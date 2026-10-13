// Migrated from tests/kernel/test_setup_card.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,RpcClient,campaign_dir,read_json,profile,begin,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,pyMin,pyMax,math} from "./setup-native-support.ts";




export let TABLE_ORDER:any=["STR","CON","SIZ","DEX","APP","INT","POW","EDU"];
export async function criminal(){
let semantic:any=(await profile());
(await pyMethod(semantic,"update",[({["name"]:"龙薇",["occupation"]:"Criminal",["age"]:26,["sex"]:"女",["own_language"]:"中文",["occupation_skills"]:["Fighting (Brawl)","Firearms (Handgun)","Stealth","Drive Auto","Disguise","Psychology","Spot Hidden","Sleight of Hand"],["interest_skills"]:["Dodge","Throw","Climb"]})],{}));
return semantic;
}
export async function draft(kernel:any,semantic:any,extra:any={}){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
return (await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:semantic,...extra})],{}));
}
export async function current(kernel:any){
return pyAt(pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"state"),"draft");
}

export async function test_a_described_person_takes_the_quick_fire_array_in_priority_order(kernel:any){

let semantic:any=(await criminal());
semantic["aptitude"]=({["strong"]:["DEX","APP","STR","CON"],["weak"]:[],["origin"]:"player"});
let card:any=(await draft(kernel,semantic));
let generated:any=pyAt(pyAt(pyAt(card,"sheet"),"creation"),"characteristics");
assert.ok(pyBool(pyEqual(pyAt(generated,"method"),"quick_fire")),"tests/kernel/test_setup_card.py:39 assert generated[\"method\"] == \"quick_fire\"");
let values:any=pyAt(generated,"values");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(values,"DEX"),80);return pyBool(__left)?pyEqual(pyAt(values,"APP"),70):__left})());return pyBool(__left)?pyEqual(pyAt(values,"STR"),60):__left})());return pyBool(__left)?pyEqual(pyAt(values,"CON"),60):__left})())),"tests/kernel/test_setup_card.py:41 assert values[\"DEX\"] == 80 and values[\"APP\"] == 70 and values[\"STR\"] == 60 and values[\"CON\"] == 60");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(["SIZ","INT","POW","EDU"])){if(pyBool(true))__rows.push(pyAt(values,a));}return __rows;})()),[50,50,50,40])),pyStr("the rest take the middle of the array in table order"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"DEX"),80);return pyBool(__left)?pyLessEqual(70,pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"APP")):__left})())),"tests/kernel/test_setup_card.py:43 assert card[\"sheet\"][\"characteristics\"][\"DEX\"] == 80 and card[\"sheet\"][\"characteristics\"][\"APP\"] >= 70");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"generation"),"method"),"quick_fire")),"tests/kernel/test_setup_card.py:44 assert card[\"generation\"][\"method\"] == \"quick_fire\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_described_person_takes_the_quick_fire_array_in_priority_order"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_described_person_takes_the_quick_fire_array_in_priority_order(await kernel(t,{}));});
export async function test_a_weak_characteristic_takes_the_bottom_of_the_array(kernel:any){
let semantic:any=(await criminal());
semantic["aptitude"]=({["strong"]:["INT"],["weak"]:["STR"],["origin"]:"player"});
let values:any=pyAt(pyAt(pyAt(pyAt((await draft(kernel,semantic)),"sheet"),"creation"),"characteristics"),"values");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(values,"INT"),80);return pyBool(__left)?pyEqual(pyAt(values,"STR"),40):__left})())),"tests/kernel/test_setup_card.py:51 assert values[\"INT\"] == 80 and values[\"STR\"] == 40");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_weak_characteristic_takes_the_bottom_of_the_array"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_weak_characteristic_takes_the_bottom_of_the_array(await kernel(t,{}));});
export async function test_without_a_word_about_the_person_the_dice_decide(kernel:any){
let card:any=(await draft(kernel,(await criminal())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(card,"sheet"),"creation"),"characteristics"),"method"),"rolled")),"tests/kernel/test_setup_card.py:56 assert card[\"sheet\"][\"creation\"][\"characteristics\"][\"method\"] == \"rolled\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"generation"),"method"),"rolled")),"tests/kernel/test_setup_card.py:57 assert card[\"generation\"][\"method\"] == \"rolled\"");
assert.ok(pyBool(pyEqual(pyAt(card,"pins"),({["characteristics"]:({}),["skills"]:({})}))),"tests/kernel/test_setup_card.py:58 assert card[\"pins\"] == {\"characteristics\": {}, \"skills\": {}}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_without_a_word_about_the_person_the_dice_decide"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_without_a_word_about_the_person_the_dice_decide(await kernel(t,{}));});
export async function test_a_number_written_in_the_dossier_is_a_pin(kernel:any){
let card:any=(await draft(kernel,(await criminal()),({"numbers":({["characteristics"]:({["DEX"]:90,["APP"]:85})})})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"DEX"),90);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"APP"),85):__left})())),"tests/kernel/test_setup_card.py:63 assert card[\"sheet\"][\"characteristics\"][\"DEX\"] == 90 and card[\"sheet\"][\"characteristics\"][\"APP\"] == 85");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"pins"),"characteristics"),"DEX"),({["value"]:90,["by"]:"player"}))),"tests/kernel/test_setup_card.py:64 assert card[\"pins\"][\"characteristics\"][\"DEX\"] == {\"value\": 90, \"by\": \"player\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"generation"),"method"),"rolled")),pyStr("a number is a pin over the dice, not a method of its own"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(card,"sheet"),"creation"),"characteristics"),"pinned"),["DEX","APP"])),"tests/kernel/test_setup_card.py:66 assert card[\"sheet\"][\"creation\"][\"characteristics\"][\"pinned\"] == [\"DEX\", \"APP\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"derived"),"HP"),Math.floor((pyAdd(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"CON"),pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"SIZ")))/10))),"tests/kernel/test_setup_card.py:67 assert card[\"sheet\"][\"derived\"][\"HP\"] == (card[\"sheet\"][\"characteristics\"][\"CON\"] + card[\"sheet\"][\"characteristics\"][\"SIZ\"]) // 10");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_number_written_in_the_dossier_is_a_pin"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_number_written_in_the_dossier_is_a_pin(await kernel(t,{}));});
export async function test_a_pin_above_the_creation_bound_asks_for_the_unlock(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await criminal()),["numbers"]:({["characteristics"]:({["STR"]:95})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_card.py:73 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(error,"details"),"field"),"STR");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"unlock"),({["characteristic_max"]:95})):__left})())),"tests/kernel/test_setup_card.py:74 assert error[\"details\"][\"field\"] == \"STR\" and error[\"details\"][\"unlock\"] == {\"characteristic_max\": 95}");
let card:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await criminal()),["numbers"]:({["characteristics"]:({["STR"]:95})}),["limits"]:({["characteristic_max"]:95})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"STR"),95)),"tests/kernel/test_setup_card.py:76 assert card[\"sheet\"][\"characteristics\"][\"STR\"] == 95");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(card,"budget"),"legal")===false);return pyBool(__left)?pyContains(pyAt(pyAt(card,"limits"),"overridden"),"characteristic_max"):__left})())),"tests/kernel/test_setup_card.py:77 assert card[\"budget\"][\"legal\"] is False and \"characteristic_max\" in card[\"limits\"][\"overridden\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_above_the_creation_bound_asks_for_the_unlock"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_above_the_creation_bound_asks_for_the_unlock(await kernel(t,{}));});

export async function test_a_profile_revision_moves_no_number(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let second:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["equipment"]:["吉他箱","武士刀","六把飞刀"],["backstory"]:({...pyAt((await profile()),"backstory"),["personal_description"]:"皮肤白皙，黑发到肩"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(second,"revision"),pyAdd(pyAt(first,"revision"),1))),"tests/kernel/test_setup_card.py:85 assert second[\"revision\"] == first[\"revision\"] + 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"sheet"),"characteristics"),pyAt(pyAt(first,"sheet"),"characteristics"))),"tests/kernel/test_setup_card.py:86 assert second[\"sheet\"][\"characteristics\"] == first[\"sheet\"][\"characteristics\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"sheet"),"skills"),pyAt(pyAt(first,"sheet"),"skills"))),"tests/kernel/test_setup_card.py:87 assert second[\"sheet\"][\"skills\"] == first[\"sheet\"][\"skills\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"sheet"),"credit_rating"),pyAt(pyAt(first,"sheet"),"credit_rating"))),"tests/kernel/test_setup_card.py:88 assert second[\"sheet\"][\"credit_rating\"] == first[\"sheet\"][\"credit_rating\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"sheet"),"equipment"),["吉他箱","武士刀","六把飞刀"])),"tests/kernel/test_setup_card.py:89 assert second[\"sheet\"][\"equipment\"] == [\"吉他箱\", \"武士刀\", \"六把飞刀\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(second,"sheet"),"backstory"),"personal_description"),"皮肤白皙，黑发到肩")),"tests/kernel/test_setup_card.py:90 assert second[\"sheet\"][\"backstory\"][\"personal_description\"] == \"皮肤白皙，黑发到肩\"");
assert.ok(pyBool(pyEqual(pyAt(second,"applied"),["backstory","equipment"])),"tests/kernel/test_setup_card.py:91 assert second[\"applied\"] == [\"backstory\", \"equipment\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_profile_revision_moves_no_number"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_profile_revision_moves_no_number(await kernel(t,{}));});
export async function test_one_backstory_category_can_be_corrected_alone(kernel:any){

let first:any=(await draft(kernel,(await criminal())));
let fixed:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["backstory"]:({["personal_description"]:"皮肤白皙，黑发到肩，很美"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(fixed,"sheet"),"backstory"),"personal_description"),"皮肤白皙，黑发到肩，很美")),"tests/kernel/test_setup_card.py:98 assert fixed[\"sheet\"][\"backstory\"][\"personal_description\"] == \"皮肤白皙，黑发到肩，很美\"");
for(const key of pyIterable(["ideology_beliefs","significant_people","scenario_bound"])){
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(fixed,"sheet"),"backstory"),key),pyAt(pyAt(pyAt(first,"sheet"),"backstory"),key))),"tests/kernel/test_setup_card.py:100 assert fixed[\"sheet\"][\"backstory\"][key] == first[\"sheet\"][\"backstory\"][key]");
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(fixed,"sheet"),"characteristics"),pyAt(pyAt(first,"sheet"),"characteristics"))),"tests/kernel/test_setup_card.py:101 assert fixed[\"sheet\"][\"characteristics\"] == first[\"sheet\"][\"characteristics\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_one_backstory_category_can_be_corrected_alone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_one_backstory_category_can_be_corrected_alone(await kernel(t,{}));});
export async function test_a_backstory_category_at_the_top_level_is_folded_in(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let fixed:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["personal_description"]:"很美",["equipment"]:["吉他箱"]})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(fixed,"sheet"),"backstory"),"personal_description"),"很美");return pyBool(__left)?pyEqual(pyAt(pyAt(fixed,"sheet"),"equipment"),["吉他箱"]):__left})())),"tests/kernel/test_setup_card.py:107 assert fixed[\"sheet\"][\"backstory\"][\"personal_description\"] == \"很美\" and fixed[\"sheet\"][\"equipment\"] == [\"吉他箱\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(fixed,"sheet"),"backstory"),"scenario_bound"),pyAt(pyAt(pyAt(first,"sheet"),"backstory"),"scenario_bound"))),"tests/kernel/test_setup_card.py:108 assert fixed[\"sheet\"][\"backstory\"][\"scenario_bound\"] == first[\"sheet\"][\"backstory\"][\"scenario_bound\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_backstory_category_at_the_top_level_is_folded_in"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_backstory_category_at_the_top_level_is_folded_in(await kernel(t,{}));});
export async function test_draft_with_a_card_on_the_table_is_a_revision(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let again:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["age"]:30})})],{}));
assert.ok(pyBool(pyEqual(pyAt(again,"revision"),pyAdd(pyAt(first,"revision"),1))),"tests/kernel/test_setup_card.py:114 assert again[\"revision\"] == first[\"revision\"] + 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(again,"sheet"),"creation"),"characteristics"),pyAt(pyAt(pyAt(first,"sheet"),"creation"),"characteristics"))),"tests/kernel/test_setup_card.py:115 assert again[\"sheet\"][\"creation\"][\"characteristics\"] == first[\"sheet\"][\"creation\"][\"characteristics\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_draft_with_a_card_on_the_table_is_a_revision"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_draft_with_a_card_on_the_table_is_a_revision(await kernel(t,{}));});
export async function test_an_unprinted_weapon_goes_to_the_equipment_instead_of_a_refusal(kernel:any){
let semantic:any=(await criminal());
semantic["weapons"]=["武士刀",".45 Automatic"];
let card:any=(await draft(kernel,semantic));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const weapon of pyIterable(pyAt(pyAt(card,"sheet"),"weapons"))){if(pyBool(true))__rows.push(pyAt(weapon,"name"));}return __rows;})()),[".45 Automatic"])),"tests/kernel/test_setup_card.py:122 assert [weapon[\"name\"] for weapon in card[\"sheet\"][\"weapons\"]] == [\".45 Automatic\"]");
assert.ok(pyBool(pyContains(pyAt(pyAt(card,"sheet"),"equipment"),"武士刀")),"tests/kernel/test_setup_card.py:123 assert \"武士刀\" in card[\"sheet\"][\"equipment\"]");
assert.ok(pyBool(pyEqual(pyAt(card,"moved_to_equipment"),["武士刀"])),"tests/kernel/test_setup_card.py:124 assert card[\"moved_to_equipment\"] == [\"武士刀\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unprinted_weapon_goes_to_the_equipment_instead_of_a_refusal"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unprinted_weapon_goes_to_the_equipment_instead_of_a_refusal(await kernel(t,{}));});
export async function test_unknown_profile_fields_are_named_not_the_whole_schema(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({...(await criminal()),["step"]:"x",["skills"]:({})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_setup_card.py:130 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"unknown"),["skills","step"])),"tests/kernel/test_setup_card.py:131 assert error[\"details\"][\"unknown\"] == [\"skills\", \"step\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_profile_fields_are_named_not_the_whole_schema"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_profile_fields_are_named_not_the_whole_schema(await kernel(t,{}));});

export async function test_fewer_than_eight_occupation_skills_are_filled_from_the_trade(kernel:any){
let semantic:any=(await criminal());
semantic["occupation_skills"]=["Psychology","Stealth"];
let card:any=(await draft(kernel,semantic));
let listed:any=pyAt(pyAt(pyAt(pyAt(pyAt(card,"sheet"),"creation"),"skills"),"occupation"),"resolved");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(listed)),8);return pyBool(__left)?pyEqual((await pyLen((await pySet(listed)))),8):__left})())),"tests/kernel/test_setup_card.py:141 assert len(listed) == 8 and len(set(listed)) == 8");
assert.ok(pyBool(pyLessEqual(new Set(["Psychology","Stealth","Spot Hidden"]),(await pySet(listed)))),"tests/kernel/test_setup_card.py:142 assert {\"Psychology\", \"Stealth\", \"Spot Hidden\"} <= set(listed)");
assert.ok(pyBool(pyEqual((await pySet(pyAt(card,"filled_in"))),pySubtract((await pySet(listed)),new Set(["Psychology","Stealth"])))),"tests/kernel/test_setup_card.py:143 assert set(card[\"filled_in\"]) == set(listed) - {\"Psychology\", \"Stealth\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"profile"),"occupation_skills"),listed)),"tests/kernel/test_setup_card.py:144 assert card[\"profile\"][\"occupation_skills\"] == listed");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_fewer_than_eight_occupation_skills_are_filled_from_the_trade"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_fewer_than_eight_occupation_skills_are_filled_from_the_trade(await kernel(t,{}));});
export async function test_names_resolve_through_the_localized_labels(kernel:any){
let semantic:any=(await criminal());
(await pyMethod(semantic,"update",[({["occupation"]:"罪犯",["occupation_skills"]:["心理学","侦查","潜行","斗殴","手枪","乔装","汽车驾驶","妙手"],["interest_skills"]:["闪避","投掷"]})],{}));
let card:any=(await draft(kernel,semantic));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"sheet"),"occupation"),"Criminal")),"tests/kernel/test_setup_card.py:152 assert card[\"sheet\"][\"occupation\"] == \"Criminal\"");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(pyAt(card,"profile"),"occupation_skills"),"Spot Hidden");return pyBool(__left)?pyContains(pyAt(pyAt(card,"profile"),"interest_skills"),"Dodge"):__left})())),"tests/kernel/test_setup_card.py:153 assert \"Spot Hidden\" in card[\"profile\"][\"occupation_skills\"] and \"Dodge\" in card[\"profile\"][\"interest_skills\"]");
assert.ok(pyBool(pyLess(Math.floor(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"DEX")/2),pyAt(pyAt(pyAt(card,"sheet"),"skills"),"Dodge"))),pyStr("the interest list was spent on it"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_names_resolve_through_the_localized_labels"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_names_resolve_through_the_localized_labels(await kernel(t,{}));});
export async function test_an_unknown_trade_offers_the_closest_entries_by_their_skills(kernel:any){
let semantic:any=(await criminal());
(await pyMethod(semantic,"update",[({["occupation"]:"Mechanic",["occupation_skills"]:["Mechanical Repair","Electrical Repair","Drive Auto","Operate Heavy Machinery"]})],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:semantic})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"occupation"):__left})())),"tests/kernel/test_setup_card.py:162 assert error[\"code\"] == \"needs\" and error[\"details\"][\"field\"] == \"occupation\"");
let candidates:any=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(error,"details"),"candidates"))){if(pyBool(true))__rows.push(pyAt(row,"id"));}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=1;const __term1=(await pyLen(candidates));const __term2=3;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})());return pyBool(__left)?pyContains(candidates,"Engineer"):__left})())),"tests/kernel/test_setup_card.py:164 assert 1 <= len(candidates) <= 3 and \"Engineer\" in candidates");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(error,"details"),"candidates"))){if(pyBool(true))__rows.push(pyLessEqual(new Set(["id","label","skills"]),(await pySet(row))));}return __rows;})())))),"tests/kernel/test_setup_card.py:165 assert all({\"id\", \"label\", \"skills\"} <= set(row) for row in error[\"details\"][\"candidates\"])");
assert.ok(pyBool(!pyContains(pyAt(error,"details"),"skills")),pyStr("no catalog dump rides on a refusal"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unknown_trade_offers_the_closest_entries_by_their_skills"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unknown_trade_offers_the_closest_entries_by_their_skills(await kernel(t,{}));});
export async function test_an_unresolved_skill_is_dropped_with_candidates_and_the_card_is_still_drawn(kernel:any){
let semantic:any=(await criminal());
semantic["interest_skills"]=["anything at all","Dodge","Spot Hiden"];
let card:any=(await draft(kernel,semantic));
let given:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(card,"unresolved"))){if(pyBool(true))__rows.push([pyAt(row,"given"),pyAt(row,"candidates")]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pySet(given)),new Set(["anything at all","Spot Hiden"]))),"tests/kernel/test_setup_card.py:174 assert set(given) == {\"anything at all\", \"Spot Hiden\"}");
assert.ok(pyBool(pyContains(pyAt(given,"Spot Hiden"),"Spot Hidden")),"tests/kernel/test_setup_card.py:175 assert \"Spot Hidden\" in given[\"Spot Hiden\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"profile"),"interest_skills"),["Dodge"])),"tests/kernel/test_setup_card.py:176 assert card[\"profile\"][\"interest_skills\"] == [\"Dodge\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unresolved_skill_is_dropped_with_candidates_and_the_card_is_still_drawn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unresolved_skill_is_dropped_with_candidates_and_the_card_is_still_drawn(await kernel(t,{}));});
export async function test_the_catalog_is_one_compact_read(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let catalog:any=(await pyMethod(kernel,"ok",["setup.catalog",({["campaign"]:CAMPAIGN})],{}));
let occupations:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(catalog,"occupations"))){if(pyBool(true))__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyLen(occupations)),28);return pyBool(__left)?pyAt(pyAt(occupations,"Criminal"),"label"):__left})());return pyBool(__left)?!pyEqual(pyAt(pyAt(occupations,"Criminal"),"label"),"Criminal"):__left})())),"tests/kernel/test_setup_card.py:183 assert len(occupations) == 28 and occupations[\"Criminal\"][\"label\"] and occupations[\"Criminal\"][\"label\"] != \"Criminal\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(occupations,"Criminal"),"credit_rating_range"),[5,65]);return pyBool(__left)?pyAt(pyAt(occupations,"Criminal"),"skills"):__left})())),"tests/kernel/test_setup_card.py:184 assert occupations[\"Criminal\"][\"credit_rating_range\"] == [5, 65] and occupations[\"Criminal\"][\"skills\"]");
let skills:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(catalog,"skills"))){if(pyBool(true))__rows.push([pyAt(row,"name"),pyAt(row,"label")]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyAt(skills,"Spot Hidden");return pyBool(__left)?!pyEqual(pyAt(skills,"Spot Hidden"),"Spot Hidden"):__left})());return pyBool(__left)?pyLessEqual(79,(await pyLen(skills))):__left})())),"tests/kernel/test_setup_card.py:186 assert skills[\"Spot Hidden\"] and skills[\"Spot Hidden\"] != \"Spot Hidden\" and len(skills) >= 79");
assert.ok(pyBool(pyContains(pyAt(catalog,"weapons"),".45 Automatic")),"tests/kernel/test_setup_card.py:187 assert \".45 Automatic\" in catalog[\"weapons\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_catalog_is_one_compact_read"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_catalog_is_one_compact_read(await kernel(t,{}));});

export async function test_a_pinned_skill_survives_a_list_change_and_the_new_skills_take_only_what_is_left(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let pinned:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:70})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(pinned,"sheet"),"skills"),"Dodge"),70);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(pinned,"pins"),"skills"),"Dodge"),"by"),"player"):__left})())),"tests/kernel/test_setup_card.py:195 assert pinned[\"sheet\"][\"skills\"][\"Dodge\"] == 70 and pinned[\"pins\"][\"skills\"][\"Dodge\"][\"by\"] == \"player\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pinned,"pins"),"skills"),"Dodge"),"interest"),pySubtract(70,Math.floor(pyAt(pyAt(pyAt(first,"sheet"),"characteristics"),"DEX")/2)))),pyStr("a pin is points in the interest column"));
let widened:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["interest_skills"]:["Dodge","Throw","Climb","First Aid","Natural World"]})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(widened,"sheet"),"skills"),"Dodge"),70)),"tests/kernel/test_setup_card.py:198 assert widened[\"sheet\"][\"skills\"][\"Dodge\"] == 70");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(widened,"pins"),"skills"),"Dodge"),"interest"),pyAt(pyAt(pyAt(pyAt(pinned,"pins"),"skills"),"Dodge"),"interest"))),"tests/kernel/test_setup_card.py:199 assert widened[\"pins\"][\"skills\"][\"Dodge\"][\"interest\"] == pinned[\"pins\"][\"skills\"][\"Dodge\"][\"interest\"]");
assert.ok(pyBool(pyLessEqual(0,pyAt(pyAt(pyAt(widened,"budget"),"interest"),"unspent"))),"tests/kernel/test_setup_card.py:200 assert widened[\"budget\"][\"interest\"][\"unspent\"] >= 0");
for(const name of pyIterable(["Throw","Climb"])){
assert.ok(pyBool((await (async()=>{const __left=pyLessEqual(0,pyAt(pyAt(pyAt(widened,"sheet"),"skills"),name));return pyBool(__left)?pyLessEqual(pyAt(pyAt(pyAt(widened,"sheet"),"skills"),name),75):__left})())),"tests/kernel/test_setup_card.py:202 assert widened[\"sheet\"][\"skills\"][name] >= 0 and widened[\"sheet\"][\"skills\"][name] <= 75");
}
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(widened,"budget"),"interest"),"unspent"),0);return pyBool(__left)?__left:(await pyAll((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(["Throw","Climb","First Aid","Natural World"])){if(pyBool(true))__rows.push(pyLessEqual(75,pyAt(pyAt(pyAt(widened,"sheet"),"skills"),n)));}return __rows;})())))})())),pyStr("what the pins leave is spent unless every soft skill is capped"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pinned_skill_survives_a_list_change_and_the_new_skills_take_only_what_is_left"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pinned_skill_survives_a_list_change_and_the_new_skills_take_only_what_is_left(await kernel(t,{}));});
export async function test_soft_allocations_are_sticky_and_only_the_biggest_holder_gives_way(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let skills:any=pyAt(pyAt(first,"sheet"),"skills");
let softest:any=(await pyMin(["Fighting (Brawl)","Firearms (Handgun)","Stealth","Drive Auto"],({"key":async (name:any)=>pyAt(skills,name)})));
let raised:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({[softest]:pyAdd(pyAt(skills,softest),10)})})})],{}));
let changed:any=new Set((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(skills)){if(pyBool(!pyEqual(pyAt(pyAt(pyAt(raised,"sheet"),"skills"),name),pyAt(skills,name))))__rows.push(name);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyContains(changed,softest);return pyBool(__left)?pyLessEqual((await pyLen(changed)),3):__left})())),pyStr(`one pin moved ${(await pySorted(changed))}`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(raised,"budget"),"occupation"),"unspent"),pyAt(pyAt(pyAt(first,"budget"),"occupation"),"unspent"))),"tests/kernel/test_setup_card.py:213 assert raised[\"budget\"][\"occupation\"][\"unspent\"] == first[\"budget\"][\"occupation\"][\"unspent\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_soft_allocations_are_sticky_and_only_the_biggest_holder_gives_way"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_soft_allocations_are_sticky_and_only_the_biggest_holder_gives_way(await kernel(t,{}));});
export async function test_a_pin_by_the_model_is_recorded_as_the_models(kernel:any){
(await draft(kernel,(await criminal())));
let card:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:60})}),["by"]:"model"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(pyAt(card,"pins"),"skills"),"Dodge"),"by"),"model");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(card,"pins"),"skills"),"Dodge"),"value"),60):__left})())),"tests/kernel/test_setup_card.py:219 assert card[\"pins\"][\"skills\"][\"Dodge\"][\"by\"] == \"model\" and card[\"pins\"][\"skills\"][\"Dodge\"][\"value\"] == 60");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(card,"pins"),"skills"),"Dodge"),"interest"),pySubtract(60,Math.floor(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"DEX")/2)))),pyStr("a pin is points above the base"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_by_the_model_is_recorded_as_the_models"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_by_the_model_is_recorded_as_the_models(await kernel(t,{}));});
export async function test_a_pin_above_the_cap_asks_for_the_unlock_and_takes_it(kernel:any){
(await draft(kernel,(await criminal())));
let error:any=(await pyMethod(kernel,"err",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:85})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"Dodge"):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"unlock"),({["skill_cap"]:85})):__left})())),"tests/kernel/test_setup_card.py:226 assert error[\"code\"] == \"needs\" and error[\"details\"][\"field\"] == \"Dodge\" and error[\"details\"][\"unlock\"] == {\"skill_cap\": 85}");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(pyAt((await current(kernel)),"sheet"),"skills"),"Dodge"),85)),"tests/kernel/test_setup_card.py:227 assert current(kernel)[\"sheet\"][\"skills\"][\"Dodge\"] != 85");
let card:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:85})}),["limits"]:({["skill_cap"]:90})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"skills"),"Dodge"),85);return pyBool(__left)?pyEqual(pyAt(pyAt(card,"limits"),"skill_cap"),90):__left})())),"tests/kernel/test_setup_card.py:229 assert card[\"sheet\"][\"skills\"][\"Dodge\"] == 85 and card[\"limits\"][\"skill_cap\"] == 90");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(card,"budget"),"legal")===false);return pyBool(__left)?(await pyAny((await (async()=>{const __rows:any[]=[];for(const note of pyIterable(pyAt(pyAt(card,"budget"),"notes"))){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(note,"code"),"relaxed");return pyBool(__left)?pyEqual(pyAt(note,"limit"),"skill_cap"):__left})()));}return __rows;})()))):__left})())),"tests/kernel/test_setup_card.py:230 assert card[\"budget\"][\"legal\"] is False and any(note[\"code\"] == \"relaxed\" and note[\"limit\"] == \"skill_cap\" for note in card[\"budget\"][\"notes\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_above_the_cap_asks_for_the_unlock_and_takes_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_above_the_cap_asks_for_the_unlock_and_takes_it(await kernel(t,{}));});
export async function test_a_pin_the_budget_cannot_hold_is_kept_and_the_overspend_is_reported(kernel:any){
(await draft(kernel,(await criminal()),({"limits":({["skill_cap"]:90})})));
let card:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Fighting (Brawl)"]:90,["Firearms (Handgun)"]:90,["Stealth"]:90,["Drive Auto"]:90,["Disguise"]:90,["Psychology"]:90,["Spot Hidden"]:90,["Sleight of Hand"]:90})})})],{}));
for(const name of pyIterable(["Fighting (Brawl)","Sleight of Hand"])){
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"skills"),name),90)),"tests/kernel/test_setup_card.py:237 assert card[\"sheet\"][\"skills\"][name] == 90");
}
assert.ok(pyBool((await (async()=>{const __left=pyLess(pyAt(pyAt(pyAt(card,"budget"),"occupation"),"unspent"),0);return pyBool(__left)?(pyAt(pyAt(card,"budget"),"legal")===false):__left})())),"tests/kernel/test_setup_card.py:238 assert card[\"budget\"][\"occupation\"][\"unspent\"] < 0 and card[\"budget\"][\"legal\"] is False");
assert.ok(pyBool(pyAt(pyAt(card,"completeness"),"valid")),pyStr("an overspent card is a non-standard card, not an incomplete one"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_the_budget_cannot_hold_is_kept_and_the_overspend_is_reported"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_the_budget_cannot_hold_is_kept_and_the_overspend_is_reported(await kernel(t,{}));});
export async function test_a_relaxed_budget_left_unspent_is_a_note_not_a_gate(kernel:any){
(await draft(kernel,(await criminal())));
let relaxed:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["limits"]:({["interest_points"]:300})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(relaxed,"budget"),"interest"),"total"),300);return pyBool(__left)?pyLess(0,pyAt(pyAt(pyAt(relaxed,"budget"),"interest"),"unspent")):__left})())),"tests/kernel/test_setup_card.py:245 assert relaxed[\"budget\"][\"interest\"][\"total\"] == 300 and relaxed[\"budget\"][\"interest\"][\"unspent\"] > 0");
assert.ok(pyBool(pyAt(pyAt(relaxed,"completeness"),"valid")),"tests/kernel/test_setup_card.py:246 assert relaxed[\"completeness\"][\"valid\"]");
let committed:any=(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["consent"]:"approved"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(committed,"committed");return pyBool(__left)?pyLess(0,pyAt(pyAt(pyAt(pyAt(pyAt(committed,"sheet"),"creation"),"skills"),"interest"),"unspent")):__left})())),"tests/kernel/test_setup_card.py:248 assert committed[\"committed\"] and committed[\"sheet\"][\"creation\"][\"skills\"][\"interest\"][\"unspent\"] > 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_relaxed_budget_left_unspent_is_a_note_not_a_gate"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_relaxed_budget_left_unspent_is_a_note_not_a_gate(await kernel(t,{}));});
export async function test_auto_spread_spends_what_is_left_and_moves_no_pin(kernel:any){
(await draft(kernel,(await criminal())));
(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:60})})})],{}));
let relaxed:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["limits"]:({["interest_points"]:300,["occupation_points"]:600})})],{}));
let spread:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["auto_spread"]:true})],{}));
assert.ok(pyBool(pyLessEqual(pyAt(pyAt(pyAt(spread,"budget"),"interest"),"unspent"),pyAt(pyAt(pyAt(relaxed,"budget"),"interest"),"unspent"))),"tests/kernel/test_setup_card.py:257 assert spread[\"budget\"][\"interest\"][\"unspent\"] <= relaxed[\"budget\"][\"interest\"][\"unspent\"]");
assert.ok(pyBool(pyLessEqual(pyAt(pyAt(pyAt(spread,"budget"),"occupation"),"unspent"),pyAt(pyAt(pyAt(relaxed,"budget"),"occupation"),"unspent"))),"tests/kernel/test_setup_card.py:258 assert spread[\"budget\"][\"occupation\"][\"unspent\"] <= relaxed[\"budget\"][\"occupation\"][\"unspent\"]");
let capped:any=async (card:any, names:any)=>(await pyAll((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(names)){if(pyBool(true))__rows.push(pyLessEqual(pyAt(pyAt(card,"limits"),"skill_cap"),pyAt(pyAt(pyAt(card,"sheet"),"skills"),n)));}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(spread,"budget"),"interest"),"unspent"),0);return pyBool(__left)?__left:(await capped(spread,(await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(pyAt(pyAt(pyAt(pyAt(spread,"sheet"),"creation"),"skills"),"interest"),"pool"))){if(pyBool(!pyEqual(n,"Dodge")))__rows.push(n);}return __rows;})())))})())),"tests/kernel/test_setup_card.py:260 assert spread[\"budget\"][\"interest\"][\"unspent\"] == 0 or capped(spread, [n for n in spread[\"sheet\"][\"creation\"][\"skills\"][\"interest\"][\"pool\"] if n != \"Dodge\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(spread,"sheet"),"skills"),"Dodge"),60)),"tests/kernel/test_setup_card.py:261 assert spread[\"sheet\"][\"skills\"][\"Dodge\"] == 60");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_auto_spread_spends_what_is_left_and_moves_no_pin"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_auto_spread_spends_what_is_left_and_moves_no_pin(await kernel(t,{}));});
export async function test_the_override_alias_still_edits_numbers_for_the_card(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let con:any=pyAt(pyAt(pyAt(first,"sheet"),"characteristics"),"CON");
let target:any=(pyBool(pyLessEqual(pyAdd(con,10),90))?pyAdd(con,10):pySubtract(con,10));
let card:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["edits"]:({["characteristics"]:({["CON"]:target})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"revision"),pyAdd(pyAt(first,"revision"),1));return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"CON"),target):__left})())),"tests/kernel/test_setup_card.py:269 assert card[\"revision\"] == first[\"revision\"] + 1 and card[\"sheet\"][\"characteristics\"][\"CON\"] == target");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"pins"),"characteristics"),"CON"),({["value"]:target,["by"]:"player"}))),"tests/kernel/test_setup_card.py:270 assert card[\"pins\"][\"characteristics\"][\"CON\"] == {\"value\": target, \"by\": \"player\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"derived"),"HP"),Math.floor((pyAdd(target,pyAt(pyAt(pyAt(card,"sheet"),"characteristics"),"SIZ")))/10))),"tests/kernel/test_setup_card.py:271 assert card[\"sheet\"][\"derived\"][\"HP\"] == (target + card[\"sheet\"][\"characteristics\"][\"SIZ\"]) // 10");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_override_alias_still_edits_numbers_for_the_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_override_alias_still_edits_numbers_for_the_card(await kernel(t,{}));});
export async function test_credit_rating_is_pinned_inside_the_trade_range(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"err",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["credit_rating"]:70})})],{})),"details"),"range"),[5,65])),"tests/kernel/test_setup_card.py:276 assert kernel.err(\"setup.revise\", {\"campaign\": CAMPAIGN, \"numbers\": {\"credit_rating\": 70}})[\"details\"][\"range\"] == [5, 65]");
let card:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["credit_rating"]:60})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(card,"sheet"),"credit_rating"),60);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"skills"),"Credit Rating"),60):__left})())),"tests/kernel/test_setup_card.py:278 assert card[\"sheet\"][\"credit_rating\"] == 60 and card[\"sheet\"][\"skills\"][\"Credit Rating\"] == 60");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"pins"),"credit_rating"),({["value"]:60,["by"]:"player"}))),"tests/kernel/test_setup_card.py:279 assert card[\"pins\"][\"credit_rating\"] == {\"value\": 60, \"by\": \"player\"}");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(card,"sheet"),"finance"),pyAt(pyAt(first,"sheet"),"finance"))),pyStr("wealth follows the rating"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_credit_rating_is_pinned_inside_the_trade_range"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_credit_rating_is_pinned_inside_the_trade_range(await kernel(t,{}));});
export async function test_a_refused_revision_leaves_the_card_as_it_was(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:"high"})})})],{})),"code"),"invalid_params")),"tests/kernel/test_setup_card.py:285 assert kernel.err(\"setup.revise\", {\"campaign\": CAMPAIGN, \"numbers\": {\"skills\": {\"Dodge\": \"high\"}}})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["occupation"]:"Mechanic"})})],{})),"code"),"needs")),"tests/kernel/test_setup_card.py:286 assert kernel.err(\"setup.revise\", {\"campaign\": CAMPAIGN, \"profile\": {\"occupation\": \"Mechanic\"}})[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt((await current(kernel)),"revision"),pyAt(first,"revision"))),"tests/kernel/test_setup_card.py:287 assert current(kernel)[\"revision\"] == first[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_refused_revision_leaves_the_card_as_it_was"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_refused_revision_leaves_the_card_as_it_was(await kernel(t,{}));});
export async function test_a_revision_needs_a_card(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:60})})})],{})),"code"),"needs")),"tests/kernel/test_setup_card.py:292 assert kernel.err(\"setup.revise\", {\"campaign\": CAMPAIGN, \"numbers\": {\"skills\": {\"Dodge\": 60}}})[\"code\"] == \"needs\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_revision_needs_a_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_revision_needs_a_card(await kernel(t,{}));});

export async function test_reroll_is_the_only_call_that_rolls_again_and_it_keeps_the_pins(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["characteristics"]:({["DEX"]:90})})})],{}));
for(const _ of pyIterable((await pyRange(3)))){
(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["age"]:30})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await current(kernel)),"sheet"),"creation"),"characteristics"),"rolls"),pyAt(pyAt(pyAt(pyAt(first,"sheet"),"creation"),"characteristics"),"rolls"))),"tests/kernel/test_setup_card.py:302 assert current(kernel)[\"sheet\"][\"creation\"][\"characteristics\"][\"rolls\"] == first[\"sheet\"][\"creation\"][\"characteristics\"][\"rolls\"]");
}
let rerolled:any=(await pyMethod(kernel,"ok",["setup.reroll",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(rerolled,"sheet"),"characteristics"),"DEX"),90)),"tests/kernel/test_setup_card.py:304 assert rerolled[\"sheet\"][\"characteristics\"][\"DEX\"] == 90");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(pyAt(pyAt(rerolled,"sheet"),"creation"),"characteristics"),"rolls"),pyAt(pyAt(pyAt(pyAt(first,"sheet"),"creation"),"characteristics"),"rolls"))),"tests/kernel/test_setup_card.py:305 assert rerolled[\"sheet\"][\"creation\"][\"characteristics\"][\"rolls\"] != first[\"sheet\"][\"creation\"][\"characteristics\"][\"rolls\"]");
assert.ok(pyBool(!pyEqual(pyAt(rerolled,"seed"),pyAt(first,"seed"))),"tests/kernel/test_setup_card.py:306 assert rerolled[\"seed\"] != first[\"seed\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reroll_is_the_only_call_that_rolls_again_and_it_keeps_the_pins"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reroll_is_the_only_call_that_rolls_again_and_it_keeps_the_pins(await kernel(t,{}));});

export async function test_confirm_checks_only_that_this_is_the_current_card(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAdd(pyAt(first,"revision"),5),["consent"]:"approved"})],{})),"code_detail"),"stale_draft")),"tests/kernel/test_setup_card.py:313 assert kernel.err(\"setup.confirm\", {\"campaign\": CAMPAIGN, \"revision\": first[\"revision\"] + 5, \"consent\": \"approved\"})[\"code_detail\"] == \"stale_draft\"");
let committed:any=(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["consent"]:"approved"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(committed,"committed");return pyBool(__left)?pyEqual(pyAt(committed,"sheet"),pyAt(first,"sheet")):__left})())),"tests/kernel/test_setup_card.py:315 assert committed[\"committed\"] and committed[\"sheet\"] == first[\"sheet\"]");
assert.ok(pyBool(pyEqual((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"investigator.json"))),pyAt(first,"sheet"))),"tests/kernel/test_setup_card.py:316 assert read_json(campaign_dir(kernel.workspace) / \"party\" / \"investigator.json\") == first[\"sheet\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_confirm_checks_only_that_this_is_the_current_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_confirm_checks_only_that_this_is_the_current_card(await kernel(t,{}));});
export async function test_previewed_is_gone(kernel:any){
(await draft(kernel,(await criminal())));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.previewed",({["campaign"]:CAMPAIGN,["revision"]:1})],{})),"code"),"unknown_method")),"tests/kernel/test_setup_card.py:321 assert kernel.err(\"setup.previewed\", {\"campaign\": CAMPAIGN, \"revision\": 1})[\"code\"] == \"unknown_method\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_previewed_is_gone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_previewed_is_gone(await kernel(t,{}));});
export async function test_the_card_file_holds_the_pins_and_the_soft_share(kernel:any){
(await draft(kernel,(await criminal())));
let card:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:65})})})],{}));
let stored:any=(await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"setup"),"drafts"),`${pyAt(card,"revision")}.json`)));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(stored,"pins"),pyAt(card,"pins"));return pyBool(__left)?pyEqual(pyAt(stored,"budget"),pyAt(card,"budget")):__left})())),"tests/kernel/test_setup_card.py:328 assert stored[\"pins\"] == card[\"pins\"] and stored[\"budget\"] == card[\"budget\"]");
assert.ok(pyBool(!pyContains(pyAt(pyAt(stored,"soft"),"interest"),"Dodge")),"tests/kernel/test_setup_card.py:329 assert \"Dodge\" not in stored[\"soft\"][\"interest\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(stored,"manual");return pyBool(__left)?!pyContains(pyAt(pyAt(stored,"sheet"),"creation"),"manual"):__left})())),"tests/kernel/test_setup_card.py:330 assert \"manual\" not in stored and \"manual\" not in stored[\"sheet\"][\"creation\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_card_file_holds_the_pins_and_the_soft_share"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_card_file_holds_the_pins_and_the_soft_share(await kernel(t,{}));});

export async function test_a_printed_list_with_alternatives_and_slashes_still_fills_the_trade(kernel:any){

let semantic:any=(await criminal());
(await pyMethod(semantic,"update",[({["occupation"]:"Engineer",["occupation_skills"]:["Mechanical Repair"],["interest_skills"]:["Dodge"]})],{}));
let card:any=(await draft(kernel,semantic));
let listed:any=pyAt(pyAt(pyAt(pyAt(pyAt(card,"sheet"),"creation"),"skills"),"occupation"),"resolved");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(listed)),8);return pyBool(__left)?pyLessEqual(new Set(["Mechanical Repair","Electrical Repair","Library Use","Operate Heavy Machinery","Science (Physics)"]),(await pySet(listed))):__left})())),pyStr(listed));
let farmer:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["occupation"]:"Farmer",["occupation_skills"]:["Natural World"]})})],{}));
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(pyAt(pyAt(farmer,"sheet"),"creation"),"skills"),"occupation"),"resolved"),"Drive Auto")),"tests/kernel/test_setup_card.py:344 assert \"Drive Auto\" in farmer[\"sheet\"][\"creation\"][\"skills\"][\"occupation\"][\"resolved\"]");
let detective:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["occupation"]:"Police Detective",["occupation_skills"]:["Disguise"]})})],{}));
let resolved:any=pyAt(pyAt(pyAt(pyAt(pyAt(detective,"sheet"),"creation"),"skills"),"occupation"),"resolved");
assert.ok(pyBool((await (async()=>{const __left=pyContains(resolved,"Disguise");return pyBool(__left)?pyEqual((await pyLen(resolved)),8):__left})())),"tests/kernel/test_setup_card.py:347 assert \"Disguise\" in resolved and len(resolved) == 8");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_printed_list_with_alternatives_and_slashes_still_fills_the_trade"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_printed_list_with_alternatives_and_slashes_still_fills_the_trade(await kernel(t,{}));});
export async function test_a_ninth_occupation_pick_leads_the_interest_list_and_is_reported(kernel:any){
let semantic:any=(await criminal());
semantic["occupation_skills"]=["Fighting (Brawl)","Firearms (Handgun)","Stealth","Drive Auto","Disguise","Psychology","Spot Hidden","Sleight of Hand","Locksmith","Appraise"];
let card:any=(await draft(kernel,semantic));
assert.ok(pyBool(pyEqual((await pyLen(pyAt(pyAt(card,"profile"),"occupation_skills"))),8)),"tests/kernel/test_setup_card.py:354 assert len(card[\"profile\"][\"occupation_skills\"]) == 8");
assert.ok(pyBool(pyEqual(pyAt(card,"moved_to_interest"),["Locksmith","Appraise"])),"tests/kernel/test_setup_card.py:355 assert card[\"moved_to_interest\"] == [\"Locksmith\", \"Appraise\"]");
assert.ok(pyBool(pyEqual(pySlice(pyAt(pyAt(card,"profile"),"interest_skills"),undefined,2),["Locksmith","Appraise"])),"tests/kernel/test_setup_card.py:356 assert card[\"profile\"][\"interest_skills\"][:2] == [\"Locksmith\", \"Appraise\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_ninth_occupation_pick_leads_the_interest_list_and_is_reported"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_ninth_occupation_pick_leads_the_interest_list_and_is_reported(await kernel(t,{}));});
export async function test_a_reordered_interest_list_respreads_that_pool_and_keeps_the_pins(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let pinned:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Climb"]:40})})})],{}));
let reordered:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["interest_skills"]:["Throw","Dodge","Climb"]})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(reordered,"sheet"),"skills"),"Climb"),40)),"tests/kernel/test_setup_card.py:363 assert reordered[\"sheet\"][\"skills\"][\"Climb\"] == 40");
assert.ok(pyBool(pyLessEqual(pyAt(pyAt(pyAt(reordered,"sheet"),"skills"),"Dodge"),pyAt(pyAt(pyAt(reordered,"sheet"),"skills"),"Throw"))),pyStr("the front of the list is served first"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(reordered,"budget"),"interest"),"total"),pyAt(pyAt(pyAt(pinned,"budget"),"interest"),"total"));return pyBool(__left)?pyLessEqual(0,pyAt(pyAt(pyAt(reordered,"budget"),"interest"),"unspent")):__left})())),"tests/kernel/test_setup_card.py:365 assert reordered[\"budget\"][\"interest\"][\"total\"] == pinned[\"budget\"][\"interest\"][\"total\"] and reordered[\"budget\"][\"interest\"][\"unspent\"] >= 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(reordered,"budget"),"interest"),"total"),pyAt(pyAt(pyAt(first,"budget"),"interest"),"total"))),"tests/kernel/test_setup_card.py:366 assert reordered[\"budget\"][\"interest\"][\"total\"] == first[\"budget\"][\"interest\"][\"total\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(reordered,"sheet"),"characteristics"),pyAt(pyAt(first,"sheet"),"characteristics"))),"tests/kernel/test_setup_card.py:367 assert reordered[\"sheet\"][\"characteristics\"] == first[\"sheet\"][\"characteristics\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reordered_interest_list_respreads_that_pool_and_keeps_the_pins"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reordered_interest_list_respreads_that_pool_and_keeps_the_pins(await kernel(t,{}));});
export async function test_credit_rating_follows_the_trade_on_an_occupation_change(kernel:any){
(await draft(kernel,(await criminal())));
(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["credit_rating"]:60})})],{}));
let pinned:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["profile"]:({["occupation"]:"Drifter",["occupation_skills"]:["Stealth"]})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pinned,"sheet"),"credit_rating"),60)),pyStr("a pinned rating stays"));
assert.ok(pyBool((await (async()=>{const __left=(await pyAny((await (async()=>{const __rows:any[]=[];for(const note of pyIterable(pyAt(pyAt(pinned,"budget"),"notes"))){if(pyBool(true))__rows.push(pyEqual(pyAt(note,"code"),"credit_out_of_range"));}return __rows;})())));return pyBool(__left)?(pyAt(pyAt(pinned,"budget"),"legal")===false):__left})())),"tests/kernel/test_setup_card.py:375 assert any(note[\"code\"] == \"credit_out_of_range\" for note in pinned[\"budget\"][\"notes\"]) and pinned[\"budget\"][\"legal\"] is False");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(pyAt(pyAt(pinned,"budget"),"occupation"),"spent"),pyAt(pyAt(pyAt(pinned,"budget"),"occupation"),"unspent")),pyAt(pyAt(pyAt(pinned,"budget"),"occupation"),"total"))),pyStr("the report adds up even when the rating exceeds the pool"));
let unpinned:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["credit_rating"]:null})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(unpinned,"sheet"),"credit_rating"),5);return pyBool(__left)?(await pyAny((await (async()=>{const __rows:any[]=[];for(const note of pyIterable(pyAt(pyAt(unpinned,"budget"),"notes"))){if(pyBool(true))__rows.push(pyEqual(pyAt(note,"code"),"credit_moved"));}return __rows;})()))):__left})())),"tests/kernel/test_setup_card.py:378 assert unpinned[\"sheet\"][\"credit_rating\"] == 5 and any(note[\"code\"] == \"credit_moved\" for note in unpinned[\"budget\"][\"notes\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_credit_rating_follows_the_trade_on_an_occupation_change"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_credit_rating_follows_the_trade_on_an_occupation_change(await kernel(t,{}));});
export async function test_a_pin_from_the_dossier_below_its_base_is_refused_on_the_first_draft_too(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await criminal()),["numbers"]:({["skills"]:({["Dodge"]:3})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"Dodge"):__left})());return pyBool(__left)?pyLess(3,pyAt(pyAt(pyAt(error,"details"),"range"),0)):__left})())),"tests/kernel/test_setup_card.py:384 assert error[\"code\"] == \"needs\" and error[\"details\"][\"field\"] == \"Dodge\" and error[\"details\"][\"range\"][0] > 3");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pin_from_the_dossier_below_its_base_is_refused_on_the_first_draft_too"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pin_from_the_dossier_below_its_base_is_refused_on_the_first_draft_too(await kernel(t,{}));});
export async function test_a_pinned_characteristic_is_written_into_the_generation_record(kernel:any){
(await draft(kernel,(await criminal())));
let card:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["characteristics"]:({["CON"]:70})})})],{}));
let record:any=pyAt(pyAt(pyAt(card,"sheet"),"creation"),"characteristics");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(record,"values"),"CON"),70);return pyBool(__left)?pyEqual(pyAt(record,"pinned"),["CON"]):__left})())),"tests/kernel/test_setup_card.py:391 assert record[\"values\"][\"CON\"] == 70 and record[\"pinned\"] == [\"CON\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pinned_characteristic_is_written_into_the_generation_record"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pinned_characteristic_is_written_into_the_generation_record(await kernel(t,{}));});
export async function test_a_reroll_spends_the_new_budget(kernel:any){
(await draft(kernel,(await criminal())));
for(const _ of pyIterable((await pyRange(3)))){
let rerolled:any=(await pyMethod(kernel,"ok",["setup.reroll",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(rerolled,"budget"),"occupation"),"unspent"),0);return pyBool(__left)?__left:pyLess(pyAt(pyAt(pyAt(rerolled,"budget"),"occupation"),"unspent"),0)})());return pyBool(__left)?__left:(await pyAll((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(pyAt(pyAt(pyAt(pyAt(rerolled,"sheet"),"creation"),"skills"),"occupation"),"resolved"))){if(pyBool(true))__rows.push(pyLessEqual(75,pyAt(pyAt(pyAt(rerolled,"sheet"),"skills"),name)));}return __rows;})())))})())),pyStr(pyAt(rerolled,"budget")));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reroll_spends_the_new_budget"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reroll_spends_the_new_budget(await kernel(t,{}));});

export async function modern(semantic:any){
semantic={...semantic};semantic.era="modern";return semantic;
}
export async function test_a_modern_card_lists_the_whole_standard_sheet_and_the_modern_only_skills(kernel:any){

let card:any=(await draft(kernel,(await modern((await criminal())))));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"sheet"),"era"),"modern")),"tests/kernel/test_setup_card.py:411 assert card[\"sheet\"][\"era\"] == \"modern\"");
let skills:any=pyAt(pyAt(card,"sheet"),"skills");
assert.ok(pyBool(pyLess(40,(await pyLen(skills)))),pyStr((await pyLen(skills))));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyContains(skills,"Computer Use");return pyBool(__left)?pyContains(skills,"Electronics"):__left})());return pyBool(__left)?pyContains(skills,"Library Use"):__left})())),"tests/kernel/test_setup_card.py:414 assert \"Computer Use\" in skills and \"Electronics\" in skills and \"Library Use\" in skills");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_modern_card_lists_the_whole_standard_sheet_and_the_modern_only_skills"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_modern_card_lists_the_whole_standard_sheet_and_the_modern_only_skills(await kernel(t,{}));});
export async function test_a_skill_pin_is_points_so_dodge_follows_dex(kernel:any){

let first:any=(await draft(kernel,(await criminal())));
let by_model:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["skills"]:({["Dodge"]:60})}),["by"]:"model"})],{}));
let dex:any=pyAt(pyAt(pyAt(by_model,"sheet"),"characteristics"),"DEX");
let points:any=pyAt(pyAt(pyAt(pyAt(by_model,"pins"),"skills"),"Dodge"),"interest");
assert.ok(pyBool(pyEqual(points,pySubtract(60,Math.floor(dex/2)))),"tests/kernel/test_setup_card.py:424 assert points == 60 - dex // 2");
let raised:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["numbers"]:({["characteristics"]:({["DEX"]:90})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(raised,"sheet"),"skills"),"Dodge"),(await pyMin(pyAdd(45,points),75)))),"tests/kernel/test_setup_card.py:426 assert raised[\"sheet\"][\"skills\"][\"Dodge\"] == min(45 + points, 75)");
let typed:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(raised,"revision"),["edits"]:({["skills"]:({["Dodge"]:({["interest"]:10})})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(typed,"sheet"),"skills"),"Dodge"),55);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(typed,"pins"),"skills"),"Dodge"),"by"),"player"):__left})())),"tests/kernel/test_setup_card.py:428 assert typed[\"sheet\"][\"skills\"][\"Dodge\"] == 55 and typed[\"pins\"][\"skills\"][\"Dodge\"][\"by\"] == \"player\"");
let lowered:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(typed,"revision"),["edits"]:({["characteristics"]:({["DEX"]:50})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(lowered,"sheet"),"skills"),"Dodge"),35)),pyStr("the ten interest points ride on the new base"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_skill_pin_is_points_so_dodge_follows_dex"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_skill_pin_is_points_so_dodge_follows_dex(await kernel(t,{}));});
export async function test_the_worksheet_columns_are_the_pin_and_the_card_reports_both(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let card:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["edits"]:({["skills"]:({["Stealth"]:({["occupation"]:30,["interest"]:10}),["Throw"]:({["interest"]:20})})})})],{}));
let ledger:any=pyAt(pyAt(pyAt(card,"sheet"),"creation"),"skills");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(ledger,"occupation"),"allocations"),"Stealth"),30);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(ledger,"interest"),"allocations"),"Stealth"),10):__left})())),"tests/kernel/test_setup_card.py:437 assert ledger[\"occupation\"][\"allocations\"][\"Stealth\"] == 30 and ledger[\"interest\"][\"allocations\"][\"Stealth\"] == 10");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"skills"),"Stealth"),pyAdd(pyAt(pyAt(ledger,"bases"),"Stealth"),40))),"tests/kernel/test_setup_card.py:438 assert card[\"sheet\"][\"skills\"][\"Stealth\"] == ledger[\"bases\"][\"Stealth\"] + 40");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(ledger,"interest"),"allocations"),"Throw"),20);return pyBool(__left)?!pyContains(pyAt(pyAt(ledger,"occupation"),"allocations"),"Throw"):__left})())),"tests/kernel/test_setup_card.py:439 assert ledger[\"interest\"][\"allocations\"][\"Throw\"] == 20 and \"Throw\" not in ledger[\"occupation\"][\"allocations\"]");
let refused:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(card,"revision"),["edits"]:({["skills"]:({["Throw"]:({["occupation"]:5})})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"column"),"occupation"):__left})())),"tests/kernel/test_setup_card.py:441 assert refused[\"code\"] == \"needs\" and refused[\"details\"][\"column\"] == \"occupation\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_worksheet_columns_are_the_pin_and_the_card_reports_both"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_worksheet_columns_are_the_pin_and_the_card_reports_both(await kernel(t,{}));});
export async function test_a_custom_skill_lives_on_the_card_with_its_own_base_and_takes_points(kernel:any){

let semantic:any=(await criminal());
semantic["custom_skills"]=[({["name"]:"无人机操控",["base"]:10}),({["name"]:"Language (Other: Cantonese)",["base"]:1}),({["name"]:"Spot Hidden",["base"]:5})];
let card:any=(await draft(kernel,semantic));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(card,"sheet"),"skills"),"无人机操控"),10);return pyBool(__left)?pyContains(pyAt(pyAt(pyAt(pyAt(card,"sheet"),"creation"),"skills"),"custom"),"无人机操控"):__left})())),"tests/kernel/test_setup_card.py:450 assert card[\"sheet\"][\"skills\"][\"无人机操控\"] == 10 and \"无人机操控\" in card[\"sheet\"][\"creation\"][\"skills\"][\"custom\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"profile"),"custom_skills"),[({["name"]:"无人机操控",["base"]:10})])),pyStr("a catalog name is not custom, and a language is its catalog form"));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(pyAt(card,"profile"),"occupation_skills"),"Spot Hidden");return pyBool(__left)?pyContains(pyAt(pyAt(card,"sheet"),"skills"),"Language (Other: Cantonese)"):__left})())),"tests/kernel/test_setup_card.py:452 assert \"Spot Hidden\" in card[\"profile\"][\"occupation_skills\"] and \"Language (Other: Cantonese)\" in card[\"sheet\"][\"skills\"]");
let pinned:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(card,"revision"),["edits"]:({["skills"]:({["无人机操控"]:({["interest"]:40})})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pinned,"sheet"),"skills"),"无人机操控"),50)),"tests/kernel/test_setup_card.py:454 assert pinned[\"sheet\"][\"skills\"][\"无人机操控\"] == 50");
(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["consent"]:"approved"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"investigator.json"))),"skills"),"无人机操控"),50)),"tests/kernel/test_setup_card.py:456 assert read_json(campaign_dir(kernel.workspace) / \"party\" / \"investigator.json\")[\"skills\"][\"无人机操控\"] == 50");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_custom_skill_lives_on_the_card_with_its_own_base_and_takes_points"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_custom_skill_lives_on_the_card_with_its_own_base_and_takes_points(await kernel(t,{}));});
export async function test_the_edit_control_can_change_the_occupation(kernel:any){
let first:any=(await draft(kernel,(await criminal())));
let changed:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["edits"]:({}),["profile"]:({["occupation"]:"Soldier"})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(changed,"sheet"),"occupation"),"Soldier")),"tests/kernel/test_setup_card.py:462 assert changed[\"sheet\"][\"occupation\"] == \"Soldier\"");
let resolved:any=pyAt(pyAt(pyAt(pyAt(pyAt(changed,"sheet"),"creation"),"skills"),"occupation"),"resolved");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyLen(resolved)),8);return pyBool(__left)?pyContains(resolved,"Dodge"):__left})());return pyBool(__left)?pyContains(resolved,"Fighting (Brawl)"):__left})())),"tests/kernel/test_setup_card.py:464 assert len(resolved) == 8 and \"Dodge\" in resolved and \"Fighting (Brawl)\" in resolved");
assert.ok(pyBool(pyEqual(pyAt(pyAt(changed,"sheet"),"characteristics"),pyAt(pyAt(first,"sheet"),"characteristics"))),"tests/kernel/test_setup_card.py:465 assert changed[\"sheet\"][\"characteristics\"] == first[\"sheet\"][\"characteristics\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_edit_control_can_change_the_occupation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_edit_control_can_change_the_occupation(await kernel(t,{}));});
export async function test_the_budget_reports_the_characteristic_points_against_the_point_buy_reference(kernel:any){
let card:any=(await draft(kernel,(await criminal())));
let chars:any=pyAt(pyAt(card,"sheet"),"characteristics");
let total:any=(await pySum((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(["STR","CON","SIZ","DEX","APP","INT","POW","EDU"])){if(pyBool(true))__rows.push(pyAt(chars,a));}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"budget"),"characteristics"),({["total"]:460,["spent"]:total,["unspent"]:pySubtract(460,total),["source"]:"characteristic-dice.generation_methods.point_buy_460"}))),"tests/kernel/test_setup_card.py:472 assert card[\"budget\"][\"characteristics\"] == {\"total\": 460, \"spent\": total, \"unspent\": 460 - total, \"source\": \"characteristic-dice.generation_methods.point_buy_460\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_budget_reports_the_characteristic_points_against_the_point_buy_reference"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_budget_reports_the_characteristic_points_against_the_point_buy_reference(await kernel(t,{}));});
export async function test_the_edit_control_can_move_a_skill_between_the_lists_and_the_points_reflow(kernel:any){

let first:any=(await draft(kernel,(await criminal())));
let moved:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["edits"]:({}),["profile"]:({["occupation_skills"]:["Dodge","Fighting (Brawl)","Firearms (Handgun)","Stealth","Disguise","Psychology","Spot Hidden","Sleight of Hand"],["interest_skills"]:["Drive Auto","Throw","Climb"]})})],{}));
let ledger:any=pyAt(pyAt(pyAt(moved,"sheet"),"creation"),"skills");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(pyAt(ledger,"occupation"),"resolved"),"Dodge");return pyBool(__left)?pyContains(pyAt(pyAt(ledger,"interest"),"pool"),"Drive Auto"):__left})())),"tests/kernel/test_setup_card.py:482 assert \"Dodge\" in ledger[\"occupation\"][\"resolved\"] and \"Drive Auto\" in ledger[\"interest\"][\"pool\"]");
assert.ok(pyBool(pyContains(pyAt(pyAt(ledger,"occupation"),"allocations"),"Dodge")),pyStr("an occupation skill takes occupation points"));
assert.ok(pyBool(!pyContains(pyAt(pyAt(ledger,"interest"),"allocations"),"Dodge")),"tests/kernel/test_setup_card.py:484 assert \"Dodge\" not in ledger[\"interest\"][\"allocations\"]");
assert.ok(pyBool(pyLessEqual(0,pyAt(pyAt(pyAt(moved,"budget"),"occupation"),"unspent"))),"tests/kernel/test_setup_card.py:485 assert moved[\"budget\"][\"occupation\"][\"unspent\"] >= 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(moved,"sheet"),"characteristics"),pyAt(pyAt(first,"sheet"),"characteristics"))),"tests/kernel/test_setup_card.py:486 assert moved[\"sheet\"][\"characteristics\"] == first[\"sheet\"][\"characteristics\"]");
let refused:any=(await pyMethod(kernel,"err",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(moved,"revision"),["edits"]:({}),["profile"]:({["name"]:"x"})})],{}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"invalid_params")),"tests/kernel/test_setup_card.py:488 assert refused[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_edit_control_can_move_a_skill_between_the_lists_and_the_points_reflow"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_edit_control_can_move_a_skill_between_the_lists_and_the_points_reflow(await kernel(t,{}));});
export async function test_the_edit_control_can_change_the_age_and_the_age_table_reruns_on_the_same_dice(kernel:any){

let first:any=(await draft(kernel,(await criminal())));
(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["edits"]:({["characteristics"]:({["APP"]:85})})})],{}));
let older:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAdd(pyAt(first,"revision"),1),["edits"]:({}),["profile"]:({["age"]:62})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(older,"sheet"),"age"),62);return pyBool(__left)?!pyEqual(pyAt(pyAt(pyAt(pyAt(older,"sheet"),"creation"),"age"),"bracket"),pyAt(pyAt(pyAt(pyAt(first,"sheet"),"creation"),"age"),"bracket")):__left})())),"tests/kernel/test_setup_card.py:496 assert older[\"sheet\"][\"age\"] == 62 and older[\"sheet\"][\"creation\"][\"age\"][\"bracket\"] != first[\"sheet\"][\"creation\"][\"age\"][\"bracket\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(older,"sheet"),"characteristics"),"APP"),85)),pyStr("a pinned characteristic is not aged"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(older,"sheet"),"creation"),"characteristics"),"rolls"),pyAt(pyAt(pyAt(pyAt(first,"sheet"),"creation"),"characteristics"),"rolls"))),pyStr("same dice"));
assert.ok(pyBool(pyLess(pyAt(pyAt(pyAt(older,"sheet"),"derived"),"MOV"),pyAt(pyAt(pyAt(first,"sheet"),"derived"),"MOV"))),"tests/kernel/test_setup_card.py:499 assert older[\"sheet\"][\"derived\"][\"MOV\"] < first[\"sheet\"][\"derived\"][\"MOV\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_edit_control_can_change_the_age_and_the_age_table_reruns_on_the_same_dice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_edit_control_can_change_the_age_and_the_age_table_reruns_on_the_same_dice(await kernel(t,{}));});
export async function test_a_bigger_budget_after_a_characteristic_edit_is_spent_not_left_on_the_table(seeded_kernel:any){

let kernel:any=seeded_kernel;
let first:any=(await draft(kernel,(await criminal())));
let dex:any=pyAt(pyAt(pyAt(first,"sheet"),"characteristics"),"DEX");
let raised:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(first,"revision"),["edits"]:({["characteristics"]:({["DEX"]:90,["EDU"]:80})})})],{}));
assert.ok(pyBool(pyLess(pyAt(pyAt(pyAt(first,"budget"),"occupation"),"total"),pyAt(pyAt(pyAt(raised,"budget"),"occupation"),"total"))),"tests/kernel/test_setup_card.py:512 assert raised[\"budget\"][\"occupation\"][\"total\"] > first[\"budget\"][\"occupation\"][\"total\"]");
let occ:any=pyAt(pyAt(pyAt(pyAt(raised,"sheet"),"creation"),"skills"),"occupation");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(raised,"budget"),"occupation"),"unspent"),0);return pyBool(__left)?__left:(await pyAll((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(occ,"resolved"))){if(pyBool(true))__rows.push(pyLessEqual(75,pyAt(pyAt(pyAt(raised,"sheet"),"skills"),n)));}return __rows;})())))})())),pyStr(pyAt(raised,"budget")));
let before:any=pyAt(pyAt(pyAt(pyAt(pyAt(first,"sheet"),"creation"),"skills"),"occupation"),"allocations");
for(const [name,points] of pyIterable((await pyMethod(before,"items",[],{})))){
assert.ok(pyBool(pyLessEqual(points,(await pyMethod(pyAt(occ,"allocations"),"get",[name,0],{})))),pyStr("an allocation already held only grows"));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_bigger_budget_after_a_characteristic_edit_is_spent_not_left_on_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_bigger_budget_after_a_characteristic_edit_is_spent_not_left_on_the_table(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
