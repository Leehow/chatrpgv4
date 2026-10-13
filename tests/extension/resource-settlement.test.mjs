import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resourceSuite, INVESTIGATOR, DAY, WEEK } from './resource-settlement-support.mjs';

// Assertion counterparts for tests/kernel/test_apply_time_healing.py and
// tests/kernel/test_apply_time_mp.py. Those unchanged RPC tests retain disk,
// lookup projection and the public result's omitted-field assertions.
const suite = await resourceSuite();
after(() => suite.close());
const hp = table => table.sheet().current_hp;
const hpRows = result => result.recovered.filter(row => row.resource === 'hp');
const mpRows = result => result.recovered.filter(row => row.resource === 'mp');

test('test_a_day_of_rest_is_one_hit_point_not_three', async () => {
  const table = suite.create();
  await table.hurt('t1-c1', 4);
  assert.equal(hp(table), 8);
  assert.ok(!table.sheet().conditions.includes('major_wound'));
  const rested = await table.rest('t1-c2', DAY);
  assert.equal(hp(table), 9);
  assert.deepEqual(hpRows(rested), [{ investigator: INVESTIGATOR, resource: 'hp', before: 8, after: 9 }]);
  assert.ok(rested.receipts.some(r => r.id.startsWith('delta:hp-t1')));
});

test('test_the_day_turns_at_twenty_four_hours', async () => {
  const table = suite.create();
  await table.hurt('t1-c1', 4);
  await table.rest('t1-c2', 2 * DAY - 1);
  assert.equal(hp(table), 9);
  await table.rest('t1-c3', 2 * DAY);
  assert.equal(hp(table), 11);
});

test('test_a_week_of_rest_is_seven_hit_points', async () => {
  const table = suite.create();
  await table.hurt('t1-c1', 5);
  await table.hurt('t1-c2', 5);
  assert.equal(hp(table), 2);
  assert.ok(!table.sheet().conditions.includes('major_wound'));
  const rested = await table.rest('t1-c3', WEEK);
  assert.equal(hp(table), 9);
  assert.deepEqual(hpRows(rested), [{ investigator: INVESTIGATOR, resource: 'hp', before: 2, after: 9 }]);
});

test('test_a_month_of_rest_is_as_long_as_the_month', async () => {
  const table = suite.create();
  await table.hurt('t1-c1', 5);
  await table.hurt('t1-c2', 5);
  const rested = await table.rest('t1-c3', 30 * DAY);
  assert.equal(hp(table), 12);
  assert.deepEqual(hpRows(rested), [{ investigator: INVESTIGATOR, resource: 'hp', before: 2, after: 12 }]);
});

test('test_a_major_wound_gets_no_weekly_roll_from_two_days_and_a_third', async () => {
  const table = suite.create('4');
  await table.hurt('t1-c1', 8);
  assert.equal(hp(table), 4);
  assert.ok(table.sheet().conditions.includes('major_wound'));
  const rested = await table.rest('t1-c2', 3360);
  assert.deepEqual(rested.recovered, []);
  assert.ok(!rested.receipts.some(r => r.id.startsWith('delta:hp')));
  assert.equal(hp(table), 4);
  assert.ok(table.sheet().conditions.includes('major_wound'));
});

test('test_three_weeks_with_a_major_wound_roll_three_times', async () => {
  const one = suite.create('4'), three = suite.create('4');
  for (const table of [one, three]) {
    await table.hurt('t1-c1', 11);
    assert.equal(hp(table), 1);
    assert.ok(table.sheet().conditions.includes('major_wound'));
  }
  await one.rest('t1-c2', WEEK);
  const rested = await three.rest('t1-c2', 3 * WEEK);
  assert.ok(hp(one) > 1, 'seed 4: the first recovery roll succeeds');
  assert.ok(hp(three) > hp(one));
  assert.deepEqual(hpRows(rested), [{ investigator: INVESTIGATOR, resource: 'hp', before: 1, after: hp(three) }]);
});

test('test_healing_clears_the_sheet_and_a_healed_wound_does_not_come_back', async () => {
  const table = suite.create('4');
  await table.hurt('t1-c1', 8);
  assert.equal(hp(table), 4);
  assert.ok(table.sheet().conditions.includes('major_wound'));
  await table.rest('t1-c2', 8 * WEEK);
  assert.equal(hp(table), 12, 'eight weeks restores full health');
  assert.deepEqual(table.sheet().conditions, []);
  await table.hurt('t1-c3', 2);
  assert.equal(hp(table), 10);
  assert.ok(!table.sheet().conditions.includes('major_wound'));
});

test('test_apply_time_five_minutes_leaves_mp_untouched', async () => {
  const table = suite.create(); table.setMp(3);
  const result = await table.rest('t1-c1', 5);
  assert.deepEqual(result.recovered, []);
  assert.equal(table.sheet().current_mp, 3);
});

test('test_apply_time_sixty_minutes_grants_exactly_one_point', async () => {
  const table = suite.create(); table.setMp(0);
  const regained = mpRows(await table.rest('t1-c1', 60));
  assert.ok(regained.length);
  assert.equal(regained[0].before, 0); assert.equal(regained[0].after, 1);
  assert.equal(table.sheet().current_mp, 1);
});

test('test_apply_time_ninety_minutes_grants_one_point_not_a_rounded_two', async () => {
  const table = suite.create(); table.setMp(0);
  const regained = mpRows(await table.rest('t1-c1', 90));
  assert.ok(regained.length);
  assert.equal(regained[0].before, 0); assert.equal(regained[0].after, 1);
  assert.equal(table.sheet().current_mp, 1);
});

test('test_apply_time_two_separate_thirty_minute_advances_do_not_yet_accumulate', async () => {
  const table = suite.create(); table.setMp(0);
  assert.deepEqual((await table.rest('t1-c1', 30)).recovered, []);
  assert.deepEqual((await table.rest('t1-c2', 30)).recovered, []);
  assert.equal(table.sheet().current_mp, 0);
});

test('test_apply_time_long_rest_never_exceeds_the_pow_over_five_ceiling', async () => {
  const table = suite.create(); table.setMp(9);
  const regained = mpRows(await table.rest('t1-c1', 600));
  assert.ok(regained.length);
  assert.equal(regained[0].before, 9); assert.equal(regained[0].after, 11);
  assert.equal(table.sheet().current_mp, 11);
});
