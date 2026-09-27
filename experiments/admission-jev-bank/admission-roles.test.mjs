// SL-97 phase 2a: the role-first typed admission family (admission-roles.ts) and its replay wiring, on synthetic input.
// No retained evidence and no live call is read here.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {admissionJevBatches} from '../../runtime/jev/admission-domain.ts';
import {
  ROLE_OPTIONS, admitProbability, binaryConfidence, interpretRoles, lineKind, lineQuestions, lineVerdict, revisionFamilies, rolesBatches,
  rolesBindings, rolesCatalog, runAdmissionRoles,
} from './admission-roles.ts';
import {assemble, parseArgs, replayOne, v1LineAdmitMass} from './replay.mjs';

const input = (proposal = ['apply clue: clue="knott-answer"; from="Steven Knott"; how="Knott answers the question"', 'apply time: minutes=10; why="talking"']) => ({
  campaign: 'c1', turn: 3, tool: 'apply', proposal,
  playerText: 'I ask Knott what happened to the Macario family.',
  investigators: [{name: 'Thomas', occupation: 'journalist'}], scene: 'Office', present: ['Steven Knott'],
  delivered: [
    {turn: 1, player: null, keeper: 'Knott offers twenty dollars a day. The Globe, the Hall of Records and the neighbours are the places to try.'},
    {turn: 2, player: 'I take the job.', keeper: 'Knott pushes the keys across the desk and waits for your questions.'},
  ],
  landed: ['resolve settled (social)'], refused: [],
});
const optionsOf = (revision, name) => revisionFamilies(revision).find(family => family.name === name).options;
const CHOICE = optionsOf('2a.2', 'choice'), RESULT = optionsOf('2a.2', 'result'), SPAN = optionsOf('2a.2', 'span');
const TARGET = optionsOf('2a.2', 'target'), GATE = optionsOf('2a.2', 'gate');
const lease = (value, revision) => {
  const bindings = rolesBindings(value, revision);
  return new TaskLease({owner: 'action-admission', goal: 'test', scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet,
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 1, remainingActions: 8}});
};
const choiceAnswer = probabilities => {
  const choice = Object.entries(probabilities).reduce((a, b) => b[1] > a[1] ? b : a)[0];
  return {status: 'answered', type: 'choice', choice, confidence: 0.5, probabilities};
};
const one = (options, chosen, p = 1) => Object.fromEntries(options.map(option => [option, option === chosen ? p : (1 - p) / (options.length - 1)]));
const complete = answers => ({batchId: 'b', status: 'complete', answers, issues: [], coverage: {required: [], answered: [], unknown: []}});
/** A port that answers each question family from a table keyed by family then line; unlisted families pick their first option. */
function scripted(table) {
  let calls = 0;
  return {get calls() { return calls; }, async decide(batch) {
    calls++;
    const answers = Object.fromEntries(batch.questions.map(question => {
      const [family, line] = question.key.split('_');
      const options = Object.keys(question.criteria);
      const row = table[family]?.[Number(line)];
      if (family === 'missing' || family === 'basis') return [question.key, choiceAnswer(one(options, row ?? 'none'))];
      return [question.key, choiceAnswer(row ?? one(options, options[0]))];
    }));
    const keys = batch.questions.map(question => question.key);
    return {batchId: batch.id, status: 'complete', answers, issues: [], coverage: {required: keys, answered: keys, unknown: []}};
  }};
}

test('the state is §32.3 input as facts: no rules list, the newest delivery apart, each line with its closed kind', () => {
  const {state} = rolesCatalog(input());
  assert.equal(state.rules, undefined);
  assert.deepEqual(Object.keys(state).sort(), ['earlier', 'fieldNotes', 'investigators', 'justTold', 'playerWords', 'proposal', 'refusedThisTurn',
    'scene', 'settledThisTurn'].sort());
  assert.equal(state.justTold.turn, '2');
  assert.equal(state.earlier.length, 1);
  assert.equal(state.earlier[0].turn, '1');
  assert.deepEqual(state.proposal.map(line => line.kind), ['clue', 'time']);
  assert.equal(state.fieldNotes.unfinishedDeclaration, undefined);
  assert.deepEqual(state.playerWords.map(row => row.alias), ['said:0']);
  const unfinished = rolesCatalog({...input(), interruptedPlayerText: 'I was heading to the Globe.'}).state;
  assert.ok(unfinished.fieldNotes.unfinishedDeclaration);
  assert.equal(unfinished.unfinishedDeclaration[0].alias, 'unfinished:0');
});

test('the kind is read from the host line grammar only', () => {
  assert.equal(lineKind('resolve (roll the dice for an action): intent="social"'), 'resolve');
  assert.equal(lineKind('apply move: to="newspaper-morgue"'), 'move');
  assert.equal(lineKind('apply handout: name="x"'), 'handout');
  assert.equal(lineKind('something else'), 'unknown');
});

test('each line gets the role question and every conditional question of its revision, over closed option sets', () => {
  const catalog = rolesCatalog(input());
  const first = lineQuestions(1, catalog, {revision: '2a.1'});
  assert.deepEqual(first.map(question => question.key), ['role_1', 'choice_1', 'result_1', 'span_1', 'missing_1', 'basis_1']);
  assert.deepEqual(Object.keys(first[2].criteria), ['follows', 'needs_unchosen_act', 'unclear']);
  const second = lineQuestions(1, catalog);
  assert.deepEqual(second.map(question => question.key), ['role_1', 'choice_1', 'result_1', 'span_1', 'target_1', 'gate_1', 'missing_1', 'basis_1']);
  assert.deepEqual(Object.keys(second[0].criteria), [...ROLE_OPTIONS]);
  assert.deepEqual(Object.keys(second[2].criteria), [...RESULT]);
  assert.deepEqual(Object.keys(second[5].criteria), [...GATE]);
  assert.ok(second.every(question => question.instructions.includes('`proposal[1]`')));
  // Every family's admitting options are a proper, non-empty subset of its options: each question can refuse.
  for (const revision of ['2a.1', '2a.2', '2a.3']) for (const family of revisionFamilies(revision)) {
    assert.ok(family.admitting.length > 0 && family.admitting.every(option => family.options.includes(option)), family.name);
    assert.ok(family.options.some(option => !family.admitting.includes(option)), family.name);
  }
  const ablated = lineQuestions(0, catalog, {ablation: true});
  assert.equal(ablated.at(-1).key, 'single_0');
  assert.deepEqual(Object.keys(ablated.at(-1).criteria), ['player_chose', 'routine_step', 'not_investigator_choice', 'keeper_chooses', 'unclear']);
});

test('lines share one request while they fit, and split only at the packing bound', () => {
  assert.equal(rolesBatches(input()).batches.length, 1);
  assert.equal(rolesBatches(input(), undefined, {maxLinesPerBatch: 1}).batches.length, 2);
  // A long keeper history pushes each line's questions over the bound only when many lines share the batch.
  const long = {...input(Array.from({length: 8}, (_, index) => `apply clue: clue="c${index}"; how="${'x'.repeat(1500)}"`)),
    delivered: Array.from({length: 4}, (_, turn) => ({turn, player: 'p'.repeat(400), keeper: 'k'.repeat(1500)}))};
  const {batches} = rolesBatches(long, undefined, {revision: '2a.1'});
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flatMap(batch => batch.questions.filter(question => question.key.startsWith('role_')).map(question => question.key)),
    Array.from({length: 8}, (_, index) => `role_${index}`));
  assert.ok(rolesBatches(long).batches.length <= 3);
  // The v1 family needs four batches for the same eight lines.
  assert.equal(admissionJevBatches(long).batches.length, 4);
});

test('admit mass is the role mixture of the conditional answers, and confidence the two-option Choice confidence', () => {
  const role = {investigator_act: 0.2, world_response: 0.7, time_passing: 0.1};
  const p = admitProbability(role, {chosen: 0.1, routine_step: 0.1, keeper_choice: 0.7, unclear: 0.1}, {follows: 0.9, needs_unchosen_act: 0.05, unclear: 0.05},
    {fits: 0.5, unchosen_time: 0.4, unclear: 0.1});
  assert.ok(Math.abs(p - (0.2 * 0.2 + 0.7 * 0.9 + 0.1 * 0.5)) < 1e-12);
  assert.equal(binaryConfidence(0.95), 0.9);
  assert.equal(binaryConfidence(0.05), 0.9);
  assert.equal(binaryConfidence(0.5), 0);
});

test('2a.2: a target the player did not address, or an obstacle skipped, caps the line at its weakest judgment', () => {
  const value = input(['resolve (roll the dice for an action): intent="social"; target="the clerk"']);
  const {passages} = rolesBatches(value);
  const base = {role_0: choiceAnswer(one(ROLE_OPTIONS, 'investigator_act', 1)), choice_0: choiceAnswer(one(CHOICE, 'chosen', 1)),
    result_0: choiceAnswer(one(RESULT, 'answers_player', 1)), span_0: choiceAnswer(one(SPAN, 'activity_time', 1)),
    target_0: choiceAnswer(one(TARGET, 'addressed', 1)), gate_0: choiceAnswer(one(GATE, 'no_obstacle', 1)),
    missing_0: choiceAnswer({none: 1}), basis_0: choiceAnswer({none: 1})};
  const read = answers => interpretRoles(value, complete(answers), passages, 0);
  assert.equal(read(base).lines[0].pAdmit, 1);
  const unaddressed = read({...base, target_0: choiceAnswer({addressed: 0.1, no_target: 0.1, not_addressed: 0.8})}).lines[0];
  assert.equal(unaddressed.pAdmit, 0.2);
  assert.equal(unaddressed.admit, false);
  assert.equal(unaddressed.verdict, 'not_authorized');
  assert.equal(read({...base, gate_0: choiceAnswer({no_obstacle: 0.05, player_takes_it_on: 0.05, skips_obstacle: 0.9})}).lines[0].pAdmit, 0.1);
  // A world response is not capped by the act's target question.
  const world = read({...base, role_0: choiceAnswer(one(ROLE_OPTIONS, 'world_response', 1)), target_0: choiceAnswer({addressed: 0, no_target: 0, not_addressed: 1})});
  assert.equal(world.lines[0].pAdmit, 1);
  assert.equal(world.lines[0].verdict, 'not_player_action');
  // Both admitting readings of a world response count: a manifestation on its own admits like an answer the player asked for.
  const manifestation = read({...base, role_0: choiceAnswer(one(ROLE_OPTIONS, 'world_response', 1)),
    result_0: choiceAnswer({answers_player: 0.3, world_on_its_own: 0.65, needs_unchosen_act: 0.05, unclear: 0})});
  assert.equal(manifestation.lines[0].pAdmit, 0.95);
  // Likewise time the world imposes admits like the time a chosen activity takes.
  const kept = read({...base, role_0: choiceAnswer(one(ROLE_OPTIONS, 'time_passing', 1)),
    span_0: choiceAnswer({activity_time: 0.1, imposed_time: 0.85, unchosen_time: 0.05, unclear: 0})});
  assert.equal(kept.lines[0].pAdmit, 0.95);
});

test('2a.3: a line that gets ahead of the order or a condition the player set is capped like a skipped obstacle', () => {
  const value = input(['resolve (roll the dice for an action): intent="investigate"; skill="Library Use"']);
  const {passages} = rolesBatches(value, undefined, {revision: '2a.3'});
  assert.deepEqual(lineQuestions(0, rolesCatalog(value), {revision: '2a.3'}).map(question => question.key),
    ['role_0', 'choice_0', 'result_0', 'span_0', 'target_0', 'gate_0', 'order_0', 'missing_0', 'basis_0']);
  const choice3 = optionsOf('2a.3', 'choice');
  const base = {role_0: choiceAnswer(one(ROLE_OPTIONS, 'investigator_act', 1)), choice_0: choiceAnswer(one(choice3, 'chosen', 1)),
    result_0: choiceAnswer(one(RESULT, 'answers_player', 1)), span_0: choiceAnswer(one(SPAN, 'activity_time', 1)),
    target_0: choiceAnswer(one(TARGET, 'no_target', 1)), gate_0: choiceAnswer(one(GATE, 'no_obstacle', 1)),
    order_0: choiceAnswer({in_step: 1, ahead_of_plan: 0}), missing_0: choiceAnswer({none: 1}), basis_0: choiceAnswer({none: 1})};
  const read = answers => interpretRoles(value, complete(answers), passages, 0, {revision: '2a.3'});
  assert.equal(read(base).lines[0].pAdmit, 1);
  assert.equal(read({...base, order_0: choiceAnswer({in_step: 0.15, ahead_of_plan: 0.85})}).lines[0].pAdmit, 0.15);
  // 2a.2 never asked it, so the same answers without it still read there.
  const {order_0: _order, ...without} = base;
  assert.equal(interpretRoles(value, complete(without), passages, 0, {revision: '2a.2'}).lines[0].pAdmit, 1);
  assert.equal(read(without).reason, 'invalid_typed_answer');
});

test('a line maps to the lane label of its dominant role, and a refusal reads unclear as uncertain', () => {
  const act = {investigator_act: 0.8, world_response: 0.1, time_passing: 0.1}, world = {investigator_act: 0.1, world_response: 0.8, time_passing: 0.1};
  const choice = {chosen: 0.3, routine_step: 0.6, keeper_choice: 0.05, unclear: 0.05};
  assert.equal(lineVerdict(true, {role: act, choice}), 'entailed');
  assert.equal(lineVerdict(true, {role: act, choice: {...choice, chosen: 0.7, routine_step: 0.2}}), 'authorized');
  assert.equal(lineVerdict(true, {role: world, choice, result: {follows: 1}}), 'not_player_action');
  assert.equal(lineVerdict(false, {role: act, choice: {chosen: 0.1, routine_step: 0.1, keeper_choice: 0.2, unclear: 0.6}}), 'uncertain');
  assert.equal(lineVerdict(false, {role: act, choice: {chosen: 0.1, routine_step: 0.1, keeper_choice: 0.7, unclear: 0.1}}), 'not_authorized');
});

test('an NPC answer the player asked for admits confidently even though the player did not choose its content', async () => {
  const port = scripted({
    role: [one(ROLE_OPTIONS, 'world_response', 0.96), one(ROLE_OPTIONS, 'time_passing', 0.98)],
    choice: [one(CHOICE, 'keeper_choice', 0.9), one(CHOICE, 'unclear', 0.7)],
    result: [one(RESULT, 'answers_player', 0.98), one(RESULT, 'answers_player', 0.9)],
    span: [one(SPAN, 'unclear', 0.5), one(SPAN, 'activity_time', 0.99)],
  });
  const value = input(), owned = lease(value);
  const result = await runAdmissionRoles(value, port, owned, {minConfidence: 0.87});
  owned.close();
  assert.equal(result.status, 'decided');
  assert.equal(result.admit, true);
  assert.deepEqual(result.lines.map(line => line.verdict), ['not_player_action', 'entailed']);
  assert.ok(result.confidence >= 0.87);
  assert.equal(port.calls, 1);
});

test('under the minimum the answer is a fallback that still carries every line; a refusal carries host-rendered text', async () => {
  const unsure = scripted({role: [one(ROLE_OPTIONS, 'investigator_act', 0.5), one(ROLE_OPTIONS, 'time_passing', 0.9)],
    choice: [one(CHOICE, 'keeper_choice', 1)]});
  const value = input(), owned = lease(value);
  const low = await runAdmissionRoles(value, unsure, owned, {minConfidence: 0.87});
  owned.close();
  assert.equal(low.status, 'fallback');
  assert.equal(low.reason, 'low_confidence');
  assert.equal(low.lines.length, 2);
  const refuse = scripted({
    role: [one(ROLE_OPTIONS, 'investigator_act', 1), one(ROLE_OPTIONS, 'time_passing', 1)],
    choice: [one(CHOICE, 'keeper_choice', 1), one(CHOICE, 'chosen', 1)],
    span: [undefined, one(SPAN, 'activity_time', 1)],
    missing: ['destination'], basis: ['said:0'],
  });
  const owned2 = lease(value);
  const refused = await runAdmissionRoles(value, refuse, owned2, {minConfidence: 0.5});
  owned2.close();
  assert.equal(refused.status, 'decided');
  assert.equal(refused.admit, false);
  assert.equal(refused.verdict, 'not_authorized');
  assert.match(refused.missing, /^the player has not chosen this destination: apply clue/);
  assert.match(refused.grounds, /^Decided by the player's words this turn: "I ask Knott/);
});

test('a revision mismatch between the lease and the request is a binding fallback, not a call', async () => {
  const value = input(), owned = lease(value, '2a.1'), port = scripted({});
  const result = await runAdmissionRoles(value, port, owned, {minConfidence: 0});
  owned.close();
  assert.equal(result.reason, 'attempt_binding_mismatch');
  assert.equal(port.calls, 0);
});

test('an answer with no distribution, or an unissued basis alias, is invalid, never a verdict', () => {
  const value = input(['apply time: minutes=5']);
  const {passages} = rolesBatches(value);
  const good = {role_0: choiceAnswer(one(ROLE_OPTIONS, 'time_passing')), choice_0: choiceAnswer(one(CHOICE, 'chosen')),
    result_0: choiceAnswer(one(RESULT, 'answers_player')), span_0: choiceAnswer(one(SPAN, 'activity_time')),
    target_0: choiceAnswer(one(TARGET, 'no_target')), gate_0: choiceAnswer(one(GATE, 'no_obstacle')),
    missing_0: choiceAnswer({none: 1}), basis_0: choiceAnswer({none: 1})};
  assert.equal(interpretRoles(value, complete(good), passages, 0).status, 'decided');
  assert.equal(interpretRoles(value, complete({...good, role_0: {status: 'answered', type: 'choice', choice: 'time_passing', confidence: 1}}), passages, 0).reason,
    'invalid_typed_answer');
  assert.equal(interpretRoles(value, complete({...good, basis_0: choiceAnswer({'said:99': 1})}), passages, 0).reason, 'invalid_typed_answer');
  const {gate_0: _dropped, ...noGate} = good;
  assert.equal(interpretRoles(value, complete(noGate), passages, 0).reason, 'invalid_typed_answer');
  assert.equal(interpretRoles(value, {...complete(good), status: 'unavailable', failure: {code: 'timeout', retryable: true}}, passages, 0).reason, 'timeout');
});

test('replay: --design v2 parses, extras join the sample once, unlabelled cases can be skipped', () => {
  assert.equal(parseArgs(['--bank', 'b', '--out', 'o', '--port', 'shape']).design, 'v1');
  const parsed = parseArgs(['--bank', 'b', '--out', 'o', '--port', 'live', '--design', 'v2', '--ablation', '--extra', 'x', '--skip-unlabelled', '--per-class', '5',
    '--revision', '2a.1']);
  assert.deepEqual([parsed.design, parsed.ablation, parsed.extra, parsed.skipUnlabelled, parsed.perClass, parsed.revision], ['v2', true, ['x'], true, 5, '2a.1']);
  assert.throws(() => parseArgs(['--bank', 'b', '--out', 'o', '--port', 'live', '--ablation']));
  assert.throws(() => parseArgs(['--bank', 'b', '--out', 'o', '--port', 'live', '--design', 'v2', '--revision', '9']));
  const row = (id, verdict) => ({id, lane: {verdict}});
  assert.deepEqual(assemble([row('a', 'authorized'), row('b', null)], [row('a', 'authorized'), row('c', 'entailed')], false).map(value => value.id), ['a', 'b', 'c']);
  assert.deepEqual(assemble([row('a', 'authorized'), row('b', null)], [row('c', 'entailed')], true).map(value => value.id), ['a', 'c']);
});

test('replay: v1 keeps its per-line admit mass from the raw distributions', () => {
  const results = [{answers: {verdict_0: {probabilities: {authorized: 0.3, entailed: 0.25, not_player_action: 0.1, not_authorized: 0.3, uncertain: 0.05}}}},
    {answers: {verdict_1: {probabilities: {authorized: 0.9, entailed: 0.05, not_player_action: 0, not_authorized: 0.05, uncertain: 0}}}}];
  assert.deepEqual(v1LineAdmitMass(results, 3), [0.65, 0.95, null]);
});

test('replay: the v2 echo port maps every lane verdict back to itself through the role questions', async () => {
  for (const revision of ['2a.1', '2a.2', '2a.3']) for (const verdict of ['authorized', 'entailed', 'not_player_action', 'not_authorized', 'uncertain']) {
    const value = {id: 'x', lane: {verdict, model: 'm', ms: 1}, verb: 'apply', source: {kind: 'driver', run: 'table'}, kinds: ['clue'],
      input: input(['apply clue: clue="a"'])};
    const row = await replayOne(value, 'echo', undefined, 'v2', true, revision);
    assert.equal(row.route, 'typed');
    assert.equal(row.jev, verdict, `${revision} ${verdict}`);
    assert.equal(row.confidence, 1);
  }
});

test('no CJK in the experiment code (system language is English)', () => {
  const cjk = new RegExp(['[', '\\u3000-\\u9fff', '\\uac00-\\ud7af', '\\uff00-\\uffef', ']'].join(''), 'u');
  for (const file of ['admission-roles.ts', 'replay.mjs', 'sl97b-analyze.mjs', 'sl97b-holdout.mjs', 'admission-roles.test.mjs', 'sl97b-analyze.test.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), cjk, file);
  }
});
