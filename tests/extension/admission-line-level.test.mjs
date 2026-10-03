/**
 * SL-30, a batch is admitted line by line (contract §32.12.3; the owner's ruling after long gate #2, 2026-09-24), as
 * §32.12.3.2 (SL-97 phase 2b) leaves it.
 *
 * - The owner's amendment stands: an effect §32.1 does not put to review on its own (`threat`, `person`, ...) is sent to
 *   neither reviewer and lands with the batch.
 * - §32.12.3's split does not: the typed reading no longer clears lines and hands a fresh remainder to the lane. A line
 *   it settles (a listed class at the settle confidence, `admission-typed-settle.test.mjs`) is that line's own outcome
 *   beside the other lines' lane calls, and the batch lands whole or not at all -- a typed-settled line never lands
 *   alone beside a refused one, and the result carries no partial landing.
 * - `remainderAttempt` stays: it is how one line reads the batch's typed answer (`lineReading`, §32.12.3.1).
 *
 * The seam: the real `apply` tool and admission seam, the shared decision adapter behind a controlled typed endpoint
 * (`typed-admission-endpoint.mjs`), the harness's scripted `admission/a1` lane (delayed where the order matters), the fake
 * kernel; one test on the emitted kernel with long gate #2's turn-14 batch.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { laneByLine, openTable, waitForIdle } from "./harness.mjs";
import { installTypedEndpoint, questionKeys } from "./typed-admission-endpoint.mjs";
import { remainderAttempt } from "../../extensions/kernel/admission.ts";

const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const applies = (table) => table.kernelRequests().filter((entry) => entry.method === "table.apply");
const effectsOf = (table) => applies(table).map((entry) => entry.params.effects.map((effect) => effect.kind));
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slowVerdict = (row, ms) => async () => { await sleep(ms); return fauxAssistantMessage(JSON.stringify(row)); };
const proposes = (text) => text.slice(text.indexOf("[The Keeper now proposes]"));
/** The typed endpoint (the role-first design): `lines[i]` is line i's `{verdict, confidence}`. Returns the requests it answered. */
const installJev = (t, lines) => installTypedEndpoint(t, lines);
function toolResults(session, tool) {
	return session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => ({ isError: message.isError, details: message.details,
			text: (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("") }));
}
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = [call("narrate", { text: "你撬开了储物柜。" }), ];
const WORDS = "我下楼回厨房，撬开那个锁着的储物柜。";
const THREAT = { kind: "threat", name: "corbitt-haunting", clock: "corbitt-awareness", why: "撬柜的木头响声传到楼上。" };
const TIME = { kind: "time", minutes: 10, why: "下楼找到储物柜并试图撬开。" };
const CLUE = { kind: "clue", clue: "corbitt-diaries", how: "柜里压着一摞旧日记。" };
const MOVE = { kind: "move", to: "corbitt-house-ground" };

// ---- the pure rules ---------------------------------------------------------------------------------------------------

test("§32.12.3 remainderAttempt: the batch's own answer on the lines left, mapped as §32.10 maps a batch; no new typed call", () => {
	const answer = { status: "decided", verdict: "not_authorized", grounds: "Decided by the player's words: \"撬开\"; typed review judged line 3 not_authorized (apply clue)",
		missing: "the choice of target: apply clue", confidence: 0.4, calls: 2, elapsedMs: 700, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
		lines: [{ verdict: "entailed", confidence: 0.93, missing: "none" }, { verdict: "not_player_action", confidence: 0.5, missing: "none" }, { verdict: "not_authorized", confidence: 0.4, missing: "target" }] };
	const rest = remainderAttempt({ typed: answer, meta: { jev_calls: 2 } }, [1, 2]);
	assert.equal(rest.typed.verdict, "not_authorized");
	assert.equal(rest.typed.confidence, 0.4);
	assert.deepEqual(rest.typed.lines.map((line) => line.verdict), ["not_player_action", "not_authorized"]);
	assert.equal(rest.typed.grounds, answer.grounds, "the deciding line stayed behind, so its grounds travel");
	assert.equal(rest.typed.missing, answer.missing);
	assert.equal(rest.meta.jev_calls, 0);
	const admitting = remainderAttempt({ typed: answer, meta: {} }, [1]);
	assert.deepEqual([admitting.typed.verdict, admitting.typed.confidence, admitting.typed.missing], ["not_player_action", 0.5, undefined]);
	assert.match(admitting.typed.grounds, /line 2 not_player_action 0\.5/);
});

// ---- the seam -----------------------------------------------------------------------------------------------------------

test("§32.12.3 (owner's amendment): long gate #2's turn 14 -- the lane sees only the time line; the threat line lands with the batch unreviewed", async (t) => {
	const typed = installJev(t, [{ verdict: "entailed", confidence: 0.6 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [THREAT, TIME] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "prying it open takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const [request, ...more] = table.lanes.admission.requests();
	assert.equal(more.length, 0);
	assert.match(proposes(request), /apply time/);
	assert.doesNotMatch(proposes(request), /apply threat/, "the threat line is not sent to the lane");
	assert.deepEqual(questionKeys(typed, "role"), ["role_0"], "nor to the typed reviewer");
	assert.deepEqual(effectsOf(table), [["threat", "time"]], "it lands with the batch, one call, the batch's own order");
	const [row] = admissionRows(table);
	assert.deepEqual([row.path, row.verdict, row.line_level ?? null], ["lane", "entailed", null]);
	assert.deepEqual(row.proposed.map((line) => line.split(":")[0]), ["apply time"]);
	assert.deepEqual(row.line_confidences, [0.6], "a line that did not clear can be read back");
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false);
	assert.equal(result.details.admission, undefined, "everything landed: nothing to say");
});

test("§32.12.3 (owner's amendment): a person + move batch -- the lane sees only the move, and the person lands with it", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.6 }]);
	const PERSON = { kind: "person", who: "Vittorio Macario", why: "探视名单上写着这个名字。" };
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [PERSON, MOVE] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "authorized", grounds: "the player went down to the kitchen" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const [request] = table.lanes.admission.requests();
	assert.match(proposes(request), /apply move/);
	assert.doesNotMatch(proposes(request), /apply person|Vittorio/, "the person line is not sent to the lane");
	assert.deepEqual(effectsOf(table), [["person", "move"]]);
});

test("§32.12.3 (owner's amendment): a lane refusal of the reviewed lines still refuses the call; nothing lands", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.6 }]);
	const PERSON = { kind: "person", who: "Vittorio Macario" };
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [PERSON, MOVE] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only asked about the house", missing: "whether to go" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), []);
});

test("§32.12.3: the typed answer clears no line (0.86) -- the batch is reviewed by the lane, one call per line (§32.12.3.1)", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.86 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, CLUE] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "entailed", grounds: "prying it open takes the time" }, 300],
			[/apply clue/, { verdict: "authorized", grounds: "the diaries were in the cabinet the player pried" }, 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level, row.lines, row.verdict]), [["lane", "line", [1], "entailed"], ["lane", "line", [2], "authorized"]]);
	assert.ok(rows.every((row) => row.batch_admitted === true && row.batch_verdict === "authorized"), "the batch's verdict is the lines' combined (§32.10)");
	assert.deepEqual(rows[0].line_confidences, [0.86, 0.4], "a line that did not clear can be read back");
	assert.equal(table.lanes.admission.requests().length, 2);
	assert.deepEqual(effectsOf(table), [["time", "clue"]]);
});

test("§32.12.3: with the fast path off no line clears", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.99 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" }, responses: [call("apply", { effects: [TIME, CLUE] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "prying it open takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(admissionRows(table).map((row) => [row.path, row.line_level ?? null]), [["lane", "line"], ["lane", "line"]], "no line clears: each is the lane's (§32.12.3.1)");
});

test("§32.12.3.2: no split -- a time line the typed reading settles does not land beside a clue the lane refuses, nor does the unreviewed threat; no partial landing", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [THREAT, TIME, CLUE] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "entailed", grounds: "would admit" }, 3000],
			[/apply clue/, { verdict: "not_authorized", grounds: "the player only pried the door, not the diaries", missing: "whether to read the diaries" }, 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [], "the batch is refused whole (§32.10)");
	assert.ok(!table.lanes.admission.requests().some((text) => text.includes("admitted in this same call")), "no remainder round");
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, true);
	assert.equal(result.details.admission, undefined, "no partial landing");
	assert.equal(result.details.coc_error.details.missing, "whether to read the diaries");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level, row.lines, row.of_lines, row.verdict, row.batch_admitted]),
		[["typed", "line", [1], 2, "entailed", false], ["lane", "line", [2], 2, "not_authorized", false]]);
});

test("§32.12.3.2: no split -- the same batch whose clue the lane admits lands whole, the unreviewed threat with it, in the batch's order", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [THREAT, TIME, CLUE] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 3000],
			[/apply clue/, { verdict: "authorized", grounds: "the diaries were in the cabinet the player pried" }, 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["threat", "time", "clue"]]);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false);
	assert.equal(result.details.admission, undefined, "everything landed: nothing to say");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.reviewer, row.lines, row.verdict, row.batch_admitted, row.batch_verdict]),
		[["typed", "jev", [1], "entailed", true, "authorized"], ["lane", "lane", [2], "authorized", true, "authorized"]]);
});

test("§32.12.3 on the emitted kernel: long gate #2's turn-14 batch -- the lane reviews the time line alone, and both receipts land", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.6 }]);
	const table = await openTable({ realKernel: true, campaign: "line-level-seam", env: KEY, responses: [
		call("look", {}), call("narrate", { text: "诺特把钥匙推过桌面，等你开口。" }),
		call("apply", { effects: [THREAT, TIME] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "prying it open takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt(WORDS);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false, result.text.slice(0, 400));
	const receipts = result.details.receipts ?? [];
	assert.ok(receipts.some((id) => String(id).startsWith("time:")), `a time receipt (${JSON.stringify(receipts)})`);
	assert.ok(receipts.some((id) => String(id).startsWith("threat:")), `a threat receipt (${JSON.stringify(receipts)})`);
	const requests = table.lanes.admission.requests();
	assert.ok(requests.length >= 1 && requests.every((text) => !/apply threat/.test(proposes(text))), "no lane round read the threat line");
});
