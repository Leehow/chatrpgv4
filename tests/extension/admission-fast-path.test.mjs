/**
 * The bookkeeping fast path (contract §32.11) through the product path, as §32.12.3.2 (SL-97 phase 2b) narrows it: the
 * real `apply`/`resolve` tools, the real admission seam and shared decision adapter, a controlled typed endpoint behind
 * `fetch` (`typed-admission-endpoint.mjs`, answering the role-first design), and the harness's scripted `admission/a1`
 * lane, whose requests are counted.
 *
 * Every reviewed call is typed beside the lane. Since §32.12.3.2 the typed reading settles a line alone only when the
 * line's class is on the data's list (today `time`) at the settle confidence (0.87): a `move` / `clue` batch the old fast
 * path settled at 0.87 is now the lane's, line by line; a typed refusal on a listed line escalates it; a `resolve` and a
 * batch carrying another triggering kind are the lane's. The typed-settle cases themselves are in
 * `admission-typed-settle.test.mjs`.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { laneByLine, openTable } from "./harness.mjs";
import { installTypedEndpoint } from "./typed-admission-endpoint.mjs";
import { ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE, admissionFastMinConfidence } from "../../extensions/kernel/admission.ts";

const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));
/** §32.12.2: the lane and the typed answer race; a lane answer delayed past Jev's makes the order the test's own. */
const slowVerdict = (row, ms) => async () => { await new Promise((resolve) => setTimeout(resolve, ms)); return fauxAssistantMessage(JSON.stringify(row)); };
/** The typed endpoint: `lines[i]` is line i's `{verdict, confidence}`; missing none, basis the player's first passage. */
const installJev = (t, lines) => installTypedEndpoint(t, lines);
const turn = (effects) => [
	fauxAssistantMessage([fauxToolCall("apply", { effects })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "你走进了剪报室。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("after"),
];
const bookkeeping = [{ kind: "move", to: "newspaper-morgue", travel_minutes: 30 }, { kind: "clue", clue: "globe-unpublished-story" }];
const TIME = { kind: "time", minutes: 30, why: "going through the clippings" };
const WORDS = "我去环球报的剪报室查那栋房子的旧闻";

test("the fast-path threshold is the measured 0.87, read per review, and `off` turns the path off", () => {
	assert.equal(ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE, 0.87);
	assert.equal(admissionFastMinConfidence({}), 0.87);
	assert.equal(admissionFastMinConfidence({ PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "0.95" }), 0.95);
	assert.equal(admissionFastMinConfidence({ PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "2" }), 0.87);
	assert.equal(admissionFastMinConfidence({ PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" }), undefined);
});

test("§32.12.3.2: a move and clue batch typed at 0.9 is no longer settled by the typed reading -- neither class is listed, each line is the lane's", async (t) => {
	const requests = installJev(t, [{ verdict: "authorized", confidence: 0.9 }, { verdict: "entailed", confidence: 0.88 }]);
	const table = await openTable({ responses: turn(bookkeeping), env: KEY,
		laneResponses: { admission: laneByLine([[/apply (move|clue)/, { verdict: "not_authorized", grounds: "a lane that refuses", missing: "x" }, 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);

	assert.equal(requests.length, 1, "one typed request over both lines");
	assert.equal(table.lanes.admission.requests().length, 2, "one lane call per line, none cancelled");
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stands over the typed 0.88/0.9 admission");
	const rows = admissionRows(table);
	assert.ok(rows.length >= 1);
	for (const row of rows) {
		assert.equal(row.path, "lane");
		assert.equal(row.reviewer, "lane");
		assert.equal(row.fast_path, undefined, "the old fast path's fields are gone");
		assert.equal(row.jev_fallback, undefined, "a class the reading may not settle names no fallback");
		assert.equal(row.lane_cancelled, false);
	}
});

test("below the threshold the lane decides, and its refusal stands", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.86 }]);
	// §32.12.3.1: one lane call per line; the clue line alone would be admitted, the move's refusal refuses the batch.
	const table = await openTable({ responses: turn(bookkeeping), env: KEY,
		laneResponses: { admission: laneByLine([[/apply move/, { verdict: "not_authorized", grounds: "only interest", missing: "which archive to visit" }, 300],
			[/apply clue/, { verdict: "authorized", grounds: "a line that would admit on its own" }, 100]]) } });
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");

	assert.equal(table.lanes.admission.requests().length, 2, "one lane call per line");
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's refusal stands");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.verdict, row.batch_admitted]), [[1, "not_authorized", false], [2, "authorized", false]]);
	for (const row of rows) {
		assert.equal(row.path, "lane");
		assert.equal(row.jev_confidence, 0.86);
		assert.equal(row.typed_confidence, 0.86);
		assert.equal(typeof row.lane_ms, "number");
	}
});

test("§32.12.3.2: a typed refusal on a listed line escalates that line to the lane, however confident; it never refuses on its own", async (t) => {
	installJev(t, [{ verdict: "not_authorized", confidence: 0.99, missing: "method" }, { verdict: "authorized", confidence: 0.99 }]);
	const table = await openTable({ responses: turn([TIME, { kind: "clue", clue: "globe-unpublished-story" }]), env: KEY,
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "entailed", grounds: "the search the player chose takes the time" }, 200],
			[/apply clue/, { verdict: "authorized", grounds: "the clippings the player asked for" }, 100]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);

	assert.equal(table.lanes.admission.requests().length, 2);
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.map((effect) => effect.kind)), [["time", "clue"]],
		"the lane admitted both lines, so the whole batch landed in its order");
	const [time, clue] = admissionRows(table);
	assert.deepEqual([time.path, time.verdict, time.jev_fallback, time.line_class], ["lane", "entailed", "typed_refusal", "time"]);
	assert.deepEqual([clue.path, clue.jev_fallback, clue.line_class], ["lane", undefined, "clue"]);
	assert.deepEqual(time.line_verdicts, ["not_authorized", "authorized"]);
});

test("an uncertain line escalates too", async (t) => {
	installJev(t, [{ verdict: "uncertain", confidence: 0.95 }]);
	const table = await openTable({ responses: turn([TIME]), env: KEY,
		laneResponses: { admission: [slowVerdict({ verdict: "entailed", grounds: "the search takes the time" }, 300)] } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(table.lanes.admission.requests().length, 1);
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the lane admitted it");
	assert.ok(admissionRows(table).every((row) => row.jev_fallback === "typed_refusal" && row.reviewer === "lane"));
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

test("a batch carrying a kind §32 ties to consent (an item) is the lane's: a confident typed admission settles neither line, and the lane's refusal of the item refuses the batch whole", async (t) => {
	installJev(t, [{ verdict: "authorized", confidence: 0.99 }]);
	const table = await openTable({ env: KEY,
		responses: turn([{ kind: "clue", clue: "globe-unpublished-story" }, { kind: "item", name: "剪报", quantity: 1, why: "带走" }]),
		laneResponses: { admission: laneByLine([[/apply clue/, { verdict: "authorized", grounds: "the clippings the player asked for" }, 100],
			[/apply item/, { verdict: "not_authorized", grounds: "taking the clippings away was not asked", missing: "whether to take them" }, 200]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(table.lanes.admission.requests().length, 2);
	assert.deepEqual(kernelCalls(table, "table.apply"), [], "the lane's refusal of the item refused the whole batch (§32.10); nothing landed alone");
	const rows = admissionRows(table);
	assert.ok(rows.every((row) => row.path === "lane" && row.batch_admitted === false));
	assert.ok(rows.some((row) => row.verdict === "not_authorized" && /apply item/.test(row.proposed.join(" "))));
});
