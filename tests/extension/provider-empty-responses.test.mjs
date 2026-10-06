/** JEV-OPEN-02: controlled SSE through the real Responses parser and host.
 * These are decoder/recovery regressions, not reconstructed v32 streams or play acceptance.
 * The injected fetch returns public fixture data only; no external model is called.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {streamSimple} from '@earendil-works/pi-ai/api/openai-responses';
import {isRetryableAssistantError} from '@earendil-works/pi-ai';
import {customMessages, openTable, waitForIdle} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';

const PROSE = 'The clock advances while you wait beside the closed office door.';
const message = (text, refusal = false) => ({id: 'msg-controlled', type: 'message', role: 'assistant', status: 'completed',
  content: refusal ? [{type: 'refusal', refusal: text}] : [{type: 'output_text', text, annotations: []}]});
function textEvents(shape, text = PROSE, refusal = false) {
  const item = message(text, refusal);
  const events = [{type: 'response.output_item.added', output_index: 0, item: {...item, status: 'in_progress', content: []}}];
  if (shape === 'normal') events.push({type: refusal ? 'response.refusal.delta' : 'response.output_text.delta', output_index: 0, content_index: 0, delta: text});
  if (['normal', 'empty-item-done', 'empty'].includes(shape)) events.push({type: 'response.output_item.done', output_index: 0, item: shape === 'normal' ? item : message('')});
  if (shape !== 'missing-terminal') events.push(terminal([shape === 'empty' ? message('') : item]));
  return events;
}
const terminal = output => ({type: 'response.completed', response: {id: 'resp-controlled', status: 'completed', output,
  usage: {input_tokens: 1, output_tokens: 4, output_tokens_details: {reasoning_tokens: 0}}}});
function timeEvents() {
  const item = {type: 'function_call', id: 'fc-controlled-time', call_id: 'call-controlled-time', name: 'apply',
    arguments: JSON.stringify({effects: [{kind: 'time', minutes: 2}]}), status: 'completed'};
  return [{type: 'response.output_item.added', output_index: 0, item: {...item, arguments: ''}},
    {type: 'response.output_item.done', output_index: 0, item}, terminal([item])];
}
function sse(events) {
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    {status: 200, headers: {'content-type': 'text/event-stream'}});
}
const modelSpec = {id: 'gpt-6-luna', name: 'Controlled Responses fixture', reasoning: true, input: ['text'],
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 100000, maxTokens: 4096};
const normalizedBytes = result => result.content.filter(block => block.type === 'text').reduce((n, block) => n + Buffer.byteLength(block.text), 0);

test('real pi-ai 1.0 parser loses text present only in the terminal snapshot', async () => {
  const model = {type: 'chat', api: 'openai-responses', provider: 'controlled-responses', baseUrl: 'https://controlled.invalid/v1', ...modelSpec};
  for (const shape of ['terminal-only', 'empty-item-done']) {
    const raw = [], normalized = [];
    const stream = streamSimple(model, {messages: [{role: 'user', content: 'Controlled decoder probe.', timestamp: Date.now()}]},
      {apiKey: 'unused', reasoning: 'low', fetch: async () => sse(textEvents(shape)),
        onProviderStreamEvent: event => raw.push(event.type)});
    for await (const event of stream) normalized.push(event.type);
    const result = await stream.result();
    assert.ok(raw.includes('response.completed'));
    assert.equal(result.rawStopReason, 'completed');
    assert.equal(result.stopReason, 'stop');
    assert.equal(normalizedBytes(result), 0);
    assert.ok(!normalized.includes('text_delta'));
  }
});

async function controlledTable(t, responses, options = {}) {
  const engine = createHybridEngine({env: process.env, decision: null});
  const table = await openTable({env: {PI_COC_LOOP_ENGINE: 'hybrid-v1', FAKE_KERNEL_WORKSPACE: '1', FAKE_KERNEL_PRESENT: '[]'},
    runDriver: engine.runDriver, extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}],
    settings: {retry: {enabled: true, maxRetries: 2, baseDelayMs: 1}}, ...options});
  t.after(() => table.dispose());
  let requests = 0;
  table.session.modelRuntime.registerProvider('controlled-responses', {api: 'openai-responses', baseUrl: 'https://controlled.invalid/v1', apiKey: 'unused',
    models: [modelSpec], streamSimple: (model, context, options) => streamSimple(model, context, {...options,
      fetch: async () => {
        const events = responses[requests++];
        if (!events) throw new Error('Controlled Responses fixture exhausted');
        return sse(events);
      }})});
  await table.session.setModel(table.session.modelRuntime.getModel('controlled-responses', 'gpt-6-luna'));
  table.session.setThinkingLevel('low');
  const events = [];
  const settled = [];
  table.session.subscribe(event => {
    events.push(event);
    if (event.type === 'agent_settled') settled.push({cards: table.entries('coc-mechanics').filter(row => row.undelivered && row.turn === 1).length,
      notices: notices(table).length});
  });
  return {table, events, settled, requests: () => requests};
}
const runEnd = events => events.findLast(event => event.type === 'run_end');
const notices = table => customMessages(table.session, 'coc-delivery').filter(message => message.details?.provider_outage || message.details?.turn_unfinished);
const applies = table => table.kernelRequests().filter(row => row.method === 'table.apply');

for (const shape of ['terminal-only', 'empty-item-done']) test(`host classifies ${shape} decoder loss and publishes one prior settlement before agent_settled`, async t => {
  const {table, events, settled, requests} = await controlledTable(t, [timeEvents(), textEvents(shape), textEvents('normal', 'The doorway stays quiet as you look along its frame.')]);
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(requests(), 2, 'the normalization failure must not buy retries or a compose repair');
  assert.equal(applies(table).length, 1, 'the earlier canonical effect executes once');
  assert.equal(table.kernelRequests().filter(row => row.method === 'table.narrate').length, 0);
  assert.equal(runEnd(events).status, 'undelivered');
  const failed = table.session.messages.findLast(row => row.role === 'assistant');
  assert.equal(failed.stopReason, 'error');
  assert.match(failed.errorMessage, /^responses_terminal_text_missing:/);
  assert.equal(isRetryableAssistantError(failed), false);
  const cards = table.entries('coc-mechanics').filter(row => row.undelivered && row.turn === 1);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].mechanics.filter(row => row.kind === 'time' && row.minutes === 2).length, 1);
  assert.equal(notices(table).length, 1);
  const summary = table.telemetry().findLast(row => row.lane === 'provider-stream-summary');
  assert.equal(summary.terminal_observed, true);
  assert.equal(summary.terminal_messages.text_bytes, Buffer.byteLength(PROSE));
  assert.equal(summary.normalized_text_bytes, 0);
  assert.equal(summary.normalization_failure, 'responses_terminal_text_missing');
  assert.equal(table.telemetry().filter(row => row.lane === 'provider-normalization').length, 1);
  assert.deepEqual(settled, [{cards: 1, notices: 1}], 'the card and notice exist at the outward agent_settled boundary');
  const observation = JSON.stringify(table.telemetry().filter(row => ['provider-stream-summary', 'provider-normalization'].includes(row.lane)));
  assert.ok(!observation.includes(PROSE) && !observation.includes('unused') && !observation.includes('msg-controlled'));

  // The next real input releases the stranded turn; its earlier effect is never replayed.
  await table.session.prompt('I look along the doorway.');
  await waitForIdle(table.session);
  assert.equal(requests(), 3);
  assert.equal(applies(table).length, 1);
  assert.equal(table.entries('coc-mechanics').filter(row => row.undelivered && row.turn === 1).length, 1);
  assert.equal(notices(table).length, 1);
  const inputs = table.kernelRequests().filter(row => row.method === 'table.player_input');
  assert.equal(inputs.length, 2);
  assert.ok(inputs[1].params.release === 'stranded' || table.kernelRequests().some(row => row.method === 'table.release'));
  assert.equal(runEnd(events).status, 'delivered');
});

test('a completed response empty at both boundaries uses one bounded repair and keeps one settlement', async t => {
  const {table, events, requests} = await controlledTable(t, [timeEvents(), textEvents('empty'), textEvents('empty')]);
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(requests(), 3);
  assert.equal(runEnd(events).status, 'undelivered');
  assert.equal(applies(table).length, 1);
  assert.equal(table.entries('coc-mechanics').filter(row => row.undelivered && row.turn === 1).length, 1);
  assert.equal(notices(table).length, 1);
  assert.equal(table.telemetry().filter(row => row.lane === 'provider-normalization').length, 0);
  const empty = table.telemetry().filter(row => row.lane === 'provider-stream-summary' && row.terminal_messages.messages > 0);
  assert.equal(empty.length, 2);
  assert.ok(empty.every(row => row.terminal_observed && row.terminal_messages.text_bytes === 0 && row.normalized_text_bytes === 0));
});

test('missing terminal remains a parser error rather than an observed empty completion', async t => {
  const {table, events, requests} = await controlledTable(t, [timeEvents(), ...Array.from({length: 3}, () => textEvents('missing-terminal'))]);
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(runEnd(events).status, 'undelivered');
  assert.equal(applies(table).length, 1);
  const summary = table.telemetry().findLast(row => row.lane === 'provider-stream-summary');
  assert.equal(summary.terminal_observed, false);
  assert.equal(summary.terminal_output_present, false);
  assert.equal(summary.normalization_failure, undefined);
  assert.equal(requests(), 4, 'existing parser retries stay bounded by the session allowance');
  assert.match(table.session.messages.findLast(row => row.role === 'assistant').errorMessage, /before a terminal response event/);
});

test('a missing terminal refusal is classified without logging or publishing its content', async t => {
  const {table, events, requests} = await controlledTable(t, [textEvents('terminal-only', PROSE, true)]);
  await table.session.prompt('I look along the doorway.');
  await waitForIdle(table.session);
  assert.equal(requests(), 1);
  assert.equal(runEnd(events).status, 'undelivered');
  const summary = table.telemetry().findLast(row => row.lane === 'provider-stream-summary');
  assert.equal(summary.terminal_messages.refusal_bytes, Buffer.byteLength(PROSE));
  assert.equal(summary.normalization_failure, 'responses_terminal_text_missing');
  assert.equal(notices(table).length, 1);
});

test('an inconsistent completion cannot execute its normalized tool proposals', async t => {
  const tool = timeEvents();
  const mixed = [...tool.slice(0, -1),
    {type: 'response.output_item.added', output_index: 1, item: message('')},
    {type: 'response.output_item.done', output_index: 1, item: message('')},
    terminal([tool.at(-1).response.output[0], message(PROSE)])];
  const {table, events, requests} = await controlledTable(t, [mixed]);
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(requests(), 1);
  assert.equal(runEnd(events).status, 'undelivered');
  assert.equal(applies(table).length, 0);
  assert.equal(table.session.messages.findLast(row => row.role === 'assistant').stopReason, 'error');
  assert.equal(table.extensionErrors.length, 0);
});

test('normal streamed text reaches canonical delivery once without normalization failure', async t => {
  const {table, events, requests} = await controlledTable(t, [timeEvents(), textEvents('normal')]);
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(requests(), 2);
  assert.equal(runEnd(events).status, 'delivered');
  assert.equal(applies(table).length, 1);
  assert.equal(table.kernelRequests().filter(row => row.method === 'table.narrate').length, 1);
  assert.equal(table.session.messages.findLast(row => row.role === 'assistant').content.find(row => row.type === 'text').text, PROSE);
  assert.equal(table.telemetry().filter(row => row.lane === 'provider-normalization').length, 0);
});

test('normally normalized Responses text tool calls survive restoration and execute once', async t => {
  const body = 'to=functions.apply code:\n' + JSON.stringify({effects: [{kind: 'time', minutes: 2}]});
  const {table, events, requests} = await controlledTable(t, [textEvents('normal', body), textEvents('normal')]);
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(applies(table).length, 1, 'the existing restoration must preserve the valid tool proposal');
  assert.equal(requests(), 2);
  assert.equal(runEnd(events).status, 'delivered');
  assert.equal(table.kernelRequests().filter(row => row.method === 'table.narrate').length, 1);
  assert.equal(table.telemetry().filter(row => row.lane === 'provider-normalization').length, 0);
  assert.deepEqual(table.telemetry().filter(row => row.lane === 'model-output' && row.event === 'textual_tool_calls')
    .flatMap(row => row.restored), ['apply']);
  const summary = table.telemetry().find(row => row.lane === 'provider-stream-summary');
  assert.equal(summary.terminal_messages.text_bytes, Buffer.byteLength(body));
  assert.equal(summary.normalized_text_bytes, Buffer.byteLength(body), 'observe parser text before restoration removes it');
  assert.equal(summary.normalized_text_blocks, 1);
  assert.equal(summary.normalization_failure, undefined);
  assert.equal(table.extensionErrors.length, 0);
});

// Prepare through the production TS RPC entry. This is a controlled state fixture,
// not a player run or chapter acceptance record.
function closedFirstTurn(workspace) {
  const root = resolve(import.meta.dirname, '../..');
  const calls = [['table.open', {}], ['table.player_input', {text: 'I enter the newspaper morgue.'}],
    ['table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue'}]}],
    ['table.narrate', {call_id: 't1-c2', text: 'The newspaper morgue is quiet.'}]];
  const input = calls.map(([method, params], id) => JSON.stringify({id: String(id), method, params: {campaign: 'test-camp', ...params}})).join('\n') + '\n';
  const result = spawnSync(process.execPath, [join(root, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(root, 'content')],
    {cwd: root, input, encoding: 'utf8'});
  assert.equal(result.status, 0);
  const frames = result.stdout.trim().split('\n').map(line => JSON.parse(line)).filter(frame => !frame.progress);
  assert.equal(frames.length, calls.length);
  assert.ok(frames.every(frame => frame.ok), `the canonical fixture RPCs must succeed: ${JSON.stringify(frames.filter(frame => !frame.ok).map(frame => ({id: frame.id, code: frame.error?.code, message: frame.error?.message})))}`);
}

test('production TS kernel retains the settled receipt on the stranded record without replay on the next input', async t => {
  const {table, events, requests} = await controlledTable(t, [timeEvents(), textEvents('empty-item-done'),
    textEvents('normal', 'You look along the doorway while the quiet room waits around you.')],
    {realKernel: true, prepareWorkspace: closedFirstTurn});
  await table.session.prompt('I wait beside the office door for two minutes.');
  await waitForIdle(table.session);
  assert.equal(requests(), 2);
  assert.equal(runEnd(events).status, 'undelivered');
  const cards = table.entries('coc-mechanics').filter(row => row.undelivered && row.turn === 2);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].mechanics.filter(row => row.kind === 'time' && row.minutes === 2).length, 1);
  await table.session.prompt('I look along the doorway.');
  await waitForIdle(table.session);
  assert.equal(requests(), 3);
  const record = JSON.parse(readFileSync(join(table.workspace, '.coc/campaigns/test-camp/turns/0002.json'), 'utf8'));
  assert.equal(record.closed_by, 'stranded');
  assert.equal(record.receipts.length, 1);
  assert.equal(record.rendered_text, null);
  assert.equal(table.telemetry().filter(row => row.tool === 'apply' && row.ok === true).length, 1);
  assert.equal(table.entries('coc-mechanics').filter(row => row.undelivered && row.turn === 2).length, 1);
  assert.equal(table.extensionErrors.length, 0);
});
