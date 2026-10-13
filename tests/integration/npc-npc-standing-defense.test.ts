// Migrated from tests/kernel/test_npc_standing_defense.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,narrate,open_turn,read_json,resolve,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";





export let CORBITT:any="walter-corbitt";
export let CORBITT_NODE:any="npc-walter-corbitt";
export async function corbitt_record(graph:any){
let node:any,properties:any,projection:any;
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),CORBITT_NODE)))__rows.push(n);}return __rows;})())));
properties=(await pyMethod(node,"setdefault",["properties",({})],{}));
projection=(await pyMethod(properties,"get",["runtime_projection"],{}));
return (pyBool((await (async()=>{const __left=(await pyIsInstance(projection,pyDict));return pyBool(__left)?(await pyIsInstance((await pyMethod(projection,"get",["record"],{})),pyDict)):__left})()))?pyAt(projection,"record"):properties);
}
export async function content_with(tmp_path:any,change:any){
let content:any,path:any,graph:any;

content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(content,"starters"),"the-haunting"),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
(await change((await corbitt_record(graph))));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return content;
}
export async function with_dodge(value:any){
async function change(record:any){
pyAt(pyAt(pyAt(record,"mechanics"),"profile"),"skills")["Dodge"]=value;
}
return change;
}
export async function melee_attack(client:any,n:any){

return (await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
}
export async function standing_after_melee(client:any){
let n:any,attack:any,pending:any;
(await open_turn(client,"I hit him."));
n=(await walk_to_confrontation(client));
attack=(await melee_attack(client,n));
pending=pyAt(pyAt(attack,"session"),"pending_defense");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"for"),"npc");return pyBool(__left)?pyEqual(pyAt(pending,"actor"),CORBITT):__left})())),"tests/kernel/test_npc_standing_defense.py:56 assert pending[\"for\"] == \"npc\" and pending[\"actor\"] == CORBITT");
assert.ok(pyBool(pyEqual(pyAt(pending,"options"),["dodge","fight_back","none"])),pyStr("the standing narrows nothing: the options stay as issued"));
return [pyAt(pending,"standing"),attack,n];
}

export async function test_rule_default_fights_back_when_fighting_is_at_least_dodge(kernel:any){
let standing:any,attack:any,_:any;
const __unpack2753=(await standing_after_melee(kernel));standing=__unpack2753[0];attack=__unpack2753[1];_=__unpack2753[2];
assert.ok(pyBool(pyEqual(standing,({["defense"]:"fight_back",["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_defense.py:65 assert standing == {\"defense\": \"fight_back\", \"basis\": \"rule-default\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(attack,"pending_choice"),"for"),"keeper");return pyBool(__left)?!pyContains((await pyMethod(json,"dumps",[pyAt(attack,"pending_choice")],{})),"rule-default"):__left})())),"tests/kernel/test_npc_standing_defense.py:66 assert attack[\"pending_choice\"][\"for\"] == \"keeper\" and \"rule-default\" not in json.dumps(attack[\"pending_choice\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"session"})),"session"),"pending_defense"),"standing"),standing)),"tests/kernel/test_npc_standing_defense.py:68 assert kernel.table(\"look\", focus=\"session\")[\"session\"][\"pending_defense\"][\"standing\"] == standing");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rule_default_fights_back_when_fighting_is_at_least_dodge"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_rule_default_fights_back_when_fighting_is_at_least_dodge(await kernel(t,{}));});
export async function test_rule_default_dodges_when_dodge_is_higher(tmp_path:any){
let client:any,standing:any,_:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await content_with(tmp_path,(await with_dodge(60))))})));
try{const __unpack3384=(await standing_after_melee(client));standing=__unpack3384[0];_=__unpack3384[1];_=__unpack3384[2];
assert.ok(pyBool(pyEqual(standing,({["defense"]:"dodge",["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_defense.py:75 assert standing == {\"defense\": \"dodge\", \"basis\": \"rule-default\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rule_default_dodges_when_dodge_is_higher"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_rule_default_dodges_when_dodge_is_higher(temporary);});
export async function test_rule_default_fights_back_on_a_tie(tmp_path:any){
let client:any,standing:any,_:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await content_with(tmp_path,(await with_dodge(50))))})));
try{const __unpack3726=(await standing_after_melee(client));standing=__unpack3726[0];_=__unpack3726[1];_=__unpack3726[2];
assert.ok(pyBool(pyEqual(standing,({["defense"]:"fight_back",["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_defense.py:84 assert standing == {\"defense\": \"fight_back\", \"basis\": \"rule-default\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rule_default_fights_back_on_a_tie"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_rule_default_fights_back_on_a_tie(temporary);});
export async function test_a_firearm_attack_maps_the_standing_to_diving_for_cover(kernel:any){
let n:any,attack:any,pending:any,defend:any;
(await open_turn(kernel,"I shoot him."));
n=(await walk_to_confrontation(kernel));
attack=(await resolve(kernel,`t1-c${n}`,({"intent":"combat","goal":"shoot him","method":"revolver","target":"Walter Corbitt","weapon":".38 Revolver"})));
pending=pyAt(pyAt(attack,"session"),"pending_defense");
assert.ok(pyBool(pyEqual(pyAt(pending,"options"),["dodge","none"])),"tests/kernel/test_npc_standing_defense.py:95 assert pending[\"options\"] == [\"dodge\", \"none\"]");
assert.ok(pyBool(pyEqual(pyAt(pending,"standing"),({["defense"]:"dodge",["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_defense.py:97 assert pending[\"standing\"] == {\"defense\": \"dodge\", \"basis\": \"rule-default\"}");
defend=(await resolve(kernel,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Walter Corbitt","defense":pyAt(pyAt(pending,"standing"),"defense")})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(defend,"decision"),"combat:defend");return pyBool(__left)?pyEqual(pyAt(pyAt(defend,"outcome"),"defense"),"dive_for_cover"):__left})())),"tests/kernel/test_npc_standing_defense.py:100 assert defend[\"decision\"] == \"combat:defend\" and defend[\"outcome\"][\"defense\"] == \"dive_for_cover\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_firearm_attack_maps_the_standing_to_diving_for_cover"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_firearm_attack_maps_the_standing_to_diving_for_cover(await kernel(t,{}));});
export async function test_a_player_defender_has_no_standing(kernel:any){
let n:any,strike:any,pending:any;
(await open_turn(kernel,"I shoot him."));
n=(await walk_to_confrontation(kernel));
(await resolve(kernel,`t1-c${n}`,({"intent":"combat","goal":"shoot","method":"revolver","target":"Walter Corbitt","weapon":".38 Revolver"})));
(await resolve(kernel,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"x","method":"","actor":"Walter Corbitt","defense":"none"})));
strike=(await resolve(kernel,`t1-c${pyAdd(n,2)}`,({"intent":"combat","goal":"he lunges","method":"","actor":"Walter Corbitt","target":"Thomas Hayes"})));
pending=pyAt(pyAt(strike,"session"),"pending_defense");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"for"),"player");return pyBool(__left)?!pyContains(pending,"standing"):__left})())),"tests/kernel/test_npc_standing_defense.py:111 assert pending[\"for\"] == \"player\" and \"standing\" not in pending");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_player_defender_has_no_standing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_player_defender_has_no_standing(await kernel(t,{}));});

export async function test_an_authored_tactic_is_issued_with_basis_authored(tmp_path:any){
let client:any,standing:any,_:any;
async function authored(record:any){
record["combat"]=({["defense"]:"dodge"});
}
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await content_with(tmp_path,authored))})));
try{const __unpack5872=(await standing_after_melee(client));standing=__unpack5872[0];_=__unpack5872[1];_=__unpack5872[2];
assert.ok(pyBool(pyEqual(standing,({["defense"]:"dodge",["basis"]:"authored"}))),"tests/kernel/test_npc_standing_defense.py:122 assert standing == {\"defense\": \"dodge\", \"basis\": \"authored\"}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_tactic"),({["defense"]:"dodge",["basis"]:"authored"}))),"tests/kernel/test_npc_standing_defense.py:123 assert client.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_tactic\"] == {\"defense\": \"dodge\", \"basis\": \"authored\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_authored_tactic_is_issued_with_basis_authored"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_authored_tactic_is_issued_with_basis_authored(temporary);});
export async function test_an_authored_word_outside_the_enum_is_refused_at_registration(tmp_path:any){
let client:any,error:any;

async function authored(record:any){
record["combat"]=({["defense"]:"parry"});
}
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await content_with(tmp_path,authored))})));
try{error=(await pyMethod(client,"err",["campaign.create",({["id"]:"refused-tactic",["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"zh-Hans"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"reason"),"mechanics_invalid"):__left})())),"tests/kernel/test_npc_standing_defense.py:138 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"reason\"] == \"mechanics_invalid\"");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const refusal of pyIterable(pyAt(pyAt(error,"details"),"refusals"))){if(pyBool(true))__rows.push(pyContains((await pyMethod(refusal,"get",["path",""],{})),"defense"));}return __rows;})())))),pyStr(error));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_authored_word_outside_the_enum_is_refused_at_registration"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_authored_word_outside_the_enum_is_refused_at_registration(temporary);});

export async function test_a_keeper_override_is_a_receipt_changes_the_standing_and_survives_a_restart(tmp_path:any){
let client:any,n:any,why:any,applied:any,receipt:any,again:any,second:any,resumed:any,turn:any,attack:any,view:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await open_turn(client,"I go down to face him."));
n=(await walk_to_confrontation(client));
why="Cornered against the coffin, he only tries to get out of the way.";
applied=(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["defense"]:"dodge",["why"]:why})]}));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(applied,"receipts"),pyAt(r,"id"))))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"kind"),"npc");return pyBool(__left)?pyEqual(pyAt(receipt,"handle"),CORBITT):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"call_id"),`t1-c${n}`):__left})())),"tests/kernel/test_npc_standing_defense.py:154 assert receipt[\"kind\"] == \"npc\" and receipt[\"handle\"] == CORBITT and receipt[\"call_id\"] == f\"t1-c{n}\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"defense"),"dodge");return pyBool(__left)?(pyAt(receipt,"previous")===null):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"why"),why):__left})())),"tests/kernel/test_npc_standing_defense.py:155 assert receipt[\"defense\"] == \"dodge\" and receipt[\"previous\"] is None and receipt[\"why\"] == why");
assert.ok(pyBool(pyEqual(pyAt(receipt,"visibility"),"keeper")),"tests/kernel/test_npc_standing_defense.py:156 assert receipt[\"visibility\"] == \"keeper\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_tactic"),({["defense"]:"dodge",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_defense.py:157 assert client.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_tactic\"] == {\"defense\": \"dodge\", \"basis\": \"keeper\"}");
again=(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["defense"]:"none",["why"]:"He gives up."})]}));
second=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(again,"receipts"),pyAt(r,"id"))))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(second,"defense"),"none");return pyBool(__left)?pyEqual(pyAt(second,"previous"),"dodge"):__left})())),"tests/kernel/test_npc_standing_defense.py:161 assert second[\"defense\"] == \"none\" and second[\"previous\"] == \"dodge\"");
(await narrate(client,`t1-c${pyAdd(n,2)}`,"He sags against the wall."));}finally{(await pyMethod(client,"close",[],{}));}
resumed=(new RpcClient(pyDivide(tmp_path,"ws")));
try{assert.ok(pyBool(pyEqual(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(resumed.workspace)),"world.json"))),"npc_defense"),CORBITT),({["defense"]:"none",["why"]:"He gives up.",["turn"]:1}))),"tests/kernel/test_npc_standing_defense.py:169 assert read_json(campaign_dir(resumed.workspace) / \"world.json\")[\"npc_defense\"][CORBITT] == {\"defense\": \"none\", \"why\": \"He gives up.\", \"turn\": 1}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(resumed,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_tactic"),({["defense"]:"none",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_defense.py:170 assert resumed.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_tactic\"] == {\"defense\": \"none\", \"basis\": \"keeper\"}");
turn=pyAt((await pyMethod(resumed,"table",["player_input"],{"text":"I hit him."})),"turn");
attack=(await resolve(resumed,`t${turn}-c1`,({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(attack,"session"),"pending_defense"),"standing"),({["defense"]:"none",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_defense.py:173 assert attack[\"session\"][\"pending_defense\"][\"standing\"] == {\"defense\": \"none\", \"basis\": \"keeper\"}");
view=(await pyMethod(json,"dumps",[(await pyMethod(resumed,"ok",["table.view",({["campaign"]:"c1"})],{}))],{"ensure_ascii":false}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyContains(view,"\"basis\": \"keeper\"");return pyBool(__left)?!pyContains(view,"He gives up."):__left})());return pyBool(__left)?!pyContains(view,"npc_defense"):__left})())),"tests/kernel/test_npc_standing_defense.py:176 assert '\"basis\": \"keeper\"' not in view and \"He gives up.\" not in view and \"npc_defense\" not in view");}finally{(await pyMethod(resumed,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_keeper_override_is_a_receipt_changes_the_standing_and_survives_a_restart"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_keeper_override_is_a_receipt_changes_the_standing_and_survives_a_restart(temporary);});
export async function test_a_keeper_override_is_refused_whole_without_why_with_another_change_or_with_an_unknown_word(kernel:any){
let effect:any,field:any,refused:any,unknown:any;
(await open_turn(kernel,"I watch Knott."));
for([effect,field] of pyIterable([[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"dodge"}),"npc.why"],[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"dodge",["to"]:"here",["why"]:"x"}),"npc.defense"],[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"parry",["why"]:"x"}),"npc.defense"]])){
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[effect]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"field"),field):__left})())),"tests/kernel/test_npc_standing_defense.py:187 assert refused[\"code\"] == \"invalid_params\" and refused[\"details\"][\"field\"] == field");
}
unknown=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"parry",["why"]:"x"})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(unknown,"details"),"options"),["dodge","fight_back","none"])),"tests/kernel/test_npc_standing_defense.py:189 assert unknown[\"details\"][\"options\"] == [\"dodge\", \"fight_back\", \"none\"]");
assert.ok(pyBool(!pyContains((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"npc_defense")),"tests/kernel/test_npc_standing_defense.py:190 assert \"npc_defense\" not in read_json(campaign_dir(kernel.workspace) / \"world.json\")");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_npc_standing_defense.py:191 assert kernel.table(\"status\")[\"receipts\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_keeper_override_is_refused_whole_without_why_with_another_change_or_with_an_unknown_word"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_keeper_override_is_refused_whole_without_why_with_another_change_or_with_an_unknown_word(await kernel(t,{}));});
export async function test_the_tactic_is_keeper_only(kernel:any){
let why:any,card:any,delivered:any,shown:any;
(await open_turn(kernel,"I watch Knott."));
why="He has decided to swing at anyone who grabs him.";
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"fight_back",["why"]:why})]}));
card=(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"}));
assert.ok(pyBool(pyEqual(pyAt(card,"combat_tactic"),({["defense"]:"fight_back",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_defense.py:199 assert card[\"combat_tactic\"] == {\"defense\": \"fight_back\", \"basis\": \"keeper\"}");
delivered=(await narrate(kernel,"t1-c2","Knott squares his shoulders."));
shown=pyAdd((await pyMethod(json,"dumps",[delivered],{"ensure_ascii":false})),(await pyMethod(json,"dumps",[(await pyMethod(kernel,"ok",["table.view",({["campaign"]:"c1"})],{}))],{"ensure_ascii":false})));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyContains(shown,"combat_tactic");return pyBool(__left)?!pyContains(shown,"npc_defense"):__left})());return pyBool(__left)?!pyContains(shown,why):__left})())),"tests/kernel/test_npc_standing_defense.py:202 assert \"combat_tactic\" not in shown and \"npc_defense\" not in shown and why not in shown");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(true))__rows.push(pyEqual((await pyMethod(row,"get",["kind"],{})),"npc"));}return __rows;})()))))),"tests/kernel/test_npc_standing_defense.py:203 assert not any(row.get(\"kind\") == \"npc\" for row in delivered[\"mechanics\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_tactic_is_keeper_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_tactic_is_keeper_only(await kernel(t,{}));});
export async function test_the_card_reads_the_rule_from_the_profile_and_names_no_word_without_one(kernel:any){
(await open_turn(kernel,"I watch Knott."));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_tactic"),({["defense"]:"fight_back",["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_defense.py:209 assert kernel.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_tactic\"] == {\"defense\": \"fight_back\", \"basis\": \"rule-default\"}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_tactic"),({["defense"]:null,["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_defense.py:211 assert kernel.table(\"look\", focus=\"npc\", name=\"Steven Knott\")[\"combat_tactic\"] == {\"defense\": None, \"basis\": \"rule-default\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_card_reads_the_rule_from_the_profile_and_names_no_word_without_one"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_card_reads_the_rule_from_the_profile_and_names_no_word_without_one(await kernel(t,{}));});

export async function test_ask_accepts_the_none_the_kernel_offers_the_player(kernel:any){
let n:any,strike:any,pending:any,asked:any;

(await open_turn(kernel,"I shoot him."));
n=(await walk_to_confrontation(kernel));
(await resolve(kernel,`t1-c${n}`,({"intent":"combat","goal":"shoot","method":"revolver","target":"Walter Corbitt","weapon":".38 Revolver"})));
(await resolve(kernel,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"x","method":"","actor":"Walter Corbitt","defense":"none"})));
strike=(await resolve(kernel,`t1-c${pyAdd(n,2)}`,({"intent":"combat","goal":"he lunges","method":"","actor":"Walter Corbitt","target":"Thomas Hayes"})));
pending=pyAt(strike,"pending_choice");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"for"),"player");return pyBool(__left)?pyEqual(pyAt(pending,"options"),["dodge","fight_back","none"]):__left})())),"tests/kernel/test_npc_standing_defense.py:225 assert pending[\"for\"] == \"player\" and pending[\"options\"] == [\"dodge\", \"fight_back\", \"none\"]");
asked=(await pyMethod(kernel,"table",["ask"],{"call_id":`t1-c${pyAdd(n,3)}`,"kind":"mechanics","options":pyAt(pending,"options"),"binds":pyAt(pending,"name"),"text":"The knife swings at you."}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"pending_choice"),"options"),["dodge","fight_back","none"])),"tests/kernel/test_npc_standing_defense.py:228 assert asked[\"pending_choice\"][\"options\"] == [\"dodge\", \"fight_back\", \"none\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"kind"),"mechanics")),"tests/kernel/test_npc_standing_defense.py:229 assert asked[\"interaction\"][\"kind\"] == \"mechanics\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ask_accepts_the_none_the_kernel_offers_the_player"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ask_accepts_the_none_the_kernel_offers_the_player(await kernel(t,{}));});

export async function test_a_handout_already_shown_is_marked_by_world_state(kernel:any){
let assets:any,handout:any,after:any,shown:any;
(await open_turn(kernel,"I read the letter."));
assets=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"assets");
handout=(await pyNext((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(assets)){if(pyBool(pyEqual(pyAt(a,"kind"),"handout")))__rows.push(a);}return __rows;})())));
assert.ok(pyBool(!pyContains(handout,"shown")),"tests/kernel/test_npc_standing_defense.py:238 assert \"shown\" not in handout");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["apply.options"],{})),"context"),"handouts_shown"),[])),"tests/kernel/test_npc_standing_defense.py:239 assert kernel.table(\"apply.options\")[\"context\"][\"handouts_shown\"] == []");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"handout",["name"]:pyAt(handout,"name")})]}));
after=(await pyNext((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"assets"))){if(pyBool(pyEqual(pyAt(a,"name"),pyAt(handout,"name"))))__rows.push(a);}return __rows;})())));
assert.ok(pyBool((pyAt(after,"shown")===true)),"tests/kernel/test_npc_standing_defense.py:242 assert after[\"shown\"] is True");
shown=pyAt(pyAt((await pyMethod(kernel,"table",["apply.options"],{})),"context"),"handouts_shown");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(shown,pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"handouts_shown"));return pyBool(__left)?pyEqual((await pyLen(shown)),1):__left})())),"tests/kernel/test_npc_standing_defense.py:244 assert shown == read_json(campaign_dir(kernel.workspace) / \"world.json\")[\"handouts_shown\"] and len(shown) == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_handout_already_shown_is_marked_by_world_state"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_handout_already_shown_is_marked_by_world_state(await kernel(t,{}));});
