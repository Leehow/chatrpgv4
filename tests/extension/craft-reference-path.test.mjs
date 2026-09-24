/** Real Pi + emitted TS kernel + deterministic provider; this is not literary or live-table evidence. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {installContextPolicy} from '../../extensions/table/context-runtime.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

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

for (const engine of ['legacy', 'hybrid-v1']) for (const mode of ['selected', 'transport_drop', 'none', 'off', 'budget', 'unavailable']) {
  test(`real ${engine} request preserves ordinary material with craft ${mode}`, async t => {
    const requests = [], telemetry = [];
    let calls = 0;
    const hybrid = engine === 'hybrid-v1' ? createHybridEngine({env: process.env, decision: null}) : undefined;
    const selector = async ({index}) => {
      calls++;
      assert.equal(index.candidates.length, 12);
      return mode === 'none' ? null : 'CRAFT-VOI-01';
    };
    const table = await openTable({
      realKernel: true, keeperProviderCallbacks: true,
      env: {PI_COC_LOOP_ENGINE: engine, PI_COC_JEV_PRESELECT: '0', EXT_JEV_PRESELECTENABLED: 'false', EXT_JEV_APIKEY: undefined,
        ...(mode === 'budget' ? {PI_COC_REQUEST_BYTES: '4096'} : {})},
      prepareWorkspace: workspace => prepare(workspace, mode !== 'off'),
      ...(hybrid ? {runDriver: hybrid.runDriver, extraExtensions: [{name: 'coc-hybrid-engine', factory: hybrid.extension}]} : {}),
      tableExtensionFactory: pi => installContextPolicy(pi, row => telemetry.push(row), undefined,
        {craftSelector: mode === 'unavailable' ? undefined : selector}),
      responses: [context => {
        requests.push(context);
        return fauxAssistantMessage([fauxToolCall('narrate', {text: 'The office remains quiet.'})], {stopReason: 'toolUse'});
      }],
    });
    t.after(() => table.dispose());
    if (mode === 'transport_drop') table.faux.setTransport({body: {messages: []}});
    await table.session.prompt('Please answer the current question plainly.');
    assert.equal(requests.length, 1, JSON.stringify(table.extensionErrors));
    const texts = requests[0].messages.map(textOf), joined = texts.join('\n');
    assert.ok(joined.includes('Please answer the current question plainly.'), 'current input remains');
    assert.ok(joined.includes('Everything at the start of this turn'), 'current capsule remains');
    const references = texts.filter(text => text.includes('Optional craft reference;'));
    if (mode === 'selected' || mode === 'transport_drop') {
      assert.equal(calls, 1);
      assert.equal(references.length, 1, JSON.stringify(telemetry.filter(row => row.lane === 'craft')));
      assert.ok(references[0].includes('BEGIN SEPARATE EXAMPLE'));
      assert.ok(references[0].includes('not campaign evidence'));
      assert.ok(!references[0].includes('CRAFT-VOI-01'), 'card identity stays in private metadata');
      assert.ok(!references[0].includes('Some books are better left unread'), 'counterexample is never injected');
      assert.ok(telemetry.some(row => row.lane === 'craft' && row.event === 'projected'));
      assert.equal(telemetry.some(row => row.lane === 'craft' && row.event === 'injected'), mode === 'selected',
        'only the provider payload, not a selected or projected packet, proves injection');
      if (mode === 'transport_drop') assert.ok(telemetry.some(row => row.lane === 'craft' && row.reason === 'final_payload_absent'));
    } else {
      assert.equal(references.length, 0);
      assert.equal(calls, mode === 'none' ? 1 : 0);
      assert.ok(telemetry.some(row => row.lane === 'craft' && row.event === 'omitted'));
    }
    assert.ok(!table.session.messages.some(message => message.customType === 'coc-craft-reference'), 'advice is transport-only');
    assert.deepEqual(table.extensionErrors, []);
  });
}
