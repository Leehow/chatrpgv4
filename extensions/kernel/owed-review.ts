/**
 * Contract §158.4: the next run waits, within a bound, for the previous delivery's post review still running.
 *
 * The review is what names what the ledger owes (§158.2). On the installed App's turn 26 it landed 13 s after turn 27
 * had opened, so turn 27's clerk built its moves from the ledger's position and walked the party to the wrong
 * cemetery. The run's first read takes 8-12 s of its own; waiting beside it costs the player only what is left of
 * the bound, and only when a review is in flight.
 */
export const OWED_WAIT_DEFAULT_MS = 15_000;
/** `PI_COC_OWED_WAIT_MS`, counted from the run's start; 0 waits for nothing, anything else unreadable is the default. */
export function owedWaitMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.PI_COC_OWED_WAIT_MS, value = raw === undefined || raw === "" ? NaN : Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : OWED_WAIT_DEFAULT_MS;
}
export interface ReviewFlight { turn: number; done: Promise<void> }
export interface OwedReviewWait { in_flight: boolean; waited_ms: number; landed: boolean; turn?: number }
/** Resolves when the review in flight settles, or when what is left of `capMs` after `elapsedMs` runs out. */
export async function settleOwedReview(flight: ReviewFlight | undefined, capMs: number, elapsedMs: number): Promise<OwedReviewWait> {
	if (!flight) return { in_flight: false, waited_ms: 0, landed: false };
	const left = capMs - Math.max(0, elapsedMs);
	if (!(left > 0)) return { in_flight: true, waited_ms: 0, landed: false, turn: flight.turn };
	const began = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const landed = await Promise.race([
		flight.done.then(() => true),
		new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), left); timer.unref?.(); }),
	]);
	if (timer) clearTimeout(timer);
	return { in_flight: true, waited_ms: Date.now() - began, landed, turn: flight.turn };
}
