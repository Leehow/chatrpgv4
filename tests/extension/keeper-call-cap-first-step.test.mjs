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
import { createServer } from "node:net";
import { test } from "node:test";
import { configureHttpDispatcher } from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { openTable, waitFor, customMessages } from "./harness.mjs";
import { createHybridEngine, keeperCallCapMs as computeKeeperCallCapMs } from "../../runtime/jev/hybrid-engine.ts";
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

test("createHybridEngine: the flag off returns the plain ordinary number, not a function -- unchanged from before SL-82", () => {
	const env = { PI_COC_TURN_BUDGET_MS: "45000" };
	const engine = createHybridEngine({ env });
	assert.equal(typeof engine.keeperCallCapMs, "number");
	assert.equal(engine.keeperCallCapMs, computeKeeperCallCapMs(env));
});

test("createHybridEngine: the flag on returns a function sized allowance-on-step-1, ordinary-on-step-2, resetting on new player input", async () => {
	const env = { PI_COC_TURN_BUDGET_MS: "45000", COC_FIRST_STEP_THINKING: "1" };
	const capRows = [];
	const engine = createHybridEngine({ env, record: (row) => capRows.push(row) });
	assert.equal(typeof engine.keeperCallCapMs, "function", "the flag on: a per-call function, not a fixed number");

	const ordinary = computeKeeperCallCapMs(env);
	const allowance = (await firstStepThinkingBudget()).callCapMs;
	assert.ok(allowance > ordinary, "the shipped allowance must exceed the ordinary cap for this test to distinguish them");

	const pi = stubPi();
	engine.extension(pi);

	await pi.fire("before_agent_start"); // new player input: step resets to 0
	await pi.fire("turn_start"); // the turn's first call: step becomes 1
	assert.equal(await engine.keeperCallCapMs(), Math.max(ordinary, allowance), "step 1: the allowance wins");

	await pi.fire("turn_start"); // the turn's second call: step becomes 2
	assert.equal(await engine.keeperCallCapMs(), ordinary, "step 2: the ordinary cap, the allowance never reaches it");

	await pi.fire("turn_start"); // step 3: still ordinary
	assert.equal(await engine.keeperCallCapMs(), ordinary, "step 3: still ordinary");

	await pi.fire("before_agent_start"); // a second player turn: the counter resets
	await pi.fire("turn_start");
	assert.equal(await engine.keeperCallCapMs(), Math.max(ordinary, allowance), "second turn, first call: the allowance wins again");

	// The keeper_call_cap telemetry row carries `step` -- the current counter value at the moment a cap fires.
	engine.onKeeperCallCap("streaming", 12_345);
	const row = capRows.find((r) => r.event === "keeper_call_cap");
	assert.ok(row, "onKeeperCallCap wrote a keeper_call_cap row");
	assert.equal(row.step, 1, "the second turn's first call is step 1");
	assert.equal(row.phase, "streaming");
	assert.equal(row.cap_ms, 12_345);
});

test("createHybridEngine: the flag on, but a step that never reaches isFirstStepOfTurn's boundary (defensive 0) still resolves -- mutation guard on the >= vs <= boundary", async () => {
	// No turn_start fired at all: `step` stays at its initial 0, which `isFirstStepOfTurn` still treats as
	// the first step (§38.7.1's own documented boundary). This pins the `<= 1` reading against a mutation to
	// `< 1` or `=== 1`, which would silently drop this defensive case to the ordinary cap instead.
	const env = { PI_COC_TURN_BUDGET_MS: "45000", COC_FIRST_STEP_THINKING: "1" };
	const engine = createHybridEngine({ env });
	const ordinary = computeKeeperCallCapMs(env);
	const allowance = (await firstStepThinkingBudget()).callCapMs;
	assert.equal(await engine.keeperCallCapMs(), Math.max(ordinary, allowance));
});

// ---------------------------------------------------------------------------
// The vendored seam itself: a function value for `keeperCallCapMs`, resolved fresh per attempt.
// ---------------------------------------------------------------------------

const IDLE_MS = 30_000; // generous: the idle-progress watchdog must not be what fires here.
const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 20 };

configureHttpDispatcher(IDLE_MS);

/** A provider that accepts the connection and then says nothing at all -- never even the response headers. */
function silentProvider(t) {
	const sockets = new Set();
	let requests = 0;
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("error", () => {});
		socket.on("close", () => sockets.delete(socket));
		socket.on("data", (data) => { if (String(data).includes("\r\n\r\n")) requests++; });
	});
	t.after(() => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, requests: () => requests })));
}

const outageNotices = (session) => customMessages(session, "coc-delivery").filter((message) => message.details?.provider_outage && message.details?.terminal);

test("vendored seam (patch 0004): keeperCallCapMs as a function is resolved fresh before every attempt, and the keeper_call_cap row carries step", async (t) => {
	const provider = await silentProvider(t);
	const capRows = [];
	const hybrid = createHybridEngine({ env: process.env, record: (row) => capRows.push(row) });
	// A function whose answer changes call to call -- if the vendored seam cached the first resolution
	// instead of re-resolving per attempt, both provider requests below would be cut at the same cap
	// (1200 ms); resolved fresh, the first is cut at 1200 ms and the retry at 2000 ms.
	let calls = 0;
	const caps = [1_200, 2_000];
	const keeperCallCapMs = () => caps[calls++] ?? caps.at(-1);
	const BOUND_MS = caps[0] + caps[1] + 6_000;

	const table = await openTable({
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_PRESENT: "[]" },
		runDriver: hybrid.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }],
		settings: { httpIdleTimeoutMs: IDLE_MS, retry: RETRY },
		keeperCallCapMs,
		onKeeperCallCap: hybrid.onKeeperCallCap,
	});
	t.after(() => table.dispose());
	const runtime = table.session.modelRuntime;
	runtime.registerProvider("stallbox", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-responses", apiKey: "unused",
		models: [{ id: "stall-1", name: "stall", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
	await table.session.setModel(runtime.getModel("stallbox", "stall-1"));
	const events = [];
	table.session.subscribe((event) => events.push(event));

	const prompt = table.session.prompt("I ask him to pull the old clippings on the Corbitt house.").then(() => "ended");
	const outcome = await Promise.race([prompt, new Promise((resolve) => setTimeout(() => resolve("hung"), BOUND_MS))]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended", `the run was still waiting after ${BOUND_MS} ms; a stale cached cap did not end it`);

	assert.equal(provider.requests(), 2, "exactly two provider requests: the capped original and its one resend");
	assert.equal(calls, 2, "keeperCallCapMs was invoked once per attempt, not once and cached");

	const capEvents = capRows.filter((row) => row.event === "keeper_call_cap");
	assert.equal(capEvents.length, 2, "one keeper_call_cap row per overrun");
	assert.equal(capEvents[0].cap_ms, 1_200, "the first attempt used the freshly resolved first value");
	assert.equal(capEvents[1].cap_ms, 2_000, "the retry used the freshly resolved second value, not the cached first one");
	for (const row of capEvents) assert.equal(typeof row.step, "number", "the row carries step");

	await waitFor(() => outageNotices(table.session).length === 1, { label: "the §38.7 terminal provider notice" });
});
