import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCheck, validateCheckOptions} from '../../runtime/jev/resolve-selection.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {initialView, next, startStep, settleCheckSelection, settleExecute, settleRead, keeperOwns, interpretBind, interpretRoute} from '../../runtime/jev/step-policy.ts';
import {COMPILE_PREDICATES} from '../../runtime/jev/route-compile.ts';

const scope = {owner: 'check-selection', campaign: 'table', worldline: 'main', loop: 0, audience: 'keeper'};
const listen = {key: 'listen', family: 'core-check', label: 'Listen', action: {actor: 'Ada', decision: 'core-check:ordinary-check', skill: 'Listen'},
  parameters: [], needs: [], authorization: 'declaration'};
const spot = {...listen, key: 'spot', label: 'Spot Hidden', action: {...listen.action, skill: 'Spot Hidden'}};

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

test('unmet prerequisites defer a check, while ambiguity cannot authorize it', async t => {
  for (const [blocked, expected] of [[0.01, 'selected'], [0.99, 'deferred'], [0.5, 'unresolved']]) {
    const {input} = setup(t, () => noul(0.99), [listen]);
    const port = input.decision;
    input.decision = {async decide(batch) {
      const result = await port.decide(batch);
      for (const question of batch.questions) if (question.key.endsWith('_blocked')) result.answers[question.key] = noul(blocked);
      return result;
    }};
    assert.equal((await selectCheck(input)).status, expected);
  }
});

test('no-roll, ambiguous need and missing provider answers are distinct', async t => {
  for (const [answer, expected] of [[0.01, 'no_roll'], [0.5, 'unresolved'], [undefined, 'unresolved']]) {
    const {input} = setup(t, () => answer === undefined ? {status: 'unknown'} : noul(answer));
    assert.equal((await selectCheck(input)).status, expected);
  }
});

test('ordinary necessity requires both method fit and a rule need', async t => {
  for (const key of ['check_0', 'check_0_uncertain']) {
    for (const [p, expected] of [[0.1, 'no_roll'], [0.64, 'unresolved'], [0.65, 'selected'], [0.9, 'selected']]) {
      const {input} = setup(t, (batch, question) => noul(batch.family.startsWith('check-selection-need') && question.key === key ? p : 0.99), [listen]);
      assert.equal((await selectCheck(input)).status, expected, `${key}=${p}`);
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
    assert.equal(result.status, refinedNeed === 0.9 ? 'selected' : 'unresolved');
    assert.equal(result.action?.skill, refinedNeed === 0.9 ? 'Listen' : undefined);
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

test('weak Choice uses one absolute Noul, never invents a replacement or votes until accepted', async t => {
  const option = {...listen, parameters: [{name: 'difficulty', question: 'Required success level?',
    options: [{label: 'Regular', value: 'regular'}, {label: 'Hard', value: 'hard'}]}]};
  for (const confirmation of [0.95, 0.5, 0.1, undefined]) {
    const {input, seen} = setup(t, (batch, question) => batch.family === 'check-selection-bind-refine'
      ? confirmation === undefined ? {status: 'unknown'} : noul(confirmation)
      : question.type === 'choice' ? choice(question, 'value_1', 0.6) : noul(0.99), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, confirmation === 0.95 ? 'selected' : 'unresolved');
    assert.equal(result.action?.difficulty, confirmation === 0.95 ? 'hard' : undefined);
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
  assert.equal((await selectCheck(input)).status, 'unresolved');
  assert.equal(seen.filter(batch => batch.family.endsWith('-refine')).length, 1);
  assert.equal(seen.some(batch => batch.family === 'check-selection-bind-refine'), false);
});

test('ambiguous default conditions may be refined once; unavailable answers never default', async t => {
  const option = {...listen, parameters: [{name: 'bonus', question: 'Granted bonus dice?',
    options: [{label: 'Zero', value: 'none'}, {label: 'One', value: 'one'}],
    default: {value: 'none', question: 'Does an established advantage grant bonus dice?'}}]};
  for (const confirmation of [0.1, undefined]) {
    const {input, seen} = setup(t, (batch, question) => batch.family === 'check-selection-defaults-refine'
      ? confirmation === undefined ? {status: 'unknown'} : noul(confirmation)
      : noul(batch.family === 'check-selection-defaults' ? 0.5 : 0.99), [option]);
    const result = await selectCheck(input);
    assert.equal(result.action?.bonus, confirmation === 0.1 ? 'none' : undefined);
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

test('closed parameters use only issued values and refuse uncertain bindings', async t => {
  const option = {...listen, parameters: [{name: 'difficulty', question: 'Required success level?', options: [{label: 'Regular', value: 'regular'}, {label: 'Hard', value: 'hard'}]}]};
  for (const p of [0.99, 0.55]) {
    const {input} = setup(t, (batch, question) => question.type === 'noul' ? noul(batch.family === 'check-selection-bind-refine' ? 0.5 : 0.99) : choice(question, 'value_1', p), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, p > 0.85 ? 'selected' : 'unresolved');
    assert.equal(result.action?.difficulty, p > 0.85 ? 'hard' : undefined);
  }
});

test('rule defaults require a confident absence of modifiers, never a failed provider', async t => {
  const option = {...listen, parameters: [{name: 'bonus', question: 'Number of granted bonus dice?',
    options: [{label: 'Zero', value: 'none'}, {label: 'One', value: 'one'}],
    default: {value: 'none', question: 'Does an established advantage grant any bonus dice?'}}]};
  for (const [override, expected] of [[0.1, 'none'], [0.95, 'one'], [0.5, undefined], [undefined, undefined]]) {
    const {input, seen} = setup(t, (batch, question) => batch.family.startsWith('check-selection-defaults')
      ? override === undefined ? {status: 'unknown'} : noul(override)
      : question.type === 'noul' ? noul(0.99) : choice(question, 'value_0'), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, expected ? 'selected' : 'unresolved');
    assert.equal(result.action?.bonus, expected);
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

test('a combined check binds an explicit set; an uncertain member is not guessed', async t => {
  const option = {...listen, action: {actor: 'Ada', decision: 'core-check:combined-check'}, parameters: [{name: 'skills',
    question: 'Which skills does this combined attempt require?', multiple: {minimum: 2},
    options: ['Listen', 'Spot Hidden', 'Library Use'].map(value => ({label: value, value}))}]};
  for (const uncertain of [false, true]) {
    const {input} = setup(t, (batch, question) => noul(batch.family.startsWith('check-selection-bind')
      ? question.key === 'parameter_0_2' ? 0.01 : uncertain && question.key === 'parameter_0_1' ? 0.5 : 0.99 : 0.99), [option]);
    const result = await selectCheck(input);
    assert.equal(result.status, uncertain ? 'unresolved' : 'selected');
    assert.deepEqual(result.action?.skills, uncertain ? undefined : ['Listen', 'Spot Hidden']);
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

test('a stale check rebinds once from refreshed candidates; another stale or refusal stays unresolved', () => {
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
  assert.deepEqual(view.unresolvedChecks.at(-1).needs, ['check_selection_stale']);
  const refused = initialView({runId: 'refused-run', rawInput: 'I listen.', context, candidates: [selected]});
  settleExecute(refused, 1, {kind: 'direct', purpose: 'execute', candidate: selected}, {ok: false, summary: {refusal: 'action_not_admitted'}}, fresh, 2);
  assert.equal(refused.checkRefreshUsed, undefined);
  assert.equal(refused.pending[0].reason, 'clerk_refused');
  assert.deepEqual(refused.unresolvedChecks.at(-1).needs, ['action_not_admitted']);
});

test('ordinary bookkeeping cannot re-open an unresolved check in the same run and scene', () => {
  const request = {...candidate, bound: {decision: listen.action.decision}};
  const context = {scene: 'hall', clock: {}, present: []};
  const view = initialView({runId: 'held-run', rawInput: 'I listen.', context, candidates: [request]});
  settleCheckSelection(view, request, {status: 'unresolved', needs: ['check_necessity_uncertain'], calls: 2}, 2);
  assert.deepEqual(view.candidates, [], 'the next route cannot retry the same question even without a fresh read');
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
  const doubtful = setup(t, (batch) => noul(batch.family.startsWith('check-selection-bind') ? .5 : .99), [option]);
  const unresolved = await selectCheck(doubtful.input);
  assert.equal(unresolved.status, 'unresolved');
  assert.deepEqual(unresolved.needs, ['unbound:involuntary']);
});
