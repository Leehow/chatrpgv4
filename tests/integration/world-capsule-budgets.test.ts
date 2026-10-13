// Migrated from tests/kernel/test_capsule_budgets.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,CAMPAIGN,PREGEN,RpcClient,campaign_dir,create_campaign,narrate_opening,read_json,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_capsule_budgets.py',import.meta.url).pathname;




export let INVESTIGATOR:any="托马斯·海斯";

export let SECTION_BUDGETS:any=({["where"]:4096,["present"]:3072,["known"]:3072,["pressures"]:1024,["obligations"]:1024,["director"]:3072,["situations"]:1024,["memory"]:1536,["recent"]:2048,["warnings"]:1024,["voices"]:3072,["own"]:2048,["player_knows"]:2048});


export let STYLE_BUDGET_FIRST_TURN:any=2048;
export let STYLE_BUDGET_LATER:any=1536;






export let WALK:any=[["commission-briefing",["knott-commission","knott-research-leads","knott-macario-summary","knott-keys"]],["chapel-of-contemplation-ruins",["chapel-eye-symbol","chapel-cellar-remains","chapel-journal-burial","liber-ivonis-tome"]],["higher-courts-central-police",["police-raid-chapel"]],["hall-of-records",["will-executor-chapel","chapel-closed-1912"]],["central-library",["house-built-1835","neighbor-lawsuit-1852","basement-burial-lawsuit","second-lawsuit-outcome-unrecorded"]],["newspaper-morgue",["globe-unpublished-story","macario-tragedy","globe-fire-cutoff"]],["neighborhood-gossip",["dooley-macario-madness","burning-eyes-form","chapel-ruins-location"]],["previous-tenants",["vittorio-bible-weapon","gabriela-night-visitor","boys-burning-eyes"]],["corbitt-house-ground",["corbitt-diaries","upstairs-disturbance","catholic-wards","nailed-windows"]],["upper-floor-bedroom",["poltergeist-bed","blood-pool-manifest","mythos-reek"]],["basement-rites",["rusted-basement-dagger","floating-knife","hollow-boards","corbitt-body-found","ritual-dagger-is-his"]],["corbitt-confrontation",["corbitt-animates","own-dagger-ends-him","flesh-ward-active"]]];
export async function size(payload:any){
return (await pyInvoke(pyLen,[(await pyMethod((await pyMethod(json,"dumps",[payload],{"ensure_ascii":false})),"encode",["utf-8"],{}))],{}));
}
Object.defineProperty(size,"__pySignature",{value:[{"name":"payload","rest":false,"varargs":false}]});
export async function discover_everything_effects(){
let effects:any,i:any,scene:any,clues:any;
effects=[];
for([i,[scene,clues]] of pyIterable((await pyInvoke(pyEnumerate,[WALK],{})))){
if(pyBool(pyLess(0,i))){(await pyMethod(effects,"append",[({["kind"]:"move",["to"]:scene})],{}));}
(await pyMethod(effects,"extend",[(await (async()=>{const __rows:any[]=[];for(const clue of pyIterable(clues)){__rows.push(({["kind"]:"clue",["clue"]:clue}));}return __rows;})())],{}));
}
return effects;
}
Object.defineProperty(discover_everything_effects,"__pySignature",{value:[]});
export async function build_rich_state(client:any){
let world_path:any,world:any,narrated:any,job_id:any,long_statement:any,quote:any;

(await pyInvoke(create_campaign,[client],{}));
(await pyInvoke(narrate_opening,[client],{}));
world_path=pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"world.json");
world=(await pyInvoke(read_json,[world_path],{}));
world["discovered_clues"]=(await (async()=>{const __rows:any[]=[];for(const [_scene,clues] of pyIterable(WALK)){for(const clue of pyIterable(clues)){__rows.push(clue);}}return __rows;})());
(await pyMethod(world_path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
(await pyMethod(client,"table",["player_input"],{"text":"We visit the house's rooms and finally confront Corbitt in the cellar."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":(await pyInvoke(discover_everything_effects,[],{}))}));
(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c2","action":({["intent"]:"combat",["goal"]:"冲上去和科比特对决",["method"]:"举枪射击",["target"]:"Walter Corbitt",["weapon"]:".38 Revolver"})}));
narrated=(await pyInvoke(narrate,[client,"t1-c3",pyMultiply("故事的每一条线索都被翻了出来，科比特应声而起。",3)],{}));
job_id=pyAt(pyAt(narrated,"extraction"),"job_id");
long_statement=pyAdd("科比特",pyMultiply("的事情说来话长，笔记写得密密麻麻，",20));
(await pyMethod(client,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["candidates"]:(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyInvoke(pyRange,[9],{})))){__rows.push(({["kind"]:"knowledge",["subject"]:"Walter Corbitt",["entities"]:[INVESTIGATOR],["statement"]:`${i}${long_statement}`}));}return __rows;})())})],{}));
quote=pySlice(pyAt(narrated,"rendered_text"),undefined,100);
(await pyMethod(client,"ok",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:1,["lane"]:"verifier",["findings"]:(await (async()=>{const __rows:any[]=[];for(const _ of pyIterable((await pyInvoke(pyRange,[10],{})))){__rows.push(({["kind"]:"reveal",["quote"]:quote,["why"]:pyMultiply("理由说明文字",90)}));}return __rows;})())})],{}));
}
Object.defineProperty(build_rich_state,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function test_every_section_stays_within_its_budget_on_a_rich_state(kernel:any){
let capsule:any,missing:any,name:any,budget:any,truncated:any,valid_names:any;
(await pyInvoke(build_rich_state,[kernel],{}));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
missing=(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(SECTION_BUDGETS)){if(pyBool(!pyContains(capsule,name))){__rows.push(name);}}return __rows;})());
for([name,budget] of pyIterable((await pyMethod(SECTION_BUDGETS,"items",[],{})))){
if(pyBool(pyContains(missing,name))){continue;}
assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(capsule,name)],{})),budget)),pyStr([name,(await pyInvoke(size,[pyAt(capsule,name)],{})),budget]));
}
truncated=(await pyMethod(capsule,"get",["truncated",[]],{}));
valid_names=pyUnion((await pyInvoke(pySet,[SECTION_BUDGETS],{})),new Set(["style","module","reading"]));
assert.ok(pyBool(pyLessEqual((await pyInvoke(pySet,[truncated],{})),valid_names)),pyStr(truncated));
assert.ok(pyBool(pyLessEqual((await pyInvoke(pySet,[truncated],{})),(await pyInvoke(pySet,[capsule],{})))),pyStr(truncated));
if(pyBool(!pyContains(missing,"memory"))){assert.ok(pyBool(pyContains(truncated,"memory")),"tests/kernel/test_capsule_budgets.py:125 assert \"memory\" in truncated");}
if(pyBool(!pyContains(missing,"warnings"))){assert.ok(pyBool(pyContains(truncated,"warnings")),"tests/kernel/test_capsule_budgets.py:127 assert \"warnings\" in truncated");}
assert.ok(pyBool(!pyBool(missing)),pyStr(`capsule is missing sections (not implemented yet in this slice): ${missing}`));
}
Object.defineProperty(test_every_section_stays_within_its_budget_on_a_rich_state,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_every_section_stays_within_its_budget_on_a_rich_state"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_every_section_stays_within_its_budget_on_a_rich_state(await kernel(t,{}));});
export async function test_head_and_turn_are_excluded_from_the_budget_and_from_truncated(kernel:any){
let capsule:any,truncated:any;
(await pyInvoke(build_rich_state,[kernel],{}));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
truncated=(await pyMethod(capsule,"get",["truncated",[]],{}));
assert.ok(pyBool(!pyContains(truncated,"turn")),"tests/kernel/test_capsule_budgets.py:137 assert \"turn\" not in truncated");
assert.ok(pyBool(!pyContains(truncated,"head")),"tests/kernel/test_capsule_budgets.py:138 assert \"head\" not in truncated");
assert.ok(pyBool(pyContains(capsule,"turn")),"tests/kernel/test_capsule_budgets.py:140 assert \"turn\" in capsule");
}
Object.defineProperty(test_head_and_turn_are_excluded_from_the_budget_and_from_truncated,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_head_and_turn_are_excluded_from_the_budget_and_from_truncated"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_head_and_turn_are_excluded_from_the_budget_and_from_truncated(await kernel(t,{}));});
export async function test_style_budget_is_larger_on_the_first_capsule_of_a_fresh_process(tmp_path:any){
let workspace:any,first:any,first_capsule:any,second_capsule:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await pyInvoke(build_rich_state,[first],{}));
first_capsule=pyAt((await pyMethod(first,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool(pyContains(first_capsule,"style")),pyStr("capsule has no `style` section (§13.6) -- not implemented yet in this slice"));
assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(first_capsule,"style")],{})),STYLE_BUDGET_FIRST_TURN)),"tests/kernel/test_capsule_budgets.py:150 assert size(first_capsule[\"style\"]) <= STYLE_BUDGET_FIRST_TURN");
second_capsule=(await pyMethod(first,"table",["capsule"],{}));
assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(second_capsule,"style")],{})),STYLE_BUDGET_LATER)),"tests/kernel/test_capsule_budgets.py:154 assert size(second_capsule[\"style\"]) <= STYLE_BUDGET_LATER");}finally{(await pyMethod(first,"close",[],{}));}
}
Object.defineProperty(test_style_budget_is_larger_on_the_first_capsule_of_a_fresh_process,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_style_budget_is_larger_on_the_first_capsule_of_a_fresh_process"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_style_budget_is_larger_on_the_first_capsule_of_a_fresh_process(temporary);});
export async function test_style_budget_is_the_smaller_one_in_a_later_turn(kernel:any){
let later_capsule:any;
(await pyInvoke(build_rich_state,[kernel],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"继续搜查。"}));
(await pyInvoke(narrate,[kernel,"t2-c1","一无所获。"],{}));
later_capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"再搜一次。"})),"capsule");
assert.ok(pyBool(pyContains(later_capsule,"style")),pyStr("capsule has no `style` section (§13.6) -- not implemented yet in this slice"));
assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(later_capsule,"style")],{})),STYLE_BUDGET_LATER)),"tests/kernel/test_capsule_budgets.py:165 assert size(later_capsule[\"style\"]) <= STYLE_BUDGET_LATER");
}
Object.defineProperty(test_style_budget_is_the_smaller_one_in_a_later_turn,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_style_budget_is_the_smaller_one_in_a_later_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_style_budget_is_the_smaller_one_in_a_later_turn(await kernel(t,{}));});
