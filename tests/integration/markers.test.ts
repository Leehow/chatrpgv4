// Migrated from tests/kernel/test_markers.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,PREGEN,open_turn,campaign_dir,git_log,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";


export let SEARCH:any=({["intent"]:"investigate",["goal"]:"找线索",["method"]:"翻找",["skill"]:"Spot Hidden"});
export async function resolve_search(kernel:any,call_id:any="t1-c1",overrides:any={}){
return (await pyMethod(kernel,"table",["resolve"],{"call_id":call_id,"action":({...SEARCH,...overrides})}));
}
export async function test_the_kernel_hands_the_keeper_its_markers_and_they_are_names_not_receipt_ids(kernel:any){
let rolled:any,applied:any;
(await open_turn(kernel));
rolled=(await resolve_search(kernel));
assert.ok(pyBool(pyEqual(pyAt(rolled,"markers"),["check:spot-hidden"])),"tests/kernel/test_markers.py:20 assert rolled[\"markers\"] == [\"check:spot-hidden\"]");
assert.ok(pyBool(pyEqual(pyAt(rolled,"receipts"),["roll:spot-hidden-t1-c1"])),"tests/kernel/test_markers.py:23 assert rolled[\"receipts\"] == [\"roll:spot-hidden-t1-c1\"]");
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-commission",["label"]:"委托条件"}),({["kind"]:"time",["minutes"]:10})]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"markers"),["clue:knott-commission","time"])),"tests/kernel/test_markers.py:29 assert applied[\"markers\"] == [\"clue:knott-commission\", \"time\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_kernel_hands_the_keeper_its_markers_and_they_are_names_not_receipt_ids"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_kernel_hands_the_keeper_its_markers_and_they_are_names_not_receipt_ids(await kernel(t,{}));});
export async function test_a_second_roll_of_the_same_skill_is_numbered_across_calls(kernel:any){

(await open_turn(kernel));
assert.ok(pyBool(pyEqual(pyAt((await resolve_search(kernel,"t1-c1")),"markers"),["check:spot-hidden"])),"tests/kernel/test_markers.py:35 assert resolve_search(kernel, \"t1-c1\")[\"markers\"] == [\"check:spot-hidden\"]");
assert.ok(pyBool(pyEqual(pyAt((await resolve_search(kernel,"t1-c2")),"markers"),["check:spot-hidden-2"])),"tests/kernel/test_markers.py:36 assert resolve_search(kernel, \"t1-c2\")[\"markers\"] == [\"check:spot-hidden-2\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_second_roll_of_the_same_skill_is_numbered_across_calls"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_second_roll_of_the_same_skill_is_numbered_across_calls(await kernel(t,{}));});
export async function test_a_placed_marker_leaves_the_prose_and_lands_on_its_row(kernel:any){
let text:any,result:any,rows:any;
(await open_turn(kernel));
(await resolve_search(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-commission",["label"]:"委托条件"})]}));
text="你翻过桌上的纸{{check:spot-hidden}}，条款写得清楚{{clue:knott-commission}}。";
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),(await pyMethod((await pyMethod(text,"replace",["{{check:spot-hidden}}",""],{})),"replace",["{{clue:knott-commission}}",""],{})))),"tests/kernel/test_markers.py:47 assert result[\"rendered_text\"] == text.replace(\"{{check:spot-hidden}}\", \"\").replace(\"{{clue:knott-commission}}\", \"\")");
assert.ok(pyBool((await pyMethod(pyAt(result,"rendered_text"),"startswith",["你翻过桌上的纸，条款写得清楚。"],{}))),"tests/kernel/test_markers.py:48 assert result[\"rendered_text\"].startswith(\"你翻过桌上的纸，条款写得清楚。\")");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"{{")),"tests/kernel/test_markers.py:49 assert \"{{\" not in result[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),text)),"tests/kernel/test_markers.py:51 assert result[\"marked_text\"] == text");
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"mechanics"))){__rows.push([pyAt(row,"kind"),row]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"roll"),"marker"),"check:spot-hidden")),"tests/kernel/test_markers.py:54 assert rows[\"roll\"][\"marker\"] == \"check:spot-hidden\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"clue"),"marker"),"clue:knott-commission")),"tests/kernel/test_markers.py:55 assert rows[\"clue\"][\"marker\"] == \"clue:knott-commission\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_placed_marker_leaves_the_prose_and_lands_on_its_row"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_placed_marker_leaves_the_prose_and_lands_on_its_row(await kernel(t,{}));});
export async function test_a_receipt_nobody_placed_gets_a_fallback_marker_after_the_delivery(kernel:any){
let result:any,rows:any;

(await open_turn(kernel));
(await resolve_search(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:10})]}));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"你翻过桌上的纸{{check:spot-hidden}}。"}));
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),"你翻过桌上的纸{{check:spot-hidden}}。\n\n{{time}}")),"tests/kernel/test_markers.py:67 assert result[\"marked_text\"] == \"你翻过桌上的纸{{check:spot-hidden}}。\\n\\n{{time}}\"");
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"mechanics"))){__rows.push([pyAt(row,"kind"),row]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"roll"),"marker"),"check:spot-hidden")),"tests/kernel/test_markers.py:69 assert rows[\"roll\"][\"marker\"] == \"check:spot-hidden\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"time"),"marker"),"time")),"tests/kernel/test_markers.py:70 assert rows[\"time\"][\"marker\"] == \"time\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_receipt_nobody_placed_gets_a_fallback_marker_after_the_delivery"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_receipt_nobody_placed_gets_a_fallback_marker_after_the_delivery(await kernel(t,{}));});
export async function test_a_delivery_with_no_explicit_marker_appends_every_mechanic_without_changing_prose(kernel:any){
let text:any,result:any;
(await open_turn(kernel));
(await resolve_search(kernel));
text="你翻过桌上的纸，什么也没找到。";
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),text)),"tests/kernel/test_markers.py:78 assert result[\"rendered_text\"] == text");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),`${text}\n\n{{check:spot-hidden}}`)),"tests/kernel/test_markers.py:79 assert result[\"marked_text\"] == f\"{text}\\n\\n{{{{check:spot-hidden}}}}\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"mechanics"))){__rows.push(pyAt(row,"marker"));}return __rows;})()),["check:spot-hidden"])),"tests/kernel/test_markers.py:80 assert [row[\"marker\"] for row in result[\"mechanics\"]] == [\"check:spot-hidden\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_delivery_with_no_explicit_marker_appends_every_mechanic_without_changing_prose"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_delivery_with_no_explicit_marker_appends_every_mechanic_without_changing_prose(await kernel(t,{}));});
export async function test_a_marker_naming_no_receipt_is_dropped_not_refused(kernel:any){
let result:any,dropped:any;

(await open_turn(kernel));
(await resolve_search(kernel));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"你翻过桌上的纸{{check:library-use}}，指尖沾了灰{{check:spot-hidden}}。"}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"你翻过桌上的纸，指尖沾了灰。")),"tests/kernel/test_markers.py:90 assert result[\"rendered_text\"] == \"你翻过桌上的纸，指尖沾了灰。\"");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"{{")),"tests/kernel/test_markers.py:91 assert \"{{\" not in result[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),"你翻过桌上的纸，指尖沾了灰{{check:spot-hidden}}。")),"tests/kernel/test_markers.py:92 assert result[\"marked_text\"] == \"你翻过桌上的纸，指尖沾了灰{{check:spot-hidden}}。\"");
dropped=pyAt(result,"dropped_markers");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(dropped,"unknown"),["check:library-use"]);return pyBool(__left)?!pyContains(dropped,"duplicate"):__left})())),"tests/kernel/test_markers.py:94 assert dropped[\"unknown\"] == [\"check:library-use\"] and \"duplicate\" not in dropped");
assert.ok(pyBool(pyContains(pyAt(dropped,"markers"),"check:spot-hidden")),"tests/kernel/test_markers.py:95 assert \"check:spot-hidden\" in dropped[\"markers\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"mechanics"))){if(pyBool(pyEqual(pyAt(row,"kind"),"roll"))){__rows.push((await pyMethod(row,"get",["marker"],{})));}}return __rows;})()),["check:spot-hidden"])),"tests/kernel/test_markers.py:96 assert [row.get(\"marker\") for row in result[\"mechanics\"] if row[\"kind\"] == \"roll\"] == [\"check:spot-hidden\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_marker_naming_no_receipt_is_dropped_not_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_marker_naming_no_receipt_is_dropped_not_refused(await kernel(t,{}));});
export async function test_only_the_first_placement_of_a_marker_stands(kernel:any){
let result:any;
(await open_turn(kernel));
(await resolve_search(kernel));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"你翻过桌上的纸{{check:spot-hidden}}，又翻了一遍{{check:spot-hidden}}。"}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"你翻过桌上的纸，又翻了一遍。")),"tests/kernel/test_markers.py:104 assert result[\"rendered_text\"] == \"你翻过桌上的纸，又翻了一遍。\"");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),"你翻过桌上的纸{{check:spot-hidden}}，又翻了一遍。")),"tests/kernel/test_markers.py:105 assert result[\"marked_text\"] == \"你翻过桌上的纸{{check:spot-hidden}}，又翻了一遍。\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"dropped_markers"),"duplicate"),["check:spot-hidden"])),"tests/kernel/test_markers.py:106 assert result[\"dropped_markers\"][\"duplicate\"] == [\"check:spot-hidden\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_the_first_placement_of_a_marker_stands"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_the_first_placement_of_a_marker_stands(await kernel(t,{}));});
export async function test_a_delivery_whose_markers_all_miss_still_reaches_the_player(kernel:any){
let result:any;

(await open_turn(kernel));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"{{scene:corbitt-house-ground}}你站在人行道上{{item}}。"}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"你站在人行道上。")),"tests/kernel/test_markers.py:114 assert result[\"rendered_text\"] == \"你站在人行道上。\"");
assert.ok(pyBool(!pyContains(result,"marked_text")),"tests/kernel/test_markers.py:115 assert \"marked_text\" not in result");
assert.ok(pyBool(pyEqual((await pySorted(pyAt(pyAt(result,"dropped_markers"),"unknown"))),["item","scene:corbitt-house-ground"])),"tests/kernel/test_markers.py:116 assert sorted(result[\"dropped_markers\"][\"unknown\"]) == [\"item\", \"scene:corbitt-house-ground\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_delivery_whose_markers_all_miss_still_reaches_the_player"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_delivery_whose_markers_all_miss_still_reaches_the_player(await kernel(t,{}));});
export async function test_a_delivery_of_a_marker_and_latin_prose_is_delivered_on_a_zh_hans_table(kernel:any){
let done:any;

(await open_turn(kernel));
(await resolve_search(kernel));
done=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"{{check:spot-hidden}} nothing but english"}));
assert.ok(pyBool(pyEqual(pyAt(done,"rendered_text"),"nothing but english")),"tests/kernel/test_markers.py:125 assert done[\"rendered_text\"] == \"nothing but english\"");
assert.ok(pyBool(pyEqual(pyAt(done,"marked_text"),"{{check:spot-hidden}} nothing but english")),"tests/kernel/test_markers.py:126 assert done[\"marked_text\"] == \"{{check:spot-hidden}} nothing but english\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_delivery_of_a_marker_and_latin_prose_is_delivered_on_a_zh_hans_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_delivery_of_a_marker_and_latin_prose_is_delivered_on_a_zh_hans_table(await kernel(t,{}));});
export async function test_ask_places_markers_the_same_way(kernel:any){
let result:any;
(await open_turn(kernel));
(await resolve_search(kernel));
result=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c3","prompt":"你接下来做什么？","options":["再翻一遍","去问诺特"],"text":"你翻过桌上的纸{{check:spot-hidden}}。"}));
assert.ok(pyBool((await pyMethod(pyAt(result,"rendered_text"),"startswith",["你翻过桌上的纸。"],{}))),"tests/kernel/test_markers.py:135 assert result[\"rendered_text\"].startswith(\"你翻过桌上的纸。\")");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),"你翻过桌上的纸{{check:spot-hidden}}。")),"tests/kernel/test_markers.py:136 assert result[\"marked_text\"] == \"你翻过桌上的纸{{check:spot-hidden}}。\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"mechanics"),0),"marker"),"check:spot-hidden")),"tests/kernel/test_markers.py:137 assert result[\"mechanics\"][0][\"marker\"] == \"check:spot-hidden\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ask_places_markers_the_same_way"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ask_places_markers_the_same_way(await kernel(t,{}));});
export async function test_a_mechanics_ask_without_story_text_still_places_every_row(kernel:any){
let result:any;
(await open_turn(kernel));
(await resolve_search(kernel));
result=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c3","kind":"mechanics","binds":"check:spot-hidden","options":["accept"]}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"")),"tests/kernel/test_markers.py:145 assert result[\"rendered_text\"] == \"\"");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),"{{check:spot-hidden}}")),"tests/kernel/test_markers.py:146 assert result[\"marked_text\"] == \"{{check:spot-hidden}}\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"mechanics"),0),"marker"),"check:spot-hidden")),"tests/kernel/test_markers.py:147 assert result[\"mechanics\"][0][\"marker\"] == \"check:spot-hidden\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_mechanics_ask_without_story_text_still_places_every_row"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_mechanics_ask_without_story_text_still_places_every_row(await kernel(t,{}));});
export async function test_the_turn_record_keeps_both_readings(kernel:any){
let text:any,record:any;


(await open_turn(kernel));
(await resolve_search(kernel));
text="你翻过桌上的纸{{check:spot-hidden}}。";
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
record=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
assert.ok(pyBool(pyEqual(pyAt(record,"rendered_text"),(await pyMethod(text,"replace",["{{check:spot-hidden}}",""],{})))),"tests/kernel/test_markers.py:158 assert record[\"rendered_text\"] == text.replace(\"{{check:spot-hidden}}\", \"\")");
assert.ok(pyBool((await pyMethod(pyAt(record,"rendered_text"),"startswith",["你翻过桌上的纸。"],{}))),"tests/kernel/test_markers.py:159 assert record[\"rendered_text\"].startswith(\"你翻过桌上的纸。\")");
assert.ok(pyBool(pyEqual(pyAt(record,"marked_text"),text)),"tests/kernel/test_markers.py:160 assert record[\"marked_text\"] == text");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_turn_record_keeps_both_readings"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_turn_record_keeps_both_readings(await kernel(t,{}));});
export async function test_the_commit_subject_is_minted_from_the_rendered_text(kernel:any){
let subjects:any;


(await open_turn(kernel));
(await resolve_search(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:10})]}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"你翻过桌上的纸{{check:spot-hidden}}，十分钟很快耗尽。{{time}}"}));
subjects=(await git_log(kernel.workspace));
assert.ok(pyBool((await pyMethod(pyAt(subjects,0),"startswith",["turn 1: 你翻过桌上的纸，十分钟很快耗尽。"],{}))),"tests/kernel/test_markers.py:171 assert subjects[0].startswith(\"turn 1: 你翻过桌上的纸，十分钟很快耗尽。\")");
assert.ok(pyBool(!pyContains(pyAt(subjects,0),"{{")),"tests/kernel/test_markers.py:172 assert \"{{\" not in subjects[0]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_commit_subject_is_minted_from_the_rendered_text"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_commit_subject_is_minted_from_the_rendered_text(await kernel(t,{}));});
export async function test_a_marker_alone_on_its_line_leaves_no_blank_paragraph(kernel:any){
let text:any,result:any;

(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:10})]}));
text="你翻过桌上的纸。\n\n{{time}}\n\n窗外的光挪到了另一面墙上。";
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":text}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"你翻过桌上的纸。\n\n窗外的光挪到了另一面墙上。")),"tests/kernel/test_markers.py:182 assert result[\"rendered_text\"] == \"你翻过桌上的纸。\\n\\n窗外的光挪到了另一面墙上。\"");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"\n\n\n")),"tests/kernel/test_markers.py:183 assert \"\\n\\n\\n\" not in result[\"rendered_text\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_marker_alone_on_its_line_leaves_no_blank_paragraph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_marker_alone_on_its_line_leaves_no_blank_paragraph(await kernel(t,{}));});
export async function test_a_translated_marker_never_reaches_the_rendered_text(kernel:any){
let result:any;

(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:10})]}));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"她朝上应了一声。{{时间}}脚步一阶一阶响上去。"}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(result,"rendered_text"),"{{");return pyBool(__left)?!pyContains(pyAt(result,"rendered_text"),"}}"):__left})())),"tests/kernel/test_markers.py:192 assert \"{{\" not in result[\"rendered_text\"] and \"}}\" not in result[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"她朝上应了一声。脚步一阶一阶响上去。")),"tests/kernel/test_markers.py:193 assert result[\"rendered_text\"] == \"她朝上应了一声。脚步一阶一阶响上去。\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_translated_marker_never_reaches_the_rendered_text"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_translated_marker_never_reaches_the_rendered_text(await kernel(t,{}));});
