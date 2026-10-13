// Migrated from tests/kernel/test_npc_coercion.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,open_turn,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";



export let HAYES:any="thomas-hayes";
export async function pressing(tmp_path:any,psychology:any=null){
let client:any=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"4"})})));
(await open_turn(client,"I lean over his desk."));
if(pyBool((psychology!==null))){let path:any=pyDivide(pyDivide((await campaign_dir(client.workspace)),"party"),`${HAYES}.json`);
let sheet:any=(await read_json(path));
(await pyMethod(sheet,"setdefault",["skills",({})],{}))["Psychology"]=psychology;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false}))],{"encoding":"utf-8"}));}
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["skill"]:({["name"]:"Intimidate",["value"]:60}),["why"]:"a landlord used to bullying tenants"})]}));
let pressed:any=(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c2","action":({["actor"]:"Steven Knott",["intent"]:"social",["skill"]:"Intimidate",["target"]:"Thomas Hayes",["goal"]:"make him back off",["method"]:"slams the ledger down"})}));
let roll:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),"t1-c2"):__left})())))__rows.push(r);}return __rows;})())));
return [client,pressed,roll];
}
export async function test_a_pressed_investigator_is_a_receipt_and_the_opposing_skill_sets_the_difficulty(tmp_path:any){
const __unpack2003=(await pressing(tmp_path));let client:any=__unpack2003[0];let pressed:any=__unpack2003[1];let roll:any=__unpack2003[2];
try{assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pressed,"decision"),"core-check:ordinary-check");return pyBool(__left)?pyEqual(pyAt(roll,"skill"),"Intimidate"):__left})());return pyBool(__left)?(pyAt(roll,"actor_is_investigator")===false):__left})())),"tests/kernel/test_npc_coercion.py:36 assert pressed[\"decision\"] == \"core-check:ordinary-check\" and roll[\"skill\"] == \"Intimidate\" and roll[\"actor_is_investigator\"] is False");
assert.ok(pyBool(pyEqual(pyAt(roll,"difficulty"),"regular")),pyStr("Hayes's Intimidate and Psychology are both under 50"));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(pyAt(roll,"coercion"),"pressed")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(roll,"coercion"),"investigator"),HAYES):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(roll,"coercion"),"npc"),"steven-knott"):__left})())),"tests/kernel/test_npc_coercion.py:38 assert roll[\"coercion\"][\"pressed\"] is True and roll[\"coercion\"][\"investigator\"] == HAYES and roll[\"coercion\"][\"npc\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual(pyAt(pressed,"coercion"),pyAt(roll,"coercion"))),"tests/kernel/test_npc_coercion.py:39 assert pressed[\"coercion\"] == roll[\"coercion\"]");
const __unpack2506=(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(client,"table",["capsule"],{})),"pressures"))){if(pyBool(pyEqual((await pyMethod(p,"get",["kind"],{})),"coercion")))__rows.push(p);}return __rows;})());let row:any=__unpack2506[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"receipt"),pyAt(roll,"id"));return pyBool(__left)?pyContains(pyAt(row,"cue"),"penalty die"):__left})())),"tests/kernel/test_npc_coercion.py:41 assert row[\"receipt\"] == roll[\"id\"] and \"penalty die\" in row[\"cue\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pressed_investigator_is_a_receipt_and_the_opposing_skill_sets_the_difficulty"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pressed_investigator_is_a_receipt_and_the_opposing_skill_sets_the_difficulty(temporary);});
export async function test_a_higher_opposing_psychology_makes_it_hard(tmp_path:any){
const __unpack2776=(await pressing(tmp_path,60));let client:any=__unpack2776[0];let _pressed:any=__unpack2776[1];let roll:any=__unpack2776[2];
try{assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(roll,"difficulty"),"hard");return pyBool(__left)?pyEqual(pyAt(roll,"threshold"),30):__left})())),"tests/kernel/test_npc_coercion.py:49 assert roll[\"difficulty\"] == \"hard\" and roll[\"threshold\"] == 30");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_higher_opposing_psychology_makes_it_hard"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_higher_opposing_psychology_makes_it_hard(temporary);});
export async function test_a_refusal_spends_one_penalty_die_on_one_roll_once(tmp_path:any){
const __unpack3028=(await pressing(tmp_path));let client:any=__unpack3028[0];let _pressed:any=__unpack3028[1];let roll:any=__unpack3028[2];
try{let spent:any=(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c3","action":({["intent"]:"investigate",["skill"]:"Spot Hidden",["coercion"]:pyAt(roll,"id"),["goal"]:"find the back door",["method"]:"scan the room while Knott glares"})}));
assert.ok(pyBool(pyEqual(pyAt(spent,"decision"),"core-check:ordinary-check")),"tests/kernel/test_npc_coercion.py:59 assert spent[\"decision\"] == \"core-check:ordinary-check\"");
let second:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),"t1-c3"):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(second,"penalty"),1);return pyBool(__left)?pyEqual(pyAt(second,"coercion_spent"),pyAt(roll,"id")):__left})())),"tests/kernel/test_npc_coercion.py:61 assert second[\"penalty\"] == 1 and second[\"coercion_spent\"] == roll[\"id\"]");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(client,"table",["capsule"],{})),"pressures"))){if(pyBool(pyEqual((await pyMethod(p,"get",["kind"],{})),"coercion")))__rows.push(p);}return __rows;})()))),pyStr("spent: it presses no more"));
let again:any=(await pyMethod(client,"table_err",["resolve"],{"call_id":"t1-c4","action":({["intent"]:"investigate",["skill"]:"Spot Hidden",["coercion"]:pyAt(roll,"id"),["goal"]:"look again",["method"]:"look again"})}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(again,"details"),"reason"),"coercion_unavailable")),"tests/kernel/test_npc_coercion.py:65 assert again[\"details\"][\"reason\"] == \"coercion_unavailable\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_refusal_spends_one_penalty_die_on_one_roll_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_refusal_spends_one_penalty_die_on_one_roll_once(temporary);});
export async function test_the_penalty_die_falls_on_the_coerced_investigators_own_roll(tmp_path:any){
const __unpack4207=(await pressing(tmp_path));let client:any=__unpack4207[0];let _pressed:any=__unpack4207[1];let roll:any=__unpack4207[2];
try{let refused:any=(await pyMethod(client,"table_err",["resolve"],{"call_id":"t1-c3","action":({["actor"]:"Steven Knott",["intent"]:"investigate",["skill"]:"Spot Hidden",["coercion"]:pyAt(roll,"id"),["goal"]:"watch him",["method"]:"watch him"})}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(refused,"details"),"field"),"action.coercion")),"tests/kernel/test_npc_coercion.py:75 assert refused[\"details\"][\"field\"] == \"action.coercion\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_penalty_die_falls_on_the_coerced_investigators_own_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_penalty_die_falls_on_the_coerced_investigators_own_roll(temporary);});
