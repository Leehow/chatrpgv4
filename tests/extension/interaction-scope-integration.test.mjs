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
for (const variant of ['implicit', 'explicit', 'mutation']) test(`reference scope closes ${variant} without fictional effects or a speech rewrite`, async t => {
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0'}, decision, npcAct: null});
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
  assert.equal(record.interaction_scope, 'reference');
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

const clerkNotes = context => context.messages.flatMap(message => {
  const text = typeof message.content === 'string' ? message.content : (message.content ?? []).map(block => block.text ?? '').join('');
  const start = text.indexOf('{"kind":"single_loop_step"');
  return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf('}') + 1))];
});
const scopeOnly = (world, system) => ({async decide(batch) {
  if (batch.family !== 'interaction-scope') return decision.decide(batch);
  if (world === 'throw') throw new Error('network_error');
  return bindDecisionAnswers(batch, {world_action: {status: 'answered', type: 'noul', noul: world}, system_request: {status: 'answered', type: 'noul', noul: system}},
    {inputTokens: 1, outputTokens: 1, costUsd: 0});
}});
// §163 (owner ruling 2026-10-01): an unsettled or unanswered scope is a world turn, recorded, with prose and no clarification.
for (const [variant, port, why] of [['no Jev credential', null, 'jev_unanswered'], ['provider failure', scopeOnly('throw'), 'jev_unanswered'],
  ['gray scores', scopeOnly(0.6, 0.5), 'below_confidence_gate']]) test(`§163: an interaction scope with ${variant} plays as a world turn and records the forced resolution`, async t => {
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0'}, decision: port, npcAct: null});
  const requests = [];
  const prose = 'Knott glances at the clock. "The Globe keeps its clippings by subject," he says, and slides the office key across the desk.';
  const table = await openTable({realKernel: true, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
    extraExtensions: [{name: 'scope-engine', factory: engine.extension}],
    responses: [context => { requests.push(context); return fauxAssistantMessage([fauxToolCall('narrate', {text: prose})], {stopReason: 'toolUse'}); }],
    prepareWorkspace: workspace => rpc(workspace, [['table.open', {}], ['table.player_input', {text: 'I wait in the office.'}],
      ['table.narrate', {call_id: 't1-c1', text: 'Knott waits beside his desk while you remain in the office.'}]])});
  t.after(() => table.dispose());
  await table.session.prompt('So how does the Globe archive work, anyway?');
  const record = read(table.workspace, 'turns/0002.json');
  assert.equal(record.interaction_scope, undefined, 'a world turn: the delivery is not stamped out of fiction');
  assert.equal(record.text, prose, 'the Keeper\'s prose is the delivery');
  assert.equal(table.session.lastDrivenRun.status, 'delivered');
  const telemetry = table.telemetry();
  const rows = telemetry.filter(row => row.lane === 'forced-resolution' && row.family === 'interaction-scope');
  assert.equal(rows.length, 1, 'recorded once');
  assert.deepEqual({chosen: rows[0].chosen, why: rows[0].why, subject: rows[0].subject}, {chosen: {outcome: 'world'}, why, subject: 'So how does the Globe archive work, anyway?'});
  assert.ok(!telemetry.some(row => row.reason === 'interaction_scope' || row.reason === 'check_selection_unresolved_notice'), 'no world tool was blocked and no notice was sent');
  assert.ok(!table.session.messages.some(message => message.customType === 'coc-delivery' && message.details?.check_selection_unresolved));
  const notes = requests.flatMap(clerkNotes);
  const marked = notes.find(note => note.decided_under_uncertainty);
  assert.deepEqual(marked.decided_under_uncertainty.map(entry => [entry.family, entry.chosen.outcome])[0], ['interaction-scope', 'world']);
  assert.match(marked.decided_under_uncertainty_note, /do not ask the player to clarify, confirm or repeat/);
  assert.ok(notes.every(note => note.interaction_scope === undefined && !/clarification/i.test(note.interaction_scope_note ?? '')), 'no clarification note');
});
