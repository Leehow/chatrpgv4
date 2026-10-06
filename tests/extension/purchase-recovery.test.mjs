/** Contract seams and native host/kernel regressions; fixtures are never live-play acceptance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {PurchaseRecovery} from '../../extensions/kernel/purchase-recovery.ts';
import {boundCashAuthority,shapeVerdict} from '../../extensions/kernel/admission.ts';
import {KernelError,KernelClient} from '../../extensions/kernel/client.ts';
import {openTable,assistantTexts,waitFor} from './harness.mjs';
import {playtestScratch} from './playtest-scratch.mjs';

const suite=playtestScratch('purchase-recovery'),root=resolve(import.meta.dirname,'../..');
const bill={kind:'cash',bill:'Counter bill',category:'purchase',source:'quote',with:'Counter clerk',items:[{name:'Cola',quantity:2,unit_price:'0.50'}]};
const item={kind:'item',name:'Cola',quantity:2,to:'Alice',from:'Counter clerk'};
const approved={verdict:'authorized',grounds:'The player chose the item'};
const context={turn:1,playerText:'Buy the one-dollar bill.',investigators:[],present:[],delivered:[],landed:[],refused:[]};
const proposal={tool:'apply',key:'cash',lines:[],cash:{previews:[{index:0,category:'purchase',delta:-3,purchase_amount:1,currency:'USD'}]}};

test('an authorized semantic verdict cannot turn nominal-price acceptance into a larger cash ceiling',()=>{
  assert.equal(boundCashAuthority(proposal,context,approved).verdict,'not_authorized');
  const verdict={...approved,cash_limits:[{index:0,amount:3,basis:'price',evidence:'the one-dollar bill'}]};
  assert.equal(boundCashAuthority(proposal,context,verdict).verdict,'not_authorized');
  assert.match(boundCashAuthority(proposal,context,verdict).missing,/merchandise price 1/);
});
test('explicit actual-debit evidence is source-bound and enough for the same original bill',()=>{
  const verdict={...approved,cash_limits:[{index:0,amount:'3',basis:'input',evidence:'full three-dollar cash debit'}]};
  assert.equal(boundCashAuthority(proposal,context,verdict).verdict,'not_authorized');
  assert.equal(boundCashAuthority(proposal,{...context,playerText:'I accept the full three-dollar cash debit.'},verdict).verdict,'authorized');
  const delegated={...approved,cash_limits:[{index:0,amount:3,basis:'delegation',evidence:'spend up to three dollars'}]};
  assert.equal(boundCashAuthority(proposal,{...context,delivered:[{turn:0,keeper:'spend up to three dollars'}]},delegated).verdict,'not_authorized');
  assert.equal(boundCashAuthority(proposal,{...context,delivered:[{turn:0,keeper:'Okay.',player:'You may spend up to three dollars.'}]},delegated).verdict,'authorized');
});
test('a contextual living correction preserves choice, and malformed monetary limits are no verdict',()=>{
  const verdict={...approved,cash_limits:[{index:0,amount:0,basis:'none',evidence:'',category:'living'}]};
  assert.equal(boundCashAuthority(proposal,context,verdict).recovery,'correct_proposal');
  assert.equal(shapeVerdict({...approved,cash_limits:[{index:0,amount:'NaN',basis:'input',evidence:'NaN'}]}),undefined);
});
test('offer acceptance is limited to previously displayed cash terms for the same purchase',()=>{
  const row={index:0,subject:'alice',with:'clerk',category:'purchase',delta:-3,purchase_amount:1,currency:'USD',items:bill.items};
  const q={quote:'Counter bill',subject:'alice',with_id:'clerk',origin_turn:0,currency:'USD',items:bill.items,cash_debit:3};
  const p={...proposal,cash:{previews:[row],quotes:[q]}},v={...approved,cash_limits:[{index:0,amount:3,basis:'offer',evidence:'Counter bill'}]};
  assert.equal(boundCashAuthority(p,context,v).verdict,'authorized');
  assert.equal(boundCashAuthority({...p,cash:{...p.cash,quotes:[{...q,origin_turn:1}]}},context,v).verdict,'not_authorized');
  assert.equal(boundCashAuthority({...p,cash:{...p.cash,quotes:[{...q,cash_debit:1}]}},context,v).verdict,'not_authorized');
  const accepted={...context,playerText:'Okay, settle the quotation card you just showed.'};
  const words={...approved,cash_limits:[{index:0,amount:3,basis:'offer',evidence:'settle the quotation card you just showed'}]};
  const referenced={...p,cash:{...p.cash,previews:[{...row,quote:'Counter bill'}]}};
  assert.equal(boundCashAuthority(referenced,accepted,words).verdict,'authorized');
  assert.equal(boundCashAuthority(referenced,context,words).verdict,'not_authorized');
  assert.equal(boundCashAuthority({...referenced,cash:{...referenced.cash,previews:[{...row,quote:'Another bill'}]}},accepted,words).verdict,'not_authorized');
  assert.equal(boundCashAuthority({...referenced,cash:{...referenced.cash,quotes:[q,q]}},accepted,words).verdict,'not_authorized');
});

async function policy(){
  const home=await mkdtemp(join(suite,'home-')),base=join(home,'.coc/campaigns/c');await mkdir(base,{recursive:true});
  await writeFile(join(base,'campaign.json'),JSON.stringify({active_worldline:'main'}));
  await writeFile(join(base,'world.json'),JSON.stringify({cash_quotes:[{name:'Saved bill',subject:'alice',category:'purchase',source:'quote',with:'Counter clerk',items:bill.items,currency:'USD',settled:null}]}));
  return {home,base,recovery:()=>new PurchaseRecovery(home,'c',[{id:'alice',name:'Alice'}])};
}
const insufficient=new KernelError({code:'invalid_params',message:'Cannot debit three from a two-dollar purse',details:{cash_debit:3}});
test('an unpaid transaction survives restart, freezes its rates and blocks payment-removal delivery',async()=>{
  const p=await policy();await p.recovery().failure({effects:[bill,item]},insufficient,1);
  await assert.rejects(p.recovery().check({effects:[{...bill,items:[{name:'Cola',quantity:2,unit_price:'1.5'}]},item]},2),e=>e.details.reason==='purchase_terms_changed');
  await assert.rejects(p.recovery().check({effects:[item]},2),e=>e.details.reason==='purchase_payment_required');
  await p.recovery().check({effects:[{...item,name:'Map'}]},2);
  await p.recovery().check({effects:[{...item,from:'Another clerk'}]},2);
  await writeFile(join(p.base,'campaign.json'),JSON.stringify({active_worldline:'other'}));await p.recovery().check({effects:[item]},2);
  await writeFile(join(p.base,'campaign.json'),JSON.stringify({active_worldline:'main',worldlines:{main:{loop:1}}}));await p.recovery().check({effects:[item]},2);
  await writeFile(join(p.base,'campaign.json'),JSON.stringify({active_worldline:'main'}));
  await p.recovery().settled({effects:[bill,item]},{receipts:['cash:t2-c1'],_cash_settlements:[{...bill,subject:'alice',settlement:'cash'}]});
  await p.recovery().check({effects:[item]},3);
});
test('saved-offer retries have the same hold, and a real cancellation releases it without payment',async()=>{
  const p=await policy(),cash={kind:'cash',quote:'Saved bill'};
  await p.recovery().failure({effects:[cash,item]},insufficient,1);
  await assert.rejects(p.recovery().check({effects:[item]},2),e=>e.details.reason==='purchase_payment_required');
  const cancel={kind:'cash',mode:'cancel',quote:'Saved bill'};
  await assert.rejects(p.recovery().check({effects:[cancel,item]},2));
  await p.recovery().settled({effects:[cancel]},{receipts:['cash:t2-c1'],_cash_settlements:[{subject:'alice',quote:'Saved bill',settlement:'cancelled'}]});
  await p.recovery().check({effects:[item]},3);
});
test('corrupt retained policy state never silently removes a payment hold',async()=>{
  const p=await policy();await writeFile(join(p.base,'purchase-recovery.json'),'not JSON');
  await assert.rejects(p.recovery().check({effects:[item]},2),e=>e instanceof KernelError);
});
test('a new negotiated agreement may change prices after cancelling the unpaid original, never during a retry',async()=>{
  const p=await policy(),recovery=p.recovery();
  await recovery.failure({effects:[bill,item]},insufficient,1);
  const revised={...bill,bill:'Negotiated counter bill',items:[{name:'Cola',quantity:2,unit_price:'0.40'}]};
  await assert.rejects(recovery.check({effects:[revised,item]},2),e=>e.details.reason==='purchase_terms_changed');
  assert.equal((await recovery.offers([],1))[0].items[0].unit_price,'0.50','failure preserves the original rate');
  const cancel={kind:'cash',mode:'cancel',bill:bill.bill};
  await recovery.check({effects:[cancel]},2);
  await recovery.settled({effects:[cancel]},{receipts:['cash:t2-c1'],_cash_settlements:[{subject:'alice',bill:bill.bill,settlement:'cancelled'}]});
  await recovery.check({effects:[revised,item]},2);
  assert.deepEqual(await recovery.offers([],2),[]);
});
test('canonical counterparty aliases cannot change rates or disguise the unpaid item delivery',async()=>{
  const p=await policy(),recovery=p.recovery();
  await recovery.observe({effects:[bill]},[{index:0,with:'clerk-id',with_label:'Mr Clerk'}]);
  await recovery.failure({effects:[bill,item]},insufficient,1);
  const restarted=p.recovery();
  await assert.rejects(restarted.check({effects:[{...item,from:'clerk-id'}]},2));
  await assert.rejects(restarted.check({effects:[{...bill,with:'clerk-id',items:[{name:'Cola',quantity:2,unit_price:'1.5'}]}]},2));
});

async function ready(workspace){
  const kernel=new KernelClient({command:[process.execPath,join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],cwd:root});
  try{await kernel.call('table.open',{campaign:'test-camp'});await kernel.call('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The clerk waits.'});
    const p=join(workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),card=JSON.parse(await readFile(p,'utf8'));
    card.finance={cash:{amount:9,currency:'USD'},spending_level:{amount:2,currency:'USD'},living_standard:'Average',daily_spending:{day:0,total:2,debited:0}};await writeFile(p,JSON.stringify(card));
  }finally{await kernel.close();}
}
const response=(name,args)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});
test('native review caps a false approval, preserves rates on retry, then accepted catch-up settles once',async t=>{
  const goods={...item,to:'thomas-hayes'},priceVerdict={...approved,cash_limits:[{index:0,amount:3,basis:'price',evidence:'one-dollar bill'}]},cashVerdict={...approved,cash_limits:[{index:0,amount:3,basis:'input',evidence:'full three-dollar cash debit'}]};
  const table=await openTable({realKernel:true,prepareWorkspace:ready,responses:[
    response('apply',{effects:[bill,goods]}),response('narrate',{text:'The original one-dollar goods wait. Their cash requirement is separate.'}),
    response('apply',{effects:[{...bill,items:[{name:'Cola',quantity:2,unit_price:'1.5'}]},goods]}),
    response('apply',{effects:[bill,goods],narrate:'The original goods are paid and handed over.'}),
  ],laneResponses:{admission:Array.from({length:12},()=>input=>{
    const body=input.messages.filter(m=>m.role==='user').flatMap(m=>m.content.map(c=>c.text??'')).join('\n');
    return fauxAssistantMessage(JSON.stringify(body.includes('[Cash authority table:')?(body.includes('I accept the full three-dollar cash debit')?cashVerdict:priceVerdict):approved));
  })}});
  t.after(()=>table.dispose());
  await table.session.prompt('Buy the one-dollar bill.');await waitFor(()=>assistantTexts(table.session).some(x=>x.includes('cash requirement is separate')));
  const first=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));assert.equal(first.receipts.length,0);
  assert.equal(first.mechanics.find(r=>r.quote_status==='pending').cash_debit,3);
  await table.session.prompt('I accept the full three-dollar cash debit, keeping the original goods price.');
  assert.ok(assistantTexts(table.session).some(x=>x.includes('paid and handed over')),JSON.stringify(table.session.messages.filter(m=>m.role==='toolResult'&&m.isError).map(m=>m.content)));
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8')),cash=record.receipts.find(r=>r.kind==='cash');
  assert.equal(cash.purchase_amount,1);assert.equal(cash.delta,-3);assert.equal(cash.after,6);assert.equal(cash.items[0].unit_price,'0.50');
  assert.ok(record.receipts.some(r=>r.kind==='item'));assert.ok(!record.quote_drafts?.length);
  assert.equal(JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/purchase-recovery.json'),'utf8')).lines.main.length,0);
});
test('native affordability refusal cannot be bypassed by issuing purchased inventory alone',async t=>{
  const table=await openTable({realKernel:true,prepareWorkspace:async workspace=>{await ready(workspace);const p=join(workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),card=JSON.parse(await readFile(p,'utf8'));card.finance.cash.amount=2;await writeFile(p,JSON.stringify(card));},responses:[
    response('apply',{effects:[bill,{...item,to:'thomas-hayes'}]}),response('apply',{effects:[{...item,to:'thomas-hayes'}]}),response('narrate',{text:'The purchase remains unpaid and the goods stay at the counter.'}),
  ]});t.after(()=>table.dispose());await table.session.prompt('Buy the one-dollar bill.');await waitFor(()=>assistantTexts(table.session).some(x=>x.includes('remains unpaid')));
  const record=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));assert.equal(record.receipts.length,0);
  const card=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),'utf8'));assert.equal(card.finance.cash.amount,2);assert.equal(card.finance.daily_spending.total,2);
  assert.equal(table.kernelRequests().filter(r=>r.method==='table.apply').length,0);
});
