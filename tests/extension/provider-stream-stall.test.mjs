/**
 * Contract §135.29: a provider attempt whose stream answers and then stops producing events ends as a timeout
 * error of that attempt, is retried by Pi's own auto-retry, and the run ends. It never hangs.
 *
 * Found at the SL-02 live gate (2026-09-24, `gate2-haunting-2153`, hybrid-v1, Grok 4.7 build fast through the local
 * proxy): twice on the same input the infer step's provider answered 200 in two seconds and then produced no
 * assistant event for as long as anyone waited -- no `provider-call`, no attempt 2, no `run_end` -- while the agent
 * home's `httpIdleTimeoutMs: 60000` was in force. That setting reaches undici's `bodyTimeout` and it does cut a
 * connection that goes byte-silent (the 60 s `error` rows on retained grok-build tables, and the byte-silent case
 * below). It cannot cut a connection that keeps sending bytes no model event is made of: SSE keep-alive comments, or
 * event types pi-ai does not surface. The legacy loop had the same exposure (§94's 2026-09-17 turn: a 200 whose
 * stream never closed again, the turn `acting` for 23 minutes).
 *
 * The provider here is a real socket speaking the Responses SSE protocol behind Pi's real provider path, with the
 * process dispatcher configured the way Pi's `main` configures it, so the transport idle timeout is in place and
 * the only thing under test is what happens above it.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:net";
import { test } from "node:test";
import { configureHttpDispatcher } from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { customMessages, openTable, waitFor } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

/** The agent home's idle timeout, scaled down: the product writes 60 s (`runtime/launch.ts`). */
const IDLE_MS = 1_500;
const RETRY = { enabled: true, maxRetries: 2, baseDelayMs: 50 };
const ATTEMPTS = RETRY.maxRetries + 1;
/** Every attempt may use its whole idle allowance, plus the backoff and generous slack; a hang runs far past it. */
const BOUND_MS = ATTEMPTS * IDLE_MS + 6_000;

// What Pi's `main` does before any session exists (`configureHttpDispatcher(settings.getHttpIdleTimeoutMs())`).
configureHttpDispatcher(IDLE_MS);

/**
 * A Responses endpoint that answers 200 with one `response.created` event and then says nothing a model event is
 * made of. `keepalive`: an SSE comment every 200 ms, so the socket is never idle; `silent`: no byte at all.
 */
function stallingProvider(t, mode) {
	const sockets = new Set();
	let requests = 0;
	const server = createServer((socket) => {
		sockets.add(socket);
		let received = "";
		let timer;
		socket.on("error", () => {});
		socket.on("close", () => { clearInterval(timer); sockets.delete(socket); });
		socket.on("data", (data) => {
			received += data;
			if (!received.includes("\r\n\r\n")) return;
			received = "";
			requests++;
			// Written by hand: `writeHead()` alone does not put the headers on the wire.
			socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\n\r\n");
			const chunk = (text) => socket.write(`${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`);
			chunk(`event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: `resp-${requests}`, status: "in_progress", output: [] } })}\n\n`);
			if (mode === "keepalive") timer = setInterval(() => chunk(": keep-alive\n\n"), 200);
		});
	});
	t.after(() => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, requests: () => requests })));
}

function answered(batch, exit) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** A table on the stalling provider: hybrid-v1 with the route asking the Keeper (as at the gate), or the legacy loop. */
async function stalledTable(t, { engine, mode }) {
	const provider = await stallingProvider(t, mode);
	const decisions = [];
	const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: { decide: async (batch) => {
		decisions.push(batch);
		return answered(batch, batch.family === ROUTE_FAMILY && decisions.length === 1 ? "ask_llm" : "finish");
	} } }) : undefined;
	const table = await openTable({
		env: hybrid ? { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_PRESENT: "[]" } : { FAKE_KERNEL_PRESENT: "[]" },
		...(hybrid ? { runDriver: hybrid.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }] } : {}),
		settings: { httpIdleTimeoutMs: IDLE_MS, retry: RETRY },
	});
	t.after(() => table.dispose());
	const runtime = table.session.modelRuntime;
	runtime.registerProvider("stallbox", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-responses", apiKey: "unused",
		models: [{ id: "stall-1", name: "stall", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
	await table.session.setModel(runtime.getModel("stallbox", "stall-1"));
	const events = [];
	table.session.subscribe((event) => events.push(event));
	return { table, events, provider };
}

/** Prompt, and wait at most `BOUND_MS` for the run to end. A run still going then is aborted so the test can report it. */
async function promptBounded(table, text) {
	const began = Date.now();
	const prompt = table.session.prompt(text).then(() => "ended");
	const outcome = await Promise.race([prompt, new Promise((resolve) => setTimeout(() => resolve("hung"), BOUND_MS))]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	return { outcome, ms: Date.now() - began };
}

const outageNotices = (session) => customMessages(session, "coc-delivery").filter((message) => message.details?.provider_outage && message.details?.terminal);
const assistantEnds = (events) => events.filter((event) => event.type === "message_end" && event.message.role === "assistant").map((event) => event.message);

test("§135.29: a driven infer whose stream keeps the socket alive but produces no event is cut per attempt, retried, and the run ends undelivered with the provider notice", async (t) => {
	const { table, events, provider } = await stalledTable(t, { engine: "hybrid-v1", mode: "keepalive" });
	const { outcome, ms } = await promptBounded(table, "I ask him to pull the old clippings on the Corbitt house.");
	assert.equal(outcome, "ended", `the run was still waiting on the stalled stream after ${BOUND_MS} ms`);

	const run = events.filter(isRunEvent);
	const inferStart = run.find((event) => event.type === "step_start" && event.kind === "infer");
	const attempts = run.filter((event) => event.type === "step_attempt");
	// One step, several attempts of it: each a row with its own attempt id, never a new step.
	assert.deepEqual(attempts.map((event) => [event.stepId, event.attempt, event.attemptId]),
		Array.from({ length: ATTEMPTS }, (_, index) => [inferStart.stepId, index + 1, `${inferStart.stepId}#a${index + 1}`]));
	assert.equal(provider.requests(), ATTEMPTS, "one provider request per attempt, and no more: the retries are bounded");
	const failed = assistantEnds(events);
	assert.equal(failed.length, ATTEMPTS);
	for (const message of failed) {
		assert.equal(message.stopReason, "error", "a stalled attempt is a provider error, not an abort: Pi retries errors only");
		assert.match(message.errorMessage, /timed? out|timeout/i, "the error is one pi-ai's retry patterns already match");
	}
	assert.equal(events.filter((event) => event.type === "auto_retry_start").length, RETRY.maxRetries);
	assert.ok(ms >= ATTEMPTS * IDLE_MS, `every attempt waited its idle allowance (${ms} ms)`);

	const end = run.at(-1);
	assert.deepEqual([end.type, end.status], ["run_end", "undelivered"]);
	assert.equal(run.find((event) => event.type === "step_end" && event.kind === "infer").status, "unavailable");
	// §38.7: a turn whose provider failed terminally tells the player so, instead of §38's generic line.
	await waitFor(() => outageNotices(table.session).length === 1, { label: "the §38.7 terminal provider notice" });
});

test("§135.29: the same stall on the legacy loop is retried the same way and the run settles", async (t) => {
	const { table, events, provider } = await stalledTable(t, { engine: "legacy", mode: "keepalive" });
	const { outcome } = await promptBounded(table, "I ask him to pull the old clippings on the Corbitt house.");
	assert.equal(outcome, "ended", `the legacy run was still waiting on the stalled stream after ${BOUND_MS} ms`);
	assert.equal(provider.requests(), ATTEMPTS);
	const failed = assistantEnds(events);
	assert.equal(failed.length, ATTEMPTS);
	for (const message of failed) assert.match(`${message.stopReason} ${message.errorMessage}`, /^error .*(timed? out|timeout)/i);
	assert.equal(events.filter(isRunEvent).length, 0, "the legacy loop, not a driven run");
	await waitFor(() => outageNotices(table.session).length === 1, { label: "the §38.7 terminal provider notice" });
});

test("§135.29: a stream that goes byte-silent after its headers ends the same way (the transport half, unchanged)", async (t) => {
	const { table, events, provider } = await stalledTable(t, { engine: "hybrid-v1", mode: "silent" });
	const { outcome } = await promptBounded(table, "I ask him to pull the old clippings on the Corbitt house.");
	assert.equal(outcome, "ended");
	assert.equal(provider.requests(), ATTEMPTS);
	for (const message of assistantEnds(events)) assert.match(`${message.stopReason} ${message.errorMessage}`, /^error .*(terminated|timed? out|timeout)/i);
	assert.equal(events.filter(isRunEvent).at(-1).status, "undelivered");
});
