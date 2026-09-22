/** Extraction packets and retained candidate evidence; no model calls or fact promotion. */
import { join } from 'node:path';
import { RpcError, pythonTypeName } from '../errors.js';
import { isJsonObject, jsonDigest, pythonJsonDumps, type JsonValue } from '../json.js';
import { appendJsonl, writeTextAtomic } from '../fileio.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { committedFacts } from '../write/text.js';
import { ModuleGraph } from '../read/module-graph.js';
import { sceneLabel } from '../read/capsule.js';
import { EntityIndex, queryCandidates } from '../read/memory.js';
import { storyAssessmentContext } from '../read/story.js';
import {validateCorrectionRefs, bindCorrectionRefs, applyCorrectionLinks} from './corrections.js';
import { array, row, clone, string, number, integer, numeric, truth, repr, sorted, length, type Row } from '../read/values.js';
export const CANDIDATE_KINDS = ['world_event', 'knowledge', 'belief', 'relationship', 'player_assertion', 'player_preference', 'keeper_correction', 'promise'];
const FIELDS = ['kind', 'subject', 'knowers', 'statement', 'entities', 'privacy', 'state', 'confidence', 'corrects'];
const MACHINE = ['commit', 'receipt', 'receipts', 'turn', 'id', 'job_id', 'episode_id', 'call_id', 'source'];
const PRIVACY = ['player_safe', 'keeper_only'], STATES = ['accurate', 'uncertain', 'distorted'];
export const FAILURE_REASONS = ['invalid', 'lane_error', 'model_error'];
const STORY_STATUSES = ['aligned', 'unclear', 'misframed', 'detached'];
export const episodeId = (turn: number) => `ep:t${turn}`;
export const jobId = (campaign: string, turn: number) => `extract:${campaign}:t${turn}`;
export const proseOf = (value: any): string => truth(value) ? string(value).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '') : '';
const instruction = (language: string) => 'Write only what is new this turn: facts, knowledge, beliefs, relationships, player assertions. ' +
    'For subject use a name from known_entities, or one of the reserved subjects world, party, keeper, player, ' +
    'as the kind allows: a world_event uses subject world; a player_assertion or player_preference uses subject ' +
    'player. For knowers use known NPC or investigator names, or party, keeper or player. For entities use only ' +
    'the actual semantic names supplied in known_entities (the people, clues, scenes or other entities the ' +
    'statement is about), and never the reserved words world, party, keeper or player. ' +
    'no numbers or dice; do not repeat what prior already holds. Each candidate has kind (one of world_event, ' +
    'knowledge, belief, relationship, player_assertion, player_preference, keeper_correction, promise), subject and ' +
    "statement; a world_event's subject must be world; a relationship names exactly one entity in entities. " +
    'A relationship is directed: subject is the person whose view of the other person changed, and entities ' +
    'contains that other person alone. Preserve the concrete shared event or explicit statement that supports ' +
    'trust, distrust, gratitude, resentment or changed cooperation. Do not infer a lasting change from courtesy ' +
    'alone, turn a promise into its fulfillment, or invent the reverse person\'s feelings. ' +
    'When someone promised something with a deadline or a condition, write a promise: subject is the one who ' +
    'promised, entities the one promised to and what it concerns, statement the condition or deadline. ' +
    'When an NPC learned something, took a position or gave their word this turn, say so with them in it: a ' +
    'knowledge or belief whose knowers include them, or a promise whose subject is them -- that is what puts it ' +
    'on their account, and the keeper reads it back the next time they are in the room. ' +
    'For an explicit correction or retraction, use keeper_correction and corrects: copy the exact subject and statement of each earlier claim it withdraws from correction_targets. Use [] when none applies. Do not repeat the withdrawn claim as new knowledge. A report of what someone said is not verified module truth. ' +
    `Write every statement in the campaign's play language (${language}): the keeper reads it back and the player ` +
    'may see it through recall. Never write ids, turn numbers, receipts or any machine key.';
export async function logs(campaign: CampaignWriter, path: string): Promise<Row[]> {
    return clone((await campaign.context.snapshots.readJsonl(campaign.path(path))).map(value => {
        if (!isJsonObject(value))
            throw new RpcError('internal', `AttributeError: '${pythonTypeName(value as JsonValue)}' object has no attribute 'get'`);
        return value;
    }));
}
export async function writeLines(campaign: CampaignWriter, path: string, rows: Row[]): Promise<void> {
    await writeTextAtomic(campaign.path(path), rows.map(value => pythonJsonDumps(value) + '\n').join(''));
}
export async function records(campaign: CampaignWriter): Promise<Map<number, Row>> {
    return new Map((await campaign.files('turns')).map(value => [number(value.turn), value]));
}
export async function committedRecords(campaign: CampaignWriter): Promise<Map<number, Row>> {
    return new Map([...await records(campaign)].filter(([, value]) => value.closed_by === 'narrate' && truth(value.commit)));
}
export function parseJobId(campaign: CampaignWriter, value: any): number {
    const found = typeof value === 'string' ? /^(extract|reconcile):([A-Za-z0-9][A-Za-z0-9._-]{0,63}):t(\d+)(?:-(\d+)(?::[a-f0-9]{12})?)?$/.exec(value) : null;
    if (!found || found[2] !== campaign.id || (found[1] === 'extract' ? found[4] != null : !found[4] || Number(found[4]) < 1))
        throw new RpcError('invalid_params', 'job_id must be the extract:<campaign>:t<n> that memory.job returned', { details: { job_id: value ?? null } });
    return Number(found[3]);
}
export async function readJob(campaign: CampaignWriter, id: string): Promise<Row | null> {
    try {
        const value = await campaign.context.snapshots.readJson(campaign.path(join('memory/jobs', id + '.json')));
        return isJsonObject(value) ? clone(value) : null;
    }
    catch {
        return null;
    }
}
export const writeJob = (campaign: CampaignWriter, value: Row) => campaign.write(join('memory/jobs', value.job_id + '.json'), value);
export async function defaultJobTurn(campaign: CampaignWriter, options: {referenced?: boolean; exclude?: number[]} = {}): Promise<number | null> {
    const skip = new Set((await logs(campaign, 'memory/backlog.jsonl')).filter(value => value.status === 'pending' && (integer(value.turn) || typeof value.turn === 'boolean')).map(value => number(value.turn)));
    for (const turn of [...(await committedRecords(campaign)).keys()].sort((a, b) => b - a)) {
        if (options.exclude?.includes(turn)) continue;
        const existing = await readJob(campaign, jobId(campaign.id, turn));
        if (skip.has(turn) && !(options.referenced && existing?.protocol === 'memory-reference-v1'))
            continue;
        if (existing?.status === 'done')
            continue;
        return turn;
    }
    return null;
}
export async function buildJob(campaign: CampaignWriter, graph: ModuleGraph, language: string, turn: number, party: Row[], world: Row): Promise<Row> {
    const committed = await committedRecords(campaign), record = committed.get(turn);
    if (!record)
        throw new RpcError('invalid_params', `turn ${turn} has no committed record`, { fix: 'only turns closed by narrate have extraction jobs', details: { turn, committed_turns: [...committed.keys()].sort((a, b) => a - b) } });
    const snapshot = row(record.world), scene = graph.scene(string(row(snapshot.scene).name || world.active_scene));
    const present = [...new Map([
        ...array(row(record.capsule).present).map(value => graph.find(string(row(value).name || value), ['npc'])).filter(truth) as Row[],
        ...array(snapshot.present).map(name => graph.find(string(name), ['npc'])).filter(truth) as Row[]
    ].map(node => [node.node_id, node])).values()];
    const display = sceneLabel(graph, world, scene);
    const known: Row[] = party.map(sheet => ({ name: string(sheet.name), kind: 'investigator' })), allowed: string[] = [];
    for (const node of present) {
        known.push({ name: graph.displayName(node), kind: 'npc' });
        allowed.push(node.node_id);
    }
    known.push({ name: display, kind: 'scene' });
    allowed.push(scene.node_id);
    const clues: string[] = [];
    for (const [n, value] of [...committed].sort(([a], [b]) => a - b))
        if (n <= turn)
            for (const receipt of array(value.receipts))
                if (receipt.kind === 'clue' && !clues.includes(receipt.clue))
                    clues.push(string(receipt.clue));
    for (const handle of clues) {
        const node = graph.find(handle, ['clue']);
        if (node && !allowed.includes(node.node_id)) {
            known.push({ name: graph.handle(node), kind: 'clue' });
            allowed.push(node.node_id);
        }
    }
    const labels = Object.fromEntries(array(snapshot.investigators).map(sheet => [string(sheet.id), string(sheet.name)]));
    const facts = array(row(record.facts).committed);
    const rows = await logs(campaign, 'memory/candidates.jsonl'), about = known.filter(value => ['investigator', 'npc'].includes(value.kind)).map(value => value.name);
    const prior = queryCandidates(rows, new EntityIndex(graph, party, labels), about, { limit: 12 }).map(hit => ({ id: hit.id, kind: hit.kind, subject: hit.subject, statement: hit.statement, status: hit.status, turn: hit.turn }));
    const correctionTargets = queryCandidates(rows.filter(value => number(value.valid_from_turn) < turn), new EntityIndex(graph, party, labels), about, {limit: 30})
        .map(hit => ({subject: hit.subject, statement: hit.statement, kind: hit.kind}));
    const meta = await campaign.readCampaign(), worldline = string(meta.active_worldline || 'main'), loop = number(row(row(meta.worldlines)[worldline]).loop);
    const historicalWorld = {active_scene: graph.handle(scene), discovered_clues: clues,
        npc_presence: Object.fromEntries(present.map(node => [graph.handle(node), graph.handle(scene)]))};
    const history = [...committed].filter(([n]) => n <= turn).sort(([a], [b]) => a - b).map(([, value]) => value);
    const historicalCandidates = rows.filter(value => number(value.valid_from_turn) <= turn && (!value.worldline || value.worldline === worldline));
    const storyContext = storyAssessmentContext(graph, historicalWorld, history, historicalCandidates,
        await logs(campaign, 'memory/story.jsonl'), worldline, loop, turn);
    return { job_id: jobId(campaign.id, turn), turn, commit: record.commit ?? null, scene: { name: graph.handle(scene), display_name: display },
        present: present.map(node => graph.displayName(node)), investigators: party.map(sheet => ({ id: string(sheet.id), name: string(sheet.name) })),
        player_text: record.player_text ?? null, keeper_text: proseOf(record.rendered_text),
        committed_facts: facts.length ? facts : committedFacts(array(record.receipts), snapshot, id => labels[id] ?? id, record.player_text),
        known_entities: known, prior, ...(correctionTargets.length ? {correction_targets: correctionTargets} : {}),
        ...(array(storyContext.threads).length ? {story_context: storyContext} : {}),
        budget: { max_candidates: 12, max_statement_chars: 400 }, instruction: instruction(language),
        _worldline: worldline, _allowed: allowed, _receipts: array(record.receipts).map(receipt => receipt.id) };
}

const detailsOfStory = (story: Row): Row => ({status: story.status, thread: story.thread, bridge_delivered: story.bridge_delivered});
export function validateStory(job: Row, value: unknown, referenced = false): Row | null {
    const context = row(row(job.packet).story_context), threads = array(context.threads);
    // Older bundled hosts can finish an already-open extraction without inventing an assessment.
    // The current extension requires story whenever the packet supplies threads.
    if (value === undefined || value === null) return null;
    if (!threads.length) {
        throw new RpcError('invalid_params', 'This memory job has no story assessment context');
    }
    if (!isJsonObject(value) || Object.keys(value).sort().join(',') !== 'bridge_delivered,delivery_quote,frame,status,thread')
        throw new RpcError('invalid_params', 'params.story needs exactly status, thread, frame, bridge_delivered and delivery_quote');
    if (!STORY_STATUSES.includes(value.status as string))
        throw new RpcError('invalid_params', `params.story.status must be one of: ${STORY_STATUSES.join(', ')}`);
    const unclear = value.status === 'unclear', names = threads.map(thread => string(row(thread).thread));
    if (unclear ? value.thread !== null : typeof value.thread !== 'string' || !names.includes(value.thread))
        throw new RpcError('invalid_params', unclear ? 'An unclear story assessment uses thread null' : 'params.story.thread must name one supplied story_context thread',
            {details: {threads: names}});
    const selected = threads.find(thread => row(thread).thread === value.thread);
    const selectedEvidence = selected ? array(row(selected).supporting).length + array(row(selected).contradicting).length : 0;
    if (value.status === 'aligned' && selected && !selectedEvidence)
        throw new RpcError('invalid_params', 'An aligned story assessment requires acquired causal evidence on the selected thread; an unsupported correct guess remains uncertain');
    const player = string(row(job.packet).player_text || '');
    if (unclear ? value.frame !== null : typeof value.frame !== 'string' || !value.frame.trim() || value.frame.length > (referenced ? 800 : 500) || !player.includes(value.frame))
        throw new RpcError('invalid_params', unclear ? 'An unclear story assessment uses frame null' : 'params.story.frame must be an exact bounded excerpt from player_text');
    if (typeof value.bridge_delivered !== 'boolean')
        throw new RpcError('invalid_params', 'params.story.bridge_delivered must be boolean');
    if (value.bridge_delivered && !selectedEvidence)
        throw new RpcError('invalid_params', 'A delivered causal bridge requires acquired supporting or contradicting evidence on the selected thread; atmosphere alone is not delivery');
    const keeper = string(row(job.packet).keeper_text || '');
    if (value.bridge_delivered ? typeof value.delivery_quote !== 'string' || !value.delivery_quote.trim() || value.delivery_quote.length > (referenced ? 800 : 700) || !keeper.includes(value.delivery_quote) : value.delivery_quote !== null)
        throw new RpcError('invalid_params', value.bridge_delivered ? 'params.story.delivery_quote must be an exact bounded excerpt from keeper_text' : 'A story assessment without a delivered bridge uses delivery_quote null');
    return clone(value);
}
export async function correctionJob(campaign: CampaignWriter, graph: ModuleGraph, party: Row[], requested?: string): Promise<Row | null> {
    const rows = await logs(campaign, 'memory/candidates.jsonl'), meta = await campaign.readCampaign();
    const backlog = new Set((await logs(campaign, 'memory/backlog.jsonl')).filter(row => row.status === 'pending').map(row => row.job_id));
    const eligible = rows.filter(row => row.kind === 'keeper_correction' && row.superseded_by == null && row.correction_links_checked !== true)
        .sort((a, b) => number(a.valid_from_turn) - number(b.valid_from_turn));
    for (const correction of eligible) {
        if (!/^mem:t\d+-\d+$/.test(string(correction.id))) continue;
        const id = `reconcile:${campaign.id}:${string(correction.id).slice(4)}:${jsonDigest(meta.active_worldline ?? 'main').slice(0, 12)}`;
        if (requested ? id !== requested : backlog.has(id)) continue;
        const existing = await readJob(campaign, id);
        if (existing) return existing.packet;
        const turn = number(correction.valid_from_turn), record = (await committedRecords(campaign)).get(turn);
        if (!record) continue;
        const about = [correction.subject, ...array(correction.knowers), ...array(correction.entities)];
        const targets = queryCandidates(rows.filter(row => number(row.valid_from_turn) < turn), new EntityIndex(graph, party), about, {limit: 30})
            .map(hit => ({subject: hit.subject, statement: hit.statement, kind: hit.kind}));
        return {job_id: id, task: 'reconcile_correction', turn, commit: record.commit ?? null,
            correction: {kind: correction.kind, subject: correction.subject, statement: correction.statement}, correction_targets: targets,
            player_text: record.player_text ?? '', keeper_text: proseOf(record.rendered_text), prior: [],
            budget: {max_candidates: 1, max_statement_chars: 400},
            instruction: 'Link the supplied existing correction to the earlier reports it explicitly withdraws. Return exactly one candidate, copying correction.kind, subject and statement unchanged, with corrects selected as exact subject/statement pairs from correction_targets. Use corrects:[] if none applies. Do not invent new facts, rewrite the correction, or adjudicate module truth. Distinguish an explicit retraction from uncertainty about an unrelated fact. No identifiers in the response.',
            _correction: correction.id, _worldline: meta.active_worldline ?? 'main', _allowed: [], _receipts: []};
    }
    return null;
}
export async function openJob(campaign: CampaignWriter, packet: Row): Promise<Row> {
    const allowed = packet._allowed, receipts = packet._receipts, correction = packet._correction, worldline = packet._worldline;
    delete packet._allowed;
    delete packet._receipts;
    delete packet._correction; delete packet._worldline;
    const existing = await readJob(campaign, packet.job_id);
    if (existing && packet.task === 'reconcile_correction') return existing.packet;
    if (!existing || !['done', 'failed'].includes(existing.status))
        await writeJob(campaign, { job_id: packet.job_id, turn: packet.turn, commit: packet.commit, status: 'open', opened_at: nowIso(), packet, allowed, receipts,
            ...(worldline != null ? {worldline} : {}), ...(correction ? {correction} : {}) });
    return packet;
}
function reject(index: number, message: string, fix: string, details: Row = {}): never {
    throw new RpcError('invalid_params', message, { fix, details: { index, ...details } });
}
function resolveName(index: EntityIndex, position: number, field: string, name: any, options: Parameters<EntityIndex['matches']>[1] = {}): string {
    if (typeof name !== 'string' || !name.trim())
        return reject(position, `candidates[${position}].${field} must be a name`, `use one of: ${index.usableNames().join(', ')}`, { field });
    const found = index.matches(name, options), usable = index.usableNames();
    if (found.length === 1)
        return found[0];
    if (!found.length)
        return reject(position, `candidates[${position}].${field}: ${repr(name)} is not a known name`, `use one of: ${usable.join(', ')}`, { field, name, candidates: usable });
    const described = found.map(key => index.describe(key));
    return reject(position, `candidates[${position}].${field}: ${repr(name)} names ${found.length} entities`, 'say which one by id: ' + described.map(value => `${value.id} (${value.kind} ${value.name})`).join(', '), { field, name, candidates: described });
}
export function validateCandidates(index: EntityIndex, candidates: any, referenced = false): Row[] {
    if (!Array.isArray(candidates))
        throw new RpcError('invalid_params', 'params.candidates must be a list');
    if (candidates.length > 12)
        throw new RpcError('invalid_params', 'at most 12 candidates per job', { fix: 'keep the 12 most important', details: { index: 12 } });
    return candidates.map((candidate, i) => {
        if (!isJsonObject(candidate))
            return reject(i, `candidates[${i}] must be an object`, 'give kind, subject and statement');
        const machine = sorted(Object.keys(candidate).filter(key => MACHINE.includes(key))), unknown = sorted(Object.keys(candidate).filter(key => !FIELDS.includes(key)));
        if (machine.length)
            return reject(i, `candidates[${i}] carries machine keys ${repr(machine)}`, 'drop them; the kernel attaches turn, commit and receipts itself', { fields: machine });
        if (unknown.length)
            return reject(i, `candidates[${i}] has unknown fields ${repr(unknown)}`, `allowed fields: ${sorted(FIELDS).join(', ')}`, { fields: unknown });
        const kind = candidate.kind, statement = candidate.statement;
        if (!CANDIDATE_KINDS.includes(kind as string))
            return reject(i, `candidates[${i}].kind ${repr(kind)} is not a kind`, `one of: ${CANDIDATE_KINDS.join(', ')}`);
        if (typeof statement !== 'string' || length(statement.trim()) < 1 || length(statement.trim()) > (referenced ? 800 : 400))
            return reject(i, `candidates[${i}].statement must be 1–400 characters`, 'shorten or split the statement');
        if (Object.hasOwn(candidate, 'corrects') && kind !== 'keeper_correction')
            return reject(i, 'Only keeper_correction may withdraw earlier assertions', 'remove corrects or use keeper_correction for an explicit correction');
        const corrects = Object.hasOwn(candidate, 'corrects') ? validateCorrectionRefs(candidate.corrects) : undefined;
        const subject = resolveName(index, i, 'subject', candidate.subject);
        if (kind === 'world_event' && subject !== 'reserved:world')
            return reject(i, `candidates[${i}]: a world_event's subject must be world`, 'set subject to world, or choose knowledge/belief for what someone knows');
        const knowers = candidate.knowers ?? [], entities = candidate.entities ?? [];
        if (!Array.isArray(knowers))
            return reject(i, `candidates[${i}].knowers must be a list of names`, 'list investigators, NPCs, party, keeper or player');
        if (!Array.isArray(entities))
            return reject(i, `candidates[${i}].entities must be a list of names`, 'list the names the statement is about');
        const resolvedKnowers = knowers.map(name => resolveName(index, i, 'knowers', name, { reserved: ['party', 'keeper', 'player'], kinds: ['npc'] }));
        const knowerKeys = referenced ? [...new Set(resolvedKnowers)] : resolvedKnowers;
        // Where an entity link is an index into the graph rather than part of the fact, one invented
        // name -- a scene the Keeper never labelled (`admission-e2e-4` turn 11 invented one) -- used to
        // reject the whole submit and lose every candidate of that turn with it. Such a name is dropped
        // now, and the result says which. Subject and knowers stay strict everywhere, because they say
        // whose knowledge this is; and a relationship or a promise keeps its entities strict too,
        // because there the other party is half the statement and the key this kind supersedes on
        // (contract §32.9). An ambiguous name is still refused in every kind.
        const bearing = ['relationship', 'promise'].includes(kind as string);
        const droppedEntities: string[] = [], entityKeys: string[] = [];
        for (const name of entities) {
            if (!bearing && typeof name === 'string' && name.trim() && !index.matches(name, { reserved: [] }).length) {
                droppedEntities.push(name.trim());
                continue;
            }
            const key = resolveName(index, i, 'entities', name, { reserved: [] });
            if (!referenced || !entityKeys.includes(key)) entityKeys.push(key);
        }
        if (kind === 'relationship' && entityKeys.length !== 1)
            return reject(i, `candidates[${i}]: a relationship names exactly one entity, got ${entityKeys.length}`, 'put the other party of the relationship, alone, in entities');
        const privacy = Object.hasOwn(candidate, 'privacy') ? candidate.privacy : 'player_safe', state = Object.hasOwn(candidate, 'state') ? candidate.state : 'accurate', confidence = candidate.confidence ?? null;
        if (!PRIVACY.includes(privacy as string))
            return reject(i, `candidates[${i}].privacy ${repr(privacy)}`, `one of: ${PRIVACY.join(', ')}`);
        if (!STATES.includes(state as string))
            return reject(i, `candidates[${i}].state ${repr(state)}`, `one of: ${STATES.join(', ')}`);
        if (confidence !== null && (!numeric(confidence) || number(confidence) < 0 || number(confidence) > 1 || !Number.isFinite(number(confidence))))
            return reject(i, `candidates[${i}].confidence must be a number from 0 to 1`, 'omit it or give 0–1');
        return { kind, subject: index.canonicalName(subject), knowers: knowerKeys.map(key => index.canonicalName(key)), entities: entityKeys.map(key => index.canonicalName(key)), statement: referenced ? statement : statement.trim(), privacy, state, confidence, _keys: { subject, entities: sorted(entityKeys) }, ...(corrects !== undefined ? {corrects} : {}), ...(droppedEntities.length ? { _dropped: droppedEntities } : {}) };
    });
}
export async function appendBacklog(campaign: CampaignWriter, id: string, turn: number, reason: string, detail: any): Promise<Row> {
    const value = { job_id: id, turn, reason, detail: detail ?? null, at: nowIso(), status: 'pending' };
    await appendJsonl(campaign.path('memory/backlog.jsonl'), value);
    return value;
}
export async function recoverBacklog(campaign: CampaignWriter, id: string): Promise<void> {
    const rows = await logs(campaign, 'memory/backlog.jsonl');
    let changed = false;
    for (const value of rows)
        if (value.job_id === id && value.status === 'pending') {
            value.status = 'recovered';
            value.recovered_at = nowIso();
            changed = true;
        }
    if (changed)
        await writeLines(campaign, 'memory/backlog.jsonl', rows);
}
export async function submit(campaign: CampaignWriter, graph: ModuleGraph, party: Row[], job: Row, candidates: any, story?: unknown): Promise<[
    Row,
    boolean
]> {
    const id = string(job.job_id), turn = number(job.turn), meta = await campaign.readCampaign();
    const line = typeof meta.active_worldline === 'string' && meta.active_worldline ? meta.active_worldline : 'main', loop = number(row(row(meta.worldlines)[line]).loop);
    const digest = story === undefined ? jsonDigest(candidates ?? null) : jsonDigest({candidates: candidates ?? null, story: story as any});
    if (job.worldline != null && job.worldline !== line) throw new RpcError('invalid_params', 'Memory job belongs to another worldline');
    if (job.status === 'done') {
        if (job.candidates_sha256 === digest)
            return [clone(row(job.result)), true];
        throw new RpcError('idempotency_conflict', `job ${id} already completed with different candidates`, { fix: 'a completed job is final; nothing to resubmit', details: { job_id: id } });
    }
    if (job.correction) {
        if (story !== undefined && story !== null) throw new RpcError('invalid_params', 'Correction reconciliation does not assess story alignment');
        const rows = await logs(campaign, 'memory/candidates.jsonl'), correction = rows.find(row => row.id === job.correction);
        const value = Array.isArray(candidates) && candidates.length === 1 ? candidates[0] : null;
        if (!correction || correction.superseded_by != null || !isJsonObject(value) || Object.keys(value).some(key => !FIELDS.includes(key))
            || value.kind !== 'keeper_correction' || value.subject !== correction.subject || value.statement !== correction.statement)
            throw new RpcError('invalid_params', 'Reconciliation must return the unchanged active correction and its corrects references');
        correction.corrects = bindCorrectionRefs(validateCorrectionRefs(value.corrects), array(job.packet.correction_targets), rows, turn);
        correction.correction_links_checked = true;
        const superseded = applyCorrectionLinks(rows);
        await writeLines(campaign, 'memory/candidates.jsonl', rows);
        const result = {job_id: id, turn, candidates: 0, written: [], superseded, correction: correction.id};
        await writeJob(campaign, {...job, status: 'done', candidates_sha256: digest, submitted: candidates, result, completed_at: nowIso()});
        await recoverBacklog(campaign, id); return [result, false];
    }
    const world = await campaign.readWorld(), index = new EntityIndex(graph, party, row(world.scene_labels), array(job.allowed));
    let validated: Row[];
    let assessed: Row | null;
    try {
        validated = validateCandidates(index, candidates);
        assessed = validateStory(job, story);
    }
    catch (error) {
        if (error instanceof RpcError && error.code === 'invalid_params')
            await appendBacklog(campaign, id, turn, 'invalid', error.message);
        throw error;
    }
    const existing = await logs(campaign, 'memory/candidates.jsonl'), beforeCandidates = clone(existing), prefix = `mem:t${turn}-`;
    const storyRows = await logs(campaign, 'memory/story.jsonl'), beforeStory = clone(storyRows);
    for (const value of validated) if (Object.hasOwn(value, 'corrects')) {
        value.corrects = bindCorrectionRefs(value.corrects, array(job.packet.correction_targets), existing, turn);
        value.correction_links_checked = true;
    }
    const used = existing.filter(value => string(value.id || '').startsWith(prefix) && /^\d+$/.test(string(value.id).split('-').at(-1)!)).map(value => Number(string(value.id).split('-').at(-1)));
    let next = Math.max(0, ...used) + 1;
    const graphIndex = new EntityIndex(graph, party, row(world.scene_labels)), written: Row[] = [], superseded: string[] = [], dropped: string[] = [];
    for (const value of validated) {
        const keys = value._keys;
        delete value._keys;
        if (Array.isArray(value._dropped)) {
            dropped.push(...value._dropped.map(string));
            delete value._dropped;
        }
        const newId = `mem:t${turn}-${next++}`;
        if (['relationship', 'promise'].includes(value.kind))
            for (const old of existing) {
                if (old.kind === value.kind && old.status === 'candidate' && old.superseded_by == null && graphIndex.lenientKey(string(old.subject)) === keys.subject &&
                    pythonJsonDumps(sorted(array(old.entities).map(entity => graphIndex.lenientKey(string(entity))))) === pythonJsonDumps(keys.entities)) {
                    old.valid_until_turn = turn;
                    old.superseded_by = newId;
                    old.status = 'superseded';
                    superseded.push(string(old.id));
                }
            }
        const landed = { id: newId, ...value, status: 'candidate', source: { turn, commit: job.commit ?? null, episode_id: episodeId(turn), receipts: [...array(job.receipts)] }, worldline: line, loop, valid_from_turn: turn, job_id: id, at: nowIso() };
        existing.push(landed);
        written.push(landed);
    }
    superseded.push(...applyCorrectionLinks(existing).filter(id => !superseded.includes(id)));
    const storyRow = assessed ? {turn, commit: job.commit ?? null, worldline: line, loop, job_id: id, at: nowIso(), ...assessed} : null;
    if (storyRow) {
        const duplicate = storyRows.findIndex(value => value.job_id === id);
        if (duplicate >= 0) storyRows.splice(duplicate, 1);
        storyRows.push(storyRow);
    }
    const result = { job_id: id, turn, candidates: written.length, written: written.map(value => value.id), superseded,
        ...(storyRow ? {story: detailsOfStory(storyRow)} : {}), ...(dropped.length ? { dropped_entities: sorted(new Set(dropped)) } : {}) };
    try {
        await writeLines(campaign, 'memory/candidates.jsonl', existing);
        if (storyRow) await writeLines(campaign, 'memory/story.jsonl', storyRows);
        await writeJob(campaign, { ...job, status: 'done', candidates_sha256: digest, submitted: candidates,
            ...(story !== undefined ? {submitted_story: story} : {}), result, completed_at: nowIso() });
    } catch (error) {
        await Promise.allSettled([writeLines(campaign, 'memory/candidates.jsonl', beforeCandidates),
            ...(storyRow ? [writeLines(campaign, 'memory/story.jsonl', beforeStory)] : [])]);
        throw error;
    }
    await recoverBacklog(campaign, id);
    return [result, false];
}
export async function fail(campaign: CampaignWriter, job: Row | null, id: string, turn: number, reason: any, detail: any): Promise<Row> {
    if (!FAILURE_REASONS.includes(reason))
        throw new RpcError('invalid_params', `reason ${repr(reason)} is not a failure reason`, { fix: `one of: ${FAILURE_REASONS.join(', ')}` });
    const value = await appendBacklog(campaign, id, turn, reason, detail);
    if (job && job.status !== 'done')
        await writeJob(campaign, { ...job, status: 'failed', failed_at: nowIso(), reason, detail: detail ?? null });
    return { job_id: id, turn, status: value.status, reason };
}
