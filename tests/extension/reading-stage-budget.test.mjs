/**
 * SL-35 (contract §20 addendum 2): an import stage's reading pays from one lease sized to the book.
 * Per dimension: clamp(floor, pages × per-page cost × stage share, ceiling); the per-page cost is the
 * reader's own measured cost on this book when it has measured four pages or more.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {READING_STAGE_BUDGET, readingStageBudget, measuredPageCost, openStageProviderBudget, withStageLease} from '../../runtime/jev/reading-stage-budget.ts';
import {BudgetRefusal, TaskLease} from '../../runtime/jev/task-context.ts';

const model = {provider: 'test', id: 'vision', api: 'openai-responses', maxTokens: 16384, contextWindow: 500000,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};

test('a 669-page book sizes its opening lease from its pages; guidance takes half; inspect calls no provider', () => {
  const opening = readingStageBudget('opening', {pageCount: 669});
  assert.deepEqual({input: opening.inputTokens, output: opening.outputTokens, actions: opening.actions, usd: opening.costUsd},
    {input: 669 * 16_000, output: 669 * 1_000, actions: Math.ceil(669 * 0.5), usd: 669 * 0.03});
  assert.equal(opening.measured, false);
  assert.equal(opening.callOutputTokens, READING_STAGE_BUDGET.callOutputTokens);
  assert.equal(opening.deadlineMs, READING_STAGE_BUDGET.deadlineMs);
  const guidance = readingStageBudget('guidance', {pageCount: 669});
  assert.equal(guidance.inputTokens, 669 * 16_000 * 0.5);
  assert.equal(guidance.actions, Math.ceil(669 * 0.5 * 0.5));
  assert.equal(readingStageBudget('prepare', {pageCount: 669}).inputTokens, 669 * 16_000 * 1.5);
  assert.equal(readingStageBudget('inspect', {pageCount: 669}), null);
  assert.throws(() => readingStageBudget('index', {pageCount: 669}), /unknown reading stage/);
});

test('a short book gets the floor; a huge book the ceiling', () => {
  const short = readingStageBudget('opening', {pageCount: 41});
  assert.deepEqual({input: short.inputTokens, output: short.outputTokens, actions: short.actions, usd: short.costUsd},
    {input: 4_000_000, output: 262_144, actions: 64, usd: 10});
  // The floor holds eight whole-context reservations of a 500,000-token reader.
  assert.ok(short.inputTokens >= 8 * model.contextWindow);
  const unknown = readingStageBudget('opening', {pageCount: 0});
  assert.equal(unknown.inputTokens, 4_000_000);
  const huge = readingStageBudget('opening', {pageCount: 5_000});
  assert.deepEqual({input: huge.inputTokens, output: huge.outputTokens, actions: huge.actions, usd: huge.costUsd},
    {input: 40_000_000, output: 2_000_000, actions: 800, usd: 100});
});

async function moduleFixture(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'stage-budget-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const [job, lines] of Object.entries(rows)) {
    await mkdir(join(dir, 'work', job, 'attempt-1'), {recursive: true});
    await writeFile(join(dir, 'work', job, 'attempt-1', 'usage.jsonl'), lines.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  return dir;
}
const usage = (inputTokens, outputTokens = 100, actions = 2, costUsd = 0) => ({inputTokens, outputTokens, costUsd, actions, unknownCalls: 0});

test('the per-page cost is measured from the book\'s own completed author rounds', async t => {
  const dir = await moduleFixture(t, {
    'read-1': [{phase: 'read', round: 1, ok: true, pages: 6, usage: usage(180_000, 6_000, 6)},
      {phase: 'read', round: 2, ok: false, pages: 6, usage: usage(900_000)}],
    'read-2': [{phase: 'index', round: 1, ok: true, pages: 4, usage: usage(120_000, 4_000, 4)},
      {phase: 'verify', round: 1, ok: true, pages: 9, usage: usage(5_000_000)}],
  });
  const measured = await measuredPageCost(dir);
  assert.deepEqual(measured, {inputTokens: 30_000, outputTokens: 1_000, actions: 1, costUsd: 0});
  const opening = readingStageBudget('opening', {pageCount: 669, perPage: measured});
  assert.equal(opening.inputTokens, 669 * 30_000);
  assert.equal(opening.measured, true);
});

test('fewer than four measured pages is not a measurement', async t => {
  const dir = await moduleFixture(t, {'read-1': [{phase: 'read', round: 1, ok: true, pages: 3, usage: usage(90_000)}]});
  assert.equal(await measuredPageCost(dir), undefined);
  assert.equal(await measuredPageCost(join(dir, 'missing')), undefined);
});

test('the opened lease is the sized one, bounds each call\'s output, and names its ceiling when it refuses', async () => {
  const sized = readingStageBudget('opening', {pageCount: 41});
  const {budget, close} = openStageProviderBudget(sized);
  try {
    assert.equal(budget.callOutputTokens, 32_768);
    assert.ok(budget.deadlineAt > Date.now() + sized.deadlineMs - 5_000);
    // Eight image calls that each end without usage (a provider error) are charged their whole reservation.
    for (let n = 0; n < 8; n++) (await budget.reserve({model, inputTokens: 500_000, outputTokens: 8192})).settle();
    await assert.rejects(budget.reserve({model, inputTokens: 500_000, outputTokens: 8192}), error => {
      assert.ok(error instanceof BudgetRefusal);
      assert.equal(error.code, 'task_budget_exhausted');
      assert.deepEqual(error.refusal, {dimension: 'inputTokens', ceiling: 4_000_000, used: 4_000_000, held: 0, requested: 500_000});
      return true;
    });
  } finally { close(); }
  // With a call still in flight, the refusal separates what was used from what that call holds.
  const second = openStageProviderBudget(sized);
  try {
    const inflight = await second.budget.reserve({model, inputTokens: 500_000, outputTokens: 8192});
    for (let n = 0; n < 4; n++) (await second.budget.reserve({model, inputTokens: 500_000, outputTokens: 8192})).settle();
    await assert.rejects(second.budget.reserve({model, inputTokens: 2_500_000, outputTokens: 1}), error => {
      assert.deepEqual(error.refusal, {dimension: 'inputTokens', ceiling: 4_000_000, used: 2_000_000, held: 500_000, requested: 2_500_000});
      return true;
    });
    inflight.release();
  } finally { second.close(); }
});

test('a direct reservation names its dimension too (the writer and lane path)', () => {
  const lease = new TaskLease({owner: 'direct', goal: 'Refuse one reservation', scope: {owner: 'direct', audience: 'system'}, capabilities: [], readSet: [],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 100, remainingOutputTokens: 100, remainingCostUsd: 1, remainingActions: 5}});
  try {
    assert.throws(() => lease.reserve({inputTokens: 10, outputTokens: 101, costUsd: 0, actions: 1}, {waitable: false}), error => {
      assert.ok(error instanceof BudgetRefusal);
      assert.deepEqual(error.refusal, {dimension: 'outputTokens', ceiling: 100, used: 0, held: 0, requested: 101});
      return true;
    });
  } finally { lease.close(); }
});

test('the worker\'s stage runs its reading with the sized lease, reports it, and closes it after', async t => {
  const dir = await moduleFixture(t, {});
  await writeFile(join(dir, 'module.json'), JSON.stringify({page_count: 669}));
  const rows = [];
  let seen;
  const result = await withStageLease('opening', {moduleDir: dir, env: {}, report: row => rows.push(row)}, async reading => {
    seen = reading.providerBudget;
    assert.equal(reading.providerBudget.callOutputTokens, 32_768);
    const charge = await reading.providerBudget.reserve({model, inputTokens: 669 * 16_000, outputTokens: 1});
    charge.release();
    await assert.rejects(reading.providerBudget.reserve({model, inputTokens: 669 * 16_000 + 1, outputTokens: 1}), /task_budget_exhausted/);
    return 'read';
  });
  assert.equal(result, 'read');
  assert.equal(seen.signal.aborted, true, 'the stage lease is closed when the stage ends');
  assert.deepEqual(rows.map(row => [row.event, row.stage, row.pageCount, row.inputTokens]), [['stage_budget', 'opening', 669, 669 * 16_000]]);
  // A reader command that is not a Pi child has no provider channel: no lease, as runtime/tasks.ts.
  await withStageLease('opening', {moduleDir: dir, env: {PI_COC_READER_CMD: '["node","reader.mjs"]'}}, async reading => assert.equal(reading.providerBudget, undefined));
  await withStageLease('inspect', {moduleDir: dir, env: {}}, async reading => assert.equal(reading.providerBudget, undefined));
});
