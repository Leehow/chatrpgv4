/**
 * The bookkeeping fast path (contract §32.11) through the product path: the real `apply`/`resolve` tools, the real
 * admission seam and shared decision adapter, a controlled typed endpoint behind `fetch`, and the harness's scripted
 * `admission/a1` lane, whose requests are counted. The reviewer setting is left at its default (`lane`).
 *
 * A bookkeeping batch (every triggering kind move / clue / handout / time) is typed first; a typed admission at or
 * above the fast-path confidence stands with no lane call; below it, or a typed refusal on any line, the lane decides
 * exactly as it does alone. A `resolve` on an investigator and a batch carrying another triggering kind never make a
 * typed request by default.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE, admissionFastMinConfidence } from "../../extensions/kernel/admission.ts";

const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));
/** §32.12.2: the lane and the typed answer race; a lane answer delayed past Jev's makes the order the test's own. */
const slowVerdict = (row, ms) => async () => { await new Promise((resolve) => setTimeout(resolve, ms)); return fauxAssistantMessage(JSON.stringify(row)); };

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/** The typed endpoint: `lines[i]` is line i's `{verdict, confidence}`; missing none, basis the player's first passage. */
function installJev(t, lines) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria), index = Number(key.split("_")[1]), line = lines[index] ?? lines[0];
			const choice = key.startsWith("verdict_") ? line.verdict : key.startsWith("missing_") ? "none" : body.state.playerWords?.[0]?.alias ?? "none";
			const confidence = key.startsWith("verdict_") ? line.confidence : 0.97;
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}
const turn = (effects) => [
	fauxAssistantMessage([fauxToolCall("apply", { effects })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "你走进了剪报室。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("after"),
];
const bookkeeping = [{ kind: "move", to: "newspaper-morgue", travel_minutes: 30 }, { kind: "clue", clue: "globe-unpublished-story" }];
const WORDS = "我去环球报的剪报室查那栋房子的旧闻";

test("the fast-path threshold is the measured 0.87, read per review, and `off` turns the path off", () => {
	assert.equal(ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE, 0.87);
	assert.equal(admissionFastMinConfidence({}), 0.87);
	assert.equal(admissionFastMinConfidence({ PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "0.95" }), 0.95);
	assert.equal(admissionFastMinConfidence({ PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "2" }), 0.87);
	assert.equal(admissionFastMinConfidence({ PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" }), undefined);
});

test("a bookkeeping batch typed admitting at or above the threshold settles without the lane's verdict, and its row says path typed", async (t) => {
	const requests = installJev(t, [{ verdict: "authorized", confidence: 0.9 }, { verdict: "entailed", confidence: 0.88 }]);
	const table = await openTable({ responses: turn(bookkeeping), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);

	assert.equal(requests.length, 1, "one typed batch");
	// §32.12.2: the lane starts beside it and is abandoned; its (slow) refusal never lands.
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the admitted batch reached the kernel");
	const [row] = admissionRows(table);
	assert.equal(row.path, "typed");
	assert.equal(row.reviewer, "jev");
	assert.equal(row.fast_path, true);
	assert.equal(row.fast_min_confidence, 0.87);
	assert.equal(row.typed_rule, "fast_path");
	assert.equal(row.confidence, 0.88, "the review confidence is the lowest line's");
	assert.equal(row.admitted, true);
	assert.equal(typeof row.ms, "number");
});

test("below the threshold the lane decides, and its refusal stands", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.86 }]);
	const table = await openTable({ responses: turn(bookkeeping), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "only interest", missing: "which archive to visit" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");

	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stands");
	const [row] = admissionRows(table);
	assert.equal(row.path, "lane");
	assert.equal(row.fast_path, true);
	assert.equal(row.jev_fallback, "low_confidence");
	assert.equal(row.jev_confidence, 0.86);
	assert.equal(typeof row.lane_ms, "number");
});

test("a typed refusal on any line escalates to the lane, however confident; it never refuses on its own here", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.99 }, { verdict: "not_authorized", confidence: 0.99 }]);
	const table = await openTable({ responses: turn(bookkeeping), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "authorized", grounds: "the player named the Globe morgue" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);

	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the lane admitted it");
	const [row] = admissionRows(table);
	assert.equal(row.path, "lane");
	assert.equal(row.jev_fallback, "typed_refusal");
	assert.deepEqual(row.line_verdicts, ["authorized", "not_authorized"]);
});

test("an uncertain line escalates too", async (t) => {
	installJev(t, [{ verdict: "uncertain", confidence: 0.95 }]);
	const table = await openTable({ responses: turn(bookkeeping), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "the search takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(admissionRows(table)[0].jev_fallback, "typed_refusal");
});

test("a resolve on an investigator is not on the fast path: however confident the typed answer, the lane decides (§32.12.2: both run)", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.99 }]);
	const table = await openTable({ env: KEY,
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "翻剪报", method: "用图书馆使用查旧闻" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻着剪报。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "the player only asked about clippings", missing: "which method" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt("我翻剪报");
	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.resolve").length, 0, "the lane's refusal stood over a typed 0.99 admission");
	const [row] = admissionRows(table);
	assert.equal(row.path, "lane");
	assert.equal(row.fast_path, undefined);
	assert.equal(row.jev_fallback, undefined, "the typed answer could not stand here, so no fallback is named");
});

test("a batch carrying a kind §32 ties to consent (an item) is not a bookkeeping batch: a confident typed admission does not stand, the lane decides", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.99 }]);
	const table = await openTable({ env: KEY,
		responses: turn([{ kind: "clue", clue: "globe-unpublished-story" }, { kind: "item", name: "剪报", quantity: 1, why: "带走" }]),
		laneResponses: { admission: [slowVerdict({ verdict: "not_authorized", grounds: "taking the clippings away was not asked", missing: "whether to take them" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stood");
	assert.equal(admissionRows(table)[0].path, "lane");
});
