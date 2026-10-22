/** Real Pi tool dispatch and kernel settlement; controlled component evidence, never live play (contract §249.4). */
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
const action=skill=>({intent:'investigate',goal:'Open the padlock on the side door',method:'Work the lock with the small picks',skill,stakes:'The door stays shut.',decision:'core-check:ordinary-check'});

test('a resolve refused for an unknown skill is settled by the corrected call of the same act, and the turn publishes (live el-v2-20261021f T25)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no review is expected');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('resolve',{action:action('Lockpicks')})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('resolve',{action:action('Locksmith')})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I kneel at the side door and try to pick the padlock.');
 const telemetry=table.telemetry();
 assert.ok(telemetry.some(row=>row.lane==='held-operation'&&row.event==='parameter_failure_reconciled'),JSON.stringify(telemetry.filter(row=>row.lane==='held-operation')));
 assert.equal(telemetry.filter(row=>row.lane==='turn'&&row.event==='input_ended'&&row.cause==='held_act_unconfirmed').length,0,'the corrected act releases the hold');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1,'the turn publishes');
});
