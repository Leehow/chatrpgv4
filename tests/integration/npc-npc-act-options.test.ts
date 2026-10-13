// Migrated from tests/kernel/test_npc_act_options.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,narrate,open_turn,read_json,resolve,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";







export let KNOTT:any="steven-knott";
export let INVESTIGATOR:any="thomas-hayes";
export async function options(client:any,name:any="Steven Knott",extra:any={}){
return (await pyMethod(client,"ok",["npc.act.options",({["campaign"]:"c1",["name"]:name,...extra})],{}));
}
export async function ways(result:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"ways"))){if(pyBool(true))__rows.push([pyAt(row,"way"),pyAt(row,"params")]);}return __rows;})()));
}
export async function values(params:any,name:any){
return (await (async()=>{const __rows:any[]=[];for(const option of pyIterable(pyAt(params,name))){if(pyBool(true))__rows.push(pyAt(option,"value"));}return __rows;})());
}
export async function* knott(tmp_path:any){
let client:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
yield client;
(await pyMethod(client,"close",[],{}));
}
export async function pinned(client:any){
(await open_turn(client,"I square up to Knott."));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"an office man"})]}));
}
export async function knotts_turn(client:any){

(await pinned(client));
(await narrate(client,"t1-c2","Knott gets up from behind the desk."));
(await pyMethod(client,"table",["player_input"],{"text":"I punch Knott in the face."}));
(await resolve(client,"t2-c1",({"intent":"combat","goal":"hit him","method":"fists","target":"Steven Knott","weapon":"unarmed"})));
(await resolve(client,"t2-c2",({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Steven Knott","defense":"none"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(client,"table",["look"],{"focus":"session"})),"session"),"turn_of"),KNOTT)),"tests/kernel/test_npc_act_options.py:59 assert client.table(\"look\", focus=\"session\")[\"session\"][\"turn_of\"] == KNOTT");
}
export async function test_outside_a_fight_there_is_no_attack_and_no_flight_the_first_blow_is_how_one_opens(knott:any){
let result:any,found:any,blow:any,skills:any;
(await pinned(knott));
result=(await options(knott));
assert.ok(pyBool(pyEqual(pyAt(result,"npc"),({["handle"]:KNOTT,["name"]:"Steven Knott",["kind"]:"npc"}))),"tests/kernel/test_npc_act_options.py:65 assert result[\"npc\"] == {\"handle\": KNOTT, \"name\": \"Steven Knott\", \"kind\": \"npc\"}");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(result,"in_session")===false);return pyBool(__left)?(pyAt(result,"my_turn")===false):__left})())),"tests/kernel/test_npc_act_options.py:66 assert result[\"in_session\"] is False and result[\"my_turn\"] is False");
found=(await ways(result));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(found,"attack");return pyBool(__left)?!pyContains(found,"flee"):__left})())),pyStr((await pyMethod(found,"keys",[],{}))));
assert.ok(pyBool(pyEqual((await values(pyAt(found,"first_blow"),"target")),[INVESTIGATOR])),pyStr("only the investigator can take a first blow (§142.11)"));
blow=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"ways"))){if(pyBool(pyEqual(pyAt(row,"way"),"first_blow")))__rows.push(row);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(blow,"ready")===true);return pyBool(__left)?!pyContains(blow,"preparation"):__left})())),pyStr("the pinned archetype completes his block (§159.12)"));
assert.ok(pyBool(pyContains((await values(pyAt(found,"first_blow"),"weapon")),"unarmed")),"tests/kernel/test_npc_act_options.py:72 assert \"unarmed\" in values(found[\"first_blow\"], \"weapon\")");
skills=(await values(pyAt(found,"check"),"skill"));
assert.ok(pyBool((await (async()=>{const __left=skills;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const value of pyIterable(skills)){if(pyBool(true))__rows.push((await pyIsInstance(value,pyStr)));}return __rows;})()))):__left})())),"tests/kernel/test_npc_act_options.py:75 assert skills and all(isinstance(value, str) for value in skills)");
assert.ok(pyBool(pyEqual((await pySorted((await values(pyAt(found,"coercion"),"skill")))),["Charm","Fast Talk","Intimidate","Persuade"])),pyStr("the rule's four (§142.13)"));
assert.ok(pyBool(pyEqual((await values(pyAt(found,"coercion"),"investigator")),[INVESTIGATOR])),"tests/kernel/test_npc_act_options.py:77 assert values(found[\"coercion\"], \"investigator\") == [INVESTIGATOR]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(found,"leave");return pyBool(__left)?pyContains(found,"stance"):__left})())),"tests/kernel/test_npc_act_options.py:78 assert \"leave\" in found and \"stance\" in found");
assert.ok(pyBool(pyEqual(pyAt((await pyList(found)),(-1)),"intention_only")),pyStr("every act has somewhere to go"));
assert.ok(pyBool(pyEqual(pyAt(result,"acted_on"),[])),pyStr("nothing was done to him this turn"));
assert.ok(pyBool(pyAt(result,"play_language")),pyStr("the act is written in the campaign's language"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_outside_a_fight_there_is_no_attack_and_no_flight_the_first_blow_is_how_one_opens"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_outside_a_fight_there_is_no_attack_and_no_flight_the_first_blow_is_how_one_opens(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_person_with_no_numbers_is_offered_the_first_blow_only_as_preparation_and_no_check(knott:any){
let result:any,rows:any,blow:any;

(await open_turn(knott,"I look at Knott."));
result=(await options(knott));
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"ways"))){if(pyBool(true))__rows.push([pyAt(row,"way"),row]);}return __rows;})()));
blow=pyAt(rows,"first_blow");
assert.ok(pyBool(pyEqual((await values(pyAt(blow,"params"),"target")),[INVESTIGATOR])),"tests/kernel/test_npc_act_options.py:92 assert values(blow[\"params\"], \"target\") == [INVESTIGATOR]");
assert.ok(pyBool((pyAt(blow,"ready")===false)),pyStr("a fight needs a stat block: without one the first blow is never executable"));
assert.ok(pyBool(pyEqual(pyAt(blow,"preparation"),[({["actor"]:"Steven Knott",["role"]:"combat",["completion"]:"archetype",["missing"]:["characteristics.STR","characteristics.SIZ","characteristics.DEX","characteristics.CON"]})])),pyStr("the fight's own gaps, completed by an archetype because he is a person"));
assert.ok(pyBool(!pyContains(rows,"check")),pyStr("no numbers and no pins: nothing of his own to roll"));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(rows,"intention_only"),"ready")===true);return pyBool(__left)?!pyContains(pyAt(rows,"intention_only"),"preparation"):__left})())),"tests/kernel/test_npc_act_options.py:99 assert rows[\"intention_only\"][\"ready\"] is True and \"preparation\" not in rows[\"intention_only\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_person_with_no_numbers_is_offered_the_first_blow_only_as_preparation_and_no_check"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_person_with_no_numbers_is_offered_the_first_blow_only_as_preparation_and_no_check(await acquireFixture(t,()=>knott(temporary)));});
export async function test_on_his_turn_of_the_fight_the_attack_targets_only_opponents_and_flight_is_offered(knott:any){
let result:any,found:any,kinds:any;
(await knotts_turn(knott));
result=(await options(knott));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(result,"in_session")===true);return pyBool(__left)?(pyAt(result,"my_turn")===true):__left})())),"tests/kernel/test_npc_act_options.py:105 assert result[\"in_session\"] is True and result[\"my_turn\"] is True");
found=(await ways(result));
assert.ok(pyBool(pyEqual((await values(pyAt(found,"attack"),"target")),[INVESTIGATOR])),pyStr("the fight's own opponents who can still fight"));
assert.ok(pyBool((await values(pyAt(found,"attack"),"weapon"))),pyStr("the weapons in his hands in the fight"));
assert.ok(pyBool(pyContains(found,"flee")),"tests/kernel/test_npc_act_options.py:109 assert \"flee\" in found");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyContains(found,"first_blow");return pyBool(__left)?!pyContains(found,"leave"):__left})());return pyBool(__left)?!pyContains(found,"walk_on"):__left})())),pyStr("a fight is not left by walking out"));
kinds=(await pySorted(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"acted_on"))){if(pyBool(true))__rows.push(pyAt(row,"kind"));}return __rows;})()))));
assert.ok(pyBool(pyEqual(kinds,["delta","roll_against"])),pyStr(pyAt(result,"acted_on")));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_on_his_turn_of_the_fight_the_attack_targets_only_opponents_and_flight_is_offered"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_on_his_turn_of_the_fight_the_attack_targets_only_opponents_and_flight_is_offered(await acquireFixture(t,()=>knott(temporary)));});
export async function test_off_his_turn_of_the_fight_nothing_of_the_fight_is_his_to_bind(knott:any){
let combat_path:any,combat:any,result:any,found:any;
(await knotts_turn(knott));
combat_path=pyDivide(pyDivide((await campaign_dir(knott.workspace)),"save"),"combat.json");
combat=(await read_json(combat_path));
combat["initiative_cursor"]=(await pyNext((await (async()=>{const __rows:any[]=[];for(const [i,value] of pyIterable((await pyEnumerate(pyAt(combat,"current_initiative"))))){if(pyBool(pyEqual(pyAt(value,"actor_id"),INVESTIGATOR)))__rows.push(i);}return __rows;})())));
(await pyMethod(combat_path,"write_text",[(await pyMethod(json,"dumps",[combat],{}))],{"encoding":"utf-8"}));
result=(await options(knott));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(result,"in_session")===true);return pyBool(__left)?(pyAt(result,"my_turn")===false):__left})())),"tests/kernel/test_npc_act_options.py:123 assert result[\"in_session\"] is True and result[\"my_turn\"] is False");
found=(await ways(result));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(found,"attack");return pyBool(__left)?!pyContains(found,"flee"):__left})())),"tests/kernel/test_npc_act_options.py:125 assert \"attack\" not in found and \"flee\" not in found");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_off_his_turn_of_the_fight_nothing_of_the_fight_is_his_to_bind"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_off_his_turn_of_the_fight_nothing_of_the_fight_is_his_to_bind(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_act_is_an_intention_of_his_the_same_line_under_way_continues_it_a_settled_one_is_a_new_attempt(knott:any){
let line:any,fresh:any,under_way:any,again:any;
(await pinned(knott));
line="Ring the brass bell for the porter.";
fresh=pyAt((await options(knott,undefined,({"act":line}))),"act");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(fresh,"line"),line);return pyBool(__left)?(await pyMethod(pyAt(fresh,"ref"),"startswith",[`intent:${KNOTT}:`],{})):__left})());return pyBool(__left)?(pyAt(fresh,"continues")===null):__left})())),"tests/kernel/test_npc_act_options.py:132 assert fresh[\"line\"] == line and fresh[\"ref\"].startswith(f\"intent:{KNOTT}:\") and fresh[\"continues\"] is None");
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:line,["outcome"]:"attempted"})]}));
under_way=pyAt((await options(knott,undefined,({"act":`  ${line} `}))),"act");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(under_way,"ref"),pyAt(fresh,"ref"));return pyBool(__left)?pyEqual(pyAt(pyAt(under_way,"continues"),"ref"),pyAt(fresh,"ref")):__left})())),"tests/kernel/test_npc_act_options.py:135 assert under_way[\"ref\"] == fresh[\"ref\"] and under_way[\"continues\"][\"ref\"] == fresh[\"ref\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(under_way,"continues"),"status"),"attempted")),"tests/kernel/test_npc_act_options.py:136 assert under_way[\"continues\"][\"status\"] == \"attempted\"");
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intent_ref"]:pyAt(fresh,"ref"),["outcome"]:"failed"})]}));
again=pyAt((await options(knott,undefined,({"act":line}))),"act");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(again,"continues")===null);return pyBool(__left)?pyEqual(pyAt(again,"line"),`${line} (turn 1)`):__left})());return pyBool(__left)?!pyEqual(pyAt(again,"ref"),pyAt(fresh,"ref")):__left})())),pyStr("a settled intention is not tried again: a new attempt is a new line"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_act_is_an_intention_of_his_the_same_line_under_way_continues_it_a_settled_one_is_a_new_attempt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_act_is_an_intention_of_his_the_same_line_under_way_continues_it_a_settled_one_is_a_new_attempt(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_produce_list_is_the_price_list_of_the_modules_era_and_only_when_asked(knott:any){
let produce:any,weapons:any,equipment:any,priced:any,era:any,armed:any;

(await pinned(knott));
assert.ok(pyBool((await (async()=>{const __left=!pyContains((await options(knott)),"produce");return pyBool(__left)?!pyContains((await options(knott)),"draw"):__left})())),"tests/kernel/test_npc_act_options.py:147 assert \"produce\" not in options(knott) and \"draw\" not in options(knott)");
produce=pyAt((await options(knott,undefined,({"produce":true}))),"produce");
weapons=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"weapons.json")),"read_text",[],{"encoding":"utf-8"}))],{})),"weapons");
equipment=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"equipment.json")),"read_text",[],{"encoding":"utf-8"}))],{})),"records");
priced=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(equipment)){if(pyBool(true))__rows.push([pyAt(row,"price_id"),row]);}return __rows;})()));
era=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(equipment)){if(pyBool(pyEqual(pyAt(row,"era"),"1920s")))__rows.push(row);}return __rows;})());
assert.ok(pyBool(pyEqual(pySlice((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(produce)){if(pyBool(true))__rows.push(pyAt(option,"value"));}return __rows;})()),undefined,(await pyLen(era))),(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(era)){if(pyBool(true))__rows.push(pyAt(row,"price_id"));}return __rows;})()))),pyStr("the haunting is a 1920s module: every record of it, in the book's order"));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(produce)){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(option,"label"),pyAt(pyAt(priced,pyAt(option,"value")),"name"));return pyBool(__left)?pyEqual(pyAt(option,"category"),pyAt(pyAt(priced,pyAt(option,"value")),"category")):__left})()));}return __rows;})())))),"tests/kernel/test_npc_act_options.py:155 assert all(option[\"label\"] == priced[option[\"value\"]][\"name\"] and option[\"category\"] == priced[option[\"value\"]][\"category\"] for option in produce)");
armed=(await (async()=>{const __rows:any[]=[];for(const option of pyIterable(produce)){if(pyBool(pyContains(option,"weapon")))__rows.push(option);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=armed;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(armed)){if(pyBool(true))__rows.push((await (async()=>{const __left=pyContains(weapons,pyAt(option,"weapon"));return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(priced,pyAt(option,"value")),"entity_ref"),"entity_id"),pyAt(option,"weapon")):__left})()));}return __rows;})()))):__left})())),pyStr("a weapon record names its weapons.json profile"));
assert.ok(pyBool(pyEqual((await pyLen((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(pySlice(produce,undefined,(await pyLen(era))))){if(pyBool(pyContains(option,"weapon")))__rows.push(option);}return __rows;})()))),(await pySum((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(era)){if(pyBool(pyEqual((await pyMethod(((await (async()=>{const __left=(await pyMethod(row,"get",["entity_ref"],{}));return pyBool(__left)?__left:({})})())),"get",["kind"],{})),"weapon")))__rows.push(1);}return __rows;})()))))),"tests/kernel/test_npc_act_options.py:159 assert len([option for option in produce[:len(era)] if \"weapon\" in option]) == sum(1 for row in era if (row.get(\"entity_ref\") or {}).get(\"kind\") == \"weapon\")");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(armed)){if(pyBool(true))__rows.push(pyEqual(pyAt(option,"weapon"),"automatic_25_derringer"));}return __rows;})())))),pyStr("the pocket pistol the loop test draws"));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(produce)){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(option,"label"),"Umbrella");return pyBool(__left)?!pyContains(option,"weapon"):__left})()));}return __rows;})())))),pyStr("and things that are not weapons"));
assert.ok(pyBool(pyLessEqual(255,(await pyLen(produce)))),pyStr("longer than one Jev question holds: the host asks by its part first"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_produce_list_is_the_price_list_of_the_modules_era_and_only_when_asked"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_produce_list_is_the_price_list_of_the_modules_era_and_only_when_asked(await acquireFixture(t,()=>knott(temporary)));});
export async function book_name(name:any){

return (await pyMethod((await pyMethod(re,"sub",["[\\s_\\-]+"," ",(await pyMethod(name,"lower",[],{}))],{})),"strip",[],{}));
}
export async function test_a_surprise_is_not_held_to_the_modules_era_and_the_modules_own_record_is_preferred(knott:any){
let plain:any,produce:any,equipment:any,priced:any,era:any,later:any,era_names:any,chainsaw:any,parts:any;

(await pinned(knott));
plain=(await options(knott));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(plain,"produce");return pyBool(__left)?!pyContains((await pyMethod(json,"dumps",[plain],{})),"eq.modern."):__left})())),pyStr("without produce: no price list, nothing of another era"));
produce=pyAt((await options(knott,undefined,({"produce":true}))),"produce");
equipment=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"equipment.json")),"read_text",[],{"encoding":"utf-8"}))],{})),"records");
priced=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(equipment)){if(pyBool(true))__rows.push([pyAt(row,"price_id"),row]);}return __rows;})()));
era=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(equipment)){if(pyBool(pyEqual(pyAt(row,"era"),"1920s")))__rows.push(row);}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(pySlice(produce,undefined,(await pyLen(era))))){if(pyBool(true))__rows.push(pyAt(option,"value"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(era)){if(pyBool(true))__rows.push(pyAt(row,"price_id"));}return __rows;})()))),pyStr("the module's era first"));
later=pySlice(produce,(await pyLen(era)),undefined);
assert.ok(pyBool((await (async()=>{const __left=later;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(later)){if(pyBool(true))__rows.push(!pyEqual(pyAt(pyAt(priced,pyAt(option,"value")),"era"),"1920s"));}return __rows;})()))):__left})())),pyStr("then the other eras"));
era_names=new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(era)){if(pyBool(true))__rows.push((await book_name(pyAt(row,"name"))));}return __rows;})()));
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(later)){if(pyBool(pyContains(era_names,(await book_name(pyAt(option,"label"))))))__rows.push(pyAt(option,"label"));}return __rows;})()))),pyStr("a name the module's era prints is its own record"));
assert.ok(pyBool(pyEqual((await pyLen(new Set((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(later)){if(pyBool(true))__rows.push((await book_name(pyAt(option,"label"))));}return __rows;})())))),(await pyLen(later)))),pyStr("each other-era name once"));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(produce)){if(pyBool(pyEqual(pyAt(option,"label"),"Hand Grenade*")))__rows.push(pyAt(option,"value"));}return __rows;})()),["eq.1920s.weapon_table.table_xvii_explosives_heavy_weapons_misc.hand_grenade"])),pyStr("printed in both eras: the module's record only"));
chainsaw=(await pyNext((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(later)){if(pyBool(pyEqual((await pyMethod(option,"get",["weapon"],{})),"chainsaw")))__rows.push(option);}return __rows;})())));
assert.ok(pyBool(pyEqual([pyAt(chainsaw,"value"),pyAt(chainsaw,"label"),pyAt(chainsaw,"category")],["eq.modern.weapon_table.table_xvii_hand_to_hand_weapons.chainsaw_i","Chainsaw* (i)","weapon_table"])),pyStr("a modern weapon, with its profile"));
assert.ok(pyBool(pyLessEqual(new Set(["m79_grenade_launcher","minigun"]),new Set((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(later)){if(pyBool(true))__rows.push((await pyMethod(option,"get",["weapon"],{})));}return __rows;})())))),"tests/kernel/test_npc_act_options.py:193 assert {\"m79_grenade_launcher\", \"minigun\"} <= {option.get(\"weapon\") for option in later}");
parts=(await Counter((await (async()=>{const __rows:any[]=[];for(const option of pyIterable(produce)){if(pyBool(true))__rows.push(pyAt(option,"category"));}return __rows;})())));
assert.ok(pyBool(pyLessEqual(pyAdd((await pyMax((await pyMethod(parts,"values",[],{})))),1),255)),pyStr(`every part still fits one choice question beside none: ${(await pyMethod(parts,"most_common",[3],{}))}`));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_surprise_is_not_held_to_the_modules_era_and_the_modules_own_record_is_preferred"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_surprise_is_not_held_to_the_modules_era_and_the_modules_own_record_is_preferred(await acquireFixture(t,()=>knott(temporary)));});
export async function test_refusals(knott:any){
(await pinned(knott));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(knott,"err",["npc.act.options",({["campaign"]:"c1"})],{})),"code"),"invalid_params")),"tests/kernel/test_npc_act_options.py:201 assert knott.err(\"npc.act.options\", {\"campaign\": \"c1\"})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(knott,"err",["npc.act.options",({["campaign"]:"c1",["name"]:"Nobody At All"})],{})),"code"),"unknown_entity")),"tests/kernel/test_npc_act_options.py:202 assert knott.err(\"npc.act.options\", {\"campaign\": \"c1\", \"name\": \"Nobody At All\"})[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(knott,"err",["npc.act.options",({["campaign"]:"c1",["name"]:"Steven Knott",["produce"]:"yes"})],{})),"code"),"invalid_params")),"tests/kernel/test_npc_act_options.py:203 assert knott.err(\"npc.act.options\", {\"campaign\": \"c1\", \"name\": \"Steven Knott\", \"produce\": \"yes\"})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(knott,"err",["npc.act.options",({["campaign"]:"c1",["name"]:"Steven Knott",["act"]:""})],{})),"code"),"invalid_params")),"tests/kernel/test_npc_act_options.py:204 assert knott.err(\"npc.act.options\", {\"campaign\": \"c1\", \"name\": \"Steven Knott\", \"act\": \"\"})[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_refusals"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_refusals(await acquireFixture(t,()=>knott(temporary)));});
export async function test_an_attack_waiting_for_its_defence_carries_its_intention_stamp_to_the_defence_roll(knott:any){
let line:any,ref:any,carried:any,receipts:any,attack:any;

(await pinned(knott));
line="Grab the letter opener and lunge at the visitor.";
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:line,["outcome"]:"attempted",["_generated"]:true})]}));
ref=pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(knott,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"npc");return pyBool(__left)?pyEqual((await pyMethod((await pyMethod(r,"get",["intent",({})],{})),"get",["text"],{})),line):__left})())))__rows.push(r);}return __rows;})()))),"intent"),"ref");
(await resolve(knott,"t1-c3",({"actor":"Steven Knott","intent":"combat","target":"Thomas Hayes","goal":"lunge","method":"lunge","intent_ref":ref,"_generated":true})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(knott,"table",["look"],{"focus":"session"})),"session"),"pending_defense"),"actor"),INVESTIGATOR)),pyStr("the blow waits for the defence"));
carried=(await read_json(pyDivide(pyDivide((await campaign_dir(knott.workspace)),"save"),"attack-intents.json")));
assert.ok(pyBool(pyEqual((await pyList((await pyMethod(carried,"values",[],{})))),[({["ref"]:ref,["npc"]:KNOTT,["text"]:line,["generated"]:true})])),"tests/kernel/test_npc_act_options.py:218 assert list(carried.values()) == [{\"ref\": ref, \"npc\": KNOTT, \"text\": line, \"generated\": True}]");
(await resolve(knott,"t1-c4",({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Thomas Hayes","defense":"dodge"})));
receipts=pyAt((await pyMethod(knott,"table",["status"],{})),"receipts");
attack=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["actor"],{})),KNOTT):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),"t1-c4"):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(attack,"intent"),"ref"),ref);return pyBool(__left)?(pyAt(pyAt(attack,"intent"),"generated")===true):__left})())),"tests/kernel/test_npc_act_options.py:222 assert attack[\"intent\"][\"ref\"] == ref and attack[\"intent\"][\"generated\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(attack,"intent"),"outcome"),((pyBool(pyAt(attack,"passed"))?"done":"failed")))),pyStr("the roll settled the act"));
assert.ok(pyBool(pyEqual((await read_json(pyDivide(pyDivide((await campaign_dir(knott.workspace)),"save"),"attack-intents.json"))),({}))),pyStr("taken once"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_attack_waiting_for_its_defence_carries_its_intention_stamp_to_the_defence_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_attack_waiting_for_its_defence_carries_its_intention_stamp_to_the_defence_roll(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_generated_mark_is_true_or_absent(knott:any){
let error:any;
(await pinned(knott));
error=(await pyMethod(knott,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:"Leave.",["outcome"]:"attempted",["_generated"]:"yes"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"npc._generated"):__left})())),"tests/kernel/test_npc_act_options.py:230 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"field\"] == \"npc._generated\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_generated_mark_is_true_or_absent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_generated_mark_is_true_or_absent(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_person_the_flight_rules_block_is_not_offered_flee(knott:any){
let path:any,combat:any,knott_row:any;

(await knotts_turn(knott));
path=pyDivide(pyDivide((await campaign_dir(knott.workspace)),"save"),"combat.json");
combat=(await read_json(path));
knott_row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(combat,"participants"))){if(pyBool(pyEqual(pyAt(p,"actor_id"),KNOTT)))__rows.push(p);}return __rows;})())));
knott_row["conditions"]=[...(await pyMethod(knott_row,"get",["conditions",[]],{})),"grappled"];
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[combat],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
assert.ok(pyBool(!pyContains((await ways((await options(knott)))),"flee")),pyStr("a held person cannot run"));
knott_row["conditions"]=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(knott_row,"conditions"))){if(pyBool(!pyEqual(c,"grappled")))__rows.push(c);}return __rows;})());
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[combat],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyContains((await ways((await options(knott)))),"flee")),"tests/kernel/test_npc_act_options.py:245 assert \"flee\" in ways(options(knott))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_person_the_flight_rules_block_is_not_offered_flee"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_person_the_flight_rules_block_is_not_offered_flee(await acquireFixture(t,()=>knott(temporary)));});






export async function spoke_at_the_office(client:any){

(await open_turn(client,"I ask Knott about the house."));
(await narrate(client,"t1-c1","诺特靠回椅背。{{say:Steven Knott}}「那房子空了好些年。」{{/say}}"));
(await pyMethod(client,"table",["player_input"],{"text":"I keep asking."}));
}
export async function test_a_line_he_said_last_turn_in_this_room_keeps_him_in_the_conversation(knott:any){
let conversation:any;
(await spoke_at_the_office(knott));
conversation=pyAt((await options(knott)),"conversation");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(conversation!==null);return pyBool(__left)?pyEqual(pyAt(conversation,"turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(conversation,"by"),["speech"]):__left})())),pyStr(conversation));
assert.ok(pyBool(pyEqual(pyAt((await options(knott)),"acted_on"),[])),pyStr("nothing was done to him this turn: this is the third trigger, not the first"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_line_he_said_last_turn_in_this_room_keeps_him_in_the_conversation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_line_he_said_last_turn_in_this_room_keeps_him_in_the_conversation(await acquireFixture(t,()=>knott(temporary)));});
export async function test_an_intention_of_his_this_turn_is_his_part_now(knott:any){
let conversation:any;
(await spoke_at_the_office(knott));
(await pyMethod(knott,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:"Ring for the porter.",["outcome"]:"attempted"})]}));
conversation=pyAt((await options(knott)),"conversation");
assert.ok(pyBool(pyEqual([pyAt(conversation,"turn"),pyAt(conversation,"by")],[2,["intention"]])),pyStr(conversation));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_intention_of_his_this_turn_is_his_part_now"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_intention_of_his_this_turn_is_his_part_now(await acquireFixture(t,()=>knott(temporary)));});
export async function test_leaving_the_room_ends_it_even_if_he_comes_along(knott:any){
let moved:any;
(await spoke_at_the_office(knott));
(await pyMethod(knott,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:"newspaper-morgue"})]}));
(await pyMethod(knott,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["to"]:"here",["why"]:"test fixture: he came along"})]}));
moved=(await options(knott));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(moved,"place"),"newspaper-morgue");return pyBool(__left)?pyEqual(pyAt(moved,"acted_on"),[]):__left})())),pyStr("he stands beside the investigator again, and nothing was done to him"));
assert.ok(pyBool((pyAt(moved,"conversation")===null)),pyStr("the office's exchange does not follow the party to the morgue"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_leaving_the_room_ends_it_even_if_he_comes_along"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_leaving_the_room_ends_it_even_if_he_comes_along(await acquireFixture(t,()=>knott(temporary)));});
export async function test_someone_who_said_nothing_is_not_in_it(knott:any){
(await open_turn(knott,"I look around the office."));
(await narrate(knott,"t1-c1","诺特低头看文件，一言不发。"));
(await pyMethod(knott,"table",["player_input"],{"text":"I wait."}));
assert.ok(pyBool((pyAt((await options(knott)),"conversation")===null)),"tests/kernel/test_npc_act_options.py:289 assert options(knott)[\"conversation\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_someone_who_said_nothing_is_not_in_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_someone_who_said_nothing_is_not_in_it(await acquireFixture(t,()=>knott(temporary)));});
