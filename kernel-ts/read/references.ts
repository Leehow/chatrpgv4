/** Optional kind-qualified semantic names disambiguate source roles, without opaque IDs. */
import { RpcError } from '../errors.js';
import { ModuleGraph } from './module-graph.js';
import { array, type Row } from './values.js';

export const referenceName = (graph: ModuleGraph, node: Row): string => `${node.node_kind}: ${graph.handle(node)}`;
export function resolveReference(graph: ModuleGraph, value: unknown, kinds?: string[]): Row {
    if (typeof value !== 'string' || !value.trim()) throw new RpcError('invalid_params', 'Use a semantic entity name');
    let name = value.trim(), selected = kinds;
    const colon = name.indexOf(':'), prefix = colon < 0 ? '' : name.slice(0, colon).trim();
    if (graph.byKind.has(prefix)) {
        if (kinds && !kinds.includes(prefix)) throw new RpcError('invalid_params', `This reference requires ${kinds.join(' or ')}, not ${prefix}`, {
            fix: 'Choose a source reference of the required kind',
            details: {candidates: kinds.flatMap(kind => graph.kind(kind)).slice(0, 8).map(node => ({name: referenceName(graph, node), kind: node.node_kind}))}
        });
        selected = [prefix]; name = name.slice(colon + 1).trim();
    }
    try { return graph.resolve(name, selected); }
    catch (error) {
        if (!(error instanceof RpcError) || error.code !== 'unknown_entity') throw error;
        let nodes = array(error.details?.candidates).flatMap(candidate => {const node = graph.nodes.get(candidate.id); return node ? [node] : [];});
        if (!nodes.length) nodes = (selected ?? ['scene', 'npc', 'clue']).flatMap(kind => graph.kind(kind)).slice(0, 8);
        throw new RpcError('unknown_entity', error.message, {
            fix: `Use a supplied kind-qualified semantic name${nodes.length ? `, such as ${referenceName(graph, nodes[0])}` : ''}. Original source anchors cannot name a newly added campaign entity.`,
            details: {...error.details, candidates: nodes.map(node => ({name: referenceName(graph, node), kind: node.node_kind}))}
        });
    }
}
