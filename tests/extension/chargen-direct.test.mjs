import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fastSuite, ROOT } from './fast-support.mjs';

// Direct counterparts of tests/kernel/test_chargen.py, except its two retained RPC cases.
const suite = await fastSuite();
after(() => suite.close());
const { Chargen, ChargenError, PythonRandom, parseFormula, evaluateFormula, defaultInvestigatorId } = suite.api;
const read = async path => JSON.parse(await readFile(join(ROOT, path), 'utf8'));
const POLICY = (await read('content/setup/steps.json')).steps.find(s => s.id === 'create-investigator');
const chargen = await Chargen.create(suite.tables, POLICY);
const BASE = { STR: 60, CON: 50, SIZ: 70, DEX: 55, APP: 45, INT: 65, POW: 60, EDU: 70 };
const rules = name => suite.tables.load(name);
const build = (overrides = {}, generator = chargen) => generator.build({ investigatorId: 'ada', name: 'Ada',
  occupationId: 'Private Investigator', concept: null, age: 27, sex: null, method: 'quick_fire', seed: '7', era: '1920s', ...overrides });
const sum = values => values.reduce((a, b) => a + b, 0);
const sorted = values => [...values].sort((a, b) => a - b);
const subset = (left, right) => [...left].every(value => right.has(value));
const raises = (fn, stage, check = () => true) => assert.throws(fn, e => e instanceof ChargenError && e.stage === stage && check(e));
const rejects = (fn, stage, check = () => true) => assert.rejects(fn, e => e instanceof ChargenError && e.stage === stage && check(e));

test('test_derive_values_match_the_rulebook_cases', async () => {
  assert.deepEqual((await chargen.derive(BASE, 0)).values, { HP: 12, SAN: 60, MP: 12, MOV: 7, DB: '+1D4', BUILD: 1 });
});
test('test_movement_rate_applies_the_age_penalty', async () => {
  const fast = { ...BASE, STR: 80, SIZ: 65, DEX: 75 };
  assert.equal((await chargen.derive(fast, 0)).values.MOV, 9);
  assert.equal((await chargen.derive(fast, 1)).values.MOV, 8);
});
test('test_every_derived_number_names_its_table', async () => {
  const trace = (await chargen.derive(BASE, 0)).trace;
  for (const [key, prefix] of Object.entries({HP:'derived-attributes.hit_points',MP:'derived-attributes.magic_points',
    SAN:'derived-attributes.sanity',DB:'damage-bonus-build',BUILD:'damage-bonus-build',MOV:'movement-rate'})) assert.ok(trace[key].startsWith(prefix));
});
test('test_age_bracket_20_39_only_runs_one_edu_check', () => {
  const aged = chargen.applyAge({...BASE}, 32, new PythonRandom('x')), trace = aged.trace;
  assert.equal(trace.bracket, '20-39');
  assert.equal(trace.edu_reduction, 0); assert.equal(trace.app_reduction, 0);
  assert.deepEqual(trace.characteristic_reductions, []); assert.equal(trace.edu_improvement_checks.length, 1);
  const check = trace.edu_improvement_checks[0];
  if (check.roll > check.edu) {
    assert.ok(check.improvement >= 1 && check.improvement <= 10);
    assert.equal(aged.values.EDU, Math.min(99, BASE.EDU + check.improvement));
  } else assert.equal(aged.values.EDU, BASE.EDU);
  assert.equal(trace.mov_penalty, 0); assert.equal(trace.luck_rolls_keep_highest, 1);
});
test('test_age_bracket_40_49_spreads_the_reduction_over_the_listed_choices', () => {
  const aged = chargen.applyAge({...BASE}, 47, new PythonRandom('x')), trace = aged.trace;
  assert.equal(trace.bracket, '40-49'); assert.equal(aged.values.APP, BASE.APP - 5);
  assert.deepEqual(trace.characteristic_reductions.map(r=>r.characteristic), ['STR','CON','DEX']);
  assert.equal(sum(trace.characteristic_reductions.map(r=>r.amount)), 5);
  assert.equal(aged.values.STR+aged.values.CON+aged.values.DEX, BASE.STR+BASE.CON+BASE.DEX-5);
  assert.equal(trace.edu_improvement_checks.length, 2); assert.equal(trace.mov_penalty, 1);
});
test('test_teens_lose_edu_and_roll_luck_twice', () => {
  const aged = chargen.applyAge({...BASE},17,new PythonRandom('x'));
  assert.equal(aged.values.EDU,BASE.EDU-5); assert.equal(aged.trace.luck_rolls_keep_highest,2);
  const luck=chargen.luck(new PythonRandom('x'),2);
  assert.equal(luck.attempts.length,2); assert.equal(luck.value,Math.max(...luck.attempts.map(a=>a.total))*5);
});
test('test_age_outside_the_table_is_refused', () => { raises(()=>chargen.ageBracket(14),'age'); raises(()=>chargen.ageBracket(90),'age'); });
test('test_quick_fire_uses_the_data_array_and_leads_with_the_formula', async () => {
  const array=(await rules('characteristic-dice')).generation_methods.quick_fire_array.array;
  const [sheet]=await build({occupationId:'Antiquarian'}), generated=sheet.creation.characteristics;
  assert.deepEqual(generated.array,array); assert.equal(generated.assignment_order[0],'EDU');
  assert.deepEqual(sorted(Object.values(generated.values)),sorted(array)); assert.equal(generated.values.EDU,array[0]);
});
test('test_rolled_uses_each_characteristic_dice_times_the_multiplier', async () => {
  const [sheet]=await build({method:'rolled',seed:'rolled-1'}), dice=(await rules('characteristic-dice')).characteristics;
  for(const [abbr,roll] of Object.entries(sheet.creation.characteristics.rolls)) {
    assert.equal(roll.dice,dice[abbr].dice.toUpperCase());
    assert.equal(roll.total,sum(roll.faces)+(roll.dice.endsWith('+6')?6:0));
    assert.equal(sheet.creation.characteristics.values[abbr],roll.total*5);
  }
});
test('test_same_seed_same_sheet_different_seed_different_rolls', async () => {
  const [one]=await build({method:'rolled',seed:'s1'}), [two]=await build({method:'rolled',seed:'s1'}), [three]=await build({method:'rolled',seed:'s2'});
  assert.deepEqual(one,two); assert.notDeepEqual(three.characteristics,one.characteristics);
});
test('test_formula_parser_takes_the_richest_alternative_and_says_which', () => {
  const parsed=parseFormula('EDU*2+either APP*2, DEX*2 or STR*2');
  assert.deepEqual(parsed.base,[['EDU',2]]); assert.equal(parsed.alternatives.length,3);
  const value=evaluateFormula(parsed,{EDU:60,APP:50,DEX:70,STR:40});
  assert.equal(value.total,260); assert.deepEqual(value.alternative,['DEX*2']);
  const plain=evaluateFormula(parseFormula('EDU*4'),{EDU:65}); assert.equal(plain.total,260); assert.equal(plain.alternative,null);
  raises(()=>parseFormula('four times education'),'formula');
});
test('test_occupation_points_follow_the_formula_and_credit_rating_the_range', async () => {
  const spec=(await rules('occupations')).occupations['Private Investigator'], [sheet,receipt]=await build(), occ=sheet.creation.skills.occupation;
  const expected=evaluateFormula(parseFormula(spec.skill_point_formula),sheet.characteristics).total;
  assert.equal(occ.budget.total,expected); assert.equal(sheet.credit_rating,spec.credit_rating_range[0]); assert.equal(sheet.credit_rating,sheet.skills['Credit Rating']);
  assert.equal(occ.points,expected-sheet.credit_rating); assert.equal(occ.spent+occ.unspent,occ.points);
  assert.ok(subset(Object.keys(occ.allocations),new Set(occ.resolved))); assert.ok(occ.choices_pending.includes('any one other skill'));
  assert.deepEqual(receipt.choices_pending,occ.choices_pending);
});
test('test_spread_reserves_the_entries_it_cannot_name_instead_of_maxing_four_skills', async () => {
  const tiers=POLICY.allocation.tiers,[sheet,receipt]=await build({occupationId:'Military Officer'}),occ=sheet.creation.skills.occupation;
  for(const value of [occ.allocation,receipt.allocation,POLICY.allocation.default])assert.equal(value,'spread');
  assert.deepEqual(sheet.creation.allocation,{policy:'spread',tiers,source:'steps.json create-investigator.allocation'});
  assert.deepEqual(new Set(Object.keys(occ.allocations)),new Set(occ.resolved)); assert.equal(occ.resolved.length,4);
  assert.deepEqual(new Set(occ.resolved.map(s=>sheet.skills[s])),new Set([tiers[0]]));
  assert.deepEqual(occ.reserved.map(r=>r.for),occ.choices_pending); assert.ok(occ.reserved.every(r=>r.points>0&&r.points<=tiers[0]));
  assert.equal(receipt.occupation_reserved,sum(occ.reserved.map(r=>r.points))); assert.ok(receipt.occupation_reserved<=occ.unspent);
  assert.equal(occ.spent+occ.unspent,occ.points);
  const [filled,fr]=await build({occupationId:'Military Officer',allocation:'fill'}),fo=filled.creation.skills.occupation;
  assert.equal(fo.allocation,'fill'); assert.equal(filled.creation.allocation.policy,'fill');
  assert.deepEqual(new Set(fo.resolved.map(s=>filled.skills[s])),new Set([chargen.cap]));
  assert.deepEqual(fo.reserved,[]); assert.equal(fr.occupation_reserved,0); assert.equal(fo.points,occ.points);
});
test('test_spread_walks_the_list_tier_by_tier_and_the_tiers_come_from_the_table', () => {
  const values={A:10,B:20,C:30},slots=['A','B','any one other skill','C'],resolved=new Set(['A','B','C']);
  const [allocations,reserved]=Chargen.spread(slots,resolved,200,{...values},75,[50,70]);
  assert.deepEqual(allocations,{A:60,B:50,C:20}); assert.deepEqual(reserved,[{for:'any one other skill',points:70}]);
  assert.equal(sum(Object.values(allocations))+sum(reserved.map(r=>r.points)),200);
  assert.deepEqual(Chargen.spread(slots,resolved,200,{...values},75,[40,60]),[{A:65,B:45,C:30},[{for:'any one other skill',points:60}]]);
  assert.deepEqual(Chargen.spread(slots,resolved,200,{...values},75,[]),[{A:65,B:55,C:5},[{for:'any one other skill',points:75}]]);
  assert.deepEqual(Chargen.spread(['A'],new Set(['A']),500,{...values},75,[50,90]),[{A:65},[]]);
  assert.deepEqual(Chargen.allocate(['A','B','C'],9,{...values},75),{A:3,B:3,C:3});
});
test('test_the_default_policy_is_read_from_the_table_and_unknown_policies_are_refused', async () => {
  const swapped=await Chargen.create(suite.tables,{...POLICY,allocation:{...POLICY.allocation,default:'fill'}});
  const [sheet]=await build({occupationId:'Military Officer'},swapped);
  assert.equal(sheet.creation.allocation.policy,'fill'); assert.deepEqual(sheet.creation.skills.occupation.reserved,[]);
  await rejects(()=>build({occupationId:'Military Officer',allocation:'random'}),'allocation', e=>{
    assert.deepEqual(e.expected.options,['spread','fill']); assert.equal(e.expected.default,POLICY.allocation.default); return true;
  });
});
test('test_skill_values_are_base_plus_points_and_never_above_the_cap', async () => {
  const [sheet]=await build({occupationId:'Journalist'}),skills=await rules('skills'),cap=skills.guided_creation_policy.starting_skill_cap;
  const occ=sheet.creation.skills.occupation.allocations,interest=sheet.creation.skills.interest.allocations;
  for(const [name,value] of Object.entries(sheet.skills)) {
    if(name==='Credit Rating')continue;
    let base=skills.skills[name].base_chance;
    if(base==='half_DEX')base=Math.floor(sheet.characteristics.DEX/2); else if(base==='EDU')base=sheet.characteristics.EDU;
    const points=(occ[name]??0)+(interest[name]??0); assert.equal(value,base+points); assert.ok(points===0||value<=cap);
  }
});
test('test_interest_points_are_int_times_two_over_the_standard_sheet', async () => {
  const [sheet]=await build({occupationId:'Artist'}),interest=sheet.creation.skills.interest;
  assert.equal(interest.budget.formula,POLICY.formulas.personal_interest_points); assert.equal(interest.budget.total,sheet.characteristics.INT*2);
  const standard=(await rules('skills')).standard_sheet['1920s'].default_skill_ids, resolved=new Set(sheet.creation.skills.occupation.resolved);
  assert.deepEqual(new Set(interest.pool),new Set(standard.filter(s=>!resolved.has(s)&&!POLICY.interest_pool.exclude.includes(s))));
  assert.ok(subset(Object.keys(interest.allocations),new Set(interest.pool))); assert.equal(sheet.skills['Cthulhu Mythos'],0);
  assert.equal(interest.spent+interest.unspent,interest.budget.total);
});
test('test_finance_comes_from_the_era_tier_or_is_declared_unavailable', async () => {
  const [sheet,receipt]=await build(),finance=sheet.finance;
  assert.equal(finance.credit_rating,sheet.credit_rating); assert.equal(finance.period,'1920s');
  assert.equal(sheet.cash,`${finance.cash.amount} ${finance.cash.currency}`); assert.equal(receipt.finance_available,true);
  const [ww1,wr]=await build({occupationId:'Soldier',era:'ww1'});
  assert.equal(ww1.finance,null); assert.equal(ww1.cash,null); assert.equal(ww1.creation.finance.available,false);
  assert.ok(ww1.creation.finance.reason.includes('ww1')); assert.equal(wr.finance_available,false);
  assert.equal(ww1.creation.skills.standard_sheet,null); assert.equal(ww1.creation.skills.interest.unspent,ww1.characteristics.INT*2);
});
test('test_equipment_is_not_invented', async () => { const [sheet]=await build(); assert.deepEqual(sheet.equipment,[]); assert.deepEqual(sheet.weapons,[]); assert.equal(sheet.creation.equipment.source,null); });
test('test_unknown_occupation_and_method_are_refused', async () => {
  await rejects(()=>build({occupationId:'war correspondent'}),'occupation', e=>e.expected.options.includes('Journalist'));
  await rejects(()=>build({method:'point_buy'}),'method');
});
test('test_sheet_has_the_pregen_shape', async () => {
  const pregen=await read('content/starters/the-haunting/pregens/thomas-hayes/character.json'),[sheet]=await build();
  for(const key of ['schema_version','id','name','occupation','era','age','sex','characteristics','derived','skills','weapons','equipment','backstory','credit_rating','cash'])assert.ok(key in sheet,key);
  assert.deepEqual(new Set(Object.keys(sheet.characteristics)),new Set(Object.keys(pregen.characteristics)));
  assert.deepEqual(new Set(Object.keys(sheet.derived)),new Set(Object.keys(pregen.derived)));
});
test('test_default_investigator_id_slugs_latin_names_and_numbers_the_rest', () => {
  assert.equal(defaultInvestigatorId('Ada Lovelace',1),'ada-lovelace');
  assert.equal(defaultInvestigatorId('\u6258\u9a6c\u65af\u00b7\u6d77\u65af',2),'inv-2');
});
const pools=()=>chargen.dicePools().map(([,pool])=>pool);
test('test_dice_pools_group_the_characteristics_by_their_own_expression', () => {
  assert.deepEqual(chargen.dicePools(),[['3D6',['STR','CON','DEX','APP','POW']],['2D6+6',['SIZ','INT','EDU']]]);
});
for(const seed of ['s1','s2','s3','s4','s5','s6','s7','s8']) {
  test(`test_an_aptitude_permutes_the_same_rolls_inside_each_pool[${seed}]`, () => {
    const plain=chargen.rolled(new PythonRandom(seed)),stated=chargen.rolled(new PythonRandom(seed),{strong:['STR'],weak:['INT']});
    assert.equal(stated.method,'rolled_pool_assignment'); assert.equal(stated.multiplier,plain.multiplier);
    for(const pool of pools())assert.deepEqual(sorted(pool.map(a=>plain.values[a])),sorted(pool.map(a=>stated.values[a])));
    assert.equal(stated.values.STR,Math.max(...pools()[0].map(a=>plain.values[a]))); assert.equal(stated.values.INT,Math.min(...pools()[1].map(a=>plain.values[a])));
  });
  test(`test_each_characteristic_reports_the_dice_that_actually_made_its_value[${seed}]`, () => {
    const stated=chargen.rolled(new PythonRandom(seed),{strong:['STR','CON'],weak:['APP']});
    for(const [abbr,roll] of Object.entries(stated.rolls)) {
      assert.equal(sum(roll.faces)+(roll.dice==='2D6+6'?6:0),roll.total); assert.equal(roll.total*stated.multiplier,stated.values[abbr]);
    }
    assert.ok(subset(stated.assignment.filter(r=>r.characteristic!==r.rolled_for).map(r=>r.characteristic),new Set(pools()[0])));
    assert.deepEqual(new Set(stated.assignment.filter(r=>r.direction).map(r=>r.characteristic)),new Set(['STR','CON','APP']));
  });
  test(`test_only_the_named_characteristic_and_the_slot_it_took_from_move[${seed}]`, () => {
    const plain=chargen.rolled(new PythonRandom(seed)),stated=chargen.rolled(new PythonRandom(seed),{strong:['STR'],weak:[]});
    const donor=new Set(stated.assignment.filter(r=>r.characteristic==='STR').map(r=>r.rolled_for));
    for(const abbr of chargen.characteristics)if(abbr!=='STR'&&!donor.has(abbr))assert.equal(stated.values[abbr],plain.values[abbr]);
  });
}
test('test_an_absent_or_empty_aptitude_generates_exactly_as_before', () => {
  const plain=chargen.rolled(new PythonRandom('s1'));
  for(const empty of [null,{}, {strong:[],weak:[]}])assert.deepEqual(chargen.rolled(new PythonRandom('s1'),chargen.aptitude(empty)),plain);
});
for(const [index,[value,message]] of [
  [{strong:['LUCK'],origin:'player'},'unknown characteristics'],[{strong:['Strength'],origin:'player'},'unknown characteristics'],
  [{strong:['STR'],weak:['STR'],origin:'player'},'cannot be both'],[{strong:['STR','STR'],origin:'player'},'at most once'],
  [{strong:['STR']},'must say who named this'],[{strong:['STR'],origin:'keeper'},'must say who named this'],
].entries())test(`test_the_kernel_only_accepts_the_closed_set[${index}]`,()=>raises(()=>chargen.aptitude(value),'aptitude',e=>e.message.includes(message)));
test('test_an_inference_off_the_concept_is_capped_and_a_players_claim_is_not', () => {
  const limit=POLICY.aptitude.concept_limit;
  assert.equal(chargen.aptitude({strong:Array(limit).fill('STR'),weak:['INT'].slice(0,limit),origin:'concept'}).origin,'concept');
  raises(()=>chargen.aptitude({strong:['STR','CON'],weak:['INT'],origin:'concept'}),'aptitude',e=>e.expected.concept_limit===limit);
  assert.deepEqual(chargen.aptitude({strong:['STR','CON'],weak:['INT','EDU'],origin:'player'}).strong,['STR','CON']);
});
test('test_both_origins_place_the_same_rolls_the_same_way', () => {
  const placed=['player','concept'].map(origin=>chargen.rolled(new PythonRandom('s1'),chargen.aptitude({strong:['STR'],weak:['INT'],origin})));
  assert.deepEqual(placed[0].values,placed[1].values); assert.deepEqual(placed.map(p=>p.aptitude.origin),['player','concept']);
});
test('test_an_aptitude_cannot_direct_the_quick_fire_array', async () => { await rejects(()=>build({method:'quick_fire',aptitude:{strong:['STR'],origin:'player'}}),'aptitude'); });
test('test_the_built_card_records_the_assignment_as_its_method', async () => {
  const aptitude={strong:['STR'],weak:['INT'],origin:'player'},[sheet,receipt]=await build({method:'rolled',aptitude});
  assert.equal(sheet.creation.method,'rolled_pool_assignment'); assert.equal(receipt.method,'rolled_pool_assignment');
  assert.deepEqual(sheet.creation.characteristics.aptitude,aptitude);
  const [plain]=await build({method:'rolled'}); assert.equal(plain.creation.method,'rolled'); assert.ok(!('aptitude' in plain.creation.characteristics));
});
const INTERESTS=['Fighting (Brawl)','Throw','First Aid','Climb','Library Use','Navigate','Swim','Jump'];
const profile=(overrides={})=>({method:'rolled',seed:'interest-1',interestSkills:[...INTERESTS],occupationSkills:
  ['Spot Hidden','Listen','Track','Natural World','Mechanical Repair','Drive Auto','Intimidate','Operate Heavy Machinery'],occupationId:'Farmer',...overrides});
test('test_the_supplied_interest_order_decides_who_reaches_a_usable_value', async () => {
  const [first]=await build(profile()),interest=first.creation.skills.interest;
  assert.equal(interest.allocation,'spread'); assert.deepEqual(interest.tiers,[50,70]); assert.equal(interest.source,'steps.json create-investigator.interest_allocation');
  assert.equal(first.skills['Fighting (Brawl)'],50); assert.equal(first.skills.Jump,chargen.skillBase('Jump',first.characteristics));
  const [second]=await build(profile({interestSkills:[...INTERESTS].reverse()})); assert.equal(second.skills.Jump,50);
  assert.ok(second.skills['Fighting (Brawl)']<first.skills['Fighting (Brawl)']); assert.equal(second.creation.skills.interest.spent,interest.spent);
});
test('test_the_interest_budget_is_still_spent_whole', async () => {
  for(const policy of ['spread','fill']) {
    const [sheet,receipt]=await build(profile({interestAllocation:policy})),interest=sheet.creation.skills.interest;
    assert.equal(interest.unspent,0); assert.equal(interest.spent,interest.budget.total); assert.equal(interest.allocation,policy); assert.equal(receipt.interest_allocation,policy);
  }
});
test('test_fill_keeps_the_older_level_round_robin', async () => {
  const [sheet]=await build(profile({interestAllocation:'fill'})),given=sorted(Object.values(sheet.creation.skills.interest.allocations));
  assert.ok(given.at(-1)-given[0]<=1); assert.equal(sheet.creation.skills.interest.tiers,null);
});
test('test_the_legacy_auto_pool_carries_no_order_so_it_keeps_the_round_robin', async () => {
  const [sheet,receipt]=await build({occupationId:'Farmer'}),interest=sheet.creation.skills.interest;
  assert.equal(interest.allocation,'fill'); assert.equal(receipt.interest_allocation,'fill');
  const given=sorted(Object.values(interest.allocations)); assert.ok(given.at(-1)-given[0]<=1);
});
test('test_an_unknown_interest_policy_is_refused_at_its_own_stage', async () => {
  await rejects(()=>build(profile({interestAllocation:'pointy'})),'interest_allocation',e=>{assert.deepEqual(e.expected.options,['spread','fill']);return true;});
});
