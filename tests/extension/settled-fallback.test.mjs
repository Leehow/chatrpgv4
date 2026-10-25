/** §271: a turn never ends silent: what settled is published when the Keeper's own delivery did not land. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';

const base={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
 EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});
 await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await client.close();}}
function answer(batch,p){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?1-p:p}];
 const choice=Object.keys(q.criteria).find(x=>x!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(x=>[x,x===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));
 return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}
async function play(t,env,responses,input='I look around the office.'){
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses});
 t.after(()=>table.dispose());await table.session.prompt(input);return table;
}
const published=table=>table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed'&&row.turn===1).length;
const fallbacks=table=>table.telemetry().filter(row=>row.event==='settled_fallback_started');

test('the same broken Turn IR output twice still ends in prose',async t=>{
 const broken={version:5,actions:[{op:'material',action:'show',item:'letter',holder:'investigator_1'}]};
 const table=await play(t,{...base,PI_COC_TURN_IR:'1'},[
  fauxAssistantMessage([fauxToolCall('output',broken)],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('output',broken)],{stopReason:'toolUse'}),
  fauxAssistantMessage('done')]);
 assert.equal(fallbacks(table).length,1,'the host published what settled');
 assert.equal(published(table),1);
});

test('a Keeper that stops without delivering still ends in prose',async t=>{
 const table=await play(t,base,[fauxAssistantMessage('I am not sure what to do.')]);
 assert.equal(fallbacks(table).length,1);
 assert.equal(published(table),1);
});
