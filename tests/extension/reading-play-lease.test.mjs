/**
 * SL-41 (contract §20 addendum 3): a read raised during play pays from a lease sized to the book, opened per reader child
 * by `runtime/tasks.ts` from the size the reading service derived, instead of the fixed 1,000,000-token lease.
 *
 * Evidence (SL-29A on batch 4, 血色公路, 111 pages): the `last-chance-bar` detail read failed four rounds with
 * `budget_input_tokens`, ceiling 1,000,000, about half of it used and the next image call asking for the reader's whole
 * 500,000-token context. The Masks shape here: image calls that end in a provider error are charged their whole
 * reservation, so the fixed lease refuses the third and the book-sized one does not.
 *
 * Runs the real `runtimeCapabilities.runTask` and the real reader host against a scripted child that installs the real
 * child side of the provider channel.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {runtimeCapabilities} from '../../runtime/tasks.ts';
import {composeRuntimeContext} from '../../runtime/host.ts';
import {readingStageBudget} from '../../runtime/jev/reading-stage-budget.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const model = {provider: 'test', id: 'vision', api: 'openai-responses', maxTokens: 16_384, contextWindow: 500_000,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
const STALL = 'Provider stream timed out: no response event for 60000 ms';

async function child(t, calls) {
  const home = await mkdtemp(join(tmpdir(), 'reading-play-lease-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const agent = join(home, 'agent'), cwd = join(home, 'work', 'read-6', 'attempt-1');
  await mkdir(agent, {recursive: true}); await mkdir(cwd, {recursive: true});
  const cli = join(home, 'pi-fixture.mjs'), marker = join(home, 'calls.jsonl');
  await writeFile(cli, `import {appendFileSync} from 'node:fs';
import readerContext from ${JSON.stringify(join(ROOT, 'extensions/module/reader-context.ts'))};
import {ExtensionRunner,createExtensionRuntime} from ${JSON.stringify(join(ROOT, 'build/node_modules/@earendil-works/pi-coding-agent/dist/index.js'))};
const handlers=new Map();readerContext({on:(name,fn)=>{const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);}}, {env:process.env});
const ctx={model:${JSON.stringify(model)},abort(){}};
const runner=new ExtensionRunner([{path:"play-lease-conformance",handlers}],createExtensionRuntime(),process.cwd(),{},{});
runner.bindCore({}, {getModel:()=>ctx.model,abort:()=>ctx.abort()});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
for(let n=0;n<${calls};n++){
 let payload={model:ctx.model.id,input:[{type:'input_image',image_url:'data:image/png;base64,small'}]};
 payload=await runner.emitBeforeProviderRequest(payload);
 appendFileSync(${JSON.stringify(marker)},JSON.stringify({max_output_tokens:payload.max_output_tokens})+'\\n');
 const message={role:'assistant',stopReason:'error',errorMessage:${JSON.stringify(STALL)}};
 console.log(JSON.stringify({type:'message_end',message}));
 await wait(50);
 await runner.emitMessageEnd({type:'message_end',message});
}
process.disconnect();`);
  const base = composeRuntimeContext({owner: 'preparation', home}, {resourceRoot: ROOT, env: {...process.env, PI_COC_HOME: home, PI_CODING_AGENT_DIR: agent}});
  const context = {...base, entrypoints: {...base.entrypoints, pi: cli}};
  const dispatched = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const run = request => runtimeCapabilities.runTask(context, {kind: 'reader', request: {cwd, brief: 'Play lease conformance only', model: 'test/vision', timeoutMs: 10_000, ...request}},
    new AbortController().signal);
  return {run, dispatched};
}

test('§20 addendum 3 without a size the child keeps the fixed lease: the third whole-context image call is refused', async t => {
  const f = await child(t, 3);
  const outcome = await f.run({});
  assert.equal(outcome.refusal?.reason, 'budget_input_tokens');
  assert.equal(outcome.refusal.ceiling, 1_000_000);
  assert.equal((await f.dispatched()).length, 2);
  assert.deepEqual((await f.dispatched()).map(row => row.max_output_tokens), [8_192, 8_192], 'and the default per-call output bound');
});

test('§20 addendum 3 a play read\'s child opens the book-sized lease its reading service derived: all three calls are dispatched', async t => {
  const f = await child(t, 3);
  const size = readingStageBudget('detail', {pageCount: 111});
  const outcome = await f.run({readingLease: size});
  assert.equal(outcome.refusal, undefined, JSON.stringify(outcome.refusal));
  assert.equal((await f.dispatched()).length, 3);
  assert.equal(outcome.usage.unknownCalls, 3, 'each call was charged its whole reservation, and the lease paid for it');
  assert.deepEqual((await f.dispatched()).map(row => row.max_output_tokens), [16_384, 16_384, 16_384], 'the per-call bound is the lease\'s 32,768, capped by the model');
});

test('§20 addendum 3 the sized lease still refuses, typed, at its own ceiling', async t => {
  const f = await child(t, 9);
  const outcome = await f.run({readingLease: readingStageBudget('answer', {pageCount: 111})});
  assert.equal(outcome.refusal?.reason, 'budget_input_tokens');
  assert.equal(outcome.refusal.ceiling, 4_000_000);
  assert.equal((await f.dispatched()).length, 8, 'eight whole-context reservations, as the floor promises');
});
