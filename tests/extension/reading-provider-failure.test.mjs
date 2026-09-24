/**
 * SL-35 (contract §20 addendum 2): a reading round that failed on the provider is said with its cause,
 * a refusal from a lease the job shares across its rounds is not retried into that lease, and a reading
 * nobody waits on outlives the onboarding worker's exit instead of being cancelled with it.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); } };
const REFUSAL = {reason: 'budget_input_tokens', code: 'task_budget_exhausted', dimension: 'inputTokens', ceiling: 1000000, used: 649066,
  held: 0, requested: 500000, after_provider_error: 'Provider stream timed out: no response event for 60000 ms', unknown_usage_calls: 1};
const USAGE = {inputTokens: 149375, outputTokens: 564, costUsd: 0, actions: 6, unknownCalls: 1};

async function job(t, purpose = 'opening', foreground = true) {
  const home = await mkdtemp(join(tmpdir(), 'reading-provider-failure-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const cwd = join(home, 'work', 'read-3', 'attempt-1');
  await mkdir(cwd, {recursive: true});
  return {home, cwd, row: {job_id: 'read-3', module_id: 'book', purpose, focus: 'Start: Lima', foreground, lease: 'lease-3', work_dir: cwd,
    source: {path: join(home, '.coc', 'modules', 'book', 'source.pdf'), page_count: 669, file_sha256: 'source-sha'},
    index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: []}};
}

/** Run one job whose every read round fails with `outcome`; returns what the kernel and the event log were told. */
async function failingRounds(t, outcome, providerBudget) {
  const f = await job(t), finishes = [], records = [];
  let rounds = 0;
  const service = new ReadingService({home: f.home, model: () => ({id: 'grok-build/grok-4.7-build-fast', vision: true, thinking: 'low'}),
    progress() {}, record: row => records.push(row),
    runtime: {contentRoot: join(ROOT, 'content'), async runTask() { rounds++; return {ok: false, code: null, timedOut: false, ms: 120000, stderr: '', command: [], usage: USAGE, ...outcome}; }},
    async call(method, params) { assert.equal(method, 'module.read.finish'); finishes.push(params); return {state: params.outcome}; }});
  t.after(() => service.close());
  await service.runJob(f.row, new AbortController().signal, undefined, providerBudget);
  return {rounds, finishes, records, cwd: f.cwd};
}

test('a refusal from the stage lease fails the job after one round, with the cause the kernel keeps', async t => {
  const stageLease = {signal: new AbortController().signal, deadlineAt: Date.now() + 1e6, reserve() { throw new Error('unused'); }};
  const run = await failingRounds(t, {error: 'provider_budget_refused: budget_input_tokens (…)', refusal: REFUSAL}, stageLease);
  assert.equal(run.rounds, 1, 'the second round would reserve from the same lease');
  const finish = run.finishes.at(-1);
  assert.equal(finish.outcome, 'failed');
  assert.equal(finish.refusal.rule, 'provider_budget_refused');
  assert.equal(finish.refusal.reason, 'budget_input_tokens');
  assert.match(finish.refusal.message, /^provider_budget_refused: budget_input_tokens \(the call asked for 500000 inputTokens; the lease's ceiling is 1000000, 649066 used, 0 held by other calls; 1 call\(s\) ended without usage/);
  const refused = run.records.find(row => row.event === 'provider_refused');
  assert.deepEqual({reason: refused.reason, ceiling: refused.ceiling, used: refused.used, requested: refused.requested, round: refused.round},
    {reason: 'budget_input_tokens', ceiling: 1000000, used: 649066, requested: 500000, round: 1});
  const round = run.records.find(row => row.phase === 'read' && row.round === 1 && row.event === undefined);
  assert.deepEqual([round.usage, round.refusal], [USAGE, 'budget_input_tokens']);
  const rows = (await readFile(join(run.cwd, 'usage.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows, [{job_id: 'read-3', phase: 'read', round: 1, ok: false, pages: 0, usage: USAGE}]);
  const findings = JSON.parse(await readFile(join(run.cwd, 'findings.json'), 'utf8'));
  assert.deepEqual(findings.details.refusal, REFUSAL);
});

test('with a fresh lease per round (no stage lease), a refusal still gets the second round', async t => {
  const run = await failingRounds(t, {error: 'provider_budget_refused: budget_input_tokens (…)', refusal: REFUSAL});
  assert.equal(run.rounds, 2);
  assert.equal(run.finishes.at(-1).refusal.reason, 'budget_input_tokens');
});

test('a round that failed on the provider twice fails with reason transport', async t => {
  const stageLease = {signal: new AbortController().signal, deadlineAt: Date.now() + 1e6, reserve() { throw new Error('unused'); }};
  const run = await failingRounds(t, {error: 'Connection error.', providerError: 'Connection error.'}, stageLease);
  assert.equal(run.rounds, 2);
  const finish = run.finishes.at(-1);
  assert.deepEqual([finish.outcome, finish.refusal.rule, finish.refusal.reason], ['failed', 'reader_transport', 'transport']);
  assert.match(finish.refusal.message, /Connection error\./);
  assert.equal(run.records.filter(row => row.event === 'provider_refused').length, 2);
});

/** A claimed job whose reader runs until it is stopped; then the service closes the way the worker does. */
async function closing(t, {foreground, handOff}) {
  const f = await job(t, 'detail', foreground), calls = [], records = [];
  let started = false, claimed = false;
  const service = new ReadingService({home: f.home, model: () => ({id: 'fixture/vision', vision: true, thinking: 'low'}),
    progress() {}, record: row => records.push(row),
    runtime: {contentRoot: join(ROOT, 'content'), async runTask(_task, signal) {
      started = true;
      await new Promise(done => signal.addEventListener('abort', done, {once: true}));
      return {ok: false, code: null, timedOut: false, ms: 5, stderr: '', command: [], error: 'cancelled'};
    }},
    async call(method, params) {
      calls.push({method, params});
      if (method === 'module.read.claim') { if (claimed) return {job_id: null}; claimed = true; return f.row; }
      if (method === 'module.read.finish') return {state: params.outcome};
      throw new Error(`unexpected ${method}`);
    }});
  const pump = service.prefetch('book', 'test');
  await until(() => started);
  await service.close(handOff ? {handOff: true} : {});
  await pump;
  return {finishes: calls.filter(call => call.method === 'module.read.finish'), records};
}

test('at the worker\'s exit a reading nobody waits on is handed off, not cancelled', async t => {
  const handed = await closing(t, {foreground: false, handOff: true});
  assert.deepEqual(handed.finishes, [], 'the job stays running with no lock holder, for the next owner to re-queue');
  assert.deepEqual(handed.records.filter(row => row.event === 'handed_off').map(row => [row.job_id, row.purpose]), [['read-3', 'detail']]);
  const waited = await closing(t, {foreground: true, handOff: true});
  assert.deepEqual(waited.finishes.map(call => call.params.outcome), ['cancelled'], 'a reading the stage waits on is still cancelled');
  const table = await closing(t, {foreground: false, handOff: false});
  assert.deepEqual(table.finishes.map(call => call.params.outcome), ['cancelled'], 'without hand-off (the table host) nothing changes');
});
