/** Native Pi/kernel component seams with deterministic decisions; never live-play evidence. */
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
const look=()=>fauxAssistantMessage([fauxToolCall('look',{focus:'scene'})],{stopReason:'toolUse'});
const output=()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});

test('a read spiral gets a progress note on its eighth consecutive read, never a refusal',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>({batchId:batch.id,status:'complete',answers:{},coverage:{required:[],answered:[],unknown:[]},issues:[]})}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[...Array.from({length:9},look),output]});
 t.after(()=>table.dispose());
 await table.session.prompt('I look around the office.');
 assert.deepEqual(table.extensionErrors,[]);
 const reads=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='look');
 assert.equal(reads.length,9);
 const noted=reads.map(row=>JSON.stringify(row.content).includes('Host note: 8 reads in this input'));
 assert.deepEqual(noted,[false,false,false,false,false,false,false,true,false],'only the eighth consecutive read carries the note');
 assert(reads.every(row=>row.isError!==true),'no read is refused');
 assert.equal(table.telemetry().filter(row=>row.lane==='keeper-progress'&&row.event==='read_streak_noted').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1,'the turn still publishes');
});
