/**
 * SL-55 (contract §22.4.6.1, addendum): an answer that is still reading when a publication moves the module's generation is
 * checked at its finish against the generation current then, instead of being lost; the same question asked again while
 * its job is parked or still reading attaches to that job.
 *
 * Evidence (SL-29A on batch 6, 血色公路, `sl29ab6-xuese-6001`): t17's own consultation `read-8` went `unavailable` 15.5 s
 * after it went pending, because `mather-general-store`'s publication moved the generation while it read; in SL-54's replay,
 * with no publication in flight, the same question landed 108 s later.
 *
 * - The emitted kernel over RPC (the synthetic harbor book): across a publication of another focus the answer lands under
 *   the current generation and its pinned waiter follows it throughout; across a publication touching its focus it is sent
 *   back once, re-claimed `reread`, and lands; a second touch refuses; the same question asked again attaches.
 * - The reading service over the emitted kernel with the pending list: a consultation whose focus is published while it
 *   reads stays pending, is read again from its draft, and lands.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {PendingAnswers} from '../../extensions/kernel/source-answers.ts';
import {ANSWER, answerDraft, answerRuntime, finish, harbor, observed, publishDetail, until, write} from './harbor-book.mjs';

/** A reviewed detail read of the Dock that also publishes Lena (who is at the Dock): a publication touching Lena. */
async function dockDraft(job) {
  await observed(job);
  await write(join(job.work_dir, 'draft.json'), {nodes: [
    {node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: [{page: 1}], properties: {keeper_notes: 'The dock at dusk.'}},
    {node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: [{page: 1}], summary: 'Lena mends nets on the dock.'}],
  claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-lena']});
  await write(join(job.work_dir, 'review.json'), {checked: [{paths: ['/nodes/0', '/nodes/1', '/coverage'], verdict: 'supported', source_refs: [{page: 1}],
    reason: 'Source support.'}], missing: []});
}
async function publishDock(f, question) {
  await f.call('module.read.request', {purpose: 'detail', focus: 'Dock', question, foreground: true});
  const job = await f.claim();
  assert.equal(job.focus, 'Dock', 'the Dock is another focus than Lena: it may be read while she is');
  await dockDraft(job);
  const before = (await f.module()).generation;
  await finish(f, job);
  assert.equal((await f.module()).generation, before + 1);
}
const answerJobs = async f => (await f.queue()).filter(job => job.purpose === 'answer');

test('§22.4.6.1 SL-55 an answer reading across a publication of another focus lands under the current generation, its waiter following it', async t => {
  const f = await harbor(t, 'untouched');
  const ask = {purpose: 'answer', focus: 'the harbour master', question: 'Who keeps the register of ships?'};
  const queued = await f.call('module.read.request', {...ask, foreground: false});
  const pinned = queued.generation, job = await f.claim();
  assert.equal(job.base_generation, pinned);
  await publishDetail(f, 'Tower', 'scene-tower', 2);
  const now = (await f.module()).generation;
  const reading = await f.call('module.read.request', {...ask, context_generation: pinned});
  assert.deepEqual([reading.state, reading.job_id], ['reading', job.job_id], 'the waiter follows the job still reading under the old generation');
  await answerDraft(job);
  const landed = await finish(f, job);
  assert.deepEqual([landed.state, landed.generation, landed.source_answer?.answer], ['ready', now, ANSWER.answer], 'it lands as is');
  const done = (await answerJobs(f))[0];
  assert.deepEqual([done.state, done.context_generation, done.finished_under, done.focus_rereads], ['completed', now, {from_generation: pinned, generation: now}, undefined]);
  const followed = await f.call('module.read.request', {...ask, context_generation: pinned});
  assert.deepEqual([followed.state, followed.source_answer?.answer], ['ready', ANSWER.answer]);
  const exact = await f.call('module.read.request', ask);
  assert.deepEqual([exact.state, exact.source_answer?.answer], ['ready', ANSWER.answer], 'kept under the current generation');
  const snapshot = await f.call('module.source.materials.snapshot');
  assert.deepEqual([snapshot.checked_answers.map(answer => answer.question), snapshot.checked_answers_invalid], [[ask.question], 0]);
});

test('§22.4.6.1 SL-55 an answer whose focus was published while it read is read again from its draft once, and lands; a second touch refuses', async t => {
  const f = await harbor(t, 'touched');
  const ask = {purpose: 'answer', focus: 'Lena', question: 'What does Lena carry?'};
  const pinned = (await f.call('module.read.request', {...ask, foreground: false})).generation;
  const first = await f.claim();
  assert.equal(first.focus, 'Lena');
  await publishDock(f, 'Who works the dock?');
  const now = (await f.module()).generation;
  await answerDraft(first);
  const sent = await finish(f, first);
  assert.deepEqual(sent, {state: 'queued', job_id: first.job_id, requeued: 'focus_changed', from_generation: pinned, generation: now}, 'not published: read again');
  const parked = (await answerJobs(f))[0];
  assert.deepEqual([parked.state, parked.focus_rereads, parked.lease, parked.work_dir], ['queued', 1, undefined, first.work_dir], 'back in the queue, its attempt kept');
  const waiting = await f.call('module.read.request', {...ask, context_generation: pinned});
  assert.deepEqual([waiting.state, waiting.job_id], ['queued', first.job_id], 'the waiter follows it');
  const again = await f.claim();
  assert.deepEqual([again.job_id, again.resume_from, again.context_generation], [first.job_id, first.work_dir, now]);
  assert.deepEqual(again.resumed, {from_generation: pinned, generation: now, reread: true}, 'SL-54\'s path: read again from the draft');
  await answerDraft(again);
  const landed = await finish(f, again);
  assert.deepEqual([landed.state, landed.source_answer?.answer], ['ready', ANSWER.answer]);
  assert.equal((await answerJobs(f)).length, 1, 'one job throughout');
  // Once: a second publication touching the focus while the re-read is in flight refuses, as before.
  const second = {purpose: 'answer', focus: 'Lena', question: 'Where does Lena sleep?'};
  const pin2 = (await f.call('module.read.request', {...second, memo: false, foreground: false})).generation;
  const job = await f.claim();
  await publishDock(f, 'Who waits at the dock at night?');
  await answerDraft(job);
  assert.equal((await finish(f, job)).requeued, 'focus_changed');
  const reread = await f.claim();
  assert.equal(reread.resumed.reread, true);
  await publishDock(f, 'What is moored at the dock?');
  await answerDraft(reread);
  await assert.rejects(finish(f, reread), error => error.details?.reason === 'source_context_changed', 'read again once, then the move refuses');
  assert.ok(pin2 < (await f.module()).generation);
});

test('§22.4.6.1 SL-55 the same question asked again while its job is parked or reading under an older generation attaches; a new question does not', async t => {
  const f = await harbor(t, 'reask');
  const ask = {purpose: 'answer', focus: 'the harbour master', question: 'Who keeps the register of ships?'};
  const first = await f.call('module.read.request', {...ask, foreground: false});
  const job = await f.claim();
  await f.call('module.read.yield', {job_id: job.job_id, lease: job.lease});
  await publishDetail(f, 'Tower', 'scene-tower', 2);
  const parked = await f.call('module.read.request', ask);
  assert.deepEqual([parked.state, parked.job_id, parked.attached], ['queued', first.job_id, true], 'parked: attached, not a second reading');
  assert.equal((await answerJobs(f)).length, 1);
  const running = await f.claim();
  assert.equal(running.job_id, first.job_id);
  await publishDetail(f, 'Tower', 'scene-tower', 2, 'What stands beyond the harbor?');
  const reading = await f.call('module.read.request', {...ask, foreground: true});
  assert.deepEqual([reading.state, reading.job_id, reading.attached], ['reading', first.job_id, true], 'reading under an older generation: attached');
  assert.equal((await answerJobs(f)).find(entry => entry.job_id === first.job_id).foreground, true, 'a foreground ask promotes it');
  const other = await f.call('module.read.request', {...ask, question: 'Where is the register kept?', foreground: false});
  assert.equal(other.state, 'queued');
  assert.notEqual(other.job_id, first.job_id, 'a new question keeps §22.4.3\'s attach rule');
  assert.equal((await answerJobs(f)).length, 2);
});

test('§22.4.6.1 SL-55 a waiter never follows an answer older than its pin: the same question answered under an earlier generation is not its answer', async t => {
  const f = await harbor(t, 'older');
  const ask = {purpose: 'answer', focus: 'the harbour master', question: 'Who keeps the register of ships?'};
  await f.call('module.read.request', {...ask, foreground: false});
  const old = await f.claim();
  await answerDraft(old);
  await finish(f, old);
  await publishDetail(f, 'Tower', 'scene-tower', 2);
  // Under the new generation another question on the focus is reading, and the old question asked again attaches to it
  // (§22.4.3): its waiter is pinned at this generation, and its own question's only job completed under the earlier one.
  await f.call('module.read.request', {...ask, question: 'Where is the register kept?', memo: false, foreground: false});
  const other = await f.claim();
  const attached = await f.call('module.read.request', {...ask, memo: false});
  assert.deepEqual([attached.state, attached.job_id, attached.attached], ['reading', other.job_id, true]);
  await publishDetail(f, 'Tower', 'scene-tower', 2, 'What stands beyond the harbor?');
  await assert.rejects(f.call('module.read.request', {...ask, context_generation: attached.generation}),
    error => error.details?.reason === 'source_context_changed', 'not handed the answer checked two generations ago');
});

test('§22.4.6.1 SL-55 the reading service: a consultation whose focus is published while it reads stays pending, is read again, and lands', async t => {
  const f = await harbor(t, 'service');
  const bound = (await f.module()).source_document;
  const attemptOf = cwd => { const match = /work\/(read-\d+)\/attempt-(\d+)/.exec(cwd); return match ? {job: match[1], attempt: Number(match[2])} : {}; };
  const reached = new Map(), released = new Set();
  let published = false;
  const {tasks, runtime} = answerRuntime({cache: join(f.dir, 'cache', 'pages'), fileSha: bound.file_sha256, draft: ANSWER,
    // The consultation's first read waits until the Dock has been published; the Dock's detail read holds until released.
    async hold(request, signal) {
      const {job, attempt} = attemptOf(request.cwd), task = request.prompt?.phase;
      reached.set(job, (reached.get(job) ?? 0) + 1);
      const purpose = (await f.queue()).find(entry => entry.job_id === job)?.purpose;
      if (purpose === 'answer') { if (attempt === 1 && task === 'read') await until(() => published); return false; }
      await until(() => released.has(job) || signal?.aborted);
      return true;
    }});
  const rows = [];
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.client.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  const pendingList = new PendingAnswers(() => {}), campaign = 'sl55-fixture';
  const ask = {purpose: 'answer', focus: 'Lena', question: 'What does Lena carry?', foreground: true};
  const reply = await service.ensure(f.module_id, ask, undefined, {allowanceMs: 1_000});
  assert.equal(reply.state, 'pending');
  const entry = pendingList.register(campaign, ask, 17, reply.job_id, reply.settled);
  // A move's blocking read of the Dock publishes Lena while the consultation is still reading.
  const cancel = new AbortController();
  const moving = service.ensure(f.module_id, {purpose: 'detail', focus: 'Dock', question: 'Who works the dock?', foreground: true}, cancel.signal);
  moving.catch(() => undefined);
  await until(async () => (await f.queue()).some(job => job.purpose === 'detail' && job.state === 'running' && reached.has(job.job_id)));
  const dock = (await f.queue()).find(job => job.purpose === 'detail' && job.state === 'running');
  const before = (await f.module()).generation;
  await dockDraft({...dock, source: {file_sha256: bound.file_sha256}});
  await finish(f, dock);
  assert.equal((await f.module()).generation, before + 1);
  published = true;
  released.add(dock.job_id);
  await until(() => rows.some(row => row.event === 'requeued' && row.job_id === reply.job_id));
  assert.equal(entry.state, 'pending', 'sent back to be read again, the Keeper\'s row still pending');
  assert.ok(pendingList.take(campaign).pending.some(row => row.focus === 'Lena'));
  await until(() => entry.state !== 'pending', 60_000);
  assert.equal(entry.state, 'landed', `the consultation landed (${entry.reason ?? ''})`);
  assert.equal(entry.answer?.answer, ANSWER.answer);
  const done = (await f.queue()).find(job => job.job_id === reply.job_id);
  assert.deepEqual([done.state, done.focus_rereads, done.resumed?.reread], ['completed', 1, true]);
  const reads = tasks.filter(task => task.cwd.includes(`/work/${reply.job_id}/`) && task.prompt.phase === 'read').map(task => attemptOf(task.cwd).attempt);
  assert.deepEqual(reads, [1, 2], 'read, then read again from the draft in the next attempt');
  const requeued = rows.find(row => row.event === 'requeued');
  assert.deepEqual([requeued.reason, requeued.from_generation, requeued.generation], ['focus_changed', before, before + 1]);
  cancel.abort();
  await moving.catch(() => undefined);
});
