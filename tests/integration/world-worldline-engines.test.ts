// Migrated from tests/kernel/test_worldline_engines.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,CONFRONTATION_PATH,first_failure,first_success,resolve,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
import {fork,switchValue,turn_json} from "./world-worldline.test.ts";
const __file__=new URL('../../tests/kernel/test_worldline_engines.py',import.meta.url).pathname;






export let INVESTIGATOR:any="thomas-hayes";
export let ENGINE_CONFLICT:any="conflict:engine_state:engines:snapshot";
export async function save_state(client:any,engine:any){
let path:any;

path=pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),engine),`${INVESTIGATOR}.json`);
return (pyBool((await pyMethod(path,"exists",[],{})))?(await pyInvoke(read_json,[path],{})):({}));
}
Object.defineProperty(save_state,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"engine","rest":false,"varargs":false}]});
export async function sheet_of(client:any){
return (await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"party"),`${INVESTIGATOR}.json`)],{}));
}
Object.defineProperty(sheet_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function merge_err(client:any,call:any,lines:any,extra:any={}){
return (await pyMethod(client,"table_err",["apply"],{"call_id":call,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:lines,...extra})]}));
}
Object.defineProperty(merge_err,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call","rest":false,"varargs":false},{"name":"lines","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function merge(client:any,call:any,lines:any,extra:any={}){
return (await pyMethod(client,"table",["apply"],{"call_id":call,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:lines,...extra})]}));
}
Object.defineProperty(merge,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call","rest":false,"varargs":false},{"name":"lines","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function one_line_went_mad(client:any){
let turn:any,call:any,scene:any,checked:any;

(await pyInvoke(create_campaign,[client],{}));
(await pyInvoke(narrate_opening,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我先在办公室里坐了一会儿。"}));
(await pyInvoke(narrate,[client,"t1-c1","你在诺特的办公室里坐了一会儿。"],{}));
(await pyInvoke(fork,[client,2,"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[client],{})),"turn");
(await pyMethod(client,"table",["player_input"],{"text":"我们直接去老宅，下到地窖。"}));
call=1;
for(scene of pyIterable(CONFRONTATION_PATH)){
(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c${call}`,"effects":[({["kind"]:"move",["to"]:scene})]}));
call+=1;
}
checked=(await pyInvoke(resolve,[client,`t${turn}-c${call}`],{"intent":"investigate","goal":"看见科比特的尸体动了","method":"","target":"Walter Corbitt","decision":"sanity:check","involuntary":({["kind"]:"freeze",["summary"]:"手电筒的光柱僵在原地"})}));
assert.ok(pyBool((pyAt(pyAt(checked,"outcome"),"temporary_insane")===true)),"tests/kernel/test_worldline_engines.py:77 assert checked[\"outcome\"][\"temporary_insane\"] is True");
call+=1;
while(pyBool((await pyMethod((await pyInvoke(save_state,[client,"sanity-state"],{})),"get",["bout_active"],{})))){(await pyInvoke(resolve,[client,`t${turn}-c${call}`],{"intent":"montage","goal":"等这阵过去","method":"","decision":"sanity:bout-end"}));
call+=1;}
(await pyInvoke(narrate,[client,`t${turn}-c${call}`,"他坐了起来，你僵在原地。"],{}));
(await pyInvoke(switchValue,[client,pyAt((await pyInvoke(turn_json,[client],{})),"turn"),"main"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"把两条线并起来。"}));
}
Object.defineProperty(one_line_went_mad,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function test_a_line_whose_investigator_went_mad_does_not_merge_away_in_silence(seeded_one:any){
let turn:any,error:any,conflicts:any,only:any,san:any;

(await pyInvoke(one_line_went_mad,[seeded_one],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_one],{})),"turn");
error=(await pyInvoke(merge_err,[seeded_one,`t${turn}-c1`,["main","side"]],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_worldline_engines.py:96 assert error[\"code\"] == \"needs\"");
conflicts=pyAt(pyAt(error,"details"),"conflicts");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(conflicts)){__rows.push(pyAt(row,"id"));}return __rows;})()),[ENGINE_CONFLICT])),"tests/kernel/test_worldline_engines.py:98 assert [row[\"id\"] for row in conflicts] == [ENGINE_CONFLICT]");
only=pyAt(conflicts,0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(only,"class"),"engine_state");return pyBool(__left)?pyEqual(pyAt(only,"modes"),["from"]):__left})())),"tests/kernel/test_worldline_engines.py:100 assert only[\"class\"] == \"engine_state\" and only[\"modes\"] == [\"from\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(only,"values"),"main"),"save"),({}))),"tests/kernel/test_worldline_engines.py:102 assert only[\"values\"][\"main\"][\"save\"] == {}");
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[pyAt(pyAt(pyAt(only,"values"),"side"),"save")],{})),[`save/sanity-state/${INVESTIGATOR}.json`])),"tests/kernel/test_worldline_engines.py:103 assert list(only[\"values\"][\"side\"][\"save\"]) == [f\"save/sanity-state/{INVESTIGATOR}.json\"]");
san=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [line,view] of pyIterable((await pyMethod(pyAt(only,"values"),"items",[],{})))){__rows.push([line,pyAt(pyAt(pyAt(view,"sheet"),INVESTIGATOR),"current_san")]);}return __rows;})()));
assert.ok(pyBool(pyLess(pyAt(san,"side"),pyAt(san,"main"))),"tests/kernel/test_worldline_engines.py:107 assert san[\"side\"] < san[\"main\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(save_state,[seeded_one,"sanity-state"],{})),({}))),"tests/kernel/test_worldline_engines.py:109 assert save_state(seeded_one, \"sanity-state\") == {}");
assert.ok(pyBool(!pyContains(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[seeded_one.workspace],{})),"campaign.json")],{})),"worldlines"),"joined")),"tests/kernel/test_worldline_engines.py:110 assert \"joined\" not in read_json(campaign_dir(seeded_one.workspace) / \"campaign.json\")[\"worldlines\"]");
}
Object.defineProperty(test_a_line_whose_investigator_went_mad_does_not_merge_away_in_silence,"__pySignature",{value:[{"name":"seeded_one","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_line_whose_investigator_went_mad_does_not_merge_away_in_silence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_line_whose_investigator_went_mad_does_not_merge_away_in_silence(await kernel(t,{env:{COC_KERNEL_SEED:'1'}}));});
export async function test_the_madness_lands_on_disk_when_the_keeper_takes_the_line_that_holds_it(seeded_one:any){
let turn:any,conflict:any,san:any,state:any;

(await pyInvoke(one_line_went_mad,[seeded_one],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_one],{})),"turn");
conflict=pyAt(pyAt(pyAt((await pyInvoke(merge_err,[seeded_one,`t${turn}-c1`,["main","side"]],{})),"details"),"conflicts"),0);
san=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [line,view] of pyIterable((await pyMethod(pyAt(conflict,"values"),"items",[],{})))){__rows.push([line,pyAt(pyAt(pyAt(view,"sheet"),INVESTIGATOR),"current_san")]);}return __rows;})()));
(await pyInvoke(merge,[seeded_one,`t${turn}-c2`,["main","side"]],{"dispositions":({[ENGINE_CONFLICT]:({["mode"]:"from",["line"]:"side"})})}));
(await pyInvoke(narrate,[seeded_one,`t${turn}-c3`,"两条线合到了一起，他还在发抖。"],{}));
state=(await pyInvoke(save_state,[seeded_one,"sanity-state"],{}));
assert.ok(pyBool(((await pyMethod(state,"get",["temporary_insane"],{}))===true)),"tests/kernel/test_worldline_engines.py:126 assert state.get(\"temporary_insane\") is True");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const bout of pyIterable(pyAt(state,"bouts_of_madness"))){__rows.push(pyAt(bout,"bout_kind"));}return __rows;})()),["flee"])),"tests/kernel/test_worldline_engines.py:127 assert [bout[\"bout_kind\"] for bout in state[\"bouts_of_madness\"]] == [\"flee\"]");
assert.ok(pyBool(pyEqual(pyAt(state,"san_current"),pyAt(san,"side"))),"tests/kernel/test_worldline_engines.py:128 assert state[\"san_current\"] == san[\"side\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(sheet_of,[seeded_one],{})),"current_san"),pyAt(san,"side"))),"tests/kernel/test_worldline_engines.py:130 assert sheet_of(seeded_one)[\"current_san\"] == san[\"side\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(seeded_one,"table",["look"],{"focus":"investigator"})),"san"),pyAt(san,"side"))),"tests/kernel/test_worldline_engines.py:131 assert seeded_one.table(\"look\", focus=\"investigator\")[\"san\"] == san[\"side\"]");
}
Object.defineProperty(test_the_madness_lands_on_disk_when_the_keeper_takes_the_line_that_holds_it,"__pySignature",{value:[{"name":"seeded_one","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_madness_lands_on_disk_when_the_keeper_takes_the_line_that_holds_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_madness_lands_on_disk_when_the_keeper_takes_the_line_that_holds_it(await kernel(t,{env:{COC_KERNEL_SEED:'1'}}));});
export async function test_taking_the_line_that_kept_its_mind_removes_the_other_line_s_snapshot(seeded_one:any){
let turn:any,conflict:any,san:any;

(await pyInvoke(one_line_went_mad,[seeded_one],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_one],{})),"turn");
conflict=pyAt(pyAt(pyAt((await pyInvoke(merge_err,[seeded_one,`t${turn}-c1`,["side","main"]],{})),"details"),"conflicts"),0);
san=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [line,view] of pyIterable((await pyMethod(pyAt(conflict,"values"),"items",[],{})))){__rows.push([line,pyAt(pyAt(pyAt(view,"sheet"),INVESTIGATOR),"current_san")]);}return __rows;})()));
(await pyInvoke(merge,[seeded_one,`t${turn}-c2`,["side","main"]],{"dispositions":({[ENGINE_CONFLICT]:({["mode"]:"from",["line"]:"main"})})}));
(await pyInvoke(narrate,[seeded_one,`t${turn}-c3`,"两条线合到了一起，他从没见过那具尸体。"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(save_state,[seeded_one,"sanity-state"],{})),({}))),"tests/kernel/test_worldline_engines.py:147 assert save_state(seeded_one, \"sanity-state\") == {}");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(sheet_of,[seeded_one],{})),"current_san"),pyAt(san,"main"))),"tests/kernel/test_worldline_engines.py:148 assert sheet_of(seeded_one)[\"current_san\"] == san[\"main\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(seeded_one,"table",["look"],{"focus":"investigator"})),"san"),pyAt(san,"main"))),"tests/kernel/test_worldline_engines.py:149 assert seeded_one.table(\"look\", focus=\"investigator\")[\"san\"] == san[\"main\"]");
}
Object.defineProperty(test_taking_the_line_that_kept_its_mind_removes_the_other_line_s_snapshot,"__pySignature",{value:[{"name":"seeded_one","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_taking_the_line_that_kept_its_mind_removes_the_other_line_s_snapshot"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_taking_the_line_that_kept_its_mind_removes_the_other_line_s_snapshot(await kernel(t,{env:{COC_KERNEL_SEED:'1'}}));});
export async function test_a_tick_only_one_line_earned_is_a_disagreement_no_sheet_can_show(seeded_kernel:any){
let turn:any,found:any,_:any,conflicts:any,values:any;

(await pyInvoke(open_turn,[seeded_kernel,"我先四下看看。"],{}));
(await pyInvoke(narrate,[seeded_kernel,"t1-c1","没什么特别的。"],{}));
(await pyInvoke(fork,[seeded_kernel,2,"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_kernel],{})),"turn");
(await pyMethod(seeded_kernel,"table",["player_input"],{"text":"我仔细找那个暗格。"}));
const __unpack8855=(await pyInvoke(first_success,[seeded_kernel,`t${turn}-c`],{"intent":"investigate","goal":"找到暗格","method":"用侦查"}));found=__unpack8855[0];_=__unpack8855[1];
(await pyInvoke(narrate,[seeded_kernel,`t${turn}-c${pyAdd((await pyInvoke(pyInt,[pyAt((await pyMethod(found,"split",["-c"],{})),1)],{})),1)}`,"你摸到了一道缝。"],{}));
assert.ok(pyBool(pyAt((await pyInvoke(save_state,[seeded_kernel,"development-state"],{})),"ticks")),"tests/kernel/test_worldline_engines.py:165 assert save_state(seeded_kernel, \"development-state\")[\"ticks\"]");
(await pyInvoke(switchValue,[seeded_kernel,pyAt((await pyInvoke(turn_json,[seeded_kernel],{})),"turn"),"main"],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_kernel],{})),"turn");
(await pyMethod(seeded_kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflicts=pyAt(pyAt((await pyInvoke(merge_err,[seeded_kernel,`t${turn}-c1`,["main","side"]],{})),"details"),"conflicts");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(conflicts)){__rows.push(pyAt(row,"id"));}return __rows;})()),[ENGINE_CONFLICT])),"tests/kernel/test_worldline_engines.py:171 assert [row[\"id\"] for row in conflicts] == [ENGINE_CONFLICT]");
values=pyAt(pyAt(conflicts,0),"values");
assert.ok(pyBool(pyEqual(pyAt(pyAt(values,"main"),"sheet"),pyAt(pyAt(values,"side"),"sheet"))),"tests/kernel/test_worldline_engines.py:174 assert values[\"main\"][\"sheet\"] == values[\"side\"][\"sheet\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(values,"main"),"save"),({}))),"tests/kernel/test_worldline_engines.py:175 assert values[\"main\"][\"save\"] == {}");
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[pyAt(pyAt(values,"side"),"save")],{})),[`save/development-state/${INVESTIGATOR}.json`])),"tests/kernel/test_worldline_engines.py:176 assert list(values[\"side\"][\"save\"]) == [f\"save/development-state/{INVESTIGATOR}.json\"]");
(await pyInvoke(merge,[seeded_kernel,`t${turn}-c2`,["main","side"]],{"dispositions":({[ENGINE_CONFLICT]:({["mode"]:"from",["line"]:"side"})})}));
(await pyInvoke(narrate,[seeded_kernel,`t${turn}-c3`,"两条线合到了一起。"],{}));
assert.ok(pyBool(pyAt((await pyInvoke(save_state,[seeded_kernel,"development-state"],{})),"ticks")),"tests/kernel/test_worldline_engines.py:181 assert save_state(seeded_kernel, \"development-state\")[\"ticks\"]");
}
Object.defineProperty(test_a_tick_only_one_line_earned_is_a_disagreement_no_sheet_can_show,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_tick_only_one_line_earned_is_a_disagreement_no_sheet_can_show"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_tick_only_one_line_earned_is_a_disagreement_no_sheet_can_show(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_luck_is_still_a_numeric_conflict_because_no_engine_keeps_it(seeded_kernel:any){
let failed_id:any,_:any,turn:any,call:any,spent:any,conflicts:any,only:any;

(await pyInvoke(open_turn,[seeded_kernel,"我搜。"],{}));
const __unpack10399=(await pyInvoke(first_failure,[seeded_kernel,"t1-c"],{"intent":"investigate","goal":"找到暗格","method":"用侦查","modifiers":({["difficulty"]:"hard"})}));failed_id=__unpack10399[0];_=__unpack10399[1];
(await pyInvoke(narrate,[seeded_kernel,`t1-c${pyAdd((await pyInvoke(pyInt,[pyAt((await pyMethod(failed_id,"split",["-c"],{})),1)],{})),1)}`,"暗格没有找到。"],{}));
(await pyInvoke(fork,[seeded_kernel,2,"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_kernel],{})),"turn");
(await pyMethod(seeded_kernel,"table",["player_input"],{"text":"我再搜一次，这次赌运气。"}));
const __unpack10794=(await pyInvoke(first_failure,[seeded_kernel,`t${turn}-c`],{"intent":"investigate","goal":"找到暗格","method":"用侦查","modifiers":({["difficulty"]:"hard"})}));failed_id=__unpack10794[0];_=__unpack10794[1];
call=(await pyInvoke(pyInt,[pyAt((await pyMethod(failed_id,"split",["-c"],{})),1)],{}));
spent=(await pyInvoke(resolve,[seeded_kernel,`t${turn}-c${pyAdd(call,1)}`],{"intent":"investigate","goal":"找到暗格","method":"用侦查","luck":3}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(spent,"outcome"),"kind"),"luck")),"tests/kernel/test_worldline_engines.py:201 assert spent[\"outcome\"][\"kind\"] == \"luck\"");
(await pyInvoke(narrate,[seeded_kernel,`t${turn}-c${pyAdd(call,2)}`,"你花了 3 点运气，暗格还是没有找到。"],{}));
(await pyInvoke(switchValue,[seeded_kernel,pyAt((await pyInvoke(turn_json,[seeded_kernel],{})),"turn"),"main"],{}));
turn=pyAt((await pyInvoke(turn_json,[seeded_kernel],{})),"turn");
(await pyMethod(seeded_kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflicts=pyAt(pyAt((await pyInvoke(merge_err,[seeded_kernel,`t${turn}-c1`,["main","side"]],{})),"details"),"conflicts");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(conflicts)){__rows.push(pyAt(row,"id"));}return __rows;})()),[`conflict:numeric:${INVESTIGATOR}:luck`])),"tests/kernel/test_worldline_engines.py:208 assert [row[\"id\"] for row in conflicts] == [f\"conflict:numeric:{INVESTIGATOR}:luck\"]");
only=pyAt(conflicts,0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(only,"modes"),["from","min","max"]);return pyBool(__left)?pyEqual(pyAt(only,"sheet_field"),"current_luck"):__left})())),"tests/kernel/test_worldline_engines.py:210 assert only[\"modes\"] == [\"from\", \"min\", \"max\"] and only[\"sheet_field\"] == \"current_luck\"");
assert.ok(pyBool(pyEqual(pySubtract(pyAt(pyAt(only,"values"),"main"),pyAt(pyAt(only,"values"),"side")),3)),"tests/kernel/test_worldline_engines.py:211 assert only[\"values\"][\"main\"] - only[\"values\"][\"side\"] == 3");
(await pyInvoke(merge,[seeded_kernel,`t${turn}-c2`,["main","side"]],{"dispositions":({[pyAt(only,"id")]:({["mode"]:"min"})})}));
(await pyInvoke(narrate,[seeded_kernel,`t${turn}-c3`,"两条线合到了一起。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(sheet_of,[seeded_kernel],{})),"current_luck"),pyAt(pyAt(only,"values"),"side"))),"tests/kernel/test_worldline_engines.py:214 assert sheet_of(seeded_kernel)[\"current_luck\"] == only[\"values\"][\"side\"]");
}
Object.defineProperty(test_luck_is_still_a_numeric_conflict_because_no_engine_keeps_it,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_luck_is_still_a_numeric_conflict_because_no_engine_keeps_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_luck_is_still_a_numeric_conflict_because_no_engine_keeps_it(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
