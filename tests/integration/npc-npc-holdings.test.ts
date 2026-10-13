// Migrated from tests/kernel/test_npc_holdings.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,open_turn,read_json,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export let CORBITT:any="walter-corbitt";
export async function give_corbitt_a_weapon(client:any){
let path:any=pyDivide((await campaign_dir(client.workspace)),"world.json");
let world:any=(await read_json(path));
let objects:any=(await pyMethod(world,"setdefault",["objects",({})],{}));
(await pyMethod(objects,"setdefault",["definitions",({})],{}))["def-heavy-chair"]=({["id"]:"def-heavy-chair",["name"]:"heavy chair",["category"]:"item",["parameters"]:({["skill"]:"Fighting (Brawl)",["damage"]:"1D8",["uses_per_round"]:1})});
(await pyMethod(objects,"setdefault",["instances",({})],{}))["obj-heavy-chair"]=({["id"]:"obj-heavy-chair",["name"]:"heavy chair",["definition"]:"def-heavy-chair",["owner"]:({["kind"]:"npc",["id"]:CORBITT,["name"]:"Walter Corbitt"}),["quantity"]:1,["state"]:({["condition"]:"intact"})});
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
}
export async function test_an_npcs_owned_weapon_is_in_their_hands_from_the_first_blow(tmp_path:any){
let client:any=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await open_turn(client,"I creep into the cellar."));
let n:any=(await walk_to_confrontation(client));
(await give_corbitt_a_weapon(client));
(await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${n}`,"action":({["actor"]:"Walter Corbitt",["intent"]:"combat",["target"]:"Thomas Hayes",["goal"]:"strike",["method"]:"swings the chair"})}));
let combat:any=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"save"),"combat.json")));
let corbitt:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(combat,"participants"))){if(pyBool(pyEqual(pyAt(p,"actor_id"),CORBITT)))__rows.push(p);}return __rows;})())));
let held:any=(await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt(corbitt,"weapons"))){if(pyBool(true))__rows.push((pyBool((await pyIsInstance(w,pyDict)))?(await pyMethod(w,"get",["weapon_id"],{})):w));}return __rows;})());
assert.ok(pyBool(pyContains(held,"obj-heavy-chair")),pyStr(held));
assert.ok(pyBool(pyEqual((await pyMethod(held,"count",["obj-heavy-chair"],{})),1)),"tests/kernel/test_npc_holdings.py:42 assert held.count(\"obj-heavy-chair\") == 1");
assert.ok(pyBool(pyContains(pyAt(combat,"weapon_catalog"),"obj-heavy-chair")),"tests/kernel/test_npc_holdings.py:43 assert \"obj-heavy-chair\" in combat[\"weapon_catalog\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npcs_owned_weapon_is_in_their_hands_from_the_first_blow"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npcs_owned_weapon_is_in_their_hands_from_the_first_blow(temporary);});
export async function test_an_npc_strikes_with_the_thing_they_hold(tmp_path:any){
let client:any=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await open_turn(client,"I creep into the cellar."));
let n:any=(await walk_to_confrontation(client));
(await give_corbitt_a_weapon(client));
(await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${n}`,"action":({["actor"]:"Walter Corbitt",["intent"]:"combat",["target"]:"Thomas Hayes",["weapon"]:"heavy chair",["surprise"]:true,["goal"]:"strike",["method"]:"swings the chair"})}));
let roll:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["actor"],{})),CORBITT):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["combat_action"],{})),"attack"):__left})())))__rows.push(r);}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(roll,"skill"),"Fighting (Brawl)")),pyStr(roll));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npc_strikes_with_the_thing_they_hold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npc_strikes_with_the_thing_they_hold(temporary);});
