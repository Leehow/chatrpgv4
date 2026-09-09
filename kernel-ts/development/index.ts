/** Fixed development bindings in the shared resolve pipeline. */
import { RpcError } from '../errors.js';
import { compareUnicode } from '../json.js';
import { campaignEffectiveOptionalRules, gateFor, gateMessage } from '../rules/options.js';
import type { FixedFamilyBinding } from '../resolve/families.js';
import type { SettleContext, SettlementExecutor } from '../resolve/context.js';
import { unsupportedValue } from '../resolve/pipeline.js';
import { array, clone, entries, equal, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { ENDING_KINDS, endingIdForEvent } from './plan.js';
import { buildEndingCapsule, capsuleForCampaignEnding, loadEndingCapsule, pendingSettlements, persistEndingCapsule, runDevelopmentPhase } from './state.js';
export { stageEnding, type EndingStage } from './ending.js';
export { deterministicDevelopmentPlan, sanityBaseline, endingIdForEvent, endingEventId } from './plan.js';
export { buildEndingCapsule, pendingSettlements, listEndings, loadEndingCapsule, persistEndingCapsule, runDevelopmentPhase, capsuleForCampaignEnding } from './state.js';
export const END_SESSION = 'decision:coc7:development:end-session';
export const SETTLE_ENDING = 'decision:coc7:development:settle-ending';
async function luckRecoveryGate(context: SettleContext): Promise<Row | null> {
    const manifest = context.observations.packageManifest;
    const effective = await campaignEffectiveOptionalRules(context.snapshot, manifest);
    const gate = gateFor(manifest, effective, {
        settlement: 'development.luck_recovery'
    });
    if (gate && truth(gate.conflict))
        throw new RpcError('campaign_not_ready', gateMessage(gate));
    return gate;
}
function settlementEffects(context: SettleContext, investigator: string, before: Row, sheet: Row, receipt: Row): void {
    if (!equal(sheet.current_luck ?? null, before.current_luck ?? null))
        context.addDelta('luck', investigator, before.current_luck ?? null, sheet.current_luck ?? null);
    if (!equal(sheet.current_san ?? null, before.current_san ?? null))
        context.addDelta('san', investigator, before.current_san ?? null, sheet.current_san ?? null);
    for (const value of array(receipt.skills_improved))
        context.addEffect('skill', investigator, value.current_value_before_apply ?? null, value.value_after ?? null, {
            skill: value.skill ?? null
        });
}
export const executeEndSession: SettlementExecutor = async (context, args) => {
    const campaign = context.transaction.campaign;
    const kind = string(args.kind || 'conclusion');
    if (!ENDING_KINDS.includes(kind))
        unsupportedValue('kind', kind, ENDING_KINDS, `unknown session ending kind ${repr(kind)}`);
    const sheets = new Map(context.party().map(sheet => [string(sheet.id), sheet]));
    const record: Row = {
        event_type: 'session_ending',
        scene_id: context.activeScene,
        kind,
        decision_id: context.callId,
        investigator_ids: [...sheets.keys()].sort(compareUnicode),
        summary: truth(args.summary) ? args.summary : null,
        scenario_san_reward_expr: args.scenario_san_reward_expr ?? null
    };
    let capsule: Row | null = null;
    const closure = row(context.world.ending);
    if ((await campaign.readCampaign()).status === 'completed' || closure.scope === 'chapter' && !truth(closure.continued)) {
        const turn = closure.turn;
        if (!integer(turn))
            throw new RpcError('campaign_not_ready', 'the completed campaign has no original ending turn to bind accounting');
        capsule = await capsuleForCampaignEnding(campaign, number(turn));
        Object.assign(record, {
            ending_id: `ending-campaign-turn-${turn}`,
            campaign_ending_turn: turn
        });
        if (!capsule && (await pendingSettlements(campaign)).length)
            throw new RpcError('needs', 'an earlier development settlement is still pending', {
                fix: 'resolve development:settle-ending before creating final accounting'
            });
    }
    let ending = endingIdForEvent(record);
    capsule = capsule || await loadEndingCapsule(campaign, ending);
    if (capsule && args.scenario_san_reward_expr != null && !equal(args.scenario_san_reward_expr, capsule.scenario_san_reward_expr ?? null))
        throw new RpcError('idempotency_conflict', "this ending's source reward expression is already frozen", {
            fix: 'reuse the original accounting without replacing its reward expression'
        });
    if (!capsule) {
        try {
            capsule = await buildEndingCapsule(context.tables, campaign, record, Object.fromEntries(sheets), {
                luckRecoveryGate: await luckRecoveryGate(context),
                capturedAt: nowIso()
            });
        }
        catch (error) {
            if ((error as Error).name !== 'ValueError')
                throw error;
            throw new RpcError('invalid_params', (error as Error).message, {
                fix: 'use the exact source-authored reward expression supported by the existing dice engine'
            });
        }
        await persistEndingCapsule(campaign, capsule);
    }
    ending = capsule.ending_id;
    const settlements: Row[] = [];
    for (const id of array(capsule.investigator_ids)) {
        const sheet = sheets.get(id);
        if (!sheet) {
            const error = new Error(repr(id));
            error.name = 'KeyError';
            throw error;
        }
        const before = {
            current_luck: sheet.current_luck ?? null,
            current_san: sheet.current_san ?? null
        };
        const receipt = await runDevelopmentPhase(context.tables, campaign, id, sheet, capsule);
        await context.writeSheet(sheet);
        if (!truth(receipt.replayed))
            settlementEffects(context, id, before, sheet, receipt);
        settlements.push({
            investigator_id: id,
            status: 'PASS',
            receipt
        });
    }
    return {
        data: {
            session_ending: true,
            scene_id: capsule.scene_id,
            kind: capsule.kind,
            summary: capsule.summary,
            investigator_ids: capsule.investigator_ids,
            ending_id: ending,
            development: {
                status: 'PASS',
                ending_id: ending,
                settlements
            },
            outcome: settlements.every(value => truth(value.receipt.replayed)) ? 'replayed' : 'settled'
        },
        warnings: [],
        hints: ['the session ending is durable; development has been settled for every investigator']
    };
};
export const executeDevelopmentSettle: SettlementExecutor = async (context, args) => {
    const campaign = context.transaction.campaign;
    let ending = string(args.ending_id || '');
    if (!ending) {
        const pending = (await pendingSettlements(campaign)).filter(([, investigator]) => investigator === context.actorId).map(([id]) => id);
        if (!pending.length)
            throw new RpcError('turn_state', 'no ending awaits development settlement for this investigator', {
                fix: 'end the session first (decision development:end-session)'
            });
        ending = pending.at(-1)!;
    }
    const capsule = await loadEndingCapsule(campaign, ending);
    if (!capsule)
        throw new RpcError('unknown_entity', `no ending ${repr(ending)} is recorded`, {
            details: {
                query: ending,
                candidates: []
            }
        });
    const sheet = context.actor;
    const before = {
        current_luck: sheet.current_luck ?? null,
        current_san: sheet.current_san ?? null
    };
    const receipt = await runDevelopmentPhase(context.tables, campaign, context.actorId, sheet, capsule);
    await context.writeSheet(sheet);
    if (!truth(receipt.replayed))
        settlementEffects(context, context.actorId, before, sheet, receipt);
    return {
        data: {
            ending_id: ending,
            investigator_id: context.actorId,
            receipt,
            outcome: truth(receipt.replayed) ? 'replayed' : 'settled'
        },
        warnings: [],
        hints: ['development settlement is complete and safe to report']
    };
};
export function createDevelopmentFamily(): FixedFamilyBinding {
    return {
        matches: (ref, capability) => ref === END_SESSION && capability === 'state.end_session' || ref === SETTLE_ENDING && capability === 'development.settle',
        async slots(ref, context) {
            const semantic: Row = {};
            const binding: Row = {
                investigator: context.actorId,
                decision_id: context.callId
            };
            if (ref === END_SESSION) {
                if (typeof context.action.goal === 'string' && context.action.goal)
                    semantic.summary = context.action.goal;
                semantic.kind = string(context.action.ending || 'conclusion');
                if (context.action.scenario_san_reward_expr != null)
                    semantic.scenario_san_reward_expr = context.action.scenario_san_reward_expr;
            }
            else if (ref === SETTLE_ENDING) {
                const pending = (await pendingSettlements(context.transaction.campaign)).filter(([, investigator]) => investigator === context.actorId).map(([id]) => id);
                if (pending.length)
                    binding.ending_id = pending.at(-1);
            }
            return {
                semantic,
                extras: {
                    _host_family_binding: binding
                }
            };
        },
        async locked(_context, runtime, selected) {
            const binding = row(selected._host_family_binding);
            const declared = runtime.declaredPayloadSlots(string(selected.decision_ref));
            return Object.fromEntries(entries(binding).filter(([key, value]) => value != null && declared.has(key)).map(([key, value]) => [key, clone(value)]));
        },
        args(context, plan) {
            const payload = row(row(plan.command).payload);
            const output: Row = {
                investigator: context.actorId,
                decision_id: context.callId
            };
            if (row(plan.capability).resolver_capability === 'state.end_session') {
                output.summary = payload.summary ?? null;
                output.kind = payload.kind ?? null;
                if (payload.scenario_san_reward_expr != null)
                    output.scenario_san_reward_expr = payload.scenario_san_reward_expr;
            }
            else if (payload.ending_id != null)
                output.ending_id = payload.ending_id;
            return output;
        },
        async execute(context, args, plan) {
            const capability = row(plan.capability).resolver_capability;
            if (capability === 'state.end_session')
                return executeEndSession(context, args, plan);
            if (capability === 'development.settle')
                return executeDevelopmentSettle(context, args, plan);
            throw new RpcError('not_implemented', `Development does not own capability ${repr(capability)}`);
        },
        outcome(_context, _ref, result) {
            const receipts = array(row(result.development).settlements).map(value => value.receipt);
            const receipt = row(receipts.length ? receipts[0] : result.receipt);
            return {
                kind: 'development',
                status: result.outcome || 'settled',
                ending_id: result.ending_id ?? null,
                ending_kind: result.kind ?? null,
                skills_improved: array(receipt.skills_improved).map(value => ({
                    skill: value.skill ?? null,
                    before: value.current_value_before_apply ?? null,
                    after: value.value_after ?? null
                })),
                luck_recovery: receipt.luck_recovery ?? null,
                san_before: receipt.san_before ?? null,
                san_after: receipt.san_after ?? null,
                scenario_san_reward_roll: receipt.scenario_san_reward_roll ?? null,
                scenario_san_reward_planned_delta: receipt.scenario_san_reward_planned_delta ?? null
            };
        },
    };
}
