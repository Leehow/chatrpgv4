/** Real Pi tool dispatch and kernel publication; controlled component evidence, never live play (contract §252). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall as rawToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
  EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
const output=args=>rawToolCall('output',{...args,commands:[...(args.commands??[]),{kind:'scene',service:'open',crowd:'quiet'}]});
async function opened(workspace){const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await client.close();}}
const choice={kind:'mechanics',binds:'push-luck:luck-spend',options:['accept','flee']};
const turnRecord=(table,n)=>JSON.parse(readFileSync(join(table.workspace,'.coc','campaigns','test-camp','turns',String(n).padStart(4,'0')+'.json'),'utf8'));

test('a packet-mode ask stages its choice, and the output prose publishes with it (live el-v2-20261021e T26)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no review is expected');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('ask',choice)],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([output({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'refuse'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I ask Knott again for the sealed file.');
 assert.deepEqual(table.extensionErrors,[]);
 const staged=table.telemetry().filter(row=>row.lane==='packet-choice');
 assert.deepEqual(staged.map(row=>row.event),['staged','published']);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written').length,1,'the output prose is authored');
 const record=turnRecord(table,1);
 assert.equal(record.pending_choice?.binds,'push-luck:luck-spend','the choice is the turn\'s pending choice');
 assert.deepEqual(record.pending_choice.options,choice.options);
 assert.ok(typeof record.rendered_text==='string'&&record.rendered_text.trim().length>0,'the choice is published with prose');
});

test('an unknown option is refused before anything is staged',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no review is expected');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('ask',{...choice,options:['flee','retry']})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([output({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'refuse'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I ask Knott again for the sealed file.');
 assert.equal(table.telemetry().filter(row=>row.lane==='packet-choice').length,0);
 assert.equal(turnRecord(table,1).pending_choice??null,null,'the turn publishes without a choice');
});

test('a defense choice is refused when staged, so the output that follows still delivers (live du-1026g T8)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no review is expected');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('ask',{kind:'mechanics',options:['dodge','fight_back'],binds:'defense:investigator-r2'})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([output({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'refuse'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I ask Knott again for the sealed file.');
 assert.equal(table.telemetry().filter(row=>row.lane==='packet-choice').length,0,'nothing was staged');
 const record=turnRecord(table,1);
 assert.equal(record.pending_choice??null,null);
 assert.ok(typeof record.rendered_text==='string'&&record.rendered_text.trim().length>0,'the turn still delivers its prose');
});
