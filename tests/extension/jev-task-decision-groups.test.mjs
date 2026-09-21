import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

class FakeClock {
	value = 0;
	jobs = new Set();
	now = () => this.value;
	schedule = (callback, delayMs) => {
		const job = { callback, at: this.value + delayMs };
		this.jobs.add(job);
		return () => this.jobs.delete(job);
	};
}

class RecordingStore {
	records = new Map();
	snapshots = [];
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) {
		const copy = structuredClone(record);
		this.snapshots.push(copy);
		this.records.set(copy.checkpoint.context.id, copy);
	}
}

const scope = { owner: "decision-group-owner", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const playerRef = {
	version: 1,
	scope,
	resource: "turn:4:player",
	revision: "input-r1",
	sourceType: "turn",
	selector: { kind: "field", path: ["player_text"] },
};
const readSet = [
	{ kind: "world", resource: "campaign", revision: "world-r1" },
	{ kind: "source", resource: "turn:4", revision: "source-r1" },
];

function lease(clock, overrides = {}) {
	return {
		owner: "decision-group-test",
		goal: "Classify independent frozen partitions",
		scope,
		capabilities: [],
		budget: {
			deadlineAt: 10_000,
			remainingInputTokens: 100,
			remainingOutputTokens: 100,
			remainingCostUsd: 10,
			remainingActions: 100,
		},
		readSet,
		clock,
		...overrides,
	};
}

function intent() {
	return { id: "intent-group", rawInput: playerRef, goal: "Classify independent frozen partitions", limits: [], scope, turn: 4, inputRevision: "input-r1" };
}

function plan() {
	return {
		goal: "Classify independent frozen partitions",
		subgoals: [],
		constraints: ["Each partition uses the same starting state."],
		evidenceRequired: [],
		completion: ["Every declared partition has a typed result."],
		capabilities: [],
		replanWhen: [],
		returnWhen: [],
	};
}

function batch(name, state = {}) {
	return {
		model: "local-test-model",
		family: "independent-partitions",
		familyVersion: "1",
		state: { partition: name, fixed: { value: 1 }, ...state },
		questions: [{
			key: `question_${name}`,
			type: "choice",
			target: `partition ${name}`,
			instructions: "Choose one issued result.",
			criteria: { yes: "Yes", no: "No" },
		}],
	};
}

function complete(batchValue, choice = "yes") {
	const key = batchValue.questions[0].key;
	return {
		batchId: batchValue.id,
		status: "complete",
		answers: { [key]: { status: "answered", type: "choice", choice } },
		coverage: { required: [key], answered: [key], unknown: [] },
		issues: [],
		usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
	};
}

function operations() {
	return {
		async validate() { return structuredClone(readSet); },
		async dispatch() { throw new Error("decision-group tests must not dispatch operations"); },
	};
}

function setup({ domain, decision, maxSteps = 32, store = new RecordingStore(), clock = new FakeClock() }) {
	return { store, clock, runtime: new TaskRuntime({ decision, store, operations: operations(), domains: [domain], clock, maxSteps }) };
}

async function beginAndSubmit(runtime, clock, leaseOverrides = {}) {
	const id = await runtime.begin({ lease: lease(clock, leaseOverrides), intent: intent(), domain: "groups" });
	return { id, result: runtime.submit(id, plan()) };
}

function deferredDecision(store, count) {
	const calls = [], releases = new Map();
	let startedResolve;
	const started = new Promise(resolve => { startedResolve = resolve; });
	return {
		calls,
		releases,
		started,
		port: {
			async decide(batchValue, task) {
				const atDispatch = store.records.get(task.context.id);
				assert.equal(atDispatch.checkpoint.context.budget.remainingInputTokens, 0, "all decision allowance is durably unavailable before dispatch");
				assert.equal(atDispatch.checkpoint.context.budget.remainingOutputTokens, 0);
				assert.equal(atDispatch.checkpoint.context.budget.remainingCostUsd, 0);
				const reservation = task.reserve({ inputTokens: 1, outputTokens: 1, costUsd: 0, actions: 1 });
				calls.push(structuredClone(batchValue));
				if (calls.length === count) startedResolve();
				return new Promise(resolve => releases.set(batchValue.state.partition, value => {
					reservation.settle({ inputTokens: 1, outputTokens: 1, costUsd: 0, actions: 1 });
					resolve(value ?? complete(batchValue));
				}));
			},
		},
	};
}

test("independent decision batches overlap, freeze inputs, and persist answers in declaration order", async () => {
	const store = new RecordingStore();
	const group = {
		kind: "decisions",
		batches: [
			{ key: "alpha", batch: batch("alpha") },
			{ key: "beta", batch: batch("beta") },
			{ key: "gamma", batch: batch("gamma") },
		],
	};
	const domain = {
		id: "groups", version: "1", capabilities: [],
		next: view => view.decisions.length ? { kind: "finish", status: "complete", remainingNeeds: [] } : group,
	};
	const deferred = deferredDecision(store, 3);
	const app = setup({ domain, decision: deferred.port, store });
	const { id, result } = await beginAndSubmit(app.runtime, app.clock);

	await deferred.started;
	group.batches.reverse();
	group.batches[0].batch.state.fixed.value = 99;
	assert.equal(deferred.releases.size, 3, "all calls are live before any one settles");
	assert.deepEqual(deferred.calls.map(call => call.state), [
		{ partition: "alpha", fixed: { value: 1 } },
		{ partition: "beta", fixed: { value: 1 } },
		{ partition: "gamma", fixed: { value: 1 } },
	]);
	assert.ok(deferred.calls.every(call => isSameBinding(call.scope, scope) && isSameBinding(call.readSet, readSet)));

	deferred.releases.get("gamma")();
	deferred.releases.get("alpha")();
	deferred.releases.get("beta")();
	assert.equal((await result).status, "complete");
	const saved = app.runtime.snapshot(id);
	assert.deepEqual(saved.decisions.map(row => row.key), ["alpha", "beta", "gamma"]);
	assert.deepEqual(saved.decisions.map(row => row.batch.state.partition), ["alpha", "beta", "gamma"]);
	assert.equal(saved.steps, 3);
	assert.equal(saved.checkpoint.context.step, 3);
	assert.equal(saved.checkpoint.context.rootStep, 3);
	assert.equal(app.runtime.lease(id).context.budget.remainingActions, 97);
});

test("a rejected peer becomes typed unavailable without dropping successful peers", async () => {
	const calls = [];
	const decision = {
		async decide(batchValue, task) {
			calls.push(batchValue.state.partition);
			const reservation = task.reserve({ inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 1 });
			reservation.settle();
			if (batchValue.state.partition === "beta") throw new Error("peer unavailable");
			return complete(batchValue, batchValue.state.partition === "gamma" ? "no" : "yes");
		},
	};
	const domain = {
		id: "groups", version: "1", capabilities: [],
		next: view => view.decisions.length ? { kind: "finish", status: "complete", remainingNeeds: [] } : {
			kind: "decisions",
			batches: ["alpha", "beta", "gamma"].map(key => ({ key, batch: batch(key) })),
		},
	};
	const app = setup({ domain, decision });
	const { id, result } = await beginAndSubmit(app.runtime, app.clock);
	assert.equal((await result).status, "complete");
	assert.deepEqual(calls, ["alpha", "beta", "gamma"]);
	const rows = app.runtime.snapshot(id).decisions;
	assert.deepEqual(rows.map(row => row.key), ["alpha", "beta", "gamma"]);
	assert.equal(rows[0].result.status, "complete");
	assert.equal(rows[1].result.status, "unavailable");
	assert.deepEqual(rows[1].result.answers, {});
	assert.equal(rows[1].result.failure.code, "service_error");
	assert.deepEqual(rows[1].result.coverage, { required: ["question_beta"], answered: [], unknown: ["question_beta"] });
	assert.equal(rows[2].result.status, "complete");
});

test("a decision group beyond the remaining step allowance refuses before any call", async () => {
	let calls = 0;
	const decision = { async decide(batchValue) { calls++; return complete(batchValue); } };
	const domain = {
		id: "groups", version: "1", capabilities: [],
		next: () => ({ kind: "decisions", batches: ["a", "b", "c"].map(key => ({ key, batch: batch(key) })) }),
	};
	const app = setup({ domain, decision, maxSteps: 2 });
	const { id, result } = await beginAndSubmit(app.runtime, app.clock);
	const outcome = await result;
	assert.equal(outcome.status, "partial");
	assert.match(outcome.remainingNeeds[0], /exceeds the remaining step allowance/i);
	assert.equal(calls, 0);
	assert.equal(app.runtime.snapshot(id).steps, 0);
	assert.deepEqual(app.runtime.snapshot(id).decisions, []);
});

test("duplicate group keys fail before calls or step accounting", async () => {
	let calls = 0;
	const decision = { async decide(batchValue) { calls++; return complete(batchValue); } };
	const domain = {
		id: "groups", version: "1", capabilities: [],
		next: () => ({ kind: "decisions", batches: [
			{ key: "same", batch: batch("a") },
			{ key: "same", batch: batch("b") },
		] }),
	};
	const app = setup({ domain, decision });
	const { id, result } = await beginAndSubmit(app.runtime, app.clock);
	const outcome = await result;
	assert.equal(outcome.status, "failed");
	assert.deepEqual(outcome.remainingNeeds, ["duplicate_decision_step"]);
	assert.equal(calls, 0);
	assert.equal(app.runtime.snapshot(id).steps, 0);
	assert.deepEqual(app.runtime.snapshot(id).decisions, []);
});

test("foreground cancellation fences late group results and preserves conservative budget", async () => {
	const store = new RecordingStore();
	const domain = {
		id: "groups", version: "1", capabilities: [],
		next: view => view.decisions.length ? { kind: "finish", status: "complete", remainingNeeds: [] } : {
			kind: "decisions", batches: ["alpha", "beta"].map(key => ({ key, batch: batch(key) })),
		},
	};
	const deferred = deferredDecision(store, 2);
	const app = setup({ domain, decision: deferred.port, store });
	const { id, result } = await beginAndSubmit(app.runtime, app.clock);
	await deferred.started;
	await app.runtime.cancelForeground("replacement_input");
	const cancelled = await store.load(id);
	assert.equal(cancelled.status, "closed");
	assert.equal(cancelled.result.status, "cancelled");
	assert.deepEqual(cancelled.decisions, []);
	assert.equal(cancelled.checkpoint.context.budget.remainingInputTokens, 98);
	assert.equal(cancelled.checkpoint.context.budget.remainingOutputTokens, 98);
	assert.equal(cancelled.checkpoint.context.budget.remainingActions, 98);

	deferred.releases.get("alpha")();
	deferred.releases.get("beta")();
	assert.equal((await result).status, "cancelled");
	assert.deepEqual(await store.load(id), cancelled, "late peer results cannot publish after durable cancellation");
});

function isSameBinding(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
