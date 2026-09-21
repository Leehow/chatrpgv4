import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeEvents, usableAnswer} from './reader-probe.mjs';

test('reader probe counts actual successful reads and final usage, not streaming duplicates', () => {
  const events = [
    {type: 'message_update', usage: {input: 1000}},
    {type: 'message_end', message: {role: 'assistant', provider: 'grok-build', model: 'grok-4.6', stopReason: 'toolUse', content: [], usage: {input: 1000, output: 20}}},
    {type: 'tool_execution_start', toolCallId: 'r1', toolName: 'read', args: {path: 'source-pages/page-0032.txt'}},
    {type: 'tool_execution_end', toolCallId: 'r1', isError: false},
    {type: 'tool_execution_start', toolCallId: 'r2', toolName: 'read', args: {path: '/probe/input/source-pages/page-0032.txt', offset: 50}},
    {type: 'tool_execution_end', toolCallId: 'r2', isError: false},
    {type: 'tool_execution_start', toolCallId: 'r3', toolName: 'read', args: {path: 'source-pages/page-0099.txt'}},
    {type: 'tool_execution_end', toolCallId: 'r3', isError: true},
    {type: 'message_end', message: {role: 'assistant', provider: 'grok-build', model: 'grok-4.6', stopReason: 'stop', content: [{type: 'text', text: 'Supported answer.'}], usage: {input: 1100, output: 80}}},
    {type: 'agent_end'},
  ];
  const result = summarizeEvents(events, '/probe/input');
  assert.equal(result.provider_rounds, 2);
  assert.equal(result.successful_page_read_calls, 2);
  assert.deepEqual(result.distinct_pages_read, [32]);
  assert.equal(result.reported_input_tokens, 2100);
  assert.equal(result.source_access_auditable, true);
  assert.equal(result.final_text, 'Supported answer.');
  assert.equal(result.agent_end_seen, true);
  assert.equal(result.newly_read_page_calls, 2);
  const supplied = summarizeEvents(events, '/probe/input', [32]);
  assert.equal(supplied.reread_supplied_page_calls, 2);
  assert.equal(supplied.newly_read_page_calls, 0);
  assert.deepEqual(supplied.newly_read_pages, []);
});

test('truncated, deferred, or unauditable readers cannot count as completed answers', () => {
  const good = {agent_end_seen: true, final_text: 'Answer.', source_access_auditable: true, stop_reasons: ['toolUse', 'stop']};
  assert.equal(usableAnswer(0, false, good), true);
  for (const reason of ['length', 'deferred', 'error', 'aborted']) assert.equal(usableAnswer(0, false, {...good, stop_reasons: [reason]}), false);
  assert.equal(usableAnswer(0, false, {...good, source_access_auditable: false}), false);
  assert.equal(usableAnswer(0, true, good), false);
  assert.equal(usableAnswer(1, false, good), false);
});

test('shell source access and out-of-scope reads cannot masquerade as zero supplementary reads', () => {
  assert.equal(summarizeEvents([{type: 'tool_execution_start', toolName: 'bash', args: {command: 'read sources'}}], '/probe/input').source_access_auditable, false);
  assert.equal(summarizeEvents([{type: 'tool_execution_start', toolName: 'read', args: {path: '../evaluation-only-cases.json'}}], '/probe/input').source_access_auditable, false);
});
