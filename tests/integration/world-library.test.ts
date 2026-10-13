// Migrated from tests/kernel/test_library.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,PREGEN,campaign_dir,create_campaign,git_log,narrate,narrate_opening,open_turn,read_json,read_jsonl,resolve,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_library.py',import.meta.url).pathname;









export let SECOND:any="c2";
export async function library_dir(workspace:any){
return pyDivide(pyDivide(workspace,".coc"),"investigators");
}
Object.defineProperty(library_dir,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function sheet_path(workspace:any,campaign_id:any,investigator_id:any){
return pyDivide(pyDivide((await pyInvoke(campaign_dir,[workspace,campaign_id],{})),"party"),`${investigator_id}.json`);
}
Object.defineProperty(sheet_path,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"campaign_id","rest":false,"varargs":false},{"name":"investigator_id","rest":false,"varargs":false}]});
export async function library_rows(workspace:any,campaign_id:any){
return (await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[workspace,campaign_id],{})),"telemetry.jsonl")],{})))){if(pyBool(pyEqual((await pyMethod(r,"get",["lane"],{})),"library"))){__rows.push(r);}}return __rows;})());
}
Object.defineProperty(library_rows,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"campaign_id","rest":false,"varargs":false}]});
export async function without(sheet:any,keys:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(sheet,"items",[],{})))){if(pyBool(!pyContains(keys,k))){__rows.push([k,v]);}}return __rows;})()));
}
Object.defineProperty(without,"__pySignature",{value:[{"name":"sheet","rest":false,"varargs":false},{"name":"keys","rest":false,"varargs":true}]});
export async function save_pregen(kernel:any){
let saved:any;

(await pyInvoke(create_campaign,[kernel],{}));
saved=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(saved,"created")===true);return pyBool(__left)?pyEqual(pyAt(saved,"investigator"),PREGEN):__left})())),"tests/kernel/test_library.py:46 assert saved[\"created\"] is True and saved[\"investigator\"] == PREGEN");
return pyAt(saved,"library_id");
}
Object.defineProperty(save_pregen,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
export async function load_into_new_table(kernel:any,library_id:any,campaign_id:any=SECOND,module:any="the-haunting",params:any={}){
let loaded:any;

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:campaign_id,["module"]:module,["play_language"]:"en"})],{}));
loaded=(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:campaign_id,["library_id"]:library_id,...params})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:campaign_id})],{})),"status"),"ready_for_table")),"tests/kernel/test_library.py:56 assert kernel.ok(\"setup.complete\", {\"campaign\": campaign_id})[\"status\"] == \"ready_for_table\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"ok",["table.open",({["campaign"]:campaign_id})],{})),"campaign"),"status"),"active")),"tests/kernel/test_library.py:57 assert kernel.ok(\"table.open\", {\"campaign\": campaign_id})[\"campaign\"][\"status\"] == \"active\"");
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:campaign_id,["call_id"]:"t0-c1",["text"]:"Opening."})],{}));
return loaded;
}
Object.defineProperty(load_into_new_table,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"library_id","rest":false,"varargs":false},{"name":"campaign_id","rest":false,"varargs":false},{"name":"module","rest":false,"varargs":false},{"name":"params","rest":true,"varargs":false}]});

export async function test_save_mints_a_row_from_the_campaign_sheet_and_marks_the_sheet(kernel:any){
let library_id:any,row:any,on_disk:any,listed:any,again:any;
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["investigator.list"],{})),({["investigators"]:[]}))),"tests/kernel/test_library.py:65 assert kernel.ok(\"investigator.list\") == {\"investigators\": []}");
library_id=(await pyInvoke(save_pregen,[kernel],{}));
assert.ok(pyBool(pyEqual(library_id,"investigator-1")),"tests/kernel/test_library.py:68 assert library_id == \"investigator-1\"");
row=(await pyInvoke(read_json,[pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),`${library_id}.json`)],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[row],{})),["library_id","sheet","origin","play","schema_version"])),"tests/kernel/test_library.py:70 assert list(row) == [\"library_id\", \"sheet\", \"origin\", \"play\", \"schema_version\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"schema_version"),1);return pyBool(__left)?pyEqual(pyAt(row,"library_id"),library_id):__left})())),"tests/kernel/test_library.py:71 assert row[\"schema_version\"] == 1 and row[\"library_id\"] == library_id");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"origin"),({...pyAt(row,"origin"),["created_in"]:CAMPAIGN,["era_at_creation"]:"1920s"}));return pyBool(__left)?pyAt(pyAt(row,"origin"),"created_at"):__left})())),"tests/kernel/test_library.py:72 assert row[\"origin\"] == {**row[\"origin\"], \"created_in\": CAMPAIGN, \"era_at_creation\": \"1920s\"} and row[\"origin\"][\"created_at\"]");
assert.ok(pyBool(pyEqual(pyAt(row,"play"),({...pyAt(row,"play"),["last_campaign"]:CAMPAIGN,["last_turn"]:null,["campaigns"]:[CAMPAIGN]}))),"tests/kernel/test_library.py:74 assert row[\"play\"] == {**row[\"play\"], \"last_campaign\": CAMPAIGN, \"last_turn\": None, \"campaigns\": [CAMPAIGN]}");
assert.ok(pyBool((await (async()=>{const __left=pyAt(pyAt(row,"play"),"last_commit");return pyBool(__left)?pyAt(pyAt(row,"play"),"updated_at"):__left})())),"tests/kernel/test_library.py:75 assert row[\"play\"][\"last_commit\"] and row[\"play\"][\"updated_at\"]");
on_disk=(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,CAMPAIGN,PREGEN],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(on_disk,"origin"),({["library_id"]:library_id}))),"tests/kernel/test_library.py:77 assert on_disk[\"origin\"] == {\"library_id\": library_id}");
assert.ok(pyBool(pyEqual(pyAt(row,"sheet"),on_disk)),"tests/kernel/test_library.py:79 assert row[\"sheet\"] == on_disk");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["investigator.get",({["library_id"]:library_id})],{})),row)),"tests/kernel/test_library.py:80 assert kernel.ok(\"investigator.get\", {\"library_id\": library_id}) == row");
listed=pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators");
assert.ok(pyBool(pyEqual(listed,[({["library_id"]:library_id,["name"]:pyAt(on_disk,"name"),["occupation"]:pyAt(on_disk,"occupation"),["era"]:"1920s",["current_hp"]:pyAt(on_disk,"current_hp"),["current_san"]:pyAt(on_disk,"current_san"),["last_campaign"]:CAMPAIGN,["last_turn"]:null,["updated_at"]:pyAt(pyAt(row,"play"),"updated_at")})])),"tests/kernel/test_library.py:82 assert listed == [{\"library_id\": library_id, \"name\": on_disk[\"name\"], \"occupation\": on_disk[\"occupation\"],\n                       \"era\": \"1920s\", \"current_hp\": on_disk[\"current_hp\"], \"current_san\": on_disk[\"current_san\"],\n                       \"last_campaign\": CAMPAIGN, \"last_turn\": None, \"updated_at\": row[\"play\"][\"updated_at\"]}]");
again=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(again,"library_id"),library_id);return pyBool(__left)?(pyAt(again,"created")===false):__left})())),"tests/kernel/test_library.py:87 assert again[\"library_id\"] == library_id and again[\"created\"] is False");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators"),0),"library_id"),library_id)),"tests/kernel/test_library.py:88 assert kernel.ok(\"investigator.list\")[\"investigators\"][0][\"library_id\"] == library_id");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyInvoke(pyList,[(await pyMethod((await pyInvoke(library_dir,[kernel.workspace],{})),"glob",["*.json"],{}))],{}))],{})),1)),"tests/kernel/test_library.py:89 assert len(list(library_dir(kernel.workspace).glob(\"*.json\"))) == 1");
}
Object.defineProperty(test_save_mints_a_row_from_the_campaign_sheet_and_marks_the_sheet,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_save_mints_a_row_from_the_campaign_sheet_and_marks_the_sheet"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_save_mints_a_row_from_the_campaign_sheet_and_marks_the_sheet(await kernel(t,{}));});
export async function test_load_copies_the_sheet_byte_for_byte_except_id_and_origin(kernel:any){
let library_id:any,source:any,loaded:any,new_id:any,copied:any,meta:any,receipt:any,completed:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
source=(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,CAMPAIGN,PREGEN],{}))],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:SECOND,["module"]:"the-haunting",["play_language"]:"en"})],{}));
loaded=(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:SECOND,["library_id"]:library_id})],{}));
new_id=pyAt(pyAt(loaded,"investigator"),"id");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(new_id,"inv-1");return pyBool(__left)?pyEqual(pyAt(loaded,"library_id"),library_id):__left})());return pyBool(__left)?pyEqual(pyAt(loaded,"loaded_at_turn"),0):__left})())),"tests/kernel/test_library.py:98 assert new_id == \"inv-1\" and loaded[\"library_id\"] == library_id and loaded[\"loaded_at_turn\"] == 0");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(loaded,"forked_from")===null);return pyBool(__left)?pyEqual(pyAt(loaded,"receipt"),`investigator:${new_id}`):__left})())),"tests/kernel/test_library.py:99 assert loaded[\"forked_from\"] is None and loaded[\"receipt\"] == f\"investigator:{new_id}\"");
copied=(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,SECOND,new_id],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(copied,"id"),new_id)),"tests/kernel/test_library.py:101 assert copied[\"id\"] == new_id");
assert.ok(pyBool(pyEqual(pyAt(copied,"origin"),({["library_id"]:library_id,["loaded_at_turn"]:0}))),"tests/kernel/test_library.py:102 assert copied[\"origin\"] == {\"library_id\": library_id, \"loaded_at_turn\": 0}");
assert.ok(pyBool(pyEqual((await pyInvoke(without,[copied,"id","origin"],{})),(await pyInvoke(without,[source,"id","origin"],{})))),"tests/kernel/test_library.py:103 assert without(copied, \"id\", \"origin\") == without(source, \"id\", \"origin\")");
assert.ok(pyBool(pyEqual((await pyMethod(json,"dumps",[(await pyInvoke(without,[copied,"id","origin"],{}))],{"ensure_ascii":false})),(await pyMethod(json,"dumps",[(await pyInvoke(without,[source,"id","origin"],{}))],{"ensure_ascii":false})))),"tests/kernel/test_library.py:105 assert json.dumps(without(copied, \"id\", \"origin\"), ensure_ascii=False) == json.dumps(without(source, \"id\", \"origin\"), ensure_ascii=False)");
assert.ok(pyBool(pyEqual(pyAt(loaded,"sheet"),copied)),"tests/kernel/test_library.py:106 assert loaded[\"sheet\"] == copied");
meta=(await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[kernel.workspace,SECOND],{})),"campaign.json")],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"investigators"),[new_id])),"tests/kernel/test_library.py:108 assert meta[\"investigators\"] == [new_id]");
receipt=pyAt(pyAt(pyAt(meta,"setup"),"receipts"),(-1));
assert.ok(pyBool(pyEqual(receipt,({...receipt,["id"]:`investigator:${new_id}`,["kind"]:"investigator",["source"]:"library",["library_id"]:library_id,["forked_from"]:null}))),"tests/kernel/test_library.py:110 assert receipt == {**receipt, \"id\": f\"investigator:{new_id}\", \"kind\": \"investigator\", \"source\": \"library\",\n                       \"library_id\": library_id, \"forked_from\": None}");
completed=pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:SECOND})],{})),"completed");
assert.ok(pyBool((await (async()=>{const __left=pyContains(completed,"browse-library");return pyBool(__left)?pyContains(completed,"load-investigator"):__left})())),"tests/kernel/test_library.py:118 assert \"browse-library\" in completed and \"load-investigator\" in completed");
assert.ok(pyBool(!pyContains(completed,"create-investigator")),"tests/kernel/test_library.py:119 assert \"create-investigator\" not in completed");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:SECOND})],{})),"investigators"),[new_id])),"tests/kernel/test_library.py:120 assert kernel.ok(\"setup.complete\", {\"campaign\": SECOND})[\"investigators\"] == [new_id]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["table.open",({["campaign"]:SECOND})],{})),"investigators"),0),"id"),new_id)),"tests/kernel/test_library.py:121 assert kernel.ok(\"table.open\", {\"campaign\": SECOND})[\"investigators\"][0][\"id\"] == new_id");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"ok",["investigator.get",({["library_id"]:library_id})],{})),"play"),"last_campaign"),CAMPAIGN)),"tests/kernel/test_library.py:123 assert kernel.ok(\"investigator.get\", {\"library_id\": library_id})[\"play\"][\"last_campaign\"] == CAMPAIGN");
}
Object.defineProperty(test_load_copies_the_sheet_byte_for_byte_except_id_and_origin,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_load_copies_the_sheet_byte_for_byte_except_id_and_origin"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_load_copies_the_sheet_byte_for_byte_except_id_and_origin(await kernel(t,{}));});
export async function test_unknown_row_is_unknown_entity_with_the_candidates(kernel:any){
let library_id:any,error:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
error=(await pyMethod(kernel,"err",["investigator.get",({["library_id"]:"nobody-1"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"unknown_entity");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"candidates"),[library_id]):__left})())),"tests/kernel/test_library.py:129 assert error[\"code\"] == \"unknown_entity\" and error[\"details\"][\"candidates\"] == [library_id]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["investigator.load",({["campaign"]:CAMPAIGN,["library_id"]:"nobody-1"})],{})),"code"),"unknown_entity")),"tests/kernel/test_library.py:130 assert kernel.err(\"investigator.load\", {\"campaign\": CAMPAIGN, \"library_id\": \"nobody-1\"})[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["investigator.load",({["campaign"]:"nope",["library_id"]:library_id})],{})),"code"),"campaign_not_found")),"tests/kernel/test_library.py:131 assert kernel.err(\"investigator.load\", {\"campaign\": \"nope\", \"library_id\": library_id})[\"code\"] == \"campaign_not_found\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["investigator.get",({})],{})),"code"),"invalid_params")),"tests/kernel/test_library.py:132 assert kernel.err(\"investigator.get\", {})[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_unknown_row_is_unknown_entity_with_the_candidates,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_row_is_unknown_entity_with_the_candidates"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_row_is_unknown_entity_with_the_candidates(await kernel(t,{}));});
export async function test_load_waits_for_the_keeper_to_finish_acting(kernel:any){
let library_id:any,refused:any,loaded:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:SECOND,["module"]:"the-haunting",["pregen"]:PREGEN})],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t0-c1",["text"]:"开场。"})],{}));
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I look."})],{}));
refused=(await pyMethod(kernel,"err",["investigator.load",({["campaign"]:SECOND,["library_id"]:library_id})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"state"),"open"):__left})())),"tests/kernel/test_library.py:141 assert refused[\"code\"] == \"turn_state\" and refused[\"details\"][\"state\"] == \"open\"");
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t1-c1",["text"]:"没什么。"})],{}));
loaded=(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:SECOND,["library_id"]:library_id})],{}));
assert.ok(pyBool(pyEqual(pyAt(loaded,"loaded_at_turn"),2)),"tests/kernel/test_library.py:145 assert loaded[\"loaded_at_turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(loaded,"investigator"),"id"),"inv-2")),"tests/kernel/test_library.py:147 assert loaded[\"investigator\"][\"id\"] == \"inv-2\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt((await pyMethod(kernel,"ok",["table.open",({["campaign"]:SECOND})],{})),"investigators"))){__rows.push(pyAt(s,"id"));}return __rows;})()),["inv-2",PREGEN])),"tests/kernel/test_library.py:148 assert [s[\"id\"] for s in kernel.ok(\"table.open\", {\"campaign\": SECOND})[\"investigators\"]] == [\"inv-2\", PREGEN]");
}
Object.defineProperty(test_load_waits_for_the_keeper_to_finish_acting,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_load_waits_for_the_keeper_to_finish_acting"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_load_waits_for_the_keeper_to_finish_acting(await kernel(t,{}));});

export async function test_a_card_of_the_modules_own_era_carries_no_hint(kernel:any){
let library_id:any,loaded:any,capsule:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
loaded=(await pyInvoke(load_into_new_table,[kernel,library_id],{"module":"the-haunting"}));
assert.ok(pyBool((pyAt(loaded,"era_mismatch")===null)),"tests/kernel/test_library.py:156 assert loaded[\"era_mismatch\"] is None");
assert.ok(pyBool(!pyContains((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[kernel.workspace,SECOND],{})),"campaign.json")],{})),"era_mismatch")),"tests/kernel/test_library.py:157 assert \"era_mismatch\" not in read_json(campaign_dir(kernel.workspace, SECOND) / \"campaign.json\")");
capsule=pyAt((await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I look around."})],{})),"capsule");
assert.ok(pyBool(!pyContains(pyAt(pyAt(capsule,"known"),"investigator"),"era_note")),"tests/kernel/test_library.py:159 assert \"era_note\" not in capsule[\"known\"][\"investigator\"]");
}
Object.defineProperty(test_a_card_of_the_modules_own_era_carries_no_hint,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_card_of_the_modules_own_era_carries_no_hint"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_card_of_the_modules_own_era_carries_no_hint(await kernel(t,{}));});

export async function test_three_committed_turns_move_the_row_and_last_turn_tracks_them(seeded_kernel:any){
let kernel:any,library_id:any,sheet:any,row_path:any,opening:any,hp0:any,san0:any,first:any,row1:any,second:any,row2:any,third:any,row3:any;
kernel=seeded_kernel;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{}));
sheet=(await pyInvoke(sheet_path,[kernel.workspace,SECOND,"inv-1"],{}));
row_path=pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),`${library_id}.json`);
async function after_turn(n:any,commit:any){
let row:any;
row=(await pyInvoke(read_json,[row_path],{}));
assert.ok(pyBool(pyEqual(pyAt(row,"sheet"),(await pyInvoke(read_json,[sheet],{})))),pyStr(`turn ${n}: the row is the campaign sheet`));
assert.ok(pyBool(pyEqual(pyAt(row,"play"),({...pyAt(row,"play"),["last_campaign"]:SECOND,["last_turn"]:n,["last_commit"]:commit,["campaigns"]:[CAMPAIGN,SECOND]}))),"tests/kernel/test_library.py:174 assert row[\"play\"] == {**row[\"play\"], \"last_campaign\": SECOND, \"last_turn\": n, \"last_commit\": commit,\n                               \"campaigns\": [CAMPAIGN, SECOND]}");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})),(-1)),({...pyAt((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})),(-1)),["turn"]:n,["investigator"]:"inv-1",["library_id"]:library_id,["ok"]:true}))),"tests/kernel/test_library.py:176 assert library_rows(kernel.workspace, SECOND)[-1] == {\n            **library_rows(kernel.workspace, SECOND)[-1], \"turn\": n, \"investigator\": \"inv-1\",\n            \"library_id\": library_id, \"ok\": True}");
return row;
}
Object.defineProperty(after_turn,"__pySignature",{value:[{"name":"n","rest":false,"varargs":false},{"name":"commit","rest":false,"varargs":false}]});
opening=(await pyInvoke(read_json,[row_path],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(opening,"play"),"last_turn"),0);return pyBool(__left)?pyEqual(pyAt(pyAt(opening,"play"),"last_campaign"),SECOND):__left})())),"tests/kernel/test_library.py:183 assert opening[\"play\"][\"last_turn\"] == 0 and opening[\"play\"][\"last_campaign\"] == SECOND");
const __unpack10530=[pyAt(pyAt(opening,"sheet"),"current_hp"),pyAt(pyAt(opening,"sheet"),"current_san")];hp0=__unpack10530[0];san0=__unpack10530[1];
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I climb the ladder."})],{}));
(await pyMethod(kernel,"ok",["table.apply",({["campaign"]:SECOND,["call_id"]:"t1-c1",["effects"]:[({["kind"]:"damage",["dice"]:"1D3",["why"]:"a fall"})]})],{}));
first=(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t1-c2",["text"]:"You fall."})],{}));
row1=(await pyInvoke(after_turn,[1,pyAt(first,"commit")],{}));
assert.ok(pyBool(pyLess(pyAt(pyAt(row1,"sheet"),"current_hp"),hp0)),"tests/kernel/test_library.py:192 assert row1[\"sheet\"][\"current_hp\"] < hp0");
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I look at the thing in the crater."})],{}));
(await pyMethod(kernel,"ok",["table.resolve",({["campaign"]:SECOND,["call_id"]:"t2-c1",["action"]:({["intent"]:"investigate",["goal"]:"the thing in the crater",["method"]:"",["decision"]:"sanity:check",["san_loss"]:"1/1D3",["involuntary"]:"freeze"})})],{}));
second=(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t2-c2",["text"]:"It moves."})],{}));
row2=(await pyInvoke(after_turn,[2,pyAt(second,"commit")],{}));
assert.ok(pyBool(pyLess(pyAt(pyAt(row2,"sheet"),"current_san"),san0)),"tests/kernel/test_library.py:201 assert row2[\"sheet\"][\"current_san\"] < san0");
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait."})],{}));
third=(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t3-c1",["text"]:"Time passes."})],{}));
row3=(await pyInvoke(after_turn,[3,pyAt(third,"commit")],{}));
assert.ok(pyBool(pyEqual(pyAt(row3,"sheet"),pyAt(row2,"sheet"))),"tests/kernel/test_library.py:207 assert row3[\"sheet\"] == row2[\"sheet\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})))){__rows.push(pyAt(r,"turn"));}return __rows;})()),[0,1,2,3])),"tests/kernel/test_library.py:208 assert [r[\"turn\"] for r in library_rows(kernel.workspace, SECOND)] == [0, 1, 2, 3]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators"),0),({...pyAt(pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators"),0),["last_campaign"]:SECOND,["last_turn"]:3,["current_hp"]:pyAt(pyAt(row3,"sheet"),"current_hp"),["current_san"]:pyAt(pyAt(row3,"sheet"),"current_san")}))),"tests/kernel/test_library.py:209 assert kernel.ok(\"investigator.list\")[\"investigators\"][0] == {\n        **kernel.ok(\"investigator.list\")[\"investigators\"][0], \"last_campaign\": SECOND, \"last_turn\": 3,\n        \"current_hp\": row3[\"sheet\"][\"current_hp\"], \"current_san\": row3[\"sheet\"][\"current_san\"]}");
}
Object.defineProperty(test_three_committed_turns_move_the_row_and_last_turn_tracks_them,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_three_committed_turns_move_the_row_and_last_turn_tracks_them"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_three_committed_turns_move_the_row_and_last_turn_tracks_them(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_the_campaign_is_authority_and_the_library_only_a_mirror(kernel:any){
let library_id:any,row_path:any,sheet:any,row:any,before:any,mirrored:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{}));
row_path=pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),`${library_id}.json`);
sheet=(await pyInvoke(sheet_path,[kernel.workspace,SECOND,"inv-1"],{}));
row=(await pyInvoke(read_json,[row_path],{}));
pyAt(row,"sheet")["current_hp"]=1;
pyAt(pyAt(row,"sheet"),"skills")["Spot Hidden"]=99;
(await pyMethod(row_path,"write_text",[(await pyMethod(json,"dumps",[row],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
before=(await pyMethod(sheet,"read_bytes",[],{}));
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait."})],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t1-c1",["text"]:"Time passes."})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(sheet,"read_bytes",[],{})),before)),"tests/kernel/test_library.py:228 assert sheet.read_bytes() == before");
mirrored=(await pyInvoke(read_json,[row_path],{}));
assert.ok(pyBool(pyEqual(pyAt(mirrored,"sheet"),(await pyInvoke(read_json,[sheet],{})))),"tests/kernel/test_library.py:230 assert mirrored[\"sheet\"] == read_json(sheet)");
assert.ok(pyBool((await (async()=>{const __left=!pyEqual(pyAt(pyAt(mirrored,"sheet"),"current_hp"),1);return pyBool(__left)?!pyEqual(pyAt(pyAt(pyAt(mirrored,"sheet"),"skills"),"Spot Hidden"),99):__left})())),"tests/kernel/test_library.py:231 assert mirrored[\"sheet\"][\"current_hp\"] != 1 and mirrored[\"sheet\"][\"skills\"][\"Spot Hidden\"] != 99");
}
Object.defineProperty(test_the_campaign_is_authority_and_the_library_only_a_mirror,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_campaign_is_authority_and_the_library_only_a_mirror"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_campaign_is_authority_and_the_library_only_a_mirror(await kernel(t,{}));});
export async function test_one_card_at_two_tables_last_writer_wins_and_provenance_says_who(kernel:any){
let library_id:any,row_path:any,row:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{"campaign_id":"c2"}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{"campaign_id":"c3"}));
row_path=pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),`${library_id}.json`);
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[row_path],{})),"play"),({...pyAt((await pyInvoke(read_json,[row_path],{})),"play"),["last_campaign"]:"c3",["last_turn"]:0,["campaigns"]:[CAMPAIGN,"c2","c3"]}))),"tests/kernel/test_library.py:239 assert read_json(row_path)[\"play\"] == {**read_json(row_path)[\"play\"], \"last_campaign\": \"c3\", \"last_turn\": 0,\n                                           \"campaigns\": [CAMPAIGN, \"c2\", \"c3\"]}");
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:"c2",["text"]:"I wait."})],{}));
(await pyMethod(kernel,"ok",["table.apply",({["campaign"]:"c2",["call_id"]:"t1-c1",["effects"]:[({["kind"]:"damage",["dice"]:"1D3"})]})],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:"c2",["call_id"]:"t1-c2",["text"]:"Ouch."})],{}));
row=(await pyInvoke(read_json,[row_path],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(row,"play"),"last_campaign"),"c2");return pyBool(__left)?pyEqual(pyAt(pyAt(row,"play"),"last_turn"),1):__left})())),"tests/kernel/test_library.py:245 assert row[\"play\"][\"last_campaign\"] == \"c2\" and row[\"play\"][\"last_turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(row,"sheet"),(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,"c2","inv-1"],{}))],{})))),"tests/kernel/test_library.py:246 assert row[\"sheet\"] == read_json(sheet_path(kernel.workspace, \"c2\", \"inv-1\"))");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,"c3","inv-1"],{}))],{})),"current_hp"),pyAt((await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,CAMPAIGN,PREGEN],{}))],{})),"current_hp"))),"tests/kernel/test_library.py:248 assert read_json(sheet_path(kernel.workspace, \"c3\", \"inv-1\"))[\"current_hp\"] == read_json(sheet_path(kernel.workspace, CAMPAIGN, PREGEN))[\"current_hp\"]");
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:"c3",["text"]:"I wait."})],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:"c3",["call_id"]:"t1-c1",["text"]:"Quiet."})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(read_json,[row_path],{})),"play"),"campaigns"),[CAMPAIGN,"c2","c3"])),"tests/kernel/test_library.py:252 assert read_json(row_path)[\"play\"][\"campaigns\"] == [CAMPAIGN, \"c2\", \"c3\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(read_json,[row_path],{})),"play"),"last_campaign"),"c3")),"tests/kernel/test_library.py:253 assert read_json(row_path)[\"play\"][\"last_campaign\"] == \"c3\"");
}
Object.defineProperty(test_one_card_at_two_tables_last_writer_wins_and_provenance_says_who,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_one_card_at_two_tables_last_writer_wins_and_provenance_says_who"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_one_card_at_two_tables_last_writer_wins_and_provenance_says_who(await kernel(t,{}));});
export async function test_as_loads_a_double_as_a_second_person_with_its_own_row(kernel:any){
let library_id:any,loaded:any,copied:any,source:any,fork:any,original:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:SECOND,["module"]:"the-haunting",["play_language"]:"en"})],{}));
loaded=(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:SECOND,["library_id"]:library_id,["as"]:"Tom Hayes"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(loaded,"library_id"),"tom-hayes-1");return pyBool(__left)?pyEqual(pyAt(loaded,"forked_from"),library_id):__left})())),"tests/kernel/test_library.py:260 assert loaded[\"library_id\"] == \"tom-hayes-1\" and loaded[\"forked_from\"] == library_id");
assert.ok(pyBool(pyEqual(pyAt(loaded,"investigator"),({...pyAt(loaded,"investigator"),["id"]:"tom-hayes",["name"]:"Tom Hayes"}))),"tests/kernel/test_library.py:261 assert loaded[\"investigator\"] == {**loaded[\"investigator\"], \"id\": \"tom-hayes\", \"name\": \"Tom Hayes\"}");
copied=(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,SECOND,"tom-hayes"],{}))],{}));
source=(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,CAMPAIGN,PREGEN],{}))],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(without,[copied,"id","origin","name"],{})),(await pyInvoke(without,[source,"id","origin","name"],{})))),"tests/kernel/test_library.py:264 assert without(copied, \"id\", \"origin\", \"name\") == without(source, \"id\", \"origin\", \"name\")");
assert.ok(pyBool(pyEqual(pyAt(copied,"origin"),({["library_id"]:"tom-hayes-1",["loaded_at_turn"]:0}))),"tests/kernel/test_library.py:265 assert copied[\"origin\"] == {\"library_id\": \"tom-hayes-1\", \"loaded_at_turn\": 0}");
fork=(await pyMethod(kernel,"ok",["investigator.get",({["library_id"]:"tom-hayes-1"})],{}));
assert.ok(pyBool(pyEqual(pyAt(fork,"origin"),({...pyAt(fork,"origin"),["created_in"]:SECOND,["forked_from"]:library_id,["era_at_creation"]:"1920s"}))),"tests/kernel/test_library.py:267 assert fork[\"origin\"] == {**fork[\"origin\"], \"created_in\": SECOND, \"forked_from\": library_id, \"era_at_creation\": \"1920s\"}");
assert.ok(pyBool(pyEqual(pyAt(fork,"play"),({...pyAt(fork,"play"),["last_campaign"]:SECOND,["last_turn"]:null,["last_commit"]:null,["campaigns"]:[SECOND]}))),"tests/kernel/test_library.py:268 assert fork[\"play\"] == {**fork[\"play\"], \"last_campaign\": SECOND, \"last_turn\": None, \"last_commit\": None, \"campaigns\": [SECOND]}");
assert.ok(pyBool(pyEqual(pyAt(fork,"sheet"),copied)),"tests/kernel/test_library.py:269 assert fork[\"sheet\"] == copied");
original=(await pyMethod(kernel,"ok",["investigator.get",({["library_id"]:library_id})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(original,"sheet"),"name"),pyAt(source,"name"));return pyBool(__left)?pyEqual(pyAt(pyAt(original,"play"),"last_campaign"),CAMPAIGN):__left})())),"tests/kernel/test_library.py:272 assert original[\"sheet\"][\"name\"] == source[\"name\"] and original[\"play\"][\"last_campaign\"] == CAMPAIGN");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators"))){__rows.push(pyAt(r,"library_id"));}return __rows;})())),new Set([library_id,"tom-hayes-1"]))),"tests/kernel/test_library.py:273 assert {r[\"library_id\"] for r in kernel.ok(\"investigator.list\")[\"investigators\"]} == {library_id, \"tom-hayes-1\"}");
}
Object.defineProperty(test_as_loads_a_double_as_a_second_person_with_its_own_row,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_as_loads_a_double_as_a_second_person_with_its_own_row"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_as_loads_a_double_as_a_second_person_with_its_own_row(await kernel(t,{}));});

export async function test_a_read_only_library_leaves_the_turn_committed_and_a_telemetry_row(kernel:any){
let library_id:any,root:any,row_path:any,before:any,mode:any,result:any,failed:any,error:any,third:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{}));
root=(await pyInvoke(library_dir,[kernel.workspace],{}));
row_path=pyDivide(root,`${library_id}.json`);
before=(await pyMethod(row_path,"read_bytes",[],{}));
mode=(await pyMethod(stat,"S_IMODE",[(await pyMethod(root,"stat",[],{})).st_mode],{}));
(await pyMethod(os,"chmod",[root,pyUnion(stat.S_IRUSR,stat.S_IXUSR)],{}));
try{(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait."})],{}));
result=(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t1-c1",["text"]:"Quiet."})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(result,"commit");return pyBool(__left)?(await pyMethod(pyAt((await pyInvoke(git_log,[kernel.workspace,SECOND],{})),0),"startswith",["turn 1:"],{})):__left})())),"tests/kernel/test_library.py:290 assert result[\"commit\"] and git_log(kernel.workspace, SECOND)[0].startswith(\"turn 1:\")");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[kernel.workspace,SECOND],{})),"turn.json")],{})),"turn"),2)),"tests/kernel/test_library.py:291 assert read_json(campaign_dir(kernel.workspace, SECOND) / \"turn.json\")[\"turn\"] == 2");
failed=pyAt((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})),(-1));
assert.ok(pyBool(pyEqual(failed,({...failed,["turn"]:1,["library_id"]:library_id,["investigator"]:"inv-1",["ok"]:false,["reason"]:"library_unwritable"}))),"tests/kernel/test_library.py:293 assert failed == {**failed, \"turn\": 1, \"library_id\": library_id, \"investigator\": \"inv-1\", \"ok\": False,\n                          \"reason\": \"library_unwritable\"}");
assert.ok(pyBool(pyContains(pyAt(failed,"error"),"cannot write")),"tests/kernel/test_library.py:295 assert \"cannot write\" in failed[\"error\"]");
assert.ok(pyBool(pyEqual((await pyMethod(row_path,"read_bytes",[],{})),before)),"tests/kernel/test_library.py:296 assert row_path.read_bytes() == before");
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait more."})],{}));
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t2-c1",["text"]:"Still quiet."})],{})),"commit")),"tests/kernel/test_library.py:299 assert kernel.ok(\"table.narrate\", {\"campaign\": SECOND, \"call_id\": \"t2-c1\", \"text\": \"Still quiet.\"})[\"commit\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})))){__rows.push(pyAt(r,"ok"));}return __rows;})()),[true,false,false])),"tests/kernel/test_library.py:300 assert [r[\"ok\"] for r in library_rows(kernel.workspace, SECOND)] == [True, False, False]");
error=(await pyMethod(kernel,"err",["investigator.save",({["campaign"]:SECOND})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"internal");return pyBool(__left)?pyEqual(pyAt(error,"code_detail"),"library_unwritable"):__left})())),"tests/kernel/test_library.py:303 assert error[\"code\"] == \"internal\" and error[\"code_detail\"] == \"library_unwritable\"");}finally{(await pyMethod(os,"chmod",[root,mode],{}));}
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait again."})],{}));
third=(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t3-c1",["text"]:"Dawn."})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[row_path],{})),"play"),({...pyAt((await pyInvoke(read_json,[row_path],{})),"play"),["last_turn"]:3,["last_commit"]:pyAt(third,"commit")}))),"tests/kernel/test_library.py:309 assert read_json(row_path)[\"play\"] == {**read_json(row_path)[\"play\"], \"last_turn\": 3, \"last_commit\": third[\"commit\"]}");
}
Object.defineProperty(test_a_read_only_library_leaves_the_turn_committed_and_a_telemetry_row,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_read_only_library_leaves_the_turn_committed_and_a_telemetry_row"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_read_only_library_leaves_the_turn_committed_and_a_telemetry_row(await kernel(t,{}));});
export async function test_a_row_the_kernel_cannot_read_is_a_conflict_and_is_left_alone(kernel:any){
let library_id:any,row_path:any,failed:any,error:any,listed:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{}));
row_path=pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),`${library_id}.json`);
(await pyMethod(row_path,"write_text",["{not json"],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait."})],{}));
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t1-c1",["text"]:"Quiet."})],{})),"commit")),"tests/kernel/test_library.py:318 assert kernel.ok(\"table.narrate\", {\"campaign\": SECOND, \"call_id\": \"t1-c1\", \"text\": \"Quiet.\"})[\"commit\"]");
failed=pyAt((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})),(-1));
assert.ok(pyBool(pyEqual(failed,({...failed,["turn"]:1,["ok"]:false,["reason"]:"library_conflict"}))),"tests/kernel/test_library.py:320 assert failed == {**failed, \"turn\": 1, \"ok\": False, \"reason\": \"library_conflict\"}");
assert.ok(pyBool(pyEqual((await pyMethod(row_path,"read_text",[],{"encoding":"utf-8"})),"{not json")),"tests/kernel/test_library.py:321 assert row_path.read_text(encoding=\"utf-8\") == \"{not json\"");
error=(await pyMethod(kernel,"err",["investigator.get",({["library_id"]:library_id})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"internal");return pyBool(__left)?pyEqual(pyAt(error,"code_detail"),"library_conflict"):__left})())),"tests/kernel/test_library.py:323 assert error[\"code\"] == \"internal\" and error[\"code_detail\"] == \"library_conflict\"");
listed=(await pyMethod(kernel,"ok",["investigator.list"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(listed,"investigators"),[]);return pyBool(__left)?pyEqual(pyAt(listed,"unreadable"),[library_id]):__left})())),"tests/kernel/test_library.py:325 assert listed[\"investigators\"] == [] and listed[\"unreadable\"] == [library_id]");
(await pyMethod(row_path,"write_text",[(await pyMethod(json,"dumps",[({["library_id"]:library_id,["sheet"]:({}),["schema_version"]:2})],{}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["investigator.get",({["library_id"]:library_id})],{})),"code_detail"),"library_conflict")),"tests/kernel/test_library.py:328 assert kernel.err(\"investigator.get\", {\"library_id\": library_id})[\"code_detail\"] == \"library_conflict\"");
(await pyMethod(row_path,"write_text",[(await pyMethod(json,"dumps",[({["library_id"]:"someone-else-1",["sheet"]:({}),["schema_version"]:1})],{}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["investigator.get",({["library_id"]:library_id})],{})),"code_detail"),"library_conflict")),"tests/kernel/test_library.py:330 assert kernel.err(\"investigator.get\", {\"library_id\": library_id})[\"code_detail\"] == \"library_conflict\"");
}
Object.defineProperty(test_a_row_the_kernel_cannot_read_is_a_conflict_and_is_left_alone,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_row_the_kernel_cannot_read_is_a_conflict_and_is_left_alone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_row_the_kernel_cannot_read_is_a_conflict_and_is_left_alone(await kernel(t,{}));});
export async function test_a_row_that_went_missing_is_recreated_from_the_campaign(kernel:any){
let library_id:any,row_path:any,row:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyInvoke(load_into_new_table,[kernel,library_id],{}));
row_path=pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),`${library_id}.json`);
(await pyMethod(row_path,"unlink",[],{}));
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:SECOND,["text"]:"I wait."})],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:SECOND,["call_id"]:"t1-c1",["text"]:"Quiet."})],{}));
row=(await pyInvoke(read_json,[row_path],{}));
assert.ok(pyBool(pyEqual(pyAt(row,"sheet"),(await pyInvoke(read_json,[(await pyInvoke(sheet_path,[kernel.workspace,SECOND,"inv-1"],{}))],{})))),"tests/kernel/test_library.py:341 assert row[\"sheet\"] == read_json(sheet_path(kernel.workspace, SECOND, \"inv-1\"))");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(row,"origin"),"created_in"),SECOND);return pyBool(__left)?pyEqual(pyAt(pyAt(row,"play"),"campaigns"),[SECOND]):__left})())),"tests/kernel/test_library.py:342 assert row[\"origin\"][\"created_in\"] == SECOND and row[\"play\"][\"campaigns\"] == [SECOND]");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(library_rows,[kernel.workspace,SECOND],{})),(-1)),"ok")===true)),"tests/kernel/test_library.py:343 assert library_rows(kernel.workspace, SECOND)[-1][\"ok\"] is True");
}
Object.defineProperty(test_a_row_that_went_missing_is_recreated_from_the_campaign,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_row_that_went_missing_is_recreated_from_the_campaign"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_row_that_went_missing_is_recreated_from_the_campaign(await kernel(t,{}));});
export async function test_cards_without_an_origin_are_never_written_back(kernel:any){
(await pyInvoke(open_turn,[kernel],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c1",["text"]:"没事。"})],{}));
assert.ok(pyBool(!pyBool((await pyMethod((await pyInvoke(library_dir,[kernel.workspace],{})),"exists",[],{})))),"tests/kernel/test_library.py:349 assert not library_dir(kernel.workspace).exists()");
assert.ok(pyBool(pyEqual((await pyInvoke(library_rows,[kernel.workspace,CAMPAIGN],{})),[])),"tests/kernel/test_library.py:350 assert library_rows(kernel.workspace, CAMPAIGN) == []");
}
Object.defineProperty(test_cards_without_an_origin_are_never_written_back,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cards_without_an_origin_are_never_written_back"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cards_without_an_origin_are_never_written_back(await kernel(t,{}));});

export async function test_library_ids_are_slug_plus_ordinal_deterministic_and_collision_free(kernel:any){
let n:any,cid:any,saved:any,ids:any;
for(n of pyIterable([1,2,3])){
cid=`ada${n}`;
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:cid,["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:cid,["name"]:"Ada Lovelace",["occupation"]:"Journalist",["seed"]:"1"})],{}));
saved=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:cid})],{}));
assert.ok(pyBool(pyEqual(pyAt(saved,"library_id"),`ada-lovelace-${n}`)),pyStr("one name, ascending ordinals"));
}
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"z",["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:"z",["name"]:"Zoë O'Brien-Núñez",["occupation"]:"Artist",["seed"]:"1"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:"z"})],{})),"library_id"),"zoe-o-brien-nunez-1")),"tests/kernel/test_library.py:365 assert kernel.ok(\"investigator.save\", {\"campaign\": \"z\"})[\"library_id\"] == \"zoe-o-brien-nunez-1\"");
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"h",["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:"h",["name"]:"王小明",["occupation"]:"Artist",["seed"]:"1"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:"h"})],{})),"library_id"),"investigator-1")),"tests/kernel/test_library.py:368 assert kernel.ok(\"investigator.save\", {\"campaign\": \"h\"})[\"library_id\"] == \"investigator-1\"");
(await pyMethod((pyDivide((await pyInvoke(library_dir,[kernel.workspace],{})),"ada-lovelace-7.json")),"write_text",["{}"],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"ada4",["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:"ada4",["name"]:"Ada Lovelace",["occupation"]:"Journalist",["seed"]:"1"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:"ada4"})],{})),"library_id"),"ada-lovelace-8")),"tests/kernel/test_library.py:373 assert kernel.ok(\"investigator.save\", {\"campaign\": \"ada4\"})[\"library_id\"] == \"ada-lovelace-8\"");
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"ada5",["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:"ada5",["name"]:"Ada Lovelace 2",["occupation"]:"Journalist",["seed"]:"1"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:"ada5"})],{})),"library_id"),"ada-lovelace-2-1")),"tests/kernel/test_library.py:377 assert kernel.ok(\"investigator.save\", {\"campaign\": \"ada5\"})[\"library_id\"] == \"ada-lovelace-2-1\"");
ids=new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators"))){__rows.push(pyAt(r,"library_id"));}return __rows;})()));
assert.ok(pyBool(pyEqual(ids,new Set(["ada-lovelace-1","ada-lovelace-2","ada-lovelace-3","ada-lovelace-8","ada-lovelace-2-1","zoe-o-brien-nunez-1","investigator-1"]))),"tests/kernel/test_library.py:379 assert ids == {\"ada-lovelace-1\", \"ada-lovelace-2\", \"ada-lovelace-3\", \"ada-lovelace-8\", \"ada-lovelace-2-1\",\n                   \"zoe-o-brien-nunez-1\", \"investigator-1\"}");
}
Object.defineProperty(test_library_ids_are_slug_plus_ordinal_deterministic_and_collision_free,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_library_ids_are_slug_plus_ordinal_deterministic_and_collision_free"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_library_ids_are_slug_plus_ordinal_deterministic_and_collision_free(await kernel(t,{}));});
export async function test_list_is_newest_first_and_save_names_the_card_at_a_larger_table(kernel:any){
let library_id:any,choice:any,saved:any,by_id:any,listed:any;
library_id=(await pyInvoke(save_pregen,[kernel],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:SECOND,["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:SECOND,["name"]:"Ada Lovelace",["occupation"]:"Journalist",["seed"]:"1"})],{}));
(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:SECOND,["library_id"]:library_id})],{}));
choice=(await pyMethod(kernel,"err",["investigator.save",({["campaign"]:SECOND})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(choice,"code"),"needs_choice");return pyBool(__left)?pyEqual((await pyInvoke(pyLen,[pyAt(pyAt(choice,"details"),"candidates")],{})),2):__left})())),"tests/kernel/test_library.py:390 assert choice[\"code\"] == \"needs_choice\" and len(choice[\"details\"][\"candidates\"]) == 2");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["investigator.save",({["campaign"]:SECOND,["investigator"]:"nobody"})],{})),"code"),"unknown_entity")),"tests/kernel/test_library.py:391 assert kernel.err(\"investigator.save\", {\"campaign\": SECOND, \"investigator\": \"nobody\"})[\"code\"] == \"unknown_entity\"");
saved=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:SECOND,["investigator"]:"Ada Lovelace"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(saved,"library_id"),"ada-lovelace-1");return pyBool(__left)?(pyAt(saved,"created")===true):__left})())),"tests/kernel/test_library.py:393 assert saved[\"library_id\"] == \"ada-lovelace-1\" and saved[\"created\"] is True");
by_id=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:SECOND,["investigator"]:"inv-2"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(by_id,"library_id"),library_id);return pyBool(__left)?(pyAt(by_id,"created")===false):__left})())),"tests/kernel/test_library.py:396 assert by_id[\"library_id\"] == library_id and by_id[\"created\"] is False");
listed=pyAt((await pyMethod(kernel,"ok",["investigator.list"],{})),"investigators");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(listed)){__rows.push(pyAt(r,"library_id"));}return __rows;})()),[library_id,"ada-lovelace-1"])),"tests/kernel/test_library.py:398 assert [r[\"library_id\"] for r in listed] == [library_id, \"ada-lovelace-1\"]");
assert.ok(pyBool(pyLessEqual(pyAt(pyAt(listed,1),"updated_at"),pyAt(pyAt(listed,0),"updated_at"))),"tests/kernel/test_library.py:399 assert listed[0][\"updated_at\"] >= listed[1][\"updated_at\"]");
}
Object.defineProperty(test_list_is_newest_first_and_save_names_the_card_at_a_larger_table,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_list_is_newest_first_and_save_names_the_card_at_a_larger_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_list_is_newest_first_and_save_names_the_card_at_a_larger_table(await kernel(t,{}));});
