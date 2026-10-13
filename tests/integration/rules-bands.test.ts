/** RPC boundary counterparts retained in addition to the fast arithmetic tier. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,RpcClient,CONTENT_DIR,readJson,writeJson,type Row} from './support.ts';
const rules=join(CONTENT_DIR,'rulesets/coc7/rules-json');
test('test_time_rows_are_the_time_cost_categories_in_the_table_order_with_their_ranges',async t=>{
  const k=await kernel(t),result=await k.ok('rules.bands',{field:'time.band'}),categories=readJson(join(rules,'time-costs.json')).categories;
  assert.equal(result.field,'time.band');assert.equal(result.table,'time-costs');
  assert.deepEqual(result.rows,Object.entries(categories).map(([handle,row]:[string,any])=>({handle,min:row.min,max:row.max,default:row.default,covers:row.covers.trim()})));
  assert.ok(result.rows.every((row:Row)=>row.covers));assert.ok(['local_travel','long_travel'].every(handle=>result.rows.some((row:Row)=>row.handle===handle)));
});
test('test_damage_rows_are_the_severity_ladder_in_order_with_their_dice_and_notes',async t=>{
  const k=await kernel(t),result=await k.ok('rules.bands',{field:'damage.band'}),severity=readJson(join(rules,'hazards.json')).severity;
  assert.equal(result.table,'hazards');assert.deepEqual(result.rows,Object.entries(severity).map(([handle,row]:[string,any])=>({handle,dice:row.damage_expr.trim().toUpperCase(),note:row.note})));
  assert.deepEqual(result.rows.slice(0,2).map((row:Row)=>row.handle),['minor','moderate']);
});
for(const params of [{field:'npc.archetype'},{field:'cash.band'},{}])test(`test_a_field_the_kernel_does_not_roll_from_is_refused_with_the_ones_it_does[${JSON.stringify(params)}]`,async t=>{
  const k=await kernel(t),error=await k.err('rules.bands',params);assert.equal(error.code,'invalid_params');assert.deepEqual(error.details,{field:'field',options:['time.band','damage.band']});assert.ok(error.fix.includes('details.options'));
});
test('test_a_malformed_row_fails_loudly_naming_the_table_and_the_row',async t=>{
  const k=await kernel(t),content=join(k.workspace,'content');cpSync(CONTENT_DIR,content,{recursive:true});const path=join(content,'rulesets/coc7/rules-json/time-costs.json'),table=readJson(path);
  table.categories.first_aid={min:40,default:15,max:30};writeJson(path,table);const other=new RpcClient(join(k.workspace,'malformed'),{content});t.after(()=>other.close());
  const error=await other.err('rules.bands',{field:'time.band'});assert.equal(error.code,'campaign_not_ready');assert.deepEqual(error.details,{table:'time-costs',row:'first_aid'});
});
