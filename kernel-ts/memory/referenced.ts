/** Committed-source memory publication. Decisions annotate exact occurrences; only this owner writes. */
import { committedTurnCatalog, type CommittedTurnCatalog } from '../../runtime/jev/committed-turn-sources.ts';
import {deriveCommittedSpeechSpans} from '../../runtime/jev/committed-speech-spans.ts';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest, parsePythonJson } from '../json.js';
import { EntityIndex, memoryEvidenceView } from '../read/memory.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, normalize, number, row, string, type Row } from '../read/values.js';
import { noteMemory, readNpcLedger } from '../write/contributions.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { appendBacklog, buildJob, CANDIDATE_KINDS, jobId, logs, readJob, recoverBacklog,
    validateCandidates, validateStory, writeJob, writeLines } from './jobs.js';

const PROTOCOL = 'memory-reference-v1';
const RELATIONS = ['duplicate', 'reinforcement', 'independent', 'correction', 'contradiction', 'temporal_change'];
const ANNOTATIONS = ['kind', 'subject', 'knowers', 'entities', 'privacy', 'state', 'confidence', 'relations'];
const invalid = (message: string): never => { throw new RpcError('invalid_params', message); };
const same = (left: any, right: any) => jsonDigest(left) === jsonDigest(right);
function scopeOf(meta: Row): {worldline: string; loop: number} {
    const worldline = string(meta.active_worldline || 'main');
    return {worldline, loop: number(row(row(meta.worldlines)[worldline]).loop)};
}
interface OriginalSource {catalog: CommittedTurnCatalog; revision: string; speakers: Row[]}
async function original(campaign: CampaignWriter, turn: number): Promise<OriginalSource> {
    const retained = await campaign.readTurnRecord(turn);
    if (!retained || retained.closed_by !== 'narrate' || typeof retained.commit !== 'string' || !/^[a-f0-9]{7,64}$/.test(retained.commit))
        return invalid('Referenced memory requires an original committed narration');
    const resolved = await campaign.context.git.run(campaign.id, ['rev-parse', '--verify', `${retained.commit}^{commit}`]);
    const commit = resolved.stdout.trim();
    if (resolved.code || !/^[a-f0-9]{40,64}$/.test(commit)) return invalid('The memory commit cannot be resolved unambiguously');
    const [turnBlob, campaignBlob] = await Promise.all([
        campaign.context.git.run(campaign.id, ['show', `${commit}:turns/${String(turn).padStart(4, '0')}.json`]),
        campaign.context.git.run(campaign.id, ['show', `${commit}:campaign.json`]),
    ]);
    if (turnBlob.code || campaignBlob.code) return invalid('The committed memory source is unavailable');
    let committed: Row, meta: Row;
    try { committed = row(parsePythonJson(turnBlob.stdout)); meta = row(parsePythonJson(campaignBlob.stdout)); }
    catch { return invalid('The committed memory source is malformed'); }
    if (number(committed.turn) !== turn || committed.closed_by !== 'narrate'
        || committed.player_text !== retained.player_text || committed.rendered_text !== retained.rendered_text
        || typeof committed.rendered_text !== 'string' || (committed.player_text != null && typeof committed.player_text !== 'string'))
        return invalid('The retained turn does not match its committed original');
    const origin = scopeOf(meta), active = scopeOf(await campaign.readCampaign());
    if (!same(origin, active)) return invalid('The committed memory origin belongs to another worldline or loop');
    const catalog = committedTurnCatalog({scope: {owner: `campaign:${campaign.id}`, campaign: campaign.id,
        ...origin, audience: 'keeper'}, turn, commit, playerText: committed.player_text ?? '', keeperText: committed.rendered_text});
    const speech = deriveCommittedSpeechSpans({markedText: committed.marked_text ?? committed.rendered_text,
        renderedText: committed.rendered_text, speech: committed.speech});
    for (const segment of catalog.segments) {
        if (segment.role === 'player') { segment.attribution = {kind: 'player'}; continue; }
        if (speech.status !== 'verified' || segment.ref.selector.kind !== 'utf16') { segment.attribution = {kind: 'unknown'}; continue; }
        const start = segment.ref.selector.start + segment.text.length - segment.text.trimStart().length;
        const end = segment.ref.selector.end - (segment.text.length - segment.text.trimEnd().length);
        const overlaps = speech.spans.filter(value => value.start < end && value.end > start);
        if (!overlaps.length) { segment.attribution = {kind: 'keeper_narration'}; continue; }
        const span = overlaps.length === 1 && overlaps[0].start <= start && overlaps[0].end >= end ? overlaps[0] : undefined;
        if (!span) { segment.attribution = {kind: 'mixed'}; continue; }
        const who = row(span.who);
        segment.attribution = {kind: 'speech', speaker: {name: string(who.name || who.label),
            kind: typeof who.npc === 'string' ? 'npc' : typeof who.investigator === 'string' ? 'investigator' : 'label'}};
    }
    return {catalog, speakers: speech.status === 'verified' ? speech.spans.map(value => value.who) : [], revision: jsonDigest({commit, scope: {...catalog.snapshots[0].scope},
        sources: catalog.snapshots.map(value => ({resource: value.resource, revision: value.revision}))})};
}
async function verified(campaign: CampaignWriter, job: Row): Promise<OriginalSource> {
    const source = await original(campaign, number(job.turn));
    if (source.revision !== job.origin.revision || source.catalog.commit !== job.commit)
        return invalid('The referenced memory job source changed');
    return source;
}
function bindSpeakers(job: Row, source: OriginalSource, graph: ModuleGraph, party: Row[]): Row {
    const next = {...job, context: clone(job.context), allowed: [...array(job.allowed)], name_bindings: [] as Row[]};
    const known = array(next.context.known_entities);
    for (const speaker of source.speakers) {
        const node = typeof speaker.npc === 'string' ? graph.find(speaker.npc, ['npc']) : undefined;
        const sheet = typeof speaker.investigator === 'string' ? party.find(value => value.id === speaker.investigator) : undefined;
        if (!node && !sheet) continue;
        const kind = node ? 'npc' : 'investigator', key = `${kind}:${node ? node.node_id : sheet!.id}`;
        const canonical = node ? graph.displayName(node) : string(sheet!.name);
        if (node && !next.allowed.includes(node.node_id)) next.allowed.push(node.node_id);
        for (const name of [canonical, string(speaker.name)].filter(Boolean)) {
            if (!known.some(value => value.name === name && value.kind === kind)) known.push({name, kind});
            if (!next.name_bindings.some(value => value.name === name && value.key === key)) next.name_bindings.push({name, key, kind});
        }
    }
    next.context.known_entities = known;
    return next;
}
class ReferencedEntityIndex extends EntityIndex {
    constructor(graph: ModuleGraph, party: Row[], labels: Row, allowed: string[], readonly bindings: Row[]) { super(graph, party, labels, allowed); }
    override matches(name: string, options: Parameters<EntityIndex['matches']>[1] = {}): string[] {
        const found = super.matches(name, options);
        for (const binding of this.bindings) {
            if (normalize(binding.name) !== normalize(name) || found.includes(binding.key)) continue;
            if (binding.kind === 'investigator' ? options.investigators === false : !(options.kinds ?? ['npc', 'scene', 'clue']).includes(binding.kind)) continue;
            found.push(binding.key);
        }
        return found;
    }
}
export async function referencedSource(campaign: CampaignWriter, turn: number): Promise<Row> {
    if (!Number.isSafeInteger(turn) || turn < 0) return invalid('A committed memory source requires a turn number');
    const source = await original(campaign, turn);
    return {turn, commit: source.catalog.commit, origin: {scope: source.catalog.snapshots[0].scope, revision: source.revision}};
}
function makePacket(job: Row, catalog: CommittedTurnCatalog): Row {
    const deferred = new Set(array(job.deferred));
    const indices = (job.status === 'open' ? array(job.remaining).filter(index => !deferred.has(index)) : array(job.remaining)).slice(0, 12);
    const segments = indices.map(index => catalog.segments[number(index)]);
    const key = jsonDigest({job: job.job_id, revision: job.origin.revision, sequence: job.sequence, indices});
    return {protocol: PROTOCOL, job_id: job.job_id, turn: job.turn, commit: job.commit, origin: clone(job.origin),
        status: job.status, step: {key, sequence: job.sequence, total: catalog.segments.length, remaining: array(job.remaining).length, segments},
        known_entities: clone(job.context.known_entities), prior: job.targets.map((value: Row) => ({alias: value.alias,
            kind: value.kind, subject: value.subject, statement: value.statement, status: value.status, ...memoryEvidenceView(value)})),
        prior_coverage: clone(job.prior_coverage), ...(job.context.story_context ? {story_context: clone(job.context.story_context)} : {}),
        story_sources: catalog.segments, story_complete: Boolean(job.story), ...(job.result ? {result: clone(job.result)} : {})};
}
function nextState(job: Row, prepared: Row): Row {
    const decided = new Set(array(prepared.resolved)), deferred = new Set(array(prepared.deferred));
    const rest = array(job.remaining).filter(index => !decided.has(index) && !deferred.has(index));
    const remaining = [...rest, ...array(prepared.deferred)];
    // Do not repeatedly classify uncertain rows within one dispatch. They survive for a new owner attempt.
    const deferredAll = new Set([...array(job.deferred), ...array(prepared.deferred)]);
    for (const index of decided) deferredAll.delete(index);
    const unvisited = remaining.filter(index => !deferredAll.has(index));
    const story = prepared.story ?? job.story;
    const storyRequired = array(row(job.context.story_context).threads).length > 0;
    const status = unvisited.length ? 'open' : remaining.length || storyRequired && !story ? 'pending' : 'done';
    return {...job, remaining, deferred: [...deferredAll], ...(story ? {story} : {}), status, sequence: number(job.sequence) + 1};
}

/** Reconstructs every secondary view before marking a prepared step accepted. */
async function publishPrepared(campaign: CampaignWriter, graph: ModuleGraph, job: Row): Promise<Row> {
    const prepared = row(job.prepared), rows = await logs(campaign, 'memory/candidates.jsonl');
    for (const value of array(prepared.rows)) {
        const previous = rows.find(entry => entry.id === value.id);
        if (previous) {
            if (!same(previous, value))
                throw new RpcError('idempotency_conflict', 'A reserved memory occurrence has different content');
        } else rows.push(clone(value));
    }
    const superseded: string[] = [];
    for (const value of array(prepared.rows)) for (const link of array(value.relations)) {
        if (!['correction', 'temporal_change'].includes(link.relation)) continue;
        const old = rows.find(entry => entry.id === link.target);
        if (!old) return invalid('A prepared memory relation lost its original target');
        if (old.superseded_by != null && old.superseded_by !== value.id)
            throw new RpcError('idempotency_conflict', 'A referenced memory target was already closed by another occurrence');
        old.status = 'superseded'; old.superseded_by = value.id; old.valid_until_turn = job.turn;
        if (!superseded.includes(old.id)) superseded.push(old.id);
    }
    await writeLines(campaign, 'memory/candidates.jsonl', rows);
    const ledger = await readNpcLedger(campaign);
    noteMemory(ledger, graph, array(prepared.rows));
    await campaign.write('npc-ledger.json', ledger);
    if (prepared.story) {
        const stories = await logs(campaign, 'memory/story.jsonl');
        const previous = stories.findIndex(value => value.job_id === job.job_id);
        if (previous >= 0) stories.splice(previous, 1);
        stories.push({...clone(prepared.story), turn: job.turn, commit: job.commit, ...scopeOf({active_worldline: job.origin.scope.worldline,
            worldlines: {[job.origin.scope.worldline]: {loop: job.origin.scope.loop}}}), job_id: job.job_id, at: prepared.at});
        await writeLines(campaign, 'memory/story.jsonl', stories);
    }
    const events = await logs(campaign, 'events.jsonl');
    if (!events.some(value => value.type === 'memory-written' && row(value.data).reference_step === prepared.key))
        await campaign.appendEvent(number(job.turn), {type: 'memory-written', data: {job_id: job.job_id, turn: job.turn,
            candidates: array(prepared.rows).length, superseded: superseded.length, reference_step: prepared.key}});
    const advanced = nextState(job, prepared);
    const result = {job_id: job.job_id, turn: job.turn, status: advanced.status, remaining: array(advanced.remaining).length,
        candidates: array(prepared.rows).length, written: array(prepared.rows).map(value => value.id), superseded,
        ...(prepared.story ? {story: {status: prepared.story.status, thread: prepared.story.thread,
            bridge_delivered: prepared.story.bridge_delivered}} : {})};
    delete advanced.prepared;
    advanced.steps = [...array(job.steps), {key: prepared.key, digest: prepared.digest, prepared, result}];
    advanced.result = result;
    if (advanced.status === 'done') advanced.completed_at = nowIso();
    await writeJob(campaign, advanced);
    if (advanced.status === 'pending') await appendBacklog(campaign, job.job_id, job.turn, 'model_error', 'Referenced segments or story assessment remain deferred');
    else if (advanced.status === 'done') await recoverBacklog(campaign, job.job_id);
    return advanced;
}

export async function referencedJob(campaign: CampaignWriter, graph: ModuleGraph, language: string, turn: number, party: Row[], world: Row): Promise<Row> {
    let job = await readJob(campaign, jobId(campaign.id, turn));
    if (job && job.protocol !== PROTOCOL) return clone(job.packet);
    const source = await original(campaign, turn);
    if (!job) {
        const context = await buildJob(campaign, graph, language, turn, party, world);
        const scope = source.catalog.snapshots[0].scope;
        const eligible = (await logs(campaign, 'memory/candidates.jsonl')).filter(value => number(value.valid_from_turn) < turn
            && (value.worldline ?? 'main') === scope.worldline && number(value.loop) === scope.loop);
        const selected = eligible.slice(-64);
        job = {protocol: PROTOCOL, job_id: context.job_id, turn, commit: source.catalog.commit, record_commit: context.commit, status: 'open', sequence: 0,
            origin: {scope, revision: source.revision}, context, allowed: context._allowed, receipts: context._receipts,
            remaining: source.catalog.segments.map((_, index) => index), deferred: [], steps: [], opened_at: nowIso(),
            targets: selected.map((value, index) => ({...clone(value), alias: `prior:${index}`})),
            prior_coverage: {total: eligible.length, included: selected.length, omitted: eligible.length - selected.length}};
        job = bindSpeakers(job, source, graph, party);
        await writeJob(campaign, job);
    } else {
        await verified(campaign, job);
        if (job.prepared) job = await publishPrepared(campaign, graph, job);
        job = bindSpeakers(job, source, graph, party);
    }
    return makePacket(job, source.catalog);
}

function assessedStory(job: Row, catalog: CommittedTurnCatalog, value: any): Row | undefined {
    if (value === undefined) return undefined;
    if (!isJsonObject(value) || Object.keys(value).sort().join(',') !== 'bridge_delivered,delivery_source,frame_source,status,thread')
        return invalid('Referenced story uses status, thread, frame_source, bridge_delivered and delivery_source only');
    const segment = (alias: any, role: string) => {
        const found = catalog.segments.find(value => value.alias === alias && value.role === role);
        if (!found) return invalid('Referenced story source must be an issued occurrence of the matching speaker');
        return found;
    };
    const frame = value.frame_source === null ? undefined : segment(value.frame_source, 'player');
    const delivery = value.delivery_source === null ? undefined : segment(value.delivery_source, 'keeper');
    const assessed = validateStory({packet: {...job.context, player_text: catalog.snapshots[0].text,
        keeper_text: catalog.snapshots[1].text}}, {status: value.status, thread: value.thread,
        frame: frame?.text ?? null, bridge_delivered: value.bridge_delivered, delivery_quote: delivery?.text ?? null}, true);
    return assessed ? {...assessed, ...(frame ? {frame_ref: frame.ref} : {}), ...(delivery ? {delivery_ref: delivery.ref} : {})} : undefined;
}

export async function submitReferenced(campaign: CampaignWriter, graph: ModuleGraph, party: Row[], job: Row, value: any): Promise<Row> {
    if (job.protocol !== PROTOCOL) return invalid('This extraction job uses the legacy protocol');
    const source = await verified(campaign, job), catalog = source.catalog;
    job = bindSpeakers(job, source, graph, party);
    if (!isJsonObject(value) || Object.keys(value).some(key => !['step', 'decisions', 'story'].includes(key))
        || typeof value.step !== 'string' || !Array.isArray(value.decisions)) return invalid('Invalid referenced memory submission');
    const digest = jsonDigest(value), previous = array(job.steps).find(step => step.key === value.step);
    if (previous) {
        if (previous.digest !== digest) throw new RpcError('idempotency_conflict', 'The memory step already has a different submission');
        return {...clone(previous.result), replayed: true, next: makePacket(job, catalog)};
    }
    if (job.prepared) {
        if (job.prepared.key !== value.step || job.prepared.digest !== digest)
            throw new RpcError('idempotency_conflict', 'A different memory step is already prepared');
        job = await publishPrepared(campaign, graph, job);
        return {...clone(job.result), replayed: true, next: makePacket(job, catalog)};
    }
    const packet = makePacket(job, catalog), indices = array(packet.step.segments).map(segment => catalog.segments.findIndex(value => value.alias === segment.alias));
    if (job.status === 'done' || value.step !== packet.step.key || value.decisions.length !== indices.length)
        return invalid('Memory decisions must cover exactly the current kernel-issued step');
    const index = new ReferencedEntityIndex(graph, party, row((await campaign.readWorld()).scene_labels), array(job.allowed), array(job.name_bindings));
    const existing = await logs(campaign, 'memory/candidates.jsonl'), rows: Row[] = [], resolved: number[] = [], deferred: number[] = [];
    const at = nowIso();
    for (const [position, sourceIndex] of indices.entries()) {
        const segment = catalog.segments[number(sourceIndex)], decision = value.decisions[position];
        if (!isJsonObject(decision) || Object.keys(decision).some(key => !['source', 'outcome', 'annotations'].includes(key))
            || decision.source !== segment.alias || !['retain', 'skip', 'defer'].includes(string(decision.outcome)))
            return invalid('Memory decisions must name each issued source occurrence in order');
        if (decision.outcome !== 'retain') {
            if (decision.annotations !== undefined) return invalid('Only retained source occurrences carry annotations');
            (decision.outcome === 'defer' ? deferred : resolved).push(number(sourceIndex));
            continue;
        }
        if (!Array.isArray(decision.annotations) || !decision.annotations.length || decision.annotations.length > 8
            || new Set(decision.annotations.map(value => row(value).kind)).size !== decision.annotations.length)
            return invalid('A retained occurrence needs one to eight unique memory kinds');
        for (const annotation of decision.annotations) {
            if (!isJsonObject(annotation) || Object.keys(annotation).some(key => !ANNOTATIONS.includes(key)))
                return invalid('Memory annotations cannot supply copied statements, identifiers or source coordinates');
            const {relations: links = [], ...semantic} = annotation;
            const clean = validateCandidates(index, [{...semantic, statement: segment.text}], true)[0];
            if (clean.kind === 'world_event' && segment.attribution?.kind !== 'keeper_narration')
                return invalid('A player statement, spoken claim, mixed or unknown source cannot become an unqualified world event');
            if (['player_assertion', 'player_preference'].includes(clean.kind) && clean.subject !== 'player')
                return invalid('Player assertions and preferences must have subject player');
            delete clean._keys; delete clean._dropped;
            if (!Array.isArray(links) || links.length > 64) return invalid('Invalid memory relation list');
            const relations: Row[] = [], targetKeys = new Set<string>();
            for (const link of links) {
                if (!isJsonObject(link) || Object.keys(link).sort().join(',') !== 'relation,target'
                    || !RELATIONS.includes(string(link.relation)) || typeof link.target !== 'string' || targetKeys.has(link.target))
                    return invalid('Memory relations must choose unique issued prior occurrences');
                targetKeys.add(link.target);
                const offered = array(job.targets).find(target => target.alias === link.target);
                const target = offered && existing.find(target => target.id === offered.id);
                if (!offered || !target || offered.statement !== target.statement || offered.kind !== target.kind || offered.subject !== target.subject
                    || (target.worldline ?? 'main') !== job.origin.scope.worldline || number(target.loop) !== job.origin.scope.loop)
                    return invalid('A memory relation target is absent or changed');
                if (link.relation === 'correction' && clean.kind !== 'keeper_correction') return invalid('Only keeper corrections close explicit corrected occurrences');
                if (['correction', 'temporal_change'].includes(string(link.relation)) && target.superseded_by != null)
                    return invalid('This memory target already has a closing occurrence');
                relations.push({relation: link.relation, target: target.id});
            }
            const id = `mem:t${job.turn}-${number(sourceIndex) * 8 + CANDIDATE_KINDS.indexOf(clean.kind) + 1}`;
            if (existing.some(value => value.id === id)) throw new RpcError('idempotency_conflict', 'The source occurrence already has a different publication');
            const corrects = relations.filter(link => link.relation === 'correction').map(link => link.target);
            rows.push({id, ...clean, memory_version: 2, statement_ref: segment.ref, source_refs: [segment.ref], attribution: segment.attribution, relations,
                ...(clean.kind === 'keeper_correction' ? {corrects, correction_links_checked: true} : {}),
                status: 'candidate', source: {turn: job.turn, commit: job.commit, episode_id: `ep:t${job.turn}`, receipts: array(job.receipts)},
                worldline: job.origin.scope.worldline, loop: job.origin.scope.loop, valid_from_turn: job.turn,
                job_id: job.job_id, reference_step: value.step, at});
        }
        resolved.push(number(sourceIndex));
    }
    const story = assessedStory(job, catalog, value.story);
    const closings = rows.flatMap(value => array(value.relations).filter(link => ['correction', 'temporal_change'].includes(link.relation)).map(link => link.target));
    if (new Set(closings).size !== closings.length) return invalid('One step cannot close the same prior occurrence more than once');
    const prepared = {key: value.step, digest, rows, resolved, deferred, ...(story ? {story} : {}), at};
    job = {...job, prepared};
    await writeJob(campaign, job);
    job = await publishPrepared(campaign, graph, job);
    return {...clone(job.result), next: makePacket(job, catalog)};
}
