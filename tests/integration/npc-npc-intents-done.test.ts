// Migrated from tests/kernel/test_npc_intents_done.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,narrate,open_turn,resolve,resolve_err,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export let KNOTT:any="Steven Knott";
export let FIX:any="a table act that rolled nothing is not done by saying so: abandon it (intent_outcome: abandoned), or let the dice settle it";
export let PHONE:any="诺特一把抓起电话听筒，拇指压在叉簧上，盯着海斯。";
export async function* knott(tmp_path:any){
let client:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
(await open_turn(client,"I square up to Knott."));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:KNOTT,["archetype"]:"ordinary_adult",["why"]:"an office man"})]}));
yield client;
(await pyMethod(client,"close",[],{}));
}
export async function receipts(client:any){
return pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
}
export async function ref_of(client:any,line:any){
return pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(client)))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"npc");return pyBool(__left)?pyEqual((await pyMethod((await pyMethod(r,"get",["intent",({})],{})),"get",["text"],{})),line):__left})())))__rows.push(r);}return __rows;})()))),"intent"),"ref");
}
export async function table_act(client:any,call_id:any,line:any){

(await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"npc",["name"]:KNOTT,["intends"]:line,["outcome"]:"attempted",["_generated"]:true})]}));
return (await ref_of(client,line));
}
export async function unsettled(error:any,ref:any,field:any){
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr(error));
assert.ok(pyBool(pyEqual(pyAt(error,"fix"),FIX)),"tests/kernel/test_npc_intents_done.py:48 assert error[\"fix\"] == FIX");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(error,"details"),"reason"),"table_act_unsettled");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"ref"),ref):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),field):__left})())),pyStr(pyAt(error,"details")));
return error;
}
export async function status_of(client:any,ref:any){
return pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(client,"ok",["npc.situation",({["campaign"]:"c1",["name"]:KNOTT})],{})),"done"))){if(pyBool(pyEqual(pyAt(row,"ref"),ref)))__rows.push(row);}return __rows;})()))),"status");
}
export async function test_a_table_act_that_rolled_nothing_is_not_done_or_failed_by_saying_so_and_abandoned_is_allowed(knott:any){
let ref:any;
ref=(await table_act(knott,"t1-c2",PHONE));
(await narrate(knott,"t1-c3","诺特抓起了电话听筒。"));
(await pyMethod(knott,"table",["player_input"],{"text":"I tell him to put the phone down."}));
(await unsettled((await pyMethod(knott,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:ref,["intent_outcome"]:"done",["why"]:"he threatened"})]})),ref,"npc.outcome"));
(await unsettled((await pyMethod(knott,"table_err",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:ref,["outcome"]:"failed"})]})),ref,"npc.outcome"));
(await unsettled((await pyMethod(knott,"table_err",["apply"],{"call_id":"t2-c3","effects":[({["kind"]:"npc",["name"]:KNOTT,["intends"]:PHONE,["outcome"]:"done"})]})),ref,"npc.outcome"));
assert.ok(pyBool(pyEqual((await status_of(knott,ref)),"attempted")),pyStr("nothing landed"));
(await pyMethod(knott,"table",["apply"],{"call_id":"t2-c4","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:ref,["intent_outcome"]:"abandoned",["why"]:"he puts it down"})]}));
assert.ok(pyBool(pyEqual((await status_of(knott,ref)),"abandoned")),pyStr("the Keeper's overrule (D7) stands"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_act_that_rolled_nothing_is_not_done_or_failed_by_saying_so_and_abandoned_is_allowed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_act_that_rolled_nothing_is_not_done_or_failed_by_saying_so_and_abandoned_is_allowed(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_clue_or_a_note_carrying_a_table_acts_ref_does_not_settle_it(knott:any){
let ref:any,error:any;

ref=(await table_act(knott,"t1-c2",PHONE));
error=(await unsettled((await pyMethod(knott,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads",["intent_ref"]:ref})]})),ref,"effects[0].intent_outcome"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"outcome"),"done")),pyStr("an effect's intent_outcome defaults to done"));
(await unsettled((await pyMethod(knott,"table_err",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"note",["name"]:"the telephone",["text"]:"Knott threatened to ring the police",["intent_ref"]:ref,["intent_outcome"]:"failed"})]})),ref,"effects[0].intent_outcome"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(knott)))){if(pyBool(true))__rows.push(pyContains(["clue","note"],pyAt(r,"kind")));}return __rows;})()))))),pyStr("the refused batch wrote nothing"));
assert.ok(pyBool(pyEqual((await status_of(knott,ref)),"attempted")),"tests/kernel/test_npc_intents_done.py:80 assert status_of(knott, ref) == \"attempted\"");
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c5","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads",["intent_ref"]:ref,["intent_outcome"]:"attempted"})]}));
assert.ok(pyBool(pyEqual((await status_of(knott,ref)),"attempted")),"tests/kernel/test_npc_intents_done.py:83 assert status_of(knott, ref) == \"attempted\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_clue_or_a_note_carrying_a_table_acts_ref_does_not_settle_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_clue_or_a_note_carrying_a_table_acts_ref_does_not_settle_it(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_dice_settle_a_table_act_and_an_outcome_written_beside_them_is_refused_before_any_die(knott:any){
let ref:any,before:any,error:any,roll:any,other:any,rolled:any;
ref=(await table_act(knott,"t1-c2",PHONE));
before=(await pyLen((await receipts(knott))));
error=(await resolve_err(knott,"t1-c3",({"actor":KNOTT,"intent":"investigate","skill":"Listen","goal":"listen for the operator","method":"listen","intent_ref":ref,"intent_outcome":"done"})));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"reason"),"table_act_unsettled"):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"action.intent_outcome"):__left})())),"tests/kernel/test_npc_intents_done.py:91 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"reason\"] == \"table_act_unsettled\" and error[\"details\"][\"field\"] == \"action.intent_outcome\"");
assert.ok(pyBool(pyContains(pyAt(error,"fix"),"leave action.intent_outcome out")),"tests/kernel/test_npc_intents_done.py:92 assert \"leave action.intent_outcome out\" in error[\"fix\"]");
assert.ok(pyBool(pyEqual((await pyLen((await receipts(knott)))),before)),pyStr("refused before any die was thrown"));
(await resolve(knott,"t1-c4",({"actor":KNOTT,"intent":"investigate","skill":"Listen","goal":"listen for the operator","method":"listen","intent_ref":ref})));
roll=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(knott)))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),"t1-c4"):__left})());return pyBool(__left)?(await pyMethod(r,"get",["intent"],{})):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(roll,"intent"),"ref"),ref);return pyBool(__left)?pyEqual(pyAt(pyAt(roll,"intent"),"outcome"),((pyBool(pyAt(roll,"passed"))?"done":"failed"))):__left})())),pyStr("the Keeper's roll settles it"));
other=(await table_act(knott,"t1-c5","诺特侧耳去听楼梯口有没有人。"));
(await resolve(knott,"t1-c6",({"actor":KNOTT,"intent":"investigate","skill":"Listen","goal":"listen","method":"listen","intent_ref":other,"_generated":true})));
rolled=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(knott)))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),"t1-c6"):__left})());return pyBool(__left)?(await pyMethod(r,"get",["intent"],{})):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(rolled,"intent"),"generated")===true);return pyBool(__left)?pyContains(["done","failed"],pyAt(pyAt(rolled,"intent"),"outcome")):__left})())),"tests/kernel/test_npc_intents_done.py:101 assert rolled[\"intent\"][\"generated\"] is True and rolled[\"intent\"][\"outcome\"] in (\"done\", \"failed\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_dice_settle_a_table_act_and_an_outcome_written_beside_them_is_refused_before_any_die"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_dice_settle_a_table_act_and_an_outcome_written_beside_them_is_refused_before_any_die(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_clock_an_arrival_and_a_departure_settle_a_table_act(knott:any){
let clock:any,arrival:any,departure:any,rows:any;
clock=(await table_act(knott,"t1-c2","诺特拿起听筒要摇巡警。"));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"threat",["mint"]:true,["name"]:"the constable is sent for",["length"]:4,["on_full"]:"a constable knocks at the office door",["intent_ref"]:clock})]}));
arrival=(await table_act(knott,"t1-c4","诺特朝楼梯口大喊看门的上来。"));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c5","effects":[({["kind"]:"npc",["name"]:"the porter",["to"]:"here",["walk_on"]:true,["intent_ref"]:arrival,["why"]:"he heard the shout"})]}));
departure=(await table_act(knott,"t1-c6","诺特抓起帽子往门口走。"));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c7","effects":[({["kind"]:"npc",["name"]:KNOTT,["to"]:"away",["intent_ref"]:departure,["why"]:"he walks out"})]}));
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:KNOTT})],{})),"done"))){if(pyBool(true))__rows.push([pyAt(row,"ref"),pyAt(row,"status")]);}return __rows;})()));
assert.ok(pyBool(pyEqual([pyAt(rows,clock),pyAt(rows,arrival),pyAt(rows,departure)],["done","done","done"])),"tests/kernel/test_npc_intents_done.py:113 assert (rows[clock], rows[arrival], rows[departure]) == (\"done\", \"done\", \"done\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_clock_an_arrival_and_a_departure_settle_a_table_act"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_clock_an_arrival_and_a_departure_settle_a_table_act(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_tables_own_stance_write_settles_its_act_and_the_keepers_does_not(knott:any){
let glare:any;

glare=(await table_act(knott,"t1-c2","诺特冷下脸来，盯着海斯不说话。"));
(await unsettled((await pyMethod(knott,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:KNOTT,["stance"]:"hostile",["intent_ref"]:glare,["intent_outcome"]:"done"})]})),glare,"effects[0].intent_outcome"));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"npc",["name"]:KNOTT,["stance"]:"hostile",["intent_ref"]:glare,["intent_outcome"]:"done",["why"]:"the act",["_generated"]:true})]}));
assert.ok(pyBool(pyEqual((await status_of(knott,glare)),"done")),"tests/kernel/test_npc_intents_done.py:123 assert status_of(knott, glare) == \"done\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_tables_own_stance_write_settles_its_act_and_the_keepers_does_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_tables_own_stance_write_settles_its_act_and_the_keepers_does_not(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_keeper_written_row_keeps_its_rules(knott:any){
let line:any,ref:any,other:any;
line="Knott threatens to ring the police.";
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:KNOTT,["intends"]:line,["outcome"]:"attempted"})]}));
ref=(await ref_of(knott,line));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:ref,["intent_outcome"]:"done",["why"]:"he said it"})]}));
assert.ok(pyBool(pyEqual((await status_of(knott,ref)),"done")),pyStr("the Keeper's own account of the Keeper's own row"));
other="Knott tells the visitor about the house.";
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"npc",["name"]:KNOTT,["intends"]:other,["outcome"]:"attempted"})]}));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c5","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads",["intent_ref"]:(await ref_of(knott,other))})]}));
assert.ok(pyBool(pyEqual((await status_of(knott,(await ref_of(knott,other)))),"done")),pyStr("a clue still settles a row the Keeper set out"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_keeper_written_row_keeps_its_rules"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_keeper_written_row_keeps_its_rules(await acquireFixture(t,()=>knott(temporary)));});
