/** The existing Psychoanalysis, asylum and self-help arithmetic from healing.py. */
import { isJsonObject } from '../json.js';
import type { PythonRandom } from '../random.js';
import { CheckArithmetic, rollExpression, SUCCESS_OUTCOMES, valueError } from '../resolve/arithmetic.js';
import { clone, repr, string, type Row } from '../read/values.js';
import { BACKSTORY_FIELDS } from './session.js';
import { sanityInt as int } from './expression.js';

export class PsychotherapySession {
    readonly events: Row[] = [];
    asylumMonthsRemaining = 0;
    asylumQuality: string | null = null;
    monthlyGainsCount = 0;
    constructor(readonly arithmetic: CheckArithmetic, readonly investigatorId: string, readonly sanState: Row, readonly rng: PythonRandom) {}
    get currentSan(): number { return int(Object.hasOwn(this.sanState, 'current_san') ? this.sanState.current_san : 0); }
    get maxSan(): number { return int(Object.hasOwn(this.sanState, 'max_san') ? this.sanState.max_san : 99); }
    private setSan(value: number): number { const result = Math.max(0, Math.min(this.maxSan, int(value))); this.sanState.current_san = result; return result; }
    private event(type: string, payload: Row): Row {
        const event = { event_type: type, eid: `ps${this.events.length + 1}`, ...payload }; this.events.push(event); return event;
    }
    private recover(amount: number): number {
        if (amount <= 0) return 0;
        const before = this.currentSan; this.setSan(before + amount); return this.currentSan - before;
    }
    psychoanalysis(skillValue: number, difficulty = 'regular'): Row {
        const result = this.arithmetic.check(skillValue, difficulty, 0, 0, this.rng), outcome = result.outcome, before = this.currentSan;
        const expression: Row = { extreme: '3D3', hard: '2D3', regular: '1D3', critical: '1D3' };
        const recovered = expression[outcome] ? this.recover(int(rollExpression(expression[outcome], this.rng).total)) : 0;
        return this.event('psychoanalysis', { skill: 'Psychoanalysis', difficulty, outcome, san_before: before, san_recovered: recovered, san_after: this.currentSan,
            summary: `${this.investigatorId} Psychoanalysis (${difficulty}) -> ${outcome}: +${recovered} SAN.` });
    }
    monthlyTreatmentRoll(quality: string | null = null, rng = this.rng): Row {
        let bonus = 0, penalty = 0;
        if (quality === 'good') bonus = 1;
        else if (quality === 'poor') penalty = 1;
        else if (quality !== null) valueError(`quality must be 'good', 'poor', or None, got ${repr(quality)}`);
        const result = this.arithmetic.check(95, 'regular', bonus, penalty, rng), roll = int(result.roll ?? 100), before = this.currentSan, setback = roll > 95;
        let delta: number;
        if (setback) { this.setSan(this.currentSan - int(rollExpression('1D6', rng).total)); delta = this.currentSan - before; }
        else { delta = this.recover(int(rollExpression('1D3', rng).total)); if (delta > 0) this.monthlyGainsCount++; }
        return this.event('monthly_treatment', { roll, bonus: int(result.bonus ?? 0), penalty: int(result.penalty ?? 0), quality, setback, san_before: before,
            san_delta: delta, san_after: this.currentSan, monthly_gains_count: this.monthlyGainsCount,
            summary: `${this.investigatorId} monthly treatment roll ${roll}${setback ? ' (setback)' : ''}: SAN ${before}->${this.currentSan}.` });
    }
    confineToAsylum(quality: string | null = null): Row {
        if (quality !== null && quality !== 'good' && quality !== 'poor') valueError(`quality must be 'good', 'poor', or None, got ${repr(quality)}`);
        const months = this.rng.randint(1, 6); this.asylumMonthsRemaining = months; this.asylumQuality = quality;
        return this.event('asylum_confinement', { months, quality, summary: `${this.investigatorId} committed to asylum for ${months} month(s)${quality ? ` (${quality})` : ''}.` });
    }
    resolveAsylumRelease(_psychoanalysisSkill = 0, quality: string | null = null): Row {
        const months = this.asylumMonthsRemaining; this.asylumMonthsRemaining = 0;
        const monthly = this.monthlyTreatmentRoll(quality !== null ? quality : this.asylumQuality);
        Object.assign(monthly, { event_type: 'asylum_release', months_confined: months, san_recovered: Math.max(0, int(monthly.san_delta ?? 0)),
            summary: `${this.investigatorId} released from asylum after ${months}m: monthly treatment roll ${monthly.roll}${monthly.setback ? ' (setback)' : ''}, SAN ${monthly.san_before}->${monthly.san_after}.` });
        return monthly;
    }
    cureIndefiniteCheck(): Row {
        if (this.monthlyGainsCount < 1) return { blocked: 'monthly_gain_required', monthly_gains_count: this.monthlyGainsCount, cured: false };
        const result = this.arithmetic.check(this.currentSan, 'regular', 0, 0, this.rng), outcome = result.outcome, cured = SUCCESS_OUTCOMES.has(outcome);
        if (cured) this.sanState.indefinite_insane = false;
        return this.event('cure_indefinite', { roll: result.roll, target: this.currentSan, outcome, cured, monthly_gains_count: this.monthlyGainsCount,
            summary: `${this.investigatorId} indefinite-cure check ${outcome}: cured=${string(cured)}.` });
    }
    selfHelp(keyConnection: any): Row {
        if (!isJsonObject(keyConnection)) throw new TypeError('key_connection must be a dict');
        const field = keyConnection.backstory_field ?? null;
        if (!BACKSTORY_FIELDS.some(value => value === field)) valueError(`key_connection.backstory_field must be one of (${BACKSTORY_FIELDS.map(repr).join(', ')}), got ${repr(field)}`);
        const result = this.arithmetic.check(this.currentSan, 'regular', 0, 0, this.rng), outcome = result.outcome, before = this.currentSan;
        const payload: Row = { outcome, san_before: before, key_connection: { backstory_field: field,
            summary: string(Object.hasOwn(keyConnection, 'summary') ? keyConnection.summary : '') } };
        if (SUCCESS_OUTCOMES.has(outcome)) payload.san_delta = this.recover(int(rollExpression('1D6', this.rng).total));
        else { this.setSan(this.currentSan - 1); payload.san_delta = -1; payload.backstory_amend_required = { mode: 'corrupt_existing', backstory_field: field }; }
        payload.san_after = this.currentSan;
        payload.summary = `${this.investigatorId} self-help SAN roll ${outcome}: SAN ${before}->${this.currentSan}.`;
        return this.event('self_help', payload);
    }
    snapshot(): Row {
        return { investigator_id: this.investigatorId, current_san: this.currentSan, max_san: this.maxSan, asylum_months_remaining: this.asylumMonthsRemaining,
            asylum_quality: this.asylumQuality, monthly_gains_count: this.monthlyGainsCount, events: clone(this.events) };
    }
}
