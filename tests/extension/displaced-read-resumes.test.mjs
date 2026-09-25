/**
 * SL-54 (contract §22.4.6.1): a displaced read resumes under the context current at resume time instead of failing on the
 * one it was parked under.
 *
 * Evidence (SL-29A on batch 6, 血色公路, `sl29ab6-xuese-6001`): the blocking consultation `read-8` displaced the background
 * consultation `read-7` (t15's question on the town's sheriff and missing-person reports). While `read-7` was parked,
 * `mather-general-store`'s detail read published generation 4. The waiter polled with its pinned generation 3 and was
 * refused `source_context_changed`, the Keeper's pending row turned `unavailable`, and the next claim failed the job
 * ("source context changed; request a fresh consultation"). The consultation was lost for having waited.
 *
 * - The emitted kernel over RPC, on a synthetic bound book with an index and an opening: a displaced consultation whose
 *   generation advanced is claimed again under the current generation from its attempt, its stale-pinned waiter follows it,
 *   it completes, and its answer is found at the current generation; a displaced detail read likewise; a displaced job whose
 *   focus's material was published meanwhile is marked `reread`.
 * - The host's resume: `reread` reads again from the retained draft; without it only the review runs.
 * - The reading service over the emitted kernel: the pending row of a consultation displaced by a blocking detail read that
 *   then publishes stays pending, and lands when the consultation completes.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {PendingAnswers} from '../../extensions/kernel/source-answers.ts';
import {ANSWER, answerDraft, answerRuntime, detailDraft, fail, finish, harbor, observed, publishDetail, ROOT, until, write} from './harbor-book.mjs';

test('§22.4.6.1 a displaced consultation whose generation advanced resumes under the current one, its waiter follows it, and it lands', async t => {
  const f = await harbor(t, 'answer');
  const ask = {purpose: 'answer', focus: 'the harbour master', question: 'Who keeps the register of ships?'};
  const queued = await f.call('module.read.request', {...ask, foreground: false});
  const pinned = queued.generation;
  const first = await f.claim();
  assert.equal(first.job_id, queued.job_id);
  assert.equal(first.context_generation, pinned);
  assert.deepEqual(await f.call('module.read.yield', {job_id: first.job_id, lease: first.lease}), {job_id: first.job_id, state: 'queued', displaced: 1});
  // While it is parked, another focus's detail read publishes: the generation moves on.
  await publishDetail(f, 'Tower', 'scene-tower', 2);
  const now = (await f.module()).generation;
  assert.equal(now, pinned + 1);
  // The waiter still pins the generation it started under; it follows its own parked job instead of being refused.
  const parked = await f.call('module.read.request', {...ask, context_generation: pinned});
  assert.deepEqual([parked.state, parked.job_id, parked.generation], ['queued', first.job_id, now]);
  const resumed = await f.claim();
  assert.equal(resumed.job_id, first.job_id, 'the same job, claimed again: not failed for having waited');
  assert.equal(resumed.context_generation, now, 'bound to the generation current at the claim');
  assert.equal(resumed.base_generation, now);
  assert.equal(resumed.resume_from, first.work_dir, 'from its retained attempt');
  assert.equal(resumed.attempts, 2);
  assert.deepEqual(resumed.resumed, {from_generation: pinned, generation: now, reread: false}, 'the Tower is not its focus: nothing to re-read');
  const reading = await f.call('module.read.request', {...ask, context_generation: pinned});
  assert.deepEqual([reading.state, reading.job_id], ['reading', first.job_id]);
  await answerDraft(resumed);
  const landed = await finish(f, resumed);
  assert.equal(landed.state, 'ready');
  assert.equal(landed.source_answer.answer, ANSWER.answer);
  // The pinned waiter gets its own consultation's answer; a fresh ask at the current generation is an exact hit.
  const followed = await f.call('module.read.request', {...ask, context_generation: pinned});
  assert.deepEqual([followed.state, followed.job_id, followed.source_answer?.answer], ['ready', first.job_id, ANSWER.answer]);
  const exact = await f.call('module.read.request', ask);
  assert.deepEqual([exact.state, exact.source_answer?.answer, exact.memo], ['ready', ANSWER.answer, undefined], 'kept under the generation it was checked at');
  const memo = await f.call('module.read.request', {...ask, question: 'Where is the register kept?'});
  assert.deepEqual(memo.memo?.map(entry => entry.question), [ask.question]);
  const snapshot = await f.call('module.source.materials.snapshot');
  assert.deepEqual([snapshot.checked_answers.map(answer => answer.question), snapshot.checked_answers_invalid], [[ask.question], 0]);
  const queue = await f.queue();
  assert.equal(queue.filter(job => job.purpose === 'answer').length, 1, 'no replacement consultation was queued');
});

test('§22.4.6.1 a displaced detail read resumes after another focus published, and publishes', async t => {
  const f = await harbor(t, 'detail');
  await f.call('module.read.request', {purpose: 'detail', focus: 'Lena', question: 'What does Lena carry?', foreground: false});
  const first = await f.claim();
  assert.equal(first.focus, 'Lena');
  await f.call('module.read.yield', {job_id: first.job_id, lease: first.lease});
  await publishDetail(f, 'Tower', 'scene-tower', 2);
  const now = (await f.module()).generation;
  const resumed = await f.claim();
  assert.deepEqual([resumed.job_id, resumed.resume_from, resumed.base_generation], [first.job_id, first.work_dir, now]);
  assert.deepEqual(resumed.resumed, {from_generation: now - 1, generation: now, reread: false});
  await observed(resumed);
  await write(join(resumed.work_dir, 'draft.json'), {nodes: [{node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: [{page: 1}], summary: 'Lena carries the harbour keys.'}],
    claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['npc-lena']});
  await write(join(resumed.work_dir, 'review.json'), {checked: [{paths: ['/nodes/0', '/coverage'], verdict: 'supported', source_refs: [{page: 1}], reason: 'Source support.'}], missing: []});
  const published = await finish(f, resumed);
  assert.equal((await f.module()).generation, now + 1, 'the resumed detail published onto the current generation');
  assert.ok(published.generation >= now);
  assert.equal((await f.queue()).find(job => job.job_id === first.job_id).state, 'completed');
});

test('§22.4.6.1 a displaced read whose focus\'s material was published meanwhile is resumed to read again; one on another focus is not', async t => {
  const f = await harbor(t, 'reread');
  const ask = {purpose: 'answer', focus: 'Tower', question: 'What is at the top of the tower?'};
  await f.call('module.read.request', {...ask, foreground: false});
  const answer = await f.claim();
  await f.call('module.read.request', {purpose: 'detail', focus: 'Dock', question: 'Who works the dock?', foreground: false});
  const other = await f.claim();
  assert.deepEqual([answer.focus, other.focus], ['Tower', 'Dock']);
  for (const job of [answer, other]) await f.call('module.read.yield', {job_id: job.job_id, lease: job.lease});
  // A reading of the Tower itself publishes the Tower's scene: the parked consultation's focus changed.
  await publishDetail(f, 'Tower', 'scene-tower', 2, 'What stands beyond the harbor?');
  const now = (await f.module()).generation;
  const claimed = [await f.claim(), await f.claim()];
  const byFocus = Object.fromEntries(claimed.map(job => [job.focus, job]));
  assert.deepEqual(byFocus.Tower.resumed, {from_generation: now - 1, generation: now, reread: true}, 'the Tower was published: read it again from the attempt');
  assert.equal(byFocus.Tower.resume_from, answer.work_dir);
  assert.deepEqual(byFocus.Dock.resumed, {from_generation: now - 1, generation: now, reread: false}, 'the Dock was not');
  for (const job of claimed) await fail(f, job);
});

// §22.4.6.1's "unchanged" case (a consultation running through a publication failed) is superseded by SL-55's addendum:
// see running-answer-generation-move.test.mjs.

// ---------------------------------------------------------------------------------------------------
// The host's resume.
// ---------------------------------------------------------------------------------------------------

test('§22.4.6.1 the host resumes a reread job with a read from the retained draft, and one without reread with a review only', async t => {
  const home = await mkdtemp(join(tmpdir(), 'displaced-read-host-')); t.after(() => rm(home, {recursive: true, force: true}));
  const cache = join(home, '.coc', 'modules', 'book', 'cache', 'pages');
  await mkdir(cache, {recursive: true});
  const {tasks, runtime} = answerRuntime({cache, fileSha: 'source-sha', draft: ANSWER});
  const service = new ReadingService({home, runtime, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record() {},
    async call(method) { assert.equal(method, 'module.read.finish'); return {state: 'ready'}; }});
  t.after(() => service.close());
  const job = (attempt, extra = {}) => ({job_id: 'read-7', key: 'consultation-key', module_id: 'book', purpose: 'answer', focus: 'the harbour master',
    question: 'Who keeps the register of ships?', foreground: false, lease: `lease-${attempt}`, work_dir: join(home, 'work', 'read-7', `attempt-${attempt}`),
    source: {path: join(home, '.coc', 'modules', 'book', 'source.pdf'), page_count: 3, file_sha256: 'source-sha'},
    index: [], known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [], ...extra});
  const run = async (attempt, extra) => {
    const spec = job(attempt, extra);
    await mkdir(spec.work_dir, {recursive: true});
    await writeFile(join(spec.work_dir, 'packet.json'), JSON.stringify({key: spec.key, source: {file_sha256: 'source-sha'}}));
    const from = tasks.length;
    await service.runJob(spec, new AbortController().signal, 'campaign-a');
    return tasks.slice(from);
  };
  // The first attempt reads and is reviewed; its checkpoint is retained.
  assert.deepEqual((await run(1)).map(task => task.prompt.phase), ['read', 'verify']);
  const retained = join(home, 'work', 'read-7', 'attempt-1');
  // (The review of an unchanged draft is served from the review cache, so a review-only resume may start no child at all.)
  const plain = await run(2, {resume_from: retained, resumed: {from_generation: 3, generation: 4, reread: false}});
  assert.deepEqual(plain.filter(task => task.prompt.phase === 'read'), [], 'its focus did not change: the retained read stands');
  const again = await run(3, {resume_from: retained, resumed: {from_generation: 3, generation: 5, reread: true}});
  assert.deepEqual(again.map(task => task.prompt.phase).filter(phase => phase === 'read'), ['read'], 'its focus changed: it reads again');
  assert.match(again[0].brief, /published material on this focus changed/);
  assert.equal(JSON.parse(await readFile(join(home, 'work', 'read-7', 'attempt-3', 'baseline.json'), 'utf8')).answer, ANSWER.answer,
    'from the retained draft, not from nothing');
});

// ---------------------------------------------------------------------------------------------------
// The reading service over the emitted kernel: the pending row survives the displacement.
// ---------------------------------------------------------------------------------------------------


test('§22.4.6.1 the pending row of a consultation displaced by a blocking read that then publishes stays pending, and lands', async t => {
  const f = await harbor(t, 'service');
  const bound = (await f.module()).source_document;
  const released = new Map(); // job_id -> 'fail' once the fixture lets that job's children end
  const attemptOf = cwd => { const match = /work\/(read-\d+)\/attempt-(\d+)/.exec(cwd); return match ? {job: match[1], attempt: Number(match[2])} : {}; };
  let displacedJob;
  const reached = new Set(); // job ids whose reader child started: the host has written its attempt's initial files
  const {tasks, runtime} = answerRuntime({cache: join(f.dir, 'cache', 'pages'), fileSha: bound.file_sha256, draft: ANSWER,
    // Every child holds until it is stopped or released, except the displaced consultation's resumed attempt, which reads.
    async hold(request, signal) {
      const {job, attempt} = attemptOf(request.cwd);
      reached.add(job);
      if (job === displacedJob && attempt > 1) return false;
      await new Promise(done => {
        if (signal?.aborted || released.has(job)) return done();
        signal?.addEventListener('abort', done, {once: true});
        const tick = setInterval(() => { if (released.has(job)) { clearInterval(tick); done(); } }, 20);
        signal?.addEventListener('abort', () => clearInterval(tick), {once: true});
      });
      return true;
    }});
  const rows = [], notes = [];
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.client.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  const pendingList = new PendingAnswers(row => notes.push(row)), campaign = 'sl54-fixture';
  const asks = ['the harbour master', 'the lighthouse keeper', 'the ferryman'].map(focus => ({purpose: 'answer', focus, question: `What does ${focus} know?`, foreground: true}));
  const entries = [];
  for (const ask of asks) {
    const reply = await service.ensure(f.module_id, ask, undefined, {allowanceMs: 1_000});
    assert.equal(reply.state, 'pending');
    entries.push(pendingList.register(campaign, ask, 15, reply.job_id, reply.settled));
  }
  await until(async () => (await f.queue()).filter(job => job.purpose === 'answer' && job.state === 'running' && !job.foreground).length === 3);
  // A move's blocking detail read of the Tower arrives: the youngest consultation gives its slot back.
  const cancel = new AbortController();
  const moving = service.ensure(f.module_id, {purpose: 'detail', focus: 'Tower', foreground: true}, cancel.signal);
  moving.catch(() => undefined);
  await until(async () => (await f.queue()).some(job => job.purpose === 'answer' && job.displaced === 1 && job.state === 'queued')
    && (await f.queue()).some(job => job.purpose === 'detail' && job.state === 'running'));
  const parked = (await f.queue()).find(job => job.displaced === 1);
  displacedJob = parked.job_id;
  const entry = entries.find(item => item.jobId === parked.job_id);
  assert.ok(entry, 'the displaced consultation is one the Keeper is waiting on');
  // The blocking read publishes the Tower while the consultation is parked: the generation moves on.
  const before = (await f.module()).generation;
  const detail = (await f.queue()).find(job => job.purpose === 'detail' && job.state === 'running');
  await until(() => reached.has(detail.job_id));
  await detailDraft({...detail, source: {file_sha256: bound.file_sha256}}, 'scene-tower', 'Tower', 2);
  await finish(f, detail);
  assert.equal((await f.module()).generation, before + 1);
  await new Promise(done => setTimeout(done, 1_000)); // several of the waiter's polls under the old generation
  assert.equal(entry.state, 'pending', 'the waiter follows its parked job; it is not refused');
  assert.ok(pendingList.take(campaign).pending.some(row => row.focus === entry.focus), 'the note still carries the pending row');
  // The other readings end; the parked consultation gets its slots back and resumes under the current generation.
  for (const job of await f.queue()) if (job.job_id !== parked.job_id && job.state === 'running') released.set(job.job_id, 'fail');
  await until(() => entry.state !== 'pending', 60_000);
  assert.equal(entry.state, 'landed', `the consultation landed (${entry.reason ?? ''})`);
  assert.equal(entry.answer?.answer, ANSWER.answer);
  const took = pendingList.take(campaign);
  assert.ok(took.landed.some(row => row.focus === entry.focus && row.answer?.answer === ANSWER.answer), 'carried once');
  const done = (await f.queue()).find(job => job.job_id === parked.job_id);
  assert.deepEqual([done.state, done.attempts, done.resumed], ['completed', 2, {from_generation: before, generation: before + 1, reread: false}]);
  const resumedRow = rows.find(row => row.event === 'concurrency' && row.job_id === parked.job_id && row.resumed);
  assert.deepEqual(resumedRow?.resumed, done.resumed, 'the claim row says it resumed under a new generation');
  assert.ok(tasks.some(task => task.cwd.includes(`/work/${parked.job_id}/attempt-2`)), 'read by its second attempt');
  cancel.abort();
  await moving.catch(() => undefined);
});
