/** Explicit source handles bind one physical instance; display names never establish identity (§180.19). */
import {RpcError} from '../errors.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {array, clone, equal, row, string, values, type Row} from '../read/values.js';

export const SOURCE_OBJECT_KINDS = new Set(['object', 'artifact', 'tome']);

export function sourceObjectIdentity(graph: ModuleGraph, reference: unknown): Row {
    const matches = typeof reference === 'string' ? [...graph.nodes.values()].filter(node =>
        SOURCE_OBJECT_KINDS.has(string(node.node_kind)) && graph.handle(node) === reference
        && array(node.source_refs).length > 0 && !node.campaign_origin) : [];
    if (matches.length !== 1) throw new RpcError('unknown_entity', 'source_object must be one exact sourced physical handle from lookup module',
        {details:{field:'source_object', reference:typeof reference === 'string' ? reference : null}});
    return {module_id:graph.moduleId, node_id:matches[0].node_id};
}

export function bindSourceObject(world: Row, item: Row, identity: Row | null, existing: boolean): void {
    if (!identity) return;
    if (existing) {
        if (!equal(item.source_object, identity)) throw new RpcError('invalid_params', 'An existing instance cannot acquire or change its source identity',
            {details:{reason:'source_identity_immutable'}});
        return;
    }
    if (item.quantity !== 1 || values(row(row(world.objects).instances)).some(other => other.id !== item.id && equal(other.source_object, identity)))
        throw new RpcError('invalid_params', 'A source object binds exactly one physical instance', {details:{reason:'source_identity_duplicate'}});
    item.source_object = clone(identity);
}
