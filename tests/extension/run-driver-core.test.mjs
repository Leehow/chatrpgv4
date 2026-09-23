/**
 * The RunDriver of the vendored agent-core (SL-01), against stub ports and a stub model engine: the
 * loop's own structure, independent of any product policy. The session-level gate (real provider path,
 * real session, fake kernel) is `single-loop-run-driver.test.mjs`.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RUN_EVENT_SCHEMA_VERSION, runDriver } from "./pi-agent-core.mjs";

const input = { runId: "r1", inputRevision: "rev-1", rawInput: "go north", scopeId: "r1:root" };

/** A policy that plays a fixed script of step requests, one per call, and records every view it saw. */
function scripted(steps) {
	const views = [];
	return {
		views,
		policy: {
			name: "scripted",
			version: "1",
			initial: () => ({ index: 0 }),
			next(view) {
				views.push(view);
				const step = steps[view.policyState.index];
				return typeof step === "function" ? step(view) : step ?? { kind: "finish", outcome: "undelivered", reason: "script_end" };
			},
			reduce: (state) => ({ index: state.index + 1 }),
		},
	};
}

function assistant(content, stopReason = "stop") {
	return { role: "assistant", content, api: "faux", provider: "faux", model: "m", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason, timestamp: Date.now() };
}

function engine(responses, log = []) {
	return {
		log,
		async infer({ stepId, onAttempt }) {
			await onAttempt(1);
			log.push(["infer", stepId]);
			return responses.shift();
		},
		async executeModelTool(proposal) {
			log.push(["tool", proposal.toolCall.id]);
			return { role: "toolResult", toolCallId: proposal.toolCall.id, toolName: proposal.toolCall.name, content: [{ type: "text", text: "done" }], isError: false, timestamp: Date.now() };
		},
		async refuseModelTool(proposal, reason) {
			log.push(["refuse", proposal.toolCall.id]);
			return { role: "toolResult", toolCallId: proposal.toolCall.id, toolName: proposal.toolCall.name, content: [{ type: "text", text: reason }], isError: true, timestamp: Date.now() };
		},
		async closeTurn(message, results) {
			log.push(["turn_end", results.length]);
			return { continueRequested: false };
		},
	};
}

test("a policy-origin read runs before the first model step; every event carries the run envelope, in order", async () => {
	const events = [];
	const reads = [];
	const { policy } = scripted([
		{ kind: "operate", proposals: [{ origin: "policy", operation: "read", readOnly: true, params: { method: "table.capsule" } }] },
		{ kind: "infer", purpose: "compose", reason: "test" },
		{ kind: "finish", outcome: "undelivered", reason: "prose_only" },
	]);
	const log = [];
	const result = await runDriver({
		input, policy, signal: new AbortController().signal, emit: (event) => events.push(event),
		engine: engine([assistant([{ type: "text", text: "You walk north." }])], log),
		ports: { read: { read: async (proposal, invocation) => { reads.push({ proposal, invocation }); log.push(["read", invocation.stepId]); return { status: "ok", artifact: { scene: "hall" } }; } } },
	});
	assert.equal(result.status, "undelivered");
	assert.deepEqual(log.map(([kind]) => kind), ["read", "infer", "turn_end"], "the read ran before the model was asked");
	assert.equal(reads[0].invocation.origin, "policy");
	assert.equal(reads[0].invocation.inputRevision, "rev-1");
	assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
	for (const event of events) {
		assert.equal(event.runId, "r1");
		assert.equal(event.schemaVersion, RUN_EVENT_SCHEMA_VERSION);
		assert.ok(["policy", "model", "user-command"].includes(event.origin));
		assert.ok(["internal", "keeper", "player"].includes(event.visibility));
		assert.equal(typeof event.scopeId, "string");
	}
	assert.deepEqual(events.map((event) => event.type), ["run_start", "step_start", "operation_prepared", "operation_settled", "step_end",
		"step_start", "step_attempt", "step_end", "step_start", "step_end", "run_end"]);
	const attempt = events.find((event) => event.type === "step_attempt");
	assert.equal(attempt.stepId, "r1:s2");
	assert.equal(attempt.attemptId, "r1:s2#a1", "a provider attempt has its own identity inside the step");
});

test("model tool calls are pending proposals: nothing but executing them may follow, and each gets its own paired result", async () => {
	const call = { type: "toolCall", id: "call-1", name: "look", arguments: {} };
	const bad = scripted([
		{ kind: "infer", purpose: "adjudicate", reason: "test" },
		{ kind: "decide", purpose: "route", question: {} },
	]);
	const log = [];
	const refused = await runDriver({ input, policy: bad.policy, signal: new AbortController().signal, emit: () => {}, engine: engine([assistant([call], "toolUse")], log) });
	assert.equal(refused.status, "failed");
	assert.equal(refused.reason, "policy_violation");
	assert.ok(!log.some(([kind]) => kind === "tool"), "a violating policy executes nothing");

	const good = scripted([
		{ kind: "infer", purpose: "adjudicate", reason: "test" },
		(view) => ({ kind: "operate", proposals: view.pendingProposals }),
		{ kind: "finish", outcome: "undelivered", reason: "done" },
	]);
	const log2 = [];
	const done = await runDriver({ input, policy: good.policy, signal: new AbortController().signal, emit: () => {}, engine: engine([assistant([call], "toolUse")], log2) });
	assert.equal(done.status, "undelivered");
	assert.deepEqual(log2.map(([kind, value]) => `${kind}:${value}`), ["infer:r1:s1", "tool:call-1", "turn_end:1"]);
	assert.equal(done.observations[1].toolResults[0].toolCallId, "call-1");
});

test("a truncated response executes nothing: each call is answered by an explicit refusal", async () => {
	const call = { type: "toolCall", id: "call-9", name: "apply", arguments: { effects: [] } };
	const { policy } = scripted([
		{ kind: "infer", purpose: "adjudicate", reason: "test" },
		(view) => ({ kind: "operate", proposals: view.pendingProposals }),
		{ kind: "finish", outcome: "undelivered", reason: "done" },
	]);
	const log = [];
	await runDriver({ input, policy, signal: new AbortController().signal, emit: () => {}, engine: engine([assistant([call], "length")], log) });
	assert.deepEqual(log.map(([kind]) => kind), ["infer", "refuse", "turn_end"]);
});

test("after a model step only execution or completion may follow", async () => {
	const { policy } = scripted([
		{ kind: "infer", purpose: "compose", reason: "test" },
		{ kind: "infer", purpose: "compose", reason: "again" },
	]);
	const result = await runDriver({ input, policy, signal: new AbortController().signal, emit: () => {}, engine: engine([assistant([{ type: "text", text: "x" }])]) });
	assert.equal(result.reason, "policy_violation");
});

test("abort during a decision wait revokes the run at once; the late answer is discarded and nothing runs after it", async () => {
	const controller = new AbortController();
	const events = [];
	let answer;
	const decision = { decide: () => new Promise((resolve) => { answer = resolve; queueMicrotask(() => controller.abort()); }) };
	const { policy } = scripted([
		{ kind: "decide", purpose: "route", question: { q: 1 } },
		{ kind: "operate", proposals: [{ origin: "policy", operation: "read", readOnly: true }] },
	]);
	const reads = [];
	const result = await runDriver({ input, policy, signal: controller.signal, emit: (event) => events.push(event), engine: engine([]),
		ports: { decision, read: { read: async () => { reads.push(1); return { status: "ok" }; } } } });
	answer({ status: "ok", artifact: { choice: "late" } });
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(result.status, "aborted");
	assert.equal(result.reason, "aborted_during_decide");
	assert.equal(reads.length, 0);
	assert.deepEqual(events.slice(-2).map((event) => [event.type, event.status]), [["step_end", "aborted"], ["run_end", "aborted"]]);
	assert.equal(result.observations.length, 0, "the discarded decision never became an observation");
});

test("abort during an operation wait answers the real model calls explicitly and runs nothing else", async () => {
	const controller = new AbortController();
	const calls = [{ type: "toolCall", id: "a", name: "resolve", arguments: {} }, { type: "toolCall", id: "b", name: "apply", arguments: {} }];
	const { policy } = scripted([
		{ kind: "infer", purpose: "adjudicate", reason: "test" },
		(view) => ({ kind: "operate", proposals: view.pendingProposals }),
	]);
	const log = [];
	const operations = { execute: (proposal) => new Promise(() => { log.push(["port", proposal.toolCall.id]); controller.abort(); }) };
	const result = await runDriver({ input, policy, signal: controller.signal, emit: () => {}, engine: engine([assistant(calls, "toolUse")], log), ports: { operations } });
	assert.equal(result.status, "aborted");
	assert.deepEqual(log.map(([kind, value]) => `${kind}:${value ?? ""}`), ["infer:r1:s1", "port:a", "refuse:a", "refuse:b", "turn_end:2"]);
});

test("without a decision port a decide observes unavailable; a finish claiming delivery without evidence is undelivered", async () => {
	const seen = scripted([
		{ kind: "decide", purpose: "route", question: {} },
		{ kind: "finish", outcome: "delivered", reason: "claimed" },
	]);
	const result = await runDriver({ input, policy: seen.policy, signal: new AbortController().signal, emit: () => {}, engine: engine([]) });
	assert.equal(result.observations[0].status, "unavailable");
	assert.equal(result.status, "undelivered");
	assert.match(result.reason, /no_delivered_evidence/);
});

test("scope frames are entered and left inside the same run, never as a nested run", async () => {
	const events = [];
	const { policy } = scripted([
		{ kind: "scope", transition: "enter", scopeId: "r1:source" },
		{ kind: "scope", transition: "exit", scopeId: "r1:source" },
		{ kind: "finish", outcome: "undelivered", reason: "done" },
	]);
	await runDriver({ input, policy, signal: new AbortController().signal, emit: (event) => events.push(event), engine: engine([]) });
	assert.deepEqual(events.filter((event) => event.type.startsWith("scope")).map((event) => [event.type, event.scopeId, event.parentScopeId]),
		[["scope_enter", "r1:source", "r1:root"], ["scope_exit", "r1:source", "r1:root"]]);
	assert.equal(new Set(events.map((event) => event.runId)).size, 1);
	assert.equal(events.filter((event) => event.type === "run_start").length, 1);
});
