import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";
import { createTaskStore } from "../../runtime/jev/task-store.ts";

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
const readSet = [
	{ kind: "world", resource: "campaign", revision: "world-r1" },
	{ kind: "source", resource: "turn-4", revision: "turn-r1" },
];

function lease(clock, overrides = {}) {
	return {
		owner: "recovery-test",
		goal: "Complete the bounded recovery task",
		scope,
		capabilities: ["look", "recall", "apply"],
		budget: {
			deadlineAt: 10_000,
			remainingInputTokens: 10_000,
			remainingOutputTokens: 10_000,
			remainingCostUsd: 10,
			remainingActions: 20,
		},
		readSet,
		clock,
		...overrides,
	};
}

function intent(id = "intent-recovery") {
	return {
		id,
		rawInput: playerRef,
		goal: "Complete the bounded recovery task",
		limits: [],
		scope,
		turn: 4,
		inputRevision: "turn-r1",
	};
}

function plan(capabilities) {
	return {
		goal: "Complete the bounded recovery task",
		subgoals: [],
		constraints: [],
		evidenceRequired: [],
		completion: ["The task reaches an explicit terminal result."],
		capabilities,
		replanWhen: [],
		returnWhen: [],
	};
}

function decisionPort() {
	return { async decide() { throw new Error("these recovery cases must not call the decision adapter"); } };
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

function operationPort({ validate, dispatch, reconcile } = {}) {
	return {
		async validate(task, taskIntent) {
			return validate ? validate(task, taskIntent) : structuredClone(readSet);
		},
		async dispatch(proposal, task, journal) {
			return dispatch ? dispatch(proposal, task, journal) : observation(proposal);
		},
		...(reconcile ? { async reconcile(proposal, identity, context) { return reconcile(proposal, identity, context); } } : {}),
	};
}

function makeRuntime({ domain, store, clock, operations }) {
	return new TaskRuntime({
		decision: decisionPort(),
		store,
		operations: operations ?? operationPort(),
		domains: [domain],
		clock,
	});
}

async function rejectsCode(code, action) {
	await assert.rejects(action, error => error instanceof ContractError && error.code === code);
}

async function productionStore(t) {
	const directory = await mkdtemp(join(tmpdir(), "jev-task-recovery-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return createTaskStore(directory);
}

test("a stale store writer cannot replace a newer durable cancellation", async t => {
	const store = await productionStore(t);
	const clock = new FakeClock();
	const domain = { id: "stale-save", version: "1", capabilities: [], next: () => ({ kind: "wait", remainingNeeds: [] }) };
	const runtime = makeRuntime({ domain, store, clock });
	const id = await runtime.begin({ lease: lease(clock, { capabilities: [] }), intent: intent(), domain: domain.id });
	const stale = await store.load(id);

	await runtime.cancelForeground("new_player_input");
	const cancelled = await store.load(id);
	assert.equal(cancelled.status, "closed");
	assert.ok(cancelled.revision > stale.revision);

	await rejectsCode("stale_task_record", () => store.save(stale));
	const retained = await store.load(id);
	assert.equal(retained.status, "closed");
	assert.equal(retained.revision, cancelled.revision);
});

test("cancelled settlement uncertainty reconciles only the retained identity without ordinary dispatch", async t => {
	const store = await productionStore(t);
	const clock = new FakeClock();
	let domainCalls = 0;
	let announceDispatch;
	let returnUnknown;
	const dispatchStarted = new Promise(resolve => { announceDispatch = resolve; });
	const delayedUnknown = new Promise(resolve => { returnUnknown = resolve; });
	const domain = {
		id: "cancelled-reconciliation",
		version: "1",
		capabilities: ["apply"],
		next() {
			domainCalls++;
			return { kind: "operation", key: "mutate-once", operation: "apply", args: { action: "change" }, capability: "apply", basis: [] };
		},
	};
	let originalProposal;
	const firstOperations = operationPort({ dispatch: async (proposal, _task, journal) => {
		originalProposal = structuredClone(proposal);
		await journal.save({
			operationId: proposal.id,
			taskId: proposal.taskId,
			signature: "prepared-signature",
			callId: "t1-c1",
			request: { call_id: "t1-c1", campaign: "campaign", action: "change" },
		});
		announceDispatch();
		await delayedUnknown;
		return observation(proposal, { status: "cancelled", diagnostics: [{ code: "settlement_unknown" }] });
	} });
	const first = makeRuntime({ domain, store, clock, operations: firstOperations });
	const id = await first.begin({ lease: lease(clock, { capabilities: ["apply"] }), intent: intent(), domain: domain.id });
	const running = first.submit(id, plan(["apply"]));
	await dispatchStarted;
	await first.cancelForeground("player_cancelled");
	returnUnknown();
	assert.equal((await running).status, "cancelled");
	const cancelled = await store.load(id);
	assert.equal(cancelled.status, "closed");
	assert.equal(cancelled.result.status, "cancelled");
	assert.equal(cancelled.pending.proposal.id, originalProposal.id);
	assert.equal(cancelled.identities[originalProposal.id].callId, "t1-c1");

	const unavailable = makeRuntime({ domain, store, clock, operations: operationPort() });
	const beforeUnavailable = await store.load(id);
	await assert.rejects(async () => unavailable.reconcileCancelled(id, { authorize: () => true }));
	assert.deepEqual(await store.load(id), beforeUnavailable, "an unavailable recovery port cannot alter the cancelled record");

	let ordinaryDispatches = 0;
	let reconciliation;
	const recoveryOperations = operationPort({
		dispatch: async proposal => { ordinaryDispatches++; return observation(proposal); },
		reconcile: async (proposal, identity, context) => {
			reconciliation = { proposal: structuredClone(proposal), identity: structuredClone(identity), context: structuredClone(context) };
			return { status: "settled", packet: observation(proposal, { receipts: ["receipt-original-call"] }) };
		},
	});
	const recovery = makeRuntime({ domain, store, clock, operations: recoveryOperations });
	const result = await recovery.reconcileCancelled(id, {
		authorize: record => record.status === "closed" && record.result?.status === "cancelled",
	});
	assert.equal(result.status, "cancelled", "reconciliation cannot renew cancelled gameplay authority");
	assert.deepEqual(result.receipts, ["receipt-original-call"]);
	assert.equal(ordinaryDispatches, 0);
	assert.equal(domainCalls, 1, "reconciliation never calls domain.next");
	assert.deepEqual(reconciliation.proposal, originalProposal);
	assert.equal(reconciliation.identity.callId, "t1-c1");
	assert.deepEqual(reconciliation.identity.request, { call_id: "t1-c1", campaign: "campaign", action: "change" });
	assert.equal(reconciliation.context.id, id);
	const reconciled = await store.load(id);
	assert.equal(reconciled.status, "closed");
	assert.equal(reconciled.result.status, "cancelled");
	assert.equal(reconciled.pending, undefined);
	assert.deepEqual(reconciled.result.receipts, ["receipt-original-call"]);
	assert.deepEqual(reconciled.remainingNeeds, []);
	assert.deepEqual(reconciled.result.remainingNeeds, []);
	assert.deepEqual(reconciled.result.coverage.unknown, []);
});

test("production store seals an absent cancelled call without dispatch or identity loss", async t => {
	const store = await productionStore(t);
	const clock = new FakeClock();
	let ordinaryDispatches = 0;
	const domain = {
		id: "absent-reconciliation",
		version: "1",
		capabilities: ["apply"],
		next: () => ({ kind: "operation", key: "attempt-once", operation: "apply", args: { action: "change" }, capability: "apply", basis: [] }),
	};
	const firstOperations = operationPort({ dispatch: async (proposal, _task, journal) => {
		ordinaryDispatches++;
		await journal.save({
			operationId: proposal.id,
			taskId: proposal.taskId,
			signature: "absent-signature",
			callId: "t2-c1",
			request: { call_id: "t2-c1", campaign: "campaign", action: "change" },
		});
		return observation(proposal, { status: "pending", diagnostics: [{ code: "settlement_unknown" }] });
	} });
	const first = makeRuntime({ domain, store, clock, operations: firstOperations });
	const id = await first.begin({ lease: lease(clock, { capabilities: ["apply"] }), intent: intent("absent-intent"), domain: domain.id });
	assert.equal((await first.submit(id, plan(["apply"]))).status, "pending");
	await first.cancelForeground("player_cancelled");
	const cancelled = await store.load(id);
	const proposal = structuredClone(cancelled.pending.proposal);
	const identity = structuredClone(cancelled.identities[proposal.id]);

	let recovered;
	const recovery = makeRuntime({ domain, store, clock, operations: operationPort({
		dispatch: async () => { ordinaryDispatches++; throw new Error("ordinary dispatch is forbidden during reconciliation"); },
		reconcile: async (candidate, retained, context) => {
			recovered = { proposal: structuredClone(candidate), identity: structuredClone(retained), context: structuredClone(context) };
			return { status: "absent" };
		},
	}) });
	const result = await recovery.reconcileCancelled(id, { authorize: () => true });
	assert.equal(result.status, "cancelled");
	assert.deepEqual(result.remainingNeeds, []);
	assert.deepEqual(result.coverage.unknown, []);
	assert.equal(ordinaryDispatches, 1, "only the original operation dispatch occurred");
	assert.deepEqual(recovered.proposal, proposal);
	assert.deepEqual(recovered.identity, identity);
	assert.equal(recovered.context.id, id);

	const sealed = await store.load(id);
	assert.equal(sealed.status, "closed");
	assert.equal(sealed.pending, undefined);
	assert.deepEqual(sealed.remainingNeeds, []);
	assert.deepEqual(sealed.result.remainingNeeds, []);
	assert.deepEqual(sealed.result.coverage.unknown, []);
	assert.deepEqual(sealed.identities[proposal.id], identity, "absence proof retains the original prepared identity as audit evidence");
	assert.equal(sealed.observations.at(-1).proposal.id, proposal.id);
	assert.equal(sealed.observations.at(-1).packet.status, "cancelled");
	assert.deepEqual(sealed.observations.at(-1).packet.result, { code: "reconciled_absent" });
});

test("a late committed-memory read cannot close the backlog after shutdown", async () => {
	const store = new MemoryStore();
	const clock = new FakeClock();
	let announceDispatch;
	let returnRead;
	const dispatchStarted = new Promise(resolve => { announceDispatch = resolve; });
	const delayedRead = new Promise(resolve => { returnRead = resolve; });
	const seen = [];
	const domain = {
		id: "memory-shutdown",
		version: "1",
		capabilities: ["recall"],
		next(view) {
			if (!view.observations.length) return { kind: "operation", key: "read-memory", operation: "recall", args: {}, capability: "recall", basis: [] };
			return { kind: "finish", status: "complete", remainingNeeds: [] };
		},
	};
	const firstOperations = operationPort({ dispatch: async proposal => {
		seen.push(structuredClone(proposal));
		announceDispatch();
		await delayedRead;
		return observation(proposal);
	} });
	const first = makeRuntime({ domain, store, clock, operations: firstOperations });
	const id = await first.begin({
		lease: lease(clock, { capabilities: ["recall"], kind: "committed_memory", origin: { turn: 4, sourceRefs: [playerRef] } }),
		intent: intent("memory-intent"),
		domain: domain.id,
	});
	const running = first.submit(id, plan(["recall"]));
	await dispatchStarted;
	await first.shutdown();
	assert.equal((await store.load(id)).status, "waiting");

	returnRead();
	await running;
	const retained = await store.load(id);
	assert.equal(retained.status, "waiting");

	const resumedSeen = [];
	const resumed = makeRuntime({ domain, store, clock, operations: operationPort({ dispatch: proposal => {
		resumedSeen.push(structuredClone(proposal));
		return observation(proposal);
	} }) });
	const result = await resumed.resume(id, { authorize: () => true, currentReadSet: readSet });
	assert.equal(result.status, "complete");
	if (resumedSeen.length) assert.equal(resumedSeen[0].id, seen[0].id, "a retained pending read reuses its exact proposal identity");
});

test("failed resume validation leaves the current foreground active", async () => {
	const store = new MemoryStore();
	const clock = new FakeClock();
	const domain = { id: "resume-validation", version: "1", capabilities: [], next: () => ({ kind: "wait", remainingNeeds: ["wait"] }) };
	const original = makeRuntime({ domain, store, clock });
	const resumableId = await original.begin({ lease: lease(clock, { capabilities: [] }), intent: intent("old-intent"), domain: domain.id });
	assert.equal((await original.submit(resumableId, plan([]))).status, "pending");

	const validatingOperations = operationPort({ validate: (_task, taskIntent) => {
		if (taskIntent.id === "old-intent") throw new ContractError("current_intent_rejected");
		return structuredClone(readSet);
	} });
	const current = makeRuntime({ domain, store, clock, operations: validatingOperations });
	const currentId = await current.begin({ lease: lease(clock, { capabilities: [] }), intent: intent("current-intent"), domain: domain.id });

	await rejectsCode("current_intent_rejected", () => current.resume(resumableId, { authorize: () => true, currentReadSet: readSet }));
	assert.equal(current.snapshot(currentId).status, "active");
	assert.equal(current.lease(currentId).signal.aborted, false);
});

test("child begin inherits parent scope, budget ceilings, and cancellation", async () => {
	const store = new MemoryStore();
	const clock = new FakeClock();
	const domain = { id: "child-inheritance", version: "1", capabilities: ["look", "apply"], next: () => ({ kind: "wait", remainingNeeds: [] }) };
	const runtime = makeRuntime({ domain, store, clock });
	const parentId = await runtime.begin({
		lease: lease(clock, { capabilities: ["look", "apply"], budget: {
			deadlineAt: 5_000,
			remainingInputTokens: 100,
			remainingOutputTokens: 80,
			remainingCostUsd: 2,
			remainingActions: 6,
		} }),
		intent: intent("shared-intent"),
		domain: domain.id,
	});
	const childId = await runtime.begin({
		parentId,
		lease: lease(clock, { owner: "child-owner", goal: "Perform one bounded child read", capabilities: ["look"], budget: {
			deadlineAt: 9_000,
			remainingInputTokens: 500,
			remainingOutputTokens: 500,
			remainingCostUsd: 5,
			remainingActions: 20,
		} }),
		intent: intent("shared-intent"),
		domain: domain.id,
	});
	const parentBefore = runtime.lease(parentId).context;
	const childBefore = runtime.lease(childId).context;
	assert.equal(childBefore.kind, "child");
	assert.equal(childBefore.parentId, parentId);
	assert.equal(childBefore.rootId, parentBefore.rootId);
	assert.deepEqual(childBefore.scope, parentBefore.scope);
	assert.deepEqual(childBefore.capabilities, ["look"]);
	assert.equal(childBefore.budget.deadlineAt, 5_000);
	assert.equal(childBefore.budget.remainingInputTokens, 100);
	assert.equal(childBefore.budget.remainingOutputTokens, 80);
	assert.equal(childBefore.budget.remainingCostUsd, 2);
	assert.equal(childBefore.budget.remainingActions, 6);

	const reservation = runtime.lease(childId).reserve({ inputTokens: 7, outputTokens: 5, costUsd: 0.25, actions: 1 });
	assert.equal(runtime.lease(childId).context.budget.remainingInputTokens, 93);
	assert.equal(runtime.lease(parentId).context.budget.remainingInputTokens, 93);
	reservation.release();
	assert.equal(runtime.lease(parentId).context.budget.remainingInputTokens, 100);

	await runtime.cancelForeground("parent_cancelled");
	assert.equal(runtime.lease(parentId).signal.aborted, true);
	assert.equal(runtime.lease(childId).signal.aborted, true);
});

test("a root capability omitted from the accepted plan cannot execute", async () => {
	const store = new MemoryStore();
	const clock = new FakeClock();
	let dispatches = 0;
	const domain = {
		id: "plan-capability",
		version: "1",
		capabilities: ["look", "apply"],
		next: () => ({ kind: "operation", key: "unrequested-mutation", operation: "apply", args: {}, capability: "apply", basis: [] }),
	};
	const runtime = makeRuntime({ domain, store, clock, operations: operationPort({ dispatch: proposal => {
		dispatches++;
		return observation(proposal);
	} }) });
	const id = await runtime.begin({ lease: lease(clock, { capabilities: ["look", "apply"] }), intent: intent(), domain: domain.id });
	const result = await runtime.submit(id, plan(["look"]));
	assert.equal(result.status, "failed");
	assert.deepEqual(result.remainingNeeds, ["task_operation_out_of_scope"]);
	assert.equal(dispatches, 0);
});
