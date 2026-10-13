// Migrated from tests/kernel/test_corpus.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,open_turn,read_json,read_jsonl,first_failure,seed_wound,read_command,snapshot,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_corpus.py',import.meta.url).pathname;








export let CORPUS:any=(await pyMethod((await pyInvoke(Path,[__file__],{})),"with_name",["corpus"],{}));
export let CASES:any=(await pySorted((await (async()=>{const __rows:any[]=[];for(const p of pyIterable((await pyMethod(CORPUS,"glob",["*.json"],{})))){__rows.push(p);}return __rows;})())));
export async function _seed_sanity(workspace:any,overrides:any){
let directory:any,sheet:any,state:any,path:any;

directory=(await pyInvoke(campaign_dir,[workspace],{}));
sheet=(await pyInvoke(read_json,[pyDivide(pyDivide(directory,"party"),"thomas-hayes.json")],{}));
state=({["investigator_id"]:"thomas-hayes",["san_max"]:99,["san_current"]:pyAt(sheet,"current_san"),["cm_value"]:0,["awfulness_caps"]:({}),["temporary_insane"]:false,["temporary_insane_remaining_hours"]:0,["indefinite_insane"]:false,["permanently_insane"]:false,["bout_active"]:false,["bout_rounds_remaining"]:0,["active_bout_id"]:null,["daily_san_lost"]:0,["day_start_san"]:pyAt(sheet,"current_san"),["bouts_of_madness"]:[],["involuntary_actions"]:[],["phobia"]:null,["phobia_tags"]:[],["mania"]:null,["mania_tags"]:[],["mania_unindulged"]:false,["conditions"]:[],["active_delusion"]:null,["delusion_resistant"]:false,["symptoms_suppressed_until_next_san_loss"]:false,["recovery_trigger"]:null,["treatment_trigger"]:null,["events"]:[]});
(await pyMethod(state,"update",[overrides],{}));
if(pyBool((await (async()=>{const __left=pyAt(state,"temporary_insane");return pyBool(__left)?!pyBool(pyAt(state,"temporary_insane_remaining_hours")):__left;})()))){state["temporary_insane_remaining_hours"]=5;}
path=pyDivide(pyDivide(pyDivide(directory,"save"),"sanity-state"),"thomas-hayes.json");
(await pyMethod(path.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[state],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
}
Object.defineProperty(_seed_sanity,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"overrides","rest":false,"varargs":false}]});
export async function _setup(client:any,case_value:any){
let setup:any,ordinal:any,scene:any,prior:any,failed_id:any,_:any,ended:any,ending_id:any,receipt:any,combat:any;

setup=(await (async()=>{const __left=(await pyMethod(case_value,"get",["setup"],{}));return pyBool(__left)?__left:({});})());
ordinal=1;
for(scene of pyIterable((await (async()=>{const __left=(await pyMethod(setup,"get",["move_to"],{}));return pyBool(__left)?__left:[];})()))){
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${ordinal}`,"effects":[({["kind"]:"move",["to"]:scene})]}));
ordinal+=1;
}
if(pyBool((await pyMethod(setup,"get",["wound"],{})))){(await pyInvoke(seed_wound,[client.workspace,pyAt(pyAt(setup,"wound"),"hp")],{"minutes_ago":(await pyMethod(pyAt(setup,"wound"),"get",["minutes_ago",0],{}))}));}
if(pyBool((await pyMethod(setup,"get",["prior_failed_check"],{})))){prior=pyAt(setup,"prior_failed_check");
const __unpack2661=(await pyInvoke(first_failure,[client,"t1-c"],{"intent":"investigate","goal":pyAt(prior,"goal"),"method":"","skill":pyAt(prior,"skill"),"stakes":(await pyMethod(prior,"get",["stakes"],{})),"modifiers":({["difficulty"]:pyAt(prior,"difficulty")})}));failed_id=__unpack2661[0];_=__unpack2661[1];
ordinal=pyAdd((await pyInvoke(pyInt,[pyAt((await pyMethod(failed_id,"split",["-c"],{})),1)],{})),1);}
if(pyBool((await pyMethod(setup,"get",["pending_ending"],{})))){ended=(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"montage",["goal"]:"session ends",["method"]:"",["decision"]:"development:end-session"})}));
ending_id=pyAt(pyAt(ended,"outcome"),"ending_id");
receipt=pyDivide(pyDivide(pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"development-settlements"),"endings"),ending_id),"thomas-hayes.json");
(await pyMethod(receipt,"unlink",[],{}));
ordinal=2;}
if(pyBool((await pyMethod(setup,"get",["combat"],{})))){combat=pyAt(setup,"combat");
(await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${ordinal}`,"action":({["intent"]:"combat",["goal"]:"open the fight",["method"]:"",["target"]:"Walter Corbitt",["weapon"]:(await pyMethod(combat,"get",["weapon","unarmed"],{}))})}));
(await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${pyAdd(ordinal,1)}`,"action":({["intent"]:"combat",["goal"]:"answer",["method"]:"",["actor"]:"Walter Corbitt",["defense"]:(await pyMethod(combat,"get",["defense","dodge"],{}))})}));
ordinal+=2;}
if(pyBool(((await pyMethod(setup,"get",["sanity"],{}))!==null))){(await pyInvoke(_seed_sanity,[client.workspace,pyAt(setup,"sanity")],{}));}
return ordinal;
}
Object.defineProperty(_setup,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"case","rest":false,"varargs":false}]});
export async function _check_session(expected:any,actual:any){
if(pyBool((expected===null))){assert.ok(pyBool((actual===null)),"tests/kernel/test_corpus.py:79 assert actual is None");
return ;}
if(pyBool(pyContains(expected,"kind"))){assert.ok(pyBool((await (async()=>{const __left=(actual!==null);return pyBool(__left)?pyEqual(pyAt(actual,"kind"),pyAt(expected,"kind")):__left;})())),"tests/kernel/test_corpus.py:82 assert actual is not None and actual[\"kind\"] == expected[\"kind\"]");}
if(pyBool(pyContains(expected,"kind_in"))){assert.ok(pyBool(pyContains(pyAt(expected,"kind_in"),(await pyMethod(((await (async()=>{const __left=actual;return pyBool(__left)?__left:({});})())),"get",["kind"],{})))),"tests/kernel/test_corpus.py:84 assert (actual or {}).get(\"kind\") in expected[\"kind_in\"]");}
if(pyBool(pyContains(expected,"status"))){assert.ok(pyBool(pyEqual(pyAt(actual,"status"),pyAt(expected,"status"))),"tests/kernel/test_corpus.py:86 assert actual[\"status\"] == expected[\"status\"]");}
if(pyBool(pyContains(expected,"status_in"))){assert.ok(pyBool(pyContains(pyAt(expected,"status_in"),pyAt(actual,"status"))),"tests/kernel/test_corpus.py:88 assert actual[\"status\"] in expected[\"status_in\"]");}
if(pyBool(pyContains(expected,"outcome"))){assert.ok(pyBool(pyEqual((await pyMethod(actual,"get",["outcome"],{})),pyAt(expected,"outcome"))),"tests/kernel/test_corpus.py:90 assert actual.get(\"outcome\") == expected[\"outcome\"]");}
}
Object.defineProperty(_check_session,"__pySignature",{value:[{"name":"expected","rest":false,"varargs":false},{"name":"actual","rest":false,"varargs":false}]});
export async function _check(client:any,workspace:any,call_id:any,action:any,expect:any){
let before:any,result:any,outcome:any,key:any,value:any,events:any,optional:any,event_type:any,minimum:any,receipt:any,names:any,pending:any,turn:any,n:any,again:any;
before=(await pyInvoke(pyLen,[(await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"events.jsonl")],{}))],{}));
result=(await pyMethod(client,"table",["resolve"],{"call_id":call_id,"action":action}));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),pyAt(expect,"decision"))),"tests/kernel/test_corpus.py:96 assert result[\"decision\"] == expect[\"decision\"]");
outcome=pyAt(result,"outcome");
assert.ok(pyBool(pyEqual(pyAt(outcome,"kind"),pyAt(expect,"outcome_kind"))),"tests/kernel/test_corpus.py:98 assert outcome[\"kind\"] == expect[\"outcome_kind\"]");
for([key,value] of pyIterable((await pyMethod(((await (async()=>{const __left=(await pyMethod(expect,"get",["outcome"],{}));return pyBool(__left)?__left:({});})())),"items",[],{})))){
if(pyBool((await pyMethod(key,"endswith",["_in"],{})))){assert.ok(pyBool(pyContains(value,(await pyMethod(outcome,"get",[pySlice(key,undefined,(-3))],{})))),pyStr(key));}else{assert.ok(pyBool(pyEqual((await pyMethod(outcome,"get",[key],{})),value)),pyStr(key));}
}
assert.ok(pyBool(pyLessEqual(new Set((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(result,"effects"))){__rows.push(pyAt(e,"kind"));}return __rows;})())),(await pyInvoke(pySet,[pyAt(expect,"effect_kinds_allowed")],{})))),"tests/kernel/test_corpus.py:104 assert {e[\"kind\"] for e in result[\"effects\"]} <= set(expect[\"effect_kinds_allowed\"])");
events=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pySlice((await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"events.jsonl")],{})),before,undefined))){__rows.push(pyAt(e,"type"));}return __rows;})());
optional=pyUnion((await pyInvoke(pySet,[(await (async()=>{const __left=(await pyMethod(expect,"get",["optional_event_types"],{}));return pyBool(__left)?__left:[];})())],{})),new Set(["session-changed"]));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(!pyContains(optional,e))){__rows.push(e);}}return __rows;})()),pyAt(expect,"event_types"))),"tests/kernel/test_corpus.py:109 assert [e for e in events if e not in optional] == expect[\"event_types\"]");
for([event_type,minimum] of pyIterable((await pyMethod(((await (async()=>{const __left=(await pyMethod(expect,"get",["event_counts_min"],{}));return pyBool(__left)?__left:({});})())),"items",[],{})))){
assert.ok(pyBool(pyLessEqual(minimum,(await pyMethod(events,"count",[event_type],{})))),pyStr(event_type));
}
if(pyBool(pyContains(expect,"roll_visibility"))){receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(result,"receipt")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(receipt,"visibility"),pyAt(expect,"roll_visibility"))),"tests/kernel/test_corpus.py:114 assert receipt[\"visibility\"] == expect[\"roll_visibility\"]");}
if(pyBool(pyContains(expect,"continuations"))){assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(result,"continuations"))){__rows.push(pyAt(c,"decision"));}return __rows;})()),pyAt(expect,"continuations"))),"tests/kernel/test_corpus.py:116 assert [c[\"decision\"] for c in result[\"continuations\"]] == expect[\"continuations\"]");}
if(pyBool(pyContains(expect,"continuations_on_failure"))){names=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(result,"continuations"))){__rows.push(pyAt(c,"decision"));}return __rows;})());
if(pyBool(pyContains(["fumble","critical"],(await pyMethod(outcome,"get",["level"],{}))))){assert.ok(pyBool(pyEqual(names,[])),"tests/kernel/test_corpus.py:120 assert names == []");}else if(pyBool((await pyMethod(outcome,"get",["passed"],{})))){assert.ok(pyBool(pyEqual(names,["push-luck:luck-spend"])),"tests/kernel/test_corpus.py:123 assert names == [\"push-luck:luck-spend\"]");}else{assert.ok(pyBool(pyEqual(names,pyAt(expect,"continuations_on_failure"))),"tests/kernel/test_corpus.py:125 assert names == expect[\"continuations_on_failure\"]");}}
if(pyBool(pyContains(expect,"session"))){(await pyInvoke(_check_session,[pyAt(expect,"session"),pyAt(result,"session")],{}));}
if(pyBool(pyContains(expect,"session_after"))){(await pyInvoke(_check_session,[pyAt(expect,"session_after"),pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session")],{}));}
if(pyBool(pyContains(expect,"pending_choice"))){pending=pyAt(result,"pending_choice");
if(pyBool((pyAt(expect,"pending_choice")===null))){assert.ok(pyBool((pending===null)),"tests/kernel/test_corpus.py:133 assert pending is None");}else{assert.ok(pyBool((await (async()=>{const __left=(pending!==null);return pyBool(__left)?pyEqual(pyAt(pending,"for"),pyAt(pyAt(expect,"pending_choice"),"for")):__left;})())),"tests/kernel/test_corpus.py:135 assert pending is not None and pending[\"for\"] == expect[\"pending_choice\"][\"for\"]");}}
if(pyBool((await pyMethod(expect,"get",["second_push_refused"],{})))){const __unpack7292=(await pyMethod(call_id,"split",["-c"],{}));turn=__unpack7292[0];n=__unpack7292[1];
again=(await pyMethod(client,"table_err",["resolve"],{"call_id":`${turn}-c${pyAdd((await pyInvoke(pyInt,[n],{})),1)}`,"action":action}));
assert.ok(pyBool(pyEqual(pyAt(again,"code"),pyAt(expect,"second_push_refused"))),"tests/kernel/test_corpus.py:139 assert again[\"code\"] == expect[\"second_push_refused\"]");}
assert.ok(pyBool(pyEqual((await pyMethod(client,"table",["resolve"],{"call_id":call_id,"action":action})),({...result,["replayed"]:true}))),"tests/kernel/test_corpus.py:141 assert client.table(\"resolve\", call_id=call_id, action=action) == {**result, \"replayed\": True}");
return result;
}
Object.defineProperty(_check,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"workspace","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"action","rest":false,"varargs":false},{"name":"expect","rest":false,"varargs":false}]});
export async function run_recorded_case(path:any,workspace:any,command:any=null,frozen_clock:any=false,capture_failure:any=false,capture_state:any=true){
let case_value:any,client:any,failure:any,ordinal:any,offset:any,followup:any;
case_value=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
client=null;
failure=null;
try{client=(new RpcClient(workspace,({"env":({["COC_KERNEL_SEED"]:(await pyInvoke(pyStr,[(await (async()=>{const __left=(await pyMethod(((await (async()=>{const __left=(await pyMethod(case_value,"get",["setup"],{}));return pyBool(__left)?__left:({});})())),"get",["seed"],{}));return pyBool(__left)?__left:path.stem;})())],{}))}),"command":command,"frozen_clock":frozen_clock})));
(await pyInvoke(open_turn,[client,"回归。"],{}));
ordinal=(await pyInvoke(_setup,[client,case_value],{}));
(await pyInvoke(_check,[client,client.workspace,`t1-c${ordinal}`,pyAt(case_value,"action"),pyAt(case_value,"expect")],{}));
for([offset,followup] of pyIterable((await pyInvoke(pyEnumerate,[(await (async()=>{const __left=(await pyMethod(case_value,"get",["followups"],{}));return pyBool(__left)?__left:[];})())],{"start":1})))){
(await pyInvoke(_check,[client,client.workspace,`t1-c${pyAdd(ordinal,offset)}`,pyAt(followup,"action"),pyAt(followup,"expect")],{}));
}}catch(exc){if(pyBool(!pyBool(capture_failure))){throw exc;}
failure=({["type"]:(await pyInvoke(pyType,[exc],{})).__name__,["message"]:(await pyInvoke(pyStr,[exc],{}))});}finally{if(pyBool(client)){(await pyMethod(client,"close",[],{}));}}
return ({["exchanges"]:(pyBool(client)?client.exchanges:[]),["state"]:(pyBool(capture_state)?(await pyInvoke(snapshot,[workspace],{})):null),["failure"]:failure});
}
Object.defineProperty(run_recorded_case,"__pySignature",{value:[{"name":"path","rest":false,"varargs":false},{"name":"workspace","rest":false,"varargs":false},{"name":"command","rest":false,"varargs":false},{"name":"frozen_clock","rest":false,"varargs":false},{"name":"capture_failure","rest":false,"varargs":false},{"name":"capture_state","rest":false,"varargs":false}]});
export async function test_recorded_payload_replays_as_a_resolve(path:any,tmp_path:any){
(await pyInvoke(run_recorded_case,[path,pyDivide(tmp_path,"ws")],{"capture_state":false}));
}
Object.defineProperty(test_recorded_payload_replays_as_a_resolve,"__pySignature",{value:[{"name":"path","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("path",CASES))).entries())test("test_recorded_payload_replays_as_a_resolve"+((pyCartesian([{}],pyParametrize("path",CASES))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recorded_payload_replays_as_a_resolve(row["path"],temporary);});
