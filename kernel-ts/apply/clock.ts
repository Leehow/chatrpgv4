/** Opening anchors and integer clock arithmetic shared by time and travel effects. */
import { number, row, type Row } from '../read/values.js';
import { RpcError } from '../errors.js';
import { clockStart, parseClockLocal } from '../read/capsule.js';
import { moduleDeclaration } from '../read/module-graph.js';
import { nowIso } from '../write/store.js';
import type { ApplyContext } from './index.js';

export function stageClock(context: ApplyContext, effect: Row): Row {
    const local = effect.local_datetime, parsed = parseClockLocal(local);
    if (!parsed)
        throw new RpcError('invalid_params', 'local_datetime must be a valid local calendar minute', {
            fix: 'Use a real calendar date in YYYY-MM-DDTHH:MM format, with no timezone (hours 00-23, minutes 00-59).'
        });
    const declaration = moduleDeclaration(context.graph.moduleNode), authored = row(declaration.start_clock).local_datetime;
    const start = clockStart(context.graph);
    if (start.at)
        throw new RpcError('invalid_params', 'The module already declares its opening datetime', {
            fix: `Keep the module opening ${authored}; use apply time to advance the clock.`
        });
    const clock = row(context.world.clock);
    if (Object.hasOwn(clock, 'start_local'))
        throw new RpcError('invalid_params', 'The opening datetime has already been pinned', {
            fix: `Keep the pinned opening ${clock.start_local}; use apply time to advance the clock.`
        });
    if (typeof declaration.start_time === 'string' && parsed.getUTCHours() * 60 + parsed.getUTCMinutes() !== start.minutes)
        throw new RpcError('invalid_params', 'The opening time must match the module clock time', {
            fix: `Choose a date with the module's opening clock time ${declaration.start_time}.`
        });
    (context.world.clock ??= {}).start_local = local;
    return { id: `clock:t${context.turn.turn}-c${context.ordinal}`, kind: 'clock', call_id: context.callId,
        local_datetime: local, why: typeof effect.why === 'string' ? effect.why : null, at: nowIso() };
}

export function advanceClock(world: Row, minutes: number | bigint): [
    number | bigint,
    number | bigint
] {
    const clock = world.clock ??= { minutes: 0 }, before = typeof clock.minutes === 'bigint' ? clock.minutes : Math.trunc(number(clock.minutes));
    const total = BigInt(before) + BigInt(minutes);
    clock.minutes = total <= BigInt(Number.MAX_SAFE_INTEGER) && total >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(total) : total;
    return [before, clock.minutes];
}
