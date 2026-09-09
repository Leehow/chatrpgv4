/** Closed source vocabulary loaded from the captured content root. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { array, row, sorted, string, type Row } from '../read/values.js';
export const VISUAL_CONTRACT_ID = 'coc.module-graph-shard.v4';
export const SHARD_KEYS = ['contract_id', 'nodes', 'claims', 'node_refs', 'coverage', 'dependencies', 'critical', 'ready_nodes'];
export const NODE_KEYS = ['node_id', 'node_kind', 'name', 'aliases', 'summary', 'properties', 'visibility', 'source_refs'];
export const CLAIM_KEYS = ['claim_id', 'subject_id', 'predicate', 'object', 'truth_status', 'visibility', 'source_refs', 'reason', 'known_by_ids', 'asserted_by_ids', 'validity'];
export interface ModuleContract {
    readonly graph: Row;
    readonly template: Row;
}
export async function loadModuleContract(context: Pick<KernelContext, 'content' | 'snapshots'>): Promise<ModuleContract> {
    const graph = row(await context.snapshots.readJson(join(context.content, 'modules', 'module-graph-contract-v3.json')));
    const template = row(await context.snapshots.readJson(join(context.content, 'modules', 'module-graph-template-v1.json')));
    return Object.freeze({ graph, template });
}
export const validSemanticId = (value: unknown): value is string => typeof value === 'string' && value.length <= 160 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && !value.endsWith('\n');
/**
 * The one BCP-47 shape the kernel accepts for any language tag: a source's language, a campaign's
 * `play_language`, a guidance job's tag, a bundled guidance file name. The set is open (contract
 * section 23): the shape is checked, membership never is.
 */
export const validSourceLanguage = (value: unknown): value is string => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) && !value.endsWith('\n');
/** Contract 28.3: the words a package added arrive in the reader's own dossier ask, each with the
 *  one bounded line the package wrote. The contract law is unchanged and applies to them as
 *  written -- a key a book does not give is absent, never invented. */
export function vocabulary(contract: ModuleContract, contributed: Row | null = null): Row {
    const { graph, template } = contract;
    const added = array(row(contributed).actor_profile_keys).map(entry => ({
        key: string(row(entry).key), label: string(row(entry).label), ask: string(row(entry).ask),
    })).filter(entry => entry.key !== '' && !array(graph.actor_dossier?.profile_keys).includes(entry.key));
    const dossier = added.length ? { ...row(graph.actor_dossier), contributed: added } : graph.actor_dossier;
    return {
        shard_contract_id: VISUAL_CONTRACT_ID,
        shard_keys: sorted(SHARD_KEYS), node_keys: sorted(NODE_KEYS), claim_keys: sorted(CLAIM_KEYS),
        node_kinds: [...array(graph.node_kinds)], relation_kinds: [...array(graph.relation_kinds)],
        visibility: [...array(graph.visibility)], truth_status: [...array(graph.truth_status)],
        coverage_domains: [...array(graph.coverage_domains)], coverage_status: [...array(graph.coverage_status)],
        semantic_id_law: graph.semantic_id_law, node_id_law: graph.node_id_law,
        claim_id_law: 'Claim identifiers are optional; the host reuses or derives them. Distinct assertions may use distinct semantic identifiers.',
        source_ref_law: 'Use source_refs with a physical page starting at 1 and an optional normalized box. No text spans are required.',
        exit_relation_kinds: [...array(template.entrance_relation_kinds), 'route-to'],
        playable_node_kinds: [...array(template.playable_node_kinds)], actor_kinds: [...array(template.actor_kinds)],
        actor_dossier: dossier,
    };
}
