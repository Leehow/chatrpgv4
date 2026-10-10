/**
 * Contract §145.1: `apply time {until: {days, time}}`. The Keeper names the local time the fiction reaches (days
 * counted from the day this turn began: 0 = that day, 1 = the day after); the kernel turns it into the minutes from
 * the staged clock. A skip's length is the time it reaches, not an activity's cost, and counting minutes across
 * midnight is arithmetic the model gets wrong (npc-acts-b2 turn 8 wrote fifteen minutes for a night).
 * §211.1: `days` is optional. Absent, the time names its next occurrence at or after the staged clock (that day when
 * not yet past, else the day after): the host's declared clock endpoint ("until 23:30") sends only the time, and the
 * kernel, the clock's one authority, resolves the day and the minutes.
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
    const hour = time ? Number(time[1]) : NaN, minute = time ? Number(time[2]) : NaN, eitherHalf = until.either_half;
    // §218.1: either_half names a time read off a twelve-hour face whose half nobody fixed: the morning reading, never with days.
    const halfInvalid = eitherHalf !== undefined && (typeof eitherHalf !== 'boolean' || eitherHalf && (days != null || hour >= 12));
    if (days != null && (!integer(days) || number(days) < 0) || !time || hour > 23 || minute > 59 || halfInvalid)
        refuse('until_invalid', `until must be {days?: a whole number from 0, time: "HH:MM", either_half?: true without days and with a time before 12:00}, not ${repr(effect.until)}`, {
            fix: 'days counts from today (0 today, 1 tomorrow) and may be left out for the next occurrence of the time; time is the local 24-hour time the fiction reaches, such as "08:00"; either_half: true (no days, a morning reading) takes whichever of that time and twelve hours later comes first' });
    // Days count from the day this turn began, not from the staged clock: "tomorrow" is the day after the scene the
    // prose left, however much of the night this turn already landed (live table time-skip-a, turn 5, where 1050
    // minutes and then until {days: 1} put the clock a day past the prose). The same until twice is one time.
    const start = clockStart(context.graph, row(context.world.clock)).minutes;
    const now = start + Math.trunc(number(row(context.world.clock).minutes));
    const began = now - landedMinutes([...array(context.turn.receipts).map(row), ...(context.staged?.() ?? [])]);
    // §211.1: no days names the next occurrence of the time at or after the staged clock -- never a refusal, since the
    // clock only moves forward and the player (or the Keeper) named a moment, not a day.
    const next = (ofDay: number): number => Math.floor(now / 1440) * 1440 + ofDay + (ofDay < ((now % 1440) + 1440) % 1440 ? 1440 : 0);
    // §218.1: with either_half the earlier of the two readings the clock reaches first ("until nine" at 18:28 is 21:00).
    const minuteOfDay = hour * 60 + minute, nextOccurrence = eitherHalf === true ? Math.min(next(minuteOfDay), next(minuteOfDay + 720)) : next(minuteOfDay);
    const target = days == null ? nextOccurrence : Math.floor(began / 1440) * 1440 + number(days) * 1440 + minuteOfDay;
    if (target < now)
        refuse('until_not_forward', `until ${number(days)} day(s), ${until.time} is before the clock`, {
            fix: 'the clock only moves forward, and days count from the day this turn began: a time of day already past is days 1 or more, or leave days out for the next occurrence of the time',
            details: { clock: reading(context) } });
    const { until: _given, ...rest } = effect;
    // The receipt's until is absolute either way: the days the kernel resolved, counted as §145.1 counts them.
    const resolvedDays = days == null ? Math.floor(target / 1440) - Math.floor(began / 1440) : number(days);
    const ofDay = ((target % 1440) + 1440) % 1440, resolvedTime = `${String(Math.floor(ofDay / 60)).padStart(2, '0')}:${String(ofDay % 60).padStart(2, '0')}`;
    return { ...rest, minutes: target - now, until: { days: resolvedDays, time: eitherHalf === true ? resolvedTime : until.time, ...(eitherHalf === true ? { either_half: true } : {}) } };
}
