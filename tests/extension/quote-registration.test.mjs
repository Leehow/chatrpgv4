/** Product tools + emitted TS kernel, plus a controlled slow queue regression. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {join,resolve} from 'node:path';
import {KernelClient} from '../../extensions/kernel/client.ts';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,assistantTexts,waitFor} from './harness.mjs';
import {createQuotationQueue} from '../../extensions/kernel/quotes.ts';

const quote={quote:'Water and cigarettes',category:'purchase',with:'Counter clerk',why:'Water and cigarettes',items:[
  {name:'Water',quantity:2,unit_price:0.5},{name:'Cigarettes',quantity:1,unit_price:1.75},
]};
for(const mode of ['explicit','embedded'])test(`${mode} prose and priced drafts deliver in one Keeper call, then the original card receives its quote`,async t=>{
  let keeperCalls=0;
  const text='The clerk puts the goods on the counter. "Here is the bill."';
  const response=fauxAssistantMessage([fauxToolCall(mode==='explicit'?'narrate':'apply',mode==='explicit'?{text,quotes:[quote]}:{effects:[{kind:'time',minutes:1}],narrate:text,quotes:[quote]})],{stopReason:'toolUse'});
  const table=await openTable({realKernel:true,keeperProviderCallbacks:true,prepareWorkspace:async workspace=>{
    const root=resolve(import.meta.dirname,'../..'),kernel=new KernelClient({command:[process.execPath,join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],cwd:root});
    try{await kernel.call('table.open',{campaign:'test-camp'});await kernel.call('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The investigation begins.'});}finally{await kernel.close();}
  },responses:[()=>{keeperCalls++;return response;}]});
  t.after(()=>table.dispose());
  const prompt=table.session.prompt('What is the price for two waters and cigarettes?');
  await prompt;
  await waitFor(()=>assistantTexts(table.session).includes(text),{label:'prose delivered with the quotation draft'});
  const cards=()=>table.session.sessionManager.getEntries().filter(entry=>entry.type==='custom'&&entry.customType==='coc-mechanics');
  const patches=()=>table.session.sessionManager.getEntries().filter(entry=>entry.type==='custom'&&entry.customType==='coc-card-patch'&&entry.data.source==='quote-registration');
  assert.equal(keeperCalls,1);
  assert.equal(cards().at(-1).data.mechanics.find(row=>row.quote_status==='pending').purchase_amount,undefined);
  await waitFor(()=>patches().length>0,{label:'late quotation patch on the delivered card'});
  assert.equal(patches().at(-1).data.card.turn,cards().at(-1).data.turn);
  const ready=Object.values(patches().at(-1).data.patch.quotes)[0];
  assert.equal(ready.purchase_amount,2.75);
  assert.equal(ready.quote_status,'ready');
  assert.equal(ready.before,ready.after);
  assert.equal(table.kernelRequests().filter(request=>request.method==='table.apply'&&request.params.effects.some(effect=>effect.kind==='cash')).length,0);
});

test('shutdown drops a late card update; another session can recover the persisted quotation',async()=>{
  let release;const held=new Promise(resolve=>release=resolve),patches=[];
  const queue=createQuotationQueue({active:()=>true,record(){},patch:(turn,quotes)=>patches.push({turn,quotes}),
    call:async(method,params)=>params.turn===undefined?{turns:[1]}:held});
  const finish=queue.finish();await new Promise(resolve=>setImmediate(resolve));
  queue.close();release({quotes:{q:{quote_status:'ready',purchase_amount:2.75}}});await finish;
  assert.equal(patches.length,0);
  const recovered=createQuotationQueue({active:()=>true,record(){},patch:(turn,quotes)=>patches.push({turn,quotes}),
    call:async(method,params)=>params.turn===undefined?{turns:[1]}:{quotes:{q:{quote_status:'ready',purchase_amount:2.75}}}});
  await recovered.finish();assert.equal(patches[0].quotes.q.purchase_amount,2.75);recovered.close();
});

test('a slow quotation RPC never blocks scheduling or exposes a guessed total',async()=>{
  let release,started;const held=new Promise(resolve=>release=resolve),began=new Promise(resolve=>started=resolve),patches=[];
  const queue=createQuotationQueue({active:()=>true,record(){},patch:(turn,quotes)=>patches.push({turn,quotes}),
    call:async()=>{started();return held;}});
  assert.equal(queue.schedule(1),undefined,'delivery receives no promise to await');
  await began;assert.equal(patches.length,0,'the background operation is still held');
  release({quotes:{q:{quote_status:'ready',purchase_amount:2.75}}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(patches[0].quotes.q.purchase_amount,2.75);queue.close();
});

test('the same turn number on a different worldline receives its own quotation',async()=>{
  let key='quote:main:0:t1:q0';const patches=[];
  const queue=createQuotationQueue({active:()=>true,record(){},patch:(turn,quotes)=>patches.push({turn,quotes}),
    call:async(method,params)=>params.turn===undefined?{turns:[1],keys:{1:key}}:{quotes:{[key]:{quote_status:'ready',purchase_amount:2.75}}}});
  await queue.finish();await queue.finish();assert.equal(patches.length,1,'same scoped job is already patched');
  key='quote:loop-one:1:t1:q0';await queue.finish();assert.equal(patches.length,2);queue.close();
});
