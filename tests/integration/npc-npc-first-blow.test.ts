// Migrated from tests/kernel/test_npc_first_blow.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,open_turn,read_json,campaign_dir,written,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";



const __unpack774=["walter-corbitt","thomas-hayes"];export let CORBITT:any=__unpack774[0];export let HAYES:any=__unpack774[1];
export async function at_corbitt(tmp_path:any){
let client:any=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
(await open_turn(client,"I creep into the cellar."));
return [client,(await walk_to_confrontation(client))];
}
export async function first_blow(client:any,n:any,extra:any={}){
let action:any=({["actor"]:"Walter Corbitt",["intent"]:"combat",["target"]:"Thomas Hayes",["goal"]:"strike",["method"]:"lunges out of the dark",...extra});
return (await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${n}`,"action":action}));
}
export async function test_a_first_blow_nobody_saw_coming_is_unopposed_with_a_bonus_die(tmp_path:any){
const __unpack1366=(await at_corbitt(tmp_path));let client:any=__unpack1366[0];let n:any=__unpack1366[1];
try{let opened:any=(await first_blow(client,n,({"surprise":true})));
assert.ok(pyBool((await pyMethod(pyAt(opened,"decision"),"endswith",["combat:attack"],{}))),"tests/kernel/test_npc_first_blow.py:31 assert opened[\"decision\"].endswith(\"combat:attack\")");
let roll:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["actor"],{})),CORBITT):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["combat_action"],{})),"attack"):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(roll,"bonus"),1);return pyBool(__left)?pyEqual((await pyLen(pyAt(roll,"tens_values"))),2):__left})())),pyStr("one bonus die for the attacker"));
let defended:any=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await written(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["actor"],{})),HAYES):__left})())))__rows.push(r);}return __rows;})());
assert.ok(pyBool(pyEqual(defended,[])),pyStr("no dodge and no fighting back"));
let session:any=pyAt((await pyMethod(client,"table",["look"],{"focus":"session"})),"session");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(session,"pending_defense")===null);return pyBool(__left)?pyEqual(pyAt(session,"round"),1):__left})())),"tests/kernel/test_npc_first_blow.py:37 assert session[\"pending_defense\"] is None and session[\"round\"] == 1");
let combat:any=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"save"),"combat.json")));
let order:any=(await (async()=>{const __rows:any[]=[];for(const value of pyIterable(pyAt(combat,"current_initiative"))){if(pyBool(true))__rows.push(pyAt(value,"actor_id"));}return __rows;})());
assert.ok(pyBool(pyEqual(pyAt(session,"turn_of"),pyAt(order,0))),pyStr("round 1 opens in DEX order after the blow; it spent no one's turn"));
if(pyBool(pyAt(roll,"passed"))){assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(true))__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"delta");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["resource"],{})),"hp"):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["subject"],{})),HAYES):__left})()));}return __rows;})())))),"tests/kernel/test_npc_first_blow.py:42 assert any(r[\"kind\"] == \"delta\" and r.get(\"resource\") == \"hp\" and r.get(\"subject\") == HAYES for r in client.table(\"status\")[\"receipts\"])");}}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_first_blow_nobody_saw_coming_is_unopposed_with_a_bonus_die"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_first_blow_nobody_saw_coming_is_unopposed_with_a_bonus_die(temporary);});
export async function test_a_first_blow_seen_coming_is_answered_with_a_defence_and_spends_no_turn(tmp_path:any){
const __unpack2702=(await at_corbitt(tmp_path));let client:any=__unpack2702[0];let n:any=__unpack2702[1];
try{let opened:any=(await first_blow(client,n));
let pending:any=pyAt(pyAt((await pyMethod(client,"table",["look"],{"focus":"session"})),"session"),"pending_defense");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pending,"actor"),HAYES);return pyBool(__left)?pyEqual(pyAt(pending,"attacker"),CORBITT):__left})());return pyBool(__left)?pyEqual(pyAt(pending,"for"),"player"):__left})())),"tests/kernel/test_npc_first_blow.py:52 assert pending[\"actor\"] == HAYES and pending[\"attacker\"] == CORBITT and pending[\"for\"] == \"player\"");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const hint of pyIterable(pyAt(opened,"hints"))){if(pyBool(true))__rows.push(pyContains(hint,"sees it coming"));}return __rows;})())))),"tests/kernel/test_npc_first_blow.py:53 assert any(\"sees it coming\" in hint for hint in opened[\"hints\"])");
let combat:any=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"save"),"combat.json")));
let cursor_before:any=pyAt(combat,"initiative_cursor");
(await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${pyAdd(n,1)}`,"action":({["actor"]:"Thomas Hayes",["intent"]:"combat",["decision"]:"combat:defend",["defense"]:"dodge",["goal"]:"combat:defend",["method"]:"combat:defend"})}));
let after:any=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"save"),"combat.json")));
assert.ok(pyBool((pyAt(after,"pending_attack")===null)),"tests/kernel/test_npc_first_blow.py:59 assert after[\"pending_attack\"] is None");
assert.ok(pyBool(pyEqual(pyAt(after,"initiative_cursor"),cursor_before)),pyStr("the first blow's defence moved no one's turn"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const value of pyIterable((await pyMethod(after,"get",["initiative_progress",[]],{})))){if(pyBool(true))__rows.push((await pyMethod(value,"get",["acted"],{})));}return __rows;})()))))),"tests/kernel/test_npc_first_blow.py:61 assert not any(value.get(\"acted\") for value in after.get(\"initiative_progress\", []))");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_first_blow_seen_coming_is_answered_with_a_defence_and_spends_no_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_first_blow_seen_coming_is_answered_with_a_defence_and_spends_no_turn(temporary);});
export async function test_only_a_person_present_opens_a_fight_on_an_investigator(tmp_path:any){
const __unpack3908=(await at_corbitt(tmp_path));let client:any=__unpack3908[0];let n:any=__unpack3908[1];
try{let refused:any=(await pyMethod(client,"table_err",["resolve"],{"call_id":`t1-c${n}`,"action":({["actor"]:"Walter Corbitt",["intent"]:"combat",["target"]:"Walter Corbitt",["goal"]:"strike",["method"]:"lunges"})}));
assert.ok(pyBool(pyContains(["needs","unknown_entity","turn_state"],pyAt(refused,"code"))),"tests/kernel/test_npc_first_blow.py:71 assert refused[\"code\"] in (\"needs\", \"unknown_entity\", \"turn_state\")");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_a_person_present_opens_a_fight_on_an_investigator"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_a_person_present_opens_a_fight_on_an_investigator(temporary);});
