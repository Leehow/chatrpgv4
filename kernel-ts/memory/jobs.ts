/** Extraction packets and retained candidate evidence; no model calls or fact promotion. */
import { join } from 'node:path';
import { RpcError, pythonTypeName } from '../errors.js';
import { isJsonObject, jsonDigest, pythonJsonDumps, type JsonValue } from '../json.js';
import { appendJsonl, writeTextAtomic } from '../fileio.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { committedFacts } from '../write/text.js';
import { ModuleGraph } from '../read/module-graph.js';
import { EntityIndex, queryCandidates } from '../read/memory.js';
import { array, row, clone, string, number, integer, numeric, truth, repr, sorted, length, type Row } from '../read/values.js';
export const CANDIDATE_KINDS = ['world_event', 'knowledge', 'belief', 'relationship', 'player_assertion', 'player_preference', 'keeper_correction', 'promise'];
const FIELDS = ['kind', 'subject', 'knowers', 'statement', 'entities', 'privacy', 'state', 'confidence'];
const MACHINE = ['commit', 'receipt', 'receipts', 'turn', 'id', 'job_id', 'episode_id', 'call_id', 'source'];
const PRIVACY = ['player_safe', 'keeper_only'], STATES = ['accurate', 'uncertain', 'distorted'];
export const FAILURE_REASONS = ['invalid', 'lane_error', 'model_error'];
export const episodeId = (turn: number) => `ep:t${turn}`;
export const jobId = (campaign: string, turn: number) => `extract:${campaign}:t${turn}`;
export const proseOf = (value: any): string => truth(value) ? string(value).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '') : '';
const instruction = (language: string) => 'Write only what is new this turn: facts, knowledge, beliefs, relationships, player assertions. ' +
    'Use names from known_entities as subjects, or the reserved subjects world, party, keeper, player; ' +
    'no numbers or dice; do not repeat what prior already holds. Each candidate has kind (one of world_event, ' +
    'knowledge, belief, relationship, player_assertion, player_preference, keeper_correction, promise), subject and ' +
    "statement; a world_event's subject must be world; a relationship names exactly one entity in entities. " +
    'When someone promised something with a deadline or a condition, write a promise: subject is the one who ' +
    'promised, entities the one promised to and what it concerns, statement the condition or deadline. ' +
    'When an NPC learned something, took a position or gave their word this turn, say so with them in it: a ' +
    'knowledge or belief whose knowers include them, or a promise whose subject is them -- that is what puts it ' +
    'on their account, and the keeper reads it back the next time they are in the room. ' +
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
    const found = typeof value === 'string' ? /^extract:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):t(\d+)$/.exec(value) : null;
    if (!found || found[1] !== campaign.id)
        throw new RpcError('invalid_params', 'job_id must be the extract:<campaign>:t<n> that memory.job returned', { details: { job_id: value ?? null } });
    return Number(found[2]);
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
const writeJob = (campaign: CampaignWriter, value: Row) => campaign.write(join('memory/jobs', value.job_id + '.json'), value);
export async function defaultJobTurn(campaign: CampaignWriter): Promise<number | null> {
    const skip = new Set((await logs(campaign, 'memory/backlog.jsonl')).filter(value => value.status === 'pending' && (integer(value.turn) || typeof value.turn === 'boolean')).map(value => number(value.turn)));
    for (const turn of [...(await committedRecords(campaign)).keys()].sort((a, b) => b - a)) {
        if (skip.has(turn))
            continue;
        if ((await readJob(campaign, jobId(campaign.id, turn)))?.status === 'done')
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
    const present = array(snapshot.present).map(name => graph.find(string(name), ['npc'])).filter(truth) as Row[];
    const sceneLabels = row((await campaign.readWorld()).scene_labels), display = string(sceneLabels[graph.handle(scene)] || graph.displayName(scene));
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
    return { job_id: jobId(campaign.id, turn), turn, commit: record.commit ?? null, scene: { name: graph.handle(scene), display_name: display },
        present: present.map(node => graph.displayName(node)), investigators: party.map(sheet => ({ id: string(sheet.id), name: string(sheet.name) })),
        player_text: record.player_text ?? null, keeper_text: proseOf(record.rendered_text),
        committed_facts: facts.length ? facts : committedFacts(array(record.receipts), snapshot, id => labels[id] ?? id, record.player_text),
        known_entities: known, prior, budget: { max_candidates: 12, max_statement_chars: 400 }, instruction: instruction(language),
        _allowed: allowed, _receipts: array(record.receipts).map(receipt => receipt.id) };
}
export async function openJob(campaign: CampaignWriter, packet: Row): Promise<Row> {
    const allowed = packet._allowed, receipts = packet._receipts;
    delete packet._allowed;
    delete packet._receipts;
    const existing = await readJob(campaign, packet.job_id);
    if (!existing || !['done', 'failed'].includes(existing.status))
        await writeJob(campaign, { job_id: packet.job_id, turn: packet.turn, commit: packet.commit, status: 'open', opened_at: nowIso(), packet, allowed, receipts });
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
export function validateCandidates(index: EntityIndex, candidates: any): Row[] {
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
        if (typeof statement !== 'string' || length(statement.trim()) < 1 || length(statement.trim()) > 400)
            return reject(i, `candidates[${i}].statement must be 1–400 characters`, 'shorten or split the statement');
        const subject = resolveName(index, i, 'subject', candidate.subject);
        if (kind === 'world_event' && subject !== 'reserved:world')
            return reject(i, `candidates[${i}]: a world_event's subject must be world`, 'set subject to world, or choose knowledge/belief for what someone knows');
        const knowers = candidate.knowers ?? [], entities = candidate.entities ?? [];
        if (!Array.isArray(knowers))
            return reject(i, `candidates[${i}].knowers must be a list of names`, 'list investigators, NPCs, party, keeper or player');
        if (!Array.isArray(entities))
            return reject(i, `candidates[${i}].entities must be a list of names`, 'list the names the statement is about');
        const knowerKeys = knowers.map(name => resolveName(index, i, 'knowers', name, { reserved: ['party', 'keeper', 'player'], kinds: ['npc'] }));
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
            entityKeys.push(resolveName(index, i, 'entities', name, { reserved: [] }));
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
        return { kind, subject: index.canonicalName(subject), knowers: knowerKeys.map(key => index.canonicalName(key)), entities: entityKeys.map(key => index.canonicalName(key)), statement: statement.trim(), privacy, state, confidence, _keys: { subject, entities: sorted(entityKeys) }, ...(droppedEntities.length ? { _dropped: droppedEntities } : {}) };
    });
}
export async function appendBacklog(campaign: CampaignWriter, id: string, turn: number, reason: string, detail: any): Promise<Row> {
    const value = { job_id: id, turn, reason, detail: detail ?? null, at: nowIso(), status: 'pending' };
    await appendJsonl(campaign.path('memory/backlog.jsonl'), value);
    return value;
}
async function recoverBacklog(campaign: CampaignWriter, id: string): Promise<void> {
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
export async function submit(campaign: CampaignWriter, graph: ModuleGraph, party: Row[], job: Row, candidates: any): Promise<[
    Row,
    boolean
]> {
    const id = string(job.job_id), turn = number(job.turn), meta = await campaign.readCampaign();
    const line = typeof meta.active_worldline === 'string' && meta.active_worldline ? meta.active_worldline : 'main', loop = number(row(row(meta.worldlines)[line]).loop);
    const digest = jsonDigest(candidates ?? null);
    if (job.status === 'done') {
        if (job.candidates_sha256 === digest)
            return [clone(row(job.result)), true];
        throw new RpcError('idempotency_conflict', `job ${id} already completed with different candidates`, { fix: 'a completed job is final; nothing to resubmit', details: { job_id: id } });
    }
    const world = await campaign.readWorld(), index = new EntityIndex(graph, party, row(world.scene_labels), array(job.allowed));
    let validated: Row[];
    try {
        validated = validateCandidates(index, candidates);
    }
    catch (error) {
        if (error instanceof RpcError && error.code === 'invalid_params')
            await appendBacklog(campaign, id, turn, 'invalid', error.message);
        throw error;
    }
    const existing = await logs(campaign, 'memory/candidates.jsonl'), prefix = `mem:t${turn}-`;
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
    await writeLines(campaign, 'memory/candidates.jsonl', existing);
    const result = { job_id: id, turn, candidates: written.length, written: written.map(value => value.id), superseded,
        ...(dropped.length ? { dropped_entities: sorted(new Set(dropped)) } : {}) };
    await writeJob(campaign, { ...job, status: 'done', candidates_sha256: digest, submitted: candidates, result, completed_at: nowIso() });
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
