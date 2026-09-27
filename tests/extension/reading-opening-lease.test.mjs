/**
 * SL-99b (contract §140.2): an opening or guidance read that no stage lease owns is sized to the book like its stage.
 *
 * The Masks table (669 pages, lanes on grok-build/grok-4.5 low): the setup's opening reads ran with no stage lease, so
 * every reader child took the fixed lease -- 1,000,000 input tokens, 16 actions, 8,192 output tokens a call. An image
 * call reserves the reader's whole 500,000-token context, so that lease pays only about half its ceiling in real calls:
 * `read-5` round 2 made eleven image calls (536,114 input tokens) with no timeout at all, and the twelfth was refused
 * `budget_input_tokens` asking for 500,000. The index, skeleton and play reads had been sized for the same reason
 * (§20 addenda 3, 5, 6); opening and guidance were the two purposes left on the fixed lease.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {runtimeCapabilities} from '../../runtime/tasks.ts';
import {composeRuntimeContext} from '../../runtime/host.ts';
import {readingStageBudget} from '../../runtime/jev/reading-stage-budget.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const MASKS_PAGES = 669;
const WINDOW = 500_000;

async function temporary(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

/** One reading job run by the real `ReadingService.runJob`, with a runtime that records each reader request and fails it. */
async function runJob(t, purpose, providerBudget) {
  const home = await temporary(t, 'reading-opening-lease-');
  const cwd = join(home, 'work', 'read-5', 'attempt-1');
  await mkdir(cwd, {recursive: true});
  const row = {job_id: 'read-5', module_id: 'book-1', purpose, focus: 'campaign-beginning-elias-message', foreground: true, lease: 'lease-5',
    work_dir: cwd, source: {path: join(home, 'source.pdf'), page_count: MASKS_PAGES, file_sha256: 'source-sha'},
    index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [], play_language: 'en', occupations: []};
  const requests = [], records = [];
  const service = new ReadingService({home, model: () => ({id: 'grok-build/grok-4.5', vision: true, thinking: 'low', contextWindow: WINDOW}),
    progress() {}, record: entry => records.push(entry),
    runtime: {contentRoot: join(ROOT, 'content'),
      async sourceInfo() { return {labels: [], bookmarks: []}; },
      async runTask(task) { requests.push(task.request); return {ok: false, code: 1, timedOut: false, ms: 1, stderr: '', command: [], error: 'fixture'}; }},
    async call(method, params) { assert.equal(method, 'module.read.finish'); return {state: params.outcome}; }});
  t.after(() => service.close());
  await service.runJob(row, new AbortController().signal, undefined, providerBudget);
  return {requests, sized: records.filter(entry => entry.event === 'stage_budget')};
}

test('§140.2 an opening read with no stage lease: every reader child carries the book-sized opening lease, and the size is recorded', async t => {
  const {requests, sized} = await runJob(t, 'opening');
  const expected = readingStageBudget('opening', {pageCount: MASKS_PAGES, contextWindow: WINDOW});
  assert.equal(requests.length, 2, 'two author rounds');
  for (const request of requests) {
    assert.equal(request.providerBudget, undefined);
    assert.deepEqual(request.readingLease, expected);
  }
  // Masks: the whole book read once at the default per-page cost, far above the floor of eight whole-context reservations.
  assert.deepEqual({stage: expected.stage, input: expected.inputTokens, actions: expected.actions, call: expected.callOutputTokens},
    {stage: 'opening', input: 10_704_000, actions: 335, call: 32_768});
  assert.deepEqual(sized.map(entry => [entry.job_id, entry.purpose, entry.stage, entry.inputTokens]), [['read-5', 'opening', 'opening', 10_704_000]]);
});

test('§140.2 a guidance read with no stage lease is sized as the guidance stage', async t => {
  const {requests, sized} = await runJob(t, 'guidance');
  assert.ok(requests.length > 0);
  for (const request of requests) assert.deepEqual(request.readingLease, readingStageBudget('guidance', {pageCount: MASKS_PAGES, contextWindow: WINDOW}));
  assert.deepEqual(sized.map(entry => [entry.purpose, entry.stage, entry.inputTokens]), [['guidance', 'guidance', 5_352_000]]);
});

test('§140.2 an opening read the import worker owns keeps its stage lease and is not sized again', async t => {
  const stageLease = {signal: new AbortController().signal, deadlineAt: Date.now() + 1e6, reserve() { throw new Error('unused'); }};
  const {requests, sized} = await runJob(t, 'opening', stageLease);
  for (const request of requests) {
    assert.equal(request.providerBudget, stageLease);
    assert.equal(request.readingLease, undefined);
  }
  assert.deepEqual(sized, []);
});

/**
 * `read-5` round 2's own numbers through the real `runtime/tasks.ts` and the real child side of the provider channel:
 * eleven distinct image calls reporting 536,114 input tokens between them, then a twelfth.
 */
async function imageCalls(t, inputs) {
  const home = await temporary(t, 'reading-opening-calls-');
  const agent = join(home, 'agent'), cwd = join(home, 'work', 'read-5', 'attempt-1');
  await mkdir(agent, {recursive: true}); await mkdir(cwd, {recursive: true});
  const model = {provider: 'test', id: 'vision', api: 'openai-responses', maxTokens: 16_384, contextWindow: WINDOW,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
  const cli = join(home, 'pi-fixture.mjs'), marker = join(home, 'calls.jsonl');
  await writeFile(cli, `import {appendFileSync} from 'node:fs';
import readerContext from ${JSON.stringify(join(ROOT, 'extensions/module/reader-context.ts'))};
import {ExtensionRunner,createExtensionRuntime} from ${JSON.stringify(join(ROOT, 'build/node_modules/@earendil-works/pi-coding-agent/dist/index.js'))};
const handlers=new Map();readerContext({on:(name,fn)=>{const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);}}, {env:process.env});
const ctx={model:${JSON.stringify(model)},abort(){}};
const runner=new ExtensionRunner([{path:"opening-lease-conformance",handlers}],createExtensionRuntime(),process.cwd(),{},{});
runner.bindCore({}, {getModel:()=>ctx.model,abort:()=>ctx.abort()});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const inputs=${JSON.stringify(inputs)};
for(let n=0;n<inputs.length;n++){
 let payload={model:ctx.model.id,input:[{type:'input_image',image_url:'data:image/png;base64,page'+n}]};
 payload=await runner.emitBeforeProviderRequest(payload);
 appendFileSync(${JSON.stringify(marker)},JSON.stringify({max_output_tokens:payload.max_output_tokens})+'\\n');
 const message={role:'assistant',stopReason:'toolUse',usage:{input:inputs[n],output:600,cacheRead:0,cacheWrite:0,cost:{total:0}}};
 console.log(JSON.stringify({type:'message_end',message}));
 await wait(20);
 await runner.emitMessageEnd({type:'message_end',message});
}
process.disconnect();`);
  const base = composeRuntimeContext({owner: 'preparation', home}, {resourceRoot: ROOT, env: {...process.env, PI_COC_HOME: home, PI_CODING_AGENT_DIR: agent}});
  const context = {...base, entrypoints: {...base.entrypoints, pi: cli}};
  const dispatched = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const run = request => runtimeCapabilities.runTask(context, {kind: 'reader', request: {cwd, brief: 'Opening lease conformance only',
    model: 'test/vision', timeoutMs: 60_000, ...request}}, new AbortController().signal);
  return {run, dispatched};
}

// Eleven calls summing to read-5 round 2's 536,114 input tokens, then the twelfth it never got to make.
const READ_5_ROUND_2 = [...Array(10).fill(48_738), 48_734, 48_738];

test('§140.2 read-5 round 2: on the fixed lease the twelfth image call is refused exactly as on the table; on the opening lease it is made', async t => {
  const fixed = await imageCalls(t, READ_5_ROUND_2);
  const before = await fixed.run({});
  assert.deepEqual({reason: before.refusal?.reason, ceiling: before.refusal?.ceiling, used: before.refusal?.used, requested: before.refusal?.requested},
    {reason: 'budget_input_tokens', ceiling: 1_000_000, used: 536_114, requested: 500_000}, 'the Masks refusal, number for number');
  assert.equal((await fixed.dispatched()).length, 11);

  const sized = await imageCalls(t, READ_5_ROUND_2);
  const after = await sized.run({readingLease: readingStageBudget('opening', {pageCount: MASKS_PAGES, contextWindow: WINDOW})});
  assert.equal(after.refusal, undefined, JSON.stringify(after.refusal));
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal((await sized.dispatched()).length, 12);
  assert.equal(after.usage.inputTokens, 536_114 + 48_738);
  assert.deepEqual([...new Set((await sized.dispatched()).map(row => row.max_output_tokens))], [16_384], 'the lease\'s 32,768 per call, capped by the model, not 8,192');
});
