/**
 * Contract §158.4: the next run's first read watches the previous delivery's post review still running.
 *
 * The review is what names what the ledger owes (§158.2). On the installed App's turn 26 it landed 13 s after turn 27
 * had opened, so turn 27's clerk built its moves from the ledger's position and walked the party to the wrong
 * cemetery. A review that lands while the first read runs is read before any candidate is built.
 *
 * Nothing waits for it past the read (amended 2026-10-02 at the owner's request). The first version waited up to 15 s
 * from the run's start; on the installed App's Blood Road table the post reviews took 58-159 s, every first read had
 * finished its prescreen in 3.4-4.4 s, and each of the four turns then sat until 14.3 s for a review that never landed.
 */
export interface ReviewFlight { turn: number; done: Promise<void> }
export interface OwedReviewWatch { in_flight: boolean; turn?: number; landed(): boolean }
/** Watches the review in flight from now on; `landed()` says whether it has settled since. Never a promise to wait on. */
export function watchOwedReview(flight: ReviewFlight | undefined): OwedReviewWatch {
	if (!flight) return { in_flight: false, landed: () => false };
	let landed = false;
	void flight.done.then(() => { landed = true; }, () => { landed = true; });
	return { in_flight: true, turn: flight.turn, landed: () => landed };
}
