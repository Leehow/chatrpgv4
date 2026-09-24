/**
 * SL-35 (contract §20 addendum 2): a provider refusal is typed. Each case runs the real reader host
 * (`runReader`) against a scripted child that installs the real child side of the provider channel
 * (`reader-context.ts`), so the refusal travels the path the Masks opening's did.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {createTaskProviderBudget, providerRefusal, providerRefusalText} from '../../runtime/jev/provider-budget.ts';
import {ContractError} from '../../runtime/jev/contracts.ts';
import {runReader} from '../../extensions/module/reader.ts';
import {composeRuntimeContext} from '../../runtime/host.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const model = {provider: 'test', id: 'bounded', api: 'openai-responses', maxTokens: 100, contextWindow: 10000,
  cost: {input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1, tiers: [{input: 3, output: 4, cacheRead: 1, cacheWrite: 5}]}};
const usage = {input: 10, output: 5, cacheRead: 2, cacheWrite: 3, cost: {total: 0.00004}};
const STALL = 'Provider stream timed out: no response event for 60000 ms';
const lease = (overrides = {}) => new TaskLease({owner: 'test-root', goal: 'Type what refused a nested call', scope: {owner: 'test', audience: 'keeper'},
  readSet: [], capabilities: [], budget: {deadlineAt: Date.now() + 20000, remainingInputTokens: 20000, remainingOutputTokens: 1000,
    remainingCostUsd: 1, remainingActions: 10, ...overrides}});

/** A child that makes the scripted calls: `text`/`image` payloads, each ending `ok` (with usage) or `error`. */
async function child(t, steps) {
  const home = await mkdtemp(join(tmpdir(), 'provider-refusal-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const cli = join(home, 'pi-fixture.mjs'), marker = join(home, 'calls.jsonl');
  await writeFile(cli, `import {appendFileSync} from 'node:fs';
import readerContext from ${JSON.stringify(join(ROOT, 'extensions/module/reader-context.ts'))};
import {ExtensionRunner,createExtensionRuntime} from ${JSON.stringify(join(ROOT, 'build/node_modules/@earendil-works/pi-coding-agent/dist/index.js'))};
const handlers=new Map();readerContext({on:(name,fn)=>{const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);}}, {env:process.env});
const ctx={model:${JSON.stringify(model)},abort(){}};
const runner=new ExtensionRunner([{path:"refusal-conformance",handlers}],createExtensionRuntime(),process.cwd(),{},{});
runner.bindCore({}, {getModel:()=>ctx.model,abort:()=>ctx.abort()});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
for(const step of ${JSON.stringify(steps)}){
 if(step.raw){process.send(step.raw);await wait(200);continue;}
 let payload={model:ctx.model.id,input:step.call==='image'?[{type:'input_image',image_url:'data:image/png;base64,small'}]:'hello'};
 payload=await runner.emitBeforeProviderRequest(payload);
 appendFileSync(${JSON.stringify(marker)},JSON.stringify({call:step.call,max_output_tokens:payload.max_output_tokens})+'\\n');
 const message=step.end==='error'?{role:'assistant',stopReason:'error',errorMessage:step.message}:{role:'assistant',stopReason:'toolUse',usage:step.usage??${JSON.stringify(usage)}};
 console.log(JSON.stringify({type:'message_end',message}));
 await wait(100);
 await runner.emitMessageEnd({type:'message_end',message});
}
process.disconnect();`);
  const base = composeRuntimeContext({owner: 'preparation', home}, {resourceRoot: ROOT, env: {...process.env, PI_COC_HOME: home}});
  const context = {...base, entrypoints: {...base.entrypoints, pi: cli}};
  const calls = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const run = (budget, requestModel = 'test/bounded') => runReader({cwd: home, brief: 'Refusal conformance only', model: requestModel,
    providerBudget: budget, timeoutMs: 10000}, context);
  return {run, calls};
}

test('the Masks shape: an image call that ends in a stream timeout is charged its reservation, and its retry is refused on input tokens', async t => {
  const f = await child(t, [{call: 'text', end: 'ok'}, {call: 'image', end: 'ok'}, {call: 'image', end: 'error', message: STALL}, {call: 'image', end: 'ok'}]);
  const root = lease(); t.after(() => root.close());
  const outcome = await f.run(createTaskProviderBudget(root));
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.refusal, {reason: 'budget_input_tokens', code: 'task_budget_exhausted', dimension: 'inputTokens', ceiling: 20000,
    used: 15 + 15 + 10000, held: 0, requested: 10000, after_provider_error: STALL, unknown_usage_calls: 1});
  // The child's echo of the refusal ("ContractError: provider_budget_refused") does not replace the cause.
  assert.equal(outcome.error, providerRefusalText(outcome.refusal));
  assert.match(outcome.error, /^provider_budget_refused: budget_input_tokens \(the call asked for 10000 inputTokens; the lease's ceiling is 20000, 10030 used/);
  assert.equal((await f.calls()).length, 3, 'the refused retry was never dispatched');
});

test('each lease dimension names itself', async t => {
  const cases = [
    [{remainingActions: 1}, [{call: 'text', end: 'ok'}, {call: 'text', end: 'ok'}], {reason: 'budget_actions', dimension: 'actions', ceiling: 1, used: 1, requested: 1}],
    [{remainingOutputTokens: 50}, [{call: 'text', end: 'ok'}], {reason: 'budget_output_tokens', dimension: 'outputTokens', ceiling: 50, used: 0, requested: 100}],
    [{remainingCostUsd: 0.0001}, [{call: 'text', end: 'ok'}], {reason: 'budget_usd', dimension: 'costUsd', ceiling: 0.0001, used: 0}],
  ];
  for (const [overrides, steps, expected] of cases) {
    const f = await child(t, steps), root = lease(overrides);
    const outcome = await f.run(createTaskProviderBudget(root));
    root.close();
    assert.equal(outcome.ok, false, JSON.stringify(expected));
    for (const [key, value] of Object.entries(expected)) assert.equal(outcome.refusal[key], value, `${expected.reason}.${key}`);
    assert.equal(outcome.refusal.code, 'task_budget_exhausted');
    assert.match(outcome.error, new RegExp(`^provider_budget_refused: ${expected.reason} `));
  }
});

test('an output overrun names the bound it broke; a settle for an ungranted call and a changed model are not budget refusals', async t => {
  const overrun = await child(t, [{call: 'text', end: 'ok', usage: {...usage, output: 101}}]), root = lease();
  t.after(() => root.close());
  const over = await overrun.run(createTaskProviderBudget(root));
  assert.equal(over.ok, false);
  assert.equal(over.refusal.reason, 'budget_output_tokens');
  assert.equal(over.refusal.code, 'task_budget_overrun');
  assert.deepEqual([over.refusal.overrun, over.refusal.requested, over.refusal.reserved], [true, 101, 100]);
  assert.equal(root.signal.aborted, true, 'an overrun still cancels the lease');
  assert.equal(root.signal.reason.refusal.dimension, 'outputTokens', 'and the lease says why it was cancelled');

  const unknown = await child(t, [{raw: {type: 'coc-provider-settle', id: 999}}]), second = lease();
  t.after(() => second.close());
  const settled = await unknown.run(createTaskProviderBudget(second));
  assert.equal(settled.refusal.reason, 'unknown_reservation');

  const changed = await child(t, [{call: 'text', end: 'ok'}]), third = lease();
  t.after(() => third.close());
  const other = await changed.run(createTaskProviderBudget(third), 'test/other');
  assert.equal(other.refusal.reason, 'provider_protocol');
  assert.equal(other.refusal.code, 'provider_model_changed');
});

test('a round that ends on a provider error without any refusal is a transport failure', async t => {
  const f = await child(t, [{call: 'text', end: 'error', message: 'Connection error.'}]), root = lease();
  t.after(() => root.close());
  const outcome = await f.run(createTaskProviderBudget(root));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.refusal, undefined);
  assert.equal(outcome.providerError, 'Connection error.');
});

test('the lease\'s per-call output bound reaches the child; without one the default applies', async t => {
  const bounded = await child(t, [{call: 'text', end: 'ok'}]), root = lease();
  t.after(() => root.close());
  assert.equal((await bounded.run(createTaskProviderBudget(root, {callOutputTokens: 40}))).ok, true);
  assert.deepEqual((await bounded.calls()).map(row => row.max_output_tokens), [40]);
  const plain = await child(t, [{call: 'text', end: 'ok'}]), second = lease();
  t.after(() => second.close());
  assert.equal((await plain.run(createTaskProviderBudget(second))).ok, true);
  assert.deepEqual((await plain.calls()).map(row => row.max_output_tokens), [100]);
});

test('the classifier: deadline, channel failures and child protocol codes', () => {
  assert.equal(providerRefusal(new ContractError('task_deadline')).reason, 'budget_deadline');
  assert.equal(providerRefusal(new Error('transport: write EPIPE')).reason, 'transport');
  assert.equal(providerRefusal(new Error('ContractError: provider_budget_channel_closed')).reason, 'transport');
  const child = providerRefusal(new Error('Error: ContractError: provider_output_bound_unsupported'), {unknownCalls: 2, afterProviderError: STALL});
  assert.deepEqual(child, {reason: 'provider_protocol', code: 'provider_output_bound_unsupported', unknown_usage_calls: 2, after_provider_error: STALL});
});
