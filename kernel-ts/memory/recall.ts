/** Structured recall over retained records, transcripts and candidate sources. */
import { RpcError } from '../errors.js';
import { isJsonObject, parsePythonJson, sha256Text } from '../json.js';
import { CampaignWriter, EVENT_TYPES } from '../write/store.js';
import { ModuleGraph } from '../read/module-graph.js';
import { EntityIndex, queryCandidates } from '../read/memory.js';
import { npcsPresent } from '../read/capsule.js';
import { array, row, number, integer, string, truth, sorted, chars, length, words, repr, type Row } from '../read/values.js';
import { CANDIDATE_KINDS, logs, records, proseOf } from './jobs.js';
const ROLES = ['player', 'keeper'];
const RECEIPTS = ['roll', 'move', 'clue', 'delta', 'session', 'time'];
export function parseSpan(value: any, current: number, defaults: number): number[] {
    if (value == null)
        return [Math.max(0, current - defaults + 1), current];
    if (!Array.isArray(value) || value.length !== 2 || !value.every(n => integer(n) && number(n) >= 0) || number(value[0]) > number(value[1]))
        throw new RpcError('invalid_params', 'turns must be [from, to] with 0 <= from <= to');
    return value.map(number);
}
export async function transcript(campaign: CampaignWriter, current: number, params: Row): Promise<Row> {
    const all = await logs(campaign, 'transcript.jsonl'), read = params.read;
    if (read != null) {
        if (!isJsonObject(read) || !integer(read.turn) || !ROLES.includes(read.role as string))
            throw new RpcError('invalid_params', 'read must be {turn: int, role: player|keeper}');
        const turn = number(read.turn), role = string(read.role), found = all.filter(value => number(value.turn) === turn && value.role === role);
        if (!found.length) {
            const keys = [...new Set(all.map(value => JSON.stringify([number(value.turn), value.role])))].map(value => JSON.parse(value));
            keys.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
            throw new RpcError('invalid_params', `no ${role} row for turn ${turn} in the transcript`, { fix: 'pick a card from recall transcript first', details: { turn, role, available: keys.slice(-40).map(([turn, role]) => ({ turn, role })) } });
        }
        const text = string(found.at(-1)!.text || ''), record = await campaign.readTurnRecord(turn);
        const canonical = record?.[role === 'keeper' ? 'rendered_text' : 'player_text'];
        return { what: 'transcript', turn, role, text, verified: canonical != null && sha256Text(text) === sha256Text(string(canonical)), verification_scope: 'record_integrity_only' };
    }
    const span = parseSpan(params.turns, current, 3), role = params.role ?? null;
    if (role !== null && !ROLES.includes(role))
        throw new RpcError('invalid_params', "role must be 'player' or 'keeper'");
    const entries = all.filter(value => span[0] <= number(value.turn) && number(value.turn) <= span[1] && (role === null || value.role === role));
    const result: Row = { what: 'transcript', turns: span, cards: entries.slice(-40).map(value => ({ turn: number(value.turn), role: value.role, chars: length(value.text || ''), head: chars(words(value.text || ''), 80) })) };
    if (span[1] - span[0] + 1 <= 3)
        result.entries = entries;
    return result;
}
function timelineRow(record: Row): Row {
    const world = row(record.world), counts = Object.fromEntries(RECEIPTS.map(kind => [kind, 0]));
    for (const receipt of array(record.receipts))
        if (RECEIPTS.includes(receipt.kind))
            counts[receipt.kind]++;
    return { turn: number(record.turn), commit: record.commit ?? null, scene: row(world.scene).name ?? null, clock: row(world.clock).minutes ?? null,
        closed_by: record.closed_by ?? null, receipts: counts, head: chars(words(proseOf(record.rendered_text)), 60) };
}
function historyDiff(all: Map<number, Row>, diff: any): Row {
    if (!Array.isArray(diff) || diff.length !== 2 || !diff.every(value => integer(value) && number(value) >= 0) || number(diff[0]) > number(diff[1]))
        throw new RpcError('invalid_params', 'diff must be [turn_a, turn_b] with 0 <= turn_a <= turn_b');
    const [a, b] = diff.map(number), missing = [a, b].filter(turn => !all.has(turn));
    if (missing.length)
        throw new RpcError('invalid_params', `no turn record for ${repr(missing)}`, { details: { closed_turns: [...all.keys()].sort((a, b) => a - b) } });
    const clues: string[] = [], resources = new Map<string, Row>(), sessions: Row[] = [], moves: Row[] = [];
    for (const [turn, value] of [...all].sort(([a], [b]) => a - b))
        if (a < turn && turn <= b)
            for (const receipt of array(value.receipts)) {
                if (receipt.kind === 'clue') {
                    if (!clues.includes(receipt.clue))
                        clues.push(string(receipt.clue));
                }
                else if (['delta', 'cash'].includes(receipt.kind)) {
                    const subject = string(receipt.subject), resource = string(receipt.resource), key = JSON.stringify([subject, resource]);
                    if (!resources.has(key))
                        resources.set(key, { subject, resource, from: receipt.before ?? null, to: receipt.after ?? null });
                    resources.get(key)!.to = receipt.after ?? null;
                }
                else if (receipt.kind === 'session')
                    sessions.push({ turn, family: receipt.family ?? null, transition: receipt.transition ?? null, ...(receipt.outcome != null ? { outcome: receipt.outcome } : {}) });
                else if (receipt.kind === 'move')
                    moves.push({ turn, from: receipt.from ?? null, to: receipt.to ?? null });
            }
    const left = row(all.get(a)!.world), right = row(all.get(b)!.world);
    return { from: a, to: b, scene: [row(left.scene).name ?? null, row(right.scene).name ?? null], clock: [row(left.clock).minutes ?? null, row(right.clock).minutes ?? null],
        clues_added: clues, resources: [...resources.values()], sessions, moves };
}
function worldlineTree(meta: Row): Row {
    const lines = row(meta.worldlines), active = typeof meta.active_worldline === 'string' && meta.active_worldline ? meta.active_worldline : 'main';
    return { active, lines: sorted(Object.keys(lines)).map(name => {
            const value = row(lines[name]), forked = row(value.forked_from);
            return { name, kind: value.kind ?? null, loop: number(value.loop), status: value.status ?? null, last_turn: value.last_turn ?? null, last_commit: value.last_commit ?? null,
                forked_from: truth(forked) ? { line: forked.line ?? null, turn: forked.turn ?? null, commit: forked.commit ?? null } : null, parents: truth(value.parents) ? value.parents : [], active: name === active };
        }) };
}
export async function history(campaign: CampaignWriter, current: number, params: Row): Promise<Row> {
    const span = parseSpan(params.turns, current, 20), types = params.types;
    if (types != null) {
        if (!Array.isArray(types) || !types.every(value => typeof value === 'string'))
            throw new RpcError('invalid_params', 'types must be a list of event types');
        const unknown = sorted(new Set(types.filter(value => !EVENT_TYPES.has(value))));
        if (unknown.length) {
            const options = sorted(EVENT_TYPES);
            throw new RpcError('invalid_params', `unknown event types ${repr(unknown)}`, { fix: `use one of details.options: ${options.join(', ')}`, details: { field: 'types', options } });
        }
    }
    const all = await records(campaign), result: Row = { what: 'history', turns: span,
        timeline: [...all].sort(([a], [b]) => a - b).filter(([turn]) => span[0] <= turn && turn <= span[1]).map(([, value]) => timelineRow(value)),
        events: (await logs(campaign, 'events.jsonl')).filter(value => span[0] <= number(value.turn, -1) && number(value.turn, -1) <= span[1] && (types == null || types.includes(value.type))).slice(-200) };
    if (params.diff != null)
        result.diff = historyDiff(all, params.diff);
    if (truth(params.lines))
        result.lines = worldlineTree(await campaign.readCampaign());
    return result;
}
async function lineCandidates(campaign: CampaignWriter, line: string): Promise<Row[]> {
    const raw = await campaign.context.git.lineBlob(campaign.id, line, 'memory/candidates.jsonl') || '', result: Row[] = [];
    for (const text of raw.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)) {
        if (!text.trim())
            continue;
        try {
            const value = parsePythonJson(text);
            if (isJsonObject(value))
                result.push(value);
        }
        catch { /* Unparseable rows in other retained lines remain absent from the view. */ }
    }
    return result;
}
export async function candidatesFor(campaign: CampaignWriter, meta: Row, line: any): Promise<Row[]> {
    if (line == null || line === 'current')
        return logs(campaign, 'memory/candidates.jsonl');
    const lines = row(meta.worldlines);
    if (line !== 'any') {
        if (typeof line !== 'string' || !Object.hasOwn(lines, line))
            throw new RpcError('invalid_params', `no worldline ${repr(line)}`, { fix: `one of 'current', 'any', or ${repr(sorted(Object.keys(lines)))}`, details: { line, lines: sorted(Object.keys(lines)) } });
        return lineCandidates(campaign, line);
    }
    const active = typeof meta.active_worldline === 'string' && meta.active_worldline ? meta.active_worldline : 'main', rows = new Map<string, Row>();
    for (const name of sorted(Object.keys(lines)))
        if (name !== active)
            for (const value of await lineCandidates(campaign, name))
                if (!rows.has(string(value.id)))
                    rows.set(string(value.id), value);
    for (const value of await logs(campaign, 'memory/candidates.jsonl'))
        rows.set(string(value.id), value);
    return sorted(rows.keys()).map(key => rows.get(key)!);
}
export async function recallMemory(campaign: CampaignWriter, graph: ModuleGraph, world: Row, params: Row): Promise<Row> {
    const party = await campaign.party(), index = new EntityIndex(graph, party, row(world.scene_labels)), narrow = params.about != null;
    let about: string[];
    if (!narrow)
        about = [...npcsPresent(graph, world, graph.scene(world.active_scene)).map(node => graph.displayName(node)), ...party.map(sheet => string(sheet.name))];
    else {
        if (!Array.isArray(params.about) || !params.about.every((value: any) => typeof value === 'string' && value.trim()))
            throw new RpcError('invalid_params', 'about must be a list of names');
        about = params.about.map((name: string) => {
            const exact = index.matches(name), found = exact.length ? exact : index.looseMatches(name);
            if (found.length !== 1) {
                const names = found.length ? found.map(key => index.canonicalName(key)) : graph.candidates(name, ['npc', 'scene', 'clue']);
                throw new RpcError('unknown_entity', `${repr(name)} is ${found.length ? 'ambiguous' : 'not a known name'}`, {
                    fix: names.length ? `use one of ${repr(names)}` : 'use an investigator, NPC, scene or clue name, or world/party/keeper/player', details: { query: name, candidates: names }
                });
            }
            return index.canonicalName(found[0]);
        });
    }
    const turns = params.turns == null ? undefined : parseSpan(params.turns, 0, 0), kinds = params.kinds;
    if (kinds != null && (!Array.isArray(kinds) || !kinds.every((kind: any) => CANDIDATE_KINDS.includes(kind))))
        throw new RpcError('invalid_params', 'kinds must be a list of candidate kinds', { fix: `one of ${repr(CANDIDATE_KINDS)}` });
    const limit = Object.hasOwn(params, 'limit') ? params.limit : 12;
    if (!integer(limit) || number(limit) < 1 || number(limit) > 30)
        throw new RpcError('invalid_params', 'limit must be 1–30');
    const line = Object.hasOwn(params, 'line') ? params.line : 'current', rows = await candidatesFor(campaign, await campaign.readCampaign(), line);
    return { what: 'memory', about, line, hits: queryCandidates(rows, index, about, { narrow, turns, kinds, includeSuperseded: truth(params.include_superseded), limit: number(limit) }) };
}
