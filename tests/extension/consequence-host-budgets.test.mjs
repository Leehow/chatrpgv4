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
import { JEV_STEPS_FALLBACK, jevStepsBudget } from "../../runtime/jev/host-budgets.ts";

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
	assert.deepEqual(budget, { rowMin: 0.6, rowRatio: 2.5, shadow: false, execute: ["clue_follow_up"] });
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
