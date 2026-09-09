/** Magic-point amounts and the existing whole-hour regeneration remainder. */
import { PythonFloat } from '../json.js';
import { clone, number, row, string, truth, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import type { RuleTables } from '../rules/tables.js';
import type { HealingSavePort } from './session.js';
const DEFAULT_ECONOMY: Row = { initial: 'POW/5 floor', regen_per_hour: 1, regen_per_hour_pow_above_100: 2,
    after_zero_costs_hp_one_for_one: true, max_cannot_exceed_pow_divided_5: true };
export const MP_SAVE_DIR = 'mp-state';
export const mpStatePath = (id: string): string => `${MP_SAVE_DIR}/${id}.json`;
export const readMpState = async (port: HealingSavePort, id: string): Promise<Row> => clone(row(await port.readSave(mpStatePath(id))));
export const rebaseMpClock = (state: Row, _delta: number): Row => clone(state);
function roundedMinutes(value: number): number {
    if (Number.isNaN(value))
        valueError('cannot convert float NaN to integer');
    if (!Number.isFinite(value)) {
        const error = new Error('cannot convert float infinity to integer');
        error.name = 'OverflowError';
        throw error;
    }
    const floor = Math.floor(value), fraction = value - floor;
    return fraction === 0.5 ? floor % 2 === 0 ? floor : floor + 1 : fraction < 0.5 ? floor : floor + 1;
}
export class MPool {
    mpMax: number;
    currentMp: number;
    currentHp: number | null;
    remainderMinutes: number;
    readonly events: Row[] = [];
    private eventCounter = 0;
    readonly economy: Row;
    constructor(readonly investigatorId: string, readonly powValue: number, options: {
        economy?: Row;
        currentHp?: number | null;
        remainderMinutes?: number;
    } = {}) {
        this.economy = truth(options.economy) ? options.economy! : { ...DEFAULT_ECONOMY };
        this.mpMax = Math.floor(powValue / 5);
        this.currentMp = this.mpMax;
        this.currentHp = options.currentHp ?? null;
        this.remainderMinutes = Math.trunc(options.remainderMinutes ?? 0);
    }
    get regenPerHour(): number {
        const base = Math.trunc(number(this.economy.regen_per_hour ?? 1));
        return this.powValue > 100 ? Math.trunc(number(this.economy.regen_per_hour_pow_above_100 ?? base * 2)) : base;
    }
    canSpend(amount: number): boolean { return amount <= this.currentMp || this.currentHp === null || this.currentHp - (amount - this.currentMp) > 0; }
    spendMp(rawAmount: number, source = 'cast'): Row {
        const amount = Math.trunc(rawAmount), before = this.currentMp, beforeHp = this.currentHp;
        let next = this.currentMp - amount, hpDamage = 0, overspill = 0;
        if (next < 0 && truth(this.economy.after_zero_costs_hp_one_for_one ?? true)) {
            overspill = -next;
            next = 0;
            if (this.currentHp !== null) {
                hpDamage = overspill;
                this.currentHp = Math.max(0, this.currentHp - hpDamage);
            }
        }
        this.currentMp = next;
        return this.event('mp_spend', { source, amount, mp_before: before, mp_after: next, overspill_to_hp: overspill,
            hp_damage: hpDamage, hp_before: beforeHp, hp_after: this.currentHp,
            summary: `${this.investigatorId} spent ${amount} MP (${before}->${next})${overspill ? `, overspill ${overspill} -> HP damage` : ''} (${source}).` });
    }
    regenMp(hours: number | PythonFloat, source = 'rest'): number {
        if (number(hours) <= 0)
            return 0;
        const minutes = roundedMinutes(number(hours) * 60);
        if (minutes <= 0)
            return 0;
        const total = this.remainderMinutes + minutes, wholeHours = Math.floor(total / 60);
        this.remainderMinutes = total - wholeHours * 60;
        if (wholeHours <= 0)
            return 0;
        const before = this.currentMp;
        let next = before + wholeHours * this.regenPerHour;
        if (truth(this.economy.max_cannot_exceed_pow_divided_5 ?? true))
            next = Math.min(next, this.mpMax);
        const gain = next - before;
        if (gain <= 0)
            return 0;
        this.currentMp = next;
        this.event('mp_regen', { source, hours, gain_per_hour: this.regenPerHour, gain, mp_before: before, mp_after: next,
            remainder_minutes: this.remainderMinutes, summary: `${this.investigatorId} regenerated ${gain} MP over ${string(hours)}h rest (${source}).` });
        return gain;
    }
    snapshot(): Row {
        return { investigator_id: this.investigatorId, pow_value: this.powValue, mp_max: this.mpMax, mp: this.currentMp,
            current_hp: this.currentHp, regen_remainder_minutes: this.remainderMinutes, events: [...this.events] };
    }
    async save(port: HealingSavePort): Promise<void> {
        const data = await readMpState(port, this.investigatorId);
        Object.assign(data, { investigator_id: this.investigatorId, mp: this.currentMp, mp_max: this.mpMax, regen_remainder_minutes: this.remainderMinutes });
        if (this.currentHp !== null)
            data.current_hp = this.currentHp;
        await port.writeSave(mpStatePath(this.investigatorId), data);
    }
    static async load(tables: RuleTables, port: HealingSavePort, id: string, pow: number, options: {
        currentMp?: number | null;
        currentHp?: number | null;
    } = {}): Promise<MPool> {
        const pool = new MPool(id, pow, { economy: row((await tables.spellsTable()).mp_economy) });
        const data = await readMpState(port, id);
        if (Object.hasOwn(data, 'mp'))
            pool.currentMp = Math.trunc(number(data.mp));
        if (Object.hasOwn(data, 'mp_max'))
            pool.mpMax = Math.trunc(number(data.mp_max));
        if (Object.hasOwn(data, 'current_hp'))
            pool.currentHp = Math.trunc(number(data.current_hp));
        if (Object.hasOwn(data, 'regen_remainder_minutes'))
            pool.remainderMinutes = Math.trunc(number(data.regen_remainder_minutes));
        if (options.currentMp != null)
            pool.currentMp = Math.trunc(options.currentMp);
        if (options.currentHp != null)
            pool.currentHp = Math.trunc(options.currentHp);
        return pool;
    }
    private event(type: string, payload: Row): Row { const value = { event_type: type, eid: `mp${++this.eventCounter}`, ...payload }; this.events.push(value); return value; }
}
export async function mpTimeTrigger(tables: RuleTables, port: HealingSavePort, id: string, pow: number, minutes: number, options: {
    source?: string;
    currentMp?: number | null;
} = {}): Promise<number> {
    if (minutes <= 0)
        return 0;
    const pool = await MPool.load(tables, port, id, pow, options), gained = pool.regenMp(new PythonFloat(minutes / 60), options.source ?? 'downtime');
    await pool.save(port);
    return gained;
}
