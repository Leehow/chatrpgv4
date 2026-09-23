/** The typed speech-attribution family's own policy (contract §128.3): closed set, packing, typed result. */
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {
  SPEECH_ATTRIBUTION_FAMILY, SPEECH_ATTRIBUTION_MAX_PASSAGES, interpretSpeechAttribution, runSpeechAttribution,
  speakerOptions, speechAttributionBatch, speechAttributionBindings,
} from '../../runtime/jev/speech-attribution-domain.ts';

const input = (overrides = {}) => ({campaign: 'c1', turn: 2,
  passages: [
    {text: '「先去《环球报》。你是记者。」', before: '史蒂文·诺特用下巴朝窗外的街一扬。', after: '他用指节点了点桌面。'},
    {text: '「别在我这儿坐着。」', before: '他用指节点了点桌面。', after: ''},
  ],
  present: [{name: '史蒂文·诺特', also: ['诺特先生']}, {name: '看门人'}],
  investigators: [{name: '托马斯·海耶斯', occupation: '记者'}],
  spoken: [{speaker: '史蒂文·诺特', text: '「坐吧。」'}], ...overrides});
function lease(value) {
  const bindings = speechAttributionBindings(value);
  return new TaskLease({owner: SPEECH_ATTRIBUTION_FAMILY, goal: 'test', scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet,
    budget: {deadlineAt: Date.now() + 5000, remainingInputTokens: 100000, remainingOutputTokens: 10000, remainingCostUsd: 1, remainingActions: 2}});
}
const complete = (batch, pick) => ({batchId: batch.id, status: 'complete', issues: [], usage: {inputTokens: 500, outputTokens: 20, costUsd: 0.00002},
  coverage: {required: batch.questions.map(q => q.key), answered: batch.questions.map(q => q.key), unknown: []},
  answers: Object.fromEntries(batch.questions.map((q, index) => [q.key, {status: 'answered', type: 'choice', ...pick(q, index)}]))});
async function run(value, decide, options) {
  const owned = lease(value);
  try { return await runSpeechAttribution(value, {decide}, owned, options); } finally { owned.close(); }
}

test('the closed set is the people present, the party, not_speech and someone_else -- host aliases, names in the descriptors', () => {
  const batch = speechAttributionBatch(input());
  assert.equal(batch.family, SPEECH_ATTRIBUTION_FAMILY);
  assert.equal(batch.scope.audience, 'keeper');
  assert.deepEqual(batch.questions.map(q => [q.key, q.target, q.type]), [['speaker_0', 'passages[0]', 'choice'], ['speaker_1', 'passages[1]', 'choice']]);
  for (const question of batch.questions)
    assert.deepEqual(Object.keys(question.criteria), ['npc:1', 'npc:2', 'investigator:1', 'not_speech', 'someone_else']);
  const criteria = batch.questions[0].criteria;
  assert.match(criteria['npc:1'], /史蒂文·诺特.*also called 诺特先生/);
  assert.match(criteria['investigator:1'], /investigator 托马斯·海耶斯.*记者/);
  assert.deepEqual(speakerOptions(input()).map(option => [option.key, option.kind, option.person.name]),
    [['npc:1', 'npc', '史蒂文·诺特'], ['npc:2', 'npc', '看门人'], ['investigator:1', 'investigator', '托马斯·海耶斯']]);
});

test('the state carries the passages with their sentences, the roster and earlier lines, and nothing else', () => {
  const {state} = speechAttributionBatch(input());
  assert.deepEqual(Object.keys(state).sort(), ['investigators', 'passages', 'present', 'spokenEarlier']);
  assert.deepEqual(state.passages[0], {passage: 0, before: '史蒂文·诺特用下巴朝窗外的街一扬。', text: '「先去《环球报》。你是记者。」', after: '他用指节点了点桌面。'});
  assert.deepEqual(state.present, [{alias: 'npc:1', names: ['史蒂文·诺特', '诺特先生']}, {alias: 'npc:2', names: ['看门人']}]);
  assert.deepEqual(state.spokenEarlier, [{speaker: '史蒂文·诺特', text: '「坐吧。」'}]);
  // Earlier lines are bounded material, the newest kept.
  const many = Array.from({length: 30}, (_, index) => ({speaker: 'x', text: `line ${index}`}));
  assert.deepEqual(speechAttributionBatch(input({spoken: many})).state.spokenEarlier.map(row => row.text).at(-1), 'line 29');
  assert.equal(speechAttributionBatch(input({spoken: many})).state.spokenEarlier.length, 12);
  assert.doesNotThrow(() => packDecisionBatch(speechAttributionBatch(input())), 'one batch packs under the typed bound');
});

test('a confident person is attributed; not_speech is counted; low confidence and someone_else are undecided', async () => {
  const value = input({passages: [...input().passages, {text: '『环球报』', before: '桌上摊着一份', after: '。'}, {text: '「喂！」', before: '街上有人喊。', after: ''}]});
  const picks = [{choice: 'npc:1', confidence: 0.97}, {choice: 'investigator:1', confidence: 0.5}, {choice: 'not_speech', confidence: 0.6}, {choice: 'someone_else', confidence: 0.99}];
  const result = await run(value, async batch => complete(batch, (_, index) => picks[index]));
  assert.equal(result.status, 'decided');
  assert.equal(result.calls, 1);
  assert.equal(result.usage.inputTokens, 500);
  assert.deepEqual(result.lines.map(line => [line.passage, line.outcome, line.speaker?.name]),
    [[0, 'attributed', '史蒂文·诺特'], [1, 'undecided', undefined], [2, 'not_speech', undefined], [3, 'undecided', undefined]]);
  // The family bar is a policy knob, not a constant of the domain.
  const lower = await run(value, async batch => complete(batch, (_, index) => picks[index]), {minConfidence: 0.4});
  assert.equal(lower.lines[1].outcome, 'attributed');
  assert.deepEqual(lower.lines[1].speaker, {kind: 'investigator', name: '托马斯·海耶斯'});
});

test('an unissued key, an incomplete result, a throwing port or a foreign lease is a named fallback, never a guess', async () => {
  const cases = [
    [async batch => complete(batch, () => ({choice: 'npc:9', confidence: 0.99})), 'invalid_typed_answer'],
    [async batch => ({...complete(batch, () => ({choice: 'npc:1', confidence: 0.99})), status: 'incomplete', failure: {code: 'schema_error', retryable: false}}), 'schema_error'],
    [async batch => ({batchId: batch.id, status: 'unavailable', answers: {}, issues: [], coverage: {required: [], answered: [], unknown: []}, failure: {code: 'timeout', retryable: false}}), 'timeout'],
    [async () => { throw new Error('port down'); }, 'speech_attribution_owner_error'],
  ];
  for (const [decide, reason] of cases) {
    const result = await run(input(), decide);
    assert.equal(result.status, 'fallback');
    assert.equal(result.reason, reason);
  }
  const foreign = lease(input({turn: 9}));
  const mismatch = await runSpeechAttribution(input(), {decide: async () => { throw new Error('must not run'); }}, foreign);
  foreign.close();
  assert.equal(mismatch.reason, 'attempt_binding_mismatch');
});

test('bounds are checked before any request: no passages, too many, no roster', async () => {
  let calls = 0;
  const decide = async () => { calls++; throw new Error('must not run'); };
  assert.equal((await run(input({passages: []}), decide)).reason, 'no_passages');
  const many = Array.from({length: SPEECH_ATTRIBUTION_MAX_PASSAGES + 1}, () => ({text: '「是。」', before: '', after: ''}));
  assert.equal((await run(input({passages: many}), decide)).reason, 'too_many_passages');
  assert.equal((await run(input({present: [], investigators: []}), decide)).reason, 'no_roster');
  assert.equal(calls, 0);
});

test('interpretation reads only the issued answers', () => {
  const value = input();
  const batch = speechAttributionBatch(value);
  const result = complete(batch, () => ({choice: 'npc:2', confidence: 0.95}));
  const read = interpretSpeechAttribution(value, result);
  assert.deepEqual(read.lines.map(line => line.speaker), [{kind: 'npc', name: '看门人'}, {kind: 'npc', name: '看门人'}]);
  delete result.answers.speaker_1;
  assert.deepEqual(interpretSpeechAttribution(value, result), {status: 'fallback', reason: 'invalid_typed_answer'});
});
