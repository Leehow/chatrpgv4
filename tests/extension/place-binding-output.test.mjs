/** §204.4 / Enhanced Locations: a place registered through output.commands reaches the source binding like a native place move. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitFor} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',PI_COC_SCENE_PLACEMENT:'off',
 EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
const excerpts={source_answer:{status:'excerpts',authority:'original-source-excerpts',excerpts:[{page:2,text:'The cafe stands on the corner.'}]}};

test('an output.commands place registration starts the binding and the turn does not wait for it',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async()=>{throw Error('no judgment is needed to register a place');}}});
 let release;const gate=new Promise(done=>{release=done;}),requested=[];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
  prepareWorkspace:async workspace=>{const c=new RpcClient(workspace);try{await c.ok('table.open',{campaign:'test-camp'});await c.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at the office.'});}finally{await c.close();}},
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,interactions:[],commands:[{kind:'place',action:'establish',additions:[{name:'Corner Cafe',description:'A cafe on the corner.'}]}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 // The product reader re-announces itself while the session starts; keep the controlled port in front of it.
 const bridge={ensure:async()=>({state:'ready'}),reading:()=>false,reference:async(moduleId,params)=>{requested.push(params);await gate;return excerpts;}};
 const keep=setInterval(()=>table.emit('coc:reading-bridge',bridge),5);t.after(()=>clearInterval(keep));
 await table.session.prompt('I look at the corner.');
 const cafe=()=>requested.filter(params=>params.focus==='Corner Cafe');
 await waitFor(()=>cafe().length===1,{label:'the registration asks the book'});
 assert.equal(table.telemetry().some(row=>row.lane==='place-binding'&&row.outcome==='bound'),false,'the turn committed while the binding was pending');
 assert.equal(cafe().length,1);
 release();
 const row=await waitFor(()=>table.telemetry().find(row=>row.lane==='place-binding'&&row.outcome==='bound'),{label:'bound'});
 assert.deepEqual(row.pages,[2]);
});
