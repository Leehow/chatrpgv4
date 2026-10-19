/** Real host/kernel, controlled semantic decisions and writer; not gameplay evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_PACKET_PRESCREEN:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
test('the Keeper creates a temporary shop attendant and answers in the same native packet',async t=>{
 let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='additional_work'?.99:.01}])),issues:[],coverage:{required:[],answered:[],unknown:[]}})}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],prepareWorkspace:async workspace=>{
  const k=new RpcClient(workspace);try{
   await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You stand by the office door.'});
   await k.ok('table.player_input',{campaign:'test-camp',text:'I walk to the public shop.'});
   await k.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'move',to:'Fixture Shop',via:'street',travel_minutes:3,establish:{summary:'A shop with an ordinary service counter.',within:null}}]});
   await k.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'The shop counter is ahead.'});
  }finally{await k.close();}
 },responses:[()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'walk_on',slot:'new_1',label:'the shop attendant',reason:'The shop serves customers during this local shift.'},{kind:'scene',service:'open',crowd:'quiet'}],interactions:[{actor:'new_1',to:['investigator_1'],act:'answer',content:[{result_ref:'scene'}]}]})],{stopReason:'toolUse'});}]});
 t.after(()=>table.dispose());await table.session.prompt('I ask the shop attendant whether they are open, without buying anything.');
 const written=table.telemetry().find(r=>r.lane==='isolated-expression'&&r.event==='written');
 assert.ok(written,JSON.stringify(table.telemetry().filter(r=>r.lane==='keeper-delivery'||r.lane==='turn-packet-prototype')));
 const task=JSON.parse(readFileSync(join(written.attempt,'task.json')));
 const actor=task.decision_context.responses[0].actor;assert.match(actor,/^npc_\d+$/);assert.notEqual(actor,'new_1');
 assert.equal(task.decision_context.people.find(p=>p.ref===actor).display_name,'the shop attendant');
 assert.equal(task.decision_context.scene.presence.population,'populated');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
 assert.equal(requests,1,'no repair inference');
 const scope=table.telemetry().find(row=>row.lane==='first-sight'&&row.event==='render_scope');
 assert.ok(scope.items.includes('the shop attendant'),'new arrival is checked in its own delivery');
 assert.ok(!scope.items.includes('Steven Knott'),'departure targets are not checked against arrival prose');
});
