import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient,rpcCommand} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';

async function retryTable(t,responses){
  const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_ISOLATED_OUTPUT:'0',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
    PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand())};
  const engine=createHybridEngine({env,decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
    settings:{retry:{enabled:true,maxRetries:2,baseDelayMs:1}},
    async prepareWorkspace(workspace){
      process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',join(import.meta.dirname,'../../content')]);
      const client=new RpcClient(workspace);
      try{
        await client.ok('table.open',{campaign:'test-camp'});
        await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You wait in the office.'});
      }finally{await client.close();}
    },extraExtensions:[{name:'engine',factory:engine.extension}],responses});
  t.after(()=>table.dispose());
  return table;
}

test('provider retry cannot reauthor or settle new actions after public stream interruption',async t=>{
  let calls=0;
  const table=await retryTable(t,[
      ()=>{calls++;return fauxAssistantMessage('{{public}}An exposed beginning.',{stopReason:'error',errorMessage:'Internal error during token generation'});},
      ()=>{calls++;return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:99}]})],{stopReason:'toolUse'});},
      ()=>{calls++;return fauxAssistantMessage('{{public}}A replacement ending.');},
    ]);
  await table.session.prompt('I wait at the desk.');
  assert.equal(calls,1,'the provider retry setting must not authorize another author after exposure');
  assert.equal(table.telemetry().filter(row=>row.tool==='apply').length,0,'an interrupted public response cannot gain new actions');
  const frames=table.entries('coc-final-delivery');
  assert.equal(frames.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),'An exposed beginning.');
  assert.equal(frames.at(-1).status,'interrupted');
  const owner=createFinalOutputOwner({runtime:()=>({home:table.workspace}),call:async()=>({}),record:async()=>{}});
  const recovery=await owner.recoveries('test-camp');
  assert.equal(recovery.at(-1).text,'An exposed beginning.');
  assert.equal(recovery.at(-1).status,'interrupted');
  assert.deepEqual(table.extensionErrors,[]);
});

test('a provider failure before public exposure retains ordinary retry and final publication',async t=>{
  let calls=0;
  const table=await retryTable(t,[
    ()=>{calls++;return fauxAssistantMessage('',{stopReason:'error',errorMessage:'Internal error during token generation'});},
    ()=>{calls++;return fauxAssistantMessage('{{public}}The office is quiet.');},
  ]);
  await table.session.prompt('I wait at the desk.');
  assert.equal(calls,2);
  const frames=table.entries('coc-final-delivery');
  assert.equal(frames.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),'The office is quiet.');
  assert.equal(frames.at(-1).status,'completed');
  assert.deepEqual(table.extensionErrors,[]);
});
