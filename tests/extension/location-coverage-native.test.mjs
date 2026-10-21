/** Native Pi refusal/recovery with deterministic transport; not live Keeper acceptance. */
import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {readFileSync} from 'node:fs';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';import {RpcClient} from '../integration/support.ts';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function prepared(workspace){const k=new RpcClient(workspace);try{
 await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.player_input',{campaign:'test-camp',text:'I note the shut interior door.'});const view=await k.ok('mods.locations.inspect',{campaign:'test-camp',need:'context'});
 await k.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'place',action:'establish',additions:[{name:view.place.name,features:[{name:'Door',description:'A hinged interior door.',state:'closed',passable:false}]}]}]});
 await k.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'The interior door is shut.'});
}finally{await k.close();}}
const step=[{kind:'place',action:'move',to:'here',at:'Door',relation:'beside'},
 {kind:'place',action:'observe',to:'here',sense:'sight',access:'limited',scope:'The near furniture.',facts:['A wooden chair stands by the wall.']}];
const packet=commands=>({version:4,commands:[...commands,{kind:'scene',service:'open',crowd:'quiet'}]});
const decide=async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='noul'?{status:'answered',type:'noul',noul:q.key==='feature_blocked'||q.key==='feature_satisfied'||q.key.startsWith('restriction_')?.01:.99}:{status:'answered',type:'choice',choice:Object.keys(q.criteria??{}).find(key=>key!=='none')??'none',confidence:.99}])),usage:{}});
test('feature omission reaches the same native Keeper as actionable feedback and correction writes only once',async t=>{
 const engine=createHybridEngine({env,decision:{decide}});let calls=0;const failures=[];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:prepared,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension},{name:'review-fixture',factory:pi=>{
   pi.on('tool_result',event=>{if(event.isError)failures.push(event);});
   pi.on('tool_call',event=>{if(event.toolName==='output')pi.events.emit('coc:location-demand',{campaign:'test-camp',turn:2,review:true,selection:{move:.99,feature:.99,observation:.99}});});
  }}],responses:[
   ()=>{calls++;return fauxAssistantMessage([fauxToolCall('output',packet(step))],{stopReason:'toolUse'});},
   context=>{calls++;const refusal=context.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='output'&&row.isError);
    assert(refusal);const payload=refusal.details?.coc_error??JSON.parse(refusal.content.find(row=>row.type==='text').text);
    assert.equal(payload.details.reason,'place_decision_incomplete');assert.deepEqual(payload.details.corrections.map(row=>row.axis),['feature']);
    assert(payload.fix.includes('action:"feature"'));
    assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,0);
    return fauxAssistantMessage([fauxToolCall('output',packet([{kind:'place',action:'feature',to:'here',at:'Door',state:'open',passable:true},...step]))],{stopReason:'toolUse'});
   }
  ]});t.after(()=>table.dispose());
 await table.session.prompt('I walk to the door, open it and look at the near furniture.');
 assert.equal(calls,2);assert.deepEqual(table.extensionErrors,[]);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.deepEqual(turn.receipts.filter(row=>row.kind==='place').map(row=>row.action),['feature','move','observe'],JSON.stringify(failures));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
