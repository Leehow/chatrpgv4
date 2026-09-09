/** Compile/grant boundary shared by fixed settlement families. */
import { isJsonObject } from '../json.js';
import { RuleGraph } from '../rules/graph.js';
import { array, clone, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
import { SettleContext, type ExecutionResult } from './context.js';
import { BASIC_EXECUTORS } from './basic.js';
import type { FixedFamilyBinding } from './families.js';
import { COMBINED, LUCK, LUCK_ROLL, OBSERVE, ORDINARY, PUSH, REALIZE, SOCIAL, executorArgs, hostLocked } from './bindings.js';
export interface SettlementPort {
    execute(plan: Row, selected: Row): Promise<ExecutionResult>;
    beforeExecute?(): Promise<void>;
}
export async function settleFamily(context: SettleContext, runtime: RuleGraph, selected: Row, grant: Row | null, family: FixedFamilyBinding, beforeExecute: () => Promise<void>): Promise<Row> {
    const envelope = compileSettlement(runtime,selected,context.callId,grant,await family.locked(context,runtime,selected,grant));
    if(envelope.status !== 'compiled')return envelope;
    const plan = envelope.settlement.plan, args=family.args(context,plan,selected);
    await beforeExecute();
    const result=await family.execute(context,args,plan);
    await context.prepareFacts();
    envelope.next_decisions=runtime.continuationCards(plan,context.callId);
    Object.assign(envelope,{status:'settled',settlement:{existing_result_envelope:true,execution:'canonical-resolver-subsystem',plan,result:clone(result.data)}});
    if(result.warnings.length)envelope.warnings=result.warnings;
    if(result.hints.length)envelope.hints=result.hints;
    return envelope;
}
export function failureEnvelope(runtime: RuleGraph, ref: string, id: string, code: string, message: string, details: Row = {}): Row {
    return {
        schema_version: 1,
        decision_ref: ref,
        decision_id: id,
        family: runtime.familyOf(ref),
        status: code,
        failure: {
            code,
            message,
            ...details
        }
    };
}
/** No receipt, RNG draw or state write is permitted before this boundary passes. */
export function compileSettlement(runtime: RuleGraph, selected: Row, id: string, grant: Row | null, locked: Row = {}): Row {
    if (!isJsonObject(selected))
        return {
            schema_version: 1,
            status: 'invalid_decision_selection',
            failure: {
                code: 'invalid_decision_selection',
                message: 'selected decision must be an object'
            }
        };
    const ref = selected.decision_ref;
    if (typeof ref !== 'string' || !ref)
        return {
            schema_version: 1,
            status: 'no_candidate_in_compiled_scope',
            failure: {
                code: 'no_candidate_in_compiled_scope',
                message: 'a semantic decision_ref is required'
            }
        };
    const fail = (code: string, message: string, details: Row = {}) => failureEnvelope(runtime, ref, id, code, message, details);
    if (['decision:coc7:combat:context', 'decision:coc7:sanity:context'].includes(ref))
        return fail('no_candidate_in_compiled_scope', `decision ${repr(ref)} is a context-only lookup`);
    if (runtime.nodes.has(ref) && runtime.nodes.get(ref)!.node_kind !== 'decision')
        return fail('no_candidate_in_compiled_scope', `decision ${repr(ref)} is an uncompiled exception scope`);
    const gate = runtime.optionalRuleGate(ref);
    if (gate)
        return {
            ...fail(gate.conflict ? 'rule_conflict' : 'optional_rule_disabled', `decision ${repr(ref)} belongs to optional rule ${repr(gate.option_id)}`),
            optional_rule: gate
        };
    const facts = runtime.factsForDecision(selected);
    const [active, unevaluated] = runtime.surfaceExceptions(ref, facts);
    if (active.length)
        return {
            ...fail('no_candidate_in_compiled_scope', 'a recorded uncompiled exception matches the live situation', {
                active_exceptions: active
            }),
            active_exceptions: active,
            unevaluated_exceptions: unevaluated
        };
    const stale = runtime.checkCardGrant(grant, ref);
    if (stale)
        return {
            ...stale,
            decision_id: id
        };
    const semantic = row(selected.semantic_inputs);
    const names = new Set(runtime.slotsFor(ref).filter(slot => ['host-locked', 'resolver-owned'].includes(slot.ownership)).map(slot => slot.name));
    const overlap = Object.keys(semantic).filter(key => names.has(key)).sort();
    if (overlap.length)
        return fail('locked_input_override', 'model-supplied host-locked inputs are rejected', {
            fields: overlap
        });
    const compiled = runtime.compilePlan(ref, semantic, facts, locked);
    if (compiled.failure != null)
        return {
            schema_version: 1,
            decision_ref: ref,
            decision_id: id,
            family: compiled.failure.family || runtime.familyOf(ref),
            status: compiled.failure.code,
            failure: compiled.failure
        };
    const plan = compiled.plan;
    return {
        schema_version: 1,
        decision_ref: ref,
        decision_id: id,
        family: plan.family,
        status: 'compiled',
        rule_refs: [...plan.rule_refs],
        settlement: {
            existing_result_envelope: false,
            execution: 'deferred',
            plan
        },
        next_decisions: [],
        authority: 'canonical-resolver-state-receipts'
    };
}
export function continuationsAfterCheck(runtime: RuleGraph, selected: Row, data: Row, id: string): string[] {
    if (data.outcome !== 'failure')
        return [];
    const refs = data.push_eligible !== false ? [PUSH, LUCK] : [LUCK];
    const withSource = {
        ...selected,
        _host_source_receipt: clone(data)
    };
    const cards = refs.filter(ref => runtime.nodes.has(ref)).map(ref => runtime.card(ref, runtime.factsForDecision(withSource))).filter(card => card.applicability === 'applicable');
    if (cards.length)
        runtime.issueCardGrant(cards, id);
    return cards.map(card => string(card.decision_ref));
}
function ordinaryProvenance(payload: Row): Row | null {
    if (!string(payload.skill || '').trim() && !string(payload.characteristic || '').trim() && !truth(payload.combined_targets))
        return {
            code: 'invalid_semantic_input',
            message: 'ordinary check requires skill or characteristic',
            missing: ['skill']
        };
    if (!['regular', 'hard', 'extreme'].includes(string(payload.difficulty || '').trim()))
        return {
            code: 'invalid_semantic_input',
            message: 'difficulty must be regular, hard, or extreme',
            fields: ['difficulty']
        };
    if (typeof payload.goal !== 'string' || !payload.goal.trim())
        return {
            code: 'invalid_semantic_input',
            message: 'goal must be a non-empty string',
            fields: ['goal']
        };
    if (!isJsonObject(payload.stakes))
        return {
            code: 'invalid_semantic_input',
            message: 'stakes must be {on_success, on_failure}',
            fields: ['stakes']
        };
    return null;
}
function socialProvenance(payload: Row): Row | null {
    if (!['support', 'neutral', 'oppose'].includes(string(payload.motive_direction || '')))
        return {
            code: 'invalid_semantic_input',
            message: 'motive_direction must be support|neutral|oppose',
            fields: ['motive_direction']
        };
    if (!integer(payload.motive_intensity) || ![0, 1, 2].includes(number(payload.motive_intensity)))
        return {
            code: 'invalid_semantic_input',
            message: 'motive_intensity must be 0, 1, or 2',
            fields: ['motive_intensity']
        };
    if (number(payload.motive_intensity) > 0 && !array(payload.motive_evidence).length)
        return {
            code: 'invalid_semantic_input',
            message: 'motive.intensity > 0 requires motive evidence',
            fields: ['motive_evidence'],
            missing: ['motive_evidence']
        };
    if (payload.supporting_action != null) {
        if (!isJsonObject(payload.supporting_action))
            return {
                code: 'invalid_semantic_input',
                message: 'supporting_action must be an object',
                fields: ['supporting_action']
            };
        const level = payload.supporting_action.level ?? 0;
        if (!integer(level) || ![0, 1].includes(number(level)))
            return {
                code: 'invalid_semantic_input',
                message: 'supporting_action.level must be 0 or 1',
                fields: ['supporting_action']
            };
    }
    return null;
}
export function socialBoundPlan(plan: Row, adjudication: Row): Row {
    const goal = string(row(row(plan.command).payload).goal || '').trim();
    const payload = {
        skill: string(adjudication.approach_skill || ''),
        difficulty: string(adjudication.final_difficulty || 'regular'),
        bonus: number(adjudication.bonus_dice),
        penalty: number(adjudication.penalty_dice),
        difficulty_basis: 'opponent_skill',
        goal,
        stakes: {
            on_success: `the described social action achieves its declared goal: ${goal}`,
            on_failure: `the described social action does not achieve its declared goal: ${goal}`
        },
        npc_id: adjudication.npc_id ?? null,
        social_adjudication_ref: adjudication.goal_key ?? null
    };
    return {
        schema_version: 1,
        decision_ref: plan.decision_ref,
        family: plan.family,
        capability: {
            ref: 'capability:coc7:check',
            adapter: 'resolver',
            resolver_capability: 'check'
        },
        command: {
            kind: 'check',
            phase: 'resolve',
            payload
        },
        rule_refs: [...array(plan.rule_refs)],
        source_refs: [...array(plan.source_refs)],
        resource_effects: [],
        visibility: 'keeper-only',
        pending_choices: [],
        next_decisions: [],
        machine_derived: true
    };
}
export async function settleBasic(context: SettleContext, runtime: RuleGraph, selected: Row, grant: Row | null, beforeExecute?: () => Promise<void>): Promise<Row> {
    const locked = await hostLocked(context, runtime, selected, grant);
    const envelope = compileSettlement(runtime, selected, context.callId, grant, locked);
    if (envelope.status !== 'compiled')
        return envelope;
    const ref = string(selected.decision_ref);
    const plan = envelope.settlement.plan;
    const payload = row(row(plan.command).payload);
    const fail = (code: string, message: string, details: Row = {}) => failureEnvelope(runtime, ref, context.callId, code, message, details);
    const provenance = [ORDINARY, COMBINED].includes(ref) ? ordinaryProvenance(payload) : ref === SOCIAL ? socialProvenance(payload) : null;
    if (provenance) {
        const { code, message, ...details } = provenance;
        return fail(code, message, details);
    }
    if (ref === PUSH) {
        const method = string(payload.method_changed || '').trim();
        const consequence = string(payload.failure_consequence || '').trim();
        const original = payload.canonical_roll_receipt;
        const id = string(payload.original_check_decision_id || '').trim();
        if (!method || !consequence)
            return fail('invalid_semantic_input', 'pushed roll requires method_changed and failure_consequence locked before the roll', {
                missing: [['method_changed', method], ['failure_consequence', consequence]].filter(([, value]) => !value).map(([name]) => name)
            });
        if (payload.player_confirmed_risk !== true)
            return fail('invalid_semantic_input', 'pushed roll requires player_confirmed_risk=true after the Keeper announces the failure consequence', {
                fields: ['player_confirmed_risk']
            });
        if (!id || !isJsonObject(original))
            return fail('rule_decision_not_applicable', 'pushed roll requires a frozen failed non-pushed ordinary check');
        if (truth(original.pushed) || truth(original.luck_roll))
            return fail('rule_decision_not_applicable', 'only a failed non-pushed ordinary check may be pushed');
        if (original.outcome === 'fumble')
            return fail('rule_decision_not_applicable', 'a fumble cannot be pushed; it is final');
        if (original.outcome !== 'failure')
            return fail('rule_decision_not_applicable', 'only an ordinary failed original check may be pushed');
        if (context.receiptContinued(id))
            return fail('rule_decision_not_applicable', 'push or spend Luck, but not both');
    }
    if (ref === LUCK) {
        if (!integer(payload.points) || number(payload.points) <= 0)
            return fail('invalid_semantic_input', 'points must be a positive integer', {
                fields: ['points']
            });
        if (!string(payload.source_roll_id || '').trim())
            return fail('invalid_semantic_input', 'source_roll_id is host-locked from the original receipt', {
                missing: ['source_roll_id']
            });
        const original = payload.canonical_roll_receipt;
        const id = string(payload.original_check_decision_id || '').trim();
        if (isJsonObject(original)) {
            if (truth(original.luck_roll) || string(original.skill || '').toUpperCase() === 'LUCK')
                return fail('rule_decision_not_applicable', 'Luck may not be spent on Luck rolls');
            if (truth(original.pushed))
                return fail('rule_decision_not_applicable', 'Luck may not alter a pushed roll');
            if (id && context.receiptContinued(id))
                return fail('rule_decision_not_applicable', 'push or spend Luck, but not both');
        }
    }
    const args = executorArgs(context, plan, selected);
    if (beforeExecute)
        await beforeExecute();
    const execute = (chosen: Row, input = executorArgs(context, chosen, selected)) => BASIC_EXECUTORS[string(row(chosen.capability).resolver_capability)](context, input, chosen);
    const executed = await execute(plan, args);
    const data = executed.data;
    let result: Row = data;
    let warnings = executed.warnings;
    let hints = executed.hints;
    let extra: Row = {};
    if ([ORDINARY, COMBINED].includes(ref)) {
        result = {
            bound_check: clone(data),
            outcome: string(data.outcome || ''),
            pushed: false
        };
        if (data.outcome === 'failure') {
            result.next_continuations = continuationsAfterCheck(runtime, selected, data, context.callId);
            hints = [...hints, data.push_eligible !== false ? 'ordinary failure: the player may push this roll with a changed method and an announced consequence, or spend Luck; not both' : 'ordinary failure: this check cannot be pushed; the player may spend Luck instead'];
        }
        else {
            result.next_continuations = [];
            if (data.outcome === 'fumble')
                hints = [...hints, 'a fumble cannot be pushed or bought off with Luck'];
        }
        extra.visibility = 'public';
    }
    else if (ref === LUCK_ROLL) {
        result = {
            bound_check: clone(data),
            outcome: string(data.outcome || ''),
            luck_roll: true,
            next_continuations: []
        };
        hints = [...hints, 'Luck may not be spent on Luck rolls (luck.json constraints)'];
        extra.visibility = 'public';
    }
    else if (ref === PUSH) {
        result = {
            bound_check: clone(data),
            outcome: string(data.outcome || ''),
            pushed: true,
            original_check_decision_id: string(payload.original_check_decision_id || '').trim(),
            failure_consequence: string(payload.failure_consequence || '').trim(),
            method_changed: string(payload.method_changed || '').trim(),
            player_confirmed_risk: true,
            next_continuations: []
        };
        hints = [...hints, 'the recorded failure_consequence is authoritative; apply it if the pushed roll fails'];
        extra.visibility = 'public';
    }
    else if (ref === LUCK) {
        result = {
            luck_spend: clone(data),
            source_roll_id: string(payload.source_roll_id || '').trim(),
            points: payload.points,
            resource_key: 'luck',
            outcome: string(data.outcome || ''),
            next_continuations: []
        };
        extra.visibility = 'public';
    }
    else if (ref === SOCIAL) {
        if (!Object.hasOwn(data, 'feasibility'))
            return fail('invalid_settlement_result', 'bound adjudication must return feasibility');
        result = {
            adjudication: clone(data)
        };
        const feasibility = string(data.feasibility || '');
        if (feasibility === 'roll') {
            const derived = socialBoundPlan(plan, data);
            const bound = await execute(derived);
            warnings = [...warnings, ...bound.warnings];
            hints = [...hints, ...bound.hints];
            Object.assign(result, {
                bound_check: clone(bound.data),
                bound_check_plan: derived,
                outcome: string(bound.data.outcome || ''),
                next_continuations: continuationsAfterCheck(runtime, selected, bound.data, context.callId)
            });
        }
        else {
            hints = [...hints, `feasibility is ${feasibility}: no bound roll is settled`];
            if (feasibility === 'automatic')
                hints.push('automatic success — play the compliance in fiction');
            else if (feasibility === 'conditional')
                hints.push('the goal cannot be settled by a roll now; pursue the recorded requirements or change approach/target');
            result.outcome = feasibility;
            result.next_continuations = [];
        }
        extra.visibility = 'keeper-only';
    }
    else if (ref === OBSERVE) {
        const ceiling = [data.inference_depth, data.inference_ceiling].find(value => typeof value === 'string' && value);
        if (!ceiling || typeof data.insight_id !== 'string' || !data.insight_id)
            return fail('invalid_settlement_result', 'concealed observation result lacks durable insight identity or inference ceiling');
        const continuation = runtime.card(REALIZE, runtime.factsForDecision(selected));
        if (continuation.applicability === 'applicable')
            runtime.issueCardGrant([continuation], context.callId);
        hints = [...hints, "the roll and outcome are keeper-concealed: the player sees only the realization's external_behavior; do not expose the die"];
        extra.visibility = 'concealed-result';
    }
    else if (ref === REALIZE) {
        if (!isJsonObject(data.player_projection))
            return fail('concealed_projection_violation', 'realization has no player_projection; concealed dice/outcome must never surface publicly');
        const leaked = Object.keys(data.player_projection).filter(key => key !== 'external_behavior').sort();
        if (leaked.length)
            return fail('concealed_projection_violation', 'player-safe realization leaked concealed fields', {
                leaked
            });
        extra = {
            visibility: 'public',
            player_projection: {
                external_behavior: data.player_projection.external_behavior ?? null
            },
            concealed_result: row(data.concealed_result)
        };
    }
    else
        envelope.next_decisions = runtime.continuationCards(plan, context.callId);
    Object.assign(envelope, {
        status: 'settled',
        settlement: {
            existing_result_envelope: true,
            execution: 'canonical-resolver-subsystem',
            plan,
            result: clone(result)
        },
        ...extra
    });
    if (warnings.length)
        envelope.warnings = warnings;
    if (hints.length)
        envelope.hints = hints;
    return envelope;
}
