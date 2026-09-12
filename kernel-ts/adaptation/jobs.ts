/** Host-owned draft work is retained outside campaign history; only apply accepts it. */
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { jsonDigest, pythonJsonDumps, parsePythonJson, storedJson } from '../json.js';
import { writeJsonAtomic } from '../fileio.js';
import { CampaignSnapshot, loadModule, loadCampaignModule } from '../read/campaign.js';
import { resolveReference, referenceName } from '../read/references.js';
import { array, row, string, normalize, clone, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { ADAPTATION_FIELDS, adaptationChanges, adaptedGraph, normalizeChanges } from './graph.js';
import { snapshotSource, pinnedSource } from './source.js';
import type { ApplyContext } from '../apply/index.js';

const fail = (message: string, reason = 'adaptation_invalid'): never => { throw new RpcError('needs', message, {details: {reason}, fix: 'Inspect this proposal by name; retry preparation only after resolving the reported cause'}); };
const named = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new RpcError('invalid_params', 'Give this proposal a short semantic name');
    return value.trim();
};
async function artifact(path: string): Promise<Row> {
    if (!(await lstat(path)).isFile()) return fail('The task artifact must be a regular file');
    return row(parsePythonJson(await readFile(path, 'utf8')));
}
export class AdaptationJobs {
    constructor(readonly context: KernelContext, readonly asset: (id: string, name: string) => Promise<Row | null>) {}
    private root(campaign: string) {
        if (typeof campaign !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(campaign))
            throw new RpcError('invalid_params', 'A valid bound campaign name is required');
        return join(this.context.stateRoot, 'adaptation-jobs', campaign);
    }
    private index(campaign: string, name: string) { return join(this.root(campaign), `${jsonDigest(normalize(name))}.json`); }
    private async instructions() {
        return Promise.all(['create', 'review'].map(role => readFile(join(this.context.content, 'adaptation', `${role}.md`), 'utf8')));
    }
    private async state(campaign: string) {
        this.root(campaign);
        const snapshot = await CampaignSnapshot.open(this.context, campaign); await snapshot.preload();
        const current = await loadModule(this.context, snapshot.meta.module_id);
        const head = await this.context.git.run(campaign, ['rev-parse', 'HEAD']);
        if (head.code !== 0) return fail('Campaign history is unavailable');
        const pin = jsonDigest({world: snapshot.world, party: snapshot.party, line: snapshot.meta.active_worldline ?? 'main', head: head.stdout.trim(),
            turn: snapshot.turn.turn, player: snapshot.turn.player_text ?? null, receipts: snapshot.turn.receipts ?? [], pending: snapshot.turn.pending_choice ?? null});
        return {snapshot, current, pin};
    }
    private async job(campaign: string, name: string): Promise<Row> {
        const index = this.index(campaign, name);
        if (!await this.context.snapshots.pathExists(index)) return fail(`No adaptation proposal named ${JSON.stringify(name)}`);
        const pointer = await artifact(index);
        if (!/^[a-f0-9]{64}$/.test(pointer.key)) return fail('Invalid proposal identity');
        const path = join(this.root(campaign), pointer.key);
        const job = await artifact(join(path, 'job.json'));
        if (job.campaign !== campaign || job.key !== pointer.key || !Number.isInteger(job.attempt) || job.attempt < 1)
            return fail('The retained task identity is invalid');
        return {...job, path, work: join(path, `attempt-${job.attempt}`)};
    }
    private async save(job: Row) { const {path, ...data} = job; await writeJsonAtomic(join(path, 'job.json'), data); }
    private async fresh(job: Row): Promise<boolean> {
        const state = await this.state(job.campaign);
        return state.pin === job.pin && state.current.graph.digest === job.source_digest && state.current.generation === job.source_generation
            && jsonDigest([await this.instructions(), ADAPTATION_FIELDS]) === job.contract;
    }
    private view(job: Row): Row {
        return {name: job.name, status: job.status, reason: job.error ?? null,
            ...(job.status === 'ready' ? {changes: array(job.preview), instruction: 'This reviewed proposal changes no fiction until apply adaptation accepts it; use ordinary effects afterwards.'} : {})};
    }
    async prepare(params: Row): Promise<Row> {
        const name = named(params.name), {snapshot, current, pin} = await this.state(params.campaign);
        if (!['open', 'acting'].includes(snapshot.turn.state)) return fail('Prepare an adaptation during the current player turn');
        const rebase = params.rebase === true;
        if (rebase && array(snapshot.turn.receipts).length) return fail('Rebase only at the start of a turn before any effect');
        if (typeof params.request !== 'string' || !params.request.trim() || params.request.length > 6000)
            throw new RpcError('invalid_params', 'Explain the source-connected adaptation to prepare');
        const given = array(params.anchors);
        if (!given.length || given.length > 12 || given.some(a => typeof a !== 'string'))
            throw new RpcError('invalid_params', 'Name one to twelve original source anchors');
        const anchors: string[] = [];
        for (const anchor of given) {
            const node = resolveReference(current.graph, anchor);
            if (current.material(node.node_id) !== 'ready') return fail(`Read the original source for ${JSON.stringify(anchor)} before preparing an adaptation`, 'adaptation_material_missing');
            anchors.push(referenceName(current.graph, node));
        }
        const instructions = await this.instructions(), contract = jsonDigest([instructions, ADAPTATION_FIELDS]);
        const key = jsonDigest(['adaptation-packet-v2', contract, name, pin, current.graph.digest, current.generation, params.request, anchors, rebase]);
        const path = join(this.root(snapshot.id), key);
        if (await this.context.snapshots.pathExists(join(path, 'job.json'))) {
            const old: Row = {...await artifact(join(path, 'job.json')), path};
            if (!params.retry) return {...this.view(old), task: ['pending', 'reviewing'].includes(old.status) ? this.task(old, old.status === 'reviewing' ? 'review' : 'create') : null};
        }
        const effective = await loadCampaignModule(this.context, snapshot.meta.module_id, snapshot.world);
        const base = rebase ? current : effective.adapted ? await pinnedSource(this.context, row(snapshot.world.adaptation).source) : current;
        const source = effective.adapted && !rebase ? row(snapshot.world.adaptation).source : await snapshotSource(this.context, base, this.asset);
        const previous = adaptationChanges(snapshot.world);
        const attempt = (await this.context.snapshots.pathExists(join(path, 'job.json')) ? Number((await artifact(join(path, 'job.json'))).attempt) : 0) + 1;
        const work = join(path, `attempt-${attempt}`);
        await mkdir(join(work, 'create'), {recursive: true}); await mkdir(join(work, 'review'), {recursive: true});
        const job: Row = {key, path, work, attempt, campaign: snapshot.id, name, pin, source, contract, source_digest: current.graph.digest,
            source_generation: current.generation, previous, rebase, status: 'pending', created: nowIso()};
        const handouts = await snapshot.handoutTexts(snapshot.records.flatMap(record => array(record.receipts)));
        const currentScene = effective.graph.scene(snapshot.world.active_scene);
        const contextScene = base.graph.nodes.get(currentScene.node_id) ?? array(row(currentScene.campaign_origin).sources)
            .map(id => base.graph.nodes.get(id)).find(node => node?.node_kind === 'scene');
        const files: Row = {original: 'original.json', effective: 'effective.json', world: 'world.json', party: 'party.json',
            prior_changes: 'prior-changes.json', current_receipts: 'current-receipts.json', history: 'history.json', handouts: 'handouts.json', memory: 'memory.json'};
        const inputs: Row = {original: base.graph.raw, effective: effective.graph.raw, world: snapshot.world, party: snapshot.party,
            prior_changes: previous, current_receipts: snapshot.turn.receipts,
            history: snapshot.records.map(record => ({turn: record.turn, player_text: record.player_text ?? null, rendered_text: record.rendered_text ?? '', receipts: record.receipts ?? [], world: record.world ?? null})),
            handouts: Object.fromEntries(handouts), memory: await snapshot.log('memory/candidates.jsonl')};
        const request = {schema: 2, request: params.request, anchors, rebase, play_language: snapshot.meta.play_language,
            current_input: snapshot.turn.player_text, files,
            source_scene: contextScene?.node_kind === 'scene' ? referenceName(base.graph, contextScene) : null,
            creator_contract: {result_fields: ['explanation', 'changes'], required_change_fields: ['kind', 'reason', 'sources'],
                operation_fields: ADAPTATION_FIELDS, optional_fields: {scene: ['name']},
                references: 'Use existing semantic names or kind: name. Add operations precede references to their new names. sources and based_on refer only to the ORIGINAL graph. Kernel-normalized candidates for review additionally contain kernel-owned identities.'},
            instructions: 'These files are the complete retained inputs for this task. Source and effective graph are distinct authorities. Use the supplied node executable to inspect large JSON fields. Do not inspect repository code, event logs, model requests, credentials, or search the filesystem for PDFs. If required evidence is absent, report that gap.'};
        for (const role of ['create', 'review']) {
            await writeFile(join(work, role, 'request.json'), storedJson(request), {mode: 0o400});
            for (const [key, value] of Object.entries(inputs)) await writeFile(join(work, role, files[key]), storedJson(value), {mode: 0o400});
            await writeFile(join(work, role, 'prompt.md'), instructions[role === 'create' ? 0 : 1]);
        }
        await this.save(job); await writeJsonAtomic(this.index(snapshot.id, name), {key});
        return {...this.view(job), task: this.task(job, 'create')};
    }
    private task(job: Row, role: string): Row { const cwd = join(job.work, role); return {key: job.key, attempt: job.attempt, cwd, system_prompt: join(cwd, 'prompt.md'), role}; }
    async status(params: Row): Promise<Row> {
        const job = await this.job(params.campaign, named(params.name));
        const state = await this.state(job.campaign);
        if (array(row(state.snapshot.world.adaptation).records).some(record => record.draft === job.draft_digest && record.review === job.review_digest && job.review_digest))
            return {...this.view(job), status: 'accepted'};
        if (!['accepted', 'cancelled', 'failed'].includes(job.status) && !await this.fresh(job)) { job.status = 'stale'; await this.save(job); }
        return this.view(job);
    }
    private async active(params: Row, status: string): Promise<Row> {
        const job = await this.job(params.campaign, named(params.name));
        if (job.key !== params.key || job.attempt !== params.attempt || job.status !== status) return fail('This task no longer owns the active proposal');
        if (!await this.fresh(job)) { job.status = 'stale'; await this.save(job); return fail('The campaign or source changed while this proposal was prepared', 'adaptation_stale'); }
        return job;
    }
    async draft(params: Row): Promise<Row> {
        const job = await this.active(params, 'pending'), value = await artifact(join(job.work, 'create', 'result.json'));
        if (!job.rebase && Array.isArray(value.changes) && value.changes.length === 0)
            return fail(`Draft declined: ${string(value.explanation || 'No supported change could be prepared').slice(0, 1600)}`, 'adaptation_declined');
        const source = await pinnedSource(this.context, job.source), state = await this.state(job.campaign);
        const changes = job.rebase ? [] : normalizeChanges(source.graph, job.previous, state.snapshot.world, value.changes, job.key);
        if (changes.some(change => change.id && state.snapshot.party.some(actor => normalize(actor.name) === normalize(change.name))))
            return fail('An added entity cannot reuse an investigator name');
        if (job.rebase && array(value.changes).length) return fail('A rebase must preserve the accepted changes exactly');
        const all = [...job.previous, ...changes];
        for (const change of all) for (const id of array(change.sources))
            if (source.material(id) !== 'ready') return fail('The candidate depends on unread source material', 'adaptation_material_missing');
        const effective = adaptedGraph(source.graph, all);
        const candidate = {changes, effective: effective.raw, explanation: value.explanation ?? '', rebase: job.rebase};
        job.draft_digest = jsonDigest(candidate); job.changes = changes;
        job.preview = changes.map(c => ({kind: c.kind, ...(c.name ? {name: c.name} : {}), reason: c.reason,
            ...Object.fromEntries(['from', 'to', 'scene', 'npc', 'clue', 'based_on'].filter(field => c[field]).map(field => {
                const node = effective.nodes.get(c[field]); return [field, node ? effective.handle(node) : null];
            })),
            sources: array(c.sources).map(id => source.graph.nodes.get(id)?.name ?? null),
            ...(c.description ? {description: c.description} : {}),
            ...(c.agenda ? {agenda: c.agenda} : {}),
            ...(c.text ? {text: c.text} : {})}));
        const candidatePath = join(job.work, 'review', 'candidate.json');
        if (await this.context.snapshots.pathExists(candidatePath)) {
            if (jsonDigest(await artifact(candidatePath)) !== job.draft_digest) return fail('A retained draft differs; retry preparation to retain a new attempt');
        } else await writeFile(candidatePath, storedJson(candidate), {flag: 'wx', mode: 0o400});
        job.status = 'reviewing'; await this.save(job);
        return {name: job.name, status: job.status, task: this.task(job, 'review')};
    }
    async review(params: Row): Promise<Row> {
        const job = await this.active(params, 'reviewing'), candidate = await artifact(join(job.work, 'review', 'candidate.json')),
            review = await artifact(join(job.work, 'review', 'result.json'));
        if (jsonDigest(candidate) !== job.draft_digest) return fail('Candidate bytes changed during review');
        const checked = array(review.checked), count = job.rebase ? job.previous.length : job.changes.length;
        const indices = new Set(checked.filter(c => c.verdict === 'supported' && typeof c.reason === 'string' && c.reason.trim()).map(c => c.index));
        if (review.verdict !== 'supported' || !Array.isArray(review.issues) || review.issues.length || typeof review.summary !== 'string' || !review.summary.trim() || indices.size !== count ||
            Array.from({length: count}, (_, i) => i).some(i => !indices.has(i)) || checked.length !== count)
            return fail('Independent review did not support every change without unresolved issues', 'adaptation_review_failed');
        job.review_digest = jsonDigest(review); job.status = 'ready'; await this.save(job); return this.view(job);
    }
    async cancel(params: Row): Promise<Row> {
        const job = await this.job(params.campaign, named(params.name));
        if ((await this.status(params)).status === 'accepted') return fail('An accepted adaptation cannot be cancelled');
        job.status = 'cancelled'; await this.save(job); return this.view(job);
    }
    async failed(params: Row): Promise<Row> {
        const job = await this.job(params.campaign, named(params.name));
        if (job.key === params.key && job.attempt === params.attempt && ['pending', 'reviewing'].includes(job.status)) {
            job.status = 'failed'; job.error = string(params.error).slice(0, 1000); await this.save(job);
        }
        return this.view(job);
    }
    async stage(context: ApplyContext, effect: Row): Promise<{receipt: Row; event: Row}> {
        const job = await this.job(context.campaign.id, named(effect.name));
        if (job.status !== 'ready') return fail('Only a ready independently reviewed adaptation can be accepted');
        if (!await this.fresh(job)) return fail('The proposal is stale; prepare it against this exact turn again', 'adaptation_stale');
        if (job.rebase && array(context.turn.receipts).length) return fail('Rebase before any other effect in this turn');
        const candidate = await artifact(join(job.work, 'review', 'candidate.json')), review = await artifact(join(job.work, 'review', 'result.json'));
        if (jsonDigest(candidate) !== job.draft_digest || jsonDigest(review) !== job.review_digest) return fail('Reviewed proposal evidence changed');
        const records = [...array(row(context.world.adaptation).records), {name: job.name, changes: job.changes, at: nowIso(),
            turn: context.turn.turn, draft: job.draft_digest, review: job.review_digest, rebase: job.rebase}];
        const state = {source: job.source, records, revision: jsonDigest([job.source, records])};
        context.world.adaptation = state;
        const receipt = {id: context.mint(`adaptation:${job.key.slice(0, 16)}`), kind: 'adaptation', name: job.name, visibility: 'keeper',
            call_id: context.callId, at: nowIso(), revision: state.revision};
        return {receipt, event: {type: 'adaptation-accepted', data: {name: job.name, revision: state.revision}}};
    }
    handlers(): HandlerGroup {
        return {'adaptation.prepare': p => this.prepare(p), 'adaptation.status': p => this.status(p), 'adaptation.draft': p => this.draft(p),
            'adaptation.review': p => this.review(p), 'adaptation.cancel': p => this.cancel(p), 'adaptation.fail': p => this.failed(p)};
    }
}
