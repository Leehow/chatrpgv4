/** Receipt meaning reaches later consent; this component is not live-play evidence. */
import assert from 'node:assert/strict';import {test} from 'node:test';import {join} from 'node:path';
import * as settled from '../../extensions/kernel/settled-admission.ts';
import {settledAdmissionEvidence} from '../../extensions/kernel/settled-admission.ts';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
import {openTable} from './harness.mjs';import {RpcClient} from '../integration/support.ts';import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
test('prerequisite evidence carries actual public settlement and counts omitted whole outcomes',()=>{
 const result={outcomes:[{kind:'cash',status:'changed',settlement:'living_standard',purchase_amount:.25,items:[{name:'Stew',amount:.15},{name:'Coffee',amount:.10}],private_notes:'SECRET'},
  {kind:'time',status:'changed',minutes:2},{kind:'cash',status:'changed',quote:'x'.repeat(9000)}]};
 const text=settledAdmissionEvidence(result),evidence=JSON.parse(text);
 assert.equal(evidence.outcomes[0].purchase_amount,.25);assert.equal(evidence.outcomes[0].settlement,'living_standard');assert.equal(evidence.outcomes[1].minutes,2);
 assert(!text.includes('SECRET'));assert.equal(evidence.omitted,1);assert(text.length<9000);assert.equal(settledAdmissionEvidence({receipts:['cash:t1-c1']}),undefined);
});
test('a later native place move receives semantic outcomes from an earlier successful call in this input',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
 let checked=false,table,scene,initialClock,reviewClock;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{
  if(batch.family==='continuous-action-admission'&&batch.state.proposal.kinds?.includes('place')){checked=true;reviewClock=batch.state.current_clock;assert.equal(batch.familyVersion,'25');assert.deepEqual(batch.state.completed_time,{elapsed_minutes:2,charges:[{minutes:2,clock_before:initialClock.minutes,clock_after:initialClock.minutes+2}]});assert(JSON.stringify(batch.state.settled_this_turn).includes('canonical outcomes'));assert(batch.state.settled_this_turn.some(line=>line.includes('"minutes":2')));}
  const answers=Object.fromEntries(batch.questions.map(q=>q.type==='noul'?[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?.01:.99}]
   :[q.key,{status:'answered',type:'choice',choice:Object.keys(q.criteria).find(key=>key!=='none')??'none',confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(key=>[key,key==='none'?.01:.99]))}]));
  return {batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[]};
 }}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,prepareWorkspace:async workspace=>{
  const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The landlord waits at the office.'});}finally{await client.close();}},
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const where=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).where;scene=where.scene;initialClock=where.clock;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.99,feature:.01,observation:.01}});
   return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:2,reason:'The selected wait.'}]})],{stopReason:'toolUse'});
  },()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'place',action:'move',to:scene,at:'window',relation:'beside',additions:[{name:scene,features:[{name:'window',description:'A tall street window.'}]}]},{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I wait two minutes, then walk to the window.');
 assert(checked);assert.equal(reviewClock?.minutes,initialClock.minutes+2,'the actual subsequent native review receives the advanced canonical clock');assert(reviewClock?.at||reviewClock?.hh,'elapsed minutes alone are not a local game-time anchor');assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('completed time comes only from consistent deduplicated canonical deltas',()=>{
 const time={id:'time:t1-c1',kind:'time',minutes:5,clock_before:1017,clock_after:1022,why:'PRIVATE_PURPOSE'};
 assert.equal(typeof settled.settledTimeEvidence,'function');
 const evidence=settled.settledTimeEvidence([time,time,{...time,id:'time:t1-c2',minutes:2,clock_before:1022,clock_after:1024}]);
 assert.deepEqual(evidence,{elapsed_minutes:7,charges:[{minutes:5,clock_before:1017,clock_after:1022},{minutes:2,clock_before:1022,clock_after:1024}]});
 assert(!JSON.stringify(evidence).includes('PRIVATE'));assert(!JSON.stringify(evidence).includes('time:t1'));
 for(const receipts of [[],[{id:'time:t1-c1',kind:'time',minutes:5}], [time,{...time,minutes:4,clock_after:1021}], [{...time,clock_after:1023}], [{...time,minutes:-1}], [{...time,minutes:'5'}]])assert.equal(settled.settledTimeEvidence(receipts),undefined);
 assert.deepEqual(settled.settledTimeEvidence([{...time,minutes:0,clock_after:1017}]),{elapsed_minutes:0,charges:[{minutes:0,clock_before:1017,clock_after:1017}]});
});

test('completed time never grants an unselected or restricted follow-up',async()=>{
 for(const [selection,veto,verdict]of[[.59,.1,'uncertain'],[.9,.41,'uncertain'],[.9,.1,'authorized']]){
  let seen;const completedTime=settled.settledTimeEvidence([{id:'time:t1-c1',kind:'time',minutes:5,clock_before:1017,clock_after:1022}]);
  const result=await reviewAdmissionJevOnly({campaign:'completed-time',proposal:{tool:'apply',key:'view',lines:['Observe the street.'],kinds:['place'],operations:[{kind:'place',action:'observe',to:'Street'}]},context:{turn:1,playerText:'I wait, then look outside.',investigators:[{name:'Thomas'}],present:[],delivered:[],landed:[],refused:[],completedTime},env:{},record:()=>{},ctx:{},decision:{decide:async batch=>{seen=batch;return{batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?veto:selection}])),usage:{}};}}});
  assert.equal(seen.familyVersion,'25');assert.deepEqual(seen.state.completed_time,completedTime);assert.equal(result.verdict.verdict,verdict);
 }
});
