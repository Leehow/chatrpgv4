/** Integer clock arithmetic shared by time and travel effects. */
import { number, type Row } from '../read/values.js';
export function advanceClock(world: Row, minutes: number | bigint): [
    number | bigint,
    number | bigint
] {
    const clock = world.clock ??= { minutes: 0 }, before = typeof clock.minutes === 'bigint' ? clock.minutes : Math.trunc(number(clock.minutes));
    const total = BigInt(before) + BigInt(minutes);
    clock.minutes = total <= BigInt(Number.MAX_SAFE_INTEGER) && total >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(total) : total;
    return [before, clock.minutes];
}
