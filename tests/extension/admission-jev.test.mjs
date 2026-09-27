/**
 * The typed admission reviewer (contract §32.10) through the product path: the real extension's
 * `apply`/`resolve` tools, the real admission seam, the real shared decision adapter, and a
 * controlled provider behind it -- `fetch` answers the pinned endpoint the way the typed API does
 * (`typed-admission-endpoint.mjs`, answering the role-first design §32.12.3.2 put in front). The lane
 * is the scripted `admission/a1` provider of the harness, so "no lane call" is counted, not assumed.
 *
 * Since §32.12.3.2 (SL-97 phase 2b) §32.10's family rule is retired: `PI_COC_ADMISSION_REVIEWER=jev`
 * no longer lets a typed verdict stand, refusals included. What stays pinned here is what §32.10 said
 * of the typed request (the §32.3 input and nothing Keeper-only), its fallbacks, the outage, and verdict
 * reuse -- now for the one rule under which a typed reading settles a line (`admission-typed-settle.test.mjs`).
 *
 * What is under test is what the host does with a typed answer. The answers are scripted: the
 * semantic judgement belongs to the model, and whether a live model agrees with the lane is the
 * offline bank's question (experiments/admission-jev-bank), not this file's.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { laneByLine, openTable } from "./harness.mjs";
import { installTypedEndpoint, questionKeys } from "./typed-admission-endpoint.mjs";

const JEV_ENV = { PI_COC_ADMISSION_REVIEWER: "jev", EXT_JEV_APIKEY: "test-jev-key" };
const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
/** §32.12.2: the lane and the typed answer race; a lane answer delayed past Jev's makes the order the test's own. */
const slowVerdict = (row, ms) => async () => { await new Promise((resolve) => setTimeout(resolve, ms)); return fauxAssistantMessage(JSON.stringify(row)); };
const TIME = { kind: "time", minutes: 30, why: "going through the clippings" };

function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}

function newspaperTurn() {
	return [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [
			{ kind: "move", to: "newspaper-morgue", travel_minutes: 30 },
			{ kind: "clue", clue: "globe-unpublished-story" },
		] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你走进了剪报室。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("after"),
	];
}

const applyTurn = (effects) => [
	fauxAssistantMessage([fauxToolCall("apply", { effects })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻着剪报。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("after"),
];

test("§32.12.3.2: the typed request reads exactly §32.3's input in the role-first design; with PI_COC_ADMISSION_REVIEWER=jev a confident move-and-clue admission still does not stand", async (t) => {
	const requests = installTypedEndpoint(t, [{ verdict: "authorized", confidence: 0.97 }]);
	const table = await openTable({ responses: newspaperTurn(), env: JEV_ENV,
		laneResponses: { admission: laneByLine([[/apply (move|clue)/, { verdict: "not_authorized", grounds: "a lane that refuses", missing: "x" }, 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt("我去环球报的剪报室查那栋房子的旧闻");

	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stood: the retired family rule no longer lets a typed 0.97 stand");
	assert.equal(requests.length, 1, "one typed batch");
	// The batch reads the player's exact words and the proposal, the role-first questions per line.
	const [body] = requests;
	assert.deepEqual(body.state.playerWords.map((row) => row.text).join(""), "我去环球报的剪报室查那栋房子的旧闻");
	assert.deepEqual(questionKeys(requests, "role"), ["role_0", "role_1"]);
	assert.deepEqual(questionKeys(requests, "verdict"), []);
	assert.deepEqual(Object.keys(body.questions).filter((key) => key.endsWith("_0")),
		["role_0", "choice_0", "result_0", "span_0", "target_0", "gate_0", "order_0", "missing_0", "basis_0"]);
	assert.match(body.state.proposal[0].text, /^apply move: to="newspaper-morgue"/);
	assert.deepEqual(body.state.proposal.map((line) => line.kind), ["move", "clue"]);
	// Keeper-only capsule material never reaches the typed reviewer either (§32.3).
	assert.doesNotMatch(JSON.stringify(body), /科比特在地窖下面|他知道地窖下面有东西/);

	const rows = admissionRows(table);
	assert.ok(rows.length >= 1);
	for (const row of rows) {
		assert.equal(row.reviewer, "lane");
		assert.equal(row.typed_design, "roles-2a.3");
		assert.equal(row.typed_confidence, 0.97);
		assert.equal(row.jev_calls, 1);
	}
});

test("an unavailable typed service leaves the line to the lane, which decides exactly as it does alone", async (t) => {
	const requests = installTypedEndpoint(t, [], { status: 503 });
	const table = await openTable({ responses: applyTurn([TIME]), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "going through the clippings takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报");

	assert.equal(requests.length, 1);
	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 1);
	const [row] = admissionRows(table);
	assert.equal(row.reviewer, "lane");
	assert.equal(row.model, "admission/a1");
	assert.equal(row.jev_fallback, "service_error");
	assert.equal(row.jev_status, 503);
	assert.equal(row.typed_confidence, null);
	assert.equal(typeof row.lane_ms, "number");
});

test("a typed answer under the settle confidence is not a verdict: the lane decides, and its refusal stands", async (t) => {
	installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.6 }]);
	const table = await openTable({ responses: applyTurn([TIME]), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "the player only asked about the clippings", missing: "whether to spend the half hour" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("剪报里有什么？");

	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stands");
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.verdict, row.jev_fallback, row.jev_confidence], ["lane", "not_authorized", "low_confidence", 0.6]);
	assert.equal(row.missing, "whether to spend the half hour");
	const [text] = toolResultTexts(table.session, "apply");
	assert.match(text, /^missing: "whether to spend the half hour"$/m, "the lane's missing choice is the Keeper's");
});

test("§32.12.3.2: a confident typed refusal no longer refuses, with PI_COC_ADMISSION_REVIEWER=jev or without -- the lane decides", async (t) => {
	installTypedEndpoint(t, [{ verdict: "not_authorized", confidence: 0.95, missing: "destination" }]);
	const table = await openTable({ responses: applyTurn([TIME]), env: JEV_ENV,
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "going through the clippings takes the time" }, 800)] } });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报");

	assert.equal(kernelCalls(table, "table.apply").length, 1, "the lane admitted what the typed reviewer refused");
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.verdict, row.jev_fallback], ["lane", "entailed", "typed_refusal"]);
	assert.deepEqual(row.line_verdicts, ["not_authorized"]);
});

test("with both reviewers down the review still refuses as unavailable, and a repeat escalates once", async (t) => {
	installTypedEndpoint(t, [], { status: 500 });
	const failing = () => fauxAssistantMessage("not json at all");
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [TIME] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ ...TIME, minutes: 45 }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "暂时没法结算。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		env: KEY,
		// §143.15: each lane round asks a malformed answer once more, so two failed reviews are four answers.
		laneResponses: { admission: [failing(), failing(), failing(), failing()] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报");

	assert.equal(kernelCalls(table, "table.apply").length, 0, "unavailability never admits");
	const texts = toolResultTexts(table.session, "apply");
	assert.match(texts[0], /^needs: The action review is unavailable/m);
	assert.match(texts[1], /failed 2 times in a row/);
	const refusals = table.telemetry().filter((entry) => entry.tool === "apply" && !entry.lane && entry.ok === false);
	assert.deepEqual(refusals.map((entry) => entry.reason), ["admission_unavailable", "admission_unavailable"]);
	const rows = admissionRows(table).filter((row) => row.ok === false);
	assert.equal(rows.length, 2);
	assert.ok(rows.every((row) => row.reviewer === "lane" && row.reason === "bad_output" && row.jev_fallback === "service_error"), JSON.stringify(rows));
});

test("with the settle confidence off no typed reading settles anything: a time line typed 0.99 is the lane's", async (t) => {
	installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.99 }]);
	const table = await openTable({ responses: applyTurn([TIME]), env: { ...KEY, PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" },
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only interest", missing: "whether to spend the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("剪报里有什么？");

	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stood over a typed 0.99 admission");
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.typed_confidence, row.jev_fallback], ["lane", 0.99, undefined]);
});

test("a batch carrying cash is the lane's to decide: a confident typed answer never stands on it, numbers are the lane's to compare", async (t) => {
	installTypedEndpoint(t, [{ verdict: "authorized", confidence: 0.97 }]);
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "cash", delta: -5, source: "quote", with: "Clerk" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "加满了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		env: JEV_ENV,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "no price was told or accepted", missing: "the price" }, 300)] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("加满油");

	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stood over a typed 0.97 admission");
	const [row] = admissionRows(table);
	assert.equal(row.reviewer, "lane");
	assert.equal(row.line_class, "cash");
	assert.equal(row.jev_fallback, undefined, "cash is never a class the typed reading may settle");
});

test("a typed verdict is reused for the same proposal within the turn, with no second typed call", async (t) => {
	const requests = installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.97 }]);
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [TIME] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ ...TIME, why: "again" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "剪报翻完了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500)] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报");

	assert.equal(requests.length, 1, "the second identical proposal reused its verdict");
	const rows = admissionRows(table);
	assert.equal(rows.length, 2);
	assert.deepEqual([rows[0].reviewer, rows[0].path], ["jev", "typed"]);
	assert.equal(rows[1].reused, true);
	assert.equal(rows[1].reviewer, "jev");
	assert.ok(table.lanes.admission.requests().length <= 1, "at most the one lane round cancelled for the typed verdict; the reuse started none");
	assert.equal(kernelCalls(table, "table.apply").length, 2);
});
