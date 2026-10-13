// Migrated from tests/kernel/test_creation_difficulty.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,campaign_dir,read_json,profile,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,pyMin,pyMax,math} from "./setup-native-support.ts";






export let MODULE:any="the-haunting";
export let POOL_3D6:any=["STR","CON","DEX","APP","POW"];
export let POOL_2D6_6:any=["SIZ","INT","EDU"];
export async function jsround(value:any){

return (await pyMethod(math,"floor",[pyAdd(value,0.5)],{}));
}
export async function create(kernel:any,difficulty:any=null,campaign_id:any=CAMPAIGN){
let params:any=({["id"]:campaign_id,["module"]:MODULE,["play_language"]:"en"});
if(pyBool((difficulty!==null))){params["difficulty"]=difficulty;}
return pyAt((await pyMethod(kernel,"ok",["campaign.create",params],{})),"campaign");
}
export async function investigator(kernel:any,campaign_id:any=CAMPAIGN,seed:any="11",method:any="rolled",occupation:any="Antiquarian"){
return pyAt((await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:campaign_id,["name"]:"Ada",["occupation"]:occupation,["age"]:27,["method"]:method,["seed"]:seed})],{})),"sheet");
}
export async function preset(name:any){
return ({["mode"]:"preset",["preset"]:name});
}

export async function test_absent_hard_and_empty_custom_are_bit_identical(kernel:any){
(await create(kernel));
(await create(kernel,(await preset("hard")),"c2"));
(await create(kernel,({["mode"]:"custom",["custom"]:({})}),"c3"));
const __unpack1842=(await (async()=>{const __rows:any[]=[];for(const cid of pyIterable([CAMPAIGN,"c2","c3"])){if(pyBool(true))__rows.push((await investigator(kernel,cid)));}return __rows;})());let plain:any=__unpack1842[0];let hard:any=__unpack1842[1];let empty:any=__unpack1842[2];
assert.ok(pyBool(!pyContains(pyAt(plain,"creation"),"difficulty")),"tests/kernel/test_creation_difficulty.py:51 assert \"difficulty\" not in plain[\"creation\"]");
assert.ok(pyBool(!pyContains((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"difficulty")),"tests/kernel/test_creation_difficulty.py:52 assert \"difficulty\" not in read_json(campaign_dir(kernel.workspace) / \"campaign.json\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(hard,"creation"),"difficulty"),({["mode"]:"preset",["preset"]:"hard",["custom"]:({})}))),"tests/kernel/test_creation_difficulty.py:53 assert hard[\"creation\"][\"difficulty\"] == {\"mode\": \"preset\", \"preset\": \"hard\", \"custom\": {}}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(empty,"creation"),"difficulty"),({["mode"]:"custom",["custom"]:({})}))),"tests/kernel/test_creation_difficulty.py:54 assert empty[\"creation\"][\"difficulty\"] == {\"mode\": \"custom\", \"custom\": {}}");
for(const card of pyIterable([hard,empty])){
assert.ok(pyBool(pyEqual(({...pyAt(card,"creation"),["difficulty"]:null}),({...pyAt(plain,"creation"),["difficulty"]:null}))),"tests/kernel/test_creation_difficulty.py:56 assert {**card[\"creation\"], \"difficulty\": None} == {**plain[\"creation\"], \"difficulty\": None}");
assert.ok(pyBool(pyEqual(pyAt(card,"characteristics"),pyAt(plain,"characteristics"))),"tests/kernel/test_creation_difficulty.py:57 assert card[\"characteristics\"] == plain[\"characteristics\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"derived"),pyAt(plain,"derived"));return pyBool(__left)?pyEqual(pyAt(card,"skills"),pyAt(plain,"skills")):__left})())),"tests/kernel/test_creation_difficulty.py:58 assert card[\"derived\"] == plain[\"derived\"] and card[\"skills\"] == plain[\"skills\"]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_absent_hard_and_empty_custom_are_bit_identical"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_absent_hard_and_empty_custom_are_bit_identical(await kernel(t,{}));});
export async function test_same_seed_same_difficulty_same_card(kernel:any){
(await create(kernel,(await preset("normal"))));
(await create(kernel,(await preset("normal")),"c2"));
const __unpack2668=[(await investigator(kernel)),(await investigator(kernel,"c2"))];let first:any=__unpack2668[0];let second:any=__unpack2668[1];
assert.ok(pyBool(pyEqual(second,first)),"tests/kernel/test_creation_difficulty.py:65 assert second == first");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_same_seed_same_difficulty_same_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_same_seed_same_difficulty_same_card(await kernel(t,{}));});

export async function test_presets_roll_the_rulebook_dice_on_the_rulebook_bounds(kernel:any){

(await create(kernel,(await preset("hard"))));
let baseline:any=(await investigator(kernel));
for(const name of pyIterable(["extreme","normal","easy"])){
(await create(kernel,(await preset(name)),name));
let card:any=(await investigator(kernel,name));
let generation:any=pyAt(pyAt(card,"creation"),"characteristics");
assert.ok(pyBool(!pyContains(generation,"scaling")),"tests/kernel/test_creation_difficulty.py:80 assert \"scaling\" not in generation");
assert.ok(pyBool(pyEqual(generation,pyAt(pyAt(baseline,"creation"),"characteristics"))),"tests/kernel/test_creation_difficulty.py:81 assert generation == baseline[\"creation\"][\"characteristics\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"creation"),"age"),pyAt(pyAt(baseline,"creation"),"age"))),"tests/kernel/test_creation_difficulty.py:82 assert card[\"creation\"][\"age\"] == baseline[\"creation\"][\"age\"]");
assert.ok(pyBool(pyEqual(pyAt(card,"derived"),pyAt(baseline,"derived"))),"tests/kernel/test_creation_difficulty.py:83 assert card[\"derived\"] == baseline[\"derived\"]");
if(pyBool(pyEqual(name,"easy"))){assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"creation"),"luck"),"dice"),"2D6+6")),"tests/kernel/test_creation_difficulty.py:85 assert card[\"creation\"][\"luck\"][\"dice\"] == \"2D6+6\"");}else{assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"creation"),"luck"),pyAt(pyAt(baseline,"creation"),"luck"))),"tests/kernel/test_creation_difficulty.py:87 assert card[\"creation\"][\"luck\"] == baseline[\"creation\"][\"luck\"]");
assert.ok(pyBool(pyEqual(pyAt(card,"characteristics"),pyAt(baseline,"characteristics"))),"tests/kernel/test_creation_difficulty.py:88 assert card[\"characteristics\"] == baseline[\"characteristics\"]");}
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_presets_roll_the_rulebook_dice_on_the_rulebook_bounds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_presets_roll_the_rulebook_dice_on_the_rulebook_bounds(await kernel(t,{}));});
export async function test_normal_preset_fattens_only_the_budgets(kernel:any){
(await create(kernel,(await preset("normal"))));
let card:any=(await investigator(kernel));
let skills:any=pyAt(pyAt(card,"creation"),"skills");
const __unpack4043=[pyAt(skills,"occupation"),pyAt(skills,"interest")];let occupation:any=__unpack4043[0];let interest:any=__unpack4043[1];
assert.ok(pyBool(pyEqual(pyAt(pyAt(occupation,"budget"),"total"),pyMultiply(pyAt(pyAt(card,"characteristics"),"EDU"),4))),"tests/kernel/test_creation_difficulty.py:96 assert occupation[\"budget\"][\"total\"] == card[\"characteristics\"][\"EDU\"] * 4");
assert.ok(pyBool(pyEqual(pyAt(occupation,"budget_adjusted"),({["total"]:(await jsround(pyMultiply(pyMultiply(pyAt(pyAt(card,"characteristics"),"EDU"),4),1.25))),["multiplier"]:1.25,["fixed"]:null}))),"tests/kernel/test_creation_difficulty.py:97 assert occupation[\"budget_adjusted\"] == {\"total\": jsround(card[\"characteristics\"][\"EDU\"] * 4 * 1.25),\n                                             \"multiplier\": 1.25, \"fixed\": None}");
assert.ok(pyBool(pyEqual(pyAt(occupation,"points"),pySubtract(pyAt(pyAt(occupation,"budget_adjusted"),"total"),pyAt(pyAt(occupation,"credit_rating"),"value")))),"tests/kernel/test_creation_difficulty.py:99 assert occupation[\"points\"] == occupation[\"budget_adjusted\"][\"total\"] - occupation[\"credit_rating\"][\"value\"]");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(occupation,"spent"),pyAt(occupation,"unspent")),pyAt(occupation,"points"))),"tests/kernel/test_creation_difficulty.py:100 assert occupation[\"spent\"] + occupation[\"unspent\"] == occupation[\"points\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(interest,"budget"),"total"),pyMultiply(pyAt(pyAt(card,"characteristics"),"INT"),2))),"tests/kernel/test_creation_difficulty.py:101 assert interest[\"budget\"][\"total\"] == card[\"characteristics\"][\"INT\"] * 2");
assert.ok(pyBool(pyEqual(pyAt(interest,"budget_adjusted"),({["total"]:(await jsround(pyMultiply(pyMultiply(pyAt(pyAt(card,"characteristics"),"INT"),2),1.25))),["multiplier"]:1.25,["fixed"]:null}))),"tests/kernel/test_creation_difficulty.py:102 assert interest[\"budget_adjusted\"] == {\"total\": jsround(card[\"characteristics\"][\"INT\"] * 2 * 1.25),\n                                           \"multiplier\": 1.25, \"fixed\": None}");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(interest,"spent"),pyAt(interest,"unspent")),pyAt(pyAt(interest,"budget_adjusted"),"total"))),"tests/kernel/test_creation_difficulty.py:104 assert interest[\"spent\"] + interest[\"unspent\"] == interest[\"budget_adjusted\"][\"total\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(skills,"cap"),"value"),75);return pyBool(__left)?!pyContains(pyAt(skills,"cap"),"difficulty"):__left})())),"tests/kernel/test_creation_difficulty.py:105 assert skills[\"cap\"][\"value\"] == 75 and \"difficulty\" not in skills[\"cap\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_normal_preset_fattens_only_the_budgets"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_normal_preset_fattens_only_the_budgets(await kernel(t,{}));});
export async function test_easy_preset_fattens_budgets_and_rolls_kinder_luck(kernel:any){
(await create(kernel,(await preset("easy"))));
let card:any=(await investigator(kernel));
let skills:any=pyAt(pyAt(card,"creation"),"skills");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(skills,"occupation"),"budget_adjusted"),"total"),(await jsround(pyMultiply(pyMultiply(pyAt(pyAt(card,"characteristics"),"EDU"),4),1.5))))),"tests/kernel/test_creation_difficulty.py:112 assert skills[\"occupation\"][\"budget_adjusted\"][\"total\"] == jsround(card[\"characteristics\"][\"EDU\"] * 4 * 1.5)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(skills,"interest"),"budget_adjusted"),"total"),(await jsround(pyMultiply(pyMultiply(pyAt(pyAt(card,"characteristics"),"INT"),2),1.5))))),"tests/kernel/test_creation_difficulty.py:113 assert skills[\"interest\"][\"budget_adjusted\"][\"total\"] == jsround(card[\"characteristics\"][\"INT\"] * 2 * 1.5)");
let luck:any=pyAt(pyAt(card,"creation"),"luck");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(luck,"dice"),"2D6+6");return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(luck,"attempts"))){if(pyBool(true))__rows.push((await (async()=>{const __term0=8;const __term1=pyAt(a,"total");const __term2=18;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()));}return __rows;})()))):__left})())),"tests/kernel/test_creation_difficulty.py:115 assert luck[\"dice\"] == \"2D6+6\" and all(8 <= a[\"total\"] <= 18 for a in luck[\"attempts\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"characteristics"),"LUCK"),pyMultiply((await pyMax((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(luck,"attempts"))){if(pyBool(true))__rows.push(pyAt(a,"total"));}return __rows;})()))),5))),"tests/kernel/test_creation_difficulty.py:116 assert card[\"characteristics\"][\"LUCK\"] == max(a[\"total\"] for a in luck[\"attempts\"]) * 5");
assert.ok(pyBool(pyEqual(pyAt(pyAt(skills,"cap"),"value"),75)),"tests/kernel/test_creation_difficulty.py:117 assert skills[\"cap\"][\"value\"] == 75");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_easy_preset_fattens_budgets_and_rolls_kinder_luck"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_easy_preset_fattens_budgets_and_rolls_kinder_luck(await kernel(t,{}));});
export async function test_extreme_preset_thins_budgets_and_lowers_the_cap(kernel:any){
(await create(kernel,(await preset("extreme"))));
let card:any=(await investigator(kernel,undefined,undefined,undefined,"Private Investigator"));
let skills:any=pyAt(pyAt(card,"creation"),"skills");
assert.ok(pyBool(pyEqual(pyAt(skills,"cap"),({["value"]:60,["source"]:"skills.guided_creation_policy.starting_skill_cap",["difficulty"]:({["skill_cap"]:60})}))),"tests/kernel/test_creation_difficulty.py:124 assert skills[\"cap\"] == {\"value\": 60, \"source\": \"skills.guided_creation_policy.starting_skill_cap\",\n                             \"difficulty\": {\"skill_cap\": 60}}");
let occupation:any=pyAt(skills,"occupation");
assert.ok(pyBool(pyEqual(pyAt(occupation,"budget_adjusted"),({["total"]:(await jsround(pyMultiply(pyAt(pyAt(occupation,"budget"),"total"),0.75))),["multiplier"]:0.75,["fixed"]:null}))),"tests/kernel/test_creation_difficulty.py:127 assert occupation[\"budget_adjusted\"] == {\"total\": jsround(occupation[\"budget\"][\"total\"] * 0.75),\n                                             \"multiplier\": 0.75, \"fixed\": None}");
assert.ok(pyBool(pyEqual(pyAt(occupation,"points"),pySubtract(pyAt(pyAt(occupation,"budget_adjusted"),"total"),pyAt(pyAt(occupation,"credit_rating"),"value")))),"tests/kernel/test_creation_difficulty.py:129 assert occupation[\"points\"] == occupation[\"budget_adjusted\"][\"total\"] - occupation[\"credit_rating\"][\"value\"]");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(occupation,"spent"),pyAt(occupation,"unspent")),pyAt(occupation,"points"))),"tests/kernel/test_creation_difficulty.py:130 assert occupation[\"spent\"] + occupation[\"unspent\"] == occupation[\"points\"]");
let bases:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [name,amount] of pyIterable((await pyMethod(pyAt(occupation,"allocations"),"items",[],{})))){if(pyBool(true))__rows.push([name,pySubtract(pyAt(pyAt(card,"skills"),name),amount)]);}return __rows;})()));
for(const [name,amount] of pyIterable((await pyMethod(pyAt(occupation,"allocations"),"items",[],{})))){
assert.ok(pyBool(pyLessEqual(pyAdd(pyAt(bases,name),amount),60)),"tests/kernel/test_creation_difficulty.py:133 assert bases[name] + amount <= 60");
}
let interest:any=pyAt(skills,"interest");
assert.ok(pyBool(pyEqual(pyAt(interest,"budget_adjusted"),({["total"]:(await jsround(pyMultiply(pyAt(pyAt(interest,"budget"),"total"),0.75))),["multiplier"]:0.75,["fixed"]:null}))),"tests/kernel/test_creation_difficulty.py:135 assert interest[\"budget_adjusted\"] == {\"total\": jsround(interest[\"budget\"][\"total\"] * 0.75),\n                                           \"multiplier\": 0.75, \"fixed\": None}");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(interest,"spent"),pyAt(interest,"unspent")),pyAt(pyAt(interest,"budget_adjusted"),"total"))),"tests/kernel/test_creation_difficulty.py:137 assert interest[\"spent\"] + interest[\"unspent\"] == interest[\"budget_adjusted\"][\"total\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_extreme_preset_thins_budgets_and_lowers_the_cap"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_extreme_preset_thins_budgets_and_lowers_the_cap(await kernel(t,{}));});
export async function test_quick_fire_is_the_rulebook_array_under_every_preset(kernel:any){
let array:any=[80,70,60,60,50,50,50,40];
(await create(kernel,(await preset("hard"))));
let baseline:any=(await investigator(kernel,undefined,undefined,"quick_fire",undefined));
for(const name of pyIterable(["extreme","normal","easy"])){
(await create(kernel,(await preset(name)),name));
let card:any=(await investigator(kernel,name,undefined,"quick_fire",undefined));
let generation:any=pyAt(pyAt(card,"creation"),"characteristics");
assert.ok(pyBool(pyEqual(pyAt(generation,"array"),array)),pyStr("the rulebook source array is recorded unscaled"));
assert.ok(pyBool(!pyContains(generation,"scaling")),"tests/kernel/test_creation_difficulty.py:149 assert \"scaling\" not in generation");
assert.ok(pyBool(pyEqual(pyAt(generation,"values"),pyAt(pyAt(pyAt(baseline,"creation"),"characteristics"),"values"))),"tests/kernel/test_creation_difficulty.py:150 assert generation[\"values\"] == baseline[\"creation\"][\"characteristics\"][\"values\"]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_quick_fire_is_the_rulebook_array_under_every_preset"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_quick_fire_is_the_rulebook_array_under_every_preset(await kernel(t,{}));});

export async function test_custom_pool_dice_replacement_rolls_and_bounds_its_own_range(kernel:any){
(await create(kernel,({["mode"]:"custom",["custom"]:({["characteristic_dice"]:({["3D6"]:"1D4+2"})})})));
let card:any=(await investigator(kernel));
let generation:any=pyAt(pyAt(card,"creation"),"characteristics");
assert.ok(pyBool(pyEqual(pyAt(generation,"replaced_dice"),({["3D6"]:"1D4+2"}))),"tests/kernel/test_creation_difficulty.py:160 assert generation[\"replaced_dice\"] == {\"3D6\": \"1D4+2\"}");
for(const abbr of pyIterable(POOL_3D6)){
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(generation,"rolls"),abbr),"dice"),"1D4+2")),"tests/kernel/test_creation_difficulty.py:162 assert generation[\"rolls\"][abbr][\"dice\"] == \"1D4+2\"");
assert.ok(pyBool(pyContains([15,20,25,30],pyAt(pyAt(generation,"values"),abbr))),"tests/kernel/test_creation_difficulty.py:163 assert generation[\"values\"][abbr] in (15, 20, 25, 30)");
}
for(const abbr of pyIterable(POOL_2D6_6)){
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(generation,"rolls"),abbr),"dice"),"2D6+6")),"tests/kernel/test_creation_difficulty.py:165 assert generation[\"rolls\"][abbr][\"dice\"] == \"2D6+6\"");
assert.ok(pyBool((await (async()=>{const __term0=40;const __term1=pyAt(pyAt(generation,"values"),abbr);const __term2=90;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_creation_difficulty.py:166 assert 40 <= generation[\"values\"][abbr] <= 90");
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"creation"),"difficulty"),({["mode"]:"custom",["custom"]:({["characteristic_dice"]:({["3D6"]:"1D4+2"})})}))),"tests/kernel/test_creation_difficulty.py:167 assert card[\"creation\"][\"difficulty\"] == {\"mode\": \"custom\", \"custom\": {\"characteristic_dice\": {\"3D6\": \"1D4+2\"}}}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_custom_pool_dice_replacement_rolls_and_bounds_its_own_range"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_custom_pool_dice_replacement_rolls_and_bounds_its_own_range(await kernel(t,{}));});
export async function test_custom_fixed_luck_rolls_nothing(kernel:any){
(await create(kernel,({["mode"]:"custom",["custom"]:({["luck"]:({["fixed"]:65})})})));
let card:any=(await investigator(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"characteristics"),"LUCK"),65)),"tests/kernel/test_creation_difficulty.py:173 assert card[\"characteristics\"][\"LUCK\"] == 65");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(card,"creation"),"luck"),"value"),65);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(card,"creation"),"luck"),"attempts"),[]):__left})())),"tests/kernel/test_creation_difficulty.py:174 assert card[\"creation\"][\"luck\"][\"value\"] == 65 and card[\"creation\"][\"luck\"][\"attempts\"] == []");
assert.ok(pyBool((pyAt(pyAt(pyAt(card,"creation"),"luck"),"fixed")===true)),"tests/kernel/test_creation_difficulty.py:175 assert card[\"creation\"][\"luck\"][\"fixed\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_custom_fixed_luck_rolls_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_custom_fixed_luck_rolls_nothing(await kernel(t,{}));});
export async function test_custom_luck_dice_replaces_the_roll(kernel:any){
(await create(kernel,({["mode"]:"custom",["custom"]:({["luck"]:({["dice"]:"2D4"})})})));
let card:any=(await investigator(kernel));
let luck:any=pyAt(pyAt(card,"creation"),"luck");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(luck,"dice"),"2D4");return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(luck,"attempts"))){if(pyBool(true))__rows.push((await (async()=>{const __term0=2;const __term1=pyAt(a,"total");const __term2=8;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()));}return __rows;})()))):__left})())),"tests/kernel/test_creation_difficulty.py:182 assert luck[\"dice\"] == \"2D4\" and all(2 <= a[\"total\"] <= 8 for a in luck[\"attempts\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"characteristics"),"LUCK"),pyMultiply((await pyMax((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(luck,"attempts"))){if(pyBool(true))__rows.push(pyAt(a,"total"));}return __rows;})()))),5))),"tests/kernel/test_creation_difficulty.py:183 assert card[\"characteristics\"][\"LUCK\"] == max(a[\"total\"] for a in luck[\"attempts\"]) * 5");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_custom_luck_dice_replaces_the_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_custom_luck_dice_replaces_the_roll(await kernel(t,{}));});
export async function test_custom_budget_multiplier_and_fixed(kernel:any){
(await create(kernel,({["mode"]:"custom",["custom"]:({["occupation_points"]:({["multiplier"]:2}),["interest_points"]:({["fixed"]:50})})})));
let card:any=(await investigator(kernel));
let skills:any=pyAt(pyAt(card,"creation"),"skills");
const __unpack9433=[pyAt(skills,"occupation"),pyAt(skills,"interest")];let occupation:any=__unpack9433[0];let interest:any=__unpack9433[1];
assert.ok(pyBool(pyEqual(pyAt(occupation,"budget_adjusted"),({["total"]:(await jsround(pyMultiply(pyAt(pyAt(occupation,"budget"),"total"),2))),["multiplier"]:2,["fixed"]:null}))),"tests/kernel/test_creation_difficulty.py:191 assert occupation[\"budget_adjusted\"] == {\"total\": jsround(occupation[\"budget\"][\"total\"] * 2), \"multiplier\": 2, \"fixed\": None}");
assert.ok(pyBool(pyEqual(pyAt(occupation,"points"),pySubtract(pyAt(pyAt(occupation,"budget_adjusted"),"total"),pyAt(pyAt(occupation,"credit_rating"),"value")))),"tests/kernel/test_creation_difficulty.py:192 assert occupation[\"points\"] == occupation[\"budget_adjusted\"][\"total\"] - occupation[\"credit_rating\"][\"value\"]");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(occupation,"spent"),pyAt(occupation,"unspent")),pyAt(occupation,"points"))),"tests/kernel/test_creation_difficulty.py:193 assert occupation[\"spent\"] + occupation[\"unspent\"] == occupation[\"points\"]");
assert.ok(pyBool(pyEqual(pyAt(interest,"budget_adjusted"),({["total"]:50,["multiplier"]:null,["fixed"]:50}))),"tests/kernel/test_creation_difficulty.py:194 assert interest[\"budget_adjusted\"] == {\"total\": 50, \"multiplier\": None, \"fixed\": 50}");
assert.ok(pyBool(pyEqual(pyAt(interest,"spent"),50)),"tests/kernel/test_creation_difficulty.py:195 assert interest[\"spent\"] == 50");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_custom_budget_multiplier_and_fixed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_custom_budget_multiplier_and_fixed(await kernel(t,{}));});
export async function test_custom_fixed_occupation_budget_ignores_the_formula(kernel:any){
(await create(kernel,({["mode"]:"custom",["custom"]:({["occupation_points"]:({["fixed"]:300})})})));
let card:any=(await investigator(kernel));
let occupation:any=pyAt(pyAt(pyAt(card,"creation"),"skills"),"occupation");
assert.ok(pyBool(pyEqual(pyAt(pyAt(occupation,"budget"),"total"),pyMultiply(pyAt(pyAt(card,"characteristics"),"EDU"),4))),"tests/kernel/test_creation_difficulty.py:202 assert occupation[\"budget\"][\"total\"] == card[\"characteristics\"][\"EDU\"] * 4");
assert.ok(pyBool(pyEqual(pyAt(occupation,"points"),pySubtract(300,pyAt(pyAt(occupation,"credit_rating"),"value")))),"tests/kernel/test_creation_difficulty.py:203 assert occupation[\"points\"] == 300 - occupation[\"credit_rating\"][\"value\"]");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(occupation,"spent"),pyAt(occupation,"unspent")),pyAt(occupation,"points"))),"tests/kernel/test_creation_difficulty.py:204 assert occupation[\"spent\"] + occupation[\"unspent\"] == occupation[\"points\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_custom_fixed_occupation_budget_ignores_the_formula"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_custom_fixed_occupation_budget_ignores_the_formula(await kernel(t,{}));});
export async function test_custom_skill_cap_replaces_75(kernel:any){
(await create(kernel,({["mode"]:"custom",["custom"]:({["skill_cap"]:60})})));
let card:any=(await investigator(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"creation"),"skills"),"cap"),({["value"]:60,["source"]:"skills.guided_creation_policy.starting_skill_cap",["difficulty"]:({["skill_cap"]:60})}))),"tests/kernel/test_creation_difficulty.py:210 assert card[\"creation\"][\"skills\"][\"cap\"] == {\"value\": 60, \"source\": \"skills.guided_creation_policy.starting_skill_cap\",\n                                                 \"difficulty\": {\"skill_cap\": 60}}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_custom_skill_cap_replaces_75"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_custom_skill_cap_replaces_75(await kernel(t,{}));});

export async function test_campaign_create_rejects_bad_difficulty_shapes(kernel:any){
let cases:any=[[({["mode"]:"preset",["preset"]:"impossible"}),"difficulty.preset"],[({["mode"]:"weird"}),"difficulty.mode"],[({["mode"]:"preset",["preset"]:"hard",["custom"]:({["skill_cap"]:60})}),"difficulty.custom"],[({["mode"]:"preset",["preset"]:"hard",["multiplier"]:1}),"difficulty.multiplier"],[({["mode"]:"preset",["preset"]:"hard",["multiplier"]:2}),"difficulty.multiplier"],[({["mode"]:"preset",["preset"]:"hard",["fluff"]:1}),"difficulty.fluff"],[({["mode"]:"custom",["preset"]:"hard"}),"difficulty.preset"],[({["mode"]:"custom",["custom"]:({["bogus"]:1})}),"difficulty.custom.bogus"],[({["mode"]:"custom",["custom"]:({["characteristic_dice"]:({["3d6"]:"2D6"})})}),"difficulty.custom.characteristic_dice"],[({["mode"]:"custom",["custom"]:({["characteristic_dice"]:({["3D6"]:"3D7"})})}),"difficulty.custom.characteristic_dice"],[({["mode"]:"custom",["custom"]:({["luck"]:({["dice"]:"0D6"})})}),"difficulty.custom.luck.dice"],[({["mode"]:"custom",["custom"]:({["luck"]:({["fixed"]:63})})}),"difficulty.custom.luck.fixed"],[({["mode"]:"custom",["custom"]:({["luck"]:({["dice"]:"2D6",["fixed"]:50})})}),"difficulty.custom.luck"],[({["mode"]:"custom",["custom"]:({["occupation_points"]:({["multiplier"]:0.1})})}),"difficulty.custom.occupation_points.multiplier"],[({["mode"]:"custom",["custom"]:({["interest_points"]:({["fixed"]:2001})})}),"difficulty.custom.interest_points.fixed"],[({["mode"]:"custom",["custom"]:({["skill_cap"]:0})}),"difficulty.custom.skill_cap"],[({["mode"]:"custom",["custom"]:({["characteristic_min"]:7})}),"difficulty.custom.characteristic_min"],[({["mode"]:"custom",["custom"]:({["characteristic_min"]:60,["characteristic_max"]:30})}),"difficulty.custom.characteristic_min"],["hard","difficulty"]];
for(const [difficulty,field] of pyIterable(cases)){
let error:any=(await pyMethod(kernel,"err",["campaign.create",({["id"]:CAMPAIGN,["module"]:MODULE,["difficulty"]:difficulty})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr(difficulty));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"field"),field)),pyStr(difficulty));
}
(await create(kernel));
assert.ok(pyBool(pyEqual(pyAt((await investigator(kernel)),"name"),"Ada")),"tests/kernel/test_creation_difficulty.py:245 assert investigator(kernel)[\"name\"] == \"Ada\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_campaign_create_rejects_bad_difficulty_shapes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_campaign_create_rejects_bad_difficulty_shapes(await kernel(t,{}));});

export async function test_snapshot_sheet_and_receipt_records(kernel:any){
let meta:any=(await create(kernel,(await preset("easy"))));
assert.ok(pyBool(pyEqual(pyAt(meta,"difficulty"),({["mode"]:"preset",["preset"]:"easy"}))),"tests/kernel/test_creation_difficulty.py:253 assert meta[\"difficulty\"] == {\"mode\": \"preset\", \"preset\": \"easy\"}");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"difficulty"),pyAt(meta,"difficulty"))),"tests/kernel/test_creation_difficulty.py:254 assert read_json(campaign_dir(kernel.workspace) / \"campaign.json\")[\"difficulty\"] == meta[\"difficulty\"]");
let card:any=(await investigator(kernel));
let record:any=({["mode"]:"preset",["preset"]:"easy",["custom"]:({})});
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"creation"),"difficulty"),record)),"tests/kernel/test_creation_difficulty.py:257 assert card[\"creation\"][\"difficulty\"] == record");
let receipts:any=pyAt(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"setup"),"receipts");
assert.ok(pyBool(pyEqual(pyAt(pyAt(receipts,0),"difficulty"),record)),"tests/kernel/test_creation_difficulty.py:259 assert receipts[0][\"difficulty\"] == record");
assert.ok(pyBool(!pyContains(pyAt(pyAt(card,"creation"),"characteristics"),"scaling")),"tests/kernel/test_creation_difficulty.py:260 assert \"scaling\" not in card[\"creation\"][\"characteristics\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"creation"),"luck"),"dice"),"2D6+6")),"tests/kernel/test_creation_difficulty.py:261 assert card[\"creation\"][\"luck\"][\"dice\"] == \"2D6+6\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_snapshot_sheet_and_receipt_records"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_snapshot_sheet_and_receipt_records(await kernel(t,{}));});

export async function begin_draft(kernel:any,difficulty:any){
(await create(kernel,difficulty));
return (await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile())})],{}));
}
export async function test_draft_limits_obey_the_preset_knobs(kernel:any){
let draft:any=(await begin_draft(kernel,(await preset("normal"))));
const __unpack14427=[pyAt(draft,"sheet"),pyAt(draft,"limits")];let sheet:any=__unpack14427[0];let limits:any=__unpack14427[1];
let record:any=({["mode"]:"preset",["preset"]:"normal",["custom"]:({})});
assert.ok(pyBool(pyEqual(pyAt(pyAt(sheet,"creation"),"difficulty"),record)),"tests/kernel/test_creation_difficulty.py:276 assert sheet[\"creation\"][\"difficulty\"] == record");
let stored:any=(await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts"),`${pyAt(draft,"revision")}.json`)));
assert.ok(pyBool(pyEqual(pyAt(pyAt(stored,"receipt"),"difficulty"),record)),"tests/kernel/test_creation_difficulty.py:278 assert stored[\"receipt\"][\"difficulty\"] == record");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(limits,"characteristic_min"),15);return pyBool(__left)?pyEqual(pyAt(limits,"characteristic_max"),90):__left})())),"tests/kernel/test_creation_difficulty.py:279 assert limits[\"characteristic_min\"] == 15 and limits[\"characteristic_max\"] == 90");
assert.ok(pyBool(pyEqual(pyAt(limits,"skill_cap"),75)),"tests/kernel/test_creation_difficulty.py:280 assert limits[\"skill_cap\"] == 75");
assert.ok(pyBool(pyEqual(pyAt(limits,"occupation_points"),(await jsround(pyMultiply(pyMultiply(pyAt(pyAt(sheet,"characteristics"),"EDU"),4),1.25))))),"tests/kernel/test_creation_difficulty.py:281 assert limits[\"occupation_points\"] == jsround(sheet[\"characteristics\"][\"EDU\"] * 4 * 1.25)");
assert.ok(pyBool(pyEqual(pyAt(limits,"interest_points"),(await jsround(pyMultiply(pyMultiply(pyAt(pyAt(sheet,"characteristics"),"INT"),2),1.25))))),"tests/kernel/test_creation_difficulty.py:282 assert limits[\"interest_points\"] == jsround(sheet[\"characteristics\"][\"INT\"] * 2 * 1.25)");
let relaxed:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({}),["limits_override"]:({["skill_cap"]:200,["characteristic_max"]:200}),["dry_run"]:true})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(relaxed,"limits"),"skill_cap"),200);return pyBool(__left)?pyEqual(pyAt(pyAt(relaxed,"limits"),"characteristic_max"),200):__left})())),"tests/kernel/test_creation_difficulty.py:285 assert relaxed[\"limits\"][\"skill_cap\"] == 200 and relaxed[\"limits\"][\"characteristic_max\"] == 200");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(relaxed,"limits"),"characteristic_min"),15);return pyBool(__left)?pyEqual(pyAt(pyAt(relaxed,"limits"),"overridden"),["characteristic_max","skill_cap"]):__left})())),"tests/kernel/test_creation_difficulty.py:286 assert relaxed[\"limits\"][\"characteristic_min\"] == 15 and relaxed[\"limits\"][\"overridden\"] == [\"characteristic_max\", \"skill_cap\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_draft_limits_obey_the_preset_knobs"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_draft_limits_obey_the_preset_knobs(await kernel(t,{}));});
export async function test_draft_limits_obey_custom_knobs(kernel:any){
let draft:any=(await begin_draft(kernel,({["mode"]:"custom",["custom"]:({["characteristic_min"]:30,["characteristic_max"]:60,["skill_cap"]:80,["interest_points"]:({["fixed"]:40})})})));
let limits:any=pyAt(draft,"limits");
assert.ok(pyBool(pyEqual([pyAt(limits,"characteristic_min"),pyAt(limits,"characteristic_max"),pyAt(limits,"skill_cap")],[30,60,80])),"tests/kernel/test_creation_difficulty.py:293 assert (limits[\"characteristic_min\"], limits[\"characteristic_max\"], limits[\"skill_cap\"]) == (30, 60, 80)");
assert.ok(pyBool(pyEqual(pyAt(limits,"interest_points"),40)),"tests/kernel/test_creation_difficulty.py:294 assert limits[\"interest_points\"] == 40");
assert.ok(pyBool(pyEqual(pyAt(limits,"occupation_points"),pyMultiply(pyAt(pyAt(pyAt(draft,"sheet"),"characteristics"),"EDU"),4))),"tests/kernel/test_creation_difficulty.py:295 assert limits[\"occupation_points\"] == draft[\"sheet\"][\"characteristics\"][\"EDU\"] * 4");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_draft_limits_obey_custom_knobs"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_draft_limits_obey_custom_knobs(await kernel(t,{}));});
export async function test_override_bounds_follow_a_replaced_pool(kernel:any){
let draft:any=(await begin_draft(kernel,({["mode"]:"custom",["custom"]:({["characteristic_dice"]:({["3D6"]:"1D4+2"})})})));
let beyond:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["STR"]:35})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(beyond,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(beyond,"details"),"range"),[15,30]):__left})())),"tests/kernel/test_creation_difficulty.py:302 assert beyond[\"code\"] == \"needs\" and beyond[\"details\"][\"range\"] == [15, 30]");
let within:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["STR"]:30,["SIZ"]:90})}),["dry_run"]:true})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(within,"sheet"),"characteristics"),"STR"),30);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(within,"sheet"),"characteristics"),"SIZ"),90):__left})())),"tests/kernel/test_creation_difficulty.py:305 assert within[\"sheet\"][\"characteristics\"][\"STR\"] == 30 and within[\"sheet\"][\"characteristics\"][\"SIZ\"] == 90");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_override_bounds_follow_a_replaced_pool"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_override_bounds_follow_a_replaced_pool(await kernel(t,{}));});
export async function test_luck_override_keeps_creation_bounds_under_a_replaced_pool(kernel:any){

let draft:any=(await begin_draft(kernel,({["mode"]:"custom",["custom"]:({["characteristic_dice"]:({["3D6"]:"1D4+2"})})})));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["STR"]:35})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"range"),[15,30]):__left})())),"tests/kernel/test_creation_difficulty.py:314 assert error[\"code\"] == \"needs\" and error[\"details\"][\"range\"] == [15, 30]");
for(const value of pyIterable([35,90])){
let within:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["LUCK"]:value})}),["dry_run"]:true})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(within,"sheet"),"characteristics"),"LUCK"),value)),"tests/kernel/test_creation_difficulty.py:319 assert within[\"sheet\"][\"characteristics\"][\"LUCK\"] == value");
}
let beyond:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["LUCK"]:95})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(beyond,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(beyond,"details"),"range"),[15,90]):__left})())),"tests/kernel/test_creation_difficulty.py:322 assert beyond[\"code\"] == \"needs\" and beyond[\"details\"][\"range\"] == [15, 90]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_luck_override_keeps_creation_bounds_under_a_replaced_pool"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_luck_override_keeps_creation_bounds_under_a_replaced_pool(await kernel(t,{}));});
export async function test_a_corrupt_snapshot_fails_loudly_on_the_next_build(kernel:any){

(await create(kernel,(await preset("hard"))));
let path:any=pyDivide((await campaign_dir(kernel.workspace)),"campaign.json");
let meta:any=(await read_json(path));
meta["difficulty"]=({["mode"]:"preset",["preset"]:"banana"});
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[meta],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
let error:any=(await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Ada",["occupation"]:"Antiquarian",["age"]:27,["seed"]:"11"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"difficulty.preset"):__left})())),"tests/kernel/test_creation_difficulty.py:334 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"field\"] == \"difficulty.preset\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_corrupt_snapshot_fails_loudly_on_the_next_build"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_corrupt_snapshot_fails_loudly_on_the_next_build(await kernel(t,{}));});
export async function test_a_described_person_under_a_preset_takes_the_array_and_the_plain_card_keeps_its_dice(seeded_kernel:any){

let plain:any=(await begin_draft(seeded_kernel,(await preset("normal"))));
let stated:any=(await pyMethod(seeded_kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["STR"],["weak"]:["INT"],["origin"]:"player"})})})],{}));
let generation:any=pyAt(pyAt(pyAt(stated,"sheet"),"creation"),"characteristics");
assert.ok(pyBool(pyEqual(pyAt(generation,"method"),"quick_fire")),"tests/kernel/test_creation_difficulty.py:344 assert generation[\"method\"] == \"quick_fire\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(generation,"values"),"STR"),80);return pyBool(__left)?pyEqual(pyAt(pyAt(generation,"values"),"INT"),40):__left})())),"tests/kernel/test_creation_difficulty.py:345 assert generation[\"values\"][\"STR\"] == 80 and generation[\"values\"][\"INT\"] == 40");
assert.ok(pyBool(pyEqual((await pySorted((await pyMethod(pyAt(generation,"values"),"values",[],{})))),(await pySorted(pyAt(generation,"array"))))),"tests/kernel/test_creation_difficulty.py:346 assert sorted(generation[\"values\"].values()) == sorted(generation[\"array\"])");
let cleared:any=(await pyMethod(seeded_kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:null})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(cleared,"sheet"),"creation"),"characteristics"),pyAt(pyAt(pyAt(plain,"sheet"),"creation"),"characteristics"))),"tests/kernel/test_creation_difficulty.py:348 assert cleared[\"sheet\"][\"creation\"][\"characteristics\"] == plain[\"sheet\"][\"creation\"][\"characteristics\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_described_person_under_a_preset_takes_the_array_and_the_plain_card_keeps_its_dice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_described_person_under_a_preset_takes_the_array_and_the_plain_card_keeps_its_dice(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
