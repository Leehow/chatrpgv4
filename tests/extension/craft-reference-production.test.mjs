/** Production selector and owners through real Pi + TS kernel. The only provider transport is an offline fixture. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {installContextPolicy} from '../../extensions/table/context-runtime.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {createTaskProviderBudget} from '../../runtime/jev/provider-budget.ts';

const root = resolve(import.meta.dirname, '../..');
const textOf = message => typeof message.content === 'string' ? message.content
  : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
function prepare(workspace, enabled) {
  const steps = [['table.open', {}], ['mods.configure', {id: 'narration-craft', settings: {reference_mode: enabled ? 'jev' : 'off'}}],
    ['table.player_input', {text: 'Fixture opening.'}], ['table.narrate', {call_id: 't1-c1', text: 'The office is quiet.'}]];
  const input = steps.map(([method, params], id) => JSON.stringify({id: String(id), method, params: {campaign: 'test-camp', ...params}})).join('\n') + '\n';
  const result = spawnSync(process.execPath, [join(root, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(root, 'content')],
    {cwd: root, env: process.env, input, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  for (const frame of result.stdout.trim().split('\n').map(line => JSON.parse(line)).filter(frame => !frame.progress))
    assert.ok(frame.ok, JSON.stringify(frame));
}

for (const engine of ['legacy', 'hybrid-v1']) for (const mode of ['selected', 'settled', 'moved', 'none', 'unavailable', 'off', 'no-port']) {
  test(`${engine} production craft owner: ${mode}, one bounded decision and ordinary Keeper delivery`, async t => {
    const selects = ['selected', 'settled', 'moved'].includes(mode);
    const playerText = mode === 'moved' ? 'I go to the ground floor of the Corbitt house.' : 'I ask for a plain answer, staying with this conversation.';
    const requests = [], batches = [], telemetry = [], transports = [];
    let contextCalls = 0;
    const parent = new TaskLease({owner: 'fixture-root', goal: 'Bound foreground provider work',
      scope: {owner: 'fixture-root', audience: 'keeper'}, capabilities: [], readSet: [],
      budget: {deadlineAt: Date.now() + 60_000, remainingActions: 8, remainingInputTokens: 1_000_000,
        remainingOutputTokens: 80_000, remainingCostUsd: 1}});
    t.after(() => parent.close());
    const parentBudget = createTaskProviderBudget(parent);
    const adapter = createDecisionAdapter({apiKey: 'offline-fixture', fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      transports.push(body);
      if (mode === 'unavailable') return new Response('Unavailable fixture', {status: 503});
      const criteria = body.questions.method.criteria, choice = mode === 'none' ? 'NONE' : 'CRAFT-VOI-01';
      assert.ok(Object.hasOwn(criteria, choice));
      return Response.json({model: JEV_MODEL, answers: {method: {type: 'choice', choice, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, key === choice ? 1 : 0]))}},
        usage: {input_tokens: 20, output_tokens: 5}});
    }});
    const decision = mode === 'no-port' ? null : {async decide(batch, lease) {
      batches.push(batch);
      if (batch.family === 'craft-reference') return adapter.decide(batch, lease);
      return {batchId: batch.id, status: 'unavailable', answers: {}, coverage: {required: [], answered: [], unknown: []}, issues: [],
        attempts: 0, failure: {code: 'disabled', retryable: false}};
    }};
    const hybrid = engine === 'hybrid-v1' ? createHybridEngine({env: {}, decision, record: row => telemetry.push(row)}) : undefined;
    const reply = tool => context => {
      requests.push(context);
      return fauxAssistantMessage([tool], {stopReason: 'toolUse'});
    };
    const table = await openTable({
      realKernel: true, keeperProviderCallbacks: true,
      env: {PI_COC_LOOP_ENGINE: engine, PI_COC_JEV_PRESELECT: '0', EXT_JEV_PRESELECTENABLED: 'false', EXT_JEV_APIKEY: undefined},
      prepareWorkspace: workspace => prepare(workspace, mode !== 'off'),
      ...(hybrid ? {runDriver: hybrid.runDriver} : {}),
      tableExtensionFactory: pi => installContextPolicy(pi, row => telemetry.push(row), undefined, {
        decision: hybrid ? {async decide() {contextCalls++; throw new Error('Hybrid context must not select again');}} : decision,
      }),
      extraExtensions: [
        ...(hybrid ? [{name: 'coc-hybrid-engine', factory: hybrid.extension}] : []),
        {name: 'craft-parent-budget', factory: pi => pi.events.emit('coc:task-provider-budget', () => parentBudget)},
      ],
      responses: [
        ...(selects ? [reply(mode === 'settled'
          ? fauxToolCall('apply', {effects: [{kind: 'flag', name: 'fixture-notice', value: true}]})
          : mode === 'moved' ? fauxToolCall('apply', {effects: [{kind: 'move', to: 'corbitt-house-ground'}]})
          : fauxToolCall('look', {focus: 'scene'}))] : []),
        reply(fauxToolCall('narrate', {text: 'The office remains quiet.'})),
      ],
    });
    t.after(() => table.dispose());
    await table.session.prompt(playerText);
    assert.equal(requests.length, selects ? 2 : 1, JSON.stringify(table.extensionErrors));
    assert.deepEqual(table.extensionErrors, []);
    if (mode === 'settled' || mode === 'moved') {
      const applied = requests[1].messages.findLast(message => message.role === 'toolResult' && message.toolName === 'apply');
      assert.ok(applied, 'the state-changing tool result reaches the next real request');
      assert.equal(applied.isError, false, textOf(applied));
    }
    assert.equal(contextCalls, 0, 'the single-loop context never starts a second selector');
    const craftBatches = batches.filter(batch => batch.family === 'craft-reference');
    const called = !['off', 'no-port'].includes(mode);
    assert.equal(craftBatches.length, called ? 1 : 0);
    if (hybrid && called) assert.deepEqual(craftBatches[0].state.settled_results, [],
      'the actual same-turn table.status receipt array reaches the production selection, even before any settlement');
    assert.equal(transports.length, called ? 1 : 0, 'tool continuations and failures never retry selection');
    for (const request of requests) {
      const texts = request.messages.map(textOf);
      const references = texts.filter(text => text.includes('Optional craft reference;'));
      assert.equal(references.length, selects ? 1 : 0, JSON.stringify(telemetry.filter(row => row.lane === 'craft')));
      assert.ok(texts.join('\n').includes(playerText), 'the original current input remains');
      if (mode === 'settled') assert.equal(texts.some(text => text.includes('The optional craft reference earlier in this input is no longer current.')), false);
    }
    // A player-selected move also spends the existing admission allowance; the other cases isolate craft.
    if (selects && mode !== 'moved' || mode === 'none') {
      assert.equal(parent.context.budget.remainingActions, 7);
      assert.equal(parent.context.budget.remainingInputTokens, 1_000_000 - 20, 'one actual charge reaches the parent');
    } else if (!called) assert.equal(parent.context.budget.remainingActions, 8);
    if (selects) {
      assert.equal(telemetry.filter(row => row.lane === 'craft' && row.event === 'injected').length, mode === 'moved' ? 1 : 2);
      assert.equal(telemetry.filter(row => row.lane === 'craft' && row.event === 'inactive_reference').length, mode === 'moved' ? 1 : 0);
      if (hybrid) assert.equal(telemetry.filter(row => row.lane === 'craft' && row.event === 'run_prepared').length, 1);
    }
  });
}
