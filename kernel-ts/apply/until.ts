/**
 * Contract §145.1: `apply time {until: {days, time}}`. The Keeper names the local time the fiction reaches (days
 * counted from the day this turn began: 0 = that day, 1 = the day after); the kernel turns it into the minutes from
 * the staged clock. A skip's length is the time it reaches, not an activity's cost, and counting minutes across
 * midnight is arithmetic the model gets wrong (npc-acts-b2 turn 8 wrote fifteen minutes for a night).
 */
import { RpcError } from '../errors.js';
import { clockSection, clockStart } from '../read/capsule.js';
import { array, integer, number, repr, row, string, type Row } from '../read/values.js';
import { landedMinutes } from '../read/time-reading.js';
import type { ApplyContext } from './index.js';

const refuse = (reason: string, message: string, extra: { fix?: string; details?: Row } = {}): never => {
    throw new RpcError('invalid_params', message, { ...(extra.fix ? { fix: extra.fix } : {}), details: { field: 'until', reason, ...extra.details } });
};

/** The clock as the capsule shows it, minus the elapsed counter: what a refusal names as "now". */
function reading(context: ApplyContext): Row {
    const { minutes: _minutes, elapsed: _elapsed, ...shown } = clockSection(context.graph, context.world);
    return shown;
}

/** `until` into `minutes` on a `time` effect; every effect without `until` passes through untouched. */
export function bindUntil(context: ApplyContext, effect: Row): Row {
    if (effect.until == null)
        return effect;
    const kind = string(effect.kind);
    if (kind !== 'time')
        refuse('until_none', `a ${kind} effect takes no until`, { fix: 'leave until out; only time takes one' });
    const fields = ['minutes', 'stated'].filter(field => effect[field] != null);
    if (fields.length)
        refuse('until_conflict', `until names the time the clock reaches, and ${fields.join(', ')} is another amount; give one`, {
            fix: `leave ${fields.join(', ')} out to use until, or until out`, details: { fields } });
    const until = row(effect.until), days = until.days, time = typeof until.time === 'string' ? /^(\d{2}):(\d{2})$/.exec(until.time) : null;
    const hour = time ? Number(time[1]) : NaN, minute = time ? Number(time[2]) : NaN;
    if (!integer(days) || number(days) < 0 || !time || hour > 23 || minute > 59)
        refuse('until_invalid', `until must be {days: a whole number from 0, time: "HH:MM"}, not ${repr(effect.until)}`, {
            fix: 'days counts from today (0 today, 1 tomorrow); time is the local 24-hour time the fiction reaches, such as "08:00"' });
    // Days count from the day this turn began, not from the staged clock: "tomorrow" is the day after the scene the
    // prose left, however much of the night this turn already landed (live table time-skip-a, turn 5, where 1050
    // minutes and then until {days: 1} put the clock a day past the prose). The same until twice is one time.
    const start = clockStart(context.graph, row(context.world.clock)).minutes;
    const now = start + Math.trunc(number(row(context.world.clock).minutes));
    const began = now - landedMinutes([...array(context.turn.receipts).map(row), ...(context.staged?.() ?? [])]);
    const target = Math.floor(began / 1440) * 1440 + number(days) * 1440 + hour * 60 + minute;
    if (target < now)
        refuse('until_not_forward', `until ${number(days)} day(s), ${until.time} is before the clock`, {
            fix: 'the clock only moves forward, and days count from the day this turn began: a time of day already past is days 1 or more',
            details: { clock: reading(context) } });
    const { until: _given, ...rest } = effect;
    return { ...rest, minutes: target - now, until: { days: number(days), time: until.time } };
}
