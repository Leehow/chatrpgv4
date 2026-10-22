/** Native protocol regression, not live gameplay or automatic semantic splitting. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall,getCurrentTools} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {SAME_KEEPER_AFTER_RESULT_GUIDANCE} from '../../runtime/keeper-output-guidance.ts';

// §249/§249.6: the single Keeper judges its own move and document lines itself; the batch's map reveal is the line the typed
// consent review reads, and its uncertain verdict refuses the whole atomic batch.
const MAP='player-corbitt-house-map';
const mapTitle=workspace=>JSON.parse(readFileSync(join(workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).map_labels?.[MAP]?.title;
for(const recover of [true,false])test(`a refused native mixed batch ${recover?'can settle an independently authored event before prose':'does not automatically apply its event'}`,async t=>{
 let requests=0,decisions=0,firstPublicState;
 const event={name:'signed-local-statement',summary:'Thomas Hayes signs his own statement beside Knott. A proposed later journey remains unperformed.'};
 const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
  if(batch.family==='held-act-outcome'){
   assert.ok(batch.state.draft.includes('unperformed')||batch.state.draft.includes('has not happened'));
   assert.equal(batch.state.settledReceipts.length,recover?1:0);
   return bindDecisionAnswers(batch,{held_result:{status:'answered',type:'noul',noul:.01}});
  }
  assert.equal(batch.family,'continuous-action-admission');decisions++;assert.deepEqual(batch.state.proposal.kinds,['map']);
  return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(question=>[question.key,
   {status:'answered',type:'noul',noul:.45}])));
 }}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
  env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_JEV_PRESELECT:'0',PI_COC_ISOLATED_OUTPUT:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined},
  async prepareWorkspace(workspace){const client=new RpcClient(workspace);try{
   await client.ok('table.open',{campaign:'test-camp'});
   await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
  }finally{await client.close();}},
  extraExtensions:[{name:'independent-event-driver',factory:engine.extension},{name:'receipt-before-prose',factory(pi){
   pi.events.on('coc:final-delivery',frame=>{if(frame.event==='delta'&&frame.delta&&!firstPublicState)
    firstPublicState=table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp',projection:'receipts',expected_turn:1});});
  }}],responses:[()=>{requests++;return fauxAssistantMessage([fauxToolCall('apply',{effects:[
   {kind:'move',to:'Central Library',travel_minutes:15},
   {kind:'npc',name:'Steven Knott',to:'Central Library'},
   {kind:'map',name:MAP,regions:['ground-entry-hall'],region_labels:{'ground-entry-hall':'Entry hall'},level_labels:{'Ground Floor':'Ground floor'},
    label:'Library trip planned.',why:'Knott spreads the house plan before the proposed journey.'}],event})],{stopReason:'toolUse'});},context=>{
   requests++;
   const previous=JSON.stringify(context.messages),tools=getCurrentTools(context.messages);
   assert.ok(previous.includes('action_admission_uncertain'));
   assert.ok(previous.includes('The proposal is uncommitted'));
   assert.ok(!previous.includes('Close the turn with output'));
   assert.ok(tools.find(tool=>tool.name==='apply').description.includes(SAME_KEEPER_AFTER_RESULT_GUIDANCE));
   assert.ok(!tools.find(tool=>tool.name==='apply').description.includes('write your own final reply beginning with'));
   return fauxAssistantMessage(recover?JSON.stringify({version:1,record:{event},text:'You sign the statement here. The journey remains unperformed.'})
    :'{{public}}You remain beside the desk; the proposed journey has not happened.');
  }]});
 t.after(()=>table.dispose());await table.session.prompt('I sign my statement here, then ask whether he can take me to the library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);assert.equal(decisions,1,'an event-only record adds no consent judgement');
 const refused=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='apply');
 assert.equal(refused.details.coc_error.details.reason,'action_admission_uncertain');
 assert.equal(refused.details.coc_error.details.admitted,undefined,'legacy admitted-line credentials are not minted');
 const atFirst=await firstPublicState;
 assert.equal(atFirst.receipts.filter(receipt=>receipt.kind==='event').length,recover?1:0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(receipt=>receipt.kind==='event').length,recover?1:0);
 assert.equal(turn.receipts.filter(receipt=>['move','npc','time'].includes(receipt.kind)).length,0);
 assert.equal(mapTitle(table.workspace),undefined);
 assert.equal(turn.world.clock.minutes,0);
 assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0,'no separate author');
});
