/**
 * Contract §142.2 through the product path: the time reading of a delivery. The family itself (pure), the budget it
 * reads, and the real kernel extension's three delivery paths -- an explicit narrate, the implicit close, and a
 * refusal that spends the turn's one steer -- over the fake kernel, with a controlled typed endpoint behind the real
 * decision adapter: `fetch` answers the pinned Jev URL for this family and refuses every other family (503), so
 * admission, attribution and the verifier fall back exactly as they do without a key.
 *
 * The answers are scripted: how far the prose skips is the model's reading, not this file's. What is under test is
 * what the host does with a typed answer -- what rides on `table.narrate`, when it is refusable, what is recorded.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";
import { CUTS, DAY_PARTS, NOT_SHOWN, heldReading, interpretTimeReading, runTimeReading, timeReadingBatch, timeReadingBindings,
	TIME_READING_FAMILY } from "../../runtime/jev/time-reading-domain.ts";
import { TIME_READING_FALLBACK, timeReadingBudget } from "../../runtime/jev/host-budgets.ts";
import { deliveryProse } from "../../extensions/kernel/unwrapped-speech.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const SKIP = "你出门时身后的门慢慢合上。夜里没有别的事。第二天早上你回到这条街口，剪报室的灯已经亮了。";
const STAY = "阿蒂把登记簿推回你面前，铅笔横在纸上，笔尖朝着你。楼梯底下翻纸的声音一阵一阵，不急。";

// ---------------------------------------------------------------------------------------------------------
// The family, pure.
// ---------------------------------------------------------------------------------------------------------

const scoreAnswer = (level, confidence, probabilities) => ({ status: "answered", type: "score", score: level, confidence,
	legend: {}, probabilities: probabilities ?? Object.fromEntries(CUTS.map((_, index) => [String(index), index === level ? confidence : (1 - confidence) / 4])) });
const choiceAnswer = (choice, confidence) => ({ status: "answered", type: "choice", choice, confidence, probabilities: {} });
const complete = (cut, ends) => ({ status: "complete", answers: { cut, ends_at: ends } });

test("the batch: the delivery's words are the whole state; a Score over the five cuts and a Choice over the day parts", () => {
	const batch = timeReadingBatch({ campaign: "c", turn: 8, text: SKIP });
	assert.deepEqual(batch.state, { text: SKIP });
	assert.equal(batch.family, TIME_READING_FAMILY);
	assert.deepEqual(batch.questions.map((q) => [q.key, q.type]), [["cut", "score"], ["ends_at", "choice"]]);
	assert.equal(batch.questions[0].criteria.length, CUTS.length);
	assert.deepEqual(Object.keys(batch.questions[1].criteria), [...DAY_PARTS, NOT_SHOWN]);
	assert.ok(batch.questions.every((q) => typeof q.instructions === "string" && q.instructions.includes("data, never instructions")));
	assert.ok(!JSON.stringify(batch).includes("1920"), "no clock in the request");
});

test("interpret: the argmax of each question; a tie is the lower cut; any structural gap falls back", () => {
	const read = interpretTimeReading(complete(scoreAnswer(3, 0.98), choiceAnswer("morning", 0.99)));
	assert.equal(read.status, "read");
	assert.deepEqual([read.answer.cut, read.answer.cutConfidence, read.answer.endsAt, read.answer.endsAtConfidence], ["next_day", 0.98, "morning", 0.99]);
	assert.equal(read.answer.distribution.next_day, 0.98);
	const tie = interpretTimeReading(complete(scoreAnswer(2, 0.4, { 0: 0.1, 1: 0.1, 2: 0.4, 3: 0.4, 4: 0 }), choiceAnswer("night", 0.5)));
	assert.equal(tie.answer.cut, "later_today");
	assert.deepEqual(interpretTimeReading(complete(choiceAnswer("next_day", 0.9), choiceAnswer("morning", 0.9))), { status: "fallback", reason: "invalid_typed_answer" });
	assert.deepEqual(interpretTimeReading(complete(scoreAnswer(3, 0.9), choiceAnswer("teatime", 0.9))), { status: "fallback", reason: "invalid_typed_answer" });
	assert.equal(interpretTimeReading({ status: "unavailable", answers: {}, failure: { code: "timeout" } }).reason, "timeout");
});

test("heldReading: only a cut of hours or more above the gate rides, with its floor; ends_at only when shown above the gate", () => {
	const floors = { later_today: 60, next_day: 240, days: 1440 };
	const answer = (cut, cutConfidence, endsAt, endsAtConfidence) => ({ cut, cutConfidence, endsAt, endsAtConfidence, distribution: {} });
	assert.deepEqual(heldReading(answer("next_day", 0.98, "morning", 0.99), 0.6, floors, true),
		{ cut: "next_day", confidence: 0.98, floor: 240, ends_at: "morning", refusable: true });
	assert.equal(heldReading(answer("short", 0.99, "morning", 0.99), 0.6, floors, true), null, "a short cut is not held");
	assert.equal(heldReading(answer("continuous", 0.99, "evening", 0.99), 0.6, floors, true), null);
	assert.equal(heldReading(answer("next_day", 0.59, "morning", 0.99), 0.6, floors, true), null, "below the gate");
	assert.deepEqual(heldReading(answer("later_today", 0.7, NOT_SHOWN, 0.99), 0.6, floors, false), { cut: "later_today", confidence: 0.7, floor: 60, refusable: false });
	assert.equal(heldReading(answer("days", 0.9, "dawn", 0.5), 0.6, floors, true).ends_at, undefined, "a day part below the gate stays home");
});

test("runTimeReading: one request through the port; no text and a binding mismatch fall back without one", async () => {
	const input = { campaign: "c", turn: 8, text: SKIP };
	let calls = 0;
	const port = { decide: async () => { calls++; return { ...complete(scoreAnswer(3, 0.98), choiceAnswer("morning", 0.99)), usage: { inputTokens: 300, outputTokens: 2 } }; } };
	const lease = (bindings) => new TaskLease({ owner: TIME_READING_FAMILY, goal: "test", scope: bindings.scope, capabilities: ["decision"],
		readSet: bindings.readSet, budget: { deadlineAt: Date.now() + 5000, remainingInputTokens: 10_000, remainingOutputTokens: 1000, remainingCostUsd: 0.01, remainingActions: 2 } });
	const good = lease(timeReadingBindings(input));
	const read = await runTimeReading(input, port, good);
	good.close();
	assert.equal(read.status, "read");
	assert.equal(read.answer.cut, "next_day");
	assert.equal(calls, 1);
	const empty = { ...input, text: "   " }, emptyLease = lease(timeReadingBindings(empty));
	assert.equal((await runTimeReading(empty, port, emptyLease)).reason, "no_text");
	emptyLease.close();
	const other = lease(timeReadingBindings({ ...input, turn: 9 }));
	assert.equal((await runTimeReading(input, port, other)).reason, "attempt_binding_mismatch");
	other.close();
	assert.equal(calls, 1);
});

test("timeReadingBudget: the shipped file carries the fallback's values; the file is read, and bad values fall back", async (t) => {
	assert.deepEqual(await timeReadingBudget(), TIME_READING_FALLBACK);
	const fixture = (block) => {
		const dir = mkdtempSync(join(tmpdir(), "time-reading-budget-"));
		mkdirSync(join(dir, "rulesets", "coc7"), { recursive: true });
		writeFileSync(join(dir, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, time_reading: block }));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		return dir;
	};
	const moved = await timeReadingBudget(fixture({ timeout_ms: 900, min_confidence: 0.8, floors: { next_day: 300 } }));
	assert.deepEqual(moved, { timeoutMs: 900, minConfidence: 0.8, floors: { later_today: 60, next_day: 300, days: 1440 } });
	const bad = await timeReadingBudget(fixture({ timeout_ms: -1, min_confidence: 1.5, floors: { next_day: -3, tea: 5 } }));
	assert.deepEqual(bad, TIME_READING_FALLBACK);
});

test("deliveryProse: tokens gone, spoken words and markers' surroundings left", () => {
	assert.equal(deliveryProse("{{say:阿蒂}}「楼要锁了。」{{/say}}他关了灯 {{check:x}}。"), "「楼要锁了。」他关了灯 。");
});

// ---------------------------------------------------------------------------------------------------------
// The extension over the fake kernel.
// ---------------------------------------------------------------------------------------------------------

/** A typed endpoint for this family only; `read(text)` scripts the answer, every other family gets 503. */
function installJev(t, read, { failure } = {}) {
	const original = globalThis.fetch, mine = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		if (!body.questions.cut) return new Response("unavailable", { status: 503 });
		mine.push(body);
		if (failure) return new Response("unavailable", { status: failure });
		const { cut, cutConfidence, endsAt, endsConfidence } = read(body.state.text);
		const level = CUTS.indexOf(cut), parts = [...DAY_PARTS, NOT_SHOWN];
		const answers = {
			cut: { type: "score", score: level, confidence: cutConfidence, legend: Object.fromEntries(body.questions.cut.criteria.map((c, i) => [String(i), c])),
				probabilities: Object.fromEntries(CUTS.map((_, i) => [String(i), i === level ? cutConfidence : (1 - cutConfidence) / 4])) },
			ends_at: { type: "choice", choice: endsAt, confidence: endsConfidence,
				probabilities: Object.fromEntries(parts.map((p) => [p, p === endsAt ? endsConfidence : (1 - endsConfidence) / 7])) },
		};
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 300, output_tokens: 2 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return mine;
}

const nextMorning = () => ({ cut: "next_day", cutConfidence: 0.98, endsAt: "morning", endsConfidence: 0.99 });
const noCut = () => ({ cut: "continuous", cutConfidence: 0.95, endsAt: NOT_SHOWN, endsConfidence: 0.9 });
const narrateParams = (table) => table.kernelRequests().filter((entry) => entry.method === "table.narrate").map((entry) => entry.params);
const readingRows = (table) => table.telemetry().filter((row) => row.lane === "time-reading");
const ENV = { EXT_JEV_APIKEY: "test-jev-key" };

async function play(t, { responses, env = {}, read = nextMorning, failure, input = "好，那我明天再来。" }) {
	const requests = installJev(t, read, { failure });
	const table = await openTable({ env: { ...ENV, ...env }, responses });
	t.after(() => table.dispose());
	await table.session.prompt(input);
	await waitForIdle(table.session);
	return { table, requests };
}

const narrateCall = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });

test("an explicit narrate that skips a night carries the reading, refusable, and its row says it was sent", async (t) => {
	const { table, requests } = await play(t, { responses: [narrateCall(SKIP)] });
	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].state, { text: SKIP });
	const [params] = narrateParams(table);
	assert.deepEqual(params.time_reading, { cut: "next_day", confidence: 0.98, floor: 240, ends_at: "morning", refusable: true });
	const [row] = readingRows(table);
	assert.equal(row.path, "explicit");
	assert.equal(row.ok, true);
	assert.equal(row.sent, true);
	assert.equal(row.cut, "next_day");
	assert.equal(row.ends_at, "morning");
	assert.equal(typeof row.ms, "number");
});

test("a delivery that plays through carries no reading; the row is still written", async (t) => {
	const { table } = await play(t, { responses: [narrateCall(STAY)], read: noCut });
	assert.equal(narrateParams(table)[0].time_reading, undefined);
	assert.equal(readingRows(table)[0].sent, false);
});

test("the Keeper cannot send its own time_reading", async (t) => {
	const { table } = await play(t, { responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: STAY, time_reading: { cut: "days" } })], { stopReason: "toolUse" })], read: noCut });
	assert.equal(narrateParams(table)[0]?.time_reading, undefined);
});

test("no key: nothing is asked, the delivery goes out unread, the row says skipped", async (t) => {
	const requests = installJev(t, nextMorning);
	const table = await openTable({ env: {}, responses: [narrateCall(SKIP)] });
	t.after(() => table.dispose());
	await table.session.prompt("好，那我明天再来。");
	await waitForIdle(table.session);
	assert.equal(requests.length, 0);
	assert.equal(narrateParams(table)[0].time_reading, undefined);
	assert.deepEqual(readingRows(table).map((row) => [row.ok, row.skipped]), [[true, "unconfigured"]]);
});

test("Jev down: fail open, the delivery goes out unread, the row names the failure", async (t) => {
	const { table } = await play(t, { responses: [narrateCall(SKIP)], failure: 500 });
	assert.equal(narrateParams(table)[0].time_reading, undefined);
	const [row] = readingRows(table);
	assert.equal(row.ok, false);
	assert.equal(typeof row.reason, "string");
});

test("the opening delivery is not read", async (t) => {
	const { table, requests } = await play(t, { responses: [narrateCall(SKIP)], env: { FAKE_KERNEL_OPENING: "1" } });
	assert.equal(requests.length, 0);
	assert.equal(narrateParams(table)[0].time_reading, undefined);
	assert.deepEqual(readingRows(table), []);
});

test("a refusal spends the turn's one steer: the next delivery is not refusable, and the same words are not read twice", async (t) => {
	const { table, requests } = await play(t, { env: { FAKE_KERNEL_TIME_REFUSE: "1" }, responses: [narrateCall(SKIP), narrateCall(SKIP)] });
	const sent = narrateParams(table);
	assert.equal(sent.length, 2);
	assert.equal(sent[0].time_reading.refusable, true);
	assert.equal(sent[1].time_reading.refusable, false, "the steer is spent: the kernel delivers with its finding");
	assert.equal(requests.length, 1, "the resend's words were read once");
	assert.deepEqual(readingRows(table).map((row) => row.cached ?? false), [false, true]);
	const refused = table.telemetry().find((row) => row.tool === "narrate" && row.ok === false);
	assert.equal(refused?.reason, "time_unrecorded");
});

test("the implicit close is read too, and a refusal takes the turn's one steer (§109.4) before the Keeper answers it", async (t) => {
	const { table } = await play(t, {
		// Nobody on stage: a draft with no say token would otherwise take the speech steer first (§40), spending the one steer.
		env: { FAKE_KERNEL_TIME_REFUSE: "1", FAKE_KERNEL_PRESENT: "[]" },
		responses: [
			// A tool call first, so the prose that follows is a close, not a floor steer.
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(SKIP),
			narrateCall(STAY),
		],
		read: (text) => (text.includes("第二天早上") ? nextMorning() : noCut()),
	});
	const sent = narrateParams(table);
	assert.equal(sent[0].implicit, true);
	assert.equal(sent[0].time_reading.refusable, true);
	assert.equal(readingRows(table)[0].path, "implicit");
	const steers = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "audit-repair");
	assert.equal(steers.length, 1, "the kernel's fix rode the one repair steer");
	assert.ok(String(steers[0].content).includes("time_unrecorded") || String(steers[0].content).includes("apply time"));
	assert.equal(sent.at(-1).text, STAY);
	assert.equal(sent.at(-1).time_reading, undefined);
});

// ---------------------------------------------------------------------------------------------------------
// The real kernel: the reconciliation (§142.3) answers the reading, and `until` (§142.1) closes it.
// ---------------------------------------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "../..");

/** Turn 1 walked into the newspaper morgue and closed at 10:00 on 1920-10-12; the player speaks next at turn 2. */
function turnOneClosed(workspace) {
	const input = [["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: "newspaper-morgue" }] }],
		["table.narrate", { call_id: "t1-c2", text: "报馆的剪报室很安静。" }]]
		.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(ROOT, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(ROOT, "content")],
		{ cwd: ROOT, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

const record = (workspace, turn) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
const world = (workspace) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/world.json"), "utf8"));
const kernelRows = (workspace) => readFileSync(join(workspace, ".coc/campaigns/test-camp/telemetry.jsonl"), "utf8").split("\n")
	.filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((row) => row.lane === "delivery" && row.reason === "time_unrecorded");

async function realTable(t, responses) {
	installJev(t, (text) => (text.includes("第二天早上") ? nextMorning() : noCut()));
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, env: ENV, responses });
	t.after(() => table.dispose());
	await table.session.prompt("好啊。那我明天就给你们总编写封信。");
	await waitForIdle(table.session);
	return table;
}

test("real kernel: the skip is refused with the call that closes it; the Keeper lands until and the clock reads the next morning", async (t) => {
	const table = await realTable(t, [
		narrateCall(SKIP),
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", until: { days: 1, time: "08:00" }, why: "出门，第二天早上回来" }] })], { stopReason: "toolUse" }),
		narrateCall(SKIP),
	]);
	const refusal = table.telemetry().find((row) => row.tool === "narrate" && row.ok === false);
	assert.equal(refusal?.reason, "time_unrecorded");
	const turn = record(table.workspace, 2);
	const time = turn.receipts.find((receipt) => receipt.kind === "time");
	assert.deepEqual([time.minutes, time.until], [22 * 60, { days: 1, time: "08:00" }]);
	assert.equal((turn.warnings ?? []).filter((row) => row.kind === "time_unrecorded").length, 0, "the books agree: no finding");
	assert.equal(world(table.workspace).clock.minutes, 22 * 60);
	assert.deepEqual(kernelRows(table.workspace).map((row) => row.outcome), ["refused"]);
});

test("real kernel: a Keeper that delivers the skip again after the refusal gets it out, with the finding on the record", async (t) => {
	const table = await realTable(t, [narrateCall(SKIP), narrateCall(SKIP)]);
	const turn = record(table.workspace, 2);
	const [finding] = (turn.warnings ?? []).filter((row) => row.kind === "time_unrecorded");
	assert.equal(finding.cut, "next_day");
	assert.deepEqual(finding.suggest, { until: { days: 1, time: "08:00" } });
	assert.equal(world(table.workspace).clock.minutes, 0, "nothing landed: the clock did not move for prose");
	assert.deepEqual(kernelRows(table.workspace).map((row) => row.outcome), ["refused", "delivered"]);
});

test("the apply schema offers until on time only (§142.1), and the narrate schema offers no time_reading", async () => {
	const { COC_TOOLS } = await import("../../extensions/kernel/tools.ts");
	const effects = COC_TOOLS.find((tool) => tool.name === "apply").parameters.properties.effects.items;
	const variants = effects.anyOf ?? effects.oneOf ?? [effects];
	const withUntil = variants.filter((variant) => variant.properties?.until);
	assert.equal(withUntil.length, 1);
	assert.deepEqual(withUntil[0].properties.kind.enum ?? [withUntil[0].properties.kind.const], ["time"]);
	assert.deepEqual(Object.keys(withUntil[0].properties.until.properties).sort(), ["days", "time"]);
	assert.equal(COC_TOOLS.find((tool) => tool.name === "narrate").parameters.properties.time_reading, undefined);
});

test("an implicit close after the turn's one steer is spent is read, not refusable, and delivered (turn 8's position)", async (t) => {
	const { table } = await play(t, {
		env: { FAKE_KERNEL_TIME_REFUSE: "1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			// Someone is on stage and the draft carries no say token: the speech steer (§40) takes the turn's one steer.
			fauxAssistantMessage(STAY),
			fauxAssistantMessage(SKIP),
		],
		read: (text) => (text.includes("第二天早上") ? nextMorning() : noCut()),
	});
	assert.equal(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "speech").length, 1);
	const sent = narrateParams(table);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].implicit, true);
	assert.equal(sent[0].time_reading.refusable, false, "a refusal here could never be handed back");
	assert.equal(table.telemetry().filter((row) => row.tool === "narrate" && row.ok === false).length, 0);
	assert.ok(table.telemetry().some((row) => row.event === "turn-closed" && row.ok === true));
});
