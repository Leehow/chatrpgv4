/** Ready answers (PI_COC_KP_READY_ANSWERS=1): real host/kernel, controlled decisions and writer; not gameplay evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';

const base={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_PACKET_PRESCREEN:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
const withFlag=(value,run)=>{const before=process.env.PI_COC_KP_READY_ANSWERS;if(value===undefined)delete process.env.PI_COC_KP_READY_ANSWERS;else process.env.PI_COC_KP_READY_ANSWERS=value;
 try{return run();}finally{if(before===undefined)delete process.env.PI_COC_KP_READY_ANSWERS;else process.env.PI_COC_KP_READY_ANSWERS=before;}};

test('a destination for a newcomer seats the newcomer first and names them by their seat',()=>{
 const packet={version:4,commands:[{kind:'npc',actor:'new_1',to:'away',reason:'Leaves after answering.'},{kind:'walk_on',slot:'new_1',label:'the shop attendant',reason:'On shift.'}]};
 const on=withFlag('1',()=>compileTurnPacket(packet)).effects;
 assert.deepEqual(on.map(row=>[row.name,!!row.walk_on]),[['the shop attendant',true],['the shop attendant',false]]);
 const off=withFlag(undefined,()=>compileTurnPacket(packet)).effects;
 assert.deepEqual(off.map(row=>row.name),['new_1','the shop attendant'],'off: unchanged');
});

test('with ready answers a newcomer walks on and takes a mood in the same native packet',async t=>{
 process.env.PI_COC_KP_READY_ANSWERS='1';t.after(()=>{delete process.env.PI_COC_KP_READY_ANSWERS;});
 const env={...base,PI_COC_KP_READY_ANSWERS:'1'};
 let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='additional_work'?.99:.01}])),issues:[],coverage:{required:[],answered:[],unknown:[]}})}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],prepareWorkspace:async workspace=>{
  const k=new RpcClient(workspace);try{
   await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You stand by the office door.'});
   await k.ok('table.player_input',{campaign:'test-camp',text:'I walk to the public shop.'});
   await k.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'move',to:'Fixture Shop',via:'street',travel_minutes:3,establish:{summary:'A shop with an ordinary service counter.',within:null}}]});
   await k.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'The shop counter is ahead.'});
  }finally{await k.close();}
 },responses:[()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'walk_on',slot:'new_1',label:'the shop attendant',reason:'The shop serves customers during this local shift.'},{kind:'scene',service:'open',crowd:'quiet'},{kind:'mood',actor:'new_1',mood:'wary'}],interactions:[{actor:'new_1',to:['investigator_1'],act:'answer',content:[{result_ref:'scene'}]}]})],{stopReason:'toolUse'});}]});
 t.after(()=>table.dispose());await table.session.prompt('I ask the shop attendant whether they are open, without buying anything.');
 const refusals=table.telemetry().filter(r=>r.lane==='turn-packet-prototype'&&r.ok===false);
 assert.equal(refusals.length,0,JSON.stringify(refusals));
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
 assert.equal(requests,1,'no repair inference');
 const block=table.telemetry().find(r=>r.lane==='ready-answers'&&r.event==='block');
 assert.ok(block&&block.bytes>0&&block.bytes<block.capsule_bytes,JSON.stringify(block));
});

import {normalizeTurnPacketArguments} from '../../runtime/turn-packet-prototype.ts';
import {readyBlock} from '../../runtime/ready-answers.ts';

test('a packet array sent as JSON text is that array, only with ready answers',()=>{
 const raw={version:4,commands:JSON.stringify([{kind:'scene',service:'open',crowd:'quiet'}])};
 const on=withFlag('1',()=>normalizeTurnPacketArguments(raw));
 assert.ok(Array.isArray(on.args.commands));assert.deepEqual(on.arrayTextFields,['commands']);
 const off=withFlag(undefined,()=>normalizeTurnPacketArguments(raw));
 assert.equal(typeof off.args.commands,'string');
 const junk=withFlag('1',()=>normalizeTurnPacketArguments({version:4,commands:'not json'}));
 assert.equal(junk.args.commands,'not json','anything else stays for the refusal');
});

test('one scene per stop keeps the later assessment; a journey repeated as time is dropped',()=>{
 const raw={version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},{kind:'scene',service:'closed',crowd:'empty'},
  {kind:'place',action:'move',to:'Harbour',travel_minutes:20},{kind:'time',minutes:20,reason:'walk'},{kind:'time',minutes:15,reason:'search'},{kind:'scene',service:'open',crowd:'active'}]};
 const on=withFlag('1',()=>normalizeTurnPacketArguments(raw));
 assert.deepEqual(on.args.commands.map(c=>[c.kind,c.service??c.minutes??c.to]),[['scene','closed'],['place','Harbour'],['time',15],['scene','open']]);
 assert.equal(on.sceneRepairs,2);
 const off=withFlag(undefined,()=>normalizeTurnPacketArguments(raw));
 assert.equal(off.args.commands.length,6,'off: unchanged');
});

test('the ready block gathers people, clock, charged time, holdings and checks from the capsule',()=>{
 const capsule={where:{scene:'harbour',clock:{minutes:130,day:1,hh:'10',mm:'10',day_part:'morning'},exits:[{to:'church',display_name:'Church',travel_minutes:12},{to:'cellar'}]},
  present:[{ref:'npc_1',display_name:'the harbourmaster',name_known:false,company:'goes_with_party'},{ref:'npc_2',display_name:'Ann'}],
  npc_references:{people:[{ref:'npc_1',display_name:'the harbourmaster'},{ref:'npc_3',display_name:'Vicar Hale',recorded_at:'church'}]},
  public_inventory:{holders:[{name:'Mara',items:[{name:'rope',quantity:1},{name:'match',quantity:3}]}]},
  documents_in_reach:{rows:[{name:'ledger',holder:'Mara',reach:'investigator',open:true}]},
  checks_this_turn:{rows:[{id:'r1',skill:'Spot Hidden',goal:'find the mark',level:'regular',passed:false}]}};
 const block=readyBlock(capsule,100);
 assert.deepEqual(block.people_here,[{ref:'npc_1',called:'the harbourmaster',name_known:false,with_party:true},{ref:'npc_2',called:'Ann'}]);
 assert.deepEqual(block.known_elsewhere,[{ref:'npc_3',called:'Vicar Hale',at:'church'}]);
 assert.deepEqual(block.clock,{now:'day 1 10:10 (morning)',charged_this_input_minutes:30});
 assert.deepEqual(block.travel,[{to:'Church',travel_minutes:12}]);
 assert.deepEqual(block.holdings,[{holder:'Mara',items:['rope','match x3']}]);
 assert.deepEqual(block.documents,[{name:'ledger',holder:'Mara',reach:'investigator',open:true}]);
 assert.deepEqual(block.checks_settled,[{skill:'Spot Hidden',goal:'find the mark',passed:false,level:'regular'}]);
});
