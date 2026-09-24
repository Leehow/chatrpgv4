/**
 * SL-36 (spec pi-native-single-loop, ruling "Reading never holds a turn" (b); contract §22.4.3): an in-turn source
 * consultation is asynchronous past a short allowance, memoised per campaign by the focus it names, one live reading per
 * focus, and a reviewer's malformed output is retried as a reviewer, never counted against the read.
 *
 * Evidence (long gate #3, `longgate3-haunting-1058`): five consultations on the Haunting's window cost 42-110 s each in
 * the foreground; `upper-floor-bedroom` (t11) and `upper floor bedroom` (t13) were both read fresh; t10's read was thrown
 * away with "the independent answer review must support each assigned field with a reason".
 *
 * - The kernel (real runtime, the Haunting's shipped window, no model): a checked answer on a focus answers a later
 *   question on the same focus -- by its handle or the name the book gives the place -- from the campaign memo with no read;
 *   `memo: false` reads; another campaign has no memo; a second question on a running focus attaches to it; the gate
 *   tells a malformed review from a refusal.
 * - The reading service (fake kernel, fake reader): the allowance resolves `pending` and the same reading settles later;
 *   a reviewer's malformed output is re-asked once with the schema error and the read survives; a gate-side slip costs
 *   a verify-only round, not a read; a well-formed refusal refuses.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {after, before, test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CONTENT = join(ROOT, 'content');
const sha = value => createHash('sha256').update(value).digest('hex');
let api, bundle;
before(async () => {
  await mkdir(join(ROOT, '.tmp'), {recursive: true});
  bundle = await mkdtemp(join(ROOT, '.tmp/source-answer-allowance-test-'));
  await build({stdin: {contents: [
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
  ].join('\n'), resolveDir: ROOT, sourcefile: 'source-answer-allowance-entry.ts'}, outfile: join(bundle, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
  api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);
});
after(async () => { if (bundle) await rm(bundle, {recursive: true, force: true}); });

async function kernel(t) {
  const home = await mkdtemp(join(tmpdir(), 'source-answer-allowance-'));
  const context = await api.createKernelContext({workspace: home, content: CONTENT, seed: 'source-answer-allowance', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context), call = (method, params = {}) => runtime.handlers[method](params);
  const refusal = async (method, params) => { try { await call(method, params); } catch (error) { return error; } assert.fail(`${method} was not refused`); };
  t.after(async () => { await runtime.close(); await context.git.close(); await rm(home, {recursive: true, force: true}); });
  await call('module.register', {module_id: 'the-haunting'});
  return {home, call, refusal};
}
const MID = 'the-haunting';
const queueOf = async (f, campaign) => JSON.parse(await readFile(join(f.home, '.coc/module-campaigns', campaign, 'modules', MID, 'deepen-queue.json'), 'utf8'));
const ANSWER = {status: 'answered', answer: 'The spare bedroom was Corbitt\'s; a bed can fly at whoever inspects the window.', source_refs: [{page: 9}], limitations: ''};
const supported = (draftBytes, pages = [9]) => ({checked: [{paths: ['/status', '/answer', '/source_refs', '/limitations'], verdict: 'supported',
  source_refs: pages.map(page => ({page})), reason: 'Page 9 prints the spare bedroom and the flying bed.'}], missing: [], draft_sha256: sha(draftBytes)});

/** Claim the campaign's queued consultation and write the reader's and reviewer's artifacts into its attempt. */
async function readAndReview(f, campaign, review = supported) {
  const job = await f.call('module.read.claim', {campaign, module_id: MID, owner: 'test'});
  assert.equal(job.purpose, 'answer');
  const bytes = Buffer.from(JSON.stringify(ANSWER));
  await writeFile(join(job.work_dir, 'draft.json'), bytes);
  await writeFile(join(job.work_dir, 'review.json'), JSON.stringify(typeof review === 'function' ? review(bytes) : review));
  await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: job.source.file_sha256, read_pages: [8, 9], full_pages: [], review_pages: [8, 9]}));
  return job;
}
const finishArgs = (job, campaign) => ({campaign, module_id: MID, job_id: job.job_id, lease: job.lease, outcome: 'completed',
  draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});

test('§22.4.3 a checked answer answers a later question on the same focus, by another spelling, from the campaign memo, and costs no read', async t => {
  const f = await kernel(t);
  const asked = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'upper-floor-bedroom',
    question: 'What happens upstairs in the bedrooms?', foreground: true});
  assert.equal(asked.state, 'queued');
  assert.ok(Array.isArray(asked.index), 'a reply that is still reading carries what the index holds on the focus');
  assert.ok(asked.index.some(row => row.name === 'upper-floor-bedroom' || /upper/i.test(row.name)), JSON.stringify(asked.index));
  const job = await readAndReview(f, 'c1');
  const done = await f.call('module.read.finish', finishArgs(job, 'c1'));
  assert.equal(done.source_answer.answer, ANSWER.answer);
  const before = (await queueOf(f, 'c1')).length;

  // t13 of the gate: the same scene spelled with spaces, another question.
  const again = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'upper floor bedroom',
    question: 'Are there hidden compartments in the floor or the window?', foreground: true});
  assert.equal(again.state, 'ready');
  assert.deepEqual(again.memo.map(entry => [entry.focus, entry.question, entry.source_answer.answer]),
    [['upper-floor-bedroom', 'What happens upstairs in the bedrooms?', ANSWER.answer]]);
  assert.equal((await queueOf(f, 'c1')).length, before, 'a memo hit queues no reading');
  // The Keeper asked to read past the memo: that is a reading.
  const fresh = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'upper floor bedroom',
    question: 'Are there hidden compartments in the floor or the window?', foreground: true, memo: false});
  assert.equal(fresh.state, 'queued');
  // Memoised for the campaign: another campaign reads its own.
  const other = await f.call('module.read.request', {campaign: 'c2', module_id: MID, purpose: 'answer', focus: 'upper-floor-bedroom',
    question: 'What happens upstairs in the bedrooms?', foreground: true});
  assert.equal(other.state, 'queued');
  assert.equal((await f.refusal('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'detail', focus: 'x', memo: true})).code, 'invalid_params',
    'memo is a consultation parameter');
});

test('§22.4.3 the place the book names answers for its handle: "The Corbitt House" is corbitt-house-ground', async t => {
  const f = await kernel(t);
  await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'corbitt-house-ground', question: 'What is on the ground floor?', foreground: true});
  const job = await readAndReview(f, 'c1');
  await f.call('module.read.finish', finishArgs(job, 'c1'));
  const again = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'The Corbitt House', question: 'Where is the basement door?'});
  assert.equal(again.state, 'ready');
  assert.equal(again.memo.length, 1);
});

test('§22.4.3 one live consultation per focus: a second question on a running focus attaches to it', async t => {
  const f = await kernel(t);
  const first = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'corbitt-house-ground', question: 'What rooms are there?', foreground: true});
  const job = await f.call('module.read.claim', {campaign: 'c1', module_id: MID, owner: 'test'});
  assert.equal(job.job_id, first.job_id);
  const second = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'The Corbitt House', question: 'Where is the basement door?', foreground: true});
  assert.equal(second.state, 'reading');
  assert.equal(second.attached, true);
  assert.equal(second.job_id, first.job_id);
  assert.equal((await queueOf(f, 'c1')).length, 1, 'no second reading of the same focus');
  // Once it settles, the attached question is judged afresh: the memo answers it.
  const bytes = Buffer.from(JSON.stringify(ANSWER));
  await writeFile(join(job.work_dir, 'draft.json'), bytes);
  await writeFile(join(job.work_dir, 'review.json'), JSON.stringify(supported(bytes)));
  await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: job.source.file_sha256, read_pages: [9], full_pages: [], review_pages: [9]}));
  await f.call('module.read.finish', finishArgs(job, 'c1'));
  const judged = await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'The Corbitt House', question: 'Where is the basement door?', foreground: true});
  assert.equal(judged.state, 'ready');
  assert.equal(judged.memo[0].question, 'What rooms are there?');
});

test('§22.4.3 the gate tells a reviewer\'s malformed output from its refusal', async t => {
  const f = await kernel(t);
  const cases = [
    ['a reason left out', bytes => ({...supported(bytes), checked: [{...supported(bytes).checked[0], reason: ''}]}), 'answer_review_malformed'],
    ['a verdict outside the protocol', bytes => ({...supported(bytes), checked: [{...supported(bytes).checked[0], verdict: 'ok'}]}), 'answer_review_malformed'],
    ['an assigned field left out', bytes => ({...supported(bytes), checked: [{...supported(bytes).checked[0], paths: ['/status', '/answer']}]}), 'answer_review_malformed'],
    ['a well-formed contradiction', bytes => ({...supported(bytes), checked: [{...supported(bytes).checked[0], paths: ['/answer', '/status', '/source_refs', '/limitations'], verdict: 'contradicted',
      reason: 'Page 9 says the unspoiled produce was eaten.'}]}), 'answer_review_refused'],
    ['well-formed missing support', bytes => ({...supported(bytes), missing: ['the basement door']}), 'answer_review_refused'],
  ];
  for (const [index, [label, review, reason]] of cases.entries()) {
    await f.call('module.read.request', {campaign: 'c1', module_id: MID, purpose: 'answer', focus: 'corbitt-house-ground', question: `Case ${index}?`, memo: false});
    const job = await readAndReview(f, 'c1', review);
    const error = await f.refusal('module.read.finish', finishArgs(job, 'c1'));
    assert.equal(error.details?.reason, reason, `${label}: ${error.message}`);
    if (reason === 'answer_review_refused' && label.includes('contradiction')) assert.equal(error.details.path, '/answer');
    await f.call('module.read.finish', {campaign: 'c1', module_id: MID, job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: error.message});
  }
});

// ---------------------------------------------------------------------------------------------------
// The reading service: the allowance, and the review that must never cost the read.
// ---------------------------------------------------------------------------------------------------

test('§22.4.3 past its allowance a consultation resolves pending with the index rows, the job goes to the background, and the same reading settles later', async t => {
  let landed = false;
  const unwaited = [], requests = [];
  const answer = {status: 'answered', answer: 'Three bound diaries.', source_refs: [{source_id: 'pdf:the-haunting', pdf_index: 7}], limitations: '', authority: 'source-consultation', prepared: false, supported: true};
  const service = new ReadingService({home: ROOT, model: () => ({id: 'fixture/vision', vision: true}), progress() {}, record() {}, async call(method, params) {
    if (method === 'module.read.request') {
      requests.push(params);
      return landed ? {state: 'ready', generation: 2, source_answer: answer}
        : {state: 'reading', job_id: 'read-1', generation: 2, index: [{name: 'corbitt-house-ground', pages: [[6, 9]]}]};
    }
    if (method === 'module.read.claim') return {job_id: null};
    if (method === 'module.read.unwait') { unwaited.push(params.job_id); return {foreground: false}; }
    throw new Error(method);
  }});
  t.after(() => service.close());
  const began = Date.now();
  const pending = await service.ensure(MID, {purpose: 'answer', focus: 'corbitt-house-ground', question: 'Where are the diaries?', foreground: true}, undefined, {allowanceMs: 60});
  assert.ok(Date.now() - began < 5_000, 'the allowance, not the foreground wait');
  assert.equal(pending.state, 'pending');
  assert.equal(pending.job_id, 'read-1');
  assert.deepEqual(pending.index, [{name: 'corbitt-house-ground', pages: [[6, 9]]}]);
  assert.deepEqual(pending.read, {purpose: 'answer', focus: 'corbitt-house-ground', question: 'Where are the diaries?'});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(unwaited, ['read-1'], 'the waiter left: the job gives up the foreground lease and keeps running');
  landed = true;
  const settled = await pending.settled;
  assert.deepEqual(settled.source_answer, answer, 'the same reading, followed to its end');
  assert.equal(requests.at(-1).foreground, false, 'polled in the background after the allowance');
});

/** A fake reader runtime for one answer job: `reviews` are the reviewer attempts' outputs, in order. */
function answerRuntime({cache, reviews, draft}) {
  const tasks = [];
  return {tasks, runtime: {contentRoot: join(ROOT, 'content'), async check() { return {ok: true, required_view_pages: [2]}; },
    async runTask({request}) {
      tasks.push(request);
      const call = `view-${tasks.length}`, page = 2, path = join(cache, 'page-2.png');
      if (request.prompt.phase === 'read') {
        await writeFile(join(request.cwd, 'draft.json'), JSON.stringify(draft) + '\n');
        await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: 'source-sha', path, page, box: [0, 0, 1, 1]}) + '\n');
      } else {
        const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
        const review = reviews.shift() ?? 'supported';
        const base = {paths: task.required_review, verdict: 'supported', source_refs: [{page}], reason: 'The original page supports the answer.'};
        const shape = review === 'no_reason' ? {checked: [{...base, reason: undefined}], missing: []}
          : review === 'contradicted' ? {checked: [{...base, verdict: 'contradicted', reason: 'Page 2 says otherwise.'}], missing: []}
          : {checked: [base], missing: []};
        await writeFile(join(request.cwd, 'review.json'), JSON.stringify(shape) + '\n');
      }
      request.onEvent({type: 'tool_execution_end', toolCallId: call, isError: false, result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: [{path, page}]}}});
      await writeFile(request.eventLog + '.images.jsonl', JSON.stringify({included: [call]}) + '\n');
      return {ok: true, code: 0, timedOut: false, ms: 2, stderr: '', command: []};
    }}};
}
async function answerJob(t, {reviews = [], finish}) {
  const home = await mkdtemp(join(tmpdir(), 'coc-answer-review-')); t.after(() => rm(home, {recursive: true, force: true}));
  const cwd = join(home, 'work', 'attempt-1'), cache = join(home, '.coc', 'modules', 'book', 'cache', 'pages');
  await mkdir(cwd, {recursive: true}); await mkdir(cache, {recursive: true});
  const draft = {status: 'answered', answer: 'The page prints the hours.', source_refs: [{page: 2}], limitations: ''};
  const {tasks, runtime} = answerRuntime({cache, reviews, draft});
  const finished = [], rows = [];
  const service = new ReadingService({home, runtime, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); },
    async call(method, params) { assert.equal(method, 'module.read.finish'); finished.push(params); return finish ? finish(params, finished.length) : {state: 'ready'}; }});
  t.after(() => service.close());
  await service.runJob({job_id: 'read-1', module_id: 'book', purpose: 'answer', focus: 'Menu', question: 'What hours are printed?', foreground: true, lease: 'lease-1', work_dir: cwd,
    source: {path: join(home, '.coc', 'modules', 'book', 'source.pdf'), page_count: 3, file_sha256: 'source-sha'}, index: [], known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: []},
    new AbortController().signal, 'campaign-a');
  const phases = tasks.map(task => task.prompt.phase);
  return {cwd, tasks, phases, finished, rows};
}

test('§22.4.3 a reviewer whose output fails the protocol is re-asked once with the schema error, and the read survives', async t => {
  const {cwd, phases, finished, rows} = await answerJob(t, {reviews: ['no_reason', 'supported']});
  assert.deepEqual(phases, ['read', 'verify', 'verify'], 'one read; the reviewer asked twice');
  const retry = rows.filter(row => row.event === 'review_retry');
  assert.deepEqual(retry.map(row => row.cause), ['schema']);
  const second = (await readdir(join(cwd, 'verify-1', 'unit-1'))).sort()[1];
  const failure = JSON.parse(await readFile(join(cwd, 'verify-1', 'unit-1', second, 'failure.json'), 'utf8'));
  assert.match(failure.error, /schema error/, 'the second reviewer reads the schema error');
  // The service always offers the attempt's outcome once more at the end (a completed job replays there).
  assert.deepEqual(finished.filter(row => row.outcome === 'completed').length, 1, 'published once, from the first read');
  assert.equal(finished[0].outcome, 'completed');
});

test('§22.4.3 a review the gate finds malformed costs a verify-only round, never the read', async t => {
  const {phases, finished} = await answerJob(t, {finish: (params, n) => {
    if (params.outcome === 'completed' && n === 1) throw new KernelError({code: 'invalid_params', message: 'the independent answer review is malformed: answer review omitted assigned fields',
      details: {reason: 'answer_review_malformed'}});
    return {state: 'ready'};
  }});
  assert.deepEqual(finished.filter(row => row.outcome === 'completed').length, 2, 'the same read is offered to the gate again');
  assert.equal(phases.filter(phase => phase === 'read').length, 1, 'the second round re-reviews the same read; it does not read again');
});

test('§22.4.3 a well-formed refusal refuses the read: the repair round reads again, then the job fails with the typed refusal', async t => {
  const {phases, finished} = await answerJob(t, {reviews: ['supported', 'supported'], finish: (params) => {
    if (params.outcome === 'completed') throw new KernelError({code: 'invalid_params', message: 'the independent answer review found /answer contradicted: page 2 says otherwise',
      details: {reason: 'answer_review_refused', path: '/answer', rule: 'contradicted'}});
    return {state: params.outcome};
  }});
  assert.deepEqual(phases, ['read', 'verify', 'read', 'verify'], 'a refusal is repaired against the pages, once');
  const last = finished.at(-1);
  assert.equal(last.outcome, 'failed');
  assert.equal(last.refusal.reason, 'answer_review_refused');
  assert.equal(last.refusal.path, '/answer');
});
