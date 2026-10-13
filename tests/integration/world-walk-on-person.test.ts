// Migrated from tests/kernel/test_walk_on_person.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,narrate,open_turn,read_json,campaign_dir,pyMin,pyMax,pyRound,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./world-native-support.ts";


let SHOUT:any="Shout down the stairwell for the porter.";
let PORTER:any="the porter";
export async function receipt(client:any,applied:any){
return (await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(applied,"receipts"),pyAt(r,"id"))))__rows.push(r);}return __rows;})())));
}
export async function test_a_walk_on_arrives_as_the_result_of_a_shout_and_stays_a_person_of_this_table(tmp_path:any){
let client:any=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await open_turn(client,"I hit him again."));
let ref:any=pyAt(pyAt((await receipt(client,(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:SHOUT,["outcome"]:"attempted"})]})))),"intent"),"ref");
(await narrate(client,"t1-c2","Knott bellows down the stairwell."));
(await pyMethod(client,"table",["player_input"],{"text":"I keep at him."}));
let arrival:any=({["kind"]:"npc",["name"]:PORTER,["to"]:"here",["intent_ref"]:ref,["why"]:"he heard Knott shouting"});
let refused:any=(await pyMethod(client,"table_err",["apply"],{"call_id":"t2-c1","effects":[arrival]}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"unknown_entity")),pyStr(refused));
assert.ok(pyBool(pyEqual(pyAt(pyAt(refused,"details"),"walk_on"),({...arrival,["walk_on"]:true}))),pyStr("the effect to send instead keeps the shout's ref"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt((await pyMethod(client,"table",["capsule"],{})),"present"))){if(pyBool(true))__rows.push(pyEqual(pyAt(person,"name"),PORTER));}return __rows;})()))))),pyStr("nothing was written"));
let arrived:any=(await receipt(client,(await pyMethod(client,"table",["apply"],{"call_id":"t2-c2","effects":[pyAt(pyAt(refused,"details"),"walk_on")]}))));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(arrived,"established"),"table");return pyBool(__left)?pyEqual(pyAt(pyAt(arrived,"intent"),"ref"),ref):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(arrived,"intent"),"outcome"),"done"):__left})())),"tests/kernel/test_walk_on_person.py:36 assert arrived[\"established\"] == \"table\" and arrived[\"intent\"][\"ref\"] == ref and arrived[\"intent\"][\"outcome\"] == \"done\"");
let handle:any=pyAt(arrived,"handle");
let pinned:any=(await receipt(client,(await pyMethod(client,"table",["apply"],{"call_id":"t2-c3","effects":[({["kind"]:"npc",["name"]:PORTER,["archetype"]:"capable_adult",["why"]:"a big man used to hauling coal"})]}))));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(pinned,"profile"),"archetype"),"capable_adult");return pyBool(__left)?pyEqual(pyAt(pinned,"handle"),handle):__left})());return pyBool(__left)?!pyContains(pinned,"established"):__left})())),"tests/kernel/test_walk_on_person.py:41 assert pinned[\"profile\"][\"archetype\"] == \"capable_adult\" and pinned[\"handle\"] == handle and \"established\" not in pinned");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt((await pyMethod(client,"table",["capsule"],{})),"present"))){if(pyBool(true))__rows.push(pyEqual(pyAt(person,"name"),PORTER));}return __rows;})())))),"tests/kernel/test_walk_on_person.py:42 assert any(person[\"name\"] == PORTER for person in client.table(\"capsule\")[\"present\"])");
let delivered:any=(await narrate(client,"t2-c4","{{say:the porter}}What's all this, then?{{/say}}"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(delivered,"speech"),0),"who"),"npc"),handle)),"tests/kernel/test_walk_on_person.py:44 assert delivered[\"speech\"][0][\"who\"][\"npc\"] == handle");}finally{(await pyMethod(client,"close",[],{}));}
let resumed:any=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await pyMethod(resumed,"table",["player_input"],{"text":"I turn to the porter."}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt((await pyMethod(resumed,"table",["capsule"],{})),"present"))){if(pyBool(true))__rows.push(pyEqual(pyAt(person,"name"),PORTER));}return __rows;})())))),pyStr("a table person survives a restart"));
let ledger:any=(await read_json(pyDivide((await campaign_dir(resumed.workspace)),"npc-ledger.json")));
let knott:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const [key,entry] of pyIterable((await pyMethod(ledger,"items",[],{})))){if(pyBool(pyContains(key,"knott")))__rows.push(entry);}return __rows;})())));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(knott,"intents"))){if(pyBool(true))__rows.push([pyAt(row,"text"),pyAt(row,"status")]);}return __rows;})()),[[SHOUT,"done"]])),"tests/kernel/test_walk_on_person.py:53 assert [(row[\"text\"], row[\"status\"]) for row in knott[\"intents\"]] == [(SHOUT, \"done\")]");}finally{(await pyMethod(resumed,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_walk_on_arrives_as_the_result_of_a_shout_and_stays_a_person_of_this_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_walk_on_arrives_as_the_result_of_a_shout_and_stays_a_person_of_this_table(temporary);});
