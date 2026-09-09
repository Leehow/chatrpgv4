import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {KernelError} from '../../extensions/kernel/client.ts';
import {openTable} from './harness.mjs';

test('a Mod refusal exposes missing objects and narrative repairs to the Keeper before retry', async t => {
  const missing = [{name:'Desk lamp', category:'item', reason:'The draft gives away an undefined object'}];
  const findings = [{reason:'A favorable first impression has no observable consequence',
    fix:'Show a courtesy before the clerk refuses access; preserve the failed Persuade result'}];
  const table = await openTable({responses:[
    fauxAssistantMessage([fauxToolCall('narrate', {text:'\u9986\u5458\u62d2\u7edd\u4e86\u8bf7\u6c42\u3002'})], {stopReason:'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate', {text:'\u9986\u5458\u8bf7\u4f60\u5750\u4e0b\uff0c\u4f46\u62d2\u7edd\u4e86\u8bf7\u6c42\u3002'})], {stopReason:'toolUse'}),
    fauxAssistantMessage('Done.'),
  ]});
  t.after(() => table.dispose());
  let attempts = 0;
  table.emit('coc:mods-bridge', {prepare:async tool => {
    if (tool === 'narrate' && attempts++ === 0) throw new KernelError({
      code:'needs', message:'A Mod found an incomplete consequence in the unpublished draft',
      fix:'Address the missing objects or narrative findings, then retry the narration without rerolling settled actions',
      details:{reason:'mod_narrative_repair', missing, findings},
    });
  }});
  await table.session.prompt('I ask the clerk for access.');
  const results = table.session.messages.filter(message => message.role === 'toolResult' && message.toolName === 'narrate');
  assert.equal(results.length, 2);
  assert.equal(results[0].isError, true);
  const text = results[0].content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  const repairLine = text.split('\n').find(line => line.startsWith('mod repair: '));
  assert.ok(repairLine, 'The model-visible tool body must include the concrete Mod repair');
  const feedback = JSON.parse(repairLine.slice('mod repair: '.length));
  assert.deepEqual(feedback, {missing, findings});
  assert.deepEqual(results[0].details.coc_error.details.findings, findings);
  assert.match(text, /without rerolling settled actions/);
  assert.equal(results[1].isError, false);
  assert.equal(table.kernelRequests().filter(row => row.method === 'table.narrate').length, 1);
  assert.equal(table.kernelRequests().filter(row => row.method === 'table.resolve').length, 0);
});
