import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {KernelError} from '../../extensions/kernel/client.ts';
import {openTable} from './harness.mjs';

test('merge refusals expose actionable choices without copying complete snapshots into model context', async t => {
  const conflicts = [
    {id:'conflict:mod_state:game-mods:snapshot', class:'mod_state', subject:'game-mods', field:'snapshot', modes:['from'],
      values:{archive:{history:'PRIVATE_SNAPSHOT'.repeat(1000)}, letter:{history:'retained branch state'}}},
    {id:'conflict:engine_state:engines:snapshot', class:'engine_state', subject:'engines', field:'snapshot', modes:['from'],
      values:{archive:{receipts:'PRIVATE_ENGINE'}, letter:{receipts:[]}}},
    {id:'conflict:numeric:reporter:luck', class:'numeric', subject:'reporter', field:'luck', modes:['from','min','max'],
      values:{archive:40,letter:60}},
  ];
  const table = await openTable({responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'merge',name:'combined',lines:['archive','letter']}]})],{stopReason:'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate',{text:'The branches remain separate while the conflict is considered.'})],{stopReason:'toolUse'}),
    fauxAssistantMessage('Done.'),
  ]});
  t.after(()=>table.dispose());
  table.emit('coc:mods-bridge',{prepare:async tool=>{
    if(tool==='apply')throw new KernelError({code:'needs',message:'this confluence has conflicts the keeper must settle',
      fix:'send params.dispositions with one entry per conflict id',details:{index:0,conflicts}});
  }});
  await table.session.prompt('Merge the two test branches after settling their differences.');
  const failed=table.session.messages.find(row=>row.role==='toolResult'&&row.toolName==='apply');
  assert.equal(failed.isError,true);
  const text=failed.content.filter(row=>row.type==='text').map(row=>row.text).join('\n');
  const line=text.split('\n').find(row=>row.startsWith('merge conflicts: '));
  assert.ok(line,'The Keeper needs the actual conflict IDs and allowed dispositions');
  const projected=JSON.parse(line.slice('merge conflicts: '.length));
  assert.equal(projected[0].id,conflicts[0].id);
  assert.deepEqual(projected[0].modes,['from']);
  assert.deepEqual(projected[0].lines,['archive','letter']);
  assert.deepEqual(projected[1].lines,['archive','letter']);
  assert.deepEqual(projected[2].values,{archive:40,letter:60});
  assert.deepEqual(projected[2].modes,['from','min','max']);
  assert.doesNotMatch(text,/PRIVATE_SNAPSHOT|PRIVATE_ENGINE/);
  assert.ok(text.length<2000);
  assert.deepEqual(failed.details.coc_error.details.conflicts,conflicts);
});
