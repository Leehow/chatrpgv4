// Contract §219.1-§219.2 (issue #112, the 4d7 live table), the selector half: what the catalog now carries reaches Jev.
//
// Turn 80: the player read the probate volume for the will's executor; the book finds that clue by Library Use (regular).
// Check selection asked the Library Use profile "method fit" (0.56) and "roll needed" (0.47) with nothing saying the book
// makes this find a roll, and the forced result was no roll -- four turns running (80, 81, 83, 84), until the player asked
// out of character. Turn 96: "influence Kim Debrun" and "influence <the window clerk>" were the two social options; the
// player was talking to the man the table calls "the court liaison with the kraft envelope", whose book name had never
// been told, and Jev chose the clerk (needed now 0.89) over Kim Debrun (0.16); admission refused the mismatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCheck, specializedTriggerQuestion} from '../../runtime/jev/resolve-selection.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';

const scope = {owner: 'check-selection', campaign: 'table', worldline: 'main', loop: 0, audience: 'keeper'};
const noul = value => ({status: 'answered', type: 'noul', noul: value});
const choice = (question, selected) => ({status: 'answered', type: 'choice', choice: selected, confidence: 1,
  probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0]))});
const base = key => key.replace(/__semantic_(facts|execution)$/, '');

function setup(t, options, answer) {
  const lease = new TaskLease({owner: 'check-selection', goal: 'fixture', scope, readSet: [], capabilities: ['decision'],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
  t.after(() => lease.close());
  const seen = [];
  return {seen, input: {options, request: {decision: options[0].action.decision, bound: {}}, investigators: ['艾伦·沃德'],
    declaration: '拿到以后就在柜台上一页页看科比特的遗嘱，最要紧的是看遗产执行人写的是谁。', context: {current_receipts: []}, scope, readSet: [], lease,
    decision: {async decide(batch) {
      seen.push(batch);
      const answers = Object.fromEntries(batch.questions.map(question => [question.key, answer(batch, {...question, key: base(question.key)})]));
      return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
    }}}};
}

const SKILLS = ['Accounting', 'Anthropology', 'Appraise', 'Archaeology', 'Charm', 'Climb', 'Credit Rating', 'Disguise', 'Dodge', 'Fast Talk',
  'History', 'Intimidate', 'Library Use', 'Listen', 'Persuade', 'Psychology', 'Spot Hidden'];
const FIND = {find: "Corbitt's will executor was Pastor Michael Thomas of the Chapel of Contemplation", skill: 'Library Use', difficulty: 'regular'};
const profile = (skill, index) => ({key: `check:${index}`, family: 'core-check', label: `艾伦·沃德: ordinary ${skill} check`,
  action: {actor: '艾伦·沃德', decision: 'core-check:ordinary-check', skill}, parameters: [], needs: [], authorization: 'declaration',
  ...(skill === 'Library Use' ? {facts: {book_finds: [FIND]}} : {})});

test('§219.1: a profile the book names for a find here is judged on its own, with the book\'s find in front of Jev', async t => {
  const options = SKILLS.map(profile);
  // Retrieval scores some other profile first and Library Use not at all: the beam alone would cut it.
  const {input, seen} = setup(t, options, (batch, question) => question.type === 'choice' ? choice(question, 'check_4')
    : noul(batch.family === 'check-selection-need' && batch.state.checks[question.key.replace(/_(uncertain|blocked|selected)$/, '')]?.facts?.book_finds
      ? (question.key.endsWith('_blocked') ? 0.02 : 0.9) : 0.02));
  const result = await selectCheck(input);
  const need = seen.find(batch => batch.family === 'check-selection-need');
  const judged = Object.values(need.state.checks);
  const library = judged.find(entry => entry.action.skill === 'Library Use');
  assert.ok(library, `Library Use reaches the need questions: ${judged.map(entry => entry.action.skill)}`);
  assert.deepEqual(library.facts, {book_finds: [FIND]});
  const fit = need.questions.find(question => question.target === library.label && !question.key.includes('_uncertain') && !question.key.includes('_blocked'));
  const roll = need.questions.find(question => question.target === library.label && question.key.includes('_uncertain'));
  assert.match(fit.instructions, /facts\.book_finds/);
  assert.match(roll.instructions, /book makes finding those things here a check of this skill: an attempt that seeks one of them requires this roll/);
  assert.match(roll.instructions, /it never proves the find/);
  assert.equal(need.familyVersion, '24');
  assert.equal(result.status, 'selected');
  assert.equal(result.action.skill, 'Library Use');
});

test('§219.2: a person the table calls by a word reaches the social questions by that word; the bound target stays the rules\' name', async t => {
  const social = (target, called) => ({key: `social:${target}`, family: 'social', label: `艾伦·沃德: influence ${target} with a social approach`,
    action: {actor: '艾伦·沃德', target, decision: 'social:adjudicate-difficulty', intent: 'social'},
    facts: {stage: 'difficulty_adjudication', actor_role: 'investigator', target_role: 'npc', ...(called ? {target_called: called} : {})},
    parameters: [{name: 'skill', question: 'Which social skill fits?', options: [{label: 'Persuade', value: 'Persuade'}], selection: 'compatible'}],
    needs: [], authorization: 'declaration'});
  const kim = social('Kim Debrun', '夹着牛皮纸袋的法院联络员'), clerk = social('书记室窗口的书记员');
  assert.match(specializedTriggerQuestion(kim), /call `facts\.target_called`; the bound target name is only the name the rules bind/);
  assert.doesNotMatch(specializedTriggerQuestion(clerk), /target_called/, 'a table person already goes by the table\'s word');
  const {input, seen} = setup(t, [kim, clerk], (_batch, question) => question.type === 'choice' ? choice(question, Object.keys(question.criteria)[0]) : noul(0.9));
  input.declaration = '我没走，压着声音跟他把话说透（我想试试说服）：“我不是要您递卷子……您只要告诉我，这事值不值得我去找哪位法官。”';
  await selectCheck(input);
  const need = seen.find(batch => batch.family === 'check-selection-need');
  const alternatives = Object.fromEntries(need.state.alternatives.map(entry => [entry.action.target, entry.target_called ?? null]));
  assert.deepEqual(alternatives, {'Kim Debrun': '夹着牛皮纸袋的法院联络员', '书记室窗口的书记员': null});
  const kimCheck = Object.values(need.state.checks).find(entry => entry.action.target === 'Kim Debrun');
  assert.equal(kimCheck.facts.target_called, '夹着牛皮纸袋的法院联络员');
  assert.equal(kimCheck.action.target, 'Kim Debrun');
  const selected = need.questions.find(question => question.key.endsWith('_selected'));
  assert.match(selected.instructions, /target_called/);
});
