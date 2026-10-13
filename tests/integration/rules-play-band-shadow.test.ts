// Migrated from tests/play/test_band_shadow_report.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import * as shadow from '../play/band-shadow-report.ts';
import {round,captureOutput} from './rules-play-support.ts';
import {pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";






export async function write_telemetry(path:any,rows:any){
path=Path(path);
(await pyMethod(path.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(path,"write_text",[pyAdd((await pyMethod("\n","join",[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push((await pyMethod(json,"dumps",[r],{"ensure_ascii":false})));}return __rows;})())],{})),"\n")],{"encoding":"utf-8"}));
}
export async function answered(kind:any,band:any,inside:any,confidence:any,ms:any,keeper:any=null){
let table:any;
table=(pyBool(pyEqual(kind,"time"))?"time-costs":"hazards");
return ({["lane"]:"band-shadow",["turn"]:1,["call_id"]:"t1-c1",["index"]:0,["kind"]:kind,["table"]:table,["keeper_value"]:keeper,["ok"]:true,["band"]:band,["range"]:null,["inside"]:inside,["confidence"]:confidence,["distribution"]:({[(await (async()=>{const __left=band;return pyBool(__left)?__left:"unknown";})())]:confidence}),["gate"]:0.5,["ms"]:ms,["jev_calls"]:1,...((pyBool((band===null))?({["reason"]:"unknown"}):({})))});
}
export async function failed(kind:any,reason:any,ms:any,calls:any=1){
let table:any;
table=(pyBool(pyEqual(kind,"time"))?"time-costs":"hazards");
return ({["lane"]:"band-shadow",["turn"]:2,["call_id"]:"t2-c1",["index"]:0,["kind"]:kind,["table"]:table,["keeper_value"]:5,["ok"]:false,["reason"]:reason,["band"]:null,["range"]:null,["inside"]:null,["confidence"]:null,["distribution"]:null,["gate"]:0.5,["ms"]:ms,["jev_calls"]:calls});
}
export async function skipped(kind:any,why:any){

return ({["lane"]:"band-shadow",["turn"]:3,["call_id"]:"t3-c1",["index"]:0,["kind"]:kind,["ok"]:true,["skipped"]:why});
}
export async function unasked(kind:any,reason:any){

return ({["lane"]:"band-shadow",["turn"]:3,["call_id"]:"t3-c1",["index"]:0,["kind"]:kind,["ok"]:false,["reason"]:reason});
}
export let CAMPAIGN_A:any=[({["turn"]:1,["tool"]:"apply",["call_id"]:"t1-c1",["started_at"]:"x",["ms"]:5,["ok"]:true}),(await answered("time","single_room_search",true,0.72,300,20)),(await answered("time","single_room_search",false,0.55,250,240)),(await answered("time","library_research",true,0.81,350,90)),(await answered("time",null,null,0.6,200,10)),(await failed("time","timeout",4000)),(await skipped("time","unconfigured")),({["lane"]:"band-recovery",["turn"]:1,["ok"]:false,["reason"]:"unconfigured"})];
export let CAMPAIGN_B:any=[(await answered("time","quick_observation",true,0.45,100,1)),(await skipped("time","no_declaration")),(await unasked("time","rows_unavailable")),(await answered("damage","moderate",true,0.62,150,"1D6")),(await answered("damage","severe",false,0.3,150,"1D3")),(await failed("damage","schema_error",2,0))];
export let TIME_EXPECTED:any=({["table"]:"time-costs",["rows"]:9,["unasked"]:({["no_declaration"]:1,["rows_unavailable"]:1,["unconfigured"]:1}),["failed"]:({["timeout"]:1}),["answered"]:5,["banded"]:4,["unknown"]:1,["hits"]:3,["hit_rate"]:0.75,["gates"]:({["0.5"]:({["at_or_above"]:3,["rate"]:0.6,["hit_rate"]:0.667}),["0.6"]:({["at_or_above"]:2,["rate"]:0.4,["hit_rate"]:1.0}),["0.7"]:({["at_or_above"]:2,["rate"]:0.4,["hit_rate"]:1.0}),["0.8"]:({["at_or_above"]:1,["rate"]:0.2,["hit_rate"]:1.0})}),["jev_seconds"]:({["calls"]:6,["mean"]:0.867,["total"]:5.2}),["bands"]:({["single_room_search"]:2,["library_research"]:1,["quick_observation"]:1})});
export let DAMAGE_EXPECTED:any=({["table"]:"hazards",["rows"]:3,["unasked"]:({}),["failed"]:({["schema_error"]:1}),["answered"]:2,["banded"]:2,["unknown"]:0,["hits"]:1,["hit_rate"]:0.5,["gates"]:({["0.5"]:({["at_or_above"]:1,["rate"]:0.5,["hit_rate"]:1.0}),["0.6"]:({["at_or_above"]:1,["rate"]:0.5,["hit_rate"]:1.0}),["0.7"]:({["at_or_above"]:0,["rate"]:0.0,["hit_rate"]:null}),["0.8"]:({["at_or_above"]:0,["rate"]:0.0,["hit_rate"]:null})}),["jev_seconds"]:({["calls"]:2,["mean"]:0.15,["total"]:0.3}),["bands"]:({["moderate"]:1,["severe"]:1})});
export async function workspace(tmp_path:any){
(await write_telemetry((await pyMethod(shadow,"telemetry_path",[(await pyStr(tmp_path)),"a"],{})),CAMPAIGN_A));
(await write_telemetry((await pyMethod(shadow,"telemetry_path",[(await pyStr(tmp_path)),"b"],{})),CAMPAIGN_B));
return tmp_path;
}
export async function test_the_numbers_per_kind_over_two_campaigns(workspace:any){
let rows:any,result:any;
rows=(await pyMethod(shadow,"load_rows",[[(await pyMethod(shadow,"telemetry_path",[(await pyStr(workspace)),"a"],{})),(await pyMethod(shadow,"telemetry_path",[(await pyStr(workspace)),"b"],{}))]],{}));
assert.ok(pyBool(pyEqual((await pyLen(rows)),12)),"tests/play/test_band_shadow_report.py:116 assert len(rows) == 12");
result=(await pyMethod(shadow,"report",[rows],{}));
assert.ok(pyBool(pyEqual((await pyList(result)),["time","damage"])),"tests/play/test_band_shadow_report.py:118 assert list(result) == [\"time\", \"damage\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"time"),TIME_EXPECTED)),"tests/play/test_band_shadow_report.py:119 assert result[\"time\"] == TIME_EXPECTED");
assert.ok(pyBool(pyEqual(pyAt(result,"damage"),DAMAGE_EXPECTED)),"tests/play/test_band_shadow_report.py:120 assert result[\"damage\"] == DAMAGE_EXPECTED");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_numbers_per_kind_over_two_campaigns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_numbers_per_kind_over_two_campaigns(await workspace(temporary));});
export async function test_one_campaign_alone_and_a_kind_with_no_rows_is_absent(workspace:any){
let result:any;
result=(await pyMethod(shadow,"report",[(await pyMethod(shadow,"load_rows",[[(await pyMethod(shadow,"telemetry_path",[(await pyStr(workspace)),"a"],{}))]],{}))],{}));
assert.ok(pyBool(pyEqual((await pyList(result)),["time"])),"tests/play/test_band_shadow_report.py:125 assert list(result) == [\"time\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"time"),"rows"),6)),"tests/play/test_band_shadow_report.py:126 assert result[\"time\"][\"rows\"] == 6");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"time"),"hit_rate"),(await round(pyDivide(2,3),3)))),"tests/play/test_band_shadow_report.py:127 assert result[\"time\"][\"hit_rate\"] == round(2 / 3, 3)");
assert.ok(pyBool(pyEqual((await pyMethod(shadow,"report",[[]],{})),({}))),"tests/play/test_band_shadow_report.py:128 assert shadow.report([]) == {}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_one_campaign_alone_and_a_kind_with_no_rows_is_absent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_one_campaign_alone_and_a_kind_with_no_rows_is_absent(await workspace(temporary));});
export async function test_main_reads_campaigns_all_and_files_the_same_way(workspace:any,capsys:any){
let by_campaign:any,files:any;
assert.ok(pyBool(pyEqual((await pyMethod(shadow,"main",[["--campaign","a","--campaign","b","--workspace",(await pyStr(workspace)),"--json"]],{})),0)),"tests/play/test_band_shadow_report.py:132 assert shadow.main([\"--campaign\", \"a\", \"--campaign\", \"b\", \"--workspace\", str(workspace), \"--json\"]) == 0");
by_campaign=(await pyMethod(json,"loads",[(await pyMethod(capsys,"readouterr",[],{})).out],{}));
assert.ok(pyBool(pyEqual(pyAt(by_campaign,"kinds"),({["time"]:TIME_EXPECTED,["damage"]:DAMAGE_EXPECTED}))),"tests/play/test_band_shadow_report.py:134 assert by_campaign[\"kinds\"] == {\"time\": TIME_EXPECTED, \"damage\": DAMAGE_EXPECTED}");
assert.ok(pyBool(pyEqual((await pyMethod(shadow,"main",[["--all","--workspace",(await pyStr(workspace)),"--json"]],{})),0)),"tests/play/test_band_shadow_report.py:135 assert shadow.main([\"--all\", \"--workspace\", str(workspace), \"--json\"]) == 0");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyMethod(capsys,"readouterr",[],{})).out],{})),"kinds"),pyAt(by_campaign,"kinds"))),"tests/play/test_band_shadow_report.py:136 assert json.loads(capsys.readouterr().out)[\"kinds\"] == by_campaign[\"kinds\"]");
files=(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(["a","b"])){__rows.push((await pyStr((await pyMethod(shadow,"telemetry_path",[(await pyStr(workspace)),name],{})))));}return __rows;})());
assert.ok(pyBool(pyEqual((await pyMethod(shadow,"main",[[...files,"--json"]],{})),0)),"tests/play/test_band_shadow_report.py:138 assert shadow.main([*files, \"--json\"]) == 0");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyMethod(capsys,"readouterr",[],{})).out],{})),"kinds"),pyAt(by_campaign,"kinds"))),"tests/play/test_band_shadow_report.py:139 assert json.loads(capsys.readouterr().out)[\"kinds\"] == by_campaign[\"kinds\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_main_reads_campaigns_all_and_files_the_same_way"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_main_reads_campaigns_all_and_files_the_same_way(await workspace(temporary),captureOutput(t));});
export async function test_the_text_report_states_each_number(workspace:any,capsys:any){
let text:any;
assert.ok(pyBool(pyEqual((await pyMethod(shadow,"main",[["--campaign","a","--campaign","b","--workspace",(await pyStr(workspace))]],{})),0)),"tests/play/test_band_shadow_report.py:143 assert shadow.main([\"--campaign\", \"a\", \"--campaign\", \"b\", \"--workspace\", str(workspace)]) == 0");
text=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyContains(text,"=== band shadow: a, b ===")),"tests/play/test_band_shadow_report.py:145 assert \"=== band shadow: a, b ===\" in text");
assert.ok(pyBool(pyContains(text,"--- time (time-costs) ---")),"tests/play/test_band_shadow_report.py:146 assert \"--- time (time-costs) ---\" in text");
assert.ok(pyBool(pyContains(text,"hit rate (Keeper's number inside the argmax band): 3/4 = 0.75")),"tests/play/test_band_shadow_report.py:147 assert \"hit rate (Keeper's number inside the argmax band): 3/4 = 0.75\" in text");
assert.ok(pyBool(pyContains(text,"gate 0.5: at or above 3 (rate 0.6 of answered), hit rate 0.667")),"tests/play/test_band_shadow_report.py:148 assert \"gate 0.5: at or above 3 (rate 0.6 of answered), hit rate 0.667\" in text");
assert.ok(pyBool(pyContains(text,"jev seconds: 6 calls, mean 0.867, total 5.2")),"tests/play/test_band_shadow_report.py:149 assert \"jev seconds: 6 calls, mean 0.867, total 5.2\" in text");
assert.ok(pyBool(pyContains(text,"--- damage (hazards) ---")),"tests/play/test_band_shadow_report.py:150 assert \"--- damage (hazards) ---\" in text");
assert.ok(pyBool(pyContains(text,"failed: {\"schema_error\": 1}")),"tests/play/test_band_shadow_report.py:151 assert 'failed: {\"schema_error\": 1}' in text");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_text_report_states_each_number"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_text_report_states_each_number(await workspace(temporary),captureOutput(t));});
export async function test_a_missing_campaign_is_an_error_not_an_empty_report(tmp_path:any){
assert.throws(()=>shadow.main(["--campaign","nowhere","--workspace",String(tmp_path)]),{code:"ENOENT"});
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_missing_campaign_is_an_error_not_an_empty_report"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_missing_campaign_is_an_error_not_an_empty_report(temporary);});
