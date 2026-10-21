/** Actual Pi/native path with deterministic transports; never live-play evidence. */
import test from 'node:test';import assert from 'node:assert/strict';
import {join} from 'node:path';import {readFileSync} from 'node:fs';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {RpcClient} from '../integration/support.ts';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const c=new RpcClient(workspace);try{await c.ok('table.open',{campaign:'test-camp'});await c.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The clerk waits at the desk.'});}finally{await c.close();}}
const packet=commands=>({version:4,commands:[...commands,{kind:'scene',service:'open',crowd:'quiet'}]});
const bad=packet([{kind:'time',minutes:30,reason:'An unselected extra wait'}]);
function answer(batch){return{batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='noul'?{status:'answered',type:'noul',noul:batch.family==='continuous-action-admission'&&!q.key.startsWith('restriction_')?.05:q.key.startsWith('restriction_')?.01:.99}:{status:'answered',type:'choice',choice:Object.keys(q.criteria??{}).find(k=>k!=='none')??'none',confidence:.99}])),usage:{}};}
for(const repeat of [false,true])test('native output returns one proven refusal without executing its time: '+(repeat?'repeat stops':'independent reply'),async t=>{
 let calls=0,sawError=false;const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
  ()=>{calls++;return fauxAssistantMessage([fauxToolCall('output',bad)],{stopReason:'toolUse'});},
  context=>{calls++;sawError=context.messages.some(row=>row.role==='toolResult'&&row.toolName==='output'&&row.isError&&JSON.stringify(row).includes('action_not_authorized'));assert(sawError);assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,0);return fauxAssistantMessage([fauxToolCall('output',repeat?bad:packet([]))],{stopReason:'toolUse'});}
 ]});t.after(()=>table.dispose());await table.session.prompt('I stay at the desk and ask a short question. I do not wait half an hour.');
 assert.equal(calls,2);assert(sawError);assert.deepEqual(table.extensionErrors,[]);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.world.clock.minutes,0);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,repeat?0:1);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,repeat?0:1);
});
