/** The typed setup-name-boundary family's own policy (contract §98 addendum 8, SL-68): closed one-or-two-row
 * batch, packing, typed result, fail-safe "keep the token" default. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import {
	NAME_BOUNDARY_FAMILY, checkNameBoundary, interpretNameBoundary, nameBoundaryBatch, nameBoundaryBindings,
} from "../../runtime/jev/setup-name-boundary-domain.ts";

const input = (overrides = {}) => ({ sentence: "名字叫雷·卡特，现在就做卡吧。", name: "叫雷·卡特", leading: "叫", ...overrides });

function lease(campaign, epoch, value) {
	const bindings = nameBoundaryBindings(campaign, epoch, value);
	return new TaskLease({ owner: NAME_BOUNDARY_FAMILY, goal: "test", scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet,
		budget: { deadlineAt: Date.now() + 5000, remainingInputTokens: 100000, remainingOutputTokens: 10000, remainingCostUsd: 1, remainingActions: 2 } });
}
const complete = (batch, pick) => ({ batchId: batch.id, status: "complete", issues: [], usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.00001 },
	coverage: { required: batch.questions.map((q) => q.key), answered: batch.questions.map((q) => q.key), unknown: [] },
	answers: Object.fromEntries(batch.questions.map((q, index) => [q.key, { status: "answered", type: "choice", ...pick(q, index) }])) });
async function run(campaign, epoch, value, decide) {
	const owned = lease(campaign, epoch, value);
	try { return await checkNameBoundary(campaign, epoch, value, { decide }, owned); } finally { owned.close(); }
}
/** A row's answer at the SL-52 margin (`ROW_MIN = 0.5`, `ROW_RATIO = 2`): confidence against the other option. */
const clears = (choice, confidence, other) => ({ choice, confidence, probabilities: choice === "yes" ? { yes: confidence, no: other } : { yes: other, no: confidence } });

test("the batch asks one row per boundary actually in question, never a row for a boundary not passed in", () => {
	const leadingOnly = nameBoundaryBatch("c1", "e1", input());
	assert.equal(leadingOnly.family, NAME_BOUNDARY_FAMILY);
	assert.equal(leadingOnly.scope.audience, "player");
	assert.deepEqual(leadingOnly.questions.map((q) => [q.key, q.target, q.type]), [["leading", "leading", "choice"]]);
	assert.match(leadingOnly.questions[0].instructions, /叫/);
	assert.deepEqual(Object.keys(leadingOnly.questions[0].criteria), ["yes", "no", "unclear"]);
	assert.doesNotThrow(() => packDecisionBatch(leadingOnly));

	const both = nameBoundaryBatch("c1", "e1", input({ trailing: "特" }));
	assert.deepEqual(both.questions.map((q) => q.key), ["leading", "trailing"]);
	assert.equal(both.state.leading, "叫"); assert.equal(both.state.trailing, "特");

	const trailingOnly = nameBoundaryBatch("c1", "e1", { sentence: "x", name: "y", trailing: "z" });
	assert.deepEqual(trailingOnly.questions.map((q) => q.key), ["trailing"]);
});

test("interpretNameBoundary: a row clearing no at the SL-52 margin drops that token; anything else keeps it", () => {
	const value = input({ trailing: "特" });
	const batch = nameBoundaryBatch("c1", "e1", value);

	const dropLeading = complete(batch, (q) => (q.key === "leading" ? clears("no", 0.8, 0.15) : clears("yes", 0.8, 0.15)));
	assert.deepEqual(interpretNameBoundary(value, dropLeading), { leading: false, trailing: true });

	const keepBoth = complete(batch, () => clears("yes", 0.8, 0.15));
	assert.deepEqual(interpretNameBoundary(value, keepBoth), { leading: true, trailing: true });

	const unclear = complete(batch, () => ({ choice: "unclear" }));
	assert.deepEqual(interpretNameBoundary(value, unclear), { leading: true, trailing: true }, "unclear never drops a token");

	// Below the SL-52 margin (ROW_MIN=0.5, ROW_RATIO=2): a `no` under the ratio against `yes` never clears, so it keeps.
	const underRatio = complete(batch, (q) => (q.key === "leading" ? clears("no", 0.55, 0.3) : clears("yes", 0.8, 0.15)));
	assert.deepEqual(interpretNameBoundary(value, underRatio), { leading: true, trailing: true });

	const incomplete = { ...complete(batch, () => clears("no", 0.8, 0.15)), status: "incomplete", failure: { code: "schema_error", retryable: false } };
	assert.deepEqual(interpretNameBoundary(value, incomplete), { leading: true, trailing: true }, "an incomplete result keeps every token");

	// A boundary never asked about (not in `value`) reads as kept without inspecting the result at all.
	const leadingOnlyValue = input();
	assert.deepEqual(interpretNameBoundary(leadingOnlyValue, complete(nameBoundaryBatch("c1", "e1", leadingOnlyValue), () => clears("no", 0.9, 0.05))),
		{ leading: false, trailing: true }, "trailing was never asked about, so it reads as kept regardless of what a differently-shaped result might say");
});

test("checkNameBoundary: a clear no-row drops through the port in one call; no boundary to ask about, a foreign lease, an incomplete result and a throwing port are all named fallbacks that keep every token", async () => {
	const value = input({ trailing: "特" });
	const resolved = await run("c1", "e1", value, async (batch) => complete(batch, (q) => (q.key === "leading" ? clears("no", 0.8, 0.1) : clears("yes", 0.8, 0.1))));
	assert.deepEqual(resolved, { leading: false, trailing: true });

	const nothingToAsk = await run("c1", "e1", { sentence: "x", name: "y" }, async () => { throw new Error("must not run"); });
	assert.deepEqual(nothingToAsk, { leading: true, trailing: true });

	const incomplete = await run("c1", "e1", value, async (batch) => ({ ...complete(batch, () => clears("no", 0.8, 0.1)), status: "incomplete", failure: { code: "schema_error", retryable: false } }));
	assert.deepEqual(incomplete, { leading: true, trailing: true });

	const throwingPort = await run("c1", "e1", value, async () => { throw new Error("port down"); });
	assert.deepEqual(throwingPort, { leading: true, trailing: true });

	const foreign = lease("c1", "e1", input({ leading: "different" }));
	const mismatch = await checkNameBoundary("c1", "e1", value, { decide: async () => { throw new Error("must not run"); } }, foreign);
	foreign.close();
	assert.deepEqual(mismatch, { leading: true, trailing: true });
});
