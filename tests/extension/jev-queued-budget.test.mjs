import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";

const scope = { owner: "queued-budget", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const readSet = [{ kind: "world", resource: "campaign", revision: "w1" }];
const spend = inputTokens => ({ inputTokens, outputTokens: inputTokens, costUsd: inputTokens, actions: inputTokens });
const budget = amount => ({ deadlineAt: Date.now() + 10_000, remainingInputTokens: amount,
	remainingOutputTokens: amount, remainingCostUsd: amount, remainingActions: amount });

function root(amount = 10) {
	return new TaskLease({ owner: "root", goal: "share one bounded budget", scope, capabilities: ["decision"],
		readSet, budget: budget(amount) });
}

function child(parent, owner) {
	return parent.child({ owner, goal: `${owner} decision`, capabilities: ["decision"], budget: budget(10) });
}

test("a sibling waits on ancestor-held budget and acquires only after the peer settles actual usage", async () => {
	const owner = root(), first = child(owner, "first"), second = child(owner, "second");
	const held = first.reserve(spend(8));
	let acquired = false;
	const pending = second.reserveQueued(spend(5)).then(value => { acquired = true; return value; });
	await Promise.resolve();
	assert.equal(acquired, false);
	assert.equal(owner.context.budget.remainingInputTokens, 2);
	assert.equal(second.context.budget.remainingInputTokens, 10, "waiting does not debit the sibling before authority is available");

	held.settle(spend(2));
	const reservation = await pending;
	assert.equal(acquired, true);
	assert.equal(owner.context.budget.remainingInputTokens, 3);
	assert.equal(second.context.budget.remainingInputTokens, 5);
	reservation.settle(spend(1));
	assert.equal(owner.context.budget.remainingInputTokens, 7, "the root is charged only both siblings' actual usage");
	assert.equal(first.context.budget.remainingInputTokens, 8);
	assert.equal(second.context.budget.remainingInputTokens, 9);
	owner.close();
});

test("terminal ancestor insufficiency rejects immediately and a cancelled waiter leaves no held-budget leak", async () => {
	const owner = root(), first = child(owner, "first"), impossible = child(owner, "impossible"), waiting = child(owner, "waiting");
	const held = first.reserve(spend(8));
	await assert.rejects(impossible.reserveQueued(spend(11)), error => error instanceof ContractError && error.code === "task_budget_exhausted");
	assert.equal(owner.context.budget.remainingInputTokens, 2);
	assert.equal(impossible.context.budget.remainingInputTokens, 10);

	const before = waiting.context.budget;
	const pending = waiting.reserveQueued(spend(5));
	await Promise.resolve();
	waiting.cancel("queued_cancelled");
	await assert.rejects(pending, error => error instanceof ContractError && error.code === "queued_cancelled");
	assert.deepEqual(waiting.context.budget, before, "a cancelled queued reservation consumes nothing at the child");
	assert.equal(owner.context.budget.remainingInputTokens, 2, "a cancelled waiter consumes nothing at its ancestor");
	held.release();
	assert.equal(owner.context.budget.remainingInputTokens, 10, "the live peer can still wake accounting after the waiter detaches");
	owner.close();
});
