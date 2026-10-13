// Migrated from tests/kernel/test_setup_override.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,RpcClient,campaign_dir,read_json,profile,begin,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,pyMin,pyMax,math} from "./setup-native-support.ts";




export async function characteristics_edit(sheet:any,abbr:any,delta:any,ceiling:any=90){

let value:any=pyAt(pyAt(sheet,"characteristics"),abbr);
return ({["characteristics"]:({[abbr]:pyAdd(value,((pyBool(pyLessEqual(pyAdd(value,delta),ceiling))?delta:(-delta))))})});
}
export async function test_draft_carries_the_limits_block_and_the_file_stores_it(kernel:any,tmp_path:any){
let draft:any=(await begin(kernel));
let limits:any=pyAt(draft,"limits");
let sheet:any=pyAt(draft,"sheet");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(limits,"characteristic_min"),15);return pyBool(__left)?pyEqual(pyAt(limits,"characteristic_max"),90):__left})())),"tests/kernel/test_setup_override.py:23 assert limits[\"characteristic_min\"] == 15 and limits[\"characteristic_max\"] == 90");
assert.ok(pyBool(pyEqual(pyAt(limits,"skill_cap"),75)),"tests/kernel/test_setup_override.py:24 assert limits[\"skill_cap\"] == 75");
assert.ok(pyBool(pyEqual(pyAt(pyAt(limits,"occupation_formula"),"formula"),"EDU*4")),"tests/kernel/test_setup_override.py:25 assert limits[\"occupation_formula\"][\"formula\"] == \"EDU*4\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(limits,"occupation_formula"),"total"),pyMultiply(pyAt(pyAt(sheet,"characteristics"),"EDU"),4))),"tests/kernel/test_setup_override.py:26 assert limits[\"occupation_formula\"][\"total\"] == sheet[\"characteristics\"][\"EDU\"] * 4");
assert.ok(pyBool(pyEqual(pyAt(limits,"occupation_points"),pyAt(pyAt(limits,"occupation_formula"),"total"))),"tests/kernel/test_setup_override.py:27 assert limits[\"occupation_points\"] == limits[\"occupation_formula\"][\"total\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(limits,"interest_formula"),"total"),pyMultiply(pyAt(pyAt(sheet,"characteristics"),"INT"),2))),"tests/kernel/test_setup_override.py:28 assert limits[\"interest_formula\"][\"total\"] == sheet[\"characteristics\"][\"INT\"] * 2");
assert.ok(pyBool(pyEqual(pyAt(limits,"interest_points"),pyAt(pyAt(limits,"interest_formula"),"total"))),"tests/kernel/test_setup_override.py:29 assert limits[\"interest_points\"] == limits[\"interest_formula\"][\"total\"]");
assert.ok(pyBool(pyEqual(pyAt(limits,"credit_rating_range"),[9,30])),"tests/kernel/test_setup_override.py:30 assert limits[\"credit_rating_range\"] == [9, 30]");
assert.ok(pyBool(pyEqual(pyAt(limits,"overridden"),[])),"tests/kernel/test_setup_override.py:31 assert limits[\"overridden\"] == []");
let stored:any=(await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts"),`${pyAt(draft,"revision")}.json`)));
assert.ok(pyBool(pyEqual(pyAt(stored,"limits"),limits)),"tests/kernel/test_setup_override.py:33 assert stored[\"limits\"] == limits");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_draft_carries_the_limits_block_and_the_file_stores_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_draft_carries_the_limits_block_and_the_file_stores_it(await kernel(t,{}),temporary);});
export async function test_override_one_characteristic_recomputes_derived_and_resets_currents(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let edits:any=(await characteristics_edit(sheet,"CON",10));
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:edits})],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"revision"),pyAdd(pyAt(draft,"revision"),1))),"tests/kernel/test_setup_override.py:41 assert result[\"revision\"] == draft[\"revision\"] + 1");
let updated:any=pyAt(result,"sheet");
assert.ok(pyBool(pyEqual(pyAt(pyAt(updated,"characteristics"),"CON"),pyAt(pyAt(edits,"characteristics"),"CON"))),"tests/kernel/test_setup_override.py:43 assert updated[\"characteristics\"][\"CON\"] == edits[\"characteristics\"][\"CON\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(updated,"derived"),"HP"),Math.floor((pyAdd(pyAt(pyAt(updated,"characteristics"),"CON"),pyAt(pyAt(updated,"characteristics"),"SIZ")))/10))),"tests/kernel/test_setup_override.py:44 assert updated[\"derived\"][\"HP\"] == (updated[\"characteristics\"][\"CON\"] + updated[\"characteristics\"][\"SIZ\"]) // 10");
assert.ok(pyBool(pyEqual(pyAt(pyAt(updated,"derived"),"SAN"),pyAt(pyAt(updated,"characteristics"),"POW"))),"tests/kernel/test_setup_override.py:45 assert updated[\"derived\"][\"SAN\"] == updated[\"characteristics\"][\"POW\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(updated,"derived"),"MP"),Math.floor(pyAt(pyAt(updated,"characteristics"),"POW")/5))),"tests/kernel/test_setup_override.py:46 assert updated[\"derived\"][\"MP\"] == updated[\"characteristics\"][\"POW\"] // 5");
assert.ok(pyBool(pyEqual(pyAt(updated,"current_hp"),pyAt(pyAt(updated,"derived"),"HP"))),"tests/kernel/test_setup_override.py:47 assert updated[\"current_hp\"] == updated[\"derived\"][\"HP\"]");
assert.ok(pyBool(pyEqual(pyAt(updated,"current_mp"),pyAt(pyAt(updated,"derived"),"MP"))),"tests/kernel/test_setup_override.py:48 assert updated[\"current_mp\"] == updated[\"derived\"][\"MP\"]");
assert.ok(pyBool(pyEqual(pyAt(updated,"current_san"),pyAt(pyAt(updated,"derived"),"SAN"))),"tests/kernel/test_setup_override.py:49 assert updated[\"current_san\"] == updated[\"derived\"][\"SAN\"]");
assert.ok(pyBool(pyEqual(pyAt(updated,"current_luck"),pyAt(pyAt(updated,"characteristics"),"LUCK"))),"tests/kernel/test_setup_override.py:50 assert updated[\"current_luck\"] == updated[\"characteristics\"][\"LUCK\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(updated,"creation"),"pins"),"characteristics"),"CON"),({["value"]:pyAt(pyAt(edits,"characteristics"),"CON"),["by"]:"player"}))),"tests/kernel/test_setup_override.py:51 assert updated[\"creation\"][\"pins\"][\"characteristics\"][\"CON\"] == {\"value\": edits[\"characteristics\"][\"CON\"], \"by\": \"player\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(result,"pins"),"characteristics"),"CON"),"value"),pyAt(pyAt(edits,"characteristics"),"CON"))),"tests/kernel/test_setup_override.py:52 assert result[\"pins\"][\"characteristics\"][\"CON\"][\"value\"] == edits[\"characteristics\"][\"CON\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(updated,"creation"),"method"),pyAt(pyAt(sheet,"creation"),"method"))),"tests/kernel/test_setup_override.py:53 assert updated[\"creation\"][\"method\"] == sheet[\"creation\"][\"method\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(updated,"creation"),"characteristics"),"rolls"),pyAt(pyAt(pyAt(sheet,"creation"),"characteristics"),"rolls"))),pyStr("the dice evidence stays"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(updated,"creation"),"characteristics"),"pinned"),["CON"]);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(updated,"creation"),"characteristics"),"values"),"CON"),pyAt(pyAt(edits,"characteristics"),"CON")):__left})())),"tests/kernel/test_setup_override.py:55 assert updated[\"creation\"][\"characteristics\"][\"pinned\"] == [\"CON\"] and updated[\"creation\"][\"characteristics\"][\"values\"][\"CON\"] == edits[\"characteristics\"][\"CON\"]");
let campaign:any=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(campaign,"setup"),"draft_revision"),pyAt(result,"revision"))),"tests/kernel/test_setup_override.py:57 assert campaign[\"setup\"][\"draft_revision\"] == result[\"revision\"]");
assert.ok(pyBool(((await pyMethod(pyAt(campaign,"setup"),"get",["previewed_revision"],{}))===null)),"tests/kernel/test_setup_override.py:58 assert campaign[\"setup\"].get(\"previewed_revision\") is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_override_one_characteristic_recomputes_derived_and_resets_currents"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_override_one_characteristic_recomputes_derived_and_resets_currents(await kernel(t,{}));});
export async function test_a_dex_change_recomputes_the_dodge_base_and_holds_its_points(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
const __unpack3654=[pyAt(pyAt(sheet,"characteristics"),"DEX"),pyAt(pyAt(sheet,"skills"),"Dodge")];let old_dex:any=__unpack3654[0];let old_dodge:any=__unpack3654[1];
let held:any=pySubtract(old_dodge,Math.floor(old_dex/2));
let new_dex:any=(pyBool(pyLessEqual(old_dex,80))?90:pySubtract(old_dex,10));
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["DEX"]:new_dex})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"sheet"),"skills"),"Dodge"),pyAdd(Math.floor(new_dex/2),held))),"tests/kernel/test_setup_override.py:69 assert result[\"sheet\"][\"skills\"][\"Dodge\"] == new_dex // 2 + held");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_dex_change_recomputes_the_dodge_base_and_holds_its_points"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_dex_change_recomputes_the_dodge_base_and_holds_its_points(await kernel(t,{}));});
export async function occupation_swap(sheet:any,amount:any=5){

let allocations:any=pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation"),"allocations");
let lowered:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const [name,points] of pyIterable((await pyMethod(allocations,"items",[],{})))){if(pyBool(pyLessEqual(amount,points)))__rows.push(name);}return __rows;})())));
let raised:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation"),"resolved"))){if(pyBool((await (async()=>{const __left=!pyEqual(name,lowered);return pyBool(__left)?pyLessEqual(pyAdd(pyAt(pyAt(sheet,"skills"),name),amount),75):__left})())))__rows.push(name);}return __rows;})())));
return ({[lowered]:pySubtract(pyAt(pyAt(sheet,"skills"),lowered),amount),[raised]:pyAdd(pyAt(pyAt(sheet,"skills"),raised),amount)});
}
export async function test_skill_edits_within_the_budget_are_applied(kernel:any){
let draft:any=(await begin(kernel));
let edits:any=({["skills"]:(await occupation_swap(pyAt(draft,"sheet")))});
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:edits})],{}));
for(const [name,value] of pyIterable((await pyMethod(pyAt(edits,"skills"),"items",[],{})))){
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"sheet"),"skills"),name),value)),"tests/kernel/test_setup_override.py:86 assert result[\"sheet\"][\"skills\"][name] == value");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skill_edits_within_the_budget_are_applied"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skill_edits_within_the_budget_are_applied(await kernel(t,{}));});
export async function test_exceeding_a_pool_is_reported_on_the_card_not_refused(kernel:any){

let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let allocations:any=pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation"),"allocations");
let raised:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const [name,points] of pyIterable((await pyMethod(allocations,"items",[],{})))){if(pyBool(pyLessEqual(pyAdd(pyAt(pyAt(sheet,"skills"),name),5),75)))__rows.push(name);}return __rows;})())));
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:({[raised]:pyAdd(pyAt(pyAt(sheet,"skills"),raised),5)})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"sheet"),"skills"),raised),pyAdd(pyAt(pyAt(sheet,"skills"),raised),5))),"tests/kernel/test_setup_override.py:98 assert result[\"sheet\"][\"skills\"][raised] == sheet[\"skills\"][raised] + 5");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(result,"pins"),"skills"),raised),"value"),pyAdd(pyAt(pyAt(sheet,"skills"),raised),5))),"tests/kernel/test_setup_override.py:99 assert result[\"pins\"][\"skills\"][raised][\"value\"] == sheet[\"skills\"][raised] + 5");
let occupation:any=pyAt(pyAt(result,"budget"),"occupation");
assert.ok(pyBool(pyEqual(pyAt(occupation,"total"),pyAt(pyAt(draft,"limits"),"occupation_points"))),"tests/kernel/test_setup_override.py:101 assert occupation[\"total\"] == draft[\"limits\"][\"occupation_points\"]");
assert.ok(pyBool(pyLessEqual(0,pyAt(occupation,"unspent"))),pyStr("the allocator gave way before anything was overspent"));
let others:any=(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(allocations)){if(pyBool(!pyEqual(name,raised)))__rows.push(name);}return __rows;})());
assert.ok(pyBool(pyEqual((await pySum((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(others)){if(pyBool(true))__rows.push(pyAt(pyAt(pyAt(result,"sheet"),"skills"),name));}return __rows;})()))),pySubtract((await pySum((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(others)){if(pyBool(true))__rows.push(pyAt(pyAt(sheet,"skills"),name));}return __rows;})()))),5))),"tests/kernel/test_setup_override.py:104 assert sum(result[\"sheet\"][\"skills\"][name] for name in others) == sum(sheet[\"skills\"][name] for name in others) - 5");
let campaign:any=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(campaign,"setup"),"draft_revision"),pyAt(result,"revision"))),"tests/kernel/test_setup_override.py:106 assert campaign[\"setup\"][\"draft_revision\"] == result[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_exceeding_a_pool_is_reported_on_the_card_not_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_exceeding_a_pool_is_reported_on_the_card_not_refused(await kernel(t,{}));});
export async function test_overspending_past_every_soft_point_is_a_non_standard_card(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let interest:any=pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"interest"),"allocations");
let pins:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(interest)){if(pyBool(true))__rows.push([name,75]);}return __rows;})()));
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:pins})})],{}));
for(const name of pyIterable(interest)){
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"sheet"),"skills"),name),75)),"tests/kernel/test_setup_override.py:116 assert result[\"sheet\"][\"skills\"][name] == 75");
}
assert.ok(pyBool((await (async()=>{const __left=pyLess(pyAt(pyAt(pyAt(result,"budget"),"interest"),"unspent"),0);return pyBool(__left)?__left:pyEqual(pyAt(pyAt(pyAt(result,"budget"),"interest"),"unspent"),0)})())),"tests/kernel/test_setup_override.py:117 assert result[\"budget\"][\"interest\"][\"unspent\"] < 0 or result[\"budget\"][\"interest\"][\"unspent\"] == 0");
assert.ok(pyBool(pyAt(pyAt(result,"completeness"),"valid")),pyStr("an overspent card is confirmable; it is only not standard"));
if(pyBool(pyLess(pyAt(pyAt(pyAt(result,"budget"),"interest"),"unspent"),0))){assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(result,"budget"),"legal")===false);return pyBool(__left)?(await pyAny((await (async()=>{const __rows:any[]=[];for(const note of pyIterable(pyAt(pyAt(result,"budget"),"notes"))){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(note,"code"),"overspent");return pyBool(__left)?pyEqual(pyAt(note,"pool"),"interest"):__left})()));}return __rows;})()))):__left})())),"tests/kernel/test_setup_override.py:120 assert result[\"budget\"][\"legal\"] is False and any(note[\"code\"] == \"overspent\" and note[\"pool\"] == \"interest\" for note in result[\"budget\"][\"notes\"])");}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_overspending_past_every_soft_point_is_a_non_standard_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_overspending_past_every_soft_point_is_a_non_standard_card(await kernel(t,{}));});
export async function test_a_stale_revision_conflicts(kernel:any){
let draft:any=(await begin(kernel));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAdd(pyAt(draft,"revision"),9),["edits"]:({["credit_rating"]:20})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"idempotency_conflict");return pyBool(__left)?pyEqual(pyAt(error,"code_detail"),"stale_draft"):__left})())),"tests/kernel/test_setup_override.py:127 assert error[\"code\"] == \"idempotency_conflict\" and error[\"code_detail\"] == \"stale_draft\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_stale_revision_conflicts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_stale_revision_conflicts(await kernel(t,{}));});
export async function test_unknown_edit_fields_are_invalid_and_list_the_legal_fields(kernel:any){
let draft:any=(await begin(kernel));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["hit_points"]:20})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_setup_override.py:133 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"fields"),["characteristics","credit_rating","skills"])),"tests/kernel/test_setup_override.py:134 assert error[\"details\"][\"fields\"] == [\"characteristics\", \"credit_rating\", \"skills\"]");
error=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["Strength"]:80})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_setup_override.py:137 assert error[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_edit_fields_are_invalid_and_list_the_legal_fields"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_edit_fields_are_invalid_and_list_the_legal_fields(await kernel(t,{}));});
export async function test_skill_edits_below_the_base_and_above_the_cap_are_refused(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let allocations:any=pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation"),"allocations");
let name:any=(await pyNext((await pyList(allocations))));
let base:any=pySubtract(pyAt(pyAt(sheet,"skills"),name),pyAt(allocations,name));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:({[name]:pySubtract(base,1)})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),name):__left})())),"tests/kernel/test_setup_override.py:148 assert error[\"code\"] == \"needs\" and error[\"details\"][\"field\"] == name");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(error,"details"),"range"),[base,75]);return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"attempted"),pySubtract(base,1)):__left})())),"tests/kernel/test_setup_override.py:149 assert error[\"details\"][\"range\"] == [base, 75] and error[\"details\"][\"attempted\"] == base - 1");
error=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:({[name]:76})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"range"),[base,75]):__left})())),"tests/kernel/test_setup_override.py:152 assert error[\"code\"] == \"needs\" and error[\"details\"][\"range\"] == [base, 75]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skill_edits_below_the_base_and_above_the_cap_are_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skill_edits_below_the_base_and_above_the_cap_are_refused(await kernel(t,{}));});
export async function test_cthulhu_mythos_and_credit_rating_are_not_skill_edits(kernel:any){
let draft:any=(await begin(kernel));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:({["Cthulhu Mythos"]:10})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_override.py:159 assert error[\"code\"] == \"needs\"");
error=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:({["Credit Rating"]:20})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_setup_override.py:162 assert error[\"code\"] == \"invalid_params\"");
error=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["skills"]:({["Astrology"]:20})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"Astrology"):__left})())),"tests/kernel/test_setup_override.py:165 assert error[\"code\"] == \"needs\" and error[\"details\"][\"field\"] == \"Astrology\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cthulhu_mythos_and_credit_rating_are_not_skill_edits"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cthulhu_mythos_and_credit_rating_are_not_skill_edits(await kernel(t,{}));});
export async function test_credit_rating_stays_within_the_occupation_range(kernel:any){
let draft:any=(await begin(kernel));
for(const bad of pyIterable([8,31])){
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["credit_rating"]:bad})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_override.py:173 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(error,"details"),"field"),"credit_rating");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"range"),[9,30]):__left})())),"tests/kernel/test_setup_override.py:174 assert error[\"details\"][\"field\"] == \"credit_rating\" and error[\"details\"][\"range\"] == [9, 30]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_credit_rating_stays_within_the_occupation_range"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_credit_rating_stays_within_the_occupation_range(await kernel(t,{}));});
export async function test_a_characteristic_above_the_default_bound_needs_an_unlock(kernel:any){
let draft:any=(await begin(kernel));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["STR"]:95})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"range"),[15,90]):__left})())),"tests/kernel/test_setup_override.py:181 assert error[\"code\"] == \"needs\" and error[\"details\"][\"range\"] == [15, 90]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_characteristic_above_the_default_bound_needs_an_unlock"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_characteristic_above_the_default_bound_needs_an_unlock(await kernel(t,{}));});
export async function test_a_limits_override_unlocks_and_persists_into_later_overrides(kernel:any){
let draft:any=(await begin(kernel));
let unlocked:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["STR"]:95})}),["limits_override"]:({["characteristic_max"]:99})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(unlocked,"sheet"),"characteristics"),"STR"),95)),"tests/kernel/test_setup_override.py:189 assert unlocked[\"sheet\"][\"characteristics\"][\"STR\"] == 95");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(unlocked,"limits"),"characteristic_max"),99);return pyBool(__left)?pyEqual(pyAt(pyAt(unlocked,"limits"),"overridden"),["characteristic_max"]):__left})())),"tests/kernel/test_setup_override.py:190 assert unlocked[\"limits\"][\"characteristic_max\"] == 99 and unlocked[\"limits\"][\"overridden\"] == [\"characteristic_max\"]");
let stored:any=(await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts"),`${pyAt(unlocked,"revision")}.json`)));
assert.ok(pyBool(pyEqual(pyAt(stored,"limits_override"),({["characteristic_max"]:99}))),"tests/kernel/test_setup_override.py:192 assert stored[\"limits_override\"] == {\"characteristic_max\": 99}");
let later:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(unlocked,"revision"),["edits"]:({["characteristics"]:({["CON"]:92})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(later,"sheet"),"characteristics"),"CON"),92)),pyStr("the unlock survived without being carried again"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(later,"limits"),"characteristic_max"),99);return pyBool(__left)?pyEqual(pyAt(pyAt(later,"limits"),"overridden"),["characteristic_max"]):__left})())),"tests/kernel/test_setup_override.py:196 assert later[\"limits\"][\"characteristic_max\"] == 99 and later[\"limits\"][\"overridden\"] == [\"characteristic_max\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_limits_override_unlocks_and_persists_into_later_overrides"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_limits_override_unlocks_and_persists_into_later_overrides(await kernel(t,{}));});
export async function test_dry_run_returns_the_would_be_result_and_writes_nothing(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(sheet,"CON",10)),["dry_run"]:true})],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"revision"),pyAdd(pyAt(draft,"revision"),1))),"tests/kernel/test_setup_override.py:204 assert result[\"revision\"] == draft[\"revision\"] + 1");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(pyAt(result,"sheet"),"derived"),"HP"),pyAt(pyAt(sheet,"derived"),"HP"))),"tests/kernel/test_setup_override.py:205 assert result[\"sheet\"][\"derived\"][\"HP\"] != sheet[\"derived\"][\"HP\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"limits"),"occupation_points"),pyMultiply(pyAt(pyAt(pyAt(result,"sheet"),"characteristics"),"EDU"),4))),"tests/kernel/test_setup_override.py:206 assert result[\"limits\"][\"occupation_points\"] == result[\"sheet\"][\"characteristics\"][\"EDU\"] * 4");
let campaign:any=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(campaign,"setup"),"draft_revision"),pyAt(draft,"revision"))),"tests/kernel/test_setup_override.py:208 assert campaign[\"setup\"][\"draft_revision\"] == draft[\"revision\"]");
let drafts:any=(await pyList((await pyMethod((pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts")),"glob",["*.json"],{}))));
assert.ok(pyBool(pyEqual((await pyLen(drafts)),1)),"tests/kernel/test_setup_override.py:210 assert len(drafts) == 1");
let applied:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(sheet,"CON",10))})],{}));
assert.ok(pyBool(pyEqual(pyAt(applied,"sheet"),pyAt(result,"sheet"))),pyStr("the dry run previewed exactly what the real call wrote"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_dry_run_returns_the_would_be_result_and_writes_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_dry_run_returns_the_would_be_result_and_writes_nothing(await kernel(t,{}));});
export async function test_an_identical_profile_reuses_the_overridden_draft(kernel:any){
let draft:any=(await begin(kernel));
let overridden:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(pyAt(draft,"sheet"),"CON",10))})],{}));
let repeated:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile())})],{}));
assert.ok(pyBool(pyEqual(pyAt(repeated,"revision"),pyAt(overridden,"revision"))),"tests/kernel/test_setup_override.py:221 assert repeated[\"revision\"] == overridden[\"revision\"]");
assert.ok(pyBool(pyEqual(pyAt(repeated,"sheet"),pyAt(overridden,"sheet"))),pyStr("no re-roll, the manual numbers stand"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_identical_profile_reuses_the_overridden_draft"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_identical_profile_reuses_the_overridden_draft(await kernel(t,{}));});
export async function test_confirm_without_a_revision_commits_the_current_overridden_draft(kernel:any){
let draft:any=(await begin(kernel));
let overridden:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(pyAt(draft,"sheet"),"CON",10))})],{}));
let stale:any=(await pyMethod(kernel,"err",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated"})],{}));
assert.ok(pyBool(pyEqual(pyAt(stale,"code_detail"),"stale_draft")),"tests/kernel/test_setup_override.py:230 assert stale[\"code_detail\"] == \"stale_draft\"");
let committed:any=(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["consent"]:"delegated"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(committed,"committed");return pyBool(__left)?pyEqual(pyAt(committed,"sheet"),pyAt(overridden,"sheet")):__left})())),"tests/kernel/test_setup_override.py:232 assert committed[\"committed\"] and committed[\"sheet\"] == overridden[\"sheet\"]");
let card:any=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"investigator.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"characteristics"),"CON"),pyAt(pyAt(pyAt(overridden,"sheet"),"characteristics"),"CON"))),"tests/kernel/test_setup_override.py:234 assert card[\"characteristics\"][\"CON\"] == overridden[\"sheet\"][\"characteristics\"][\"CON\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_confirm_without_a_revision_commits_the_current_overridden_draft"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_confirm_without_a_revision_commits_the_current_overridden_draft(await kernel(t,{}));});
export async function test_override_is_refused_between_confirmation_and_handoff(kernel:any){
let draft:any=(await begin(kernel));
(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated"})],{}));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(pyAt(draft,"sheet"),"CON",10))})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_setup_override.py:242 assert error[\"code\"] == \"campaign_not_ready\"");
let meta:any=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(meta,"setup"),"draft_revision"),pyAt(draft,"revision"))),pyStr("the confirmed draft stays current"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_override_is_refused_between_confirmation_and_handoff"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_override_is_refused_between_confirmation_and_handoff(await kernel(t,{}));});
export async function test_override_is_refused_once_the_campaign_left_setting_up(kernel:any){
let draft:any=(await begin(kernel));
(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{})),"status"),"ready_for_table")),"tests/kernel/test_setup_override.py:250 assert kernel.ok(\"setup.complete\", {\"campaign\": CAMPAIGN})[\"status\"] == \"ready_for_table\"");
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(pyAt(draft,"sheet"),"CON",10))})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_setup_override.py:253 assert error[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_override_is_refused_once_the_campaign_left_setting_up"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_override_is_refused_once_the_campaign_left_setting_up(await kernel(t,{}));});
export async function test_the_allocation_ledger_is_rewritten_to_the_manual_numbers(tmp_path:any){

let kernel:any=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await _ledger_case(kernel));}finally{(await pyMethod(kernel,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_allocation_ledger_is_rewritten_to_the_manual_numbers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_allocation_ledger_is_rewritten_to_the_manual_numbers(temporary);});
export async function _ledger_case(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let edu:any=pyAt(pyAt(sheet,"characteristics"),"EDU");
assert.ok(pyBool(pyLessEqual(edu,85)),pyStr("the pinned seed must leave room to raise EDU"));
let new_edu:any=90;
let held_library:any=pySubtract(pyAt(pyAt(sheet,"skills"),"Library Use"),20);
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["EDU"]:new_edu}),["skills"]:({["Library Use"]:pyAdd(pyAt(pyAt(sheet,"skills"),"Library Use"),5)})})})],{}));
let updated:any=pyAt(result,"sheet");
let ledger:any=pyAt(pyAt(pyAt(updated,"creation"),"skills"),"occupation");
assert.ok(pyBool(pyEqual(pyAt(pyAt(ledger,"budget"),"total"),pyMultiply(new_edu,4))),pyStr("the budget is evaluated on the new characteristics"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(ledger,"allocations"),"Library Use"),pyAdd(held_library,5))),"tests/kernel/test_setup_override.py:284 assert ledger[\"allocations\"][\"Library Use\"] == held_library + 5");
assert.ok(pyBool(pyEqual(pyAt(pyAt(updated,"skills"),"Library Use"),pyAdd(pyAdd(20,held_library),5))),"tests/kernel/test_setup_override.py:285 assert updated[\"skills\"][\"Library Use\"] == 20 + held_library + 5");
assert.ok(pyBool(pyEqual((await pySum((await pyMethod(pyAt(ledger,"allocations"),"values",[],{})))),pyAt(ledger,"spent"))),"tests/kernel/test_setup_override.py:286 assert sum(ledger[\"allocations\"].values()) == ledger[\"spent\"]");
assert.ok(pyBool(pyEqual(pyAt(ledger,"points"),pySubtract(pyAt(pyAt(ledger,"budget"),"total"),pyAt(updated,"credit_rating")))),"tests/kernel/test_setup_override.py:287 assert ledger[\"points\"] == ledger[\"budget\"][\"total\"] - updated[\"credit_rating\"]");
assert.ok(pyBool(pyEqual(pyAt(ledger,"unspent"),pySubtract(pyAt(ledger,"points"),pyAt(ledger,"spent")))),"tests/kernel/test_setup_override.py:288 assert ledger[\"unspent\"] == ledger[\"points\"] - ledger[\"spent\"]");
let interest:any=pyAt(pyAt(pyAt(updated,"creation"),"skills"),"interest");
assert.ok(pyBool(pyEqual(pyAt(pyAt(interest,"budget"),"total"),pyMultiply(pyAt(pyAt(updated,"characteristics"),"INT"),2))),"tests/kernel/test_setup_override.py:290 assert interest[\"budget\"][\"total\"] == updated[\"characteristics\"][\"INT\"] * 2");
assert.ok(pyBool(pyEqual((await pySum((await pyMethod(pyAt(interest,"allocations"),"values",[],{})))),pyAt(interest,"spent"))),"tests/kernel/test_setup_override.py:291 assert sum(interest[\"allocations\"].values()) == interest[\"spent\"]");
assert.ok(pyBool(pyEqual(pyAt(interest,"unspent"),pySubtract(pyAt(pyAt(interest,"budget"),"total"),pyAt(interest,"spent")))),"tests/kernel/test_setup_override.py:292 assert interest[\"unspent\"] == interest[\"budget\"][\"total\"] - interest[\"spent\"]");
}
export async function test_a_credit_rating_edit_recomputes_wealth_and_charges_the_occupation_pool(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let new_credit:any=pyAt(pyAt(pyAt(draft,"limits"),"credit_rating_range"),1);
assert.ok(pyBool(!pyEqual(new_credit,pyAt(sheet,"credit_rating"))),"tests/kernel/test_setup_override.py:299 assert new_credit != sheet[\"credit_rating\"]");
let result:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["credit_rating"]:new_credit}),["limits_override"]:({["occupation_points"]:pyAdd(pyAt(pyAt(draft,"limits"),"occupation_points"),30)})})],{}));
let updated:any=pyAt(result,"sheet");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(updated,"credit_rating"),new_credit);return pyBool(__left)?pyEqual(pyAt(pyAt(updated,"skills"),"Credit Rating"),new_credit):__left})())),"tests/kernel/test_setup_override.py:304 assert updated[\"credit_rating\"] == new_credit and updated[\"skills\"][\"Credit Rating\"] == new_credit");
let ledger:any=pyAt(pyAt(pyAt(updated,"creation"),"skills"),"occupation");
assert.ok(pyBool(pyEqual(pyAt(pyAt(ledger,"credit_rating"),"value"),new_credit)),"tests/kernel/test_setup_override.py:306 assert ledger[\"credit_rating\"][\"value\"] == new_credit");
assert.ok(pyBool(pyEqual(pyAt(ledger,"points"),pySubtract(pyAt(pyAt(ledger,"budget"),"total"),new_credit))),"tests/kernel/test_setup_override.py:307 assert ledger[\"points\"] == ledger[\"budget\"][\"total\"] - new_credit");
assert.ok(pyBool(pyEqual(pyAt(ledger,"unspent"),pySubtract(pyAt(ledger,"points"),pyAt(ledger,"spent")))),"tests/kernel/test_setup_override.py:308 assert ledger[\"unspent\"] == ledger[\"points\"] - ledger[\"spent\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyEqual(pyAt(updated,"finance"),pyAt(sheet,"finance"));return pyBool(__left)?!pyEqual(pyAt(updated,"cash"),pyAt(sheet,"cash")):__left})())),pyStr("the wealth line follows the rating instead of lagging the rolled value"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_credit_rating_edit_recomputes_wealth_and_charges_the_occupation_pool"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_credit_rating_edit_recomputes_wealth_and_charges_the_occupation_pool(await kernel(t,{}));});
export async function test_unlocking_a_pool_budget_raises_the_total_the_ledger_shows(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let occupation:any=pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation");
let target:any=(await pyMin((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(occupation,"resolved"))){if(pyBool(!pyEqual(name,"Credit Rating")))__rows.push(name);}return __rows;})()),({"key":async (name:any)=>pyAt(pyAt(sheet,"skills"),name)})));
let edit:any=({["skills"]:({[target]:pyAdd(pyAt(pyAt(sheet,"skills"),target),5)})});
let unlocked:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:edit,["limits_override"]:({["occupation_points"]:pyAdd(pyAt(pyAt(occupation,"budget"),"total"),10)})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(unlocked,"limits"),"overridden"),["occupation_points"])),"tests/kernel/test_setup_override.py:322 assert unlocked[\"limits\"][\"overridden\"] == [\"occupation_points\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(unlocked,"limits"),"occupation_points"),pyAdd(pyAt(pyAt(occupation,"budget"),"total"),10))),"tests/kernel/test_setup_override.py:323 assert unlocked[\"limits\"][\"occupation_points\"] == occupation[\"budget\"][\"total\"] + 10");
let ledger:any=pyAt(pyAt(pyAt(pyAt(unlocked,"sheet"),"creation"),"skills"),"occupation");
assert.ok(pyBool(pyEqual(pyAt(pyAt(ledger,"budget"),"total"),pyAdd(pyAt(pyAt(occupation,"budget"),"total"),10))),pyStr("the ledger shows the budget in force"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(unlocked,"budget"),"occupation"),"total"),pyAdd(pyAt(pyAt(occupation,"budget"),"total"),10))),"tests/kernel/test_setup_override.py:326 assert unlocked[\"budget\"][\"occupation\"][\"total\"] == occupation[\"budget\"][\"total\"] + 10");
assert.ok(pyBool((pyAt(pyAt(unlocked,"budget"),"legal")===false)),pyStr("a relaxed bound is a non-standard card"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unlocking_a_pool_budget_raises_the_total_the_ledger_shows"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unlocking_a_pool_budget_raises_the_total_the_ledger_shows(await kernel(t,{}));});
export async function test_unknown_limits_override_keys_are_invalid_params(kernel:any){
let draft:any=(await begin(kernel));
let error:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(pyAt(draft,"sheet"),"CON",5)),["limits_override"]:({["sanity_cap"]:99})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_setup_override.py:335 assert error[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_limits_override_keys_are_invalid_params"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_limits_override_keys_are_invalid_params(await kernel(t,{}));});
export async function swap(sheet:any,pool:any="occupation",points:any=10){

let allocations:any=pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),pool),"allocations");
let donor:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const [name,spent] of pyIterable((await pySorted((await pyMethod(allocations,"items",[],{})))))){if(pyBool(pyLessEqual(points,spent)))__rows.push(name);}return __rows;})())));
let target:any=(await pyMin((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(allocations)){if(pyBool(!pyEqual(name,donor)))__rows.push(name);}return __rows;})()),({"key":async (name:any)=>pyAt(pyAt(sheet,"skills"),name)})));
return ({["skills"]:({[donor]:pySubtract(pyAt(pyAt(sheet,"skills"),donor),points),[target]:pyAdd(pyAt(pyAt(sheet,"skills"),target),points)})});
}
export async function test_a_pin_survives_a_re_draft_that_changes_the_age(kernel:any){

let draft:any=(await begin(kernel));
let edits:any=(await characteristics_edit(pyAt(draft,"sheet"),"CON",10));
let pinned:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:edits})],{}));
let aged:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["age"]:45})})],{}));
assert.ok(pyBool(pyEqual(pyAt(aged,"revision"),pyAdd(pyAt(pinned,"revision"),1))),"tests/kernel/test_setup_override.py:358 assert aged[\"revision\"] == pinned[\"revision\"] + 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(aged,"sheet"),"characteristics"),"CON"),pyAt(pyAt(edits,"characteristics"),"CON"))),"tests/kernel/test_setup_override.py:359 assert aged[\"sheet\"][\"characteristics\"][\"CON\"] == edits[\"characteristics\"][\"CON\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(aged,"pins"),"characteristics"),"CON"),({["value"]:pyAt(pyAt(edits,"characteristics"),"CON"),["by"]:"player"}))),"tests/kernel/test_setup_override.py:360 assert aged[\"pins\"][\"characteristics\"][\"CON\"] == {\"value\": edits[\"characteristics\"][\"CON\"], \"by\": \"player\"}");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(pyAt(aged,"sheet"),"creation"),"manual");return pyBool(__left)?!pyContains(aged,"manual"):__left})())),"tests/kernel/test_setup_override.py:361 assert \"manual\" not in aged[\"sheet\"][\"creation\"] and \"manual\" not in aged");
let committed:any=(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["consent"]:"approved"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(committed,"sheet"),"characteristics"),"CON"),pyAt(pyAt(edits,"characteristics"),"CON"))),"tests/kernel/test_setup_override.py:363 assert committed[\"sheet\"][\"characteristics\"][\"CON\"] == edits[\"characteristics\"][\"CON\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_survives_a_re_draft_that_changes_the_age"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_survives_a_re_draft_that_changes_the_age(await kernel(t,{}));});
export async function test_a_pin_stored_without_columns_keeps_its_value_and_takes_an_edit(kernel:any){

let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let base:any=Math.floor(pyAt(pyAt(sheet,"characteristics"),"DEX")/2);
let path:any=pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts"),`${pyAt(draft,"revision")}.json`);
let stored:any=(await read_json(path));
pyAt(stored,"pins")["skills"]=({["Dodge"]:({["value"]:pyAdd(base,20),["by"]:"model"})});
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[stored],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
let carried:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:(await characteristics_edit(sheet,"CON",10))})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(carried,"sheet"),"skills"),"Dodge"),pyAdd(base,20))),"tests/kernel/test_setup_override.py:380 assert carried[\"sheet\"][\"skills\"][\"Dodge\"] == base + 20");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(carried,"pins"),"skills"),"Dodge"),({["by"]:"model",["occupation"]:0,["interest"]:20,["value"]:pyAdd(base,20)}))),"tests/kernel/test_setup_override.py:381 assert carried[\"pins\"][\"skills\"][\"Dodge\"] == {\"by\": \"model\", \"occupation\": 0, \"interest\": 20, \"value\": base + 20}");
let edited:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(carried,"revision"),["edits"]:({["skills"]:({["Dodge"]:({["interest"]:30})})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(edited,"sheet"),"skills"),"Dodge"),pyAdd(base,30))),"tests/kernel/test_setup_override.py:383 assert edited[\"sheet\"][\"skills\"][\"Dodge\"] == base + 30");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(edited,"pins"),"skills"),"Dodge"),({["by"]:"player",["occupation"]:0,["interest"]:30,["value"]:pyAdd(base,30)}))),"tests/kernel/test_setup_override.py:384 assert edited[\"pins\"][\"skills\"][\"Dodge\"] == {\"by\": \"player\", \"occupation\": 0, \"interest\": 30, \"value\": base + 30}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts"),`${pyAt(edited,"revision")}.json`))),"pins"),"skills"),"Dodge"),"interest"),30)),"tests/kernel/test_setup_override.py:385 assert read_json(campaign_dir(kernel.workspace) / \"setup\" / \"drafts\" / f\"{edited['revision']}.json\")[\"pins\"][\"skills\"][\"Dodge\"][\"interest\"] == 30");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_stored_without_columns_keeps_its_value_and_takes_an_edit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_stored_without_columns_keeps_its_value_and_takes_an_edit(await kernel(t,{}));});
