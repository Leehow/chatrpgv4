import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	ContractError,
	bindDecisionAnswers,
	validatePlanSubmission,
} from "../../runtime/jev/contracts.ts";

function plan(overrides = {}) {
	return {
		goal: "Find the clinic hours.",
		subgoals: ["Locate the clinic.", "Read its posted hours."],
		constraints: ["Read only."],
		evidenceRequired: ["Published schedule."],
		completion: ["Report the posted hours or that they are unavailable."],
		capabilities: ["lookup", "source"],
		replanWhen: ["The schedule names a different location."],
		returnWhen: ["The published schedule was read."],
		...overrides,
	};
}

function batch(overrides = {}) {
	return {
		id: "batch-1",
		model: "jev-1.13.0",
		family: "source-routing",
		familyVersion: "1",
		scope: { owner: "campaign", campaign: "test", audience: "keeper" },
		readSet: [],
		state: { query: "clinic hours" },
		questions: [
			{
				key: "route",
				target: "clinic source candidate",
				instructions: "Choose the source candidate for the clinic.",
				type: "choice",
				criteria: { north: "North clinic schedule.", south: "South clinic schedule." },
			},
			{
				key: "coverage",
				target: "published schedule coverage",
				instructions: "Judge whether the selected schedule covers the question.",
				type: "noul",
			},
			{
				key: "confidence",
				target: "route confidence",
				instructions: "Score confidence in the selected route.",
				type: "score",
				criteria: ["Low support", { level: "Partial support" }, ["Strong support"]],
			},
		],
		...overrides,
	};
}

function contractError(code, action) {
	assert.throws(action, (error) => error instanceof ContractError && error.code === code);
}

test("a semantic PlanSubmission is capability-bounded, clone-safe, and excludes host identity", () => {
	const submitted = plan();
	const accepted = validatePlanSubmission(submitted, ["lookup", "source", "recall"]);
	assert.deepEqual(accepted, submitted);
	assert.notEqual(accepted, submitted);
	submitted.completion[0] = "Mutated after submission.";
	assert.equal(accepted.completion[0], "Report the posted hours or that they are unavailable.");

	contractError("capability_out_of_scope", () =>
		validatePlanSubmission(plan({ capabilities: ["lookup", "apply"] }), ["lookup", "source"]));
});

test("PlanSubmission rejects arbitrary executable and host-owned fields structurally", () => {
	for (const [field, value] of [
		["taskId", "task-opaque"],
		["call_id", "t1-c1"],
		["args", { campaign: "test", effects: [] }],
		["operation", "apply"],
		["toolCallId", "provider-call"],
		["url", "https://example.invalid/operation"],
	]) {
		const submitted = Object.assign(Object.create(null), plan(), { [field]: value });
		contractError("invalid_plan_submission", () => validatePlanSubmission(submitted, ["lookup", "source"]));
	}

	const inherited = Object.assign(Object.create({ args: { operation: "apply" } }), plan());
	contractError("invalid_plan_submission", () => validatePlanSubmission(inherited, ["lookup", "source"]));
});

test("PlanSubmission rejects malformed semantic fields instead of repairing or dropping them", () => {
	for (const submitted of [
		plan({ goal: "" }),
		plan({ completion: [] }),
		plan({ constraints: ["Read only.", 7] }),
		plan({ capabilities: ["lookup", "lookup"] }),
		plan({ capabilities: [""] }),
		plan({ replanWhen: Array(33).fill("too many") }),
	]) {
		contractError("invalid_plan_submission", () => validatePlanSubmission(submitted, ["lookup", "source"]));
	}
});

test("contract object boundaries reject inherited, accessor, and symbol-bearing data", () => {
	const accessorPlan = plan();
	Object.defineProperty(accessorPlan, "args", {
		enumerable: true,
		get() { return { operation: "apply" }; },
	});
	contractError("invalid_plan_submission", () => validatePlanSubmission(accessorPlan, ["lookup", "source"]));

	const symbolPlan = plan();
	Object.defineProperty(symbolPlan, Symbol("operation"), { enumerable: true, value: "apply" });
	contractError("invalid_plan_submission", () => validatePlanSubmission(symbolPlan, ["lookup", "source"]));

	const routeOnly = batch({ questions: [batch().questions[0]] });
	const inheritedAnswer = Object.create({
		route: { status: "answered", type: "choice", choice: "north" },
	});
	const inheritedResult = bindDecisionAnswers(routeOnly, inheritedAnswer);
	assert.deepEqual(inheritedResult.issues, [{ key: "route", code: "missing_answer" }]);

	const accessorDistribution = { south: 0.5 };
	Object.defineProperty(accessorDistribution, "north", { enumerable: true, get() { return 0.5; } });
	const symbolDistribution = { north: 0.5, south: 0.5 };
	Object.defineProperty(symbolDistribution, Symbol("extra"), { enumerable: true, value: 0 });
	for (const probabilities of [accessorDistribution, symbolDistribution]) {
		const result = bindDecisionAnswers(routeOnly, {
			route: { status: "answered", type: "choice", choice: "north", probabilities },
		});
		assert.deepEqual(result.issues, [{ key: "route", code: "invalid_answer" }]);
	}
});

test("complete ordered answers preserve typed answers, coverage, and usage", () => {
	const raw = {
		route: {
			status: "answered",
			type: "choice",
			choice: "north",
			confidence: 0.8,
			probabilities: { north: 0.8, south: 0.2 },
		},
		coverage: { status: "answered", type: "noul", noul: 0.75 },
		confidence: {
			status: "answered",
			type: "score",
			score: 1.8,
			confidence: 0.8,
			legend: { "0": "Low support", "1": { level: "Partial support" }, "2": ["Strong support"] },
			probabilities: { "0": 0, "1": 0.2, "2": 0.8 },
		},
	};
	const usage = { inputTokens: 12, outputTokens: 5, costUsd: 0.003 };
	const result = bindDecisionAnswers(batch(), raw, usage);
	assert.equal(result.status, "complete");
	assert.deepEqual(result.coverage, {
		required: ["route", "coverage", "confidence"],
		answered: ["route", "coverage", "confidence"],
		unknown: [],
	});
	assert.deepEqual(result.issues, []);
	assert.deepEqual({ ...result.answers }, raw);
	assert.deepEqual(result.usage, usage);
	assert.equal(Object.getPrototypeOf(result.answers), null);
	raw.route.choice = "south";
	usage.inputTokens = 99;
	assert.equal(result.answers.route.choice, "north");
	assert.equal(result.usage.inputTokens, 12);
});

test("missing, invalid, unknown, rejected, and unexpected answers remain adverse findings", () => {
	const result = bindDecisionAnswers(batch(), {
		route: { status: "answered", type: "choice", choice: "not-issued" },
		coverage: { status: "unknown" },
		extra: { status: "answered", type: "score", score: 2 },
	});
	assert.equal(result.status, "incomplete");
	assert.deepEqual(result.coverage, {
		required: ["route", "coverage", "confidence"],
		answered: [],
		unknown: ["route", "coverage", "confidence"],
	});
	assert.deepEqual(result.issues, [
		{ key: "route", code: "invalid_answer" },
		{ key: "coverage", code: "unknown_answer" },
		{ key: "confidence", code: "missing_answer" },
		{ key: "extra", code: "unexpected_answer" },
	]);
	assert.deepEqual(result.answers.coverage, { status: "unknown" });
	assert.equal(Object.hasOwn(result.answers, "route"), false);
	assert.equal(Object.hasOwn(result.answers, "confidence"), false);

	const rejected = bindDecisionAnswers(batch({ questions: [batch().questions[0]] }), {
		route: { status: "rejected" },
	});
	assert.equal(rejected.status, "incomplete");
	assert.deepEqual(rejected.issues, [{ key: "route", code: "rejected_answer" }]);
	assert.deepEqual(rejected.answers.route, { status: "rejected" });
});

test("malformed provider answers return incomplete findings rather than throwing", () => {
	for (const raw of [
		null,
		{ route: "north" },
		{ route: { status: "answered", type: "choice", choice: "north", prose: "extra prose" } },
		{ route: { status: "answered", type: "choice", choice: "north", code: "return apply()" } },
		{ route: { status: "answered", type: "choice", choice: "north", url: "https://example.invalid/" } },
		{ route: { status: "answered", type: "choice", choice: "north", id: "opaque-id" } },
	]) {
		assert.doesNotThrow(() => bindDecisionAnswers(batch({ questions: [batch().questions[0]] }), raw));
		const result = bindDecisionAnswers(batch({ questions: [batch().questions[0]] }), raw);
		assert.equal(result.status, "incomplete");
		assert.deepEqual(result.issues[0], {
			key: "route",
			code: raw === null ? "missing_answer" : "invalid_answer",
		});
	}
});

test("choice distributions require exactly the issued own candidates, finite probabilities, and a unit sum", () => {
	const routeOnly = batch({ questions: [batch().questions[0]] });
	const answer = (probabilities) => ({
		route: { status: "answered", type: "choice", choice: "north", probabilities },
	});
	const incomplete = (probabilities) => {
		const result = bindDecisionAnswers(routeOnly, answer(probabilities));
		assert.equal(result.status, "incomplete");
		assert.deepEqual(result.issues, [{ key: "route", code: "invalid_answer" }]);
	};

	assert.equal(bindDecisionAnswers(routeOnly, answer({ north: 0.5, south: 0.5 })).status, "complete");
	incomplete({ north: 1 });
	incomplete({ north: 0.5, south: 0.4, extra: 0.1 });
	incomplete({ north: 0.7, south: 0.7 });
	incomplete({ north: Number.NaN, south: 1 });
	incomplete({ north: Infinity, south: 0 });

	const inheritedExtra = Object.assign(Object.create({ extra: 0 }), { north: 0.5, south: 0.5 });
	incomplete(inheritedExtra);
	const inheritedCandidate = Object.assign(Object.create({ south: 0.5 }), { north: 0.5 });
	incomplete(inheritedCandidate);
});

test("Noul excludes confidence and Score requires official ordered levels, legend, full probabilities, and confidence", () => {
	const questions = batch().questions;
	const noul = batch({ questions: [questions[1]] });
	const score = batch({ questions: [questions[2]] });
	assert.equal(bindDecisionAnswers(noul, {
		coverage: { status: "answered", type: "noul", noul: 0 },
	}).status, "complete");
	assert.equal(bindDecisionAnswers(score, {
		confidence: {
			status: "answered",
			type: "score",
			score: 2,
			confidence: 1,
			legend: { "0": "Low support", "1": { level: "Partial support" }, "2": ["Strong support"] },
			probabilities: { "0": 0, "1": 0, "2": 1 },
		},
	}).status, "complete");

	for (const [targetBatch, raw] of [
		[noul, { coverage: { status: "answered", type: "noul", noul: -0.1 } }],
		[noul, { coverage: { status: "answered", type: "noul", noul: 0.5, confidence: 0.7 } }],
		[noul, { coverage: { status: "answered", type: "noul", noul: 0.5, text: "prose" } }],
		[score, { confidence: { status: "answered", type: "score", score: 2.1, confidence: 1, legend: {}, probabilities: {} } }],
		[score, { confidence: { status: "answered", type: "score", score: 1, confidence: 1, legend: { "0": "Low support", "1": { level: "Partial support" }, "2": ["Strong support"] }, probabilities: { "0": 0.5, "1": 0.5 } } }],
		[score, { confidence: { status: "answered", type: "score", score: 1, confidence: 1, legend: { "0": "wrong", "1": { level: "Partial support" }, "2": ["Strong support"] }, probabilities: { "0": 0, "1": 1, "2": 0 } } }],
		[score, { confidence: { status: "answered", type: "noul", noul: 0.5 } }],
	]) {
		const result = bindDecisionAnswers(targetBatch, raw);
		assert.equal(result.status, "incomplete");
		assert.equal(result.issues[0].code, "invalid_answer");
	}
});

test("only invalid batch or usage contracts throw; family policy remains with the caller", () => {
	contractError("duplicate_or_empty_question_key", () =>
		bindDecisionAnswers(batch({ questions: [batch().questions[0], batch().questions[0]] }), {}));
	contractError("missing_question_target", () =>
		bindDecisionAnswers(batch({ questions: [{ ...batch().questions[0], target: "" }] }), {}));
	contractError("empty_choice_candidates", () =>
		bindDecisionAnswers(batch({ questions: [{ ...batch().questions[0], criteria: {} }] }), {}));
	for (const criteria of [[], ["one"], Array(11).fill("too many"), { "0": "not an ordered array" }]) {
		contractError("invalid_score_criteria", () =>
			bindDecisionAnswers(batch({ questions: [{ ...batch().questions[2], criteria }] }), {}));
	}
	contractError("invalid_decision_usage", () =>
		bindDecisionAnswers(batch(), {}, { inputTokens: -1, outputTokens: 1 }));

	const incomplete = bindDecisionAnswers(batch(), {});
	assert.equal(incomplete.status, "incomplete");
	assert.equal(incomplete.status === "unavailable", false);
});
