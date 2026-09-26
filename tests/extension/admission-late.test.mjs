/**
 * SL-24, a review that runs out of time is not a refusal (contract §32.12.2; the owner's ruling after the 20-turn long
 * gate, 2026-09-24).
 *
 * - The lane and the typed family start together and the first sufficient verdict wins: a typed fast-path admission does
 *   not wait for a slow lane, and a lane faster than Jev does not wait for Jev.
 * - A lane answer without grounds is no verdict: it neither admits nor refuses and is not an outage.
 * - At the cap (13 s by default, measured) a bookkeeping-only batch typed admitting at 0.70 or above is admitted
 *   `typed_late`; anything else is returned `review_pending` with the typed reading, the lane still running to the hard
 *   cap (twice the cap) for the Keeper's one resend, which collects it.
 *
 * The seam: the real `apply`/`resolve` tools, the real admission seam and shared decision adapter, a controlled typed
 * endpoint behind `fetch`, the harness's scripted `admission/a1` lane (delayed where the order matters), and a real
 * socket that answers 200 and then trickles for a lane that never produces a verdict.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:net";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor } from "./harness.mjs";
import {
	ADMISSION_LATE_DEFAULT_MIN_CONFIDENCE,
	DEFAULT_ADMISSION_TIMEOUT_MS,
	REVIEW_PENDING,
	REVIEW_TIMEOUT,
	admissionHardCapMs,
	admissionLateMinConfidence,
	admissionTimeoutMs,
	lateAdmission,
	lateEligibleBatch,
} from "../../extensions/kernel/admission.ts";

const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A scripted lane answer that arrives after `ms`: the order of the two reviewers is then the test's, not the scheduler's. */
const slowVerdict = (row, ms) => async () => { await sleep(ms); return fauxAssistantMessage(JSON.stringify(row)); };
const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/** The typed endpoint: `lines[i]` is line i's `{verdict, confidence}`, answered after `delayMs`. */
function installJev(t, lines, delayMs = 0) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		if (delayMs) await sleep(delayMs);
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria), index = Number(key.split("_")[1]), line = lines[index] ?? lines[0];
			const choice = key.startsWith("verdict_") ? line.verdict : key.startsWith("missing_") ? (line.missing ?? "none") : body.state.playerWords?.[0]?.alias ?? "none";
			const confidence = key.startsWith("verdict_") ? line.confidence : 0.97;
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}
function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = [call("narrate", { text: "你说明了来意。" }), fauxAssistantMessage("after")];
const bookkeeping = [{ kind: "move", to: "newspaper-morgue", travel_minutes: 30 }, { kind: "clue", clue: "globe-unpublished-story" }];
const persuade = { action: { intent: "social", skill: "Persuade", target: "Ruth Blake", goal: "请她调出旧剪报", method: "说明来意" } };
const WORDS = "我去环球报的剪报室查那栋房子的旧闻";

/** A Chat Completions endpoint that answers 200 at once and then trickles one character every 150 ms, never a verdict. */
function tricklingProvider(t) {
	const sockets = new Set();
	let requests = 0;
	const server = createServer((socket) => {
		sockets.add(socket);
		let received = "", timer;
		socket.on("error", () => {});
		socket.on("close", () => { clearInterval(timer); sockets.delete(socket); });
		socket.on("data", (data) => {
			received += data;
			if (!received.includes("\r\n\r\n")) return;
			received = "";
			requests++;
			socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\n\r\n");
			const chunk = (text) => socket.write(`${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`);
			const delta = (content) => chunk(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "trickle-1",
				choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
			delta('{"verdict":"not_authorized","grounds":"');
			timer = setInterval(() => delta("a"), 150);
		});
	});
	t.after(() => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, requests: () => requests })));
}
function registerTrickle(table, port) {
	table.session.modelRuntime.registerProvider("trickle", { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused",
		models: [{ id: "trickle-1", name: "trickle", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
}
/**
 * SL-87: a manual clock (the `TaskClock` shape: `now` and `schedule`) for a test whose subject is the review's wall-clock
 * budget. Time moves only when the test moves it; a timer scheduled on it fires when an advance reaches it. `reads()` counts
 * the readings taken, so the test can see that a waiter has taken its start.
 */
function manualClock(start = 1_000_000) {
	let t = start, reads = 0;
	const timers = new Set();
	const clock = {
		now: () => { reads++; return t; },
		schedule(callback, delayMs) {
			const timer = { at: t + Math.max(0, delayMs), callback };
			timers.add(timer);
			return () => { timers.delete(timer); };
		},
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
		/** Resolves when the clock reaches `at`. */
		until: (at) => new Promise((resolve) => { clock.schedule(resolve, at - t); }),
	};
	return clock;
}
async function promptWithin(table, text, limitMs) {
	const prompt = table.session.prompt(text);
	const outcome = await Promise.race([prompt.then(() => "ended"), sleep(limitMs).then(() => "hung")]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	return outcome;
}

// ---- the measured defaults and the pure late decision ------------------------------------------------------------------

test("§32.12.2: the cap is the measured 13 s, the lane's hard cap twice it, the late threshold the measured 0.70; each read per review", () => {
	assert.equal(DEFAULT_ADMISSION_TIMEOUT_MS, 13_000);
	assert.equal(admissionTimeoutMs({}), 13_000);
	assert.equal(admissionTimeoutMs({ PI_COC_ADMISSION_TIMEOUT_MS: "1500" }), 1500);
	assert.equal(admissionHardCapMs(13_000), 26_000);
	assert.equal(ADMISSION_LATE_DEFAULT_MIN_CONFIDENCE, 0.7);
	assert.equal(admissionLateMinConfidence({}), 0.7);
	assert.equal(admissionLateMinConfidence({ PI_COC_ADMISSION_LATE_MIN_CONFIDENCE: "0.8" }), 0.8);
	assert.equal(admissionLateMinConfidence({ PI_COC_ADMISSION_LATE_MIN_CONFIDENCE: "7" }), 0.7);
	assert.equal(admissionLateMinConfidence({ PI_COC_ADMISSION_LATE_MIN_CONFIDENCE: "off" }), undefined);
});

test("§32.12.2 lateAdmission: only a bookkeeping-only batch typed admitting every line at the threshold is admitted late", () => {
	const apply = (kinds) => ({ tool: "apply", key: kinds.join("+"), lines: kinds.map((kind) => `apply ${kind}: x`), kinds });
	const typed = (verdict, confidence) => ({ status: "decided", verdict, confidence, lineVerdicts: [verdict], grounds: "Decided by the player's words" });
	const reason = (proposal, reading, env = {}) => { const late = lateAdmission(proposal, reading, env); return late.ok ? late.verdict.path : late.reason; };
	// The owner's kinds, cash included; the non-triggering kinds ride along.
	assert.equal(reason(apply(["move", "person", "person"]), typed("authorized", 0.72)), "typed_late");
	assert.equal(reason(apply(["clue", "time", "threat"]), typed("entailed", 0.7)), "typed_late");
	assert.equal(reason(apply(["cash", "define"]), typed("authorized", 0.9)), "typed_late");
	assert.equal(reason(apply(["handout"]), typed("not_player_action", 0.95)), "typed_late");
	// Everything else is pending.
	assert.equal(reason(apply(["clue", "cash", "item", "time", "person"]), typed("authorized", 0.99)), "not_bookkeeping", "turn 1's batch carries an item");
	assert.equal(reason({ tool: "resolve", key: "r", lines: ["resolve"] }, typed("authorized", 0.99)), "not_bookkeeping");
	assert.equal(reason(apply(["threat"]), typed("authorized", 0.99)), "not_bookkeeping", "no triggering kind at all");
	assert.equal(reason(apply(["move"]), typed("authorized", 0.69)), "low_confidence");
	assert.equal(reason(apply(["move"]), typed("not_authorized", 0.99)), "typed_refusal");
	assert.equal(reason(apply(["move"]), typed("uncertain", 0.99)), "typed_refusal");
	assert.equal(reason(apply(["move"]), { status: "fallback", reason: "unconfigured" }), "no_typed_verdict");
	assert.equal(reason(apply(["move"]), undefined), "no_typed_verdict");
	assert.equal(reason(apply(["move"]), typed("authorized", 0.99), { PI_COC_ADMISSION_LATE_MIN_CONFIDENCE: "off" }), "late_off");
	const late = lateAdmission(apply(["move"]), typed("entailed", 0.8), {});
	assert.deepEqual(late, { ok: true, minConfidence: 0.7, verdict: { verdict: "entailed", grounds: "Decided by the player's words", reviewer: "jev", path: "typed_late" } });
	assert.equal(lateEligibleBatch(apply(["move", "map"])), false, "map is not among the owner's kinds");
});

// ---- the first sufficient verdict wins -----------------------------------------------------------------------------------

test("§32.12.2: a typed fast-path admission stands without waiting for a slow lane, whose refusal never lands", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.95 }, { verdict: "entailed", confidence: 0.9 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: bookkeeping }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only interest", missing: "which archive" }, 3000)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(kernelCalls(table, "table.apply").length, 1, "admitted on the typed verdict");
	const [row] = admissionRows(table);
	assert.equal(row.path, "typed");
	assert.equal(row.typed_rule, "fast_path");
	assert.ok(row.ms < 2000, `the review did not wait for the lane (${row.ms} ms)`);
});

test("§32.12.2: a lane faster than Jev stands without waiting for Jev; the row says the lane came first", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.99 }, { verdict: "authorized", confidence: 0.99 }], 2500);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: bookkeeping }), ...close],
		laneResponses: { admission: [verdict({ verdict: "not_authorized", grounds: "only interest in the papers", missing: "which archive to visit" })] } });
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stands");
	const [row] = admissionRows(table);
	assert.equal(row.path, "lane");
	assert.equal(row.verdict, "not_authorized");
	assert.equal(row.jev_fallback, "lane_first");
	assert.ok(row.ms < 2000, `the review did not wait for Jev (${row.ms} ms)`);
});

// ---- a verdict without grounds is no verdict -----------------------------------------------------------------------------

test("§32.12.2: a lane refusal without grounds refuses nothing and is no outage: the call is pending, and its resend runs the review once more", async (t) => {
	const table = await openTable({ responses: [call("resolve", persuade), call("resolve", persuade), ...close],
		laneResponses: { admission: [verdict({ verdict: "not_authorized", grounds: "  " }), verdict({ verdict: "authorized", grounds: "the player asked her for the clippings" })] } });
	t.after(() => table.dispose());
	await table.session.prompt("我说明来意，请她帮忙调出科比特宅这些年的旧剪报。");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.cause ?? null, row.resend ?? null]),
		[[REVIEW_PENDING, "no_grounds", null], ["authorized", null, true]]);
	assert.equal(rows[0].lane_no_grounds, true);
	assert.equal(rows[0].late_rule, "not_bookkeeping");
	assert.equal(table.lanes.admission.requests().length, 2, "the resend ran the review once more");
	assert.equal(kernelCalls(table, "table.resolve").length, 1, "the resend's verdict with grounds admitted it");
	assert.ok(!rows.some((row) => row.ok === false), "not an outage");
	const [first] = toolResultTexts(table.session, "resolve");
	assert.match(first, /^needs: The action review has not answered within its 13 s cap/m);
	assert.doesNotMatch(first, /action_not_authorized/);
});

test("§32.12.2: a bookkeeping batch whose lane answered without grounds is admitted late on a typed admission at the threshold", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.8 }, { verdict: "entailed", confidence: 0.75 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: bookkeeping }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(kernelCalls(table, "table.apply").length, 1);
	const [row] = admissionRows(table);
	assert.equal(row.path, "typed_late");
	assert.equal(row.reviewer, "jev");
	assert.equal(row.lane_no_grounds, true);
	assert.equal(row.late_min_confidence, 0.7);
	assert.equal(row.confidence, 0.75);
});

// ---- at the cap -------------------------------------------------------------------------------------------------------------

test("§32.12.2: at the cap a bookkeeping batch typed 0.72 is admitted typed_late within cap + 1 s; the lane runs on to the hard cap and leaves its late row", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.8 }, { verdict: "entailed", confidence: 0.72 }]);
	const provider = await tricklingProvider(t);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [call("apply", { effects: bookkeeping }), ...close] });
	t.after(() => table.dispose());
	registerTrickle(table, provider.port);
	assert.equal(await promptWithin(table, WORDS, 15_000), "ended");
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the batch landed");
	const [row] = admissionRows(table);
	assert.equal(row.verdict, "authorized");
	assert.equal(row.path, "typed_late");
	assert.equal(row.late_rule, "typed_late");
	assert.equal(row.cap_ms, 1500);
	assert.equal(row.hard_cap_ms, 3000);
	assert.ok(row.ms >= 1500 && row.ms < 2500, `admitted at the cap (${row.ms} ms)`);
	// The lane round is not abandoned at the cap: it runs to the hard cap and says what it came to.
	let late;
	for (let waited = 0; waited < 5000 && !late; waited += 100) { await sleep(100); late = table.telemetry().find((entry) => entry.lane === "admission-late"); }
	assert.equal(late?.answered, "typed_late");
	assert.equal(late?.verdict, REVIEW_TIMEOUT, "the trickle never produced a verdict by the hard cap");
});

test("§32.12.2: at the cap a resolve is returned review_pending with the typed reading; nothing is settled and the run goes on", async (t) => {
	installJev(t, [{ verdict: "not_authorized", confidence: 0.64, missing: "target" }]);
	const provider = await tricklingProvider(t);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [call("resolve", persuade), ...close] });
	t.after(() => table.dispose());
	registerTrickle(table, provider.port);
	assert.equal(await promptWithin(table, "我说明来意，请她帮忙调出科比特宅这些年的旧剪报。", 15_000), "ended");
	assert.equal(kernelCalls(table, "table.resolve").length, 0);
	const [row] = admissionRows(table);
	assert.equal(row.verdict, REVIEW_PENDING);
	assert.equal(row.admitted, false);
	assert.equal(row.cause, "cap");
	assert.equal(row.late_rule, "not_bookkeeping");
	assert.equal(row.typed.verdict, "not_authorized");
	assert.equal(row.typed.confidence, 0.64);
	assert.ok(row.ms >= 1500 && row.ms < 2500, `returned at the cap (${row.ms} ms)`);
	const [text] = toolResultTexts(table.session, "resolve");
	assert.match(text, /^needs: The action review has not answered within its 1\.5 s cap/m);
	assert.match(text, /Resend this identical call once, unchanged/);
	assert.match(text, /^typed: \{"verdict":"not_authorized","confidence":0\.64/m, "the Keeper reads the typed reading beside the pending refusal");
	assert.equal(table.telemetry().find((entry) => entry.tool === "resolve" && entry.ok === false)?.reason, REVIEW_PENDING);
	assert.ok(table.telemetry().some((entry) => entry.tool === "narrate" && entry.ok), "the run went on to the delivery");
	assert.equal(table.entries("coc-admission-status").length, 0, "not an outage");
});

test("§32.12.2: the Keeper's resend collects the lane that answered after the cap, and its verdict settles the call", async (t) => {
	// SL-87: the subject is a wall-clock budget -- the cap, the round (the hard cap, twice the cap), a verdict landing inside
	// the round, and a resend that waits only for the rest of it -- so the review and the resend run on a manual clock
	// (`coc:test-admission-clock`, the kernel extension's test-only seam) and nothing sleeps. On a loaded box the real 1 s /
	// 1.6 s version left the verdict 400 ms to land inside its round, and it did not (`review_timeout`).
	const CAP_MS = 1000, VERDICT_MS = 1600, HARD_CAP_MS = admissionHardCapMs(CAP_MS);
	const clock = manualClock(), T0 = clock.now();
	let laneAsked = false, resendAt;
	// The lane's verdict is due 1.6 s after the round began, on the clock.
	const verdictOnClock = (row) => async () => { laneAsked = true; await clock.until(T0 + VERDICT_MS); return verdict(row); };
	// The Keeper resends once it has read the pending refusal; what the clock had been read by then is marked.
	const resend = () => { resendAt = clock.reads(); return call("resolve", persuade); };
	const table = await openTable({ env: { PI_COC_ADMISSION_TIMEOUT_MS: String(CAP_MS) },
		responses: [call("resolve", persuade), resend, ...close],
		laneResponses: { admission: [verdictOnClock({ verdict: "authorized", grounds: "the player asked her for the clippings" })] } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt("我说明来意，请她帮忙调出科比特宅这些年的旧剪报。").finally(() => { ended = true; });
	await waitFor(() => laneAsked, { timeoutMs: 60_000, label: "the review's lane round" });
	// The round is running and its times are all on the clock: the cap, the verdict, and the round's own end (the hard cap).
	for (const at of [CAP_MS, VERDICT_MS, HARD_CAP_MS])
		assert.ok(clock.due().includes(T0 + at), `a timer due ${at} ms into the review (${clock.due().map((due) => due - T0)})`);
	clock.advanceTo(T0 + CAP_MS);
	// The call goes back pending at the cap; the Keeper resends it. Nothing else reads the review's clock between the
	// Keeper's resend and the resend taking its start, right before it waits on the round.
	await waitFor(() => resendAt !== undefined && clock.reads() > resendAt, { timeoutMs: 60_000, label: "the resend waiting on the round" });
	clock.advanceTo(T0 + VERDICT_MS);
	// The rest of the run. A timer due past the round's end can only be a resend waiting longer than the round: once the
	// round has settled (nothing of it is still scheduled), run it, so such a wait shows in `resend_wait_ms` instead of
	// hanging the test. The round's own timers are never forced.
	for (const deadline = Date.now() + 60_000; !ended && Date.now() < deadline;) {
		const due = clock.due(), next = due.find((at) => at > T0 + HARD_CAP_MS);
		if (next !== undefined && !due.some((at) => at <= T0 + HARD_CAP_MS)) clock.advanceTo(next);
		await sleep(10);
	}
	assert.ok(ended, "the run ended");
	await prompt;
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.resend ?? false, row.path]), [[REVIEW_PENDING, false, "lane"], ["authorized", true, "lane"]]);
	assert.equal(rows[0].ms, CAP_MS, "returned pending at the cap");
	assert.equal(table.lanes.admission.requests().length, 1, "one review, collected by the resend");
	assert.ok(rows[1].resend_wait_ms < CAP_MS * 1.5, `the resend waited only for the rest of the round (${rows[1].resend_wait_ms} ms)`);
	assert.equal(rows[1].resend_wait_ms, VERDICT_MS - CAP_MS, "from the cap, where it resent, to the verdict");
	assert.equal(rows[1].lane_ms, VERDICT_MS, "the round answered 1.6 s in, inside its 2 s");
	assert.equal(rows[1].grounds, "the player asked her for the clippings");
	assert.equal(kernelCalls(table, "table.resolve").length, 1, "the resend landed");
	assert.ok(!table.telemetry().some((entry) => entry.lane === "admission-late"), "a collected round leaves no late row");
});

// ---- telemetry --------------------------------------------------------------------------------------------------------------

test("§32.12.2: an admitting row carries its grounds and the proposed lines, as a refusing row does", async (t) => {
	const table = await openTable({ responses: [call("apply", { effects: [{ kind: "time", minutes: 15, why: "search" }] }), ...close],
		laneResponses: { admission: [verdict({ verdict: "not_player_action", grounds: "the minutes a chosen search takes" })] } });
	t.after(() => table.dispose());
	await table.session.prompt("我把储物柜后面和地板上的木板撬开，找地下室的入口。");
	const [row] = admissionRows(table);
	assert.equal(row.admitted, true);
	assert.equal(row.grounds, "the minutes a chosen search takes");
	assert.deepEqual(row.proposed, ['apply time: minutes=15; why="search"']);
});
