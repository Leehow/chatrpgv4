// Migrated from tests/kernel/test_crash_recovery.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,create_campaign,git_log,narrate,narrate_opening,open_turn,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";



export let ACTION:any=({["intent"]:"investigate",["goal"]:"看桌上有什么",["method"]:"用侦查扫一眼"});
export async function test_resume_is_null_before_any_turn_is_committed(kernel:any){
let opened:any;

(await create_campaign(kernel));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"opening_needed")===true)),"tests/kernel/test_crash_recovery.py:21 assert opened[\"opening_needed\"] is True");
assert.ok(pyBool((pyAt(opened,"resume")===null)),"tests/kernel/test_crash_recovery.py:22 assert opened[\"resume\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_resume_is_null_before_any_turn_is_committed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_resume_is_null_before_any_turn_is_committed(await kernel(t,{}));});
export async function test_killed_between_acting_and_committed_reopens_and_finishes_with_one_commit(tmp_path:any){
let workspace:any,first:any,resolved:any,commits_before:any,second:any,opened:any,pending:any,replayed:any,narrated:any,commits_after:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await open_turn(first,"我检查这间办公室。"));
resolved=(await pyMethod(first,"table",["resolve"],{"call_id":"t1-c1","action":ACTION}));
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(workspace)),"turn.json"))),"state"),"acting")),"tests/kernel/test_crash_recovery.py:31 assert read_json(campaign_dir(workspace) / \"turn.json\")[\"state\"] == \"acting\"");}finally{(await pyMethod(first,"close",[],{}));}
commits_before=(await git_log(workspace));
second=(new RpcClient(workspace));
try{opened=(await pyMethod(second,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"opening_needed")===false)),"tests/kernel/test_crash_recovery.py:40 assert opened[\"opening_needed\"] is False");
assert.ok(pyBool(pyEqual(pyAt(opened,"turn"),({["number"]:1,["state"]:"acting"}))),"tests/kernel/test_crash_recovery.py:41 assert opened[\"turn\"] == {\"number\": 1, \"state\": \"acting\"}");
pending=pyAt(opened,"pending_turn");
assert.ok(pyBool(pyEqual(pyAt(pending,"player_text"),"我检查这间办公室。")),"tests/kernel/test_crash_recovery.py:43 assert pending[\"player_text\"] == \"我检查这间办公室。\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pending,"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),[pyAt(resolved,"receipt")])),"tests/kernel/test_crash_recovery.py:44 assert [r[\"id\"] for r in pending[\"receipts\"]] == [resolved[\"receipt\"]]");
assert.ok(pyBool(pyEqual(pyAt(pending,"owed"),["narrate"])),"tests/kernel/test_crash_recovery.py:45 assert pending[\"owed\"] == [\"narrate\"]");
assert.ok(pyBool(pyAt(pending,"since")),"tests/kernel/test_crash_recovery.py:46 assert pending[\"since\"]");
assert.ok(pyBool(pyEqual(pyAt(pending,"last_call_ordinal"),1)),"tests/kernel/test_crash_recovery.py:47 assert pending[\"last_call_ordinal\"] == 1");
replayed=(await pyMethod(second,"table",["resolve"],{"call_id":"t1-c1","action":ACTION}));
assert.ok(pyBool(pyEqual(replayed,({...resolved,["replayed"]:true}))),"tests/kernel/test_crash_recovery.py:51 assert replayed == {**resolved, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(second,"table",["status"],{})),"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),[pyAt(resolved,"receipt")])),"tests/kernel/test_crash_recovery.py:52 assert [r[\"id\"] for r in second.table(\"status\")[\"receipts\"]] == [resolved[\"receipt\"]]");
narrated=(await narrate(second,"t1-c2","办公室里只有雪茄味。"));
assert.ok(pyBool(pyAt(narrated,"commit")),"tests/kernel/test_crash_recovery.py:56 assert narrated[\"commit\"]");
assert.ok(pyBool((pyAt((await pyMethod(second,"table",["open"],{})),"pending_turn")===null)),"tests/kernel/test_crash_recovery.py:57 assert second.table(\"open\")[\"pending_turn\"] is None");}finally{(await pyMethod(second,"close",[],{}));}
commits_after=(await git_log(workspace));
assert.ok(pyBool(pyEqual((await pyLen(commits_after)),pyAdd((await pyLen(commits_before)),1))),"tests/kernel/test_crash_recovery.py:62 assert len(commits_after) == len(commits_before) + 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_killed_between_acting_and_committed_reopens_and_finishes_with_one_commit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_killed_between_acting_and_committed_reopens_and_finishes_with_one_commit(temporary);});
export async function test_narrate_replayed_after_reopen_makes_no_second_commit(tmp_path:any){
let workspace:any,first:any,narrated:any,commits_before:any,second:any,replay:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await open_turn(first,"我听着走廊里的脚步声。"));
narrated=(await narrate(first,"t1-c1","脚步声渐渐远去。"));}finally{(await pyMethod(first,"close",[],{}));}
commits_before=(await git_log(workspace));
second=(new RpcClient(workspace));
try{replay=(await narrate(second,"t1-c1","脚步声渐渐远去。"));
assert.ok(pyBool(pyEqual(replay,({...narrated,["replayed"]:true}))),"tests/kernel/test_crash_recovery.py:79 assert replay == {**narrated, \"replayed\": True}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(second,"table",["status"],{})),"turn"),2)),"tests/kernel/test_crash_recovery.py:80 assert second.table(\"status\")[\"turn\"] == 2");}finally{(await pyMethod(second,"close",[],{}));}
assert.ok(pyBool(pyEqual((await git_log(workspace)),commits_before)),"tests/kernel/test_crash_recovery.py:84 assert git_log(workspace) == commits_before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_narrate_replayed_after_reopen_makes_no_second_commit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_narrate_replayed_after_reopen_makes_no_second_commit(temporary);});
export async function test_missing_checkpoint_is_rebuilt_from_head_on_reopen(tmp_path:any){
let workspace:any,first:any,narrated:any,checkpoint_path:any,second:any,opened:any,resume:any,rebuilt:any;

workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await open_turn(first,"我打开了灯。"));
narrated=(await narrate(first,"t1-c1","灯光昏黄，照亮了满地的文件。"));}finally{(await pyMethod(first,"close",[],{}));}
checkpoint_path=pyDivide(pyDivide(pyDivide((await campaign_dir(workspace)),"save"),"continuation"),"latest.json");
assert.ok(pyBool((await pyMethod(checkpoint_path,"exists",[],{}))),pyStr("narrate should have written the continuation checkpoint"));
(await pyMethod(checkpoint_path,"unlink",[],{}));
second=(new RpcClient(workspace));
try{opened=(await pyMethod(second,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"pending_turn")===null)),"tests/kernel/test_crash_recovery.py:106 assert opened[\"pending_turn\"] is None");
assert.ok(pyBool(pyEqual(pyAt(opened,"turn"),({["number"]:2,["state"]:"awaiting_player"}))),"tests/kernel/test_crash_recovery.py:107 assert opened[\"turn\"] == {\"number\": 2, \"state\": \"awaiting_player\"}");
resume=pyAt(opened,"resume");
assert.ok(pyBool((resume!==null)),"tests/kernel/test_crash_recovery.py:109 assert resume is not None");
assert.ok(pyBool(pyEqual(pyAt(resume,"turn"),1)),"tests/kernel/test_crash_recovery.py:110 assert resume[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(resume,"commit"),pyAt(narrated,"commit"))),"tests/kernel/test_crash_recovery.py:111 assert resume[\"commit\"] == narrated[\"commit\"]");
assert.ok(pyBool(pyAt(resume,"one_line")),"tests/kernel/test_crash_recovery.py:112 assert resume[\"one_line\"]");
rebuilt=(await read_json(checkpoint_path));
assert.ok(pyBool(pyEqual(pyAt(rebuilt,"turn"),1)),"tests/kernel/test_crash_recovery.py:115 assert rebuilt[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(rebuilt,"commit"),pyAt(narrated,"commit"))),"tests/kernel/test_crash_recovery.py:116 assert rebuilt[\"commit\"] == narrated[\"commit\"]");}finally{(await pyMethod(second,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_missing_checkpoint_is_rebuilt_from_head_on_reopen"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_missing_checkpoint_is_rebuilt_from_head_on_reopen(temporary);});
export async function test_corrupted_turn_json_rebuilds_a_fresh_turn_from_the_checkpoint(tmp_path:any){
let workspace:any,first:any,narrated:any,turn_path:any,second:any,opened:any,resume:any,rebuilt_turn:any;

workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await open_turn(first,"我检查抽屉。"));
narrated=(await narrate(first,"t1-c1","抽屉里空空如也。"));}finally{(await pyMethod(first,"close",[],{}));}
turn_path=pyDivide((await campaign_dir(workspace)),"turn.json");
(await pyMethod(turn_path,"write_text",["{not valid json"],{"encoding":"utf-8"}));
second=(new RpcClient(workspace));
try{opened=(await pyMethod(second,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"pending_turn")===null)),"tests/kernel/test_crash_recovery.py:138 assert opened[\"pending_turn\"] is None");
assert.ok(pyBool(pyEqual(pyAt(opened,"turn"),({["number"]:2,["state"]:"awaiting_player"}))),"tests/kernel/test_crash_recovery.py:139 assert opened[\"turn\"] == {\"number\": 2, \"state\": \"awaiting_player\"}");
resume=pyAt(opened,"resume");
assert.ok(pyBool((resume!==null)),"tests/kernel/test_crash_recovery.py:141 assert resume is not None");
assert.ok(pyBool(pyEqual(pyAt(resume,"turn"),1)),"tests/kernel/test_crash_recovery.py:142 assert resume[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(resume,"commit"),pyAt(narrated,"commit"))),"tests/kernel/test_crash_recovery.py:143 assert resume[\"commit\"] == narrated[\"commit\"]");
assert.ok(pyBool((pyAt(resume,"rebuilt")===true)),"tests/kernel/test_crash_recovery.py:144 assert resume[\"rebuilt\"] is True");
rebuilt_turn=(await read_json(turn_path));
assert.ok(pyBool(pyEqual(pyAt(rebuilt_turn,"turn"),2)),"tests/kernel/test_crash_recovery.py:147 assert rebuilt_turn[\"turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(rebuilt_turn,"state"),"awaiting_player")),"tests/kernel/test_crash_recovery.py:148 assert rebuilt_turn[\"state\"] == \"awaiting_player\"");
assert.ok(pyBool(((await pyMethod(rebuilt_turn,"get",["pending_choice"],{}))===null)),"tests/kernel/test_crash_recovery.py:149 assert rebuilt_turn.get(\"pending_choice\") is None");
(await pyMethod(second,"table",["player_input"],{"text":"我走出办公室。"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(second,"table",["status"],{})),"turn"),2)),"tests/kernel/test_crash_recovery.py:153 assert second.table(\"status\")[\"turn\"] == 2");}finally{(await pyMethod(second,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_corrupted_turn_json_rebuilds_a_fresh_turn_from_the_checkpoint"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_corrupted_turn_json_rebuilds_a_fresh_turn_from_the_checkpoint(temporary);});
export async function test_first_player_input_after_reopen_carries_resume_the_second_does_not(tmp_path:any){
let workspace:any,first:any,second:any,opened:any,resume:any,first_input:any,second_input:any;

workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await open_turn(first,"我检查这扇门。"));
(await narrate(first,"t1-c1","门锁着。"));}finally{(await pyMethod(first,"close",[],{}));}
second=(new RpcClient(workspace));
try{opened=(await pyMethod(second,"table",["open"],{}));
resume=pyAt(opened,"resume");
assert.ok(pyBool((resume!==null)),"tests/kernel/test_crash_recovery.py:172 assert resume is not None");
first_input=(await pyMethod(second,"table",["player_input"],{"text":"我试着撬锁。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(first_input,"capsule"),"resume"),resume)),"tests/kernel/test_crash_recovery.py:175 assert first_input[\"capsule\"][\"resume\"] == resume");
(await narrate(second,"t2-c1","锁被撬开了。"));
second_input=(await pyMethod(second,"table",["player_input"],{"text":"我推门进去。"}));
assert.ok(pyBool(!pyContains(pyAt(second_input,"capsule"),"resume")),"tests/kernel/test_crash_recovery.py:179 assert \"resume\" not in second_input[\"capsule\"]");}finally{(await pyMethod(second,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_player_input_after_reopen_carries_resume_the_second_does_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_player_input_after_reopen_carries_resume_the_second_does_not(temporary);});
