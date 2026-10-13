import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fastSuite, INVESTIGATOR, DAY } from './fast-support.mjs';
// Business counterparts of tests/kernel/test_sanity_day_boundary.py. RPC time/travel wiring remains integrated.
const suite=await fastSuite();
after(()=>suite.close());
const TO_MIDNIGHT=14*60, OPENING_SAN=55;
const snapshot=table=>table.save(`sanity-state/${INVESTIGATOR}.json`);
const statePair=table=>{const s=snapshot(table);return [s.daily_san_lost,s.day_start_san];};
async function lose(table,id,points){const outcome=await table.loseSan(id,points);assert.equal(outcome.san_loss,points);return outcome;}

test('test_midnight_closes_the_sanity_day', async () => {
  const table=suite.create();await lose(table,'t1-c1',3);
  assert.deepEqual(statePair(table),[3,OPENING_SAN]);
  const late=await table.rest('t1-c2',TO_MIDNIGHT-1);
  assert.equal(table.clock().at,'1920-10-12T23:59');assert.ok(!('day_ended' in late));
  assert.deepEqual(statePair(table),[3,OPENING_SAN]);
  const midnight=await table.rest('t1-c3',1);
  assert.equal(table.clock().at,'1920-10-13T00:00');
  assert.deepEqual(midnight.day_ended,{days:1,sanity:[{investigator:INVESTIGATOR,day_start_san:OPENING_SAN-3,went_indefinitely_insane:false}]});
  assert.deepEqual(statePair(table),[0,OPENING_SAN-3]);
  const closed=snapshot(table).events.filter(e=>e.type==='day_ended');assert.equal(closed.length,1);
  assert.deepEqual(closed[0].payload,{...closed[0].payload,daily_san_lost:3,threshold:11,day_start_san:OPENING_SAN,
    next_day_start_san:OPENING_SAN-3,indefinite_insanity_triggered:false});
});
test('test_travel_across_midnight_ends_the_day_though_it_is_no_rest', async () => {
  const table=suite.create();await lose(table,'t1-c1',3);
  const driven=await table.travel('t1-c2',TO_MIDNIGHT+30);
  assert.equal(table.clock().at,'1920-10-13T00:30');assert.equal(driven.day_ended.days,1);
  assert.deepEqual(statePair(table),[0,OPENING_SAN-3]);
});
test('test_a_fifth_lost_within_one_day_is_indefinite_insanity', async () => {
  const table=suite.create();
  for(const n of [1,2,3])assert.equal((await lose(table,`t1-c${n}`,3)).indefinite_insane,false);
  const fourth=await lose(table,'t1-c4',3);
  assert.equal(fourth.indefinite_insane,true);assert.equal(fourth.san_after,OPENING_SAN-12);
  assert.equal(snapshot(table).indefinite_insane,true);
});
test('test_the_same_loss_spread_over_days_never_reaches_a_fifth', async () => {
  const table=suite.create();let n=1;
  for(let i=0;i<3;i++)assert.equal((await lose(table,`t1-c${n++}`,3)).indefinite_insane,false);
  await table.rest(`t1-c${n++}`,TO_MIDNIGHT);assert.equal(snapshot(table).day_start_san,OPENING_SAN-9);
  for(let i=0;i<2;i++)assert.equal((await lose(table,`t1-c${n++}`,3)).indefinite_insane,false);
  await table.rest(`t1-c${n++}`,DAY);assert.equal(snapshot(table).day_start_san,OPENING_SAN-15);
  for(let i=0;i<2;i++)assert.equal((await lose(table,`t1-c${n++}`,3)).indefinite_insane,false);
  const state=snapshot(table);assert.equal(state.indefinite_insane,false);assert.equal(state.san_current,OPENING_SAN-21);
  assert.deepEqual(statePair(table),[6,OPENING_SAN-15]);
  assert.equal((await lose(table,`t1-c${n}`,3)).indefinite_insane,true);
});
test('test_one_advance_across_several_midnights_closes_each_day_in_turn', async () => {
  const table=suite.create();await lose(table,'t1-c1',3);
  const skipped=await table.rest('t1-c2',3*DAY);
  assert.equal(table.clock().at,'1920-10-15T10:00');
  assert.deepEqual(skipped.day_ended,{days:3,sanity:[{investigator:INVESTIGATOR,day_start_san:OPENING_SAN-3,went_indefinitely_insane:false}]});
  const state=snapshot(table);assert.deepEqual([state.daily_san_lost,state.day_start_san,state.indefinite_insane],[0,OPENING_SAN-3,false]);
  assert.deepEqual(state.events.filter(e=>e.type==='day_ended').map(e=>e.payload.daily_san_lost),[3,0,0]);
  assert.equal((await lose(table,'t1-c3',3)).indefinite_insane,false);
});
test('test_an_investigator_who_has_lost_nothing_is_not_given_a_snapshot_by_midnight', async () => {
  const table=suite.create(),passed=await table.rest('t1-c1',TO_MIDNIGHT);
  assert.deepEqual(passed.day_ended,{days:1,sanity:[]});assert.equal(snapshot(table),null);
  await lose(table,'t1-c2',3);assert.deepEqual(statePair(table),[3,OPENING_SAN]);
});
// The two resource-only cases from tests/kernel/test_apply.py; batch and storage cases stay there.
test('test_environment_damage_records_zero_hp_conditions', async () => {
  const table=suite.create();let reached=false;
  for(let n=1;n<30;n++){
    await table.hurt(`t1-c${n}`,1);const sheet=table.sheet();
    if(sheet.current_hp===0){
      assert.ok(sheet.conditions.includes('unconscious'));assert.ok(!sheet.conditions.includes('dead'));assert.ok(!sheet.conditions.includes('dying'));
      reached=true;break;
    }
  }
  assert.ok(reached,'damage did not reach zero');
});
test('test_environment_major_wound_and_lethal_damage', async () => {
  const table=suite.create(),maximum=table.sheet().derived.HP;
  await table.hurt('t1-c1',maximum);
  for(const condition of ['major_wound','unconscious','dying'])assert.ok(table.sheet().conditions.includes(condition));
  await table.hurt('t1-c2',maximum+1);assert.ok(table.sheet().conditions.includes('dead'));
});
