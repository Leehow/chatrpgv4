/** Optional kind-qualified semantic names disambiguate source roles, without opaque IDs. */
import { RpcError } from '../errors.js';
import { ModuleGraph } from './module-graph.js';
import { array, normalize, row, string, type Row } from './values.js';

export const referenceName = (graph: ModuleGraph, node: Row): string => `${node.node_kind}: ${graph.handle(node)}`;
/**
 * The node a candidate row names, by the two words the row actually carries.
 *
 * `ModuleGraph.describe` answers `{name, kind, display_name}` -- `name` is the handle, and there is
 * no `id` on it, because a model-visible identifier in this kernel is a name (contract §2). This
 * read used `candidate.id`, so every candidate was dropped and the constant fallback below was
 * printed instead: on H-SIDE t4 the same eight scene names came back for eight different queries,
 * including the two ambiguities whose right answer -- `scene: previous-tenants`,
 * `scene: neighborhood-gossip` -- was not among them. §56.1 keeps a Keeper's bare ambiguous name a
 * refusal "with its candidates"; the candidates were what went missing.
 *
 * Exact on the handle within the candidate's own kind. Nothing here guesses at a near name: the
 * ranking that chose these rows already ran inside `ModuleGraph.candidates`.
 */
const candidateNode = (graph: ModuleGraph, candidate: unknown): Row | null => {
    const kind = string(row(candidate).kind), key = normalize(row(candidate).name);
    if (!kind || !key) return null;
    return graph.kind(kind).find(node => normalize(graph.handle(node)) === key) ?? null;
};
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
        let nodes = array(error.details?.candidates).flatMap(candidate => {const node = candidateNode(graph, candidate); return node ? [node] : [];});
        if (!nodes.length) nodes = (selected ?? ['scene', 'npc', 'clue']).flatMap(kind => graph.kind(kind)).slice(0, 8);
        throw new RpcError('unknown_entity', error.message, {
            fix: `Use a supplied kind-qualified semantic name${nodes.length ? `, such as ${referenceName(graph, nodes[0])}` : ''}. Original source anchors cannot name a newly added campaign entity.`,
            details: {...error.details, candidates: nodes.map(node => ({name: referenceName(graph, node), kind: node.node_kind}))}
        });
    }
}
