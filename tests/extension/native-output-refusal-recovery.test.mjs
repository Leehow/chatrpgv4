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
const wait=packet([{kind:'time',minutes:30,reason:'The selected half-hour wait'}]);
function answer(batch){return{batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='noul'?{status:'answered',type:'noul',noul:batch.family==='continuous-action-admission'&&!q.key.startsWith('restriction_')?.05:q.key.startsWith('restriction_')?.01:.99}:{status:'answered',type:'choice',choice:Object.keys(q.criteria??{}).find(k=>k!=='none')??'none',confidence:.99}])),usage:{}};}
// §249: every native packet command (move, place, time, NPC, scene, relationship) is either the single Keeper's own judgment or
// unreviewed, so a packet no longer receives a typed consent refusal. The wait lands as the Keeper judged it; a consent
// reviewer that would refuse it (the fixture answers selection .05) is never asked.
test('a native output packet wait is the Keeper\'s own judgment: it lands without consent review and publishes once',async t=>{
 let calls=0;const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch.family);return answer(batch);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
  ()=>{calls++;return fauxAssistantMessage([fauxToolCall('output',wait)],{stopReason:'toolUse'});},
  ()=>{calls++;return fauxAssistantMessage([fauxToolCall('output',packet([]))],{stopReason:'toolUse'});}
 ]});t.after(()=>table.dispose());await table.session.prompt('I wait at the desk for half an hour, then ask a short question.');
 assert.equal(calls,1);assert.deepEqual(table.extensionErrors,[]);
 assert.equal(table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='output'&&row.isError).length,0);
 assert.equal(batches.filter(family=>family==='continuous-action-admission').length,0);
 assert.deepEqual(table.telemetry().filter(row=>row.lane==='admission'&&row.path==='keeper_judged').map(row=>({kinds:row.kinds,jev_calls:row.jev_calls})),[{kinds:['time'],jev_calls:0}]);
 assert.equal(table.telemetry().filter(row=>row.lane==='output-refusal-recovery').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.world.clock.minutes,30);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,1);
});
