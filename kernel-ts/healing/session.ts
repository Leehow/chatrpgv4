/** The current CoC wound, treatment and recovery state for one investigator. */
import type { PythonRandom } from '../random.js';
import { isJsonObject, orderedObject } from '../json.js';
import { array, clone, entries, equal, integer, number, row, string, truth, type Row } from '../read/values.js';
import { CheckArithmetic, rollExpression, SUCCESS_OUTCOMES, valueError } from '../resolve/arithmetic.js';
export interface HealingSavePort {
    readSave(name: string): Promise<any>;
    writeSave(name: string, value: Row): Promise<void>;
}
export const DAY_MINUTES = 24 * 60;
export const WEEK_MINUTES = 7 * DAY_MINUTES;
export const HEALING_SAVE_DIR = 'healing-state';
export const healingStatePath = (id: string): string => `${HEALING_SAVE_DIR}/${id}.json`;
export async function readHealingState(port: HealingSavePort, id: string): Promise<Row> {
    return clone(row(await port.readSave(healingStatePath(id))));
}
export async function writeHealingState(port: HealingSavePort, id: string, value: Row): Promise<void> {
    await port.writeSave(healingStatePath(id), value);
}
export function establishDamageWound(state: any, options: {
    decisionId: string;
    occurredElapsedMinutes: number;
    sourceDamageRollId: string | null;
}): Row {
    if (!isJsonObject(state))
        valueError('investigator state must be an object');
    const { decisionId, occurredElapsedMinutes, sourceDamageRollId } = options;
    if (typeof decisionId !== 'string' || !decisionId || decisionId !== decisionId.trim())
        valueError('damage decision id must be an exact non-empty string');
    const woundId = `wound-${decisionId}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(woundId) || woundId.endsWith('\n'))
        valueError('damage decision id cannot form a safe semantic wound identity');
    if (!integer(occurredElapsedMinutes) || occurredElapsedMinutes < 0)
        valueError('injury elapsed minutes must be a non-negative integer');
    if (sourceDamageRollId !== null && (typeof sourceDamageRollId !== 'string' || !sourceDamageRollId))
        valueError('source damage roll id must be a non-empty string or null');
    const ledger = state.wound_ledger ?? [];
    if (!Array.isArray(ledger))
        valueError('wound ledger must be a list');
    const expected = { wound_id: woundId, source_damage_roll_id: sourceDamageRollId, occurred_elapsed_minutes: occurredElapsedMinutes, status: 'active' };
    for (const item of ledger)
        if (isJsonObject(item) && item.wound_id === woundId) {
            if (!equal(item, expected))
                valueError('semantic wound identity is already bound to different damage');
            state.wound_ledger = ledger;
            return item;
        }
    ledger.push(expected);
    state.wound_ledger = ledger;
    return expected;
}
export function rebaseHealingClock(state: Row, delta: number): Row {
    const moved = clone(state);
    for (const [ledger, field] of [['wound_ledger', 'occurred_elapsed_minutes'], ['major_wound_recovery_ledger', 'attempt_elapsed_minutes']]) {
        for (const item of array(moved[ledger]))
            if (isJsonObject(item) && integer(item[field])) {
                item[field] = typeof item[field] === 'bigint' ? item[field] + BigInt(delta) : number(item[field]) + delta;
            }
    }
    return moved;
}
export const CLOCK_SAVE_PATHS = ['save/healing-state'] as const;
export const rebaseClock = rebaseHealingClock;
export class HealingSession {
    currentHp: number;
    readonly conditions: string[];
    readonly woundLedger: Row[];
    readonly recoveryLedger: Row[];
    readonly events: Row[] = [];
    woundId: string;
    dayId: string;
    private usageRecords: Row;
    private firstAidUsed = false;
    private firstAidPushUsed = false;
    private medicineUsed = false;
    private eventCounter = 0;
    beforeHp: number;
    beforeConditions: string[];
    constructor(readonly arithmetic: CheckArithmetic, readonly investigatorId: string, readonly hpMax: number, readonly conValue: number, readonly rng: PythonRandom, options: {
        currentHp?: number | null;
        conditions?: any;
        healingUsage?: any;
        woundLedger?: any;
        recoveryLedger?: any;
    } = {}) {
        this.currentHp = options.currentHp ?? hpMax;
        this.conditions = [...array(options.conditions)];
        this.woundLedger = array(options.woundLedger).filter(isJsonObject).map(clone);
        this.recoveryLedger = array(options.recoveryLedger).filter(isJsonObject).map(clone);
        const usage = row(options.healingUsage);
        this.woundId = string(usage.active_wound_id || usage.wound_id || 'active-wound');
        this.dayId = string(usage.active_day_id || usage.day_id || 'day-0');
        this.usageRecords = orderedObject(entries(usage.records).filter(([, days]) => isJsonObject(days)).map(([wound, days]) => [wound,
            orderedObject(entries(days).filter(([, flags]) => isJsonObject(flags)).map(([day, flags]) => [day, {
                    first_aid_used: flags.first_aid_used === true, first_aid_push_used: flags.first_aid_push_used === true, medicine_used: flags.medicine_used === true,
                }]))]));
        if (!truth(this.usageRecords) && ['first_aid_used', 'medicine_used'].some(key => Object.hasOwn(usage, key))) {
            this.usageRecords = { [this.woundId]: { [this.dayId]: { first_aid_used: usage.first_aid_used === true, first_aid_push_used: usage.first_aid_push_used === true, medicine_used: usage.medicine_used === true } } };
        }
        this.loadUsageFlags();
        this.beforeHp = this.currentHp;
        this.beforeConditions = [...this.conditions];
    }
    get hasMajorWound(): boolean { return this.conditions.includes('major_wound'); }
    get isDying(): boolean { return this.conditions.includes('dying'); }
    get isUnconscious(): boolean { return this.conditions.includes('unconscious'); }
    private check(target: number, difficulty = 'regular', bonus = 0, penalty = 0): Row { return this.arithmetic.check(target, difficulty, bonus, penalty, this.rng); }
    private removeCondition(value: string): void { const index = this.conditions.indexOf(value); if (index >= 0)
        this.conditions.splice(index, 1); }
    private heal(amount: number): number {
        if (amount <= 0 || this.isDying)
            return 0;
        const before = this.currentHp;
        this.currentHp = Math.min(this.hpMax, this.currentHp + amount);
        const gained = this.currentHp - before;
        if (gained > 0) {
            if (!this.isDying)
                this.removeCondition('unconscious');
            if (this.currentHp > 0)
                this.removeCondition('dying');
            if (this.currentHp >= Math.floor((this.hpMax + 1) / 2))
                this.removeCondition('major_wound');
        }
        return gained;
    }
    firstAid(skillValue: number, skillRollResult: Row | null = null, options: {
        difficulty?: string;
        pushed?: boolean;
        rescuerId?: string | null;
        assistantSkillValue?: any;
        assistantRollResult?: Row | null;
        assistantRescuerId?: any;
    } = {}): Row {
        const difficulty = options.difficulty ?? 'regular', pushed = options.pushed ?? false;
        const assistantValue = options.assistantSkillValue ?? null, assistantId = options.assistantRescuerId ?? null;
        const hasAssistant = assistantValue !== null || assistantId !== null;
        if (hasAssistant && (!integer(assistantValue) || number(assistantValue) < 1 || number(assistantValue) > 100 || typeof assistantId !== 'string' || !assistantId.trim()))
            valueError('assistant First Aid requires assistant_skill_value 1..100 and a non-empty assistant_rescuer_id');
        if (options.assistantRollResult != null && !hasAssistant)
            valueError('assistant_roll_result requires an assistant First Aid rescuer');
        if (this.isDying && this.conditions.includes('stabilized'))
            return this.event('healing_skipped', {
                reason: 'dying but already stabilized; use Medicine to clear dying (p.121)', summary: `${this.investigatorId} already stabilized; Medicine next.`,
            });
        if (pushed && !this.firstAidUsed)
            return this.event('first_aid', {
                skill: 'First Aid', difficulty, outcome: null, pushed: true, already_used_today: false, push_unavailable: true,
                hp_before: this.currentHp, hp_gained: 0, hp_after: this.currentHp, summary: `${this.investigatorId} has no failed First Aid attempt to push.`,
            });
        if (pushed && this.firstAidPushUsed)
            return this.event('first_aid', {
                skill: 'First Aid', difficulty, outcome: null, pushed: true, already_used_today: true, push_already_used: true,
                hp_before: this.currentHp, hp_gained: 0, hp_after: this.currentHp, summary: `${this.investigatorId} First Aid push already used today.`,
            });
        if (this.firstAidUsed && !pushed)
            return this.event('first_aid', {
                skill: 'First Aid', difficulty, outcome: null, pushed, already_used_today: true, hp_before: this.currentHp, hp_gained: 0,
                hp_after: this.currentHp, summary: `${this.investigatorId} First Aid already used today.`,
            });
        const primary = truth(skillRollResult) ? skillRollResult! : this.check(skillValue, difficulty), teamRolls: Row[] = [];
        let result = primary;
        if (hasAssistant) {
            const assistant = truth(options.assistantRollResult) ? options.assistantRollResult! : this.check(number(assistantValue), difficulty);
            teamRolls.push({ rescuer_id: string(options.rescuerId || this.investigatorId), outcome: primary.outcome ?? null, roll: primary.roll ?? null, target: skillValue, difficulty }, { rescuer_id: string(assistantId), outcome: assistant.outcome ?? null, roll: assistant.roll ?? null, target: number(assistantValue), difficulty });
            const rank: Row = { regular: 1, hard: 2, extreme: 3, critical: 4 };
            const successful = teamRolls.map(value => value.outcome).filter(value => Object.hasOwn(rank, value));
            const outcome = successful.length ? successful.reduce((best, value) => rank[value] > rank[best] ? value : best) : teamRolls.some(value => value.outcome === 'fumble') ? 'fumble' : 'failure';
            result = { outcome, roll: null };
        }
        if (this.isDying && !this.conditions.includes('stabilized')) {
            this.firstAidUsed = true;
            if (pushed)
                this.firstAidPushUsed = true;
            const success = SUCCESS_OUTCOMES.has(result.outcome);
            if (success) {
                this.currentHp = 1;
                this.conditions.push('stabilized');
            }
            const data: Row = {
                skill: 'First Aid', difficulty, outcome: result.outcome ?? null, roll: result.roll ?? null, target: skillValue, pushed,
                already_used_today: false, stabilized: success, hp_after: this.currentHp, rule_ref: 'core.combat.dying_stabilize',
                summary: `${this.investigatorId} First Aid on dying -> ${string(result.outcome)}: ${success ? 'stabilized at 1 temporary HP.' : 'failed to stabilize.'}`,
                check: teamRolls.length ? null : primary,
            };
            if (teamRolls.length)
                Object.assign(data, { teamwork: true, team_rolls: teamRolls });
            return this.event(success ? 'first_aid_stabilize' : 'first_aid', data);
        }
        const before = this.currentHp;
        this.firstAidUsed = true;
        if (pushed)
            this.firstAidPushUsed = true;
        const gained = SUCCESS_OUTCOMES.has(result.outcome) ? this.heal(1) : 0;
        const data: Row = {
            skill: 'First Aid', difficulty, outcome: result.outcome ?? null, roll: result.roll ?? null, target: skillValue, pushed,
            already_used_today: false, hp_before: before, hp_gained: gained, hp_after: this.currentHp,
            summary: `${this.investigatorId} First Aid (${difficulty}) -> ${string(result.outcome)}: +${gained} HP${pushed ? ' [pushed]' : ''}.`,
            check: teamRolls.length ? null : primary,
        };
        if (teamRolls.length)
            Object.assign(data, { teamwork: true, team_rolls: teamRolls });
        return this.event('first_aid', data);
    }
    medicine(skillValue: number, skillRollResult: Row | null = null, sameDay = true): Row {
        if (this.isDying && !this.conditions.includes('stabilized'))
            return this.event('healing_skipped', {
                reason: 'Medicine cannot stabilize a dying character; First Aid first (p.121)', summary: `${this.investigatorId} needs First Aid stabilization first.`,
            });
        const clearing = this.isDying && this.conditions.includes('stabilized'), difficulty = sameDay ? 'regular' : 'hard';
        if (this.medicineUsed)
            return this.event('medicine', { skill: 'Medicine', difficulty, outcome: null, already_used_today: true,
                hp_before: this.currentHp, hp_gained: 0, hp_after: this.currentHp, summary: `${this.investigatorId} Medicine already used today.` });
        const result = truth(skillRollResult) ? skillRollResult! : this.check(skillValue, difficulty), before = this.currentHp;
        let gained = 0, healingDice: Row | null = null;
        if (SUCCESS_OUTCOMES.has(result.outcome)) {
            if (clearing) {
                this.removeCondition('dying');
                this.removeCondition('stabilized');
                this.removeCondition('unconscious');
            }
            const dice = rollExpression('1D3', this.rng);
            healingDice = { expression: '1D3', raw: [...dice.rolls], total: dice.total };
            gained = this.heal(healingDice.total);
        }
        this.medicineUsed = true;
        return this.event('medicine', { skill: 'Medicine', difficulty, outcome: result.outcome ?? null, roll: result.roll ?? null, target: skillValue,
            already_used_today: false, hp_before: before, hp_gained: gained, hp_after: this.currentHp, healing_dice: healingDice, check: result,
            summary: `${this.investigatorId} Medicine (${difficulty}) -> ${string(result.outcome)}: +${gained} HP.` });
    }
    dyingConRoll(rollResult: Row | null = null): Row {
        const result = truth(rollResult) ? rollResult! : this.check(this.conValue), died = ['failure', 'fumble'].includes(result.outcome);
        if (died && !this.conditions.includes('dead'))
            this.conditions.push('dead');
        else if (!died)
            this.reopenSubsequentFirstAidAttempt();
        return this.event('dying_con_roll', { outcome: result.outcome ?? null, roll: result.roll ?? null, target: this.conValue,
            difficulty: 'regular', died, rule_ref: 'core.combat.dying_con_clock', check: result,
            summary: `${this.investigatorId} dying CON roll -> ${string(result.outcome)}${died ? ': dies.' : ': holds on.'}` });
    }
    stabilizedConRoll(rollResult: Row | null = null): Row {
        const result = truth(rollResult) ? rollResult! : this.check(this.conValue), deteriorated = ['failure', 'fumble'].includes(result.outcome);
        if (deteriorated) {
            this.currentHp = 0;
            this.removeCondition('stabilized');
            this.reopenSubsequentFirstAidAttempt();
        }
        return this.event('stabilized_con_roll', { outcome: result.outcome ?? null, roll: result.roll ?? null, target: this.conValue,
            difficulty: 'regular', deteriorated, rule_ref: 'core.combat.dying_stabilized_clock', check: result,
            summary: `${this.investigatorId} hourly CON roll -> ${string(result.outcome)}${deteriorated ? ': condition deteriorates, back to dying.' : ': stable.'}` });
    }
    weeklyRecovery(days: number): Row {
        if (days <= 0)
            return this.event('weekly_recovery', { days_of_rest: 0, hp_gained: 0, summary: `${this.investigatorId} no rest taken.` });
        const before = this.currentHp;
        if (this.hasMajorWound)
            return this.event('weekly_recovery', { days_of_rest: days, had_major_wound: true, hp_before: before,
                hp_gained: 0, hp_after: this.currentHp, major_wound_recovery_required: true, rule_ref: 'core.combat.major_wound_recovery',
                summary: `${this.investigatorId} rested ${days} day(s) with a major wound: healing requires the weekly CON recovery roll (p.121).` });
        const gained = this.heal(days);
        return this.event('weekly_recovery', { days_of_rest: days, had_major_wound: false, hp_before: before, hp_gained: gained, hp_after: this.currentHp,
            summary: `${this.investigatorId} recovered ${gained} HP over ${days} day(s) of rest.` });
    }
    majorWoundRecoveryRoll(options: {
        completeRest?: boolean;
        medicalCareSuccess?: boolean | null;
        poorEnvironment?: boolean;
        medicineFumbled?: boolean;
        rollResult?: Row | null;
        attemptElapsedMinutes?: number | null;
    } = {}): Row {
        const complete = truth(options.completeRest), care = truth(options.medicalCareSuccess), poor = truth(options.poorEnvironment), fumbled = truth(options.medicineFumbled);
        const bonus = Number(complete) + Number(care), penalty = Number(poor || fumbled), result = truth(options.rollResult) ? options.rollResult! : this.check(this.conValue, 'regular', bonus, penalty);
        const outcome = result.outcome ?? null, before = this.currentHp;
        let gained = 0, healingDice: Row | null = null;
        const expression = outcome === 'extreme' ? '2D3' : ['regular', 'hard', 'critical'].includes(outcome) ? '1D3' : null;
        if (expression) {
            const dice = rollExpression(expression, this.rng);
            healingDice = { expression, raw: [...dice.rolls], total: dice.total };
            gained = this.heal(healingDice.total);
            if (outcome === 'extreme')
                this.removeCondition('major_wound');
        }
        else if (outcome === 'fumble')
            this.event('lasting_injury', { rule_ref: 'core.combat.major_wound_recovery_fumble',
                keeper_note: 'Pick a lasting injury/complication tied to the nature of the wound and record it in the backstory under Wounds & Scars (p.121).',
                summary: `${this.investigatorId} recovery fumble: lasting injury.` });
        if (options.attemptElapsedMinutes != null) {
            const active = this.woundLedger.filter(item => item.status === 'active');
            if (active.length)
                this.recoveryLedger.push({ wound_id: active.reduce((best, item) => number(item.occurred_elapsed_minutes) > number(best.occurred_elapsed_minutes) ? item : best).wound_id, attempt_elapsed_minutes: Math.trunc(options.attemptElapsedMinutes) });
        }
        return this.event('major_wound_recovery', { skill: 'CON', target: this.conValue, difficulty: 'regular', roll: result.roll ?? null, outcome,
            bonus_dice: bonus, penalty_dice: penalty, complete_rest: complete, medical_care_success: care, poor_environment: poor, medicine_fumbled: fumbled,
            hp_before: before, hp_gained: gained, hp_after: this.currentHp, healing_dice: healingDice, check: result, rule_ref: 'core.combat.major_wound_recovery',
            summary: `${this.investigatorId} weekly recovery CON (${string(outcome)}): +${gained} HP.` });
    }
    resetDailyTreatments(): void { this.firstAidUsed = false; this.firstAidPushUsed = false; this.medicineUsed = false; this.storeUsageFlags(); }
    reopenSubsequentFirstAidAttempt(): void { this.firstAidPushUsed = false; this.storeUsageFlags(); }
    private loadUsageFlags(): void {
        const flags = row(row(this.usageRecords[this.woundId])[this.dayId]);
        this.firstAidUsed = flags.first_aid_used === true;
        this.firstAidPushUsed = flags.first_aid_push_used === true;
        this.medicineUsed = flags.medicine_used === true;
    }
    private storeUsageFlags(): void {
        this.usageRecords[this.woundId] ??= {};
        this.usageRecords[this.woundId][this.dayId] = { first_aid_used: this.firstAidUsed, first_aid_push_used: this.firstAidPushUsed, medicine_used: this.medicineUsed };
    }
    setUsageScope(woundId: string, dayId: string): void { this.storeUsageFlags(); this.woundId = woundId; this.dayId = dayId; this.loadUsageFlags(); }
    private usageSnapshot(): Row { this.storeUsageFlags(); return { active_wound_id: this.woundId, active_day_id: this.dayId, records: clone(this.usageRecords) }; }
    snapshot(): Row {
        return { investigator_id: this.investigatorId, hp_max: this.hpMax, current_hp: this.currentHp, con_value: this.conValue, conditions: [...this.conditions],
            events: [...this.events], healing_usage: this.usageSnapshot(), wound_ledger: [...this.woundLedger], major_wound_recovery_ledger: [...this.recoveryLedger] };
    }
    async save(port: HealingSavePort): Promise<void> {
        const data = await readHealingState(port, this.investigatorId);
        Object.assign(data, { investigator_id: this.investigatorId, current_hp: this.currentHp, conditions: [...this.conditions], healing_usage: this.usageSnapshot(),
            wound_ledger: [...this.woundLedger], major_wound_recovery_ledger: [...this.recoveryLedger] });
        await writeHealingState(port, this.investigatorId, data);
    }
    static async load(arithmetic: CheckArithmetic, port: HealingSavePort, id: string, hpMax: number, con: number, rng: PythonRandom, currentHp: number | null = null): Promise<HealingSession> {
        const data = await readHealingState(port, id);
        return new HealingSession(arithmetic, id, hpMax, con, rng, { currentHp: currentHp ?? (Object.hasOwn(data, 'current_hp') ? data.current_hp : hpMax),
            conditions: data.conditions ?? [], healingUsage: data.healing_usage, woundLedger: data.wound_ledger, recoveryLedger: data.major_wound_recovery_ledger });
    }
    private event(type: string, payload: Row): Row { const value = { event_type: type, eid: `hl${++this.eventCounter}`, ...payload }; this.events.push(value); return value; }
}
export async function healingTimeTrigger(arithmetic: CheckArithmetic, port: HealingSavePort, id: string, hpMax: number, con: number, minutes: number, rng: PythonRandom, hadMajorWound = false): Promise<number> {
    if (minutes <= 0)
        return 0;
    const session = await HealingSession.load(arithmetic, port, id, hpMax, con, rng), before = session.currentHp;
    if (hadMajorWound && !session.hasMajorWound)
        session.conditions.push('major_wound');
    if (minutes >= 360) {
        let remaining = minutes;
        while (session.hasMajorWound && remaining >= WEEK_MINUTES) {
            session.majorWoundRecoveryRoll({ completeRest: true });
            remaining -= WEEK_MINUTES;
        }
        if (!session.hasMajorWound) {
            let days = Math.floor(remaining / DAY_MINUTES);
            if (!days && remaining >= 360)
                days = 1;
            session.weeklyRecovery(days);
        }
    }
    session.resetDailyTreatments();
    await session.save(port);
    return Math.max(0, session.currentHp - before);
}
