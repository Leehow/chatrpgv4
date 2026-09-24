/**
 * The typed admission reviewer (contract §32.10) through the product path: the real extension's
 * `apply`/`resolve` tools, the real admission seam, the real shared decision adapter, and a
 * controlled provider behind it -- `fetch` answers the pinned endpoint the way the typed API does.
 * The lane is the scripted `admission/a1` provider of the harness, so "no lane call" is counted,
 * not assumed.
 *
 * What is under test is what the host does with a typed answer. The answers are scripted: the
 * semantic judgement belongs to the model, and whether a live model agrees with the lane is the
 * offline bank's question (experiments/admission-jev-bank), not this file's.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";

const JEV_ENV = { PI_COC_ADMISSION_REVIEWER: "jev", EXT_JEV_APIKEY: "test-jev-key" };
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));
/** §32.12.2: the lane and the typed answer race; a lane answer delayed past Jev's makes the order the test's own. */
const slowVerdict = (row, ms) => async () => { await new Promise((resolve) => setTimeout(resolve, ms)); return fauxAssistantMessage(JSON.stringify(row)); };

function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}

/**
 * A controlled typed endpoint. `answer(question, key, state)` returns `{choice, confidence}` or a
 * whole HTTP failure; every request body is kept so the test reads what the model was shown.
 */
function installJev(t, answer) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		const reply = answer.status ? answer : null;
		if (reply) return new Response("unavailable", { status: reply.status });
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria);
			const { choice, confidence } = answer(question, key, body.state);
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

/** Every line the same verdict; nothing missing unless refused; the basis is the player's first passage. */
function uniform(verdictChoice, { confidence = 0.97, missing = "none" } = {}) {
	return (question, key, state) => {
		if (key.startsWith("verdict_")) return { choice: verdictChoice, confidence };
		if (key.startsWith("missing_")) return { choice: missing, confidence };
		return { choice: state.playerWords?.[0]?.alias ?? "none", confidence };
	};
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

test("a confident typed admission settles the batch without the lane's verdict, and the row says which reviewer decided", async (t) => {
	const requests = installJev(t, uniform("authorized"));
	const table = await openTable({ responses: newspaperTurn(), env: JEV_ENV, laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500)] } });
	t.after(() => table.dispose());
	await table.session.prompt("我去环球报的剪报室查那栋房子的旧闻");

	assert.equal(kernelCalls(table, "table.apply").length, 1, "the admitted apply reached the kernel; the slow lane's refusal never landed");
	assert.equal(requests.length, 1, "one typed batch");
	// The batch reads the player's exact words and the proposal, one verdict question per line.
	const [body] = requests;
	assert.deepEqual(body.state.playerWords.map((row) => row.text).join(""), "我去环球报的剪报室查那栋房子的旧闻");
	assert.deepEqual(Object.keys(body.questions).sort(), ["basis_0", "basis_1", "missing_0", "missing_1", "verdict_0", "verdict_1"]);
	assert.deepEqual(Object.keys(body.questions.verdict_0.criteria).sort(),
		["authorized", "entailed", "not_authorized", "not_player_action", "uncertain"]);
	assert.match(body.state.proposal[0].text, /^apply move: to="newspaper-morgue"/);
	// Keeper-only capsule material never reaches the typed reviewer either (§32.3).
	assert.doesNotMatch(JSON.stringify(body), /科比特在地窖下面|他知道地窖下面有东西/);

	const [row] = admissionRows(table);
	assert.equal(row.reviewer, "jev");
	assert.equal(row.model, "jev-1.13.0");
	assert.equal(row.verdict, "authorized");
	assert.equal(row.admitted, true);
	assert.equal(row.confidence, 0.97);
	assert.deepEqual(row.line_verdicts, ["authorized", "authorized"]);
	assert.equal(row.jev_calls, 1);
	assert.equal(typeof row.ms, "number");
});

test("an unavailable typed service falls back to the lane, which decides exactly as it does alone", async (t) => {
	const requests = installJev(t, { status: 503 });
	const table = await openTable({ responses: newspaperTurn(), env: JEV_ENV,
		laneResponses: { admission: [slowVerdict({ verdict: "authorized", grounds: "the player named the Globe morgue" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("我去环球报的剪报室查那栋房子的旧闻");

	assert.equal(requests.length, 1);
	assert.equal(table.lanes.admission.requests().length, 1, "the lane reviewed it");
	assert.equal(kernelCalls(table, "table.apply").length, 1);
	const [row] = admissionRows(table);
	assert.equal(row.reviewer, "lane");
	assert.equal(row.model, "admission/a1");
	assert.equal(row.jev_fallback, "service_error");
	assert.equal(typeof row.lane_ms, "number");
});

test("a typed answer under the family confidence is not a verdict: the lane decides", async (t) => {
	installJev(t, uniform("authorized", { confidence: 0.6 }));
	const table = await openTable({ responses: newspaperTurn(), env: JEV_ENV,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only interest", missing: "which archive to visit" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");

	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stands");
	const [row] = admissionRows(table);
	assert.equal(row.reviewer, "lane");
	assert.equal(row.jev_fallback, "low_confidence");
	assert.equal(row.jev_confidence, 0.6);
	assert.equal(row.missing, "which archive to visit");
});

test("a confident typed refusal refuses the whole batch with host-derived grounds and missing, and no lane call", async (t) => {
	// Line 0 (the move) is not chosen, line 1 is entailed: the batch is refused whole.
	installJev(t, (question, key, state) => {
		if (key === "verdict_0") return { choice: "not_authorized", confidence: 0.95 };
		if (key === "verdict_1") return { choice: "entailed", confidence: 0.95 };
		if (key === "missing_0") return { choice: "destination", confidence: 0.9 };
		if (key.startsWith("missing_")) return { choice: "none", confidence: 0.9 };
		return { choice: state.playerWords[0].alias, confidence: 0.9 };
	});
	const table = await openTable({ responses: newspaperTurn(), env: JEV_ENV,
		laneResponses: { admission: [slowVerdict({ verdict: "authorized", grounds: "a lane that would admit" }, 1500)] } });
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");

	assert.equal(kernelCalls(table, "table.apply").length, 0, "nothing reached the kernel: the typed refusal stood, not the slow lane's admission");
	const [text] = toolResultTexts(table.session, "apply");
	assert.match(text, /^needs: The player has not chosen this action$/m);
	// `missing` is the closed kind rendered by the host plus the line it is about.
	assert.match(text, /^missing: "the player has not chosen this destination: apply move: to=\\"newspaper-morgue\\"/m);
	const [row] = admissionRows(table);
	assert.equal(row.reviewer, "jev");
	assert.equal(row.verdict, "not_authorized");
	// `grounds` carries the player's exact words, extracted by the host from the passage Jev selected.
	assert.match(row.grounds, /^Decided by the player's words this turn: "那看看报纸"; typed review judged line 1 not_authorized/);
	assert.match(row.missing, /^the player has not chosen this destination: /);
	assert.deepEqual(row.line_verdicts, ["not_authorized", "entailed"]);
	const refusal = table.telemetry().find((entry) => entry.tool === "apply" && !entry.lane && entry.ok === false);
	assert.equal(refusal?.reason, "action_not_authorized");
});

test("with both reviewers down the review still refuses as unavailable, and a repeat escalates once", async (t) => {
	installJev(t, { status: 500 });
	const failing = () => fauxAssistantMessage("not json at all");
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "central-library" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "暂时没法结算。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		env: JEV_ENV,
		laneResponses: { admission: [failing(), failing()] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我去剪报室");

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

test("the typed route is opt-in: by default a typed verdict never stands, however confident (outside the bookkeeping fast path, §32.11)", async (t) => {
	installJev(t, uniform("authorized"));
	// A move-and-clue batch is a bookkeeping batch, which §32.11 lets a typed admission settle by default; with the fast
	// path off it is the §32.10 opt-in this test pins. §32.12.2: the typed attempt runs beside the lane (its reading is
	// what a pending call carries), but only the configured reviewer decides.
	const table = await openTable({ responses: newspaperTurn(), env: { EXT_JEV_APIKEY: "test-jev-key", PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" },
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only interest", missing: "which archive to visit" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("我去环球报的剪报室查那栋房子的旧闻");

	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stood over a typed 0.97 admission");
	assert.equal(admissionRows(table)[0].reviewer, "lane");
});

test("a batch carrying cash is the lane's to decide: a confident typed answer never stands on it, numbers are the lane's to compare", async (t) => {
	installJev(t, uniform("authorized"));
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
	assert.equal(row.jev_fallback, "numeric_commitment");
});

test("a typed verdict is reused for the same proposal within the turn, with no second typed call", async (t) => {
	const requests = installJev(t, uniform("authorized"));
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "search the desk", method: "look through drawers", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "search the desk", method: "look through drawers", skill: "Spot Hidden", why: "again" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "抽屉里什么也没有。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		env: JEV_ENV,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500)] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻翻抽屉");

	assert.equal(requests.length, 1, "the second identical proposal reused its verdict");
	const rows = admissionRows(table);
	assert.equal(rows.length, 2);
	assert.equal(rows[1].reused, true);
	assert.equal(rows[1].reviewer, "jev");
	assert.ok(table.lanes.admission.requests().length <= 1, "at most the one lane round abandoned for the typed verdict; the reuse started none");
	assert.equal(kernelCalls(table, "table.resolve").length, 2);
});
