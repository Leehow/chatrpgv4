/** Closed source vocabulary loaded from the captured content root. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { array, row, sorted, string, truth, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import { mechanicsRules, type MechanicsRules } from './mechanics-shape.js';
export const VISUAL_CONTRACT_ID = 'coc.module-graph-shard.v4';
export const SHARD_KEYS = ['contract_id', 'nodes', 'claims', 'node_refs', 'coverage', 'dependencies', 'critical', 'ready_nodes', 'interaction_scene', 'source_needs'];
/** `distinct_from` (§191.1) is a reading-time answer to `duplicate_of_published`; publication keeps it in `reading.identity`, not on the node. */
export const NODE_KEYS = ['node_id', 'node_kind', 'name', 'aliases', 'summary', 'properties', 'visibility', 'source_refs', 'distinct_from'];
export const CLAIM_KEYS = ['claim_id', 'subject_id', 'predicate', 'object', 'truth_status', 'visibility', 'source_refs', 'reason', 'known_by_ids', 'asserted_by_ids', 'validity'];
/**
 * The ruleset's own names and closed tables a drafted statement resolves against: an obligation's value
 * paths (§134.2, `skills` and `characteristics`) and a mechanical shape's names and references (§136.26).
 */
export type RulesetNames = MechanicsRules;
export interface ModuleContract {
    readonly graph: Row;
    readonly template: Row;
    /** Absent only when the content root carries no ruleset tables; a draft stating an obligation or a shape then cannot be checked (§134.16, §136.26). */
    readonly rules?: RulesetNames;
}
export async function loadModuleContract(context: Pick<KernelContext, 'content' | 'snapshots'>): Promise<ModuleContract> {
    const graph = row(await context.snapshots.readJson(join(context.content, 'modules', 'module-graph-contract-v3.json')));
    const template = row(await context.snapshots.readJson(join(context.content, 'modules', 'module-graph-template-v1.json')));
    const rules = await rulesetNames(context);
    return Object.freeze({ graph, template, ...(rules ? { rules } : {}) });
}
/** §134.16, §136.26: the tables starter registration reads, through the same `RuleTables`, for the reader's draft check. */
async function rulesetNames(context: Pick<KernelContext, 'content' | 'snapshots'>): Promise<RulesetNames | null> {
    // `RuleTables` reads only `content` and `snapshots`; the offline checker has no whole kernel context.
    const tables = new RuleTables(context as KernelContext);
    if (!await tables.exists('skills') || !await tables.exists('characteristic-dice'))
        return null;
    return mechanicsRules(tables);
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
function dossierAsk(spine: any, words: unknown): any {
    const added = array(words).map(entry => ({
        key: string(row(entry).key), label: string(row(entry).label), ask: string(row(entry).ask),
    })).filter(entry => entry.key !== '' && !array(row(spine).profile_keys).includes(entry.key));
    return added.length ? { ...row(spine), contributed: added } : spine;
}
/**
 * The vocabulary the reader's task carries. `contributed` is what the build's packages add
 * (`buildVocabulary`): `actor_profile_keys` and `creature_profile_keys` (contract 28.3, §180.8),
 * and `actor_weaknesses`, true (or the binding's provenance row) when an enabled package requires
 * `actor.weaknesses.v1` (§180.9). Only then does the task carry the weakness shape, and only a task
 * carrying it has its weaknesses checked (`weaknessesBound`).
 */
export function vocabulary(contract: ModuleContract, contributed: Row | null = null): Row {
    const { graph, template } = contract, given = row(contributed);
    const dossier = dossierAsk(graph.actor_dossier, given.actor_profile_keys);
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
        // §180.8: a creature's words, asked of creature nodes; the boundary of §180.2 rides in both dossiers' `why`.
        ...(graph.creature_dossier ? { creature_dossier: dossierAsk(graph.creature_dossier, given.creature_profile_keys) } : {}),
        // §180.20: source facts are asked independently of consumer package switches.
        ...(graph.actor_weaknesses ? { actor_weaknesses: graph.actor_weaknesses } : {}),
        ...(graph.relation_endpoints ? { relation_endpoints: graph.relation_endpoints } : {}),
        // §22.3.2: which fields a reviewer may only contest, as the graph contract declares them.
        ...(graph.classification_fields ? { classification_fields: graph.classification_fields } : {}),
    };
}
/**
 * §187.5.2: the vocabulary an author's packet carries is the one its job can write. A visual job (scan, asset, identity,
 * map scope) and §191.5's node identity job write no person or creature, so it does not receive the actor or creature dossier or the weakness shape.
 * The closed values (`visibility`, `truth_status`, `relation_kinds`, `node_kinds`) and every other key stay, because the
 * check's findings cite them. The checker reads the whole vocabulary from the graph view, never this cut.
 */
export function scopedVocabulary(whole: Row, job: Row): Row {
    if (!['visual_scan', 'visual_asset', 'visual_identity', 'node_identity', 'map_scope'].some(field => job[field] !== undefined)) return whole;
    const { actor_dossier: _actor, creature_dossier: _creature, actor_weaknesses: _weaknesses, ...rest } = whole;
    return rest;
}
