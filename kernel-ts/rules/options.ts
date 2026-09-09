/** Read-only confirmed optional-rule precedence; this module never writes patches. */
import { join } from "node:path";
import { isJsonObject, compareUnicode } from "../json.js";
import { CampaignSnapshot } from "../read/campaign.js";
import { array, row, entries, values, string, truth, clone, sorted, repr, type Row } from "../read/values.js";
export const OPTIONAL_LAYERS = ["system_safety", "session_ruling", "house_rule", "campaign_patch", "module_supplement", "era_supplement", "official_optional", "core"];
const NON_TOGGLE = new Set(["system_safety", "core", "session_ruling"]);
export class OptionalRuleError extends Error {
    constructor(readonly code: string, message: string, readonly details: Row = {}) {
        super(message);
        this.name = "OptionalRuleError";
    }
}
export function declaredOptionalRules(manifest: Row | null): Row[] {
    return array(manifest?.optional_rules).filter(value => isJsonObject(value) && typeof value.option_id === "string").map(value => ({
        option_id: value.option_id,
        display: string(value.display || value.option_id),
        enabled_by_default: truth(value.enabled_by_default),
        rule_refs: array(value.rule_refs).map(string),
        decision_refs: array(value.decision_refs).map(string),
        operation_gates: array(value.operation_gates).map(string),
        settlement_gates: array(value.settlement_gates).map(string),
        source_note: string(value.source_note || ""),
    }));
}
export function optionForTarget(manifest: Row | null, target: string): Row | null {
    return declaredOptionalRules(manifest).find(option => option.rule_refs.includes(target) || option.decision_refs.includes(target)) ?? null;
}
const patchBody = (value: Row): Row => isJsonObject(value.patch) ? value.patch : value;
export function togglesFromPatches(manifest: Row | null, patches: Row[] | null = null): Row[] {
    return array(patches).filter(isJsonObject).map(raw => {
        const patch = patchBody(raw),
            target = string(patch.target || ""),
            relation = string(patch.relation || ""),
            layer = string(patch.layer || ""),
            scope = string(patch.scope || ""),
            option = optionForTarget(manifest, target);
        const value: Row = {
            patch_id: string(patch.patch_id || ""),
            version: patch.version ?? null,
            layer,
            scope,
            relation,
            target,
            option_id: option?.option_id ?? null,
            reason: string(patch.reason || ""),
            statement: string(patch.statement || ""),
            applicable: false
        };
        if (!option)
            value.inapplicable_reason = "target_not_an_optional_rule";
        else if (!["disables", "enables"].includes(relation))
            value.inapplicable_reason = "relation_not_enforced";
        else if (!OPTIONAL_LAYERS.includes(layer) || NON_TOGGLE.has(layer))
            value.inapplicable_reason = "layer_cannot_toggle";
        else if (scope !== "campaign")
            value.inapplicable_reason = "scope_not_enforced";
        else {
            value.applicable = true;
            value.enabled = relation === "enables";
        }
        return value;
    });
}
export function effectiveOptionalRules(manifest: Row | null, patches: Row[] | null = null): Row {
    const toggles = togglesFromPatches(manifest, patches),
        result: Row = {};
    for (const declared of declaredOptionalRules(manifest)) {
        const option = declared.option_id,
            mine = toggles.filter(value => value.applicable && value.option_id === option);
        if (!mine.length) {
            result[option] = {
                option_id: option,
                display: declared.display,
                enabled: declared.enabled_by_default,
                decided_by: "ruleset_default",
                layer: "ruleset_default",
                scope: "campaign"
            };
            continue;
        }
        const best = Math.min(...mine.map(value => OPTIONAL_LAYERS.indexOf(value.layer))),
            winners = mine.filter(value => OPTIONAL_LAYERS.indexOf(value.layer) === best).sort((a, b) => compareUnicode(a.patch_id, b.patch_id));
        if (new Set(winners.map(value => value.enabled)).size > 1) {
            result[option] = {
                option_id: option,
                display: declared.display,
                enabled: null,
                conflict: true,
                decided_by: null,
                layer: winners[0].layer,
                scope: "campaign",
                conflicting: winners.map(value => ({
                    patch_id: value.patch_id,
                    relation: value.relation
                }))
            };
        }
        else {
            const winner = winners[0];
            result[option] = {
                option_id: option,
                display: declared.display,
                enabled: winner.enabled,
                decided_by: winner.patch_id,
                layer: winner.layer,
                scope: winner.scope,
                reason: winner.reason,
                statement: winner.statement
            };
        }
    }
    return result;
}
export async function confirmedPatches(campaign: CampaignSnapshot): Promise<Row[]> {
    if (!await campaign.context.snapshots.pathExists(join(campaign.dir, "save", "house-rules.json")))
        return [];
    let document: any;
    try {
        document = await campaign.optional("save/house-rules.json");
    }
    catch (error) {
        throw new OptionalRuleError("house_rules_corrupt", error instanceof Error ? error.message : string(error));
    }
    if (!isJsonObject(document) || !Array.isArray(document.patches))
        throw new OptionalRuleError("house_rules_corrupt", "save/house-rules.json must carry a patches list");
    return document.patches.filter(isJsonObject).map(value => clone(patchBody(value)));
}
export async function campaignEffectiveOptionalRules(campaign: CampaignSnapshot, manifest: Row | null): Promise<Row> {
    return effectiveOptionalRules(manifest, await confirmedPatches(campaign));
}
const gating = (status: Row | null | undefined): boolean => status != null && (status.conflict === true || status.enabled === false);
export function disabledDecisionGates(manifest: Row | null, effective: Row): Row {
    const result: Row = {};
    for (const option of declaredOptionalRules(manifest))
        if (gating(effective[option.option_id]))
            for (const ref of option.decision_refs)
                result[ref] = clone(effective[option.option_id]);
    return result;
}
export function gateFor(manifest: Row | null, effective: Row, options: {
    operation?: string | null;
    settlement?: string | null;
}): Row | null {
    for (const option of declaredOptionalRules(manifest)) {
        if (options.operation != null && !option.operation_gates.includes(options.operation) || options.settlement != null && !option.settlement_gates.includes(options.settlement) || options.operation == null && options.settlement == null)
            continue;
        const status = effective[option.option_id];
        if (gating(status))
            return clone(status);
    }
    return null;
}
export const gateCode = (status: Row): string => truth(status.conflict) ? "rule_conflict" : "optional_rule_disabled";
export function gateMessage(status: Row): string {
    if (truth(status.conflict)) {
        const names = array(status.conflicting).map(value => `${string(value.patch_id)} (${string(value.relation)})`).join(", ");
        return `optional rule ${repr(status.option_id)} has conflicting confirmed patches at layer ${string(status.layer)}: ${names}; supersede one before this rule can settle`;
    }
    return status.decided_by === "ruleset_default"
        ? `optional rule ${repr(status.option_id)} is off by ruleset default; a confirmed house rule with relation enables switches it on for this campaign`
        : `optional rule ${repr(status.option_id)} is disabled by ${string(status.layer)} ${repr(status.decided_by)}: ${status.reason || "no reason recorded"}`;
}
