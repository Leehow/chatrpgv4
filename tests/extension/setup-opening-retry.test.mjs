/** Existing setup completion must forward the explicit retained-source retry. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {SETUP_STEPS} from './fixtures/setup-steps.mjs';
for(const retry of [false,true])test(`setup complete forwards source retry only when requested: ${retry}`,async t=>{
 const table=await openTable({mode:'setup',campaign:'opening-retry-fixture',env:{FAKE_SETUP_RESUME:JSON.stringify({
  completed:SETUP_STEPS.filter(s=>s.id!=='complete').map(s=>s.id),state:{campaign:'opening-retry-fixture',source_kind:'pdf',module_id:'the-haunting',start_scene:'scene-meeting',play_language:'en'}})},
  responses:[fauxAssistantMessage([fauxToolCall('setup',{step:'complete',...(retry?{retry:true}:{})})],{stopReason:'toolUse'}),fauxAssistantMessage('The existing card is kept.')]});
 t.after(()=>table.dispose());const calls=[];
 table.emit('coc:reading-bridge',{async prepare(params){calls.push(params);return {setup_ready:true,reference_ready:true,guidance:{opening:'A meeting.',advice:'Choose a reporter.',scene:'scene-meeting',guide:'',handoff:'Continue.'}};}});
 await table.session.prompt('Retry the opening with the same card.');await waitForIdle(table.session);
 const completion=calls.find(c=>c.targeted===true);assert.ok(completion,JSON.stringify(calls));assert.equal(completion.retry,retry?true:undefined);assert.equal(completion.campaign,'opening-retry-fixture');
});
