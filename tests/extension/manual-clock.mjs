/**
 * SL-87: a manual clock for a test whose subject is a wall-clock budget. It has the `TaskClock` shape (`now`, `schedule`,
 * `runtime/jev/task-context.ts`), so the product code under test takes it where it would read `Date.now()` and arm a
 * `setTimeout`. Time moves only when the test moves it; nothing sleeps, so a loaded machine cannot move a deadline.
 *
 * - `advanceTo(at)` fires every timer due by `at`, in order, with the clock at each one's time.
 * - `reads()` counts the readings the code under test took (`now()`), so a test can see that a waiter took its start.
 *   The test's own `at()`, `sleep` and `until` do not count.
 * - `early` makes every timer longer than 1 ms fire that many ms before it is due, which is what Node's timers do against
 *   `Date.now()` on a lagging event loop. A 1 ms timer fires on time, so a re-armed wait always makes progress.
 */
export function manualClock({ start = 1_000_000, early = 0 } = {}) {
	let t = start, reads = 0;
	const timers = new Set();
	const add = (at, callback) => { const timer = { at, callback }; timers.add(timer); return () => { timers.delete(timer); }; };
	const clock = {
		now: () => { reads++; return t; },
		schedule(callback, delayMs) {
			const delay = Math.max(0, delayMs);
			return add(t + (delay > 1 ? Math.max(1, delay - early) : delay), callback);
		},
		/** The time, for the test (not counted as a reading). */
		at: () => t,
		reads: () => reads,
		/** When each timer still scheduled is due, in order. */
		due: () => [...timers].map((timer) => timer.at).sort((a, b) => a - b),
		advanceTo(target) {
			for (;;) {
				let next;
				for (const timer of timers) if (timer.at <= target && (!next || timer.at < next.at)) next = timer;
				if (!next) break;
				timers.delete(next);
				t = Math.max(t, next.at);
				next.callback();
			}
			t = Math.max(t, target);
		},
		/** Resolves when the clock reaches `at`, exactly (a test's scripted answer that arrives at that time). */
		until: (at) => new Promise((resolve) => { add(Math.max(t, at), resolve); }),
		/** Resolves `ms` after now on the clock. */
		sleep: (ms) => clock.until(t + ms),
	};
	return clock;
}

/**
 * After the steps a test drove by hand: run the timers due after `roundEndAt` until `ended()`, but only once nothing at
 * or before `roundEndAt` is still scheduled, so the round under test is never forced. What is left then can only be a
 * wait longer than the round, and it shows in the numbers instead of hanging the test. Gives up after `timeoutMs` of
 * real time (the run did not end: the caller's assertion says so).
 */
export async function runWaitsPastRound(clock, roundEndAt, ended, { timeoutMs = 60_000 } = {}) {
	for (const deadline = Date.now() + timeoutMs; !ended() && Date.now() < deadline;) {
		const due = clock.due(), next = due.find((at) => at > roundEndAt);
		if (next !== undefined && !due.some((at) => at <= roundEndAt)) clock.advanceTo(next);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
