/** Explicit activity time and travel are additive, ordered and replay safe. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,campaignDir,readJson,readJsonl,openTurn,type RpcClient,type Row} from './support.ts';
const ROAD=30;
const world=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'world.json'));
const timeRows=(k:RpcClient)=>readJsonl(join(campaignDir(k.workspace),'events.jsonl')).filter(row=>row.type==='time-advanced').map(row=>row.data);
const receipts=async(k:RpcClient)=>(await k.table('status')).receipts;
test('equal but independent activity and travel durations both count',async t=>{
 const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue',travel_minutes:30},{kind:'time',minutes:30,why:'Read the old newspapers after arriving'}]});
 assert.equal(world(k).clock.minutes,60);assert.deepEqual(timeRows(k).map(row=>row.minutes),[30,30]);
});
test('activity before a default journey counts in the declared order',async t=>{
 const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:45},{kind:'move',to:'hall-of-records'}]});
 assert.equal(world(k).clock.minutes,ROAD+45);assert.deepEqual(timeRows(k).map(row=>row.minutes),[45,ROAD]);
});
test('a bound activity band adds to its journey without a boolean declaration',async t=>{
 const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue'},{kind:'time',band:'single_room_search'}]});
 const rows=timeRows(k);assert.equal(rows[0].minutes,ROAD);assert.ok(rows[1].minutes>0);assert.equal(world(k).clock.minutes,ROAD+rows[1].minutes);
});
test('until before travel reaches the time first and then counts the journey',async t=>{
 const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'time',until:{days:0,time:'11:00'}},{kind:'move',to:'newspaper-morgue'}]});
 assert.equal(world(k).clock.minutes,90);assert.deepEqual(timeRows(k).map(row=>row.minutes),[60,ROAD]);
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
