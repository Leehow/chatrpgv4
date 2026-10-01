import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

async function fixture() {
  const bus = new Map(), notices = [], announced = [];
  const pi = {events: {on: (name, fn) => bus.set(name, fn), emit: (name, value) => {
    if (name === 'coc:check-selection-unresolved') notices.push(value);
    if (name === 'coc:model-step') announced.push(value);
    bus.get(name)?.(value);
  }}, on: () => {}, registerTool: () => {}, getActiveTools: () => ['look','lookup','apply','resolve','narrate'], setActiveTools: () => {}};
  const engine = createHybridEngine({npcAct: null, env: {COC_NARRATOR_ONLY: 'on'},
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
  const project = async entries => (await plan.ports.projection.project({view: {policyState: {view: {
    interactionScope: {mode: 'world', reason: 'fixture', calls: 0}, unresolvedChecks: entries}}}, stepId: 'prepare',
    step: {kind: 'infer', purpose: entries.length ? 'adjudicate' : 'compose', reason: entries.length ? 'check_preparation' : 'settled'}}))
    .map(message => message.content).join('');
  const execute = async (operation, isError = false) => plan.ports.operations.execute({origin: 'model', operation,
    params: operation === 'lookup' ? {kind: 'source', source_mode: 'prepare', query: 'observed pursuers'} : {text: 'The attempt remains pending.'},
    assistantMessage: {}, toolCall: {id: operation}}, {runId: 'r', stepId: 'prepare', operationId: operation,
    origin: 'model', inputRevision: 'input', scopeId: 'root', signal,
    executeModelTool: async () => ({isError, details: {}, content: [{type: 'text', text: 'fixture result'}]})});
  const close = async status => {
    pi.events.emit('coc:turn-close', {verdict: async () => ({status, implicit: true})});
    await plan.ports.operations.execute({origin: 'policy', operation: 'turn_close', readOnly: false},
      {runId: 'r', stepId: 'close', operationId: 'close', origin: 'policy', inputRevision: 'input', scopeId: 'root', signal});
  };
  return {notices, announced, pending, project, execute, close};
}

for (const resolved of [false, true]) test(`preparation preserves agent tools and emits only a remaining terminal notice (resolved=${resolved})`, async () => {
  const f = await fixture();
  assert.match(await f.project([f.pending]), /Source answer excerpts alone do not register participants/);
  assert.equal(f.notices.length, 0, 'a recoverable preparation gap is not a final player notice');
  await f.execute('lookup');
  assert.equal(f.announced.at(-1).refuse, undefined, 'source preparation remains in the agent catalog');
  if (resolved) await f.project([]);
  await f.execute('narrate', true);
  assert.equal(f.notices.length, 0, 'a refused delivery is not terminal');
  await f.execute('narrate');
  assert.equal(f.notices.length, resolved ? 0 : 1);
});

test('implicit accepted delivery reports pending preparation; an unavailable close does not', async () => {
  for (const status of ['delivered', 'unavailable']) {
    const f = await fixture(); await f.project([f.pending]);
    await f.close(status);
    assert.equal(f.notices.length, status === 'delivered' ? 1 : 0);
  }
});
