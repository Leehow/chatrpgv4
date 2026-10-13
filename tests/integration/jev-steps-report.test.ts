import * as report from "../play/jev-steps-report.ts";
// Migrated from tests/play/test_jev_steps_report.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {captureOutput,approximations,pyObjectFromEntries,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./report-native-support.ts";






export let FIRST_IMPRESSION:any="natural-npc:first-impression";
export async function write_jsonl(path:any,rows:any){
(await pyMethod(path.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(path,"write_text",[pyAdd((await pyMethod("\n","join",[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push((await pyMethod(json,"dumps",[r],{"ensure_ascii":false})));}return __rows;})())],{})),"\n")],{"encoding":"utf-8"}));
}
export async function write_campaign(campaigns:any,cid:any,rows:any,turns:any=null){
let folder:any,turn:any,record:any,target:any;
folder=pyDivide(campaigns,cid);
(await write_jsonl(pyDivide(folder,"telemetry.jsonl"),rows));
for([turn,record] of pyIterable((await pyMethod(((await (async()=>{const __left=turns;return pyBool(__left)?__left:({});})())),"items",[],{})))){
target=pyDivide(pyDivide(folder,"turns"),`${pyFormat(turn,"04d")}.json`);
(await pyMethod(target.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(target,"write_text",[(await pyMethod(json,"dumps",[({["turn"]:turn,["player_text"]:"",["receipts"]:[],...record})],{}))],{"encoding":"utf-8"}));
}
return folder;
}
export async function candidate(cls:any,key:any,turn:any,cleared:any,did:any,confidence:any=0.8,extra:any={}){
return ({["lane"]:"route",["purpose"]:"consequence",["shadow"]:true,["run"]:`run-${turn}`,["class"]:cls,["key"]:`consequence:${cls}:${key}`,["cleared"]:cleared,["confidence"]:confidence,["distribution"]:(pyBool((confidence===null))?null:({["true"]:confidence,["false"]:pySubtract(1,confidence)})),["keeper_did"]:did,["turn"]:turn,...extra});
}
export async function budget(turn:any,ms:any,run:any=null){
return ({["lane"]:"run",["event"]:"consequence_budget",["turn"]:turn,["run"]:(await (async()=>{const __left=run;return pyBool(__left)?__left:`run-${turn}`;})()),["ms"]:ms,["rows"]:1});
}
export async function run_end(turn:any,status:any){
return ({["lane"]:"run",["type"]:"run_end",["turn"]:turn,["status"]:status});
}
export async function person_and_roll(who:any,name:any){
return ({["receipts"]:[({["kind"]:"person",["who"]:who,["name"]:name}),({["kind"]:"roll",["decision"]:FIRST_IMPRESSION,["npc"]:who})]});
}
export async function table_a_rows(){

return [(await candidate("npc_reaction","kp:vittorio-macario",1,true,false,undefined,({}))),(await candidate("npc_reaction","kp:vittorio-macario",1,true,true,undefined,({}))),(await candidate("npc_reaction","kp:dr-smith",2,true,"other",undefined,({}))),(await candidate("npc_reaction","kp:anna",3,false,true,0.3,({}))),(await candidate("npc_reaction","kp:bob",4,false,false,0.1,({}))),(await candidate("clue_follow_up","ledger",1,true,false,undefined,({"executed":true,"shadow":false}))),(await candidate("clue_follow_up","diary",2,false,false,0.2,({}))),(await candidate("time_cost","library",1,true,true,null,({"direct":true}))),(await candidate("time_cost","archive",2,false,true,null,({}))),(await candidate("time_cost","morgue",3,true,true,0.9,({}))),(await candidate("time_cost","harbor",4,true,null,0.9,({}))),(await candidate("time_cost","dock",6,false,true,0.2,({}))),(await run_end(5,"failed")),(await candidate("npc_reaction","kp:ghost",5,true,false,undefined,({}))),({["lane"]:"route",["purpose"]:"consequence",["shadow"]:true,["class"]:"npc_reaction",["exists"]:true,["cleared"]:true,["confidence"]:0.9,["turn"]:1}),(await budget(1,1000)),(await budget(2,2000)),(await budget(2,2000)),(await budget(3,1500))];
}
export async function table_b_rows(){

return [(await candidate("npc_reaction","kp:Vittorio Macario",1,true,"other",undefined,({}))),(await candidate("npc_reaction","kp:anna",2,true,true,undefined,({}))),(await candidate("npc_reaction","kp:bob",3,true,true,undefined,({}))),(await candidate("clue_follow_up","ledger",1,true,true,undefined,({}))),(await candidate("clue_follow_up","diary",2,true,true,undefined,({}))),(await candidate("clue_follow_up","map",3,true,false,undefined,({}))),(await candidate("clue_follow_up","key",4,true,"other",undefined,({}))),(await candidate("time_cost","docks",1,true,true,undefined,({}))),(await candidate("time_cost","church",2,true,true,undefined,({}))),(await budget(1,500)),(await budget(2,700))];
}
export async function* homes(tmp_path:any){
let repo:any,user_data:any;

repo=pyDivide(tmp_path,"repo");
(await write_campaign(pyDivide(pyDivide(repo,".coc"),"campaigns"),"tbl-a",(await table_a_rows()),pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const t of pyIterable((await pyRange(1,6)))){__rows.push([t,({})]);}return __rows;})()))));
(await write_campaign(pyDivide(pyDivide(repo,".coc"),"campaigns"),"setup-only",[({["lane"]:"run",["type"]:"run_end",["turn"]:0,["status"]:"delivered"})]));
user_data=pyDivide(pyDivide(pyDivide(tmp_path,"Application Support"),"Pipi"),"pipicoc");
(await write_campaign(pyDivide(pyDivide(pyDivide(user_data,"pi-coc"),".coc"),"campaigns"),"game-b",(await table_b_rows()),({[1]:(await person_and_roll("vittorio-macario","Vittorio Macario")),[2]:({}),[3]:({}),[4]:({})})));
return ({["repo"]:repo,["user_data"]:user_data,["app_home"]:pyDivide(user_data,"pi-coc")});
}
export async function resolve(...paths:any[]){
let found:any,globs:any,errors:any;
const __unpack6775=(await pyMethod(report,"split_arguments",[(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(paths)){__rows.push((await pyStr(p)));}return __rows;})())],{}));found=__unpack6775[0];globs=__unpack6775[1];errors=__unpack6775[2];
assert.ok(pyBool((await (async()=>{const __left=!pyBool(globs);return pyBool(__left)?!pyBool(errors):__left;})())),"tests/play/test_jev_steps_report.py:122 assert not globs and not errors");
return found;
}
export async function test_resolve_home_recognises_every_layout(homes:any,tmp_path:any){
let repo:any,user_data:any,app_home:any;
const __unpack6969=[pyAt(homes,"repo"),pyAt(homes,"user_data"),pyAt(homes,"app_home")];repo=__unpack6969[0];user_data=__unpack6969[1];app_home=__unpack6969[2];
assert.ok(pyBool(pyEqual((await pyMethod(report,"resolve_home",[(await pyStr(repo))],{})),[(await pyStr(pyDivide(pyDivide(repo,".coc"),"campaigns"))),"home"])),"tests/play/test_jev_steps_report.py:128 assert report.resolve_home(str(repo)) == (str(repo / \".coc\" / \"campaigns\"), \"home\")");
assert.ok(pyBool(pyEqual((await pyMethod(report,"resolve_home",[(await pyStr(app_home))],{})),[(await pyStr(pyDivide(pyDivide(app_home,".coc"),"campaigns"))),"home"])),"tests/play/test_jev_steps_report.py:129 assert report.resolve_home(str(app_home)) == (str(app_home / \".coc\" / \"campaigns\"), \"home\")");
assert.ok(pyBool(pyEqual((await pyMethod(report,"resolve_home",[(await pyStr(user_data))],{})),[(await pyStr(pyDivide(pyDivide(app_home,".coc"),"campaigns"))),"app-userdata"])),"tests/play/test_jev_steps_report.py:130 assert report.resolve_home(str(user_data)) == (str(app_home / \".coc\" / \"campaigns\"), \"app-userdata\")");
assert.ok(pyBool(pyEqual((await pyMethod(report,"resolve_home",[(await pyStr(pyDivide(app_home,".coc")))],{})),[(await pyStr(pyDivide(pyDivide(app_home,".coc"),"campaigns"))),"workspace"])),"tests/play/test_jev_steps_report.py:131 assert report.resolve_home(str(app_home / \".coc\")) == (str(app_home / \".coc\" / \"campaigns\"), \"workspace\")");
assert.ok(pyBool(pyEqual((await pyMethod(report,"resolve_home",[(await pyStr(pyDivide(pyDivide(app_home,".coc"),"campaigns")))],{})),[(await pyStr(pyDivide(pyDivide(app_home,".coc"),"campaigns"))),"campaigns-dir"])),"tests/play/test_jev_steps_report.py:132 assert report.resolve_home(str(app_home / \".coc\" / \"campaigns\")) == (str(app_home / \".coc\" / \"campaigns\"), \"campaigns-dir\")");
assert.ok(pyBool(((await pyMethod(report,"resolve_home",[(await pyStr(pyDivide(tmp_path,"nowhere")))],{}))===null)),"tests/play/test_jev_steps_report.py:133 assert report.resolve_home(str(tmp_path / \"nowhere\")) is None");
(await pyMethod((pyDivide(tmp_path,"empty")),"mkdir",[],{}));
assert.ok(pyBool(((await pyMethod(report,"resolve_home",[(await pyStr(pyDivide(tmp_path,"empty")))],{}))===null)),"tests/play/test_jev_steps_report.py:135 assert report.resolve_home(str(tmp_path / \"empty\")) is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_resolve_home_recognises_every_layout"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_resolve_home_recognises_every_layout(await acquireFixture(t,()=>homes(temporary)),temporary);});
export async function test_the_same_campaigns_dir_named_two_ways_is_one_home(homes:any){
let found:any;
found=(await resolve(pyAt(homes,"user_data"),pyAt(homes,"app_home"),pyDivide(pyAt(homes,"app_home"),".coc")));
assert.ok(pyBool(pyEqual((await pyLen(found)),1)),"tests/play/test_jev_steps_report.py:140 assert len(found) == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_same_campaigns_dir_named_two_ways_is_one_home"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_same_campaigns_dir_named_two_ways_is_one_home(await acquireFixture(t,()=>homes(temporary)));});
export async function test_aggregate_over_a_checkout_and_an_app_home_pins_every_number(homes:any){
let agg:any,a:any,b:any,npc:any,clue:any,time_cost:any;
agg=(await pyMethod(report,"aggregate",[(await resolve(pyAt(homes,"repo"),pyAt(homes,"user_data")))],{}));
assert.ok(pyBool(pyEqual(pyAt(agg,"scanned"),3)),"tests/play/test_jev_steps_report.py:146 assert agg[\"scanned\"] == 3");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(pyAt(agg,"tables"))){__rows.push(pyAt(t,"label"));}return __rows;})()),["h1:tbl-a","h2:game-b"])),"tests/play/test_jev_steps_report.py:147 assert [t[\"label\"] for t in agg[\"tables\"]] == [\"h1:tbl-a\", \"h2:game-b\"]");
const __unpack8226=pyAt(agg,"tables");a=__unpack8226[0];b=__unpack8226[1];
assert.ok(pyBool(pyEqual(pyAt(pyAt(a,"classes"),"npc_reaction"),({["rows"]:4,["artifacts"]:0,["excluded"]:({["duplicate"]:1,["stranded"]:1}),["executes"]:false,["tp"]:1,["fp"]:1,["fn"]:1,["tn"]:1}))),"tests/play/test_jev_steps_report.py:150 assert a[\"classes\"][\"npc_reaction\"] == {\"rows\": 4, \"artifacts\": 0, \"excluded\": {\"duplicate\": 1, \"stranded\": 1}, \"executes\": False,\n                                            \"tp\": 1, \"fp\": 1, \"fn\": 1, \"tn\": 1}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(a,"classes"),"clue_follow_up"),({["rows"]:1,["artifacts"]:0,["excluded"]:({["executed"]:1}),["executes"]:true,["tp"]:0,["fp"]:0,["fn"]:0,["tn"]:1}))),"tests/play/test_jev_steps_report.py:152 assert a[\"classes\"][\"clue_follow_up\"] == {\"rows\": 1, \"artifacts\": 0, \"excluded\": {\"executed\": 1}, \"executes\": True,\n                                              \"tp\": 0, \"fp\": 0, \"fn\": 0, \"tn\": 1}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(a,"classes"),"time_cost"),({["rows"]:2,["artifacts"]:0,["executes"]:false,["excluded"]:({["direct"]:1,["unanswered"]:1,["no_verdict"]:1}),["tp"]:1,["fp"]:0,["fn"]:1,["tn"]:0}))),"tests/play/test_jev_steps_report.py:154 assert a[\"classes\"][\"time_cost\"] == {\"rows\": 2, \"artifacts\": 0, \"executes\": False,\n                                         \"excluded\": {\"direct\": 1, \"unanswered\": 1, \"no_verdict\": 1},\n                                         \"tp\": 1, \"fp\": 0, \"fn\": 1, \"tn\": 0}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(b,"classes"),"npc_reaction"),"artifacts"),1)),"tests/play/test_jev_steps_report.py:157 assert b[\"classes\"][\"npc_reaction\"][\"artifacts\"] == 1");
assert.ok(pyBool(pyEqual([pyAt(pyAt(pyAt(b,"classes"),"npc_reaction"),"tp"),pyAt(pyAt(pyAt(b,"classes"),"npc_reaction"),"fp")],[3,0])),"tests/play/test_jev_steps_report.py:158 assert (b[\"classes\"][\"npc_reaction\"][\"tp\"], b[\"classes\"][\"npc_reaction\"][\"fp\"]) == (3, 0)");
assert.ok(pyBool(pyEqual([pyAt(pyAt(pyAt(b,"classes"),"clue_follow_up"),"tp"),pyAt(pyAt(pyAt(b,"classes"),"clue_follow_up"),"fp")],[2,2])),"tests/play/test_jev_steps_report.py:159 assert (b[\"classes\"][\"clue_follow_up\"][\"tp\"], b[\"classes\"][\"clue_follow_up\"][\"fp\"]) == (2, 2)");
assert.ok(pyBool(pyEqual(pyAt(a,"cost"),({["turns_with_call"]:3,["mean_ms"]:1500,["median_ms"]:1500,["max_ms"]:2000}))),"tests/play/test_jev_steps_report.py:160 assert a[\"cost\"] == {\"turns_with_call\": 3, \"mean_ms\": 1500, \"median_ms\": 1500, \"max_ms\": 2000}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(b,"cost"),"mean_ms"),600)),"tests/play/test_jev_steps_report.py:161 assert b[\"cost\"][\"mean_ms\"] == 600");
const __unpack9383=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(["npc_reaction","clue_follow_up","time_cost"])){__rows.push(pyAt(pyAt(agg,"classes"),c));}return __rows;})());npc=__unpack9383[0];clue=__unpack9383[1];time_cost=__unpack9383[2];
assert.ok(pyBool(pyEqual([pyAt(npc,"tp"),pyAt(npc,"fp"),pyAt(npc,"fn")],[4,1,1])),"tests/play/test_jev_steps_report.py:164 assert (npc[\"tp\"], npc[\"fp\"], npc[\"fn\"]) == (4, 1, 1)");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(npc,"agreement"),(await pyMethod(approximations,"approx",[0.8],{})));return pyBool(__left)?!pyBool(pyAt(npc,"agreement_met")):__left;})());return pyBool(__left)?pyAt(npc,"fp_met"):__left;})());return pyBool(__left)?!pyBool(pyAt(npc,"met")):__left;})())),"tests/play/test_jev_steps_report.py:165 assert npc[\"agreement\"] == pytest.approx(0.8) and not npc[\"agreement_met\"] and npc[\"fp_met\"] and not npc[\"met\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(npc,"recall"),(await pyMethod(approximations,"approx",[0.8],{})));return pyBool(__left)?pyEqual(pyAt(npc,"recall_tables"),2):__left;})())),"tests/play/test_jev_steps_report.py:166 assert npc[\"recall\"] == pytest.approx(0.8) and npc[\"recall_tables\"] == 2");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(clue,"agreement"),0.5);return pyBool(__left)?pyEqual(pyAt(clue,"fp_over"),["h2:game-b"]):__left;})());return pyBool(__left)?!pyBool(pyAt(clue,"fp_met")):__left;})());return pyBool(__left)?!pyBool(pyAt(clue,"met")):__left;})())),"tests/play/test_jev_steps_report.py:168 assert clue[\"agreement\"] == 0.5 and clue[\"fp_over\"] == [\"h2:game-b\"] and not clue[\"fp_met\"] and not clue[\"met\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(clue,"recall_tables"),1);return pyBool(__left)?pyEqual(pyAt(clue,"recall"),1.0):__left;})())),"tests/play/test_jev_steps_report.py:169 assert clue[\"recall_tables\"] == 1 and clue[\"recall\"] == 1.0");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(time_cost,"agreement"),1.0);return pyBool(__left)?pyEqual(pyAt(time_cost,"recall"),0.75):__left;})())),"tests/play/test_jev_steps_report.py:171 assert time_cost[\"agreement\"] == 1.0 and time_cost[\"recall\"] == 0.75");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyAt(time_cost,"fp_met");return pyBool(__left)?pyAt(time_cost,"cost_met"):__left;})());return pyBool(__left)?pyAt(time_cost,"met"):__left;})())),"tests/play/test_jev_steps_report.py:172 assert time_cost[\"fp_met\"] and time_cost[\"cost_met\"] and time_cost[\"met\"]");
assert.ok(pyBool(pyEqual(pyAt(agg,"cost"),({["tables_with_data"]:2,["over"]:[],["met"]:true}))),"tests/play/test_jev_steps_report.py:173 assert agg[\"cost\"] == {\"tables_with_data\": 2, \"over\": [], \"met\": True}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_aggregate_over_a_checkout_and_an_app_home_pins_every_number"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_aggregate_over_a_checkout_and_an_app_home_pins_every_number(await acquireFixture(t,()=>homes(temporary)));});
export async function test_verdict_text_says_met_or_not_met_with_the_table_count_and_per_table_numbers(homes:any,capsys:any){
let out:any;
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyAt(homes,"repo"))),(await pyStr(pyAt(homes,"user_data")))]],{})),0)),"tests/play/test_jev_steps_report.py:177 assert report.main([\"jev-steps-report.py\", str(homes[\"repo\"]), str(homes[\"user_data\"])]) == 0");
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyContains(out,"tables with consequence telemetry: 2")),"tests/play/test_jev_steps_report.py:179 assert \"tables with consequence telemetry: 2\" in out");
assert.ok(pyBool(pyContains(out,"[npc_reaction] NOT MET -- 2 of 2 tables have rows of this class")),"tests/play/test_jev_steps_report.py:180 assert \"[npc_reaction] NOT MET -- 2 of 2 tables have rows of this class\" in out");
assert.ok(pyBool(pyContains(out,"[clue_follow_up] NOT MET -- 2 of 2 tables")),"tests/play/test_jev_steps_report.py:181 assert \"[clue_follow_up] NOT MET -- 2 of 2 tables\" in out");
assert.ok(pyBool(pyContains(out,"[time_cost] MET -- 2 of 2 tables")),"tests/play/test_jev_steps_report.py:182 assert \"[time_cost] MET -- 2 of 2 tables\" in out");
assert.ok(pyBool(pyContains(out,"agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): 4/5 = 0.800 (>= 0.90): NOT MET")),"tests/play/test_jev_steps_report.py:183 assert \"agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): 4/5 = 0.800 (>= 0.90): NOT MET\" in out");
assert.ok(pyBool(pyContains(out,"recall tp/(tp+fn), information only, over the 2 tables that only shadowed the class: 4/5 = 0.80")),"tests/play/test_jev_steps_report.py:184 assert \"recall tp/(tp+fn), information only, over the 2 tables that only shadowed the class: 4/5 = 0.80\" in out");
assert.ok(pyBool(pyContains(out,"recall tp/(tp+fn), information only, over the 1 tables that only shadowed the class: 2/2 = 1.00")),"tests/play/test_jev_steps_report.py:185 assert \"recall tp/(tp+fn), information only, over the 1 tables that only shadowed the class: 2/2 = 1.00\" in out");
assert.ok(pyBool(pyContains(out,"h1:tbl-a: rows 4 tp 1 fp 1 fn 1 tn 1 agreement 1/2 = 0.50 recall 1/2 = 0.50")),"tests/play/test_jev_steps_report.py:186 assert \"h1:tbl-a: rows 4 tp 1 fp 1 fn 1 tn 1 agreement 1/2 = 0.50 recall 1/2 = 0.50\" in out");
assert.ok(pyBool(pyContains(out,"h1:tbl-a: rows 1 tp 0 fp 0 fn 0 tn 1 agreement n/a recall n/a (executed)")),"tests/play/test_jev_steps_report.py:187 assert \"h1:tbl-a: rows 1 tp 0 fp 0 fn 0 tn 1 agreement n/a recall n/a (executed)\" in out");
assert.ok(pyBool(pyContains(out,"h2:game-b: rows 4 tp 2 fp 2 fn 0 tn 0 agreement 2/4 = 0.50 recall 2/2 = 1.00")),"tests/play/test_jev_steps_report.py:188 assert \"h2:game-b: rows 4 tp 2 fp 2 fn 0 tn 0 agreement 2/4 = 0.50 recall 2/2 = 1.00\" in out");
assert.ok(pyBool(pyContains(out,"h1:tbl-a: 3/5 turns with a call; mean 1500 ms")),"tests/play/test_jev_steps_report.py:189 assert \"h1:tbl-a: 3/5 turns with a call; mean 1500 ms\" in out");
assert.ok(pyBool(!pyContains(out,"campaign: tbl-a")),"tests/play/test_jev_steps_report.py:190 assert \"campaign: tbl-a\" not in out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_verdict_text_says_met_or_not_met_with_the_table_count_and_per_table_numbers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_verdict_text_says_met_or_not_met_with_the_table_count_and_per_table_numbers(await acquireFixture(t,()=>homes(temporary)),captureOutput(t));});
export async function test_the_added_ms_line_is_inclusive_and_judged_per_table(tmp_path:any,ms:any,met:any){
let campaigns:any,good:any,bad:any,agg:any;
campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
good=[(await candidate("time_cost","docks",1,true,true,undefined,({}))),(await budget(1,100))];
bad=[(await candidate("time_cost","docks",1,true,true,undefined,({}))),(await budget(1,ms))];
(await write_campaign(campaigns,"good",good));
(await write_campaign(campaigns,"edge",bad));
agg=(await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{}));
assert.ok(pyBool((pyAt(pyAt(agg,"cost"),"met")===met)),"tests/play/test_jev_steps_report.py:201 assert agg[\"cost\"][\"met\"] is met");
assert.ok(pyBool(pyEqual(pyAt(pyAt(agg,"cost"),"over"),((pyBool(met)?[]:["h1:edge"])))),"tests/play/test_jev_steps_report.py:202 assert agg[\"cost\"][\"over\"] == ([] if met else [\"h1:edge\"])");
assert.ok(pyBool((pyAt(pyAt(pyAt(agg,"classes"),"time_cost"),"met")===met)),"tests/play/test_jev_steps_report.py:203 assert agg[\"classes\"][\"time_cost\"][\"met\"] is met");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("ms, met",[[1500,true],[1501,false]]))).entries())test("test_the_added_ms_line_is_inclusive_and_judged_per_table"+((pyCartesian([{}],pyParametrize("ms, met",[[1500,true],[1501,false]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_added_ms_line_is_inclusive_and_judged_per_table(temporary,row["ms"],row["met"]);});
export async function test_agreement_is_precision_over_judged_cleared_rows_and_is_inclusive_at_point_nine(tmp_path:any){
let campaigns:any,name:any,v:any;

campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
async function table(hits:any,false_positives:any){
return (pyAdd(pyAdd((await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(hits)))){__rows.push((await candidate("time_cost",`hit${i}`,i,true,true,undefined,({}))));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(false_positives)))){__rows.push((await candidate("time_cost",`fp${i}`,pyAdd(100,i),true,(pyBool((i%2))?"other":false),undefined,({}))));}return __rows;})())),[(await candidate("time_cost","miss",200,false,true,0.2,({}))),(await candidate("time_cost","quiet",201,false,false,0.1,({}))),(await budget(1,10))]));
}
for(name of pyIterable(["one","two"])){
(await write_campaign(campaigns,name,(await table(9,1))));
}
v=pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{})),"classes"),"time_cost");
assert.ok(pyBool((await (async()=>{const __left=pyEqual([pyAt(v,"tp"),pyAt(v,"fp"),pyAt(v,"fn")],[18,2,2]);return pyBool(__left)?pyEqual(pyAt(v,"agreement"),0.9):__left;})())),"tests/play/test_jev_steps_report.py:220 assert (v[\"tp\"], v[\"fp\"], v[\"fn\"]) == (18, 2, 2) and v[\"agreement\"] == 0.9");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyAt(v,"agreement_met");return pyBool(__left)?pyAt(v,"fp_met"):__left;})());return pyBool(__left)?pyAt(v,"met"):__left;})())),"tests/play/test_jev_steps_report.py:221 assert v[\"agreement_met\"] and v[\"fp_met\"] and v[\"met\"]");
for(name of pyIterable(["one","two"])){
(await write_campaign(campaigns,name,(await table(8,1))));
}
v=pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{})),"classes"),"time_cost");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual([pyAt(v,"tp"),pyAt(v,"fp")],[16,2]);return pyBool(__left)?pyAt(v,"fp_met"):__left;})());return pyBool(__left)?!pyBool(pyAt(v,"agreement_met")):__left;})());return pyBool(__left)?!pyBool(pyAt(v,"met")):__left;})())),"tests/play/test_jev_steps_report.py:225 assert (v[\"tp\"], v[\"fp\"]) == (16, 2) and v[\"fp_met\"] and not v[\"agreement_met\"] and not v[\"met\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_agreement_is_precision_over_judged_cleared_rows_and_is_inclusive_at_point_nine"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_agreement_is_precision_over_judged_cleared_rows_and_is_inclusive_at_point_nine(temporary);});
export async function test_a_ratio_just_under_the_line_is_not_printed_as_the_line(tmp_path:any,capsys:any){
let campaigns:any,rows:any;
campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
rows=(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(26)))){__rows.push((await candidate("time_cost",`hit${i}`,i,true,true,undefined,({}))));}return __rows;})());
rows=pyAdd(rows,(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(3)))){__rows.push((await candidate("time_cost",`fp${i}`,pyAdd(100,i),true,false,undefined,({}))));}return __rows;})()));
(await write_campaign(campaigns,"t",pyAdd(rows,[(await budget(1,10))])));
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyDivide(tmp_path,"home")))]],{})),0)),"tests/play/test_jev_steps_report.py:233 assert report.main([\"jev-steps-report.py\", str(tmp_path / \"home\")]) == 0");
assert.ok(pyBool(pyContains((await pyMethod(capsys,"readouterr",[],{})).out,"26/29 = 0.897 (>= 0.90): NOT MET")),"tests/play/test_jev_steps_report.py:234 assert \"26/29 = 0.897 (>= 0.90): NOT MET\" in capsys.readouterr().out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_ratio_just_under_the_line_is_not_printed_as_the_line"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_ratio_just_under_the_line_is_not_printed_as_the_line(temporary,captureOutput(t));});
export async function test_a_cleared_row_with_no_keeper_verdict_is_not_judged(tmp_path:any){
let campaigns:any,v:any;
campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
(await write_campaign(campaigns,"t",[(await candidate("time_cost","docks",1,true,null,undefined,({}))),(await budget(1,10))]));
v=pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{})),"classes"),"time_cost");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=(pyAt(v,"agreement")===null);return pyBool(__left)?pyEqual(pyAt(v,"fp"),0):__left;})());return pyBool(__left)?pyEqual(pyAt(v,"excluded"),({["no_verdict"]:1})):__left;})());return pyBool(__left)?(pyAt(v,"met")===false):__left;})())),"tests/play/test_jev_steps_report.py:241 assert v[\"agreement\"] is None and v[\"fp\"] == 0 and v[\"excluded\"] == {\"no_verdict\": 1} and v[\"met\"] is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_cleared_row_with_no_keeper_verdict_is_not_judged"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_cleared_row_with_no_keeper_verdict_is_not_judged(temporary);});
export async function test_executed_rows_are_out_individually_and_the_tables_that_execute_stay_in_the_verdict(tmp_path:any){
let campaigns:any,executing:any,shadow_only:any,agg:any,v:any;

campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
executing=[(await candidate("clue_follow_up","ledger",1,true,false,undefined,({"executed":true,"shadow":false}))),(await candidate("clue_follow_up","diary",2,true,true,undefined,({}))),(await candidate("clue_follow_up","map",3,false,true,0.2,({}))),(await budget(1,10))];
shadow_only=[(await candidate("clue_follow_up","key",1,true,true,undefined,({}))),(await candidate("clue_follow_up","lamp",2,false,true,0.2,({}))),(await budget(1,10))];
(await write_campaign(campaigns,"executing",executing));
(await write_campaign(campaigns,"shadowing",shadow_only));
agg=(await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{}));
v=pyAt(pyAt(agg,"classes"),"clue_follow_up");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(v,"excluded"),({["executed"]:1}));return pyBool(__left)?pyEqual(pyAt(v,"tables_with_rows"),2):__left;})())),"tests/play/test_jev_steps_report.py:258 assert v[\"excluded\"] == {\"executed\": 1} and v[\"tables_with_rows\"] == 2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual([pyAt(v,"tp"),pyAt(v,"fp")],[2,0]);return pyBool(__left)?pyEqual(pyAt(v,"agreement"),1.0):__left;})())),"tests/play/test_jev_steps_report.py:259 assert (v[\"tp\"], v[\"fp\"]) == (2, 0) and v[\"agreement\"] == 1.0");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(v,"recall_tables"),1);return pyBool(__left)?pyEqual([pyAt(v,"recall_tp"),pyAt(v,"recall_fn")],[1,1]):__left;})());return pyBool(__left)?pyEqual(pyAt(v,"recall"),0.5):__left;})())),"tests/play/test_jev_steps_report.py:260 assert v[\"recall_tables\"] == 1 and (v[\"recall_tp\"], v[\"recall_fn\"]) == (1, 1) and v[\"recall\"] == 0.5");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_executed_rows_are_out_individually_and_the_tables_that_execute_stay_in_the_verdict"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_executed_rows_are_out_individually_and_the_tables_that_execute_stay_in_the_verdict(temporary);});
export async function test_a_first_impression_roll_without_an_npc_field_is_not_the_keepers_action(tmp_path:any){
let campaigns:any,v:any;

campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
(await write_campaign(campaigns,"t",[(await candidate("npc_reaction","kp:Unknown Person",1,true,"other",undefined,({}))),(await budget(1,10))],({[1]:({["receipts"]:[({["kind"]:"roll",["decision"]:FIRST_IMPRESSION})]})})));
v=pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{})),"classes"),"npc_reaction");
assert.ok(pyBool(pyEqual([pyAt(v,"tp"),pyAt(v,"fp"),pyAt(v,"artifacts")],[0,1,0])),"tests/play/test_jev_steps_report.py:269 assert (v[\"tp\"], v[\"fp\"], v[\"artifacts\"]) == (0, 1, 0)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_first_impression_roll_without_an_npc_field_is_not_the_keepers_action"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_first_impression_roll_without_an_npc_field_is_not_the_keepers_action(temporary);});
export async function test_two_false_positives_in_one_table_fail_and_one_passes(tmp_path:any){
let campaigns:any,hits:any,one:any,two:any,v:any;
campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
hits=(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(20)))){__rows.push((await candidate("time_cost",`k${i}`,i,true,true,undefined,({}))));}return __rows;})());
one=(await candidate("time_cost","fp1",30,true,false,undefined,({})));
two=(await candidate("time_cost","fp2",31,true,false,undefined,({})));
(await write_campaign(campaigns,"t",pyAdd(hits,[one,(await budget(1,10))])));
assert.ok(pyBool((pyAt(pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{})),"classes"),"time_cost"),"met")===true)),"tests/play/test_jev_steps_report.py:278 assert report.aggregate(resolve(tmp_path / \"home\"))[\"classes\"][\"time_cost\"][\"met\"] is True");
(await write_campaign(campaigns,"t",pyAdd(hits,[one,two,(await budget(1,10))])));
v=pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{})),"classes"),"time_cost");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(v,"fp_over"),["h1:t"]);return pyBool(__left)?(pyAt(v,"met")===false):__left;})())),"tests/play/test_jev_steps_report.py:281 assert v[\"fp_over\"] == [\"h1:t\"] and v[\"met\"] is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_two_false_positives_in_one_table_fail_and_one_passes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_two_false_positives_in_one_table_fail_and_one_passes(temporary);});
export async function test_no_evidence_is_never_a_pass(tmp_path:any,capsys:any){
let campaigns:any,agg:any,out:any;

campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
(await write_campaign(campaigns,"t",[(await candidate("time_cost","docks",1,false,false,0.1,({})))]));
agg=(await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(pyAt(agg,"classes"),"time_cost"),"agreement")===null);return pyBool(__left)?(pyAt(pyAt(pyAt(agg,"classes"),"time_cost"),"met")===false):__left;})())),"tests/play/test_jev_steps_report.py:289 assert agg[\"classes\"][\"time_cost\"][\"agreement\"] is None and agg[\"classes\"][\"time_cost\"][\"met\"] is False");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(pyAt(agg,"classes"),"npc_reaction"),"met")===false);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(agg,"classes"),"npc_reaction"),"tables_with_rows"),0):__left;})())),"tests/play/test_jev_steps_report.py:290 assert agg[\"classes\"][\"npc_reaction\"][\"met\"] is False and agg[\"classes\"][\"npc_reaction\"][\"tables_with_rows\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(agg,"cost"),({["tables_with_data"]:0,["over"]:[],["met"]:false}))),"tests/play/test_jev_steps_report.py:291 assert agg[\"cost\"] == {\"tables_with_data\": 0, \"over\": [], \"met\": False}");
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyDivide(tmp_path,"home")))]],{})),0)),"tests/play/test_jev_steps_report.py:292 assert report.main([\"jev-steps-report.py\", str(tmp_path / \"home\")]) == 0");
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyContains(out,"n/a -- no such row (tp 0, fp 0): NOT MET, no evidence")),"tests/play/test_jev_steps_report.py:294 assert \"n/a -- no such row (tp 0, fp 0): NOT MET, no evidence\" in out");
assert.ok(pyBool(pyContains(out,"no table has a consequence_budget row: NOT MET, no evidence")),"tests/play/test_jev_steps_report.py:295 assert \"no table has a consequence_budget row: NOT MET, no evidence\" in out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_evidence_is_never_a_pass"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_evidence_is_never_a_pass(temporary,captureOutput(t));});
export async function test_same_campaign_id_in_two_homes_is_two_tables(tmp_path:any){
let name:any,agg:any;
for(name of pyIterable(["one","two"])){
(await write_campaign(pyDivide(pyDivide(pyDivide(tmp_path,name),".coc"),"campaigns"),"same",[(await candidate("time_cost","docks",1,true,true,undefined,({}))),(await budget(1,5))]));
}
agg=(await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"one"),pyDivide(tmp_path,"two")))],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(pyAt(agg,"tables"))){__rows.push(pyAt(t,"label"));}return __rows;})()),["h1:same","h2:same"])),"tests/play/test_jev_steps_report.py:302 assert [t[\"label\"] for t in agg[\"tables\"]] == [\"h1:same\", \"h2:same\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(agg,"classes"),"time_cost"),"tp"),2)),"tests/play/test_jev_steps_report.py:303 assert agg[\"classes\"][\"time_cost\"][\"tp\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_same_campaign_id_in_two_homes_is_two_tables"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_same_campaign_id_in_two_homes_is_two_tables(temporary);});
export async function test_campaign_filter_applies_across_homes(homes:any){
let agg:any;
agg=(await pyMethod(report,"aggregate",[(await resolve(pyAt(homes,"repo"),pyAt(homes,"user_data"))),["game-*"]],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(agg,"scanned"),1);return pyBool(__left)?pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(pyAt(agg,"tables"))){__rows.push(pyAt(t,"label"));}return __rows;})()),["h2:game-b"]):__left;})())),"tests/play/test_jev_steps_report.py:308 assert agg[\"scanned\"] == 1 and [t[\"label\"] for t in agg[\"tables\"]] == [\"h2:game-b\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_campaign_filter_applies_across_homes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_campaign_filter_applies_across_homes(await acquireFixture(t,()=>homes(temporary)));});
export async function test_original_root_and_glob_form_still_prints_every_campaign_then_the_verdict(homes:any,capsys:any){
let out:any;
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyAt(homes,"repo"))),"tbl-*"]],{})),0)),"tests/play/test_jev_steps_report.py:312 assert report.main([\"jev-steps-report.py\", str(homes[\"repo\"]), \"tbl-*\"]) == 0");
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool((await (async()=>{const __left=pyContains(out,"campaign: tbl-a");return pyBool(__left)?!pyContains(out,"campaign: setup-only"):__left;})())),"tests/play/test_jev_steps_report.py:314 assert \"campaign: tbl-a\" in out and \"campaign: setup-only\" not in out");
assert.ok(pyBool(pyContains(out,"-- per class (candidate rows) --")),"tests/play/test_jev_steps_report.py:315 assert \"-- per class (candidate rows) --\" in out");
assert.ok(pyBool((await (async()=>{const __left=pyContains(out,"D6 2a verdict");return pyBool(__left)?pyContains(out,"[time_cost] "):__left;})())),"tests/play/test_jev_steps_report.py:316 assert \"D6 2a verdict\" in out and \"[time_cost] \" in out");
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyAt(homes,"repo"))),"no-such-*"]],{})),1)),"tests/play/test_jev_steps_report.py:317 assert report.main([\"jev-steps-report.py\", str(homes[\"repo\"]), \"no-such-*\"]) == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_original_root_and_glob_form_still_prints_every_campaign_then_the_verdict"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_original_root_and_glob_form_still_prints_every_campaign_then_the_verdict(await acquireFixture(t,()=>homes(temporary)),captureOutput(t));});
export async function test_detail_flag_prints_the_per_campaign_sections(homes:any,capsys:any){
let out:any;
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyAt(homes,"user_data"))),"--detail"]],{})),0)),"tests/play/test_jev_steps_report.py:321 assert report.main([\"jev-steps-report.py\", str(homes[\"user_data\"]), \"--detail\"]) == 0");
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool((await (async()=>{const __left=pyContains(out,"campaign: game-b");return pyBool(__left)?pyContains(out,"D6 2a verdict"):__left;})())),"tests/play/test_jev_steps_report.py:323 assert \"campaign: game-b\" in out and \"D6 2a verdict\" in out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_detail_flag_prints_the_per_campaign_sections"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_detail_flag_prints_the_per_campaign_sections(await acquireFixture(t,()=>homes(temporary)),captureOutput(t));});
export async function test_a_directory_that_is_no_home_is_an_error_not_no_data(tmp_path:any,capsys:any){
(await pyMethod((pyDivide(tmp_path,"typo")),"mkdir",[],{}));
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyDivide(tmp_path,"typo")))]],{})),1)),"tests/play/test_jev_steps_report.py:328 assert report.main([\"jev-steps-report.py\", str(tmp_path / \"typo\")]) == 1");
assert.ok(pyBool(pyContains((await pyMethod(capsys,"readouterr",[],{})).out,"holds no .coc/campaigns")),"tests/play/test_jev_steps_report.py:329 assert \"holds no .coc/campaigns\" in capsys.readouterr().out");
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyDivide(tmp_path,"missing")))]],{})),1)),"tests/play/test_jev_steps_report.py:330 assert report.main([\"jev-steps-report.py\", str(tmp_path / \"missing\")]) == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_directory_that_is_no_home_is_an_error_not_no_data"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_directory_that_is_no_home_is_an_error_not_no_data(temporary,captureOutput(t));});
export async function test_no_arguments_prints_the_docstring(capsys:any){
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py"]],{})),2)),"tests/play/test_jev_steps_report.py:334 assert report.main([\"jev-steps-report.py\"]) == 2");
assert.ok(pyBool(pyContains((await pyMethod(capsys,"readouterr",[],{})).out,"D6 2a verdict")),"tests/play/test_jev_steps_report.py:335 assert \"D6 2a verdict\" in capsys.readouterr().out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_arguments_prints_the_docstring"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_arguments_prints_the_docstring(captureOutput(t));});
export async function test_an_unreadable_turn_file_is_a_missing_turn_not_a_crash(tmp_path:any,capsys:any){
let campaigns:any,folder:any;
campaigns=pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns");
folder=(await write_campaign(campaigns,"t",[(await candidate("time_cost","docks",1,true,true,undefined,({}))),(await budget(1,5))]));
(await pyMethod((pyDivide(folder,"turns")),"mkdir",[],{}));
(await pyMethod((pyDivide(pyDivide(folder,"turns"),"0001.json")),"write_text",["{\"turn\": 1, \"receipts\": ["],{"encoding":"utf-8"}));
(await pyMethod((pyDivide(pyDivide(folder,"turns"),"notes.json")),"write_text",["{}"],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyDivide(tmp_path,"home"))),"--detail"]],{})),0)),"tests/play/test_jev_steps_report.py:344 assert report.main([\"jev-steps-report.py\", str(tmp_path / \"home\"), \"--detail\"]) == 0");
assert.ok(pyBool(pyContains((await pyMethod(capsys,"readouterr",[],{})).out,"[time_cost] MET")),"tests/play/test_jev_steps_report.py:345 assert \"[time_cost] MET\" in capsys.readouterr().out");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unreadable_turn_file_is_a_missing_turn_not_a_crash"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unreadable_turn_file_is_a_missing_turn_not_a_crash(temporary,captureOutput(t));});
export async function snapshot(...roots:any[]){
return pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const root of pyIterable(roots)){for(const p of pyIterable([root,...(await pyMethod(root,"rglob",["*"],{}))])){__rows.push([(await pyStr(p)),[(await pyMethod(p,"stat",[],{})).st_size,(await pyMethod(p,"stat",[],{})).st_mtime_ns]]);}}return __rows;})()));
}
export async function test_the_report_writes_nothing_and_leaves_the_execute_list_alone(homes:any,tmp_path:any,capsys:any){
let budgets:any,before:any;
budgets=pyDivide(pyDivide(pyDivide(pyDivide(pyAt(homes,"repo"),"content"),"rulesets"),"coc7"),"host-budgets.json");
(await pyMethod(budgets.parent,"mkdir",[],{"parents":true}));
(await pyMethod(budgets,"write_text",[(await pyMethod(json,"dumps",[({["jev_steps"]:({["execute"]:["clue_follow_up"]})})],{}))],{"encoding":"utf-8"}));
before=(await snapshot(pyAt(homes,"repo"),pyAt(homes,"user_data").parent.parent));
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyAt(homes,"repo"))),(await pyStr(pyAt(homes,"user_data"))),"--detail"]],{})),0)),"tests/play/test_jev_steps_report.py:357 assert report.main([\"jev-steps-report.py\", str(homes[\"repo\"]), str(homes[\"user_data\"]), \"--detail\"]) == 0");
(await pyMethod(capsys,"readouterr",[],{}));
assert.ok(pyBool(pyEqual((await snapshot(pyAt(homes,"repo"),pyAt(homes,"user_data").parent.parent)),before)),"tests/play/test_jev_steps_report.py:359 assert snapshot(homes[\"repo\"], homes[\"user_data\"].parent.parent) == before");
assert.ok(pyBool(pyEqual((await pyMethod(json,"loads",[(await pyMethod(budgets,"read_text",[],{"encoding":"utf-8"}))],{})),({["jev_steps"]:({["execute"]:["clue_follow_up"]})}))),"tests/play/test_jev_steps_report.py:360 assert json.loads(budgets.read_text(encoding=\"utf-8\")) == {\"jev_steps\": {\"execute\": [\"clue_follow_up\"]}}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_report_writes_nothing_and_leaves_the_execute_list_alone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_report_writes_nothing_and_leaves_the_execute_list_alone(await acquireFixture(t,()=>homes(temporary)),temporary,captureOutput(t));});

export async function executed(key:any,turn:any,confidence:any=0.6,extra:any={}){
return (await candidate("clue_follow_up",key,turn,true,false,confidence,({"executed":true,"shadow":false,...extra})));
}
export async function real_shaped_record(text:any,clue_handles:any){
let appended:any;

appended=(await pyMethod("","join",[(await (async()=>{const __rows:any[]=[];for(const handle of pyIterable(clue_handles)){if(pyBool(!pyContains(text,`{{clue:${handle}`))){__rows.push(`\n\n{{clue:${handle}}}`);}}return __rows;})())],{}));
return ({["text"]:text,["marked_text"]:pyAdd(text,appended),["receipts"]:(await (async()=>{const __rows:any[]=[];for(const handle of pyIterable(clue_handles)){__rows.push(({["kind"]:"clue",["clue"]:handle,["id"]:`clue:${handle}-t0`}));}return __rows;})())});
}
export async function steps_of(tmp_path:any,rows:any,turns:any,home:any="home"){
(await write_campaign(pyDivide(pyDivide(pyDivide(tmp_path,home),".coc"),"campaigns"),"t",pyAdd(rows,[(await budget(1,10))]),turns));
return pyAt(pyAt(pyAt((await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,home)))],{})),"tables"),0),"executed_steps");
}
export async function test_an_executed_clue_is_narrated_when_the_keepers_text_places_its_marker(tmp_path:any){
let rows:any,turns:any,steps:any;
rows=[(await executed("ledger",1)),(await executed("diary",2)),(await executed("map",3))];
turns=({[1]:(await real_shaped_record("He slides it over. {{clue:ledger}}",["ledger"])),[2]:(await real_shaped_record("A page. {{clue:diary-t2}}",["diary"])),[3]:(await real_shaped_record("Two pages. {{clue:map-2}}",["map"]))});
steps=(await steps_of(tmp_path,rows,turns));
assert.ok(pyBool(pyEqual([pyAt(steps,"executed"),pyAt(steps,"narrated"),pyAt(steps,"neither")],[3,3,[]])),"tests/play/test_jev_steps_report.py:388 assert (steps[\"executed\"], steps[\"narrated\"], steps[\"neither\"]) == (3, 3, [])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_executed_clue_is_narrated_when_the_keepers_text_places_its_marker"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_executed_clue_is_narrated_when_the_keepers_text_places_its_marker(temporary);});
export async function test_the_known_real_case_an_executed_clue_the_prose_never_places_is_neither(tmp_path:any){
let text:any,record:any,rows:any,steps:any;

text="The newsstand smells of smoke.\n\n{{say:Dooley}}“A paper?” he asks.";
record=(await real_shaped_record(text,["dooley-macario-madness","burning-eyes-form"]));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(record,"marked_text"),"{{clue:dooley-macario-madness}}");return pyBool(__left)?!pyContains(pyAt(record,"text"),"{{clue:"):__left;})())),"tests/play/test_jev_steps_report.py:396 assert \"{{clue:dooley-macario-madness}}\" in record[\"marked_text\"] and \"{{clue:\" not in record[\"text\"]");
rows=[(await executed("dooley-macario-madness",5,0.48)),(await executed("burning-eyes-form",5,0.91))];
steps=(await steps_of(tmp_path,rows,({[5]:record})));
assert.ok(pyBool(pyEqual([pyAt(steps,"executed"),pyAt(steps,"narrated")],[2,0])),"tests/play/test_jev_steps_report.py:399 assert (steps[\"executed\"], steps[\"narrated\"]) == (2, 0)");
assert.ok(pyBool(pyEqual(pyAt(steps,"neither"),[({["turn"]:5,["key"]:"consequence:clue_follow_up:burning-eyes-form",["confidence"]:0.91}),({["turn"]:5,["key"]:"consequence:clue_follow_up:dooley-macario-madness",["confidence"]:0.48})])),"tests/play/test_jev_steps_report.py:400 assert steps[\"neither\"] == [{\"turn\": 5, \"key\": \"consequence:clue_follow_up:burning-eyes-form\", \"confidence\": 0.91},\n                                {\"turn\": 5, \"key\": \"consequence:clue_follow_up:dooley-macario-madness\", \"confidence\": 0.48}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_known_real_case_an_executed_clue_the_prose_never_places_is_neither"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_known_real_case_an_executed_clue_the_prose_never_places_is_neither(temporary);});
export async function test_a_marker_for_another_handle_that_starts_with_this_one_is_not_a_marker_for_it(tmp_path:any){
let steps:any;
steps=(await steps_of(tmp_path,[(await executed("ledger",1))],({[1]:(await real_shaped_record("{{clue:ledger-book}} {{clue:ledgers}}",[]))})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(steps,"narrated"),0);return pyBool(__left)?pyEqual((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(steps,"neither"))){__rows.push(pyAt(item,"key"));}return __rows;})()),["consequence:clue_follow_up:ledger"]):__left;})())),"tests/play/test_jev_steps_report.py:406 assert steps[\"narrated\"] == 0 and [item[\"key\"] for item in steps[\"neither\"]] == [\"consequence:clue_follow_up:ledger\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_marker_for_another_handle_that_starts_with_this_one_is_not_a_marker_for_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_marker_for_another_handle_that_starts_with_this_one_is_not_a_marker_for_it(temporary);});
export async function test_a_step_that_cannot_be_checked_is_counted_as_such_never_as_narrated(tmp_path:any){
let rows:any,turns:any,steps:any;
rows=[(await executed("stranded",1)),(await executed("norecord",2)),(await executed("notext",3)),(await executed("plain",4))];
(await pyMethod(rows,"insert",[0,(await run_end(1,"failed"))],{}));
turns=({[1]:(await real_shaped_record("{{clue:stranded}}",["stranded"])),[3]:({["marked_text"]:"{{clue:notext}}",["rendered_text"]:"x"}),[4]:(await real_shaped_record("{{clue:plain}}",["plain"]))});
steps=(await steps_of(tmp_path,rows,turns));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(steps,"executed"),4);return pyBool(__left)?pyEqual(pyAt(steps,"narrated"),1):__left;})());return pyBool(__left)?pyEqual(pyAt(steps,"neither"),[]):__left;})())),"tests/play/test_jev_steps_report.py:416 assert steps[\"executed\"] == 4 and steps[\"narrated\"] == 1 and steps[\"neither\"] == []");
assert.ok(pyBool(pyEqual((await pyDict(pyAt(steps,"not_checkable"))),({["undelivered_turn"]:1,["no_turn_record"]:1,["no_text"]:1}))),"tests/play/test_jev_steps_report.py:417 assert dict(steps[\"not_checkable\"]) == {\"undelivered_turn\": 1, \"no_turn_record\": 1, \"no_text\": 1}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_step_that_cannot_be_checked_is_counted_as_such_never_as_narrated"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_step_that_cannot_be_checked_is_counted_as_such_never_as_narrated(temporary);});
export async function test_the_turn_is_the_one_telemetry_puts_the_run_on(tmp_path:any){
let no_turn:any,wrong_turn:any,rows:any,turns:any,steps:any;

no_turn=(await executed("ledger",3,undefined,({"run":"run-9"})));
delete no_turn["turn"];
wrong_turn=(await executed("diary",3,undefined,({"run":"run-9"})));
rows=[({["lane"]:"run",["event"]:"bind",["turn"]:9,["run"]:"run-9"}),no_turn,wrong_turn];
turns=({[3]:(await real_shaped_record("{{clue:diary}}{{clue:ledger}}",[])),[9]:(await real_shaped_record("{{clue:ledger}} only",["ledger","diary"]))});
steps=(await steps_of(tmp_path,rows,turns));
assert.ok(pyBool(pyEqual([pyAt(steps,"executed"),pyAt(steps,"narrated")],[2,1])),"tests/play/test_jev_steps_report.py:429 assert (steps[\"executed\"], steps[\"narrated\"]) == (2, 1)");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(steps,"neither"))){__rows.push(pyAt(item,"key"));}return __rows;})()),["consequence:clue_follow_up:diary"]);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(steps,"neither"),0),"turn"),9):__left;})())),"tests/play/test_jev_steps_report.py:430 assert [item[\"key\"] for item in steps[\"neither\"]] == [\"consequence:clue_follow_up:diary\"] and steps[\"neither\"][0][\"turn\"] == 9");
assert.ok(pyBool(pyEqual(pyAt(steps,"turn_mismatch"),1)),"tests/play/test_jev_steps_report.py:431 assert steps[\"turn_mismatch\"] == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_turn_is_the_one_telemetry_puts_the_run_on"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_turn_is_the_one_telemetry_puts_the_run_on(temporary);});
export async function test_only_executed_clue_rows_are_examined_and_a_row_written_twice_counts_once(tmp_path:any){
let rows:any,steps:any;
rows=[(await executed("ledger",1)),(await executed("ledger",1)),(await candidate("clue_follow_up","diary",1,true,false,undefined,({}))),(await candidate("time_cost","docks",1,true,false,undefined,({"executed":true,"shadow":false})))];
steps=(await steps_of(tmp_path,rows,({[1]:(await real_shaped_record("no markers",["ledger","diary"]))})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(steps,"executed"),1);return pyBool(__left)?pyEqual((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(steps,"neither"))){__rows.push(pyAt(item,"key"));}return __rows;})()),["consequence:clue_follow_up:ledger"]):__left;})())),"tests/play/test_jev_steps_report.py:439 assert steps[\"executed\"] == 1 and [item[\"key\"] for item in steps[\"neither\"]] == [\"consequence:clue_follow_up:ledger\"]");
assert.ok(pyBool(pyEqual((await pyDict(pyAt(steps,"other_classes"))),({["time_cost"]:1}))),"tests/play/test_jev_steps_report.py:440 assert dict(steps[\"other_classes\"]) == {\"time_cost\": 1}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_executed_clue_rows_are_examined_and_a_row_written_twice_counts_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_executed_clue_rows_are_examined_and_a_row_written_twice_counts_once(temporary);});
export async function test_the_section_prints_per_table_counts_reversed_as_not_available_and_lists_the_misses(tmp_path:any,capsys:any){
let rows:any,turns:any,out:any,agg:any;
rows=[(await executed("ledger",1,0.7)),(await executed("diary",2,0.5))];
turns=({[1]:(await real_shaped_record("{{clue:ledger}}",["ledger"])),[2]:(await real_shaped_record("nothing",["diary"]))});
(await write_campaign(pyDivide(pyDivide(pyDivide(tmp_path,"home"),".coc"),"campaigns"),"t",pyAdd(rows,[(await budget(1,10))]),turns));
assert.ok(pyBool(pyEqual((await pyMethod(report,"main",[["jev-steps-report.py",(await pyStr(pyDivide(tmp_path,"home")))]],{})),0)),"tests/play/test_jev_steps_report.py:447 assert report.main([\"jev-steps-report.py\", str(tmp_path / \"home\")]) == 0");
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyContains(out,"-- executed steps not in the prose")),"tests/play/test_jev_steps_report.py:449 assert \"-- executed steps not in the prose\" in out");
assert.ok(pyBool(pyContains(out,"reversed: n/a -- no receipt kind reverses a clue")),"tests/play/test_jev_steps_report.py:450 assert \"reversed: n/a -- no receipt kind reverses a clue\" in out");
assert.ok(pyBool(pyContains(out,"h1:t: executed 2, narrated 1, reversed n/a, neither 1")),"tests/play/test_jev_steps_report.py:451 assert \"h1:t: executed 2, narrated 1, reversed n/a, neither 1\" in out");
assert.ok(pyBool(pyContains(out,"neither: turn 2 key='consequence:clue_follow_up:diary' confidence=0.5")),"tests/play/test_jev_steps_report.py:452 assert \"neither: turn 2 key='consequence:clue_follow_up:diary' confidence=0.5\" in out");
assert.ok(pyBool(pyContains(out,"totals: 2 executed clue steps over 1 tables; narrated 1; reversed n/a; neither 1; not checkable 0")),"tests/play/test_jev_steps_report.py:453 assert \"totals: 2 executed clue steps over 1 tables; narrated 1; reversed n/a; neither 1; not checkable 0\" in out");
agg=(await pyMethod(report,"aggregate",[(await resolve(pyDivide(tmp_path,"home")))],{}));
assert.ok(pyBool(pyEqual(pyAt(agg,"executed_steps"),({["tables"]:1,["executed"]:2,["narrated"]:1,["neither"]:1,["not_checkable"]:0}))),"tests/play/test_jev_steps_report.py:455 assert agg[\"executed_steps\"] == {\"tables\": 1, \"executed\": 2, \"narrated\": 1, \"neither\": 1, \"not_checkable\": 0}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_section_prints_per_table_counts_reversed_as_not_available_and_lists_the_misses"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_section_prints_per_table_counts_reversed_as_not_available_and_lists_the_misses(temporary,captureOutput(t));});
