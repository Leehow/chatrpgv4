/** Real host + kernel: complete chosen covered service, or retain the cash commitment boundary. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,assistantTexts,waitFor,admissionProposes} from './harness.mjs';
import {KernelClient} from '../../extensions/kernel/client.ts';

const root=resolve(import.meta.dirname,'../..');
const expense=category=>({kind:'cash',category,source:'quote',with:'Attendant',why:'Complete the chosen fill-up',items:[{name:'Gasoline',quantity:3,unit_price:0.57}]});
async function ready(workspace,prior=0){
  const kernel=new KernelClient({command:[process.execPath,join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],cwd:root});
  try{
    await kernel.call('table.open',{campaign:'test-camp'});
    await kernel.call('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The attendant waits at the pump.'});
    const path=join(workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),sheet=JSON.parse(await readFile(path,'utf8'));
    sheet.finance={cash:{amount:9,currency:'USD'},spending_level:{amount:2,currency:'USD'},living_standard:'Poor',
      ...(prior?{daily_spending:{day:0,total:prior,debited:0}}:{})};
    await writeFile(path,JSON.stringify(sheet));
  }finally{await kernel.close();}
}
for(const category of ['purchase','living'])test(`${category}: filling the chosen full quantity needs no price-confirmation turn when cash delta is zero`,async t=>{
  const text='The attendant fills the tank and points you toward the diner.';
  const table=await openTable({realKernel:true,prepareWorkspace:ready,responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[expense(category),{kind:'flag',name:'tank-filled',value:true}],narrate:text})],{stopReason:'toolUse'}),
  ],laneResponses:{admission:[async context=>{
    const material=admissionProposes(context.messages.filter(message=>message.role==='user').flatMap(message=>message.content.map(block=>block.text??'')).join(''));
    assert.match(material,/registered_cash_context=/);
    assert.match(material,/consent_policy/);
    assert.match(material,/"delta":0/);
    assert.match(material,/"purchase_amount":1.71/);
    return fauxAssistantMessage(JSON.stringify({verdict:'entailed',grounds:'The player chose the full service; computed coverage needs no new cash acceptance'}));
  }]}});
  t.after(()=>table.dispose());
  await table.session.prompt('Fill it up; the tank needs three gallons. Where can I get a hot meal?');
  await waitFor(()=>assistantTexts(table.session).includes(text),{label:'completed covered service in this turn'});
  const base=join(table.workspace,'.coc/campaigns/test-camp'),record=JSON.parse(await readFile(join(base,'turns/0001.json'),'utf8'));
  const cash=record.receipts.find(receipt=>receipt.kind==='cash');
  assert.equal(cash.purchase_amount,1.71);assert.equal(cash.delta,0);assert.equal(cash.items[0].quantity,3);
  assert.equal(cash.settlement,category==='living'?'living_standard':'spending_level');
  assert.ok(record.receipts.some(receipt=>receipt.kind==='flag'&&receipt.name==='tank-filled'));
  assert.equal(table.kernelRequests().filter(request=>request.method==='table.ask').length,0);
  assert.ok(!record.receipts.some(receipt=>receipt.settlement==='quote'));
});

test('a nominally small fill-up that exceeds the daily aggregate still needs acceptance of its actual debit',async t=>{
  const table=await openTable({realKernel:true,prepareWorkspace:workspace=>ready(workspace,1),responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[expense('purchase'),{kind:'flag',name:'tank-filled',value:true}]})],{stopReason:'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate',{text:'The attendant quotes the full bill and waits for your answer.'})],{stopReason:'toolUse'}),
  ],laneResponses:{admission:[async context=>{
    const material=context.messages.filter(message=>message.role==='user').flatMap(message=>message.content.map(block=>block.text??'')).join('');
    assert.match(material,/"delta":-2.71/);
    return fauxAssistantMessage(JSON.stringify({verdict:'not_authorized',grounds:'The daily full cash debit exceeds coverage and was not accepted',missing:'accept the full cash debit'}));
  }]}});
  t.after(()=>table.dispose());
  await table.session.prompt('Fill it up; the tank needs three gallons.');
  await waitFor(()=>assistantTexts(table.session).some(text=>text.includes('waits for your answer')),{label:'actual commitment returned to player'});
  const sheet=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),'utf8'));
  assert.equal(sheet.finance.cash.amount,9);assert.equal(sheet.finance.daily_spending.total,1);
  assert.equal(table.kernelRequests().filter(request=>request.method==='table.apply').length,0);
});

test('a mistaken synchronous quote for a chosen covered service is corrected, then speech and receipt share the bill',async t=>{
  const bill={...expense('purchase'),bill:'Fill-up'};
  const text='The attendant fills the tank. "Per gallon {{price:Fill-up:unit}}, total {{price:Fill-up:total}}."';
  const review=fauxAssistantMessage(JSON.stringify({verdict:'entailed',grounds:'The player already chose this complete covered fill-up'}));
  const table=await openTable({realKernel:true,prepareWorkspace:ready,responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[{...bill,mode:'quote',quote:'Fill-up'}]})],{stopReason:'toolUse'}),
    fauxAssistantMessage([fauxToolCall('apply',{effects:[bill,{kind:'flag',name:'tank-filled',value:true}],narrate:text})],{stopReason:'toolUse'}),
  ],laneResponses:{admission:[review,review]}});
  t.after(()=>table.dispose());
  await table.session.prompt('Fill the tank; it needs three gallons.');
  await waitFor(()=>assistantTexts(table.session).some(s=>s.includes('total 1.71')),{label:'bound completed fill-up'});
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.receipts.filter(r=>r.kind==='cash').length,1);
  assert.equal(record.receipts.find(r=>r.kind==='cash').delta,0);
  assert.match(record.rendered_text,/Per gallon 0.57, total 1.71/);
  assert.ok(record.price_bindings.some(b=>b.field==='total'&&b.value==='1.71'));
  assert.equal(table.kernelRequests().filter(r=>r.method==='table.apply'&&r.params.effects.some(e=>e.mode==='quote')).length,0);
});

test('repeated zero merchandise input stays out of the kernel and corrected nominal prices still debit zero',async t=>{
  const good={...expense('living'),bill:'Fill-up'},bad={...good,items:[{name:'Gasoline',quantity:3,unit_price:0}]};
  const text='The attendant fills the tank. "Per gallon {{price:Fill-up:unit}}, total {{price:Fill-up:total}}."';
  const table=await openTable({realKernel:true,prepareWorkspace:ready,responses:[bad,bad,bad,bad,good].map(e=>fauxAssistantMessage([
    fauxToolCall('apply',{effects:[e],...(e===good?{narrate:text}:{})})],{stopReason:'toolUse'})),
    laneResponses:{admission:[fauxAssistantMessage(JSON.stringify({verdict:'entailed',grounds:'The full service was chosen; its actual cash debit is zero'}))]}});
  t.after(()=>table.dispose());await table.session.prompt('Fill the tank; it needs three gallons.');
  await waitFor(()=>assistantTexts(table.session).some(s=>s.includes('total 1.71')),{label:'corrected nominal bill'});
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  const expenses=record.receipts.filter(r=>r.kind==='cash');assert.equal(expenses.length,1);
  assert.equal(expenses[0].items[0].unit_price,'0.57');assert.equal(expenses[0].delta,0);
  const rejected=table.telemetry().filter(r=>r.lane==='price-input');
  assert.deepEqual(rejected.map(r=>[r.repeated,r.kernel_called]),[[false,false],[true,false],[true,false],[true,false]]);
  assert.equal(table.telemetry().filter(r=>r.lane==='refusals'&&r.reason==='repeated_price_input'&&r.counted===false).length,3);
});

test('a price-only question remains an offer and cannot complete or charge a covered service',async t=>{
  const bill={...expense('purchase'),mode:'quote',quote:'Fill-up'};
  const text='The attendant offers gas at {{price:Fill-up:unit}} per gallon. The pump stays off.';
  const table=await openTable({realKernel:true,prepareWorkspace:ready,responses:[fauxAssistantMessage([
    fauxToolCall('apply',{effects:[bill],narrate:text})],{stopReason:'toolUse'})],
    laneResponses:{admission:[fauxAssistantMessage(JSON.stringify({verdict:'not_authorized',grounds:'The player asked only the price and chose no purchase',missing:'choose the service'}))]}});
  t.after(()=>table.dispose());await table.session.prompt('What would three gallons cost?');
  await waitFor(()=>assistantTexts(table.session).some(s=>s.includes('0.57 per gallon')),{label:'bound price-only offer'});
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  const cash=record.receipts.find(r=>r.kind==='cash');assert.equal(cash.settlement,'quote');assert.equal(cash.before,cash.after);
  assert.ok(!record.receipts.some(r=>r.kind==='flag'&&r.name==='tank-filled'));
});

test('decimal-string unit prices survive native tools, exact kernel settlement and bound NPC prose',async t=>{
  const bill={...expense('purchase'),bill:'Fill-up',items:[{name:'Gasoline',quantity:3,unit_price:'0.57'}]};
  const text='The attendant fills the tank. "Per gallon {{price:Fill-up:unit}}, total {{price:Fill-up:total}}."';
  const table=await openTable({realKernel:true,prepareWorkspace:ready,responses:[fauxAssistantMessage([
    fauxToolCall('apply',{effects:[bill],narrate:text})],{stopReason:'toolUse'})],
    laneResponses:{admission:[fauxAssistantMessage(JSON.stringify({verdict:'entailed',grounds:'The complete covered service was chosen'}))]}});
  t.after(()=>table.dispose());await table.session.prompt('Fill the tank; it needs three gallons.');
  await waitFor(()=>assistantTexts(table.session).some(s=>s.includes('total 1.71')),{label:'decimal-string bill'});
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  const cash=record.receipts.find(r=>r.kind==='cash');assert.equal(cash.items[0].unit_price,'0.57');assert.equal(cash.purchase_amount,1.71);assert.equal(cash.delta,0);
  assert.match(record.rendered_text,/Per gallon 0.57, total 1.71/);
});
