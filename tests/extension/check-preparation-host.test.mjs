import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

async function fixture() {
  const bus = new Map(), notices = [], announced = [], rows = [];
  const pi = {events: {on: (name, fn) => bus.set(name, fn), emit: (name, value) => {
    if (name === 'coc:check-selection-unresolved') notices.push(value);
    if (name === 'coc:model-step') announced.push(value);
    bus.get(name)?.(value);
  }}, on: () => {}, registerTool: () => {}, getActiveTools: () => ['look','lookup','apply','resolve','narrate'], setActiveTools: () => {}};
  const engine = createHybridEngine({npcAct: null, env: {COC_NARRATOR_ONLY: 'on'}, record: row => rows.push(row),
    decision: {decide: async () => {throw new Error('this fixture exercises preparation projection, not semantic decisions');}}});
  engine.extension(pi);
  pi.events.emit('coc:kernel-bridge', {campaign: 'c', call: async method => method === 'table.capsule'
    ? {where: {scene: 'road'}, mods: {active: []}, present: [], known: {},
      _context: {version: 1, campaign: 'c', worldline: 'main', loop: 0, turn: 1, source_revision: 'a'.repeat(64)}}
    : method === 'table.status' ? {turn: 1, state: 'open', receipts: []} : {}});
  const plan = engine.runDriver.prepare({runId: 'r', inputRevision: 'input', rawInput: 'I flee the tailgating cars.', session: {}});
  const signal = new AbortController().signal;
  await plan.ports.read.read({origin: 'policy', operation: 'read', readOnly: true},
    {runId: 'r', stepId: 'read', operationId: 'read', origin: 'policy', inputRevision: 'input', scopeId: 'root', signal});
  const needs = ['check_arguments_unavailable:chase:start'];
  const pending = {candidate: 'Chase start', needs, preparation: {decision: 'chase:start', needs}};
  const project = async (entries, preparingAttacks=[]) => (await plan.ports.projection.project({view: {policyState: {view: {
    interactionScope: {mode: 'world', reason: 'fixture', calls: 0}, unresolvedChecks: entries, preparingAttacks}}}, stepId: 'prepare',
    step: {kind: 'infer', purpose: entries.length ? 'adjudicate' : 'compose', reason: entries.length ? 'check_preparation' : 'settled'}}))
    .map(message => message.content).join('');
  const execute = async (operation, isError = false, params) => plan.ports.operations.execute({origin: 'model', operation,
    params: params ?? (operation === 'lookup' ? {kind: 'source', source_mode: 'prepare', query: 'observed pursuers'} : {text: 'The attempt remains pending.'}),
    assistantMessage: {}, toolCall: {id: operation}}, {runId: 'r', stepId: 'prepare', operationId: operation,
    origin: 'model', inputRevision: 'input', scopeId: 'root', signal,
    executeModelTool: async () => ({isError, details: {}, content: [{type: 'text', text: 'fixture result'}]})});
  const close = async status => {
    pi.events.emit('coc:turn-close', {verdict: async () => ({status, implicit: true})});
    await plan.ports.operations.execute({origin: 'policy', operation: 'turn_close', readOnly: false},
      {runId: 'r', stepId: 'close', operationId: 'close', origin: 'policy', inputRevision: 'input', scopeId: 'root', signal});
  };
  const forced = () => rows.filter(row => row.lane === 'forced-resolution');
  return {notices, announced, pending, project, execute, close, forced};
}

for (const resolved of [false, true]) test(`§163: preparation preserves agent tools; a preparation still pending at delivery is a recorded no-roll, never a notice (resolved=${resolved})`, async () => {
  const f = await fixture();
  const note = await f.project([f.pending]);
  assert.match(note, /Source answer excerpts alone do not register participants/);
  assert.match(note, /If preparation cannot complete this turn, narrate the attempt by your own judgement without a roll/);
  assert.doesNotMatch(note, /preserve the attempt as unresolved/);
  assert.equal(f.forced().length, 0, 'a recoverable preparation gap is not yet forced');
  await f.execute('lookup');
  assert.equal(f.announced.at(-1).refuse, undefined, 'source preparation remains in the agent catalog');
  if (resolved) await f.project([]);
  await f.execute('narrate', true);
  assert.equal(f.forced().length, 0, 'a refused delivery is not terminal');
  await f.execute('narrate');
  assert.deepEqual(f.forced().map(({family, subject, uncertain, chosen, why}) => ({family, subject, uncertain, chosen, why})), resolved ? []
    : [{family: 'check-preparation', subject: 'Chase start', uncertain: ['check_arguments_unavailable:chase:start'], chosen: {outcome: 'no_roll'}, why: 'preparation_incomplete'}]);
  await f.execute('narrate');
  assert.equal(f.forced().length, resolved ? 0 : 1, 'recorded once');
  assert.equal(f.notices.length, 0, 'no unresolved-check notice exists any more');
});

test('a required attack preparation write holds its premature embedded narration',async()=>{
  const f=await fixture();
  const pending={candidate:'Pen attack',needs:['pen usage'],preparation:{decision:'combat:attack',needs:['pen usage']}};
  await f.project([pending],[{key:'attack'}]);
  await f.execute('apply',false,{effects:[{kind:'usage',object:'Pen',name:'Jab',description:'The declared jab'}],narrate:'The pen has not hit yet.'});
  assert.equal(f.announced.at(-1).hold_embedded_narration,true);
});

test('§163: an implicit accepted delivery records the pending preparation as a forced no-roll; an unavailable close does not', async () => {
  for (const status of ['delivered', 'unavailable']) {
    const f = await fixture(); await f.project([f.pending]);
    await f.close(status);
    assert.equal(f.forced().length, status === 'delivered' ? 1 : 0);
    assert.equal(f.notices.length, 0);
  }
});
