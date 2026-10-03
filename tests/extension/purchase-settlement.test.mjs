import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
const evidence=join(ROOT,'.coc/playtests/purchase-settlement-contracts');
await mkdir(evidence,{recursive:true});
const suite=await mkdtemp(join(evidence,'suite-'));
await writeFile(join(suite,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
const rpc=join(suite,'rpc.mjs');
await build({entryPoints:[join(ROOT,'kernel-ts/rpc.ts')],outfile:rpc,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
await symlink(join(ROOT,'node_modules'),join(suite,'node_modules'),'dir');
async function table(t){
  const home=await mkdtemp(join(suite,'home-'));
  const connect=()=>new KernelClient({command:[process.execPath,rpc,'--workspace',home,'--content',CONTENT],cwd:ROOT,timeoutMs:20_000});
  let client=connect();t.after(()=>client.close());
  await client.call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  await client.call('table.open',{campaign:'c1'});
  await client.call('table.narrate',{campaign:'c1',call_id:'t0-c1',text:'The investigation begins.'});
  await client.call('table.player_input',{campaign:'c1',text:'I pay for the things I chose.'});
  await client.call('table.apply',{campaign:'c1',call_id:'t1-c0',effects:[{kind:'cash',delta:1,source:'found'},{kind:'cash',delta:-1,source:'found'}]});
  const sheetPath=join(home,'.coc/campaigns/c1/party/thomas-hayes.json');
  return {
    call:(method,params={})=>client.call(`table.${method}`,{campaign:'c1',...params}),
    sheet:async()=>JSON.parse(await readFile(sheetPath,'utf8')),
    world:async()=>JSON.parse(await readFile(join(home,'.coc/campaigns/c1/world.json'),'utf8')),
    record:async turn=>JSON.parse(await readFile(join(home,`.coc/campaigns/c1/turns/${String(turn).padStart(4,'0')}.json`),'utf8')),
    metaPath:join(home,'.coc/campaigns/c1/campaign.json'),
    receipts:async()=>(await client.call('table.status',{campaign:'c1'})).receipts.filter(r=>r.kind==='cash'&&r.call_id!=='t1-c0'),
    restart:async()=>{await client.close();client=connect();},
  };
}
const spend=(amount,category='purchase',extra={})=>({kind:'cash',delta:-amount,source:'quote',with:'Steven Knott',category,why:'Chosen expense',...extra});

test('an unclassified purchase never silently debits cash',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  const {category,...effect}=spend(3);
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[effect]}),e=>e.code==='needs'&&e.details.field==='category');
  assert.equal((await game.sheet()).finance.cash.amount,before);
});

test('ordinary living expenses and small purchases share one settlement path',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  await game.call('apply',{call_id:'t1-c1',effects:[spend(9.25,'living'),spend(3),spend(2),spend(2.75)]});
  const receipts=await game.receipts();
  assert.equal((await game.sheet()).finance.cash.amount,before);
  assert.deepEqual(receipts.map(r=>r.settlement),['living_standard','spending_level','spending_level','spending_level']);
  assert.deepEqual(receipts.map(r=>r.delta),[0,0,0,0]);
  assert.equal((await game.sheet()).finance.daily_spending.total,7.75);
  const delivered=await game.call('narrate',{call_id:'t1-c2',text:'The chosen expenses are settled.'});
  assert.equal(delivered.mechanics.filter(r=>r.kind==='cash').at(-1).purchase_amount,2.75);
  assert.equal(delivered.mechanics.filter(r=>r.kind==='cash').at(-1).purpose,'Chosen expense');
});

test('daily cumulative spending charges the full sum once, survives restart and resets at midnight',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  await game.call('apply',{call_id:'t1-c1',effects:[spend(6),spend(4)]});
  assert.equal((await game.sheet()).finance.cash.amount,before);
  await game.restart();
  const unchanged=await game.sheet();
  const preview=await game.call('apply.options',{cash_effects:[spend(1)]});
  assert.equal(preview.cash_previews[0].purchase_amount,1);
  assert.equal(preview.cash_previews[0].delta,-11);
  assert.deepEqual(await game.sheet(),unchanged,'a quote preview neither counts nor charges a purchase');
  await assert.rejects(game.call('apply',{call_id:'t1-c2',effects:[spend(1,'purchase',{_cash_debit_limit:1})]}),e=>e.code==='needs');
  assert.deepEqual(await game.sheet(),unchanged,'a one-dollar admitted limit cannot debit eleven');
  const params={call_id:'t1-c2',effects:[spend(1)]};
  await game.call('apply',params);
  assert.equal((await game.sheet()).finance.cash.amount,before-11);
  assert.equal((await game.receipts()).at(-1).delta,-11);
  assert.equal((await game.call('apply',params)).replayed,true);
  assert.equal((await game.sheet()).finance.cash.amount,before-11);
  await game.call('apply',{call_id:'t1-c3',effects:[spend(2)]});
  assert.equal((await game.sheet()).finance.cash.amount,before-13);
  await game.call('apply',{call_id:'t1-c4',effects:[{kind:'time',minutes:24*60},spend(3)]});
  assert.equal((await game.sheet()).finance.cash.amount,before-13);
  assert.equal((await game.sheet()).finance.daily_spending.total,3);
  const capsule=await game.call('capsule');
  assert.equal(capsule.known.investigator.living.daily_spending.total,3);
});

test('a quote computes two waters plus cigarettes exactly and is settled from the same saved terms',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  const quoted=await game.call('apply',{call_id:'t1-c1',effects:[{kind:'cash',mode:'quote',quote:'Water and cigarettes',category:'purchase',source:'quote',with:'Steven Knott',currency:'USD',why:'Water and cigarettes',items:[
    {name:'Water',quantity:2,unit_price:0.5},{name:'Cigarettes',quantity:1,unit_price:1.75},
  ]}]});
  assert.equal(quoted.cash_quotes[0].purchase_amount,2.75);
  assert.equal((await game.receipts())[0].delta,0);
  assert.equal((await game.sheet()).finance.cash.amount,before);
  await game.call('narrate',{call_id:'t1-c2',text:'Knott presents the itemized quote.'});
  await game.call('player_input',{text:'I accept the quoted purchase.'});
  const effect={kind:'cash',quote:'Water and cigarettes'};
  await assert.rejects(game.call('apply',{call_id:'t2-c1',effects:[{...effect,delta:-3.75}]}),e=>e.code==='invalid_params');
  await game.call('apply',{call_id:'t2-c1',effects:[effect]});
  assert.equal((await game.receipts()).at(-1).purchase_amount,2.75);
  assert.equal((await game.sheet()).finance.daily_spending.total,2.75);
  assert.equal((await game.sheet()).finance.cash.amount,before);
  await assert.rejects(game.call('apply',{call_id:'t2-c2',effects:[effect]}),e=>e.code==='needs');
});

test('arithmetic mismatches and an unaffordable daily catch-up reject the entire batch',async t=>{
  const game=await table(t),initial=await game.sheet();
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:5},spend(3.75,'purchase',{items:[{name:'Water',quantity:2,unit_price:0.5},{name:'Cigarettes',quantity:1,unit_price:1.75}]})]}),e=>e.code==='invalid_params');
  assert.deepEqual(await game.sheet(),initial);
  await game.call('apply',{call_id:'t1-c1',effects:[{kind:'cash',delta:-(initial.finance.cash.amount-2),source:'found'},spend(9)]});
  const before=await game.sheet();
  await assert.rejects(game.call('apply',{call_id:'t1-c2',effects:[spend(2)]}),e=>e.code==='invalid_params'&&e.details.cash_debit===11);
  assert.deepEqual(await game.sheet(),before);
});

test('cash transfers stay cash and the legacy cash selector cannot debit a covered purchase',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  await game.call('apply',{call_id:'t1-c1',effects:[spend(3,'purchase',{settlement:'cash'}),{kind:'cash',delta:-2,source:'found'},{kind:'cash',delta:0.1,source:'found'}]});
  assert.equal((await game.sheet()).finance.cash.amount,before-1.9);
  assert.deepEqual((await game.receipts()).map(r=>r.delta),[0,-2,0.1]);
});

test('a printed-price quote needs no invented NPC identity',async t=>{
  const game=await table(t);
  const book=JSON.parse(await readFile(join(CONTENT,'rulesets/coc7/rules-json/equipment.json'),'utf8'));
  const lunch=book.records.find(r=>r.price_id==='eq.1920s.meals.meals_out.lunch');
  await game.call('apply',{call_id:'t1-c1',effects:[{kind:'cash',mode:'quote',quote:'Lunch',category:'living',source:'price',price_id:lunch.price_id,items:[{name:'Lunch',quantity:1,unit_price:lunch.price.amount}]}]});
  await game.call('apply',{call_id:'t1-c2',effects:[{kind:'cash',quote:'Lunch'}]});
  assert.equal((await game.receipts()).at(-1).settlement,'living_standard');
  assert.equal((await game.receipts()).at(-1).with,null);
});

test('an ordinary counter clerk can quote and settle without registering an NPC',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  await game.call('apply',{call_id:'t1-c1',effects:[{kind:'cash',mode:'quote',quote:'Counter lunch',category:'living',with:'The counter clerk',items:[{name:'Burger',quantity:1,unit_price:0.2},{name:'Coffee',quantity:1,unit_price:0.05}]}]});
  await game.call('apply',{call_id:'t1-c2',effects:[{kind:'cash',quote:'Counter lunch'}]});
  const paid=(await game.receipts()).at(-1);
  assert.equal(paid.purchase_amount,0.25);assert.equal(paid.with_label,'The counter clerk');
  assert.equal((await game.sheet()).finance.cash.amount,before);
  await game.call('narrate',{call_id:'t1-c3',text:'The meal is served.'});
});

const draft={quote:'Water and cigarettes',category:'purchase',with:'Counter clerk',why:'Water and cigarettes',items:[
  {name:'Water',quantity:2,unit_price:0.5},{name:'Cigarettes',quantity:1,unit_price:1.75},
]};
test('delivery precedes quote arithmetic; persisted drafts recover and settle exact terms once',async t=>{
  const game=await table(t),before=await game.sheet(),text='The clerk puts the bill beside the goods and waits.';
  const delivery=await game.call('narrate',{call_id:'t1-c1',text,quotes:[draft]});
  assert.equal(delivery.rendered_text,text);
  const pending=delivery.mechanics.find(row=>row.quote_status==='pending');
  assert.ok(pending.quote_key);
  assert.equal(pending.purchase_amount,undefined);
  assert.equal((await game.world()).cash_quotes,undefined,'no quote registered before prose delivery');
  assert.equal((await game.record(1)).quote_drafts.length,1);
  await game.restart();
  assert.deepEqual((await game.call('open')).quote_turns,[1]);
  assert.deepEqual((await game.call('quotes.flush')).turns,[1]);
  await game.call('player_input',{text:'I accept this bill.'});
  const landed=await game.call('quotes.flush',{turn:1});
  assert.equal(landed.quotes[pending.quote_key].purchase_amount,2.75);
  assert.equal(landed.quotes[pending.quote_key].quote_status,'ready');
  assert.deepEqual(await game.sheet(),before,'registration never changes cash, spending or equipment');
  const current=await game.call('status');
  assert.equal(current.turn,2);
  assert.ok(!current.receipts.some(row=>row.call_id===pending.quote_key),'background work cannot join the next player turn');
  await game.call('apply',{call_id:'t2-c1',effects:[{kind:'cash',quote:draft.quote}]});
  const paid=await game.sheet();assert.equal(paid.finance.cash.amount,before.finance.cash.amount);
  assert.equal(paid.finance.daily_spending.total,2.75);
  await game.restart();
  const replay=await game.call('quotes.flush',{turn:1});
  assert.deepEqual(replay,landed);
  await assert.rejects(game.call('apply',{call_id:'t2-c2',effects:[{kind:'cash',quote:draft.quote}]}),e=>e.code==='needs');
  assert.deepEqual(await game.sheet(),paid,'a replay cannot reopen and pay an offer twice');
});
test('a bad background draft leaves the delivered prose and balances intact',async t=>{
  const game=await table(t),before=await game.sheet(),text='The clerk searches for the price list.';
  const result=await game.call('narrate',{call_id:'t1-c1',text,quotes:[{...draft,with:undefined}]});
  assert.equal(result.rendered_text,text);
  const landed=await game.call('quotes.flush',{turn:1});
  assert.equal(Object.values(landed.quotes)[0].quote_status,'failed');
  assert.equal(Object.values(landed.quotes)[0].purchase_amount,undefined);
  assert.deepEqual(await game.sheet(),before);
  assert.equal((await game.record(1)).rendered_text,text);
});
test('an older delayed quote cannot overwrite a newer committed offer with the same name',async t=>{
  const game=await table(t);
  await game.call('narrate',{call_id:'t1-c1',text:'The clerk writes an offer.',quotes:[draft]});
  await game.call('player_input',{text:'Is that still the current price?'});
  await game.call('narrate',{call_id:'t2-c1',text:'The clerk offers a new price.',quotes:[{...draft,items:[{name:'Water',quantity:2,unit_price:1}]}]});
  const old=await game.call('quotes.flush',{turn:1});
  assert.equal(Object.values(old.quotes)[0].quote_status,'superseded');
  await game.call('quotes.flush',{turn:2});
  assert.equal((await game.world()).cash_quotes[0].purchase_amount,2);
  await game.call('quotes.flush',{turn:1});
  assert.equal((await game.world()).cash_quotes[0].purchase_amount,2);
});
test('background quotes from another worldline are stale and write no state',async t=>{
  const game=await table(t);
  await game.call('narrate',{call_id:'t1-c1',text:'The clerk writes an offer.',quotes:[draft]});
  const before=await game.world(),meta=JSON.parse(await readFile(game.metaPath,'utf8'));
  await writeFile(game.metaPath,JSON.stringify({...meta,active_worldline:'fixture-other-line'}));
  assert.equal((await game.call('quotes.flush',{turn:1})).stale,true);
  assert.deepEqual((await game.call('quotes.flush')).turns,[]);
  assert.deepEqual(await game.world(),before);
});
