/** Contract section 193.3: related offstage undertakings, read without changing presence or execution authority. */
import type {ModuleGraph} from './module-graph.js';
import {compareUnicode} from '../json.js';
import {jsonSize, npcNode, npcsPresent, personLabel, personNode, presenceThrough, rosterWord, sceneLabel, untoldBlock} from './capsule.js';
import {bookCast} from './cast.js';
import {tableWord} from './person-words.js';
import {onLine} from './exchange.js';
import {memoryEvidenceView, memoryOccurrenceKey} from './memory.js';
import {array, chars, clone, normalize, number, row, string, type Row} from './values.js';
import {foldIntent, intentParts, intentsOf, openIntents} from '../npc/intents.js';

export const DEFERRED_NPCS_BYTES = 1536;
export const DEFERRED_NPCS_PEOPLE = 3;
const TEXT_CHARS = 160;
const NOTE = 'Related offstage reports and undertakings, not local presence or a duty to finish this turn. Read the named person for more; changing a player method does not cancel an NPC action.';

function person(graph: ModuleGraph, world: Row, value: unknown): Row | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const resolved = personNode(graph, world, value), found = resolved ? graph.survivorOf(resolved) : null;
        return found && graph.isPerson(found) ? found : null;
    } catch { return null; }
}

/** A retained memory occurrence must name a committed original on the same line, not merely carry a statement. */
function boundPromise(value: Row, records: Row[]): boolean {
    const source = row(value.source), commit = source.commit;
    if (!Number.isSafeInteger(source.turn) || typeof commit !== 'string' || !/^[a-f0-9]{7,64}$/.test(commit)) return false;
    return records.some(record => number(record.turn) === source.turn && typeof record.commit === 'string'
        && /^[a-f0-9]{7,64}$/.test(record.commit)
        && (record.commit === commit || record.commit.startsWith(commit) || commit.startsWith(record.commit)));
}

function clipped(value: string): {text: string; truncated?: true} {
    const text = chars(value, TEXT_CHARS);
    return {text, ...(text !== value ? {truncated: true as const} : {})};
}

export function deferredNpcContext(input: {
    graph: ModuleGraph; world: Row; turn: Row; ledger: Row; memory: Row[]; records: Row[]; scope: Row; journal?: Row; party?: Row[];
}): Row | undefined {
    const {graph, world, turn, ledger, memory, scope} = input, n = number(turn.turn);
    const records = input.records.filter(record => Boolean(record.commit) && number(record.turn) < n
        && onLine(record, scope) && !['reference', 'uncertain'].includes(string(record.interaction_scope)))
        .sort((a, b) => number(b.turn) - number(a.turn));
    const presence = presenceThrough(graph, world), here = new Set(npcsPresent(graph, world, graph.scene(world.active_scene))
        .map(node => string(node.node_id)));
    const pool = new Map<string, Row>(), recent = new Set<string>(), issued = new Set<string>(), promises = new Map<string, Row[]>();
    let sourceGaps = 0;
    for (const [index, record] of records.entries()) {
        const remember = (value: unknown): void => {
            const node = person(graph, world, value);
            if (!node) return;
            const id = string(node.node_id); issued.add(id);
            if (index < 2) {pool.set(id, node); recent.add(id);}
        };
        for (const line of array(record.speech)) {
            const who = row(row(line).who);
            if (typeof who.npc === 'string') remember(who.npc);
        }
        for (const receipt of array(record.receipts))
            for (const value of [row(receipt).npc, row(receipt).actor, row(row(receipt).intent).npc])
                if (typeof value === 'string') remember(value);
    }
    const seen = new Set<string>();
    for (const value of memory) {
        if (value.kind !== 'promise' || value.status !== 'candidate' || value.superseded_by != null
            || value.valid_until_turn != null || !onLine(value, scope) || number(value.valid_from_turn) >= n
            || row(memoryEvidenceView(value).fulfillment).status === 'complete') continue;
        if (['world', 'party', 'keeper', 'player'].includes(string(value.subject))) continue;
        if (array(input.party).some(sheet => [row(sheet).id, row(sheet).name].some(name => typeof name === 'string'
            && normalize(name) === normalize(string(value.subject))))) continue;
        const node = person(graph, world, value.subject);
        const bound = boundPromise(value, records);
        // A source-only future profile is not made a known actor by an unbound memory row.
        if (node && !issued.has(string(node.node_id)) && !graph.isTablePerson(node)) continue;
        if (node && here.has(string(node.node_id))) continue;
        if (!node || !bound || typeof value.statement !== 'string' || !value.statement.trim()) {
            sourceGaps++; continue;
        }
        const occurrence = memoryOccurrenceKey(value);
        if (seen.has(occurrence)) continue;
        seen.add(occurrence);
        const id = string(node.node_id), owned = promises.get(id) ?? [];
        owned.push(value); promises.set(id, owned); pool.set(id, node);
    }
    const people: Row[] = [], totals = new Map<Row, {undertakings: number; commitments: number}>();
    for (const [id, node] of pool) {
        const handle = graph.handle(node), at = presence.get(id)?.at;
        if (here.has(id)) continue;
        const entry = clone(row(ledger[id]));
        for (const receipt of array(turn.receipts)) {
            const stamp = row(row(receipt).intent), owner = person(graph, world, stamp.npc);
            if (owner?.node_id === id) foldIntent(entry, stamp, n, row(receipt).id, false, true);
        }
        const underway = openIntents(entry).filter(item => number(item.last_turn) < n);
        // d1's named readers and writer still address the survivor's own ledger. Do not advertise a variant-only
        // undertaking that the named exit cannot retrieve or settle; retain the old rows and report a source gap.
        const identity = (item: Row): string => intentParts(item.ref)?.digest ?? string(item.ref);
        const readable = new Set(intentsOf(entry).map(identity)), legacy = new Set<string>();
        for (const variant of graph.groupOf(node)) {
            if (variant.node_id === id) continue;
            for (const item of openIntents(row(ledger[string(variant.node_id)])))
                if (number(item.last_turn) < n && !readable.has(identity(item))) legacy.add(identity(item));
        }
        sourceGaps += legacy.size;
        const owned = promises.get(id) ?? [];
        if (!underway.length && !owned.length || !recent.has(id) && !owned.length) continue;
        const untold = untoldBlock(graph, world, row(input.journal), node, records);
        const cast = bookCast(graph).find(value => value.node && graph.survivorId(string(value.node.node_id)) === id);
        const alias = cast && cast.nodes.some(each => tableWord(world, graph.handle(each)).trim()
            || string(row(row(row(input.journal).entries)[string(each.node_id)]).label || '').trim())
            ? rosterWord(graph, world, row(input.journal), cast) : '';
        const name = alias || (untold ? typeof untold.label === 'string' ? untold.label : ''
            : personLabel(world, handle, graph.displayName(node)));
        if (!name.trim()) {sourceGaps++; continue;}
        try {if (npcNode(graph, world, name).node_id !== id) {sourceGaps++; continue;}}
        catch {sourceGaps++; continue;}
        let location: string | null = null;
        if (typeof at === 'string' && at) {
            try {location = sceneLabel(graph, world, graph.scene(at));} catch {sourceGaps++;}
        }
        const value: Row = {name, location, present: false, can_act_here: false,
            undertakings: underway.map(item => {
                const text = clipped(string(item.text));
                return {intent: text.text, status: 'attempted', since_turn: item.since_turn ?? null,
                    last_turn: item.last_turn ?? null, authority: 'canonical_receipt', ...(text.truncated ? {truncated: true} : {})};
            }),
            commitments: owned.map(item => {
                const text = clipped(item.statement);
                return {statement: text.text, turn: item.valid_from_turn ?? row(item.source).turn,
                    authority: 'conversation_report', ...(text.truncated ? {truncated: true} : {})};
            }), read_next: {focus: 'npc', name}};
        people.push(value); totals.set(value, {undertakings: underway.length, commitments: owned.length});
    }
    // Ordering is structural and stable; age is not urgency, a deadline, or an instruction to settle something.
    people.sort((a, b) => compareUnicode(string(a.name), string(b.name)));
    const eligible = people.length, selected = people.slice(0, DEFERRED_NPCS_PEOPLE);
    if (!eligible && !sourceGaps) return undefined;
    const coverage = (): Row => ({eligible, shown: selected.length, people_omitted: eligible - selected.length,
        undertakings_omitted: people.reduce((sum, item) => sum + totals.get(item)!.undertakings
            - (selected.includes(item) ? array(item.undertakings).length : 0), 0),
        commitments_omitted: people.reduce((sum, item) => sum + totals.get(item)!.commitments
            - (selected.includes(item) ? array(item.commitments).length : 0), 0), source_gaps: sourceGaps});
    const result = (): Row => ({people: selected, coverage: coverage(), note: NOTE});
    while (jsonSize(result()) > DEFERRED_NPCS_BYTES && selected.length) {
        const last = selected[selected.length - 1];
        if (array(last.commitments).length) (last.commitments as Row[]).pop();
        else if (array(last.undertakings).length) (last.undertakings as Row[]).pop();
        else selected.pop();
        if (selected.includes(last) && !array(last.commitments).length && !array(last.undertakings).length)
            last.navigation_only = true;
    }
    return result();
}
