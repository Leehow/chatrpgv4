/**
 * Contract §145.3: a time skip the prose makes, reconciled with the clock at delivery.
 *
 * The host reads the delivery with Jev (§145.2) and sends a reading only when it read a cut; this module never sees
 * the prose. It compares the reading with the kernel's own books: the minutes this turn's `time` and `move` receipts
 * moved the clock, and the clock's day part after them. A gap is refused once a turn and then delivered with a
 * finding, which the next capsules keep in `unrecorded` until a `time` receipt lands (§145.4).
 */
import { RpcError } from '../errors.js';
import { DAY_PARTS } from './capsule.js';
import { array, integer, number, numeric, row, string, type Row } from './values.js';

const CUTS = ['later_today', 'next_day', 'days'];

export interface TimeReading {
    readonly cut: string;
    readonly confidence: number;
    readonly floor: number;
    readonly ends_at: string | null;
    readonly refusable: boolean;
}

/** The host-only `time_reading` a delivery carries, or null without one; a malformed one is the host's bug, refused. */
export function timeReading(value: unknown): TimeReading | null {
    if (value == null)
        return null;
    const reading = row(value), parts = DAY_PARTS.map(([part]) => part);
    const endsAt = reading.ends_at == null ? null : string(reading.ends_at);
    if (!CUTS.includes(string(reading.cut)) || !numeric(reading.confidence) || !integer(reading.floor) || number(reading.floor) < 0
        || (endsAt !== null && !parts.includes(endsAt)) || typeof reading.refusable !== 'boolean')
        throw new RpcError('invalid_params', `time_reading must be {cut: ${CUTS.join(' | ')}, confidence, floor, ends_at?: a day part, refusable}`);
    return { cut: string(reading.cut), confidence: number(reading.confidence), floor: number(reading.floor), ends_at: endsAt, refusable: reading.refusable };
}

/** The clock's movement this turn: a `time` receipt's minutes and a `move` receipt's travel minutes. */
export function landedMinutes(receipts: readonly Row[]): number {
    return receipts.filter(receipt => ['time', 'move'].includes(string(receipt.kind)) && integer(receipt.minutes))
        .reduce((sum, receipt) => sum + number(receipt.minutes), 0);
}

function near(a: string, b: string): boolean {
    const order = DAY_PARTS.map(([part]) => part), i = order.indexOf(a), j = order.indexOf(b);
    const distance = Math.abs(i - j);
    return i >= 0 && j >= 0 && Math.min(distance, order.length - distance) <= 1;
}

/** Where the clock reads now as a minute of the day, from the capsule's clock section. */
function minuteOfDay(clock: Row): number {
    if (typeof clock.at === 'string')
        return Number(clock.at.slice(11, 13)) * 60 + Number(clock.at.slice(14, 16));
    return number(clock.hh) * 60 + number(clock.mm);
}

/**
 * `until` that lands the clock at the start of the day part the prose ends in, on the day the cut implies, with days
 * counted from the day this turn began -- as `until` binds them (§145.1). `landed` is this turn's clock movement.
 */
function suggest(reading: TimeReading, clock: Row, landed: number): Row | null {
    const start = DAY_PARTS.find(([part]) => part === reading.ends_at)?.[1];
    if (start === undefined || reading.cut === 'days')
        return null;
    const began = ((minuteOfDay(clock) - landed) % 1440 + 1440) % 1440;
    const days = reading.cut === 'next_day' ? 1 : start * 60 > began ? 0 : 1;
    // The clock already past that time: the books hold more than the prose told, and the clock never goes back.
    if (days * 1440 + start * 60 < began + landed)
        return null;
    return { until: { days, time: `${String(start).padStart(2, '0')}:00` } };
}

/** The gap between the reading and the books, or null when they agree. `clock` is `clockSection` after this turn. */
export function timeGap(reading: TimeReading | null, receipts: readonly Row[], clock: Row): Row | null {
    if (!reading)
        return null;
    const landed = landedMinutes(receipts), dayPart = string(clock.day_part);
    const partGap = reading.ends_at !== null && !near(reading.ends_at, dayPart);
    if (landed >= reading.floor && !partGap)
        return null;
    const suggested = suggest(reading, clock, landed);
    return { cut: reading.cut, ends_at: reading.ends_at, landed_minutes: landed, floor: reading.floor, day_part: dayPart,
        clock: (({ minutes: _m, elapsed: _e, ...shown }) => shown)(clock), ...(suggested ? { suggest: suggested } : {}) };
}

function cutWords(cut: string): string {
    return cut === 'later_today' ? 'to later the same day' : cut === 'next_day' ? 'through a night or to the next day' : 'by several days';
}

function clockWords(clock: Row): string {
    const at = typeof clock.at === 'string' ? clock.at : `day ${string(clock.day)} ${string(clock.hh)}:${string(clock.mm)}`;
    return `${at} (${string(clock.day_part)})`;
}

function untilWords(gap: Row): string {
    const until = row(row(gap.suggest).until);
    return gap.suggest ? `apply time with until {days: ${number(until.days)}, time: "${string(until.time)}"}` : 'apply time with until or minutes';
}

export const TIME_FIX = 'Land the time the prose skips with apply time -- until {days, time} names the local time it reaches, '
    + 'days counted from the day this turn began (details.suggest when present) -- then deliver again; or keep the prose inside the time the books hold.';

/** The refusal for a gap on the turn's first check (§145.3). */
export function timeRefusal(gap: Row): RpcError {
    const ends = gap.ends_at ? `, ending in the ${string(gap.ends_at)}` : '';
    return new RpcError('needs', `This delivery moves the story ${cutWords(string(gap.cut))}${ends}, and the clock reads `
        + `${clockWords(row(gap.clock))} with ${number(gap.landed_minutes)} minutes landed this turn; ${untilWords(gap)} records it`, {
        fix: TIME_FIX, details: { reason: 'time_unrecorded', ...gap } });
}

/** The finding a gap leaves on a delivery that went out anyway (§145.3), and that §145.4 keeps raising. */
export function timeWarning(gap: Row, at: string): Row {
    const ends = gap.ends_at ? `, ending in the ${string(gap.ends_at)}` : '';
    return { lane: 'delivery', kind: 'time_unrecorded', quote: null,
        why: `the delivery moved the story ${cutWords(string(gap.cut))}${ends}; the clock read ${clockWords(row(gap.clock))} with ${number(gap.landed_minutes)} minutes landed that turn`,
        fix: `${untilWords(gap)} makes the clock agree with what the player was told`,
        cut: gap.cut, ends_at: gap.ends_at ?? null, ...(gap.suggest ? { suggest: gap.suggest } : {}), at };
}

/**
 * §145.4: the most recent `time_unrecorded` finding on an earlier turn, while no later turn holds a `time` receipt.
 * `clock` is the capsule's clock section now. It says the two records disagree and names the call; nothing is owed.
 */
export function unrecordedTime(records: readonly Row[], turn: number, clock: Row): Row[] {
    const past = [...records].filter(record => number(record.turn) < turn).sort((a, b) => number(b.turn) - number(a.turn));
    for (const record of past) {
        if (array(record.receipts).some(receipt => string(row(receipt).kind) === 'time'))
            return [];
        const warning = array(record.warnings).map(row).find(item => item.kind === 'time_unrecorded');
        if (!warning)
            continue;
        return [{
            time: warning.cut ?? null,
            turn: record.turn,
            ends_at: warning.ends_at ?? null,
            operation: 'apply time',
            line: `turn ${string(record.turn)} told the player the story moved ${cutWords(string(warning.cut))}${warning.ends_at ? `, into the ${string(warning.ends_at)}` : ''}; `
                + `the clock reads ${clockWords(clock)} and no time has landed since; apply time (until {days, time} names the time the story reached) makes the two agree`
        }];
    }
    return [];
}
