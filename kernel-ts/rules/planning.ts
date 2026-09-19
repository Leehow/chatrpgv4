/** Generic candidate selection and closed slot refusals reused by the resolve owner. */
import { RpcError } from "../errors.js";
import { array, row, entries, string, truth, sorted, repr, type Row } from "../read/values.js";
import { semanticName } from "../read/rule-facts.js";
export const SLOT_TO_ACTION: Readonly<Record<string, string>> = Object.freeze({
    skill: "skill",
    characteristic: "skill",
    combined_target_refs: "skills",
    combined_mode: "mode",
    difficulty: "modifiers.difficulty",
    bonus: "modifiers.bonus_dice",
    penalty: "modifiers.penalty_dice",
    goal: "goal",
    stakes: "stakes",
    difficulty_basis: "stakes",
    target_ref: "target",
    npc_id: "target",
    target_npc_id: "target",
    approach: "method",
    described_action: "method",
    commitment_ref: "goal",
    motive_direction: "motive",
    motive_intensity: "motive",
    supporting_action: "support",
    feasibility: "goal",
    question: "goal",
    external_behavior: "method",
    spell: "spell",
    source: "target",
    source_ref: "target",
    pushed: "push",
    interrupted: "interrupted",
    method_changed: "method",
    failure_consequence: "stakes",
    player_confirmed_risk: "push",
    points: "luck",
    rescuer_ref: "actor",
    assistant_rescuer_ref: "target",
    changed_method: "method",
    complete_rest: "rest",
    poor_environment: "rest",
    summary: "goal",
    kind: "ending",
    weapon_ref: "weapon",
    weapon_id: "weapon",
    defense_kind: "defense",
    actor_check_ref: "skill",
    opponent_check_ref: "target",
    candidate_ref: "target",
    outcome: "outcome",
    loss_failure: "san_loss",
    loss_success: "san_loss",
    involuntary_kind: "involuntary",
    involuntary_summary: "involuntary",
    trigger_ref: "trigger",
    gain_source: "goal",
    insight: "goal",
    request_reality_check: "goal",
    pursuer_refs: "target",
    quarry_refs: "actor",
    location_refs: "goal",
    method: "method",
});
export function noAvailableDecision(intent: string, considered: string[], withheld: Row[]): never {
    const unmet = new Map(withheld.map(value => [value.decision_ref, array(value.unmet)]));
    const explanation = [...unmet].filter(([, rows]) => rows.length).map(([ref, rows]) => `${semanticName(ref)}: ` + rows.map(value => `${value.path} is ${repr(value.actual)}, needs ${value.requirement}`).join(", ")).join("; ");
    const missingNpcCondition = [...unmet.values()].flat().some(value => typeof value.path === 'string' && value.path.startsWith('actor.conditions.'));
    throw new RpcError("needs", `no rule decision is available for intent ${repr(intent)} in the current state${explanation ? ` (${explanation})` : ""}`, {
        fix: missingNpcCondition
            ? "if the fiction already established the missing condition on an NPC, record it first with apply npc {name: <the NPC name>, conditions: {gained: [<condition>]}, why: <what established it>}, then resolve again; otherwise change action.intent, name action.decision, or establish the missing state without inventing it"
            : "change action.intent, name action.decision, or resolve the state the unmet conditions describe",
        details: {
            needs: {
                field: "intent",
                options: ["investigate", "social", "move", "cast", "idle"]
            },
            considered: considered.map(semanticName),
            unmet: Object.fromEntries(unmet)
        },
    });
}
export function selectAvailableDecision(cards: Row[], routed: string[], options: {
    explicit?: boolean;
    intent?: string;
    withheld?: Row[];
    director?: {
        beat: string | null;
        grounded: string[];
    };
} = {}): {
    card: Row;
    decision_source?: "director";
} {
    let available = new Map(cards.map(card => [card.decision_ref, card]));
    if (!available.size)
        return noAvailableDecision(options.intent ?? "none", routed, options.withheld ?? []);
    let source: "director" | undefined;
    if (available.size > 1 && !options.explicit) {
        const beat = options.director?.beat ?? null,
            grounded = options.director?.grounded ?? [];
        const narrowed = sorted(available.keys()).filter(ref => grounded.includes(ref));
        if (narrowed.length === 1) {
            source = "director";
            available = new Map([[narrowed[0], available.get(narrowed[0])!]]);
        }
        else {
            const listed = narrowed.length ? narrowed : sorted(available.keys());
            let fix = "set action.decision to one of details.candidates[].name and call resolve again";
            if (narrowed.length)
                fix = `the Director beat ${string(beat)} grounds ${narrowed.length} of these; ` + fix;
            throw new RpcError("needs_choice", "several rule decisions fit this action; pick one", {
                fix,
                details: {
                    candidates: listed.map(ref => ({
                        name: available.get(ref)!.name,
                        when: available.get(ref)!.label
                    })),
                    ...(narrowed.length ? { narrowed_by: beat } : {})
                },
            });
        }
    }
    const ref = available.size === 1 ? sorted(available.keys())[0] : routed[0],
        card = available.get(ref);
    if (!card) {
        const error = new Error(repr(ref));
        error.name = "KeyError";
        throw error;
    }
    return {
        card,
        ...(source ? { decision_source: source } : {})
    };
}
export function throwPlanningFailure(envelope: Row, chosen: Row): never {
    const failure = row(envelope.failure),
        code = string(failure.code || envelope.status || "internal"),
        message = string(failure.message || code);
    if (code === "missing_semantic_input") {
        const fields = sorted(new Set(array(failure.missing).map(value => SLOT_TO_ACTION[string(value)] ?? string(value))));
        throw new RpcError("needs", `${chosen.name} needs ${fields.join(", ")}`, {
            fix: fields.length ? `fill action.${fields[0]} and call resolve again` : message,
            details: {
                needs: {
                    field: fields[0] ?? "action",
                    options: []
                },
                decision: chosen.name
            },
        });
    }
    if (code === "rule_decision_not_applicable")
        throw new RpcError("turn_state", `${chosen.name} does not apply right now: ${message}`, { details: {
                decision: chosen.name,
                unmet: failure.unmet ?? null
            } });
    if (["invalid_semantic_input", "locked_input_override"].includes(code)) {
        const fields = sorted(new Set((truth(failure.fields) ? array(failure.fields) : array(failure.missing)).map(value => SLOT_TO_ACTION[string(value)] ?? string(value))));
        throw new RpcError("invalid_params", `${chosen.name}: ${message}`, { details: {
                fields,
                decision: chosen.name
            } });
    }
    if (["optional_rule_disabled", "rule_conflict"].includes(code))
        throw new RpcError("turn_state", message, { details: {
                decision: chosen.name,
                optional_rule: envelope.optional_rule ?? null
            } });
    throw new RpcError("internal", `${chosen.name} could not settle (${code}): ${message}`, { details: failure });
}
