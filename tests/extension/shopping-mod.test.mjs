/** Contract §265: the Shopping package -- an outlet's stock, price and order time come from the kernel, not the Keeper. */
import {playtestScratch} from './playtest-scratch.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
const suite=playtestScratch('shopping-mod-contracts');
await writeFile(join(suite,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
const rpc=join(suite,'rpc.mjs');
await build({entryPoints:[join(ROOT,'kernel-ts/rpc.ts')],outfile:rpc,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
await symlink(join(ROOT,'node_modules'),join(suite,'node_modules'),'dir');
const manifest=JSON.parse(await readFile(join(ROOT,'mods/shopping/mod.json'),'utf8'));
async function table(t,{off=false}={}){
  const home=await mkdtemp(join(suite,'home-'));
  const client=new KernelClient({command:[process.execPath,rpc,'--workspace',home,'--content',CONTENT],cwd:ROOT,timeoutMs:20_000});
  t.after(()=>client.close());
  await client.call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  if(off)await client.call('mods.configure',{campaign:'c1',id:'shopping',enabled:false});
  await client.call('table.open',{campaign:'c1'});
  await client.call('table.narrate',{campaign:'c1',call_id:'t0-c1',text:'The investigation begins.'});
  await client.call('table.player_input',{campaign:'c1',text:'I go shopping.'});
  return {
    call:(method,params={})=>client.call(`table.${method}`,{campaign:'c1',...params}),
    world:async()=>JSON.parse(await readFile(join(home,'.coc/campaigns/c1/world.json'),'utf8')),
  };
}
const SUIT='Worsted Wool Dress Suit';
const outfitter={outlet:"Hollis Men's Outfitters",trade:'stocks',settlement:'city'};
const suitRow=async(game,shop=outfitter)=>{
  const answer=await game.call('lookup',{kind:'shop',query:SUIT,shop});
  return {answer,row:answer.goods.find(row=>row.name===SUIT)};
};
// §265.5: with shop the Keeper gives no source, seller or category.
const buy=(line,shop,extra={})=>({kind:'cash',why:'A new suit',items:[line],shop,...extra});

test('the shipped package is default on and requires the kernel stock capability',()=>{
  assert.equal(manifest.default_enabled,true);
  assert.ok(manifest.requires.includes('shopping.stock.v1'));
});

test('an outlet answers the same stock and printed price every time it is asked this week',async t=>{
  const game=await table(t),{answer,row}=await suitRow(game),again=await suitRow(game);
  assert.ok(row,'the printed record is among the goods');
  assert.equal(row.unit_price,'17.95');
  assert.deepEqual(again.row,row);
  assert.ok(answer.as_named&&answer.note);
  assert.deepEqual(row.line,{name:SUIT,quantity:1,unit_price:'17.95',price_id:row.price_id});
  const named=await game.call('lookup',{kind:'shop',query:'flashlight | electric torch',shop:outfitter});
  assert.ok(named.goods.some(goods=>goods.name==='Electric Torch'),'each name the Keeper gives is searched');
  assert.equal(named.as_named.name,'flashlight');
});

test('a sale is checked against the shelf, takes stock off it and refuses another price',async t=>{
  const game=await table(t),{row}=await suitRow(game);
  assert.ok(row.available,'the seeded week has suits on this outfitter\'s shelf');
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[buy({...row.line,unit_price:'12.00'},outfitter)]}),e=>e.code==='invalid_params'&&e.details.unit_price==='17.95');
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[buy({...row.line,quantity:row.in_stock+1},outfitter)]}),e=>e.code==='needs'&&e.details.reason==='out_of_stock'&&e.details.in_stock===row.in_stock);
  // A line beside it with no printed record carries the Keeper's own price (§265.4).
  await game.call('apply',{call_id:'t1-c1',effects:[{...buy(row.line,outfitter),items:[row.line,{name:'collar studs',quantity:1,unit_price:'0.10'}]}]});
  const receipt=(await game.call('status')).receipts.find(r=>r.kind==='cash'&&r.shop);
  assert.deepEqual([receipt.source,receipt.with_label,receipt.category],['quote',outfitter.outlet,'purchase']);
  const after=(await suitRow(game)).row;
  assert.equal(after.in_stock,row.in_stock-1);
  assert.equal((await game.world()).shop_ledger.outlets["hollis men's outfitters"].sold[row.price_id],1);
});

test('goods off the shelf can be ordered and are collected from the ready day',async t=>{
  const game=await table(t);
  // A village sideline never has rare goods on the shelf (8% less 25 points), but can order them.
  const shop={outlet:'Corner Store',trade:'sideline',settlement:'village',rarity:'rare'},{row}=await suitRow(game,shop);
  assert.equal(row.available,false);assert.ok(row.order.days>0);
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[buy(row.line,shop)]}),e=>e.details.reason==='out_of_stock'&&e.details.order.days===row.order.days);
  await game.call('apply',{call_id:'t1-c1',effects:[buy(row.line,{...shop,order:true},{mode:'quote',quote:'Ordered suit'})]});
  const quote=(await game.world()).cash_quotes.find(q=>q.name==='Ordered suit');
  assert.equal(quote.ready_day,row.order.ready_day);
  await assert.rejects(game.call('apply',{call_id:'t1-c2',effects:[{kind:'cash',quote:'Ordered suit'}]}),e=>e.code==='needs'&&e.details.reason==='order_not_ready');
  await game.call('apply',{call_id:'t1-c3',effects:[{kind:'time',minutes:(row.order.days+1)*1440,reason:'Waiting for the order'}]});
  await game.call('apply',{call_id:'t1-c4',effects:[{kind:'cash',quote:'Ordered suit'}]});
  assert.ok((await game.world()).cash_quotes.find(q=>q.name==='Ordered suit').settled);
});

test('an outlet that does not deal in the goods cannot order them',async t=>{
  const game=await table(t),shop={outlet:'Bakery',trade:'unlikely',settlement:'city',rarity:'rare'},{row}=await suitRow(game,shop);
  assert.equal(row.available,false);assert.equal(row.order,null);
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[buy(row.line,{...shop,order:true})]}),e=>e.code==='needs'&&e.details.reason==='not_orderable');
});

test('with the package off the shop lookup and the shop terms are refused',async t=>{
  const game=await table(t,{off:true});
  await assert.rejects(game.call('lookup',{kind:'shop',query:SUIT,shop:outfitter}),e=>e.code==='not_implemented');
  await assert.rejects(game.call('apply',{call_id:'t1-c1',effects:[buy({name:SUIT,quantity:1,unit_price:'17.95'},outfitter)]}),e=>e.code==='invalid_params');
});
