import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCheck, specializedTriggerQuestion, validateCheckOptions} from '../../runtime/jev/resolve-selection.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {initialView, next, startStep, settleCheckSelection, settleExecute, settleRead, keeperOwns, interpretBind, interpretRoute} from '../../runtime/jev/step-policy.ts';
import {COMPILE_PREDICATES} from '../../runtime/jev/route-compile.ts';

const scope = {owner: 'check-selection', campaign: 'table', worldline: 'main', loop: 0, audience: 'keeper'};
const listen = {key: 'listen', family: 'core-check', label: 'Listen', action: {actor: 'Ada', decision: 'core-check:ordinary-check', skill: 'Listen'},
  parameters: [], needs: [], authorization: 'declaration'};
const spot = {...listen, key: 'spot', label: 'Spot Hidden', action: {...listen.action, skill: 'Spot Hidden'}};

const social = {key: 'social', family: 'social', label: 'Ada influences the attendant',
  action: {actor: 'Ada', target: 'Attendant', decision: 'social:adjudicate-difficulty', intent: 'social'},
  facts: {stage: 'difficulty_adjudication', actor_role: 'investigator', target_role: 'npc'},
  parameters: [{name: 'skill', question: 'Which declared social approach?', options: [{label: 'Persuade', value: 'Persuade'}]}],
  needs: [], authorization: 'declaration'};

test('a player influence attempt reaches preliminary adjudication without requiring NPC work consent or claiming a roll', async t => {
  const {input, seen} = setup(t, (_batch, question) => question.type === 'noul' ? noul(.99) : choice(question, 'value_0'), [social]);
  input.declaration = 'I ask the attendant to waive the labor fee and try to persuade him that I cannot afford it.';
  input.context = {public_exchange: 'The attendant offered paid help. No waiver has been agreed.', current_receipts: []};
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.decision, 'social:adjudicate-difficulty');
  assert.equal(result.action.skill, 'Persuade');
  const batch = seen.find(batch => batch.family === 'check-selection-need');
  assert.deepEqual(batch.state.checks.check_0.facts, social.facts);
  assert.ok(batch.questions[0].instructions.includes('preliminary difficulty adjudication, not yet a dice roll'));
  assert.ok(batch.state.policy.includes('possible tool invocation template'));
  assert.ok(batch.questions[0].instructions.includes('Ordinary factual questions or service inquiries'));
  assert.equal(result.action.motive, undefined, 'the trigger must not invent target willingness or motive');
});

test('§163: the social method gate keeps a confident negative; a gray method is Jev\'s best guess, recorded as forced; NPC executor consent stays', async t => {
  for (const [p, status, forced] of [[.1, 'no_roll', false], [.5, 'no_roll', true], [.3, 'no_roll', false]]) {
    const {input} = setup(t, () => noul(p), [social]);
    const result = await selectCheck(input);
    assert.equal(result.status, status, `p=${p}`);
    assert.equal(!!result.forced, forced, `p=${p}`);
    if (forced) {
      assert.deepEqual(result.forced.uncertain, ['social influence method of Ada: p=0.5']);
      assert.equal(result.forced.why, 'below_confidence_gate');
    }
  }
  assert.equal(specializedTriggerQuestion({...social, facts: {...social.facts, actor_role: 'npc'}}), undefined);
});

test('routine service requests do not become uncertain influence checks against a second possible NPC', async t => {
  const second = {...social, key: 'second', label: 'Ada influences the other attendant', action: {...social.action, target: 'Other attendant'}};
  const {input, seen} = setup(t, batch => noul(batch.family === 'check-selection-social-method' ? .1 : .5), [social, second]);
  input.declaration = 'I greet the person in charge and ask to see a room before deciding whether to rent it.';
  input.context = {public_narration: 'Two people are present behind the counter and at the kitchen door.',
    public_exchange: '', secret: 'Unrelated private source context must not enter method classification.'};
  const result = await selectCheck(input);
  assert.equal(result.status, 'no_roll');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].family, 'check-selection-social-method');
  assert.equal(JSON.stringify(seen[0].state).includes('secret'), false);
  assert.equal(JSON.stringify(seen[0].state).includes('Other attendant'), false, 'target ambiguity cannot contaminate method recognition');
});

test('social method retrieval does not substitute its applicability gate for target necessity; §163 a gray necessity is Jev\'s best guess', async t => {
  for (const [need, expected, forced] of [[.5, 'no_roll', true], [.6, 'selected', true], [.9, 'selected', false]]) {
    const {input} = setup(t, (batch, question) => batch.family === 'check-selection-social-method' ? noul(.7)
      : question.type === 'noul' ? noul(need) : choice(question, 'value_0'), [social]);
    const result = await selectCheck(input);
    assert.equal(result.status, expected, `need=${need}`);
    assert.equal(!!result.forced, forced, `need=${need}`);
    if (forced) assert.ok(result.forced.uncertain.some(entry => entry.startsWith(`necessity of ${social.label}: needed now p=${need}`)), result.forced.uncertain.join('; '));
    if (expected === 'selected') assert.equal(result.action.skill, 'Persuade');
  }
});

test('§163 turn 9 of mood-live-20261001: a social necessity of .75/.74 with its prerequisite at .34/.36 is rolled as Jev\'s best guess', async t => {
  const social9 = {...social, label: '托马斯·海斯: influence 隔壁亮灯那家的人 with a social approach', action: {...social.action, actor: '托马斯·海斯', target: '隔壁亮灯那家的人'}};
  const {input, seen} = setup(t, (batch, question) => batch.family === 'check-selection-social-method' ? noul(.82)
    : question.type === 'choice' ? choice(question, 'value_0')
    : question.key.endsWith('_blocked') ? noul(batch.family.endsWith('-refine') ? .36 : .34) : noul(batch.family.endsWith('-refine') ? .74 : .75), [social9]);
  const port = input.decision;
  input.decision = {async decide(batch) {
    const result = await port.decide(batch);
    for (const question of batch.questions) if (question.key.endsWith('_blocked')) result.answers[question.key] = noul(batch.family.endsWith('-refine') ? .36 : .34);
    return result;
  }};
  input.declaration = '我去敲隔壁亮着灯那家的门，等有人开门，就说我是替房东来查这栋空房子的，想请教几句。';
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.decision, 'social:adjudicate-difficulty');
  assert.equal(result.action.target, '隔壁亮灯那家的人');
  assert.deepEqual(result.forced, {uncertain: [`necessity of ${social9.label}: needed now p=0.74, prerequisite unmet p=0.36`], why: 'below_confidence_gate'});
  assert.equal(seen.filter(batch => batch.family.endsWith('-refine')).length, 1, 'the bounded refinement still runs first');
});

test('source-specific checks reach their binder before a general skill search', () => {
  const ordinary = {key: 'ordinary', verb: 'resolve', family: 'core-check', label: 'ordinary check', clerk: 'declared_check',
    checkOwner: 'jev', source: 'catalog', bound: {decision: 'core-check:ordinary-check'},
    unbound: [{name: 'parameters', required: true, vocabulary: 'closed', binder: 'resolve-selection'}]};
  const sanity = {...ordinary, key: 'san', family: 'sanity', bound: {decision: 'sanity:check'}};
  assert.ok(!COMPILE_PREDICATES.some(predicate => predicate.reads(ordinary)), 'a broad investigate act does not preempt family routing');
  const view = initialView({runId: 'r', rawInput: 'I uncover the moving corpse.', context: {scene: 'cellar', receipts: [], present: [], clock: {}}, candidates: [ordinary, sanity]});
  const choice = {status: 'answered', type: 'choice', choice: 'now', confidence: 1, probabilities: {now: 1}};
  const routed = interpretRoute(view, [ordinary, sanity], {status: 'complete', answers: {need_1: choice, need_2: choice}}, .6);
  assert.deepEqual(routed.selected, ['san', 'ordinary']);
});
function setup(t, choose, options = [listen, spot]) {
  const lease = new TaskLease({owner: 'check-selection', goal: 'Listen then look', scope, readSet: [], capabilities: ['decision'],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
  t.after(() => lease.close());
  const seen = [];
  return {seen, input: {options, request: {decision: options[0].action.decision, bound: {}}, declaration: 'I listen first, then inspect the room.', context: {receipts: [], secret: 'private clue'},
    publicContext: [{role: 'player', text: 'I listen first, then inspect the room.'}], scope, readSet: [], lease,
    decision: {async decide(batch) {
      seen.push(batch);
      const answers = Object.fromEntries(batch.questions.map(question => [question.key, question.key.endsWith('_blocked') ? noul(0.01) : choose(batch, question)]));
      return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
    }}}};
}
const noul = value => ({status: 'answered', type: 'noul', noul: value});
const choice = (question, selected, p = 1) => ({status: 'answered', type: 'choice', choice: selected, confidence: p,
  probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? p : (1 - p) / (Object.keys(question.criteria).length - 1)]))});

test('independent declared methods do not compete in a next-check Choice', async t => {
  const {input, seen} = setup(t, (batch, question) => question.type === 'noul' ? noul(0.99) : choice(question, 'check_0'));
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Listen');
  assert.equal(seen.find(batch => batch.family === 'check-selection-need').questions.length, 6);
  assert.equal(seen.some(batch => batch.family === 'check-selection-order'), false);
  assert.equal(seen.some(batch => batch.family === 'check-selection-authority'), false, 'canonical admission remains the consent owner');
  assert.equal(result.calls, 1);
});

test('a settled first method leaves the second method, without another first roll', async t => {
  const {input} = setup(t, () => noul(0.99));
  input.context = {current_receipts: [{kind: 'roll', actor: 'Ada', skill: 'Listen', passed: false}]};
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Spot Hidden');
});

test('current-agent scope is reused without another family decision or an automatic roll', async t => {
  const {input, seen} = setup(t, (_batch, question) => question.type === 'noul' ? noul(0.99) : choice(question, 'value_0'));
  input.request = {decision: listen.action.decision, bound: {actor: 'Ada'}};
  assert.equal((await selectCheck(input)).status, 'selected');
  assert.ok(seen.every(batch => !['check-selection-family', 'check-selection-order'].includes(batch.family)));
  assert.equal(seen.find(batch => batch.family === 'check-selection-need').questions.some(question => question.key.endsWith('_uncertain')), true);
  input.request = {decision: listen.action.decision, bound: {actor: 'Someone else'}};
  assert.deepEqual((await selectCheck(input)).needs, ['check_request_options_unavailable']);
});

test('unmet prerequisites defer a check; §163 a gray prerequisite is Jev\'s best guess (a tie is not blocked)', async t => {
  for (const [blocked, expected] of [[0.01, 'selected'], [0.99, 'deferred'], [0.5, 'selected'], [0.7, 'deferred']]) {
    const {input} = setup(t, () => noul(0.99), [listen]);
    const port = input.decision;
    input.decision = {async decide(batch) {
      const result = await port.decide(batch);
      for (const question of batch.questions) if (question.key.endsWith('_blocked')) result.answers[question.key] = noul(blocked);
      return result;
    }};
    const result = await selectCheck(input);
    assert.equal(result.status, expected, `blocked=${blocked}`);
    assert.equal(!!result.forced, blocked === 0.5 || blocked === 0.7, `blocked=${blocked}`);
  }
});

test('§163: a confident no-roll, an ambiguous need and a missing provider answer all resolve, and stay distinct in the record', async t => {
  for (const [answer, why] of [[0.01, undefined], [0.5, 'below_confidence_gate'], [undefined, 'jev_unanswered']]) {
    const {input} = setup(t, () => answer === undefined ? {status: 'unknown'} : noul(answer));
    const result = await selectCheck(input);
    assert.equal(result.status, 'no_roll', `answer=${answer}`);
    assert.equal(result.forced?.why, why, `answer=${answer}`);
    if (why) assert.equal(result.forced.uncertain.length, 2, 'both methods are named');
  }
});

test('ordinary necessity requires both method fit and a rule need', async t => {
  for (const key of ['check_0', 'check_0_uncertain']) {
    for (const [p, expected, forced] of [[0.1, 'no_roll', false], [0.4, 'no_roll', true], [0.64, 'selected', true], [0.65, 'selected', false], [0.9, 'selected', false]]) {
      const {input} = setup(t, (batch, question) => noul(batch.family.startsWith('check-selection-need') && question.key === key ? p : 0.99), [listen]);
      const result = await selectCheck(input);
      assert.equal(result.status, expected, `${key}=${p}`);
      assert.equal(!!result.forced, forced, `${key}=${p}`);
    }
  }
});

test('actual settlement is a host fact and cannot be overridden by confident model answers', async t => {
  const {input, seen} = setup(t, () => noul(0.99), [listen]);
  const roll = {kind: 'roll', actor: 'Ada', skill: 'Listen', passed: false};
  input.context = {current_receipts: [roll]};
  assert.equal((await selectCheck(input)).status, 'no_roll');
  assert.equal(seen.length, 0);
  input.context = {current_receipts: [roll, {kind: 'move', scene_change: false}]};
  assert.equal((await selectCheck(input)).status, 'no_roll', 'renaming a scene does not reopen a check');
  input.context = {current_receipts: [roll, {kind: 'move', scene_change: true}]};
  assert.equal((await selectCheck(input)).status, 'selected', 'a new scene can contain a new attempt');
  input.context = {current_receipts: [{...roll, actor: 'Ben'}]};
  assert.equal((await selectCheck(input)).status, 'selected', 'another actor did not settle this attempt');
});

test('one need refinement isolates a candidate without carrying prior answers or losing evidence', async t => {
  const {input, seen} = setup(t, (batch, question) => noul(batch.family === 'check-selection-need'
    ? question.target === 'Listen' ? 0.6 : 0.1 : 0.95));
  input.context = {rules: ['Only uncertain consequential attempts need a roll.'], current_receipts: [], source: 'A concealed sound.'};
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Listen');
  assert.equal(result.calls, 2);
  const refined = seen.find(batch => batch.family === 'check-selection-need-refine');
  assert.deepEqual(Object.keys(refined.state.checks), ['check_0']);
  assert.deepEqual(refined.state.context, input.context);
  assert.equal(JSON.stringify(refined.state).includes('0.6'), false);
  assert.equal(refined.questions.length, 3);
});

test('an explicit gray method is refined before a ready later method can hide it', async t => {
  for (const refinedNeed of [0.9, 0.59]) {
    const {input, seen} = setup(t, (batch, question) => noul(question.key === 'check_0_uncertain'
      ? batch.family.endsWith('-refine') ? refinedNeed : 0.59 : 0.95));
    const result = await selectCheck(input);
    // §163: still gray after its one refinement, the explicit method is Jev's best guess and keeps its catalog precedence.
    assert.equal(result.status, 'selected');
    assert.equal(result.action?.skill, 'Listen');
    assert.equal(!!result.forced, refinedNeed !== 0.9);
    assert.equal(seen.filter(batch => batch.family.endsWith('-refine')).length, 1);
  }
});

test('a broad receipt goal cannot settle a different remaining method in retrieval', async t => {
  const options = [listen, spot, ...Array.from({length: 13}, (_, i) => ({...listen, key: `other-${i}`, label: `Other ${i}`, action: {...listen.action, skill: `Other ${i}`}}))];
  const {input, seen} = setup(t, (batch, question) => question.type === 'choice'
    ? choice(question, Object.entries(question.criteria).find(([, profile]) => profile?.skill === 'Listen')?.[0] ?? 'unknown')
    : noul(question.target === 'Listen' ? 0.99 : 0.01), options);
  input.context = {current_receipts: [{kind: 'roll', actor: 'Ada', skill: 'Spot Hidden', goal: 'I listen then inspect.'}]};
  const result = await selectCheck(input);
  assert.equal(result.action.skill, 'Listen');
  assert.ok(seen.find(batch => batch.family === 'check-selection-profiles').questions.every(question => question.type === 'choice'));
  assert.ok(seen.every(batch => batch.state.context.current_receipts[0].goal === undefined));
  assert.equal(input.context.current_receipts[0].goal, 'I listen then inspect.', 'the retained caller evidence is not mutated');
});

test('refinement cannot resurrect rejected, unknown, source-missing or blocked candidates', async t => {
  for (const mode of ['negative', 'unknown', 'missing', 'blocked']) {
    const option = {...listen, needs: mode === 'missing' ? ['source_required'] : []};
    const {input, seen} = setup(t, (_batch, question) => question.key === 'check_0'
      ? mode === 'unknown' ? {status: 'unknown'} : noul(mode === 'negative' ? 0.2 : 0.6) : noul(0.95), [option]);
    const port = input.decision;
    if (mode === 'blocked') input.decision = {async decide(batch) {
      const result = await port.decide(batch);
      result.answers.check_0_blocked = noul(0.99);
      return result;
    }};
    assert.notEqual((await selectCheck(input)).status, 'selected', mode);
    assert.equal(seen.some(batch => batch.family.endsWith('-refine')), false, mode);
  }
});

test('weak Choice uses one absolute Noul; §163 below it the best-scored issued value is forced, never an invented one', async t => {
  const option = {...listen, parameters: [{name: 'difficulty', question: 'Required success level?',
    options: [{label: 'Regular', value: 'regular'}, {label: 'Hard', value: 'hard'}]}]};
  for (const confirmation of [0.95, 0.5, 0.1, undefined]) {
    const {input, seen} = setup(t, (batch, question) => batch.family === 'check-selection-bind-refine'
      ? confirmation === undefined ? {status: 'unknown'} : noul(confirmation)
      : question.type === 'choice' ? choice(question, 'value_1', 0.6) : noul(0.99), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, 'selected');
    assert.equal(result.action?.difficulty, 'hard');
    assert.deepEqual(result.forced, confirmation === 0.95 ? undefined : {uncertain: ['difficulty: Hard p=0.6'], why: 'below_confidence_gate'});
    const refinements = seen.filter(batch => batch.family.endsWith('-refine'));
    assert.equal(refinements.length, 1);
    assert.equal(refinements[0].questions[0].type, 'noul');
    assert.equal(refinements[0].questions[0].criteria.true.nominee, 'Hard');
    assert.deepEqual(refinements[0].questions[0].criteria.false.alternatives, ['Regular']);
  }
});

test('a need refinement spends the only extra round even if parameters remain ambiguous', async t => {
  const option = {...listen, parameters: [{name: 'difficulty', question: 'Required success level?',
    options: [{label: 'Regular', value: 'regular'}, {label: 'Hard', value: 'hard'}]}]};
  const {input, seen} = setup(t, (batch, question) => question.type === 'choice' ? choice(question, 'value_1', 0.6)
    : noul(batch.family === 'check-selection-need' ? 0.6 : 0.99), [option]);
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.difficulty, 'hard', 'the second gray gate takes the best-scored value without another round');
  assert.deepEqual(result.forced.uncertain, ['difficulty: Hard p=0.6']);
  assert.equal(seen.filter(batch => batch.family.endsWith('-refine')).length, 1);
  assert.equal(seen.some(batch => batch.family === 'check-selection-bind-refine'), false);
});

test('ambiguous default conditions may be refined once; §163 an unanswered override takes the rules default, recorded as forced', async t => {
  const option = {...listen, parameters: [{name: 'bonus', question: 'Granted bonus dice?',
    options: [{label: 'Zero', value: 'none'}, {label: 'One', value: 'one'}],
    default: {value: 'none', question: 'Does an established advantage grant bonus dice?'}}]};
  for (const confirmation of [0.1, undefined]) {
    const {input, seen} = setup(t, (batch, question) => batch.family === 'check-selection-defaults-refine'
      ? confirmation === undefined ? {status: 'unknown'} : noul(confirmation)
      : noul(batch.family === 'check-selection-defaults' ? 0.5 : 0.99), [option]);
    const result = await selectCheck(input);
    assert.equal(result.action?.bonus, 'none');
    assert.deepEqual(result.forced, confirmation === 0.1 ? undefined : {uncertain: ['bonus override: unanswered, rules default'], why: 'jev_unanswered'});
    assert.equal(seen.filter(batch => batch.family.endsWith('-refine')).length, 1);
  }
});

test('a selected specialized check reports missing source instead of becoming ordinary', async t => {
  const option = {...listen, family: 'sanity', label: 'Source sanity check', action: {decision: 'sanity:check'}, needs: ['source_san_loss']};
  const {input} = setup(t, () => noul(0.99), [option]);
  const result = await selectCheck(input);
  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.needs, ['source_san_loss']);
  assert.equal(result.option.family, 'sanity');
  assert.equal(result.action, undefined);
});

test('closed parameters use only issued values; §163 an uncertain binding is the best-scored issued value, and an all-unknown answer is no roll', async t => {
  const option = {...listen, parameters: [{name: 'difficulty', question: 'Required success level?', options: [{label: 'Regular', value: 'regular'}, {label: 'Hard', value: 'hard'}]}]};
  for (const p of [0.99, 0.55]) {
    const {input} = setup(t, (batch, question) => question.type === 'noul' ? noul(batch.family === 'check-selection-bind-refine' ? 0.5 : 0.99) : choice(question, 'value_1', p), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, 'selected');
    assert.equal(result.action?.difficulty, 'hard');
    assert.equal(!!result.forced, p < 0.85);
  }
  const {input} = setup(t, (_batch, question) => question.type === 'noul' ? noul(0.99) : choice(question, 'unknown', 1), [option]);
  const result = await selectCheck(input);
  assert.equal(result.status, 'no_roll', 'no issued value carries any score: nothing is invented');
  assert.deepEqual(result.needs, ['unbound:difficulty']);
  assert.deepEqual(result.forced, {uncertain: ['Listen unbound:difficulty: unanswered'], why: 'jev_unanswered'});
  assert.equal(result.action, undefined);
});

test('rule defaults apply on a confident absence of modifiers; §163 a gray or failed override answer is decided and recorded', async t => {
  const option = {...listen, parameters: [{name: 'bonus', question: 'Number of granted bonus dice?',
    options: [{label: 'Zero', value: 'none'}, {label: 'One', value: 'one'}],
    default: {value: 'none', question: 'Does an established advantage grant any bonus dice?'}}]};
  for (const [override, expected, forced] of [[0.1, 'none', false], [0.95, 'one', false], [0.5, 'none', true], [0.7, 'one', true], [undefined, 'none', true]]) {
    const {input, seen} = setup(t, (batch, question) => batch.family.startsWith('check-selection-defaults')
      ? override === undefined ? {status: 'unknown'} : noul(override)
      : question.type === 'noul' ? noul(0.99) : choice(question, 'value_0'), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, 'selected', `override=${override}`);
    assert.equal(result.action?.bonus, expected, `override=${override}`);
    assert.equal(!!result.forced, forced, `override=${override}`);
    if (override === 0.1) assert.equal(seen.some(batch => batch.family === 'check-selection-bind'), false);
    if (override === 0.95) assert.equal(Object.values(seen.find(batch => batch.family === 'check-selection-bind').questions[0].criteria).includes('Zero'), false);
  }
  assert.equal(validateCheckOptions([{...option, parameters: [{...option.parameters[0], default: {value: 'invented', question: 'Override?'}}]}]), undefined);
});

test('the binder returns the complete patient proposal for canonical admission without claiming consent', async t => {
  const option = {...listen, family: 'healing', label: 'First Aid', action: {actor: 'Ada', decision: 'healing:first-aid-ordinary'},
    parameters: [{name: 'target', question: 'Who is treated?', options: [{label: 'Ben', value: 'Ben'}, {label: 'Cara', value: 'Cara'}]}]};
  const {input, seen} = setup(t, (_batch, question) => question.type === 'choice' ? choice(question, 'value_1') : noul(0.99), [option]);
  input.declaration = 'I treat Ben.';
  const result = await selectCheck(input);
  assert.equal(result.action.target, 'Cara', 'a model answer is only a proposal; it must still pass canonical admission');
  assert.equal(result.status, 'selected');
  assert.equal(seen.some(batch => batch.family === 'check-selection-authority'), false);
});

test('the selected decision is scoped before examining concrete candidates', async t => {
  const treatment = {...listen, key: 'aid', family: 'healing', label: 'First Aid', action: {decision: 'healing:first-aid-ordinary', actor: 'Ada'}};
  const {input, seen} = setup(t, (batch, question) => {
    assert.notEqual(batch.family, 'check-selection-family');
    return question.type === 'noul' ? noul(batch.family === 'check-selection-need' && question.target === 'First Aid' ? 0.01 : 0.99)
      : choice(question, 'check_0');
  }, [listen, treatment]);
  input.request = {decision: listen.action.decision, bound: {actor: 'Ada'}};
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Listen');
  assert.deepEqual(Object.values(seen.find(batch => batch.family === 'check-selection-need').state.checks).map(check => check.action.decision), [listen.action.decision]);
});

test('exhausted selection budget cannot start another provider request', async t => {
  const {input, seen} = setup(t, () => noul(0.99), [listen]);
  input.options = [{...listen, parameters: [{name: 'difficulty', question: 'Difficulty?', options: [{label: 'Regular', value: 'regular'}]}]}];
  input.maxCalls = 1;
  const result = await selectCheck(input);
  assert.equal(seen.length, 1);
  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.needs, ['check_selection_budget']);
});

test('a combined check binds an explicit set; §163 an uncertain member set is Jev\'s best-scored members up to the minimum', async t => {
  const option = {...listen, action: {actor: 'Ada', decision: 'core-check:combined-check'}, parameters: [{name: 'skills',
    question: 'Which skills does this combined attempt require?', multiple: {minimum: 2},
    options: ['Listen', 'Spot Hidden', 'Library Use'].map(value => ({label: value, value}))}]};
  for (const uncertain of [false, true]) {
    const {input} = setup(t, (batch, question) => noul(batch.family.startsWith('check-selection-bind')
      ? question.key === 'parameter_0_2' ? 0.01 : uncertain && question.key === 'parameter_0_1' ? 0.5 : 0.99 : 0.99), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, 'selected');
    assert.deepEqual(result.action?.skills, ['Listen', 'Spot Hidden']);
    assert.deepEqual(result.forced, uncertain ? {uncertain: ['skills: Listen p=0.99, Spot Hidden p=0.5, Library Use p=0.01'], why: 'below_confidence_gate'} : undefined);
  }
});

test('a split profile ranking retains both listening and looking for independent need judgments', async t => {
  const options = [...Array.from({length: 13}, (_, i) => ({...listen, key: `other-${i}`, label: `Other ${i}`, action: {...listen.action, skill: `Other ${i}`}})), listen, spot];
  const {input, seen} = setup(t, (batch, question) => {
    if (batch.family === 'check-selection-profiles' && question.type === 'choice') return {status: 'answered', type: 'choice', choice: 'check_13', confidence: 0,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === 'check_13' || key === 'check_14' ? 0.49 : key === 'unknown' ? 0.02 : 0]))};
    if (question.type === 'noul') return noul(0.99);
    return choice(question, 'check_0');
  }, options);
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Listen');
  assert.deepEqual(seen.find(batch => batch.family === 'check-selection-need').questions.filter(question => !question.key.endsWith('_uncertain') && !question.key.endsWith('_unsettled') && !question.key.endsWith('_blocked')).map(question => question.target), ['Listen', 'Spot Hidden']);
});

test('a hung provider is cancelled by the lease without a fallback', async t => {
  const {input} = setup(t, () => noul(1));
  input.decision = {decide: () => new Promise(() => {})};
  const result = selectCheck(input);
  input.lease.cancel('test_cancel');
  assert.equal((await result).status, 'unresolved');
});

const candidate = {key: 'resolve:selection:state', verb: 'resolve', family: 'check_selection', source: 'table.resolve.options', label: 'Select checks',
  bound: {}, basis: {compile: {predicate: 'ordinary_check'}}, unbound: [{name: 'check', required: true, vocabulary: 'closed', binder: 'resolve-selection'}], clerk: 'declared_check', checkOwner: 'jev'};

test('a stale check rebinds once from refreshed candidates; §163 another stale or a refusal is a recorded no-roll, never a notice', () => {
  const selected = {...candidate, key: 'bound-old', bound: listen.action, unbound: []};
  const freshCandidate = {...candidate, key: 'fresh-request', bound: {decision: listen.action.decision}};
  const context = {scene: 'hall', clock: {}, present: []};
  const view = initialView({runId: 'stale-run', rawInput: 'I listen.', context, candidates: [selected]});
  const fresh = {context, candidates: [freshCandidate]};
  const fail = {ok: false, summary: {refusal: 'check_selection_stale'}};
  settleExecute(view, 1, {kind: 'direct', purpose: 'execute', candidate: selected}, fail, fresh, 2);
  assert.equal(view.checkRefreshUsed, true);
  assert.equal(view.pending[0].purpose, 'bind');
  assert.equal(view.pending[0].candidate.key, freshCandidate.key);
  assert.equal(view.pending.some(item => item.reason === 'clerk_refused'), false);
  assert.equal(view.unresolvedChecks?.length ?? 0, 0);
  view.pending = [];
  settleExecute(view, 2, {kind: 'direct', purpose: 'execute', candidate: selected}, fail, fresh, 2);
  assert.equal(view.pending[0].reason, 'clerk_refused');
  assert.equal(view.unresolvedChecks, undefined);
  assert.deepEqual(view.forced.map(({family, uncertain, chosen, why}) => ({family, uncertain, chosen, why})),
    [{family: 'check-execution', uncertain: ['check_selection_stale'], chosen: {outcome: 'no_roll'}, why: 'check_refused'}]);
  const refused = initialView({runId: 'refused-run', rawInput: 'I listen.', context, candidates: [selected]});
  settleExecute(refused, 1, {kind: 'direct', purpose: 'execute', candidate: selected}, {ok: false, summary: {refusal: 'action_not_admitted'}}, fresh, 2);
  assert.equal(refused.checkRefreshUsed, undefined);
  assert.equal(refused.pending[0].reason, 'clerk_refused');
  assert.deepEqual(refused.forced.map(entry => entry.uncertain), [['action_not_admitted']]);
});

test('ordinary bookkeeping cannot re-open an unresolved check in the same run and scene', () => {
  const request = {...candidate, bound: {decision: listen.action.decision}};
  const context = {scene: 'hall', clock: {}, present: []};
  const view = initialView({runId: 'held-run', rawInput: 'I listen.', context, candidates: [request]});
  settleCheckSelection(view, request, {status: 'unresolved', needs: ['check_selection_unavailable'], calls: 2}, 2);
  assert.deepEqual(view.candidates, [], 'the next route cannot retry the same question even without a fresh read');
  assert.deepEqual(view.forced.map(({family, uncertain, chosen, why}) => ({family, uncertain, chosen, why})),
    [{family: 'check-selection', uncertain: ['check_selection_unavailable'], chosen: {outcome: 'no_roll'}, why: 'jev_unanswered'}],
    '§163: nothing scored is a recorded no-roll');
  assert.equal(view.unresolvedChecks, undefined, 'no unresolved notice is owed');
  const refreshed = {...request, key: 'new-revision'};
  const treatment = {...request, key: 'treatment', bound: {decision: 'healing:first-aid-ordinary'}};
  const read = {materials: [], summary: {}, calls: 0, ms: 0};
  settleRead(view, 3, read, {context, candidates: [refreshed, treatment]}, 1);
  assert.deepEqual(view.candidates.map(row => row.key), ['treatment']);
  settleRead(view, 4, read, {context: {...context, scene: 'attic'}, candidates: [refreshed]}, 1);
  assert.deepEqual(view.candidates.map(row => row.key), ['new-revision']);
  const nextRun = initialView({runId: 'next-input', rawInput: 'I listen again.', context, candidates: [refreshed]});
  assert.equal(nextRun.heldCheckDecisions, undefined);
  assert.equal(nextRun.candidates.length, 1);
});

test('an unavailable chase participant catalog requests preparation before any semantic necessity question', async t => {
  const unavailable = {key: 'missing-chase', family: 'chase', label: 'Prepare chase participants',
    action: {decision: 'chase:start', intent: 'move'}, parameters: [],
    needs: ['check_arguments_unavailable:chase:start'], authorization: 'declaration'};
  const {input, seen} = setup(t, () => {throw new Error('no semantic question has a concrete participant');}, [unavailable]);
  input.request = {decision: 'chase:start', bound: {}};
  const result = await selectCheck(input);
  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.needs, unavailable.needs);
  assert.equal(result.calls, 0);
  assert.equal(seen.length, 0);
  assert.equal(result.preparation.decision, 'chase:start');
});

test('a preparation hold permits agent preparation and re-opens only on a newly executable catalog', () => {
  const request = {...candidate, bound: {decision: 'chase:start'}};
  const context = {scene: 'road', clock: {}, present: []};
  const view = initialView({runId: 'prepare-run', rawInput: 'I flee the tailgating cars.', context, candidates: [request]});
  settleCheckSelection(view, request, {status: 'unresolved', needs: ['check_arguments_unavailable:chase:start'], calls: 0,
    preparation: {decision: 'chase:start', needs: ['check_arguments_unavailable:chase:start']}}, 0);
  assert.equal(view.pending[0].purpose, 'adjudicate');
  assert.equal(view.pending[0].reason, 'check_preparation');
  const refreshed = {...request, key: 'new-revision', detail: {check_options: [{needs: ['check_arguments_unavailable:chase:start'], parameters: []}]}};
  const read = {materials: [], summary: {}, calls: 0, ms: 0};
  settleRead(view, 3, read, {context, candidates: [refreshed]}, 1);
  assert.deepEqual(view.candidates, []);
  const ready = {...refreshed, key: 'participants-ready', detail: {check_options: [{needs: [], parameters: [{name: 'intent', available: true}]}]}};
  settleRead(view, 4, read, {context, candidates: [ready]}, 1);
  assert.deepEqual(view.candidates.map(c => c.key), ['participants-ready']);
});
test('the existing agent schedules the check bind and its execution before compose', () => {
  const view = initialView({runId: 'run', rawInput: 'I listen.', context: {scene: 'hall', clock: {}, present: []}, candidates: [candidate], readFirst: false});
  view.pending = [{kind: 'infer', purpose: 'compose', reason: 'finish'}];
  assert.equal(next(view).purpose, 'compose', 'a binder does not take over the agent compose');
  view.pending.unshift({kind: 'decide', purpose: 'bind', candidate});
  const request = next(view);
  assert.equal(request.purpose, 'bind');
  startStep(view, request);
  assert.equal(view.pending[0].purpose, 'compose');
  settleCheckSelection(view, candidate, {status: 'selected', option: listen, action: listen.action, needs: [], calls: 2}, 20);
  assert.equal(view.pending[0].purpose, 'execute');
  assert.equal(view.pending[0].candidate.bound.skill, 'Listen');
  assert.equal(view.pending[0].candidate.basis.compile, undefined, 'selecting a capability cannot exempt its new parameters from admission');
  assert.equal(view.pending[0].candidate.basis.check_request_compile.predicate, 'ordinary_check');
  assert.equal(view.pending[1].purpose, 'compose');
  assert.ok(view.consumed.includes(candidate.key));
});

test('unresolved check parameters cannot go to LLM adjudication or a guessed skill default', () => {
  assert.equal(keeperOwns({...candidate, family: 'combat'}, 'unavailable', ['weapon'])[0].purpose, 'compose');
  const check = {...candidate, unbound: [{name: 'skill', required: true, vocabulary: 'closed', options: ['Listen'], ruleDefault: {rule: 'highest_offered_skill', value: 'Listen'}}]};
  const result = interpretBind(check, {questions: []}, undefined, 0.6);
  assert.equal(result.pending[0].reason, 'check_unresolved');
  assert.ok(result.pending.every(item => item.kind !== 'direct'));
});

test('catalog rejects duplicate issued identities and duplicate argument bindings', () => {
  assert.equal(validateCheckOptions([listen, listen]), undefined);
  assert.equal(validateCheckOptions([{...listen, parameters: [{name: 'skill', question: 'x', options: []}, {name: 'skill', question: 'y', options: []}]}]), undefined);
  assert.deepEqual(validateCheckOptions([listen]), [listen]);
});

test('a permissible SAN response does not require every other permissible response to be disproved', async t => {
  const option = {key: 'san', family: 'sanity', label: 'SAN on seeing the horror', authorization: 'consequence', needs: [],
    action: {actor: 'Ada', decision: 'sanity:check', target: 'The horror', san_loss: '1/1D8'},
    parameters: [{name: 'involuntary', selection: 'compatible', question: 'Choose an immediate involuntary response.',
      options: [{label: 'cry_out', value: 'cry_out'}, {label: 'freeze', value: 'freeze'}]}]};
  const {input, seen} = setup(t, (batch, q) => noul(batch.family.startsWith('check-selection-bind') ? q.target.endsWith('freeze') ? .79 : .76 : .99), [option]);
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.involuntary, 'freeze');
  assert.ok(seen.filter(batch => batch.family === 'check-selection-bind').every(batch => batch.questions.every(q => q.type === 'noul')));
  // §163: no response clears adjudication; Jev's best-scored compatible response is the ruling (a tie keeps issued order).
  const doubtful = setup(t, (batch, q) => noul(batch.family.startsWith('check-selection-bind') ? q.target.endsWith('freeze') ? .41 : .5 : .99), [option]);
  const forced = await selectCheck(doubtful.input);
  assert.equal(forced.status, 'selected');
  assert.equal(forced.action.involuntary, 'cry_out');
  assert.deepEqual(forced.forced, {uncertain: ['involuntary: cry_out p=0.5'], why: 'below_confidence_gate'});
  const silent = setup(t, (batch) => batch.family.startsWith('check-selection-bind') ? {status: 'unknown'} : noul(.99), [option]);
  const none = await selectCheck(silent.input);
  assert.equal(none.status, 'no_roll', 'no score at all is the no-roll path');
  assert.deepEqual(none.needs, ['unbound:involuntary']);
});

test('§163: a forced selection executes as chosen and is recorded once; a forced no-roll holds its decision and is recorded', () => {
  const request = {...candidate, bound: {decision: listen.action.decision}};
  const context = {scene: 'hall', clock: {}, present: []};
  const view = initialView({runId: 'forced-run', rawInput: 'I listen.', context, candidates: [request]});
  const forced = {uncertain: ['necessity of Listen: method fit p=0.99, roll needed p=0.7, prerequisite unmet p=0.01'], why: 'below_confidence_gate'};
  settleCheckSelection(view, request, {status: 'selected', option: listen, action: listen.action, needs: [], calls: 2, forced}, 2);
  assert.equal(view.pending[0].purpose, 'execute');
  assert.equal(view.pending[0].candidate.bound.skill, 'Listen');
  assert.deepEqual(view.forced.map(({family, subject, uncertain, chosen, why}) => ({family, subject, uncertain, chosen, why})),
    [{family: 'check-selection', subject: 'Listen', uncertain: forced.uncertain, chosen: {outcome: 'roll', check: 'Listen', action: listen.action}, why: 'below_confidence_gate'}]);
  assert.equal(view.heldCheckDecisions, undefined, 'a chosen roll is not a hold');
  settleCheckSelection(view, request, {status: 'selected', option: listen, action: listen.action, needs: [], calls: 0, forced}, 0);
  assert.equal(view.forced.length, 1, 'the same forced decision is recorded once');
  const quiet = initialView({runId: 'forced-no-roll', rawInput: 'I listen.', context, candidates: [request]});
  settleCheckSelection(quiet, request, {status: 'no_roll', needs: [], calls: 2, forced: {uncertain: ['necessity of Listen: method fit p=0.4'], why: 'below_confidence_gate'}}, 2);
  assert.ok(!quiet.pending.some(item => item.purpose === 'execute'), 'nothing is executed for a forced no-roll');
  assert.equal(quiet.forced[0].chosen.outcome, 'no_roll');
  assert.equal(quiet.heldCheckDecisions.length, 1, 'the run does not ask the same decision again');
  assert.equal(quiet.unresolvedChecks, undefined);
});

test('§163: a jev-owned check parameter below the gate takes Jev\'s leading issued answer, uncleared for admission; no lead is the Keeper\'s no-roll', () => {
  const blow = {...candidate, key: 'blow', clerk: 'first_blow', family: 'combat', label: 'Strike the ghoul', bound: {decision: 'combat:attack'},
    unbound: [{name: 'target', required: true, vocabulary: 'closed', options: ['Ghoul', 'Rat']}]};
  const answer = (choice, confidence) => ({status: 'complete', answers: {target: {status: 'answered', type: 'choice', choice, confidence,
    probabilities: {Ghoul: choice === 'Ghoul' ? .6 : .1, Rat: .3, unknown: choice === 'unknown' ? .6 : .1}}}});
  const bound = interpretBind(blow, {questions: []}, answer('Ghoul', 0.4), 0.85);
  assert.equal(bound.pending[0].kind, 'direct');
  assert.equal(bound.pending[0].extra.target, 'Ghoul');
  assert.equal(bound.bindings.find(entry => entry.name === 'target').cleared, false, 'admission reviews it without the compile exemption');
  assert.deepEqual({family: bound.forced.family, uncertain: bound.forced.uncertain, outcome: bound.forced.chosen.outcome},
    {family: 'check-binding', uncertain: ['target: Ghoul confidence 0.4'], outcome: 'roll'});
  const view = initialView({runId: 'bind-run', rawInput: 'I strike the ghoul.', context: {scene: 'crypt', clock: {}, present: []}, candidates: [blow]});
  view.pending = [{kind: 'decide', purpose: 'bind', candidate: blow}];
  const unknown = interpretBind(blow, {questions: []}, answer('unknown', 0.6), 0.85);
  assert.equal(unknown.forced, undefined);
  assert.equal(unknown.pending[0].reason, 'check_unresolved', 'the engine records this compose as a forced no-roll');
});

test('§163: a forced deferral stays open for the attempt it waits on; the same decision in another scene is recorded again', () => {
  const request = {...candidate, bound: {decision: listen.action.decision}};
  const view = initialView({runId: 'deferred-run', rawInput: 'I listen after the door opens.', context: {scene: 'hall', clock: {}, present: []}, candidates: [request]});
  settleCheckSelection(view, request, {status: 'deferred', needs: [], calls: 2, forced: {uncertain: ['prerequisite unmet p=0.7'], why: 'below_confidence_gate'}}, 2);
  assert.equal(view.heldCheckDecisions, undefined, 'a deferred attempt is not held');
  assert.equal(view.forced[0].chosen.outcome, 'deferred');
  const quiet = {status: 'no_roll', needs: [], calls: 1, forced: {uncertain: ['necessity of Listen: roll needed p=0.4'], why: 'below_confidence_gate'}};
  settleCheckSelection(view, request, quiet, 1);
  view.context = {...view.context, scene: 'attic'};
  settleCheckSelection(view, {...request, key: 'attic-request'}, quiet, 1);
  assert.deepEqual(view.forced.map(entry => entry.chosen.outcome), ['deferred', 'no_roll', 'no_roll'], 'one record per scene');
});

test('§163: a host selection code is a no-roll because nothing could execute; a failed provider is a no-roll because Jev gave no answer', () => {
  const request = {...candidate, bound: {decision: listen.action.decision}};
  const why = needs => {
    const view = initialView({runId: 'codes', rawInput: 'I listen.', context: {scene: 'hall', clock: {}, present: []}, candidates: [request]});
    settleCheckSelection(view, request, {status: 'unresolved', needs, calls: 0}, 0);
    return view.forced[0].why;
  };
  for (const code of ['check_selection_stale', 'distinct_attempt_binding_required', 'check_session_owner', 'check_catalog_binding_changed'])
    assert.equal(why([code]), 'nothing_executable', code);
  for (const failure of ['network_error', 'check_selection_unavailable', 'check_selection_budget', 'jev_budget'])
    assert.equal(why([failure]), 'jev_unanswered', failure);
});

// ---- §163.8 (owner ruling 2026-10-01: 「玩家的选择不替他定」) -------------------------------------------------------------

test('§163.8: two gray methods of the player\'s own investigator are the player\'s open choice -- no roll; the same for a non-party actor is a best guess', async t => {
  for (const investigators of [['Ada'], []]) {
    const {input} = setup(t, (batch, question) => noul(batch.family.startsWith('check-selection-need') && question.key.endsWith('_uncertain') ? 0.99
      : batch.family.startsWith('check-selection-need') && !question.key.endsWith('_blocked') ? 0.6 : 0.99));
    input.investigators = investigators;
    const result = await selectCheck(input);
    if (investigators.length) {
      assert.equal(result.status, 'no_roll');
      assert.equal(result.forced.why, 'player_choice');
      assert.equal(result.forced.uncertain.filter(entry => /alternatives the player has not settled/.test(entry)).length, 2);
    } else {
      assert.equal(result.status, 'selected');
      assert.equal(result.action.skill, 'Listen', 'catalog order');
    }
  }
});

test('§163.8: one gray method with its alternative ruled out is a best guess even for the player\'s investigator', async t => {
  const {input} = setup(t, (batch, question) => noul(!batch.family.startsWith('check-selection-need') || question.key.endsWith('_blocked') ? 0.99
    : question.target === 'Spot Hidden' ? 0.01 : 0.6));
  input.investigators = ['Ada'];
  const result = await selectCheck(input);
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Listen');
  assert.equal(result.forced.why, 'below_confidence_gate');
});

test('§163.8: the player\'s approach below its gate is withheld; an NPC executor\'s, a rules modifier and a Keeper ruling are still best guesses', async t => {
  const gray = (batch, question) => question.type === 'choice' ? choice(question, 'value_0', 0.55) : noul(batch.family === 'check-selection-bind-refine' ? 0.4 : 0.99);
  const twoSkills = {...social.parameters[0], options: [{label: 'Persuade', value: 'Persuade'}, {label: 'Charm', value: 'Charm'}]};
  const player = setup(t, gray, [{...social, parameters: [twoSkills]}]);
  const withheld = await selectCheck(player.input);
  assert.deepEqual([withheld.status, withheld.forced.why, withheld.needs], ['no_roll', 'player_choice', ['player_choice:skill']]);
  assert.deepEqual(withheld.forced.uncertain, ['skill: Persuade p=0.55 (the player\'s choice)']);
  assert.equal(withheld.action, undefined);
  const npcOption = {...social, facts: {...social.facts, actor_role: 'npc'}, parameters: [twoSkills]};
  const npc = setup(t, gray, [npcOption]);
  const guessed = await selectCheck(npc.input);
  assert.deepEqual([guessed.status, guessed.action.skill, guessed.forced.why], ['selected', 'Persuade', 'below_confidence_gate']);
  const modifier = {...listen, parameters: [{name: 'difficulty', question: 'Required success level?', options: [{label: 'Regular', value: 'regular'}, {label: 'Hard', value: 'hard'}],
    default: {value: 'regular', question: 'Does anything override the regular default?'}}]};
  const rules = setup(t, (batch, question) => batch.family.startsWith('check-selection-defaults') ? noul(0.99)
    : question.type === 'choice' ? choice(question, 'value_0', 0.55) : noul(batch.family === 'check-selection-bind-refine' ? 0.4 : 0.99), [modifier]);
  rules.input.investigators = ['Ada'];
  const ruled = await selectCheck(rules.input);
  assert.deepEqual([ruled.status, ruled.action.difficulty, ruled.forced?.why], ['selected', 'hard', 'below_confidence_gate'],
    'a modifier with a rules default is the rules\' value, not the player\'s');
  const recovery = {key: 'rest', family: 'healing', label: 'Weekly recovery', authorization: 'consequence', needs: [], action: {actor: 'Ada', decision: 'healing:weekly-major-wound-recovery'},
    parameters: [{name: 'rest', question: 'Which convalescence conditions are established?', options: [{label: 'Complete rest', value: 'complete'}, {label: 'Incomplete rest', value: 'incomplete'}]}]};
  const consequence = setup(t, (_batch, question) => question.type === 'choice' ? choice(question, 'value_1', 0.55) : noul(0.99), [recovery]);
  consequence.input.investigators = ['Ada'];
  const established = await selectCheck(consequence.input);
  assert.deepEqual([established.status, established.action.rest], ['selected', 'incomplete'], 'a consequence\'s established facts are not the player\'s choice');
});

test('§163.8: a clerk parameter the builder marks as the player\'s is not bound from Jev\'s lead; another person\'s is', () => {
  const answer = (choice, confidence) => ({status: 'complete', answers: {target: {status: 'answered', type: 'choice', choice, confidence,
    probabilities: {Ghoul: .6, Rat: .3, unknown: .1}}}});
  const blow = {...candidate, key: 'blow', clerk: 'first_blow', family: 'combat', label: 'Strike', bound: {decision: 'combat:attack'},
    unbound: [{name: 'target', required: true, vocabulary: 'closed', options: ['Ghoul', 'Rat'], owner: 'player'}]};
  const mine = interpretBind(blow, {questions: []}, answer('Ghoul', 0.4), 0.85);
  assert.deepEqual(mine.pending.map(item => [item.kind, item.purpose, item.reason, item.extra.cause, item.extra.unresolved]),
    [['infer', 'compose', 'check_unresolved', 'player_choice', ['target']]]);
  assert.deepEqual(mine.pending[0].extra.withheld, ['target: Ghoul confidence 0.4 (the player\'s choice)']);
  assert.equal(mine.forced, undefined);
  const theirs = interpretBind({...blow, unbound: [{...blow.unbound[0], owner: undefined}]}, {questions: []}, answer('Ghoul', 0.4), 0.85);
  assert.equal(theirs.pending[0].extra.target, 'Ghoul', 'an NPC\'s own choice is still Jev\'s best guess');
});
