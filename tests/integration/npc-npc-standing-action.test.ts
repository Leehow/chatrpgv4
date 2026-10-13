// Migrated from tests/kernel/test_npc_standing_action.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,narrate,open_turn,read_json,resolve,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";






export let CORBITT:any="walter-corbitt";
export let CORBITT_NODE:any="npc-walter-corbitt";
export let INVESTIGATOR:any="thomas-hayes";
export async function corbitt_record(graph:any){
let node:any,properties:any,projection:any;
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),CORBITT_NODE))){__rows.push(n);}}return __rows;})())));
properties=(await pyMethod(node,"setdefault",["properties",({})],{}));
projection=(await pyMethod(properties,"get",["runtime_projection"],{}));
return (pyBool((await (async()=>{const __left=(await pyIsInstance(projection,pyDict));return pyBool(__left)?(await pyIsInstance((await pyMethod(projection,"get",["record"],{})),pyDict)):__left})()))?pyAt(projection,"record"):properties);
}
export async function content_with(tmp_path:any,combat:any){
let content:any,path:any,graph:any;

content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(content,"starters"),"the-haunting"),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
(await corbitt_record(graph))["combat"]=combat;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return content;
}
export async function client_with(tmp_path:any,combat:any=null){
let content:any;
content=(pyBool((combat!==null))?(await content_with(tmp_path,combat)):null);
return (new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":content})));
}
export async function corbitts_turn(client:any,stance:any=null){
let n:any,defended:any;

(await open_turn(client,"I hit him."));
n=(await walk_to_confrontation(client));
(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
defended=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Walter Corbitt","defense":"dodge"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(defended,"session"),"turn_of"),CORBITT);return pyBool(__left)?(pyAt(pyAt(defended,"session"),"pending_defense")===null):__left})())),"tests/kernel/test_npc_standing_action.py:58 assert defended[\"session\"][\"turn_of\"] == CORBITT and defended[\"session\"][\"pending_defense\"] is None");
n=pyAdd(n,2);
if(pyBool((stance!==null))){(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["stance"]:stance,["why"]:"test"})]}));
n=pyAdd(n,1);}
return n;
}
export async function edit_fight(client:any,hp_fraction:any=null,ally:any=false,investigator:any=null,corbitt:any=null,round_delta:any=0,corbitt_turn:any=false){
let path:any,combat:any,participant:any;

path=pyDivide(pyDivide((await campaign_dir(client.workspace)),"save"),"combat.json");
combat=(await read_json(path));
for(participant of pyIterable(pyAt(combat,"participants"))){
if(pyBool(pyEqual(pyAt(participant,"actor_id"),CORBITT))){if(pyBool((hp_fraction!==null))){participant["hp_current"]=(await pyInt(pyMultiply(pyAt(participant,"hp_max"),hp_fraction)));}
(await pyMethod(participant,"update",[(await (async()=>{const __left=corbitt;return pyBool(__left)?__left:({})})())],{}));}
if(pyBool(pyEqual(pyAt(participant,"actor_id"),INVESTIGATOR))){(await pyMethod(participant,"update",[(await (async()=>{const __left=investigator;return pyBool(__left)?__left:({})})())],{}));}
}
if(pyBool(ally)){(await pyMethod(pyAt(combat,"participants"),"append",[({...(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(combat,"participants"))){if(pyBool(pyEqual(pyAt(p,"actor_id"),INVESTIGATOR))){__rows.push(p);}}return __rows;})()))),["actor_id"]:"a-second-investigator"})],{}));}
combat["current_round"]=pyAdd(pyAt(combat,"current_round"),round_delta);
if(pyBool(corbitt_turn)){combat["initiative_cursor"]=(await pyNext((await (async()=>{const __rows:any[]=[];for(const [i,value] of pyIterable((await pyEnumerate(pyAt(combat,"current_initiative"))))){if(pyBool(pyEqual(pyAt(value,"actor_id"),CORBITT))){__rows.push(i);}}return __rows;})())));}
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[combat],{}))],{"encoding":"utf-8"}));
}
export async function standing(client:any){
let session:any;
session=pyAt((await pyMethod(client,"table",["look"],{"focus":"session"})),"session");
assert.ok(pyBool(pyEqual(pyAt(session,"turn_of"),CORBITT)),"tests/kernel/test_npc_standing_action.py:89 assert session[\"turn_of\"] == CORBITT");
return (await pyMethod(session,"get",["standing_action"],{}));
}

export async function test_no_disposition_no_authored_word_and_no_override_is_no_standing(tmp_path:any){
let client:any,card:any;
client=(await client_with(tmp_path));
try{(await corbitts_turn(client));
assert.ok(pyBool(((await standing(client))===null)),pyStr("hostile and able, but nothing says how he fights: the Keeper decides"));
card=(await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(card,"combat_disposition"),"disposition")===null);return pyBool(__left)?(pyAt(pyAt(card,"combat_disposition"),"basis")===null):__left})())),"tests/kernel/test_npc_standing_action.py:101 assert card[\"combat_disposition\"][\"disposition\"] is None and card[\"combat_disposition\"][\"basis\"] is None");
assert.ok(pyBool(pyEqual(pyAt(card,"combat_standing"),({["action"]:null,["basis"]:"rule-default"}))),"tests/kernel/test_npc_standing_action.py:102 assert card[\"combat_standing\"] == {\"action\": None, \"basis\": \"rule-default\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_disposition_no_authored_word_and_no_override_is_no_standing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_disposition_no_authored_word_and_no_override_is_no_standing(temporary);});



export let TABLE_ROWS:any=[["fights_to_the_end",1.0,false,null,"attack"],["fights_to_the_end",0.25,true,null,"attack"],["fights_then_flees",1.0,false,null,"attack"],["fights_then_flees",0.5,false,null,"flee"],["fights_then_flees",0.75,true,null,"flee"],["fights_then_flees",0.75,false,null,"attack"],["fights_then_flees",1.0,false,"neutral","hold"],["avoids_fighting",1.0,false,null,"hold"],["avoids_fighting",1.0,true,null,"flee"],["avoids_fighting",0.75,false,null,"flee"],["surrenders",1.0,false,null,"attack"],["surrenders",0.75,false,null,"hold"],["surrenders",1.0,true,null,"hold"],["surrenders",1.0,false,"wary","hold"]];
export async function test_the_rules_default_reads_the_disposition_table(tmp_path:any,disposition:any,fraction:any,outnumbered:any,stance:any,expected:any){
let client:any,issued:any;
client=(await client_with(tmp_path,({["disposition"]:disposition})));
try{(await corbitts_turn(client,stance));
(await edit_fight(client,fraction,outnumbered,undefined,undefined,undefined,undefined));
issued=(await standing(client));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(issued,"action"),expected);return pyBool(__left)?pyEqual(pyAt(issued,"basis"),"rule-default"):__left})())),"tests/kernel/test_npc_standing_action.py:137 assert issued[\"action\"] == expected and issued[\"basis\"] == \"rule-default\"");
assert.ok(pyBool(pyEqual(pyAt(issued,"disposition"),({["disposition"]:disposition,["basis"]:"authored"}))),"tests/kernel/test_npc_standing_action.py:138 assert issued[\"disposition\"] == {\"disposition\": disposition, \"basis\": \"authored\"}");
assert.ok(pyBool(pyEqual(pyAt(issued,"read"),({["hp_fraction"]:pyDivide((await pyInt(pyMultiply(16,fraction))),16),["outnumbered"]:outnumbered,["stance"]:(await (async()=>{const __left=stance;return pyBool(__left)?__left:"hostile"})())}))),"tests/kernel/test_npc_standing_action.py:139 assert issued[\"read\"] == {\"hp_fraction\": int(16 * fraction) / 16, \"outnumbered\": outnumbered, \"stance\": stance or \"hostile\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("disposition,fraction,outnumbered,stance,expected",TABLE_ROWS))).entries())test("test_the_rules_default_reads_the_disposition_table"+((pyCartesian([{}],pyParametrize("disposition,fraction,outnumbered,stance,expected",TABLE_ROWS))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_rules_default_reads_the_disposition_table(temporary,row["disposition"],row["fraction"],row["outnumbered"],row["stance"],row["expected"]);});
export async function test_the_stance_is_the_ledger_folded_with_the_open_turn(tmp_path:any){
let client:any,ledger:any;

client=(await client_with(tmp_path,({["disposition"]:"fights_then_flees"})));
try{(await corbitts_turn(client));
ledger=pyDivide((await campaign_dir(client.workspace)),"npc-ledger.json");
assert.ok(pyBool((await (async()=>{const __left=!pyBool((await pyMethod(ledger,"exists",[],{})));return pyBool(__left)?__left:!pyContains((await read_json(ledger)),CORBITT_NODE);})())),"tests/kernel/test_npc_standing_action.py:150 assert not ledger.exists() or CORBITT_NODE not in read_json(ledger)");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await standing(client)),"read"),"stance"),"hostile")),"tests/kernel/test_npc_standing_action.py:151 assert standing(client)[\"read\"][\"stance\"] == \"hostile\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_stance_is_the_ledger_folded_with_the_open_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_stance_is_the_ledger_folded_with_the_open_turn(temporary);});

export async function test_an_npc_out_of_the_fight_has_no_standing(tmp_path:any){
let client:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_to_the_end"})));
try{(await corbitts_turn(client));
(await edit_fight(client,undefined,undefined,undefined,({["conditions"]:["fled"]}),undefined,undefined));
assert.ok(pyBool(((await standing(client))===null)),"tests/kernel/test_npc_standing_action.py:163 assert standing(client) is None");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npc_out_of_the_fight_has_no_standing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npc_out_of_the_fight_has_no_standing(temporary);});
export async function test_an_attack_without_a_legal_target_is_not_issued(tmp_path:any){
let client:any,session:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_to_the_end"})));
try{(await corbitts_turn(client));
(await edit_fight(client,undefined,undefined,({["conditions"]:["unconscious"]}),undefined,undefined,undefined));
session=pyAt((await pyMethod(client,"table",["look"],{"focus":"session"})),"session");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(session,"actions"),0),"targets"),[])),"tests/kernel/test_npc_standing_action.py:174 assert session[\"actions\"][0][\"targets\"] == []");
assert.ok(pyBool(!pyContains(session,"standing_action")),pyStr("the table says attack, and there is no one he can attack"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_attack_without_a_legal_target_is_not_issued"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_attack_without_a_legal_target_is_not_issued(temporary);});
export async function test_no_standing_while_an_attack_is_pending(tmp_path:any){
let client:any,n:any,strike:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_to_the_end"})));
try{n=(await corbitts_turn(client));
strike=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"he lunges","method":"","actor":"Walter Corbitt","target":"Thomas Hayes"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(strike,"session"),"pending_defense"),"for"),"player")),"tests/kernel/test_npc_standing_action.py:185 assert strike[\"session\"][\"pending_defense\"][\"for\"] == \"player\"");
assert.ok(pyBool(!pyContains(pyAt(strike,"session"),"standing_action")),"tests/kernel/test_npc_standing_action.py:186 assert \"standing_action\" not in strike[\"session\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_standing_while_an_attack_is_pending"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_standing_while_an_attack_is_pending(temporary);});

export async function test_an_authored_attack_is_issued_with_basis_authored(tmp_path:any){
let client:any;
client=(await client_with(tmp_path,({["action"]:"attack"})));
try{(await corbitts_turn(client,"warm"));
assert.ok(pyBool(pyEqual((await standing(client)),({["action"]:"attack",["basis"]:"authored"}))),pyStr("the book says he always attacks; no disposition is read"));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_standing"),({["action"]:"attack",["basis"]:"authored"}))),"tests/kernel/test_npc_standing_action.py:198 assert client.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_standing\"] == {\"action\": \"attack\", \"basis\": \"authored\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_authored_attack_is_issued_with_basis_authored"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_authored_attack_is_issued_with_basis_authored(temporary);});
export async function test_an_authored_word_outside_the_enum_is_refused_where_the_book_is_registered(tmp_path:any,combat:any,path:any){
let client:any,refused:any;

client=(await client_with(tmp_path,combat));
try{refused=(await pyMethod(client,"err",["campaign.create",({["id"]:"c1",["module"]:"the-haunting",["pregen"]:INVESTIGATOR,["play_language"]:"zh-Hans"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"reason"),"mechanics_invalid"):__left})())),"tests/kernel/test_npc_standing_action.py:209 assert refused[\"code\"] == \"invalid_params\" and refused[\"details\"][\"reason\"] == \"mechanics_invalid\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(refused,"details"),"refusals"))){__rows.push([pyAt(r,"rule"),pyAt((await pyMethod(pyAt(r,"path"),"split",[".",3],{})),(-1))]);}return __rows;})()),[["shape_prose",path]])),"tests/kernel/test_npc_standing_action.py:210 assert [(r[\"rule\"], r[\"path\"].split(\".\", 3)[-1]) for r in refused[\"details\"][\"refusals\"]] == [(\"shape_prose\", path)]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("combat,path",[[({["action"]:"flee"}),"combat.action"],[({["disposition"]:"cowardly"}),"combat.disposition"]]))).entries())test("test_an_authored_word_outside_the_enum_is_refused_where_the_book_is_registered"+((pyCartesian([{}],pyParametrize("combat,path",[[({["action"]:"flee"}),"combat.action"],[({["disposition"]:"cowardly"}),"combat.disposition"]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_authored_word_outside_the_enum_is_refused_where_the_book_is_registered(temporary,row["combat"],row["path"]);});

export async function test_a_keeper_hold_is_a_receipt_survives_a_restart_and_lapses_with_its_round(tmp_path:any){
let client:any,n:any,why:any,applied:any,receipt:any,session:any,resumed:any,world:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_to_the_end"})));
try{n=(await corbitts_turn(client));
assert.ok(pyBool(pyEqual(pyAt((await standing(client)),"action"),"attack")),"tests/kernel/test_npc_standing_action.py:221 assert standing(client)[\"action\"] == \"attack\"");
why="He hesitates, staring at the relic in the investigator's hand.";
applied=(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["action"]:"hold",["why"]:why})]}));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(applied,"receipts"),pyAt(r,"id")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"kind"),"npc");return pyBool(__left)?pyEqual(pyAt(receipt,"handle"),CORBITT):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"call_id"),`t1-c${n}`):__left})())),"tests/kernel/test_npc_standing_action.py:225 assert receipt[\"kind\"] == \"npc\" and receipt[\"handle\"] == CORBITT and receipt[\"call_id\"] == f\"t1-c{n}\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"action"),"hold");return pyBool(__left)?(pyAt(receipt,"previous")===null):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"why"),why):__left})())),"tests/kernel/test_npc_standing_action.py:226 assert receipt[\"action\"] == \"hold\" and receipt[\"previous\"] is None and receipt[\"why\"] == why");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"combat_id"),"corbitt-final-combat-t1");return pyBool(__left)?pyEqual(pyAt(receipt,"round"),1):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"visibility"),"keeper"):__left})())),"tests/kernel/test_npc_standing_action.py:227 assert receipt[\"combat_id\"] == \"corbitt-final-combat-t1\" and receipt[\"round\"] == 1 and receipt[\"visibility\"] == \"keeper\"");
assert.ok(pyBool(pyEqual(pyAt(receipt,"passes_turn"),({["combat_id"]:"corbitt-final-combat-t1",["round"]:1,["turn_of"]:INVESTIGATOR}))),"tests/kernel/test_npc_standing_action.py:229 assert receipt[\"passes_turn\"] == {\"combat_id\": \"corbitt-final-combat-t1\", \"round\": 1, \"turn_of\": INVESTIGATOR}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(applied,"turn_passed"),0),"passed"),CORBITT)),"tests/kernel/test_npc_standing_action.py:230 assert applied[\"turn_passed\"][0][\"passed\"] == CORBITT");
session=pyAt((await pyMethod(client,"table",["look"],{"focus":"session"})),"session");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"turn_of"),INVESTIGATOR);return pyBool(__left)?pyEqual(pyAt(session,"round"),2):__left})())),"tests/kernel/test_npc_standing_action.py:233 assert session[\"turn_of\"] == INVESTIGATOR and session[\"round\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_standing"),"basis"),"rule-default")),"tests/kernel/test_npc_standing_action.py:234 assert client.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_standing\"][\"basis\"] == \"rule-default\"");
(await narrate(client,`t1-c${pyAdd(n,1)}`,"Corbitt freezes."));}finally{(await pyMethod(client,"close",[],{}));}
resumed=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":pyDivide(tmp_path,"content")})));
try{world=(await read_json(pyDivide((await campaign_dir(resumed.workspace)),"world.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(world,"npc_action"),CORBITT),({["action"]:"hold",["why"]:why,["turn"]:1,["combat_id"]:"corbitt-final-combat-t1",["round"]:1}))),"tests/kernel/test_npc_standing_action.py:242 assert world[\"npc_action\"][CORBITT] == {\"action\": \"hold\", \"why\": why, \"turn\": 1, \"combat_id\": \"corbitt-final-combat-t1\", \"round\": 1}");
(await pyMethod(resumed,"table",["player_input"],{"text":"I wait."}));
(await edit_fight(resumed,undefined,undefined,undefined,undefined,(-1),true));
assert.ok(pyBool(pyEqual(pyAt((await standing(resumed)),"basis"),"keeper")),pyStr("same fight, same round: the hold stands after a restart"));
(await edit_fight(resumed,undefined,undefined,undefined,undefined,1,true));
assert.ok(pyBool(pyEqual(pyAt((await standing(resumed)),"basis"),"rule-default")),pyStr("a hold holds for its round; the next round reads the table again"));}finally{(await pyMethod(resumed,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_keeper_hold_is_a_receipt_survives_a_restart_and_lapses_with_its_round"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_keeper_hold_is_a_receipt_survives_a_restart_and_lapses_with_its_round(temporary);});
export async function test_a_keeper_attack_stands_and_a_disposition_override_replaces_the_book(tmp_path:any){
let client:any,n:any,applied:any,receipt:any,card:any;
client=(await client_with(tmp_path,({["disposition"]:"surrenders"})));
try{n=(await corbitts_turn(client));
(await edit_fight(client,0.75,undefined,undefined,undefined,undefined,undefined));
assert.ok(pyBool(pyEqual(pyAt((await standing(client)),"action"),"hold")),"tests/kernel/test_npc_standing_action.py:257 assert standing(client)[\"action\"] == \"hold\"");
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["disposition"]:"fights_to_the_end",["why"]:"The house holds him; he cannot yield."})]}));
assert.ok(pyBool(pyEqual((await standing(client)),({["action"]:"attack",["basis"]:"rule-default",["disposition"]:({["disposition"]:"fights_to_the_end",["basis"]:"keeper"}),["read"]:({["hp_fraction"]:0.75,["outnumbered"]:false,["stance"]:"hostile"})}))),"tests/kernel/test_npc_standing_action.py:259 assert standing(client) == {\"action\": \"attack\", \"basis\": \"rule-default\", \"disposition\": {\"disposition\": \"fights_to_the_end\", \"basis\": \"keeper\"},\n                                    \"read\": {\"hp_fraction\": 0.75, \"outnumbered\": False, \"stance\": \"hostile\"}}");
applied=(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["action"]:"attack",["why"]:"He lunges."})]}));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(applied,"receipts"),pyAt(r,"id")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"action"),"attack");return pyBool(__left)?!pyContains(receipt,"combat_id"):__left})())),"tests/kernel/test_npc_standing_action.py:263 assert receipt[\"action\"] == \"attack\" and \"combat_id\" not in receipt");
assert.ok(pyBool(pyEqual(pyAt((await standing(client)),"basis"),"keeper")),"tests/kernel/test_npc_standing_action.py:264 assert standing(client)[\"basis\"] == \"keeper\"");
card=(await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"}));
assert.ok(pyBool(pyEqual(pyAt(card,"combat_disposition"),({["disposition"]:"fights_to_the_end",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_action.py:266 assert card[\"combat_disposition\"] == {\"disposition\": \"fights_to_the_end\", \"basis\": \"keeper\"}");
assert.ok(pyBool(pyEqual(pyAt(card,"combat_standing"),({["action"]:"attack",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_action.py:267 assert card[\"combat_standing\"] == {\"action\": \"attack\", \"basis\": \"keeper\"}");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_keeper_attack_stands_and_a_disposition_override_replaces_the_book"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_keeper_attack_stands_and_a_disposition_override_replaces_the_book(temporary);});
export async function test_an_override_is_refused_whole_without_why_with_another_change_with_an_unknown_word_or_a_hold_outside_a_fight(kernel:any){
let effect:any,field:any,refused:any,world:any;
(await open_turn(kernel,"I watch Knott."));
for([effect,field] of pyIterable([[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"attack"}),"npc.why"],[({["kind"]:"npc",["name"]:"Steven Knott",["disposition"]:"surrenders"}),"npc.why"],[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"attack",["to"]:"here",["why"]:"x"}),"npc.action"],[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"attack",["defense"]:"dodge",["why"]:"x"}),"npc.defense"],[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"attack",["disposition"]:"surrenders",["why"]:"x"}),"npc.action"],[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"flee",["why"]:"x"}),"npc.action"],[({["kind"]:"npc",["name"]:"Steven Knott",["disposition"]:"cowardly",["why"]:"x"}),"npc.disposition"],[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"hold",["why"]:"x"}),"npc.action"]])){
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[effect]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"field"),field):__left})())),pyStr([effect,refused]));
}
world=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json")));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(world,"npc_action");return pyBool(__left)?!pyContains(world,"npc_disposition"):__left})())),"tests/kernel/test_npc_standing_action.py:285 assert \"npc_action\" not in world and \"npc_disposition\" not in world");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_npc_standing_action.py:286 assert kernel.table(\"status\")[\"receipts\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_override_is_refused_whole_without_why_with_another_change_with_an_unknown_word_or_a_hold_outside_a_fight"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_override_is_refused_whole_without_why_with_another_change_with_an_unknown_word_or_a_hold_outside_a_fight(await kernel(t,{}));});
export async function test_a_hold_for_someone_outside_the_fight_is_refused(tmp_path:any){
let client:any,n:any,refused:any;
client=(await client_with(tmp_path));
try{n=(await corbitts_turn(client));
refused=(await pyMethod(client,"table_err",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Steven Knott",["action"]:"hold",["why"]:"x"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"field"),"npc.name"):__left})())),"tests/kernel/test_npc_standing_action.py:294 assert refused[\"code\"] == \"invalid_params\" and refused[\"details\"][\"field\"] == \"npc.name\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_hold_for_someone_outside_the_fight_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_hold_for_someone_outside_the_fight_is_refused(temporary);});
export async function test_the_standing_action_and_disposition_are_keeper_only(tmp_path:any){
let client:any,n:any,why:any,delivered:any,shown:any,word:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_then_flees"})));
try{n=(await corbitts_turn(client));
why="Something in the cellar has taken his nerve.";
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["disposition"]:"avoids_fighting",["why"]:why})]}));
assert.ok(pyBool(pyEqual(pyAt((await standing(client)),"action"),"hold")),"tests/kernel/test_npc_standing_action.py:305 assert standing(client)[\"action\"] == \"hold\"");
delivered=(await narrate(client,`t1-c${pyAdd(n,1)}`,"Corbitt draws back."));
shown=pyAdd((await pyMethod(json,"dumps",[delivered],{"ensure_ascii":false})),(await pyMethod(json,"dumps",[(await pyMethod(client,"ok",["table.view",({["campaign"]:"c1"})],{}))],{"ensure_ascii":false})));
for(word of pyIterable(["standing_action","combat_standing","combat_disposition","npc_disposition","avoids_fighting",why])){
assert.ok(pyBool(!pyContains(shown,word)),"tests/kernel/test_npc_standing_action.py:309 assert word not in shown");
}
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(delivered,"mechanics"))){__rows.push(pyEqual((await pyMethod(row,"get",["kind"],{})),"npc"));}return __rows;})()))))),"tests/kernel/test_npc_standing_action.py:310 assert not any(row.get(\"kind\") == \"npc\" for row in delivered[\"mechanics\"])");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_standing_action_and_disposition_are_keeper_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_standing_action_and_disposition_are_keeper_only(temporary);});

export let DISPOSITIONS:any=["fights_to_the_end","fights_then_flees","avoids_fighting","surrenders"];
export async function test_a_card_without_a_disposition_carries_what_one_is_inferred_from(kernel:any){
let card:any,table:any;

(await open_turn(kernel,"I watch Knott."));
card=pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_disposition");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(card,"disposition")===null);return pyBool(__left)?(pyAt(card,"basis")===null):__left})())),"tests/kernel/test_npc_standing_action.py:325 assert card[\"disposition\"] is None and card[\"basis\"] is None");
table=(await read_json(pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"npc-combat-disposition.json")));
assert.ok(pyBool(pyEqual(pyAt(card,"options"),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const word of pyIterable(DISPOSITIONS)){__rows.push([word,pyAt(pyAt(pyAt(table,"dispositions"),word),"description")]);}return __rows;})())))),"tests/kernel/test_npc_standing_action.py:327 assert card[\"options\"] == {word: table[\"dispositions\"][word][\"description\"] for word in DISPOSITIONS}");
assert.ok(pyBool((await (async()=>{const __left=pyAt(card,"material");return pyBool(__left)?pyLessEqual((await pySet(pyAt(card,"material"))),new Set(["agenda","fear","secret","voice","relationship_to_investigators"])):__left})())),"tests/kernel/test_npc_standing_action.py:328 assert card[\"material\"] and set(card[\"material\"]) <= {\"agenda\", \"fear\", \"secret\", \"voice\", \"relationship_to_investigators\"}");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["disposition"]:"surrenders",["why"]:"He is a landlord, not a brawler."})]}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_disposition"),({["disposition"]:"surrenders",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_action.py:330 assert kernel.table(\"look\", focus=\"npc\", name=\"Steven Knott\")[\"combat_disposition\"] == {\"disposition\": \"surrenders\", \"basis\": \"keeper\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_card_without_a_disposition_carries_what_one_is_inferred_from"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_card_without_a_disposition_carries_what_one_is_inferred_from(await kernel(t,{}));});

export async function table_with(tmp_path:any,tactic_dispositions:any){
let content:any,path:any,table:any;

content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(pyDivide(content,"rulesets"),"coc7"),"rules-json"),"npc-combat-disposition.json");
table=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
if(pyBool((tactic_dispositions===null))){(await pyMethod(table,"pop",["tactic_dispositions",null],{}));}else{table["tactic_dispositions"]=tactic_dispositions;}
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[table],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return (new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":content})));
}
export async function test_a_stated_tactic_is_the_cards_default_disposition_through_the_table(tmp_path:any){
let client:any,card:any,table:any;

client=(await client_with(tmp_path,({["defense"]:"fight_back"})));
try{(await open_turn(client,"I watch him."));
(await walk_to_confrontation(client));
card=(await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"}));
assert.ok(pyBool(pyEqual(pyAt(card,"combat_tactic"),({["defense"]:"fight_back",["basis"]:"authored"}))),"tests/kernel/test_npc_standing_action.py:356 assert card[\"combat_tactic\"] == {\"defense\": \"fight_back\", \"basis\": \"authored\"}");
table=(await read_json(pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"npc-combat-disposition.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"combat_disposition"),"default"),({["disposition"]:pyAt(pyAt(table,"tactic_dispositions"),"fight_back"),["rule"]:"card_disposition",["from"]:({["combat_tactic"]:({["defense"]:"fight_back",["basis"]:"authored"})})}))),"tests/kernel/test_npc_standing_action.py:358 assert card[\"combat_disposition\"][\"default\"] == {\"disposition\": table[\"tactic_dispositions\"][\"fight_back\"], \"rule\": \"card_disposition\",\n                                                          \"from\": {\"combat_tactic\": {\"defense\": \"fight_back\", \"basis\": \"authored\"}}}");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(card,"combat_disposition"),"disposition")===null);return pyBool(__left)?pyAt(pyAt(card,"combat_disposition"),"options"):__left})())),pyStr("still the inference's input"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_stated_tactic_is_the_cards_default_disposition_through_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_stated_tactic_is_the_cards_default_disposition_through_the_table(temporary);});
export async function test_a_keeper_tactic_is_the_cards_word_and_a_rule_default_tactic_is_not(kernel:any){
let card:any,default_value:any;
(await open_turn(kernel,"I watch Knott."));
card=(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"combat_tactic"),({["defense"]:null,["basis"]:"rule-default"}));return pyBool(__left)?!pyContains(pyAt(card,"combat_disposition"),"default"):__left})())),pyStr("no numbers, no word"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"test"})]}));
card=(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(card,"combat_tactic"),"defense")!==null);return pyBool(__left)?pyEqual(pyAt(pyAt(card,"combat_tactic"),"basis"),"rule-default"):__left})())),"tests/kernel/test_npc_standing_action.py:371 assert card[\"combat_tactic\"][\"defense\"] is not None and card[\"combat_tactic\"][\"basis\"] == \"rule-default\"");
assert.ok(pyBool(!pyContains(pyAt(card,"combat_disposition"),"default")),pyStr("Fighting against Dodge is arithmetic, not a word about him"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"dodge",["why"]:"He ducks behind the desk."})]}));
default_value=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_disposition"),"default");
assert.ok(pyBool(pyEqual(default_value,({["disposition"]:"avoids_fighting",["rule"]:"card_disposition",["from"]:({["combat_tactic"]:({["defense"]:"dodge",["basis"]:"keeper"})})}))),"tests/kernel/test_npc_standing_action.py:375 assert default == {\"disposition\": \"avoids_fighting\", \"rule\": \"card_disposition\", \"from\": {\"combat_tactic\": {\"defense\": \"dodge\", \"basis\": \"keeper\"}}}");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"none",["why"]:"He just stands there."})]}));
assert.ok(pyBool(!pyContains(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_disposition"),"default")),pyStr("a tactic without a row: no default"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["disposition"]:"surrenders",["why"]:"test"})]}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_disposition"),({["disposition"]:"surrenders",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_action.py:379 assert kernel.table(\"look\", focus=\"npc\", name=\"Steven Knott\")[\"combat_disposition\"] == {\"disposition\": \"surrenders\", \"basis\": \"keeper\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_keeper_tactic_is_the_cards_word_and_a_rule_default_tactic_is_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_keeper_tactic_is_the_cards_word_and_a_rule_default_tactic_is_not(await kernel(t,{}));});
export async function test_a_malformed_tactic_map_is_refused_when_the_card_is_read(tmp_path:any,section:any){
let client:any,error:any;
client=(await table_with(tmp_path,section));
try{(await open_turn(client,"I watch Knott."));
error=(await pyMethod(client,"table_err",["look"],{"focus":"npc","name":"Steven Knott"}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_npc_standing_action.py:388 assert error[\"code\"] == \"campaign_not_ready\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("section",[({["dodge"]:"runs_away"}),({["parry"]:"avoids_fighting"}),["dodge"]]))).entries())test("test_a_malformed_tactic_map_is_refused_when_the_card_is_read"+((pyCartesian([{}],pyParametrize("section",[({["dodge"]:"runs_away"}),({["parry"]:"avoids_fighting"}),["dodge"]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_malformed_tactic_map_is_refused_when_the_card_is_read(temporary,row["section"]);});
export async function test_a_table_without_the_tactic_map_gives_no_default(tmp_path:any){
let client:any;
client=(await table_with(tmp_path,null));
try{(await open_turn(client,"I watch Knott."));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["defense"]:"dodge",["why"]:"test"})]}));
assert.ok(pyBool(!pyContains(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"combat_disposition"),"default")),"tests/kernel/test_npc_standing_action.py:398 assert \"default\" not in client.table(\"look\", focus=\"npc\", name=\"Steven Knott\")[\"combat_disposition\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_without_the_tactic_map_gives_no_default"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_without_the_tactic_map_gives_no_default(temporary);});
export async function test_an_inferred_disposition_is_a_receipt_is_written_once_and_survives_a_restart(tmp_path:any){
let client:any,read:any,n:any,why:any,applied:any,receipt:any,again:any,resumed:any,world:any;
client=(await client_with(tmp_path));
read=["agenda","fear","voice"];
try{n=(await corbitts_turn(client));
assert.ok(pyBool(((await standing(client))===null)),"tests/kernel/test_npc_standing_action.py:408 assert standing(client) is None");
why="Inferred once for this campaign from Walter Corbitt's own parameters: agenda, fear, voice.";
applied=(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["disposition"]:"fights_to_the_end",["why"]:why,["_inferred"]:({["read"]:read})})]}));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(applied,"receipts"),pyAt(r,"id")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"disposition"),"fights_to_the_end");return pyBool(__left)?pyEqual(pyAt(receipt,"basis"),"inferred"):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"read"),read):__left})())),"tests/kernel/test_npc_standing_action.py:413 assert receipt[\"disposition\"] == \"fights_to_the_end\" and receipt[\"basis\"] == \"inferred\" and receipt[\"read\"] == read");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(receipt,"previous")===null);return pyBool(__left)?pyEqual(pyAt(receipt,"visibility"),"keeper"):__left})())),"tests/kernel/test_npc_standing_action.py:414 assert receipt[\"previous\"] is None and receipt[\"visibility\"] == \"keeper\"");
assert.ok(pyBool(pyEqual(pyAt((await standing(client)),"disposition"),({["disposition"]:"fights_to_the_end",["basis"]:"inferred"}))),"tests/kernel/test_npc_standing_action.py:415 assert standing(client)[\"disposition\"] == {\"disposition\": \"fights_to_the_end\", \"basis\": \"inferred\"}");
again=(await pyMethod(client,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["disposition"]:"surrenders",["why"]:why,["_inferred"]:({["read"]:read})})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(again,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(again,"details"),"reason"),"disposition_already_set"):__left})())),"tests/kernel/test_npc_standing_action.py:419 assert again[\"code\"] == \"invalid_params\" and again[\"details\"][\"reason\"] == \"disposition_already_set\"");
(await narrate(client,`t1-c${pyAdd(n,1)}`,"Corbitt's eyes burn."));}finally{(await pyMethod(client,"close",[],{}));}
resumed=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{world=(await read_json(pyDivide((await campaign_dir(resumed.workspace)),"world.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(world,"npc_disposition"),CORBITT),({["disposition"]:"fights_to_the_end",["why"]:why,["turn"]:1,["basis"]:"inferred",["read"]:read}))),"tests/kernel/test_npc_standing_action.py:427 assert world[\"npc_disposition\"][CORBITT] == {\"disposition\": \"fights_to_the_end\", \"why\": why, \"turn\": 1, \"basis\": \"inferred\", \"read\": read}");
(await pyMethod(resumed,"table",["player_input"],{"text":"I back away."}));
assert.ok(pyBool(pyEqual((await standing(resumed)),({["action"]:"attack",["basis"]:"rule-default",["disposition"]:({["disposition"]:"fights_to_the_end",["basis"]:"inferred"}),["read"]:({["hp_fraction"]:1.0,["outnumbered"]:false,["stance"]:"hostile"})}))),"tests/kernel/test_npc_standing_action.py:429 assert standing(resumed) == {\"action\": \"attack\", \"basis\": \"rule-default\", \"disposition\": {\"disposition\": \"fights_to_the_end\", \"basis\": \"inferred\"},\n                                     \"read\": {\"hp_fraction\": 1.0, \"outnumbered\": False, \"stance\": \"hostile\"}}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(resumed,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_disposition"),({["disposition"]:"fights_to_the_end",["basis"]:"inferred"}))),"tests/kernel/test_npc_standing_action.py:431 assert resumed.table(\"look\", focus=\"npc\", name=\"Walter Corbitt\")[\"combat_disposition\"] == {\"disposition\": \"fights_to_the_end\", \"basis\": \"inferred\"}");
(await pyMethod(resumed,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["disposition"]:"surrenders",["why"]:"The relic breaks him."})]}));
assert.ok(pyBool(pyEqual(pyAt((await standing(resumed)),"disposition"),({["disposition"]:"surrenders",["basis"]:"keeper"}))),"tests/kernel/test_npc_standing_action.py:434 assert standing(resumed)[\"disposition\"] == {\"disposition\": \"surrenders\", \"basis\": \"keeper\"}");}finally{(await pyMethod(resumed,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_inferred_disposition_is_a_receipt_is_written_once_and_survives_a_restart"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_inferred_disposition_is_a_receipt_is_written_once_and_survives_a_restart(temporary);});
export async function test_an_inferred_write_over_the_books_disposition_is_refused(tmp_path:any){
let client:any,n:any,refused:any;
client=(await client_with(tmp_path,({["disposition"]:"surrenders"})));
try{n=(await corbitts_turn(client));
refused=(await pyMethod(client,"table_err",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["disposition"]:"fights_to_the_end",["why"]:"x",["_inferred"]:({["read"]:["agenda"]})})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(refused,"details"),"reason"),"disposition_already_set")),"tests/kernel/test_npc_standing_action.py:445 assert refused[\"details\"][\"reason\"] == \"disposition_already_set\"");
assert.ok(pyBool(!pyContains(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Walter Corbitt"})),"combat_disposition"),"material")),pyStr("nothing to infer: the book says it"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_inferred_write_over_the_books_disposition_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_inferred_write_over_the_books_disposition_is_refused(temporary);});
export async function test_an_unreadable_ledger_withholds_the_tables_reading_and_never_guesses_a_stance(tmp_path:any){
let client:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_to_the_end"})));
try{(await corbitts_turn(client));
assert.ok(pyBool(pyEqual(pyAt((await standing(client)),"basis"),"rule-default")),"tests/kernel/test_npc_standing_action.py:455 assert standing(client)[\"basis\"] == \"rule-default\"");
(await pyMethod((pyDivide((await campaign_dir(client.workspace)),"npc-ledger.json")),"write_text",["{broken-json"],{"encoding":"utf-8"}));
assert.ok(pyBool(((await standing(client))===null)),pyStr("the table reads the stance; an unreadable ledger is not an empty one"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unreadable_ledger_withholds_the_tables_reading_and_never_guesses_a_stance"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unreadable_ledger_withholds_the_tables_reading_and_never_guesses_a_stance(temporary);});
