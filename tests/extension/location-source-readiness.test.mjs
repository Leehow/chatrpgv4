/** Controlled real Pi/RPC source-read boundary, not live-play acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {sourceLocationContext} from '../../extensions/kernel/source-location-context.ts';
import {KernelError} from '../../extensions/kernel/client.ts';

async function opened(workspace){
 const k=new RpcClient(workspace);
 try{await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The office is open.'});}
 finally{await k.close();}
}
for(const status of ['pending','memo'])test(`a ${status} book consultation retains the independently registered location identity`,async t=>{
 let table,finish,reads=0;
 table=await openTable({realKernel:true,prepareWorkspace:opened,env:{PI_COC_SOURCE_ANSWER_ALLOWANCE_MS:status==='pending'?'20':'5000'},responses:[async()=>{
  table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.99,feature:.01,observation:.99}});
  return fauxAssistantMessage([fauxToolCall('lookup',{kind:'source',source_mode:'answer',query:'commission-briefing',question:'What does the street frontage look like?'})],{stopReason:'toolUse'});
 },fauxAssistantMessage('Stopped controlled fixture.')]});
 t.after(()=>{finish?.({state:'ready',source_answer:{status:'unresolved',answer:'No further visible description is established.',source_refs:[],limitations:'Controlled source fixture.',prepared:false,supported:false}});return table.dispose();});
 table.emit('coc:reading-bridge',status==='pending'?{reference:async()=>{reads++;return new Promise(resolve=>{finish=resolve;});},ensure:async()=>{throw Error('No duplicate fallback');}}:
  {ensure:async()=>{reads++;return {state:'ready',memo:[{focus:'commission-briefing',question:'An earlier different question.',source_answer:{status:'unresolved',answer:'That earlier detail is not established.',source_refs:[],limitations:'Controlled memo fixture.',prepared:false,supported:false}}]};}});
 await table.session.prompt('I approach the office and look at its street frontage.');
 const result=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='lookup');
 assert(result&&!result.isError,JSON.stringify(result));
 assert.equal(result.details.source_answer.status,status);
 assert.equal(result.details.registered_location?.name,'commission-briefing');
 assert.equal(JSON.parse(result.content.find(block=>block.type==='text').text).registered_location.name,'commission-briefing','the Keeper sees the reference, not only diagnostic details');
 assert.equal(result.details.registered_location.authority,'identity-reference-only');
 assert.equal(result.details.material_ready,undefined,'registration never claims that source truth or mechanics are prepared');
 assert.equal(result.details.registered_location.permission,undefined);
 assert.equal(reads,1,'identity context does not create another reader');
 const settled=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp',projection:'receipts'});
 assert.equal(settled.receipts.length,0,'the actual kernel has no player-world settlement from the reference read');
});

test('missing or ambiguous references grant no identity, and optional read failures stay diagnostic',async()=>{
 for(const reason of ['destination_missing','ambiguous']){
  const diagnostics=[];
  const value=await sourceLocationContext(async()=>{throw new KernelError({code:'unknown_entity',message:'No unique registered place',details:{reason}});},'Not unique',error=>diagnostics.push(error));
  assert.deepEqual(value,{});assert.equal(diagnostics.length,0);
 }
 const diagnostics=[],failure=new KernelError({code:'internal',message:'Controlled optional read failure'});
 assert.deepEqual(await sourceLocationContext(async()=>{throw failure;},'Office',error=>diagnostics.push(error)),{});
 assert.deepEqual(diagnostics,[failure]);
 assert.deepEqual(await sourceLocationContext(async()=>({place:{display_name:'Incomplete'}}),'Office',()=>assert.fail('No failure expected')),{});
});
