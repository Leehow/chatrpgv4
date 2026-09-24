/**
 * SL-30, a batch is admitted line by line (contract §32.12.3; the owner's ruling after long gate #2, 2026-09-24).
 *
 * - The typed answer admits an `apply` line on its own when the line's kind may be cleared (§32.11's kinds and §32.1's
 *   non-triggering kinds, never cash / item / object / usage / map), its verdict admits, and its confidence is at the
 *   fast-path confidence (0.87) or above.
 * - When some lines clear and not all, and no verdict stood for the whole batch, the rest is reviewed on its own (the
 *   lane, with the cleared lines shown as admitted in this same call, and the batch's typed answer carried, no new
 *   typed call). A rest with no triggering kind is not reviewed at all (§32.1).
 * - An admitted rest lands with the cleared lines, in the batch's order. A rest that is refused, returned pending or
 *   unavailable does not land: the call carries the cleared lines alone, and the result's `admission` block and `note`
 *   say which lines landed and which did not, with that part's own refusal.
 * - The rest's resend collects its review; a resend of the whole batch applies only what did not land.
 *
 * The seam: the real `apply` tool and admission seam, the shared decision adapter behind a controlled typed endpoint,
 * the harness's scripted `admission/a1` lane (delayed where the order matters), the fake kernel; one test on the
 * emitted kernel with long gate #2's turn-14 batch.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { clearedLines, lineClearable, remainderAttempt } from "../../extensions/kernel/admission.ts";

const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const applies = (table) => table.kernelRequests().filter((entry) => entry.method === "table.apply");
const effectsOf = (table) => applies(table).map((entry) => entry.params.effects.map((effect) => effect.kind));
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slowVerdict = (row, ms) => async () => { await sleep(ms); return fauxAssistantMessage(JSON.stringify(row)); };
const proposes = (text) => text.slice(text.indexOf("[The Keeper now proposes]"));
/**
 * The lane, by what it is asked. Whether the batch's own round reaches the provider before the typed answer aborts it is
 * the scheduler's business, so every scripted step reads its request: a round proposing the whole batch (it carries the
 * cleared `apply time` line) waits and answers nothing useful; the rest's round answers `row` after `ms`.
 */
const restLane = (row, ms = 300) => {
	const step = async (context) => {
		const text = (context?.messages ?? []).flatMap((message) => (message.role === "user" ? message.content : [])).map((block) => block.text ?? "").join("");
		if (/apply time/.test(proposes(text))) { await sleep(5000); return fauxAssistantMessage(JSON.stringify({ verdict: "not_authorized", grounds: "the batch's own round" })); }
		await sleep(ms);
		return fauxAssistantMessage(JSON.stringify(row));
	};
	return [step, step];
};
/** The lane requests that reviewed the rest (their proposal no longer carries the cleared time line). */
const restRequests = (table) => table.lanes.admission.requests().filter((text) => !/apply time/.test(proposes(text)));

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/** The typed endpoint: `lines[i]` is line i's `{verdict, confidence}`, answered after `delayMs`. Returns the requests it answered. */
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
function toolResults(session, tool) {
	return session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => ({ isError: message.isError, details: message.details,
			text: (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("") }));
}
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = [call("narrate", { text: "你撬开了储物柜。" }), fauxAssistantMessage("after")];
const WORDS = "我下楼回厨房，撬开那个锁着的储物柜。";
const THREAT = { kind: "threat", name: "corbitt-haunting", clock: "corbitt-awareness", why: "撬柜的木头响声传到楼上。" };
const TIME = { kind: "time", minutes: 10, why: "下楼找到储物柜并试图撬开。" };
const CLUE = { kind: "clue", clue: "corbitt-diaries", how: "柜里压着一摞旧日记。" };
const MOVE = { kind: "move", to: "corbitt-house-ground" };

// ---- the pure rules ---------------------------------------------------------------------------------------------------

test("§32.12.3 lineClearable: §32.11's kinds and §32.1's non-triggering kinds; never cash, item, object, usage or map", () => {
	for (const kind of ["move", "clue", "handout", "time", "threat", "person", "npc", "flag", "note", "define", "damage"]) assert.equal(lineClearable(kind), true, kind);
	for (const kind of ["cash", "item", "object", "usage", "map"]) assert.equal(lineClearable(kind), false, kind);
});

test("§32.12.3 clearedLines: an admitting line of a clearable kind at the fast-path confidence or above, nothing else", () => {
	const proposal = (kinds) => ({ tool: "apply", key: "k", lines: kinds.map((kind) => `apply ${kind}: x`), kinds });
	const typed = (...lines) => ({ status: "decided", verdict: "entailed", grounds: "g", confidence: 0, lines: lines.map(([verdict, confidence]) => ({ verdict, confidence, missing: "none" })) });
	assert.deepEqual(clearedLines(proposal(["threat", "time"]), typed(["not_player_action", 0.55], ["entailed", 0.87]), 0.87), [1], "0.87 is at the threshold");
	assert.deepEqual(clearedLines(proposal(["threat", "time"]), typed(["not_player_action", 0.55], ["entailed", 0.869]), 0.87), [], "under it is not");
	assert.deepEqual(clearedLines(proposal(["move", "clue"]), typed(["authorized", 0.99], ["not_authorized", 0.99]), 0.87), [0], "a refusing line never clears");
	assert.deepEqual(clearedLines(proposal(["clue", "uncertain"]), typed(["authorized", 0.9], ["uncertain", 0.99]), 0.87), [0]);
	assert.deepEqual(clearedLines(proposal(["cash", "item", "object", "usage", "map", "clue"]),
		typed(["authorized", 0.99], ["authorized", 0.99], ["authorized", 0.99], ["authorized", 0.99], ["authorized", 0.99], ["authorized", 0.99]), 0.87), [5]);
	assert.deepEqual(clearedLines(proposal(["time"]), typed(["entailed", 0.99]), undefined), [], "the fast path off turns it off");
	assert.deepEqual(clearedLines({ tool: "resolve", key: "r", lines: ["resolve"] }, typed(["authorized", 0.99]), 0.87), [], "a resolve is one line, never split");
	assert.deepEqual(clearedLines(proposal(["time", "clue"]), typed(["entailed", 0.99]), 0.87), [], "an answer whose lines do not match the proposal's clears nothing");
	assert.deepEqual(clearedLines(proposal(["time"]), { status: "fallback", reason: "timeout" }, 0.87), [], "no typed lines, nothing cleared");
});

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

test("§32.12.3: long gate #2's turn 14 -- the time line clears, the threat line left has no triggering kind, so the batch lands whole with no lane round", async (t) => {
	installJev(t, [{ verdict: "not_player_action", confidence: 0.55 }, { verdict: "entailed", confidence: 0.93 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [THREAT, TIME] }), ...close],
		laneResponses: { admission: restLane({ verdict: "not_authorized", grounds: "the rest must not be reviewed" }) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["threat", "time"]], "one call, the batch's own order");
	assert.equal(restRequests(table).length, 0, "the threat line left was not put to the lane");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level, row.lines, row.skipped ?? row.verdict]),
		[["typed", "admitted", [2], "entailed"], ["none", "remainder", [1], "not_triggering"]]);
	assert.ok(rows[0].ms < 2000, `the review did not wait for the lane (${rows[0].ms} ms)`);
	assert.equal(rows[0].confidence, 0.93);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false);
	assert.equal(result.details.admission, undefined, "everything landed: nothing to say");
});

test("§32.12.3: the typed answer clears no line (0.86) -- the batch is reviewed whole, as before", async (t) => {
	installJev(t, [{ verdict: "not_player_action", confidence: 0.55 }, { verdict: "entailed", confidence: 0.86 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [THREAT, TIME] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "prying it open takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level ?? null, row.verdict]), [["lane", null, "entailed"]]);
	assert.equal(table.lanes.admission.requests().length, 1);
	assert.deepEqual(effectsOf(table), [["threat", "time"]]);
});

test("§32.12.3: with the fast path off no line clears", async (t) => {
	installJev(t, [{ verdict: "not_player_action", confidence: 0.99 }, { verdict: "entailed", confidence: 0.99 }]);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" }, responses: [call("apply", { effects: [THREAT, TIME] }), ...close],
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "prying it open takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(admissionRows(table).map((row) => [row.path, row.line_level ?? null]), [["lane", null]]);
});

test("§32.12.3: the rest is reviewed by the lane on its own, with the cleared line shown as admitted in this call; admitted, the batch lands whole in its order", async (t) => {
	const typedRequests = installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, CLUE] }), ...close],
		laneResponses: { admission: restLane({ verdict: "authorized", grounds: "the player pried the cabinet open" }) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["time", "clue"]]);
	const [request, ...more] = restRequests(table);
	assert.equal(more.length, 0, "one round on the rest");
	assert.match(proposes(request), /apply clue/, "the lane judges only the rest");
	assert.match(request.slice(0, request.indexOf("[The Keeper now proposes]")), /admitted in this same call: apply time/);
	assert.equal(typedRequests.length, 1, "the rest carries the batch's typed answer: no second typed call");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level, row.lines, row.verdict]), [["typed", "admitted", [1], "entailed"], ["lane", "remainder", [2], "authorized"]]);
	assert.equal(rows[1].batch_key, rows[0].key);
	assert.deepEqual(rows[1].line_verdicts, ["authorized"], "the rest's row carries its share of the typed answer");
});

test("§32.12.3: a rest the lane refuses does not land; the cleared line lands alone and the result says which lines landed and which did not", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, CLUE] }), ...close],
		laneResponses: { admission: restLane({ verdict: "not_authorized", grounds: "the player only pried the door, not the diaries", missing: "whether to read the diaries" }) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["time"]], "the refused clue never reached the kernel");
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false, "what landed is a success");
	const admission = result.details.admission;
	assert.equal(admission.landed.length, 1);
	assert.match(admission.landed[0], /^apply time/);
	assert.deepEqual(admission.not_landed.lines.map((line) => line.split(":")[0]), ["apply clue"]);
	assert.equal(admission.not_landed.details.reason, "action_not_authorized");
	assert.equal(admission.not_landed.details.missing, "whether to read the diaries");
	assert.match(result.details.note, /only part of this batch landed/);
	assert.match(result.text, /"not_landed"/, "the Keeper reads it in the tool result");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level, row.verdict, row.admitted]), [["typed", "admitted", "entailed", true], ["lane", "remainder", "not_authorized", false]]);
});

test("§32.12.3 with §32.12.2: a rest past the cap is returned pending alone; the cleared line lands at once, and the rest's own resend collects its review", async (t) => {
	// The typed answer takes 600 ms: the rest's cap is still the batch's, measured from the review's start.
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }], 600);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_TIMEOUT_MS: "1000" },
		responses: [call("apply", { effects: [TIME, MOVE] }), call("apply", { effects: [MOVE] }), ...close],
		laneResponses: { admission: restLane({ verdict: "authorized", grounds: "the player went down to the kitchen" }, 1100) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["time"], ["move"]], "the time at the cap, the move on its resend");
	const [first, second] = toolResults(table.session, "apply");
	assert.equal(first.details.admission.not_landed.details.reason, "review_pending");
	assert.match(first.details.note, /resend exactly the lines in admission\.not_landed\.lines/);
	assert.equal(second.isError, false);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level ?? null, row.verdict, row.resend ?? null]),
		[["typed", "admitted", "entailed", null], ["lane", "remainder", "review_pending", null], ["lane", null, "authorized", true]]);
	assert.deepEqual(rows[1].lines, [2], "the pending row names the lines still waiting");
	assert.deepEqual(rows[1].proposed.map((line) => line.split(":")[0]), ["apply move"]);
	assert.ok(rows[1].ms >= 1000 && rows[1].ms < 1400, `pending at the batch's cap (${rows[1].ms} ms)`);
	const [firstCall] = table.telemetry().filter((row) => row.tool === "apply" && row.ok === true);
	assert.ok(firstCall.ms < 1400, `the call waited the batch's cap from its review's start, not a fresh cap from the split at 600 ms (${firstCall.ms} ms)`);
	assert.equal(restRequests(table).length, 1, "the resend collected the rest's running round");
});

test("§32.12.3: a resend of the whole batch after a split applies only what did not land", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_TIMEOUT_MS: "1000" },
		responses: [call("apply", { effects: [TIME, MOVE] }), call("apply", { effects: [{ ...TIME, why: "重发" }, MOVE] }), ...close],
		laneResponses: { admission: restLane({ verdict: "authorized", grounds: "the player went down to the kitchen" }, 1300) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["time"], ["move"]], "the time line is not applied twice");
	const [, second] = toolResults(table.session, "apply");
	assert.equal(second.isError, false);
	assert.equal(second.details.admission.already_landed.length, 1);
	assert.match(second.details.admission.already_landed[0], /^apply time/);
	const rows = admissionRows(table);
	assert.ok(rows.some((row) => row.skipped === "already_landed" && row.line_level === "resend"));
	assert.ok(rows.some((row) => row.verdict === "authorized" && row.resend === true), "the rest collected its kept review");
});

test("§32.12.3: when the kernel refuses the lines admission let through, its refusal says the held-back lines did not land either", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [{ ...TIME, stated: "prying-time" }, CLUE] }), ...close],
		laneResponses: { admission: restLane({ verdict: "not_authorized", grounds: "the player only pried the door", missing: "whether to read the diaries" }) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(effectsOf(table), [["time"]]);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, true);
	const details = result.details.coc_error.details;
	assert.equal(details.reason, "stated_conflict", "the kernel's own refusal");
	assert.match(details.admission.attempted[0], /^apply time/);
	assert.equal(details.admission.not_landed.details.reason, "action_not_authorized");
	assert.deepEqual(details.admission.not_landed.lines.map((line) => line.split(":")[0]), ["apply clue"]);
});

test("§32.12.3 with §78: a delivery written behind a batch that only partly landed is refused once and written again", async (t) => {
	installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY,
		responses: [fauxAssistantMessage([fauxToolCall("apply", { effects: [TIME, CLUE] }), fauxToolCall("narrate", { text: "你翻开了日记。" })], { stopReason: "toolUse" }),
			call("narrate", { text: "你撬开了柜门，但还没去翻里面的东西。" }), fauxAssistantMessage("after")],
		laneResponses: { admission: restLane({ verdict: "not_authorized", grounds: "the player only pried the door", missing: "whether to read the diaries" }) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.ok(table.telemetry().some((row) => row.tool === "narrate" && row.reason === "delivery_behind_refused_effect"), "the narrate behind it was refused");
	assert.ok(table.telemetry().some((row) => row.tool === "narrate" && row.ok === true), "and written again");
});

test("§32.12.3 on the emitted kernel: long gate #2's turn-14 batch lands whole on the time line's clearance, with its receipts", async (t) => {
	installJev(t, [{ verdict: "not_player_action", confidence: 0.55 }, { verdict: "entailed", confidence: 0.93 }]);
	const table = await openTable({ realKernel: true, campaign: "line-level-seam", env: KEY, responses: [
		call("look", {}), call("narrate", { text: "诺特把钥匙推过桌面，等你开口。" }), fauxAssistantMessage("opening"),
		call("apply", { effects: [THREAT, TIME] }), ...close],
		laneResponses: { admission: restLane({ verdict: "not_authorized", grounds: "the rest must not be reviewed" }) } });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt(WORDS);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false, result.text.slice(0, 400));
	const receipts = result.details.receipts ?? [];
	assert.ok(receipts.some((id) => String(id).startsWith("time:")), `a time receipt (${JSON.stringify(receipts)})`);
	assert.ok(receipts.some((id) => String(id).startsWith("threat:")), `a threat receipt (${JSON.stringify(receipts)})`);
	assert.equal(restRequests(table).length, 0);
});
