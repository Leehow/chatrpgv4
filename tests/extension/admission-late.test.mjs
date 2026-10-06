/**
 * SL-24, a review that runs out of time is not a refusal (contract §32.12.2; the owner's ruling after the 20-turn long
 * gate, 2026-09-24).
 *
 * - The lane and the typed family start together and the first sufficient verdict wins: a typed fast-path admission does
 *   not wait for a slow lane, and a lane faster than Jev does not wait for Jev.
 * - A lane answer without grounds is no verdict: it neither admits nor refuses and is not an outage.
 * - At the cap (13 s by default, measured) a bookkeeping-only batch typed admitting at 0.70 or above is admitted
 *   `typed_late`; anything else is returned `review_pending` with the typed reading, the lane still running to the hard
 *   cap (twice the cap) for the Keeper's one resend, which collects it. Since §32.12.3.2 (SL-97 phase 2b) only the line
 *   classes the typed reading may settle (the data's list, today `time`) are admitted late; the typed endpoint answers the
 *   role-first design (`typed-admission-endpoint.mjs`).
 *
 * The seam: the real `apply`/`resolve` tools, the real admission seam and shared decision adapter, a controlled typed
 * endpoint behind `fetch`, the harness's scripted `admission/a1` lane (delayed where the order matters), and a real
 * socket that answers 200 and then trickles for a lane that never produces a verdict.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:net";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { laneByLine, openTable, waitFor } from "./harness.mjs";
import { manualClock, runWaitsPastRound } from "./manual-clock.mjs";
import { installTypedEndpoint } from "./typed-admission-endpoint.mjs";
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

/** The typed endpoint (the role-first design): `lines[i]` is line i's `{verdict, confidence}`, answered after `delayMs`. */
const installJev = (t, lines, delayMs = 0) => installTypedEndpoint(t, lines, { delayMs });
function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = [call("narrate", { text: "你说明了来意。" }), fauxAssistantMessage("after")];
const TIME = { kind: "time", minutes: 30, why: "going through the clippings" };
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

test("§32.12.2 lateAdmission: only a bookkeeping-only batch typed admitting every line at the threshold is admitted late (§32.12.3.2: of a listed class)", () => {
	const apply = (kinds) => ({ tool: "apply", key: kinds.join("+"), lines: kinds.map((kind) => `apply ${kind}: x`), kinds });
	const typed = (verdict, confidence) => ({ status: "decided", verdict, confidence, lineVerdicts: [verdict], grounds: "Decided by the player's words" });
	const LISTED = ["time"];
	const reason = (proposal, reading, env = {}, classes = LISTED) => { const late = lateAdmission(proposal, reading, env, classes); return late.ok ? late.verdict.path : late.reason; };
	// A listed class; the non-triggering kinds ride along.
	assert.equal(reason(apply(["time", "person", "person"]), typed("entailed", 0.72)), "typed_late");
	assert.equal(reason(apply(["time", "threat"]), typed("not_player_action", 0.7)), "typed_late");
	// The owner's other late kinds are not the typed reading's to admit (§32.12.3.2).
	for (const kind of ["move", "clue", "handout", "cash"]) assert.equal(reason(apply([kind]), typed("authorized", 0.99)), "class_not_listed", kind);
	assert.equal(reason(apply(["move"]), typed("authorized", 0.99), {}, ["move", "time"]), "typed_late", "a list that names move admits it");
	// Everything else is pending.
	assert.equal(reason(apply(["clue", "cash", "item", "time", "person"]), typed("authorized", 0.99)), "not_bookkeeping", "turn 1's batch carries an item");
	assert.equal(reason({ tool: "resolve", key: "r", lines: ["resolve"] }, typed("authorized", 0.99)), "not_bookkeeping");
	assert.equal(reason(apply(["threat"]), typed("authorized", 0.99)), "not_bookkeeping", "no triggering kind at all");
	assert.equal(reason(apply(["time"]), typed("entailed", 0.69)), "low_confidence");
	assert.equal(reason(apply(["time"]), typed("not_authorized", 0.99)), "typed_refusal");
	assert.equal(reason(apply(["time"]), typed("uncertain", 0.99)), "typed_refusal");
	assert.equal(reason(apply(["time"]), { status: "fallback", reason: "unconfigured" }), "no_typed_verdict");
	assert.equal(reason(apply(["time"]), undefined), "no_typed_verdict");
	assert.equal(reason(apply(["time"]), typed("entailed", 0.99), { PI_COC_ADMISSION_LATE_MIN_CONFIDENCE: "off" }), "late_off");
	const late = lateAdmission(apply(["time"]), typed("entailed", 0.8), {}, LISTED);
	assert.deepEqual(late, { ok: true, minConfidence: 0.7, verdict: { verdict: "entailed", grounds: "Decided by the player's words", reviewer: "jev", path: "typed_late" } });
	assert.equal(lateEligibleBatch(apply(["move", "map"])), false, "map is not among the owner's kinds");
});

// ---- the first sufficient verdict wins -----------------------------------------------------------------------------------

test("§32.12.2: a typed admission that settles its line stands without waiting for a slow lane, whose refusal never lands", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.95 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only interest", missing: "which archive" }, 3000)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(kernelCalls(table, "table.apply").length, 1, "admitted on the typed verdict");
	const [row] = admissionRows(table);
	assert.equal(row.path, "typed");
	assert.equal(row.reviewer, "jev");
	assert.equal(row.lane_cancelled, true);
	assert.ok(row.ms < 2000, `the review did not wait for the lane (${row.ms} ms)`);
});

test("§32.12.2: a lane faster than Jev stands without waiting for Jev; the row says the lane came first", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.99 }], 2500);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME] }), ...close],
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
	installJev(t, [{ verdict: "not_player_action", confidence: 0.8 }, { verdict: "entailed", confidence: 0.75 }]);
	// §32.12.3.1: each line has its own lane call, and each call its own late admission, on that line's typed reading.
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, { ...TIME, minutes: 10, why: "waiting for the clerk" }] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "not_authorized", grounds: "" }, 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(kernelCalls(table, "table.apply").length, 1);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.path, row.confidence]), [[1, "typed_late", 0.8], [2, "typed_late", 0.75]]);
	for (const row of rows) {
		assert.equal(row.reviewer, "jev");
		assert.equal(row.lane_no_grounds, true);
		assert.equal(row.late_min_confidence, 0.7);
		assert.equal(row.batch_admitted, true);
	}
});

// ---- at the cap -------------------------------------------------------------------------------------------------------------

test("§32.12.2: at the cap a bookkeeping batch typed 0.72 is admitted typed_late within cap + 1 s; the lane runs on to the hard cap and leaves its late row", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.72 }]);
	const provider = await tricklingProvider(t);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [call("apply", { effects: [TIME] }), ...close] });
	t.after(() => table.dispose());
	registerTrickle(table, provider.port);
	assert.equal(await promptWithin(table, WORDS, 15_000), "ended");
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the batch landed");
	const [row] = admissionRows(table);
	assert.equal(row.verdict, "entailed");
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

test("a running review is continued to the hard deadline without returning a soft-cap refusal", async t=>{
 installJev(t,[{verdict:"not_authorized",confidence:0.64,missing:"target"}]);
 const provider=await tricklingProvider(t),table=await openTable({env:{...KEY,PI_COC_ADMISSION_MODEL:"trickle/trickle-1",PI_COC_ADMISSION_TIMEOUT_MS:"1500"},responses:[call("resolve",persuade),...close]});
 t.after(()=>table.dispose());registerTrickle(table,provider.port);
 assert.equal(await promptWithin(table,"I ask her for the clippings.",15000),"ended");
 assert.equal(kernelCalls(table,"table.resolve").length,0);
 const [row]=admissionRows(table);assert.equal(row.verdict,REVIEW_TIMEOUT);assert.equal(row.host_continued,true);
 assert.ok(table.telemetry().some(x=>x.lane==="admission-wait"&&x.event==="continue_existing"));
 assert.equal(admissionRows(table).some(x=>x.verdict===REVIEW_PENDING),false);
 assert.equal(table.entries("coc-admission-status").length,0);
});

test("the host collects a verdict just after the soft cap from the same review with one model proposal", async t=>{
 const CAP_MS=1000,VERDICT_MS=1280,HARD_CAP_MS=admissionHardCapMs(CAP_MS),clock=manualClock(),T0=clock.at();let laneAsked=false;
 const table=await openTable({env:{PI_COC_ADMISSION_TIMEOUT_MS:String(CAP_MS)},responses:[call("resolve",persuade),...close],
  laneResponses:{admission:[async()=>{laneAsked=true;await clock.until(T0+VERDICT_MS);return verdict({verdict:"authorized",grounds:"The player asked for the clippings"});}]}});
 t.after(()=>table.dispose());table.emit("coc:test-admission-clock",clock);let ended=false;
 const prompt=table.session.prompt("I ask for the clippings.").finally(()=>{ended=true});
 await waitFor(()=>laneAsked,{timeoutMs:60000,label:"one review started"});clock.advanceTo(T0+CAP_MS);
 await waitFor(()=>table.telemetry().some(x=>x.lane==="admission-wait"),{timeoutMs:60000,label:"host continuing the review"});
 assert.equal(kernelCalls(table,"table.resolve").length,0);clock.advanceTo(T0+VERDICT_MS);
 await runWaitsPastRound(clock,T0+HARD_CAP_MS,()=>ended);await prompt;
 const [row]=admissionRows(table);assert.equal(row.verdict,"authorized");assert.equal(row.host_continued,true);
 assert.equal(row.continuation_wait_ms,VERDICT_MS-CAP_MS);assert.equal(row.resend,undefined);
 assert.equal(table.lanes.admission.requests().length,1);assert.equal(kernelCalls(table,"table.resolve").length,1);
 assert.equal(admissionRows(table).some(x=>x.verdict===REVIEW_PENDING),false);
});

test("an early soft-cap timer is rearmed and a continued review still cannot exceed its hard deadline", async t=>{
 const CAP_MS=1000,clock=manualClock({early:1}),T0=clock.at();
 const table=await openTable({env:{PI_COC_ADMISSION_TIMEOUT_MS:String(CAP_MS)},responses:[call("resolve",persuade),...close],laneResponses:{admission:[async()=>{await clock.until(T0+10*CAP_MS);return verdict({verdict:"authorized",grounds:"too late"});}]}});
 t.after(()=>table.dispose());table.emit("coc:test-admission-clock",clock);let ended=false;
 const prompt=table.session.prompt("I ask for the clippings.").finally(()=>{ended=true});
 await waitFor(()=>clock.due().includes(T0+CAP_MS-1),{timeoutMs:60000,label:"soft cap armed"});
 clock.advanceTo(T0+CAP_MS-1);assert.ok(clock.due().includes(T0+CAP_MS));clock.advanceTo(T0+CAP_MS);
 await waitFor(()=>table.telemetry().some(x=>x.lane==="admission-wait"),{timeoutMs:60000,label:"soft cap continued"});
 const HARD=2*CAP_MS;clock.advanceTo(T0+HARD-1);await new Promise(r=>setImmediate(r));clock.advanceTo(T0+HARD);
 await runWaitsPastRound(clock,T0+HARD,()=>ended);await prompt;
 assert.equal(kernelCalls(table,"table.resolve").length,0);assert.equal(admissionRows(table)[0].verdict,REVIEW_TIMEOUT);
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
