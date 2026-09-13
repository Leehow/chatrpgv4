/** Source relationships stay useful after acquisition. This view never infers comprehension. */
import { RpcError } from '../errors.js';
import { pythonJsonDumps } from '../json.js';
import { ModuleGraph, recordOf } from './module-graph.js';
import { resolveReference } from './references.js';
import {EntityIndex, queryCandidates} from './memory.js';
import { array, chars, row, string, type Row } from './values.js';

export function continuityView(graph: ModuleGraph, world: Row, records: Row[] = [], candidates: Row[] = [], options: Row = {}): Row {
    const limit = options.limit ?? 6;
    if (!Number.isInteger(limit) || limit < 1 || limit > 12)
        throw new RpcError('invalid_params', 'Continuity limit must be an integer from 1 to 12');
    if (options.anchors != null && (!Array.isArray(options.anchors) || options.anchors.length > 12 || options.anchors.some((v: any) => typeof v !== 'string' || !v.trim())))
        throw new RpcError('invalid_params', 'Continuity anchors must be at most twelve entity names');
    const named = [...array(options.anchors), ...(options.query ? [options.query] : [])];
    const anchorNodes = named.length ? named.map(name => resolveReference(graph, name)) : [
        ...array(world.discovered_clues).slice(-4).reverse().flatMap(name => { const node = graph.find(name, ['clue']); return node ? [node] : []; }),
        graph.scene(world.active_scene),
        ...Object.entries(row(world.npc_presence)).filter(([, at]) => at === world.active_scene).flatMap(([name]) => { const node = graph.find(name, ['npc']); return node ? [node] : []; })
    ];
    const anchorOrder = new Map(anchorNodes.map((node, index) => [node.node_id, index]));
    const distance = new Map<string, number>(anchorNodes.map(node => [node.node_id, 0]));
    for (const node of anchorNodes.filter(n => n.node_kind === 'scene'))
        for (const id of graph.sceneClueIds(node)) if (!distance.has(id)) distance.set(id, 1);
    for (let depth = 0; depth < 2; depth++) {
        for (const [id, d] of [...distance]) if (d <= depth) {
            for (const edge of [...(graph.out.get(id) ?? []), ...(graph.incoming.get(id) ?? [])]) {
                const other = edge.from_node_id === id ? edge.to_node_id : edge.from_node_id;
                if (graph.nodes.has(other) && !distance.has(other)) distance.set(other, d + 1);
            }
        }
    }
    const acquired = new Set(array(world.discovered_clues));
    const source = (node: Row): Row => ({
        origin: graph.adaptationOrigin(node.campaign_origin) ?? 'source',
        references: array(node.source_refs).length ? node.source_refs : array(node.source_references),
        claims: (graph.claimsBySubject.get(node.node_id) ?? []).slice(0, 4).map(c => ({predicate: c.predicate, object: c.object, source_refs: c.source_refs ?? []}))
    });
    const connections = graph.kind('conclusion').flatMap(conclusion => {
        const relations = (graph.incoming.get(conclusion.node_id) ?? []).filter(edge => ['supports', 'contradicts'].includes(edge.relation_kind));
        const relevant = relations.filter(edge => distance.has(edge.from_node_id));
        if (!distance.has(conclusion.node_id) && !relevant.length) return [];
        const evidence = relations.flatMap(edge => {
            const node = graph.nodes.get(edge.from_node_id);
            if (!node) return [];
            const name = graph.handle(node);
            const deliveries = records.filter(record => array(record.receipts).some(r => r.clue === name || r.handout === name));
            return [{name, relation: edge.relation_kind, acquired: acquired.has(name),
                disclosure: acquired.has(name) ? 'acquired_evidence' : 'keeper_only',
                summary: chars(graph.summary(node), 400), ...source(node),
                deliveries: deliveries.slice(-3).map(record => ({turn: record.turn, text: chars(string(record.rendered_text), 700), truncated: string(record.rendered_text).length > 700})),
                more_deliveries: deliveries.length > 3,
                people: graph.npcsKnowing(node).slice(0, 3).flatMap(id => {
                    const npc = graph.nodes.get(id);
                    if (!npc) return [];
                    const knowledge = graph.npcKnows(npc).find(entry => entry.node.node_id === node.node_id);
                    return [{name: graph.handle(npc), at: row(world.npc_presence)[graph.handle(npc)] ?? null,
                        motives: graph.npcProfile(npc), origin: knowledge?.origin ?? 'source_knowledge'}];
                })}];
        });
        return [{name: graph.handle(conclusion), claim: chars(graph.summary(conclusion), 500), disclosure: 'keeper_only_synthesis',
            ...source(conclusion), evidence: evidence.slice(0, 8), evidence_truncated: evidence.length > 8,
            possible_development: recordOf(conclusion).fallback_policy ?? null,
            anchor_order: Math.min(anchorOrder.get(conclusion.node_id) ?? Infinity, ...relations.map(e => anchorOrder.get(e.from_node_id) ?? Infinity)),
            distance: Math.min(distance.get(conclusion.node_id) ?? Infinity, ...relevant.map(e => distance.get(e.from_node_id)!))}];
    }).sort((a, b) => a.distance - b.distance || a.anchor_order - b.anchor_order || a.name.localeCompare(b.name))
        .map(({anchor_order, ...connection}) => connection);
    const names = new Set(anchorNodes.flatMap(node => graph.nameKeys(node)));
    const hypotheses = candidates.filter(c => c.superseded_by == null && ['belief', 'player_assertion', 'player_preference'].includes(c.kind) &&
        ([c.subject, ...array(c.entities)].some(name => names.has(name)) || c.subject === 'player')).slice(-6)
        .map(c => ({kind: c.kind, statement: c.statement, state: c.state ?? null, confidence: c.confidence ?? null, turn: c.valid_from_turn ?? c.turn ?? null, superseded: c.superseded_by != null, origin: 'memory_candidate'}));
    const corrections = queryCandidates(candidates, new EntityIndex(graph, [], row(world.scene_labels)), anchorNodes.map(node => graph.displayName(node)),
        {narrow: true, kinds: ['keeper_correction'], limit: 3}).map(hit => ({statement: hit.statement, turn: hit.turn, status: hit.status, authority: hit.authority}));
    const result: Row = {anchors: anchorNodes.map(node => graph.handle(node)), connections: connections.slice(0, limit), hypotheses, corrections,
        truncated: connections.length > limit,
        guidance: 'Acquired evidence is not proof of understanding. Clarify public connections freely; new disclosures still need their ordinary authority and receipts. Use recall for complete prior delivery, and source lookup for missing evidence. Hypotheses and possible developments are not settled facts.'};
    if (options.compact) {
        delete result.guidance;
        result.hypotheses = [];
        delete result.corrections;
        result.connections = result.connections.map((c: Row) => ({name: c.name, claim: chars(c.claim, 200), disclosure: c.disclosure,
            evidence: [...c.evidence].sort((a: Row, b: Row) => Number(b.acquired) - Number(a.acquired)).slice(0, 2).map((e: Row) => ({name: e.name, relation: e.relation, acquired: e.acquired,
                summary: chars(e.summary, 100), turns: e.deliveries.map((d: Row) => d.turn)})),
            truncated: true}));
    }
    const budget = options.budget ?? 10000;
    while (Buffer.byteLength(pythonJsonDumps(result), 'utf8') > budget && result.connections.length) {
        result.connections.pop(); result.truncated = true;
    }
    for (const field of ['hypotheses', 'anchors', 'corrections']) {
        if (!Array.isArray(result[field])) continue;
        while (Buffer.byteLength(pythonJsonDumps(result), 'utf8') > budget && result[field].length) {
            result[field].pop(); result.truncated = true;
        }
    }
    return result;
}
