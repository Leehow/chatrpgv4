/** The two existing table.lookup kinds, composed once by the kernel owner. */
import type { KernelContext } from "../context.js";
import type { RuleLookup } from "../read/handlers.js";
import type { KernelResult } from "../handlers.js";
import { RuleObservations } from "../read/rule-facts.js";
import { RpcError } from "../errors.js";
import { compareUnicode } from "../json.js";
import { array, row, normalize, string, type Row } from "../read/values.js";
import { RuleTables } from "./tables.js";
import { Catalog, moduleSpellRecords } from "./catalog.js";
export function lookupRules(observations: RuleObservations, query: string, limit = 8): Row[] {
    const key = normalize(query),
        tokens = key.split(" ").filter(Boolean);
    if (!tokens.length)
        return [];
    const rows: Array<{
        rank: number;
        value: Row;
    }> = [];
    for (const node of observations.nodes.values()) {
        if (node.node_kind !== "rule")
            continue;
        const family = string(row(node.properties).family_id || ""),
            haystack = normalize(`${node.name || ""} ${node.node_id} ${family}`);
        const hits = tokens.filter(token => haystack.includes(token)).length;
        if (!hits)
            continue;
        rows.push({
            rank: -(hits + (haystack.includes(key) ? 10 : 0)),
            value: {
                name: node.node_id,
                family,
                summary: node.name ?? null,
                evidence_span_ids: [...array(node.evidence_span_ids)],
                authority: node.authority ?? null,
                visibility: node.visibility ?? null,
            }
        });
    }
    return rows.sort((a, b) => a.rank - b.rank || compareUnicode(a.value.name, b.value.name)).slice(0, limit).map(item => item.value);
}
export function createRuleQueries(context: KernelContext): {
    lookup: RuleLookup;
} {
    const catalog = new Catalog(new RuleTables(context));
    let loaded: Promise<RuleObservations> | undefined;
    function observations(): Promise<RuleObservations> {
        if (!loaded) {
            loaded = RuleObservations.load(context);
            void loaded.catch(() => {
                loaded = undefined;
            });
        }
        return loaded;
    }
    const lookup: RuleLookup = async (_campaign, module, params): Promise<KernelResult> => {
        const query = params.query;
        if (typeof query !== "string" || !query.trim())
            throw new RpcError("invalid_params", "params.query must be a non-empty string");
        if (params.kind === "rule")
            return {
                query,
                rules: lookupRules(await observations(), query)
            };
        if (params.kind !== "catalog")
            throw new RpcError("not_implemented", "The rule query contribution only serves rule and catalog lookup");
        const kinds = params.kinds;
        if (kinds != null && (!Array.isArray(kinds) || kinds.some((kind: any) => typeof kind !== "string")))
            throw new RpcError("invalid_params", "params.kinds must be a list of catalog kinds");
        const result = await catalog.search(query, {
            kinds,
            limit: params.limit,
            moduleSpells: moduleSpellRecords(module.graph, _campaign.world)
        });
        if (!result.ok) {
            const error = row(result.error);
            throw new RpcError("invalid_params", string(error.detail || error.code || "bad catalog query"), { details: error });
        }
        return {
            query,
            kinds: result.kinds,
            candidates: result.candidates,
            truncated: result.truncated,
            unresolved_family_parameters: result.unresolved_family_parameters
        };
    };
    return { lookup };
}
