/**
 * Contract §135.29 addendum 2 (SL-82): with `COC_FIRST_STEP_THINKING=1`, the turn's first Keeper call sizes
 * its own per-call cap -- `max(the ordinary SL-69 cap, the data file's thinking-call allowance)` -- and every
 * later call of the same turn keeps the ordinary cap; the flag off is unchanged. Two layers:
 *
 * - `createHybridEngine`'s own exposed `keeperCallCapMs` driven directly against a stub extension host (no
 *   real Pi session, no timers): proves the engine's own step counter and cap selection, and that the
 *   flag-off path returns the plain ordinary number rather than a wrapped function (the byte-for-byte
 *   requirement one level up from "the vendored request is unchanged").
 * - A real-socket integration test (the `keeper-call-cap-integration.test.mjs` harness) proving the vendored
 *   seam itself (`vendor/pi/packages/coding-agent/src/core/sdk.ts`, patch `0004`) accepts a function for
 *   `keeperCallCapMs`, resolves it fresh immediately before every attempt (a counter-backed function answers
 *   differently call to call), and that the `keeper_call_cap` telemetry row carries `step`.
 */
import { strict as assert } from "node:assert";
import { silentThenLateProvider } from "./fixtures/late-provider.mjs";
import { test } from "node:test";
import { configureHttpDispatcher } from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { openTable } from "./harness.mjs";
import { createHybridEngine, keeperCallCapMs as computeKeeperCallCapMs } from "./hybrid-engine-fixture.mjs";
import { firstStepThinkingBudget } from "../../runtime/jev/host-budgets.ts";

// ---------------------------------------------------------------------------
// `createHybridEngine`'s own step counter and cap selection (stub extension host, no real session).
// ---------------------------------------------------------------------------

/** A minimal stand-in for the Pi extension host: just enough of `pi.on`/`pi.events` for
 * `createHybridEngine`'s `extension` function to register against, plus a way to fire an event by hand. */
function stubPi() {
	const handlers = new Map();
	return {
		events: { on() {}, emit() {} },
		on(event, handler) {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event).push(handler);
		},
		async fire(event) {
			for (const handler of handlers.get(event) ?? []) await handler();
		},
	};
}

test("createHybridEngine: with no active thinking the flag-off cap retains the ordinary allowance", async () => {
	const env = { PI_COC_TURN_BUDGET_MS: "45000" };
	const engine = createHybridEngine({ env });
	assert.equal(await engine.keeperCallCapMs(), computeKeeperCallCapMs(env));
});

test('an actual low-thinking call receives its existing allowance without the experimental flag',async()=>{
 const env={PI_COC_TURN_BUDGET_MS:'45000'},engine=createHybridEngine({env}),pi=stubPi();let level='low';
 pi.getThinkingLevel=()=>level;engine.extension(pi);
 const allowance=(await firstStepThinkingBudget()).callCapMs;
 assert.equal(await engine.keeperCallCapMs(),Math.max(computeKeeperCallCapMs(env),allowance));
 await pi.fire('turn_start');await pi.fire('turn_start');
 assert.equal(await engine.keeperCallCapMs(),Math.max(computeKeeperCallCapMs(env),allowance),'later calls still using thinking are not treated as off');
 level='off';assert.equal(await engine.keeperCallCapMs(),computeKeeperCallCapMs(env));
});

// ---------------------------------------------------------------------------
// The vendored seam itself: a function value for `keeperCallCapMs`, resolved fresh per attempt.
// ---------------------------------------------------------------------------

const IDLE_MS = 30_000; // generous: the idle-progress watchdog must not be what fires here.
const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 20 };

configureHttpDispatcher(IDLE_MS);
