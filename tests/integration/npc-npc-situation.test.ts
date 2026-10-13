// Migrated from tests/kernel/test_npc_situation.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,pin_contact_impression,read_json,resolve,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {give_corbitt_a_weapon} from "./npc-npc-holdings.test.ts";







export let KNOTT:any="steven-knott";
export let INVESTIGATOR:any="thomas-hayes";
export let PUNCH:any="I punch Knott in the face.";
export let SNATCH:any="I snatch the wallet out of his coat.";
export async function situation(client:any,name:any="Steven Knott"){
return (await pyMethod(client,"ok",["npc.situation",({["campaign"]:"c1",["name"]:name})],{}));
}
export async function packet_bytes(packet:any){
return (await pyLen((await pyMethod((await pyMethod(json,"dumps",[packet],{"ensure_ascii":false})),"encode",["utf-8"],{}))));
}
export async function receipts(client:any){
return pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
}
export async function knott_hit_then_robbed(client:any){
let hit:any,cash:any;

(await open_turn(client,"I square up to Knott."));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"an office man"})]}));
(await narrate(client,"t1-c2","Knott gets up from behind the desk."));
(await pyMethod(client,"table",["player_input"],{"text":PUNCH}));
(await resolve(client,"t2-c1",({"intent":"combat","goal":"hit him","method":"fists","target":"Steven Knott","weapon":"unarmed"})));
(await resolve(client,"t2-c2",({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Steven Knott","defense":"none"})));
hit=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(client)))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"delta");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["resource"],{})),"hp"):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["subject"],{})),KNOTT):__left})()))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool(pyLess(pyAt(hit,"after"),pyAt(hit,"before"))),pyStr("seed 1: the punch lands"));
(await narrate(client,"t2-c3","The punch lands."));
(await pyMethod(client,"table",["player_input"],{"text":SNATCH}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"cash",["subject"]:"Thomas Hayes",["delta"]:20,["source"]:"found",["with"]:"Steven Knott",["why"]:"taken from his coat"})]}));
cash=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(client)))){if(pyBool(pyEqual(pyAt(r,"kind"),"cash"))){__rows.push(r);}}return __rows;})())));
return [hit,cash];
}
export async function* knott(tmp_path:any){
let client:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
yield client;
(await pyMethod(client,"close",[],{}));
}
export async function test_a_landed_blow_last_turn_and_a_purse_taken_this_turn_are_two_sentences_and_nothing_else(knott:any){
let hit:any,cash:any,packet:any,happened:any,blow:any,purse:any,declared:any;
const __unpack3255=(await knott_hit_then_robbed(knott));hit=__unpack3255[0];cash=__unpack3255[1];
packet=(await situation(knott));
assert.ok(pyBool(pyEqual(pyAt(packet,"npc"),({["handle"]:KNOTT,["name"]:"Steven Knott",["kind"]:"npc"}))),"tests/kernel/test_npc_situation.py:70 assert packet[\"npc\"] == {\"handle\": KNOTT, \"name\": \"Steven Knott\", \"kind\": \"npc\"}");
happened=pyAt(packet,"happened");
assert.ok(pyBool(pyEqual((await pyLen(happened)),3)),pyStr(happened));
const __unpack3689=happened;blow=__unpack3689[0];purse=__unpack3689[1];declared=__unpack3689[2];
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod(blow,"startswith",["turn 2: "],{}));return pyBool(__left)?pyContains(blow,"Fighting (Brawl) (attack) against Steven Knott"):__left})())),pyStr(blow));
assert.ok(pyBool(pyContains(blow,`Steven Knott's hp ${pyAt(hit,"before")} -> ${pyAt(hit,"after")}`)),pyStr("the attack, its damage roll and the hp it cost are one sentence"));
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod(purse,"startswith",["turn 3: "],{}));return pyBool(__left)?pyContains(purse,`${pyAt(cash,"subject_label")}'s cash +20 USD, with Steven Knott`):__left})())),pyStr(purse));
assert.ok(pyBool(pyContains(purse,"(why: taken from his coat)")),"tests/kernel/test_npc_situation.py:79 assert \"(why: taken from his coat)\" in purse");
assert.ok(pyBool(pyEqual(declared,`${pyAt(cash,"subject_label")} (investigator) declared: "${SNATCH}"`)),"tests/kernel/test_npc_situation.py:80 assert declared == f'{cash[\"subject_label\"]} (investigator) declared: \"{SNATCH}\"'");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(happened)){__rows.push(pyContains(line,PUNCH));}return __rows;})()))))),pyStr("the declaration is this turn's, not last turn's"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_landed_blow_last_turn_and_a_purse_taken_this_turn_are_two_sentences_and_nothing_else"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_landed_blow_last_turn_and_a_purse_taken_this_turn_are_two_sentences_and_nothing_else(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_state_reads_the_fight_the_ledger_and_the_room(knott:any){
let _:any,cash:any,packet:any,combat:any,fighter:any,state:any,at_hand:any;
const __unpack4404=(await knott_hit_then_robbed(knott));_=__unpack4404[0];cash=__unpack4404[1];
packet=(await situation(knott));
combat=(await read_json(pyDivide(pyDivide((await campaign_dir(knott.workspace)),"save"),"combat.json")));
fighter=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(combat,"participants"))){if(pyBool(pyEqual(pyAt(p,"actor_id"),KNOTT))){__rows.push(p);}}return __rows;})())));
state=pyAt(packet,"state");
assert.ok(pyBool((await (async()=>{const __left=pyEqual([pyAt(state,"hp"),pyAt(state,"hp_max")],[pyAt(fighter,"hp_current"),pyAt(fighter,"hp_max")]);return pyBool(__left)?pyLess(pyAt(state,"hp"),pyAt(state,"hp_max")):__left})())),"tests/kernel/test_npc_situation.py:90 assert (state[\"hp\"], state[\"hp_max\"]) == (fighter[\"hp_current\"], fighter[\"hp_max\"]) and state[\"hp\"] < state[\"hp_max\"]");
assert.ok(pyBool(pyEqual(pyAt(state,"stance"),"hostile")),pyStr("a person fought this turn stands hostile (§17.3)"));
assert.ok(pyBool((pyAt(state,"in_session")===true)),"tests/kernel/test_npc_situation.py:92 assert state[\"in_session\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt((await pyMethod(knott,"table",["look"],{"focus":"session"})),"session"),"turn_of"),KNOTT);return pyBool(__left)?(pyAt(state,"my_turn")===true):__left})())),"tests/kernel/test_npc_situation.py:93 assert knott.table(\"look\", focus=\"session\")[\"session\"][\"turn_of\"] == KNOTT and state[\"my_turn\"] is True");
at_hand=pyAt(packet,"at_hand");
assert.ok(pyBool(pyEqual(pyAt(at_hand,"present"),[pyAt(cash,"subject_label")])),pyStr("the investigator is here; Knott is not listed with himself; Corbitt is elsewhere"));
assert.ok(pyBool(pyAt(at_hand,"exits")),pyStr("the office's ways out, by the table's labels"));
assert.ok(pyBool(pyEqual(pyAt(packet,"truncated"),[])),"tests/kernel/test_npc_situation.py:97 assert packet[\"truncated\"] == []");
assert.ok(pyBool(pyLessEqual((await packet_bytes(packet)),6144)),"tests/kernel/test_npc_situation.py:98 assert packet_bytes(packet) <= 6144");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_state_reads_the_fight_the_ledger_and_the_room"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_state_reads_the_fight_the_ledger_and_the_room(await acquireFixture(t,()=>knott(temporary)));});
export async function test_an_intention_under_way_is_in_done_and_not_in_happened(knott:any){
let line:any,settled:any,ref:any,ledger:any,packet:any,first:any,second:any,earlier:any,declared:any;
(await open_turn(knott,"I tell Knott I will not take the job."));
line="Call the porter up from the lobby and have the visitor shown out.";
settled="Offer the visitor a bonus to reconsider the job.";
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:settled,["outcome"]:"failed"})]}));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:line,["outcome"]:"attempted"})]}));
ref=pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(knott)))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"npc");return pyBool(__left)?pyEqual(pyAt(pyAt(r,"intent"),"text"),line):__left})()))){__rows.push(r);}}return __rows;})()))),"intent"),"ref");
ledger=pyDivide((await campaign_dir(knott.workspace)),"npc-ledger.json");
assert.ok(pyBool((await (async()=>{const __left=!pyBool((await pyMethod(ledger,"exists",[],{})));return pyBool(__left)?__left:!pyBool((await pyMethod((await pyMethod((await read_json(ledger)),"get",["npc-steven-knott",({})],{})),"get",["intents"],{})));})())),"tests/kernel/test_npc_situation.py:110 assert not ledger.exists() or not read_json(ledger).get(\"npc-steven-knott\", {}).get(\"intents\")");
packet=(await situation(knott));
const __unpack6325=pyAt(packet,"done");first=__unpack6325[0];second=__unpack6325[1];
assert.ok(pyBool(pyEqual(first,({["ref"]:ref,["intent"]:line,["status"]:"attempted",["since_turn"]:1,["turn"]:1}))),pyStr("under way first"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(second,"intent"),settled);return pyBool(__left)?pyEqual(pyAt(second,"status"),"failed"):__left})())),"tests/kernel/test_npc_situation.py:115 assert second[\"intent\"] == settled and second[\"status\"] == \"failed\"");
const __unpack6607=pyAt(packet,"happened");earlier=__unpack6607.slice(0,-1);declared=__unpack6607[__unpack6607.length-1];
assert.ok(pyBool((await pyMethod(declared,"endswith",["(investigator) declared: \"I tell Knott I will not take the job.\""],{}))),pyStr("an intention-only receipt is in done, not in happened"));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const sentence of pyIterable(earlier)){__rows.push((await (async()=>{const __left=!pyContains(sentence,line);return pyBool(__left)?!pyContains(sentence,settled):__left})()));}return __rows;})())))),"tests/kernel/test_npc_situation.py:120 assert all(line not in sentence and settled not in sentence for sentence in earlier)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_intention_under_way_is_in_done_and_not_in_happened"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_intention_under_way_is_in_done_and_not_in_happened(await acquireFixture(t,()=>knott(temporary)));});
export async function test_an_intention_given_up_is_said_in_happened_the_next_turn(knott:any){
let line:any,ref:any,packet:any,gave_up:any,declared:any;

(await open_turn(knott,"I tell Knott I will not take the job."));
line="Lift the telephone receiver and threaten to ring the police.";
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:line,["outcome"]:"attempted",["_generated"]:true})]}));
ref=pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(knott)))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"npc");return pyBool(__left)?pyEqual(pyAt(pyAt(r,"intent"),"text"),line):__left})()))){__rows.push(r);}}return __rows;})()))),"intent"),"ref");
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intent_ref"]:ref,["outcome"]:"abandoned",["why"]:"repeated",["_generated"]:true})]}));
(await narrate(knott,"t1-c3","Knott sets the receiver down."));
(await pyMethod(knott,"table",["player_input"],{"text":"I wait."}));
packet=(await situation(knott));
const __unpack8092=pyAt(packet,"happened");gave_up=__unpack8092[0];declared=__unpack8092[1];
assert.ok(pyBool(pyEqual(gave_up,`turn 1: Steven Knott gave up "${line}" without doing it (why: repeated)`)),pyStr(gave_up));
assert.ok(pyBool((await pyMethod(declared,"endswith",["declared: \"I wait.\""],{}))),"tests/kernel/test_npc_situation.py:137 assert declared.endswith('declared: \"I wait.\"')");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(packet,"done"))){__rows.push([pyAt(row,"ref"),pyAt(row,"status")]);}return __rows;})()),[[ref,"abandoned"]])),"tests/kernel/test_npc_situation.py:138 assert [(row[\"ref\"], row[\"status\"]) for row in packet[\"done\"]] == [(ref, \"abandoned\")]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_intention_given_up_is_said_in_happened_the_next_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_intention_given_up_is_said_in_happened_the_next_turn(await acquireFixture(t,()=>knott(temporary)));});
export async function test_thirty_settled_intentions_fit_the_budget_and_the_newest_survives(knott:any){
let lines:any,n:any,line:any,packet:any;
(await open_turn(knott,"I keep Knott talking all afternoon."));
lines=(await (async()=>{const __rows:any[]=[];for(const n of pyIterable((await pyRange(1,31)))){__rows.push(`Intention ${pyFormat(n,"02d")}: steer the visitor back to the job, remind him of the deadline, the wages, the keys on the desk, `+`the address in Roxbury and the newspaper men who will not stop asking about the house -- variant ${pyFormat(n,"02d")}.`);}return __rows;})());
for([n,line] of pyIterable((await pyEnumerate(lines,({"start":1}))))){
(await pyMethod(knott,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:line,["outcome"]:"done"})]}));
}
packet=(await situation(knott));
assert.ok(pyBool(pyLessEqual((await packet_bytes(packet)),6144)),pyStr((await packet_bytes(packet))));
assert.ok(pyBool(pyEqual(pyAt(packet,"truncated"),["at_hand","history"])),pyStr("binding constraints survive before optional surroundings and old intentions"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"canonical_context"),"player_declaration"),"I keep Knott talking all afternoon.")),"tests/kernel/test_npc_situation.py:151 assert packet[\"canonical_context\"][\"player_declaration\"] == \"I keep Knott talking all afternoon.\"");
assert.ok(pyBool(pyEqual(pyAt(packet,"at_hand"),({["holdings"]:[],["objects"]:[],["exits"]:[],["present"]:[]}))),"tests/kernel/test_npc_situation.py:152 assert packet[\"at_hand\"] == {\"holdings\": [], \"objects\": [], \"exits\": [], \"present\": []}");
assert.ok(pyBool((await (async()=>{const __term0=1;const __term1=(await pyLen(pyAt(packet,"done")));const __term2=30;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<");})())),"tests/kernel/test_npc_situation.py:153 assert 1 <= len(packet[\"done\"]) < 30");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(packet,"done"),0),"intent"),pyAt(lines,(-1)))),pyStr("the newest row is the one kept"));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(packet,"done"))){__rows.push(pyAt(row,"intent"));}return __rows;})()),pySlice(pySlice(lines,undefined,undefined,(-1)),undefined,(await pyLen(pyAt(packet,"done")))))),pyStr("the oldest rows go first"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_thirty_settled_intentions_fit_the_budget_and_the_newest_survives"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_thirty_settled_intentions_fit_the_budget_and_the_newest_survives(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_budget_is_the_named_default_in_host_budgets(tmp_path:any){
let content:any,path:any,budgets:any,client:any,packet:any;
content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(content,"rulesets"),"coc7"),"host-budgets.json");
budgets=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
assert.ok(pyBool(pyEqual(pyAt(budgets,"npc_situation"),({["max_bytes"]:6144}))),"tests/kernel/test_npc_situation.py:163 assert budgets[\"npc_situation\"] == {\"max_bytes\": 6144}");
pyAt(budgets,"npc_situation")["max_bytes"]=1024;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[budgets],{}))],{"encoding":"utf-8"}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"}),"content":content})));
try{(await open_turn(client,"I look Knott over."));
packet=(await situation(client));
assert.ok(pyBool(pyLessEqual((await packet_bytes(packet)),1024)),pyStr((await packet_bytes(packet))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(packet,"truncated"),0),"at_hand");return pyBool(__left)?pyEqual(pyAt(pyAt(packet,"truncated"),(-1)),"constraints"):__left})())),pyStr(pyAt(packet,"truncated")));
assert.ok(pyBool((await (async()=>{const __left=!pyBool(pyAt(pyAt(packet,"at_hand"),"exits"));return pyBool(__left)?!pyBool(pyAt(pyAt(packet,"at_hand"),"present")):__left;})())),"tests/kernel/test_npc_situation.py:174 assert not packet[\"at_hand\"][\"exits\"] and not packet[\"at_hand\"][\"present\"]");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(packet,"happened"),(-1)),"endswith",["declared: \"I look Knott over.\""],{}))),pyStr("the declaration is never cut"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_budget_is_the_named_default_in_host_budgets"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_budget_is_the_named_default_in_host_budgets(temporary);});
export async function test_holdings_are_the_weapons_combat_reads_and_what_he_owns(tmp_path:any){
let client:any,packet:any,holdings:any,state:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await open_turn(client,"I creep into the cellar."));
(await walk_to_confrontation(client));
(await give_corbitt_a_weapon(client));
packet=(await situation(client,"Walter Corbitt"));
holdings=pyAt(pyAt(packet,"at_hand"),"holdings");
assert.ok(pyBool((await (async()=>{const __left=pyContains(holdings,"Clawed fingernails (kick, punch, claw)");return pyBool(__left)?pyContains(holdings,"floating-knife"):__left})())),pyStr("the printed profile's weapons"));
assert.ok(pyBool((await (async()=>{const __left=pyContains(holdings,"heavy chair");return pyBool(__left)?pyEqual((await pyMethod(holdings,"count",["heavy chair"],{})),1):__left})())),pyStr("an owned object, once"));
state=pyAt(packet,"state");
assert.ok(pyBool(pyEqual([pyAt(state,"hp"),pyAt(state,"hp_max")],[16,16])),pyStr("outside a fight: the printed profile's HP"));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(state,"in_session")===false);return pyBool(__left)?(pyAt(state,"my_turn")===false):__left})())),"tests/kernel/test_npc_situation.py:192 assert state[\"in_session\"] is False and state[\"my_turn\"] is False");
assert.ok(pyBool(pyAt(pyAt(packet,"at_hand"),"present")),pyStr("the investigator is in the cellar with him"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_holdings_are_the_weapons_combat_reads_and_what_he_owns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_holdings_are_the_weapons_combat_reads_and_what_he_owns(temporary);});
export async function test_a_name_is_required_and_must_be_someone(kernel:any){
(await open_turn(kernel));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["npc.situation",({["campaign"]:"c1"})],{})),"code"),"invalid_params")),"tests/kernel/test_npc_situation.py:200 assert kernel.err(\"npc.situation\", {\"campaign\": \"c1\"})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["npc.situation",({["campaign"]:"c1",["name"]:"Nobody At All"})],{})),"code"),"unknown_entity")),"tests/kernel/test_npc_situation.py:201 assert kernel.err(\"npc.situation\", {\"campaign\": \"c1\", \"name\": \"Nobody At All\"})[\"code\"] == \"unknown_entity\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_name_is_required_and_must_be_someone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_name_is_required_and_must_be_someone(await kernel(t,{}));});
export async function test_constraints_are_the_capsules_rows_that_name_him(knott:any){
let constraints:any,capsule:any,scene_rows:any,contacts:any;
(await create_campaign(knott));
(await pin_contact_impression(knott));
(await narrate_opening(knott));
(await pyMethod(knott,"table",["player_input"],{"text":"I look Knott over."}));
constraints=pyAt((await situation(knott)),"constraints");
capsule=(await pyMethod(knott,"table",["capsule"],{}));
scene_rows=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(capsule,"obligations"))){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(row,"get",["kind"],{})),"scene");return pyBool(__left)?pyEqual((await pyMethod(row,"get",["who"],{})),"Steven Knott"):__left})()))){__rows.push(row);}}return __rows;})());
contacts=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(capsule,"mods"),"pending_contacts"))){if(pyBool(pyEqual(pyAt(row,"target"),"Steven Knott"))){__rows.push(row);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=scene_rows;return pyBool(__left)?contacts:__left})())),pyStr("the office: the book's commission obligation and the active Mod's first-impression check"));
assert.ok(pyBool(pyEqual(constraints,pyAdd((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(scene_rows)){__rows.push(`scene obligation ${pyAt(row,"name")} (${pyAt(row,"state")}): ${pyAt(row,"cue")}`);}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(contacts)){__rows.push(`Mod check ${pyAt(row,"decision")} between ${pyAt(row,"actor")} and Steven Knott is still to come: ${pyAt(row,"when")}`);}return __rows;})())))),"tests/kernel/test_npc_situation.py:215 assert constraints == [f\"scene obligation {row['name']} ({row['state']}): {row['cue']}\" for row in scene_rows] + \\\n        [f\"Mod check {row['decision']} between {row['actor']} and Steven Knott is still to come: {row['when']}\" for row in contacts]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_constraints_are_the_capsules_rows_that_name_him"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_constraints_are_the_capsules_rows_that_name_him(await acquireFixture(t,()=>knott(temporary)));});







export let ASK_THE_EDITOR:any="I take the job. Give me the keys and the money; I'm off to the Globe to read the old papers.";
export let ARTY:any="Arty Wilmot";
export let MORGUE:any="newspaper-morgue";
export async function moved_to_the_morgue(client:any){

(await open_turn(client,ASK_THE_EDITOR));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:MORGUE})]}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt((await pyMethod(client,"table",["capsule"],{})),"present"))){__rows.push(pyEqual((await pyMethod(person,"get",["name"],{})),ARTY));}return __rows;})())))),pyStr("the city editor stands in the morgue"));
}
export async function test_said_before_a_move_the_line_is_not_theirs_and_the_arrival_stands_in_for_it(knott:any){
let before:any,who:any,packet:any,happened:any,both:any;
(await moved_to_the_morgue(knott));
before=pyAt((await situation(knott,ARTY)),"happened");
assert.ok(pyBool((await pyMethod(pyAt(before,(-1)),"endswith",[`declared: "${ASK_THE_EDITOR}"`],{}))),pyStr("without the host's reading, §143.1 as it was"));
who=pyAt((await pyMethod(pyAt(before,(-1)),"split",[" (investigator) declared: "],{})),0);
packet=(await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:ARTY,["declared_before_move"]:true})],{}));
happened=pyAt(packet,"happened");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(happened)){__rows.push(pyContains(line,ASK_THE_EDITOR));}return __rows;})()))))),pyStr(happened));
assert.ok(pyBool(pyEqual(pyAt(happened,(-1)),`${who} (investigator) has just arrived where ${ARTY} is`)),pyStr(happened));
both=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:ARTY,["declared_before_move"]:true,["addressed"]:true})],{})),"happened");
assert.ok(pyBool((await (async()=>{const __left=!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(both)){__rows.push(pyContains(line,ASK_THE_EDITOR));}return __rows;})()))));return pyBool(__left)?pyEqual(pyAt(both,(-1)),pyAt(happened,(-1))):__left;})())),"tests/kernel/test_npc_situation.py:250 assert not any(ASK_THE_EDITOR in line for line in both) and both[-1] == happened[-1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_said_before_a_move_the_line_is_not_theirs_and_the_arrival_stands_in_for_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_said_before_a_move_the_line_is_not_theirs_and_the_arrival_stands_in_for_it(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_person_it_was_said_to_has_it_and_no_one_else_does(knott:any){
let addressed:any,other:any;
(await open_turn(knott,"I tell Knott I will not take the job."));
addressed=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["addressed"]:true,["declared_before_move"]:false})],{})),"happened");
assert.ok(pyBool((await pyMethod(pyAt(addressed,(-1)),"endswith",["declared: \"I tell Knott I will not take the job.\""],{}))),pyStr(addressed));
other=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["addressed"]:false})],{})),"happened");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(other)){__rows.push(pyContains(line,"I will not take the job"));}return __rows;})()))))),pyStr("said to someone else: nothing stands in for it"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(other)){__rows.push(pyContains(line,"has just arrived"));}return __rows;})()))))),"tests/kernel/test_npc_situation.py:259 assert not any(\"has just arrived\" in line for line in other)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_person_it_was_said_to_has_it_and_no_one_else_does"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_person_it_was_said_to_has_it_and_no_one_else_does(await acquireFixture(t,()=>knott(temporary)));});
export async function test_the_readings_are_booleans_or_absent(knott:any){
let field:any,error:any;
(await open_turn(knott,"I look Knott over."));
for(field of pyIterable(["addressed","declared_before_move"])){
error=(await pyMethod(knott,"err",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",[field]:"yes"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),field):__left})())),pyStr(error));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_readings_are_booleans_or_absent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_readings_are_booleans_or_absent(await acquireFixture(t,()=>knott(temporary)));});






export let GIVE_IT_BACK:any="Then give me back my five dollars first.";
export async function test_words_that_named_no_one_are_said_to_no_one_by_name(knott:any){
let plain:any,who:any,unnamed:any,other:any,moved:any;
(await open_turn(knott,GIVE_IT_BACK));
plain=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["addressed"]:true,["named_no_one"]:false})],{})),"happened");
who=pyAt((await pyMethod(pyAt(plain,(-1)),"split",[" (investigator) declared: "],{})),0);
assert.ok(pyBool(pyEqual(pyAt(plain,(-1)),`${who} (investigator) declared: "${GIVE_IT_BACK}"`)),pyStr("named him: the words as they were"));
unnamed=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["addressed"]:true,["named_no_one"]:true})],{})),"happened");
assert.ok(pyBool(pyEqual(pyAt(unnamed,(-1)),`${who} (investigator) declared (to no one by name): "${GIVE_IT_BACK}"`)),pyStr(unnamed));
assert.ok(pyBool(pyEqual((await pySum((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(unnamed)){__rows.push(pyContains(line,GIVE_IT_BACK));}return __rows;})()))),1)),pyStr("the words once, as the closing sentence"));
other=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["addressed"]:false,["named_no_one"]:true})],{})),"happened");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(other)){__rows.push(pyContains(line,GIVE_IT_BACK));}return __rows;})()))))),pyStr(other));
moved=pyAt((await pyMethod(knott,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["declared_before_move"]:true,["named_no_one"]:true})],{})),"happened");
assert.ok(pyBool(pyEqual(pyAt(moved,(-1)),`${who} (investigator) has just arrived where Steven Knott is`)),pyStr(moved));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_words_that_named_no_one_are_said_to_no_one_by_name"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_words_that_named_no_one_are_said_to_no_one_by_name(await acquireFixture(t,()=>knott(temporary)));});
export async function test_named_no_one_is_a_boolean_or_absent(knott:any){
let error:any;
(await open_turn(knott,"I look Knott over."));
error=(await pyMethod(knott,"err",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott",["named_no_one"]:"yes"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"named_no_one"):__left})())),pyStr(error));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_named_no_one_is_a_boolean_or_absent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_named_no_one_is_a_boolean_or_absent(await acquireFixture(t,()=>knott(temporary)));});
