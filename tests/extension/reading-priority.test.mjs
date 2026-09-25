/**
 * SL-45 (contract §22.4.6): reading capacity belongs to the turn. A read a turn waits on (blocking) takes any free slot;
 * a background read (a consultation past its allowance, a map, a read-ahead, the index) never takes the last one, and
 * yields its slot to a blocking read -- displaced and returned to the queue with its attempt, never cancelled.
 *
 * Evidence (SL-29A on batch 4, 血色公路, `sl29ab4-xuese-2401`): at 17:23:40 all three slots were held by reads no turn
 * waited on (a read-ahead of `church-lane`, a consultation demoted at 17:21:21, one about to be); the `last-chance-bar`
 * read a move needed got its slot at 17:24:51 only because one of them had just failed.
 *
 * - The emitted kernel over RPC: the last-slot rule; three background reads holding every slot make a blocking claim name
 *   the youngest to displace; the yield returns it `queued` with its attempt, the blocking read claims, the displaced read
 *   waits for two free slots and resumes from its attempt.
 * - The reading service over that kernel, with a reader runtime that holds each read until it is stopped: a blocking
 *   `detail` read arriving while three background consultations hold the slots is claimed within the consultation
 *   allowance, and the rows name the class, the wait and the displacement.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRuntime} from '../../runtime/host.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {SOURCE_ANSWER_ALLOWANCE_MS} from '../../extensions/kernel/source-answers.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const PAGES = 111; // 血色公路's page count

async function book(t, name) {
  const home = await mkdtemp(join(tmpdir(), `reading-priority-${name}-`));
  const owner = createRuntime({owner: 'preparation', home}, {resourceRoot: ROOT, nodeExecutable: process.execPath});
  t.after(async () => { await owner.close(); await rm(home, {recursive: true, force: true}); });
  const client = owner.openKernel();
  const bytes = Buffer.from(`%PDF-1.7\nsource identity for the reading-priority fixture only (${name})\n`), pdf = join(home, 'fixture.pdf');
  await writeFile(pdf, bytes);
  const {module_id} = await client.call('module.source.bind', {source: {path: pdf, page_count: PAGES, file_sha256: createHash('sha256').update(bytes).digest('hex')}});
  const queue = async () => JSON.parse(await readFile(join(home, '.coc/modules', module_id, 'deepen-queue.json'), 'utf8'));
  return {home, client, module_id, queue, call: (method, params = {}) => client.call(method, {module_id, ...params})};
}
const detail = (f, focus, foreground) => f.call('module.read.request', {purpose: 'detail', focus, foreground});
const claim = f => f.call('module.read.claim', {owner: 'host-test'});
const fail = (f, job) => f.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: 'End the fixture without publishing a graph'});

test('§22.4.6 a background read never takes the last slot; a blocking read takes it', async t => {
  const f = await book(t, 'last-slot');
  await detail(f, 'church-lane', false);
  const ahead = await claim(f), index = await claim(f);
  assert.deepEqual([ahead.focus, index.purpose], ['church-lane', 'index'], 'two background reads: one slot is left');
  assert.equal(ahead.concurrency, 3);
  await detail(f, 'esso-station', false);
  assert.deepEqual(await claim(f), {job_id: null}, 'a third background read would take the last slot: it waits');
  await detail(f, 'last-chance-bar', true);
  const blocking = await claim(f);
  assert.equal(blocking.focus, 'last-chance-bar', 'the read a turn waits on takes the last slot');
  const paused = (await f.queue()).find(job => job.focus === 'esso-station');
  assert.equal(paused.state, 'queued', 'the background read is paused, not refused');
  await fail(f, ahead);
  assert.deepEqual(await claim(f), {job_id: null}, 'still one slot free only: the background read keeps waiting');
  await fail(f, index);
  assert.equal((await claim(f)).focus, 'esso-station', 'two free slots: it runs');
});

test('§22.4.6 three background reads holding every slot yield the youngest to a blocking read, which it resumes from later', async t => {
  const f = await book(t, 'displace');
  // Three consultations claimed inside their allowance (blocking), then demoted when their waiters left (§61, §22.4.3).
  const held = [];
  for (const focus of ['esso-station', 'mather-general-store', 'church-lane']) {
    await f.call('module.read.request', {purpose: 'answer', focus, question: `Who is at ${focus}?`, foreground: true});
    held.push(await claim(f));
  }
  assert.deepEqual(held.map(job => job.purpose), ['answer', 'answer', 'answer']);
  for (const job of held) await f.call('module.read.unwait', {job_id: job.job_id});
  await detail(f, 'last-chance-bar', true);
  const [youngest] = held.slice(-1);
  assert.deepEqual(await claim(f), {job_id: null, displace: youngest.job_id}, 'the background read claimed last yields: the least work lost');
  assert.deepEqual(await f.call('module.read.claim', {owner: 'another-host'}), {job_id: null}, 'only the owner is asked to stop its own reading');
  // Only the attempt holding the lease may yield; a yield is not a finish.
  await assert.rejects(f.call('module.read.yield', {job_id: youngest.job_id, lease: 'not-this-attempt'}), /no longer owns its slot/);
  const yieldedAt = Date.now();
  assert.deepEqual(await f.call('module.read.yield', {job_id: youngest.job_id, lease: youngest.lease}), {job_id: youngest.job_id, state: 'queued', displaced: 1});
  assert.deepEqual(await f.call('module.read.yield', {job_id: youngest.job_id, lease: youngest.lease}), {job_id: youngest.job_id, state: 'queued', displaced: 1}, 'idempotent');
  const yielded = (await f.queue()).find(job => job.job_id === youngest.job_id);
  assert.equal(yielded.foreground, false);
  assert.equal(yielded.work_dir, youngest.work_dir, 'the attempt is kept');
  assert.equal(yielded.detail, undefined, 'no failure, no cancellation, no refusal');
  assert.equal(yielded.refusal, undefined);
  assert.ok(Date.parse(yielded.class_at) >= yieldedAt, 'the slot wait restarts at the yield');
  const blocking = await claim(f);
  assert.equal(blocking.focus, 'last-chance-bar', 'the read the turn waits on takes the returned slot');
  assert.equal(blocking.foreground, true);
  await fail(f, held[0]);
  assert.deepEqual(await claim(f), {job_id: null}, 'the displaced read is background: it does not take the last slot');
  await fail(f, blocking);
  const back = await claim(f);
  assert.equal(back.job_id, youngest.job_id, 'displaced, not cancelled: it comes back');
  assert.equal(back.resume_from, youngest.work_dir, 'and resumes from its retained attempt');
  assert.equal(back.attempts, 2);
  for (const job of [held[1], back]) await fail(f, job);
});

test('§22.4.6 a blocking read never displaces a blocking read', async t => {
  const f = await book(t, 'no-blocking-displacement');
  const held = [];
  for (const focus of ['a', 'b', 'c']) { await detail(f, focus, true); held.push(await claim(f)); }
  await detail(f, 'd', true);
  assert.deepEqual(await claim(f), {job_id: null});
  for (const job of held) await fail(f, job);
});

/** A reader runtime whose every child holds until it is stopped; it records what each child was asked to run as. */
function heldReaders() {
  const started = [];
  return {started, runtime: {contentRoot: join(ROOT, 'content'), async check() { return {ok: true}; },
    async runTask({request}, signal) {
      started.push({cwd: request.cwd, at: Date.now(), priority: request.priority?.(), lease: request.readingLease});
      await new Promise(done => { if (signal?.aborted) done(); else signal?.addEventListener('abort', done, {once: true}); });
      return {ok: false, code: null, timedOut: false, ms: 1, stderr: '', command: [], error: 'cancelled'};
    }}};
}
const until = async (predicate, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (!(await predicate())) { if (Date.now() > deadline) assert.fail('timed out waiting'); await new Promise(done => setTimeout(done, 25)); }
};

test('§22.4.6 the reading service: a blocking detail read arriving while three background consultations hold the slots gets one within the allowance', async t => {
  const f = await book(t, 'service');
  // A book whose index is done, so the three slots are the three consultations' (the index job would otherwise take one).
  const meta = join(f.home, '.coc/modules', f.module_id, 'module.json'), record = JSON.parse(await readFile(meta, 'utf8'));
  await writeFile(meta, JSON.stringify({...record, reading: {...record.reading, index_complete: true}}));
  const rows = [], {started, runtime} = heldReaders();
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.client.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  // Three consultations, each claimed inside its allowance and then past it: pending, demoted, still reading in the
  // background. (The allowance is long enough for the claim to land first on a loaded machine; the product's is 8 s.)
  for (const [n, focus] of ['esso-station', 'mather-general-store', 'abattoir'].entries()) {
    const reply = await service.ensure(f.module_id, {purpose: 'answer', focus, question: `What is at ${focus}?`, foreground: true}, undefined, {allowanceMs: 1_000});
    assert.equal(reply.state, 'pending');
    assert.equal(started.length, n + 1, 'claimed while a turn waited on it');
  }
  await until(async () => started.length === 3 && (await f.queue()).filter(job => job.purpose === 'answer' && job.state === 'running' && !job.foreground).length === 3);
  const cancel = new AbortController(), asked = Date.now();
  const waiting = service.ensure(f.module_id, {purpose: 'detail', focus: 'last-chance-bar', foreground: true}, cancel.signal);
  waiting.catch(() => undefined);
  await until(() => started.length === 4);
  const slotMs = started[3].at - asked;
  assert.ok(slotMs < SOURCE_ANSWER_ALLOWANCE_MS, `the blocking read reached a reader in ${slotMs} ms`);
  t.diagnostic(`blocking read reached a reader ${slotMs} ms after it was asked for`);
  const queue = await f.queue(), read = queue.find(job => job.purpose === 'detail' && job.focus === 'last-chance-bar');
  assert.ok(started[3].cwd.includes(`/work/${read.job_id}/`), 'the fourth reader is the blocking read');
  assert.equal(started[3].priority, 'foreground');
  const displaced = queue.filter(job => job.purpose === 'answer' && job.displaced === 1);
  assert.equal(displaced.length, 1, 'one consultation gave its slot back');
  assert.equal(displaced[0].state, 'queued', 'displaced, not failed or cancelled');
  assert.equal(queue.filter(job => job.purpose === 'answer' && job.state === 'running').length, 2, 'the other two keep reading');
  const moved = rows.find(row => row.event === 'displaced');
  assert.deepEqual([moved?.job_id, moved?.for_job, moved?.displaced], [displaced[0].job_id, read.job_id, 1]);
  assert.ok(Number.isFinite(moved.ran_ms));
  const slot = rows.find(row => row.event === 'concurrency' && row.job_id === read.job_id);
  assert.equal(slot.class, 'blocking');
  assert.ok(slot.slot_wait_ms < SOURCE_ANSWER_ALLOWANCE_MS, `slot_wait_ms ${slot.slot_wait_ms}`);
  assert.ok(rows.filter(row => row.event === 'concurrency' && row.purpose === 'answer').every(row => row.class === 'blocking'),
    'consultations are claimed inside their allowance, while a turn waits on them');
  // §20 addendum 3 (SL-41): each read raised in play is sized from the book, and its children carry the size.
  const sized = rows.filter(row => row.event === 'stage_budget');
  assert.deepEqual(sized.map(row => [row.purpose, row.stage, row.pageCount, row.inputTokens]).filter(row => row[0] === 'detail'),
    [['detail', 'detail', PAGES, 4_000_000]]);
  assert.ok(sized.some(row => row.stage === 'answer'));
  assert.equal(started[3].lease.stage, 'detail');
  assert.equal(started[3].lease.callOutputTokens, 32_768);
  cancel.abort();
  await assert.rejects(waiting, /cancelled/);
});

// SL-53 (contract §20 addendum 5): the fork's index job has no stage lease either; it is sized from the book like the play
// reads, where batch 6's ran under the fixed 1,000,000-token lease and lost a round to it.
test('§20 addendum 5 the reading service sizes the book\'s index job: its reader child carries the index lease and the row is written', async t => {
  const f = await book(t, 'index-lease');
  const rows = [], {started, runtime} = heldReaders();
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.client.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  const cancel = new AbortController();
  const waiting = service.ensure(f.module_id, {purpose: 'detail', focus: 'last-chance-bar', foreground: true}, cancel.signal);
  waiting.catch(() => undefined);
  await until(async () => (await f.queue()).some(job => job.purpose === 'index' && job.state === 'running') && started.length === 2);
  const index = (await f.queue()).find(job => job.purpose === 'index');
  const child = started.find(entry => entry.cwd.includes(`/work/${index.job_id}/`));
  assert.ok(child, 'the index job reached a reader');
  assert.deepEqual({stage: child.lease?.stage, pages: child.lease?.pageCount, input: child.lease?.inputTokens, call: child.lease?.callOutputTokens},
    {stage: 'index', pages: PAGES, input: 4_000_000, call: 32_768}, 'the book-sized floor, not the fixed 1,000,000');
  const sized = rows.find(row => row.event === 'stage_budget' && row.job_id === index.job_id);
  assert.deepEqual([sized?.purpose, sized?.stage, sized?.pageCount, sized?.inputTokens], ['index', 'index', PAGES, 4_000_000]);
  cancel.abort();
  await assert.rejects(waiting, /cancelled/);
});

// SL-65 (contract §20 addendum 6; amends addendum 3/5): a campaign's own fork reads under the same book-sized
// lease as the library, but sized to the reader that is actually doing the reading -- the b10 fork's index and
// detail jobs got the (correctly book-sized) floor of 4,000,000, and still lost every round to three consecutive
// provider-error calls that each reserved 1,000,000 tokens (this reader's own whole context window, twice the
// 500,000-token reader the fixed floor assumed).
test('§20 addendum 6 a background job\'s lease is sized to this reader\'s own context window, not a fixed one', async t => {
  const f = await book(t, 'index-lease-context-window');
  const rows = [], {started, runtime} = heldReaders();
  const service = new ReadingService({home: f.home, runtime, call: (method, params) => f.client.call(method, params),
    model: () => ({id: 'fixture/vision', vision: true, thinking: 'off', contextWindow: 1_000_000}), progress() {}, record(row) { rows.push(row); }});
  t.after(() => service.close());
  const cancel = new AbortController();
  const waiting = service.ensure(f.module_id, {purpose: 'detail', focus: 'last-chance-bar', foreground: true}, cancel.signal);
  waiting.catch(() => undefined);
  await until(async () => (await f.queue()).some(job => job.purpose === 'index' && job.state === 'running') && started.length === 2);
  const index = (await f.queue()).find(job => job.purpose === 'index');
  const child = started.find(entry => entry.cwd.includes(`/work/${index.job_id}/`));
  assert.ok(child, 'the index job reached a reader');
  assert.equal(child.lease?.inputTokens, 8_000_000, 'eight reservations of this 1,000,000-token reader, not the 500,000-token default');
  const sized = rows.find(row => row.event === 'stage_budget' && row.job_id === index.job_id);
  assert.equal(sized?.inputTokens, 8_000_000);
  cancel.abort();
  await assert.rejects(waiting, /cancelled/);
});
