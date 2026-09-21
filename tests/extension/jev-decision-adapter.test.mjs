import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDecisionAdapter, JEV_ENDPOINT, JEV_INPUT_USD_PER_MILLION } from "../../runtime/jev/decision-adapter.ts";
import { ESTIMATE_PROVENANCE, JEV_MODEL, packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";

const readSet = [{ kind: "world", resource: "campaign-a", revision: "w1" }];
const keeperScope = { owner: "campaign-owner", campaign: "campaign-a", worldline: "main", loop: 0, audience: "keeper" };

function lease(overrides = {}) {
	return new TaskLease({
		owner: "decision-test",
		goal: "answer the bounded typed questions",
		scope: keeperScope,
		capabilities: ["decision"],
		readSet,
		budget: {
			deadlineAt: Date.now() + 10_000,
			remainingInputTokens: 1_000_000,
			remainingOutputTokens: 1_000_000,
			remainingCostUsd: 10,
			remainingActions: 10,
		},
		...overrides,
	});
}

function generousBudget(deadlineAt = Date.now() + 10_000) {
	return {
		deadlineAt,
		remainingInputTokens: 1_000_000,
		remainingOutputTokens: 1_000_000,
		remainingCostUsd: 10,
		remainingActions: 10,
	};
}

function batch(overrides = {}) {
	return {
		id: "batch-1",
		model: JEV_MODEL,
		family: "routing",
		familyVersion: "1",
		scope: keeperScope,
		readSet,
		state: { player: "我没有答应委托。", candidates: ["报社", "图书馆"] },
		questions: [
			{ key: "route", target: "candidate route", instructions: "Choose the supported route.", type: "choice",
				criteria: { archive: { label: "报社档案" }, library: ["图书馆", { access: "public" }] } },
			{ key: "supported", target: "claim support", instructions: "Is the claim supported?", type: "noul",
				criteria: { true: "Supported by the record", false: { reason: "Missing or contradicted" } } },
			{ key: "urgency", target: "current urgency", instructions: "Score urgency.", type: "score",
				criteria: ["None", { label: "Some" }, ["Immediate", { danger: true }]] },
		],
		...overrides,
	};
}

function answer(overrides = {}) {
	return {
		model: JEV_MODEL,
		answers: {
			route: { type: "choice", choice: "archive", confidence: 0.75, probabilities: { archive: 0.75, library: 0.25 } },
			supported: { type: "noul", noul: 0 },
			urgency: { type: "score", score: 0, confidence: 0.8,
				legend: { "0": "None", "1": { label: "Some" }, "2": ["Immediate", { danger: true }] },
				probabilities: { "0": 0.8, "1": 0.15, "2": 0.05 } },
		},
		usage: { input_tokens: 120, output_tokens: 30 },
		...overrides,
	};
}

function response(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function nonOkResponse(status, headers = {}, onCancel = () => {}) {
	return {
		status,
		ok: false,
		headers: new Headers(headers),
		body: { async cancel() { onCancel(); } },
	};
}

async function waitUntil(probe, label) {
	const deadline = Date.now() + 2_000;
	while (!probe()) {
		if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

test("adapter sends one strict CJK-safe typed request and charges listed-price usage once", async () => {
	const calls = [], traces = [];
	const owner = lease();
	const before = owner.context.budget;
	const adapter = createDecisionAdapter({
		apiKey: "memory-only-secret",
		fetcher: async (url, init) => { calls.push({ url, init }); return response(answer()); },
		trace: event => traces.push(event),
	});
	const result = await adapter.decide(batch(), owner);

	assert.equal(result.status, "complete");
	assert.equal(result.answers.supported.noul, 0, "a negative Noul remains an answered value");
	assert.equal(result.answers.urgency.score, 0, "a zero Score remains an answered value");
	assert.equal(result.attempts, 1);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, JEV_ENDPOINT);
	assert.equal(calls[0].init.redirect, "error");
	assert.equal(calls[0].init.headers.Authorization, "Bearer memory-only-secret");
	const sent = JSON.parse(calls[0].init.body);
	assert.deepEqual(Object.keys(sent), ["model", "state", "questions"]);
	assert.deepEqual(sent.questions.route.instructions, { target: "candidate route", instruction: "Choose the supported route." });
	assert.deepEqual(sent.questions.urgency.criteria, batch().questions[2].criteria);
	assert.equal(calls[0].init.body.includes("memory-only-secret"), false);
	assert.equal(traces[0].kind, "packing");
	assert.equal(traces[0].estimate.provenance, ESTIMATE_PROVENANCE);
	assert.equal(traces[0].cache, "disabled");
	const cost = 120 * JEV_INPUT_USD_PER_MILLION / 1_000_000;
	assert.equal(result.usage.costUsd, cost);
	assert.equal(owner.context.budget.remainingInputTokens, before.remainingInputTokens - 120);
	assert.equal(owner.context.budget.remainingOutputTokens, before.remainingOutputTokens - 30);
	assert.equal(owner.context.budget.remainingActions, before.remainingActions - 1);
	assert.equal(owner.context.budget.remainingCostUsd, before.remainingCostUsd - cost);
	assert.equal(traces.at(-1).cost.kind, "listed_price_estimate");
});

test("packing refuses unsafe grouping and oversize payloads without truncation or fetch", async () => {
	let calls = 0;
	const adapter = createDecisionAdapter({ apiKey: "secret", fetcher: async () => { calls++; return response(answer()); } });
	const tooMany = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`option_${index}`, `候选 ${index}`]));
	const grouped = batch({ questions: [{ key: "route", target: "all candidates", instructions: "Choose one.", type: "choice", criteria: tooMany }] });
	const groupedResult = await adapter.decide(grouped, lease());
	assert.equal(groupedResult.failure.code, "packing_limit");
	assert.equal(groupedResult.coverage.unknown.length, 1);

	const largeState = "界".repeat(20_000);
	const large = batch({ state: { exact: largeState } });
	const packed = await adapter.decide(large, lease());
	assert.equal(packed.failure.code, "packing_limit");
	assert.equal(large.state.exact, largeState, "packing never truncates state");
	assert.equal(calls, 0);
	assert.throws(() => packDecisionBatch(batch({ questions: [{ key: "score", target: "x", instructions: "x", type: "score", criteria: ["only"] }] })));
	assert.throws(() => packDecisionBatch(batch({ questions: [
		{ key: "same", target: "first", instructions: "x", type: "noul" },
		{ key: "same", target: "second", instructions: "x", type: "noul" },
	] })));
});

test("missing, extra, and malformed primitive answers remain explicit incomplete coverage", async () => {
	const cases = [
		{ ...answer(), answers: { ...answer().answers, supported: undefined } },
		{ ...answer(), answers: { ...answer().answers, extra: { type: "noul", noul: 1 } } },
		{ ...answer(), answers: { ...answer().answers, supported: { type: "noul", noul: 0, confidence: 1 } } },
		{ ...answer(), answers: { ...answer().answers, urgency: { ...answer().answers.urgency, legend: { "0": "wrong" } } } },
	];
	for (const body of cases) {
		const adapter = createDecisionAdapter({ apiKey: "secret", fetcher: async () => response(body) });
		const result = await adapter.decide(batch(), lease());
		assert.equal(result.status, "incomplete");
		assert.equal(result.failure.code, "schema_error");
		assert.ok(result.coverage.unknown.length > 0 || result.issues.some(issue => issue.code === "unexpected_answer"));
	}
	const unknownEnvelope = await createDecisionAdapter({ apiKey: "secret", fetcher: async () => response({ ...answer(), extra: true }) })
		.decide(batch(), lease());
	assert.equal(unknownEnvelope.status, "unavailable");
	assert.equal(unknownEnvelope.failure.code, "schema_error");
});

test("incomplete answers emit sanitized structural schema diagnostics", async () => {
	const traces = [];
	const choiceBatch = batch({
		id: "schema-diagnostic",
		state: { privateContext: "must-not-enter-telemetry" },
		questions: [{
			key: "route",
			target: "private target text",
			instructions: "private instruction text",
			type: "choice",
			criteria: { archive: "issued archive", library: "issued library" },
		}],
	});
	const adapter = createDecisionAdapter({
		apiKey: "must-not-enter-telemetry",
		trace: event => traces.push(event),
		fetcher: async () => response({
			model: JEV_MODEL,
			answers: {
				route: { type: "choice", choice: "unissued-private-value", confidence: 0.61,
					probabilities: { archive: 1.2, "unissued-private-value": -0.2 } },
			},
			usage: { input_tokens: 20, output_tokens: 5 },
		}),
	});
	const result = await adapter.decide(choiceBatch, lease());
	assert.equal(result.status, "incomplete");
	const schema = traces.find(event => event.kind === "answer_schema");
	assert.deepEqual(schema, {
		kind: "answer_schema",
		batchId: "schema-diagnostic",
		status: "incomplete",
		diagnostics: [{
			key: "route",
			type: "choice",
			fieldNames: ["choice", "confidence", "probabilities", "type"],
			expectedProbabilityCount: 2,
			actualProbabilityCount: 2,
			missingProbabilityKeyCount: 1,
			extraProbabilityKeyCount: 1,
			probabilitySum: 1,
			probabilitySumValid: false,
			probabilityRangeValid: false,
			selectedChoiceIsIssued: false,
			confidence: 0.61,
		}],
	});
	const serialized = JSON.stringify(schema);
	for (const privateValue of ["must-not-enter-telemetry", "private target text", "private instruction text",
		"unissued-private-value", "issued archive", "issued library"]) assert.equal(serialized.includes(privateValue), false);
});

test("cent-grid probability rounding accepts possible mass without normalizing raw values", async () => {
	const criteria = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`option_${index}`, `Option ${index}`]));
	const rounded = Object.fromEntries(Object.keys(criteria).map(key => [key, 0.11]));
	const roundedBatch = batch({
		id: "rounded-nine",
		questions: [{ key: "route", target: "issued route", instructions: "Choose one issued route.", type: "choice", criteria }],
	});
	const roundedResult = await createDecisionAdapter({ apiKey: "secret", fetcher: async () => response({
		model: JEV_MODEL,
		answers: { route: { type: "choice", choice: "option_4", confidence: 0.53, probabilities: rounded } },
		usage: { input_tokens: 20, output_tokens: 5 },
	}) }).decide(roundedBatch, lease());
	assert.equal(Object.values(rounded).reduce((sum, value) => sum + value, 0), 0.99);
	assert.equal(roundedResult.status, "complete");
	assert.deepEqual(roundedResult.answers.route.probabilities, rounded, "wire probabilities stay raw and are never normalized");
	assert.equal(roundedResult.answers.route.confidence, 0.53, "confidence is retained telemetry, not an acceptance threshold");

	const impossible = Object.fromEntries(Object.keys(criteria).map(key => [key, 0.09]));
	const traces = [];
	const impossibleResult = await createDecisionAdapter({
		apiKey: "secret",
		trace: event => traces.push(event),
		fetcher: async () => response({
			model: JEV_MODEL,
			answers: { route: { type: "choice", choice: "option_4", confidence: 0.99, probabilities: impossible } },
			usage: { input_tokens: 20, output_tokens: 5 },
		}),
	}).decide(batch({ ...roundedBatch, id: "impossible-nine" }), lease());
	assert.equal(impossibleResult.status, "incomplete");
	assert.equal(impossibleResult.failure.code, "schema_error");
	const schema = traces.find(event => event.kind === "answer_schema");
	assert.equal(schema.diagnostics[0].expectedProbabilityCount, 9);
	assert.equal(schema.diagnostics[0].actualProbabilityCount, 9);
	assert.ok(Math.abs(schema.diagnostics[0].probabilitySum - 0.81) < Number.EPSILON * 4);
	assert.equal(schema.diagnostics[0].probabilitySumValid, false);
	assert.equal(schema.diagnostics[0].probabilityRangeValid, true);
	assert.equal(schema.diagnostics[0].selectedChoiceIsIssued, true);
	assert.equal(schema.diagnostics[0].confidence, 0.99);
});

test("disabled and unconfigured adapters return typed unavailable without fake answers or budget spend", async () => {
	for (const options of [{ enabled: false, apiKey: "secret" }, {}]) {
		let calls = 0;
		const owner = lease();
		const before = owner.context.budget;
		const result = await createDecisionAdapter({ ...options, fetcher: async () => { calls++; return response(answer()); } }).decide(batch(), owner);
		assert.equal(result.status, "unavailable");
		assert.equal(result.failure.code, options.enabled === false ? "disabled" : "unconfigured");
		assert.deepEqual(result.answers, {});
		assert.deepEqual(owner.context.budget, before);
		assert.equal(calls, 0);
	}
});

test("explicit family retry honors retry headers without renewing the absolute deadline", async () => {
	const delays = [], traces = [];
	let calls = 0, cancelledBodies = 0;
	const owner = lease();
	const adapter = createDecisionAdapter({
		apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 2, backoffInitialMs: 2, backoffMaxMs: 20 } },
		fetcher: async () => ++calls === 1 ? nonOkResponse(429, { "retry-after-ms": "7" }, () => cancelledBodies++)
			: calls === 2 ? nonOkResponse(529, { "Retry-After": "0" }, () => cancelledBodies++) : response(answer()),
		sleep: async ms => { delays.push(ms); },
		trace: event => traces.push(event),
	});
	const result = await adapter.decide(batch(), owner);
	assert.equal(result.status, "complete");
	assert.equal(result.attempts, 3);
	assert.deepEqual(delays, [7, 0]);
	assert.equal(calls, 3);
	assert.equal(cancelledBodies, 2, "retry responses release their unread transport bodies");
	assert.ok(traces.find(event => event.kind === "usage").cost.unknownRetryBoundUsd > 0);
	assert.equal(owner.context.budget.remainingActions, 9, "one logical decision call charges one action across retries");

	let slept = false;
	const short = lease({ budget: generousBudget(Date.now() + 20) });
	const bounded = createDecisionAdapter({ apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 1, backoffInitialMs: 100, backoffMaxMs: 100 } },
		fetcher: async () => response({}, 429), sleep: async () => { slept = true; } });
	const stopped = await bounded.decide(batch(), short);
	assert.equal(stopped.failure.code, "rate_limited");
	assert.equal(stopped.attempts, 1);
	assert.equal(slept, false, "retry delay cannot extend the parent deadline");

	for (const status of [401, 422]) {
		let rejectedCalls = 0, rejectedCancels = 0;
		const rejected = createDecisionAdapter({ apiKey: "secret",
			retryPolicies: { routing: { maxRetries: 2, backoffInitialMs: 0, backoffMaxMs: 0, retryNetwork: true, retryTimeout: true } },
			fetcher: async () => { rejectedCalls++; return nonOkResponse(status, {}, () => rejectedCancels++); }, sleep: async () => undefined });
		const rejectedResult = await rejected.decide(batch(), lease());
		assert.equal(rejectedResult.failure.code, status === 422 ? "schema_error" : "service_error");
		assert.equal(rejectedCalls, 1, `HTTP ${status} is never retried`);
		assert.equal(rejectedCancels, 1, `HTTP ${status} releases its unread transport body`);
	}
});

test("telemetry is advisory and post-fetch exceptions retain conservative attempt spend", async () => {
	let traceCalls = 0;
	const tracedOwner = lease();
	const tracedBefore = tracedOwner.context.budget;
	const traced = createDecisionAdapter({
		apiKey: "secret",
		fetcher: async () => response(answer()),
		trace: () => { traceCalls++; throw new Error("telemetry sink unavailable"); },
	});
	const tracedResult = await traced.decide(batch(), tracedOwner);
	assert.equal(tracedResult.status, "complete");
	assert.ok(traceCalls >= 3);
	assert.equal(tracedOwner.context.budget.remainingInputTokens, tracedBefore.remainingInputTokens - 120);
	assert.equal(tracedOwner.context.budget.remainingOutputTokens, tracedBefore.remainingOutputTokens - 30);
	assert.equal(tracedOwner.context.budget.remainingActions, tracedBefore.remainingActions - 1);

	const uncertainOwner = lease();
	const uncertainBefore = uncertainOwner.context.budget;
	const uncertain = createDecisionAdapter({ apiKey: "secret", fetcher: async () => ({
		get status() { throw new Error("response metadata unavailable after request"); },
	}) });
	const uncertainResult = await uncertain.decide(batch(), uncertainOwner);
	assert.equal(uncertainResult.status, "unavailable");
	assert.equal(uncertainResult.failure.code, "service_error");
	assert.equal(uncertainResult.attempts, 1);
	assert.ok(uncertainOwner.context.budget.remainingInputTokens < uncertainBefore.remainingInputTokens);
	assert.ok(uncertainOwner.context.budget.remainingOutputTokens < uncertainBefore.remainingOutputTokens);
	assert.ok(uncertainOwner.context.budget.remainingCostUsd < uncertainBefore.remainingCostUsd);
	assert.equal(uncertainOwner.context.budget.remainingActions, uncertainBefore.remainingActions - 1);
});

test("default retry sleep rejects a signal already cancelled by retry telemetry", async () => {
	const owner = lease();
	let calls = 0;
	const adapter = createDecisionAdapter({
		apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 1, backoffInitialMs: 500, backoffMaxMs: 500 } },
		fetcher: async () => { calls++; return nonOkResponse(429); },
		trace: event => { if (event.kind === "retry") owner.cancel("cancelled_before_sleep"); },
	});
	const result = await Promise.race([
		adapter.decide(batch(), owner),
		new Promise((_resolve, reject) => setTimeout(() => reject(new Error("pre-aborted sleep did not reject promptly")), 100)),
	]);
	assert.equal(result.failure.code, "cancelled");
	assert.equal(calls, 1);
});

test("network and timeout retries require explicit family policy; cancellation and late answers never retry", async () => {
	let networkCalls = 0;
	const network = createDecisionAdapter({ apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 1, backoffInitialMs: 0, backoffMaxMs: 0, retryNetwork: true } },
		fetcher: async () => { if (++networkCalls === 1) throw new TypeError("offline"); return response(answer()); },
		sleep: async () => undefined });
	assert.equal((await network.decide(batch(), lease())).status, "complete");
	assert.equal(networkCalls, 2);

	let timeoutCalls = 0;
	const timeout = createDecisionAdapter({ apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 0, backoffInitialMs: 0, backoffMaxMs: 0, attemptTimeoutMs: 10 } },
		fetcher: async (_url, init) => new Promise((_resolve, reject) => {
			init.signal.addEventListener("abort", () => { timeoutCalls++; reject(init.signal.reason); }, { once: true });
		}) });
	assert.equal((await timeout.decide(batch(), lease())).failure.code, "timeout");
	assert.equal(timeoutCalls, 1);

	const cancelledOwner = lease();
	let cancelCalls = 0;
	const cancelled = createDecisionAdapter({ apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 2, backoffInitialMs: 0, backoffMaxMs: 0, retryNetwork: true, retryTimeout: true } },
		fetcher: async (_url, init) => new Promise((_resolve, reject) => {
			cancelCalls++; queueMicrotask(() => cancelledOwner.cancel("user_cancelled"));
			init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
		}) });
	assert.equal((await cancelled.decide(batch(), cancelledOwner)).failure.code, "cancelled");
	assert.equal(cancelCalls, 1);

	const lateOwner = lease({ budget: generousBudget(Date.now() + 15) });
	const late = createDecisionAdapter({ apiKey: "secret", fetcher: async () => ({
		ok: true, status: 200, headers: new Headers(), json: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return answer(); },
	}) });
	assert.equal((await late.decide(batch(), lateOwner)).failure.code, "timeout");
});

test("bounded concurrency cancels queued callers and the no-cache slice never reuses across calls or scopes", async () => {
	let releaseFirst;
	const held = new Promise(resolve => { releaseFirst = resolve; });
	let calls = 0, active = 0, maximumActive = 0;
	const adapter = createDecisionAdapter({ apiKey: "secret", maxConcurrency: 1, fetcher: async () => {
		calls++;
		active++;
		maximumActive = Math.max(maximumActive, active);
		try {
			if (calls === 1) await held;
			return response(answer());
		} finally {
			active--;
		}
	} });
	const firstOwner = lease();
	const queuedOwner = lease();
	const queuedBudget = queuedOwner.context.budget;
	const first = adapter.decide(batch({ id: "first" }), firstOwner);
	const queued = adapter.decide(batch({ id: "queued" }), queuedOwner);
	queuedOwner.cancel("queued_cancelled");
	assert.equal((await queued).failure.code, "cancelled");
	assert.deepEqual(queuedOwner.context.budget, queuedBudget, "a caller cancelled in the concurrency queue reserves and spends nothing");
	releaseFirst();
	assert.equal((await first).status, "complete");

	assert.equal((await adapter.decide(batch({ id: "repeat" }), lease())).status, "complete");
	const otherScope = { ...keeperScope, campaign: "campaign-b" };
	const otherReadSet = [{ kind: "world", resource: "campaign-b", revision: "w1" }];
	const otherLease = lease({ scope: otherScope, readSet: otherReadSet });
	const otherBatch = batch({ id: "other-scope", scope: otherScope, readSet: otherReadSet });
	assert.equal((await adapter.decide(otherBatch, otherLease)).status, "complete");
	assert.equal(calls, 3, "the first slice has no cache, including same-request and cross-scope reuse");
	assert.equal(maximumActive, 1);
});

test("shared-lease batches wait for peer reservation refunds instead of failing from speculative worst-case holds", async () => {
	const count = 6, actualInput = 1, actualOutput = 1;
	const packed = packDecisionBatch(batch());
	const inputBound = packed.estimate.totalUpperBound, outputBound = packed.estimate.responseUpperBound;
	const costBound = inputBound * JEV_INPUT_USD_PER_MILLION / 1_000_000;
	const actualCost = actualInput * JEV_INPUT_USD_PER_MILLION / 1_000_000;
	const initial = {
		deadlineAt: Date.now() + 10_000,
		remainingInputTokens: inputBound * 2 + actualInput * (count - 2),
		remainingOutputTokens: outputBound * 2 + actualOutput * (count - 2),
		remainingCostUsd: costBound * 2 + actualCost * (count - 2),
		remainingActions: count,
	};
	const owner = lease({ budget: initial });
	const releases = [], snapshots = [];
	let calls = 0, active = 0, maximumActive = 0;
	const adapter = createDecisionAdapter({ apiKey: "secret", maxConcurrency: 4, fetcher: async () => {
		calls++; active++; maximumActive = Math.max(maximumActive, active);
		snapshots.push(owner.context.budget);
		return new Promise(resolve => releases.push(() => {
			active--;
			resolve(response(answer({ usage: { input_tokens: actualInput, output_tokens: actualOutput } })));
		}));
	} });
	const pending = Array.from({ length: count }, (_, index) => adapter.decide(batch({ id: `shared-${index}` }), owner));
	for (const expected of [2, 4, 6]) {
		await waitUntil(() => calls === expected, `${expected} admitted shared-lease fetches`);
		assert.equal(releases.length, 2);
		releases.splice(0).forEach(release => release());
	}
	const results = await Promise.all(pending);

	assert.ok(results.every(value => value.status === "complete"), JSON.stringify(results));
	assert.equal(calls, count);
	assert.equal(maximumActive, 2, "only the two worst-case reservations that fit may reach fetch concurrently");
	assert.ok(snapshots.every(value => value.remainingInputTokens >= 0 && value.remainingOutputTokens >= 0
		&& value.remainingCostUsd >= 0 && value.remainingActions >= 0), "outstanding reservations never exceed the shared lease budget");
	assert.ok(snapshots[1].remainingInputTokens < inputBound, "a third worst-case reservation cannot fit until a peer settles actual usage");
	assert.equal(owner.context.budget.remainingInputTokens, initial.remainingInputTokens - count * actualInput);
	assert.equal(owner.context.budget.remainingOutputTokens, initial.remainingOutputTokens - count * actualOutput);
	assert.ok(Math.abs(owner.context.budget.remainingCostUsd - (initial.remainingCostUsd - count * actualCost)) < 1e-15);
	assert.equal(owner.context.budget.remainingActions, 0);
});

test("budget reservation blocks before fetch and actual usage overrun cancels the lease", async () => {
	let calls = 0;
	const small = lease({ budget: {
		deadlineAt: Date.now() + 10_000, remainingInputTokens: 1, remainingOutputTokens: 1,
		remainingCostUsd: 0.000001, remainingActions: 1,
	} });
	const adapter = createDecisionAdapter({ apiKey: "secret", maxConcurrency: 1, fetcher: async () => { calls++; return response(answer()); } });
	assert.equal((await adapter.decide(batch(), small)).failure.code, "budget_exhausted");
	assert.equal(calls, 0);
	assert.equal((await adapter.decide(batch({ id: "after-budget-rejection" }), lease())).status, "complete",
		"terminal budget rejection releases its concurrency slot");
	assert.equal(calls, 1);

	const overrunOwner = lease();
	const overrun = createDecisionAdapter({ apiKey: "secret", fetcher: async () => response(answer({
		usage: { input_tokens: 120, output_tokens: 10_000 },
	})) });
	const result = await overrun.decide(batch(), overrunOwner);
	assert.equal(result.failure.code, "budget_exhausted");
	assert.equal(overrunOwner.signal.aborted, true);
});
