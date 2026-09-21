import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";
import { createTaskStore } from "../../runtime/jev/task-store.ts";

const temporary = [];
afterEach(async () => {
	await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function directory() {
	const path = await mkdtemp(join(tmpdir(), "jev-task-store-"));
	temporary.push(path);
	return path;
}

const scope = { owner: "store-owner", campaign: "store-campaign", worldline: "main", loop: 0, audience: "keeper" };
const readSet = [{ kind: "world", resource: "store-campaign", revision: "world-r1" },
  {kind: "source", resource: "store-campaign", revision: "source-r1"}];

async function seededRecord(store) {
	const domain = { id: "store-domain", version: "1", capabilities: [], next: () => ({ kind: "wait", remainingNeeds: [] }) };
	const runtime = new TaskRuntime({
		decision: { async decide() { throw new Error("store seed must not decide"); } },
		store,
		operations: {
			async validate() { return structuredClone(readSet); },
			async dispatch() { throw new Error("store seed must not dispatch"); },
		},
		domains: [domain],
	});
	const id = await runtime.begin({
		domain: domain.id,
		intent: {
			id: "store-intent",
			rawInput: {
				version: 1,
				scope,
				resource: "turn:1:player",
				revision: "input-r1",
				sourceType: "turn",
				selector: { kind: "utf16", start: 0, end: 4 },
			},
			limits: [],
			scope,
			turn: 1,
			inputRevision: "input-r1",
		},
		lease: {
			owner: "store-owner",
			goal: "Seed one authentic task record",
			scope,
			capabilities: [],
			budget: {
				deadlineAt: Date.now() + 60_000,
				remainingInputTokens: 10,
				remainingOutputTokens: 10,
				remainingCostUsd: 1,
				remainingActions: 10,
			},
			readSet,
		},
	});
	return { id, record: await store.load(id), runtime };
}

test('an owned source publication persists through the real task store without losing its replay binding', async () => {
  const store = createTaskStore(await directory()), {id, runtime} = await seededRecord(store);
  const task = runtime.lease(id), advance = {version:1, owner:'module-reading', token:'owned-source-token',
    taskId:id, rootId:id, operationId:'source-operation', callId:'t1-c1', campaign:scope.campaign,
    moduleId:'source-module', scope, turn:1, from:'source-r1', to:'source-r2',
    publicationId:'source-publication', jobId:'read-1', lease:'source-lease'};
  const {to, ...expected} = advance;
  task.advanceSource(advance, expected);
  await runtime.persistBudget(id);
  const saved = await store.load(id);
  assert.deepEqual(saved.checkpoint.sourceAdvances, [advance]);
  assert.deepEqual(saved.checkpoint.settledReceipts, []);
  assert.equal(saved.checkpoint.context.readSet.find(row => row.kind === 'source').revision, to);
  for (const corrupted of [
    [{...advance, rootId:'foreign-root'}], [{...advance, scope:{...scope, owner:'foreign-owner'}}], [advance, advance],
  ]) await assert.rejects(store.save({...structuredClone(saved), revision:saved.revision+1,
    checkpoint:{...structuredClone(saved.checkpoint),sourceAdvances:corrupted}}), error => error.code === 'invalid_task_record');
  // Cancellation must snapshot the lease's latest advance, even before a separate persistence callback.
  const raced = {...advance, token:'second-token', operationId:'second-operation', from:to, to:'source-r3', publicationId:'second-publication'};
  const {to: next, ...racedExpected} = raced;
  task.advanceSource(raced, racedExpected);
  await runtime.cancelForeground('owner_cancelled_after_source_publication');
  const cancelled = await store.load(id);
  assert.equal(cancelled.status, 'closed');
  assert.equal(cancelled.result.status, 'cancelled');
  assert.deepEqual(cancelled.checkpoint.sourceAdvances, [advance, raced]);
  assert.equal(cancelled.checkpoint.context.readSet.find(row => row.kind === 'source').revision, next);
  await assert.rejects(runtime.resume(id, {authorize:()=>true, currentReadSet:cancelled.checkpoint.context.readSet}), error => error.code === 'task_resume_not_authorized');
});

test("task snapshots publish atomically and remain readable during concurrent replacements", async () => {
	const root = await directory();
	const store = createTaskStore(root);
	const { id, record: initial } = await seededRecord(store);

	const observed = [];
	const writes = await Promise.allSettled([
		...Array.from({ length: 8 }, (_, index) => store.save({ ...structuredClone(initial), revision: initial.revision + 1, reason: `writer-${index}` })),
		...Array.from({ length: 32 }, async () => {
			const value = await store.load(id);
			observed.push(value);
		}),
	]);

	assert.equal(observed.length, 32);
	assert.ok(observed.every(value => value?.version === 1 && value.checkpoint.context.id === id));
	assert.ok(observed.every(value => [initial.revision, initial.revision + 1].includes(value.revision)));
	const writeResults = writes.slice(0, 8);
	assert.equal(writeResults.filter(result => result.status === "fulfilled").length, 1);
	assert.ok(writeResults.filter(result => result.status === "rejected")
		.every(result => result.reason instanceof ContractError && result.reason.code === "stale_task_record"));
	const files = await readdir(root);
	assert.equal(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length, 1);
	assert.equal(files.some(name => name.endsWith(".tmp")), false);
	const publishedFile = files.find(name => /^[a-f0-9]{64}\.json$/.test(name));
	const published = JSON.parse(await readFile(join(root, publishedFile), "utf8"));
	assert.equal(published.checkpoint.context.id, id);
	assert.equal(published.revision, initial.revision + 1);
	assert.equal((await store.load("missing")), undefined);
	assert.deepEqual((await store.list()).map(value => value.checkpoint.context.id), [id]);
});

test("task store rejects malformed JSON and structurally corrupt coordination records", async () => {
	const root = await directory();
	const store = createTaskStore(root);
	const { id } = await seededRecord(store);
	const file = (await readdir(root)).find(name => name.endsWith(".json"));

	await writeFile(join(root, file), "{not-json", "utf8");
	await assert.rejects(() => store.load(id), error => error instanceof ContractError && error.code === "invalid_task_record");

	await writeFile(join(root, file), JSON.stringify({ version: 1, revision: 2, checkpoint: { context: { id: "foreign-task" } } }), "utf8");
	await assert.rejects(() => store.load(id), error => error instanceof ContractError && error.code === "invalid_task_record");
});
