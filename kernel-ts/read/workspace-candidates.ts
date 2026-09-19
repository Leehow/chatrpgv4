/** Static source projections and bounded retrieval; no world mutation or semantic inference. */
import {jsonDigest} from '../json.js';
import {ModuleGraph, recordOf} from './module-graph.js';
import {array, row, string, type Row} from './values.js';

export const WORKSPACE_ADAPTER = 'static-evidence-v2';
const SOURCE_FIELDS = ['prose', 'description', 'summary', 'agenda', 'fear', 'secret', 'voice',
    'relationship', 'keeper_note', 'keeper_notes', 'social_role', 'dramatic_question', 'background'];
const indexes = new Map<string, {postings: Map<string, string[]>; exact: Map<string, string[]>}>();
const terms = (text: string): string[] => {
    const normalized = text.normalize('NFKC').toLocaleLowerCase();
    // Generic character pairs are lexical retrieval keys, never an intent or language classifier.
    const chars = Array.from(normalized).slice(0, 1024);
    return [...new Set(chars.length < 2 ? chars : chars.slice(0, -1).map((value, i) => value + chars[i + 1]))];
};

export function staticBody(graph: ModuleGraph, node: Row): {body: string; coverage: Row} {
    const record = recordOf(node), fields: Row = {};
    for (const key of SOURCE_FIELDS) {
        const value = record[key] ?? row(node.properties)[key];
        if (typeof value === 'string' && value) fields[key] = value;
    }
    const body = JSON.stringify({name: graph.handle(node), kind: node.node_kind, summary: node.summary ?? '',
        authored_background: fields});
    const coverage: Row = {status: 'complete', projection: WORKSPACE_ADAPTER, entity_complete: false,
        omitted: ['dynamic_state', 'unselected_source_fields']};
    if (Buffer.byteLength(body, 'utf8') <= 8192) return {body, coverage};
    // An excerpt is explicitly a range of the source projection, never a full entity or rule.
    let excerpt = '';
    for (const char of body) {if (Buffer.byteLength(excerpt + char, 'utf8') > 8192) break; excerpt += char;}
    return {body: excerpt, coverage: {...coverage, range: {from: 0, to: Array.from(excerpt).length},
        omitted: [...coverage.omitted, 'source_projection_remainder']}};
}

/** Build lexical postings once per effective published graph revision; never scan a PDF. */
function indexFor(graph: ModuleGraph, revision: string) {
    const key = `${graph.moduleId}:${revision}`;
    const existing = indexes.get(key);
    if (existing) {indexes.delete(key); indexes.set(key, existing); return existing;}
    const index = {postings: new Map<string, string[]>(), exact: new Map<string, string[]>()};
    let postings = 0;
    for (const node of graph.nodes.values()) {
        if (postings >= 262144 || index.exact.size >= 16384 || index.postings.size >= 65536) break;
        const id = string(node.node_id);
        for (const name of graph.nameKeys(node)) {
            const key = name.normalize('NFKC').toLocaleLowerCase();
            const ids = index.exact.get(key) ?? []; if (ids.length < 128) {ids.push(id); postings++;} index.exact.set(key, ids);
        }
        for (const term of terms(`${node.name ?? ''} ${node.summary ?? ''} ${graph.prose(node).slice(0, 512)}`)) {
            if (postings >= 262144 || index.postings.size >= 65536) break;
            const ids = index.postings.get(term) ?? []; if (ids.length < 128) {ids.push(id); postings++;} index.postings.set(term, ids);
        }
    }
    indexes.set(key, index);
    while (indexes.size > 4) indexes.delete(indexes.keys().next().value!);
    return index;
}

export function workspaceNodes(graph: ModuleGraph, input: {revision: string; scene: string; query: string;
    names: string[]; limit: number; present: string[]}): {nodes: Row[]; inspected: number} {
    const index = indexFor(graph, input.revision), pending: string[] = [], inspected = new Set<string>();
    const exact = (name: string) => index.exact.get(name.normalize('NFKC').toLocaleLowerCase()) ?? [];
    const add = (id: string) => {
        if (!inspected.has(id) && inspected.size >= input.limit) return;
        inspected.add(id);
        if (pending.length < input.limit && !pending.includes(id)) pending.push(id);
    };
    // Current scene and established identities lead; a separate lexical query channel follows.
    for (const name of [input.scene, ...input.names.slice(0, 16), ...input.present.slice(0, 16)])
        for (const id of exact(name)) add(id);
    const tableLimit = Math.min(pending.length + 12, input.limit);
    for (const id of graph.tableNames.keys()) {if (pending.length >= tableLimit) break; add(id);}
    const scores = new Map<string, number>();
    const queryLimit = inspected.size + Math.floor((input.limit - inspected.size) / 2);
    for (const term of terms(input.query).slice(0, 64))
        for (const id of index.postings.get(term) ?? []) {
            if (!inspected.has(id) && inspected.size >= queryLimit) continue;
            inspected.add(id);
            scores.set(id, (scores.get(id) ?? 0) + 1);
        }
    for (const [id] of [...scores].sort((a, b) => b[1] - a[1]).slice(0, Math.floor(input.limit / 2))) add(id);
    for (let i = 0; i < pending.length && i < input.limit; i++) {
        const id = pending[i];
        for (const relation of [...(graph.out.get(id) ?? []).slice(0, input.limit), ...(graph.incoming.get(id) ?? []).slice(0, input.limit)]) {
            if (pending.length >= input.limit) break;
            add(string(relation.from_node_id) === id ? string(relation.to_node_id) : string(relation.from_node_id));
        }
    }
    // Very young/empty scenes retain a bounded published-source fallback, not a sorted full scan.
    for (const node of graph.nodes.values()) {if (pending.length >= input.limit) break; add(string(node.node_id));}
    const nodes = pending.map(id => graph.nodes.get(id)).filter((node): node is Row => Boolean(node));
    return {nodes, inspected: inspected.size};
}

export function sourceReference(graph: ModuleGraph, node: Row, scope: Row, revision: string, scene: string, ready: boolean): Row {
    const kind = string(node.node_kind || 'module'), locator = `${kind}:${graph.handle(node)}`;
    const projected = staticBody(graph, node);
    const sceneRefs = new Set<string>(), threadRefs = new Set<string>();
    if (kind === 'scene') sceneRefs.add(graph.handle(node));
    if (kind === 'conclusion') threadRefs.add(graph.handle(node));
    for (const relation of [...(graph.out.get(node.node_id) ?? []).slice(0, 128), ...(graph.incoming.get(node.node_id) ?? []).slice(0, 128)]) {
        for (const id of [relation.from_node_id, relation.to_node_id]) {
            const linked = graph.nodes.get(id); if (linked?.node_kind === 'scene') sceneRefs.add(graph.handle(linked));
            if (linked?.node_kind === 'conclusion') threadRefs.add(graph.handle(linked));
        }
    }
    return {locator, kind, scope, source_revision: revision, audience: 'keeper_only', adapter: WORKSPACE_ADAPTER,
        identity: jsonDigest({revision, locator}), authority: node.campaign_origin ? 'campaign_adaptation' : 'module_source',
        body: ready ? projected.body : undefined, text: ready ? projected.body : '',
        coverage: ready ? projected.coverage : 'unavailable',
        scene_refs: [...sceneRefs].slice(0, 16), entity_refs: [graph.handle(node)],
        thread_refs: [...new Set([...threadRefs, ...array(row(node.properties).thread_refs).filter(value => typeof value === 'string')])].slice(0, 16)};
}
