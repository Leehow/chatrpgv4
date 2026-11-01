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

/** Live7 cs-1101b: `complete` waited 120 s per call on the opening's reading and named a booked step; turns ran out in silence. */
const resume=(env={})=>({FAKE_SETUP_RESUME:JSON.stringify({completed:SETUP_STEPS.filter(s=>s.id!=='complete').map(s=>s.id),
 state:{campaign:'opening-retry-fixture',source_kind:'pdf',module_id:'the-haunting',start_scene:'scene-meeting',play_language:'en'}}),...env});
const results=session=>session.messages.filter(m=>m.role==='toolResult'&&m.toolName==='setup').map(m=>JSON.parse(m.content.filter(b=>b.type==='text').map(b=>b.text).join('')));

test('§14.19.8: complete waits on the opening for a bounded allowance, and a failed reading is a structured refusal naming complete',async t=>{
 const table=await openTable({mode:'setup',campaign:'opening-retry-fixture',env:resume(),
  responses:[fauxAssistantMessage([fauxToolCall('setup',{step:'complete'})],{stopReason:'toolUse'}),fauxAssistantMessage('The card is kept.')]});
 t.after(()=>table.dispose());const calls=[];
 table.emit('coc:reading-bridge',{async prepare(params,_signal,options){calls.push({params,options});
  if(params.targeted)throw Object.assign(new Error('reading failed'),{code:'reading_failed'});return {setup_ready:true};}});
 const began=Date.now();
 await table.session.prompt('Open the table.');await waitForIdle(table.session);
 const completion=calls.find(c=>c.params.targeted===true);
 assert.ok(completion?.options?.allowanceMs>0&&completion.options.allowanceMs<=20_000,`a bounded wait: ${JSON.stringify(completion?.options)}`);
 const refused=results(table.session).at(-1);
 assert.equal(refused.ok,false);assert.equal(refused.code,'campaign_not_ready');assert.equal(refused.details.reason,'opening_preparing');
 assert.match(refused.fix,/complete again with retry: true/,'the fix names a step the table allows');
 assert.doesNotMatch(refused.fix,/prepare-module/);
 assert.equal(typeof refused.player_reason,'string','the player is told the card is kept');
 assert.ok(Date.now()-began<60_000);
});

test('§14.19.8: a reading left "preparing" with nothing running is read again at complete, not waited on',async t=>{
 const table=await openTable({mode:'setup',campaign:'opening-retry-fixture',
  env:resume({FAKE_KERNEL_MODULE:JSON.stringify({module_id:'the-haunting',reading:{state:'preparing',opening_ready:false,queued:0,active:null,idle:true}})}),
  responses:[fauxAssistantMessage([fauxToolCall('setup',{step:'complete'})],{stopReason:'toolUse'}),fauxAssistantMessage('The card is kept.')]});
 t.after(()=>table.dispose());const calls=[];
 table.emit('coc:reading-bridge',{async prepare(params){calls.push(params);return {setup_ready:true,reference_ready:true};}});
 await table.session.prompt('Open the table.');await waitForIdle(table.session);
 const completion=calls.find(c=>c.targeted===true);
 assert.equal(completion?.retry,true,'the idle reading is asked again');
});
