/** Real Pi argument preparation and kernel dispatch; controlled component evidence, never live play (contract §250.14). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
  EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await client.close();}}

test('an apply effect naming a person by the packet\'s issued investigator reference reaches the kernel by name (live el-v2-20261021f T2)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no review is expected');}}});
 const effects=[{kind:'cash',delta:-1,category:'expense',subject:'investigator_1',why:'Coffee at the counter.'}];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I pay for a coffee.');
 const named=table.telemetry().filter(row=>row.lane==='arguments'&&row.event==='person_reference_named');
 assert.deepEqual(named.map(row=>row.fields),[['effects[0].subject']]);
 const results=table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply').map(message=>JSON.stringify(message.content));
 assert.ok(results.length&&results.every(text=>!text.includes("no investigator 'investigator_1'")),results.join('\n'));
});
