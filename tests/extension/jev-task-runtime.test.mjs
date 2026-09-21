import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";
import { assertTaskRecord } from "../../runtime/jev/task-record.ts";
import { createTaskProviderBudget } from "../../runtime/jev/provider-budget.ts";

class FakeClock {
	value = 0;
	jobs = new Set();
	now = () => this.value;
	schedule = (callback, delayMs) => {
		const job = { callback, at: this.value + delayMs };
		this.jobs.add(job);
		return () => this.jobs.delete(job);
	};
	advance(ms) {
		this.value += ms;
		for (;;) {
			const due = [...this.jobs].filter(job => job.at <= this.value);
			if (!due.length) return;
			for (const job of due) {
				this.jobs.delete(job);
				job.callback();
			}
		}
	}
}

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

const scope = { owner: "campaign-owner", campaign: "campaign", worldline: "main", loop: 1, audience: "keeper" };
const playerRef = {
	version: 1,
	scope,
	resource: "turn-4",
	revision: "turn-r1",
	sourceType: "turn",
	selector: { kind: "field", path: ["player_text"] },
};
const initialReadSet = [
	{ kind: "world", resource: "campaign", revision: "world-r1" },
	{ kind: "source", resource: "turn-4", revision: "turn-r1" },
];

function budget(deadlineAt = 1_000) {
	return {
		deadlineAt,
		remainingInputTokens: 100,
		remainingOutputTokens: 100,
		remainingCostUsd: 10,
		remainingActions: 100,
	};
}

function lease(clock, overrides = {}) {
	return {
		owner: "host",
		goal: "Complete the bounded task",
		scope,
		capabilities: ["look", "apply", "recall", "narrate"],
		budget: budget(),
		readSet: initialReadSet,
		clock,
		...overrides,
	};
}

function intent(overrides = {}) {
	return {
		id: "intent-4",
		rawInput: playerRef,
		goal: "Inspect, act, and reassess",
		limits: [],
		scope,
		turn: 4,
		inputRevision: "turn-r1",
		...overrides,
	};
}

function plan(capabilities = ["look"]) {
	return {
		goal: "Complete the bounded task",
		subgoals: [],
		constraints: [],
		evidenceRequired: [],
		completion: ["The task reaches an explicit terminal result."],
		capabilities,
		replanWhen: [],
		returnWhen: [],
	};
}

function question(key, state = {}) {
	return {
		kind: "decision",
		key,
		batch: {
			model: "local-test-model",
			family: "test-family",
			familyVersion: "1",
			state,
			questions: [{
				key: "proceed",
				type: "choice",
				target: "Select the next bounded action.",
				instructions: "Choose one issued candidate.",
				criteria: { yes: "Proceed", no: "Stop" },
			}],
		},
	};
}

function decisionPort(trace = []) {
	return {
		calls: [],
		async decide(batch) {
			this.calls.push(structuredClone(batch));
			trace.push(`decision:${batch.state.stage ?? "unknown"}`);
			return {
				batchId: batch.id,
				status: "complete",
				answers: { proceed: { status: "answered", type: "choice", choice: "yes" } },
				coverage: { required: ["proceed"], answered: ["proceed"], unknown: [] },
				issues: [],
				usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
			};
		},
	};
}

function observation(proposal, overrides = {}) {
	return {
		operationId: proposal.id,
		status: "succeeded",
		result: { observed: true },
		refs: [],
		receipts: [],
		readSet: proposal.readSet,
		coverage: { used: [], omitted: [], unknown: [] },
		...overrides,
	};
}

function operations(dispatch, currentReadSet = () => initialReadSet) {
	return {
		validations: 0,
		dispatches: [],
		async validate() {
			this.validations++;
			return structuredClone(currentReadSet());
		},
		async dispatch(proposal, task, journal) {
			this.dispatches.push(structuredClone(proposal));
			return dispatch ? dispatch(proposal, task, journal) : observation(proposal);
		},
	};
}

function runtime({ domain, decision = decisionPort(), store = new MemoryStore(), operationPort = operations(), clock = new FakeClock(), maxSteps } = {}) {
	return {
		clock,
		decision,
		store,
		operationPort,
		runtime: new TaskRuntime({ decision, store, operations: operationPort, domains: [domain], clock, maxSteps }),
	};
}

async function rejects(code, action) {
	await assert.rejects(action, caught => caught instanceof ContractError && caught.code === code);
}

test("a nested provider grant persists every charged ancestor before dispatch and recovery", async () => {
	const domain = { id: "durable-budget", version: "1", capabilities: ["look"],
		next: () => ({ kind: "finish", status: "complete", remainingNeeds: [] }) };
	const setup = runtime({ domain });
	const rootId = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: ["look"] }), intent: intent(), domain: domain.id });
	const childId = await setup.runtime.begin({ parentId: rootId, lease: lease(setup.clock, { capabilities: ["look"] }), intent: intent(), domain: domain.id });
	const leafId = await setup.runtime.begin({ parentId: childId, lease: lease(setup.clock, { capabilities: ["look"] }), intent: intent(), domain: domain.id });
	const entered = Promise.withResolvers(), gate = Promise.withResolvers(), save = setup.store.save.bind(setup.store);
	setup.store.save = async record => {
		if (record.checkpoint.context.id === rootId) { entered.resolve(); await gate.promise; }
		await save(record);
	};
	const port = createTaskProviderBudget(setup.runtime.lease(leafId), { changed: () => setup.runtime.persistBudget(leafId) });
	let dispatched = false;
	const pending = port.reserve({ model: { provider: "test", id: "bounded", api: "openai-responses", maxTokens: 10, contextWindow: 100,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, inputTokens: 20, outputTokens: 10 })
		.then(charge => { dispatched = true; return charge; });
	await entered.promise;
	assert.equal(dispatched, false, "Persisting the child alone cannot authorize dispatch");
	gate.resolve(); const charge = await pending;
	for (const id of [rootId, childId, leafId]) {
		const saved = await setup.store.load(id);
		assert.equal(saved.checkpoint.context.budget.remainingInputTokens, 80);
		assert.equal(saved.checkpoint.context.budget.remainingOutputTokens, 90);
		assert.equal(saved.checkpoint.context.budget.remainingActions, 99);
	}
	charge.settle();
	const recovered = runtime({ domain, store: setup.store });
	await recovered.runtime.resume(rootId, { authorize: record => record.intent.id === intent().id, currentReadSet: initialReadSet });
	assert.equal(recovered.runtime.lease(rootId).context.budget.remainingInputTokens, 80);
	await recovered.runtime.shutdown(); await setup.runtime.shutdown();
});

test("a decision can authorize an actual operation whose observation informs a later decision", async () => {
	const trace = [];
	const domain = {
		id: "dependent",
		version: "1",
		capabilities: ["look"],
		next(view) {
			if (!view.decisions.length) return question("initial-decision", { stage: "before-operation" });
			if (!view.observations.length) return {
				kind: "operation",
				key: "inspect-room",
				operation: "look",
				args: { target: "room" },
				capability: "look",
				basis: [playerRef],
			};
			if (view.decisions.length === 1) return question("follow-up-decision", {
				stage: "after-operation",
				observation: view.observations[0].packet.result,
			});
			return { kind: "finish", status: "complete", remainingNeeds: [] };
		},
	};
	const decision = decisionPort(trace);
	const operationPort = operations(async proposal => {
		trace.push(`operation:${proposal.operation}`);
		return observation(proposal, { result: { door: "open" } });
	});
	const setup = runtime({ domain, decision, operationPort });
	const id = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: ["look"] }), intent: intent(), domain: domain.id });
	const result = await setup.runtime.submit(id, plan(["look"]));

	assert.equal(result.status, "complete");
	assert.deepEqual(trace, ["decision:before-operation", "operation:look", "decision:after-operation"]);
	assert.equal(operationPort.dispatches.length, 1);
	assert.deepEqual(decision.calls[1].state.observation, { door: "open" });
	assert.deepEqual(setup.runtime.snapshot(id).observations.map(row => row.key), ["inspect-room"]);
});

test("direct draft reaches composing with zero decision calls", async () => {
	const domain = { id: "direct", version: "1", capabilities: [], next: () => { throw new Error("domain must not run"); } };
	const decision = decisionPort();
	const setup = runtime({ domain, decision });
	const id = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: [] }), intent: intent(), domain: domain.id });
	const result = await setup.runtime.directDraft(id);

	assert.equal(result.status, "complete");
	assert.equal(decision.calls.length, 0);
	assert.equal(setup.operationPort.dispatches.length, 0);
	assert.equal(setup.runtime.snapshot(id).phase, "composing");
	assert.equal(setup.runtime.snapshot(id).status, "ready");
});

test("invalid mixed-source decision data closes its artifact before transport without poisoning storage", async () => {
	const store = new MemoryStore(), save = store.save.bind(store);
	store.save = async record => { assertTaskRecord(record); await save(record); };
	const domain = { id: "mixed", version: "1", completion: "artifact", capabilities: ["recall"],
		next: () => ({kind: "decisions", batches: [{key: "assess", batch: question("assess", {raw: {state: undefined}}).batch}]}) };
	const setup = runtime({domain, store});
	const id = await setup.runtime.begin({lease: lease(setup.clock, {capabilities: ["recall"]}), intent: intent(), domain: domain.id});
	const result = await setup.runtime.submit(id, plan(["recall"]));
	assert.equal(result.status, "failed");
	assert.deepEqual(result.remainingNeeds, ["invalid_decision_input"]);
	assert.equal(setup.decision.calls.length, 0);
	assert.equal((await store.load(id)).status, "closed");
	assert.equal((await store.load(id)).decisions.length, 0);
});

test("new player input cancels only the old foreground while separately rooted committed memory survives", async () => {
	const domain = { id: "lifetime", version: "1", capabilities: ["recall"], next: () => ({ kind: "wait", remainingNeeds: ["later"] }) };
	const setup = runtime({ domain });
	const foreground = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: ["recall"] }), intent: intent(), domain: domain.id });
	const memory = await setup.runtime.begin({
		lease: lease(setup.clock, { capabilities: ["recall"], kind: "committed_memory", origin: { turn: 4, sourceRefs: [playerRef] } }),
		intent: intent({ id: "memory-intent" }),
		domain: domain.id,
	});
	const replacement = await setup.runtime.begin({
		lease: lease(setup.clock, { capabilities: ["recall"] }),
		intent: intent({ id: "intent-5", turn: 5 }),
		domain: domain.id,
	});

	assert.equal(setup.runtime.result(foreground).status, "cancelled");
	assert.equal(setup.runtime.lease(foreground).signal.aborted, true);
	assert.equal(setup.runtime.lease(memory).signal.aborted, false);
	assert.equal(setup.runtime.snapshot(memory).status, "active");
	assert.equal(setup.runtime.lease(replacement).signal.aborted, false);
});

test("a completed operation key cannot execute twice", async () => {
	const domain = {
		id: "replay",
		version: "1",
		capabilities: ["look"],
		next: () => ({ kind: "operation", key: "same-operation", operation: "look", args: {}, capability: "look", basis: [] }),
	};
	const setup = runtime({ domain });
	const id = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: ["look"] }), intent: intent(), domain: domain.id });
	const result = await setup.runtime.submit(id, plan(["look"]));

	assert.equal(result.status, "unresolved");
	assert.equal(setup.operationPort.dispatches.length, 1);
	assert.match(result.remainingNeeds[0], /repeated a completed step/i);
});

test("owner cancellation after settlement preserves the actual receipt in the terminal record", async () => {
	const domain = {
		id: "settled-cancel",
		version: "1",
		capabilities: ["apply"],
		next(view) {
			if (!view.observations.length) return { kind: "operation", key: "apply-change", operation: "apply", args: {}, capability: "apply", basis: [] };
			return { kind: "finish", status: "complete", remainingNeeds: [] };
		},
	};
	let current = structuredClone(initialReadSet);
	const operationPort = operations(async (proposal, task) => {
		task.advance({
			operationId: proposal.id,
			receiptId: "receipt-settled",
			changes: [{ kind: "world", resource: "campaign", from: "world-r1", to: "world-r2" }],
		});
		current = task.context.readSet;
		task.cancel("owner_cancelled_after_settlement");
		return observation(proposal, {
			result: { changed: true },
			receipts: ["receipt-settled"],
			readSet: task.context.readSet,
			diagnostics: [{ code: "owner_cancelled_after_settlement" }],
		});
	}, () => current);
	const setup = runtime({ domain, operationPort });
	const id = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: ["apply"] }), intent: intent(), domain: domain.id });
	const result = await setup.runtime.submit(id, plan(["apply"]));
	const saved = await setup.store.load(id);

	assert.equal(result.status, "cancelled");
	assert.deepEqual(result.receipts, ["receipt-settled"]);
	assert.deepEqual(saved.checkpoint.settledReceipts, ["receipt-settled"]);
	assert.equal(saved.checkpoint.context.readSet[0].revision, "world-r2");
	assert.equal(saved.status, "closed");
});

test("a durable pending operation resumes only with owner authorization and reuses its exact identity", async () => {
	const store = new MemoryStore();
	const clock = new FakeClock();
	const domain = {
		id: "durable-pending",
		version: "1",
		capabilities: ["look"],
		next(view) {
			if (!view.observations.length) return { kind: "operation", key: "durable-read", operation: "look", args: {}, capability: "look", basis: [] };
			return { kind: "finish", status: "complete", remainingNeeds: [] };
		},
	};
	const firstOperations = operations(proposal => observation(proposal, {
		status: "pending",
		diagnostics: [{ code: "settlement_unknown" }],
	}));
	const first = runtime({ domain, store, clock, operationPort: firstOperations });
	const id = await first.runtime.begin({ lease: lease(clock, { capabilities: ["look"] }), intent: intent(), domain: domain.id });
	assert.equal((await first.runtime.submit(id, plan(["look"]))).status, "pending");
	const originalProposal = firstOperations.dispatches[0];

	const resumedOperations = operations(proposal => observation(proposal));
	const second = runtime({ domain, store, clock, operationPort: resumedOperations });
	await rejects("task_resume_not_authorized", () => second.runtime.resume(id, {
		authorize: () => false,
		currentReadSet: initialReadSet,
	}));
	const result = await second.runtime.resume(id, {
		authorize: record => record.intent.id === "intent-4" && record.status === "waiting",
		currentReadSet: initialReadSet,
	});

	assert.equal(result.status, "complete");
	assert.equal(resumedOperations.dispatches.length, 1);
	assert.deepEqual(resumedOperations.dispatches[0], originalProposal);
});

test("durably cancelled tasks never resume", async () => {
	const domain = { id: "revoked", version: "1", capabilities: [], next: () => ({ kind: "wait", remainingNeeds: [] }) };
	const setup = runtime({ domain });
	const id = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: [] }), intent: intent(), domain: domain.id });
	await setup.runtime.cancelForeground("player_replaced_intent");
	const fresh = runtime({ domain, store: setup.store, clock: setup.clock });

	await rejects("task_resume_not_authorized", () => fresh.runtime.resume(id, {
		authorize: () => true,
		currentReadSet: initialReadSet,
	}));
});

test("an expired absolute deadline cannot be renewed by restart", async () => {
	const domain = { id: "deadline", version: "1", capabilities: [], next: () => ({ kind: "wait", remainingNeeds: ["later"] }) };
	const clock = new FakeClock();
	const setup = runtime({ domain, clock });
	const id = await setup.runtime.begin({ lease: lease(clock, { capabilities: [], budget: budget(10) }), intent: intent(), domain: domain.id });
	assert.equal((await setup.runtime.submit(id, plan([]))).status, "pending");
	clock.advance(10);
	const fresh = runtime({ domain, store: setup.store, clock });

	await rejects("task_deadline", () => fresh.runtime.resume(id, {
		authorize: () => true,
		currentReadSet: initialReadSet,
	}));
});

test("a domain that never reaches a terminal condition is stopped by the step bound", async () => {
	const domain = {
		id: "bounded",
		version: "1",
		capabilities: [],
		next: view => question(`decision-${view.decisions.length}`, { stage: String(view.decisions.length) }),
	};
	const decision = decisionPort();
	const setup = runtime({ domain, decision, maxSteps: 3 });
	const id = await setup.runtime.begin({ lease: lease(setup.clock, { capabilities: [] }), intent: intent(), domain: domain.id });
	const result = await setup.runtime.submit(id, plan([]));

	assert.equal(result.status, "unresolved");
	assert.equal(decision.calls.length, 3);
	assert.deepEqual(result.remainingNeeds, ["The task reached its bounded step limit."]);
});

test("committed memory cannot mutate world state or deliver player-facing output", async t => {
	for (const blocked of [
		{ name: "world mutation", operation: "apply", capability: "apply" },
		{ name: "delivery", operation: "narrate", capability: "narrate" },
	]) await t.test(blocked.name, async () => {
		const domain = {
			id: `background-${blocked.operation}`,
			version: "1",
			capabilities: [blocked.capability],
			next: () => ({
				kind: "operation",
				key: blocked.name,
				operation: blocked.operation,
				args: {},
				capability: blocked.capability,
				basis: [],
			}),
		};
		const setup = runtime({ domain });
		const id = await setup.runtime.begin({
			lease: lease(setup.clock, {
				capabilities: [blocked.capability],
				kind: "committed_memory",
				origin: { turn: 4, sourceRefs: [playerRef] },
			}),
			intent: intent({ id: `intent-${blocked.operation}` }),
			domain: domain.id,
		});
		const result = await setup.runtime.submit(id, plan([blocked.capability]));

		assert.equal(result.status, "failed");
		assert.deepEqual(result.remainingNeeds, ["task_operation_out_of_scope"]);
		assert.equal(setup.operationPort.dispatches.length, 0);
		assert.equal(setup.runtime.snapshot(id).status, "closed");
	});
});
