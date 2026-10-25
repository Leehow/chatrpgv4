// Migrated from tests/kernel/test_transactions.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {ordinaryMechanics} from './npc-support.ts';
import {RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,read_jsonl,repo_dir,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";


export let ACTION:any=({["intent"]:"investigate",["goal"]:"看桌上有什么",["method"]:"用侦查扫一眼"});
export async function test_idempotent_replay_and_conflict(kernel:any){
let first:any,replay:any,conflict:any,applied:any,text:any,narrated:any,again:any;
(await open_turn(kernel));
first=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":ACTION}));
replay=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":ACTION}));
assert.ok(pyBool(pyEqual(replay,({...first,["replayed"]:true}))),"tests/kernel/test_transactions.py:13 assert replay == {**first, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))),1)),"tests/kernel/test_transactions.py:14 assert len(kernel.table(\"status\")[\"receipts\"]) == 1");
conflict=(await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t1-c1","action":({...ACTION,["goal"]:"别的目标"})}));
assert.ok(pyBool(pyEqual(pyAt(conflict,"code"),"idempotency_conflict")),"tests/kernel/test_transactions.py:17 assert conflict[\"code\"] == \"idempotency_conflict\"");
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:5})]}));
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:5})]})),({...applied,["replayed"]:true}))),"tests/kernel/test_transactions.py:20 assert kernel.table(\"apply\", call_id=\"t1-c2\", effects=[{\"kind\": \"time\", \"minutes\": 5}]) == {**applied, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["look"],{"focus":"time"})),({["clock"]:({["minutes"]:5})}))),"tests/kernel/test_transactions.py:21 assert kernel.table(\"look\", focus=\"time\") == {\"clock\": {\"minutes\": 5}}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:6})]})),"code"),"idempotency_conflict")),"tests/kernel/test_transactions.py:22 assert kernel.table_err(\"apply\", call_id=\"t1-c2\", effects=[{\"kind\": \"time\", \"minutes\": 6}])[\"code\"] == \"idempotency_conflict\"");
text="他抬起头。";
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
again=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
assert.ok(pyBool(pyEqual(again,({...narrated,["replayed"]:true}))),"tests/kernel/test_transactions.py:28 assert again == {**narrated, \"replayed\": True}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"turn"),2)),"tests/kernel/test_transactions.py:29 assert kernel.table(\"status\")[\"turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["narrate"],{"call_id":"t1-c3","text":"别的文字"})),"code"),"idempotency_conflict")),"tests/kernel/test_transactions.py:30 assert kernel.table_err(\"narrate\", call_id=\"t1-c3\", text=\"别的文字\")[\"code\"] == \"idempotency_conflict\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_idempotent_replay_and_conflict"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_idempotent_replay_and_conflict(await kernel(t,{}));});
export async function test_turn_state_errors(kernel:any){
let method:any,params:any;
(await create_campaign(kernel));
(await narrate_opening(kernel));
for([method,params] of pyIterable([["resolve",({["call_id"]:"t1-c1",["action"]:({["intent"]:"idle"})})],["apply",({["call_id"]:"t1-c1",["effects"]:[({["kind"]:"time",["minutes"]:1})]})],["ask",({["call_id"]:"t1-c1",["prompt"]:"?",["options"]:["a","b"]})],["narrate",({["call_id"]:"t1-c1",["text"]:"x"})]])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",[method],{...params})),"code"),"turn_state")),pyStr(method));
}
assert.ok(pyBool((await pyMethod(kernel,"table",["look"],{}))),"tests/kernel/test_transactions.py:44 assert kernel.table(\"look\")");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"state"),"awaiting_player")),"tests/kernel/test_transactions.py:45 assert kernel.table(\"status\")[\"state\"] == \"awaiting_player\"");
(await pyMethod(kernel,"table",["player_input"],{"text":"第一句。"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["player_input"],{"text":"第二句。"})),"code"),"turn_state")),"tests/kernel/test_transactions.py:48 assert kernel.table_err(\"player_input\", text=\"第二句。\")[\"code\"] == \"turn_state\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"state"),"open")),"tests/kernel/test_transactions.py:49 assert kernel.table(\"status\")[\"state\"] == \"open\"");
(await pyMethod(kernel,"table",["look"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"state"),"acting")),"tests/kernel/test_transactions.py:51 assert kernel.table(\"status\")[\"state\"] == \"acting\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["player_input"],{"text":"第三句。"})),"code"),"turn_state")),"tests/kernel/test_transactions.py:52 assert kernel.table_err(\"player_input\", text=\"第三句。\")[\"code\"] == \"turn_state\"");
(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","prompt":"去哪？","options":["左","右"]}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"state"),"asked")),"tests/kernel/test_transactions.py:55 assert kernel.table(\"status\")[\"state\"] == \"asked\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["narrate"],{"call_id":"t1-c2","text":"x"})),"code"),"turn_state")),"tests/kernel/test_transactions.py:56 assert kernel.table_err(\"narrate\", call_id=\"t1-c2\", text=\"x\")[\"code\"] == \"turn_state\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t1-c2","action":({["intent"]:"idle"})})),"code"),"turn_state")),"tests/kernel/test_transactions.py:57 assert kernel.table_err(\"resolve\", call_id=\"t1-c2\", action={\"intent\": \"idle\"})[\"code\"] == \"turn_state\"");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["look"],{"focus":"time"})),({["clock"]:({["minutes"]:0})}))),"tests/kernel/test_transactions.py:58 assert kernel.table(\"look\", focus=\"time\") == {\"clock\": {\"minutes\": 0}}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"左。"})),"turn"),2)),"tests/kernel/test_transactions.py:59 assert kernel.table(\"player_input\", text=\"左。\")[\"turn\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_turn_state_errors"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_turn_state_errors(await kernel(t,{}));});
export async function test_ask_closes_turn_and_pending_choice_carries_over(kernel:any){
let asked:any,pending:any,record:any,cards:any,read:any,answer:any,bad:any,chosen:any,receipts:any,narrated:any;
(await open_turn(kernel,"我问诺特该从哪里查起。"));
asked=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","prompt":"你想先去哪里？","options":["报社档案","中央图书馆"],"binds":"first-stop"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(asked,"state"),"asked");return pyBool(__left)?pyEqual(pyAt(asked,"turn"),1):__left})())),"tests/kernel/test_transactions.py:66 assert asked[\"state\"] == \"asked\" and asked[\"turn\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(asked,"rendered_text"),"");return pyBool(__left)?pyEqual(pyAt(asked,"mechanics"),[]):__left})())),"tests/kernel/test_transactions.py:67 assert asked[\"rendered_text\"] == \"\" and asked[\"mechanics\"] == []");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"prompt"),"你想先去哪里？")),"tests/kernel/test_transactions.py:68 assert asked[\"interaction\"][\"prompt\"] == \"你想先去哪里？\"");
pending=pyAt(asked,"pending_choice");
assert.ok(pyBool(pyEqual(pyAt(pending,"name"),"ask-first-stop-t1")),"tests/kernel/test_transactions.py:70 assert pending[\"name\"] == \"ask-first-stop-t1\"");
assert.ok(pyBool(pyEqual(pyAt(pending,"options"),["报社档案","中央图书馆"])),"tests/kernel/test_transactions.py:71 assert pending[\"options\"] == [\"报社档案\", \"中央图书馆\"]");
assert.ok(pyBool(pyEqual(pyAt(pending,"binds"),"first-stop")),"tests/kernel/test_transactions.py:72 assert pending[\"binds\"] == \"first-stop\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"pending_choice"),pending)),"tests/kernel/test_transactions.py:73 assert kernel.table(\"status\")[\"pending_choice\"] == pending");
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["open"],{})),"pending_turn")===null)),"tests/kernel/test_transactions.py:74 assert kernel.table(\"open\")[\"pending_turn\"] is None");
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(record,"closed_by"),"ask");return pyBool(__left)?pyEqual(pyAt(record,"rendered_text"),pyAt(asked,"rendered_text")):__left})())),"tests/kernel/test_transactions.py:76 assert record[\"closed_by\"] == \"ask\" and record[\"rendered_text\"] == asked[\"rendered_text\"]");
cards=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","role":"keeper"})),"cards");
assert.ok(pyBool(pyEqual([pyAt(pyAt(cards,(-1)),"turn"),pyAt(pyAt(cards,(-1)),"chars")],[1,0])),"tests/kernel/test_transactions.py:78 assert (cards[-1][\"turn\"], cards[-1][\"chars\"]) == (1, 0)");
read=(await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:1,["role"]:"keeper"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(read,"text"),pyAt(asked,"rendered_text"));return pyBool(__left)?(pyAt(read,"verified")===true):__left})())),"tests/kernel/test_transactions.py:80 assert read[\"text\"] == asked[\"rendered_text\"] and read[\"verified\"] is True");
answer=(await pyMethod(kernel,"table",["player_input"],{"text":"先去报社。"}));
assert.ok(pyBool(pyEqual(pyAt(answer,"turn"),2)),"tests/kernel/test_transactions.py:83 assert answer[\"turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(answer,"capsule"),"turn"),"pending_choice"),pending)),"tests/kernel/test_transactions.py:84 assert answer[\"capsule\"][\"turn\"][\"pending_choice\"] == pending");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(answer,"capsule"),"recent"),(-1)),({["turn"]:1,["player"]:"我问诺特该从哪里查起。",["keeper"]:pyAt(asked,"rendered_text"),["closed"]:"explicit",["receipts"]:0}))),"tests/kernel/test_transactions.py:85 assert answer[\"capsule\"][\"recent\"][-1] == {\"turn\": 1, \"player\": \"我问诺特该从哪里查起。\",\n                                               \"keeper\": asked[\"rendered_text\"], \"closed\": \"explicit\", \"receipts\": 0}");
bad=(await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"meta",["choice"]:({["pending"]:"other",["option"]:"x"})})}));
assert.ok(pyBool(pyEqual(pyAt(bad,"code"),"invalid_params")),"tests/kernel/test_transactions.py:89 assert bad[\"code\"] == \"invalid_params\"");
chosen=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"meta",["goal"]:"选路",["method"]:"",["choice"]:({["pending"]:pyAt(pending,"name"),["option"]:"报社档案"})})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(chosen,"outcome"),({["kind"]:"none"}));return pyBool(__left)?(pyAt(chosen,"pending_choice")===null):__left})())),"tests/kernel/test_transactions.py:93 assert chosen[\"outcome\"] == {\"kind\": \"none\"} and chosen[\"pending_choice\"] is None");
receipts=pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts");
assert.ok(pyBool(pyEqual(receipts,[({...pyAt(receipts,0),["id"]:`choice:${pyAt(pending,"name")}-t2`,["kind"]:"choice",["option"]:"报社档案"})])),"tests/kernel/test_transactions.py:95 assert receipts == [{**receipts[0], \"id\": f\"choice:{pending['name']}-t2\", \"kind\": \"choice\", \"option\": \"报社档案\"}]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"move",["to"]:"newspaper-morgue"})]}));
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t2-c3","text":"你们出发去报社。"}));
assert.ok(pyBool(pyEqual(pyAt(narrated,"rendered_text"),"你们出发去报社。")),"tests/kernel/test_transactions.py:98 assert narrated[\"rendered_text\"] == \"你们出发去报社。\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(ordinaryMechanics(pyAt(narrated,"mechanics"),read_json(pyDivide(pyDivide(campaign_dir(kernel.workspace),"turns"),"0002.json")).receipts))){__rows.push([pyAt(m,"kind"),(await pyMethod(m,"get",["option"],{})),(await pyMethod(m,"get",["to"],{}))]);}return __rows;})()),[["choice","报社档案",null],["scene",null,"newspaper-morgue"]])),"tests/kernel/test_transactions.py:100 assert [(m[\"kind\"], m.get(\"option\"), m.get(\"to\")) for m in narrated[\"mechanics\"]] == [\n        (\"choice\", \"报社档案\", None), (\"scene\", None, \"newspaper-morgue\")]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ask_closes_turn_and_pending_choice_carries_over"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ask_closes_turn_and_pending_choice_carries_over(await kernel(t,{}));});
export async function test_pending_turn_survives_a_crash(tmp_path:any){
let workspace:any,first:any,second:any,opened:any,pending:any,roll:any,result:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await open_turn(first,"我环视办公室。"));
(await pyMethod(first,"table",["resolve"],{"call_id":"t1-c1","action":ACTION}));
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(workspace)),"turn.json"))),"state"),"acting")),"tests/kernel/test_transactions.py:110 assert read_json(campaign_dir(workspace) / \"turn.json\")[\"state\"] == \"acting\"");}finally{(await pyMethod(first,"close",[],{}));}
second=(new RpcClient(workspace));
try{opened=(await pyMethod(second,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"opening_needed")===false)),"tests/kernel/test_transactions.py:117 assert opened[\"opening_needed\"] is False");
assert.ok(pyBool(pyEqual(pyAt(opened,"turn"),({["number"]:1,["state"]:"acting"}))),"tests/kernel/test_transactions.py:118 assert opened[\"turn\"] == {\"number\": 1, \"state\": \"acting\"}");
pending=pyAt(opened,"pending_turn");
assert.ok(pyBool(pyEqual(pyAt(pending,"player_text"),"我环视办公室。")),"tests/kernel/test_transactions.py:120 assert pending[\"player_text\"] == \"我环视办公室。\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pending,"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),["roll:spot-hidden-t1-c1"])),"tests/kernel/test_transactions.py:121 assert [r[\"id\"] for r in pending[\"receipts\"]] == [\"roll:spot-hidden-t1-c1\"]");
assert.ok(pyBool(pyEqual(pyAt(pending,"owed"),["narrate"])),"tests/kernel/test_transactions.py:122 assert pending[\"owed\"] == [\"narrate\"]");
assert.ok(pyBool(pyAt(pending,"since")),"tests/kernel/test_transactions.py:123 assert pending[\"since\"]");
assert.ok(pyBool(pyEqual(pyAt(pending,"last_call_ordinal"),1)),"tests/kernel/test_transactions.py:124 assert pending[\"last_call_ordinal\"] == 1");
roll=pyAt(pyAt(pending,"receipts"),0);
result=(await pyMethod(second,"table",["narrate"],{"call_id":"t1-c2","text":`办公室里只有雪茄味。（${pyAt(roll,"roll")}／${pyAt(roll,"target")}）`}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(result,"mechanics"),0),"kind"),"roll");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(result,"mechanics"),0),"skill"),"Spot Hidden"):__left})())),"tests/kernel/test_transactions.py:128 assert result[\"mechanics\"][0][\"kind\"] == \"roll\" and result[\"mechanics\"][0][\"skill\"] == \"Spot Hidden\"");
assert.ok(pyBool((pyAt((await pyMethod(second,"table",["open"],{})),"pending_turn")===null)),"tests/kernel/test_transactions.py:129 assert second.table(\"open\")[\"pending_turn\"] is None");}finally{(await pyMethod(second,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pending_turn_survives_a_crash"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pending_turn_survives_a_crash(temporary);});
export async function test_pending_turn_from_hand_edited_turn_json(kernel:any){
let path:any,turn:any,opened:any;
(await open_turn(kernel,"我等他开口。"));
path=pyDivide((await campaign_dir(kernel.workspace)),"turn.json");
turn=(await read_json(path));
turn["state"]="acting";
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[turn],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"turn"),"state"),"acting")),"tests/kernel/test_transactions.py:141 assert opened[\"turn\"][\"state\"] == \"acting\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"pending_turn"),"player_text"),"我等他开口。")),"tests/kernel/test_transactions.py:142 assert opened[\"pending_turn\"][\"player_text\"] == \"我等他开口。\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"pending_turn"),"receipts"),[])),"tests/kernel/test_transactions.py:143 assert opened[\"pending_turn\"][\"receipts\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pending_turn_from_hand_edited_turn_json"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pending_turn_from_hand_edited_turn_json(await kernel(t,{}));});
export async function test_transport_errors_do_not_kill_the_kernel(kernel:any){
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"raw",["not json"],{})),"error"),"code"),"invalid_params")),"tests/kernel/test_transactions.py:147 assert kernel.raw(\"not json\")[\"error\"][\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"raw",["{\"id\": \"x\", \"method\": 5}"],{})),"error"),"code"),"invalid_params")),"tests/kernel/test_transactions.py:148 assert kernel.raw('{\"id\": \"x\", \"method\": 5}')[\"error\"][\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["nope.method"],{})),"code"),"unknown_method")),"tests/kernel/test_transactions.py:149 assert kernel.err(\"nope.method\")[\"code\"] == \"unknown_method\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.open",({})],{})),"code"),"invalid_params")),"tests/kernel/test_transactions.py:150 assert kernel.err(\"table.open\", {})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.open",({["campaign"]:"ghost"})],{})),"code"),"campaign_not_found")),"tests/kernel/test_transactions.py:151 assert kernel.err(\"table.open\", {\"campaign\": \"ghost\"})[\"code\"] == \"campaign_not_found\"");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["kernel.hello"],{})),"kernel_version")),"tests/kernel/test_transactions.py:152 assert kernel.ok(\"kernel.hello\")[\"kernel_version\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_transport_errors_do_not_kill_the_kernel"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_transport_errors_do_not_kill_the_kernel(await kernel(t,{}));});
export async function test_commit_failure_keeps_the_turn_open(kernel:any){
let directory:any,transcript_before:any,events_before:any,repo:any,broken:any,error:any,status:any,result:any;

(await open_turn(kernel,"我听墙角。"));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"x",["method"]:"y",["skill"]:"Listen"})}));
directory=(await campaign_dir(kernel.workspace));
transcript_before=(await read_jsonl(pyDivide(directory,"transcript.jsonl")));
events_before=(await read_jsonl(pyDivide(directory,"events.jsonl")));
repo=(await repo_dir(kernel.workspace));
broken=(await pyMethod(repo,"with_name",["c1.broken"],{}));
(await pyMethod(repo,"rename",[broken],{}));
try{error=(await pyMethod(kernel,"table_err",["narrate"],{"call_id":"t1-c2","text":"第一段。\n\n第二段。"}));}finally{(await pyMethod(broken,"rename",[repo],{}));}
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"commit_failed")),"tests/kernel/test_transactions.py:172 assert error[\"code\"] == \"commit_failed\"");
status=(await pyMethod(kernel,"table",["status"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(status,"turn"),1);return pyBool(__left)?pyEqual(pyAt(status,"state"),"acting"):__left})())),"tests/kernel/test_transactions.py:174 assert status[\"turn\"] == 1 and status[\"state\"] == \"acting\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(status,"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),["roll:listen-t1-c1"])),"tests/kernel/test_transactions.py:175 assert [r[\"id\"] for r in status[\"receipts\"]] == [\"roll:listen-t1-c1\"]");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(pyDivide(directory,"turns"),"0001.json")),"exists",[],{})))),"tests/kernel/test_transactions.py:176 assert not (directory / \"turns\" / \"0001.json\").exists()");
assert.ok(pyBool(pyEqual((await read_jsonl(pyDivide(directory,"transcript.jsonl"))),transcript_before)),"tests/kernel/test_transactions.py:177 assert read_jsonl(directory / \"transcript.jsonl\") == transcript_before");
assert.ok(pyBool(pyEqual((await read_jsonl(pyDivide(directory,"events.jsonl"))),events_before)),"tests/kernel/test_transactions.py:178 assert read_jsonl(directory / \"events.jsonl\") == events_before");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["open"],{})),"pending_turn"),"owed"),["narrate"])),"tests/kernel/test_transactions.py:179 assert kernel.table(\"open\")[\"pending_turn\"][\"owed\"] == [\"narrate\"]");
result=(await narrate(kernel,"t1-c2","第一段。\n\n第二段。"));
assert.ok(pyBool(pyAt(result,"commit")),"tests/kernel/test_transactions.py:182 assert result[\"commit\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(result,"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"roll"))){__rows.push(pyAt(m,"skill"));}}return __rows;})()),["Listen"])),"tests/kernel/test_transactions.py:183 assert [m[\"skill\"] for m in result[\"mechanics\"] if m[\"kind\"] == \"roll\"] == [\"Listen\"]");
status=(await pyMethod(kernel,"table",["status"],{}));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["turn","state","receipts","mechanics","pending_choice"])){__rows.push([key,pyAt(status,key)]);}return __rows;})())),({["turn"]:2,["state"]:"awaiting_player",["receipts"]:[],["mechanics"]:[],["pending_choice"]:null}))),"tests/kernel/test_transactions.py:185 assert {key: status[key] for key in (\"turn\", \"state\", \"receipts\", \"mechanics\", \"pending_choice\")} == {\n        \"turn\": 2, \"state\": \"awaiting_player\", \"receipts\": [], \"mechanics\": [], \"pending_choice\": None}");
assert.ok(pyBool(pyAt(status,"labels")),"tests/kernel/test_transactions.py:187 assert status[\"labels\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_commit_failure_keeps_the_turn_open"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_commit_failure_keeps_the_turn_open(await kernel(t,{}));});
export async function test_ask_keeps_story_mechanics_and_interaction_separate(kernel:any){
let asked:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"x",["method"]:"y",["skill"]:"Spot Hidden"})}));
asked=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c2","text":"你举起灯，墙上有影子在动。","prompt":"你要怎么做？","options":["退后","上前"]}));
assert.ok(pyBool(pyEqual(pyAt(asked,"rendered_text"),"你举起灯，墙上有影子在动。")),"tests/kernel/test_transactions.py:194 assert asked[\"rendered_text\"] == \"你举起灯，墙上有影子在动。\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"options"),["退后","上前"])),"tests/kernel/test_transactions.py:195 assert asked[\"interaction\"][\"options\"] == [\"退后\", \"上前\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"prompt"),"你要怎么做？")),"tests/kernel/test_transactions.py:196 assert asked[\"interaction\"][\"prompt\"] == \"你要怎么做？\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(asked,"mechanics"))){__rows.push(pyAt(row,"kind"));}return __rows;})()),["roll"])),"tests/kernel/test_transactions.py:197 assert [row[\"kind\"] for row in asked[\"mechanics\"]] == [\"roll\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ask_keeps_story_mechanics_and_interaction_separate"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ask_keeps_story_mechanics_and_interaction_separate(await kernel(t,{}));});
export async function test_mechanics_choice_has_no_question_or_numbered_prose(kernel:any){
let bad:any,asked:any;
(await open_turn(kernel));
bad=(await pyMethod(kernel,"table_err",["ask"],{"call_id":"t1-c1","kind":"mechanics","prompt":"怎么处理失败？","options":["flee","accept"]}));
assert.ok(pyBool(pyEqual(pyAt(bad,"code"),"invalid_params")),"tests/kernel/test_transactions.py:203 assert bad[\"code\"] == \"invalid_params\"");
asked=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","kind":"mechanics","options":["flee","accept"]}));
assert.ok(pyBool(pyEqual(pyAt(asked,"rendered_text"),"")),"tests/kernel/test_transactions.py:205 assert asked[\"rendered_text\"] == \"\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"kind"),"mechanics")),"tests/kernel/test_transactions.py:206 assert asked[\"interaction\"][\"kind\"] == \"mechanics\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"options"),["flee","accept"])),"tests/kernel/test_transactions.py:207 assert asked[\"interaction\"][\"options\"] == [\"push\", \"spend_luck\", \"accept\"]");
assert.ok(pyBool(!pyBool(pyAt(pyAt(asked,"interaction"),"prompt"))),"tests/kernel/test_transactions.py:208 assert not asked[\"interaction\"][\"prompt\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_mechanics_choice_has_no_question_or_numbered_prose"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_mechanics_choice_has_no_question_or_numbered_prose(await kernel(t,{}));});
