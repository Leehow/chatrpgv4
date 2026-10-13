// Migrated from tests/kernel/test_mechanics_readers.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,open_turn,read_json,resolve,resolve_err,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_mechanics_readers.py',import.meta.url).pathname;





export let SOURCE:any=({["source_id"]:"pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting",["pdf_index"]:452});
export let SPAN:any="span-page-447-anchor-1";
export let START:any="scene-commission-briefing";
export let HOUND:any="cellar-hound";
export async function stated(graph:any,kind:any,slug:any,mechanics:any,name:any=null){
(await pyMethod(pyAt(graph,"nodes"),"append",[({["node_id"]:`${kind}-${slug}`,["node_kind"]:kind,["name"]:(await (async()=>{const __left=name;return pyBool(__left)?__left:slug})()),["visibility"]:"keeper-only",["aliases"]:[],["summary"]:`${slug}.`,["evidence_span_ids"]:[SPAN],["properties"]:({["mechanics"]:mechanics}),["source_refs"]:[SOURCE]})],{}));
}
Object.defineProperty(stated,"__pySignature",{value:[{"name":"graph","rest":false,"varargs":false},{"name":"kind","rest":false,"varargs":false},{"name":"slug","rest":false,"varargs":false},{"name":"mechanics","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false}]});
export async function hound_profile(sanity_loss:any){
return ({["characteristics"]:({["STR"]:60,["CON"]:50,["SIZ"]:50,["DEX"]:70,["POW"]:40}),["derived"]:({["HP"]:10,["MOV"]:10}),["skills"]:({["Fighting (Brawl)"]:45,["Dodge"]:35}),["weapons"]:[({["weapon_id"]:"bite",["skill"]:"Fighting (Brawl)",["damage"]:"1D6",["uses_per_round"]:1,["impale"]:false})],["sanity_loss"]:sanity_loss});
}
Object.defineProperty(hound_profile,"__pySignature",{value:[{"name":"sanity_loss","rest":false,"varargs":false}]});
export async function derived_content(tmp_path:any,sanity_loss:any=null){
let content:any,path:any,graph:any;
content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(content,"starters"),"the-haunting"),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
(await pyInvoke(stated,[graph,"creature",HOUND,({["profile"]:(await pyInvoke(hound_profile,[(await (async()=>{const __left=sanity_loss;return pyBool(__left)?__left:({["success"]:"0",["failure"]:"1D6"})})())],{}))})],{"name":"Cellar hound"}));
(await pyMethod(pyAt(graph,"relations"),"append",[({["relation_id"]:"relation-rd02-hound",["relation_kind"]:"present-in",["from_node_id"]:`creature-${HOUND}`,["to_node_id"]:START,["properties"]:({})})],{}));
(await pyInvoke(stated,[graph,"spell","veil-of-thorns",({["spell"]:({["cost_mp"]:3,["cost_sanity"]:"1D4",["casting_time"]:({["amount"]:1,["unit"]:"round"})})})],{"name":"Veil of Thorns"}));
(await pyInvoke(stated,[graph,"tome","thorn-grimoire",({["tome"]:({["initial_reading"]:({["amount"]:3,["unit"]:"hour"}),["spells"]:["spell-veil-of-thorns"]})})],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return content;
}
Object.defineProperty(derived_content,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"sanity_loss","rest":false,"varargs":false}]});
export async function test_a_creature_with_a_stat_block_is_fought_with_the_books_numbers(tmp_path:any){
let client:any,opened:any,attack:any,session:any,snapshot:any,hound:any,strike:any,swing:any,pending:any,defend:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":(await pyInvoke(derived_content,[tmp_path],{}))})));
try{opened=(await pyInvoke(open_turn,[client,"I punch the hound."],{}));
assert.ok(pyBool(pyContains((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt(pyAt(opened,"capsule"),"present"))){__rows.push(pyAt(person,"name"));}return __rows;})()),"Cellar hound")),"tests/kernel/test_mechanics_readers.py:55 assert \"Cellar hound\" in [person[\"name\"] for person in opened[\"capsule\"][\"present\"]]");
attack=(await pyInvoke(resolve,[client,"t1-c1"],{"intent":"combat","goal":"hit it","method":"fists","target":HOUND,"weapon":"unarmed"}));
session=pyAt(attack,"session");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(session,"status"),"active"):__left})())),"tests/kernel/test_mechanics_readers.py:58 assert session[\"kind\"] == \"combat\" and session[\"status\"] == \"active\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(attack,"outcome"),"initiative"))){__rows.push(pyAt(row,"actor_id"));}return __rows;})()),[HOUND,"thomas-hayes"])),"tests/kernel/test_mechanics_readers.py:60 assert [row[\"actor_id\"] for row in attack[\"outcome\"][\"initiative\"]] == [HOUND, \"thomas-hayes\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(session,"participants"))){if(pyBool(pyEqual(pyAt(p,"name"),HOUND))){__rows.push(p);}}return __rows;})()))),"hp_max"),10)),"tests/kernel/test_mechanics_readers.py:61 assert next(p for p in session[\"participants\"] if p[\"name\"] == HOUND)[\"hp_max\"] == 10");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"turn_of"),HOUND);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(session,"actions"),0),"weapons"),["bite"]):__left})())),"tests/kernel/test_mechanics_readers.py:62 assert session[\"turn_of\"] == HOUND and session[\"actions\"][0][\"weapons\"] == [\"bite\"]");
snapshot=(await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"combat.json")],{}));
hound=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(snapshot,"participants"))){if(pyBool(pyEqual(pyAt(p,"actor_id"),HOUND))){__rows.push(p);}}return __rows;})())));
assert.ok(pyBool(pyEqual([pyAt(hound,"combat_skill"),pyAt(hound,"dodge_skill"),pyAt(hound,"dex")],[45,35,70])),"tests/kernel/test_mechanics_readers.py:65 assert (hound[\"combat_skill\"], hound[\"dodge_skill\"], hound[\"dex\"]) == (45, 35, 70)");
assert.ok(pyBool(pyEqual(pyAt(hound,"weapons"),[({["weapon_id"]:"bite",["skill"]:"Fighting (Brawl)",["damage"]:"1D6",["uses_per_round"]:"1",["impales"]:false})])),"tests/kernel/test_mechanics_readers.py:67 assert hound[\"weapons\"] == [{\"weapon_id\": \"bite\", \"skill\": \"Fighting (Brawl)\", \"damage\": \"1D6\", \"uses_per_round\": \"1\", \"impales\": False}]");
strike=(await pyInvoke(resolve,[client,"t1-c2"],{"intent":"combat","goal":"it lunges","method":"","actor":HOUND,"target":"Thomas Hayes"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(strike,"session"),"pending_defense"),"for"),"player")),"tests/kernel/test_mechanics_readers.py:69 assert strike[\"session\"][\"pending_defense\"][\"for\"] == \"player\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"combat.json")],{})),"pending_attack"),"weapon_id"),"bite")),"tests/kernel/test_mechanics_readers.py:70 assert read_json(campaign_dir(client.workspace) / \"save\" / \"combat.json\")[\"pending_attack\"][\"weapon_id\"] == \"bite\"");
(await pyInvoke(resolve,[client,"t1-c3"],{"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"thomas-hayes","defense":"dodge"}));
swing=(await pyInvoke(resolve,[client,"t1-c4"],{"intent":"combat","goal":"hit it","method":"fists","target":HOUND,"weapon":"unarmed"}));
pending=pyAt(pyAt(swing,"session"),"pending_defense");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"for"),"npc");return pyBool(__left)?pyEqual(pyAt(pending,"actor"),HOUND):__left})())),"tests/kernel/test_mechanics_readers.py:74 assert pending[\"for\"] == \"npc\" and pending[\"actor\"] == HOUND");
assert.ok(pyBool(pyEqual(pyAt(pending,"standing"),({["defense"]:"fight_back",["basis"]:"rule-default"}))),"tests/kernel/test_mechanics_readers.py:76 assert pending[\"standing\"] == {\"defense\": \"fight_back\", \"basis\": \"rule-default\"}");
defend=(await pyInvoke(resolve,[client,"t1-c5"],{"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":HOUND,"defense":pyAt(pyAt(pending,"standing"),"defense")}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(defend,"decision"),"combat:defend");return pyBool(__left)?pyEqual(pyAt(pyAt(defend,"outcome"),"defense"),"fight_back"):__left})())),"tests/kernel/test_mechanics_readers.py:79 assert defend[\"decision\"] == \"combat:defend\" and defend[\"outcome\"][\"defense\"] == \"fight_back\"");
assert.ok(pyBool(pyContains((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(defend,"outcome"),"rolls"))){__rows.push(({["actor"]:pyAt(r,"actor"),["target"]:pyAt(r,"target")}));}return __rows;})()),({["actor"]:HOUND,["target"]:45}))),"tests/kernel/test_mechanics_readers.py:80 assert {\"actor\": HOUND, \"target\": 45} in [{\"actor\": r[\"actor\"], \"target\": r[\"target\"]} for r in defend[\"outcome\"][\"rolls\"]]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_creature_with_a_stat_block_is_fought_with_the_books_numbers,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_creature_with_a_stat_block_is_fought_with_the_books_numbers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_creature_with_a_stat_block_is_fought_with_the_books_numbers(temporary);});
export async function sanity_check(client:any,call_id:any,extra:any={}){
return (await pyInvoke(pyDict,[],{"intent":"investigate","goal":"the hound's face in the dark","method":"looks at it","decision":"sanity:check","target":HOUND,"involuntary":"flee",...extra}));
}
Object.defineProperty(sanity_check,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function test_sanity_check_rolls_the_typed_loss_without_action_san_loss(tmp_path:any){
let client:any,result:any,outcome:any,receipts:any,rolled:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":(await pyInvoke(derived_content,[tmp_path],{}))})));
try{(await pyInvoke(open_turn,[client,"I look at the hound."],{}));
result=(await pyInvoke(resolve,[client,"t1-c1"],{...(await pyInvoke(sanity_check,[client,"t1-c1"],{}))}));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"sanity:check")),"tests/kernel/test_mechanics_readers.py:95 assert result[\"decision\"] == \"sanity:check\"");
outcome=pyAt(result,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(outcome,"passed")===false);return pyBool(__left)?(await (async()=>{const __term0=1;const __term1=pyAt(outcome,"san_loss");const __term2=6;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()):__left})())),"tests/kernel/test_mechanics_readers.py:98 assert outcome[\"passed\"] is False and 1 <= outcome[\"san_loss\"] <= 6");
receipts=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turn.json")],{})),"receipts"))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
rolled=pyAt(receipts,"roll:san-loss-t1-c1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(rolled,"expression"),"1D6");return pyBool(__left)?pyEqual(pyAt(rolled,"total"),pyAt(outcome,"san_loss")):__left})())),"tests/kernel/test_mechanics_readers.py:101 assert rolled[\"expression\"] == \"1D6\" and rolled[\"total\"] == outcome[\"san_loss\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_sanity_check_rolls_the_typed_loss_without_action_san_loss,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sanity_check_rolls_the_typed_loss_without_action_san_loss"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sanity_check_rolls_the_typed_loss_without_action_san_loss(temporary);});
export async function test_an_unstated_half_is_the_keepers_to_complete(tmp_path:any){
let content:any,client:any,refused:any,own:any;
content=(await pyInvoke(derived_content,[tmp_path],{"sanity_loss":({["success"]:"0",["failure_unstated"]:true})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":content})));
try{(await pyInvoke(open_turn,[client,"I look at the hound."],{}));
refused=(await pyInvoke(resolve_err,[client,"t1-c1"],{...(await pyInvoke(sanity_check,[client,"t1-c1"],{}))}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(refused,"details"),"needs"),"field"),"san_loss"):__left})())),"tests/kernel/test_mechanics_readers.py:112 assert refused[\"code\"] == \"needs\" and refused[\"details\"][\"needs\"][\"field\"] == \"san_loss\"");
own=(await pyInvoke(resolve,[client,"t1-c1"],{...(await pyInvoke(sanity_check,[client,"t1-c1"],{"san_loss":"0/1D3"}))}));
assert.ok(pyBool(pyEqual(pyAt(own,"decision"),"sanity:check")),"tests/kernel/test_mechanics_readers.py:115 assert own[\"decision\"] == \"sanity:check\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_an_unstated_half_is_the_keepers_to_complete,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unstated_half_is_the_keepers_to_complete"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unstated_half_is_the_keepers_to_complete(temporary);});
export async function test_a_spell_named_by_a_tome_is_learned_and_cast_at_its_stated_price(tmp_path:any){
let client:any,n:any,learned:any,cast:any,outcome:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":(await pyInvoke(derived_content,[tmp_path],{}))})));
try{(await pyInvoke(open_turn,[client,"I read the grimoire."],{}));
let learningSucceeded=false;
for(n of pyIterable((await pyInvoke(pyRange,[1,40],{})))){
learned=(await pyInvoke(resolve,[client,`t1-c${n}`],{"intent":"investigate","goal":"learn the Veil of Thorns","method":"study the grimoire","spell":"Veil of Thorns","target":"thorn-grimoire"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(learned,"decision"),"magic:learn-spell");return pyBool(__left)?pyEqual(pyAt(pyAt(learned,"outcome"),"source"),"tome"):__left})())),"tests/kernel/test_mechanics_readers.py:127 assert learned[\"decision\"] == \"magic:learn-spell\" and learned[\"outcome\"][\"source\"] == \"tome\"");
if(pyBool(pyEqual(pyAt(pyAt(learned,"outcome"),"status"),"studying"))){learningSucceeded=true;break;}
assert.ok(pyBool(pyEqual(pyAt(pyAt(learned,"outcome"),"status"),"failed")),"tests/kernel/test_mechanics_readers.py:130 assert learned[\"outcome\"][\"status\"] == \"failed\"");
}
if(!learningSucceeded)throw new assert.AssertionError({message:"no successful learning roll in 39 attempts"});
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"time",["minutes"]:pyAt(pyAt(learned,"outcome"),"study_due_minutes")})]}));
cast=(await pyInvoke(resolve,[client,`t1-c${pyAdd(n,2)}`],{"intent":"cast","goal":"the thorns rise","method":"cast","spell":"Veil of Thorns"}));
assert.ok(pyBool(pyEqual(pyAt(cast,"decision"),"magic:cast-spell")),"tests/kernel/test_mechanics_readers.py:135 assert cast[\"decision\"] == \"magic:cast-spell\"");
outcome=pyAt(cast,"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"spell"),"Veil of Thorns");return pyBool(__left)?pyEqual(pyAt(outcome,"mp_spent"),3):__left})())),pyStr(outcome));
if(pyBool(pyEqual(pyAt(outcome,"status"),"cast"))){assert.ok(pyBool((await (async()=>{const __term0=1;const __term1=pyAt(outcome,"san_lost");const __term2=4;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_mechanics_readers.py:139 assert 1 <= outcome[\"san_lost\"] <= 4");}}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_spell_named_by_a_tome_is_learned_and_cast_at_its_stated_price,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_spell_named_by_a_tome_is_learned_and_cast_at_its_stated_price"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_spell_named_by_a_tome_is_learned_and_cast_at_its_stated_price(temporary);});
