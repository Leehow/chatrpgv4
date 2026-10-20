/** Current authorization must not inherit an older discharged stranded declaration. */
import {test} from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {immediatelyPrecedingUnfinished} from '../../extensions/kernel/admission.ts';
import {openTable} from './harness.mjs';import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
test('only the immediately preceding stranded declaration is retained',()=>{
 const failed={turn:1,closed:'stranded',player:'I visit the inn.'};
 assert.equal(immediatelyPrecedingUnfinished([failed]),failed.player);
 assert.equal(immediatelyPrecedingUnfinished([failed,{turn:2,player:'I return to the desk.',keeper:'You return.'}]),undefined);
 assert.equal(immediatelyPrecedingUnfinished([{turn:0,keeper:'Opening'},failed]),failed.player);
 assert.equal(immediatelyPrecedingUnfinished([]),undefined);
});
test('a real later delivery discharges the old declaration before native consent review',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='noul'?{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')||q.key.endsWith('_blocked')?.01:.99}:{status:'answered',type:'choice',choice:Object.keys(q.criteria)[0],confidence:.99,probabilities:{[Object.keys(q.criteria)[0]]:1}}]))};}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],prepareWorkspace:async workspace=>{
  const k=new RpcClient(workspace);try{
   await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The office is open.'});
   await k.ok('table.player_input',{campaign:'test-camp',text:'I visit the inn.'});await k.ok('table.release',{campaign:'test-camp',release:'stranded'});
   await k.ok('table.player_input',{campaign:'test-camp',text:'I remain at the desk.'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t2-c1',text:'You remain at the desk.'});
  }finally{await k.close();}
 },responses:[fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:1}]})],{stopReason:'toolUse'}),fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I wait here for one minute.');
 const consent=batches.filter(batch=>batch.family==='continuous-action-admission');assert(consent.length>0);
 assert(consent.every(batch=>batch.state.unfinished_player_words===undefined),'the old inn visit is no longer the immediately preceding unfinished input');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
