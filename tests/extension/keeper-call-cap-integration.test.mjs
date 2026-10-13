/**
 * Contract §135.29's SL-69 addendum, at full session integration (the sibling of `tests/extension/
 * provider-stream-stall.test.mjs`'s own coverage of the idle-progress watchdog): a driven infer's
 * provider call that never answers at all is cut at `runtime/jev/hybrid-engine.ts`'s own per-call cap
 * (derived from the turn budget, floored) and re-sent once under the same context. Since patch 0005
 * (owner, 2026-10-02: speed comes from optimisation, never from stopping a call) the re-send has no cap:
 * a provider that answers it late is waited for and the step completes. `httpIdleTimeoutMs` is set
 * generously long here so the idle-progress watchdog never fires first: the cap alone is under test.
 */
import { strict as assert } from "node:assert";
import { silentThenLateProvider } from "./fixtures/late-provider.mjs";
import { test } from "node:test";
import { configureHttpDispatcher } from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { openTable } from "./harness.mjs";
import { createHybridEngine, keeperCallCapMs as computeKeeperCallCapMs } from "./hybrid-engine-fixture.mjs";

const IDLE_MS = 30_000; // generous: the idle-progress watchdog must not be what fires here.
const CAP_MS = 1_200;
const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 20 };
/** The re-send answers only after this long: past the cap, so a capped re-send would have been cut. */
const LATE_MS = 2 * CAP_MS + 400;
/** The capped original, then the late re-send. Bounded generously. */
const BOUND_MS = CAP_MS + LATE_MS + 6_000;
const PROSE = "The clerk pulls three yellowed folders and sets them on the counter without a word.";

configureHttpDispatcher(IDLE_MS);

const assistantEnds = (events) => events.filter((event) => event.type === "message_end" && event.message.role === "assistant").map((event) => event.message);

test("keeperCallCapMs(env): a named default derived from the turn budget, never below its own floor", () => {
	const short = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "10000" });
	assert.equal(short, 20_000, "half of a 10s turn budget (5s) is under the floor, so the floor wins");
	const long = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "120000" });
	assert.equal(long, 60_000, "half of a 120s turn budget is above the floor, so half the budget wins");
	const custom = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "120000", PI_COC_KEEPER_CALL_CAP_FLOOR_MS: "90000" });
	assert.equal(custom, 90_000, "an explicit floor still wins over half the budget when it is larger");
});
