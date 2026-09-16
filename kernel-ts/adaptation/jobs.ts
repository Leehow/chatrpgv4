/** Host-owned draft work is retained outside campaign history; only apply accepts it. */
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { jsonDigest, parsePythonJson, storedJson } from '../json.js';
import { writeJsonAtomic } from '../fileio.js';
import { CampaignSnapshot, loadModule, loadCampaignModule } from '../read/campaign.js';
import { resolveReference, referenceName } from '../read/references.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, row, string, normalize, chars, type Row } from '../read/values.js';
import { continuityView } from '../read/continuity.js';
import { nowIso } from '../write/store.js';
import { ADAPTATION_FIELDS, adaptationChanges, adaptedGraph, normalizeChanges } from './graph.js';
import { snapshotSource, pinnedSource } from './source.js';
import type { ApplyContext } from '../apply/index.js';

const fail = (message: string, reason = 'adaptation_invalid'): never => { throw new RpcError('needs', message, {details: {reason}, fix: 'Inspect this proposal by name; retry preparation only after resolving the reported cause'}); };
const STALE_REASON = 'The world, party, worldline or source moved after this proposal was pinned, so the retained work was abandoned';
const STALE_INSTRUCTION = 'This proposal is finished: nothing is running, nothing was built, and no scene, person or handout from it exists. '
    + 'Preparation is the only thing that revives it -- call lookup kind=adaptation action=prepare with this same name, purpose, anchors and request '
    + 'to start a fresh attempt pinned to the current turn, or continue without it and tell the player nothing is still being prepared.';
/**
 * A place the module already registered is never minted a second time.
 *
 * `new_destination` requires `add_scene`, so until now the only thing the system could say about a
 * place-name that was not a handle was "absent -- mint a node". On 2026-09-15 a player said they
 * would stand in the Boston Globe's lobby at Wilmot's counter; the lookup missed, an adaptation was
 * prepared, and the creator minted `add_scene "Boston Globe lobby"` `based_on scene-newspaper-morgue`
 * with its own reason reading "Same building: lobby connects through the hall and iron door to the
 * existing clipping morgue". Creator and reviewer both knew, and minted anyway, because the shape
 * left them nothing else to say. The Keeper then moved Arty Wilmot into the copy, while the authored
 * affordance, the presence requirement and three clues stayed on the original: the player was
 * standing in a hollow duplicate of a room the book had already written.
 *
 * `placeOf` is the whole test -- the same resolver `move.to` uses, on authored names only -- so
 * there is no second rule here to keep in step with the first.
 */
function coveredPlace(graph: ModuleGraph, name: string): Row | null {
    const place = graph.placeOf(name);
    return place && normalize(graph.handle(place)) !== normalize(name) ? place : null;
}
const samePlace = (graph: ModuleGraph, place: Row, requested: string): never => {
    throw new RpcError('needs', `${JSON.stringify(requested)} is part of ${JSON.stringify(graph.placeName(place))}, a place this module already registers`, {
        fix: `Do not adapt a second scene for it. Move to ${JSON.stringify(graph.handle(place))} and narrate the part the player named as the inside of that place; whoever waits there and whatever they ask for are ordinary play, not a new destination.`,
        details: {reason: 'same_place', requested, scene: graph.handle(place), place: graph.placeName(place)}
    });
};
const PURPOSES = ['new_destination', 'persistent_npc', 'source_rebinding', 'handout', 'rebase'] as const;
type Purpose = typeof PURPOSES[number];
const PURPOSE_CHANGES: Record<Purpose, readonly string[]> = {
    new_destination: Object.keys(ADAPTATION_FIELDS),
    persistent_npc: ['add_npc', 'npc_knows'],
    source_rebinding: ['scene', 'clue_at', 'route', 'npc_knows'],
    handout: ['handout'],
    rebase: []
};
function purpose(params: Row, rebase: boolean): Purpose {
    const value = params.purpose;
    if (typeof value !== 'string' || !PURPOSES.includes(value as Purpose))
        throw new RpcError('invalid_params', `Adaptation prepare needs purpose: ${PURPOSES.join(' | ')}`);
    if ((value === 'rebase') !== rebase)
        throw new RpcError('invalid_params', 'purpose rebase and rebase true must be used together');
    return value as Purpose;
}
function validatePurpose(value: Purpose, changes: Row[]) {
    const allowed = PURPOSE_CHANGES[value], kinds = changes.map(change => string(change.kind));
    const invalid = kinds.find(kind => !allowed.includes(kind));
    if (invalid) throw new RpcError('invalid_params', `Adaptation purpose ${value} does not permit ${invalid}`, {details: {field: 'purpose', purpose: value, allowed: [...allowed]}});
    const required = value === 'new_destination' ? 'add_scene' : value === 'persistent_npc' ? 'add_npc' : value === 'handout' ? 'handout' : null;
    if (required && !kinds.includes(required))
        throw new RpcError('invalid_params', `Adaptation purpose ${value} requires ${required}`, {details: {field: 'purpose', purpose: value, required}});
    if (value === 'rebase' && changes.length)
        throw new RpcError('invalid_params', 'A rebase adaptation permits no new changes', {details: {field: 'purpose', purpose: value}});
}
function focusedNodes(graph: any, roots: Row[]): Row[] {
    const ids = new Set<string>();
    for (const node of roots) if (node?.node_id && ids.size < 12) ids.add(node.node_id);
    for (const id of [...ids]) {
        for (const edge of [...(graph.out.get(id) ?? []), ...(graph.incoming.get(id) ?? [])]) {
            if (ids.size >= 12) break;
            const other = edge.from_node_id === id ? edge.to_node_id : edge.from_node_id;
            if (graph.nodes.has(other)) ids.add(other);
        }
    }
    return [...ids].flatMap(id => {
        const node = graph.nodes.get(id); if (!node) return [];
        return [{...graph.entityView(node), claims: (graph.claimsBySubject.get(id) ?? []).slice(0, 4).map((claim: Row) =>
            Object.fromEntries(['predicate', 'object', 'source_refs'].filter(key => claim[key] != null).map(key => [key, claim[key]])))}];
    });
}
function canonicalizeAnchorReferences(graph: any, anchors: string[], input: unknown): unknown {
    if (!Array.isArray(input)) return input;
    const choices = new Map<string, Set<string>>();
    for (const anchor of anchors) {
        const node = resolveReference(graph, anchor), canonical = referenceName(graph, node);
        for (const value of [graph.handle(node), node.name, node.node_id]) {
            const key = normalize(value); if (!key) continue;
            const values = choices.get(key) ?? new Set<string>(); values.add(canonical); choices.set(key, values);
        }
    }
    const canonical = (value: unknown): unknown => {
        if (typeof value !== 'string') return value;
        const values = choices.get(normalize(value));
        return values?.size === 1 ? [...values][0] : value;
    };
    return input.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const change: Row = {...value};
        if (Array.isArray(change.sources)) change.sources = change.sources.map(canonical);
        for (const field of ['scene', 'clue', 'from', 'to', 'npc', 'based_on']) if (change[field] != null) change[field] = canonical(change[field]);
        return change;
    });
}
/**
 * The world the review is shown -- and, for exactly that reason, the world the pin protects.
 *
 * `focus.world` is the world surface of an adaptation task: the creator writes against it and the
 * reviewer judges against it, and `world.json` is a named fallback for *semantic* facts absent from
 * it. Until 2026-09-16 the pin digested the whole world row instead, which is the same row plus the
 * engine's own bookkeeping -- `mods` (per-package locks, lane dossiers stamped with a turn,
 * natural-npc check records, queued mod work), `objects` (the item registry), and the label/map
 * projections. None of that is evidence a proposal can be supported or contradicted by, and all of
 * it moves while the table is doing nothing: on campaign `game-ef7545c5` the npc-voice lane wrote a
 * dossier -- no receipt, no fiction -- and a reviewed proposal went from `ready` to `stale` in the
 * same breath. Since a preparation that outruns its ~12-second foreground wait meets the next such
 * write, background preparation could never finish, and the creator's completed work was thrown
 * away with it.
 *
 * So this list is the pin, not a blocklist of what to ignore: a field nobody put in front of the
 * review cannot be the thing the review depended on, and a field someone later decides the review
 * needs is added here once and is pinned by that same act. The two consumers below share this
 * constant so they cannot drift apart.
 */
const REVIEWED_WORLD = ['active_scene', 'visited_scenes', 'scene_trail', 'discovered_clues', 'flags', 'clock', 'npc_presence', 'handouts_shown'] as const;
/**
 * `adaptation` is the one load-bearing field the focus row does not carry raw: the review reads it
 * projected as `prior_changes`, and it decides both the pinned source and the accepted records that
 * `normalizeChanges` built this candidate on top of. Accepting against a different record set would
 * layer reviewed changes onto a graph nobody reviewed, so the pin carries the field itself.
 */
const PINNED_WORLD = [...REVIEWED_WORLD, 'adaptation'] as const;
/** Fixed key order, and an absent field pins as absent rather than as a hole the next one fills. */
const pinnedWorld = (world: Row): Row => Object.fromEntries(PINNED_WORLD.map(key => [key, world[key] ?? null]));
const compactReceipt = (receipt: Row): Row => Object.fromEntries(
    ['id', 'kind', 'call_id', 'actor', 'subject', 'npc', 'scene', 'clue', 'handout', 'name', 'from', 'to', 'delta', 'before', 'after']
        .filter(key => receipt[key] != null).map(key => [key, receipt[key]]));
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
        const current = await loadModule(this.context, snapshot.meta.module_id, snapshot.id);
        // A pending preparation is allowed to cross an honest wait-only narrate and a later status
        // request. Those change HEAD, turn and player text but not the world the proposal will alter.
        // The reviewed world, the party, the worldline and the source generation still invalidate
        // every material change; final apply remains subject to the current player's action-admission
        // review.
        const pin = jsonDigest({world: pinnedWorld(snapshot.world), party: snapshot.party, line: snapshot.meta.active_worldline ?? 'main'});
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
        // Contract §37.6: a refusal the Keeper cannot read is a refusal it repeats. The independent
        // reviewer's own words travel to the surface, not the generic sentence the failure carries.
        const refusal = row(job.refusal);
        return {name: job.name, purpose: job.purpose, status: job.status,
            reason: job.error ?? (job.status === 'stale' ? STALE_REASON : null),
            // §36.15: a stale job is finished, and until now it said so in one word and stopped there.
            // `status` is the diagnostic path the wait instruction points at, so it is where the one
            // call that can revive the proposal has to be named -- a Keeper executes the fix it reads
            // literally, and "stale" with no call in it is a dead end (campaign game-ef7545c5).
            ...(job.status === 'stale' ? {instruction: STALE_INSTRUCTION} : {}),
            ...(job.status === 'failed' && Object.keys(refusal).length ? {refused: refusal,
                instruction: 'The independent source review contradicted this exact placement. Do not prepare the same placement again: propose a materially different one the original source supports, or continue the chosen action without it and leave the causal thread standing.'} : {}),
            ...(job.status === 'ready' ? {changes: array(job.preview), instruction: 'This reviewed proposal changes no fiction until apply adaptation accepts it; use ordinary effects afterwards.'} : {})};
    }
    async prepare(params: Row): Promise<Row> {
        const name = named(params.name), {snapshot, current, pin} = await this.state(params.campaign);
        if (!['open', 'acting'].includes(snapshot.turn.state)) return fail('Prepare an adaptation during the current player turn');
        const rebase = params.rebase === true;
        const requestedPurpose = purpose(params, rebase);
        if (rebase && array(snapshot.turn.receipts).length) return fail('Rebase only at the start of a turn before any effect');
        if (typeof params.request !== 'string' || !params.request.trim() || params.request.length > 6000)
            throw new RpcError('invalid_params', 'Explain the source-connected adaptation to prepare');
        // Before the creator is paid for a turn of work: a destination the module already registers
        // is not prepared at all. The requested name is what is tested -- the request prose is not,
        // because a place's name found loose in a paragraph is a substring search over prose, which
        // is the mistake `phraseWithin` exists to refuse.
        if (requestedPurpose === 'new_destination') {
            const covered = coveredPlace(current.graph, name);
            if (covered) samePlace(current.graph, covered, name);
        }
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
        const key = jsonDigest(['adaptation-packet-v2', contract, name, pin, current.graph.digest, current.generation, params.request, anchors, requestedPurpose, rebase]);
        const path = join(this.root(snapshot.id), key);
        if (await this.context.snapshots.pathExists(join(path, 'job.json'))) {
            const old: Row = {...await artifact(join(path, 'job.json')), path};
            // A stale retained attempt is abandoned work, and `prepare` is what the stale instruction
            // sends the Keeper back to: answering it with the same dead view and `task: null` would
            // make that instruction a loop. Every other retained status still answers as itself --
            // `failed` keeps the reviewer's refusal, `ready` keeps its reviewed changes -- and only
            // an explicit `retry` restarts those. Falling through starts attempt n+1 at this key.
            if (!params.retry && old.status !== 'stale')
                return {...this.view(old), task: ['pending', 'reviewing'].includes(old.status) ? this.task(old, old.status === 'reviewing' ? 'review' : 'create') : null};
        }
        const effective = await loadCampaignModule(this.context, snapshot.meta.module_id, snapshot.world, snapshot.id);
        const base = rebase ? current : effective.adapted ? await pinnedSource(this.context, row(snapshot.world.adaptation).source) : current;
        const source = effective.adapted && !rebase ? row(snapshot.world.adaptation).source : await snapshotSource(this.context, base, this.asset);
        const previous = adaptationChanges(snapshot.world);
        const attempt = (await this.context.snapshots.pathExists(join(path, 'job.json')) ? Number((await artifact(join(path, 'job.json'))).attempt) : 0) + 1;
        const work = join(path, `attempt-${attempt}`);
        await mkdir(join(work, 'create'), {recursive: true}); await mkdir(join(work, 'review'), {recursive: true});
        const job: Row = {key, path, work, attempt, campaign: snapshot.id, name, purpose: requestedPurpose, anchors, pin, source, contract, source_digest: current.graph.digest,
            source_generation: current.generation, previous, rebase, status: 'pending', created: nowIso()};
        const handouts = await snapshot.handoutTexts(snapshot.records.flatMap(record => array(record.receipts)));
        const currentScene = effective.graph.scene(snapshot.world.active_scene);
        const contextScene = base.graph.nodes.get(currentScene.node_id) ?? array(row(currentScene.campaign_origin).sources)
            .map(id => base.graph.nodes.get(id)).find(node => node?.node_kind === 'scene');
        const candidates = await snapshot.log('memory/candidates.jsonl');
        const baseRoots = anchors.flatMap(anchor => { try { return [resolveReference(base.graph, anchor)]; } catch { return []; } });
        if (contextScene && !baseRoots.some(node => node.node_id === contextScene.node_id)) baseRoots.push(contextScene);
        const recentHistory = snapshot.records.slice(-6).map(record => ({turn: record.turn, player_text: chars(string(record.player_text), 1200),
            rendered_text: chars(string(record.rendered_text), 1600), receipts: array(record.receipts).map(compactReceipt)}));
        const focusWorld = {...snapshot.world, ...(contextScene ? {active_scene: base.graph.handle(contextScene)} : {})};
        const focus = {schema: 1, purpose: requestedPurpose, request: params.request, current_input: snapshot.turn.player_text,
            allowed_operations: PURPOSE_CHANGES[requestedPurpose], required_operation: requestedPurpose === 'new_destination' ? 'add_scene' : requestedPurpose === 'persistent_npc' ? 'add_npc' : requestedPurpose === 'handout' ? 'handout' : null,
            change_example: {kind: requestedPurpose === 'persistent_npc' ? 'add_npc' : requestedPurpose === 'handout' ? 'handout' : 'add_scene',
                note: 'Every change uses the exact kind field. New names are plain; copy kind-qualified existing references from anchors or source.name.'},
            anchors, source: focusedNodes(base.graph, baseRoots),
            effective_scene: effective.graph.entityView(currentScene),
            world: Object.fromEntries(REVIEWED_WORLD.filter(key => snapshot.world[key] != null).map(key => [key, snapshot.world[key]])),
            party: snapshot.party.map(actor => ({name: actor.name, occupation: actor.occupation ?? null})),
            current_receipts: array(snapshot.turn.receipts).map(compactReceipt), recent_history: recentHistory,
            recent_history_complete: snapshot.records.length <= recentHistory.length,
            continuity: continuityView(base.graph, focusWorld, snapshot.records, candidates, {anchors, limit: 4, budget: 6000}),
            prior_changes: previous,
            ordinary_alternatives: {physical_item: 'Use apply define/object/item; physical items are not graph adaptations.',
                first_appearance_npc: 'A compatible first-appearance supporting person may remain narration. Promote only when recurring identity or sourced knowledge must persist.',
                scenery: 'Compatible ordinary scenery may remain narration.'},
            full_files: ['original.json', 'effective.json', 'world.json', 'party.json', 'current-receipts.json', 'history.json', 'handouts.json', 'memory.json'],
            full_file_rule: 'Read a full file only for a named evidence gap absent from this focus. Do not enumerate schemas or files.'};
        const files: Row = {focus: 'focus.json', original: 'original.json', effective: 'effective.json', world: 'world.json', party: 'party.json',
            prior_changes: 'prior-changes.json', current_receipts: 'current-receipts.json', history: 'history.json', handouts: 'handouts.json', memory: 'memory.json'};
        const inputs: Row = {focus, original: base.graph.raw, effective: effective.graph.raw, world: snapshot.world, party: snapshot.party,
            prior_changes: previous, current_receipts: snapshot.turn.receipts,
            history: snapshot.records.map(record => ({turn: record.turn, player_text: record.player_text ?? null, rendered_text: record.rendered_text ?? '', receipts: record.receipts ?? [], world: record.world ?? null})),
            handouts: Object.fromEntries(handouts), memory: candidates};
        const request = {schema: 2, request: params.request, purpose: requestedPurpose, anchors, rebase, play_language: snapshot.meta.play_language,
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
    private async retained(params: Row): Promise<Row> {
        const root = this.root(params.campaign);
        let names: string[];
        try { names = (await readdir(root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {status: 'none'};
            throw error;
        }
        const state = await this.state(params.campaign), accepted = array(row(state.snapshot.world.adaptation).records);
        const jobs: Row[] = [];
        for (const name of names) {
            try {
                const pointer = await artifact(join(root, name)), path = join(root, string(pointer.key));
                const job: Row = {...await artifact(join(path, 'job.json')), path};
                if (job.campaign !== params.campaign || !['pending', 'reviewing', 'ready', 'failed', 'stale'].includes(string(job.status))) continue;
                if (accepted.some(record => record.draft === job.draft_digest && record.review === job.review_digest && job.review_digest)) continue;
                if (['pending', 'reviewing', 'ready'].includes(string(job.status)) && !await this.fresh(job)) {
                    job.status = 'stale'; await this.save(job);
                }
                jobs.push(job);
            } catch { /* Explicit named status remains the diagnostic path for malformed retained evidence. */ }
        }
        jobs.sort((a, b) => string(b.created).localeCompare(string(a.created)) || Number(b.attempt) - Number(a.attempt) || string(a.name).localeCompare(string(b.name)));
        return jobs.length ? {...this.view(jobs[0]), attempt: jobs[0].attempt, retained: true} : {status: 'none'};
    }
    async status(params: Row): Promise<Row> {
        if (params.name == null) return this.retained(params);
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
        const changes = job.rebase ? [] : normalizeChanges(source.graph, job.previous, state.snapshot.world,
            canonicalizeAnchorReferences(source.graph, array(job.anchors).map(string), value.changes), job.key);
        validatePurpose(job.purpose as Purpose, changes);
        // The same test again, on the name the creator actually minted. `prepare` sees the Keeper's
        // proposal name; the creator is free to choose another, and on 2026-09-15 it did -- the
        // prepared name and the minted "Boston Globe lobby" were not the same string. One rule, two
        // gates, and neither of them a signature: "based_on an existing scene, routes both ways, no
        // new authored content" is equally the shape of a legitimate new room, and refusing on it
        // would refuse the adaptations this path exists for.
        for (const change of changes)
            if (string(change.kind) === 'add_scene') {
                const covered = coveredPlace(source.graph, string(change.name));
                if (covered) samePlace(source.graph, covered, string(change.name));
            }
        if (changes.some(change => change.id && state.snapshot.party.some(actor => normalize(actor.name) === normalize(change.name))))
            return fail('An added entity cannot reuse an investigator name');
        if (job.rebase && array(value.changes).length) return fail('A rebase must preserve the accepted changes exactly');
        const all = [...job.previous, ...changes];
        for (const change of all) for (const id of array(change.sources))
            if (source.material(id) !== 'ready') return fail('The candidate depends on unread source material', 'adaptation_material_missing');
        const effective = adaptedGraph(source.graph, all);
        const candidate = {changes, explanation: value.explanation ?? '', rebase: job.rebase,
            deterministic: {closed_fields: true, references_resolved: true, purpose_validated: true,
                original_graph_unchanged: true, generated_ids_kernel_owned: true}};
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
            Array.from({length: count}, (_, i) => i).some(i => !indices.has(i)) || checked.length !== count) {
            const line = (value: unknown) => chars(string(value), 400);
            const refusal: Row = {
                ...(string(review.summary).trim() ? {summary: line(review.summary)} : {}),
                ...(array(review.issues).length ? {issues: array(review.issues).slice(0, 4).map(line)} : {}),
                ...(checked.some(entry => row(entry).verdict !== 'supported')
                    ? {contradicted: checked.filter(entry => row(entry).verdict !== 'supported').slice(0, 4).map(entry => line(row(entry).reason))}
                    : {})
            };
            if (Object.keys(refusal).length) { job.refusal = refusal; await this.save(job); }
            return fail('Independent review did not support every change without unresolved issues', 'adaptation_review_failed');
        }
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
