/** Preserve the real RPC and saved-state boundaries of test_sanity_day_boundary.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,CAMPAIGN,campaignDir,readJson,openTurn,type RpcClient} from './support.ts';
const INVESTIGATOR='thomas-hayes',OPENING_SAN=55,TO_MIDNIGHT=840,DAY=1440;
const path=(k:RpcClient)=>join(campaignDir(k.workspace),'save/sanity-state',INVESTIGATOR+'.json');
const snapshot=(k:RpcClient)=>readJson(path(k));
const clock=async(k:RpcClient)=>(await k.ok('table.view',{campaign:CAMPAIGN})).clock.at;
const advance=(k:RpcClient,call_id:string,minutes:number)=>k.table('apply',{call_id,effects:[{kind:'time',minutes}]});
async function lose(k:RpcClient,call_id:string,points:number){
  const outcome=(await k.table('resolve',{call_id,action:{intent:'investigate',goal:'又一样不该看见的东西',method:'',decision:'sanity:check',san_loss:`${points}/${points}`,involuntary:'freeze'}})).outcome;
  assert.equal(outcome.san_loss,points);return outcome;
}
test('test_midnight_closes_the_sanity_day',async t=>{
  const k=await kernel(t);await openTurn(k);await lose(k,'t1-c1',3);let state=snapshot(k);assert.deepEqual([state.daily_san_lost,state.day_start_san],[3,OPENING_SAN]);
  const late=await advance(k,'t1-c2',TO_MIDNIGHT-1);assert.equal(await clock(k),'1920-10-12T23:59');assert.ok(!('day_ended' in late));state=snapshot(k);assert.deepEqual([state.daily_san_lost,state.day_start_san],[3,OPENING_SAN]);
  const midnight=await advance(k,'t1-c3',1);assert.equal(await clock(k),'1920-10-13T00:00');assert.deepEqual(midnight.day_ended,{days:1,sanity:[{investigator:INVESTIGATOR,day_start_san:OPENING_SAN-3,went_indefinitely_insane:false}]});
  state=snapshot(k);assert.deepEqual([state.daily_san_lost,state.day_start_san],[0,OPENING_SAN-3]);const closed=state.events.filter((row:any)=>row.type==='day_ended');assert.equal(closed.length,1);
  assert.deepEqual(closed[0].payload,{...closed[0].payload,daily_san_lost:3,threshold:11,day_start_san:OPENING_SAN,next_day_start_san:OPENING_SAN-3,indefinite_insanity_triggered:false});
});
test('test_travel_across_midnight_ends_the_day_though_it_is_no_rest',async t=>{
  const k=await kernel(t);await openTurn(k);await lose(k,'t1-c1',3);const driven=await k.table('apply',{call_id:'t1-c2',effects:[{kind:'move',to:'Hall of Records',travel_minutes:TO_MIDNIGHT+30}]});
  assert.equal(await clock(k),'1920-10-13T00:30');assert.equal(driven.day_ended.days,1);const state=snapshot(k);assert.deepEqual([state.daily_san_lost,state.day_start_san],[0,OPENING_SAN-3]);
});
test('test_a_fifth_lost_within_one_day_is_indefinite_insanity',async t=>{
  const k=await kernel(t);await openTurn(k);for(const n of [1,2,3])assert.equal((await lose(k,`t1-c${n}`,3)).indefinite_insane,false);
  const fourth=await lose(k,'t1-c4',3);assert.equal(fourth.indefinite_insane,true);assert.equal(fourth.san_after,OPENING_SAN-12);assert.equal(snapshot(k).indefinite_insane,true);
});
test('test_the_same_loss_spread_over_days_never_reaches_a_fifth',async t=>{
  const k=await kernel(t);await openTurn(k);let n=1;for(let i=0;i<3;i++)assert.equal((await lose(k,`t1-c${n++}`,3)).indefinite_insane,false);
  await advance(k,`t1-c${n++}`,TO_MIDNIGHT);assert.equal(snapshot(k).day_start_san,OPENING_SAN-9);for(let i=0;i<2;i++)assert.equal((await lose(k,`t1-c${n++}`,3)).indefinite_insane,false);
  await advance(k,`t1-c${n++}`,DAY);assert.equal(snapshot(k).day_start_san,OPENING_SAN-15);for(let i=0;i<2;i++)assert.equal((await lose(k,`t1-c${n++}`,3)).indefinite_insane,false);
  const state=snapshot(k);assert.equal(state.indefinite_insane,false);assert.equal(state.san_current,OPENING_SAN-21);assert.deepEqual([state.daily_san_lost,state.day_start_san],[6,OPENING_SAN-15]);
  assert.equal((await lose(k,`t1-c${n}`,3)).indefinite_insane,true);
});
test('test_one_advance_across_several_midnights_closes_each_day_in_turn',async t=>{
  const k=await kernel(t);await openTurn(k);await lose(k,'t1-c1',3);const skipped=await advance(k,'t1-c2',3*DAY);
  assert.equal(await clock(k),'1920-10-15T10:00');assert.deepEqual(skipped.day_ended,{days:3,sanity:[{investigator:INVESTIGATOR,day_start_san:OPENING_SAN-3,went_indefinitely_insane:false}]});
  const state=snapshot(k);assert.deepEqual([state.daily_san_lost,state.day_start_san,state.indefinite_insane],[0,OPENING_SAN-3,false]);assert.deepEqual(state.events.filter((row:any)=>row.type==='day_ended').map((row:any)=>row.payload.daily_san_lost),[3,0,0]);
  assert.equal((await lose(k,'t1-c3',3)).indefinite_insane,false);
});
test('test_an_investigator_who_has_lost_nothing_is_not_given_a_snapshot_by_midnight',async t=>{
  const k=await kernel(t);await openTurn(k);assert.deepEqual((await advance(k,'t1-c1',TO_MIDNIGHT)).day_ended,{days:1,sanity:[]});assert.ok(!existsSync(path(k)));
  await lose(k,'t1-c2',3);const state=snapshot(k);assert.deepEqual([state.daily_san_lost,state.day_start_san],[3,OPENING_SAN]);
});
