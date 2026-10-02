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
  await assert.rejects(game.call('apply',{call_id:'t1-c2',effects:[spend(2)]}),e=>e.code==='invalid_params');
  assert.deepEqual(await game.sheet(),before);
});

test('cash transfers stay cash and the legacy cash selector cannot debit a covered purchase',async t=>{
  const game=await table(t),before=(await game.sheet()).finance.cash.amount;
  await game.call('apply',{call_id:'t1-c1',effects:[spend(3,'purchase',{settlement:'cash'}),{kind:'cash',delta:-2,source:'found'},{kind:'cash',delta:0.1,source:'found'}]});
  assert.equal((await game.sheet()).finance.cash.amount,before-1.9);
  assert.deepEqual((await game.receipts()).map(r=>r.delta),[0,-2,0.1]);
});
