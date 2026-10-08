/**
 * Contract §138.8 (BR-04): the shadow questions as pure decisions over a stub port -- the time Choice (the rows an
 * action can take, each with its range, an `unknown` exit), the damage Score (the ladder in the table's order), the
 * band as the argmax, every non-answer a `failed` result with its reason -- and the extension glue's pure parts:
 * which effects are shadowed (never a host-origin call, never `stated` or `band`), the row, `inside`.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { BAND_SHADOW_FAMILY, ROUTE_TIME_BANDS, runBandShadow, shadowBindings } from "../../runtime/jev/band-shadow-domain.ts";
import { bandShadowGate, insideBand, readBandRows, sameDice, shadowRow, shadowTargets, skippedRow, unaskedRow } from "../../extensions/kernel/band-shadow.ts";

const TIME = [
	{ handle: "quick_observation", min: 0, max: 5, default: 1 },
	{ handle: "single_room_search", min: 10, max: 45, default: 20 },
	{ handle: "local_travel", min: 10, max: 120, default: 30 },
	{ handle: "long_travel", min: 120, max: 1440, default: 360 },
	{ handle: "library_research", min: 60, max: 480, default: 180 },
];
const LADDER = [
	{ handle: "minor", dice: "1D3", note: "A person could survive numerous occurrences of this level of damage." },
	{ handle: "moderate", dice: "1D6", note: "Might cause a major wound." },
	{ handle: "severe", dice: "1D10" },
];
const base = { campaign: "c1", turn: 4, callId: "t4-c2", index: 0, declaration: "I search the study", settled: ["resolve settled (success)"] };
const TIME_INPUT = { ...base, kind: "time", rows: TIME };
const DAMAGE_INPUT = { ...base, kind: "damage", rows: LADDER };

/** A stub port: `answer(question, batch)` returns the wire-normalized answer for the one question; every batch is recorded. */
function port(answer, extra = {}) {
	const batches = [];
	return { batches, decide: async (batch) => {
		batches.push(batch);
		const [question] = batch.questions;
		const given = answer(question, batch);
		return { batchId: batch.id, status: given ? "complete" : "unavailable", answers: given ? { [question.key]: given } : {},
			coverage: { required: [question.key], answered: given ? [question.key] : [], unknown: [] }, issues: [], usage: { inputTokens: 200, outputTokens: 4 }, ...extra };
	} };
}
function lease(input) {
	const bindings = shadowBindings(input);
	return new TaskLease({ owner: BAND_SHADOW_FAMILY, goal: "test", scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet,
		signal: new AbortController().signal, budget: { deadlineAt: Date.now() + 10_000, remainingInputTokens: 100_000, remainingOutputTokens: 10_000, remainingCostUsd: 1, remainingActions: 5 } });
}
const choice = (choice, probabilities, confidence = 0.7) => ({ status: "answered", type: "choice", choice, confidence, probabilities });
const run = (input, stub) => runBandShadow(input, stub, lease(input));

test("the time question is one Choice over the rows an action can take, each with its range, with an unknown exit, over the declaration only", async () => {
	const stub = port((question) => choice("single_room_search", Object.fromEntries(Object.keys(question.criteria)
		.map((key) => [key, key === "single_room_search" ? 0.7 : 0.1]))));
	const result = await run(TIME_INPUT, stub);
	assert.deepEqual({ ...result, elapsedMs: 0 }, { status: "answered", kind: "time", band: "single_room_search", confidence: 0.7,
		distribution: { quick_observation: 0.1, single_room_search: 0.7, library_research: 0.1, unknown: 0.1 }, calls: 1, elapsedMs: 0,
		usage: { inputTokens: 200, outputTokens: 4, costUsd: 0 } });
	const [batch] = stub.batches;
	assert.equal(batch.family, BAND_SHADOW_FAMILY);
	assert.deepEqual([batch.scope, batch.readSet], [shadowBindings(TIME_INPUT).scope, shadowBindings(TIME_INPUT).readSet]);
	const [question] = batch.questions;
	assert.equal(question.type, "choice");
	assert.deepEqual(Object.keys(question.criteria), ["quick_observation", "single_room_search", "library_research", "unknown"]);
	for (const road of ROUTE_TIME_BANDS) assert.ok(!Object.hasOwn(question.criteria, road), `${road} is a road's time, never offered`);
	assert.equal(question.criteria.library_research, "library research: 60 to 480 minutes");
	assert.deepEqual(batch.state, { declaration: "I search the study", settled_this_turn: ["resolve settled (success)"] });
});

test("the band is the argmax of the distribution; an argmax on the unknown exit is an answer with no band", async () => {
	const skewed = await run(TIME_INPUT, port(() => choice("quick_observation",
		{ quick_observation: 0.3, single_room_search: 0.4, library_research: 0.2, unknown: 0.1 }, 0.4)));
	assert.equal(skewed.band, "single_room_search");
	const unknown = await run(TIME_INPUT, port(() => choice("unknown",
		{ quick_observation: 0.1, single_room_search: 0.1, library_research: 0.1, unknown: 0.7 })));
	assert.equal(unknown.status, "answered");
	assert.equal(unknown.band, null);
	assert.equal(unknown.distribution.unknown, 0.7);
	// A tie goes to the first row in the table's order.
	const tie = await run(TIME_INPUT, port(() => choice("library_research",
		{ quick_observation: 0.1, single_room_search: 0.4, library_research: 0.4, unknown: 0.1 })));
	assert.equal(tie.band, "single_room_search");
});

test("the damage question is one Score over the ladder in the table's order; the rows are named on the record, the level kept", async () => {
	const stub = port((question) => ({ status: "answered", type: "score", score: 1.1, confidence: 0.55,
		legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])), probabilities: { 0: 0.2, 1: 0.5, 2: 0.3 } }));
	const result = await run(DAMAGE_INPUT, stub);
	assert.equal(result.status, "answered");
	assert.equal(result.band, "moderate");
	assert.equal(result.score, 1.1);
	assert.equal(result.confidence, 0.55);
	assert.deepEqual(result.distribution, { minor: 0.2, moderate: 0.5, severe: 0.3 });
	const [question] = stub.batches[0].questions;
	assert.equal(question.type, "score");
	assert.deepEqual(question.criteria, [
		"minor, 1D3: A person could survive numerous occurrences of this level of damage.",
		"moderate, 1D6: Might cause a major wound.",
		"severe, 1D10",
	]);
	assert.deepEqual(stub.batches[0].state, { declaration: "I search the study", settled_this_turn: ["resolve settled (success)"] });
});

test("every non-answer is a failed result with its reason, and a question never asked costs no call", async () => {
	const timeout = await run(TIME_INPUT, port(() => undefined, { failure: { code: "timeout", retryable: false } }));
	assert.deepEqual([timeout.status, timeout.reason, timeout.calls], ["failed", "timeout", 1]);
	const unknown = await run(TIME_INPUT, port(() => ({ status: "unknown" })));
	assert.deepEqual([unknown.status, unknown.reason], ["failed", "answer_unknown"]);
	const empty = await run({ ...TIME_INPUT, rows: [] }, port(() => { throw new Error("never asked"); }));
	assert.deepEqual([empty.reason, empty.calls], ["no_rows", 0]);
	// A ladder longer than a Score can carry is refused by the packer before anything is sent.
	const long = { ...DAMAGE_INPUT, rows: Array.from({ length: 11 }, (_, index) => ({ handle: `rung_${index}`, dice: `${index + 1}D6` })) };
	const refused = await run(long, port(() => { throw new Error("never asked"); }));
	assert.deepEqual([refused.reason, refused.calls], ["schema_error", 0]);
	const thrown = await run(TIME_INPUT, { decide: async () => { throw new Error("boom"); } });
	assert.equal(thrown.reason, "shadow_owner_error");
});

test("the declaration is clipped and only the last settled lines are read", async () => {
	const stub = port((question) => choice("unknown", Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === "unknown" ? 1 : 0]))));
	await run({ ...TIME_INPUT, declaration: "x".repeat(700), settled: Array.from({ length: 20 }, (_, index) => `apply landed: clue:c${index}`) }, stub);
	const { state } = stub.batches[0];
	assert.equal(Array.from(state.declaration).length, 600);
	assert.ok(state.declaration.endsWith("..."));
	assert.deepEqual(state.settled_this_turn, Array.from({ length: 16 }, (_, index) => `apply landed: clue:c${index + 4}`));
});

test("only a model-origin apply's own numbers are shadowed: not a host-origin call, not stated, not band, not another kind", () => {
	const payload = { effects: [
		{ kind: "time", minutes: 25, why: "w" },
		{ kind: "time", stated: "long-search" },
		{ kind: "time", band: "single_room_search" },
		{ kind: "damage", dice: "1D6" },
		{ kind: "damage", band: "minor" },
		{ kind: "damage", stated: "chapel-floor" },
		{ kind: "cash", delta: -5 },
		{ kind: "damage", dice: "  " },
		null,
	] };
	assert.deepEqual(shadowTargets("apply", payload, undefined), [
		{ index: 0, kind: "time", keeperValue: 25 }, { index: 3, kind: "damage", keeperValue: "1D6" }]);
	assert.deepEqual(shadowTargets("apply", payload, { origin: "policy", run: "r", step: "s", clerk: "move" }), [], "a clerk's write is never shadowed");
	assert.deepEqual(shadowTargets("resolve", payload, undefined), []);
	assert.deepEqual(shadowTargets("apply", {}, undefined), []);
});

test("inside: minutes within the row's range, both ends included; dice equal to the rung's with case and spacing ignored", () => {
	const time = (minutes) => insideBand({ index: 0, kind: "time", keeperValue: minutes }, { min: 10, max: 45 });
	assert.deepEqual([time(9), time(10), time(45), time(46)], [false, true, true, false]);
	assert.equal(insideBand({ index: 0, kind: "damage", keeperValue: "1d6" }, "1D6"), true);
	assert.equal(insideBand({ index: 0, kind: "damage", keeperValue: "1D6+1" }, "1D6"), false);
	assert.equal(insideBand({ index: 0, kind: "time", keeperValue: 10 }, null), null);
	assert.ok(sameDice(" 2d10 ", "2D10"));
	assert.ok(sameDice("1D6 + 1", "1d6+1"));
});

test("the row: answered, answered with no band, failed, never asked", () => {
	const rows = { kind: "time", rows: TIME };
	const target = { index: 1, kind: "time", keeperValue: 30 }, at = { turn: 4, callId: "t4-c2" };
	const answered = { status: "answered", kind: "time", band: "single_room_search", confidence: 0.61, distribution: { single_room_search: 0.61, unknown: 0.39 }, calls: 1, elapsedMs: 212, usage: {} };
	assert.deepEqual(shadowRow(target, at, rows, answered, 0.5), { lane: "band-shadow", turn: 4, call_id: "t4-c2", index: 1, kind: "time", table: "time-costs",
		keeper_value: 30, ok: true, band: "single_room_search", range: { min: 10, max: 45 }, inside: true, confidence: 0.61,
		distribution: { single_room_search: 0.61, unknown: 0.39 }, gate: 0.5, ms: 212, jev_calls: 1 });
	const none = shadowRow(target, at, rows, { ...answered, band: null }, 0.5);
	assert.deepEqual([none.ok, none.reason, none.band, none.range, none.inside, none.confidence], [true, "unknown", null, null, null, 0.61]);
	const failed = shadowRow(target, at, rows, { status: "failed", kind: "time", reason: "timeout", calls: 1, elapsedMs: 4000, usage: {} }, 0.7);
	assert.deepEqual([failed.ok, failed.reason, failed.band, failed.inside, failed.distribution, failed.gate, failed.ms], [false, "timeout", null, null, null, 0.7, 4000]);
	// A deliberate skip is not a failure (the admission lane's convention); a question the kernel's rows could not feed is.
	assert.deepEqual(skippedRow(target, at, "unconfigured"), { lane: "band-shadow", turn: 4, call_id: "t4-c2", index: 1, kind: "time", ok: true, skipped: "unconfigured" });
	assert.deepEqual(unaskedRow(target, at, "rows_unavailable"), { lane: "band-shadow", turn: 4, call_id: "t4-c2", index: 1, kind: "time", ok: false, reason: "rows_unavailable" });
	const damage = shadowRow({ index: 0, kind: "damage", keeperValue: "1d6" }, at, { kind: "damage", rows: LADDER },
		{ status: "answered", kind: "damage", band: "moderate", confidence: 0.4, distribution: { minor: 0.3, moderate: 0.4, severe: 0.3 }, score: 1, calls: 1, elapsedMs: 5, usage: {} }, 0.5);
	assert.deepEqual([damage.table, damage.range, damage.inside, damage.score], ["hazards", "1D6", true, 1]);
});

test("the gate is read for the record only, and the kernel's rows are read defensively", () => {
	assert.equal(bandShadowGate({}), 0.5);
	assert.equal(bandShadowGate({ PI_COC_BAND_MIN_CONFIDENCE: "0.7" }), 0.7);
	assert.equal(bandShadowGate({ PI_COC_BAND_MIN_CONFIDENCE: "1.5" }), 0.5);
	assert.deepEqual(readBandRows("time", { rows: [{ handle: "a", min: 1, max: 2, default: 1 }, { handle: "b", min: "x", max: 2 }] }),
		{ kind: "time", rows: [{ handle: "a", min: 1, max: 2, default: 1 }] });
	// §202.1: what act a row covers rides to the question, trimmed; a blank one is left out, never invented.
	assert.deepEqual(readBandRows("time", { rows: [{ handle: "a", min: 1, max: 2, covers: " One thing. " }, { handle: "b", min: 3, max: 4, covers: "  " }] }),
		{ kind: "time", rows: [{ handle: "a", min: 1, max: 2, covers: "One thing." }, { handle: "b", min: 3, max: 4 }] });
	assert.deepEqual(readBandRows("damage", { rows: [{ handle: "minor", dice: "1D3", note: "n" }, { handle: "bad" }] }),
		{ kind: "damage", rows: [{ handle: "minor", dice: "1D3", note: "n" }] });
	assert.equal(readBandRows("time", { rows: [] }), undefined);
	assert.equal(readBandRows("damage", null), undefined);
});
