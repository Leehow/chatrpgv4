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
import {READING_STAGE_BUDGET, readingStageBudget, measuredPageCost, openStageProviderBudget, readingJobStage, withStageLease} from '../../runtime/jev/reading-stage-budget.ts';
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
  assert.throws(() => readingStageBudget('verify', {pageCount: 669}), /unknown reading stage/);
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
  // A cheaper measurement does not lower the default: it counts the author's rounds, not the review.
  const cheap = readingStageBudget('opening', {pageCount: 669, perPage: {inputTokens: 7_135, outputTokens: 578, actions: 0.43, costUsd: 0}});
  assert.deepEqual([cheap.inputTokens, cheap.outputTokens, cheap.actions], [669 * 16_000, 669 * 1_000, Math.ceil(669 * 0.5)]);
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

// ---------------------------------------------------------------------------------------------------
// SL-41 (contract §20 addendum 3): the reads raised during play are stages of the same table.
// ---------------------------------------------------------------------------------------------------

test('§20 addendum 3 a play read is sized from the book like a stage: detail a quarter, answer and map a tenth, the floor and ceiling hold', () => {
  assert.deepEqual({...READING_STAGE_BUDGET.share}, {inspect: 0, guidance: 0.5, opening: 1, prepare: 1.5, detail: 0.25, answer: 0.1, map: 0.1, index: 0.5, skeleton: 0.5});
  const masks = Object.fromEntries(['detail', 'answer', 'map'].map(stage => [stage, readingStageBudget(stage, {pageCount: 5_000})]));
  assert.equal(masks.detail.inputTokens, Math.ceil(5_000 * 16_000 * 0.25));
  assert.equal(masks.answer.inputTokens, 5_000 * 16_000 * 0.1);
  assert.equal(masks.map.actions, Math.ceil(5_000 * 0.5 * 0.1));
  // 血色公路 (111 pages): the floor decides, eight whole-context reservations where the fixed lease held two.
  const book = readingStageBudget('detail', {pageCount: 111});
  assert.deepEqual({input: book.inputTokens, output: book.outputTokens, actions: book.actions, usd: book.costUsd, call: book.callOutputTokens},
    {input: 4_000_000, output: 262_144, actions: 64, usd: 10, call: 32_768});
  assert.equal(readingStageBudget('detail', {pageCount: 100_000}).inputTokens, 40_000_000);
  const measured = readingStageBudget('detail', {pageCount: 5_000, perPage: {inputTokens: 40_000, outputTokens: 1_000, actions: 1, costUsd: 0}});
  assert.equal(measured.inputTokens, 40_000_000, 'a measurement raises it, the ceiling still caps it');
  assert.equal(readingStageBudget('answer', {pageCount: 669, perPage: {inputTokens: 90_000, outputTokens: 1_000, actions: 1, costUsd: 0}}).inputTokens, Math.ceil(669 * 90_000 * 0.1));
});

test('§20 addendum 3 and 5 which jobs without a stage lease are sized: detail, a map\'s pages, a consultation, the index, a skeleton; nothing else', () => {
  assert.equal(readingJobStage({purpose: 'detail'}), 'detail');
  assert.equal(readingJobStage({purpose: 'detail', material: 'map'}), 'map');
  assert.equal(readingJobStage({purpose: 'answer'}), 'answer');
  assert.equal(readingJobStage({purpose: 'index'}), 'index');
  assert.equal(readingJobStage({purpose: 'skeleton'}), 'skeleton');
  for (const purpose of ['opening', 'guidance', 'verify', undefined]) assert.equal(readingJobStage({purpose}), undefined, String(purpose));
});

// ---------------------------------------------------------------------------------------------------
// SL-53 (contract §20 addendum 5): the background index job, and a skeleton outside a stage, are sized from the book too.
// ---------------------------------------------------------------------------------------------------

test('§20 addendum 5 an index job on a 111-page book gets the floor lease, on 669 pages the scaled one; a skeleton likewise', () => {
  // 血色公路 (111 pages): the batch-6 index round was refused at the fixed 1,000,000 input tokens; the floor holds eight
  // whole-context reservations of a 500,000-token reader.
  for (const stage of ['index', 'skeleton']) {
    const book = readingStageBudget(stage, {pageCount: 111});
    assert.deepEqual({input: book.inputTokens, output: book.outputTokens, actions: book.actions, usd: book.costUsd, call: book.callOutputTokens},
      {input: 4_000_000, output: 262_144, actions: 64, usd: 10, call: 32_768}, stage);
    assert.ok(book.inputTokens > 721_191 + 500_000, 'the batch-6 refusal (used 721,191, asked 500,000) fits');
  }
  // Masks (669 pages): half the book read once, above the floor in every dimension.
  const masks = readingStageBudget('index', {pageCount: 669});
  assert.deepEqual({input: masks.inputTokens, output: masks.outputTokens, actions: masks.actions, usd: masks.costUsd},
    {input: 669 * 16_000 * 0.5, output: 669 * 1_000 * 0.5, actions: Math.ceil(669 * 0.5 * 0.5), usd: 669 * 0.03 * 0.5});
  assert.deepEqual([masks.inputTokens, masks.outputTokens, masks.actions], [5_352_000, 334_500, 168]);
  assert.equal(readingStageBudget('skeleton', {pageCount: 669}).inputTokens, 5_352_000);
  assert.equal(readingStageBudget('index', {pageCount: 100_000}).inputTokens, 40_000_000, 'the ceiling still caps it');
});

test('§20 addendum 3 a stage lease absorbs an overrun it can pay: the call is refused and typed, the lease goes on; one it cannot pay cancels it', async () => {
  const {budget, close} = openStageProviderBudget(readingStageBudget('detail', {pageCount: 111}));
  try {
    const overrun = await budget.reserve({model, inputTokens: 10_000, outputTokens: 8_192});
    const refusal = overrun.settle({input: 9_000, output: 9_470, cacheRead: 0, cacheWrite: 0, cost: {total: 0}});
    assert.deepEqual({reason: refusal.reason, code: refusal.code, dimension: refusal.dimension, requested: refusal.requested, reserved: refusal.reserved, overrun: refusal.overrun},
      {reason: 'budget_output_tokens', code: 'task_budget_overrun', dimension: 'outputTokens', requested: 9_470, reserved: 8_192, overrun: true});
    assert.equal(budget.signal.aborted, false, 'the lease is not cancelled');
    const next = await budget.reserve({model, inputTokens: 10_000, outputTokens: 8_192});
    assert.equal(next.settle({input: 9_000, output: 100, cacheRead: 0, cacheWrite: 0, cost: {total: 0}}), undefined, 'the next call reserves and settles as usual');
  } finally { close(); }
  // In debt: the lease's output remaining would go below zero, so the overrun still cancels it.
  const lease = new TaskLease({owner: 'debt', goal: 'Refuse an overrun that cannot be paid', scope: {owner: 'debt', audience: 'system'}, capabilities: [], readSet: [],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 100_000, remainingOutputTokens: 9_000, remainingCostUsd: 1, remainingActions: 5}});
  const charge = lease.reserve({inputTokens: 10, outputTokens: 8_192, costUsd: 0, actions: 1}, {absorbOverrun: true});
  assert.throws(() => charge.settle({outputTokens: 9_470}), error => error instanceof BudgetRefusal && error.code === 'task_budget_overrun');
  assert.equal(lease.signal.aborted, true);
  // Without the option (the Keeper's turn, the lanes, the fixed lease) any overrun still cancels.
  const plain = new TaskLease({owner: 'plain', goal: 'Cancel on an overrun', scope: {owner: 'plain', audience: 'system'}, capabilities: [], readSet: [],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 100_000, remainingOutputTokens: 100_000, remainingCostUsd: 1, remainingActions: 5}});
  const call = plain.reserve({inputTokens: 10, outputTokens: 8_192, costUsd: 0, actions: 1});
  assert.throws(() => call.settle({outputTokens: 9_470}), /task_budget_overrun/);
  assert.equal(plain.signal.aborted, true);
});
