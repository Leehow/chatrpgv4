/** Structured recall over retained records, transcripts and candidate sources. */
import { RpcError } from '../errors.js';
import { isJsonObject, parsePythonJson, sha256Text } from '../json.js';
import { CampaignWriter, EVENT_TYPES } from '../write/store.js';
import { ModuleGraph } from '../read/module-graph.js';
import { EntityIndex, queryCandidates, withPromiseFulfillment, canonicalMemoryReceipts, memoryOccurrenceKey } from '../read/memory.js';
import {lineFulfillmentEvidence} from '../read/worldline.js';
import { npcsPresent } from '../read/capsule.js';
import { array, row, number, integer, string, truth, sorted, chars, length, words, repr, type Row } from '../read/values.js';
import { CANDIDATE_KINDS, logs, records, proseOf } from './jobs.js';
import {RECALL_CHARS, pageOptions, detailOptions, position, publicRecall, recallBytes, recallSnapshot, textPage, rowsPage, rowDetail} from './pages.js';
const ROLES = ['player', 'keeper'];
const RECEIPTS = ['roll', 'move', 'clue', 'delta', 'session', 'time', 'clock'];
export function parseSpan(value: any, current: number, defaults: number): number[] {
    if (value == null)
        return [Math.max(0, current - defaults + 1), current];
    if (!Array.isArray(value) || value.length !== 2 || !value.every(n => integer(n) && number(n) >= 0) || number(value[0]) > number(value[1]))
        throw new RpcError('invalid_params', 'turns must be [from, to] with 0 <= from <= to');
    return value.map(number);
}
export async function transcript(campaign: CampaignWriter, current: number, params: Row): Promise<Row> {
    const all = await logs(campaign, 'transcript.jsonl'), read = params.read;
    const snapshot = await recallSnapshot(campaign, params, all);
    if (read != null) {
        if (!isJsonObject(read) || Object.keys(read).some(key => !['turn', 'role', 'offset', 'limit'].includes(key))
            || !integer(read.turn) || number(read.turn) < 0 || !ROLES.includes(read.role as string))
            throw new RpcError('invalid_params', 'read must name a turn, role and optional offset/limit');
        const turn = number(read.turn), role = string(read.role), found = all.filter(value => number(value.turn) === turn && value.role === role);
        if (!found.length)
            throw new RpcError('invalid_params', `no ${role} row for turn ${turn} in the transcript`, {
                fix: 'Pick a card from recall transcript first.', details: {turn, role},
            });
        const text = string(found.at(-1)!.text || ''), record = await campaign.readTurnRecord(turn);
        const canonical = record?.[role === 'keeper' ? 'rendered_text' : 'player_text'];
        const offset = position(read.offset, 0, 'read.offset'), limit = position(read.limit, RECALL_CHARS, 'read.limit', true);
        return textPage(text, offset, limit, {what: 'transcript', turn, role, _snapshot: snapshot,
            verified: canonical != null && sha256Text(text) === sha256Text(string(canonical)), verification_scope: 'record_integrity_only'},
            offset => ({what: 'transcript', read: {turn, role, offset, limit}}));
    }
    const span = parseSpan(params.turns, current, 3), role = params.role ?? null;
    if (role !== null && !ROLES.includes(role))
        throw new RpcError('invalid_params', "role must be 'player' or 'keeper'");
    const latest = new Map<string, Row>();
    for (const value of all) if (span[0] <= number(value.turn) && number(value.turn) <= span[1] && (role === null || value.role === role))
        latest.set(`${value.turn}:${value.role}`, value);
    const cards = [...latest.values()].sort((a, b) => number(a.turn) - number(b.turn) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role))
        .map(value => ({turn: number(value.turn), role: value.role, chars: length(value.text || ''), head: chars(string(value.text || ''), 80),
            read: {what: 'transcript', read: {turn: number(value.turn), role: value.role, offset: 0, limit: RECALL_CHARS}}}));
    const query = {...params, turns: span}, base = {what: 'transcript', turns: span, _snapshot: snapshot};
    return rowDetail(cards, query, 'cards', base) ?? rowsPage(cards, query, 'cards', base);
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
        if (unknown.length) throw new RpcError('invalid_params', 'History contains an unsupported event type', {
            fix: 'Use an event type supplied by the tool schema.', details: {field: 'types'},
        });
    }
    const all = await records(campaign), events = await logs(campaign, 'events.jsonl');
    const lines = truth(params.lines) ? worldlineTree(await campaign.readCampaign()) : null;
    const snapshot = await recallSnapshot(campaign, params, [[...all], events, lines]);
    const requested = detailOptions(params)?.section ?? pageOptions(params, params.diff != null ? 'diff' : types != null ? 'events' : 'timeline').section;
    const query = {...params, turns: span}, base: Row = {what: 'history', turns: span, _snapshot: snapshot};
    const timeline = [...all].sort(([a], [b]) => a - b).filter(([turn]) => span[0] <= turn && turn <= span[1]).map(([, value]) => timelineRow(value));
    const largeLines = lines != null && recallBytes(lines) > 2048;
    if (lines) base.lines = largeLines ? {active: chars(string(lines.active), 80), truncated: true,
        read: {...publicRecall(query), page: {section: 'timeline', offset: timeline.length, limit: 1}}} : lines;
    let selected: Row[];
    if (requested === 'events') selected = events.filter(value => span[0] <= number(value.turn, -1) && number(value.turn, -1) <= span[1] && (types == null || types.includes(value.type)));
    else if (requested === 'timeline') {
        selected = timeline;
        if (largeLines) selected.push({kind: 'worldlines', ...lines});
    } else if (requested === 'diff') {
        const diff = historyDiff(all, params.diff);
        base.from = diff.from; base.to = diff.to;
        selected = [{kind: 'scene', from: diff.scene[0], to: diff.scene[1]}, {kind: 'clock', from: diff.clock[0], to: diff.clock[1]},
            ...diff.clues_added.map((clue: string) => ({kind: 'clue', clue})),
            ...diff.resources.map((value: Row) => ({kind: 'resource', ...value})),
            ...diff.sessions.map((value: Row) => ({kind: 'session', ...value})),
            ...diff.moves.map((value: Row) => ({kind: 'move', ...value}))];
    } else throw new RpcError('invalid_params', 'History sections are timeline, events and diff');
    return rowDetail(selected, query, requested, base) ?? rowsPage(selected, query, requested, base);
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
    const evidence=await lineFulfillmentEvidence(campaign,line);
    return withPromiseFulfillment(evidence.memory??result,{campaign:campaign.id,...evidence});
}
export async function candidatesFor(campaign: CampaignWriter, meta: Row, line: any): Promise<Row[]> {
    const current=async()=>{const [memory,world,turn,history]=await Promise.all([logs(campaign,'memory/candidates.jsonl'),campaign.readWorld(),campaign.readTurn(),records(campaign)]);
        return withPromiseFulfillment(memory,{campaign:campaign.id,receipts:canonicalMemoryReceipts([...history.values()],array(turn.receipts)),world});};
    if (line == null || line === 'current'||line===(meta.active_worldline||'main')) return current();
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
                if (!rows.has(memoryOccurrenceKey(value)))
                    rows.set(memoryOccurrenceKey(value), value);
    for (const value of await current())
        rows.set(memoryOccurrenceKey(value), value);
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
    position(limit, 12, 'limit', true);
    const line = Object.hasOwn(params, 'line') ? params.line : 'current', rows = await candidatesFor(campaign, await campaign.readCampaign(), line);
    const hits = queryCandidates(rows, index, about, {narrow, turns, kinds, includeSuperseded: truth(params.include_superseded), limit: rows.length});
    const snapshot = await recallSnapshot(campaign, params, [rows, hits, line]);
    const query = {...params, page: {limit: number(limit), ...row(params.page)}};
    const base = {what: 'memory', about, line, _snapshot: snapshot};
    return rowDetail(hits, query, 'hits', base) ?? rowsPage(hits, query, 'hits', base);
}
