import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createTableEvidenceDomain, tableEvidenceCapsule } from "../../runtime/jev/table-evidence-domain.ts";

const scope = { owner: "session:test", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const readSet = [{ kind: "world", resource: "campaign", revision: "world-r1" }];

function plan(capabilities = ["look", "recall"], overrides = {}) {
	return {
		goal: "Answer from bounded table evidence.",
		subgoals: [],
		constraints: ["Read only."],
		evidenceRequired: ["Requirement A"],
		completion: ["Requirement B"],
		capabilities,
		replanWhen: [],
		returnWhen: [],
		...overrides,
	};
}

function view(overrides = {}) {
	return {
		intent: {
			id: "intent",
			rawInput: {
				version: 1,
				scope,
				resource: "turn:1:player",
				revision: "input-r1",
				sourceType: "turn",
				selector: { kind: "utf16", start: 0, end: 4 },
			},
			limits: ["read_only"],
			scope,
			turn: 1,
			inputRevision: "input-r1",
		},
		plan: plan(),
		context: {
			id: "task",
			rootId: "task",
			owner: "keeper",
			kind: "foreground",
			goal: "Answer from bounded table evidence.",
			scope,
			capabilities: ["look", "recall"],
			readSet,
			budget: {
				deadlineAt: 10_000,
				remainingInputTokens: 100,
				remainingOutputTokens: 100,
				remainingCostUsd: 1,
				remainingActions: 10,
			},
			checkpointRefs: [],
			step: 0,
			rootStep: 0,
		},
		observations: [],
		decisions: [],
		remainingNeeds: [],
		replans: 0,
		...overrides,
	};
}

function choiceResult(decision, choice, supports = [], nextWeights = {}) {
	const nextCriteria = Object.keys(decision.batch.questions[0].criteria);
	const nextProbabilities = Object.fromEntries(nextCriteria.map(key => [key, nextWeights[key] ?? 0]));
	if (!Object.values(nextProbabilities).some(value => value > 0)) nextProbabilities[choice] = 1;
	return {
		batchId: decision.key,
		status: "complete",
		answers: {
			next: { status: "answered", type: "choice", choice, probabilities: nextProbabilities },
			...Object.fromEntries(supports.map((support, index) => [`support_${index}`, {
				status: "answered",
				type: "choice",
				choice: support,
				probabilities: Object.fromEntries(["sufficient", "needs_more", "unavailable"].map(key => [key, key === support ? 1 : 0])),
			}])),
		},
		coverage: { required: ["next", ...supports.map((_, index) => `support_${index}`)], answered: ["next", ...supports.map((_, index) => `support_${index}`)], unknown: [] },
		issues: [],
	};
}

function recallObservation(result) {
	return {
		key: "prior-recall",
		proposal: {
			id: "operation-recall",
			taskId: "task",
			operation: "recall",
			args: { what: "transcript" },
			capability: "recall",
			scope,
			readSet,
			basis: [],
		},
		packet: {
			operationId: "operation-recall",
			status: "succeeded",
			result,
			refs: [],
			receipts: [],
			readSet,
			coverage: { used: [], omitted: [], unknown: [] },
		},
	};
}

test("table evidence capsule excludes private and large guidance while reporting every omission and partial sheet coverage", () => {
	const privateSecret = "UNSPOKEN-CELLAR-ENTITY";
	const largeStyle = "STYLE-GUIDANCE-".repeat(5_000);
	const raw = {
		turn: { number: 7, state: "open", player_text: "What did I promise?" },
		where: {
			scene: "clinic",
			display_name: "Clinic",
			clock: { at: "10:00" },
			session: null,
			dramatic_question: "Who hid the ledger?",
			keeper_notes: [privateSecret],
			pressure_moves: ["Escalate the unseen threat."],
			exits: [{ to: "cellar" }],
		},
		known: {
			investigator: { name: "Ada", hp: 9, skills_of_note: [{ name: "Library Use", value: 60 }] },
			discovered_clues: [{ name: "Receipt" }],
			clues_here: [{ name: privateSecret, discovered: false }],
		},
		present: [{
			name: "Clerk",
			called: "Mr. Ward",
			role: "witness",
			relationship: "guarded",
			agenda: "Keep the ledger hidden",
			known_facts: ["The public closing time"],
			secret: privateSecret,
			fear: "The cellar",
		}],
		pressures: [{ name: privateSecret }],
		obligations: [{ name: "Recover the ledger" }],
		director: { reason: privateSecret },
		situations: [{ decision: "secret-check" }],
		memory: [{ summary: privateSecret }],
		style: { directives: [largeStyle] },
	};

	const projected = tableEvidenceCapsule(raw);
	const text = JSON.stringify(projected);
	assert.deepEqual(Object.keys(projected), ["turn", "where", "investigator", "discoveredClues", "present", "coverage"]);
	assert.deepEqual(projected.where, { scene: "clinic", display_name: "Clinic", clock: { at: "10:00" }, session: null });
	assert.deepEqual(projected.present, [{ name: "Clerk", called: "Mr. Ward", role: "witness" }]);
	assert.equal(text.includes(privateSecret), false);
	assert.equal(text.includes("STYLE-GUIDANCE"), false);
	assert.ok(projected.coverage.investigator.includes("partial sheet projection"));
	assert.ok(projected.coverage.history.includes("not original spoken text"));
	assert.ok(projected.coverage.present.includes("private source secrets and unspoken terms are unavailable"));
	assert.deepEqual(projected.coverage.omitted, ["pressures", "obligations", "director", "situations", "memory", "style"]);
	assert.deepEqual(projected.coverage.omittedWhere, ["dramatic_question", "keeper_notes", "pressure_moves", "exits"]);
	assert.deepEqual(projected.coverage.omittedKnown, ["clues_here"]);
	assert.ok(text.length < 2_000, `bounded projection unexpectedly reached ${text.length} characters`);
});

test("issued recall continuation arguments survive candidate selection byte-for-byte in structure", async t => {
	const continuations = [
		{
			label: "card read",
			args: { what: "transcript", read: { turn: 7, role: "player", span: [4, 19] }, filters: { exact: true } },
			locate: candidate => typeof candidate === "object" && candidate?.purpose?.includes("actual original-text card"),
		},
		{
			label: "card detail",
			args: { what: "history", detail: { receipt: "turn:7", fields: ["effects", "why"] } },
			locate: candidate => typeof candidate === "object" && candidate?.purpose?.includes("oversized structured card"),
		},
		{
			label: "next page",
			args: { what: "transcript", cursor: "opaque:7/+==", role: "player", filters: { from: 2, to: 7 } },
			locate: candidate => typeof candidate === "string" && candidate.includes("actual continuation"),
		},
		{
			label: "memory detail",
			args: { what: "memory", detail: { record: "memory:42", revision: "r9" }, include: ["basis", "links"] },
			locate: candidate => typeof candidate === "string" && candidate.includes("oversized memory result"),
		},
	];

	for (const continuation of continuations) await t.test(continuation.label, () => {
		const result = {
			cards: [
				{ head: "Exact promise", role: "player", read: continuations[0].args },
				{ head: "Large receipt", detail: continuations[1].args },
			],
			next: continuations[2].args,
			hits: [{ detail: continuations[3].args }],
		};
		const observation = recallObservation(result);
		const domain = createTableEvidenceDomain({ rawInput: () => "What exactly did I promise?", capsule: () => ({}) });
		const baseView = view({ plan: plan(["recall"]), observations: [observation] });
		const decision = domain.next(baseView);
		assert.equal(decision.kind, "decision");
		const index = decision.batch.state.candidates.findIndex(continuation.locate);
		assert.ok(index >= 0, `${continuation.label} was not offered`);
		const selected = domain.next({
			...baseView,
			decisions: [{ key: decision.key, result: choiceResult(decision, `candidate_${index}`, ["needs_more", "needs_more"]) }],
		});
		assert.equal(selected.kind, "operation");
		assert.equal(selected.operation, "recall");
		assert.deepEqual(selected.args, continuation.args);
	});
});

test("v2 completion requires every independent requirement to be explicitly sufficient", () => {
	const domain = createTableEvidenceDomain({ rawInput: () => "Can I answer now?", capsule: () => ({ known: {} }) });
	const baseView = view({ plan: plan(["look"], { evidenceRequired: ["Requirement A"], completion: ["Requirement B"] }) });
	const decision = domain.next(baseView);
	assert.equal(decision.kind, "decision");
	assert.equal(decision.batch.familyVersion, "2");
	assert.deepEqual(decision.batch.questions.map(question => [question.key, question.type]), [
		["next", "choice"],
		["support_0", "choice"],
		["support_1", "choice"],
	]);
	assert.deepEqual(Object.keys(decision.batch.questions[1].criteria), ["sufficient", "needs_more", "unavailable"]);
	assert.deepEqual(Object.keys(decision.batch.questions[2].criteria), ["sufficient", "needs_more", "unavailable"]);
	assert.ok(decision.batch.questions[1].instructions.includes("Judge independently from the next-operation answer"));
	assert.ok(decision.batch.questions[2].instructions.includes("Judge independently from the next-operation answer"));

	const complete = domain.next({
		...baseView,
		decisions: [{ key: decision.key, result: choiceResult(decision, "complete", ["sufficient", "sufficient"]) }],
	});
	assert.deepEqual(complete, { kind: "finish", status: "complete", remainingNeeds: [] });

	const unavailable = domain.next({
		...baseView,
		decisions: [{ key: decision.key, result: choiceResult(decision, "complete", ["sufficient", "unavailable"]) }],
	});
	assert.deepEqual(unavailable, { kind: "finish", status: "partial", remainingNeeds: ["Requirement B"] });
});

test("global complete with needs_more follows the best positively weighted remaining issued read", () => {
	const domain = createTableEvidenceDomain({ rawInput: () => "Can I answer now?", capsule: () => ({ known: {} }) });
	const baseView = view({ plan: plan(["look"], { evidenceRequired: ["Requirement A"], completion: ["Requirement B"] }) });
	const decision = domain.next(baseView);
	assert.equal(decision.kind, "decision");
	const next = domain.next({
		...baseView,
		decisions: [{ key: decision.key, result: choiceResult(decision, "complete", ["sufficient", "needs_more"], {
			candidate_0: 0.1,
			candidate_1: 0.3,
			complete: 0.6,
		}) }],
	});
	assert.equal(next.kind, "operation");
	assert.match(next.key, /^read-/);
	assert.equal(next.operation, "look");
	assert.deepEqual(next.args, { focus: "session" });
	assert.equal(next.capability, "look");
	assert.deepEqual(next.basis, []);
});

test("the accepted plan narrows candidate capabilities even when the task lease is broader", () => {
	const domain = createTableEvidenceDomain({ rawInput: () => "Read only the transcript.", capsule: () => ({}) });
	const recallOnly = view({ plan: plan(["recall"]) });
	const decision = domain.next(recallOnly);
	assert.equal(decision.kind, "decision");
	assert.equal(decision.batch.state.candidates.length, 3);
	assert.deepEqual(decision.batch.state.candidates, [
		"List bounded original-text cards for the recent three turns; card heads are not full evidence.",
		"Read the bounded default memory view, preserving belief, correction, status and attribution.",
		"Read the bounded recent canonical timeline and receipt-derived changes.",
	]);
	assert.deepEqual(Object.keys(decision.batch.questions[0].criteria), ["candidate_0", "candidate_1", "candidate_2", "complete", "needs_player", "unresolved"]);

	const selected = domain.next({
		...recallOnly,
		decisions: [{ key: decision.key, result: choiceResult(decision, "candidate_0", ["needs_more", "needs_more"]) }],
	});
	assert.equal(selected.kind, "operation");
	assert.equal(selected.operation, "recall");
	assert.deepEqual(selected.args, { what: "transcript" });

	const afterCompleted = domain.next({
		...recallOnly,
		observations: [{
			...recallObservation({ cards: [] }),
			key: selected.key,
			proposal: { ...recallObservation({}).proposal, args: selected.args },
		}],
		decisions: [],
	});
	assert.equal(afterCompleted.kind, "decision");
	assert.equal(afterCompleted.batch.state.candidates.includes(decision.batch.state.candidates[0]), false,
		"the exact completed operation arguments are not issued again");
});
