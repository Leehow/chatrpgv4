/**
 * SL-82 (contract §135.29 addendum 2): the step-1 call's own allowance comes from
 * `content/rulesets/coc7/host-budgets.json`'s `first_step_thinking.call_cap_ms`, the same rules-data file
 * SL-72's `look_budget` and SL-76's `jev_steps` live in -- never a literal in `hybrid-engine.ts`. This test
 * proves the value is actually read: it writes a fixture directory shaped like `extensionContentRoot()`,
 * points `firstStepThinkingBudget` at it, and checks that editing the file changes what comes back
 * (mirroring `tests/extension/consequence-host-budgets.test.mjs`'s own proof for `jev_steps`).
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FIRST_STEP_THINKING_BUDGET_FALLBACK, firstStepThinkingBudget } from "../../runtime/jev/host-budgets.ts";

function fixture(t, firstStepThinking) {
	const root = mkdtempSync(join(tmpdir(), "first-step-thinking-budget-"));
	mkdirSync(join(root, "rulesets", "coc7"), { recursive: true });
	writeFileSync(join(root, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, look_budget: { per_turn: 8, tools: [] }, first_step_thinking: firstStepThinking }));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test("firstStepThinkingBudget: reads call_cap_ms from the data file", async (t) => {
	const root = fixture(t, { call_cap_ms: 45_000 });
	const budget = await firstStepThinkingBudget(root);
	assert.deepEqual(budget, { callCapMs: 45_000 });
});

test("firstStepThinkingBudget: mutating the file's number changes what is returned -- proving it is read, not a constant", async (t) => {
	const first = await firstStepThinkingBudget(fixture(t, { call_cap_ms: 60_000 }));
	const second = await firstStepThinkingBudget(fixture(t, { call_cap_ms: 90_000 }));
	assert.notEqual(first.callCapMs, second.callCapMs);
	assert.equal(second.callCapMs, 90_000);
});

test("firstStepThinkingBudget: an out-of-range or missing value falls back to the shipped default", async (t) => {
	const zero = await firstStepThinkingBudget(fixture(t, { call_cap_ms: 0 }));
	assert.equal(zero.callCapMs, FIRST_STEP_THINKING_BUDGET_FALLBACK.callCapMs, "call_cap_ms <= 0 falls back");
	const negative = await firstStepThinkingBudget(fixture(t, { call_cap_ms: -1000 }));
	assert.equal(negative.callCapMs, FIRST_STEP_THINKING_BUDGET_FALLBACK.callCapMs, "a negative value falls back");
	const missing = await firstStepThinkingBudget(fixture(t, {}));
	assert.equal(missing.callCapMs, FIRST_STEP_THINKING_BUDGET_FALLBACK.callCapMs, "no first_step_thinking key falls back");
});

test("firstStepThinkingBudget: a missing or unreadable file falls back whole, never throws", async () => {
	const budget = await firstStepThinkingBudget(join(tmpdir(), "first-step-thinking-budget-does-not-exist"));
	assert.deepEqual(budget, FIRST_STEP_THINKING_BUDGET_FALLBACK);
});

test("firstStepThinkingBudget: the shipped content/rulesets/coc7/host-budgets.json carries SL-82's own default", async () => {
	// No contentRoot argument: the real content directory this repo ships.
	const budget = await firstStepThinkingBudget();
	assert.deepEqual(budget, FIRST_STEP_THINKING_BUDGET_FALLBACK, "the shipped file's first_step_thinking matches the fallback it also names as the default");
});
