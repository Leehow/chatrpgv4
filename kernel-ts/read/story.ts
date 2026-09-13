/** Keeper-only assessment context and one bounded causal re-entry projection. */
import { continuityView, evidenceAcquired, evidenceHandouts } from './continuity.js';
import { ModuleGraph, recordOf } from './module-graph.js';
import { array, chars, number, row, string, type Row } from './values.js';

const IMPORTANCE = ['critical', 'core', 'major', 'supporting', 'minor'];
const rank = (value: unknown): number => {
    const found = IMPORTANCE.indexOf(string(value));
    return found < 0 ? IMPORTANCE.length : found;
};

export function latestStoryAssessment(rows: Row[], worldline: string, loop = 0, before = Number.POSITIVE_INFINITY): Row | null {
    return rows.filter(value => value.worldline === worldline && number(value.loop) === loop && number(value.turn) < before)
        .sort((a, b) => number(b.turn) - number(a.turn))[0] ?? null;
}

/** The memory lane chooses only among these source-backed open threads; it never invents a target. */
export function storyAssessmentContext(graph: ModuleGraph, world: Row, records: Row[], candidates: Row[], assessments: Row[], worldline: string, loop: number, before: number): Row {
    const open = graph.kind('conclusion').flatMap(conclusion => {
        const evidence = (graph.incoming.get(conclusion.node_id) ?? [])
            .filter(edge => ['supports', 'contradicts'].includes(edge.relation_kind) && graph.nodes.get(edge.from_node_id)?.node_kind === 'clue')
            .map(edge => ({edge, clue: graph.nodes.get(edge.from_node_id)!}));
        const supports = evidence.filter(value => value.edge.relation_kind === 'supports');
        const missing = supports.filter(value => !evidenceAcquired(graph, world, value.clue, records));
        if (!supports.length || !missing.length) return [];
        const source = recordOf(conclusion);
        return [{name: graph.handle(conclusion), claim: chars(graph.summary(conclusion), 500),
            importance: string(source.importance || 'unknown'),
            acquired: evidence.filter(value => evidenceAcquired(graph, world, value.clue, records)).map(value => graph.handle(value.clue)),
            missing: missing.length, of: supports.length}];
    }).sort((a, b) => rank(a.importance) - rank(b.importance) || b.acquired.length - a.acquired.length || a.missing - b.missing || a.name.localeCompare(b.name));
    const core = open.filter(value => ['critical', 'core'].includes(value.importance));
    const best = open.length ? rank(open[0].importance) : IMPORTANCE.length;
    const threads = (core.length ? core : open.filter(value => rank(value.importance) === best)).slice(0, 6);
    const continuity = threads.length ? continuityView(graph, world, records, candidates,
        {anchors: threads.map(value => value.name), limit: threads.length, budget: 7000, compact: true}) : {connections: [], truncated: false};
    const connections = array(continuity.connections);
    const previous = latestStoryAssessment(assessments, worldline, loop, before);
    const supplied = threads.map(thread => {
        const connection = row(connections.find(value => value.name === thread.name));
        const evidence = array(connection.evidence).filter(value => value.acquired === true);
        const project = (relation: string) => evidence.filter(value => value.relation === relation).slice(0, 4).map(value => ({
            evidence: value.name,
            delivery_turn: array(value.turns).filter(value => value != null).at(-1)
                ?? array(value.deliveries).map(delivery => row(delivery).turn).filter(value => value != null).at(-1) ?? null
        }));
        return {thread: thread.name, claim: thread.claim, importance: thread.importance,
            supporting: project('supports'), contradicting: project('contradicts')};
    });
    // Contract §37.2: `truncated` means this packet's evidence was cut, not that the graph holds other
    // conclusions. `continuity.truncated` reports the latter — it is `connections.length > limit`, and this
    // caller deliberately asks for only its selected threads, so it was true on every turn and told the lane
    // its evidence might be incomplete when nothing had been dropped.
    const cut = threads.some(thread => {
        const connection = connections.find(value => row(value).name === thread.name);
        if (!connection) return true;
        const kept = array(row(connection).evidence).filter(value => row(value).acquired === true).length;
        return number(row(connection).acquired_total) > kept;
    });
    return {threads: supplied,
        last_assessment: previous ? {turn: previous.turn, status: previous.status, thread: previous.thread, frame: previous.frame,
            bridge_delivered: previous.bridge_delivered, delivery_quote: previous.delivery_quote} : null,
        truncated: cut};
}

/** A prior semantic finding becomes one actionable row only while its selected source thread remains open. */
export function storyReentry(graph: ModuleGraph, world: Row, records: Row[], assessments: Row[], worldline: string, loop: number, lines: Row[]): Row | null {
    const assessment = latestStoryAssessment(assessments, worldline, loop);
    if (!assessment || !['misframed', 'detached'].includes(string(assessment.status)) || assessment.bridge_delivered === true) return null;
    const line = lines.find(value => value.name === assessment.thread);
    if (!line) return null;
    const conclusion = graph.find(string(assessment.thread), ['conclusion']);
    if (!conclusion) return null;
    const evidence = (graph.incoming.get(conclusion.node_id) ?? []).flatMap(edge => {
        const clue = graph.nodes.get(edge.from_node_id);
        if (!clue || clue.node_kind !== 'clue' || !['supports', 'contradicts'].includes(edge.relation_kind)) return [];
        const name = graph.handle(clue), deliveries = records.filter(record => array(record.receipts).some(receipt => receipt.clue === name));
        return [{clue, name, relation: edge.relation_kind, summary: graph.summary(clue), acquired: evidenceAcquired(graph, world, clue, records),
            turns: deliveries.map(record => record.turn).slice(-3)}];
    });
    const known = evidence.filter(value => value.acquired).slice(0, 3).map(value => ({
        name: value.name, relation: value.relation, summary: chars(string(value.summary), 180), turns: value.turns
    }));
    const clarifiedBefore = assessments.some(value => value.worldline === worldline && number(value.loop) === loop
        && value.thread === assessment.thread && value.bridge_delivered === true && number(value.turn) < number(assessment.turn));
    const mode = known.length && !clarifiedBefore ? 'clarify_known' : 'introduce_evidence';
    const bridge = mode === 'introduce_evidence' ? evidence.filter(value => !value.acquired).flatMap(value => {
        const clue = value.clue;
        const handouts = evidenceHandouts(graph, clue);
        const people = graph.npcsKnowing(clue).flatMap(id => graph.nodes.has(id) ? [graph.handle(graph.nodes.get(id)!)] : []);
        const scenes = graph.scenes().filter(scene => graph.sceneClueIds(scene).includes(clue.node_id)).map(scene => graph.handle(scene));
        return [{clue: value.name, relation: value.relation, fact: chars(string(value.summary), 360),
            source_handouts: handouts.slice(0, 2), knowledgeable_people: people.slice(0, 2), source_scenes: scenes.slice(0, 3),
            rank: handouts.length ? 0 : people.length ? 1 : 2}];
    }).sort((a, b) => a.rank - b.rank || a.clue.localeCompare(b.clue)).map(({rank: _rank, ...value}) => value)[0] : undefined;
    return {
        assessed_turn: assessment.turn,
        status: assessment.status,
        frame: assessment.frame,
        mode,
        thread: {name: line.name, claim: chars(string(graph.summary(conclusion) || line.needs), 360), importance: line.importance},
        known,
        ...(bridge ? {bridge: {...bridge,
            delivery: 'Carry this existing evidence into the chosen direction through source_rebinding when its source location changes, then settle its existing clue or handout receipt before narration. State how the evidence supports or contradicts the selected thread and why that matters now.'}} : {}),
        available: {here: array(line.here).slice(0, 2), handed: array(line.handed).slice(0, 2), next: array(line.next).slice(0, 2),
            fallback: line.fallback ? chars(string(line.fallback), 120) : null},
        action: mode === 'clarify_known'
            ? 'Before ordinary pacing, clarify one acquired known evidence row: state how it supports or contradicts the selected thread and why that matters now, then continue the investigator\'s chosen action. Do not open adaptation or introduce another clue.'
            : 'Before ordinary pacing, realize the supplied bridge and make its causal relation and current stakes explicit. New information keeps its existing authority and receipts; changed persistent placement uses reviewed source_rebinding first. Never retry a refused hook or choose the investigator\'s response.'
    };
}
