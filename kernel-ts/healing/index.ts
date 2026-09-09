/** Named healing binding for the existing fixed-family resolve pipeline. */
import { isJsonObject } from '../json.js';
import { RpcError } from '../errors.js';
import { array, number, row, string, truth, type Row } from '../read/values.js';
import type { FixedFamilyBinding } from '../resolve/families.js';
import type { SettleContext, ExecutionResult } from '../resolve/context.js';
import { SUCCESS_OUTCOMES } from '../resolve/arithmetic.js';
import { DAY_MINUTES, HealingSession } from './session.js';
import { minutesSinceInjury, syncHealing } from './resources.js';
const DECISIONS: Readonly<Record<string, string>> = Object.freeze({
    'decision:coc7:healing:dying-hour-clock': 'dying_check',
    'decision:coc7:healing:dying-round-clock': 'dying_check',
    'decision:coc7:healing:first-aid-ordinary': 'first_aid',
    'decision:coc7:healing:first-aid-stabilization': 'first_aid',
    'decision:coc7:healing:medicine-ordinary': 'medicine',
    'decision:coc7:healing:medicine-stabilization': 'medicine',
    'decision:coc7:healing:weekly-major-wound-recovery': 'weekly_recovery',
});
function noSkill(context: SettleContext, actor: any, skill: string): never {
    const id = string(actor || ''), node = context.npcNode(id);
    if (!node)
        throw new RpcError('needs', `the rescuer has no ${skill} value on the sheet`, {
            fix: `name an investigator with ${skill} as action.actor`, details: { needs: { field: 'actor', options: context.partyNames() } },
        });
    const who = context.graph.displayName(node);
    throw new RpcError('needs', `the book gives ${who} no ${skill}`, {
        fix: `pin it once with apply npc {name: "${who}", skill: {name: "${skill}", value: <0-100>}}, why: ...}} — it is theirs from then on`,
        details: { needs: { field: 'npc.skill', options: [] }, actor: id, skill },
    });
}
async function sessionFor(context: SettleContext): Promise<HealingSession> {
    return HealingSession.load(context.arithmetic, context, context.subjectId, number(row(context.subject.derived).HP || 10), number(row(context.subject.characteristics).CON || 50), context.rng, context.subject.current_hp ?? null);
}
async function finishHealing(context: SettleContext, session: HealingSession, event: Row, rescuer: string | null, skill: string | null, extra: Array<[
    string,
    Row
]> = []): Promise<Row> {
    const before = Math.trunc(session.beforeHp), beforeConditions = [...session.beforeConditions];
    if (!Object.hasOwn(event, 'hp_before'))
        event.hp_before = before;
    if (!Object.hasOwn(event, 'skill'))
        event.skill = skill;
    await session.save(context);
    await syncHealing(context, context.subjectId, session.currentHp, [...session.conditions]);
    const check = event.check;
    if (isJsonObject(check) && skill)
        event.roll_id = context.addRoll({ actor: rescuer || context.actorId, skill, target: check.target, difficulty: check.difficulty,
            threshold: check.threshold, roll: check.roll, level: check.level, passed: check.passed, bonus: check.bonus ?? 0, penalty: check.penalty ?? 0,
            visibility: 'public', kind: 'healing_check', pushed: truth(event.pushed), check: { ...check, investigator_id: rescuer || context.actorId, skill, kind: 'healing_check' } });
    for (const [label, dice] of extra)
        if (isJsonObject(dice))
            context.addDiceRoll({ actor: rescuer || context.actorId, label, expression: dice.expression ?? null,
                faces: truth(dice.raw) ? dice.raw : truth(dice.rolls) ? dice.rolls : [], total: dice.total ?? null });
    if (session.currentHp !== before)
        context.addDelta('hp', context.subjectId, before, session.currentHp);
    if (session.conditions.length !== beforeConditions.length || session.conditions.some((condition, i) => condition !== beforeConditions[i]))
        context.addEffect('condition', context.subjectId, beforeConditions, [...session.conditions]);
    return { investigator_id: context.subjectId, rescuer_id: rescuer, event, current_hp: session.currentHp, conditions: [...session.conditions],
        player_state_receipt: { schema_version: 1, investigator_id: context.subjectId, hp: { before, after: session.currentHp }, conditions_before: beforeConditions, conditions_after: [...session.conditions] },
        events: [...session.events] };
}
export function createHealingResolveContribution(): FixedFamilyBinding {
    return Object.freeze<FixedFamilyBinding>({
        matches(ref, capability) { return Object.hasOwn(DECISIONS, ref) && (capability === null || DECISIONS[ref] === capability); },
        async slots(ref, context, targets) {
            const semantic: Row = {};
            if (ref.includes('first-aid') || ref.includes('medicine') || ref.includes('weekly'))
                semantic.rescuer_ref = context.actingId;
            if (ref.includes('first-aid')) {
                if (targets.investigator && ![context.actorId, context.subjectId].includes(string(targets.investigator.id)))
                    semantic.assistant_rescuer_ref = string(targets.investigator.id);
                if (truth(context.action.push)) {
                    semantic.changed_method = typeof context.action.method === 'string' ? context.action.method : '';
                    semantic.failure_consequence = typeof context.action.stakes === 'string' ? context.action.stakes : '';
                }
            }
            if (ref.includes('weekly')) {
                const rest = row(context.action.rest);
                semantic.complete_rest = truth(rest.complete);
                semantic.poor_environment = truth(rest.poor_environment);
            }
            return { semantic, extras: {} };
        },
        async locked(context, _runtime, selected, _grant) {
            const ref = string(selected.decision_ref), semantic = row(selected.semantic_inputs), rescuer = string(semantic.rescuer_ref || context.actorId), locked: Row = {};
            if (ref.includes('first-aid')) {
                const value = await context.actorSkillValue(rescuer, 'First Aid');
                if (value !== null)
                    locked.skill_value = value;
                locked.rescuer_id = rescuer;
                locked.pushed = truth(semantic.changed_method || semantic.failure_consequence);
                const assistant = semantic.assistant_rescuer_ref;
                if (typeof assistant === 'string' && assistant.trim()) {
                    const id = assistant.trim(), skill = await context.skillValue(context.sheetById(id), 'First Aid');
                    if (skill !== null) {
                        locked.assistant_skill_value = skill;
                        locked.assistant_rescuer_id = id;
                    }
                }
            }
            else if (ref.includes('medicine')) {
                const value = await context.actorSkillValue(rescuer, 'Medicine');
                if (value !== null)
                    locked.skill_value = value;
                locked.rescuer_id = rescuer;
            }
            else if (ref.includes('weekly')) {
                const value = await context.skillValue(context.sheetById(rescuer) || {}, 'Medicine');
                if (value !== null) {
                    locked.medicine_skill_value = value;
                    locked.caregiver_id = rescuer;
                }
            }
            return locked;
        },
        args(context, plan, selected) {
            const payload = row(row(plan.command).payload), semantic = row(selected.semantic_inputs), capability = row(plan.capability).resolver_capability;
            const result: Row = { investigator: context.actorId, decision_id: context.callId };
            if (capability === 'first_aid' || capability === 'medicine') {
                const rescuer = payload.rescuer_id || semantic.rescuer_ref || context.actorId;
                if (!Object.hasOwn(payload, 'skill_value'))
                    noSkill(context, rescuer, capability === 'first_aid' ? 'First Aid' : 'Medicine');
                Object.assign(result, { skill_value: payload.skill_value, rescuer_id: rescuer });
                if (capability === 'first_aid') {
                    result.pushed = truth(payload.pushed);
                    for (const key of ['changed_method', 'failure_consequence'])
                        if (truth(semantic[key]))
                            result[key] = semantic[key];
                    const assistant = semantic.assistant_rescuer_ref;
                    if (typeof assistant === 'string' && assistant.trim()) {
                        if (payload.assistant_skill_value == null || typeof payload.assistant_rescuer_id !== 'string')
                            throw new RpcError('unknown_entity', 'the assistant rescuer has no First Aid value', { details: { query: assistant, candidates: context.partyNames() } });
                        result.assistant_skill_value = payload.assistant_skill_value;
                        result.assistant_rescuer_id = payload.assistant_rescuer_id;
                    }
                }
            }
            else if (capability === 'dying_check')
                result.clock_kind = payload.clock_kind ?? null;
            else if (capability === 'weekly_recovery') {
                result.complete_rest = Object.hasOwn(semantic, 'complete_rest') ? semantic.complete_rest : payload.complete_rest ?? null;
                result.poor_environment = Object.hasOwn(semantic, 'poor_environment') ? semantic.poor_environment : payload.poor_environment ?? null;
                for (const key of ['medicine_skill_value', 'caregiver_id'])
                    if (payload[key] != null)
                        result[key] = payload[key];
            }
            return result;
        },
        async execute(context, args, plan): Promise<ExecutionResult> {
            const session = await sessionFor(context), capability = row(plan.capability).resolver_capability;
            if (capability === 'first_aid') {
                const event = session.firstAid(number(args.skill_value), null, { pushed: truth(args.pushed), rescuerId: args.rescuer_id,
                    assistantSkillValue: args.assistant_skill_value, assistantRescuerId: args.assistant_rescuer_id });
                const data = await finishHealing(context, session, event, string(args.rescuer_id || context.actorId), 'First Aid');
                const hints = truth(event.summary) ? [event.summary] : [];
                if (truth(event.already_used_today) || truth(event.push_unavailable) || truth(event.push_already_used))
                    hints.push('First Aid is once per wound per day; Medicine or rest are the remaining routes');
                return { data, warnings: [], hints };
            }
            if (capability === 'medicine') {
                const minutes = await minutesSinceInjury(context), event = session.medicine(number(args.skill_value), null, minutes === null || minutes < DAY_MINUTES);
                const data = await finishHealing(context, session, event, string(args.rescuer_id || context.actorId), 'Medicine', truth(event.healing_dice) ? [['Medicine 1D3', event.healing_dice]] : []);
                return { data, warnings: [], hints: truth(event.summary) ? [event.summary] : [] };
            }
            if (capability === 'dying_check') {
                const clock = string(args.clock_kind || 'round'), event = clock === 'round' ? session.dyingConRoll() : session.stabilizedConRoll();
                const data = await finishHealing(context, session, event, null, 'CON');
                data.clock_kind = clock;
                return { data, warnings: [], hints: [event.summary ?? ''] };
            }
            if (capability === 'weekly_recovery') {
                let care: boolean | null = null, fumbled = false, careRoll: Row | null = null;
                if (args.medicine_skill_value != null) {
                    careRoll = context.arithmetic.check(number(args.medicine_skill_value), 'regular', 0, 0, context.rng);
                    care = SUCCESS_OUTCOMES.has(careRoll.outcome);
                    fumbled = careRoll.outcome === 'fumble';
                    context.addRoll({ actor: string(args.caregiver_id || context.actorId), skill: 'Medicine', target: careRoll.target, difficulty: 'regular', threshold: careRoll.threshold,
                        roll: careRoll.roll, level: careRoll.level, passed: careRoll.passed, bonus: 0, penalty: 0, visibility: 'public', kind: 'healing_check', check: { ...careRoll, skill: 'Medicine', kind: 'healing_check' } });
                }
                const event = session.majorWoundRecoveryRoll({ completeRest: truth(args.complete_rest), medicalCareSuccess: care, poorEnvironment: truth(args.poor_environment), medicineFumbled: fumbled, attemptElapsedMinutes: context.clockMinutes });
                const data = await finishHealing(context, session, event, null, 'CON', truth(event.healing_dice) ? [['recovery', event.healing_dice]] : []);
                data.medical_care_roll = careRoll;
                return { data, warnings: [], hints: [event.summary ?? ''] };
            }
            throw new RpcError('not_implemented', `Healing capability ${string(capability)} is not implemented`);
        },
        outcome(_context, _ref, result) {
            const event = row(result.event);
            return { kind: 'healing', status: event.event_type ?? null, skill: event.skill ?? null, roll: event.roll ?? null,
                target: event.target ?? null, difficulty: event.difficulty ?? null, level: event.outcome ?? null, passed: SUCCESS_OUTCOMES.has(event.outcome),
                hp_before: event.hp_before ?? null, hp_after: result.current_hp ?? null, hp_gained: event.hp_gained ?? null,
                conditions: result.conditions ?? null, summary: event.summary ?? null, patient: result.investigator_id ?? null };
        },
    });
}
