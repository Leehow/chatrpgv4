/**
 * Contract §190.3 (ticket TP-03 of `docs/specs/told-position-tickets.md`; amends §143.15): a transient provider failure of
 * the admission lane is asked again once, and every refusal's cause is readable afterwards.
 *
 * Evidence: RD-08 (`rd-accept-blood-01-play`) turn 7, the Keeper's `apply move` to the gas station was refused
 * `admission_unavailable` after one `model_error` in 524 ms (`flapcode API error (429)`), `attempts: 1`; §143.15 retried only a
 * malformed answer, and the Keeper then narrated the drive anyway.
 *
 * The seam: the real `apply` tool path and admission seam, the lane's provider a real local OpenAI-compatible endpoint (so
 * the status a failure carries is the one Pi's own adapter saw on the wire), the harness's fake kernel for the host side and
 * the emitted kernel for the turn record. No Jev key: the lane alone decides.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { ModelRuntime } from "./pi.mjs";
import { runLane } from "../../extensions/lanes/subsession.ts";
import { KernelError } from "../../extensions/kernel/client.ts";
import { clipBytes, refusedMovesOf, reviewAdmission, transientLaneFailure, withRefusedMoves } from "../../extensions/kernel/admission.ts";
import { ADMISSION_TRANSIENT_FALLBACK, admissionTransientBudget, resetAdmissionTransientBudgetCache } from "../../runtime/jev/host-budgets.ts";

const WAIT_MS = 1500; // `admission.transient_retry_ms` as shipped (content/rulesets/coc7/host-budgets.json)
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const MOVE = { kind: "move", to: "the-gas-station" };
const WORDS = "我开车去加油站，问问那几个人。";
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const toolResults = (session, tool) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
	.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));

/**
 * A Chat Completions endpoint that answers request n with `script[n]` (the last step repeats): `{status, body}` an HTTP
 * error, `"drop"` the socket closed before any response, `"hold"` never an answer, any other object a verdict streamed 200.
 */
function laneEndpoint(t, script) {
	const hits = [], sockets = new Set();
	const server = createServer((request, response) => {
		request.on("data", () => {});
		request.on("end", () => {
			hits.push(Date.now());
			const step = script[Math.min(hits.length - 1, script.length - 1)];
			if (step === "drop") { request.socket.destroy(); return; }
			if (step === "hold") return;
			if (step.status) {
				response.writeHead(step.status, { "content-type": "application/json" });
				response.end(JSON.stringify(step.body));
				return;
			}
			const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "l1",
				choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(chunk({ role: "assistant", content: JSON.stringify(step) }) + chunk({}, "stop") + "data: [DONE]\n\n");
		});
	});
	server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
	t.after(() => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, hits })));
}
const LANE_MODEL = { id: "l1", name: "lane", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 };
const registerLane = (registry, port) => registry.registerProvider("lane", { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused", models: [LANE_MODEL] });

/**
 * A table whose admission lane is `lane/l1` on the endpoint; the Keeper proposes the move, then closes the turn. The emitted
 * kernel's table opens with the host's own opening turn (§128), which the Keeper closes first.
 */
async function moveTable(t, endpoint, { env = {}, realKernel = false, close = "你把车开向加油站。" } = {}) {
	const table = await openTable({ realKernel, env: { PI_COC_ADMISSION_MODEL: "lane/l1", ...env },
		responses: [...(realKernel ? [call("narrate", { text: "公路在热浪里发亮。" })] : []),
			call("apply", { effects: [MOVE] }), call("narrate", { text: close }), fauxAssistantMessage("after")] });
	t.after(() => table.dispose());
	registerLane(table.session.modelRuntime, endpoint.port);
	if (realKernel) await waitForIdle(table.session);
	return table;
}

const AUTHORIZED = { verdict: "authorized", grounds: "the player said they drive to the gas station" };

// ---- the retry ----------------------------------------------------------------------------------------------------------

test("§190.3: a 503 then a verdict admits the move: two requests the data's wait apart, attempts 2, the first failure named", async (t) => {
	const endpoint = await laneEndpoint(t, [{ status: 503, body: { error: { message: "upstream overloaded" } } }, AUTHORIZED]);
	const table = await moveTable(t, endpoint);
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	assert.equal(endpoint.hits.length, 2, "the transient failure was asked again once");
	assert.ok(endpoint.hits[1] - endpoint.hits[0] >= WAIT_MS - 50, `the retry waited admission.transient_retry_ms (${endpoint.hits[1] - endpoint.hits[0]} ms)`);
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the move was admitted and applied");
	const [row] = admissionRows(table);
	assert.equal(row.ok, true);
	assert.equal(row.verdict, "authorized");
	assert.equal(row.attempts, 2);
	assert.equal(row.transient_retry.provider_status, 503);
	assert.equal(row.transient_retry.after_ms, WAIT_MS);
	assert.match(row.transient_retry.detail, /503/);
	const [narrate] = kernelCalls(table, "table.narrate");
	assert.equal(narrate.params.refused_moves, undefined, "an admitted move leaves no refused move");
});

test("§190.3: a transport that ended before any response is transient too: the retry admits, the row says how it ended", async (t) => {
	const endpoint = await laneEndpoint(t, ["drop", AUTHORIZED]);
	const table = await moveTable(t, endpoint);
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	assert.equal(endpoint.hits.length, 2);
	assert.equal(kernelCalls(table, "table.apply").length, 1);
	const [row] = admissionRows(table);
	assert.equal(row.attempts, 2);
	assert.equal(row.transient_retry.transport, "ended_before_response");
	assert.equal(row.transient_retry.provider_status, undefined);
});

test("§190.3: a 401 refuses at once, one request; the row carries the status and the provider's message clipped to 200 bytes", async (t) => {
	// A long multi-byte message: the clip is in UTF-8 bytes and never splits a code point.
	const message = "鉴权失败：密钥无效或已过期。".repeat(20);
	const endpoint = await laneEndpoint(t, [{ status: 401, body: { error: { message } } }]);
	const table = await moveTable(t, endpoint, { close: "车没有动。" });
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	assert.equal(endpoint.hits.length, 1, "an authentication failure is not asked again");
	assert.equal(kernelCalls(table, "table.apply").length, 0);
	const [row] = admissionRows(table);
	assert.equal(row.ok, false);
	assert.equal(row.reason, "model_error");
	assert.equal(row.attempts, 1);
	assert.equal(row.provider_status, 401);
	assert.equal(row.transient_retry, undefined);
	assert.ok(row.detail.includes("鉴权失败"), row.detail);
	assert.ok(Buffer.byteLength(row.detail, "utf8") <= 200, `detail is ${Buffer.byteLength(row.detail, "utf8")} bytes`);
	assert.ok(Buffer.byteLength(row.detail, "utf8") > 190, "clipped at the bound, not short of it");
	assert.ok(!row.detail.includes("�"), "no code point was split");
	const [result] = toolResults(table.session, "apply");
	assert.match(result, /^needs: The action review is unavailable/m);
	// §190.3: the refused batch carried a move, so the delivery that closed the turn carries it to the record.
	const [narrate] = kernelCalls(table, "table.narrate");
	assert.deepEqual(narrate.params.refused_moves, [{ to: "the-gas-station", reason: "admission_unavailable" }]);
});

test("§190.3: a timeout is not retried: the provider never answers, the round sends one request and ends review_timeout", async (t) => {
	const endpoint = await laneEndpoint(t, ["hold"]);
	// The cap and the hard cap (twice it) are short, so the round ends on its deadline, never on the provider. The host
	// waits the running round out itself past the cap (§32.12.2's continuation): the row is the round's own outcome.
	const table = await moveTable(t, endpoint, { env: { PI_COC_ADMISSION_TIMEOUT_MS: "600" }, close: "车没有动。" });
	await table.session.prompt(WORDS);
	await waitForIdle(table.session, { timeoutMs: 20_000 });
	assert.equal(endpoint.hits.length, 1, "a round cut at its deadline is not asked again");
	assert.equal(kernelCalls(table, "table.apply").length, 0);
	const [row] = admissionRows(table);
	assert.equal(row.verdict, "review_timeout");
	assert.equal(row.host_continued, true);
	assert.equal(row.attempts, 1);
	assert.equal(row.transient_retry, undefined, "a timeout is not a transient provider failure");
	assert.equal(row.provider_status, undefined);
	const [narrate] = kernelCalls(table, "table.narrate");
	assert.deepEqual(narrate.params.refused_moves, [{ to: "the-gas-station", reason: "review_timeout" }], "the timed-out move was refused");
});

test("§190.3: a transient failure with no time left for the wait is not retried; the provider's failure stands", async (t) => {
	const endpoint = await laneEndpoint(t, [{ status: 503, body: { error: { message: "upstream overloaded" } } }, AUTHORIZED]);
	// A 600 ms cap makes the round's deadline (the hard cap) 1,200 ms, shorter than the shipped 1,500 ms wait.
	const table = await moveTable(t, endpoint, { env: { PI_COC_ADMISSION_TIMEOUT_MS: "600" }, close: "车没有动。" });
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	assert.equal(endpoint.hits.length, 1, "no retry was started past the round's deadline");
	assert.equal(kernelCalls(table, "table.apply").length, 0);
	const [row] = admissionRows(table);
	assert.equal(row.ok, false);
	assert.equal(row.reason, "model_error");
	assert.equal(row.provider_status, 503);
	assert.equal(row.attempts, 1);
	assert.equal(row.transient_retry.skipped, "no_time");
	assert.equal(row.transient_retry.provider_status, 503);
});

// ---- the turn record --------------------------------------------------------------------------------------------------

test("§190.3: a refused move lands on the emitted kernel's turn record as refused_moves; the record is the delivery's", async (t) => {
	const endpoint = await laneEndpoint(t, [{ status: 401, body: { error: { message: "bad key" } } }]);
	const table = await moveTable(t, endpoint, { realKernel: true, close: "车没有动，你还站在原地。" });
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	assert.equal(endpoint.hits.length, 1);
	const dir = join(table.workspace, ".coc/campaigns/test-camp/turns");
	const records = readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
	const record = records.find((entry) => entry.player_text === WORDS);
	assert.ok(record, `a turn record for the player's words: ${JSON.stringify(records.map((entry) => entry.player_text))}`);
	assert.equal(record.closed_by, "narrate");
	assert.deepEqual(record.refused_moves, [{ to: "the-gas-station", reason: "admission_unavailable" }]);
	assert.ok(records.filter((entry) => entry !== record).every((entry) => entry.refused_moves === undefined), "no other turn carries one");
});

test("§190.3: the host's implicit close carries the turn's refused moves to the kernel too", async (t) => {
	const draft = "车没有动。你握着方向盘坐在原地，热风从半开的车窗灌进来，公路尽头的加油站在热浪里晃动，像一块被晒软的铁皮。";
	const table = await openTable({ env: { PI_COC_ADMISSION_MODEL: "nobody/home" },
		responses: [call("apply", { effects: [{ kind: "time", minutes: 5, why: "a pause" }, MOVE] }), fauxAssistantMessage(draft)] });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	const [narrate] = kernelCalls(table, "table.narrate");
	assert.equal(narrate?.params.implicit, true, "the host closed the turn");
	assert.deepEqual(narrate.params.refused_moves, [{ to: "the-gas-station", reason: "admission_unavailable" }]);
});

test("§190.3: the refusal budget's fallback narrate carries the turn's refused moves, at most sixteen", async (t) => {
	// Twenty moves to twenty places, each refused at admission (no lane model): the refusal budget cuts the run and the host
	// closes the turn with its fallback narrate (§135.11.3).
	const moves = Array.from({ length: 20 }, (_, i) => fauxToolCall("apply", { effects: [{ kind: "move", to: `place-${i + 1}` }] }, { id: `m${i + 1}` }));
	const table = await openTable({ env: { PI_COC_ADMISSION_MODEL: "nobody/home" }, responses: [fauxAssistantMessage(moves, { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	const fallback = table.telemetry().filter((row) => row.event === undefined && row.tool === "narrate" && row.lane === "delivery");
	assert.deepEqual(fallback.map((row) => row.reason), ["refusal_budget_fallback"], JSON.stringify(fallback));
	const [narrate] = kernelCalls(table, "table.narrate");
	const refused = narrate.params.refused_moves;
	assert.ok(refused.length >= 2 && refused.length <= 16, `the refused moves rode the fallback: ${JSON.stringify(refused)}`);
	assert.deepEqual(refused[0], { to: "place-1", reason: "admission_unavailable" });
});

// ---- the lane runner reads what the request saw --------------------------------------------------------------------------

async function laneRuntime(t, port) {
	const home = mkdtempSync(join(tmpdir(), "transient-lane-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, modelsStorePath: join(home, "models.json"), refreshOnCreate: false });
	registerLane(runtime, port);
	const model = runtime.getModel("lane", "l1");
	return (options = {}) => runLane({ ctx: { model, modelRegistry: runtime, sessionManager: { getSessionId: () => undefined } }, timeoutMs: 5000,
		envName: "UNUSED_TRANSIENT_LANE_MODEL", lane: "transient-test", systemPrompt: "Answer one JSON object.", input: "Answer.", shape: (value) => value,
		observeTransport: true, ...options });
}

test("§190.3 runLane: a failure carries the HTTP status or that the transport ended; nothing when not asked or when its own signal aborted", async (t) => {
	const endpoint = await laneEndpoint(t, [{ status: 429, body: { detail: "Rate limit exceeded" } }, "drop", { status: 429, body: {} }, "hold"]);
	const lane = await laneRuntime(t, endpoint.port);
	const limited = await lane();
	assert.equal(limited.reason, "model_error");
	assert.deepEqual(limited.transport, { status: 429 });
	assert.equal(transientLaneFailure(limited), true);
	const dropped = await lane();
	assert.deepEqual(dropped.transport, { endedBeforeResponse: true });
	assert.equal(transientLaneFailure(dropped), true);
	const unasked = await lane({ observeTransport: false });
	assert.equal(unasked.reason, "model_error");
	assert.equal(unasked.transport, undefined, "a lane that did not ask is handed no fetch");
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 200);
	const aborted = await lane({ signal: controller.signal });
	assert.equal(aborted.ok, false);
	assert.equal(aborted.transport, undefined, "a round its own signal cut did not see the transport end");
	assert.equal(transientLaneFailure(aborted), false);
});

test("§190.3 transientLaneFailure: only 429, 5xx and a transport that ended; never auth, a timeout, a missing model or a malformed answer", () => {
	const failed = (reason, transport) => ({ ok: false, reason, detail: "x", ms: 1, ...(transport ? { transport } : {}) });
	for (const status of [429, 500, 502, 503, 504, 529, 599]) assert.equal(transientLaneFailure(failed("model_error", { status })), true, String(status));
	for (const status of [200, 400, 401, 403, 404, 408, 422, 600]) assert.equal(transientLaneFailure(failed("model_error", { status })), false, String(status));
	assert.equal(transientLaneFailure(failed("model_error", { endedBeforeResponse: true })), true);
	assert.equal(transientLaneFailure(failed("model_error")), false, "nothing observed is not transient");
	assert.equal(transientLaneFailure(failed("timeout", { status: 503 })), false);
	assert.equal(transientLaneFailure(failed("model_unavailable")), false);
	assert.equal(transientLaneFailure(failed("bad_output", { status: 200 })), false);
	assert.equal(transientLaneFailure({ ok: true, value: {}, ms: 1, model: "m", raw: "{}" }), false);
	assert.equal(clipBytes("abc", 200), "abc");
	assert.equal(clipBytes("鉴权".repeat(100), 200), "鉴权".repeat(33), "66 three-byte code points fit in 200 bytes");
});

test("§190.3 refusedMovesOf: each move of a refused apply batch, with the refusal's reason; never a pending review or a resolve", () => {
	const refusal = (reason) => new KernelError({ code: "needs", message: "refused", details: { reason } });
	const effects = [{ kind: "time", minutes: 10 }, MOVE, { kind: "move", to: "  the-motel  " }];
	assert.deepEqual(refusedMovesOf("apply", effects, refusal("action_not_authorized")),
		[{ to: "the-gas-station", reason: "action_not_authorized" }, { to: "the-motel", reason: "action_not_authorized" }]);
	assert.deepEqual(refusedMovesOf("apply", effects, refusal("review_pending")), [], "a pending review is not a refusal");
	assert.deepEqual(refusedMovesOf("resolve", effects, refusal("admission_unavailable")), []);
	assert.deepEqual(refusedMovesOf("apply", effects, new Error("not a refusal")), []);
	assert.deepEqual(refusedMovesOf("apply", effects, new KernelError({ code: "invalid_params", message: "x" })),
		[{ to: "the-gas-station", reason: "invalid_params" }, { to: "the-motel", reason: "invalid_params" }], "no details.reason: the code");
	const one = { to: "the-gas-station", reason: "admission_unavailable" };
	assert.deepEqual(withRefusedMoves([one], [one, { ...one, reason: "review_timeout" }]), [one, { ...one, reason: "review_timeout" }]);
	const many = Array.from({ length: 20 }, (_, index) => ({ to: `place-${index}`, reason: "action_not_authorized" }));
	assert.equal(withRefusedMoves([], many).length, 16);
});

test("§190.3: the wait is the data's: a content root that says 300 ms is waited 300 ms, not the shipped 1500", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "transient-root-"));
	mkdirSync(join(root, "rulesets", "coc7"), { recursive: true });
	writeFileSync(join(root, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ admission: { transient_retry_ms: 300 } }));
	const before = process.env.PI_COC_CONTENT_ROOT;
	process.env.PI_COC_CONTENT_ROOT = root;
	resetAdmissionTransientBudgetCache();
	t.after(() => {
		if (before === undefined) delete process.env.PI_COC_CONTENT_ROOT; else process.env.PI_COC_CONTENT_ROOT = before;
		resetAdmissionTransientBudgetCache();
		rmSync(root, { recursive: true, force: true });
	});
	const endpoint = await laneEndpoint(t, [{ status: 429, body: { detail: "Rate limit exceeded" } }, AUTHORIZED]);
	const home = mkdtempSync(join(tmpdir(), "transient-review-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, modelsStorePath: join(home, "models.json"), refreshOnCreate: false });
	registerLane(runtime, endpoint.port);
	const outcome = await reviewAdmission({ ctx: { model: runtime.getModel("lane", "l1"), modelRegistry: runtime, sessionManager: { getSessionId: () => undefined } },
		timeoutMs: 26_000, record: () => {}, proposal: { tool: "apply", key: "move", lines: ['apply move: to="the-gas-station"'], kinds: ["move"] },
		context: { turn: 7, playerText: WORDS, investigators: [{ name: "Jack" }], present: [], delivered: [], landed: [], refused: [] } });
	assert.equal(outcome.ok, true, JSON.stringify(outcome));
	assert.equal(outcome.verdict.verdict, "authorized");
	assert.equal(outcome.meta.attempts, 2);
	assert.equal(outcome.meta.transient_retry.after_ms, 300);
	assert.equal(outcome.meta.transient_retry.provider_status, 429);
	const gap = endpoint.hits[1] - endpoint.hits[0];
	assert.ok(gap >= 250 && gap < 1200, `the retry waited the data's 300 ms (${gap} ms)`);
});

test("§190.3: admission.transient_retry_ms is data, read from the content root and falling back to 1500", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "transient-budget-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "rulesets", "coc7"), { recursive: true });
	const write = (value) => writeFileSync(join(root, "rulesets", "coc7", "host-budgets.json"), JSON.stringify(value));
	write({ admission: { transient_retry_ms: 250 } });
	assert.deepEqual(await admissionTransientBudget(root), { retryMs: 250 });
	write({ admission: { transient_retry_ms: -1 } });
	assert.deepEqual(await admissionTransientBudget(root), { retryMs: 1500 });
	write({});
	assert.deepEqual(await admissionTransientBudget(root), { retryMs: 1500 });
	assert.deepEqual(await admissionTransientBudget(join(root, "missing")), ADMISSION_TRANSIENT_FALLBACK);
	assert.equal((await admissionTransientBudget()).retryMs, WAIT_MS, "the shipped value");
});
