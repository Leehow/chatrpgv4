import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {expressionBatch, expressionBindings, runExpressionDecision, interpretExpressionDecision} from '../../runtime/jev/npc-expression-domain.ts';

const input = () => ({kind: 'material', resource: 'frozen-source', revision: 'source-v1',
  records: [{id: 'exchange-1', source: 'A asks. B answers.', turns: [{quote: 'May I enter?'}, {quote: 'Tomorrow.'}], speaker_candidates: ['A', 'B']}],
  tags: [{id: 'practical', description: 'A practical request and response.'}]});
function lease(value) {
  const binding = expressionBindings(value);
  return new TaskLease({owner: binding.scope.owner, goal: 'bounded material decision', ...binding, capabilities: ['decision'],
    budget: {deadlineAt: Date.now() + 5000, remainingInputTokens: 200000, remainingOutputTokens: 10000, remainingCostUsd: 1, remainingActions: 2}});
}
const complete = batch => ({batchId: batch.id, status: 'complete', issues: [],
  coverage: {required: batch.questions.map(q => q.key), answered: batch.questions.map(q => q.key), unknown: []},
  answers: Object.fromEntries(batch.questions.map(q => [q.key, q.type === 'noul'
    ? {status: 'answered', type: 'noul', noul: 0.99}
    : {status: 'answered', type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.95}]))});

test('material admission, each speaker, mode and independent semantic tags share bounded source state', () => {
  const batch = expressionBatch(input());
  assert.doesNotThrow(() => packDecisionBatch(batch));
  assert.equal(batch.questions.filter(q => q.type === 'noul').length, 2);
  assert.equal(batch.questions.filter(q => q.type === 'choice').length, 4);
  for (const q of batch.questions) assert.ok(q.instructions.includes('records[0]'));
  for (const q of batch.questions.filter(q => q.target.endsWith('.speaker')))
    assert.ok(Object.hasOwn(q.criteria, 'insufficient_evidence'));
});

test('no complete result or an unissued candidate leaves the decision unresolved', () => {
  const value = input(), batch = expressionBatch(value), result = complete(batch);
  const speaker = batch.questions.find(q => q.target.endsWith('.speaker'));
  result.answers[speaker.key].choice = 'invented_person';
  assert.equal(interpretExpressionDecision(batch, result).status, 'unresolved');
  const missing = complete(batch); delete missing.answers[batch.questions[0].key];
  assert.equal(interpretExpressionDecision(batch, missing).status, 'unresolved');
});

test('a source or taxonomy change cannot reuse an old lease or answer', async () => {
  const value = input(), owned = lease(value);
  let calls = 0;
  try {
    const changed = {...value, tags: [{id: 'practical', description: 'Changed criterion.'}]};
    const result = await runExpressionDecision(changed, {decide: async () => {calls++;}}, owned);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.reason, 'attempt_binding_mismatch');
    assert.equal(calls, 0);
    const batch = expressionBatch(value), stale = complete(expressionBatch({...value, revision: 'v2'}));
    assert.equal(interpretExpressionDecision(batch, stale).status, 'unresolved');
  } finally {owned.close();}
});

test('matching tests every candidate independently and can reject all of them', () => {
  const batch = expressionBatch({kind: 'match', resource: 'index', revision: 'v1', condition: 'Clarifying a misunderstanding.',
    records: [{id: 'a', source: 'A threat.'}, {id: 'b', source: 'A greeting.'}], tags: []});
  assert.equal(batch.questions.length, 2);
  assert.ok(batch.questions.every(q => q.type === 'noul'));
  const result = complete(batch);
  for (const answer of Object.values(result.answers)) answer.noul = 0.01;
  const read = interpretExpressionDecision(batch, result);
  assert.equal(read.status, 'answered');
  assert.deepEqual(Object.values(read.answers).map(a => a.noul), [0.01, 0.01]);
});
