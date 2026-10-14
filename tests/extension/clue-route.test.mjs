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
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';

const input = {campaign: 'table', turn: 7, declaration: '我把书架之间翻了一遍。',
  clue: {name: 'house-built-1835', summary: 'The house was built in 1835 by a merchant.', cues: ['Search the stacks for the land records'],
    check: {skill: 'Library Use', difficulty: 'regular'}, supports: [{name: 'corbitt-history', importance: 'core'}], others: ['A newspaper story the editor spiked']},
  rolls: [{id: 'roll:spot-hidden-t7-c1', skill: 'Spot Hidden', actor: 'Thomas', goal: 'look for a hidden deed between the stacks'},
    {id: 'roll:listen-t7-c2', skill: 'Listen', actor: 'Thomas', goal: 'hear the archivist'}]};
const budget = {mode: 'on', fitMin: 0.6, obviousMin: 0.65, timeoutMs: 8000};

function routeTransport(t, answers = {fit_r0: 0.82, fit_r1: 0.1, obvious: 0.1}) {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);seen.push(request);
    return new Response(JSON.stringify({model:JEV_MODEL, answers:Object.fromEntries(Object.keys(request.questions)
      .map(key=>[key,{type:'noul',noul:answers[key]??0.1}])), usage:{input_tokens:300,output_tokens:12}}),
      {status:200,headers:{'Content-Type':'application/json'}});
  });
  return seen;
}

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

test('a rolled-back child clue reads its exact existing entity before the actual route decision', async t => {
  const seen=routeTransport(t),calls=[],records=[];
  const refusal={clue:input.clue.name,check:input.clue.check,routes:{other_rolls:input.rolls},index:1};
  const entity={name:input.clue.name,kind:'clue',summary:input.clue.summary,material:'ready',properties:{},relations:[
    {kind:'supports',to:'corbitt-history'},{kind:'supports',from:'not-an-outgoing-conclusion'},
    {kind:'discoverable-at',to:'private-child-room'}]};
  const result=await openClueRoute({env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,
    declaration:input.declaration,budget,record:row=>records.push(row),call:async(method,params)=>{
      calls.push({method,params});
      return method==='table.apply.options'?{candidates:[{effect:{kind:'clue',clue:'parent-only-clue'},
        description:{summary:'UNRELATED_PRIVATE_PARENT_CLUE'}}]}:{query:input.clue.name,expected_kind:'clue',entities:[entity]};
    }},refusal);
  assert.equal(seen.length,1);
  assert.equal(seen[0].state.clue.states,input.clue.summary,'the route must not judge an empty descriptor after rollback');
  assert.deepEqual(seen[0].state.clue.book_cues,[],'the lookup cannot invent scene affordances');
  assert.deepEqual(seen[0].state.clue.supports,[{conclusion:'corbitt-history',importance:null}]);
  assert.deepEqual(seen[0].state.scene_other_clues,[],'canonical parent candidates are not the child scene reading basis');
  assert.equal(JSON.stringify(seen).includes('UNRELATED_PRIVATE_PARENT_CLUE'),false);
  assert.deepEqual(Object.values(seen[0].state.rolls).map(roll=>roll.goal),input.rolls.map(roll=>roll.goal));
  assert.deepEqual(calls,[{method:'table.apply.options',params:{campaign:'table'}},
    {method:'table.lookup',params:{campaign:'table',kind:'module',query:input.clue.name,expected_kind:'clue'}}]);
  assert.deepEqual(result,{route:'fitting_check',roll:input.rolls[0].id});
  assert.equal(records.at(-1).resent,true);
});

test('a current candidate retains its complete descriptor without an added entity read', async t => {
  const seen=routeTransport(t),calls=[];
  const refusal={clue:input.clue.name,check:input.clue.check,routes:{other_rolls:input.rolls},index:0};
  const own={effect:{kind:'clue',clue:input.clue.name},description:input.clue};
  const result=await openClueRoute({env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,budget,
    declaration:input.declaration,record:()=>{},call:async method=>{
      calls.push(method);assert.equal(method,'table.apply.options');return {candidates:[own,
        {effect:{kind:'clue',clue:'other'},description:{summary:input.clue.others[0]}}]};
    }},refusal);
  assert.deepEqual(calls,['table.apply.options']);assert.deepEqual(result,{route:'fitting_check',roll:input.rolls[0].id});
  assert.deepEqual(seen[0].state,clueRouteState(input));
});

test('unavailable, ambiguous, wrong identity or kind never runs a decision on an empty fallback', async t => {
  const seen=routeTransport(t),refusal={clue:input.clue.name,check:input.clue.check,routes:{other_rolls:input.rolls},index:0};
  const valid={name:input.clue.name,kind:'clue',summary:input.clue.summary,material:'ready',relations:[]};
  const variants=[[],[valid,valid],[{...valid,name:'similarly-named-clue'}],[{...valid,kind:'npc'}],
    [{...valid,material:'unprepared'}],[{...valid,material:'unread'}],[{...valid,summary:''}],[{...valid,summary:null}]];
  for(const entities of variants){
    const records=[];
    assert.equal(await openClueRoute({env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,budget,
      record:row=>records.push(row),call:async method=>method==='table.apply.options'?{candidates:[]}:
        {query:input.clue.name,expected_kind:'clue',entities}},refusal),undefined);
    assert.equal(records.at(-1)?.reason,'basis_unavailable');assert.equal(records.at(-1)?.resent,false);
  }
  for(const field of ['query','expected_kind']){
    assert.equal(await openClueRoute({env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,budget,record:()=>{},
      call:async method=>method==='table.apply.options'?{candidates:[]}:{query:input.clue.name,expected_kind:'clue',entities:[valid],[field]:'wrong'}},refusal),undefined);
  }
  const records=[];
  assert.equal(await openClueRoute({env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,budget,record:row=>records.push(row),
    call:async method=>{if(method==='table.apply.options')return {candidates:[]};throw new Error('entity read unavailable');}},refusal),undefined);
  assert.equal(records.at(-1)?.resent,false);assert.equal(seen.length,0);
});

test('cancellation before or after either read cannot send a route decision', async t => {
  const seen=routeTransport(t),refusal={clue:input.clue.name,check:input.clue.check,routes:{other_rolls:input.rolls},index:0};
  for(const stop of ['before','table.apply.options','table.lookup']){
    const controller=new AbortController(),calls=[];
    if(stop==='before')controller.abort();
    assert.equal(await openClueRoute({env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,budget,
      signal:controller.signal,record:()=>{},call:async method=>{
        calls.push(method);if(stop===method)controller.abort();
        return method==='table.apply.options'?{candidates:[]}:{query:input.clue.name,expected_kind:'clue',entities:[
          {name:input.clue.name,kind:'clue',summary:input.clue.summary}]};
      }},refusal),undefined);
    assert.equal(calls.length,stop==='before'?0:stop==='table.apply.options'?1:2);
  }
  assert.equal(seen.length,0);
});

test('a recovered basis cannot lower fitting bars or turn an unavailable decision into discovery', async t => {
  const refusal={clue:input.clue.name,check:input.clue.check,routes:{other_rolls:input.rolls},index:0},records=[];
  const deps={env:{EXT_JEV_APIKEY:'test-only'},campaign:input.campaign,turn:input.turn,budget,
    record:row=>records.push(row),call:async method=>method==='table.apply.options'?{candidates:[]}:
      {query:input.clue.name,expected_kind:'clue',entities:[{name:input.clue.name,kind:'clue',summary:input.clue.summary,
        properties:{secret:'UNRELATED_PRIVATE_PROPERTY'},relations:[]}]}};
  const seen=routeTransport(t,{fit_r0:0.59,fit_r1:0.3,obvious:0.64});
  assert.equal(await openClueRoute(deps,refusal),undefined);assert.equal(records.at(-1)?.resent,false);
  assert.equal(JSON.stringify(seen).includes('UNRELATED_PRIVATE_PROPERTY'),false);
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({model:JEV_MODEL,answers:{},usage:{input_tokens:3,output_tokens:0}}),
    {status:200,headers:{'Content-Type':'application/json'}}));
  assert.equal(await openClueRoute(deps,refusal),undefined);
  assert.equal(records.at(-1)?.ok,false);assert.equal(records.at(-1)?.resent,false);
});
