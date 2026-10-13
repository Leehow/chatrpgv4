// Migrated from tests/kernel/test_events_slice2.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {resolve,walk_to_confrontation} from './rules-families.test.ts';
const ask=(client:any,call_id:string,prompt:string,options:string[])=>client.table('ask',{call_id,prompt,options});
import {RpcClient,campaign_dir,narrate,open_turn,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";



export let EMITTED:any=new Set(["turn-started","player-declared","roll-resolved","scene-moved","clue-discovered","time-advanced","resource-changed","decision-settled","session-changed","choice-asked","memory-written","turn-finalized","flag-set","note-written","ruling-made","map-revealed"]);
export async function test_canonical_events_end_to_end(tmp_path:any){
let client:any,n:any,attack:any,narrated:any,job:any,events:any,session:any,asked:any,written:any,finalized:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await open_turn(client,"我举枪对准棺材里的东西。"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"}),({["kind"]:"time",["minutes"]:5}),({["kind"]:"damage",["dice"]:"1D3",["why"]:"被门夹了"}),({["kind"]:"flag",["name"]:"door-open"}),({["kind"]:"note",["name"]:"the door",["text"]:"say what the door did"}),({["kind"]:"ruling",["name"]:"doors",["statement"]:"doors bite for 1D3",["anchor"]:({["family"]:"core-check"})})]}));
n=(await walk_to_confrontation(client,2));
attack=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(attack,"session"),"kind"),"combat")),"tests/kernel/test_events_slice2.py:33 assert attack[\"session\"][\"kind\"] == \"combat\"");
narrated=(await narrate(client,`t1-c${pyAdd(n,1)}`,"枪响了。"));
(await pyMethod(client,"table",["player_input"],{"text":"我闪开。"}));
(await ask(client,"t2-c1","你要怎么做？",["闪避","反击"]));
job=(await pyMethod(client,"ok",["memory.job",({["campaign"]:"c1",["turn"]:1})],{}));
(await pyMethod(client,"ok",["memory.submit",({["campaign"]:"c1",["job_id"]:pyAt(job,"job_id"),["candidates"]:[({["kind"]:"world_event",["subject"]:"world",["statement"]:"枪响了。"})]})],{}));
events=(await read_jsonl(pyDivide((await campaign_dir(client.workspace)),"events.jsonl")));
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){__rows.push(pyAt(e,"type"));}return __rows;})())),EMITTED)),"tests/kernel/test_events_slice2.py:42 assert {e[\"type\"] for e in events} == EMITTED");
assert.ok(pyBool(pyEqual(pySlice((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(pyEqual((await pyMethod(e,"get",["call_id"],{})),"t1-c1"))){__rows.push(pyAt(e,"type"));}}return __rows;})()),(-3),undefined),["flag-set","note-written","ruling-made"])),"tests/kernel/test_events_slice2.py:43 assert [e[\"type\"] for e in events if e.get(\"call_id\") == \"t1-c1\"][-3:] == [\"flag-set\", \"note-written\", \"ruling-made\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){__rows.push(pyAt(e,"seq"));}return __rows;})()),(await pyList((await pyRange(1,pyAdd((await pyLen(events)),1))))))),"tests/kernel/test_events_slice2.py:44 assert [e[\"seq\"] for e in events] == list(range(1, len(events) + 1))");
session=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(pyEqual(pyAt(e,"type"),"session-changed"))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=session;return pyBool(__left)?pyEqual(pyAt(pyAt(session,0),"turn"),1):__left;})())),"tests/kernel/test_events_slice2.py:47 assert session and session[0][\"turn\"] == 1");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(session,0),"receipt"),"startswith",["session:combat-start-t1-c"],{}))),"tests/kernel/test_events_slice2.py:48 assert session[0][\"receipt\"].startswith(\"session:combat-start-t1-c\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(session,0),"data"),({...pyAt(pyAt(session,0),"data"),["family"]:"combat",["transition"]:"start"}))),"tests/kernel/test_events_slice2.py:49 assert session[0][\"data\"] == {**session[0][\"data\"], \"family\": \"combat\", \"transition\": \"start\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(session,0),"call_id"),`t1-c${n}`)),"tests/kernel/test_events_slice2.py:50 assert session[0][\"call_id\"] == f\"t1-c{n}\"");
asked=pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(pyEqual(pyAt(e,"type"),"choice-asked"))){__rows.push(e);}}return __rows;})()),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(asked,"turn"),2);return pyBool(__left)?pyEqual(pyAt(asked,"call_id"),"t2-c1"):__left;})())),"tests/kernel/test_events_slice2.py:53 assert asked[\"turn\"] == 2 and asked[\"call_id\"] == \"t2-c1\"");
assert.ok(pyBool(pyEqual(pyAt(asked,"data"),({["name"]:pyAt(pyAt(asked,"data"),"name"),["prompt"]:"你要怎么做？",["options"]:["闪避","反击"],["binds"]:null}))),"tests/kernel/test_events_slice2.py:54 assert asked[\"data\"] == {\"name\": asked[\"data\"][\"name\"], \"prompt\": \"你要怎么做？\", \"options\": [\"闪避\", \"反击\"],\n                                 \"binds\": None}");
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod(pyAt(pyAt(asked,"data"),"name"),"startswith",["ask-"],{}));return pyBool(__left)?(await pyMethod(pyAt(pyAt(asked,"data"),"name"),"endswith",["-t2"],{})):__left;})())),"tests/kernel/test_events_slice2.py:56 assert asked[\"data\"][\"name\"].startswith(\"ask-\") and asked[\"data\"][\"name\"].endswith(\"-t2\")");
written=pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(pyEqual(pyAt(e,"type"),"memory-written"))){__rows.push(e);}}return __rows;})()),0);
assert.ok(pyBool(pyEqual(pyAt(written,"turn"),1)),"tests/kernel/test_events_slice2.py:59 assert written[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(written,"data"),({["job_id"]:"extract:c1:t1",["turn"]:1,["candidates"]:1,["superseded"]:0}))),"tests/kernel/test_events_slice2.py:60 assert written[\"data\"] == {\"job_id\": \"extract:c1:t1\", \"turn\": 1, \"candidates\": 1, \"superseded\": 0}");
finalized=pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(e,"type"),"turn-finalized");return pyBool(__left)?pyEqual(pyAt(e,"turn"),1):__left;})()))){__rows.push(e);}}return __rows;})()),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(finalized,"receipt"),"turn:1");return pyBool(__left)?pyAt(narrated,"commit"):__left;})())),"tests/kernel/test_events_slice2.py:63 assert finalized[\"receipt\"] == \"turn:1\" and narrated[\"commit\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_canonical_events_end_to_end"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_canonical_events_end_to_end(temporary);});
export async function test_travel_advances_the_clock_as_an_event(kernel:any){
let events:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"hall-of-records",["travel_minutes"]:20})]}));
events=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool(pyEqual((await pyMethod(e,"get",["receipt"],{})),"move:hall-of-records-t1-c1"))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){__rows.push(pyAt(e,"type"));}return __rows;})()),["scene-moved","time-advanced"])),"tests/kernel/test_events_slice2.py:73 assert [e[\"type\"] for e in events] == [\"scene-moved\", \"time-advanced\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(events,1),"receipt"),"move:hall-of-records-t1-c1")),"tests/kernel/test_events_slice2.py:74 assert events[1][\"receipt\"] == \"move:hall-of-records-t1-c1\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(events,1),"data"),({["minutes"]:20,["why"]:"travel",["clock"]:({["minutes"]:20})}))),"tests/kernel/test_events_slice2.py:75 assert events[1][\"data\"] == {\"minutes\": 20, \"why\": \"travel\", \"clock\": {\"minutes\": 20}}");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"move",["to"]:"central-library",["travel_minutes"]:0})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))),(-1)),"type"),"scene-moved")),"tests/kernel/test_events_slice2.py:78 assert read_jsonl(campaign_dir(kernel.workspace) / \"events.jsonl\")[-1][\"type\"] == \"scene-moved\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_travel_advances_the_clock_as_an_event"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_travel_advances_the_clock_as_an_event(await kernel(t,{}));});
