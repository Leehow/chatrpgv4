// Migrated from tests/kernel/test_jev_call_status.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {campaign_dir,git_log,narrate,open_turn,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export async function _digest(path:any){
return (pyBool((await pyMethod(path,"exists",[],{})))?(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(path,"read_bytes",[],{}))],{})),"hexdigest",[],{})):null);
}
export async function _state_fingerprint(client:any){
let root:any;
root=(await campaign_dir(client.workspace));
return pyUnion(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(["world.json","turn.json","events.jsonl","transcript.jsonl","turns/0001.json"])){if(pyBool(true))__rows.push([name,(await _digest(pyDivide(root,name)))]);}return __rows;})())),({["git"]:(await git_log(client.workspace))}));
}
export async function _status(client:any,call_id:any,request:any,extra:any={}){
return (await pyMethod(client,"ok",["table.call_status",({["campaign"]:"c1",["call_id"]:call_id,["request"]:request,...extra})],{}));
}
export async function test_call_status_returns_exact_settled_resolve_and_apply_without_new_writes(kernel:any){
let resolve_request:any,resolved:any,apply_request:any,applied:any,before:any,resolve_status:any,apply_status:any;
(await open_turn(kernel));
resolve_request=({["campaign"]:"c1",["call_id"]:"t1-c1",["action"]:({["intent"]:"investigate",["goal"]:"check the room",["method"]:"look for a hidden object",["skill"]:"Spot Hidden"})});
resolved=(await pyMethod(kernel,"ok",["table.resolve",resolve_request],{}));
apply_request=({["campaign"]:"c1",["call_id"]:"t1-c2",["effects"]:[({["kind"]:"time",["minutes"]:5})]});
applied=(await pyMethod(kernel,"ok",["table.apply",apply_request],{}));
before=(await _state_fingerprint(kernel));
resolve_status=(await _status(kernel,"t1-c1",resolve_request));
apply_status=(await _status(kernel,"t1-c2",apply_request));
assert.ok(pyBool(pyEqual(pyAt(resolve_status,"status"),"settled")),"tests/kernel/test_jev_call_status.py:53 assert resolve_status[\"status\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(resolve_status,"call_turn"),1)),"tests/kernel/test_jev_call_status.py:54 assert resolve_status[\"call_turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(resolve_status,"active_turn"),1)),"tests/kernel/test_jev_call_status.py:55 assert resolve_status[\"active_turn\"] == 1");
assert.ok(pyBool((pyAt(pyAt(resolve_status,"result"),"replayed")===true)),"tests/kernel/test_jev_call_status.py:56 assert resolve_status[\"result\"][\"replayed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(resolve_status,"result"),"receipt"),pyAt(resolved,"receipt"))),"tests/kernel/test_jev_call_status.py:57 assert resolve_status[\"result\"][\"receipt\"] == resolved[\"receipt\"]");
assert.ok(pyBool(pyEqual(pyAt(apply_status,"status"),"settled")),"tests/kernel/test_jev_call_status.py:58 assert apply_status[\"status\"] == \"settled\"");
assert.ok(pyBool((pyAt(pyAt(apply_status,"result"),"replayed")===true)),"tests/kernel/test_jev_call_status.py:59 assert apply_status[\"result\"][\"replayed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(apply_status,"result"),"receipts"),pyAt(applied,"receipts"))),"tests/kernel/test_jev_call_status.py:60 assert apply_status[\"result\"][\"receipts\"] == applied[\"receipts\"]");
assert.ok(pyBool(pyEqual((await _state_fingerprint(kernel)),before)),"tests/kernel/test_jev_call_status.py:61 assert _state_fingerprint(kernel) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_call_status_returns_exact_settled_resolve_and_apply_without_new_writes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_call_status_returns_exact_settled_resolve_and_apply_without_new_writes(await kernel(t,{}));});
export async function test_call_status_rejects_digest_conflict_and_malformed_bound_requests(kernel:any){
let request:any,conflict:any,params:any;
(await open_turn(kernel));
request=({["campaign"]:"c1",["call_id"]:"t1-c1",["action"]:({["intent"]:"investigate",["goal"]:"check",["method"]:"look",["skill"]:"Spot Hidden"})});
(await pyMethod(kernel,"ok",["table.resolve",request],{}));
conflict=(await pyMethod(kernel,"err",["table.call_status",({["campaign"]:"c1",["call_id"]:"t1-c1",["request"]:({...request,["action"]:({...pyAt(request,"action"),["method"]:"different"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(conflict,"code"),"idempotency_conflict")),"tests/kernel/test_jev_call_status.py:81 assert conflict[\"code\"] == \"idempotency_conflict\"");
for(params of pyIterable([({["campaign"]:"c1",["call_id"]:"t1-c1"}),({["campaign"]:"c1",["call_id"]:"t1-c1",["request"]:({...request,["campaign"]:"other"})}),({["campaign"]:"c1",["call_id"]:"t1-c1",["request"]:({...request,["call_id"]:"t1-c2"})}),({["campaign"]:"c1",["call_id"]:"not-a-call",["request"]:request})])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.call_status",params],{})),"code"),"invalid_params")),"tests/kernel/test_jev_call_status.py:88 assert kernel.err(\"table.call_status\", params)[\"code\"] == \"invalid_params\"");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_call_status_rejects_digest_conflict_and_malformed_bound_requests"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_call_status_rejects_digest_conflict_and_malformed_bound_requests(await kernel(t,{}));});
export async function test_call_status_keeps_historical_settlement_after_turn_close_and_reports_old_absence(kernel:any){
let request:any,settled:any,historical:any,absent_old:any;
(await open_turn(kernel));
request=({["campaign"]:"c1",["call_id"]:"t1-c1",["action"]:({["intent"]:"investigate",["goal"]:"check",["method"]:"look",["skill"]:"Spot Hidden"})});
settled=(await pyMethod(kernel,"ok",["table.resolve",request],{}));
(await narrate(kernel,"t1-c2","The search leaves the room unchanged."));
(await pyMethod(kernel,"table",["player_input"],{"text":"I continue."}));
historical=(await _status(kernel,"t1-c1",request));
absent_old=(await _status(kernel,"t1-c99",({["campaign"]:"c1",["call_id"]:"t1-c99",["action"]:({["intent"]:"idle"})})));
assert.ok(pyBool(pyEqual(pyAt(historical,"status"),"settled")),"tests/kernel/test_jev_call_status.py:108 assert historical[\"status\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(historical,"active_turn"),2)),"tests/kernel/test_jev_call_status.py:109 assert historical[\"active_turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(historical,"call_turn"),1)),"tests/kernel/test_jev_call_status.py:110 assert historical[\"call_turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(historical,"result"),"receipt"),pyAt(settled,"receipt"))),"tests/kernel/test_jev_call_status.py:111 assert historical[\"result\"][\"receipt\"] == settled[\"receipt\"]");
assert.ok(pyBool(pyEqual(absent_old,({["status"]:"absent",["call_id"]:"t1-c99",["call_turn"]:1,["active_turn"]:2,["scope"]:pyAt(historical,"scope")}))),"tests/kernel/test_jev_call_status.py:112 assert absent_old == {\n        \"status\": \"absent\",\n        \"call_id\": \"t1-c99\",\n        \"call_turn\": 1,\n        \"active_turn\": 2,\n        \"scope\": historical[\"scope\"],\n    }");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_call_status_keeps_historical_settlement_after_turn_close_and_reports_old_absence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_call_status_keeps_historical_settlement_after_turn_close_and_reports_old_absence(await kernel(t,{}));});
export async function test_call_status_absence_and_active_scope_mismatch_are_explicit(kernel:any){
let request:any,absent:any,mismatch:any;
(await open_turn(kernel));
request=({["campaign"]:"c1",["call_id"]:"t1-c77",["action"]:({["intent"]:"idle"})});
absent=(await _status(kernel,"t1-c77",request));
assert.ok(pyBool(pyEqual(pyAt(absent,"status"),"absent")),"tests/kernel/test_jev_call_status.py:129 assert absent[\"status\"] == \"absent\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(absent,"call_turn");const __term1=pyAt(absent,"active_turn");const __term2=1;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_call_status.py:130 assert absent[\"call_turn\"] == absent[\"active_turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(absent,"scope"),"worldline"),"main")),"tests/kernel/test_jev_call_status.py:131 assert absent[\"scope\"][\"worldline\"] == \"main\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(absent,"scope"),"loop"),0)),"tests/kernel/test_jev_call_status.py:132 assert absent[\"scope\"][\"loop\"] == 0");
mismatch=(await pyMethod(kernel,"err",["table.call_status",({["campaign"]:"c1",["call_id"]:"t1-c77",["request"]:request,["scope"]:({["worldline"]:"foreign",["loop"]:0})})],{}));
assert.ok(pyBool(pyEqual(pyAt(mismatch,"code"),"turn_state")),"tests/kernel/test_jev_call_status.py:143 assert mismatch[\"code\"] == \"turn_state\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(mismatch,"details"),"reason"),"operation_scope_stale")),"tests/kernel/test_jev_call_status.py:144 assert mismatch[\"details\"][\"reason\"] == \"operation_scope_stale\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_call_status_absence_and_active_scope_mismatch_are_explicit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_call_status_absence_and_active_scope_mismatch_are_explicit(await kernel(t,{}));});
export async function test_owned_apply_returns_exact_receipt_bound_world_revision(kernel:any){
let before_context:any,before:any,before_task:any,request:any,result:any,after_context:any,after:any,after_task:any,advance:any,replay:any,replay_context:any;
(await open_turn(kernel));
before_context=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:"c1"})],{})),"_context");
before=pyAt(before_context,"world_revision");
before_task=pyAt(before_context,"task_world_revision");
request=({["campaign"]:"c1",["call_id"]:"t1-c1",["_task_read_set"]:true,["effects"]:[({["kind"]:"time",["minutes"]:5})]});
result=(await pyMethod(kernel,"ok",["table.apply",request],{}));
after_context=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:"c1"})],{})),"_context");
after=pyAt(after_context,"world_revision");
after_task=pyAt(after_context,"task_world_revision");
advance=pyAt(result,"_task_advance");
assert.ok(pyBool(pyEqual(pyAt(advance,"before"),before)),"tests/kernel/test_jev_call_status.py:159 assert advance['before'] == before");
assert.ok(pyBool(pyEqual(pyAt(advance,"after"),after)),"tests/kernel/test_jev_call_status.py:160 assert advance['after'] == after");
assert.ok(pyBool(!pyEqual(pyAt(advance,"before"),pyAt(advance,"after"))),"tests/kernel/test_jev_call_status.py:161 assert advance['before'] != advance['after']");
assert.ok(pyBool(pyEqual(pyAt(advance,"task_before"),before_task)),"tests/kernel/test_jev_call_status.py:162 assert advance['task_before'] == before_task");
assert.ok(pyBool(pyEqual(pyAt(advance,"task_after"),after_task)),"tests/kernel/test_jev_call_status.py:163 assert advance['task_after'] == after_task");
assert.ok(pyBool(!pyEqual(pyAt(advance,"task_before"),pyAt(advance,"task_after"))),"tests/kernel/test_jev_call_status.py:164 assert advance['task_before'] != advance['task_after']");
assert.ok(pyBool(pyEqual(pyAt(advance,"receiptIds"),pyAt(result,"receipts"))),"tests/kernel/test_jev_call_status.py:165 assert advance['receiptIds'] == result['receipts']");
assert.ok(pyBool(pyEqual(pyAt(advance,"operationId"),"t1-c1")),"tests/kernel/test_jev_call_status.py:166 assert advance['operationId'] == 't1-c1'");
assert.ok(pyBool(pyEqual(pyAt(advance,"campaign"),"c1")),"tests/kernel/test_jev_call_status.py:167 assert advance['campaign'] == 'c1'");
assert.ok(pyBool(pyEqual(pyAt(advance,"turn"),1)),"tests/kernel/test_jev_call_status.py:168 assert advance['turn'] == 1");
replay=(await pyMethod(kernel,"ok",["table.apply",request],{}));
assert.ok(pyBool(pyEqual(pyAt(replay,"_task_advance"),advance)),"tests/kernel/test_jev_call_status.py:170 assert replay['_task_advance'] == advance");
replay_context=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:"c1"})],{})),"_context");
assert.ok(pyBool(pyEqual(pyAt(replay_context,"world_revision"),after)),"tests/kernel/test_jev_call_status.py:172 assert replay_context['world_revision'] == after");
assert.ok(pyBool(pyEqual(pyAt(replay_context,"task_world_revision"),after_task)),"tests/kernel/test_jev_call_status.py:173 assert replay_context['task_world_revision'] == after_task");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_owned_apply_returns_exact_receipt_bound_world_revision"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_owned_apply_returns_exact_receipt_bound_world_revision(await kernel(t,{}));});
