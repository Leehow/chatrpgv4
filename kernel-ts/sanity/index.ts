/** The fixed SAN family uses the common selection, transaction and receipt pipeline. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { mirrorInvestigator } from '../healing/resources.js';
import { recordOf } from '../read/module-graph.js';
import { boutActive } from '../read/session-view.js';
import { array, clone, entries, integer, repr, row, string, truth, type Row } from '../read/values.js';
import { rollExpression, SUCCESS_OUTCOMES } from '../resolve/arithmetic.js';
import type { ExecutionResult, SettleContext, SettlementExecutor } from '../resolve/context.js';
import type { FixedFamilyBinding } from '../resolve/families.js';
import { unsupportedValue } from '../resolve/pipeline.js';
import { recordDice, recordPercentile } from '../resolve/session-receipts.js';
import { parseSanLoss, sanityInt as int, validateSanLossExpression } from './expression.js';
import { INVOLUNTARY_KINDS, SanitySession, sanityGainPendingName } from './session.js';

export { SanitySession, sanitySnapshotName, sanityGainPendingName, rebaseSanityClock, writeSanityGainPending, recordPsychoanalysisGainPending } from './session.js';
export { PsychotherapySession } from './treatment.js';
export { parseSanLoss, validateSanLossExpression } from './expression.js';
const PREFIX = 'decision:coc7:sanity:';
const COMMANDS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
    check: ['sanity_check', 'sanity.execute'], 'bout-tick': ['bout_tick', 'sanity.execute'], 'bout-end': ['bout_end', 'sanity.execute'],
    'reality-check': ['reality_check', 'sanity.session.reality_check'], 'gain-current-san': ['gain_current_san', 'sanity.session.gain_san'],
    'insane-insight': ['insane_insight', 'sanity.context'], 'apply-treatment': ['apply_psychoanalysis_treatment', 'time.apply_psychoanalysis_treatment'],
    'recover-temporary': ['recover_temporary_insanity', 'time.recover_temporary_insanity'],
});
const text = (value: any): string => typeof value === 'string' ? value : '';
const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
const turnState = (message: string, fix?: string): never => { throw new RpcError('turn_state', message, { fix }); };

export function recordSanityRolls(context: SettleContext, session: SanitySession, extra: Row = {}): string[] {
    const ids: string[] = [];
    for (const record of session.drainPending()) {
        if (!isJsonObject(record)) continue;
        const skill = string(record.skill || '');
        if (skill === 'SAN') {
            ids.push(recordPercentile(context, record, 'sanity_check', extra));
            if (Array.isArray(record.san_loss_rolls) && record.san_loss_rolls.length)
                ids.push(context.addDiceRoll({ actor: string(record.actor_id), label: 'SAN Loss', expression: record.san_loss_expression ?? null,
                    faces: record.san_loss_rolls.map(int), total: record.san_loss ?? null }));
        }
        else if (skill === 'INT') ids.push(recordPercentile(context, record, 'sanity_int_check', extra));
        else if (Object.hasOwn(record, 'die_expression') || record.die != null) ids.push(recordDice(context, record));
    }
    return ids;
}
export async function finishSanity(context: SettleContext, session: SanitySession, before: number, data: Row, hints: string[], wasBout: boolean): Promise<ExecutionResult> {
    await session.save(context);
    const state = session.state, after = int(state.san_current);
    if (after !== before) context.addDelta('san', context.actorId, before, after);
    await mirrorInvestigator(context, session.investigatorId, { currentSan: after });
    if (state.bout_active && !wasBout) {
        const bout = row(state.bouts_of_madness.at(-1)), result = string(bout.bout_result || bout.bout_kind || ''), rounds = bout.duration_rounds ?? null;
        context.addSessionReceipt('sanity_bout', 'start', { outcome: result || null, summary: result && rounds !== null ? `${result} (${rounds} rounds)` : result || null,
            rounds: integer(rounds) ? rounds : null });
    }
    else if (wasBout && !state.bout_active) context.addSessionReceipt('sanity_bout', 'end');
    const view = context.sessions();
    Object.assign(data, { investigator_id: context.actorId, san_before: before, san_after: after, temporary_insane: truth(state.temporary_insane),
        indefinite_insane: truth(state.indefinite_insane), permanently_insane: truth(state.permanently_insane), bout_active: truth(state.bout_active),
        bout_rounds_remaining: int(state.bout_rounds_remaining), session: state.bout_active || wasBout ? view.boutView(context.actorId) : null,
        pending_choice: view.pendingChoice() });
    if (state.bout_active) hints.push('a bout of madness is running: the Keeper controls the investigator; advance it with sanity:bout-tick or end it with sanity:bout-end; no SAN can be lost meanwhile (p.157)');
    else if (state.temporary_insane || state.indefinite_insane) hints.push('underlying insanity: any further SAN loss of 1+ triggers another bout (p.158)');
    if (state.permanently_insane) hints.push('SAN reached 0: permanent insanity — this investigator is lost to the Mythos');
    return { data, warnings: [], hints };
}
export const executeSanity: SettlementExecutor = async (context, args, plan) => {
    const command = row(args.command), payload = row(command.payload), kind = string(command.kind || ''), capability = row(plan.capability).resolver_capability;
    if (capability === 'sanity.session.gain_san') {
        const amount = payload.san_gain;
        if (!integer(amount) || amount <= 0) turnState('no host SAN-gain receipt is pending for this investigator');
        const source = string(payload.gain_source || '').trim();
        if (!source) throw new RpcError('needs', 'the SAN gain needs its source', { fix: 'put it in action.goal', details: { needs: { field: 'goal', options: [] } } });
        const session = await SanitySession.load(context), before = int(session.state.san_current);
        session.gainSan(int(amount), source); session.drainPending();
        await context.removeSave(sanityGainPendingName(context.actorId));
        return finishSanity(context, session, before, { command: 'gain_current_san', requested: int(amount), source, san_gain: int(session.state.san_current) - before }, [], truth(session.state.bout_active));
    }
    const session = await SanitySession.load(context), state = session.state, before = int(state.san_current), wasBout = truth(state.bout_active);
    if (capability === 'sanity.context') {
        if (!state.temporary_insane && !state.indefinite_insane) turnState('insane insight applies only while temporary or indefinite insanity is active');
        const insight = string(payload.insight || '').trim();
        if (!insight) throw new RpcError('needs', "the insight needs the Keeper's wording", { fix: 'put it in action.goal', details: { needs: { field: 'goal', options: [] } } });
        return { data: { command: 'insane_insight', insight, insanity_state: state.indefinite_insane ? 'indefinite' : 'temporary', authority: 'keeper-advisory',
            outcome: 'advised', san_before: before, san_after: before, session: null, pending_choice: null }, warnings: [],
            hints: ['advisory only: the Mythos-touched mind glimpses what the sane cannot; no SAN changes'] };
    }
    if (capability === 'sanity.execute') {
        const data: Row = { command: kind };
        if (kind === 'sanity_check') {
            if (state.bout_active) turnState('no SAN is lost during a bout of madness (p.157)', 'advance or end the bout first: sanity:bout-tick / sanity:bout-end');
            if (state.permanently_insane) turnState('the investigator is permanently insane; no further SAN checks', 'narrate the loss; the character is retired');
            const involuntary = string(payload.involuntary_kind || '');
            if (!INVOLUNTARY_KINDS.includes(involuntary)) throw new RpcError('needs', 'a failed SAN roll needs the involuntary action the Keeper decided on (p.166)', {
                fix: 'set action.involuntary to one of details.needs.options (optionally {kind, summary})', details: { needs: { field: 'involuntary', options: [...INVOLUNTARY_KINDS] } } });
            const event = await session.sanityCheck(string(payload.source || 'the unnatural'), field(payload, 'san_loss_success', '0'), string(payload.san_loss_fail_expr || '1'), {
                involuntaryKind: involuntary, involuntarySummary: string(payload.involuntary_summary || ''), alone: truth(payload.alone),
                creatureType: typeof payload.creature_type === 'string' ? payload.creature_type : null });
            if (event.type === 'sanity_check_skipped') turnState(string(row(event.payload).summary || 'SAN check skipped'));
            const ids = recordSanityRolls(context, session, { source: string(payload.source || '') }), result = row(event.payload);
            const sanRoll = ids.length ? row(context.receipts.find(receipt => receipt.id === ids[0])) : {};
            data.check = { skill: 'SAN', target: before, roll: sanRoll.roll ?? null, level: result.roll_outcome ?? null, passed: SUCCESS_OUTCOMES.has(result.roll_outcome),
                san_loss: result.san_loss ?? null, source: result.source ?? null };
            data.involuntary_action = result.involuntary_action ?? null; data.mythos_hardened = result.mythos_hardened ?? null;
        }
        else if (kind === 'bout_tick' || kind === 'bout_end') {
            if (!state.bout_active) turnState('no bout of madness is running', 'nothing to advance');
            if (kind === 'bout_tick') data.bout = session.tickBoutRound();
            else { session.endBout(); data.bout = { bout_active: false, bout_rounds_remaining: 0 }; }
            recordSanityRolls(context, session);
        }
        else unsupportedValue('command.kind', kind, ['sanity_check', 'bout_tick', 'bout_end'], `unknown sanity command ${repr(kind)}`);
        return finishSanity(context, session, before, data, [], wasBout);
    }
    if (capability === 'sanity.session.reality_check') {
        if (!isJsonObject(state.active_delusion)) turnState('the investigator has no active delusion to test');
        if (payload.request_reality_check !== true) throw new RpcError('needs', "a reality check is the player's call", {
            fix: "set action.goal to the player's suspicion", details: { needs: { field: 'goal', options: [] } } });
        const outcome = await session.realityCheck();
        const rollId = context.addRoll({ actor: context.actorId, skill: 'SAN', target: before, difficulty: 'regular', threshold: before,
            roll: int(outcome.roll), level: outcome.success ? 'regular' : 'failure', passed: truth(outcome.success), kind: 'sanity_reality_check', visibility: 'public' });
        recordSanityRolls(context, session);
        return finishSanity(context, session, before, { command: 'reality_check', check: { skill: 'SAN', target: before, roll: outcome.roll, passed: truth(outcome.success), roll_id: rollId },
            delusion_cleared: truth(outcome.success), rule_ref: outcome.rule_ref ?? null }, [], wasBout);
    }
    if (capability === 'time.recover_temporary_insanity') {
        const trigger = state.recovery_trigger;
        if (!state.temporary_insane || !isJsonObject(trigger)) turnState('no temporary insanity awaits recovery');
        if (string(payload.recovery_trigger_ref || trigger.trigger_id) !== string(trigger.trigger_id)) turnState('the recovery trigger is stale', 'look and resolve again');
        const due = int(trigger.due_elapsed_minutes || 0);
        if (context.clockMinutes < due) turnState(`recovery is due at clock ${due}, now ${context.clockMinutes}`, `advance time by ${due - context.clockMinutes} minutes of safe rest first`);
        if (state.bout_active) session.endBout();
        session.recoverTemporary(); session.drainPending();
        return finishSanity(context, session, before, { command: 'recover_temporary_insanity', trigger_id: trigger.trigger_id ?? null, recovered: true },
            ['temporary insanity has passed; underlying phobias or manias remain'], wasBout);
    }
    if (capability === 'time.apply_psychoanalysis_treatment') {
        const trigger = state.treatment_trigger;
        if (!state.indefinite_insane || !isJsonObject(trigger)) turnState('no treatment is due: the investigator is not indefinitely insane');
        const due = int(trigger.due_elapsed_minutes || 0);
        if (context.clockMinutes < due) turnState(`treatment is due at clock ${due}, now ${context.clockMinutes}`, `advance time by ${due - context.clockMinutes} minutes first`);
        const psychoanalysis = row(row(await context.tables.load('treatment')).psychoanalysis), skill = int(payload.psychoanalysis_skill || 1);
        const check = context.arithmetic.check(skill, 'regular', 0, 0, context.rng);
        const rollId = context.addRoll({ actor: context.actorId, skill: 'Psychoanalysis', target: skill, difficulty: 'regular', threshold: check.threshold,
            roll: check.roll, level: check.level, passed: check.passed, kind: 'treatment_check', visibility: 'public' });
        let recovered = 0, setback = 0;
        const level = string(check.outcome), recovery = row(psychoanalysis.success_recovery);
        if (SUCCESS_OUTCOMES.has(level)) {
            const expression = recovery[level === 'critical' ? 'extreme' : level] || recovery.regular || '1D3', rolled = rollExpression(string(expression), context.rng);
            context.addDiceRoll({ actor: context.actorId, label: 'SAN Reward', expression: rolled.expression, faces: rolled.rolls, total: rolled.total });
            recovered = int(rolled.total); session.gainSan(recovered, 'psychoanalysis'); session.drainPending();
        }
        else if (level === 'fumble') {
            await session.applyDirectLoss('psychoanalysis setback', string(row(psychoanalysis.monthly_roll).setback_loss || '1D6'));
            recordSanityRolls(context, session); setback = before - int(state.san_current);
        }
        state.treatment_trigger = null; session.scheduleMonthlyTreatment();
        return finishSanity(context, session, before, { command: 'apply_psychoanalysis_treatment', trigger_id: trigger.trigger_id ?? null, roll_id: rollId,
            check: { skill: 'Psychoanalysis', target: skill, roll: check.roll, level, passed: truth(check.passed) }, san_recovered: recovered, setback, next_trigger: state.treatment_trigger }, [], wasBout);
    }
    throw new RpcError('not_implemented', `Sanity capability ${string(capability)} is not implemented`);
};

/** A typed `sanity_loss` shape (§136.6 shape 3) as the check's pair; null unless both halves are stated strings. */
export function statedSanLoss(shape: any): [string, string] | null {
    if (!isJsonObject(shape) || typeof shape.success !== 'string' || typeof shape.failure !== 'string') return null;
    return [shape.success, shape.failure];
}
export function createSanityFamily(): FixedFamilyBinding {
    return Object.freeze<FixedFamilyBinding>({
        matches(ref, capability) { const suffix = ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : ''; const entry = Object.hasOwn(COMMANDS, suffix) ? COMMANDS[suffix] : undefined; return !!entry && (capability === null || capability === entry[1]); },
        async slots(ref, context, targets) {
            const suffix = ref.split(':').at(-1)!, action = context.action, sessions = context.sessions(), snapshot = row(sessions.sanity.get(context.actorId));
            const goal = text(action.goal), method = text(action.method), stakes = text(action.stakes), sheet = context.actor;
            const sanBefore = integer(snapshot.san_current) || typeof snapshot.san_current === 'boolean' ? snapshot.san_current : sheet.current_san ?? null;
            const sanMax = integer(snapshot.san_max) || typeof snapshot.san_max === 'boolean' ? snapshot.san_max : 99 - int(row(sheet.skills)['Cthulhu Mythos'] || 0);
            const binding: Row = { investigator_id: context.actorId, san_before: sanBefore, san_max: sanMax }, semantic: Row = {};
            if (suffix === 'check') {
                let loss = truth(action.san_loss) ? parseSanLoss(action.san_loss) : null;
                if (!loss && targets.npc) {
                    const profile = row(context.npcProfile(context.graph.handle(targets.npc)));
                    // The typed shape first (contract §136.13): both halves stated, or it is the Keeper's to complete.
                    loss = statedSanLoss(profile.sanity_loss);
                    if (!loss) for (const key of ['san_loss', 'san_loss_to_see', 'sanity_loss']) { loss = parseSanLoss(profile[key]); if (loss) break; }
                }
                if (!loss) throw new RpcError('needs', 'the SAN check needs its loss expression (success/failure)', {
                    fix: 'set action.san_loss like 0/1D6, or target an NPC whose profile states one', details: { needs: { field: 'san_loss', options: ['0/1', '0/1D3', '0/1D6', '1/1D6', '1/1D8', '1/1D10'] } } });
                for (const [label, expression] of [['success', loss[0]], ['failure', loss[1]]]) {
                    if (expression === '0' || expression === '') continue;
                    try { validateSanLossExpression(expression); }
                    catch (error) { if ((error as Error).name !== 'ValueError') throw error; throw new RpcError('invalid_params', `san_loss ${label} part: ${(error as Error).message}`); }
                }
                const involuntary = action.involuntary, kind = isJsonObject(involuntary) ? involuntary.kind : involuntary, summary = isJsonObject(involuntary) ? involuntary.summary : null;
                if (!INVOLUNTARY_KINDS.includes(kind)) throw new RpcError('needs', 'a failed SAN roll always costs the investigator an involuntary action the Keeper decides (p.166)', {
                    fix: 'set action.involuntary to one of details.needs.options (or {kind, summary})', details: { needs: { field: 'involuntary', options: [...INVOLUNTARY_KINDS] } } });
                const source = goal || method || (targets.npc ? `seeing ${context.graph.displayName(targets.npc)}` : '');
                if (!source) throw new RpcError('needs', 'the SAN check needs its source', { fix: 'put what the investigator beholds in action.goal', details: { needs: { field: 'goal', options: [] } } });
                Object.assign(semantic, { source, loss_success: loss[0], loss_failure: loss[1], involuntary_kind: string(kind), involuntary_summary: string(truth(summary) ? summary : stakes || kind) });
                if (truth(action.trigger)) { semantic.trigger_ref = string(action.trigger); const trigger = string(action.trigger), at = trigger.indexOf(':'); binding.trigger_id = at < 0 ? trigger : trigger.slice(at + 1); }
            }
            else if (suffix === 'bout-tick' || suffix === 'bout-end') {
                if (!boutActive(snapshot)) turnState('no bout of madness is running', 'nothing to advance or end');
                const view = sessions.boutView(context.actorId, snapshot) || {};
                Object.assign(binding, { pending_choice_ref: `bout:${context.actorId}-r${view.round ?? null}`, origin_command_id: snapshot.active_bout_id ?? null, bout_revision: int(view.round || 0) });
            }
            else if (suffix === 'reality-check') {
                if (!isJsonObject(snapshot.active_delusion)) turnState('the investigator has no active delusion to test');
                semantic.request_reality_check = true; binding.active_delusion_ref = 'active-delusion:current';
            }
            else if (suffix === 'insane-insight') {
                if (!truth(snapshot.temporary_insane) && !truth(snapshot.indefinite_insane)) turnState('the investigator is not currently insane');
                if (!goal) throw new RpcError('needs', 'the insight needs its wording', { fix: 'put it in action.goal', details: { needs: { field: 'goal', options: [] } } });
                semantic.insight = goal; binding.insanity_state = truth(snapshot.indefinite_insane) ? 'indefinite' : 'temporary';
            }
            else if (suffix === 'gain-current-san') {
                const receipt = row(await context.readSave(sanityGainPendingName(context.actorId)));
                if (!integer(receipt.san_gain) || receipt.san_gain <= 0) turnState('no host SAN-gain receipt is pending for this investigator');
                semantic.gain_source = goal || string(receipt.gain_source || 'reward'); binding.san_gain = int(receipt.san_gain);
            }
            else if (suffix === 'apply-treatment' || suffix === 'recover-temporary') {
                const key = suffix === 'apply-treatment' ? 'treatment_trigger' : 'recovery_trigger', trigger = snapshot[key];
                if (!isJsonObject(trigger)) turnState(`no ${suffix.replaceAll('-', ' ')} is due`);
                Object.assign(binding, { [suffix === 'apply-treatment' ? 'treatment_trigger_ref' : 'recovery_trigger_ref']: trigger.trigger_id ?? null,
                    due_elapsed_minutes: int(trigger.due_elapsed_minutes || 0), safe_place: true });
                if (suffix === 'apply-treatment') binding.psychoanalysis_skill = int(row(sheet.skills).Psychoanalysis || 1);
            }
            return { semantic, extras: { _host_session_binding: binding } };
        },
        async locked(_context, runtime, selected) {
            const declared = runtime.declaredPayloadSlots(string(selected.decision_ref));
            return Object.fromEntries(entries(selected._host_session_binding).filter(([key, value]) => value != null && declared.has(key) && !key.startsWith('_')).map(([key, value]) => [key, clone(value)]));
        },
        args(context, plan) {
            const suffix = string(plan.decision_ref || '').split(':').at(-1)!, kind = COMMANDS[suffix]?.[0], payload = row(row(plan.command).payload);
            if (!kind) throw new RpcError('not_implemented', `unknown sanity phase ${repr(suffix)}`);
            const command: Row = { decision_id: string(context.callId) };
            if (kind === 'bout_tick' || kind === 'bout_end') Object.assign(command, { choice_id: payload.pending_choice_ref ?? null, responder: 'keeper', revision: payload.bout_revision ?? null, action: kind === 'bout_tick' ? 'tick' : 'end' });
            else if (kind === 'sanity_check') Object.assign(command, { source: payload.source ?? null, san_loss_success: field(payload, 'loss_success', '0'), san_loss_fail_expr: payload.loss_failure ?? null,
                involuntary_kind: payload.involuntary_kind ?? null, involuntary_summary: payload.involuntary_summary ?? null, trigger_id: payload.trigger_id ?? null });
            else if (kind === 'reality_check') command.request_reality_check = payload.request_reality_check ?? null;
            else if (kind === 'gain_current_san') Object.assign(command, { san_gain: payload.san_gain ?? null, gain_source: payload.gain_source ?? null });
            else if (kind === 'insane_insight') Object.assign(command, { insight: payload.insight ?? null, insanity_state: payload.insanity_state ?? null });
            else if (kind === 'apply_psychoanalysis_treatment') Object.assign(command, { treatment_trigger_ref: payload.treatment_trigger_ref ?? null, psychoanalysis_skill: payload.psychoanalysis_skill ?? null, safe_place: payload.safe_place ?? null });
            else if (kind === 'recover_temporary_insanity') Object.assign(command, { recovery_trigger_ref: payload.recovery_trigger_ref ?? null, safe_place: payload.safe_place ?? null });
            return { command: { command_id: `${context.callId}:command`, kind, phase: string(row(plan.command).phase || 'resolve'), payload: command } };
        },
        execute: executeSanity,
        outcome(_context, _ref, result) {
            const check = row(result.check), output: Row = { kind: 'sanity', status: string(result.command || 'settled'), san_before: result.san_before ?? null,
                san_after: result.san_after ?? null, temporary_insane: result.temporary_insane ?? null, indefinite_insane: result.indefinite_insane ?? null,
                permanently_insane: result.permanently_insane ?? null, bout_active: result.bout_active ?? null, bout_rounds_remaining: result.bout_rounds_remaining ?? null };
            if (truth(check)) for (const key of ['skill', 'target', 'roll', 'level', 'passed', 'san_loss']) output[key] = check[key] ?? null;
            for (const key of ['involuntary_action', 'bout', 'delusion_cleared', 'san_gain', 'san_recovered', 'setback', 'insight', 'insanity_state', 'recovered'])
                if (result[key] != null) output[key] = result[key];
            return output;
        },
    });
}
