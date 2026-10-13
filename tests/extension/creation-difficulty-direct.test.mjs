import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fastSuite, ROOT } from './fast-support.mjs';
// The arithmetic cases of tests/kernel/test_creation_difficulty.py; draft/commit/snapshot tests stay integrated.
const suite=await fastSuite();after(()=>suite.close());
const policy=JSON.parse(await readFile(join(ROOT,'content/setup/steps.json'),'utf8')).steps.find(s=>s.id==='create-investigator');
const chargen=await suite.api.Chargen.create(suite.tables,policy);
const preset=name=>({mode:'preset',preset:name});
const custom=knobs=>({mode:'custom',custom:knobs});
// Compare the public numeric shape with the production serializer (PythonFloat becomes a JSON number).
const card=async (difficulty,extra={})=>JSON.parse(suite.api.pythonJsonDumps((await chargen.build({investigatorId:'ada',name:'Ada',occupationId:'Antiquarian',
  concept:null,age:27,sex:null,method:'rolled',seed:'11',era:'1920s',difficulty,...extra}))[0]));
test('test_same_seed_same_difficulty_same_card',async()=>{assert.deepEqual(await card(preset('normal')),await card(preset('normal')));});
test('test_presets_roll_the_rulebook_dice_on_the_rulebook_bounds',async()=>{
  const baseline=await card(preset('hard'));
  for(const name of ['extreme','normal','easy']){
    const sheet=await card(preset(name)),generation=sheet.creation.characteristics;
    assert.ok(!('scaling' in generation));assert.deepEqual(generation,baseline.creation.characteristics);
    assert.deepEqual(sheet.creation.age,baseline.creation.age);assert.deepEqual(sheet.derived,baseline.derived);
    if(name==='easy')assert.equal(sheet.creation.luck.dice,'2D6+6');
    else {assert.deepEqual(sheet.creation.luck,baseline.creation.luck);assert.deepEqual(sheet.characteristics,baseline.characteristics);}
  }
});
test('test_normal_preset_fattens_only_the_budgets',async()=>{
  const sheet=await card(preset('normal')),skills=sheet.creation.skills,occupation=skills.occupation,interest=skills.interest;
  assert.equal(occupation.budget.total,sheet.characteristics.EDU*4);
  assert.deepEqual(occupation.budget_adjusted,{total:Math.round(sheet.characteristics.EDU*4*1.25),multiplier:1.25,fixed:null});
  assert.equal(occupation.points,occupation.budget_adjusted.total-occupation.credit_rating.value);assert.equal(occupation.spent+occupation.unspent,occupation.points);
  assert.equal(interest.budget.total,sheet.characteristics.INT*2);
  assert.deepEqual(interest.budget_adjusted,{total:Math.round(sheet.characteristics.INT*2*1.25),multiplier:1.25,fixed:null});
  assert.equal(interest.spent+interest.unspent,interest.budget_adjusted.total);assert.equal(skills.cap.value,75);assert.ok(!('difficulty' in skills.cap));
});
test('test_easy_preset_fattens_budgets_and_rolls_kinder_luck',async()=>{
  const sheet=await card(preset('easy')),skills=sheet.creation.skills,luck=sheet.creation.luck;
  assert.equal(skills.occupation.budget_adjusted.total,Math.round(sheet.characteristics.EDU*4*1.5));
  assert.equal(skills.interest.budget_adjusted.total,Math.round(sheet.characteristics.INT*2*1.5));
  assert.equal(luck.dice,'2D6+6');assert.ok(luck.attempts.every(a=>a.total>=8&&a.total<=18));
  assert.equal(sheet.characteristics.LUCK,Math.max(...luck.attempts.map(a=>a.total))*5);assert.equal(skills.cap.value,75);
});
test('test_extreme_preset_thins_budgets_and_lowers_the_cap',async()=>{
  const sheet=await card(preset('extreme'),{occupationId:'Private Investigator'}),skills=sheet.creation.skills,occupation=skills.occupation,interest=skills.interest;
  assert.deepEqual(skills.cap,{value:60,source:'skills.guided_creation_policy.starting_skill_cap',difficulty:{skill_cap:60}});
  assert.deepEqual(occupation.budget_adjusted,{total:Math.round(occupation.budget.total*0.75),multiplier:0.75,fixed:null});
  assert.equal(occupation.points,occupation.budget_adjusted.total-occupation.credit_rating.value);assert.equal(occupation.spent+occupation.unspent,occupation.points);
  for(const name of Object.keys(occupation.allocations))assert.ok(sheet.skills[name]<=60);
  assert.deepEqual(interest.budget_adjusted,{total:Math.round(interest.budget.total*0.75),multiplier:0.75,fixed:null});
  assert.equal(interest.spent+interest.unspent,interest.budget_adjusted.total);
});
test('test_quick_fire_is_the_rulebook_array_under_every_preset',async()=>{
  const baseline=await card(preset('hard'),{method:'quick_fire'});
  for(const name of ['extreme','normal','easy']){
    const generation=(await card(preset(name),{method:'quick_fire'})).creation.characteristics;
    assert.deepEqual(generation.array,[80,70,60,60,50,50,50,40]);assert.ok(!('scaling' in generation));
    assert.deepEqual(generation.values,baseline.creation.characteristics.values);
  }
});
test('test_custom_pool_dice_replacement_rolls_and_bounds_its_own_range',async()=>{
  const difficulty=custom({characteristic_dice:{'3D6':'1D4+2'}}),sheet=await card(difficulty),generation=sheet.creation.characteristics;
  assert.deepEqual(generation.replaced_dice,{'3D6':'1D4+2'});
  for(const abbr of ['STR','CON','DEX','APP','POW']){assert.equal(generation.rolls[abbr].dice,'1D4+2');assert.ok([15,20,25,30].includes(generation.values[abbr]));}
  for(const abbr of ['SIZ','INT','EDU']){assert.equal(generation.rolls[abbr].dice,'2D6+6');assert.ok(generation.values[abbr]>=40&&generation.values[abbr]<=90);}
  assert.deepEqual(sheet.creation.difficulty,difficulty);
});
test('test_custom_fixed_luck_rolls_nothing',async()=>{
  const sheet=await card(custom({luck:{fixed:65}}));assert.equal(sheet.characteristics.LUCK,65);
  assert.equal(sheet.creation.luck.value,65);assert.deepEqual(sheet.creation.luck.attempts,[]);assert.equal(sheet.creation.luck.fixed,true);
});
test('test_custom_luck_dice_replaces_the_roll',async()=>{
  const sheet=await card(custom({luck:{dice:'2D4'}})),luck=sheet.creation.luck;
  assert.equal(luck.dice,'2D4');assert.ok(luck.attempts.every(a=>a.total>=2&&a.total<=8));assert.equal(sheet.characteristics.LUCK,Math.max(...luck.attempts.map(a=>a.total))*5);
});
test('test_custom_budget_multiplier_and_fixed',async()=>{
  const sheet=await card(custom({occupation_points:{multiplier:2},interest_points:{fixed:50}})),occupation=sheet.creation.skills.occupation,interest=sheet.creation.skills.interest;
  assert.deepEqual(occupation.budget_adjusted,{total:Math.round(occupation.budget.total*2),multiplier:2,fixed:null});
  assert.equal(occupation.points,occupation.budget_adjusted.total-occupation.credit_rating.value);assert.equal(occupation.spent+occupation.unspent,occupation.points);
  assert.deepEqual(interest.budget_adjusted,{total:50,multiplier:null,fixed:50});assert.equal(interest.spent,50);
});
test('test_custom_fixed_occupation_budget_ignores_the_formula',async()=>{
  const sheet=await card(custom({occupation_points:{fixed:300}})),occupation=sheet.creation.skills.occupation;
  assert.equal(occupation.budget.total,sheet.characteristics.EDU*4);assert.equal(occupation.points,300-occupation.credit_rating.value);
  assert.equal(occupation.spent+occupation.unspent,occupation.points);
});
test('test_custom_skill_cap_replaces_75',async()=>{
  const sheet=await card(custom({skill_cap:60}));assert.deepEqual(sheet.creation.skills.cap,{value:60,source:'skills.guided_creation_policy.starting_skill_cap',difficulty:{skill_cap:60}});
});
