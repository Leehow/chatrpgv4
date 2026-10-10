import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
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
	assert.equal(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length, 0);
	assert.equal(files.some(name => name.endsWith(".tmp")), false);
	const db = new DatabaseSync(join(root, 'tasks.sqlite'), {readOnly:true});
	const published = JSON.parse(String(db.prepare('SELECT payload FROM tasks WHERE id=?').get(id).payload));
	db.close();
	assert.equal(published.checkpoint.context.id, id);
	assert.equal(published.revision, initial.revision + 1);
	assert.equal((await store.load("missing")), undefined);
	assert.deepEqual((await store.list()).map(value => value.checkpoint.context.id), [id]);
});

test("task store rejects malformed JSON and structurally corrupt coordination records", async () => {
	const root = await directory();
	const store = createTaskStore(root);
	const { id } = await seededRecord(store);
	const db = new DatabaseSync(join(root, 'tasks.sqlite'));
	db.prepare('UPDATE tasks SET payload=? WHERE id=?').run('{not-json', id);
	await assert.rejects(() => store.load(id), error => error instanceof ContractError && error.code === "invalid_task_record");
	db.prepare('UPDATE tasks SET payload=? WHERE id=?').run(JSON.stringify({ version: 1, revision: 2, checkpoint: { context: { id: "foreign-task" } } }), id);
	db.close();
	await assert.rejects(() => store.load(id), error => error instanceof ContractError && error.code === "invalid_task_record");
});

test('legacy tasks import once with exact original bytes and never fall back after SQL loss', async()=>{
  const origin=createTaskStore(await directory()), {id,record}=await seededRecord(origin), root=await directory();
  const name=createHash('sha256').update(id).digest('hex')+'.json', bytes=JSON.stringify(record,null,2)+'\n';
  await writeFile(join(root,name),bytes);
  const store=createTaskStore(root);
  assert.deepEqual(await store.load(id),record);
  assert.equal(await readFile(join(root,name),'utf8'),bytes);
  const db=new DatabaseSync(join(root,'tasks.sqlite'),{readOnly:true}), imported=db.prepare('SELECT * FROM task_imports WHERE name=?').get(name);
  assert.equal(Buffer.from(imported.bytes).toString(),bytes);
  assert.equal(imported.sha256,createHash('sha256').update(bytes).digest('hex'));db.close();
  await writeFile(join(root,name),'{stale-json');
  assert.deepEqual(await store.load(id),record);
  await rm(join(root,'tasks.sqlite'));
  await assert.rejects(store.load(id),/authoritative SQLite database is missing/);
});

test('independent task writers keep one CAS winner and reject immutable changes without a partial write', async()=>{
  const root=await directory(), store=createTaskStore(root), {id,record}=await seededRecord(store);
  const module=pathToFileURL(join(import.meta.dirname,'../../runtime/jev/task-store.ts')).href;
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',
      'import {createTaskStore} from '+JSON.stringify(module)+';let raw="";for await(const part of process.stdin)raw+=part;'
      +'try{await createTaskStore(process.argv[1]).save(JSON.parse(raw));console.log("won");}'
      +'catch(error){console.log(error.code);if(error.code!=="stale_task_record")process.exitCode=1;}',root]);
    let output='';child.stdout.on('data',part=>output+=part);child.on('error',reject);
    child.on('close',code=>code===0?resolve(output.trim()):reject(Error('task child failed:'+output)));
    child.stdin.end(JSON.stringify({...record,revision:record.revision+1}));
  });
  const outcomes=await Promise.all(Array.from({length:4},run));
  assert.equal(outcomes.filter(value=>value==='won').length,1);
  assert.equal(outcomes.filter(value=>value==='stale_task_record').length,3);
  const current=await store.load(id);
  await assert.rejects(store.save({...current,revision:current.revision+1,checkpoint:{...current.checkpoint,
    context:{...current.checkpoint.context,goal:'Foreign replacement goal'}}}),error=>error.code==='task_record_conflict');
  assert.deepEqual(await store.load(id),current);
});

test('a killed SQLite writer cannot expose its uncommitted task revision',async t=>{
  const root=await directory(),store=createTaskStore(root),{id,record}=await seededRecord(store);
  const child=spawn(process.execPath,['--input-type=module','-e',
    'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync(process.argv[1]);'
    +'db.exec("BEGIN IMMEDIATE");db.prepare("UPDATE tasks SET revision=revision+1 WHERE id=?").run(process.argv[2]);'
    +'console.log("transaction-held");setInterval(()=>{},1000);',join(root,'tasks.sqlite'),id]);
  t.after(()=>child.kill('SIGKILL'));
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('writer exited before handshake')));});
  assert.deepEqual(await store.load(id),record);
  const exited=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await exited;
  assert.deepEqual(await store.load(id),record);
});

test('malformed legacy input cannot partially import a namespace',async()=>{
  const source=createTaskStore(await directory()),{id,record}=await seededRecord(source),root=await directory();
  const name=createHash('sha256').update(id).digest('hex')+'.json',original=JSON.stringify(record);
  await writeFile(join(root,name),original);await writeFile(join(root,'f'.repeat(64)+'.json'),'{invalid');
  await assert.rejects(createTaskStore(root).load(id),error=>error.code==='invalid_task_record');
  assert.equal(await readFile(join(root,name),'utf8'),original);
  assert.equal((await readdir(root)).includes('tasks.sqlite'),false);
});
