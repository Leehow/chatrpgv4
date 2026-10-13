import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fastSuite } from './fast-support.mjs';
// tests/kernel/test_rules_bands.py through the real handler, without serialization or a child process.
const suite=await fastSuite();
after(()=>suite.close());
const read=suite.api.readHandlers(suite.kernel)['rules.bands'];
test('test_time_rows_are_the_time_cost_categories_in_the_table_order_with_their_ranges', async () => {
  const result=await read({field:'time.band'}),categories=(await suite.tables.load('time-costs')).categories;
  assert.equal(result.field,'time.band');assert.equal(result.table,'time-costs');
  assert.deepEqual(result.rows,Object.entries(categories).map(([handle,row])=>({handle,min:row.min,max:row.max,default:row.default,covers:row.covers.trim()})));
  assert.ok(result.rows.every(row=>row.covers));
  for(const name of ['local_travel','long_travel'])assert.ok(result.rows.some(row=>row.handle===name));
});
test('test_damage_rows_are_the_severity_ladder_in_order_with_their_dice_and_notes', async () => {
  const result=await read({field:'damage.band'}),severity=(await suite.tables.load('hazards')).severity;
  assert.equal(result.table,'hazards');
  assert.deepEqual(result.rows,Object.entries(severity).map(([handle,row])=>({handle,dice:row.damage_expr.trim().toUpperCase(),note:row.note})));
  assert.deepEqual(result.rows.slice(0,2).map(row=>row.handle),['minor','moderate']);
});
for(const [index,params] of [{field:'npc.archetype'},{field:'cash.band'},{}].entries()) {
  test(`test_a_field_the_kernel_does_not_roll_from_is_refused_with_the_ones_it_does[${index}]`, async () => {
    await assert.rejects(()=>read(params),error=>{
      assert.equal(error.code,'invalid_params');assert.deepEqual(error.details,{field:'field',options:['time.band','damage.band']});
      assert.ok(error.fix.includes('details.options'));return true;
    });
  });
}
test('test_a_malformed_row_fails_loudly_naming_the_table_and_the_row', async () => {
  const bad=await suite.tables.load('time-costs'),authored=bad.categories.first_aid;
  bad.categories.first_aid={min:40,default:15,max:30};
  const kernel={...suite.kernel,snapshots:{...suite.kernel.snapshots,readJson:async path=>path.endsWith('/time-costs.json')?suite.api.clone(bad):suite.kernel.snapshots.readJson(path)}};
  await assert.rejects(()=>suite.api.readHandlers(kernel)['rules.bands']({field:'time.band'}),error=>{
    assert.equal(error.code,'campaign_not_ready');assert.deepEqual(error.details,{table:'time-costs',row:'first_aid'});return true;
  });
  // Retain the original malformed row above, then isolate the range guard from the covers guard.
  bad.categories.first_aid={...authored,min:40,default:15,max:30};
  await assert.rejects(()=>suite.api.readHandlers(kernel)['rules.bands']({field:'time.band'}),error=>{
    assert.equal(error.code,'campaign_not_ready');assert.deepEqual(error.details,{table:'time-costs',row:'first_aid'});return true;
  });
});
