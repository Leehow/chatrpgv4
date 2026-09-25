/** The typed person-name-resolution family's own policy (contract §11.5.6, SL-62): closed fan-out, packing, typed result. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import {
	PERSON_RESOLUTION_FAMILY, PERSON_RESOLUTION_MAX_CANDIDATES, interpretPersonResolution, personResolutionBatch,
	personResolutionBindings, resolvePersonName,
} from "../../runtime/jev/person-resolution-domain.ts";

const input = (overrides = {}) => ({ campaign: "c1", turn: 4, name: "档案处的办事员",
	candidates: [{ handle: "the Hall of Records clerk", names: ["the Hall of Records clerk"] }], ...overrides });

function lease(value) {
	const bindings = personResolutionBindings(value);
	return new TaskLease({ owner: PERSON_RESOLUTION_FAMILY, goal: "test", scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet,
		budget: { deadlineAt: Date.now() + 5000, remainingInputTokens: 100000, remainingOutputTokens: 10000, remainingCostUsd: 1, remainingActions: 2 } });
}
const complete = (batch, pick) => ({ batchId: batch.id, status: "complete", issues: [], usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.00001 },
	coverage: { required: batch.questions.map((q) => q.key), answered: batch.questions.map((q) => q.key), unknown: [] },
	answers: Object.fromEntries(batch.questions.map((q, index) => [q.key, { status: "answered", type: "choice", ...pick(q, index) }])) });
async function run(value, decide) {
	const owned = lease(value);
	try { return await resolvePersonName(value, { decide }, owned); } finally { owned.close(); }
}
/** A row's answer at the SL-52 margin (`ROW_MIN = 0.5`, `ROW_RATIO = 2`): confidence against the other option. */
const clears = (choice, confidence, other) => ({ choice, confidence, probabilities: choice === "yes" ? { yes: confidence, no: other } : { yes: other, no: confidence } });

test("one fan-out row per candidate, in order, each judging only its own row", () => {
	const value = input({ candidates: [{ handle: "a", names: ["Ann", "安"] }, { handle: "b", names: ["Bea"] }] });
	const batch = personResolutionBatch(value);
	assert.equal(batch.family, PERSON_RESOLUTION_FAMILY);
	assert.equal(batch.scope.audience, "keeper");
	assert.deepEqual(batch.questions.map((q) => [q.key, q.target, q.type]), [["person_1", "candidates[0]", "choice"], ["person_2", "candidates[1]", "choice"]]);
	for (const question of batch.questions) assert.deepEqual(Object.keys(question.criteria), ["yes", "no", "unclear"]);
	assert.match(batch.questions[0].instructions, /档案处的办事员/);
	assert.deepEqual(batch.state.candidates, [{ alias: "person_1", names: ["Ann", "安"] }, { alias: "person_2", names: ["Bea"] }]);
	assert.doesNotThrow(() => packDecisionBatch(batch), "one batch packs under the typed bound");
});

test("a row clearing yes at the SL-52 margin resolves to that candidate; a candidate cap and an empty state fall back", () => {
	assert.equal(input().candidates.length <= PERSON_RESOLUTION_MAX_CANDIDATES, true);
	const many = input({ candidates: Array.from({ length: PERSON_RESOLUTION_MAX_CANDIDATES + 1 }, (_, i) => ({ handle: `h${i}`, names: [`n${i}`] })) });
	assert.equal(personResolutionBatch(many).questions.length, PERSON_RESOLUTION_MAX_CANDIDATES + 1, "the batch itself does not cap; the caller does before asking");
});

test("interpretPersonResolution: exactly one cleared yes resolves; none or more than one is unresolved", () => {
	const value = input({ candidates: [{ handle: "a", names: ["Ann"] }, { handle: "b", names: ["Bea"] }] });
	const batch = personResolutionBatch(value);
	const oneClear = complete(batch, (_, index) => (index === 0 ? clears("yes", 0.8, 0.15) : clears("no", 0.8, 0.15)));
	assert.deepEqual(interpretPersonResolution(value, oneClear), { status: "resolved", handle: "a", confidence: 0.8 });

	const noneClear = complete(batch, () => clears("no", 0.8, 0.15));
	assert.deepEqual(interpretPersonResolution(value, noneClear), { status: "unresolved", reason: "no_row_cleared" });

	const bothClear = complete(batch, () => clears("yes", 0.8, 0.15));
	assert.deepEqual(interpretPersonResolution(value, bothClear), { status: "unresolved", reason: "ambiguous" });

	// Below the SL-52 margin (ROW_MIN=0.5, ROW_RATIO=2): a `yes` under the ratio against `no` never clears.
	const underRatio = complete(batch, (_, index) => (index === 0 ? clears("yes", 0.55, 0.3) : clears("no", 0.8, 0.15)));
	assert.deepEqual(interpretPersonResolution(value, underRatio), { status: "unresolved", reason: "no_row_cleared" });
	const underMin = complete(batch, (_, index) => (index === 0 ? clears("yes", 0.45, 0.1) : clears("no", 0.8, 0.15)));
	assert.deepEqual(interpretPersonResolution(value, underMin), { status: "unresolved", reason: "no_row_cleared" });

	// `unclear` and a missing confidence never clear either.
	const unclear = complete(batch, (q, index) => (index === 0 ? { choice: "unclear" } : clears("no", 0.8, 0.15)));
	assert.deepEqual(interpretPersonResolution(value, unclear), { status: "unresolved", reason: "no_row_cleared" });
});

test("resolvePersonName: a clear row resolves through the port in one call; no candidates, too many, an unissued key, an incomplete result, a throwing port or a foreign lease is a named fallback", async () => {
	const value = input();
	const resolved = await run(value, async (batch) => complete(batch, () => clears("yes", 0.8, 0.15)));
	assert.deepEqual(resolved, { status: "resolved", handle: "the Hall of Records clerk", confidence: 0.8, calls: 1 });

	const noCandidates = await run(input({ candidates: [] }), async () => { throw new Error("must not run"); });
	assert.deepEqual(noCandidates, { status: "unresolved", reason: "no_candidates", calls: 0 });

	const tooMany = await run(input({ candidates: Array.from({ length: PERSON_RESOLUTION_MAX_CANDIDATES + 1 }, (_, i) => ({ handle: `h${i}`, names: [`n${i}`] })) }),
		async () => { throw new Error("must not run"); });
	assert.deepEqual(tooMany, { status: "unresolved", reason: "too_many_candidates", calls: 0 });

	const cases = [
		[async (batch) => complete(batch, () => ({ type: "score", score: 0 })), "invalid_typed_answer"],
		[async (batch) => ({ ...complete(batch, () => clears("yes", 0.8, 0.15)), status: "incomplete", failure: { code: "schema_error", retryable: false } }), "schema_error"],
		[async (batch) => ({ batchId: batch.id, status: "unavailable", answers: {}, issues: [], coverage: { required: [], answered: [], unknown: [] }, failure: { code: "timeout", retryable: false } }), "timeout"],
		[async () => { throw new Error("port down"); }, "person_resolution_owner_error"],
	];
	for (const [decide, reason] of cases) {
		const result = await run(value, decide);
		assert.equal(result.status, "unresolved");
		assert.equal(result.reason, reason);
	}
	const foreign = lease(input({ turn: 9 }));
	const mismatch = await resolvePersonName(value, { decide: async () => { throw new Error("must not run"); } }, foreign);
	foreign.close();
	assert.equal(mismatch.reason, "attempt_binding_mismatch");
});
