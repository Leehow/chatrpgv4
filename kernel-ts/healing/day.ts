/** The existing midnight SAN-day close, shared with the later sanity family. */
import { isJsonObject, orderedObject } from '../json.js';
import { clockSection } from '../read/capsule.js';
import { moduleDeclaration, type ModuleGraph } from '../read/module-graph.js';
import { array, clone, entries, integer, number, row, string, truth, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import type { SettleContext } from '../resolve/context.js';
export function gameDayOf(graph: ModuleGraph, minutes: number): number {
    const zero = clockSection(graph, { clock: { minutes: 0 } }), at = typeof zero.at === 'string' ? /T(\d\d):(\d\d)/.exec(zero.at) : null;
    let start = at ? Number(at[1]) * 60 + Number(at[2]) : 0;
    if (!at) {
        const text = moduleDeclaration(graph.moduleNode).start_time;
        if (typeof text === 'string' && text.includes(':')) {
            const parts = text.split(':'), hour = Number(parts[0]), minute = Number(parts[1]);
            if (parts.length === 2 && parts.every(part => /^[+-]?\d+(?:_\d+)*$/.test(part.trim())) && Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour < 24 && minute >= 0 && minute < 60)
                start = hour * 60 + minute;
        }
    }
    return Math.floor((start + Math.trunc(minutes)) / 1440);
}
function intField(value: any): number {
    if (value === null || value === undefined)
        throw new TypeError("int() argument must be a string, a bytes-like object or a real number, not 'NoneType'");
    const converted = typeof value === 'string' ? (/^[+-]?\d+(?:_\d+)*$/.test(value.trim()) ? Number(value.replaceAll('_', '')) : NaN) : number(value);
    if (!Number.isFinite(converted))
        valueError(typeof value === 'string' ? `invalid literal for int() with base 10: ${string(value)}` : 'cannot convert float NaN to integer');
    return Math.trunc(converted);
}
const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export function scheduleSanityTreatment(state: Row, clockMinutes: number | null): string | null {
    if (clockMinutes === null) return null;
    const investigatorId = state.investigator_id, due = Math.trunc(clockMinutes) + 30 * 24 * 60;
    const triggerId = `apply-treatment:${investigatorId}:${due}`;
    state.treatment_trigger = { trigger_id: triggerId, handler: 'apply_psychoanalysis_treatment', due_elapsed_minutes: due,
        policy: 'auto_apply_if_safe', payload: { condition: 'indefinite_insane' } };
    state.events.push({ event_id: `se${state.events.length + 1}`, type: 'treatment_trigger_scheduled', payload: {
        trigger_id: triggerId, due_elapsed_minutes: due,
        summary: `${investigatorId} monthly Psychoanalysis treatment scheduled for elapsed>${due} (auto_apply_if_safe).` } });
    return triggerId;
}
export function closeSanityDays(input: Row, investigatorId: string, cmValue: number, clockMinutes: number | null, days: number): Row {
    if (input.investigator_id !== investigatorId) {
        const error = new Error('persisted sanity investigator_id does not match requested investigator_id');
        error.name = 'SanityStateIdentityError';
        throw error;
    }
    const active = field(input, 'bout_active', false), rounds = field(input, 'bout_rounds_remaining', 0), id = input.active_bout_id ?? null;
    const bouts = truth(input.bouts_of_madness) ? input.bouts_of_madness : [];
    if (typeof active !== 'boolean' || !integer(rounds) || rounds < 0 || !Array.isArray(bouts))
        valueError('malformed bout state contract');
    if (active) {
        const found = bouts.filter(item => isJsonObject(item) && item.bout_id === id);
        if (typeof id !== 'string' || !id || rounds < 1 || found.length !== 1 || found[0].mode !== 'real_time' || !integer(found[0].duration_rounds) || found[0].duration_rounds < rounds)
            valueError('active bout fields do not match a real-time bout record');
    }
    else if (id !== null || rounds !== 0)
        valueError('inactive bout must have null id and zero remaining rounds');
    const maximum = intField(field(input, 'san_max', 99)), current = intField(field(input, 'san_current', maximum));
    const state: Row = {
        investigator_id: investigatorId, san_max: maximum, san_current: current, cm_value: intField(field(input, 'cm_value', cmValue)),
        awfulness_caps: orderedObject(entries(input.awfulness_caps).map(([key, value]) => [key, intField(value)])),
        temporary_insane: truth(input.temporary_insane), temporary_insane_remaining_hours: intField(field(input, 'temporary_insane_remaining_hours', 0)),
        indefinite_insane: truth(input.indefinite_insane), permanently_insane: truth(input.permanently_insane),
        bout_active: active, bout_rounds_remaining: rounds, active_bout_id: id,
        daily_san_lost: intField(field(input, 'daily_san_lost', 0)), day_start_san: intField(field(input, 'day_start_san', current)),
        bouts_of_madness: clone(bouts), involuntary_actions: clone(array(input.involuntary_actions)),
        phobia: input.phobia ?? null, phobia_tags: array(input.phobia_tags).map(string), mania: input.mania ?? null, mania_tags: array(input.mania_tags).map(string),
        mania_unindulged: truth(input.mania_unindulged), conditions: clone(array(input.conditions)), active_delusion: input.active_delusion ?? null,
        delusion_resistant: truth(input.delusion_resistant), symptoms_suppressed_until_next_san_loss: truth(input.symptoms_suppressed_until_next_san_loss),
        recovery_trigger: truth(row(input.recovery_trigger)) ? clone(input.recovery_trigger) : null,
        treatment_trigger: truth(row(input.treatment_trigger)) ? clone(input.treatment_trigger) : null,
        events: clone(array(input.events)),
    };
    const event = (type: string, payload: Row) => state.events.push({ event_id: `se${state.events.length + 1}`, type, payload });
    for (let day = 0; day < days; day++) {
        const threshold = Math.max(1, Math.floor(state.day_start_san / 5)), lost = state.daily_san_lost, anchored = state.day_start_san;
        const triggered = lost >= threshold && !state.indefinite_insane && !state.permanently_insane;
        if (triggered) {
            state.indefinite_insane = true;
            event('indefinite_insanity', { summary: `${investigatorId} lost >=1/5 SAN in one day → indefinite insanity.`, daily_san_lost: lost, threshold });
            scheduleSanityTreatment(state, clockMinutes);
        }
        state.daily_san_lost = 0;
        state.day_start_san = state.san_current;
        event('day_ended', { daily_san_lost: lost, threshold, day_start_san: anchored, next_day_start_san: state.day_start_san,
            indefinite_insanity_triggered: triggered, summary: `${investigatorId} day closed: lost ${lost} of ${anchored} (threshold ${threshold}); next day anchors at ${state.day_start_san}.` });
    }
    return state;
}
export async function stageDayBoundary(context: Pick<SettleContext, 'graph' | 'world' | 'party' | 'readSave' | 'writeSave'>, before: number): Promise<Row | null> {
    const after = Math.trunc(number(row(context.world.clock).minutes)), days = gameDayOf(context.graph, after) - gameDayOf(context.graph, before);
    if (days <= 0)
        return null;
    const sanity: Row[] = [];
    for (const sheet of context.party()) {
        const id = string(sheet.id || '');
        if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) || id.endsWith('\n'))
            continue;
        const saved = await context.readSave(`sanity-state/${id}.json`);
        if (!isJsonObject(saved))
            continue;
        const previous = truth(saved.indefinite_insane), state = closeSanityDays(saved, id, intField(row(sheet.skills)['Cthulhu Mythos'] || 0), after, days);
        await context.writeSave(`sanity-state/${id}.json`, state);
        sanity.push({ investigator: id, day_start_san: state.day_start_san, went_indefinitely_insane: state.indefinite_insane && !previous });
    }
    return { days, sanity };
}
