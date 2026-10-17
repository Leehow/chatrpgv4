/** Captured t206 calls at the actual Pi/kernel seam; controlled decisions, never live acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';

const captured=JSON.parse(readFileSync(new URL('./fixtures/t206-refused-move.json',import.meta.url)));
function decision(batch){return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(question=>[question.key,
 question.type==='noul'?{status:'answered',type:'noul',noul:.3}:{status:'answered',type:'choice',choice:'later',confidence:1,
 probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key==='later'?1:0]))}])));}
async function opened(workspace){const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});
 await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});}finally{await client.close();}}
test('zero-settlement write exhaustion ends the native input before captured false arrival can be authored',async t=>{
 let requests=0;
 const engine=createHybridEngine({env:{},decision:{decide:async batch=>decision(batch)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,
  env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_JEV_PRESELECT:'0',PI_COC_MEMORY_BACKFILL:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined},
  runDriver:engine.runDriver,extraExtensions:[{name:'exhaustion-driver',factory:engine.extension}],responses:[
   ...captured.proposals.map((args,index)=>()=>{requests++;return fauxAssistantMessage([fauxToolCall('apply',args,{id:`captured-${index}`})],{stopReason:'toolUse'});}),
   ()=>{requests++;return fauxAssistantMessage(captured.publicResponse);}]});
 t.after(()=>table.dispose());await table.session.prompt(captured.player);await waitForIdle(table.session);
 assert.deepEqual(table.extensionErrors,[]);
 assert.equal(requests,3,'a spent zero-settlement write budget must not request a final success story');
 const refused=table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply');
 assert.equal(refused.length,3,'native cancellation must not duplicate the final refused call');
 assert.equal(new Set(refused.map(message=>message.toolCallId)).size,3);
 assert.ok(refused.every(message=>message.isError&&message.details.coc_error),'all original refusal results survive finalization');
 assert.ok(table.telemetry().some(row=>row.lane==='turn'&&row.event==='input_ended'&&row.cause==='write_refusal_exhausted'));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='delta').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.player_text,captured.player);assert.equal(turn.receipts.length,0);assert.equal(turn.world.clock.minutes,0);
 const cursor=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turn.json')));
 assert.equal(cursor.state,'awaiting_player');assert.equal(cursor.turn,2,'the stranded input closes without another player utterance');
 table.faux.setResponses([fauxAssistantMessage('{{reference}}I can clarify the destination before departing.')]);
 await table.session.prompt('I stay here and clarify which place was meant.');
 assert.ok(table.telemetry().filter(row=>row.tool==='table.player_input'&&row.ok).length>=2,'control returns to a real next player input');
});

test('a valid partial settlement survives exhaustion and may still be narrated',async t=>{
 let requests=0,admissions=0;
 const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
  if(batch.family!=='continuous-action-admission')return decision(batch);
  const probability=++admissions===1?.99:.3;
  return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:probability}])));
 }}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,
  env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_JEV_PRESELECT:'0',PI_COC_MEMORY_BACKFILL:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined},
  runDriver:engine.runDriver,extraExtensions:[{name:'partial-exhaustion-driver',factory:engine.extension}],responses:[
   fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:1,why:'The selected one-minute wait.'}]})],{stopReason:'toolUse'}),
   ...captured.proposals.map((args,index)=>()=>{requests++;return fauxAssistantMessage([fauxToolCall('apply',args,{id:`partial-${index}`})],{stopReason:'toolUse'});}),
   ()=>{requests++;return fauxAssistantMessage('{{public}}The minute passes beside the same desk. The destination is still unresolved.');}]});
 t.after(()=>table.dispose());await table.session.prompt('I wait one minute, then try my requested destination.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,4);
 assert.equal(table.telemetry().some(row=>row.event==='input_ended'&&row.cause==='write_refusal_exhausted'),false);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);assert.equal(turn.world.clock.minutes,1);
 assert.equal(turn.receipts.filter(row=>row.kind==='move').length,0);
 assert.ok(table.entries('coc-final-delivery').some(row=>row.event==='delta'));
});
