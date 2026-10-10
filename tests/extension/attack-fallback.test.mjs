// Contract §224.2 (user ruling 2026-10-10, re-rules §163.2/§163.8 per the Keeper Rulebook): a declared attack is settled in
// the same turn. An unsettled weapon takes the best-scored issued weapon, else unarmed Fighting (Brawl); an unsettled target
// takes its best-scored issued target; only a target nobody scored stays unbound. Other player-owned values are still withheld.
import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretBind} from '../../runtime/jev/step-policy.ts';
import {selectCheck} from '../../runtime/jev/resolve-selection.ts';
import {attackFallback, declaredAttack} from '../../runtime/jev/attack-fallback.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';

const choiceAnswer = (probabilities) => {
  const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return {status: 'answered', type: 'choice', choice, confidence: 0.3, probabilities};
};
const blow = {key: 'resolve:combat:first-blow', verb: 'resolve', family: 'combat', source: 'table.resolve.options', label: 'Ada: combat:attack at Ghoul, opening a fight',
  bound: {intent: 'combat', decision: 'combat:attack', target: 'Ghoul', goal: 'I hit it', method: 'I hit it'}, composed: ['goal', 'method'],
  unbound: [{name: 'weapon', required: true, vocabulary: 'closed', options: ['.38 revolver', 'kitchen knife', 'unarmed'], owner: 'player'}],
  clerk: 'first_blow', checkOwner: 'jev'};

test('§224.2: an unknown weapon takes the best-scored issued weapon, recorded as an attack_fallback roll', () => {
  const answer = {status: 'complete', answers: {weapon: choiceAnswer({'.38 revolver': .05, 'kitchen knife': .3, unarmed: .1, unknown: .55})}};
  const bound = interpretBind(blow, {questions: []}, answer, 0.85);
  assert.deepEqual(bound.pending.map(item => [item.kind, item.purpose, item.extra.weapon]), [['direct', 'execute', 'kitchen knife']]);
  assert.equal(bound.forced.family, 'check-binding');
  assert.equal(bound.forced.why, 'attack_fallback');
  assert.equal(bound.forced.chosen.outcome, 'roll');
  const record = bound.bindings.find(entry => entry.name === 'weapon');
  assert.deepEqual([record.path, record.rule, record.value], ['rule-default', 'attack_fallback', 'kitchen knife']);
});

test('§224.2: a weapon nobody scored is unarmed Fighting (Brawl); a weapon Jev did not answer at all likewise', () => {
  for (const answer of [{status: 'complete', answers: {weapon: choiceAnswer({'.38 revolver': 0, 'kitchen knife': 0, unarmed: 0, unknown: 1})}},
    {status: 'complete', answers: {}}, undefined]) {
    const bound = interpretBind(blow, {questions: []}, answer, 0.85);
    assert.equal(bound.pending[0].kind, 'direct');
    assert.equal(bound.pending[0].extra.weapon, 'unarmed');
    assert.ok(bound.forced.uncertain.some(line => line.includes('Fighting (Brawl) fallback')));
  }
  const noUnarmed = {...blow, unbound: [{...blow.unbound[0], options: ['.38 revolver', 'kitchen knife']}]};
  assert.equal(interpretBind(noUnarmed, {questions: []}, undefined, 0.85).pending[0].extra.weapon, 'unarmed',
    'the kernel always accepts unarmed for an investigator, issued or not');
});

test('§224.2: a session attack target and weapon both fall back; a target nobody scored stays unbound', () => {
  const turn = {...blow, key: 'resolve:combat:attack:Ada', clerk: 'session_step', bound: {intent: 'combat', decision: 'combat:attack', actor: 'Ada'},
    unbound: [{name: 'target', required: true, vocabulary: 'closed', options: ['Ghoul', 'Cultist'], owner: 'player'}, blow.unbound[0]]};
  const answer = {status: 'complete', answers: {target: choiceAnswer({Ghoul: .2, Cultist: .3, unknown: .5}),
    weapon: choiceAnswer({'.38 revolver': .4, 'kitchen knife': .4, unarmed: .1, unknown: .1})}};
  const bound = interpretBind(turn, {questions: []}, answer, 0.85);
  assert.deepEqual([bound.pending[0].extra.target, bound.pending[0].extra.weapon], ['Cultist', '.38 revolver'], 'a tie goes to the first listed');
  assert.equal(bound.bindings.find(entry => entry.name === 'target').cleared, false, 'canonical admission reviews a fallback target');
  const blank = interpretBind(turn, {questions: []}, {status: 'complete', answers: {}}, 0.85);
  assert.deepEqual(blank.pending.map(item => [item.purpose, item.reason, item.extra.unresolved]), [['compose', 'check_unresolved', ['target']]]);
});

test('§224.2: a non-attack player-owned value is still withheld (§163.8 stands outside attacks)', () => {
  const obligation = {...blow, key: 'resolve:obligation', clerk: 'stated_obligation', bound: {decision: 'core-check:ordinary-check'},
    unbound: [{name: 'skill', required: true, vocabulary: 'closed', options: ['Persuade', 'Charm'], owner: 'player'}]};
  assert.equal(declaredAttack(obligation), false);
  const held = interpretBind(obligation, {questions: []}, {status: 'complete', answers: {skill: choiceAnswer({Persuade: .3, Charm: .1, unknown: .6})}}, 0.85);
  assert.deepEqual(held.pending.map(item => [item.purpose, item.extra.cause]), [['compose', 'player_choice']]);
  assert.equal(attackFallback('target', ['A', 'B'], null), undefined);
});

const scope = {owner: 'check-selection', campaign: 'table', worldline: 'main', loop: 0, audience: 'keeper'};
const noul = value => ({status: 'answered', type: 'noul', noul: value});
const attack = (key, target, weapon) => ({key, family: 'combat', label: `Ada: attack ${target} with ${weapon}`, action: {actor: 'Ada', target, weapon, intent: 'combat', decision: 'combat:attack'},
  parameters: [], needs: [], authorization: 'declaration'});
function selection(t, options, selected) {
  const lease = new TaskLease({owner: 'check-selection', goal: 'attack', scope, readSet: [], capabilities: ['decision'],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
  t.after(() => lease.close());
  return {options, request: {decision: options[0].action.decision, bound: {}}, declaration: 'I go for him.', context: {conditions: [{actor: 'Ada', conditions: []}]},
    investigators: ['Ada'], scope, readSet: [], lease, decision: {async decide(batch) {
      const answers = Object.fromEntries(batch.questions.map(question => {
        const key = question.key.replace(/__semantic_(facts|execution)$/, '');
        return [question.key, noul(key.endsWith('_blocked') ? 0.01 : key.endsWith('_selected') ? selected(key) : 0.99)];
      }));
      return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
    }}};
}

test('§224.2 rule 3: unsettled catalog attack alternatives roll the best-scored one, else one target\'s unarmed option', async t => {
  const options = [attack('a', 'Cultist', '.38 revolver'), attack('b', 'Cultist', 'unarmed')];
  const scored = await selectCheck(selection(t, options, key => key === 'check_0_selected' ? 0.2 : 0.4));
  assert.deepEqual([scored.status, scored.action.weapon], ['selected', 'unarmed']);
  assert.ok(scored.forced.why.includes('attack_fallback'));
  assert.equal(scored.forced.why.includes('player_choice'), false);
  const blank = await selectCheck(selection(t, options, () => 0));
  assert.deepEqual([blank.status, blank.action.weapon], ['selected', 'unarmed'], 'one target, nothing scored: its unarmed option');
  const two = [attack('a', 'Cultist', 'unarmed'), attack('b', 'Ghoul', 'unarmed')];
  const open = await selectCheck(selection(t, two, () => 0));
  assert.equal(open.status, 'no_roll', 'two targets nobody scored stay unsettled');
  assert.ok(open.forced.why.includes('player_choice'));
});
