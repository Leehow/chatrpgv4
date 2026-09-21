import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ContractError, TASK_OUTCOMES } from "../../runtime/jev/contracts.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { advanceReadSet, compareReadSet } from "../../runtime/jev/read-set.ts";
import { awaitOrYield, mapTaskOutcome } from "../../runtime/jev/task-outcome.ts";

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

const scope = { owner: "campaign-owner", campaign: "campaign", worldline: "main", loop: 1, audience: "keeper" };
const readSet = [
	{ kind: "world", resource: "campaign", revision: "w1" },
	{ kind: "source", resource: "page-1", revision: "s1" },
];
const budget = deadlineAt => ({
	deadlineAt,
	remainingInputTokens: 10,
	remainingOutputTokens: 10,
	remainingCostUsd: 10,
	remainingActions: 10,
});

function lease(clock, overrides = {}) {
	return new TaskLease({
		owner: "host",
		goal: "bounded task",
		scope,
		capabilities: ["recall", "lookup"],
		budget: budget(100),
		readSet,
		clock,
		...overrides,
	});
}

function error(code, action) {
	assert.throws(action, caught => caught instanceof ContractError && caught.code === code);
}

test("deadline is absolute for root and child and no activity renews it", () => {
	const clock = new FakeClock();
	const root = lease(clock);
	const child = root.child({ owner: "reader", goal: "child", capabilities: ["recall"], budget: budget(1_000) });
	assert.equal(child.context.budget.deadlineAt, 100);
	root.nextStep();
	child.nextStep();
	clock.advance(99);
	root.assertActive();
	child.assertActive();
	clock.advance(1);
	assert.equal(root.signal.aborted, true);
	assert.equal(child.signal.aborted, true);
	error("task_deadline", () => root.assertActive());
	error("task_deadline", () => child.assertActive());
});

test("child cancellation does not cancel its parent but parent cancellation propagates", () => {
	const clock = new FakeClock();
	const root = lease(clock);
	const child = root.child({ owner: "reader", goal: "child", capabilities: ["recall"], budget: budget(50) });
	child.cancel("child_stopped");
	assert.equal(child.signal.aborted, true);
	assert.equal(root.signal.aborted, false);
	root.assertActive();
	const second = root.child({ owner: "reader", goal: "second", capabilities: ["recall"], budget: budget(50) });
	root.cancel("root_stopped");
	error("root_stopped", () => root.assertActive());
	error("root_stopped", () => second.assertActive());
});

test("hierarchical reservations reserve once, refund known remainder, and charge unknown usage conservatively", () => {
	const clock = new FakeClock();
	const root = lease(clock);
	const child = root.child({
		owner: "reader",
		goal: "child",
		capabilities: ["recall"],
		budget: { ...budget(90), remainingInputTokens: 7, remainingActions: 7 },
	});
	const first = child.reserve({ inputTokens: 5, outputTokens: 2, costUsd: 1, actions: 2 });
	assert.equal(root.context.budget.remainingInputTokens, 5);
	assert.equal(child.context.budget.remainingInputTokens, 2);
	first.settle({ inputTokens: 3, outputTokens: 1, costUsd: 0.25, actions: 1 });
	assert.equal(root.context.budget.remainingInputTokens, 7);
	assert.equal(child.context.budget.remainingInputTokens, 4);
	error("reservation_already_settled", () => first.release());

	const unknown = child.reserve({ inputTokens: 2, outputTokens: 2, costUsd: 2, actions: 2 });
	unknown.settle();
	assert.equal(root.context.budget.remainingInputTokens, 5, "unknown actual usage spends the full reservation");
	assert.equal(child.context.budget.remainingInputTokens, 2);
	const refund = child.reserve({ inputTokens: 2, outputTokens: 1, costUsd: 1, actions: 1 });
	refund.release();
	assert.equal(root.context.budget.remainingInputTokens, 5);
	assert.equal(child.context.budget.remainingInputTokens, 2);
});

test("actual provider overrun records honest debt and cancels the root", () => {
	const clock = new FakeClock();
	const root = lease(clock);
	const child = root.child({ owner: "reader", goal: "child", capabilities: ["recall"], budget: budget(80) });
	const reservation = child.reserve({ inputTokens: 2, outputTokens: 1, costUsd: 1, actions: 1 });
	error("task_budget_overrun", () => reservation.settle({ inputTokens: 3, outputTokens: 1, costUsd: 1, actions: 1 }));
	assert.equal(root.signal.aborted, true);
	assert.equal(child.signal.aborted, true);
	assert.equal(root.context.budget.remainingInputTokens, 7);
	error("task_budget_overrun", () => root.assertActive());
});

test("committed memory is a separate rooted task with mandatory original-turn refs and survives foreground close", () => {
	const clock = new FakeClock();
	const foreground = lease(clock);
	error("memory_job_origin_required", () => lease(clock, { kind: "committed_memory" }));
	const origin = {
		turn: 4,
		sourceRefs: [{
			version: 1,
			scope,
			resource: "turn-4",
			revision: "r4",
			sourceType: "turn",
			selector: { kind: "field", path: ["player_text"] },
		}],
	};
	const memory = lease(clock, { kind: "committed_memory", origin, capabilities: ["recall"] });
	assert.equal(memory.context.kind, "committed_memory");
	assert.equal(memory.context.rootId, memory.context.id);
	foreground.close();
	assert.equal(memory.signal.aborted, false);
	memory.nextStep();
	const anotherForeground = lease(clock);
	error("memory_job_requires_separate_root", () => anotherForeground.child({
		owner: "memory",
		goal: "illegal child",
		capabilities: ["recall"],
		budget: budget(50),
		kind: "committed_memory",
	}));
});

test("read-set comparison ignores unrelated additions and receipt advancement is atomic and replay-safe", () => {
	assert.deepEqual(compareReadSet(readSet, [...readSet, { kind: "memory", resource: "new", revision: "m1" }]), {
		status: "current",
		changed: [],
	});
	const stale = compareReadSet(readSet, [{ kind: "world", resource: "campaign", revision: "w2" }]);
	assert.equal(stale.status, "stale");
	assert.deepEqual(stale.changed.map(row => ({ resource: row.resource, currentRevision: row.currentRevision })), [
		{ resource: "campaign", currentRevision: "w2" },
		{ resource: "page-1", currentRevision: undefined },
	]);
	const clock = new FakeClock();
	const task = lease(clock);
	task.advance({
		operationId: "operation-1",
		receiptId: "receipt-1",
		changes: [{ kind: "world", resource: "campaign", from: "w1", to: "w2" }],
	});
	assert.equal(task.context.readSet.find(row => row.resource === "campaign").revision, "w2");
	error("receipt_advance_replayed", () => task.advance({
		operationId: "operation-1", receiptId: "receipt-1",
		changes: [{ kind: "world", resource: "campaign", from: "w2", to: "w3" }],
	}));
	error("stale_receipt_advance", () => task.advance({
		operationId: "operation-2", receiptId: "receipt-2",
		changes: [{ kind: "world", resource: "campaign", from: "w1", to: "w3" }],
	}));
	assert.equal(task.context.readSet.find(row => row.resource === "campaign").revision, "w2");
	error("stale_receipt_advance", () => advanceReadSet(readSet, {
		operationId: "bad", receiptId: "bad", changes: [
			{ kind: "world", resource: "campaign", from: "w1", to: "w2" },
			{ kind: "source", resource: "page-1", from: "wrong", to: "s2" },
		],
	}));
});

test("a child receipt advances its ancestors while an old sibling remains stale", () => {
	const clock = new FakeClock();
	const root = lease(clock);
	const performer = root.child({ owner: "performer", goal: "perform", capabilities: ["recall"], budget: budget(80) });
	const sibling = root.child({ owner: "sibling", goal: "observe", capabilities: ["recall"], budget: budget(80) });
	performer.advance({
		operationId: "operation-child",
		receiptId: "receipt-child",
		changes: [{ kind: "world", resource: "campaign", from: "w1", to: "w2" }],
	});
	assert.equal(root.context.readSet.find(row => row.resource === "campaign").revision, "w2");
	assert.equal(performer.context.readSet.find(row => row.resource === "campaign").revision, "w2");
	assert.equal(sibling.context.readSet.find(row => row.resource === "campaign").revision, "w1");
	assert.equal(sibling.revalidate(root.context.readSet).status, "stale");
});

test("yielding an awaiter leaves the operation owned and outcomes require an exhaustive mapping", async () => {
	let resolveOperation;
	const operation = new Promise(resolve => { resolveOperation = resolve; });
	const waiter = new AbortController();
	const result = awaitOrYield(operation, waiter.signal);
	waiter.abort();
	assert.deepEqual(await result, { status: "yielded" });
	resolveOperation("completed later");
	assert.equal(await operation, "completed later");

	const taskResult = {
		taskId: "task",
		status: "partial",
		scope,
		refs: [],
		receipts: [],
		coverage: { used: [], omitted: [], unknown: [] },
		remainingNeeds: ["more"],
	};
	const handlers = Object.fromEntries(TASK_OUTCOMES.map(status => [status, result => status + ":" + result.taskId]));
	assert.equal(mapTaskOutcome(taskResult, handlers), "partial:task");
	const incomplete = { ...handlers };
	delete incomplete.cancelled;
	error("incomplete_outcome_mapping", () => mapTaskOutcome(taskResult, incomplete));
});

test("checkpoint resume requires durable owner authorization and restores validated identity without deadline renewal", () => {
	const clock = new FakeClock();
	const task = lease(clock);
	assert.equal(task.nextStep().rootStep, 1);
	assert.equal(task.nextStep().rootStep, 2);
	task.advance({
		operationId: "operation-a",
		receiptId: "receipt-a",
		changes: [{ kind: "world", resource: "campaign", from: "w1", to: "w2" }],
	});
	const checkpoint = task.checkpoint("deciding", ["receipt-b"], "remaining goal");
	assert.equal(checkpoint.version, 1);
	assert.equal(checkpoint.context.id, task.context.id);
	checkpoint.context.goal = "mutated checkpoint";
	checkpoint.settledReceipts.push("receipt-b");
	assert.equal(task.context.goal, "bounded task");
	assert.deepEqual(task.checkpoint("deciding", [], "remaining goal").settledReceipts, ["receipt-a"]);
	const freshCheckpoint = task.checkpoint("deciding", ["receipt-b"], "remaining goal");
	error("checkpoint_resume_not_authorized", () => TaskLease.resume(freshCheckpoint, {
		currentReadSet: task.context.readSet,
		clock,
	}));
	error("checkpoint_resume_not_authorized", () => TaskLease.resume(freshCheckpoint, {
		currentReadSet: task.context.readSet,
		clock,
		authorizeResume: () => false,
	}));
	const resumed = TaskLease.resume(freshCheckpoint, {
		currentReadSet: task.context.readSet,
		clock,
		authorizeResume: restored => restored.context.id === task.context.id,
	});
	assert.equal(resumed.context.id, task.context.id);
	assert.equal(resumed.context.rootId, task.context.rootId);
	assert.equal(resumed.context.step, 2);
	assert.equal(resumed.context.rootStep, 2);
	assert.equal(resumed.nextStep().rootStep, 3);
	error("receipt_advance_replayed", () => resumed.advance({
		operationId: "operation-again",
		receiptId: "receipt-a",
		changes: [{ kind: "world", resource: "campaign", from: "w2", to: "w3" }],
	}));
	error("stale_task_checkpoint", () => TaskLease.resume(task.checkpoint("deciding", [], "remaining goal"), {
		currentReadSet: readSet,
		clock,
		authorizeResume: () => true,
	}));
	clock.advance(100);
	error("task_deadline", () => resumed.assertActive());
});

test("checkpoint creation and resume reject cancelled, malformed, inherited, and revoked state", () => {
	const clock = new FakeClock();
	const task = lease(clock);
	const checkpoint = task.checkpoint("planning", [], "goal");
	task.cancel("durably_revoked");
	error("durably_revoked", () => task.checkpoint("planning", [], "goal"));
	let revocationRecorded = true;
	error("checkpoint_resume_not_authorized", () => TaskLease.resume(checkpoint, {
		currentReadSet: checkpoint.context.readSet,
		clock: new FakeClock(),
		authorizeResume: () => !revocationRecorded,
	}));
	revocationRecorded = false;
	const restarted = TaskLease.resume(checkpoint, {
		currentReadSet: checkpoint.context.readSet,
		clock: new FakeClock(),
		authorizeResume: () => !revocationRecorded,
	});
	assert.equal(restarted.signal.aborted, false, "restart uses a fresh controller after durable owner approval");

	for (const bad of [
		{ ...checkpoint, phase: "" },
		{ ...checkpoint, remainingGoal: 7 },
		{ ...checkpoint, settledReceipts: [""] },
		{ ...checkpoint, context: { ...checkpoint.context, rootStep: -1 } },
		Object.assign(Object.create({ phase: "inherited" }), checkpoint),
	]) error("invalid_task_checkpoint", () => TaskLease.resume(bad, {
		currentReadSet: checkpoint.context.readSet,
		clock: new FakeClock(),
		authorizeResume: () => true,
	}));

	const inheritedBudget = Object.create(budget(100));
	error("invalid_task_deadline", () => lease(new FakeClock(), { budget: inheritedBudget }));
	error("invalid_read_set", () => lease(new FakeClock(), { readSet: Object.create(readSet) }));
	const fakeOrigin = {
		turn: 1,
		sourceRefs: [{ version: 1, scope: { owner: "campaign-owner", audience: "keeper" }, resource: "turn", revision: "r1", sourceType: "turn", selector: { kind: "field", path: ["text"] } }],
	};
	error("memory_job_origin_scope_mismatch", () => lease(new FakeClock(), {
		kind: "committed_memory",
		origin: fakeOrigin,
		capabilities: ["recall"],
	}));
});
