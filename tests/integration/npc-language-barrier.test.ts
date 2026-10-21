// Migrated from tests/kernel/test_language_barrier.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {apply_dossier,built_module,emitted_client,open_turn,played,table_npcs,words} from "./world-mod-vocabulary.test.ts";





export async function test_unknown_language_policy_reaches_every_turn_and_ordinary_audit(tmp_path:any){
let client:any,mid:any,_:any,campaign:any,root:any,sheet_path:any,sheet:any,active:any,mod:any,full:any,view:any,job:any,packet:any,prompt:any,later:any;
client=(await emitted_client(pyDivide(tmp_path,"ws")));
try{const __unpack423=(await built_module(client,tmp_path,({["agenda"]:"Sell fuel."})));mid=__unpack423[0];_=__unpack423[1];
campaign=(await played(client,tmp_path,mid));
root=pyDivide(pyDivide(pyDivide(client.workspace,".coc"),"campaigns"),campaign);
sheet_path=(await pyNext((await pyMethod((pyDivide(root,"party")),"glob",["*.json"],{}))));
sheet=(await read_json(sheet_path));
sheet["own_language"]="Chinese";
pyAt(sheet,"skills")["Language (Own)"]=50;
pyAt(sheet,"skills")["Language (Other: English)"]=1;
(await pyMethod(sheet_path,"write_text",[(await pyMethod(json,"dumps",[sheet],{}))],{}));
active=pyAt(pyAt((await read_json(pyDivide(root,"world.json"))),"mods"),"active");
for(mod of pyIterable(active)){
if(pyBool(!pyEqual(mod,"natural-npc"))){(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:mod,["enabled"]:false})],{}));}
}
(await open_turn(client,campaign));
assert.ok(pyBool((pyAt(pyAt((await words(client,campaign)),"language"),"bound")===true)),"tests/kernel/test_language_barrier.py:30 assert words(client, campaign)[\"language\"][\"bound\"] is True");
assert.ok(pyBool(!pyContains(pyAt((await table_npcs(client,campaign)),"Tenant"),"speaks")),"tests/kernel/test_language_barrier.py:31 assert \"speaks\" not in table_npcs(client, campaign)[\"Tenant\"]");
full=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt((await pyMethod(client,"ok",["table.capsule",({["campaign"]:campaign})],{})),"mods"),"instructions"))){if(pyBool(pyEqual(pyAt(row,"mod"),"natural-npc"))){__rows.push(row);}}return __rows;})())));
// §248.1: natural-npc is sectioned, so it rides indexed; its language section is read by key, as the host or the Keeper's mod verb reads it.
assert.ok(pyBool(pyEqual(pyAt(full,"form"),"indexed")),"tests/kernel/test_language_barrier.py:34 assert full[\"form\"] == \"full\" (indexed since §248)");
const languageKey=pyAt(full,"sections").find((section:any)=>section.heading==="The language of the exchange").key;
assert.ok(pyBool(pyContains(pyAt(full,"instruction"),'"natural-npc: The language of the exchange"')),"the index lists the language section");
const language=pyAt(pyAt(pyAt((await pyMethod(client,"ok",["mods.sections",({["campaign"]:campaign,["keys"]:[languageKey]})],{})),"sections"),0),"text");
assert.ok(pyBool(pyContains(language,"Missing `speaks` means unknown")),"tests/kernel/test_language_barrier.py:35 assert \"Missing `speaks` means unknown\" in full[\"instruction\"]");
assert.ok(pyBool(pyContains(language,"What the player writes is what the investigator means")),"tests/kernel/test_language_barrier.py:36 assert \"What the player writes is what the investigator means\" in full[\"instruction\"]");
view=(await pyMethod(client,"ok",["table.look",({["campaign"]:campaign,["focus"]:"investigator"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(view,"skills"),"Language (Other: English)"),1)),"tests/kernel/test_language_barrier.py:38 assert view[\"skills\"][\"Language (Other: English)\"] == 1");
job=(await pyMethod(client,"ok",["mods.job",({["campaign"]:campaign,["role"]:"audit",["input"]:({["text"]:"The tenant answers the whole question fluently."})})],{}));
assert.ok(pyBool(pyAt(job,"enabled")),pyStr("ordinary conversation must not need a first-impression roll"));
packet=(await read_json(pyDivide((await Path(pyAt(job,"cwd"))),"request.json")));
assert.ok(pyBool(pyEqual(pyAt(packet,"receipts"),[])),"tests/kernel/test_language_barrier.py:44 assert packet[\"receipts\"] == []");
assert.ok(pyBool(pyEqual(pyAt(packet,"player_text"),"I try talking to them.")),"tests/kernel/test_language_barrier.py:45 assert packet[\"player_text\"] == \"I try talking to them.\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(packet,"party"),0),"skills"),"Language (Other: English)"),1)),"tests/kernel/test_language_barrier.py:46 assert packet[\"party\"][0][\"skills\"][\"Language (Other: English)\"] == 1");
assert.ok(pyBool(!pyContains((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(packet,"present"))){if(pyBool(pyEqual(pyAt(row,"name"),"Tenant"))){__rows.push(row);}}return __rows;})()))),"speaks")),"tests/kernel/test_language_barrier.py:47 assert \"speaks\" not in next(row for row in packet[\"present\"] if row[\"name\"] == \"Tenant\")");
prompt=(await pyMethod((await Path(pyAt(job,"system_prompt"))),"read_text",[],{}));
assert.ok(pyBool(pyContains(prompt,"do not skip a fluent exchange")),"tests/kernel/test_language_barrier.py:49 assert \"do not skip a fluent exchange\" in prompt");
assert.ok(pyBool(pyContains(prompt,"request.present")),"tests/kernel/test_language_barrier.py:50 assert \"request.present\" in prompt");
assert.ok(pyBool(pyContains(prompt,"Player words are intent")),"tests/kernel/test_language_barrier.py:51 assert \"Player words are intent\" in prompt");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(packet,"source_review");return pyBool(__left)?!pyContains(packet,"continuity_review"):__left})())),"tests/kernel/test_language_barrier.py:52 assert \"source_review\" not in packet and \"continuity_review\" not in packet");
(await pyMethod(client,"ok",["table.narrate",({["campaign"]:campaign,["call_id"]:"t1-c1",["text"]:"The tenant points to the pump."})],{}));
(await open_turn(client,campaign));
later=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt((await pyMethod(client,"ok",["table.capsule",({["campaign"]:campaign})],{})),"mods"),"instructions"))){if(pyBool(pyEqual(pyAt(row,"mod"),"natural-npc"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(later,"form"),"indexed")),"tests/kernel/test_language_barrier.py:60 assert later[\"form\"] == \"full\" (indexed since §248)");
assert.ok(pyBool(pyEqual(pyAt(later,"instruction"),pyAt(full,"instruction"))),"tests/kernel/test_language_barrier.py:61 assert later[\"instruction\"] == full[\"instruction\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_language_policy_reaches_every_turn_and_ordinary_audit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_language_policy_reaches_every_turn_and_ordinary_audit(temporary);});
export async function test_established_language_reaches_keeper_and_auditor_without_rewriting_source(tmp_path:any){
let client:any,mid:any,_:any,campaign:any,job:any,packet:any;
client=(await emitted_client(pyDivide(tmp_path,"ws")));
try{const __unpack3527=(await built_module(client,tmp_path,({["agenda"]:"Sell fuel."})));mid=__unpack3527[0];_=__unpack3527[1];
campaign=(await played(client,tmp_path,mid));
(await open_turn(client,campaign));
(await apply_dossier(client,campaign,"Tenant",({["language"]:"English"}),undefined,"The exchange establishes English as the working language."));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await table_npcs(client,campaign)),"Tenant"),"speaks"),"English")),"tests/kernel/test_language_barrier.py:74 assert table_npcs(client, campaign)[\"Tenant\"][\"speaks\"] == \"English\"");
job=(await pyMethod(client,"ok",["mods.job",({["campaign"]:campaign,["role"]:"audit",["input"]:({["text"]:"The tenant waits while the visitor searches for a word."})})],{}));
packet=(await read_json(pyDivide((await Path(pyAt(job,"cwd"))),"request.json")));
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(packet,"present"))){if(pyBool(pyEqual(pyAt(row,"name"),"Tenant"))){__rows.push(row);}}return __rows;})()))),"speaks"),"English")),"tests/kernel/test_language_barrier.py:78 assert next(row for row in packet[\"present\"] if row[\"name\"] == \"Tenant\")[\"speaks\"] == \"English\"");
(await pyMethod(client,"ok",["table.narrate",({["campaign"]:campaign,["call_id"]:"t1-c2",["text"]:"The tenant waits."})],{}));
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:"natural-npc",["enabled"]:false})],{}));
assert.ok(pyBool(!pyContains(pyAt((await table_npcs(client,campaign)),"Tenant"),"speaks")),"tests/kernel/test_language_barrier.py:82 assert \"speaks\" not in table_npcs(client, campaign)[\"Tenant\"]");
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:"natural-npc",["enabled"]:true})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await table_npcs(client,campaign)),"Tenant"),"speaks"),"English")),"tests/kernel/test_language_barrier.py:84 assert table_npcs(client, campaign)[\"Tenant\"][\"speaks\"] == \"English\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_established_language_reaches_keeper_and_auditor_without_rewriting_source"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_established_language_reaches_keeper_and_auditor_without_rewriting_source(temporary);});
