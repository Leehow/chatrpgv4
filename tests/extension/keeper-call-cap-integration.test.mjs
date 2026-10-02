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

test("§135.29's SL-69 addendum, 0005: a Keeper call that never answers is capped and re-sent once, and the re-send is not capped: answering past the cap, it completes", async (t) => {
	const provider = await silentThenLateProvider(t, { lateMs: LATE_MS, prose: PROSE });
	const capRows = [];
	const hybrid = createHybridEngine({ env: process.env, record: (row) => capRows.push(row) });
	const table = await openTable({
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_PRESENT: "[]" },
		runDriver: hybrid.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }],
		settings: { httpIdleTimeoutMs: IDLE_MS, retry: RETRY },
		keeperCallCapMs: CAP_MS,
		onKeeperCallCap: hybrid.onKeeperCallCap,
	});
	t.after(() => table.dispose());
	const runtime = table.session.modelRuntime;
	runtime.registerProvider("stallbox", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-completions", apiKey: "unused",
		models: [{ id: "stall-1", name: "stall", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
	await table.session.setModel(runtime.getModel("stallbox", "stall-1"));
	const events = [];
	table.session.subscribe((event) => events.push(event));

	const prompt = table.session.prompt("I ask him to pull the old clippings on the Corbitt house.").then(() => "ended");
	const outcome = await Promise.race([prompt, new Promise((resolve) => setTimeout(() => resolve("hung"), BOUND_MS))]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended", `the run was still waiting after ${BOUND_MS} ms`);

	assert.equal(provider.requests(), 2, "the capped original and its one re-send");
	const ends = assistantEnds(events);
	assert.match(ends[0].errorMessage, /timed? out|timeout/i, "the overrun is worded to be retried");
	assert.equal(ends[0].stopReason, "error");
	const answered = ends.find((message) => message.stopReason === "stop");
	assert.ok(answered, `the late re-send completed: ${JSON.stringify(ends.map((message) => [message.stopReason, message.errorMessage]))}`);
	assert.ok(JSON.stringify(answered.content).includes(PROSE));
	assert.ok(!ends.some((message) => /second time/.test(message.errorMessage ?? "")), "no overrun ends the step any more");
	assert.equal(events.filter((event) => event.type === "auto_retry_start").length, 1, "exactly one automatic retry");
	const caps = capRows.filter((row) => row.event === "keeper_call_cap");
	assert.deepEqual(caps.map((row) => [row.phase, row.cap_ms]), [["first_byte", CAP_MS]], "one overrun, before the first byte; the re-send is never capped");
});

test("keeperCallCapMs(env): a named default derived from the turn budget, never below its own floor", () => {
	const short = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "10000" });
	assert.equal(short, 20_000, "half of a 10s turn budget (5s) is under the floor, so the floor wins");
	const long = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "120000" });
	assert.equal(long, 60_000, "half of a 120s turn budget is above the floor, so half the budget wins");
	const custom = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "120000", PI_COC_KEEPER_CALL_CAP_FLOOR_MS: "90000" });
	assert.equal(custom, 90_000, "an explicit floor still wins over half the budget when it is larger");
});
