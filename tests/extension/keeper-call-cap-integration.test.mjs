/**
 * Contract §135.29's SL-69 addendum, at full session integration (the sibling of `tests/extension/
 * provider-stream-stall.test.mjs`'s own coverage of the idle-progress watchdog): a driven infer's
 * provider call that never answers at all is cut at `runtime/jev/hybrid-engine.ts`'s own per-call cap
 * (derived from the turn budget, floored), retried exactly once under the same context, and on a second
 * overrun ends the step without a further automatic retry -- even though the session's own `retry.
 * maxRetries` would otherwise allow more. `httpIdleTimeoutMs` is set generously long here so the idle-
 * progress watchdog never fires first: the cap alone is under test.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:net";
import { test } from "node:test";
import { configureHttpDispatcher } from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { openTable, waitFor, customMessages } from "./harness.mjs";
import { createHybridEngine, keeperCallCapMs as computeKeeperCallCapMs } from "../../runtime/jev/hybrid-engine.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

const IDLE_MS = 30_000; // generous: the idle-progress watchdog must not be what fires here.
const CAP_MS = 1_200;
const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 20 };
/** Two attempts total: the first cap overrun retries once, the second ends the step. Bounded generously. */
const BOUND_MS = 2 * CAP_MS + 6_000;

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
const assistantEnds = (events) => events.filter((event) => event.type === "message_end" && event.message.role === "assistant").map((event) => event.message);

test("§135.29's SL-69 addendum: a driven Keeper call that never answers is capped, retried once, and a second overrun ends the step without exhausting the session's own larger retry budget", async (t) => {
	const provider = await silentProvider(t);
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
	runtime.registerProvider("stallbox", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-responses", apiKey: "unused",
		models: [{ id: "stall-1", name: "stall", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
	await table.session.setModel(runtime.getModel("stallbox", "stall-1"));
	const events = [];
	table.session.subscribe((event) => events.push(event));

	const began = Date.now();
	const prompt = table.session.prompt("I ask him to pull the old clippings on the Corbitt house.").then(() => "ended");
	const outcome = await Promise.race([prompt, new Promise((resolve) => setTimeout(() => resolve("hung"), BOUND_MS))]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended", `the run was still waiting after ${BOUND_MS} ms; the cap did not end it`);

	assert.equal(provider.requests(), 2, "exactly two provider requests: the capped original and its one resend, never a third");
	const failed = assistantEnds(events);
	assert.equal(failed.length, 2);
	assert.match(failed[0].errorMessage, /timed? out|timeout/i, "the first overrun is worded to be retried");
	assert.ok(!/timed? out|timeout|terminated/i.test(failed[1].errorMessage), "the second overrun is worded so nothing retries it again");
	assert.match(failed[1].errorMessage, /second time/);
	for (const message of failed) assert.equal(message.stopReason, "error");

	assert.equal(events.filter((event) => event.type === "auto_retry_start").length, 1, "exactly one automatic retry, never the session's larger maxRetries budget");

	assert.equal(capRows.filter((row) => row.event === "keeper_call_cap").length, 2, "one keeper_call_cap telemetry row per overrun");
	for (const row of capRows.filter((r) => r.event === "keeper_call_cap")) {
		assert.equal(row.phase, "first_byte", "no header ever arrived from this provider, so every overrun is the first_byte phase");
		assert.equal(row.cap_ms, CAP_MS);
	}

	const run = events.filter(isRunEvent);
	const end = run.at(-1);
	assert.deepEqual([end.type, end.status], ["run_end", "undelivered"], "the step ends through the existing no-delivered-evidence fallback (SL-16), not a third automatic retry");
	await waitFor(() => outageNotices(table.session).length === 1, { label: "the §38.7 terminal provider notice" });
});

test("keeperCallCapMs(env): a named default derived from the turn budget, never below its own floor", () => {
	const short = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "10000" });
	assert.equal(short, 20_000, "half of a 10s turn budget (5s) is under the floor, so the floor wins");
	const long = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "120000" });
	assert.equal(long, 60_000, "half of a 120s turn budget is above the floor, so half the budget wins");
	const custom = computeKeeperCallCapMs({ PI_COC_TURN_BUDGET_MS: "120000", PI_COC_KEEPER_CALL_CAP_FLOOR_MS: "90000" });
	assert.equal(custom, 90_000, "an explicit floor still wins over half the budget when it is larger");
});
