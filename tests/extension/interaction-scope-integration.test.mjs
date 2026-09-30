/** The real single-loop gateway and emitted TS kernel; deterministic decisions are not live acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {openTable} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const message = 'Pause the fiction. Explain how a newspaper archive works; do not advance the story.';
const answer = 'Newspaper archives commonly keep dated clippings in subject files. This is reference information; the scene remains paused.';
const file = (workspace, name) => join(workspace, '.coc/campaigns/test-camp', name);
const read = (workspace, name) => JSON.parse(readFileSync(file(workspace, name), 'utf8'));
function rpc(workspace, calls) {
  const run = spawnSync(process.execPath, [join(root, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(root, 'content')], {
    cwd: root, encoding: 'utf8', input: calls.map(([method, params], id) => JSON.stringify({id: String(id), method, params: {campaign: 'test-camp', ...params}})).join('\n')+'\n'});
  assert.equal(run.status, 0, run.stderr);
  const frames = run.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(frame => !frame.progress);
  for (const frame of frames) assert.equal(frame.ok, true, JSON.stringify(frame));
  return frames.map(frame => frame.result);
}
const decision = {async decide(batch) {
  return bindDecisionAnswers(batch, Object.fromEntries(batch.questions.map(q => {
    if (q.type === 'noul') return [q.key, {status: 'answered', type: 'noul', noul: q.key === 'system_request' ? .99 : .01}];
    const selected = 'finish' in q.criteria ? 'finish' : 'later' in q.criteria ? 'later' : Object.keys(q.criteria)[0];
    return [q.key, {status: 'answered', type: 'choice', choice: selected, confidence: 1, probabilities: {[selected]: 1}}];
  })), {inputTokens: 1, outputTokens: 1, costUsd: 0});
}};
for (const variant of ['implicit', 'explicit', 'mutation', 'unavailable']) test(`reference scope closes ${variant} without fictional effects or a speech rewrite`, async t => {
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0'}, decision: variant === 'unavailable' ? null : decision, npcAct: null});
  let beforeWorld, beforeLedger;
  const delivery = variant === 'explicit'
    ? fauxAssistantMessage([fauxToolCall('narrate', {text: answer})], {stopReason: 'toolUse'}) : fauxAssistantMessage(answer);
  const responses = variant === 'mutation' ? [fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'time', minutes: 94, why: 'Researching archives'}]})], {stopReason: 'toolUse'}), delivery] : [delivery];
  const table = await openTable({realKernel: true, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
    extraExtensions: [{name: 'scope-engine', factory: engine.extension}], responses,
    prepareWorkspace: workspace => {
      rpc(workspace, [['table.open', {}], ['table.player_input', {text: 'I wait in the office.'}],
        ['table.narrate', {call_id: 't1-c1', text: 'Knott waits beside his desk while you remain in the office.'}]]);
      beforeWorld = read(workspace, 'world.json'); beforeLedger = read(workspace, 'npc-ledger.json');
    }});
  t.after(() => table.dispose());
  await table.session.prompt(message);
  const telemetry = table.telemetry();
  const record = read(table.workspace, 'turns/0002.json');
  assert.equal(record.interaction_scope, variant === 'unavailable' ? 'uncertain' : 'reference');
  assert.equal(record.text, answer);
  assert.equal(record.receipts.length, 0);
  assert.deepEqual(read(table.workspace, 'world.json'), beforeWorld);
  assert.deepEqual(read(table.workspace, 'npc-ledger.json'), beforeLedger);
  assert.ok(!telemetry.some(row => row.reason === 'speech_steer' || row.reason === 'floor_steer'));
  assert.ok(!telemetry.some(row => ['resolve', 'apply'].includes(row.tool) && row.ok));
  assert.ok(!telemetry.some(row => row.lane === 'npc-act' && row.event === 'generated'));
  assert.equal(table.session.lastDrivenRun.status, 'delivered');
  const [status] = rpc(table.workspace, [['table.status', {}]]);
  assert.equal(status.last_exchange.turn, 1, 'reference information does not replace the last fictional exchange');
  const [, next] = rpc(table.workspace, [['table.player_input', {text: 'And the sources?'}], ['table.status', {}]]);
  assert.equal(next.last_interaction.turn, 2, 'short replies use the actual latest conversation frame');
  assert.equal(next.last_interaction.mode, record.interaction_scope);
  assert.equal(next.last_exchange.turn, 1, 'fictional conversation remains separate');
  if (variant === 'mutation') assert.ok(telemetry.some(row => row.reason === 'interaction_scope'));
});
