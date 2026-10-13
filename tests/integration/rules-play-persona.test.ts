// Migrated from tests/play/test_persona_bench.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {bench,player_mod,driver,persona_metrics,persona_report,os,uuid,iter,next,_ScriptedPlayer,pyMethod,pyMonkeypatch,resetPersona} from './rules-persona-support.ts';
import {captureOutput} from './rules-play-support.ts';
import {join} from 'node:path';

import {pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";









export let REPO_ROOT:any=Path(ROOT);











export let FAKE_KEEPER:any=pyDivide(pyDivide(pyDivide(pyDivide(REPO_ROOT,"tests"),"play"),"fixtures"),"fake-pi-rpc.mjs");
export let FAKE_PERSONA:any=pyDivide(pyDivide(pyDivide(pyDivide(REPO_ROOT,"tests"),"play"),"fixtures"),"fake-persona-pi.mjs");

export async function test_all_personas_load_and_only_name_registered_metrics(){
let personas:any,persona:any,metric_id:any;
personas=(await pyMethod(player_mod,"load_personas",[],{}));
assert.ok(pyBool(pyEqual((await pyLen(personas)),18)),pyStr("the suite is twelve normal personas and six stress personas"));
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const p of pyIterable((await pyMethod(personas,"values",[],{})))){__rows.push(pyAt(p,"kind"));}return __rows;})())),new Set(["normal","stress"]))),"tests/play/test_persona_bench.py:42 assert {p[\"kind\"] for p in personas.values()} == {\"normal\", \"stress\"}");
for(persona of pyIterable((await pyMethod(personas,"values",[],{})))){
for(metric_id of pyIterable(pyAt(persona,"assertions"))){
assert.ok(pyBool(pyContains(persona_metrics.METRICS,metric_id)),"tests/play/test_persona_bench.py:45 assert metric_id in persona_metrics.METRICS");
}
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_all_personas_load_and_only_name_registered_metrics"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_all_personas_load_and_only_name_registered_metrics();});
export async function test_a_persona_naming_an_unregistered_metric_fails_to_load(tmp_path:any){
let persona:any,path:any;
persona=(await pyMethod(json,"loads",[(await pyMethod((await pyNext((await pyMethod((pyDivide(REPO_ROOT,"tests/play/personas")),"glob",["P01*.json"],{})))),"read_text",[],{}))],{}));
persona["assertions"]=["vibes"];
path=pyDivide(tmp_path,"P99_vibes.json");
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[persona],{}))],{"encoding":"utf-8"}));
assert.throws(()=>player_mod.load_persona(path),(error:any)=>error instanceof player_mod.PersonaValidationError&&/unregistered metric/.test(error.message));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_persona_naming_an_unregistered_metric_fails_to_load"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_persona_naming_an_unregistered_metric_fails_to_load(temporary);});
export async function test_personas_carry_no_cjk_because_every_field_is_model_visible(){
let path:any,text:any;
for(path of pyIterable((await pyMethod((pyDivide(REPO_ROOT,"tests/play/personas")),"glob",["*.json"],{})))){
text=(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const ch of pyIterable(text)){__rows.push((await (async()=>{const __left=(await (async()=>{const __term0="一";const __term1=ch;const __term2="鿿";return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})());return pyBool(__left)?__left:(await (async()=>{const __term0="぀";const __term1=ch;const __term2="ヿ";return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})());})()));}return __rows;})()))))),pyStr(`${path.name} carries CJK; persona text is system language (contract section 16.1)`));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_personas_carry_no_cjk_because_every_field_is_model_visible"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_personas_carry_no_cjk_because_every_field_is_model_visible();});
export async function test_rate_means_one_thing_per_metric(){
assert.ok(pyBool(pyEqual((await pyMethod(persona_metrics,"rate",["hard_denial_rate"],{"ok":9,"violation":1})),0.1)),"tests/play/test_persona_bench.py:65 assert persona_metrics.rate(\"hard_denial_rate\", ok=9, violation=1) == 0.1");
assert.ok(pyBool(pyEqual((await pyMethod(persona_metrics,"rate",["world_consequence_rate"],{"ok":9,"violation":1})),0.9)),"tests/play/test_persona_bench.py:66 assert persona_metrics.rate(\"world_consequence_rate\", ok=9, violation=1) == 0.9");
assert.ok(pyBool(((await pyMethod(persona_metrics,"rate",["hard_denial_rate"],{"ok":0,"violation":0}))===null)),"tests/play/test_persona_bench.py:67 assert persona_metrics.rate(\"hard_denial_rate\", ok=0, violation=0) is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rate_means_one_thing_per_metric"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_rate_means_one_thing_per_metric();});

export async function test_player_view_hides_keeper_visibility_rolls(){
let delivery:any,view:any;
delivery=({["kind"]:"narrate",["rendered_text"]:"The door gives.",["mechanics"]:[({["kind"]:"roll",["skill"]:"Spot Hidden",["visibility"]:"keeper",["passed"]:false}),({["kind"]:"roll",["skill"]:"Locksmith",["visibility"]:"public",["passed"]:true}),({["kind"]:"time",["minutes"]:5})]});
view=(await pyMethod(player_mod,"player_view",[delivery,"","settled"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(view,"Locksmith");return pyBool(__left)?!pyContains(view,"Spot Hidden"):__left;})())),"tests/play/test_persona_bench.py:79 assert \"Locksmith\" in view and \"Spot Hidden\" not in view");
assert.ok(pyBool(pyContains(view,"The door gives.")),"tests/play/test_persona_bench.py:80 assert \"The door gives.\" in view");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_player_view_hides_keeper_visibility_rolls"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_player_view_hides_keeper_visibility_rolls();});
export async function test_player_view_names_a_concealed_check_and_shows_no_figure(){
let delivery:any,view:any,shown:any,figure:any;
delivery=({["kind"]:"narrate",["rendered_text"]:"He looks at the window.",["mechanics"]:[({["kind"]:"roll",["skill"]:"Psychology",["visibility"]:"concealed",["receipt"]:"roll:psychology-t5-c1",["roll"]:2,["target"]:70,["threshold"]:70,["difficulty"]:"regular",["level"]:"extreme",["passed"]:true,["pushed"]:false,["actor_is_investigator"]:true})]});
view=(await pyMethod(player_mod,"player_view",[delivery,"","settled"],{}));
assert.ok(pyBool(pyContains(view,"He looks at the window.")),"tests/play/test_persona_bench.py:93 assert \"He looks at the window.\" in view");
shown=(await pyMethod(json,"loads",[pyAt((await pyMethod(view,"rsplit",["\n",1],{})),(-1))],{}));
assert.ok(pyBool(pyEqual(shown,({["kind"]:"roll",["skill"]:"Psychology",["visibility"]:"concealed",["receipt"]:"roll:psychology-t5-c1",["actor_is_investigator"]:true}))),"tests/play/test_persona_bench.py:95 assert shown == {\"kind\": \"roll\", \"skill\": \"Psychology\", \"visibility\": \"concealed\",\n                     \"receipt\": \"roll:psychology-t5-c1\", \"actor_is_investigator\": True}");
for(figure of pyIterable(player_mod.CONCEALED_FIGURES)){
assert.ok(pyBool(!pyContains(shown,figure)),pyStr(figure));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_player_view_names_a_concealed_check_and_shows_no_figure"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_player_view_names_a_concealed_check_and_shows_no_figure();});
export async function test_player_view_falls_back_to_prose_and_names_a_dead_turn(){
assert.ok(pyBool(pyEqual((await pyMethod(player_mod,"player_view",[null,"words","settled"],{})),"words")),"tests/play/test_persona_bench.py:102 assert player_mod.player_view(None, \"words\", \"settled\") == \"words\"");
assert.ok(pyBool(pyContains((await pyMethod(player_mod,"player_view",[null,"","timeout"],{})),"nothing this turn")),"tests/play/test_persona_bench.py:103 assert \"nothing this turn\" in player_mod.player_view(None, \"\", \"timeout\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_player_view_falls_back_to_prose_and_names_a_dead_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_player_view_falls_back_to_prose_and_names_a_dead_turn();});
export async function test_parse_reply_takes_the_object_and_refuses_the_rest(){
let parsed:any,error:any;
const __unpack4814=(await pyMethod(player_mod,"parse_reply",["```json\n{\"player_message\": \"I knock.\", "+"\"private_eval\": {\"confusion\": 1}}\n```"],{}));assert.equal(__unpack4814.length,2,"Original tuple unpacking requires exact arity");parsed=__unpack4814[0];error=__unpack4814[1];
assert.ok(pyBool((await (async()=>{const __left=(error===null);return pyBool(__left)?pyEqual(pyAt(parsed,"player_message"),"I knock."):__left;})())),"tests/play/test_persona_bench.py:109 assert error is None and parsed[\"player_message\"] == \"I knock.\"");
assert.ok(pyBool(pyEqual(pyAt(parsed,"private_eval"),({["confusion"]:1}))),"tests/play/test_persona_bench.py:110 assert parsed[\"private_eval\"] == {\"confusion\": 1}");
assert.ok(pyBool((pyAt((await pyMethod(player_mod,"parse_reply",["no json here"],{})),0)===null)),"tests/play/test_persona_bench.py:111 assert player_mod.parse_reply(\"no json here\")[0] is None");
assert.ok(pyBool((pyAt((await pyMethod(player_mod,"parse_reply",["{\"private_eval\": {}}"],{})),0)===null)),"tests/play/test_persona_bench.py:112 assert player_mod.parse_reply('{\"private_eval\": {}}')[0] is None");
assert.ok(pyBool((pyAt((await pyMethod(player_mod,"parse_reply",["{\"player_message\": \"   \"}"],{})),0)===null)),"tests/play/test_persona_bench.py:113 assert player_mod.parse_reply('{\"player_message\": \"   \"}')[0] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_parse_reply_takes_the_object_and_refuses_the_rest"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_parse_reply_takes_the_object_and_refuses_the_rest();});

export async function test_persona_player_runs_outside_the_repo_with_no_tools(tmp_path:any){
let persona:any,record:any,player:any,act:any,seen:any,flag:any;
persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01");
record=pyDivide(tmp_path,"argv.json");
player=(await pyMethod(player_mod,"PersonaPlayer",[persona,pyDivide(tmp_path,"run")],{"launcher":FAKE_PERSONA,"credentials_from":pyDivide(tmp_path,"no-credentials")}));

os.environ["FAKE_PERSONA_RECORD"]=(await pyStr(record));
try{(await pyMethod(player,"start",[],{}));
act=(await pyMethod(player,"act",["The office is quiet."],{"timeout":20.0}));}finally{(await pyMethod(os.environ,"pop",["FAKE_PERSONA_RECORD",null],{}));
(await pyMethod(player,"stop",[],{}));}
seen=(await pyMethod(json,"loads",[(await pyMethod(record,"read_text",[],{"encoding":"utf-8"}))],{}));
for(flag of pyIterable(player_mod.ISOLATION_FLAGS)){
assert.ok(pyBool(pyContains(pyAt(seen,"argv"),flag)),pyStr(`the persona player ran without ${flag}`));
}
assert.ok(pyBool(!pyBool((await pyMethod((await Path(pyAt(seen,"cwd"))),"is_relative_to",[REPO_ROOT],{})))),pyStr("the player could read the repo"));
assert.ok(pyBool((await (async()=>{const __left=pyAt(seen,"pi_home");return pyBool(__left)?!pyBool((await pyMethod((await Path(pyAt(seen,"pi_home"))),"is_relative_to",[REPO_ROOT],{}))):__left;})())),"tests/play/test_persona_bench.py:136 assert seen[\"pi_home\"] and not Path(seen[\"pi_home\"]).is_relative_to(REPO_ROOT)");
assert.ok(pyBool(pyEqual(pyAt(seen,"home_files"),["settings.json"])),pyStr("an isolated home holds no packages"));
assert.ok(pyBool((await (async()=>{const __left=pyAt(act,"ok");return pyBool(__left)?pyEqual(pyAt(act,"player_message"),"persona turn 1"):__left;})())),"tests/play/test_persona_bench.py:138 assert act[\"ok\"] and act[\"player_message\"] == \"persona turn 1\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(act,"private_eval"),"engagement"),8)),"tests/play/test_persona_bench.py:139 assert act[\"private_eval\"][\"engagement\"] == 8");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_persona_player_runs_outside_the_repo_with_no_tools"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_persona_player_runs_outside_the_repo_with_no_tools(temporary);});
export async function test_an_unreadable_persona_reply_is_retried_once_then_reported(tmp_path:any){
let persona:any,player:any,act:any;

persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"S04");
os.environ["FAKE_PERSONA_GARBAGE"]="5";
player=(await pyMethod(player_mod,"PersonaPlayer",[persona,pyDivide(tmp_path,"run")],{"launcher":FAKE_PERSONA,"credentials_from":pyDivide(tmp_path,"none")}));
try{(await pyMethod(player,"start",[],{}));
act=(await pyMethod(player,"act",["Anything?"],{"timeout":20.0}));}finally{(await pyMethod(os.environ,"pop",["FAKE_PERSONA_GARBAGE",null],{}));
(await pyMethod(player,"stop",[],{}));}
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(act,"ok")===false);return pyBool(__left)?pyEqual(pyAt(act,"attempts"),2):__left;})());return pyBool(__left)?(pyAt(act,"player_message")===null):__left;})())),"tests/play/test_persona_bench.py:154 assert act[\"ok\"] is False and act[\"attempts\"] == 2 and act[\"player_message\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unreadable_persona_reply_is_retried_once_then_reported"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_an_unreadable_persona_reply_is_retried_once_then_reported(temporary);});

export async function* fixture_campaign(){
let campaign_id:any,path:any;

campaign_id=`fixture-persona-${pySlice((await pyMethod(uuid,"uuid4",[],{})).hex,undefined,8)}`;
path=(await pyMethod(bench,"campaign_dir",[campaign_id],{}));
(await pyMethod((pyDivide(path,"turns")),"mkdir",[],{"parents":true}));
(await pyMethod((pyDivide(path,"party")),"mkdir",[],{"parents":true}));
(await pyMethod(driver,"write_json",[pyDivide(path,"campaign.json"),({["id"]:campaign_id,["module_id"]:"the-haunting",["status"]:"active",["play_language"]:"zh-Hans"})],{}));
(await pyMethod(driver,"write_json",[pyDivide(pyDivide(path,"party"),"thomas-hayes.json"),({["id"]:"thomas-hayes",["current_hp"]:11,["conditions"]:[],["skills"]:({["Spot Hidden"]:55})})],{}));
(await pyMethod((pyDivide(path,"transcript.jsonl")),"write_text",[pyAdd((await pyMethod(json,"dumps",[({["turn"]:0,["role"]:"keeper",["text"]:"The office is quiet."})],{})),"\n")],{"encoding":"utf-8"}));
(await pyMethod(driver,"write_json",[pyDivide(pyDivide(path,"turns"),"0001.json"),({["turn"]:1,["receipts"]:[({["kind"]:"clue",["clue"]:"the-letter"}),({["kind"]:"roll",["skill"]:"Spot Hidden",["passed"]:true}),({["kind"]:"delta",["resource"]:"hp",["before"]:11,["after"]:9})]})],{}));
(await pyMethod((pyDivide(path,"telemetry.jsonl")),"write_text",[pyAdd((await pyMethod("\n","join",[(await (async()=>{const __rows:any[]=[];for(const row of pyIterable([({["turn"]:1,["tool"]:"look",["ok"]:true}),({["turn"]:1,["tool"]:"narrate",["ok"]:true}),({["turn"]:1,["lane"]:"admission",["verb"]:"resolve",["verdict"]:"authorized",["ms"]:900}),({["turn"]:1,["lane"]:"director",["adopted"]:true})])){__rows.push((await pyMethod(json,"dumps",[row],{})));}return __rows;})())],{})),"\n")],{"encoding":"utf-8"}));
yield campaign_id;
(await pyMethod(shutil,"rmtree",[path],{"ignore_errors":true}));
}
export async function test_one_run_plays_the_real_driver_and_keeps_both_sides_of_every_turn(fixture_campaign:any,monkeypatch:any){
let suite:any,run:any,persona:any,real_init:any,suite_dir:any,record:any,rows:any,played:any;

(await pyMethod(monkeypatch,"setattr",[bench,"kernel_call",(method:any, params:any)=>({["ok"]:true,["result"]:({})})],{}));
(await pyMethod(monkeypatch,"setattr",[player_mod.PersonaPlayer,"_launcher_default",FAKE_PERSONA],{"raising":false}));
suite=({...bench.DEFAULTS,["suite"]:"fixture",["personas"]:["P01"],["max_turns"]:3,["turn_timeout"]:30.0,["opening_timeout"]:30.0,["launcher"]:(await pyStr(FAKE_KEEPER)),["player_model"]:"deepseek/deepseek-v4-pro"});
run=({["persona"]:"P01",["lane"]:"controlled",["trial"]:1,["campaign"]:fixture_campaign,["run_id"]:`${fixture_campaign}-run`});
persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01");
class IsolatedPlayer extends player_mod.PersonaPlayer{constructor(persona:any,dir:any,options:any={}){super(persona,dir,{...options,launcher:FAKE_PERSONA,credentials_from:pyDivide(Path(dir),'no-credentials')});}}
bench.PersonaPlayer=IsolatedPlayer;
suite_dir=pyDivide(pyDivide(pyDivide(REPO_ROOT,".coc"),"benchmarks"),`fixture-${pySlice((await pyMethod(uuid,"uuid4",[],{})).hex,undefined,8)}`);
try{record=(await pyMethod(bench,"execute_run",[run,suite,persona,suite_dir],{}));
assert.ok(pyBool(pyEqual(pyAt(record,"status"),"completed")),pyStr((await pyMethod(record,"get",["error"],{}))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(record,"method"),"persona-benchmark");return pyBool(__left)?(pyAt(record,"acceptance")===false):__left;})())),"tests/play/test_persona_bench.py:211 assert record[\"method\"] == \"persona-benchmark\" and record[\"acceptance\"] is False");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(record,"turns_played"),3);return pyBool(__left)?pyEqual(pyAt(record,"stop_reason"),"max_turns"):__left;})())),"tests/play/test_persona_bench.py:212 assert record[\"turns_played\"] == 3 and record[\"stop_reason\"] == \"max_turns\"");
rows=(await pyMethod(persona_report,"read_jsonl",[pyDivide(pyDivide(suite_dir,pyAt(run,"run_id")),"trace.jsonl")],{}));
played=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){if(pyBool(pyEqual((await pyMethod(r,"get",["phase"],{})),"play"))){__rows.push(r);}}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(played)){__rows.push(pyAt(r,"player_message"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const n of pyIterable([1,2,3])){__rows.push(`persona turn ${n}`);}return __rows;})()))),"tests/play/test_persona_bench.py:216 assert [r[\"player_message\"] for r in played] == [f\"persona turn {n}\" for n in (1, 2, 3)]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(played)){__rows.push(pyEqual(pyAt(pyAt(r,"private_eval"),"engagement"),8));}return __rows;})())))),pyStr("the sidecar must survive to the trace"));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(played)){__rows.push(pyAt(r,"keeper_text"));}return __rows;})())))),"tests/play/test_persona_bench.py:219 assert all(r[\"keeper_text\"] for r in played)");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,0),"phase"),"opening");return pyBool(__left)?pyContains(pyAt(pyAt(rows,0),"text"),"office"):__left;})())),"tests/play/test_persona_bench.py:220 assert rows[0][\"phase\"] == \"opening\" and \"office\" in rows[0][\"text\"]");}finally{(await pyMethod(shutil,"rmtree",[suite_dir],{"ignore_errors":true}));
(await pyMethod(shutil,"rmtree",[(await pyMethod(driver,"run_dir",[pyAt(run,"run_id")],{}))],{"ignore_errors":true}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_one_run_plays_the_real_driver_and_keeps_both_sides_of_every_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_one_run_plays_the_real_driver_and_keeps_both_sides_of_every_turn(await acquireFixture(t,()=>fixture_campaign()),pyMonkeypatch(t));});
export async function test_a_run_whose_player_is_not_isolated_is_refused(tmp_path:any,monkeypatch:any){
let persona:any,player:any;
persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01");
player=(await pyMethod(player_mod,"PersonaPlayer",[persona,pyDivide(tmp_path,"run")],{"launcher":FAKE_PERSONA,"credentials_from":pyDivide(tmp_path,"none")}));
player.isolation=({["argv_flags"]:["--no-tools"],["cwd"]:(await pyStr(REPO_ROOT))});
assert.throws(()=>bench._assert_isolation(player),(error:any)=>error instanceof bench.RunFailed&&/not isolated/.test(error.message));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_run_whose_player_is_not_isolated_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_run_whose_player_is_not_isolated_is_refused(temporary,pyMonkeypatch(t));});

export async function test_receipts_tier_reads_the_receipts_not_their_projection(fixture_campaign:any){
let metrics:any;
metrics=(await pyMethod(persona_report,"receipts_metrics",[(await pyMethod(bench,"campaign_dir",[fixture_campaign],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(metrics,"turns_played"),1)),"tests/play/test_persona_bench.py:239 assert metrics[\"turns_played\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(metrics,"clues_found"),1);return pyBool(__left)?pyEqual(pyAt(metrics,"clues_in_module"),39):__left;})())),"tests/play/test_persona_bench.py:240 assert metrics[\"clues_found\"] == 1 and metrics[\"clues_in_module\"] == 39");
assert.ok(pyBool(pyEqual(pyAt(metrics,"rules_layer_turns"),1)),"tests/play/test_persona_bench.py:241 assert metrics[\"rules_layer_turns\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(metrics,"combat_receipts"),1)),"tests/play/test_persona_bench.py:243 assert metrics[\"combat_receipts\"] == 1");
assert.ok(pyBool((pyAt(metrics,"investigator_alive")===true)),"tests/play/test_persona_bench.py:244 assert metrics[\"investigator_alive\"] is True");
assert.ok(pyBool(pyEqual(pyAt(metrics,"admission_verdicts"),({["authorized"]:1}))),"tests/play/test_persona_bench.py:245 assert metrics[\"admission_verdicts\"] == {\"authorized\": 1}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_receipts_tier_reads_the_receipts_not_their_projection"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_receipts_tier_reads_the_receipts_not_their_projection(await acquireFixture(t,()=>fixture_campaign()));});
export async function test_the_judge_may_not_invent_metrics_turns_or_uncited_findings(){
let judgement:any,folded:any;
judgement=({["findings"]:[({["metric"]:"hard_denial_rate",["turn"]:2,["verdict"]:"violation",["quote"]:"You cannot."}),({["metric"]:"hard_denial_rate",["turn"]:3,["verdict"]:"ok",["quote"]:"The door holds."}),({["metric"]:"hard_denial_rate",["turn"]:2,["verdict"]:"violation",["quote"]:""}),({["metric"]:"vibes",["turn"]:2,["verdict"]:"violation",["quote"]:"bad vibes"}),({["metric"]:"secret_leak",["turn"]:99,["verdict"]:"violation",["quote"]:"off the record"}),({["metric"]:"premature_truth_reveal",["turn"]:2,["verdict"]:"violation",["quote"]:"not asked for"})]});
folded=(await pyMethod(persona_report,"fold_judgement",[judgement],{"turns_seen":new Set([2,3]),"allowed":["hard_denial_rate","secret_leak"]}));
assert.ok(pyBool(pyEqual(pyAt(folded,"hard_denial_rate"),({["ok"]:1,["violation"]:1,["rate"]:0.5,["direction"]:"lower_is_better",["violations_while_review_unavailable"]:0,["citations"]:[({["turn"]:2,["verdict"]:"violation",["quote"]:"You cannot.",["why"]:""}),({["turn"]:3,["verdict"]:"ok",["quote"]:"The door holds.",["why"]:""})]}))),"tests/play/test_persona_bench.py:259 assert folded[\"hard_denial_rate\"] == {\n        \"ok\": 1, \"violation\": 1, \"rate\": 0.5, \"direction\": \"lower_is_better\",\n        \"violations_while_review_unavailable\": 0,\n        \"citations\": [{\"turn\": 2, \"verdict\": \"violation\", \"quote\": \"You cannot.\", \"why\": \"\"},\n                      {\"turn\": 3, \"verdict\": \"ok\", \"quote\": \"The door holds.\", \"why\": \"\"}]}");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(folded,"vibes");return pyBool(__left)?!pyContains(folded,"secret_leak"):__left;})())),"tests/play/test_persona_bench.py:264 assert \"vibes\" not in folded and \"secret_leak\" not in folded");
assert.ok(pyBool(pyEqual(pyAt(folded,"_dropped_findings"),4)),"tests/play/test_persona_bench.py:265 assert folded[\"_dropped_findings\"] == 4");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_judge_may_not_invent_metrics_turns_or_uncited_findings"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_the_judge_may_not_invent_metrics_turns_or_uncited_findings();});
export async function test_sidecar_is_labelled_self_report(){
let rows:any,metrics:any;
rows=(await (async()=>{const __rows:any[]=[];for(const n of pyIterable((await pyRange(1,6)))){__rows.push(({["phase"]:"play",["turn"]:n,["private_eval"]:({["perceived_agency"]:n,["confusion"]:1,["engagement"]:5,["frustration"]:0,["current_hypothesis"]:`h${Math.floor(n/2)}`})}));}return __rows;})());
metrics=(await pyMethod(persona_report,"sidecar_metrics",[rows],{}));
assert.ok(pyBool((pyAt(metrics,"self_report")===true)),"tests/play/test_persona_bench.py:274 assert metrics[\"self_report\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(metrics,"perceived_agency"),3);return pyBool(__left)?pyEqual(pyAt(metrics,"hypothesis_changes"),2):__left;})())),"tests/play/test_persona_bench.py:275 assert metrics[\"perceived_agency\"] == 3 and metrics[\"hypothesis_changes\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sidecar_is_labelled_self_report"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_sidecar_is_labelled_self_report();});

export async function test_the_full_matrix_is_the_one_the_spec_names(){
let suite:any,runs:any;
suite=(await pyMethod(bench,"load_suite",[pyDivide(REPO_ROOT,"tests/play/suites/full.json")],{}));
runs=(await pyMethod(bench,"plan_runs",[suite,(await pyMethod(player_mod,"load_personas",[],{})),"20260911T000000Z"],{}));
assert.ok(pyBool(pyEqual((await pyLen(runs)),108)),"tests/play/test_persona_bench.py:283 assert len(runs) == 108");
assert.ok(pyBool(pyEqual((await pyLen(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(runs)){__rows.push(pyAt(r,"campaign"));}return __rows;})())))),108)),pyStr("concurrent runs must not share a campaign"));
assert.ok(pyBool(pyEqual((await pyLen(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(runs)){__rows.push(pyAt(r,"run_id"));}return __rows;})())))),108)),"tests/play/test_persona_bench.py:285 assert len({r[\"run_id\"] for r in runs}) == 108");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_full_matrix_is_the_one_the_spec_names"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_the_full_matrix_is_the_one_the_spec_names();});
export async function test_the_bench_never_steals_the_default_run_pointer(fixture_campaign:any,monkeypatch:any,tmp_path:any){
let before:any,suite:any,run_id:any;

(await pyMethod(monkeypatch,"setattr",[driver,"CURRENT_RUN_FILE",pyDivide(tmp_path,".current-run")],{}));
before=(await pyMethod(driver,"read_json",[driver.CURRENT_RUN_FILE,({["run_id"]:"a-human-table"})],{}));
(await pyMethod(driver,"write_json",[driver.CURRENT_RUN_FILE,before],{}));
suite=({...bench.DEFAULTS,["suite"]:"fixture",["kp_model"]:"xai/grok-4.6",["launcher"]:(await pyStr(FAKE_KEEPER)),["admission_model"]:null});
run_id=`${fixture_campaign}-pointer`;
try{(await pyMethod(bench,"start_table",[fixture_campaign,run_id,suite],{"launcher":(await pyStr(FAKE_KEEPER))}));
assert.ok(pyBool(pyEqual((await pyMethod(driver,"read_json",[driver.CURRENT_RUN_FILE,({})],{})),before)),"tests/play/test_persona_bench.py:300 assert driver.read_json(driver.CURRENT_RUN_FILE, {}) == before");}finally{(await pyMethod(bench,"stop_table",[run_id],{}));
(await pyMethod(shutil,"rmtree",[(await pyMethod(driver,"run_dir",[run_id],{}))],{"ignore_errors":true}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_bench_never_steals_the_default_run_pointer"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_the_bench_never_steals_the_default_run_pointer(await acquireFixture(t,()=>fixture_campaign()),pyMonkeypatch(t),temporary);});
export async function test_the_creation_lane_opens_by_the_player_speaking_first(tmp_path:any,monkeypatch:any){
let asked:any,player:any,result:any;

asked=[];
async function status(campaign:any){
(await pyMethod(asked,"append",[campaign],{}));
return (pyBool(pyLess((await pyLen(asked)),5))?"setting_up":"ready_for_table");
}
(await pyMethod(monkeypatch,"setattr",[bench,"start_table",(campaign:any,run_id:any,...args:any[])=>run_id],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"stop_table",(...args:any[])=>null],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"campaign_status",status],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"send_turn",(run_id:any, text:any, timeout:any)=>({["settle_class"]:"settled",["final_text"]:`keeper heard ${text}`,["delivery"]:null})],{}));
player=(await _ScriptedPlayer(["a folklore professor","yes","done"]));
result=(await pyMethod(bench,"run_setup_lane",[({["campaign"]:"c",["run_id"]:"r"}),({...bench.DEFAULTS,["setup_max_turns"]:5,["turn_timeout"]:1.0,["opening_timeout"]:1.0}),player,pyDivide(tmp_path,"trace.jsonl")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"setup_steps"),2);return pyBool(__left)?(pyAt(result,"setup_ended_by_process_exit")===false):__left;})())),"tests/play/test_persona_bench.py:338 assert result[\"setup_steps\"] == 2 and result[\"setup_ended_by_process_exit\"] is False");
assert.ok(pyBool(pyEqual(pyAt(player.views,0),bench.SETUP_FIRST_VIEW)),"tests/play/test_persona_bench.py:339 assert player.views[0] == bench.SETUP_FIRST_VIEW");
assert.ok(pyBool((await pyMethod(pyAt(player.views,1),"startswith",["keeper heard a folklore professor"],{}))),"tests/play/test_persona_bench.py:340 assert player.views[1].startswith(\"keeper heard a folklore professor\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_creation_lane_opens_by_the_player_speaking_first"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_the_creation_lane_opens_by_the_player_speaking_first(temporary,pyMonkeypatch(t));});
export async function test_a_creation_lane_that_never_finishes_the_card_is_a_failed_run(tmp_path:any,monkeypatch:any){
let player:any;
(await pyMethod(monkeypatch,"setattr",[bench,"start_table",(campaign:any,run_id:any,...args:any[])=>run_id],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"stop_table",(...args:any[])=>null],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"campaign_status",(campaign:any)=>"setting_up"],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"send_turn",(run_id:any,text:any,timeout:any)=>({["settle_class"]:"settled",["final_text"]:"still asking",["delivery"]:null})],{}));
player=(await _ScriptedPlayer(["a","b"]));
await assert.rejects(()=>bench.run_setup_lane({campaign:"c",run_id:"r"},{...bench.DEFAULTS,setup_max_turns:2,turn_timeout:1},player,pyDivide(tmp_path,"trace.jsonl")),(error:any)=>error instanceof bench.RunFailed&&/ready_for_table/.test(error.message));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_creation_lane_that_never_finishes_the_card_is_a_failed_run"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_creation_lane_that_never_finishes_the_card_is_a_failed_run(temporary,pyMonkeypatch(t));});
export async function test_a_throttled_provider_does_not_kill_the_table(tmp_path:any,monkeypatch:any){
let persona:any,player:any,replies:any,waited:any,act:any;

persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01");
player=(await pyMethod(player_mod,"PersonaPlayer",[persona,pyDivide(tmp_path,"run")],{"launcher":FAKE_PERSONA,"credentials_from":pyDivide(tmp_path,"none")}));
replies=(await iter([["",true],["",true],["{\"player_message\": \"I knock.\", \"private_eval\": {\"confusion\": 0}}",false]]));
waited=[];
(await pyMethod(monkeypatch,"setattr",[player_mod.time,"sleep",async (s:any)=>(await pyMethod(waited,"append",[s],{}))],{}));
(await pyMethod(monkeypatch,"setattr",[player_mod.PersonaPlayer,"_prompt",async (self:any, message:any, timeout:any)=>(await next(replies))],{}));
act=(await pyMethod(player,"act",["The office is quiet."],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(act,"ok");return pyBool(__left)?pyEqual(pyAt(act,"player_message"),"I knock."):__left;})())),"tests/play/test_persona_bench.py:369 assert act[\"ok\"] and act[\"player_message\"] == \"I knock.\"");
assert.ok(pyBool(pyEqual(pyAt(act,"transient_retries"),2)),pyStr("two provider errors, two waits, no verdict on the model"));
assert.ok(pyBool(pyEqual(waited,[10.0,30.0])),pyStr("the wait grows; it does not retry inside a millisecond"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_throttled_provider_does_not_kill_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_throttled_provider_does_not_kill_the_table(temporary,pyMonkeypatch(t));});
export async function test_an_unreadable_answer_is_still_only_retried_once(tmp_path:any,monkeypatch:any){
let persona:any,player:any,act:any;
persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01");
player=(await pyMethod(player_mod,"PersonaPlayer",[persona,pyDivide(tmp_path,"run")],{"launcher":FAKE_PERSONA,"credentials_from":pyDivide(tmp_path,"none")}));
(await pyMethod(monkeypatch,"setattr",[player_mod.time,"sleep",(s:any)=>null],{}));
(await pyMethod(monkeypatch,"setattr",[player_mod.PersonaPlayer,"_prompt",(self:any,message:any,timeout:any)=>["I would rather not answer in JSON.",false]],{}));
act=(await pyMethod(player,"act",["The office is quiet."],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(act,"ok")===false);return pyBool(__left)?pyEqual(pyAt(act,"attempts"),2):__left;})());return pyBool(__left)?pyEqual(pyAt(act,"transient_retries"),0):__left;})())),"tests/play/test_persona_bench.py:382 assert act[\"ok\"] is False and act[\"attempts\"] == 2 and act[\"transient_retries\"] == 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unreadable_answer_is_still_only_retried_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_an_unreadable_answer_is_still_only_retried_once(temporary,pyMonkeypatch(t));});
export async function test_a_finished_card_ends_the_creation_lane_even_if_the_process_is_already_gone(tmp_path:any,monkeypatch:any){
let seen:any,player:any,result:any;

seen=({["n"]:0});
async function status(campaign:any){
seen["n"]=pyAdd(pyAt(seen,"n"),1);
return (pyBool(pyLessEqual(pyAt(seen,"n"),1))?"setting_up":"ready_for_table");
}
async function send(run_id:any,text:any,timeout:any){
throw new driver.DaemonUnavailable("daemon closed the connection without responding");
}
(await pyMethod(monkeypatch,"setattr",[bench,"start_table",(campaign:any,run_id:any,...args:any[])=>run_id],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"stop_table",(...args:any[])=>null],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"campaign_status",status],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"send_turn",send],{}));
player=(await _ScriptedPlayer(["a folklore professor"]));
result=(await pyMethod(bench,"run_setup_lane",[({["campaign"]:"c",["run_id"]:"r"}),({...bench.DEFAULTS,["setup_max_turns"]:5,["turn_timeout"]:1.0}),player,pyDivide(tmp_path,"trace.jsonl")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"setup_steps"),0);return pyBool(__left)?(pyAt(result,"setup_ended_by_process_exit")===true):__left;})())),"tests/play/test_persona_bench.py:404 assert result[\"setup_steps\"] == 0 and result[\"setup_ended_by_process_exit\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_finished_card_ends_the_creation_lane_even_if_the_process_is_already_gone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_finished_card_ends_the_creation_lane_even_if_the_process_is_already_gone(temporary,pyMonkeypatch(t));});
export async function test_a_dead_setup_process_without_a_card_is_still_a_failure(tmp_path:any,monkeypatch:any){
let player:any;
(await pyMethod(monkeypatch,"setattr",[bench,"start_table",(campaign:any,run_id:any,...args:any[])=>run_id],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"stop_table",(...args:any[])=>null],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"campaign_status",(campaign:any)=>"setting_up"],{}));
(await pyMethod(monkeypatch,"setattr",[bench,"send_turn",()=>{throw new driver.DaemonUnavailable("gone");}],{}));
player=(await _ScriptedPlayer(["a folklore professor"]));
await assert.rejects(()=>bench.run_setup_lane({campaign:"c",run_id:"r"},{...bench.DEFAULTS,setup_max_turns:5,turn_timeout:1},player,pyDivide(tmp_path,"trace.jsonl")),driver.DaemonUnavailable);
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_dead_setup_process_without_a_card_is_still_a_failure"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_dead_setup_process_without_a_card_is_still_a_failure(temporary,pyMonkeypatch(t));});
export async function test_a_run_that_never_got_a_card_is_a_result_not_a_broken_instrument(){

assert.ok(pyBool(pyEqual((await pyMethod(persona_report,"classify",[({["status"]:"invalid",["error"]:"RunFailed: setup lane ended with campaign status 'setting_up', not ready_for_table"})],{})),"no_card")),"tests/play/test_persona_bench.py:423 assert persona_report.classify({\n        \"status\": \"invalid\",\n        \"error\": \"RunFailed: setup lane ended with campaign status 'setting_up', not ready_for_table\",\n    }) == \"no_card\"");
assert.ok(pyBool(pyEqual((await pyMethod(persona_report,"classify",[({["status"]:"invalid",["error"]:"instrument-invalid: stopped to fix the creation lane"})],{})),"instrument_invalid")),"tests/play/test_persona_bench.py:427 assert persona_report.classify({\n        \"status\": \"invalid\", \"error\": \"instrument-invalid: stopped to fix the creation lane\",\n    }) == \"instrument_invalid\"");
assert.ok(pyBool(pyEqual((await pyMethod(persona_report,"classify",[({["status"]:"completed"})],{})),"completed")),"tests/play/test_persona_bench.py:430 assert persona_report.classify({\"status\": \"completed\"}) == \"completed\"");
assert.ok(pyBool(pyEqual((await pyMethod(persona_report,"classify",[({["status"]:"invalid",["error"]:"DaemonUnavailable: gone"})],{})),"invalid")),"tests/play/test_persona_bench.py:431 assert persona_report.classify({\"status\": \"invalid\", \"error\": \"DaemonUnavailable: gone\"}) == \"invalid\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_run_that_never_got_a_card_is_a_result_not_a_broken_instrument"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_run_that_never_got_a_card_is_a_result_not_a_broken_instrument();});
export async function test_unjudged_gates_print_as_unmeasured_not_as_clean(tmp_path:any,capsys:any){
let suite_dir:any,out:any;

suite_dir=pyDivide(tmp_path,"suite");
(await pyMethod(suite_dir,"mkdir",[],{}));
(await pyMethod((pyDivide(suite_dir,"suite-report.json")),"write_text",[(await pyMethod(json,"dumps",[({["suite_dir"]:(await pyStr(suite_dir)),["by_persona"]:({["P01_detective/controlled"]:[({["trial"]:1,["status"]:"completed",["hard_gates"]:({["secret_leak"]:0}),["receipts"]:({["turns_played"]:30,["clue_reachability"]:0.36}),["judged"]:({}),["self_report"]:({})})]})})],{}))],{"encoding":"utf-8"}));
(await pyMethod(persona_report,"main",[["table","--suite-dir",(await pyStr(suite_dir))]],{}));
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyContains(pyAt((await pyMethod(out,"splitlines",[],{})),4),"-")),pyStr("an unjudged suite must not print a zero gate count"));
assert.ok(pyBool(pyContains(out,"not the same as clean")),"tests/play/test_persona_bench.py:445 assert \"not the same as clean\" in out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unjudged_gates_print_as_unmeasured_not_as_clean"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_unjudged_gates_print_as_unmeasured_not_as_clean(temporary,captureOutput(t));});
export async function test_a_violation_on_a_turn_whose_review_timed_out_is_marked(tmp_path:any){
let folded:any,bucket:any;

folded=(await pyMethod(persona_report,"fold_judgement",[({["findings"]:[({["metric"]:"hard_denial_rate",["turn"]:5,["verdict"]:"violation",["quote"]:"cannot settle"}),({["metric"]:"hard_denial_rate",["turn"]:6,["verdict"]:"violation",["quote"]:"you cannot"})]})],{"turns_seen":new Set([5,6]),"allowed":["hard_denial_rate"],"admission_failed":new Set([5])}));
bucket=pyAt(folded,"hard_denial_rate");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(bucket,"violation"),2);return pyBool(__left)?pyEqual(pyAt(bucket,"violations_while_review_unavailable"),1):__left;})())),"tests/play/test_persona_bench.py:458 assert bucket[\"violation\"] == 2 and bucket[\"violations_while_review_unavailable\"] == 1");
assert.ok(pyBool((pyAt(pyAt(pyAt(bucket,"citations"),0),"review_unavailable_this_turn")===true)),"tests/play/test_persona_bench.py:459 assert bucket[\"citations\"][0][\"review_unavailable_this_turn\"] is True");
assert.ok(pyBool(!pyContains(pyAt(pyAt(bucket,"citations"),1),"review_unavailable_this_turn")),"tests/play/test_persona_bench.py:460 assert \"review_unavailable_this_turn\" not in bucket[\"citations\"][1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_violation_on_a_turn_whose_review_timed_out_is_marked"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_violation_on_a_turn_whose_review_timed_out_is_marked(temporary);});
export async function test_admission_failures_are_read_by_turn_number_from_telemetry(tmp_path:any){
let campaign:any;
campaign=pyDivide(tmp_path,"c");
(await pyMethod(campaign,"mkdir",[],{}));
(await pyMethod((pyDivide(campaign,"telemetry.jsonl")),"write_text",[pyAdd((await pyMethod("\n","join",[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable([({["turn"]:1,["lane"]:"admission",["ok"]:true,["verdict"]:"authorized"}),({["turn"]:5,["lane"]:"admission",["ok"]:false,["reason"]:"timeout"}),({["turn"]:7,["lane"]:"director",["ok"]:false})])){__rows.push((await pyMethod(json,"dumps",[r],{})));}return __rows;})())],{})),"\n")],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual((await pyMethod(persona_report,"admission_failed_turns",[campaign],{})),new Set([5]))),"tests/play/test_persona_bench.py:471 assert persona_report.admission_failed_turns(campaign) == {5}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_admission_failures_are_read_by_turn_number_from_telemetry"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_admission_failures_are_read_by_turn_number_from_telemetry(temporary);});
export async function test_findings_can_be_refolded_without_paying_the_judge_again(tmp_path:any,monkeypatch:any){
let called:any,run_dir:any,reused:any;

called=[];
(await pyMethod(monkeypatch,"setattr",[persona_report,"run_judge",async (...args:any[])=>(await (async()=>{const __left=(await pyMethod(called,"append",[args],{}));return pyBool(__left)?__left:({["findings"]:[]});})())],{}));
run_dir=pyDivide(tmp_path,"run");
(await pyMethod(run_dir,"mkdir",[],{}));
(await pyMethod((pyDivide(run_dir,"judgement.jsonl")),"write_text",[pyAdd((await pyMethod(json,"dumps",[({["metric"]:"hard_denial_rate",["turn"]:2,["verdict"]:"ok",["quote"]:"q"})],{})),"\n")],{"encoding":"utf-8"}));
reused=(await pyMethod(persona_report,"read_existing_judgement",[run_dir],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(reused,"reused")===true);return pyBool(__left)?pyEqual((await pyLen(pyAt(reused,"findings"))),1):__left;})());return pyBool(__left)?!pyBool(called):__left;})())),"tests/play/test_persona_bench.py:485 assert reused[\"reused\"] is True and len(reused[\"findings\"]) == 1 and not called");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_findings_can_be_refolded_without_paying_the_judge_again"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_findings_can_be_refolded_without_paying_the_judge_again(temporary,pyMonkeypatch(t));});
export async function test_a_secret_leak_on_a_turn_that_minted_no_clue_says_so(){
let folded:any,citations:any;
folded=(await pyMethod(persona_report,"fold_judgement",[({["findings"]:[({["metric"]:"secret_leak",["turn"]:2,["verdict"]:"violation",["quote"]:"the wards"}),({["metric"]:"secret_leak",["turn"]:3,["verdict"]:"violation",["quote"]:"the sorcerer"})]})],{"turns_seen":new Set([2,3]),"allowed":["secret_leak"],"admission_failed":(await pySet()),"clue_turns":new Set([3])}));
citations=pyAt(pyAt(folded,"secret_leak"),"citations");
assert.ok(pyBool((pyAt(pyAt(citations,0),"no_clue_receipt_this_turn")===true)),"tests/play/test_persona_bench.py:496 assert citations[0][\"no_clue_receipt_this_turn\"] is True");
assert.ok(pyBool(!pyContains(pyAt(citations,1),"no_clue_receipt_this_turn")),"tests/play/test_persona_bench.py:497 assert \"no_clue_receipt_this_turn\" not in citations[1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_secret_leak_on_a_turn_that_minted_no_clue_says_so"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_secret_leak_on_a_turn_that_minted_no_clue_says_so();});
export async function test_credentials_are_linked_not_copied_so_a_refresh_reaches_the_player(tmp_path:any){
let live:any,home:any;

live=pyDivide(tmp_path,"live");
(await pyMethod(live,"mkdir",[],{}));
(await pyMethod((pyDivide(live,"auth.json")),"write_text",["{\"xai\": {\"access\": \"first\"}}"],{"encoding":"utf-8"}));
(await pyMethod((pyDivide(live,"models.json")),"write_text",["{\"providers\": {}}"],{"encoding":"utf-8"}));
home=(await pyMethod(player_mod,"seed_home",[pyDivide(tmp_path,"home"),live],{}));
assert.ok(pyBool((await pyMethod((pyDivide(home,"auth.json")),"is_symlink",[],{}))),"tests/play/test_persona_bench.py:507 assert (home / \"auth.json\").is_symlink()");
(await pyMethod((pyDivide(live,"auth.json")),"write_text",["{\"xai\": {\"access\": \"refreshed\"}}"],{"encoding":"utf-8"}));
assert.ok(pyBool(pyContains((await pyMethod((pyDivide(home,"auth.json")),"read_text",[],{"encoding":"utf-8"})),"refreshed")),"tests/play/test_persona_bench.py:509 assert \"refreshed\" in (home / \"auth.json\").read_text(encoding=\"utf-8\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_credentials_are_linked_not_copied_so_a_refresh_reaches_the_player"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_credentials_are_linked_not_copied_so_a_refresh_reaches_the_player(temporary);});
export async function test_out_of_credit_stops_the_suite_instead_of_looking_like_a_bad_player(tmp_path:any,monkeypatch:any){
let persona:any,player:any;

persona=pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01");
player=(await pyMethod(player_mod,"PersonaPlayer",[persona,pyDivide(tmp_path,"run")],{"launcher":FAKE_PERSONA,"credentials_from":pyDivide(tmp_path,"none")}));
player._last_error_message="OpenAI API error (403): 403 \"You have run out of credits\"";
(await pyMethod(monkeypatch,"setattr",[player_mod.PersonaPlayer,"_prompt",(self:any, m:any, t:any)=>["",true]],{}));
await assert.rejects(()=>player.act("anything"),player_mod.ProviderExhausted);
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_out_of_credit_stops_the_suite_instead_of_looking_like_a_bad_player"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_out_of_credit_stops_the_suite_instead_of_looking_like_a_bad_player(temporary,pyMonkeypatch(t));});
export async function test_a_run_queued_after_exhaustion_is_not_started(tmp_path:any){
let record:any;
(await pyMethod(bench._exhausted,"set",[],{}));
try{record=(await pyMethod(bench,"execute_run",[({["campaign"]:"c",["run_id"]:"r",["lane"]:"controlled",["trial"]:1,["persona"]:"P01"}),({...bench.DEFAULTS,["suite"]:"s"}),pyAt((await pyMethod(player_mod,"load_personas",[],{})),"P01"),tmp_path],{}));}finally{(await pyMethod(bench._exhausted,"clear",[],{}));}
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(record,"status"),"invalid");return pyBool(__left)?pyContains(pyAt(record,"error"),"provider_exhausted"):__left;})())),"tests/play/test_persona_bench.py:532 assert record[\"status\"] == \"invalid\" and \"provider_exhausted\" in record[\"error\"]");
assert.ok(pyBool(pyEqual(pyAt(record,"turns_played"),0)),"tests/play/test_persona_bench.py:533 assert record[\"turns_played\"] == 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_run_queued_after_exhaustion_is_not_started"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetPersona(t);await test_a_run_queued_after_exhaustion_is_not_started(temporary);});
