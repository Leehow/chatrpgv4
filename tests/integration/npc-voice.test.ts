// Migrated from tests/kernel/test_voice.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,PREGEN,WORKTREE,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,read_jsonl,pyObjectFromEntries,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {built_module,played,table_npcs} from "./world-mod-vocabulary.test.ts";






export let KNOTT:any="Steven Knott";
export let KNOTT_HANDLE:any="steven-knott";
export let KNOTT_ID:any="npc-steven-knott";
export let MOD:any="npc-voice";
export let EXPRESSION:any="narration-craft";
export let VERSION:any=pyAt((await read_json(pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"npc-voice"),"mod.json"))),"version");
export let SHIPPED:any=pyAt(pyAt(pyAt((await read_json(pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"npc-voice"),"mod.json"))),"contributes"),"vocabulary"),"actor_profile_keys");
export let MASK:any=({["key"]:"voice_mask",["label"]:"mask",["shape"]:"lines",["ask"]:pyAt(pyAt(SHIPPED,0),"ask")});
export let EXCHANGES:any=({["key"]:"exchanges",["label"]:"in exchange",["shape"]:"lines",["ask"]:pyAt(pyAt(SHIPPED,1),"ask")});
export let VOICE:any=({["mask"]:"自称「鄙人」，管人叫「先生」，句尾爱带「这个嘛」。",["exchanges"]:["你是房东？ → 鄙人正是，先生找房子？","雨真大。 → 这个嘛，雨大房子更难租，先生您说是不是。","那房子闹鬼？ → 先生，鄙人只管收租，这个嘛……先看纸再说。"]});
export async function package_value(tmp_path:any,vocabulary:any=MASK,name:any="voice-fixture"){
let path:any,manifest:any,check:any;

path=pyDivide(tmp_path,`package-${name}`);
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),"natural-npc"),path],{}));
manifest=(await read_json(pyDivide(path,"mod.json")));
manifest["id"]=name;
manifest["version"]="0.0.1";
manifest["default_enabled"]=false;
pyAt(manifest,"contributes")["vocabulary"]=({["actor_profile_keys"]:[vocabulary]});
for(check of pyIterable(pyAt(pyAt(manifest,"contributes"),"checks"))){
check["name"]=`${name}:first-impression`;
}
pyAt(manifest,"contributes")["audit_on_decisions"]=[`${name}:first-impression`];
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{}));
return path;
}
export async function configure(client:any,change:any={}){
let enabled:any;

enabled=(await pyMethod(change,"get",["enabled",true],{}));
if(pyBool(enabled)){(await pyMethod(client,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:EXPRESSION,["enabled"]:false})],{}));}
return (await pyMethod(client,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:MOD,["version"]:VERSION,["enabled"]:true,...change})],{}));
}
export async function on(client:any){

(await create_campaign(client));
(await configure(client));
(await narrate_opening(client));
return pyAt((await pyMethod(client,"table",["player_input"],{"text":"我仔细观察诺特。"})),"capsule");
}
export async function settle(client:any,call_id:any="t1-c1"){
return (await narrate(client,call_id,"诺特没有说话。"));
}
export async function job(client:any,params:any={}){
return (await pyMethod(client,"ok",["voice.job",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function submit(client:any,job_id:any,voice:any){
return (await pyMethod(client,"ok",["voice.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["voice"]:voice})],{}));
}
export async function submit_err(client:any,job_id:any,voice:any){
return (await pyMethod(client,"err",["voice.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["voice"]:voice})],{}));
}
export async function present(client:any){
return pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc"})),"present"))){__rows.push([pyAt(p,"name"),p]);}return __rows;})()));
}
export async function test_the_shape_is_checked_at_install(kernel:any,tmp_path:any){
let error:any;
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyStr((await package_value(tmp_path,({...MASK,["key"]:"verses",["shape"]:"poem"}),undefined))))})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"shape"):__left})())),"tests/kernel/test_voice.py:84 assert error[\"code\"] == \"invalid_params\" and \"shape\" in error[\"message\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_shape_is_checked_at_install"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_shape_is_checked_at_install(await kernel(t,{}),temporary);});
export async function test_the_shipped_package_declares_the_two_words_the_lane_writes(kernel:any){
let manifest:any;
manifest=(await read_json(pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"npc-voice"),"mod.json")));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(manifest,"default_enabled")===false);return pyBool(__left)?pyEqual(pyAt(manifest,"superseded_by"),"narration-craft"):__left})())),"tests/kernel/test_voice.py:89 assert manifest[\"default_enabled\"] is False and manifest[\"superseded_by\"] == \"narration-craft\"");
assert.ok(pyBool(pyEqual(pyAt(manifest,"settings"),({["coarse_language"]:true}))),"tests/kernel/test_voice.py:90 assert manifest[\"settings\"] == {\"coarse_language\": True}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(manifest,"contributes"),"vocabulary"),"actor_profile_keys"),[MASK,EXCHANGES])),"tests/kernel/test_voice.py:91 assert manifest[\"contributes\"][\"vocabulary\"][\"actor_profile_keys\"] == [MASK, EXCHANGES]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_shipped_package_declares_the_two_words_the_lane_writes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_shipped_package_declares_the_two_words_the_lane_writes(await kernel(t,{}));});
export async function test_nobody_needs_a_voice_while_the_package_is_off(kernel:any){
(await create_campaign(kernel));
(await narrate_opening(kernel));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:EXPRESSION,["enabled"]:false})],{}));
(await configure(kernel,({"enabled":false})));
(await pyMethod(kernel,"table",["player_input"],{"text":"我仔细观察诺特。"}));
assert.ok(pyBool(pyEqual((await job(kernel)),({["job_id"]:null}))),"tests/kernel/test_voice.py:100 assert job(kernel) == {\"job_id\": None}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_nobody_needs_a_voice_while_the_package_is_off"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_nobody_needs_a_voice_while_the_package_is_off(await kernel(t,{}));});
export async function test_the_packet_is_closed_and_names_the_person_by_handle(kernel:any){
let packet:any,lock:any;
(await on(kernel));
packet=(await job(kernel));
lock=pyAt(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"mods"),"active"),MOD);
assert.ok(pyBool(pyEqual(pyAt(packet,"generation"),pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["version","digest","state_version"])){__rows.push([key,pyAt(lock,key)]);}return __rows;})())))),"tests/kernel/test_voice.py:107 assert packet[\"generation\"] == {key: lock[key] for key in (\"version\", \"digest\", \"state_version\")}");
assert.ok(pyBool(pyEqual(pyAt(packet,"job_id"),`voice:${CAMPAIGN}:${pyAt(pyAt(packet,"npc"),"handle")}@${pyAt(lock,"digest")}`)),"tests/kernel/test_voice.py:108 assert packet[\"job_id\"] == f\"voice:{CAMPAIGN}:{packet['npc']['handle']}@{lock['digest']}\"");
assert.ok(pyBool(pyEqual((await pySet(packet)),new Set(["job_id","generation","play_language","module","coarse_language","npc","documents","taken_masks","said","budget","instruction","investigator"]))),"tests/kernel/test_voice.py:109 assert set(packet) == {\"job_id\", \"generation\", \"play_language\", \"module\", \"coarse_language\", \"npc\", \"documents\", \"taken_masks\", \"said\", \"budget\", \"instruction\", \"investigator\"}");
assert.ok(pyBool(pyEqual(pyAt(packet,"said"),[])),"tests/kernel/test_voice.py:110 assert packet[\"said\"] == []");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"play_language"),"zh-Hans");return pyBool(__left)?(pyAt(packet,"coarse_language")===true):__left})())),"tests/kernel/test_voice.py:111 assert packet[\"play_language\"] == \"zh-Hans\" and packet[\"coarse_language\"] is True");
assert.ok(pyBool(pyEqual(pyAt(packet,"budget"),({["mask_chars"]:200,["exchanges"]:3,["max_chars"]:200}))),"tests/kernel/test_voice.py:112 assert packet[\"budget\"] == {\"mask_chars\": 200, \"exchanges\": 3, \"max_chars\": 200}");
assert.ok(pyBool(pyEqual(pyAt(packet,"taken_masks"),[])),"tests/kernel/test_voice.py:113 assert packet[\"taken_masks\"] == []");
assert.ok(pyBool((await (async()=>{const __left=pyAt(pyAt(packet,"npc"),"name");return pyBool(__left)?!pyContains((await pyMethod(json,"dumps",[packet],{})),KNOTT_ID):__left})())),"tests/kernel/test_voice.py:114 assert packet[\"npc\"][\"name\"] and KNOTT_ID not in json.dumps(packet)");
assert.ok(pyBool(pyContains(pyAt(packet,"instruction"),"taken_masks")),"tests/kernel/test_voice.py:115 assert \"taken_masks\" in packet[\"instruction\"]");
(await settle(kernel));
(await configure(kernel,({"settings":({["coarse_language"]:false})})));
assert.ok(pyBool((pyAt((await job(kernel)),"coarse_language")===false)),"tests/kernel/test_voice.py:119 assert job(kernel)[\"coarse_language\"] is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_packet_is_closed_and_names_the_person_by_handle"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_packet_is_closed_and_names_the_person_by_handle(await kernel(t,{}));});
export async function test_the_packet_carries_the_investigator_the_mask_has_to_fit(kernel:any){
let sheet:any,packet:any;

(await on(kernel));
sheet=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),`${PREGEN}.json`)));
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"investigator"),({["sex"]:pyAt(sheet,"sex")}))),pyStr("the sheet's own free text, the value §117 makes the Keeper owe"));
assert.ok(pyBool(!pyContains((await pyMethod(json,"dumps",[pyAt(packet,"investigator")],{})),pyAt(sheet,"name"))),pyStr("no name travels with the listener"));
(await pyMethod(kernel,"ok",["table.apply",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c1",["effects"]:[({["kind"]:"person",["who"]:pyAt(sheet,"name"),["address"]:"汤米"})]})],{}));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"investigator"),({["sex"]:pyAt(sheet,"sex"),["address"]:"汤米"}))),"tests/kernel/test_voice.py:133 assert job(kernel)[\"investigator\"] == {\"sex\": sheet[\"sex\"], \"address\": \"汤米\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_packet_carries_the_investigator_the_mask_has_to_fit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_packet_carries_the_investigator_the_mask_has_to_fit(await kernel(t,{}));});
export async function test_the_packet_carries_what_is_visible_of_the_listener(kernel:any){
let path:any,sheet:any,written:any,appearance:any;

(await on(kernel));
path=pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),`${PREGEN}.json`);
sheet=(await read_json(path));
assert.ok(pyBool(!pyContains(pyAt((await job(kernel)),"investigator"),"appearance")),pyStr("nothing written, nothing invented"));
written="机车皮夹克，墨镜，一头中长黑发。";
pyAt(sheet,"backstory")["personal_description"]=pyMultiply(written,30);
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
appearance=pyAt(pyAt((await job(kernel)),"investigator"),"appearance");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(appearance)),200);return pyBool(__left)?pyEqual(appearance,pySlice((pyMultiply(written,30)),undefined,200)):__left})())),"tests/kernel/test_voice.py:147 assert len(appearance) == 200 and appearance == (written * 30)[:200]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_packet_carries_what_is_visible_of_the_listener"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_packet_carries_what_is_visible_of_the_listener(await kernel(t,{}));});
export async function test_a_packet_with_nothing_to_say_about_the_listener_carries_no_investigator(kernel:any){
let path:any,sheet:any;

(await on(kernel));
path=pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),`${PREGEN}.json`);
sheet=(await read_json(path));
(await pyMethod(sheet,"pop",["sex",null],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
assert.ok(pyBool(!pyContains((await job(kernel)),"investigator")),"tests/kernel/test_voice.py:158 assert \"investigator\" not in job(kernel)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_packet_with_nothing_to_say_about_the_listener_carries_no_investigator"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_packet_with_nothing_to_say_about_the_listener_carries_no_investigator(await kernel(t,{}));});
export async function test_the_write_lands_in_the_package_namespace_and_reaches_the_capsule_as_voices(kernel:any){
let packet:any,result:any,world:any,recorded:any,turn:any,knott:any;
(await on(kernel));
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"npc"),({...pyAt(packet,"npc"),["handle"]:KNOTT_HANDLE,["name"]:KNOTT}))),"tests/kernel/test_voice.py:165 assert packet[\"npc\"] == {**packet[\"npc\"], \"handle\": KNOTT_HANDLE, \"name\": KNOTT}");
result=(await submit(kernel,pyAt(packet,"job_id"),VOICE));
assert.ok(pyBool(pyEqual(result,({["job_id"]:pyAt(packet,"job_id"),["npc"]:KNOTT_HANDLE,["name"]:KNOTT,["voice"]:VOICE}))),"tests/kernel/test_voice.py:167 assert result == {\"job_id\": packet[\"job_id\"], \"npc\": KNOTT_HANDLE, \"name\": KNOTT, \"voice\": VOICE}");
world=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json")));
recorded=pyAt(pyAt(pyAt(pyAt(pyAt(world,"mods"),"state"),MOD),"dossier"),KNOTT_ID);
assert.ok(pyBool(pyEqual(pyAt(recorded,"voice_mask"),({...pyAt(recorded,"voice_mask"),["value"]:[pyAt(VOICE,"mask")],["label"]:"mask",["mod"]:MOD,["shape"]:"lines"}))),"tests/kernel/test_voice.py:170 assert recorded[\"voice_mask\"] == {**recorded[\"voice_mask\"], \"value\": [VOICE[\"mask\"]], \"label\": \"mask\", \"mod\": MOD, \"shape\": \"lines\"}");
assert.ok(pyBool(pyEqual(pyAt(recorded,"exchanges"),({...pyAt(recorded,"exchanges"),["value"]:pyAt(VOICE,"exchanges"),["label"]:"in exchange",["mod"]:MOD,["shape"]:"lines"}))),"tests/kernel/test_voice.py:171 assert recorded[\"exchanges\"] == {**recorded[\"exchanges\"], \"value\": VOICE[\"exchanges\"], \"label\": \"in exchange\", \"mod\": MOD, \"shape\": \"lines\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),"dossier-established"))){__rows.push(e);}}return __rows;})()),(-1)),"data"),({["npc"]:KNOTT_HANDLE,["keys"]:["voice_mask","exchanges"]}))),"tests/kernel/test_voice.py:172 assert [e for e in read_jsonl(campaign_dir(kernel.workspace) / \"events.jsonl\") if e[\"type\"] == \"dossier-established\"][-1][\"data\"] == {\"npc\": KNOTT_HANDLE, \"keys\": [\"voice_mask\", \"exchanges\"]}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt((await present(kernel)),KNOTT),"mask"),[pyAt(VOICE,"mask")]);return pyBool(__left)?pyEqual(pyAt(pyAt((await present(kernel)),KNOTT),"in exchange"),pyAt(VOICE,"exchanges")):__left})())),"tests/kernel/test_voice.py:174 assert present(kernel)[KNOTT][\"mask\"] == [VOICE[\"mask\"]] and present(kernel)[KNOTT][\"in exchange\"] == VOICE[\"exchanges\"]");
(await settle(kernel));
turn=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我问诺特房子的事。"})),"capsule");
knott=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(turn,"present"))){if(pyBool(pyEqual(pyAt(p,"name"),KNOTT))){__rows.push(p);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(knott,"mask");return pyBool(__left)?!pyContains(knott,"in exchange"):__left})())),"tests/kernel/test_voice.py:179 assert \"mask\" not in knott and \"in exchange\" not in knott");
assert.ok(pyBool(pyEqual(pyAt(turn,"voices"),[({["name"]:KNOTT,["mask"]:pyAt(VOICE,"mask"),["in exchange"]:pyAt(VOICE,"exchanges")})])),"tests/kernel/test_voice.py:180 assert turn[\"voices\"] == [{\"name\": KNOTT, \"mask\": VOICE[\"mask\"], \"in exchange\": VOICE[\"exchanges\"]}]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(turn,"head"),"voices");return pyBool(__left)?pyContains(pyAt(turn,"head"),"flexible register"):__left})())),"tests/kernel/test_voice.py:183 assert \"voices\" in turn[\"head\"] and \"flexible register\" in turn[\"head\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(turn,"head"),"Preserve source secrets and listener identity");return pyBool(__left)?pyContains(pyAt(turn,"head"),"Exchanges are reference"):__left})())),"tests/kernel/test_voice.py:184 assert \"Preserve source secrets and listener identity\" in turn[\"head\"] and \"Exchanges are reference\" in turn[\"head\"]");
assert.ok(pyBool(!pyBool((await pyMethod(re,"search",["\\banswers?\\b[^.;]*\\b(?:first|what was (?:actually )?said)\\b",pyAt(turn,"head"),re.I],{})))),pyStr("§40.9: no answer-first in the base head"));
assert.ok(pyBool(pyContains(pyAt(turn,"head"),"never lines to read out or slogans to repeat")),"tests/kernel/test_voice.py:186 assert \"never lines to read out or slogans to repeat\" in turn[\"head\"]");
assert.ok(pyBool(!pyContains(pyAt(turn,"head"),"Wear the mask on every line")),"tests/kernel/test_voice.py:187 assert \"Wear the mask on every line\" not in turn[\"head\"]");
(await narrate(kernel,"t2-c1","诺特点了点头。"));
(await configure(kernel,({"enabled":false})));
assert.ok(pyBool(!pyContains(pyAt((await present(kernel)),KNOTT),"mask")),"tests/kernel/test_voice.py:191 assert \"mask\" not in present(kernel)[KNOTT]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我再看看。"})),"capsule"),"voices"),[])),"tests/kernel/test_voice.py:192 assert kernel.table(\"player_input\", text=\"我再看看。\")[\"capsule\"][\"voices\"] == []");
(await narrate(kernel,"t3-c1","诺特没有说话。"));
(await configure(kernel));
assert.ok(pyBool((pyAt((await submit(kernel,pyAt(packet,"job_id"),VOICE)),"replayed")===true)),"tests/kernel/test_voice.py:196 assert submit(kernel, packet[\"job_id\"], VOICE)[\"replayed\"] is True");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(packet,"job_id"),({...VOICE,["mask"]:"别的。"}))),"code"),"idempotency_conflict")),"tests/kernel/test_voice.py:197 assert submit_err(kernel, packet[\"job_id\"], {**VOICE, \"mask\": \"别的。\"})[\"code\"] == \"idempotency_conflict\"");
assert.ok(pyBool(!pyEqual((await pyMethod((await pyMethod((await job(kernel)),"get",["npc",({})],{})),"get",["handle"],{})),KNOTT_HANDLE)),"tests/kernel/test_voice.py:198 assert job(kernel).get(\"npc\", {}).get(\"handle\") != KNOTT_HANDLE");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_write_lands_in_the_package_namespace_and_reaches_the_capsule_as_voices"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_write_lands_in_the_package_namespace_and_reaches_the_capsule_as_voices(await kernel(t,{}));});
export async function test_only_the_shape_is_checked(kernel:any){
let job_id:any,bad:any,field:any,error:any;
(await on(kernel));
job_id=pyAt((await job(kernel)),"job_id");
for([bad,field] of pyIterable([["不是对象","voice"],[({["mask"]:pyAt(VOICE,"mask")}),"voice.exchanges"],[({["mask"]:"",["exchanges"]:pyAt(VOICE,"exchanges")}),"voice.mask"],[({["mask"]:pyMultiply("x",201),["exchanges"]:pyAt(VOICE,"exchanges")}),"voice.mask"],[({["mask"]:"带{{记号}}",["exchanges"]:pyAt(VOICE,"exchanges")}),"voice.mask"],[({["mask"]:pyAt(VOICE,"mask"),["exchanges"]:pySlice(pyAt(VOICE,"exchanges"),undefined,2)}),"voice.exchanges"],[({["mask"]:pyAt(VOICE,"mask"),["exchanges"]:["一句","一句","一句"]}),"voice.exchanges"],[({["mask"]:pyAt(VOICE,"mask"),["exchanges"]:["一句","两\n行","三句"]}),"voice.exchanges"],[({["mask"]:pyAt(VOICE,"mask"),["exchanges"]:pyAt(VOICE,"exchanges"),["extra"]:1}),"voice"]])){
error=(await submit_err(kernel,job_id,bad));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),field):__left})())),pyStr(bad));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_the_shape_is_checked"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_the_shape_is_checked(await kernel(t,{}));});
export async function test_a_failed_job_is_offered_again(kernel:any){
let job_id:any,failed:any;
(await on(kernel));
job_id=pyAt((await job(kernel)),"job_id");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["voice.fail",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["reason"]:"bad_output"})],{})),"code"),"invalid_params")),"tests/kernel/test_voice.py:222 assert kernel.err(\"voice.fail\", {\"campaign\": CAMPAIGN, \"job_id\": job_id, \"reason\": \"bad_output\"})[\"code\"] == \"invalid_params\"");
failed=(await pyMethod(kernel,"ok",["voice.fail",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["reason"]:"model_error",["detail"]:"no json"})],{}));
assert.ok(pyBool(pyEqual(pyAt(failed,"status"),"failed")),"tests/kernel/test_voice.py:224 assert failed[\"status\"] == \"failed\"");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"job_id"),job_id)),"tests/kernel/test_voice.py:225 assert job(kernel)[\"job_id\"] == job_id");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_failed_job_is_offered_again"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_failed_job_is_offered_again(await kernel(t,{}));});
export async function test_the_keeper_does_not_author_the_mask_at_the_table(kernel:any){
let key:any,error:any;
(await on(kernel));
for(key of pyIterable(["voice_mask","exchanges"])){
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"dossier",["name"]:KNOTT,["values"]:({[key]:"先付定金再谈。"}),["why"]:"他开口了"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"fix"),"lane"):__left})())),pyStr(key));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_keeper_does_not_author_the_mask_at_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_keeper_does_not_author_the_mask_at_the_table(await kernel(t,{}));});
export async function test_backfill_reaches_people_the_table_has_not_met_and_later_packets_carry_the_masks_taken(kernel:any){
let offered:any,masks:any,packet:any,mask:any;
(await on(kernel));
const __unpack12703=[(await pySet()),[]];offered=__unpack12703[0];masks=__unpack12703[1];
while(pyBool(true)){packet=(await job(kernel,({"backfill":true})));
if(pyBool((pyAt(packet,"job_id")===null))){break;}
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"taken_masks"),pySlice(masks,(-12),undefined));return pyBool(__left)?!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(offered)){__rows.push(pyContains((await pyMethod(json,"dumps",[pyAt(packet,"taken_masks")],{})),name));}return __rows;})())))):__left})())),"tests/kernel/test_voice.py:244 assert packet[\"taken_masks\"] == masks[-12:] and not any(name in json.dumps(packet[\"taken_masks\"]) for name in offered)");
(await pyMethod(offered,"add",[pyAt(pyAt(packet,"npc"),"name")],{}));
mask=`自称「${pyAt(pyAt(packet,"npc"),"handle")}」，句尾带「呗」。`;
(await submit(kernel,pyAt(packet,"job_id"),({["mask"]:mask,["exchanges"]:[`${mask}一`,`${mask}二`,`${mask}三`]})));
(await pyMethod(masks,"append",[mask],{}));}
assert.ok(pyBool((await (async()=>{const __left=pyContains(offered,"Walter Corbitt");return pyBool(__left)?pyContains(offered,KNOTT):__left})())),"tests/kernel/test_voice.py:249 assert \"Walter Corbitt\" in offered and KNOTT in offered");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_backfill_reaches_people_the_table_has_not_met_and_later_packets_carry_the_masks_taken"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_backfill_reaches_people_the_table_has_not_met_and_later_packets_carry_the_masks_taken(await kernel(t,{}));});
export async function test_the_books_silence_is_honoured_and_the_person_is_never_offered_again(kernel:any){
let packet:any,result:any,recorded:any;

(await on(kernel));
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"err",["voice.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["voice"]:null})],{})),"details"),"field"),"reason")),"tests/kernel/test_voice.py:258 assert kernel.err(\"voice.submit\", {\"campaign\": CAMPAIGN, \"job_id\": packet[\"job_id\"], \"voice\": None})[\"details\"][\"field\"] == \"reason\"");
result=(await pyMethod(kernel,"ok",["voice.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["voice"]:null,["reason"]:"does_not_speak"})],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(result,"voice")===null);return pyBool(__left)?pyEqual(pyAt(result,"reason"),"does_not_speak"):__left})())),"tests/kernel/test_voice.py:260 assert result[\"voice\"] is None and result[\"reason\"] == \"does_not_speak\"");
recorded=pyAt(pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"mods"),"state"),MOD),"dossier"),KNOTT_ID);
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(recorded,"exchanges"),"value")===null);return pyBool(__left)?pyEqual(pyAt(pyAt(recorded,"exchanges"),"reason"),"does_not_speak"):__left})())),"tests/kernel/test_voice.py:262 assert recorded[\"exchanges\"][\"value\"] is None and recorded[\"exchanges\"][\"reason\"] == \"does_not_speak\"");
assert.ok(pyBool(!pyContains(pyAt((await present(kernel)),KNOTT),"mask")),"tests/kernel/test_voice.py:263 assert \"mask\" not in present(kernel)[KNOTT]");
(await settle(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我问诺特。"})),"capsule"),"voices"),[])),"tests/kernel/test_voice.py:265 assert kernel.table(\"player_input\", text=\"我问诺特。\")[\"capsule\"][\"voices\"] == []");
assert.ok(pyBool(!pyEqual((await pyMethod((await pyMethod((await job(kernel)),"get",["npc",({})],{})),"get",["handle"],{})),KNOTT_HANDLE)),"tests/kernel/test_voice.py:266 assert job(kernel).get(\"npc\", {}).get(\"handle\") != KNOTT_HANDLE");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_books_silence_is_honoured_and_the_person_is_never_offered_again"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_books_silence_is_honoured_and_the_person_is_never_offered_again(await kernel(t,{}));});
export async function test_a_record_left_by_the_two_line_word_is_replaced_not_kept_beside(kernel:any){
let path:any,world:any,packet:any,knott:any;

(await on(kernel));
(await settle(kernel));
path=pyDivide((await campaign_dir(kernel.workspace)),"world.json");
world=(await read_json(path));
(await pyMethod((await pyMethod(pyAt(pyAt(world,"mods"),"state"),"setdefault",[MOD,({})],{})),"setdefault",["dossier",({})],{}))[KNOTT_ID]=({["sample_lines"]:({["value"]:["活儿是活儿。","谁跟你说的？"],["label"]:"sounds like",["turn"]:1,["mod"]:MOD})});
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我问诺特。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await present(kernel)),KNOTT),"sounds like"),["活儿是活儿。","谁跟你说的？"])),"tests/kernel/test_voice.py:280 assert present(kernel)[KNOTT][\"sounds like\"] == [\"活儿是活儿。\", \"谁跟你说的？\"]");
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"npc"),"handle"),KNOTT_HANDLE)),pyStr("an old record does not settle the person"));
(await submit(kernel,pyAt(packet,"job_id"),VOICE));
knott=pyAt((await present(kernel)),KNOTT);
assert.ok(pyBool((await (async()=>{const __left=!pyContains(knott,"sounds like");return pyBool(__left)?pyEqual(pyAt(knott,"mask"),[pyAt(VOICE,"mask")]):__left})())),"tests/kernel/test_voice.py:285 assert \"sounds like\" not in knott and knott[\"mask\"] == [VOICE[\"mask\"]]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_record_left_by_the_two_line_word_is_replaced_not_kept_beside"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_record_left_by_the_two_line_word_is_replaced_not_kept_beside(await kernel(t,{}));});
export async function test_the_packet_carries_the_lines_this_person_already_said(kernel:any){
let packet:any;

(await create_campaign(kernel));
(await configure(kernel));
(await narrate_opening(kernel,"开场。\n\n{{say:Steven Knott}}「钥匙在这儿，拿去就是。」{{/say}}诺特把钥匙拍在桌上。"));
(await pyMethod(kernel,"table",["player_input"],{"text":"我仔细观察诺特。"}));
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"said"),["「钥匙在这儿，拿去就是。」"])),"tests/kernel/test_voice.py:295 assert packet[\"said\"] == [\"「钥匙在这儿，拿去就是。」\"]");
assert.ok(pyBool(pyContains(pyAt(packet,"instruction"),"said")),"tests/kernel/test_voice.py:296 assert \"said\" in packet[\"instruction\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"generation"),"state_version"),2)),"tests/kernel/test_voice.py:297 assert packet[\"generation\"][\"state_version\"] == 2");
assert.ok(pyBool(pyContains(packet,"investigator")),"tests/kernel/test_voice.py:298 assert \"investigator\" in packet");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_packet_carries_the_lines_this_person_already_said"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_packet_carries_the_lines_this_person_already_said(await kernel(t,{}));});
export async function installed_voice(kernel:any,tmp_path:any,version:any,state_version:any){
let path:any,manifest:any;
path=pyDivide(tmp_path,version);
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),MOD),path],{}));
manifest=(await read_json(pyDivide(path,"mod.json")));
(await pyMethod(manifest,"update",[],{"version":version,"state_version":state_version}));
if(pyBool(pyEqual(state_version,1))){(await pyMethod(manifest,"pop",["migrations",null],{}));}
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyStr(path))})],{}));
}
export async function legacy_campaign(kernel:any,tmp_path:any){
let path:any,world:any;
(await installed_voice(kernel,tmp_path,"1.1.2",1));
(await create_campaign(kernel));
(await narrate_opening(kernel));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:EXPRESSION,["enabled"]:false})],{}));
path=pyDivide((await campaign_dir(kernel.workspace)),"world.json");
world=(await read_json(path));
(await pyMethod(pyAt(pyAt(world,"mods"),"active"),"pop",[MOD,null],{}));
(await pyMethod(pyAt(pyAt(world,"mods"),"state"),"pop",[MOD,null],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual((await job(kernel)),({["job_id"]:null}))),pyStr("a missing lock must not auto-enroll"));
(await configure(kernel,({"version":"1.1.2"})));
return (await campaign_dir(kernel.workspace));
}
export async function job_file(root:any,packet:any,owner:any=MOD){
let generation:any,folder:any;
generation=(await pyMethod(packet,"get",["generation"],{}));
folder=pyDivide(pyDivide(root,owner),"jobs");
if(pyBool(generation)){folder=pyDivide(pyDivide(folder,"v2"),pyAt(generation,"digest"));}
return pyDivide(folder,`${pyAt(pyAt(packet,"npc"),"handle")}.json`);
}
export async function test_explicit_upgrade_archives_cards_and_preserves_jobs_and_turns(kernel:any,tmp_path:any){
let root:any,old:any,old_bytes:any,old_dossier:any,turns:any,state:any,new_value:any;
root=(await legacy_campaign(kernel,tmp_path));
old=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(old,"job_id"),`voice:${CAMPAIGN}:${KNOTT_HANDLE}`)),"tests/kernel/test_voice.py:339 assert old[\"job_id\"] == f\"voice:{CAMPAIGN}:{KNOTT_HANDLE}\"");
assert.ok(pyBool(!pyContains(old,"generation")),"tests/kernel/test_voice.py:340 assert \"generation\" not in old");
(await submit(kernel,pyAt(old,"job_id"),VOICE));
assert.ok(pyBool((pyAt((await submit(kernel,pyAt(old,"job_id"),VOICE)),"replayed")===true)),"tests/kernel/test_voice.py:342 assert submit(kernel, old[\"job_id\"], VOICE)[\"replayed\"] is True");
old_bytes=(await pyMethod((await job_file(root,old)),"read_bytes",[],{}));
old_dossier=pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"state"),MOD),"dossier");
turns=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod((pyDivide(root,"turns")),"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{})))){__rows.push([path,(await pyMethod(path,"read_bytes",[],{}))]);}}return __rows;})()));
assert.ok(pyBool(turns),pyStr("retention must check actual historical files"));
(await configure(kernel));
state=pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"state"),MOD);
assert.ok(pyBool(pyEqual(pyAt(state,"legacy_voice_dossier"),old_dossier)),"tests/kernel/test_voice.py:349 assert state[\"legacy_voice_dossier\"] == old_dossier");
assert.ok(pyBool(pyEqual(pyAt(state,"dossier"),({}))),"tests/kernel/test_voice.py:350 assert state[\"dossier\"] == {}");
new_value=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(new_value,"npc"),"handle"),KNOTT_HANDLE)),pyStr("old done must not suppress regeneration"));
assert.ok(pyBool(!pyEqual(pyAt(new_value,"job_id"),pyAt(old,"job_id"))),"tests/kernel/test_voice.py:353 assert new[\"job_id\"] != old[\"job_id\"]");
assert.ok(pyBool(pyEqual(pyAt((await read_json((await job_file(root,new_value)))),"generation"),pyAt(new_value,"generation"))),"tests/kernel/test_voice.py:354 assert read_json(job_file(root, new))[\"generation\"] == new[\"generation\"]");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(old,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:355 assert submit_err(kernel, old[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
(await pyMethod(kernel,"err",["voice.fail",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(old,"job_id"),["reason"]:"model_error"})],{}));
(await submit(kernel,pyAt(new_value,"job_id"),VOICE));
assert.ok(pyBool((pyAt((await submit(kernel,pyAt(new_value,"job_id"),VOICE)),"replayed")===true)),"tests/kernel/test_voice.py:358 assert submit(kernel, new[\"job_id\"], VOICE)[\"replayed\"] is True");
assert.ok(pyBool(pyEqual((await pyMethod((await job_file(root,old)),"read_bytes",[],{})),old_bytes)),"tests/kernel/test_voice.py:359 assert job_file(root, old).read_bytes() == old_bytes");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const [path,data] of pyIterable((await pyMethod(turns,"items",[],{})))){__rows.push(pyEqual((await pyMethod(path,"read_bytes",[],{})),data));}return __rows;})())))),"tests/kernel/test_voice.py:360 assert all(path.read_bytes() == data for path, data in turns.items())");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"state"),MOD),"legacy_voice_dossier"),old_dossier)),"tests/kernel/test_voice.py:361 assert read_json(root / \"world.json\")[\"mods\"][\"state\"][MOD][\"legacy_voice_dossier\"] == old_dossier");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_explicit_upgrade_archives_cards_and_preserves_jobs_and_turns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_explicit_upgrade_archives_cards_and_preserves_jobs_and_turns(await kernel(t,{}),temporary);});
export async function test_upgrade_stays_pending_and_preserves_explicit_disable(kernel:any,tmp_path:any){
let root:any,world:any,lock:any;
root=(await legacy_campaign(kernel,tmp_path));
(await configure(kernel,({"version":"1.1.2","enabled":false})));
(await pyMethod(kernel,"table",["player_input"],{"text":"I look around."}));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:MOD,["version"]:VERSION})],{}));
world=(await read_json(pyDivide(root,"world.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(world,"mods"),"active"),MOD),"version"),"1.1.2")),"tests/kernel/test_voice.py:370 assert world[\"mods\"][\"active\"][MOD][\"version\"] == \"1.1.2\"");
assert.ok(pyBool((pyAt(pyAt(pyAt(pyAt(world,"mods"),"pending"),MOD),"enabled")===false)),"tests/kernel/test_voice.py:371 assert world[\"mods\"][\"pending\"][MOD][\"enabled\"] is False");
assert.ok(pyBool(pyEqual((await job(kernel)),({["job_id"]:null}))),"tests/kernel/test_voice.py:372 assert job(kernel) == {\"job_id\": None}");
(await settle(kernel));
(await pyMethod(kernel,"table",["player_input"],{"text":"I wait."}));
lock=pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active"),MOD);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(lock,"state_version"),2);return pyBool(__left)?(pyAt(lock,"enabled")===false):__left})())),"tests/kernel/test_voice.py:376 assert lock[\"state_version\"] == 2 and lock[\"enabled\"] is False");
assert.ok(pyBool(pyEqual((await job(kernel)),({["job_id"]:null}))),"tests/kernel/test_voice.py:377 assert job(kernel) == {\"job_id\": None}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_upgrade_stays_pending_and_preserves_explicit_disable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_upgrade_stays_pending_and_preserves_explicit_disable(await kernel(t,{}),temporary);});
export async function test_current_generation_is_unique_and_stale_submit_and_fail_are_read_only(kernel:any,tmp_path:any){
let root:any,old:any,current:any,before:any;
(await create_campaign(kernel));
(await configure(kernel));
(await narrate_opening(kernel));
root=(await campaign_dir(kernel.workspace));
old=(await job(kernel));
(await installed_voice(kernel,tmp_path,"1.2.1",2));
(await configure(kernel,({"version":"1.2.1"})));
current=(await job(kernel));
assert.ok(pyBool(!pyEqual(pyAt(current,"job_id"),pyAt(old,"job_id"))),"tests/kernel/test_voice.py:389 assert current[\"job_id\"] != old[\"job_id\"]");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(current,"generation"),"digest"),pyAt(pyAt(old,"generation"),"digest"))),"tests/kernel/test_voice.py:390 assert current[\"generation\"][\"digest\"] != old[\"generation\"][\"digest\"]");
before=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable([pyDivide(root,"world.json"),(await job_file(root,old)),(await job_file(root,current))])){__rows.push([path,(await pyMethod(path,"read_bytes",[],{}))]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(old,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:392 assert submit_err(kernel, old[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
(await pyMethod(kernel,"err",["voice.fail",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(old,"job_id"),["reason"]:"model_error"})],{}));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const [path,data] of pyIterable((await pyMethod(before,"items",[],{})))){__rows.push(pyEqual((await pyMethod(path,"read_bytes",[],{})),data));}return __rows;})())))),"tests/kernel/test_voice.py:394 assert all(path.read_bytes() == data for path, data in before.items())");
(await submit(kernel,pyAt(current,"job_id"),VOICE));
assert.ok(pyBool((pyAt((await submit(kernel,pyAt(current,"job_id"),VOICE)),"replayed")===true)),"tests/kernel/test_voice.py:396 assert submit(kernel, current[\"job_id\"], VOICE)[\"replayed\"] is True");
(await configure(kernel,({"version":"1.2.1","enabled":false})));
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(current,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:398 assert submit_err(kernel, current[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_current_generation_is_unique_and_stale_submit_and_fail_are_read_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_current_generation_is_unique_and_stale_submit_and_fail_are_read_only(await kernel(t,{}),temporary);});
export async function test_submit_checks_all_generation_fields_before_any_write(kernel:any,location:any,field:any,value:any){
let packet:any,root:any,path:any,stored:any,before:any;
(await on(kernel));
packet=(await job(kernel));
root=(await campaign_dir(kernel.workspace));
path=(await job_file(root,packet));
stored=(await read_json(path));
pyAt(((pyBool(pyEqual(location,"job"))?stored:pyAt(stored,"packet"))),"generation")[field]=value;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[stored],{}))],{"encoding":"utf-8"}));
before=[(await pyMethod(path,"read_bytes",[],{})),(await pyMethod((pyDivide(root,"world.json")),"read_bytes",[],{}))];
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(packet,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:412 assert submit_err(kernel, packet[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual([(await pyMethod(path,"read_bytes",[],{})),(await pyMethod((pyDivide(root,"world.json")),"read_bytes",[],{}))],before)),"tests/kernel/test_voice.py:413 assert (path.read_bytes(), (root / \"world.json\").read_bytes()) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("location",["job","packet"])),pyParametrize("field,value",[["version","9.9.9"],["state_version",1],["state_version","2"],["digest",pyMultiply("0",64)]]))).entries())test("test_submit_checks_all_generation_fields_before_any_write"+((pyCartesian(pyCartesian([{}],pyParametrize("location",["job","packet"])),pyParametrize("field,value",[["version","9.9.9"],["state_version",1],["state_version","2"],["digest",pyMultiply("0",64)]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_submit_checks_all_generation_fields_before_any_write(await kernel(t,{}),row["location"],row["field"],row["value"]);});
export async function test_old_inflight_result_cannot_write_after_pending_upgrade_applies(kernel:any,tmp_path:any){
let root:any,old:any,current:any,paths:any,before:any;
root=(await legacy_campaign(kernel,tmp_path));
old=(await job(kernel));
(await pyMethod(kernel,"table",["player_input"],{"text":"I wait."}));
(await configure(kernel));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"job_id"),pyAt(old,"job_id"))),pyStr("pending is not active"));
(await settle(kernel));
(await pyMethod(kernel,"table",["player_input"],{"text":"I look around."}));
current=(await job(kernel));
assert.ok(pyBool(!pyEqual(pyAt(current,"job_id"),pyAt(old,"job_id"))),"tests/kernel/test_voice.py:425 assert current[\"job_id\"] != old[\"job_id\"]");
paths=[pyDivide(root,"world.json"),(await job_file(root,old)),(await job_file(root,current))];
before=(await (async()=>{const __rows:any[]=[];for(const path of pyIterable(paths)){__rows.push((await pyMethod(path,"read_bytes",[],{})));}return __rows;})());
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(old,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:428 assert submit_err(kernel, old[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
(await pyMethod(kernel,"err",["voice.fail",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(old,"job_id"),["reason"]:"model_error"})],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const path of pyIterable(paths)){__rows.push((await pyMethod(path,"read_bytes",[],{})));}return __rows;})()),before)),"tests/kernel/test_voice.py:430 assert [path.read_bytes() for path in paths] == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_old_inflight_result_cannot_write_after_pending_upgrade_applies"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_old_inflight_result_cannot_write_after_pending_upgrade_applies(await kernel(t,{}),temporary);});
export async function test_source_authored_words_survive_real_package_upgrade(kernel:any,tmp_path:any){
let mid:any,_:any,campaign:any,root:any,world:any,before:any,module_root:any,evidence:any,after:any;

(await installed_voice(kernel,tmp_path,"1.1.2",1));
const __unpack22822=(await built_module(kernel,tmp_path,({["voice_mask"]:["Measured, courteous speech."],["exchanges"]:["Good morning. -> Good morning to you."]})));mid=__unpack22822[0];_=__unpack22822[1];
campaign=(await played(kernel,tmp_path,mid));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:campaign,["call_id"]:"t0-c1",["text"]:"The tenant waits."})],{}));
root=(await campaign_dir(kernel.workspace,campaign));
world=(await read_json(pyDivide(root,"world.json")));
(await pyMethod(pyAt(pyAt(world,"mods"),"active"),"pop",[MOD],{}));
(await pyMethod((pyDivide(root,"world.json")),"write_text",[(await pyMethod(json,"dumps",[world],{}))],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:campaign,["id"]:EXPRESSION,["enabled"]:false})],{}));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:campaign,["id"]:MOD,["version"]:"1.1.2",["enabled"]:true})],{}));
before=pyAt((await table_npcs(kernel,campaign)),"Tenant");
module_root=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid);
evidence=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(module_root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{})))){__rows.push([path,(await pyMethod(path,"read_bytes",[],{}))]);}}return __rows;})()));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:campaign,["id"]:MOD,["version"]:VERSION})],{}));
after=pyAt((await table_npcs(kernel,campaign)),"Tenant");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(after,"mask");const __term1=pyAt(before,"mask");const __term2=["Measured, courteous speech."];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_voice.py:451 assert after[\"mask\"] == before[\"mask\"] == [\"Measured, courteous speech.\"]");
assert.ok(pyBool(pyEqual(pyAt(after,"in exchange"),pyAt(before,"in exchange"))),"tests/kernel/test_voice.py:452 assert after[\"in exchange\"] == before[\"in exchange\"]");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["voice.job",({["campaign"]:campaign,["backfill"]:true})],{})),({["job_id"]:null}))),"tests/kernel/test_voice.py:453 assert kernel.ok(\"voice.job\", {\"campaign\": campaign, \"backfill\": True}) == {\"job_id\": None}");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const [path,data] of pyIterable((await pyMethod(evidence,"items",[],{})))){__rows.push(pyEqual((await pyMethod(path,"read_bytes",[],{})),data));}return __rows;})())))),"tests/kernel/test_voice.py:454 assert all(path.read_bytes() == data for path, data in evidence.items())");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_source_authored_words_survive_real_package_upgrade"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_source_authored_words_survive_real_package_upgrade(await kernel(t,{}),temporary);});
export async function test_v2_identity_parser_rejects_invalid_suffixes(kernel:any){
let packet:any,identity:any;
(await on(kernel));
packet=(await job(kernel));
for(identity of pyIterable([pyAt((await pyMethod(pyAt(packet,"job_id"),"split",["@"],{})),0),pyAdd(pyAt(packet,"job_id"),"extra"),pyAdd(pyAt(packet,"job_id"),"/../x")])){
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,identity,VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:461 assert submit_err(kernel, identity, VOICE)[\"code\"] == \"invalid_params\"");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_v2_identity_parser_rejects_invalid_suffixes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_v2_identity_parser_rejects_invalid_suffixes(await kernel(t,{}));});

export let GENERATION:any="npc.voice.generation.v2";
export let UNIFIED_VERSION:any="90.0.0";
export async function unified_package(kernel:any,tmp_path:any,generation:any=true,version:any=UNIFIED_VERSION){
let path:any,manifest:any,requires:any,lane:any;

path=pyDivide(tmp_path,`${EXPRESSION}-${version}`);
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),EXPRESSION),path],{}));
manifest=(await read_json(pyDivide(path,"mod.json")));
manifest["version"]=version;
requires=(await (async()=>{const __rows:any[]=[];for(const cap of pyIterable(pyAt(manifest,"requires"))){if(pyBool(!pyEqual(cap,GENERATION))){__rows.push(cap);}}return __rows;})());
manifest["requires"]=(pyBool(generation)?[...requires,GENERATION]:requires);
if(pyBool((await (async()=>{const __left=!pyBool(generation);return pyBool(__left)?pyContains(pyAt(manifest,"contributes"),"voice_lane"):__left;})()))){lane=(await pyMethod(pyAt(manifest,"contributes"),"pop",["voice_lane"],{}));
manifest["package_files"]=(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(manifest,"package_files"))){if(pyBool(!pyEqual(name,lane))){__rows.push(name);}}return __rows;})());
(await pyMethod((pyDivide(path,lane)),"unlink",[],{}));}
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyStr(path))})],{}));
}
export async function test_the_lane_instruction_comes_from_the_owning_package(kernel:any,tmp_path:any){
let path:any,manifest:any,packet:any,zh_addendum:any;

path=pyDivide(tmp_path,`${EXPRESSION}-lane`);
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),EXPRESSION),path],{}));
manifest=(await read_json(pyDivide(path,"mod.json")));
manifest["version"]=UNIFIED_VERSION;
(await pyMethod((pyDivide(path,pyAt(pyAt(manifest,"contributes"),"voice_lane"))),"write_text",["Package lane instruction: taken_masks, said, and the voice shape."],{"encoding":"utf-8"}));
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyStr(path))})],{}));
(await create_campaign(kernel));
(await narrate_opening(kernel));
(await pyMethod(kernel,"table",["player_input"],{"text":"我仔细观察诺特。"}));
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"generation"),"version"),UNIFIED_VERSION)),"tests/kernel/test_voice.py:502 assert packet[\"generation\"][\"version\"] == UNIFIED_VERSION");
zh_addendum=(await pyMethod((await pyMethod((pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"zh-optimize"),"voice-lane.zh.md")),"read_text",[],{"encoding":"utf-8"})),"strip",[],{}));
assert.ok(pyBool(pyEqual(pyAt(packet,"instruction"),("Package lane instruction: taken_masks, said, and the voice shape."+`\n\n## Language addendum: zh-optimize\n\n${zh_addendum}`))),"tests/kernel/test_voice.py:506 assert packet[\"instruction\"] == (\"Package lane instruction: taken_masks, said, and the voice shape.\"\n                                     f\"\\n\\n## Language addendum: zh-optimize\\n\\n{zh_addendum}\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_lane_instruction_comes_from_the_owning_package"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_lane_instruction_comes_from_the_owning_package(await kernel(t,{}),temporary);});
export async function test_a_legacy_owner_keeps_the_frozen_lane_instruction(kernel:any){
let packet:any;

(await on(kernel));
packet=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"instruction"),(await pyMethod((await pyMethod((pyDivide(pyDivide(pyDivide(WORKTREE,"content"),"compat"),"npc-voice-lane.md")),"read_text",[],{"encoding":"utf-8"})),"strip",[],{})))),"tests/kernel/test_voice.py:514 assert packet[\"instruction\"] == (WORKTREE / \"content\" / \"compat\" / \"npc-voice-lane.md\").read_text(encoding=\"utf-8\").strip()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_legacy_owner_keeps_the_frozen_lane_instruction"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_legacy_owner_keeps_the_frozen_lane_instruction(await kernel(t,{}));});
export async function test_voice_lane_without_the_generation_capability_is_refused(kernel:any,tmp_path:any){
let path:any,manifest:any,error:any;
path=pyDivide(tmp_path,`${EXPRESSION}-no-lane`);
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),EXPRESSION),path],{}));
manifest=(await read_json(pyDivide(path,"mod.json")));
manifest["version"]=UNIFIED_VERSION;
manifest["requires"]=(await (async()=>{const __rows:any[]=[];for(const cap of pyIterable(pyAt(manifest,"requires"))){if(pyBool(!pyEqual(cap,GENERATION))){__rows.push(cap);}}return __rows;})());
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyStr(path))})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"voice_lane"):__left})())),"tests/kernel/test_voice.py:525 assert error[\"code\"] == \"invalid_params\" and \"voice_lane\" in error[\"message\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_voice_lane_without_the_generation_capability_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_voice_lane_without_the_generation_capability_is_refused(await kernel(t,{}),temporary);});
export async function task_world_revision(client:any){
return pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"_context"),"task_world_revision");
}
export async function test_a_new_world_gives_the_lane_to_the_unified_package(kernel:any,tmp_path:any){
let root:any,locks:any,packet:any,lock:any,revision:any,result:any,world:any,recorded:any,turn:any;
(await unified_package(kernel,tmp_path));
(await create_campaign(kernel));
root=(await campaign_dir(kernel.workspace));
locks=pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active");
assert.ok(pyBool(pyEqual([pyAt(pyAt(locks,EXPRESSION),"version"),pyAt(pyAt(locks,EXPRESSION),"enabled"),pyAt(pyAt(locks,MOD),"enabled")],[UNIFIED_VERSION,true,false])),"tests/kernel/test_voice.py:537 assert (locks[EXPRESSION][\"version\"], locks[EXPRESSION][\"enabled\"], locks[MOD][\"enabled\"]) == (UNIFIED_VERSION, True, False)");
(await narrate_opening(kernel));
packet=(await job(kernel));
lock=pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active"),EXPRESSION);
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"npc"),"handle"),KNOTT_HANDLE)),"tests/kernel/test_voice.py:542 assert packet[\"npc\"][\"handle\"] == KNOTT_HANDLE");
assert.ok(pyBool(pyEqual(pyAt(packet,"generation"),pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["version","digest","state_version"])){__rows.push([key,pyAt(lock,key)]);}return __rows;})())))),"tests/kernel/test_voice.py:543 assert packet[\"generation\"] == {key: lock[key] for key in (\"version\", \"digest\", \"state_version\")}");
assert.ok(pyBool(pyEqual(pyAt(packet,"job_id"),`voice:${CAMPAIGN}:${KNOTT_HANDLE}@${pyAt(lock,"digest")}`)),"tests/kernel/test_voice.py:544 assert packet[\"job_id\"] == f\"voice:{CAMPAIGN}:{KNOTT_HANDLE}@{lock['digest']}\"");
assert.ok(pyBool((pyAt(packet,"coarse_language")===pyAt(pyAt(lock,"settings"),"coarse_language"))),"tests/kernel/test_voice.py:545 assert packet[\"coarse_language\"] is lock[\"settings\"][\"coarse_language\"]");
assert.ok(pyBool(pyEqual(pyAt((await read_json((await job_file(root,packet,EXPRESSION)))),"job_id"),pyAt(packet,"job_id"))),"tests/kernel/test_voice.py:546 assert read_json(job_file(root, packet, EXPRESSION))[\"job_id\"] == packet[\"job_id\"]");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(root,MOD)),"exists",[],{})))),pyStr("the unified owner's jobs never share the legacy folder"));
revision=(await task_world_revision(kernel));
result=(await submit(kernel,pyAt(packet,"job_id"),VOICE));
assert.ok(pyBool(pyEqual(result,({["job_id"]:pyAt(packet,"job_id"),["npc"]:KNOTT_HANDLE,["name"]:KNOTT,["voice"]:VOICE}))),"tests/kernel/test_voice.py:550 assert result == {\"job_id\": packet[\"job_id\"], \"npc\": KNOTT_HANDLE, \"name\": KNOTT, \"voice\": VOICE}");
world=(await read_json(pyDivide(root,"world.json")));
recorded=pyAt(pyAt(pyAt(pyAt(pyAt(world,"mods"),"state"),EXPRESSION),"dossier"),KNOTT_ID);
assert.ok(pyBool(pyEqual(pyAt(recorded,"voice_mask"),({...pyAt(recorded,"voice_mask"),["value"]:[pyAt(VOICE,"mask")],["label"]:"mask",["mod"]:EXPRESSION,["shape"]:"lines"}))),"tests/kernel/test_voice.py:553 assert recorded[\"voice_mask\"] == {**recorded[\"voice_mask\"], \"value\": [VOICE[\"mask\"]], \"label\": \"mask\", \"mod\": EXPRESSION, \"shape\": \"lines\"}");
assert.ok(pyBool(pyEqual(pyAt(recorded,"exchanges"),({...pyAt(recorded,"exchanges"),["value"]:pyAt(VOICE,"exchanges"),["label"]:"in exchange",["mod"]:EXPRESSION,["shape"]:"lines"}))),"tests/kernel/test_voice.py:554 assert recorded[\"exchanges\"] == {**recorded[\"exchanges\"], \"value\": VOICE[\"exchanges\"], \"label\": \"in exchange\", \"mod\": EXPRESSION, \"shape\": \"lines\"}");
assert.ok(pyBool(!pyContains(pyAt(pyAt(world,"mods"),"state"),MOD)),"tests/kernel/test_voice.py:555 assert MOD not in world[\"mods\"][\"state\"]");
assert.ok(pyBool(pyEqual(pyAt((await read_json((await job_file(root,packet,EXPRESSION)))),"status"),"done")),"tests/kernel/test_voice.py:556 assert read_json(job_file(root, packet, EXPRESSION))[\"status\"] == \"done\"");
assert.ok(pyBool(pyEqual((await task_world_revision(kernel)),revision)),"tests/kernel/test_voice.py:558 assert task_world_revision(kernel) == revision");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide(root,"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),"dossier-established"))){__rows.push(e);}}return __rows;})()),(-1)),"data"),({["npc"]:KNOTT_HANDLE,["keys"]:["voice_mask","exchanges"]}))),"tests/kernel/test_voice.py:559 assert [e for e in read_jsonl(root / \"events.jsonl\") if e[\"type\"] == \"dossier-established\"][-1][\"data\"] == {\"npc\": KNOTT_HANDLE, \"keys\": [\"voice_mask\", \"exchanges\"]}");
turn=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我问诺特房子的事。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(turn,"voices"),[({["name"]:KNOTT,["mask"]:pyAt(VOICE,"mask"),["in exchange"]:pyAt(VOICE,"exchanges")})])),"tests/kernel/test_voice.py:562 assert turn[\"voices\"] == [{\"name\": KNOTT, \"mask\": VOICE[\"mask\"], \"in exchange\": VOICE[\"exchanges\"]}]");
assert.ok(pyBool((pyAt((await submit(kernel,pyAt(packet,"job_id"),VOICE)),"replayed")===true)),"tests/kernel/test_voice.py:563 assert submit(kernel, packet[\"job_id\"], VOICE)[\"replayed\"] is True");
assert.ok(pyBool(!pyEqual((await pyMethod((await pyMethod((await job(kernel)),"get",["npc",({})],{})),"get",["handle"],{})),KNOTT_HANDLE)),"tests/kernel/test_voice.py:564 assert job(kernel).get(\"npc\", {}).get(\"handle\") != KNOTT_HANDLE");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_new_world_gives_the_lane_to_the_unified_package"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_new_world_gives_the_lane_to_the_unified_package(await kernel(t,{}),temporary);});
export async function test_a_new_unified_generation_reads_who_is_settled_from_the_owners_namespace(kernel:any,tmp_path:any){
let first:any,packet:any;

(await unified_package(kernel,tmp_path));
(await create_campaign(kernel));
(await narrate_opening(kernel));
first=(await job(kernel));
(await submit(kernel,pyAt(first,"job_id"),VOICE));
(await unified_package(kernel,tmp_path,undefined,"90.0.1"));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:EXPRESSION,["version"]:"90.0.1"})],{}));
packet=(await job(kernel,({"backfill":true})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(packet,"generation"),"version"),"90.0.1");return pyBool(__left)?!pyEqual(pyAt(pyAt(packet,"generation"),"digest"),pyAt(pyAt(first,"generation"),"digest")):__left})())),"tests/kernel/test_voice.py:578 assert packet[\"generation\"][\"version\"] == \"90.0.1\" and packet[\"generation\"][\"digest\"] != first[\"generation\"][\"digest\"]");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(packet,"npc"),"handle"),KNOTT_HANDLE)),pyStr("Knott is on stage and first in line unless the owner's dossier settles him"));
assert.ok(pyBool(pyContains(pyAt(packet,"taken_masks"),pyAt(VOICE,"mask"))),"tests/kernel/test_voice.py:580 assert VOICE[\"mask\"] in packet[\"taken_masks\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_new_unified_generation_reads_who_is_settled_from_the_owners_namespace"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_new_unified_generation_reads_who_is_settled_from_the_owners_namespace(await kernel(t,{}),temporary);});
export async function test_a_handed_over_card_is_established_under_the_unified_owner(kernel:any,tmp_path:any){
let root:any,legacy:any,before:any,world:any,digest:any,offered:any,packet:any,mask:any,written:any,turn:any;
(await unified_package(kernel,tmp_path));
(await create_campaign(kernel));
(await configure(kernel));
(await narrate_opening(kernel));
root=(await campaign_dir(kernel.workspace));
legacy=(await job(kernel));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(legacy,"npc"),"handle"),KNOTT_HANDLE);return pyBool(__left)?(await pyMethod((await job_file(root,legacy)),"exists",[],{})):__left})())),"tests/kernel/test_voice.py:590 assert legacy[\"npc\"][\"handle\"] == KNOTT_HANDLE and job_file(root, legacy).exists()");
(await submit(kernel,pyAt(legacy,"job_id"),VOICE));
before=pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"state"),MOD),"dossier");
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:EXPRESSION,["version"]:UNIFIED_VERSION,["enabled"]:true})],{}));
world=(await read_json(pyDivide(root,"world.json")));
assert.ok(pyBool((pyAt(pyAt(pyAt(pyAt(world,"mods"),"active"),MOD),"enabled")===false)),"tests/kernel/test_voice.py:595 assert world[\"mods\"][\"active\"][MOD][\"enabled\"] is False");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(world,"mods"),"state"),EXPRESSION),"dossier"),KNOTT_ID),pyAt(before,KNOTT_ID))),"tests/kernel/test_voice.py:596 assert world[\"mods\"][\"state\"][EXPRESSION][\"dossier\"][KNOTT_ID] == before[KNOTT_ID]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(world,"mods"),"state"),EXPRESSION),"voice_handover"),"copied_count"),1)),"tests/kernel/test_voice.py:597 assert world[\"mods\"][\"state\"][EXPRESSION][\"voice_handover\"][\"copied_count\"] == 1");
digest=pyAt(pyAt(pyAt(pyAt(world,"mods"),"active"),EXPRESSION),"digest");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(legacy,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:600 assert submit_err(kernel, legacy[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
offered=[];
while(pyBool((pyAt(((packet=(await job(kernel,({"backfill":true}))))),"job_id")!==null))){assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(packet,"generation"),"digest"),digest);return pyBool(__left)?pyContains(pyAt(packet,"taken_masks"),pyAt(VOICE,"mask")):__left})())),"tests/kernel/test_voice.py:604 assert packet[\"generation\"][\"digest\"] == digest and VOICE[\"mask\"] in packet[\"taken_masks\"]");
(await pyMethod(offered,"append",[pyAt(pyAt(packet,"npc"),"handle")],{}));
mask=`自称「${pyAt(pyAt(packet,"npc"),"handle")}」，句尾带「呗」。`;
(await submit(kernel,pyAt(packet,"job_id"),({["mask"]:mask,["exchanges"]:[`${mask}一`,`${mask}二`,`${mask}三`]})));}
assert.ok(pyBool((await (async()=>{const __left=offered;return pyBool(__left)?!pyContains(offered,KNOTT_HANDLE):__left})())),"tests/kernel/test_voice.py:608 assert offered and KNOTT_HANDLE not in offered");
world=(await read_json(pyDivide(root,"world.json")));
written=pyAt(pyAt(pyAt(pyAt(world,"mods"),"state"),EXPRESSION),"dossier");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const [npc,record] of pyIterable((await pyMethod(written,"items",[],{})))){if(pyBool(!pyEqual(npc,KNOTT_ID))){__rows.push(pyEqual(pyAt(pyAt(record,"exchanges"),"mod"),EXPRESSION));}}return __rows;})())))),"tests/kernel/test_voice.py:611 assert all(record[\"exchanges\"][\"mod\"] == EXPRESSION for npc, record in written.items() if npc != KNOTT_ID)");
assert.ok(pyBool(pyEqual((await pyLen(written)),pyAdd((await pyLen(offered)),1))),"tests/kernel/test_voice.py:612 assert len(written) == len(offered) + 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(world,"mods"),"state"),MOD),"dossier"),before)),pyStr("the old namespace is kept, not written"));
turn=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我问诺特房子的事。"})),"capsule");
assert.ok(pyBool(pyContains(pyAt(turn,"voices"),({["name"]:KNOTT,["mask"]:pyAt(VOICE,"mask"),["in exchange"]:pyAt(VOICE,"exchanges")}))),"tests/kernel/test_voice.py:615 assert {\"name\": KNOTT, \"mask\": VOICE[\"mask\"], \"in exchange\": VOICE[\"exchanges\"]} in turn[\"voices\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_handed_over_card_is_established_under_the_unified_owner"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_handed_over_card_is_established_under_the_unified_owner(await kernel(t,{}),temporary);});
export async function test_with_neither_package_on_the_lane_has_no_owner_and_no_job(kernel:any,tmp_path:any){
let root:any,stale:any,locks:any,paths:any,before:any;
(await unified_package(kernel,tmp_path));
(await create_campaign(kernel));
(await narrate_opening(kernel));
root=(await campaign_dir(kernel.workspace));
stale=(await job(kernel));
assert.ok(pyBool((await pyMethod(pyAt(stale,"job_id"),"endswith",[pyAdd("@",pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active"),EXPRESSION),"digest"))],{}))),"tests/kernel/test_voice.py:624 assert stale[\"job_id\"].endswith(\"@\" + read_json(root / \"world.json\")[\"mods\"][\"active\"][EXPRESSION][\"digest\"])");
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:EXPRESSION,["enabled"]:false})],{}));
locks=pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active");
assert.ok(pyBool(pyEqual([pyAt(pyAt(locks,EXPRESSION),"enabled"),pyAt(pyAt(locks,MOD),"enabled")],[false,false])),"tests/kernel/test_voice.py:627 assert (locks[EXPRESSION][\"enabled\"], locks[MOD][\"enabled\"]) == (False, False)");
(await pyMethod(kernel,"table",["player_input"],{"text":"我仔细观察诺特。"}));
assert.ok(pyBool(pyEqual((await job(kernel)),({["job_id"]:null}))),"tests/kernel/test_voice.py:629 assert job(kernel) == {\"job_id\": None}");
assert.ok(pyBool(pyEqual((await job(kernel,({"backfill":true}))),({["job_id"]:null}))),"tests/kernel/test_voice.py:630 assert job(kernel, backfill=True) == {\"job_id\": None}");
paths=[pyDivide(root,"world.json"),(await job_file(root,stale,EXPRESSION))];
before=(await (async()=>{const __rows:any[]=[];for(const path of pyIterable(paths)){__rows.push((await pyMethod(path,"read_bytes",[],{})));}return __rows;})());
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt(stale,"job_id"),VOICE)),"code"),"invalid_params")),"tests/kernel/test_voice.py:634 assert submit_err(kernel, stale[\"job_id\"], VOICE)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["voice.fail",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(stale,"job_id"),["reason"]:"model_error"})],{})),"code"),"invalid_params")),"tests/kernel/test_voice.py:635 assert kernel.err(\"voice.fail\", {\"campaign\": CAMPAIGN, \"job_id\": stale[\"job_id\"], \"reason\": \"model_error\"})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const path of pyIterable(paths)){__rows.push((await pyMethod(path,"read_bytes",[],{})));}return __rows;})()),before)),"tests/kernel/test_voice.py:636 assert [path.read_bytes() for path in paths] == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_with_neither_package_on_the_lane_has_no_owner_and_no_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_with_neither_package_on_the_lane_has_no_owner_and_no_job(await kernel(t,{}),temporary);});
export async function test_an_enabled_unified_package_that_does_not_declare_generation_owns_nothing(kernel:any,tmp_path:any){
let root:any,locks:any;
(await unified_package(kernel,tmp_path,false,undefined));
(await create_campaign(kernel));
(await narrate_opening(kernel));
root=(await campaign_dir(kernel.workspace));
locks=pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active");
assert.ok(pyBool(pyEqual([pyAt(pyAt(locks,EXPRESSION),"version"),pyAt(pyAt(locks,EXPRESSION),"enabled"),pyAt(pyAt(locks,MOD),"enabled")],[UNIFIED_VERSION,true,false])),"tests/kernel/test_voice.py:645 assert (locks[EXPRESSION][\"version\"], locks[EXPRESSION][\"enabled\"], locks[MOD][\"enabled\"]) == (UNIFIED_VERSION, True, False)");
assert.ok(pyBool(pyEqual((await job(kernel,({"backfill":true}))),({["job_id"]:null}))),"tests/kernel/test_voice.py:646 assert job(kernel, backfill=True) == {\"job_id\": None}");
assert.ok(pyBool((await (async()=>{const __left=!pyBool((await pyMethod((pyDivide(root,EXPRESSION)),"exists",[],{})));return pyBool(__left)?!pyBool((await pyMethod((pyDivide(root,MOD)),"exists",[],{}))):__left;})())),"tests/kernel/test_voice.py:647 assert not (root / EXPRESSION).exists() and not (root / MOD).exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_enabled_unified_package_that_does_not_declare_generation_owns_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_enabled_unified_package_that_does_not_declare_generation_owns_nothing(await kernel(t,{}),temporary);});
