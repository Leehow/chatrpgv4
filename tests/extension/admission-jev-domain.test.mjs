/** The typed admission family's own policy (contract §32.10): every non-verdict is a named fallback. */
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {admissionJevBatches, admissionJevBindings, batchVerdict, runAdmissionJev} from '../../runtime/jev/admission-domain.ts';

const input = (overrides = {}) => ({campaign: 'c1', turn: 3, tool: 'apply', proposal: ['apply move: to="morgue"', 'apply clue: clue="c"'],
  playerText: 'I go to the morgue. I read the files.', investigators: [{name: 'Thomas', occupation: 'journalist'}], scene: 'Office',
  present: ['Knott'], delivered: [{turn: 2, player: 'hello', keeper: 'Knott names the Globe morgue and the library.'}], landed: [], refused: [], ...overrides});
function lease(value) {
  const bindings = admissionJevBindings(value);
  return new TaskLease({owner: 'action-admission', goal: 'test', scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet,
    budget: {deadlineAt: Date.now() + 5000, remainingInputTokens: 100000, remainingOutputTokens: 10000, remainingCostUsd: 1, remainingActions: 4}});
}
const complete = (batch, pick) => ({batchId: batch.id, status: 'complete', issues: [],
  coverage: {required: batch.questions.map(q => q.key), answered: batch.questions.map(q => q.key), unknown: []},
  answers: Object.fromEntries(batch.questions.map(q => [q.key, {status: 'answered', type: 'choice', ...pick(q)}]))});

test('a batch is admitted only when every line admits; the first refusing kind names it', () => {
  assert.equal(batchVerdict(['authorized', 'entailed']), 'authorized');
  assert.equal(batchVerdict(['entailed', 'not_player_action']), 'entailed');
  assert.equal(batchVerdict(['not_player_action']), 'not_player_action');
  assert.equal(batchVerdict(['authorized', 'uncertain']), 'uncertain');
  assert.equal(batchVerdict(['uncertain', 'not_authorized', 'authorized']), 'not_authorized');
});

test('passage aliases cover the player words and every delivery, and are the only basis options', () => {
  const {batches: [batch], passages} = admissionJevBatches(input());
  const basis = Object.keys(batch.questions.find(q => q.key === 'basis_0').criteria);
  assert.deepEqual(basis.filter(key => key !== 'none').sort(), [...passages.keys()].sort());
  assert.equal(batch.state.playerWords.map(row => row.text).join(''), 'I go to the morgue. I read the files.');
  assert.equal(batch.state.playerWords.length, 2, 'sentence segmentation, not one blob');
  assert.equal(batch.scope.audience, 'player');
});

test('an unissued basis alias, an incomplete result or an absent confidence is a fallback, never a verdict', async () => {
  const value = input();
  const cases = [
    [batch => complete(batch, q => ({choice: q.key.startsWith('basis') ? 'said:99' : q.key.startsWith('verdict') ? 'authorized' : 'none', confidence: 0.99})), 'invalid_typed_answer'],
    [batch => ({...complete(batch, () => ({choice: 'none'})), status: 'incomplete', failure: {code: 'schema_error', retryable: false}}), 'schema_error'],
    [batch => ({batchId: batch.id, status: 'unavailable', answers: {}, issues: [], coverage: {required: [], answered: [], unknown: []}, failure: {code: 'timeout', retryable: false}}), 'timeout'],
    [batch => complete(batch, q => ({choice: q.key.startsWith('verdict') ? 'authorized' : 'none'})), 'low_confidence'],
  ];
  for (const [answer, reason] of cases) {
    const owned = lease(value);
    const result = await runAdmissionJev(value, {decide: async batch => answer(batch)}, owned);
    owned.close();
    assert.equal(result.status, 'fallback');
    assert.equal(result.reason, reason);
  }
});

test('a batch over the packing bound falls back before any request', async () => {
  const long = 'x'.repeat(1500);
  const value = input({delivered: Array.from({length: 40}, (_, turn) => ({turn, player: long, keeper: long}))});
  let calls = 0;
  const owned = lease(value);
  const result = await runAdmissionJev(value, {decide: async () => { calls++; throw new Error('must not run'); }}, owned);
  owned.close();
  assert.equal(calls, 0);
  assert.equal(result.status, 'fallback');
  assert.equal(result.reason, 'packing_limit');
});

test('a lease bound to another input is refused as an attempt mismatch', async () => {
  const owned = lease(input({playerText: 'something else'}));
  const result = await runAdmissionJev(input(), {decide: async () => { throw new Error('must not run'); }}, owned);
  owned.close();
  assert.equal(result.reason, 'attempt_binding_mismatch');
});

test('an admitting verdict carries no missing; an uncertain one says so and names the line', async () => {
  const value = input();
  const owned = lease(value);
  const result = await runAdmissionJev(value, {decide: async batch => complete(batch, q => ({
    choice: q.key === 'verdict_1' ? 'uncertain' : q.key.startsWith('verdict') ? 'authorized' : q.key.startsWith('basis') ? 'none' : 'none', confidence: 0.95}))}, owned);
  owned.close();
  assert.equal(result.status, 'decided');
  assert.equal(result.verdict, 'uncertain');
  assert.match(result.missing, /^whether the player chose this is not clear from their words: apply clue: clue="c"$/);
  assert.match(result.grounds, /^No player-visible passage chooses it; typed review judged line 2 uncertain/);
});

test('a long proposal is split into same-state batches sent together, and one refusing line refuses the whole', async () => {
  const value = input({proposal: ['apply move: to="a"', 'apply clue: clue="b"', 'apply time: minutes=10', 'apply clue: clue="d"', 'apply item: name="e"']});
  const {batches} = admissionJevBatches(value);
  assert.deepEqual(batches.map(batch => batch.questions.filter(q => q.key.startsWith('verdict_')).map(q => q.key)),
    [['verdict_0', 'verdict_1'], ['verdict_2', 'verdict_3'], ['verdict_4']]);
  assert.ok(batches.every(batch => JSON.stringify(batch.state) === JSON.stringify(batches[0].state)), 'one shared state');
  const pending = [];
  const owned = lease(value);
  const running = runAdmissionJev(value, {decide: batch => new Promise(resolve => pending.push(() => resolve(complete(batch, q => ({
    choice: q.key === 'verdict_4' ? 'not_authorized' : q.key.startsWith('verdict') ? 'authorized' : 'none', confidence: 0.95})))))}, owned);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 3, 'no batch waits for a peer');
  for (const release of pending) release();
  const result = await running;
  owned.close();
  assert.equal(result.calls, 3);
  assert.equal(result.verdict, 'not_authorized');
  assert.match(result.grounds, /line 5 not_authorized \(apply item: name="e"\)/);
});
