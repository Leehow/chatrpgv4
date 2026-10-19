/** Real Pi/TS book-name refusal and explicit author correction; not live acceptance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {SAME_KEEPER_AFTER_RESULT_GUIDANCE} from '../../runtime/keeper-output-guidance.ts';

for(const [correct,prior] of [[true,false],[false,false],[false,true]])test(`a real inline book_name refusal ${correct?'allows an explicitly corrected record before prose':prior?'preserves an earlier successful receipt without replay':'allows staying put without automatic replay'}`,async t=>{
 let requests=0,decisions=0,firstPublic;
 const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
  if(batch.family==='held-act-outcome')return bindDecisionAnswers(batch,{held_result:{status:'answered',type:'noul',noul:.01}});
  assert.equal(batch.family,'continuous-action-admission');decisions++;
  return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:question.key.startsWith('restriction_')?.01:.99}])));
 }}});
 const event={name:'selected-short-wait',summary:'The selected short wait finishes beside the same desk.'};
 const time={kind:'time',minutes:15,why:'The player selected this fifteen-minute wait.'};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
  env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_JEV_PRESELECT:'0',PI_COC_ISOLATED_OUTPUT:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined},
  async prepareWorkspace(workspace){const client=new RpcClient(workspace);try{
   await client.ok('table.open',{campaign:'test-camp'});
   await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
  }finally{await client.close();}},
  extraExtensions:[{name:'inline-kernel-recovery',factory:engine.extension},{name:'inline-order-observer',factory(pi){
   pi.events.on('coc:final-delivery',frame=>{if(frame.event==='delta'&&frame.delta&&!firstPublic)
    firstPublic=table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp',projection:'receipts',expected_turn:1});});
  }}],responses:[...(prior?[()=>{requests++;return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:1,why:'The first selected minute.'}]})],{stopReason:'toolUse'});}]:[]),()=>{requests++;return fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[time,
    {kind:'npc',name:'Steven Knott assistant',to:'here',walk_on:true}],event},text:'REJECTED_INLINE_BODY'}));},context=>{
   requests++;const previous=JSON.stringify(context.messages);
   assert.ok(previous.includes('book_name')&&previous.includes('npc.name'));
   assert.ok(previous.includes('leave walk_on out')&&previous.includes('present[]'),'the actual kernel fix is retained');
   assert.ok(previous.includes('invalid_params')&&previous.includes(SAME_KEEPER_AFTER_RESULT_GUIDANCE));
   assert.ok(previous.includes('Only proposed effects and events without successful receipts remain unsettled'));
   assert.ok(previous.includes('already confirmed by receipts remain settled, including after a publication failure'));
   assert.ok(!previous.includes('place another outstanding record in the final response'));
   assert.ok(!previous.includes('Then begin the public response with'));
   return fauxAssistantMessage(correct?JSON.stringify({version:1,record:{effects:[time,{kind:'npc',name:'Steven Knott',to:'here'}],event},text:'The fifteen minutes pass beside the desk.'})
    :prior?'{{public}}The first minute passed beside the desk. The fifteen-minute interval has not elapsed.'
    :'{{public}}You remain beside the desk. That fifteen-minute interval has not elapsed.');
  }]});
 t.after(()=>table.dispose());await table.session.prompt('I stay here and wait fifteen minutes while Knott arranges the papers.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,prior?3:2,JSON.stringify(table.telemetry().filter(row=>['keeper-delivery','admission'].includes(row.lane)).map(row=>({lane:row.lane,ok:row.ok,reason:row.reason,verdict:row.verdict}))));
 assert.equal(decisions,prior?2:1,'bookkeeping correction reuses the selected wait; a different duration retains fresh consent review');
 const delivered=table.entries('coc-final-delivery').filter(row=>row.event==='delta').map(row=>row.delta).join('');
 assert.ok(!delivered.includes('REJECTED_INLINE_BODY'));
 const first=await firstPublic;assert.equal(first.receipts.filter(row=>row.kind==='time').length,correct||prior?1:0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.world.clock.minutes,correct?15:prior?1:0);
 // Knott already occupies this desk: the corrected assignment is unchanged, not a new NPC event.
 for(const kind of ['time','npc','event'])assert.equal(turn.receipts.filter(row=>row.kind===kind).length,kind==='npc'?0:correct||kind==='time'&&prior?1:0);
 const failed=table.telemetry().find(row=>row.lane==='keeper-delivery'&&row.ok===false);
 assert.ok(failed,'the failed private attempt is retained');
 assert.equal(table.telemetry().some(row=>row.lane==='final-output'&&row.event==='start'),false);
});
