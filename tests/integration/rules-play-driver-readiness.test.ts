// Migrated from tests/play/test_driver.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {replay_turn,importlib,SimpleNamespace,pyMethod,resetDriver,continuous_readiness_probe} from './rules-driver-support.ts';
import {nativeAssertions,pyEqual,captureOutput} from './rules-play-support.ts';
const DRIVER=ROOT+'/tests/play/driver.ts';

import {pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
















export async function test_continuous_background_events_do_not_starve_idle_prompt(monkeypatch:any){
let _:any,calls:any,polls:any,result:any,prompts:any;
const __unpack50529=(await continuous_readiness_probe(monkeypatch,[({["success"]:true,["data"]:({["isStreaming"]:false})})]));assert.equal(__unpack50529.length,5,"Original tuple unpacking requires exact arity");_=__unpack50529[0];_=__unpack50529[1];calls=__unpack50529[2];polls=__unpack50529[3];result=__unpack50529[4];
prompts=(await (async()=>{const __rows:any[]=[];for(const [kind,at] of pyIterable(calls)){if(pyBool(pyEqual(kind,"prompt"))){__rows.push(at);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(prompts)),1)),"tests/play/test_driver.py:1061 assert len(prompts) == 1");
assert.ok(pyBool(pyLessEqual(pyAt(prompts,0),3.01)),"tests/play/test_driver.py:1062 assert prompts[0] <= 3.01");
assert.ok(pyBool(pyEqual((await pyLen(polls)),1)),"tests/play/test_driver.py:1063 assert len(polls) == 1");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:1064 assert result[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"timings"),"readiness_wait_seconds"),(await pyMethod(nativeAssertions,"approx",[3.0],{})))),"tests/play/test_driver.py:1065 assert result[\"timings\"][\"readiness_wait_seconds\"] == pytest.approx(3.0)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"timings"),"prompt_ack_seconds"),(await pyMethod(nativeAssertions,"approx",[0.2],{})))),"tests/play/test_driver.py:1066 assert result[\"timings\"][\"prompt_ack_seconds\"] == pytest.approx(0.2)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"timings"),"keeper_wait_seconds"),(await pyMethod(nativeAssertions,"approx",[0.3],{})))),"tests/play/test_driver.py:1067 assert result[\"timings\"][\"keeper_wait_seconds\"] == pytest.approx(0.3)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_continuous_background_events_do_not_starve_idle_prompt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_continuous_background_events_do_not_starve_idle_prompt(pyMonkeypatch(t));});
export async function test_continuous_background_events_never_release_busy_prompt(monkeypatch:any,data:any){
let _:any,clock:any,calls:any,polls:any,result:any;
const __unpack51328=(await continuous_readiness_probe(monkeypatch,[({["success"]:true,["data"]:data})]));assert.equal(__unpack51328.length,5,"Original tuple unpacking requires exact arity");_=__unpack51328[0];clock=__unpack51328[1];calls=__unpack51328[2];polls=__unpack51328[3];result=__unpack51328[4];
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const [kind,_] of pyIterable(calls)){__rows.push(pyEqual(kind,"prompt"));}return __rows;})()))))),"tests/play/test_driver.py:1077 assert not any(kind == \"prompt\" for kind, _ in calls)");
assert.ok(pyBool(pyLessEqual(2,(await pyLen(polls)))),"tests/play/test_driver.py:1078 assert len(polls) >= 2");
assert.ok(pyBool(pyEqual(clock.value,(await pyMethod(nativeAssertions,"approx",[10],{})))),"tests/play/test_driver.py:1079 assert clock.value == pytest.approx(10)");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"timeout")),"tests/play/test_driver.py:1080 assert result[\"settle_class\"] == \"timeout\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("data",[({["isStreaming"]:true}),({["isStreaming"]:false,["isCompacting"]:true}),({["isStreaming"]:false,["pendingMessageCount"]:1})]))).entries())test("test_continuous_background_events_never_release_busy_prompt"+((pyCartesian([{}],pyParametrize("data",[({["isStreaming"]:true}),({["isStreaming"]:false,["isCompacting"]:true}),({["isStreaming"]:false,["pendingMessageCount"]:1})]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_continuous_background_events_never_release_busy_prompt(pyMonkeypatch(t),row["data"]);});
export async function test_unanswered_or_malformed_state_is_not_idle(monkeypatch:any,state:any){
let _:any,calls:any,polls:any,result:any;
const __unpack51855=(await continuous_readiness_probe(monkeypatch,[state]));assert.equal(__unpack51855.length,5,"Original tuple unpacking requires exact arity");_=__unpack51855[0];_=__unpack51855[1];calls=__unpack51855[2];polls=__unpack51855[3];result=__unpack51855[4];
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const [kind,_] of pyIterable(calls)){__rows.push(pyEqual(kind,"prompt"));}return __rows;})()))))),"tests/play/test_driver.py:1087 assert not any(kind == \"prompt\" for kind, _ in calls)");
assert.ok(pyBool(pyLessEqual(2,(await pyLen(polls)))),"tests/play/test_driver.py:1088 assert len(polls) >= 2");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"timeout")),"tests/play/test_driver.py:1089 assert result[\"settle_class\"] == \"timeout\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("state",[null,({}),({["success"]:false}),({["success"]:true,["data"]:({})}),({["success"]:true,["data"]:null}),({["success"]:true,["data"]:[]})]))).entries())test("test_unanswered_or_malformed_state_is_not_idle"+((pyCartesian([{}],pyParametrize("state",[null,({}),({["success"]:false}),({["success"]:true,["data"]:({})}),({["success"]:true,["data"]:null}),({["success"]:true,["data"]:[]})]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_unanswered_or_malformed_state_is_not_idle(pyMonkeypatch(t),row["state"]);});
export async function test_state_polling_keeps_absolute_deadline_when_events_never_stop(monkeypatch:any){
let _:any,clock:any,calls:any,polls:any,result:any;
const __unpack52155=(await continuous_readiness_probe(monkeypatch,[({["success"]:true,["data"]:({["isStreaming"]:true})})],4,undefined));assert.equal(__unpack52155.length,5,"Original tuple unpacking requires exact arity");_=__unpack52155[0];clock=__unpack52155[1];calls=__unpack52155[2];polls=__unpack52155[3];result=__unpack52155[4];
assert.ok(pyBool(pyEqual(polls,[(await pyMethod(nativeAssertions,"approx",[3.0],{}))])),"tests/play/test_driver.py:1094 assert polls == [pytest.approx(3.0)]");
assert.ok(pyBool(pyEqual(clock.value,(await pyMethod(nativeAssertions,"approx",[4.0],{})))),"tests/play/test_driver.py:1095 assert clock.value == pytest.approx(4.0)");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const [kind,_] of pyIterable(calls)){__rows.push(pyEqual(kind,"prompt"));}return __rows;})()))))),"tests/play/test_driver.py:1096 assert not any(kind == \"prompt\" for kind, _ in calls)");
assert.ok(pyBool((pyAt(pyAt(result,"timings"),"prompt_ack_seconds")===null)),"tests/play/test_driver.py:1097 assert result[\"timings\"][\"prompt_ack_seconds\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_state_polling_keeps_absolute_deadline_when_events_never_stop"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_state_polling_keeps_absolute_deadline_when_events_never_stop(pyMonkeypatch(t));});
export async function test_failed_state_may_recover_only_after_a_later_explicit_idle_state(monkeypatch:any){
let _:any,calls:any,polls:any,result:any;
const __unpack52588=(await continuous_readiness_probe(monkeypatch,[({["success"]:false,["data"]:({["isStreaming"]:false})}),({["success"]:true,["data"]:({["isStreaming"]:false})})]));assert.equal(__unpack52588.length,5,"Original tuple unpacking requires exact arity");_=__unpack52588[0];_=__unpack52588[1];calls=__unpack52588[2];polls=__unpack52588[3];result=__unpack52588[4];
assert.ok(pyBool(pyEqual(polls,[(await pyMethod(nativeAssertions,"approx",[3.0],{})),(await pyMethod(nativeAssertions,"approx",[6.0],{}))])),"tests/play/test_driver.py:1105 assert polls == [pytest.approx(3.0), pytest.approx(6.0)]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const [kind,at] of pyIterable(calls)){if(pyBool(pyEqual(kind,"prompt"))){__rows.push(at);}}return __rows;})()),[(await pyMethod(nativeAssertions,"approx",[6.0],{}))])),"tests/play/test_driver.py:1106 assert [at for kind, at in calls if kind == \"prompt\"] == [pytest.approx(6.0)]");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:1107 assert result[\"settle_class\"] == \"settled\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_failed_state_may_recover_only_after_a_later_explicit_idle_state"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_failed_state_may_recover_only_after_a_later_explicit_idle_state(pyMonkeypatch(t));});
export async function test_idle_state_does_not_attribute_buffered_opening_events_to_the_new_prompt(monkeypatch:any){
let _:any,calls:any,result:any;
const __unpack53076=(await continuous_readiness_probe(monkeypatch,[({["success"]:true,["data"]:({["isStreaming"]:false})})],undefined,true));assert.equal(__unpack53076.length,5,"Original tuple unpacking requires exact arity");_=__unpack53076[0];_=__unpack53076[1];calls=__unpack53076[2];_=__unpack53076[3];result=__unpack53076[4];
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const [kind,_] of pyIterable(calls)){__rows.push(pyEqual(kind,"prompt"));}return __rows;})())))),"tests/play/test_driver.py:1112 assert any(kind == \"prompt\" for kind, _ in calls)");
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),"Fixture delivery")),"tests/play/test_driver.py:1113 assert result[\"final_text\"] == \"Fixture delivery\"");
assert.ok(pyBool(pyEqual(pyAt(result,"stop_reason"),"agent_settled")),"tests/play/test_driver.py:1114 assert result[\"stop_reason\"] == \"agent_settled\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_idle_state_does_not_attribute_buffered_opening_events_to_the_new_prompt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_idle_state_does_not_attribute_buffered_opening_events_to_the_new_prompt(pyMonkeypatch(t));});
export async function test_phase_timings_are_additive_and_persisted_without_replacing_wall_time(tmp_path:any){
let spec:any,module:any,daemon:any,timings:any,result:any,saved:any;
spec=(await pyMethod(importlib.util,"spec_from_file_location",["driver_phase_timing",DRIVER],{}));
module=(await pyMethod(importlib.util,"module_from_spec",[spec],{}));
(await pyMethod(spec.loader,"exec_module",[module],{}));
daemon=(await pyMethod(module.Daemon,"__new__",[module.Daemon],{}));
daemon.run_id="timing-fixture";
daemon.dir=String(tmp_path);
daemon._write_heartbeat=(...args:any[])=>null;
daemon.log=(await SimpleNamespace(({"write":(...args:any[])=>null})));
timings=({["readiness_wait_seconds"]:3.0,["prompt_ack_seconds"]:.2,["keeper_wait_seconds"]:.3});
result=(await pyMethod(daemon,"_finalize_turn",[1,"Fixture input",(await pyMethod(module,"now_iso",[],{})),(await pyMethod(module.time,"monotonic",[],{})),[],"Fixture delivery","settled","agent_settled"],{"timings":timings}));
saved=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(tmp_path,"turn-1.json")),"read_text",[],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(saved,"timings"),timings)),"tests/play/test_driver.py:1129 assert saved[\"timings\"] == timings");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"summary"),"timings"),timings)),"tests/play/test_driver.py:1130 assert result[\"summary\"][\"timings\"] == timings");
assert.ok(pyBool(typeof pyAt(saved,"wall_seconds")==="number"),"tests/play/test_driver.py:1131 assert isinstance(saved[\"wall_seconds\"], (int, float))");
assert.ok(pyBool(pyEqual(pyAt(saved,"settle_class"),"settled")),"tests/play/test_driver.py:1132 assert saved[\"settle_class\"] == \"settled\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_phase_timings_are_additive_and_persisted_without_replacing_wall_time"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_phase_timings_are_additive_and_persisted_without_replacing_wall_time(temporary);});
