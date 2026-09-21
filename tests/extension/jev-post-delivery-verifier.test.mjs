import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import {
	POST_DELIVERY_FINDING_KINDS,
	POST_DELIVERY_VERIFIER_MODEL,
	postDeliveryVerifierBindings,
	runPostDeliveryVerifier,
} from "../../runtime/jev/post-delivery-verifier-domain.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { budgetedVerifierContext, runVerifierLane } from "../../extensions/kernel/verifier.ts";

function input(overrides = {}) {
	return {
		campaign: "campaign-a",
		turn: 7,
		commit: "abc1234",
		incumbentModel: "fixture/incumbent",
		renderedText: "Same. Same.",
		playLanguage: "en",
		facts: {
			committed: ["Location: Office"],
			keeper_only: ["Undiscovered clue: cellar-scratches -- Deep scratches mark the cellar frame."],
			public: ["Investigator: Thomas Hayes"],
		},
		speech: [{ who: { name: "Knott" }, text: "Same." }],
		...overrides,
	};
}

function leaseFor(value, overrides = {}) {
	const bindings = postDeliveryVerifierBindings(value);
	return new TaskLease({
		owner: "post-delivery-verifier",
		goal: "Classify one committed delivery.",
		scope: bindings.scope,
		capabilities: ["decision"],
		readSet: bindings.readSet,
		budget: {
			deadlineAt: Date.now() + 10_000,
			remainingInputTokens: 1_000_000,
			remainingOutputTokens: 100_000,
			remainingCostUsd: 1,
			remainingActions: 32,
		},
		...overrides,
	});
}

function complete(batch, choices, usage = { inputTokens: 10, outputTokens: 2, costUsd: 0.000001 }) {
	const answers = Object.fromEntries(batch.questions.map(question => [question.key, {
		status: "answered", type: "choice", choice: choices[question.key] ?? "none",
	}]));
	return { batchId: batch.id, status: "complete", answers,
		coverage: { required: batch.questions.map(question => question.key), answered: batch.questions.map(question => question.key), unknown: [] },
		issues: [], usage, elapsedMs: 1, attempts: 1 };
}

test("typed aliases select duplicate-safe exact prose and a host-bound clue without copying either", async () => {
	const value = input(), batches = [];
	assert.equal(postDeliveryVerifierBindings(value).readSet.find(binding => binding.kind === "source").revision, value.commit,
		"the source binding is the canonical committed origin, not a turn number or text-only cache key");
	const decision = { async decide(batch) {
		batches.push(structuredClone(batch));
		if (batch.id.endsWith("reveal-basis")) return complete(batch, { "reveal:1:0": "keeper-fact:0" });
		if (batch.id === "post-delivery:1") return complete(batch, {
			reveal: "prose:1", player_agency: "prose:1",
			uncommitted_state: "none", play_language_mismatch: "none", unmarked_speech: "none",
			investigator_identity_mismatch: "none",
		});
		return complete(batch, { reveal: "none", player_agency: "none" });
	} };
	const lease = leaseFor(value);
	const result = await runPostDeliveryVerifier(value, decision, lease);
	lease.close();

	assert.equal(result.status, "complete");
	assert.equal(result.calls, 3);
	assert.deepEqual(result.findings.map(row => ({ kind: row.kind, quote: row.quote, clue: row.clue })), [
		{ kind: "reveal", quote: "Same.", clue: "cellar-scratches" },
		{ kind: "player_agency", quote: "Same.", clue: undefined },
	]);
	assert.deepEqual(batches[0].state.prose.map(row => [row.alias, row.text]), [["prose:0", "Same. "], ["prose:1", "Same."]]);
	assert.deepEqual(batches[0].questions.map(question => question.key), POST_DELIVERY_FINDING_KINDS);
	assert.deepEqual(batches[1].questions.map(question => question.key), ["reveal:1:0"]);
	assert.equal(JSON.stringify(batches.map(batch => batch.questions)).includes("cellar-scratches"), false,
		"answers and criteria carry aliases, never the clue name");
});

test("the real DecisionAdapter wire sees semantic evidence and aliases but no SourceRef coordinates or bindings", async () => {
	const value = input({ renderedText: "门框完好。" });
	let sent;
	const adapter = createDecisionAdapter({ apiKey: "memory-only-test-key", fetcher: async (_url, init) => {
		sent = JSON.parse(init.body);
		const answers = Object.fromEntries(Object.entries(sent.questions).map(([key, question]) => [key, {
			type: "choice", choice: "none", confidence: 1,
			probabilities: Object.fromEntries(Object.keys(question.criteria).map(candidate => [candidate, candidate === "none" ? 1 : 0])),
		}]));
		return new Response(JSON.stringify({ model: POST_DELIVERY_VERIFIER_MODEL, answers,
			usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { "Content-Type": "application/json" } });
	} });
	const lease = leaseFor(value);
	const result = await runPostDeliveryVerifier(value, adapter, lease);
	lease.close();

	assert.equal(result.status, "complete");
	assert.deepEqual(result.findings, []);
	assert.deepEqual(Object.keys(sent), ["model", "state", "questions"]);
	assert.equal(sent.state.prose[0].text, "门框完好。");
	const wire = JSON.stringify(sent);
	const keys = new Set();
	const collectKeys = value => {
		if (Array.isArray(value)) return value.forEach(collectKeys);
		if (!value || typeof value !== "object") return;
		for (const [key, item] of Object.entries(value)) { keys.add(key); collectKeys(item); }
	};
	collectKeys(sent);
	for (const privateField of ["selector", "revision", "resource", "readSet", "scope"])
		assert.equal(keys.has(privateField), false, `${privateField} stays host-only`);
	assert.equal(wire.includes("memory-only-test-key"), false, "the credential stays host-only");
	for (const answer of Object.values(sent.questions))
		assert.ok(Object.keys(answer.criteria).every(candidate => candidate === "none" || /^prose:\d+$/.test(candidate)));
});

test("incomplete typed coverage requests incumbent fallback and publishes no partial findings", async () => {
	const value = input(), lease = leaseFor(value);
	const decision = { async decide(batch) {
		return { batchId: batch.id, status: "incomplete", answers: {},
			coverage: { required: batch.questions.map(question => question.key), answered: [], unknown: batch.questions.map(question => question.key) },
			issues: [{ key: batch.questions[0].key, code: "missing_answer" }],
			failure: { code: "schema_error", retryable: false } };
	} };
	const result = await runPostDeliveryVerifier(value, decision, lease);
	lease.close();

	assert.deepEqual(result, {
		status: "fallback", reason: "schema_error", calls: 1, elapsedMs: result.elapsedMs,
		usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
	});
});

test("the legacy ten-finding ceiling is applied after exact host materialization", async () => {
	const value = input({ renderedText: "One. Two." });
	const decision = { async decide(batch) {
		return complete(batch, Object.fromEntries(batch.questions.map(question => {
			const issued = Object.keys(question.criteria).filter(alias => alias !== "none");
			return [question.key, issued[0] ?? "none"];
		})));
	} };
	const lease = leaseFor(value);
	const result = await runPostDeliveryVerifier(value, decision, lease);
	lease.close();

	assert.equal(result.status, "complete");
	assert.equal(result.findings.length, 10);
	assert.ok(result.findings.every(row => value.renderedText.includes(row.quote)));
	assert.ok(result.calls >= 2);
});

test("a lease with another source binding is rejected before any semantic call", async () => {
	const value = input();
	let calls = 0;
	const lease = leaseFor(value, { readSet: [{ kind: "source", resource: "wrong", revision: "wrong" }] });
	const result = await runPostDeliveryVerifier(value, { async decide() { calls++; throw new Error("must not run"); } }, lease);
	lease.close();

	assert.equal(result.status, "fallback");
	assert.equal(result.reason, "attempt_binding_mismatch");
	assert.equal(calls, 0);
});

test("unexpected provider errors cannot copy private detail into fallback telemetry", async () => {
	const value = input(), lease = leaseFor(value);
	const result = await runPostDeliveryVerifier(value, { async decide() {
		throw new Error("private delivered text and credential detail");
	} }, lease);
	lease.close();

	assert.equal(result.status, "fallback");
	assert.equal(result.reason, "verifier_owner_error");
	assert.equal(JSON.stringify(result).includes("private delivered text"), false);
});

test("typed verification refuses an absent canonical commit instead of fabricating a turn revision", async () => {
	const value = input({ commit: undefined }), bindings = postDeliveryVerifierBindings(input());
	const lease = new TaskLease({ owner: "post-delivery-verifier", goal: "Reject an uncommitted origin.",
		scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet,
		budget: { deadlineAt: Date.now() + 10_000, remainingInputTokens: 100, remainingOutputTokens: 100,
			remainingCostUsd: 1, remainingActions: 2 } });
	let calls = 0;
	const result = await runPostDeliveryVerifier(value, { async decide() { calls++; throw new Error("must not run"); } }, lease);
	lease.close();

	assert.equal(result.status, "fallback");
	assert.equal(result.reason, "verifier_commit_unavailable");
	assert.equal(calls, 0);
});

test("the opt-in extension routes a missing commit through one budgeted incumbent attempt", async () => {
	const previous = { route: process.env.PI_COC_JEV_VERIFIER, model: process.env.PI_COC_VERIFIER_MODEL };
	process.env.PI_COC_JEV_VERIFIER = "1";
	process.env.PI_COC_VERIFIER_MODEL = "fixture/incumbent";
	const model = { id: "incumbent", provider: "fixture", api: "openai-completions", maxTokens: 4096,
		cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.75 } };
	let completions = 0;
	const ctx = { cwd: process.cwd(), model, sessionManager: { getSessionId: () => undefined }, modelRegistry: {
		find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
		async complete(_model, _context, options) {
			completions++;
			assert.ok(options.maxTokens <= 8192);
			return { role: "assistant", content: [{ type: "text", text: '{"findings":[]}' }], api: model.api,
				provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "stop",
				usage: { input: 8, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
					cost: { input: 0.000008, output: 0.000004, cacheRead: 0, cacheWrite: 0, total: 0.000012 } } };
		},
	} };
	const warnings = [], rows = [];
	try {
		await runVerifierLane({ ctx, payload: { campaign: "campaign-a", turn: 7, rendered_text: "Committed words.",
			facts: { committed: [], keeper_only: [], public: [] } }, playLanguage: "en",
			call: async (method, params) => { warnings.push({ method, params }); return { recorded: 0, dropped: 0 }; },
			record: row => rows.push(row) });
	} finally {
		if (previous.route === undefined) delete process.env.PI_COC_JEV_VERIFIER; else process.env.PI_COC_JEV_VERIFIER = previous.route;
		if (previous.model === undefined) delete process.env.PI_COC_VERIFIER_MODEL; else process.env.PI_COC_VERIFIER_MODEL = previous.model;
	}
	assert.equal(completions, 1);
	assert.equal(warnings.length, 1);
	const final = rows.findLast(row => row.lane === "verifier");
	assert.equal(final.fallback_reason, "missing_commit");
	assert.equal(final.route, "incumbent");
	assert.equal(final.incumbent_calls, 1);
});

test("incumbent fallback reserves the public 8192-token ceiling and settles actual usage on the same lease", async () => {
	const value = input(), lease = leaseFor(value), before = lease.context.budget;
	let options, during;
	const model = { id: "incumbent", provider: "fixture", api: "openai-completions", maxTokens: 20_000,
		cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.75,
			tiers: [{ inputTokensAbove: 100, input: 3, output: 4, cacheRead: 2, cacheWrite: 2.5 }] } };
	const reply = { role: "assistant", content: [{ type: "text", text: "{}" }], api: model.api, provider: model.provider,
		model: model.id, timestamp: Date.now(), stopReason: "stop",
		usage: { input: 11, output: 7, cacheRead: 2, cacheWrite: 3, totalTokens: 23,
			cost: { input: 0.00001, output: 0.01996, cacheRead: 0.00001, cacheWrite: 0.00002, total: 0.02 } } };
	const ctx = { modelRegistry: { async complete(_model, _context, sent) { options = sent; during = lease.context.budget; return reply; } } };
	const accounting = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const wrapped = budgetedVerifierContext(ctx, lease, accounting);
	assert.equal(await wrapped.modelRegistry.complete(model, { systemPrompt: "bounded", messages: [] }, { maxTokens: 20_000 }), reply);

	assert.equal(options.maxTokens, 8192);
	assert.equal(during.remainingOutputTokens, before.remainingOutputTokens - 8192, "the full public output bound is held before the call");
	assert.deepEqual(accounting, { calls: 1, inputTokens: 16, outputTokens: 7, costUsd: 0.02 });
	assert.equal(lease.context.budget.remainingInputTokens, before.remainingInputTokens - 16);
	assert.equal(lease.context.budget.remainingOutputTokens, before.remainingOutputTokens - 7);
	assert.equal(lease.context.budget.remainingCostUsd, before.remainingCostUsd - 0.02);
	assert.equal(lease.context.budget.remainingActions, before.remainingActions - 1);
	lease.close();
});

test("an unknown incumbent failure keeps the full reserved bound and a cancelled typed call requests fallback", async () => {
	const value = input(), lease = leaseFor(value), before = lease.context.budget;
	const model = { id: "incumbent", provider: "fixture", api: "openai-completions", maxTokens: 20_000,
		cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.75, tiers: [] } };
	const ctx = { modelRegistry: { async complete() { throw new Error("transport failed after dispatch"); } } };
	const accounting = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const wrapped = budgetedVerifierContext(ctx, lease, accounting);
	await assert.rejects(() => wrapped.modelRegistry.complete(model, { systemPrompt: "bounded", messages: [] }, {}), /transport failed/);
	assert.equal(accounting.calls, 1);
	assert.equal(accounting.outputTokens, 8192);
	assert.equal(lease.context.budget.remainingOutputTokens, before.remainingOutputTokens - 8192);
	assert.equal(lease.context.budget.remainingActions, before.remainingActions - 1);
	lease.close();

	const cancelled = leaseFor(value);
	cancelled.cancel("typed_verifier_cancelled");
	const result = await runPostDeliveryVerifier(value, { async decide(_batch, owner) { owner.assertActive(); } }, cancelled);
	assert.equal(result.status, "fallback");
	assert.equal(result.reason, "typed_verifier_cancelled");
});
