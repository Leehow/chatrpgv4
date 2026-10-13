/** Delivery number obligations from tests/kernel/test_narrate_numbers.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn,type RpcClient,type Row} from './support.ts';
const hurt=(k:RpcClient)=>k.table('apply',{call_id:'t1-c1',effects:[{kind:'damage',dice:'1D1+6',why:'梁塌了'}]});
async function publicFigures(k:RpcClient){
  const figures=new Set<string>();for(const row of (await k.table('status')).receipts){
    if(row.visibility==='keeper')continue;
    for(const key of ['roll','target','total','before','after','minutes'])if(typeof row[key]==='number')figures.add(String(Math.trunc(row[key])));
  }return figures;
}
test('test_a_delivery_that_states_none_of_its_figures_goes_through',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k);await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:15}]});
  const figures=await publicFigures(k);assert.ok(figures.size);const text='梁塌下来，他倒在瓦砾里，喘不上气。';assert.ok(![...figures].some(figure=>text.includes(figure)));
  const result=await k.table('narrate',{call_id:'t1-c3',text});assert.equal(result.rendered_text,text);assert.equal(result.turn,1);assert.ok(result.commit);
  const kinds=result.mechanics.map((row:Row)=>row.kind);assert.ok(['dice','change','time'].every(kind=>kinds.includes(kind)));
  assert.equal(result.mechanics.find((row:Row)=>row.kind==='time').minutes,15);
});
test('test_no_error_code_asks_for_figures_in_the_prose',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k);const result=await k.table('narrate',{call_id:'t1-c2',text:'他倒下了。'});
  assert.ok(!('error' in result));assert.equal((await k.table('status')).turn,2);
});
test('test_keeper_only_receipts_still_oblige_nothing',async t=>{
  const k=await kernel(t);await openTurn(k);assert.deepEqual(await publicFigures(k),new Set());
  assert.equal((await k.table('narrate',{call_id:'t1-c1',text:'他把烟按进托盘，没有回答。'})).turn,1);
});
