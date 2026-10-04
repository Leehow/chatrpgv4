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
