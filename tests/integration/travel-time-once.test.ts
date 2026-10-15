/** The complete per-batch travel-time guard from test_travel_time_once.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,campaignDir,readJson,readJsonl,openTurn,type RpcClient,type Row} from './support.ts';
const ROAD=30;
const world=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'world.json'));
const timeRows=(k:RpcClient)=>readJsonl(join(campaignDir(k.workspace),'events.jsonl')).filter(row=>row.type==='time-advanced').map(row=>row.data);
const receipts=async(k:RpcClient)=>(await k.table('status')).receipts;
async function refused(k:RpcClient,effects:Row[]){const error=await k.tableErr('apply',{call_id:'t1-c1',effects});assert.equal(error.code,'invalid_params');
  assert.equal(error.details.reason,'travel_time_duplicated');assert.equal(world(k).clock.minutes,0);assert.equal(world(k).active_scene,'commission-briefing');
  assert.deepEqual(await receipts(k),[]);assert.deepEqual(timeRows(k),[]);return error;}
test('test_a_time_beside_a_travelling_move_is_refused_with_a_literal_fix',async t=>{
  const k=await kernel(t);await openTurn(k);const error=await refused(k,[{kind:'move',to:'newspaper-morgue',travel_minutes:30},{kind:'time',minutes:30,why:'从诺特办公室到环球报馆的路程'}]);
  assert.equal(error.details.index,1);assert.equal(error.details.field,'beyond_travel');assert.equal(error.details.minutes,30);assert.equal(error.details.travel_minutes,30);
  assert.deepEqual(error.details.moves,[{index:0,to:'newspaper-morgue',minutes:30}]);assert.ok(error.fix.startsWith('Remove this time effect and send the batch again'));assert.ok(error.fix.includes('beyond_travel: true'));
  assert.ok(error.fix.includes('effects[1]'),error.fix);
});
test('test_the_edge_default_travel_counts_and_order_does_not_matter',async t=>{
  const k=await kernel(t);await openTurn(k);const error=await refused(k,[{kind:'time',minutes:45},{kind:'move',to:'hall-of-records'}]);assert.equal(error.details.index,0);assert.equal(error.details.travel_minutes,ROAD);
  assert.ok(error.fix.includes('effects[0]'),error.fix);
});
test('test_amounts_the_kernel_binds_are_guarded_too',async t=>{
  const k=await kernel(t);await openTurn(k);await refused(k,[{kind:'move',to:'newspaper-morgue'},{kind:'time',band:'single_room_search'}]);
});
test('test_an_until_before_the_move_is_guarded',async t=>{
  const k=await kernel(t);await openTurn(k);await refused(k,[{kind:'time',until:{days:0,time:'11:00'}},{kind:'move',to:'newspaper-morgue'}]);
});
test('test_beyond_travel_lands_and_the_clock_advances_by_both',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue',travel_minutes:30},{kind:'time',minutes:45,why:'翻旧报纸',beyond_travel:true}]});
  assert.equal(world(k).clock.minutes,75);assert.equal(world(k).active_scene,'newspaper-morgue');const time=(await receipts(k)).filter((r:Row)=>r.kind==='time');
  assert.equal(time.length,1);assert.equal(time[0].minutes,45);assert.equal(time[0].beyond_travel,true);assert.deepEqual(timeRows(k).map(row=>[row.minutes,row.why]),[[30,'travel'],[45,'翻旧报纸']]);
});
test('test_a_move_alone_advances_once',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue'}]});assert.equal(world(k).clock.minutes,ROAD);assert.deepEqual(timeRows(k).map(row=>[row.minutes,row.why]),[[ROAD,'travel']]);
});
test('test_a_time_alone_is_unchanged',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:20}]});await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:5,beyond_travel:true}]});
  assert.equal(world(k).clock.minutes,25);const time=(await receipts(k)).filter((r:Row)=>r.kind==='time');assert.ok(!('beyond_travel' in time[0]));assert.equal(time[1].beyond_travel,true);
});
test('test_forms_that_add_no_elapsed_time_are_not_refused',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue'},{kind:'time',minutes:0}]});assert.equal(world(k).clock.minutes,ROAD);
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'move',to:'central-library',travel_minutes:0},{kind:'time',minutes:20}]});assert.equal(world(k).clock.minutes,ROAD+20);
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'move',to:'central-library',label:'中央图书馆'},{kind:'time',minutes:10}]});assert.equal(world(k).clock.minutes,ROAD+30);
  await k.table('apply',{call_id:'t1-c4',effects:[{kind:'move',to:'hall-of-records'},{kind:'time',until:{days:0,time:'12:00'}}]});assert.equal(world(k).clock.minutes,120);assert.equal(world(k).active_scene,'hall-of-records');
});
test('test_the_clerk_s_separate_time_write_after_a_move_still_lands',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue'}]});await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',band:'single_room_search',why:"the clerk's band"}]});assert.ok(world(k).clock.minutes>ROAD);
});
test('test_beyond_travel_must_be_a_boolean',async t=>{
  const k=await kernel(t);await openTurn(k);const error=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:5,beyond_travel:'yes'}]});assert.equal(error.code,'invalid_params');assert.equal(error.details.reason,'beyond_travel_invalid');assert.equal(world(k).clock.minutes,0);
});
