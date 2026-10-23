// Migrated from tests/kernel/test_fast_guidance.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {bind,request,claim,observed,write,finish,opening,handle_of,confirmed_investigator,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
import {profile} from "./setup-drafts.test.ts";
const __file__=new URL('../../tests/kernel/test_fast_guidance.py',import.meta.url).pathname;







export let KEY:any=pyMultiply("a",64);
export async function seed(client:any,tmp_path:any){
let mid:any,_:any,job:any,work:any,draft:any,guidance:any,review:any;
const __unpack337=(await pyInvoke(bind,[client,tmp_path],{}));mid=__unpack337[0];_=__unpack337[1];
(await pyInvoke(request,[client,mid,"guidance"],{"guidance_key":KEY,"play_language":"en","occupations":[]}));
job=(await pyInvoke(claim,[client,mid],{}));
(await pyInvoke(observed,[job],{}));
work=(await pyInvoke(Path,[pyAt(job,"work_dir")],{}));
draft=({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["source_refs"]:[({["page"]:1})],["properties"]:({["is_entrance"]:true})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:[]});
guidance=({["opening"]:"At the dock, who are you?",["advice"]:"Public source premise.",["scene"]:"Dock",["guide"]:"",["handoff"]:"Continue the meeting."});
(await pyInvoke(write,[pyDivide(work,"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide(work,"guidance.json"),guidance],{}));
review=({["checked"]:[({["path"]:"/nodes/0",["source_refs"]:[({["page"]:1})],["verdict"]:"supported"})],["missing"]:[],["guidance"]:({["approved"]:true,["issues"]:[],["draft_sha256"]:(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((pyDivide(work,"draft.json")),"read_bytes",[],{}))],{})),"hexdigest",[],{})),["guidance_sha256"]:(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((pyDivide(work,"guidance.json")),"read_bytes",[],{}))],{})),"hexdigest",[],{}))})});
(await pyInvoke(write,[pyDivide(work,"review.json"),review],{}));
return [mid,job,draft,guidance,review];
}
Object.defineProperty(seed,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
export async function refuse(client:any,job:any){
let work:any;
work=(await pyInvoke(Path,[pyAt(job,"work_dir")],{}));
return (await pyMethod(client,"err",["module.read.finish",({["module_id"]:pyAt(job,"module_id"),["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide(work,"draft.json")],{})),["review_path"]:(await pyInvoke(pyStr,[pyDivide(work,"review.json")],{}))})],{}));
}
Object.defineProperty(refuse,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"job","rest":false,"varargs":false}]});
export async function test_guidance_opens_setup_but_not_world_or_play_and_preserves_confirmation(kernel:any,tmp_path:any){
let mid:any,job:any,_:any,directory:any,mods:any,confirmed:any,error:any,ready_job:any,result:any,world:any,meta:any,reused:any;
const __unpack1928=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack1928[0];job=__unpack1928[1];_=__unpack1928[2];_=__unpack1928[3];_=__unpack1928[4];
assert.ok(pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"setup_ready")),"tests/kernel/test_fast_guidance.py:43 assert finish(kernel, job)[\"setup_ready\"]");
assert.ok(pyBool(!pyBool(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"opening_ready"))),"tests/kernel/test_fast_guidance.py:44 assert not kernel.ok(\"module.status\", {\"module_id\": mid})[\"opening_ready\"]");
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"early",["module"]:mid,["guidance_key"]:KEY,["play_language"]:"en"})],{}));
directory=pyDivide(kernel.workspace,".coc/campaigns/early");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(directory,"world.json")),"exists",[],{})))),"tests/kernel/test_fast_guidance.py:47 assert not (directory / \"world.json\").exists()");
mods=(await pyMethod(kernel,"ok",["mods.list",({["campaign"]:"early"})],{}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(mods,"mods"))){__rows.push(pyEqual(pyAt(r,"id"),"natural-npc"));}return __rows;})())))),"tests/kernel/test_fast_guidance.py:49 assert any(r[\"id\"] == \"natural-npc\" for r in mods[\"mods\"])");
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:"early",["id"]:"natural-npc",["enabled"]:false})],{}));
(await pyMethod(kernel,"ok",["setup.prologue",({["campaign"]:"early",["scene"]:"Dock",["text"]:"Who are you?"})],{}));
confirmed=(await pyInvoke(confirmed_investigator,[kernel,"early"],{}));
error=(await pyMethod(kernel,"err",["setup.complete",({["campaign"]:"early"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"reason"),"opening_preparing")),"tests/kernel/test_fast_guidance.py:54 assert error[\"details\"][\"reason\"] == \"opening_preparing\"");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(directory,"world.json")),"exists",[],{})))),"tests/kernel/test_fast_guidance.py:55 assert not (directory / \"world.json\").exists()");
const __unpack2856=(await pyInvoke(opening,[kernel,mid],{}));ready_job=__unpack2856[0];_=__unpack2856[1];_=__unpack2856[2];
(await pyInvoke(finish,[kernel,ready_job],{}));
result=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"early"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"prologue"),"opening"),"Who are you?")),"tests/kernel/test_fast_guidance.py:59 assert result[\"prologue\"][\"opening\"] == \"Who are you?\"");
assert.ok(pyBool(!pyContains(pyAt(result,"reading"),"way_on")),pyStr("an opening with a way on asks for no repair"));
world=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(directory,"world.json")),"read_text",[],{}))],{}));
meta=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(directory,"campaign.json")),"read_text",[],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(meta,"setup"),"confirmed_revision"),pyAt(confirmed,"revision"))),"tests/kernel/test_fast_guidance.py:63 assert meta[\"setup\"][\"confirmed_revision\"] == confirmed[\"revision\"]");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"early"})],{})),"replayed")),"tests/kernel/test_fast_guidance.py:64 assert kernel.ok(\"setup.complete\", {\"campaign\": \"early\"})[\"replayed\"]");
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:"early"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(world,"npc_presence"),(await pyInvoke(handle_of,[kernel,"early","Lena"],{}))),(await pyInvoke(handle_of,[kernel,"early","Dock"],{})))),"tests/kernel/test_fast_guidance.py:67 assert world[\"npc_presence\"][handle_of(kernel, \"early\", \"Lena\")] == handle_of(kernel, \"early\", \"Dock\")");
mods=(await pyMethod(kernel,"ok",["mods.list",({["campaign"]:"early"})],{}));
assert.ok(pyBool((pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(mods,"mods"))){if(pyBool(pyEqual(pyAt(r,"id"),"natural-npc"))){__rows.push(r);}}return __rows;})()))),"active"),"enabled")===false)),"tests/kernel/test_fast_guidance.py:69 assert next(r for r in mods[\"mods\"] if r[\"id\"] == \"natural-npc\")[\"active\"][\"enabled\"] is False");
reused=(await pyInvoke(request,[kernel,mid,"guidance"],{"guidance_key":KEY,"play_language":"en","occupations":[]}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(reused,"setup_ready");return pyBool(__left)?pyEqual(pyAt(reused,"generation"),2):__left})())),"tests/kernel/test_fast_guidance.py:71 assert reused[\"setup_ready\"] and reused[\"generation\"] == 2");
}
Object.defineProperty(test_guidance_opens_setup_but_not_world_or_play_and_preserves_confirmation,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_guidance_opens_setup_but_not_world_or_play_and_preserves_confirmation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_guidance_opens_setup_but_not_world_or_play_and_preserves_confirmation(await kernel(t,{}),temporary);});
export async function test_the_start_scene_seats_its_own_cast_before_any_other_scene_claims_them(kernel:any,tmp_path:any){
let mid:any,guidance_job:any,_:any,job:any,refs:any,nodes:any,claims:any,paths:any,world:any,dock:any;

const __unpack4654=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack4654[0];guidance_job=__unpack4654[1];_=__unpack4654[2];_=__unpack4654[3];_=__unpack4654[4];
assert.ok(pyBool(pyAt((await pyInvoke(finish,[kernel,guidance_job],{})),"setup_ready")),"tests/kernel/test_fast_guidance.py:84 assert finish(kernel, guidance_job)[\"setup_ready\"]");
(await pyInvoke(request,[kernel,mid,"opening"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
assert.ok(pyBool(pyEqual(pyAt(job,"purpose"),"opening")),"tests/kernel/test_fast_guidance.py:87 assert job[\"purpose\"] == \"opening\"");
(await pyInvoke(observed,[job],{}));
refs=[({["page"]:1})];
nodes=[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["source_refs"]:refs,["properties"]:({["is_entrance"]:true})}),({["node_id"]:"scene-attic",["node_kind"]:"scene",["name"]:"Attic",["source_refs"]:[({["page"]:2})],["summary"]:"A loft over the harbor.",["properties"]:({["is_final"]:true})}),({["node_id"]:"npc-lena",["node_kind"]:"npc",["name"]:"Lena",["source_refs"]:refs,["properties"]:({["mechanics"]:({["profile"]:({["characteristics"]:({["STR"]:50})})})})})];
claims=(await (async()=>{const __rows:any[]=[];for(const [a,r,b] of pyIterable([["scene-dock","route-to","scene-attic"],["npc-lena","present-in","scene-attic"],["npc-lena","present-in","scene-dock"]])){__rows.push(({["subject_id"]:a,["predicate"]:r,["object"]:({["node_id"]:b}),["truth_status"]:"authored-fact",["source_refs"]:refs}));}return __rows;})());
paths=["/nodes/0","/nodes/1","/nodes/2","/nodes/2/properties/mechanics/profile/characteristics/STR","/claims/0","/claims/1","/claims/2","/coverage"];
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:nodes,["claims"]:claims,["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-dock","npc-lena"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["missing"]:[],["checked"]:(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(paths)){__rows.push(({["path"]:p,["verdict"]:"supported",["source_refs"]:refs,["reason"]:"fixture support"}));}return __rows;})())})],{}));
(await pyInvoke(finish,[kernel,job],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"seated",["module"]:mid,["guidance_key"]:KEY,["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.prologue",({["campaign"]:"seated",["scene"]:"Dock",["text"]:"Who are you?"})],{}));
(await pyInvoke(confirmed_investigator,[kernel,"seated"],{}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"seated"})],{}));
world=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(kernel.workspace,".coc/campaigns/seated/world.json")),"read_text",[],{}))],{}));
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:"seated"})],{}));
dock=(await pyInvoke(handle_of,[kernel,"seated","Dock"],{}));
assert.ok(pyBool(pyEqual(pyAt(world,"active_scene"),dock)),"tests/kernel/test_fast_guidance.py:121 assert world[\"active_scene\"] == dock");
assert.ok(pyBool(pyEqual(pyAt(pyAt(world,"npc_presence"),(await pyInvoke(handle_of,[kernel,"seated","Lena"],{}))),dock)),"tests/kernel/test_fast_guidance.py:124 assert world[\"npc_presence\"][handle_of(kernel, \"seated\", \"Lena\")] == dock");
}
Object.defineProperty(test_the_start_scene_seats_its_own_cast_before_any_other_scene_claims_them,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_start_scene_seats_its_own_cast_before_any_other_scene_claims_them"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_start_scene_seats_its_own_cast_before_any_other_scene_claims_them(await kernel(t,{}),temporary);});
export async function test_review_binds_both_files_and_requires_source_support(kernel:any,tmp_path:any){
let mid:any,job:any,draft:any,guidance:any,review:any,work:any,bad:any;
const __unpack7695=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack7695[0];job=__unpack7695[1];draft=__unpack7695[2];guidance=__unpack7695[3];review=__unpack7695[4];
work=(await pyInvoke(Path,[pyAt(job,"work_dir")],{}));
(await pyInvoke(write,[pyDivide(work,"guidance.json"),({...guidance,["opening"]:"Altered after review"})],{}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(refuse,[kernel,job],{})),"message"),"exact")),"tests/kernel/test_fast_guidance.py:131 assert \"exact\" in refuse(kernel, job)[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"generation"),0)),"tests/kernel/test_fast_guidance.py:132 assert kernel.ok(\"module.status\", {\"module_id\": mid})[\"generation\"] == 0");
(await pyInvoke(write,[pyDivide(work,"guidance.json"),guidance],{}));
bad=(await pyMethod(copy,"deepcopy",[review],{}));
bad["checked"]=[];
(await pyInvoke(write,[pyDivide(work,"review.json"),bad],{}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(refuse,[kernel,job],{})),"message"),"omitted")),"tests/kernel/test_fast_guidance.py:137 assert \"omitted\" in refuse(kernel, job)[\"message\"]");
(await pyInvoke(write,[pyDivide(work,"review.json"),review],{}));
draft["ready_nodes"]=["scene-dock"];
(await pyInvoke(write,[pyDivide(work,"draft.json"),draft],{}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(refuse,[kernel,job],{})),"message"),"cannot grant")),"tests/kernel/test_fast_guidance.py:141 assert \"cannot grant\" in refuse(kernel, job)[\"message\"]");
}
Object.defineProperty(test_review_binds_both_files_and_requires_source_support,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_review_binds_both_files_and_requires_source_support"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_review_binds_both_files_and_requires_source_support(await kernel(t,{}),temporary);});
export async function test_campaign_cannot_pin_an_unaccepted_or_different_language_guidance(kernel:any,tmp_path:any){
let mid:any,job:any,_:any,params:any;
const __unpack8471=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack8471[0];job=__unpack8471[1];_=__unpack8471[2];_=__unpack8471[3];_=__unpack8471[4];
params=({["id"]:"early",["module"]:mid,["guidance_key"]:KEY,["play_language"]:"en"});
assert.ok(pyBool(pyContains(pyAt((await pyMethod(kernel,"err",["campaign.create",params],{})),"message"),"not been accepted")),"tests/kernel/test_fast_guidance.py:147 assert \"not been accepted\" in kernel.err(\"campaign.create\", params)[\"message\"]");
(await pyInvoke(finish,[kernel,job],{}));
// §261 (2026-10-23): a guidance accepted for another play_language is refused naming the language it was accepted for.
assert.ok(pyBool(pyContains(pyAt((await pyMethod(kernel,"err",["campaign.create",({...params,["play_language"]:"zh-Hans"})],{})),"message"),"is for play_language")),"tests/kernel/test_fast_guidance.py:149 the accepted guidance names its own play_language");
}
Object.defineProperty(test_campaign_cannot_pin_an_unaccepted_or_different_language_guidance,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_campaign_cannot_pin_an_unaccepted_or_different_language_guidance"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_campaign_cannot_pin_an_unaccepted_or_different_language_guidance(await kernel(t,{}),temporary);});
export async function test_explicit_opening_does_not_reuse_another_prepared_scene(kernel:any,tmp_path:any){
let mid:any,job:any,draft:any,_:any,review:any,ready:any,result:any;
const __unpack8913=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack8913[0];job=__unpack8913[1];draft=__unpack8913[2];_=__unpack8913[3];review=__unpack8913[4];
(await pyInvoke(finish,[kernel,job],{}));
const __unpack8993=(await pyInvoke(opening,[kernel,mid],{}));ready=__unpack8993[0];_=__unpack8993[1];_=__unpack8993[2];
(await pyInvoke(finish,[kernel,ready],{}));
result=(await pyInvoke(request,[kernel,mid,"opening"],{"focus":"Another entrance","foreground":true}));
assert.ok(pyBool(pyEqual(pyAt(result,"state"),"queued")),"tests/kernel/test_fast_guidance.py:158 assert result[\"state\"] == \"queued\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(claim,[kernel,mid],{})),"focus"),"Another entrance")),"tests/kernel/test_fast_guidance.py:159 assert claim(kernel, mid)[\"focus\"] == \"Another entrance\"");
}
Object.defineProperty(test_explicit_opening_does_not_reuse_another_prepared_scene,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_explicit_opening_does_not_reuse_another_prepared_scene"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_explicit_opening_does_not_reuse_another_prepared_scene(await kernel(t,{}),temporary);});
export async function test_ambiguous_guidance_publishes_choices_without_authorizing_character_creation(kernel:any,tmp_path:any){
let mid:any,job:any,draft:any,_:any,review:any,work:any,result:any,retry:any;
const __unpack9352=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack9352[0];job=__unpack9352[1];draft=__unpack9352[2];_=__unpack9352[3];review=__unpack9352[4];
work=(await pyInvoke(Path,[pyAt(job,"work_dir")],{}));
(await pyMethod(pyAt(draft,"nodes"),"append",[({["node_id"]:"scene-garden",["node_kind"]:"scene",["name"]:"Garden",["source_refs"]:[({["page"]:2})],["properties"]:({["is_entrance"]:true})})],{}));
(await pyInvoke(write,[pyDivide(work,"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide(work,"guidance.json"),({["needs_choice"]:true})],{}));
(await pyMethod(pyAt(review,"checked"),"append",[({["path"]:"/nodes/1",["source_refs"]:[({["page"]:2})],["verdict"]:"supported"})],{}));
(await pyMethod(pyAt(review,"guidance"),"update",[],{"draft_sha256":(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((pyDivide(work,"draft.json")),"read_bytes",[],{}))],{})),"hexdigest",[],{})),"guidance_sha256":(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((pyDivide(work,"guidance.json")),"read_bytes",[],{}))],{})),"hexdigest",[],{}))}));
(await pyInvoke(write,[pyDivide(work,"review.json"),review],{}));
result=(await pyInvoke(finish,[kernel,job],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"state"),"blocked");return pyBool(__left)?!pyBool(pyAt(result,"setup_ready")):__left})())),"tests/kernel/test_fast_guidance.py:174 assert result[\"state\"] == \"blocked\" and not result[\"setup_ready\"]");
retry=(await pyInvoke(request,[kernel,mid,"guidance"],{"guidance_key":KEY,"play_language":"en","occupations":[]}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(pyAt(pyAt(retry,"opening"),"choice"),"candidates")],{})),2)),"tests/kernel/test_fast_guidance.py:176 assert len(retry[\"opening\"][\"choice\"][\"candidates\"]) == 2");
}
Object.defineProperty(test_ambiguous_guidance_publishes_choices_without_authorizing_character_creation,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ambiguous_guidance_publishes_choices_without_authorizing_character_creation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ambiguous_guidance_publishes_choices_without_authorizing_character_creation(await kernel(t,{}),temporary);});
export async function test_authored_era_prose_uses_the_rulebook_default_without_losing_the_setting(kernel:any,tmp_path:any){
let mid:any,job:any,draft:any,_:any,review:any,work:any,request:any,sheet:any;

const __unpack10463=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack10463[0];job=__unpack10463[1];draft=__unpack10463[2];_=__unpack10463[3];review=__unpack10463[4];
work=(await pyInvoke(Path,[pyAt(job,"work_dir")],{}));
pyAt(pyAt(pyAt(draft,"nodes"),0),"properties")["investigator_setup"]=({["era"]:"An expedition in March 1921"});
(await pyInvoke(write,[pyDivide(work,"draft.json"),draft],{}));
pyAt(review,"guidance")["draft_sha256"]=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((pyDivide(work,"draft.json")),"read_bytes",[],{}))],{})),"hexdigest",[],{}));
(await pyInvoke(write,[pyDivide(work,"review.json"),review],{}));
(await pyInvoke(finish,[kernel,job],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"era-choice",["module"]:mid,["guidance_key"]:KEY,["play_language"]:"en"})],{}));
request=({["campaign"]:"era-choice",["profile"]:(await pyInvoke(profile,[],{}))});
sheet=pyAt((await pyMethod(kernel,"ok",["setup.draft",request],{})),"sheet");
assert.ok(pyBool(pyEqual(pyAt(sheet,"era"),"1920s")),"tests/kernel/test_fast_guidance.py:191 assert sheet[\"era\"] == \"1920s\"");
assert.ok(pyBool(pyEqual(pyAt(sheet,"setting_era"),"An expedition in March 1921")),"tests/kernel/test_fast_guidance.py:192 assert sheet[\"setting_era\"] == \"An expedition in March 1921\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(sheet,"finance"),"source"),"cash-assets.periods.1920s")),"tests/kernel/test_fast_guidance.py:193 assert sheet[\"finance\"][\"source\"] == \"cash-assets.periods.1920s\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(sheet,"finance"),"substituted_for"),"An expedition in March 1921")),"tests/kernel/test_fast_guidance.py:194 assert sheet[\"finance\"][\"substituted_for\"] == \"An expedition in March 1921\"");
}
Object.defineProperty(test_authored_era_prose_uses_the_rulebook_default_without_losing_the_setting,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_authored_era_prose_uses_the_rulebook_default_without_losing_the_setting"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_authored_era_prose_uses_the_rulebook_default_without_losing_the_setting(await kernel(t,{}),temporary);});
export async function test_an_opening_published_ready_stays_ready_under_a_later_rule(kernel:any,tmp_path:any){
let mid:any,job:any,_:any,ready_job:any,index_job:any,module_dir:any,meta:any,graph_path:any,graph:any,manifest_path:any,manifest:any,done:any,private_dir:any,private_queue:any,shared_queue:any,dock:any,reading:any;

const __unpack11683=(await pyInvoke(seed,[kernel,tmp_path],{}));mid=__unpack11683[0];job=__unpack11683[1];_=__unpack11683[2];_=__unpack11683[3];_=__unpack11683[4];
(await pyInvoke(finish,[kernel,job],{}));
const __unpack11754=(await pyInvoke(opening,[kernel,mid],{}));ready_job=__unpack11754[0];_=__unpack11754[1];_=__unpack11754[2];
assert.ok(pyBool(pyAt((await pyInvoke(finish,[kernel,ready_job],{})),"opening_ready")),"tests/kernel/test_fast_guidance.py:204 assert finish(kernel, ready_job)[\"opening_ready\"]");
(await pyInvoke(request,[kernel,mid,"index"],{}));
index_job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[index_job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(index_job,"work_dir")],{})),"draft.json"),({["title"]:"Book",["language"]:"en",["sections"]:[({["name"]:"The harbor",["pages"]:[[1,2]]})]})],{}));
(await pyInvoke(finish,[kernel,index_job],{}));
module_dir=pyDivide(pyDivide(kernel.workspace,".coc/modules"),mid);
meta=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(module_dir,"module.json")),"read_text",[],{}))],{}));
graph_path=pyDivide(module_dir,pyAt(meta,"graph_file"));
graph=(await pyMethod(json,"loads",[(await pyMethod(graph_path,"read_text",[],{}))],{}));
graph["relations"]=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyMethod(graph,"get",["relations",[]],{})))){if(pyBool(!pyEqual((await pyMethod(r,"get",["relation_kind"],{})),"route-to"))){__rows.push(r);}}return __rows;})());
graph["claims"]=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable((await pyMethod(graph,"get",["claims",[]],{})))){if(pyBool(!pyEqual((await pyMethod(c,"get",["predicate"],{})),"route-to"))){__rows.push(c);}}return __rows;})());
(await pyMethod(graph_path,"write_text",[(await pyMethod(json,"dumps",[graph],{}))],{"encoding":"utf-8"}));
manifest_path=pyDivide(graph_path.parent,"module-graph-manifest.json");
manifest=(await pyMethod(json,"loads",[(await pyMethod(manifest_path,"read_text",[],{}))],{}));
manifest["graph_content_digest"]=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((await pyMethod(json,"dumps",[graph],{"sort_keys":true,"separators":[",",":"]})),"encode",[],{}))],{})),"hexdigest",[],{}));
const __unpack12965=[(await pyInvoke(pyLen,[(await pyMethod(graph,"get",["relations",[]],{}))],{})),(await pyInvoke(pyLen,[(await pyMethod(graph,"get",["claims",[]],{}))],{}))];manifest["relation_count"]=__unpack12965[0];manifest["claim_count"]=__unpack12965[1];
(await pyMethod(manifest_path,"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
meta["graph_digest"]=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(graph_path,"read_bytes",[],{}))],{})),"hexdigest",[],{}));
(await pyInvoke(write,[pyDivide(module_dir,"module.json"),meta],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"opening"],{"focus":"Dock"})),"state"),"ready")),"tests/kernel/test_fast_guidance.py:225 assert request(kernel, mid, \"opening\", focus=\"Dock\")[\"state\"] == \"ready\"");
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"installed",["module"]:mid,["guidance_key"]:KEY,["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.prologue",({["campaign"]:"installed",["scene"]:"Dock",["text"]:"Who are you?"})],{}));
(await pyInvoke(confirmed_investigator,[kernel,"installed"],{}));
done=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"installed"})],{}));
assert.ok(pyBool(pyEqual(pyAt(done,"module_id"),mid)),"tests/kernel/test_fast_guidance.py:230 assert done[\"module_id\"] == mid");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(done,"reading"),"way_on"),"state"),"queued")),"tests/kernel/test_fast_guidance.py:232 assert done[\"reading\"][\"way_on\"][\"state\"] == \"queued\"");
private_dir=pyDivide(pyDivide(kernel.workspace,".coc/module-campaigns/installed/modules"),mid);
assert.ok(pyBool((await pyMethod((pyDivide(private_dir,"module.json")),"exists",[],{}))),"tests/kernel/test_fast_guidance.py:236 assert (private_dir / \"module.json\").exists()");
private_queue=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(private_dir,"deepen-queue.json")),"read_text",[],{}))],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(private_queue)){__rows.push([pyAt(row,"purpose"),(await pyMethod(row,"get",["repair"],{})),pyAt(row,"focus"),pyAt(row,"state")]);}return __rows;})()),[["opening","way_on","dock","queued"]])),"tests/kernel/test_fast_guidance.py:238 assert [(row[\"purpose\"], row.get(\"repair\"), row[\"focus\"], row[\"state\"]) for row in private_queue] == [\n        (\"opening\", \"way_on\", \"dock\", \"queued\")]");
assert.ok(pyBool(pyAt(pyAt(private_queue,0),"resume_from")),"tests/kernel/test_fast_guidance.py:240 assert private_queue[0][\"resume_from\"]");
shared_queue=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(module_dir,"deepen-queue.json")),"read_text",[],{}))],{}));
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(shared_queue)){if(pyBool(pyEqual(pyAt(row,"state"),"queued"))){__rows.push(row);}}return __rows;})()))),"tests/kernel/test_fast_guidance.py:242 assert not [row for row in shared_queue if row[\"state\"] == \"queued\"]");
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:"installed"})],{}));
dock=(await pyInvoke(handle_of,[kernel,"installed","Dock"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(done,"reading"),"way_on"),"scene"),dock)),"tests/kernel/test_fast_guidance.py:247 assert done[\"reading\"][\"way_on\"][\"scene\"] == dock");
assert.ok(pyBool(pyEqual(pyAt(pyAt(done,"reading"),"ahead"),({["queued"]:[pyAt(pyAt(private_queue,0),"job_id")],["scene"]:dock,["way_on"]:pyAt(pyAt(done,"reading"),"way_on"),["window"]:({["mode"]:"whole",["first"]:1,["last"]:2,["chapters"]:[],["complete"]:false,["transcript"]:[[1,2]]})}))),"tests/kernel/test_fast_guidance.py:249 assert done[\"reading\"][\"ahead\"] == {\n        \"queued\": [private_queue[0][\"job_id\"]],\n        \"scene\": dock,\n        \"way_on\": done[\"reading\"][\"way_on\"],\n        \"window\": {\"mode\": \"whole\", \"first\": 1, \"last\": 2, \"chapters\": [], \"complete\": False, \"transcript\": [[1, 2]]},\n    }");
reading=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:"installed"})],{})),"reading");
assert.ok(pyBool((pyAt(reading,"index_complete")===true)),"tests/kernel/test_fast_guidance.py:256 assert reading[\"index_complete\"] is True");
assert.ok(pyBool(pyEqual(pyAt(reading,"sections"),[({["name"]:"The harbor",["pages"]:[[1,2]],["read"]:false})])),pyStr("viewed opening pages do not claim that the indexed section was prepared"));
}
Object.defineProperty(test_an_opening_published_ready_stays_ready_under_a_later_rule,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_opening_published_ready_stays_ready_under_a_later_rule"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_opening_published_ready_stays_ready_under_a_later_rule(await kernel(t,{}),temporary);});
