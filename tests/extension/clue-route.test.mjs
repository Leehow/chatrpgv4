/**
 * Contract §222.2: the clue-route lane -- the rulebook's ways to a checked clue that the kernel cannot read from receipts,
 * judged by Jev (a fitting other roll, an obvious clue) or decided by the host (its no roll this turn), and attested to the
 * kernel as `found_by` on the re-sent apply. Pure questions and reading over a typed Jev double; the extension wrapper's
 * no-Jev paths (no roll first, unconfigured, shadow) and its refusal reading.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {CLUE_ROUTE_FAMILY, clueRouteDecision, clueRouteQuestions, clueRouteState, runClueRoute} from '../../runtime/jev/clue-route.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {checkFirstRefusal, openClueRoute, withFoundBy} from '../../extensions/kernel/clue-route.ts';

const input = {campaign: 'table', turn: 7, declaration: '我把书架之间翻了一遍。',
  clue: {name: 'house-built-1835', summary: 'The house was built in 1835 by a merchant.', cues: ['Search the stacks for the land records'],
    check: {skill: 'Library Use', difficulty: 'regular'}, supports: [{name: 'corbitt-history', importance: 'core'}], others: ['A newspaper story the editor spiked']},
  rolls: [{id: 'roll:spot-hidden-t7-c1', skill: 'Spot Hidden', actor: 'Thomas', goal: 'look for a hidden deed between the stacks'},
    {id: 'roll:listen-t7-c2', skill: 'Listen', actor: 'Thomas', goal: 'hear the archivist'}]};
const budget = {mode: 'on', fitMin: 0.6, obviousMin: 0.65, timeoutMs: 8000};

/** A Jev double answering each Noul by key. */
function jev(answers) {
  const seen = [];
  return {seen, decide: async batch => {
    seen.push(batch);
    const out = Object.fromEntries(batch.questions.map(question => [question.key, question.key in answers
      ? {status: 'answered', type: 'noul', noul: answers[question.key]} : {status: 'unknown'}]));
    return {batchId: batch.id, status: 'complete', answers: out, coverage: {required: Object.keys(out), answered: Object.keys(out), unknown: []}, issues: [],
      usage: {inputTokens: 300, outputTokens: 12, costUsd: 0.001}};
  }};
}
function lease(t) {
  const value = new TaskLease({owner: CLUE_ROUTE_FAMILY, goal: 'test', scope: {owner: CLUE_ROUTE_FAMILY, campaign: 'table', audience: 'keeper'}, readSet: [],
    capabilities: ['decision'], budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 100_000, remainingOutputTokens: 10_000, remainingCostUsd: 1, remainingActions: 5}});
  t.after(() => value.close());
  return value;
}

test('the questions: one fit Noul per other roll, one obvious Noul; the state carries the book\'s words, never a handle for the rolls', () => {
  const questions = clueRouteQuestions(input);
  assert.deepEqual(questions.map(question => [question.key, question.type]), [['fit_r0', 'noul'], ['fit_r1', 'noul'], ['obvious', 'noul']]);
  assert.match(questions[0].instructions, /rolls\.r0/);
  assert.match(questions[2].instructions, /obvious ones/);
  const state = clueRouteState(input);
  assert.deepEqual(Object.keys(state.rolls), ['r0', 'r1']);
  assert.equal(state.rolls.r0.goal, 'look for a hidden deed between the stacks');
  assert.equal(state.clue.book_check, 'Library Use (regular)');
  assert.deepEqual(state.clue.supports, [{conclusion: 'corbitt-history', importance: 'core'}]);
  assert.deepEqual(state.scene_other_clues, ['A newspaper story the editor spiked']);
});

test('the reading: the best-scored fitting roll at or above fit_min wins; else obvious at or above obvious_min; else nothing', async t => {
  const fits = jev({fit_r0: 0.82, fit_r1: 0.7, obvious: 0.9});
  const result = await runClueRoute(input, fits, lease(t));
  assert.equal(result.status, 'answered');
  assert.deepEqual(result.fit, {'roll:spot-hidden-t7-c1': 0.82, 'roll:listen-t7-c2': 0.7});
  assert.deepEqual(clueRouteDecision(result, budget), {route: 'fitting_check', roll: 'roll:spot-hidden-t7-c1', score: 0.82});
  assert.equal(fits.seen[0].family, CLUE_ROUTE_FAMILY);
  const obvious = await runClueRoute(input, jev({fit_r0: 0.2, fit_r1: 0.1, obvious: 0.71}), lease(t));
  assert.deepEqual(clueRouteDecision(obvious, budget), {route: 'obvious', score: 0.71});
  const neither = await runClueRoute(input, jev({fit_r0: 0.59, fit_r1: 0.3, obvious: 0.64}), lease(t));
  assert.equal(clueRouteDecision(neither, budget), null, 'at the bar is in, under it is out');
  const partial = await runClueRoute(input, jev({obvious: 0.9}), lease(t));
  assert.equal(partial.status, 'answered');
  assert.deepEqual(partial.fit, {'roll:spot-hidden-t7-c1': null, 'roll:listen-t7-c2': null});
  const none = await runClueRoute(input, jev({}), lease(t));
  assert.deepEqual({status: none.status, reason: none.reason}, {status: 'failed', reason: 'no_answer'});
  assert.equal(clueRouteDecision(none, budget), null);
  const noRolls = await runClueRoute({...input, rolls: []}, jev({obvious: 0.8}), lease(t));
  assert.deepEqual(clueRouteDecision(noRolls, budget), {route: 'obvious', score: 0.8});
});

test('the kernel\'s check_first refusal is read off the error, other errors are not', () => {
  const error = {code: 'needs', codeDetail: 'check_first', message: 'x', details: {reason: 'check_first', clue: 'house-built-1835', check: {skill: 'Library Use', difficulty: 'regular'},
    routes: {other_rolls: [{id: 'roll:spot-hidden-t7-c1', skill: 'Spot Hidden', actor: 'Thomas', goal: 'look', turn: 6}], idea_roll: true}, index: 2}};
  assert.deepEqual(checkFirstRefusal(error), {clue: 'house-built-1835', check: {skill: 'Library Use', difficulty: 'regular'},
    routes: {other_rolls: [{id: 'roll:spot-hidden-t7-c1', skill: 'Spot Hidden', actor: 'Thomas', goal: 'look', turn: 6}], idea_roll: true}, index: 2});
  assert.equal(checkFirstRefusal({code: 'not_here', details: {clue: 'x'}}), undefined);
  assert.equal(checkFirstRefusal(new Error('boom')), undefined);
  assert.equal(checkFirstRefusal({codeDetail: 'check_first', details: {clue: 'x', check: {skill: 'Spot Hidden'}}}), undefined, 'no routes, nothing to open');
  const payload = {campaign: 'c', effects: [{kind: 'time', minutes: 5}, {kind: 'clue', clue: 'house-built-1835'}]};
  assert.deepEqual(withFoundBy(payload, 1, {route: 'obvious'}), {campaign: 'c', effects: [{kind: 'time', minutes: 5}, {kind: 'clue', clue: 'house-built-1835', found_by: {route: 'obvious'}}]});
  assert.equal(withFoundBy(payload, 0, {route: 'obvious'}), undefined, 'only a clue effect takes a route');
  assert.deepEqual(payload.effects[1], {kind: 'clue', clue: 'house-built-1835'}, 'the original payload is untouched');
});

test('the wrapper: the host\'s no roll opens the clue before any Jev call; without a Jev key nothing else is tried; shadow re-sends nothing', async () => {
  const refusal = {clue: 'house-built-1835', check: {skill: 'Library Use'}, routes: {other_rolls: [], idea_roll: true}, index: 0};
  const rows = [], calls = [];
  const deps = {env: {}, campaign: 'c1', turn: 7, call: async method => { calls.push(method); return {candidates: []}; }, record: row => rows.push(row), budget};
  assert.deepEqual(await openClueRoute({...deps, noRoll: {turn: 7, status: 'no_roll', why: 'no_check_needed'}}, refusal), {route: 'no_roll'});
  assert.deepEqual(calls, [], 'the host decided; Jev and the kernel were not asked');
  assert.deepEqual({chosen: rows[0].chosen, resent: rows[0].resent, lane: rows[0].lane, no_roll: rows[0].no_roll.why}, {chosen: 'no_roll', resent: true, lane: 'clue-route', no_roll: 'no_check_needed'});
  assert.equal(await openClueRoute({...deps, noRoll: {turn: 6, status: 'no_roll', why: 'x'}}, refusal), undefined, 'an earlier turn\'s decision is not this turn\'s');
  assert.deepEqual({skipped: rows[1].skipped, chosen: rows[1].chosen}, {skipped: 'unconfigured', chosen: null});
  assert.equal(await openClueRoute({...deps, noRoll: {turn: 7, status: 'no_roll', why: 'x'}, budget: {...budget, mode: 'shadow'}}, refusal), undefined);
  assert.deepEqual({chosen: rows[2].chosen, resent: rows[2].resent, mode: rows[2].mode}, {chosen: 'no_roll', resent: false, mode: 'shadow'});
  assert.equal(await openClueRoute({...deps, noRoll: {turn: 7, status: 'no_roll', why: 'x'}, env: {PI_COC_CLUE_ROUTE: 'off'}}, refusal), undefined);
  assert.equal(rows.length, 3, 'off records nothing');
});
