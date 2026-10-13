// Migrated from tests/play/test_kpi.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {subprocess,sys,reversed,nativeAssertions,pyEqual} from './rules-play-support.ts';
import * as nativeKpi from '../play/kpi.ts';
const kpi={...nativeKpi,skills:(rows:any,turns:any=null,campaign:any=null)=>nativeKpi.skills(rows,Array.isArray(turns)?turns:null,turns?.campaign??campaign)};
import {pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";








export let KPI_SCRIPT:any=Path(ROOT+'/tests/play/kpi.ts');
export async function write_telemetry(path:any,rows:any){
(await pyMethod(path.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(path,"write_text",[pyAdd((await pyMethod("\n","join",[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push((await pyMethod(json,"dumps",[r],{"ensure_ascii":false})));}return __rows;})())],{})),"\n")],{"encoding":"utf-8"}));
}
export async function row(turn:any,tool:any,call_id:any=null,ok:any=true,code:any=null,ms:any=1){
let r:any;
r=({["turn"]:turn,["tool"]:tool,["call_id"]:call_id,["started_at"]:"2026-01-01T00:00:00.000Z",["ms"]:ms,["ok"]:ok});
if(pyBool((code!==null))){r["code"]=code;}
return r;
}
export let SYNTHETIC_ROWS:any=[(await row(0,"narrate","t0-c1",undefined,undefined,undefined)),({["turn"]:0,["tool"]:"narrate",["event"]:"turn-closed",["round_trips"]:1,["ok"]:true}),({["turn"]:1,["tool"]:"table.player_input",["started_at"]:"x",["ms"]:1,["ok"]:true}),(await row(1,"look")),(await row(1,"lookup")),(await row(1,"apply","t1-c1",undefined,undefined,undefined)),(await row(1,"narrate","t1-c2",undefined,undefined,undefined)),({["turn"]:1,["tool"]:"narrate",["event"]:"turn-closed",["round_trips"]:3,["ok"]:true}),({["turn"]:2,["tool"]:"table.player_input",["started_at"]:"x",["ms"]:1,["ok"]:true}),(await row(2,"look")),(await row(2,"resolve","t2-c1",false,"needs",undefined)),(await row(2,"recall")),(await row(2,"resolve","t2-c2",undefined,undefined,undefined)),(await row(2,"apply","t2-c3",undefined,undefined,undefined)),(await row(2,"narrate","t2-c4",undefined,undefined,undefined)),({["turn"]:2,["tool"]:"narrate",["event"]:"turn-closed",["round_trips"]:4,["ok"]:true}),({["lane"]:"verifier",["turn"]:2,["ok"]:true,["findings"]:0}),({["turn"]:3,["tool"]:"table.player_input",["started_at"]:"x",["ms"]:1,["ok"]:true}),(await row(3,"apply","t3-c1",undefined,undefined,undefined)),(await row(3,"narrate","t3-c2",undefined,undefined,undefined)),({["turn"]:3,["tool"]:"narrate",["event"]:"turn-closed",["round_trips"]:2,["ok"]:true})];
export async function workspace(tmp_path:any){
(await write_telemetry(pyDivide(pyDivide(pyDivide(tmp_path,"campaigns"),"synth"),"telemetry.jsonl"),SYNTHETIC_ROWS));
return tmp_path;
}
export async function test_reads_before_write_skips_over_failed_write_attempts(workspace:any){
let rows:any,per_turn:any;
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(workspace)),"synth"],{}))],{}));
per_turn=(await pyMethod(kpi,"compute",[rows],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,0),"reads_before_write"),0)),"tests/play/test_kpi.py:79 assert per_turn[0][\"reads_before_write\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,1),"reads_before_write"),2)),"tests/play/test_kpi.py:80 assert per_turn[1][\"reads_before_write\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,2),"reads_before_write"),2)),"tests/play/test_kpi.py:83 assert per_turn[2][\"reads_before_write\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,3),"reads_before_write"),0)),"tests/play/test_kpi.py:84 assert per_turn[3][\"reads_before_write\"] == 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reads_before_write_skips_over_failed_write_attempts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reads_before_write_skips_over_failed_write_attempts(await workspace(temporary));});
export async function test_harness_player_input_is_not_a_tool_call(workspace:any){
let rows:any,per_turn:any;
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(workspace)),"synth"],{}))],{}));
per_turn=(await pyMethod(kpi,"compute",[rows],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,1),"total_calls"),4)),"tests/play/test_kpi.py:91 assert per_turn[1][\"total_calls\"] == 4");
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,2),"total_calls"),6)),"tests/play/test_kpi.py:92 assert per_turn[2][\"total_calls\"] == 6");
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,3),"total_calls"),2)),"tests/play/test_kpi.py:93 assert per_turn[3][\"total_calls\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_harness_player_input_is_not_a_tool_call"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_harness_player_input_is_not_a_tool_call(await workspace(temporary));});
export async function test_event_and_lane_rows_are_excluded(workspace:any){
let rows:any,per_turn:any;
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(workspace)),"synth"],{}))],{}));
per_turn=(await pyMethod(kpi,"compute",[rows],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,2),"total_calls"),6)),"tests/play/test_kpi.py:101 assert per_turn[2][\"total_calls\"] == 6");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_event_and_lane_rows_are_excluded"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_event_and_lane_rows_are_excluded(await workspace(temporary));});
export async function test_kernel_errors_and_rules_layer(workspace:any){
let rows:any,per_turn:any;
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(workspace)),"synth"],{}))],{}));
per_turn=(await pyMethod(kpi,"compute",[rows],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,2),"kernel_errors"),1)),"tests/play/test_kpi.py:107 assert per_turn[2][\"kernel_errors\"] == 1");
assert.ok(pyBool((pyAt(pyAt(per_turn,2),"reached_rules_layer")===true)),"tests/play/test_kpi.py:108 assert per_turn[2][\"reached_rules_layer\"] is True");
assert.ok(pyBool((pyAt(pyAt(per_turn,3),"reached_rules_layer")===false)),"tests/play/test_kpi.py:109 assert per_turn[3][\"reached_rules_layer\"] is False");
assert.ok(pyBool(pyEqual(pyAt(pyAt(per_turn,0),"kernel_errors"),0)),"tests/play/test_kpi.py:110 assert per_turn[0][\"kernel_errors\"] == 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_kernel_errors_and_rules_layer"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_kernel_errors_and_rules_layer(await workspace(temporary));});
export async function test_turns_filter_is_inclusive(workspace:any){
let rows:any,per_turn:any;
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(workspace)),"synth"],{}))],{}));
per_turn=(await pyMethod(kpi,"compute",[rows,[1,2]],{}));
assert.ok(pyBool(pyEqual(new Set(Object.keys(per_turn).map(Number)),new Set([1,2]))),"tests/play/test_kpi.py:116 assert set(per_turn) == {1, 2}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_turns_filter_is_inclusive"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_turns_filter_is_inclusive(await workspace(temporary));});
export async function test_summarize_is_deterministic_and_matches_by_hand(workspace:any){
let rows:any,per_turn:any,summary:any,reads:any,again:any;
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(workspace)),"synth"],{}))],{}));
per_turn=(await pyMethod(kpi,"compute",[rows],{}));
summary=(await pyMethod(kpi,"summarize",[per_turn],{}));
assert.ok(pyBool(pyEqual(pyAt(summary,"turns"),4)),"tests/play/test_kpi.py:123 assert summary[\"turns\"] == 4");
reads=[0,2,2,0];
assert.ok(pyBool(pyEqual(pyAt(summary,"reads_before_write_median"),1.0)),"tests/play/test_kpi.py:125 assert summary[\"reads_before_write_median\"] == 1.0");
assert.ok(pyBool(pyEqual(pyAt(summary,"reads_before_write_mean"),(await pyMethod(nativeAssertions,"approx",[1.0],{})))),"tests/play/test_kpi.py:126 assert summary[\"reads_before_write_mean\"] == pytest.approx(1.0)");
assert.ok(pyBool(pyEqual(pyAt(summary,"reads_before_write_max"),2)),"tests/play/test_kpi.py:127 assert summary[\"reads_before_write_max\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(summary,"reached_rules_layer_turns"),1)),"tests/play/test_kpi.py:128 assert summary[\"reached_rules_layer_turns\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(summary,"reached_write_turns"),4)),"tests/play/test_kpi.py:129 assert summary[\"reached_write_turns\"] == 4");
again=(await pyMethod(kpi,"summarize",[(await pyMethod(kpi,"compute",[rows],{}))],{}));
assert.ok(pyBool(pyEqual(again,summary)),"tests/play/test_kpi.py:132 assert again == summary");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_summarize_is_deterministic_and_matches_by_hand"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_summarize_is_deterministic_and_matches_by_hand(await workspace(temporary));});
export async function test_cli_runs_end_to_end_and_prints_the_summary(workspace:any){
let result:any,again:any;
result=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--campaign","synth","--workspace",(await pyStr(workspace))]],{"capture_output":true,"text":true,"check":true}));
assert.ok(pyBool(pyContains(result.stdout,"reads_before_write_median")),"tests/play/test_kpi.py:140 assert \"reads_before_write_median\" in result.stdout");
assert.ok(pyBool((await (async()=>{const __left=pyContains(result.stdout,"turn   2");return pyBool(__left)?__left:pyContains(result.stdout,"turn 2");})())),"tests/play/test_kpi.py:141 assert \"turn   2\" in result.stdout or \"turn 2\" in result.stdout");
again=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--campaign","synth","--workspace",(await pyStr(workspace))]],{"capture_output":true,"text":true,"check":true}));
assert.ok(pyBool(pyEqual(again.stdout,result.stdout)),"tests/play/test_kpi.py:147 assert again.stdout == result.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cli_runs_end_to_end_and_prints_the_summary"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cli_runs_end_to_end_and_prints_the_summary(await workspace(temporary));});
export async function test_cli_turns_filter(workspace:any){
let result:any;
result=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--campaign","synth","--workspace",(await pyStr(workspace)),"--turns","1-2"]],{"capture_output":true,"text":true,"check":true}));
assert.ok(pyBool(!pyContains(result.stdout,"turn   0")),"tests/play/test_kpi.py:155 assert \"turn   0\" not in result.stdout");
assert.ok(pyBool(pyContains(result.stdout,"turns: 2")),"tests/play/test_kpi.py:156 assert \"turns: 2\" in result.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cli_turns_filter"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cli_turns_filter(await workspace(temporary));});
export async function test_cli_requires_campaign_unless_baseline(workspace:any){
let result:any;
result=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--workspace",(await pyStr(workspace))]],{"capture_output":true,"text":true}));
assert.ok(pyBool(!pyEqual(result.returncode,0)),"tests/play/test_kpi.py:164 assert result.returncode != 0");
assert.ok(pyBool(pyContains(result.stderr,"--campaign is required")),"tests/play/test_kpi.py:165 assert \"--campaign is required\" in result.stderr");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cli_requires_campaign_unless_baseline"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cli_requires_campaign_unless_baseline(await workspace(temporary));});
export async function test_cli_missing_telemetry_reports_clearly(tmp_path:any){
let result:any;
result=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--campaign","nope","--workspace",(await pyStr(tmp_path))]],{"capture_output":true,"text":true}));
assert.ok(pyBool(!pyEqual(result.returncode,0)),"tests/play/test_kpi.py:173 assert result.returncode != 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cli_missing_telemetry_reports_clearly"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cli_missing_telemetry_reports_clearly(temporary);});
export async function test_baseline_mode_reads_the_real_haunting_s0_campaign(){
let repo_root:any,telemetry:any,result:any;

repo_root=Path(ROOT);
telemetry=pyDivide(pyDivide(pyDivide(pyDivide(repo_root,".coc"),"campaigns"),"haunting-s0"),"telemetry.jsonl");
assert.ok(await pyMethod(telemetry,"exists",[],{}),"The wrapper skips this original case when retained telemetry is absent");
result=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--baseline"]],{"cwd":(await pyStr(repo_root)),"capture_output":true,"text":true,"check":true}));
assert.ok(pyBool(pyContains(result.stdout,"baseline: haunting-s0 turns 13-25")),"tests/play/test_kpi.py:187 assert \"baseline: haunting-s0 turns 13-25\" in result.stdout");
assert.ok(pyBool(pyContains(result.stdout,"reads_before_write_median")),"tests/play/test_kpi.py:188 assert \"reads_before_write_median\" in result.stdout");
assert.ok(pyBool(pyContains(result.stdout,"turns: 13")),"tests/play/test_kpi.py:189 assert \"turns: 13\" in result.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_baseline_mode_reads_the_real_haunting_s0_campaign"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);if(!Path(ROOT+'/ .coc/campaigns/haunting-s0/telemetry.jsonl'.replace('/ ','/')).exists()){t.skip('No retained baseline telemetry in this checkout');return;}await test_baseline_mode_reads_the_real_haunting_s0_campaign();});
export async function test_admission_section_counts_verdicts_reuse_and_unavailability_apart_from_delivery_time(){
let rows:any,section:any;

rows=[({["turn"]:1,["lane"]:"admission",["verb"]:"apply",["ok"]:true,["verdict"]:"not_authorized",["admitted"]:false,["reused"]:false,["ms"]:900,["key"]:"a"}),({["turn"]:1,["lane"]:"admission",["verb"]:"apply",["ok"]:true,["verdict"]:"not_authorized",["admitted"]:false,["reused"]:true,["ms"]:0,["key"]:"a"}),({["turn"]:2,["lane"]:"admission",["verb"]:"resolve",["ok"]:true,["verdict"]:"entailed",["admitted"]:true,["reused"]:false,["ms"]:300,["key"]:"b"}),({["turn"]:3,["lane"]:"admission",["verb"]:"resolve",["ok"]:false,["reason"]:"timeout",["ms"]:60000,["key"]:"c"}),({["turn"]:0,["lane"]:"admission",["verb"]:"apply",["ok"]:true,["skipped"]:"no_player_text",["key"]:"d"}),({["turn"]:2,["lane"]:"lane-call",["subsession"]:"admission",["phase"]:"end",["ok"]:true,["ms"]:290}),(await row(2,"resolve","t2-c1",undefined,undefined,5000))];
section=(await pyMethod(kpi,"admission",[rows],{}));
assert.ok(pyBool(pyEqual(section,({["reviews"]:2,["reused"]:1,["skipped"]:1,["verdicts"]:({["entailed"]:1,["not_authorized"]:2}),["unavailable"]:({["timeout"]:1}),["review_ms"]:({["total"]:1200,["max"]:900,["mean"]:600})}))),"tests/play/test_kpi.py:204 assert section == {\n        \"reviews\": 2, \"reused\": 1, \"skipped\": 1,\n        \"verdicts\": {\"entailed\": 1, \"not_authorized\": 2},\n        \"unavailable\": {\"timeout\": 1},\n        \"review_ms\": {\"total\": 1200, \"max\": 900, \"mean\": 600},\n    }");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"admission",[[(await row(1,"apply","t1-c1",undefined,undefined,undefined))]],{})),({}))),"tests/play/test_kpi.py:210 assert kpi.admission([row(1, \"apply\", call_id=\"t1-c1\")]) == {}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_admission_section_counts_verdicts_reuse_and_unavailability_apart_from_delivery_time"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_admission_section_counts_verdicts_reuse_and_unavailability_apart_from_delivery_time();});
export async function test_admission_section_splits_reviews_by_the_reviewer_that_decided_them(){
let rows:any,section:any;

rows=[({["turn"]:1,["lane"]:"admission",["verb"]:"apply",["ok"]:true,["verdict"]:"authorized",["reused"]:false,["ms"]:700,["reviewer"]:"jev"}),({["turn"]:1,["lane"]:"admission",["verb"]:"apply",["ok"]:true,["verdict"]:"authorized",["reused"]:true,["ms"]:0,["reviewer"]:"jev"}),({["turn"]:2,["lane"]:"admission",["verb"]:"apply",["ok"]:true,["verdict"]:"entailed",["reused"]:false,["ms"]:9000,["reviewer"]:"lane",["jev_fallback"]:"low_confidence"}),({["turn"]:3,["lane"]:"admission",["verb"]:"resolve",["ok"]:false,["reason"]:"timeout",["ms"]:120000,["reviewer"]:"lane",["jev_fallback"]:"service_error"})];
section=(await pyMethod(kpi,"admission",[rows],{}));
assert.ok(pyBool(pyEqual(pyAt(section,"by_reviewer"),({["jev"]:({["reviews"]:1,["unavailable"]:0,["fallbacks"]:({}),["ms"]:({["total"]:700,["max"]:700,["mean"]:700})}),["lane"]:({["reviews"]:2,["unavailable"]:1,["fallbacks"]:({["low_confidence"]:1,["service_error"]:1}),["ms"]:({["total"]:129000,["max"]:120000,["mean"]:64500})})}))),"tests/play/test_kpi.py:225 assert section[\"by_reviewer\"] == {\n        \"jev\": {\"reviews\": 1, \"unavailable\": 0, \"fallbacks\": {}, \"ms\": {\"total\": 700, \"max\": 700, \"mean\": 700}},\n        \"lane\": {\"reviews\": 2, \"unavailable\": 1, \"fallbacks\": {\"low_confidence\": 1, \"service_error\": 1},\n                 \"ms\": {\"total\": 129000, \"max\": 120000, \"mean\": 64500}},\n    }");
assert.ok(pyBool(!pyContains((await pyMethod(kpi,"admission",[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(r,"items",[],{})))){if(pyBool(!pyContains(["reviewer","jev_fallback"],k))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})())],{})),"by_reviewer")),"tests/play/test_kpi.py:230 assert \"by_reviewer\" not in kpi.admission([{k: v for k, v in r.items() if k not in (\"reviewer\", \"jev_fallback\")} for r in rows])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_admission_section_splits_reviews_by_the_reviewer_that_decided_them"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_admission_section_splits_reviews_by_the_reviewer_that_decided_them();});
export async function test_lane_section_tells_a_lane_that_never_worked_from_one_that_ran_clean(){
let rows:any,section:any;

rows=[({["turn"]:0,["lane"]:"memory",["ok"]:false,["reason"]:"lane_error",["detail"]:"entity 'x' is ambiguous"}),({["turn"]:1,["lane"]:"memory",["ok"]:false,["reason"]:"lane_error",["detail"]:"entity 'x' is ambiguous"}),({["turn"]:2,["lane"]:"memory",["ok"]:false,["reason"]:"lane_error",["detail"]:"entity 'x' is ambiguous"}),({["turn"]:0,["lane"]:"journal",["ok"]:true,["ms"]:12}),({["turn"]:1,["lane"]:"journal",["ok"]:true,["ms"]:14}),({["turn"]:0,["lane"]:"voice",["ok"]:false,["reason"]:"model_error"}),({["turn"]:1,["lane"]:"voice",["ok"]:true}),({["turn"]:2,["lane"]:"voice",["ok"]:false,["reason"]:"model_error"}),({["turn"]:3,["lane"]:"reading",["event"]:"concurrency",["job_id"]:"read-6"})];
section=(await pyMethod(kpi,"lanes",[rows],{}));
assert.ok(pyBool(pyEqual(section,({["journal"]:({["rows"]:2,["failed"]:0,["worst_streak"]:0}),["memory"]:({["rows"]:3,["failed"]:3,["worst_streak"]:3,["reasons"]:({["lane_error"]:3})}),["voice"]:({["rows"]:3,["failed"]:2,["worst_streak"]:1,["reasons"]:({["model_error"]:2})})}))),"tests/play/test_kpi.py:252 assert section == {\n        \"journal\": {\"rows\": 2, \"failed\": 0, \"worst_streak\": 0},\n        \"memory\": {\"rows\": 3, \"failed\": 3, \"worst_streak\": 3, \"reasons\": {\"lane_error\": 3}},\n        \"voice\": {\"rows\": 3, \"failed\": 2, \"worst_streak\": 1, \"reasons\": {\"model_error\": 2}},\n    }");
assert.ok(pyBool(!pyContains(section,"reading")),"tests/play/test_kpi.py:257 assert \"reading\" not in section");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"lanes",[[(await row(1,"apply","t1-c1",undefined,undefined,undefined))]],{})),({}))),"tests/play/test_kpi.py:258 assert kpi.lanes([row(1, \"apply\", call_id=\"t1-c1\")]) == {}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lane_section_tells_a_lane_that_never_worked_from_one_that_ran_clean"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lane_section_tells_a_lane_that_never_worked_from_one_that_ran_clean();});
export async function skill_rows(){

async function skill(turn:any,enabled:any,provider:any,model:any,overrides:any={}){
return ({["lane"]:"skills",["campaign"]:"skills-test",["turn"]:turn,["run_id"]:`run-${turn}`,["enabled"]:enabled,["provider"]:provider,["model"]:model,["provider_models"]:[({["provider"]:provider,["model"]:model,["rounds"]:(await pyMethod(overrides,"get",["provider_rounds",2],{}))})],["mixed_provider_model"]:false,["offered"]:(pyBool(enabled)?["direct-authorized-change"]:[]),["selected"]:null,["invalid_selection"]:null,["tool_names"]:["apply","narrate"],["provider_rounds"]:2,["refusal_classes"]:[],["delivered"]:true,["fallback"]:false,...overrides});
}
return [(await skill(1,false,"grok-build","grok-4.6",({"provider_rounds":4}))),(await skill(2,true,"grok-build","grok-4.6",({"selected":"direct-authorized-change"}))),(await skill(3,true,"grok-build","grok-4.6",({"selected":"direct-authorized-change","delivered":false,"fallback":true,"refusal_classes":["action_not_authorized"],"provider_rounds":5,"tool_names":["apply","apply"]}))),(await skill(4,true,"grok-build","grok-4.6",({"invalid_selection":"not-offered"}))),(await skill(5,false,"deepseek","deepseek-v4.1-flash",({"provider_rounds":8}))),(await skill(6,true,"deepseek","deepseek-v4.1-flash",({"selected":"direct-authorized-change","provider_rounds":6,"tool_names":["look","apply","narrate"]})))];
}
export async function test_skills_stratify_arms_and_exact_provider_model(skill_rows:any){
let result:any,strata:any,grok:any,off:any,deepseek:any,other:any;
result=(await pyMethod(kpi,"skills",[skill_rows],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"rows"),6)),"tests/play/test_kpi.py:290 assert result[\"rows\"] == 6");
strata=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(result,"strata"))){__rows.push([[pyAt(s,"provider"),pyAt(s,"model"),pyAt(s,"enabled")],s]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyLen(strata)),4)),"tests/play/test_kpi.py:292 assert len(strata) == 4");
grok=pyAt(strata,["grok-build","grok-4.6",true]);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(grok,"rows");const __term1=pyAt(grok,"runs");const __term2=pyAt(grok,"offered_runs");const __term3=3;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==")&&pyCompare(__term2,__term3,"==");})())),"tests/play/test_kpi.py:294 assert grok[\"rows\"] == grok[\"runs\"] == grok[\"offered_runs\"] == 3");
assert.ok(pyBool(pyEqual(pyAt(grok,"offered"),({["direct-authorized-change"]:3}))),"tests/play/test_kpi.py:295 assert grok[\"offered\"] == {\"direct-authorized-change\": 3}");
assert.ok(pyBool(pyEqual(pyAt(grok,"selected"),({["direct-authorized-change"]:2}))),"tests/play/test_kpi.py:296 assert grok[\"selected\"] == {\"direct-authorized-change\": 2}");
assert.ok(pyBool(pyEqual(pyAt(grok,"selected_runs"),2)),"tests/play/test_kpi.py:297 assert grok[\"selected_runs\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(grok,"selection_rate"),0.667)),"tests/play/test_kpi.py:298 assert grok[\"selection_rate\"] == 0.667");
assert.ok(pyBool(pyEqual(pyAt(grok,"invalid_selections"),1)),"tests/play/test_kpi.py:299 assert grok[\"invalid_selections\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(grok,"delivered_after_selection"),({["runs"]:1,["observed"]:2,["rate"]:0.5}))),"tests/play/test_kpi.py:300 assert grok[\"delivered_after_selection\"] == {\"runs\": 1, \"observed\": 2, \"rate\": 0.5}");
assert.ok(pyBool(pyEqual(pyAt(grok,"fallback_after_selection"),({["runs"]:1,["observed"]:2,["rate"]:0.5}))),"tests/play/test_kpi.py:301 assert grok[\"fallback_after_selection\"] == {\"runs\": 1, \"observed\": 2, \"rate\": 0.5}");
assert.ok(pyBool(pyEqual(pyAt(grok,"refusals"),({["runs"]:1,["observed"]:3,["rate"]:0.333,["classes"]:({["action_not_authorized"]:1})}))),"tests/play/test_kpi.py:302 assert grok[\"refusals\"] == {\"runs\": 1, \"observed\": 3, \"rate\": 0.333,\n                                 \"classes\": {\"action_not_authorized\": 1}}");
assert.ok(pyBool(pyEqual(pyAt(grok,"provider_rounds"),({["samples"]:3,["counts"]:({["2"]:2,["5"]:1}),["min"]:2,["max"]:5,["median"]:2,["mean"]:3}))),"tests/play/test_kpi.py:304 assert grok[\"provider_rounds\"] == {\"samples\": 3, \"counts\": {\"2\": 2, \"5\": 1},\n                                         \"min\": 2, \"max\": 5, \"median\": 2, \"mean\": 3}");
assert.ok(pyBool(pyEqual(pyAt(grok,"tool_sequences"),[({["tool_names"]:["apply","apply"],["runs"]:1}),({["tool_names"]:["apply","narrate"],["runs"]:2})])),"tests/play/test_kpi.py:306 assert grok[\"tool_sequences\"] == [{\"tool_names\": [\"apply\", \"apply\"], \"runs\": 1},\n                                       {\"tool_names\": [\"apply\", \"narrate\"], \"runs\": 2}]");
off=pyAt(strata,["grok-build","grok-4.6",false]);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(off,"offered_runs");const __term1=pyAt(off,"selected_runs");const __term2=0;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:309 assert off[\"offered_runs\"] == off[\"selected_runs\"] == 0");
assert.ok(pyBool((pyAt(off,"selection_rate")===null)),"tests/play/test_kpi.py:310 assert off[\"selection_rate\"] is None");
assert.ok(pyBool(pyEqual(pyAt(pyAt(off,"provider_rounds"),"mean"),4)),"tests/play/test_kpi.py:311 assert off[\"provider_rounds\"][\"mean\"] == 4");
deepseek=pyAt(strata,["deepseek","deepseek-v4.1-flash",true]);
assert.ok(pyBool(pyEqual(pyAt(pyAt(deepseek,"provider_rounds"),"mean"),6)),"tests/play/test_kpi.py:313 assert deepseek[\"provider_rounds\"][\"mean\"] == 6");
assert.ok(pyBool(pyEqual(pyAt(pyAt(deepseek,"delivered_after_selection"),"rate"),1)),"tests/play/test_kpi.py:314 assert deepseek[\"delivered_after_selection\"][\"rate\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(deepseek,"fallback_after_selection"),"rate"),0)),"tests/play/test_kpi.py:315 assert deepseek[\"fallback_after_selection\"][\"rate\"] == 0");
other=({...pyAt(skill_rows,1),["provider"]:"other",["provider_models"]:[({["provider"]:"other",["model"]:"grok-4.6",["rounds"]:2})]});
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await pyMethod(kpi,"skills",[pyAdd(skill_rows,[other])],{})),"strata"))),5)),"tests/play/test_kpi.py:319 assert len(kpi.skills(skill_rows + [other])[\"strata\"]) == 5");
assert.ok(pyBool((pyAt(grok,"comparison_eligible")===true)),"tests/play/test_kpi.py:320 assert grok[\"comparison_eligible\"] is True");
assert.ok(pyBool(pyEqual(pyAt(grok,"provider_models"),[({["provider"]:"grok-build",["model"]:"grok-4.6",["rounds"]:9})])),"tests/play/test_kpi.py:321 assert grok[\"provider_models\"] == [{\"provider\": \"grok-build\", \"model\": \"grok-4.6\", \"rounds\": 9}]");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"skills",[(await pyList((await reversed(skill_rows))))],{})),result)),"tests/play/test_kpi.py:322 assert kpi.skills(list(reversed(skill_rows))) == result");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_stratify_arms_and_exact_provider_model"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_stratify_arms_and_exact_provider_model(await skill_rows());});
export async function test_skills_missing_optional_fields_are_not_false_outcomes(){
let result:any,unknown:any;
result=pyAt(pyAt((await pyMethod(kpi,"skills",[[({["lane"]:"skills",["enabled"]:true,["offered"]:["repair-named-gap"],["selected"]:"repair-named-gap"})]],{})),"unavailable_identity_runs"),0);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(result,"provider");const __term1=pyAt(result,"model");const __term2=null;return pyCompare(__term0,__term1,"is")&&pyCompare(__term1,__term2,"is");})())),"tests/play/test_kpi.py:328 assert result[\"provider\"] is result[\"model\"] is None");
assert.ok(pyBool(pyEqual(pyAt(result,"delivered_after_selection"),({["runs"]:0,["observed"]:0,["rate"]:null}))),"tests/play/test_kpi.py:329 assert result[\"delivered_after_selection\"] == {\"runs\": 0, \"observed\": 0, \"rate\": None}");
assert.ok(pyBool((pyAt(pyAt(result,"fallback_after_selection"),"rate")===null)),"tests/play/test_kpi.py:330 assert result[\"fallback_after_selection\"][\"rate\"] is None");
assert.ok(pyBool((pyAt(pyAt(result,"refusals"),"rate")===null)),"tests/play/test_kpi.py:331 assert result[\"refusals\"][\"rate\"] is None");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"provider_rounds"),"samples"),0)),"tests/play/test_kpi.py:332 assert result[\"provider_rounds\"][\"samples\"] == 0");
assert.ok(pyBool((pyAt(pyAt(result,"provider_rounds"),"mean")===null)),"tests/play/test_kpi.py:333 assert result[\"provider_rounds\"][\"mean\"] is None");
assert.ok(pyBool(pyEqual(pyAt(result,"tool_sequences"),[])),"tests/play/test_kpi.py:334 assert result[\"tool_sequences\"] == []");
assert.ok(pyBool(pyEqual(pyAt(result,"tool_sequences_unavailable"),1)),"tests/play/test_kpi.py:335 assert result[\"tool_sequences_unavailable\"] == 1");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(result,"wall_ms"),"status");const __term1=pyAt(pyAt(result,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:336 assert result[\"wall_ms\"][\"status\"] == result[\"admission\"][\"status\"] == \"unavailable\"");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"skills",[SYNTHETIC_ROWS],{})),({}))),"tests/play/test_kpi.py:337 assert kpi.skills(SYNTHETIC_ROWS) == {}");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"skills",[[]],{})),({}))),"tests/play/test_kpi.py:338 assert kpi.skills([]) == {}");
unknown=pyAt(pyAt((await pyMethod(kpi,"skills",[[({["lane"]:"skills"})]],{})),"unavailable_identity_runs"),0);
assert.ok(pyBool((pyAt(unknown,"comparison_eligible")===false)),"tests/play/test_kpi.py:340 assert unknown[\"comparison_eligible\"] is False");
assert.ok(pyBool((pyAt(unknown,"enabled")===null)),"tests/play/test_kpi.py:341 assert unknown[\"enabled\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_missing_optional_fields_are_not_false_outcomes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_missing_optional_fields_are_not_false_outcomes();});
export async function test_skills_join_only_exact_run_owned_evidence(skill_rows:any){
let run:any,evidence:any,section:any,untimed:any,no_reviews:any,field:any,incomplete:any,file_rows:any,invalid_id:any,conflicting:any,missing_ids:any;
run=pyAt(skill_rows,1);
evidence=[({...(await row(2,"table.player_input")),["campaign"]:"skills-test"}),({...(await row(2,"narrate",undefined,undefined,undefined,250)),["campaign"]:"skills-test",["started_at"]:"2026-01-01T00:00:10Z"}),({["lane"]:"admission",["campaign"]:"skills-test",["turn"]:2,["ok"]:true,["verdict"]:"entailed",["reused"]:false,["ms"]:400}),({["lane"]:"admission",["campaign"]:"skills-test",["turn"]:2,["ok"]:true,["verdict"]:"entailed",["reused"]:true,["ms"]:0}),({["lane"]:"admission",["campaign"]:"other",["turn"]:2,["ok"]:false,["reason"]:"timeout"})];
evidence=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(evidence)){__rows.push(({...r,["run_id"]:pyAt(run,"run_id")}));}return __rows;})());
section=pyAt(pyAt((await pyMethod(kpi,"skills",[[run,...evidence]],{})),"strata"),0);
assert.ok(pyBool(pyEqual(pyAt(pyAt(section,"wall_ms"),"mean"),10250)),"tests/play/test_kpi.py:357 assert section[\"wall_ms\"][\"mean\"] == 10250");
assert.ok(pyBool(pyEqual(pyAt(pyAt(section,"wall_ms"),"unavailable_runs"),0)),"tests/play/test_kpi.py:358 assert section[\"wall_ms\"][\"unavailable_runs\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(section,"admission"),"joined_runs"),1)),"tests/play/test_kpi.py:359 assert section[\"admission\"][\"joined_runs\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(section,"admission"),"summary"),"reviews"),1)),"tests/play/test_kpi.py:360 assert section[\"admission\"][\"summary\"][\"reviews\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(section,"admission"),"summary"),"reused"),1)),"tests/play/test_kpi.py:361 assert section[\"admission\"][\"summary\"][\"reused\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(section,"admission"),"summary"),"unavailable"),({}))),"tests/play/test_kpi.py:362 assert section[\"admission\"][\"summary\"][\"unavailable\"] == {}");
untimed=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(evidence)){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(r,"items",[],{})))){if(pyBool(!pyEqual(k,"started_at"))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})());
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await pyMethod(kpi,"skills",[[run,...untimed]],{})),"strata"),0),"wall_ms"),"status"),"unavailable")),"tests/play/test_kpi.py:365 assert kpi.skills([run, *untimed])[\"strata\"][0][\"wall_ms\"][\"status\"] == \"unavailable\"");
no_reviews=pyAt(pyAt((await pyMethod(kpi,"skills",[[run,...pySlice(evidence,undefined,2)]],{})),"strata"),0);
assert.ok(pyBool(pyEqual(pyAt(pyAt(no_reviews,"admission"),"status"),"unavailable")),"tests/play/test_kpi.py:368 assert no_reviews[\"admission\"][\"status\"] == \"unavailable\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(no_reviews,"admission"),"summary"),({}))),"tests/play/test_kpi.py:369 assert no_reviews[\"admission\"][\"summary\"] == {}");
for(section of pyIterable(pyAt((await pyMethod(kpi,"skills",[[run,({...run,["enabled"]:false}),...evidence]],{})),"strata"))){
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(section,"wall_ms"),"status");const __term1=pyAt(pyAt(section,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:372 assert section[\"wall_ms\"][\"status\"] == section[\"admission\"][\"status\"] == \"unavailable\"");
}
for(field of pyIterable(["campaign","turn","run_id"])){
incomplete=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(run,"items",[],{})))){if(pyBool(!pyEqual(k,field))){__rows.push([k,v]);}}return __rows;})()));
section=pyAt(pyAt((await pyMethod(kpi,"skills",[[incomplete,...evidence]],{})),"strata"),0);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(section,"wall_ms"),"status");const __term1=pyAt(pyAt(section,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:376 assert section[\"wall_ms\"][\"status\"] == section[\"admission\"][\"status\"] == \"unavailable\"");
}
file_rows=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable([run,...pySlice(evidence,undefined,4)])){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(r,"items",[],{})))){if(pyBool(!pyEqual(k,"campaign"))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})());
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await pyMethod(kpi,"skills",[file_rows],{"campaign":"skills-test"})),"strata"),0),"wall_ms"),"mean"),10250)),"tests/play/test_kpi.py:379 assert kpi.skills(file_rows, campaign=\"skills-test\")[\"strata\"][0][\"wall_ms\"][\"mean\"] == 10250");
for(invalid_id of pyIterable([null,""," ","different",42])){
conflicting=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(evidence)){__rows.push(({...r,["run_id"]:invalid_id}));}return __rows;})());
section=pyAt(pyAt((await pyMethod(kpi,"skills",[[run,...conflicting]],{})),"strata"),0);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(section,"wall_ms"),"status");const __term1=pyAt(pyAt(section,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:383 assert section[\"wall_ms\"][\"status\"] == section[\"admission\"][\"status\"] == \"unavailable\"");
}
missing_ids=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(evidence)){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(r,"items",[],{})))){if(pyBool(!pyEqual(k,"run_id"))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})());
section=pyAt(pyAt((await pyMethod(kpi,"skills",[[run,...missing_ids]],{})),"strata"),0);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(section,"wall_ms"),"status");const __term1=pyAt(pyAt(section,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:386 assert section[\"wall_ms\"][\"status\"] == section[\"admission\"][\"status\"] == \"unavailable\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_join_only_exact_run_owned_evidence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_join_only_exact_run_owned_evidence(await skill_rows());});
export async function test_skills_recovery_cannot_borrow_unledgered_run_evidence(skill_rows:any){
let run:any,old:any,delivery:any,old_rows:any,section:any,second:any,owned:any,report:any,by_arm:any;
run=pyAt(skill_rows,1);
old=[({...(await row(2,"table.player_input")),["campaign"]:"skills-test",["run_id"]:"interrupted"}),({["lane"]:"admission",["campaign"]:"skills-test",["turn"]:2,["run_id"]:"interrupted",["ok"]:true,["verdict"]:"entailed",["ms"]:400})];
delivery=({...(await row(2,"narrate",undefined,undefined,undefined,100)),["campaign"]:"skills-test",["run_id"]:pyAt(run,"run_id"),["started_at"]:"2026-01-01T00:00:10Z"});
for(old_rows of pyIterable([old,(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(old)){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(r,"items",[],{})))){if(pyBool(!pyEqual(k,"run_id"))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})())])){
section=pyAt(pyAt((await pyMethod(kpi,"skills",[[...old_rows,delivery,run]],{})),"strata"),0);
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(section,"wall_ms"),"status");const __term1=pyAt(pyAt(section,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:400 assert section[\"wall_ms\"][\"status\"] == section[\"admission\"][\"status\"] == \"unavailable\"");
}
second=({...run,["run_id"]:"second",["enabled"]:false,["selected"]:null,["offered"]:[]});
owned=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(old)){__rows.push(({...r,["run_id"]:pyAt(run,"run_id")}));}return __rows;})());
report=(await pyMethod(kpi,"skills",[[run,second,...owned,delivery]],{}));
by_arm=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(report,"strata"))){__rows.push([pyAt(s,"enabled"),s]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(by_arm,true),"wall_ms"),"mean"),10100)),"tests/play/test_kpi.py:406 assert by_arm[True][\"wall_ms\"][\"mean\"] == 10100");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(pyAt(by_arm,false),"wall_ms"),"status");const __term1=pyAt(pyAt(pyAt(by_arm,false),"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:407 assert by_arm[False][\"wall_ms\"][\"status\"] == by_arm[False][\"admission\"][\"status\"] == \"unavailable\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_recovery_cannot_borrow_unledgered_run_evidence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_recovery_cannot_borrow_unledgered_run_evidence(await skill_rows());});
export async function test_skills_mixed_run_is_separate_and_keeps_exact_identity_rounds(skill_rows:any){
let models:any,mixed:any,report:any,entry:any;
models=[({["provider"]:"route-a",["model"]:"model-a",["rounds"]:2}),({["provider"]:"route-b",["model"]:"model-b",["rounds"]:1})];
mixed=({...pyAt(skill_rows,1),["run_id"]:"mixed",["provider"]:null,["model"]:null,["provider_rounds"]:3,["provider_models"]:models,["mixed_provider_model"]:true});
report=(await pyMethod(kpi,"skills",[[...skill_rows,mixed]],{}));
assert.ok(pyBool(pyEqual(pyAt(report,"rows"),7)),"tests/play/test_kpi.py:416 assert report[\"rows\"] == 7");
assert.ok(pyBool(pyEqual(pyAt(report,"strata"),pyAt((await pyMethod(kpi,"skills",[skill_rows],{})),"strata"))),"tests/play/test_kpi.py:417 assert report[\"strata\"] == kpi.skills(skill_rows)[\"strata\"]");
assert.ok(pyBool(pyEqual(pyAt(report,"unavailable_identity_runs"),[])),"tests/play/test_kpi.py:418 assert report[\"unavailable_identity_runs\"] == []");
entry=pyAt(pyAt(report,"mixed_runs"),0);
assert.ok(pyBool((pyAt(entry,"comparison_eligible")===false)),"tests/play/test_kpi.py:420 assert entry[\"comparison_eligible\"] is False");
assert.ok(pyBool(pyEqual(pyAt(entry,"identity_status"),"mixed")),"tests/play/test_kpi.py:421 assert entry[\"identity_status\"] == \"mixed\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(entry,"provider");const __term1=pyAt(entry,"model");const __term2=null;return pyCompare(__term0,__term1,"is")&&pyCompare(__term1,__term2,"is");})())),"tests/play/test_kpi.py:422 assert entry[\"provider\"] is entry[\"model\"] is None");
assert.ok(pyBool(pyEqual(pyAt(entry,"provider_models"),models)),"tests/play/test_kpi.py:423 assert entry[\"provider_models\"] == models");
assert.ok(pyBool(pyEqual(pyAt(entry,"run_id"),"mixed")),"tests/play/test_kpi.py:424 assert entry[\"run_id\"] == \"mixed\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(entry,"provider_rounds"),"mean"),3)),"tests/play/test_kpi.py:425 assert entry[\"provider_rounds\"][\"mean\"] == 3");
assert.ok(pyBool(pyEqual(pyAt(entry,"tool_sequences"),[({["tool_names"]:["apply","narrate"],["runs"]:1})])),"tests/play/test_kpi.py:426 assert entry[\"tool_sequences\"] == [{\"tool_names\": [\"apply\", \"narrate\"], \"runs\": 1}]");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"skills",[[mixed,...(await reversed(skill_rows))]],{})),report)),"tests/play/test_kpi.py:427 assert kpi.skills([mixed, *reversed(skill_rows)]) == report");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_mixed_run_is_separate_and_keeps_exact_identity_rounds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_mixed_run_is_separate_and_keeps_exact_identity_rounds(await skill_rows());});
export async function test_skills_malformed_identity_is_not_comparison_eligible(skill_rows:any,overrides:any){
let report:any,entry:any;
report=(await pyMethod(kpi,"skills",[[({...pyAt(skill_rows,1),...overrides})]],{}));
assert.ok(pyBool(pyEqual(pyAt(report,"strata"),[])),"tests/play/test_kpi.py:448 assert report[\"strata\"] == []");
assert.ok(pyBool(pyEqual(pyAt(report,"rows"),1)),"tests/play/test_kpi.py:449 assert report[\"rows\"] == 1");
entry=pyAt(pyAdd(pyAt(report,"mixed_runs"),pyAt(report,"unavailable_identity_runs")),0);
assert.ok(pyBool(pyEqual(pyAt(entry,"identity_status"),"unavailable")),"tests/play/test_kpi.py:451 assert entry[\"identity_status\"] == \"unavailable\"");
assert.ok(pyBool((pyAt(entry,"comparison_eligible")===false)),"tests/play/test_kpi.py:452 assert entry[\"comparison_eligible\"] is False");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(entry,"provider");const __term1=pyAt(entry,"model");const __term2=null;return pyCompare(__term0,__term1,"is")&&pyCompare(__term1,__term2,"is");})())),"tests/play/test_kpi.py:453 assert entry[\"provider\"] is entry[\"model\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("overrides",[({["provider_models"]:null}),({["provider_models"]:[]}),({["provider_models"]:"bad"}),({["provider_models"]:[null]}),({["provider_models"]:[({["provider"]:"grok-build",["model"]:"grok-4.6",["rounds"]:true})]}),({["provider_models"]:[({["provider"]:"grok-build",["model"]:"grok-4.6",["rounds"]:(-1)})]}),({["provider_models"]:[({["provider"]:"",["model"]:"grok-4.6",["rounds"]:2})]}),({["provider_models"]:[({["provider"]:"grok-build",["model"]:[],["rounds"]:2})]}),({["mixed_provider_model"]:true}),({["mixed_provider_model"]:"false"}),({["provider"]:"different"}),({["provider_rounds"]:3}),({["provider_models"]:[({["provider"]:"a",["model"]:"a",["rounds"]:1}),({["provider"]:"b",["model"]:"b",["rounds"]:1})]}),({["mixed_provider_model"]:true,["provider_models"]:[({["provider"]:"a",["model"]:"a",["rounds"]:1}),({["provider"]:"b",["model"]:"b",["rounds"]:1})]}),({["provider_models"]:pyMultiply([({["provider"]:"a",["model"]:"b",["rounds"]:1})],2)})]))).entries())test("test_skills_malformed_identity_is_not_comparison_eligible"+((pyCartesian([{}],pyParametrize("overrides",[({["provider_models"]:null}),({["provider_models"]:[]}),({["provider_models"]:"bad"}),({["provider_models"]:[null]}),({["provider_models"]:[({["provider"]:"grok-build",["model"]:"grok-4.6",["rounds"]:true})]}),({["provider_models"]:[({["provider"]:"grok-build",["model"]:"grok-4.6",["rounds"]:(-1)})]}),({["provider_models"]:[({["provider"]:"",["model"]:"grok-4.6",["rounds"]:2})]}),({["provider_models"]:[({["provider"]:"grok-build",["model"]:[],["rounds"]:2})]}),({["mixed_provider_model"]:true}),({["mixed_provider_model"]:"false"}),({["provider"]:"different"}),({["provider_rounds"]:3}),({["provider_models"]:[({["provider"]:"a",["model"]:"a",["rounds"]:1}),({["provider"]:"b",["model"]:"b",["rounds"]:1})]}),({["mixed_provider_model"]:true,["provider_models"]:[({["provider"]:"a",["model"]:"a",["rounds"]:1}),({["provider"]:"b",["model"]:"b",["rounds"]:1})]}),({["provider_models"]:pyMultiply([({["provider"]:"a",["model"]:"b",["rounds"]:1})],2)})]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_malformed_identity_is_not_comparison_eligible(await skill_rows(),row["overrides"]);});
export async function test_skills_new_identity_requires_matching_nonempty_top_level_fields(skill_rows:any,field:any,value:any){
let run:any,report:any,entry:any;
run=({...pyAt(skill_rows,1),[field]:value});
report=(await pyMethod(kpi,"skills",[[run]],{}));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(report,"strata");const __term1=pyAt(report,"mixed_runs");const __term2:any[]=[];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:461 assert report[\"strata\"] == report[\"mixed_runs\"] == []");
entry=pyAt(pyAt(report,"unavailable_identity_runs"),0);
assert.ok(pyBool(pyEqual(pyAt(entry,"identity_status"),"unavailable")),"tests/play/test_kpi.py:463 assert entry[\"identity_status\"] == \"unavailable\"");
assert.ok(pyBool((pyAt(entry,"comparison_eligible")===false)),"tests/play/test_kpi.py:464 assert entry[\"comparison_eligible\"] is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("field",["provider","model"])),pyParametrize("value",[null,""," ","different"]))).entries())test("test_skills_new_identity_requires_matching_nonempty_top_level_fields"+((pyCartesian(pyCartesian([{}],pyParametrize("field",["provider","model"])),pyParametrize("value",[null,""," ","different"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_new_identity_requires_matching_nonempty_top_level_fields(await skill_rows(),row["field"],row["value"]);});
export async function test_skills_new_identity_requires_present_top_level_fields(skill_rows:any,field:any){
let run:any,report:any,entry:any;
run=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(pyAt(skill_rows,1),"items",[],{})))){if(pyBool(!pyEqual(k,field))){__rows.push([k,v]);}}return __rows;})()));
report=(await pyMethod(kpi,"skills",[[run]],{}));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(report,"strata");const __term1=pyAt(report,"mixed_runs");const __term2:any[]=[];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:471 assert report[\"strata\"] == report[\"mixed_runs\"] == []");
entry=pyAt(pyAt(report,"unavailable_identity_runs"),0);
assert.ok(pyBool(pyEqual(pyAt(entry,"identity_status"),"unavailable")),"tests/play/test_kpi.py:473 assert entry[\"identity_status\"] == \"unavailable\"");
assert.ok(pyBool((pyAt(entry,"comparison_eligible")===false)),"tests/play/test_kpi.py:474 assert entry[\"comparison_eligible\"] is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("field",["provider","model"]))).entries())test("test_skills_new_identity_requires_present_top_level_fields"+((pyCartesian([{}],pyParametrize("field",["provider","model"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_new_identity_requires_present_top_level_fields(await skill_rows(),row["field"]);});
export async function test_skills_historical_identity_counts_without_run_joins(skill_rows:any){
let historical:any,report:any,entry:any;
historical=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(skill_rows)){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(r,"items",[],{})))){if(pyBool(!pyContains(["run_id","provider_models","mixed_provider_model"],k))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})());
report=(await pyMethod(kpi,"skills",[historical],{}));
assert.ok(pyBool(pyEqual(pyAt(report,"rows"),6)),"tests/play/test_kpi.py:481 assert report[\"rows\"] == 6");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(report,"strata"))),4)),"tests/play/test_kpi.py:482 assert len(report[\"strata\"]) == 4");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(report,"mixed_runs");const __term1=pyAt(report,"unavailable_identity_runs");const __term2:any[]=[];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:483 assert report[\"mixed_runs\"] == report[\"unavailable_identity_runs\"] == []");
for(entry of pyIterable(pyAt(report,"strata"))){
assert.ok(pyBool(pyEqual(pyAt(entry,"provider_models_unavailable_runs"),pyAt(entry,"runs"))),"tests/play/test_kpi.py:485 assert entry[\"provider_models_unavailable_runs\"] == entry[\"runs\"]");
assert.ok(pyBool((pyAt(pyAt(pyAt(entry,"provider_models"),0),"rounds")===null)),"tests/play/test_kpi.py:486 assert entry[\"provider_models\"][0][\"rounds\"] is None");
assert.ok(pyBool(pyEqual(pyAt(pyAt(entry,"provider_rounds"),"samples"),pyAt(entry,"runs"))),"tests/play/test_kpi.py:487 assert entry[\"provider_rounds\"][\"samples\"] == entry[\"runs\"]");
assert.ok(pyBool(pyEqual(pyAt(entry,"tool_sequences_unavailable"),0)),"tests/play/test_kpi.py:488 assert entry[\"tool_sequences_unavailable\"] == 0");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(entry,"wall_ms"),"status");const __term1=pyAt(pyAt(entry,"admission"),"status");const __term2="unavailable";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_kpi.py:489 assert entry[\"wall_ms\"][\"status\"] == entry[\"admission\"][\"status\"] == \"unavailable\"");
}
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"skills",[SYNTHETIC_ROWS],{})),({}))),"tests/play/test_kpi.py:490 assert kpi.skills(SYNTHETIC_ROWS) == {}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_historical_identity_counts_without_run_joins"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_historical_identity_counts_without_run_joins(await skill_rows());});
export async function test_skills_cli_is_json_and_respects_turn_filter(tmp_path:any,skill_rows:any){
let args:any,result:any,line:any,report:any;
(await write_telemetry(pyDivide(pyDivide(pyDivide(tmp_path,"campaigns"),"skills-test"),"telemetry.jsonl"),skill_rows));
args=[sys.executable,(await pyStr(KPI_SCRIPT)),"--workspace",(await pyStr(tmp_path)),"--campaign","skills-test","--turns","2-3"];
result=(await pyMethod(subprocess,"run",[args],{"capture_output":true,"text":true,"check":true}));
line=(await pyNext((await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await pyMethod(result.stdout,"splitlines",[],{})))){if(pyBool((await pyMethod(line,"startswith",["skills: "],{})))){__rows.push(line);}}return __rows;})())));
report=(await pyMethod(json,"loads",[line.slice("skills: ".length)],{}));
assert.ok(pyBool(pyEqual(report,(await pyMethod(kpi,"skills",[skill_rows,[2,3],"skills-test"],{})))),"tests/play/test_kpi.py:500 assert report == kpi.skills(skill_rows, (2, 3), \"skills-test\")");
assert.ok(pyBool(pyEqual(pyAt(report,"rows"),2)),"tests/play/test_kpi.py:501 assert report[\"rows\"] == 2");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(report,"strata"))),1)),"tests/play/test_kpi.py:502 assert len(report[\"strata\"]) == 1");
assert.ok(pyBool(pyEqual((await pyMethod(subprocess,"run",[args],{"capture_output":true,"text":true,"check":true})).stdout,result.stdout)),"tests/play/test_kpi.py:503 assert subprocess.run(args, capture_output=True, text=True, check=True).stdout == result.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skills_cli_is_json_and_respects_turn_filter"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skills_cli_is_json_and_respects_turn_filter(temporary,await skill_rows());});
export async function test_a_lane_failure_reaches_the_printed_report(tmp_path:any){
let telemetry:any,result:any;

telemetry=pyDivide(pyDivide(pyDivide(pyDivide(tmp_path,"ws"),"campaigns"),"c1"),"telemetry.jsonl");
(await pyMethod(telemetry.parent,"mkdir",[],{"parents":true}));
(await write_telemetry(telemetry,[(await row(1,"apply","t1-c1",true,undefined,undefined)),({["turn"]:1,["lane"]:"memory",["ok"]:false,["reason"]:"lane_error"})]));
result=(await pyMethod(subprocess,"run",[[sys.executable,(await pyStr(KPI_SCRIPT)),"--workspace",(await pyStr(pyDivide(tmp_path,"ws"))),"--campaign","c1"]],{"capture_output":true,"text":true,"check":true}));
assert.ok(pyBool(pyContains(result.stdout,"lanes:")),"tests/play/test_kpi.py:519 assert \"lanes:\" in result.stdout");
assert.ok(pyBool(pyContains(result.stdout,"memory")),"tests/play/test_kpi.py:520 assert \"memory\" in result.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_lane_failure_reaches_the_printed_report"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_lane_failure_reaches_the_printed_report(temporary);});
export async function test_basis_counts_whose_number_each_receipt_carried_and_the_pins_a_band_named(tmp_path:any){
let campaign:any,turns:any,rows:any;

campaign=pyDivide(pyDivide(tmp_path,"campaigns"),"synth");
(await write_telemetry(pyDivide(campaign,"telemetry.jsonl"),[({["turn"]:2,["lane"]:"run",["event"]:"bind",["clerk"]:"band_recovery",["status"]:"succeeded",["call_id"]:"t2-c2",["refused_call_id"]:"t2-c1",["field"]:"archetype",["bindings"]:[]}),({["turn"]:3,["lane"]:"run",["event"]:"bind",["clerk"]:"band_recovery",["status"]:"succeeded",["refused_call_id"]:"t3-c1",["field"]:"weapon",["bindings"]:[]}),({["turn"]:3,["lane"]:"run",["event"]:"bind",["clerk"]:"band_recovery",["outcome"]:"keeper",["cause"]:"low_confidence",["refused_call_id"]:"t3-c4",["field"]:"archetype",["bindings"]:[]}),({["turn"]:2,["lane"]:"run",["event"]:"bind",["clerk"]:"declared_time",["status"]:"succeeded",["call_id"]:"t2-c3",["bindings"]:[({["name"]:"band",["path"]:"banded",["value"]:"single_room_search",["table"]:"time-costs"})]}),({["turn"]:4,["lane"]:"run",["event"]:"bind",["clerk"]:"declared_time",["outcome"]:"keeper",["cause"]:"unknown_binding",["bindings"]:[]}),({["turn"]:4,["lane"]:"run",["event"]:"bind",["clerk"]:"stated_hazard",["status"]:"refused",["call_id"]:"t4-c2",["bindings"]:[]})]));
turns=pyDivide(campaign,"turns");
(await pyMethod(turns,"mkdir",[],{"parents":true}));
(await pyMethod((pyDivide(turns,"0002.json")),"write_text",[(await pyMethod(json,"dumps",[({["turn"]:2,["receipts"]:[({["id"]:"npc:knott-t2-c2",["kind"]:"npc",["call_id"]:"t2-c2",["profile"]:({["archetype"]:"capable_adult"})}),({["id"]:"time:t2-c3",["kind"]:"time",["call_id"]:"t2-c3",["minutes"]:20,["basis"]:"banded",["band"]:"single_room_search"}),({["id"]:"time:t2-c4",["kind"]:"time",["call_id"]:"t2-c4",["minutes"]:5,["basis"]:"keeper"})]})],{}))],{"encoding":"utf-8"}));
(await pyMethod((pyDivide(turns,"0003.json")),"write_text",[(await pyMethod(json,"dumps",[({["turn"]:3,["receipts"]:[({["id"]:"item:knife-t3-c1",["kind"]:"item",["call_id"]:"t3-c1",["name"]:"knife",["weapon"]:"knife_medium"}),({["id"]:"item:pipe-t3-c2",["kind"]:"item",["call_id"]:"t3-c2",["name"]:"pipe",["weapon"]:"club_large"}),({["id"]:"npc:dooley-t3-c3",["kind"]:"npc",["call_id"]:"t3-c3",["archetype"]:"ordinary_adult"}),({["id"]:"roll:t3-c5",["kind"]:"roll",["call_id"]:"t3-c5",["basis"]:"stated",["stated"]:"chapel-floor"}),({["id"]:"delta:t3-c5",["kind"]:"delta",["call_id"]:"t3-c5",["basis"]:"stated",["stated"]:"chapel-floor"}),({["id"]:"clue:t3-c6",["kind"]:"clue",["call_id"]:"t3-c6"})]})],{}))],{"encoding":"utf-8"}));
rows=(await pyMethod(kpi,"load_rows",[(await pyMethod(kpi,"telemetry_path",[(await pyStr(tmp_path)),"synth"],{}))],{}));
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"basis",[rows,(await pyStr(tmp_path)),"synth"],{})),({["by_kind"]:({["delta"]:({["stated"]:1}),["roll"]:({["stated"]:1}),["time"]:({["banded"]:1,["keeper"]:1})}),["pins"]:({["archetype"]:({["keeper"]:1,["banded"]:1}),["weapon"]:({["keeper"]:1,["banded"]:1})}),["clerk_bands"]:({["time"]:({["landed"]:1,["refused"]:0,["keeper"]:1}),["damage"]:({["landed"]:0,["refused"]:1,["keeper"]:0})})}))),"tests/play/test_kpi.py:556 assert kpi.basis(rows, str(tmp_path), \"synth\") == {\n        \"by_kind\": {\"delta\": {\"stated\": 1}, \"roll\": {\"stated\": 1}, \"time\": {\"banded\": 1, \"keeper\": 1}},\n        \"pins\": {\"archetype\": {\"keeper\": 1, \"banded\": 1}, \"weapon\": {\"keeper\": 1, \"banded\": 1}},\n        \"clerk_bands\": {\"time\": {\"landed\": 1, \"refused\": 0, \"keeper\": 1}, \"damage\": {\"landed\": 0, \"refused\": 1, \"keeper\": 0}},\n    }");
assert.ok(pyBool(pyEqual((await pyMethod(kpi,"basis",[[],(await pyStr(tmp_path)),"nowhere"],{})),({}))),"tests/play/test_kpi.py:562 assert kpi.basis([], str(tmp_path), \"nowhere\") == {}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_basis_counts_whose_number_each_receipt_carried_and_the_pins_a_band_named"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_basis_counts_whose_number_each_receipt_carried_and_the_pins_a_band_named(temporary);});
