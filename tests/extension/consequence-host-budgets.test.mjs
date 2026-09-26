/**
 * SL-76 (contract §135.3.1): `jev_steps` thresholds come from `content/rulesets/coc7/host-budgets.json`, the same
 * rules-data file SL-72's `look_budget` lives in -- never a literal in `consequence-route.ts`/`hybrid-engine.ts`.
 * This test proves the value is actually read: it writes a fixture directory shaped like `extensionContentRoot()`,
 * points `jevStepsBudget` at it, and checks that editing the file changes what comes back.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JEV_STEPS_FALLBACK, jevStepsBudget, thresholdsForClass } from "../../runtime/jev/host-budgets.ts";
import { noulClears } from "../../runtime/jev/consequence-route.ts";

function fixture(t, jevSteps) {
	const root = mkdtempSync(join(tmpdir(), "jev-steps-budget-"));
	mkdirSync(join(root, "rulesets", "coc7"), { recursive: true });
	writeFileSync(join(root, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, look_budget: { per_turn: 8, tools: [] }, jev_steps: jevSteps }));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test("jevStepsBudget: reads row_min/row_ratio/shadow/execute from the data file", async (t) => {
	const root = fixture(t, { row_min: 0.6, row_ratio: 2.5, shadow: false, execute: ["clue_follow_up"] });
	const budget = await jevStepsBudget(root);
	assert.deepEqual(budget, { rowMin: 0.6, rowRatio: 2.5, shadow: false, execute: ["clue_follow_up"], classRowMin: {}, classRowRatio: {} });
});

test("jevStepsBudget (SL-78): `execute` is empty when the file names none, filters out a non-string entry, and never throws on a bad shape", async (t) => {
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2 }))).execute, [], "no `execute` key: nothing executes");
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, execute: ["clue_follow_up", 7, null, "npc_reaction"] }))).execute,
		["clue_follow_up", "npc_reaction"], "a non-string entry is dropped, not a reason to fall back whole");
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, execute: "clue_follow_up" }))).execute, [],
		"`execute` that is not an array falls back to the empty default, never a guess at what was meant");
});

test("jevStepsBudget: mutating the file's numbers changes what is returned -- proving it is read, not a constant", async (t) => {
	const first = await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2 }));
	const second = await jevStepsBudget(fixture(t, { row_min: 0.9, row_ratio: 5 }));
	assert.notEqual(first.rowMin, second.rowMin);
	assert.notEqual(first.rowRatio, second.rowRatio);
	assert.equal(second.rowMin, 0.9);
	assert.equal(second.rowRatio, 5);
});

test("jevStepsBudget: an out-of-range or missing value falls back to the shipped default, field by field", async (t) => {
	const budget = await jevStepsBudget(fixture(t, { row_min: 1.5, row_ratio: 0.5 }));
	assert.equal(budget.rowMin, JEV_STEPS_FALLBACK.rowMin, "row_min outside (0,1) falls back");
	assert.equal(budget.rowRatio, JEV_STEPS_FALLBACK.rowRatio, "row_ratio not > 1 falls back");
	assert.equal(budget.shadow, JEV_STEPS_FALLBACK.shadow, "no shadow key falls back");
	assert.deepEqual(budget.execute, JEV_STEPS_FALLBACK.execute, "no execute key falls back");
});

test("jevStepsBudget: a missing or unreadable file falls back whole, never throws", async () => {
	const budget = await jevStepsBudget(join(tmpdir(), "jev-steps-budget-does-not-exist"));
	assert.deepEqual(budget, JEV_STEPS_FALLBACK);
});

test("jevStepsBudget: the shipped `content/rulesets/coc7/host-budgets.json` carries SL-76's row gate and SL-78's `clue_follow_up` execute list", async () => {
	// No contentRoot argument: the real content directory this repo ships.
	const budget = await jevStepsBudget();
	assert.equal(budget.rowMin, JEV_STEPS_FALLBACK.rowMin);
	assert.equal(budget.rowRatio, JEV_STEPS_FALLBACK.rowRatio);
	assert.equal(budget.shadow, JEV_STEPS_FALLBACK.shadow);
	assert.deepEqual(budget.execute, ["clue_follow_up"], "SL-78's ruling: only clue_follow_up executes; npc_reaction and time_cost stay shadow");
});

test("jevStepsBudget (SL-86, §135.32 addendum 3): reads a per-class `row_min` override from `jev_steps.classes`, leaving `row_ratio` shared", async (t) => {
	const root = fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_min: 0.35 } } });
	const budget = await jevStepsBudget(root);
	assert.deepEqual(budget.classRowMin, { clue_follow_up: 0.35 });
	assert.equal(budget.rowRatio, 2, "row_ratio is never overridden per class");
});

test("jevStepsBudget (SL-86): an out-of-range, non-numeric, or missing `row_min` for a class falls back to the shared default, and a bad `classes` shape never throws", async (t) => {
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_min: 1.5 } } }))).classRowMin, {},
		"out of (0,1): dropped, not carried through");
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_min: "0.35" } } }))).classRowMin, {},
		"a string is not a number: dropped");
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: {} } }))).classRowMin, {}, "no row_min key: dropped");
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: "clue_follow_up" }))).classRowMin, {},
		"`classes` that is not an object falls back to empty, never throws");
	assert.deepEqual((await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2 }))).classRowMin, {}, "no `classes` key at all: empty");
});

test("jevStepsBudget (SL-86): mutating a class's row_min changes only that class -- proving it is read, not a literal", async (t) => {
	const first = await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_min: 0.35 } } }));
	const second = await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_min: 0.2 } } }));
	assert.notEqual(first.classRowMin.clue_follow_up, second.classRowMin.clue_follow_up);
	assert.equal(second.classRowMin.clue_follow_up, 0.2);
});

test("jevStepsBudget: the shipped file opens `clue_follow_up` at row_min 0.4 with its own row_ratio 0.67 (effective Noul gate 0.4; §135.32 addendum 3.1)", async () => {
	const budget = await jevStepsBudget();
	assert.deepEqual(budget.classRowMin, { clue_follow_up: 0.4 });
	assert.deepEqual(budget.classRowRatio, { clue_follow_up: 0.67 });
});

// SL-86 finding (owner-facing, ticket 86 Comments): `noulClears`'s row gate is `p >= rowMin AND p >= rowRatio *
// (1-p)`. Solving the ratio term alone gives `p >= rowRatio/(1+rowRatio)`, which for the shared `row_ratio: 2` is
// `p >= 0.667` -- a floor that binds regardless of `rowMin` whenever `rowMin <= 0.667`. Both the old shared
// `row_min` (0.5) and the new `clue_follow_up` override (0.35) are below that floor, so at the *shared* ratio the
// override is mathematically inert: no probability clears `true` under 0.35 that would not already have cleared
// under 0.5, and none of gate #17's seven false-negative probabilities (0.12-0.45) come close to 0.667 either way.
// The plumbing this ticket adds (data file -> `jevStepsBudget` -> `thresholdsForClass` -> `interpretConsequenceResult`)
// is correct and is what the ticket's scope asks for; whether `clue_follow_up` also needs its own `row_ratio` (not
// just `row_min`) to move the recall number is a live question for the human reading the next table's report, not
// settled by this test file.
test("jevStepsBudget/noulClears (SL-86 finding): at the shared row_ratio of 2, a row_min of 0.35 clears no probability that 0.5 would not already clear", async () => {
	const { noulClears } = await import("../../runtime/jev/consequence-route.ts");
	for (const p of [0.12, 0.20, 0.24, 0.37, 0.39, 0.45, 0.5, 0.6, 0.66]) {
		const old = noulClears(p, { rowMin: 0.5, rowRatio: 2 });
		const shipped = noulClears(p, { rowMin: 0.35, rowRatio: 2 });
		assert.equal(shipped, old, `p=${p}: row_min 0.35 and 0.5 agree while row_ratio is 2 (both below the ratio's own 0.667 floor)`);
	}
});

test("thresholdsForClass (SL-86): a named class's own row_min, the shared row_ratio; an unnamed class falls back to the shared gate entirely", () => {
	const budget = { rowMin: 0.5, rowRatio: 2, classRowMin: { clue_follow_up: 0.35 } };
	assert.deepEqual(thresholdsForClass(budget, "clue_follow_up"), { rowMin: 0.35, rowRatio: 2 });
	assert.deepEqual(thresholdsForClass(budget, "npc_reaction"), { rowMin: 0.5, rowRatio: 2 }, "unnamed class: the shared gate, unchanged");
	assert.deepEqual(thresholdsForClass(budget, "time_cost"), { rowMin: 0.5, rowRatio: 2 });
});

test("jevStepsBudget (§135.32 addendum 3.1): a per-class `row_ratio` is read and used, so a class can lower its effective Noul gate", async (t) => {
	const budget = await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_min: 0.4, row_ratio: 0.67 } } }));
	assert.deepEqual(budget.classRowRatio, { clue_follow_up: 0.67 });
	assert.deepEqual(thresholdsForClass(budget, "clue_follow_up"), { rowMin: 0.4, rowRatio: 0.67 });
	assert.deepEqual(thresholdsForClass(budget, "npc_reaction"), { rowMin: 0.5, rowRatio: 2 }, "an unlisted class keeps the shared gate");
	assert.equal(noulClears(0.42, thresholdsForClass(budget, "clue_follow_up")), "true", "0.42 clears the clue class (effective gate 0.4)");
	assert.equal(noulClears(0.42, thresholdsForClass(budget, "npc_reaction")), undefined, "0.42 does not clear the shared gate (effective 0.667)");
	const bad = await jevStepsBudget(fixture(t, { row_min: 0.5, row_ratio: 2, classes: { clue_follow_up: { row_ratio: -1 } } }));
	assert.deepEqual(bad.classRowRatio, {}, "a non-positive per-class ratio is ignored");
});
