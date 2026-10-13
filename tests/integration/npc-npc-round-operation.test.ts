// Migrated from tests/kernel/test_npc_round_operation.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {campaign_dir,narrate,read_json,resolve,resolve_err,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {CORBITT,INVESTIGATOR,client_with,corbitts_turn} from "./npc-npc-standing-action.test.ts";





export let HURL:any="Hurl the brass lamp at the investigator's lantern to plunge the cellar into darkness.";
export async function ledger_intents(client:any){
let ledger:any;
ledger=(await read_json(pyDivide((await campaign_dir(client.workspace)),"npc-ledger.json")));
return (await pyMethod((await pyNext((await (async()=>{const __rows:any[]=[];for(const [key,entry] of pyIterable((await pyMethod(ledger,"items",[],{})))){if(pyBool(pyContains(key,"corbitt")))__rows.push(entry);}return __rows;})()))),"get",["intents",[]],{}));
}
export async function receipts_of(client:any,applied:any){
return (await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(pyAt(applied,"receipts"),pyAt(r,"id"))))__rows.push(r);}return __rows;})());
}
export async function* fight(tmp_path:any){
let client:any;
client=(await client_with(tmp_path,({["disposition"]:"fights_to_the_end"})));
yield client;
(await pyMethod(client,"close",[],{}));
}
export async function test_an_npc_spends_their_own_turn_on_something_else_and_the_fight_moves_on(fight:any){
let n:any,applied:any,receipt:any,session:any,attacked:any,row:any;
n=(await corbitts_turn(fight));
applied=(await pyMethod(fight,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted",["spend_turn"]:true,["why"]:"the light hurts him"})]}));
const __unpack1965=(await receipts_of(fight,applied));receipt=__unpack1965[0];
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(receipt,"intent"),"text"),HURL);return pyBool(__left)?pyEqual(pyAt(pyAt(receipt,"intent"),"outcome"),"attempted"):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(receipt,"intent"),"npc"),CORBITT):__left})())),"tests/kernel/test_npc_round_operation.py:43 assert receipt[\"intent\"][\"text\"] == HURL and receipt[\"intent\"][\"outcome\"] == \"attempted\" and receipt[\"intent\"][\"npc\"] == CORBITT");
assert.ok(pyBool(pyEqual(pyAt(receipt,"passes_turn"),({["combat_id"]:"corbitt-final-combat-t1",["round"]:1,["turn_of"]:INVESTIGATOR}))),"tests/kernel/test_npc_round_operation.py:44 assert receipt[\"passes_turn\"] == {\"combat_id\": \"corbitt-final-combat-t1\", \"round\": 1, \"turn_of\": INVESTIGATOR}");
session=pyAt((await pyMethod(fight,"table",["look"],{"focus":"session"})),"session");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"turn_of"),INVESTIGATOR);return pyBool(__left)?pyEqual(pyAt(session,"round"),2):__left})())),pyStr("his turn is spent; the next round opens on the investigator"));
attacked=(await resolve(fight,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
assert.ok(pyBool((await pyMethod(pyAt(attacked,"decision"),"endswith",["combat:attack"],{}))),"tests/kernel/test_npc_round_operation.py:49 assert attacked[\"decision\"].endswith(\"combat:attack\")");
(await narrate(fight,`t1-c${pyAdd(n,2)}`,"The lamp shatters against the wall."));
const __unpack2794=(await ledger_intents(fight));row=__unpack2794[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"text"),HURL);return pyBool(__left)?pyEqual(pyAt(row,"status"),"attempted"):__left})())),"tests/kernel/test_npc_round_operation.py:52 assert row[\"text\"] == HURL and row[\"status\"] == \"attempted\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npc_spends_their_own_turn_on_something_else_and_the_fight_moves_on"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npc_spends_their_own_turn_on_something_else_and_the_fight_moves_on(await acquireFixture(t,()=>fight(temporary)));});
export async function test_spend_turn_is_refused_off_their_turn_and_outside_a_fight(fight:any){
let n:any,refused:any,clock:any,batch:any,outside:any;
n=(await corbitts_turn(fight));
(await pyMethod(fight,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["action"]:"hold",["why"]:"he freezes"})]}));
refused=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted",["spend_turn"]:true})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"turn_of"),INVESTIGATOR):__left})())),"tests/kernel/test_npc_round_operation.py:60 assert refused[\"code\"] == \"turn_state\" and refused[\"details\"][\"turn_of\"] == INVESTIGATOR");
clock=pyAt((await read_json(pyDivide((await campaign_dir(fight.workspace)),"world.json"))),"clock");
batch=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"time",["minutes"]:5,["why"]:"a pause"}),({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted",["spend_turn"]:true})]}));
assert.ok(pyBool(pyEqual(pyAt(batch,"code"),"turn_state")),"tests/kernel/test_npc_round_operation.py:65 assert batch[\"code\"] == \"turn_state\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(fight.workspace)),"world.json"))),"clock"),clock)),pyStr("the refused batch wrote nothing"));
(await pyMethod(fight,"table",["resolve"],{"call_id":`t1-c${pyAdd(n,2)}`,"action":({["intent"]:"combat",["decision"]:"combat:end",["outcome"]:"stalemate",["goal"]:"run",["method"]:"run"})}));
outside=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,3)}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted",["spend_turn"]:true})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outside,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(outside,"details"),"field"),"npc.spend_turn"):__left})())),"tests/kernel/test_npc_round_operation.py:71 assert outside[\"code\"] == \"invalid_params\" and outside[\"details\"][\"field\"] == \"npc.spend_turn\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_spend_turn_is_refused_off_their_turn_and_outside_a_fight"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_spend_turn_is_refused_off_their_turn_and_outside_a_fight(await acquireFixture(t,()=>fight(temporary)));});
export async function test_the_stuck_turn_refusal_names_the_lawful_ways_on(fight:any){
let n:any,refused:any;
n=(await corbitts_turn(fight));
refused=(await resolve_err(fight,`t1-c${n}`,({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"turn_of"),CORBITT):__left})())),"tests/kernel/test_npc_round_operation.py:77 assert refused[\"code\"] == \"turn_state\" and refused[\"details\"][\"turn_of\"] == CORBITT");
assert.ok(pyBool(pyContains(pyAt(refused,"fix"),"spend_turn")),pyStr("a person who spends the turn on something else is a way on"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_stuck_turn_refusal_names_the_lawful_ways_on"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_stuck_turn_refusal_names_the_lawful_ways_on(await acquireFixture(t,()=>fight(temporary)));});
export async function test_an_npcs_roll_in_a_fight_is_their_own_check_not_an_attack(fight:any){
let n:any,rolled:any,roll:any;
n=(await corbitts_turn(fight));
rolled=(await resolve(fight,`t1-c${n}`,({"actor":"Walter Corbitt","intent":"investigate","skill":"Spot Hidden","goal":"find the lantern's flame","method":"scan the dark"})));
assert.ok(pyBool(pyEqual(pyAt(rolled,"decision"),"core-check:ordinary-check")),pyStr("before §142.6 this settled as decision:coc7:combat:attack"));
roll=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(fight,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),`t1-c${n}`):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((pyAt(roll,"actor_is_investigator")===false)),"tests/kernel/test_npc_round_operation.py:87 assert roll[\"actor_is_investigator\"] is False");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(fight,"table",["look"],{"focus":"session"})),"session"),"turn_of"),CORBITT)),pyStr("a roll alone does not spend the turn"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npcs_roll_in_a_fight_is_their_own_check_not_an_attack"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npcs_roll_in_a_fight_is_their_own_check_not_an_attack(await acquireFixture(t,()=>fight(temporary)));});
export async function test_a_roll_and_an_effect_report_an_intentions_result(fight:any){
let n:any,applied:any,ref:any,rolled:any,roll:any,expected:any,before:any,again:any;
n=(await corbitts_turn(fight));
applied=(await pyMethod(fight,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted"})]}));
ref=pyAt(pyAt(pyAt((await receipts_of(fight,applied)),0),"intent"),"ref");
rolled=(await resolve(fight,`t1-c${pyAdd(n,1)}`,({"actor":"Walter Corbitt","intent":"investigate","skill":"Throw","goal":"hit the lantern","method":"throw the lamp","intent_ref":ref})));
roll=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(fight,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),`t1-c${pyAdd(n,1)}`):__left})())))__rows.push(r);}return __rows;})())));
expected=(pyBool(pyAt(roll,"passed"))?"done":"failed");
assert.ok(pyBool(pyEqual(pyAt(roll,"intent"),({["ref"]:ref,["npc"]:CORBITT,["text"]:HURL,["outcome"]:expected}))),"tests/kernel/test_npc_round_operation.py:99 assert roll[\"intent\"] == {\"ref\": ref, \"npc\": CORBITT, \"text\": HURL, \"outcome\": expected}");
assert.ok(pyBool(pyEqual(pyAt(rolled,"decision"),"core-check:ordinary-check")),"tests/kernel/test_npc_round_operation.py:100 assert rolled[\"decision\"] == \"core-check:ordinary-check\"");
before=(await pyLen(pyAt((await pyMethod(fight,"table",["status"],{})),"receipts")));
again=(await resolve_err(fight,`t1-c${pyAdd(n,2)}`,({"actor":"Walter Corbitt","intent":"investigate","skill":"Throw","goal":"hit the lantern","method":"throw again","intent_ref":ref})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(again,"details"),"reason"),"intent_settled")),"tests/kernel/test_npc_round_operation.py:105 assert again[\"details\"][\"reason\"] == \"intent_settled\"");
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await pyMethod(fight,"table",["status"],{})),"receipts"))),before)),pyStr("nothing was rolled"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_roll_and_an_effect_report_an_intentions_result"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_roll_and_an_effect_report_an_intentions_result(await acquireFixture(t,()=>fight(temporary)));});
export async function test_any_effect_can_be_the_result_of_someone_elses_intention(fight:any){
let n:any,applied:any,ref:any,ticked:any,receipt:any,refused:any,bad:any;
n=(await corbitts_turn(fight));
applied=(await pyMethod(fight,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted"})]}));
ref=pyAt(pyAt(pyAt((await receipts_of(fight,applied)),0),"intent"),"ref");
ticked=(await pyMethod(fight,"table",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"threat",["name"]:"corbitt-haunting",["clock"]:"corbitt-awareness",["intent_ref"]:ref,["why"]:"the dark feeds him"})]}));
const __unpack7587=(await receipts_of(fight,ticked));receipt=__unpack7587[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"kind"),"threat");return pyBool(__left)?pyEqual(pyAt(receipt,"intent"),({["ref"]:ref,["npc"]:CORBITT,["text"]:HURL,["outcome"]:"done"})):__left})())),"tests/kernel/test_npc_round_operation.py:115 assert receipt[\"kind\"] == \"threat\" and receipt[\"intent\"] == {\"ref\": ref, \"npc\": CORBITT, \"text\": HURL, \"outcome\": \"done\"}");
refused=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,2)}`,"effects":[({["kind"]:"threat",["name"]:"corbitt-haunting",["clock"]:"corbitt-awareness",["intent_ref"]:ref})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(refused,"details"),"reason"),"intent_settled")),"tests/kernel/test_npc_round_operation.py:117 assert refused[\"details\"][\"reason\"] == \"intent_settled\"");
bad=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,3)}`,"effects":[({["kind"]:"threat",["name"]:"corbitt-haunting",["clock"]:"corbitt-awareness",["intent_ref"]:ref,["intent_outcome"]:"maybe"})]}));
assert.ok(pyBool((await pyMethod(pyAt(pyAt(bad,"details"),"field"),"endswith",["intent_outcome"],{}))),"tests/kernel/test_npc_round_operation.py:119 assert bad[\"details\"][\"field\"].endswith(\"intent_outcome\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_any_effect_can_be_the_result_of_someone_elses_intention"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_any_effect_can_be_the_result_of_someone_elses_intention(await acquireFixture(t,()=>fight(temporary)));});
export async function test_an_npc_who_flees_flees_and_the_pursuit_is_the_investigators_choice(fight:any){
let n:any,actions:any,fled:any,named:any,hint:any;

n=(await corbitts_turn(fight));
actions=pyAt(pyAt((await pyMethod(fight,"table",["look"],{"focus":"session"})),"session"),"actions");
assert.ok(pyBool(pyContains(actions,({["decision"]:"combat:flee",["actor"]:CORBITT}))),"tests/kernel/test_npc_round_operation.py:127 assert {\"decision\": \"combat:flee\", \"actor\": CORBITT} in actions");
fled=(await resolve(fight,`t1-c${n}`,({"actor":"Walter Corbitt","intent":"flee","goal":"get away","method":"run for the stairs"})));
assert.ok(pyBool((await pyMethod(pyAt(fled,"decision"),"endswith",["combat:flee"],{}))),"tests/kernel/test_npc_round_operation.py:129 assert fled[\"decision\"].endswith(\"combat:flee\")");
named=(await (async()=>{const __rows:any[]=[];for(const hint of pyIterable(pyAt(fled,"hints"))){if(pyBool(pyContains(hint,CORBITT)))__rows.push(hint);}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(named)),1)),pyStr(pyAt(fled,"hints")));
hint=pyAt(named,0);
assert.ok(pyBool((await (async()=>{const __left=pyContains(hint,"apply npc to: away");return pyBool(__left)?pyContains(hint,"quarry"):__left})())),pyStr(hint));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyContains(hint,`if ${INVESTIGATOR} gives chase`);return pyBool(__left)?pyContains(hint,"resolve chase:start"):__left})());return pyBool(__left)?pyContains(hint,"actor: <that investigator>"):__left})())),pyStr(hint));
assert.ok(pyBool(pyContains(hint,`target ${CORBITT}`)),pyStr(hint));
assert.ok(pyBool((pyAt((await pyMethod(fight,"table",["look"],{"focus":"session"})),"session")===null)),pyStr("he was the only one fighting them: the fight is over"));
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const c of pyIterable((await pyMethod(fled,"get",["continuations",[]],{})))){if(pyBool((await (async()=>{const __left=pyContains((await pyStr((await pyMethod(c,"get",["decision",""],{})))),"chase");return pyBool(__left)?(await pyMethod(c,"get",["executed"],{})):__left})())))__rows.push(c);}return __rows;})()))),pyStr("a pursuit is the investigators' choice, never started for them"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npc_who_flees_flees_and_the_pursuit_is_the_investigators_choice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npc_who_flees_flees_and_the_pursuit_is_the_investigators_choice(await acquireFixture(t,()=>fight(temporary)));});
export async function test_every_refusal_of_a_ref_says_where_refs_are_and_lists_the_options(fight:any){
let where:any,n:any,applied:any,ref:any,under_way:any,bad:any,reason:any,refused:any,nobody:any,rolled:any,unresolved:any,settled:any;

where="refs are on the capsule at present[].history.intents[].ref, or in details.options here";
n=(await corbitts_turn(fight));
applied=(await pyMethod(fight,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intends"]:HURL,["outcome"]:"attempted"})]}));
ref=pyAt(pyAt(pyAt((await receipts_of(fight,applied)),0),"intent"),"ref");
under_way=[({["ref"]:ref,["intent"]:HURL,["status"]:"attempted"})];
for([bad,reason] of pyIterable([["@intent-placeholder",null],["intent:walter-corbitt:0123456789ab","unknown_intent"]])){
refused=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intent_ref"]:bad,["intent_outcome"]:"done"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(refused,"fix"),where):__left})())),pyStr(refused));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(pyAt(refused,"details"),"get",["reason"],{})),reason);return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"options"),under_way):__left})())),"tests/kernel/test_npc_round_operation.py:157 assert refused[\"details\"].get(\"reason\") == reason and refused[\"details\"][\"options\"] == under_way");
}
nobody=(await pyMethod(fight,"table_err",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"threat",["name"]:"corbitt-haunting",["clock"]:"corbitt-awareness",["intent_ref"]:"@intent-placeholder"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(nobody,"fix"),where);return pyBool(__left)?pyEqual(pyAt(pyAt(nobody,"details"),"options"),[({...pyAt(under_way,0),["npc"]:CORBITT})]):__left})())),"tests/kernel/test_npc_round_operation.py:160 assert where in nobody[\"fix\"] and nobody[\"details\"][\"options\"] == [{**under_way[0], \"npc\": CORBITT}]");
rolled=(await resolve_err(fight,`t1-c${pyAdd(n,1)}`,({"actor":"Walter Corbitt","intent":"investigate","skill":"Throw","goal":"hit the lantern","method":"throw the lamp","intent_ref":"@intent-placeholder"})));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(rolled,"fix"),where);return pyBool(__left)?pyEqual(pyAt(pyAt(rolled,"details"),"options"),[({...pyAt(under_way,0),["npc"]:CORBITT})]):__left})())),"tests/kernel/test_npc_round_operation.py:163 assert where in rolled[\"fix\"] and rolled[\"details\"][\"options\"] == [{**under_way[0], \"npc\": CORBITT}]");
(await narrate(fight,`t1-c${pyAdd(n,1)}`,"The lamp is in his hand."));
(await pyMethod(fight,"table",["player_input"],{"text":"I keep swinging."}));
unresolved=(await pyMethod(fight,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intent_ref"]:ref,["outcome"]:"attempted"})]}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(unresolved,"details"),"reason"),"intent_unresolved");return pyBool(__left)?pyContains(pyAt(unresolved,"fix"),where):__left})());return pyBool(__left)?pyContains(pyAt(unresolved,"fix"),"details.ref"):__left})())),"tests/kernel/test_npc_round_operation.py:168 assert unresolved[\"details\"][\"reason\"] == \"intent_unresolved\" and where in unresolved[\"fix\"] and \"details.ref\" in unresolved[\"fix\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(unresolved,"details"),"options"),under_way)),"tests/kernel/test_npc_round_operation.py:169 assert unresolved[\"details\"][\"options\"] == under_way");
(await pyMethod(fight,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intent_ref"]:ref,["outcome"]:"failed"})]}));
settled=(await pyMethod(fight,"table_err",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["intent_ref"]:ref,["outcome"]:"abandoned"})]}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(settled,"details"),"reason"),"intent_settled");return pyBool(__left)?(await pyMethod(pyAt(settled,"fix"),"startswith",["its result stands"],{})):__left})());return pyBool(__left)?pyContains(pyAt(settled,"fix"),where):__left})())),"tests/kernel/test_npc_round_operation.py:173 assert settled[\"details\"][\"reason\"] == \"intent_settled\" and settled[\"fix\"].startswith(\"its result stands\") and where in settled[\"fix\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(settled,"details"),"options"),[])),"tests/kernel/test_npc_round_operation.py:174 assert settled[\"details\"][\"options\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_every_refusal_of_a_ref_says_where_refs_are_and_lists_the_options"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_every_refusal_of_a_ref_says_where_refs_are_and_lists_the_options(await acquireFixture(t,()=>fight(temporary)));});
