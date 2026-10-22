/** Real Pi tool dispatch, kernel settlement and author task; controlled component evidence, never live play (contract §250.18). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
  EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
const office='commission-briefing';
async function opened(workspace){const client=new RpcClient(workspace);try{
  await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});
}finally{await client.close();}}
const output=commands=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[...commands,{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});
const tasks=table=>table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written').map(row=>JSON.parse(readFileSync(join(row.attempt,'task.json'),'utf8')));

test('returning to a place shown before, the author receives what was recorded there on earlier visits (§250.18, live el-v2-20261021e)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no review is expected');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>output([{kind:'place',action:'observe',to:'here',at:'office window',sense:'sight',facts:['Across the street stand two brick office blocks.']}]),
   ()=>output([{kind:'place',action:'move',to:'Corner Cafe',via:'A few doors down',travel_band:'adjacent',additions:[{name:'Corner Cafe',within:null,description:'A small cafe.'}]}]),
   ()=>output([{kind:'place',action:'move',to:office}])]});
 t.after(()=>table.dispose());
 await table.session.prompt('I look out of the office window.');
 await table.session.prompt('I walk to the cafe a few doors down.');
 await table.session.prompt('I walk back to Knott\'s office.');
 const [, away, back]=tasks(table);
 assert.equal(away.decision_context.reference_observations?.some(group=>group.revisit),undefined,'a first visit has no history to give');
 const revisit=back.decision_context.reference_observations?.find(group=>group.revisit);
 assert.ok(revisit,JSON.stringify(back.decision_context.reference_observations));
 assert.deepEqual(revisit.records.map(row=>row.facts),[['Across the street stand two brick office blocks.']]);
 assert.ok(table.telemetry().some(row=>row.lane==='location-revisit'&&row.event==='history'&&row.records===1));
});
