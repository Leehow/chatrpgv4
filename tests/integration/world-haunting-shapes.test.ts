// Migrated from tests/kernel/test_haunting_shapes.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,RpcClient,campaign_dir,read_json,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_haunting_shapes.py',import.meta.url).pathname;




export let CHAPEL:any=["chapel-of-contemplation-ruins"];
export let CONFRONTATION:any=["corbitt-house-ground","basement-rites","corbitt-confrontation"];
export let FLOOR:any="chapel-floor-collapse";

export let LUCK_FAILS_JUMP_FAILS:any=1;

export let SAN_FAILS:any=1;

export let LATIN_SEED:any=0;

export async function* table(tmp_path:any){
let clients:any,client:any;
clients=[];
async function open_at(seed:any,path:any,pregen:any="thomas-hayes"){
let client:any,index:any,scene:any;
client=(new RpcClient(pyDivide(tmp_path,`s${seed}-${(await pyInvoke(pyLen,[clients],{}))}`),({"env":({["COC_KERNEL_SEED"]:(await pyInvoke(pyStr,[seed],{}))}),"content":CONTENT_DIR})));
(await pyMethod(clients,"append",[client],{}));
(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:pregen,["play_language"]:"en"})],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t0-c1","text":"The opening."}));
(await pyMethod(client,"table",["player_input"],{"text":"I set out."}));
for([index,scene] of pyIterable((await pyInvoke(pyEnumerate,[path],{})))){
if(pyBool(index)){(await pyMethod(client,"table",["narrate"],{"call_id":`t${index}-c2`,"text":"On we go."}));
(await pyMethod(client,"table",["player_input"],{"text":`I go to ${scene}.`}));}
(await pyMethod(client,"table",["apply"],{"call_id":`t${pyAdd(index,1)}-c1`,"effects":[({["kind"]:"move",["to"]:scene})]}));
}
return [client,(await pyInvoke(pyLen,[path],{}))];
}
Object.defineProperty(open_at,"__pySignature",{value:[{"name":"seed","rest":false,"varargs":false},{"name":"path","rest":false,"varargs":false},{"name":"pregen","rest":false,"varargs":false}]});
yield open_at;
for(client of pyIterable(clients)){
(await pyMethod(client,"close",[],{}));
}
}
Object.defineProperty(table,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
export async function resolve(client:any,call_id:any,action:any={}){
let body:any;
body=({["intent"]:"move",["goal"]:"keep their footing",["method"]:"careful steps",...action});
return (await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:call_id,["action"]:body})],{}));
}
Object.defineProperty(resolve,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"action","rest":true,"varargs":false}]});
export async function apply(client:any,call_id:any,effects:any){
return (await pyMethod(client,"call",["table.apply",({["campaign"]:CAMPAIGN,["call_id"]:call_id,["effects"]:(await pyInvoke(pyList,[effects],{}))})],{}));
}
Object.defineProperty(apply,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"effects","rest":false,"varargs":true}]});
export async function ok(response:any){
assert.ok(pyBool(pyAt(response,"ok")),pyStr((await pyMethod(response,"get",["error"],{}))));
return pyAt(response,"result");
}
Object.defineProperty(ok,"__pySignature",{value:[{"name":"response","rest":false,"varargs":false}]});
export async function refusal(response:any){
assert.ok(pyBool(!pyBool(pyAt(response,"ok"))),pyStr((await pyMethod(response,"get",["result"],{}))));
return [pyAt(pyAt(response,"error"),"code"),(await pyMethod(pyAt(pyAt(response,"error"),"details"),"get",["reason"],{}))];
}
Object.defineProperty(refusal,"__pySignature",{value:[{"name":"response","rest":false,"varargs":false}]});
export async function receipts(client:any){
return pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turn.json")],{})),"receipts");
}
Object.defineProperty(receipts,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function sheet(client:any,pregen:any="thomas-hayes"){
return (await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"party"),`${pregen}.json`)],{}));
}
Object.defineProperty(sheet,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"pregen","rest":false,"varargs":false}]});

export let CHAPEL_MECH:any=("hazard (Keeper triggers): [0] Luck difficulty unstated, on failure step 1, on fumble step 1; "+"[1] Jump difficulty unstated, on failure damage 1D6, on fumble damage 1D6, push allowed");
export async function test_the_chapel_row_carries_its_mech_line(table:any){
let client:any,turn:any,look:any,row:any,capsule:any,compact:any;
const __unpack3455=(await pyInvoke(table,[0,CHAPEL],{}));client=__unpack3455[0];turn=__unpack3455[1];
look=(await pyMethod(client,"table",["look"],{"focus":"scene"}));
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(look,"where"),"rules"))){if(pyBool(pyEqual(pyAt(r,"name"),"The chapel's weakened floor"))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(row,"mech"),CHAPEL_MECH)),"tests/kernel/test_haunting_shapes.py:82 assert row[\"mech\"] == CHAPEL_MECH");
(await pyMethod(client,"table",["narrate"],{"call_id":`t${turn}-c2`,"text":"The ruins."}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"I look around the ruins."})),"capsule");
compact=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(capsule,"where"),"rules"))){if(pyBool(pyEqual(pyAt(r,"name"),"The chapel's weakened floor"))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(compact,"mech"),pySlice(CHAPEL_MECH,undefined,160));return pyBool(__left)?(pyAt(compact,"mech_truncated")===true):__left})())),"tests/kernel/test_haunting_shapes.py:86 assert compact[\"mech\"] == CHAPEL_MECH[:160] and compact[\"mech_truncated\"] is True");
}
Object.defineProperty(test_the_chapel_row_carries_its_mech_line,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_chapel_row_carries_its_mech_line"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_chapel_row_carries_its_mech_line(await acquireFixture(t,()=>table(temporary)));});
export async function test_the_chapel_hazard_binds_luck_then_jump_to_the_books_1d6(table:any){
let client:any,turn:any,hp:any,luck:any,jump:any,rows:any,conflict:any,landed:any,by_id:any,minted:any,dice:any;
const __unpack4093=(await pyInvoke(table,[LUCK_FAILS_JUMP_FAILS,CHAPEL],{}));client=__unpack4093[0];turn=__unpack4093[1];
hp=pyAt((await pyInvoke(sheet,[client],{})),"current_hp");
luck=(await pyInvoke(ok,[(await pyInvoke(resolve,[client,`t${turn}-c2`],{"rule":FLOOR}))],{}));
assert.ok(pyBool(pyEqual(pyAt(luck,"decision"),"push-luck:luck-roll")),"tests/kernel/test_haunting_shapes.py:93 assert luck[\"decision\"] == \"push-luck:luck-roll\"");
assert.ok(pyBool(pyEqual(pyAt(luck,"stated"),({["rule"]:FLOOR,["step"]:0,["level"]:"failure",["effects"]:[],["next_step"]:1}))),"tests/kernel/test_haunting_shapes.py:94 assert luck[\"stated\"] == {\"rule\": FLOOR, \"step\": 0, \"level\": \"failure\", \"effects\": [], \"next_step\": 1}");
jump=(await pyInvoke(ok,[(await pyInvoke(resolve,[client,`t${turn}-c3`],{"rule":FLOOR,"step":1}))],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(jump,"decision"),"core-check:ordinary-check");return pyBool(__left)?pyEqual(pyAt(pyAt(jump,"outcome"),"skill"),"Jump"):__left})())),"tests/kernel/test_haunting_shapes.py:96 assert jump[\"decision\"] == \"core-check:ordinary-check\" and jump[\"outcome\"][\"skill\"] == \"Jump\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(jump,"stated"),"step"),1);return pyBool(__left)?pyEqual(pyAt(pyAt(jump,"stated"),"level"),"failure"):__left})())),"tests/kernel/test_haunting_shapes.py:97 assert jump[\"stated\"][\"step\"] == 1 and jump[\"stated\"][\"level\"] == \"failure\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(jump,"stated"),"effects"),[({["kind"]:"damage",["dice"]:"1D6"})])),"tests/kernel/test_haunting_shapes.py:98 assert jump[\"stated\"][\"effects\"] == [{\"kind\": \"damage\", \"dice\": \"1D6\"}]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(jump,"stated"),"push"),({["allowed"]:true,["book"]:"A failed pushed Jump loses or breaks a personal possession."}))),"tests/kernel/test_haunting_shapes.py:99 assert jump[\"stated\"][\"push\"] == {\"allowed\": True, \"book\": \"A failed pushed Jump loses or breaks a personal possession.\"}");
rows=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(receipts,[client],{})))){if(pyBool((await pyMethod(r,"get",["basis"],{})))){__rows.push(r);}}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push(pyAt(r,"kind"));}return __rows;})()),["roll","roll"])),"tests/kernel/test_haunting_shapes.py:102 assert [r[\"kind\"] for r in rows] == [\"roll\", \"roll\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push(pyAt(r,"basis"));}return __rows;})()),[({["rule"]:FLOOR,["step"]:0,["level"]:"failure"}),({["rule"]:FLOOR,["step"]:1,["level"]:"failure"})])),"tests/kernel/test_haunting_shapes.py:103 assert [r[\"basis\"] for r in rows] == [{\"rule\": FLOOR, \"step\": 0, \"level\": \"failure\"}, {\"rule\": FLOOR, \"step\": 1, \"level\": \"failure\"}]");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(sheet,[client],{})),"current_hp"),hp)),"tests/kernel/test_haunting_shapes.py:104 assert sheet(client)[\"current_hp\"] == hp");
conflict=(await pyInvoke(apply,[client,`t${turn}-c4`,({["kind"]:"damage",["stated"]:FLOOR,["dice"]:"2D6"})],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[conflict],{})),["invalid_params","stated_conflict"])),"tests/kernel/test_haunting_shapes.py:107 assert refusal(conflict) == (\"invalid_params\", \"stated_conflict\")");
landed=(await pyInvoke(ok,[(await pyInvoke(apply,[client,`t${turn}-c5`,({["kind"]:"damage",["stated"]:FLOOR,["why"]:"the floor gives way"})],{}))],{}));
by_id=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(receipts,[client],{})))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
minted=(await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(pyAt(landed,"receipts"))){__rows.push(pyAt(by_id,receipt));}return __rows;})());
dice=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(minted)){if(pyBool(pyEqual(pyAt(r,"kind"),"roll"))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(dice,"expression"),"1D6");return pyBool(__left)?(await (async()=>{const __term0=1;const __term1=pyAt(dice,"total");const __term2=6;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()):__left})())),"tests/kernel/test_haunting_shapes.py:112 assert dice[\"expression\"] == \"1D6\" and 1 <= dice[\"total\"] <= 6");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(minted)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(r,"basis"),"stated");return pyBool(__left)?pyEqual(pyAt(r,"stated"),FLOOR):__left})()));}return __rows;})())))),"tests/kernel/test_haunting_shapes.py:113 assert all(r[\"basis\"] == \"stated\" and r[\"stated\"] == FLOOR for r in minted)");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(sheet,[client],{})),"current_hp"),pySubtract(hp,pyAt(dice,"total")))),"tests/kernel/test_haunting_shapes.py:114 assert sheet(client)[\"current_hp\"] == hp - dice[\"total\"]");
}
Object.defineProperty(test_the_chapel_hazard_binds_luck_then_jump_to_the_books_1d6,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_chapel_hazard_binds_luck_then_jump_to_the_books_1d6"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_chapel_hazard_binds_luck_then_jump_to_the_books_1d6(await acquireFixture(t,()=>table(temporary)));});

export async function test_sanity_check_on_corbitt_rolls_the_typed_1_1d8(table:any){
let client:any,turn:any,result:any,outcome:any,rolled:any;
const __unpack6154=(await pyInvoke(table,[SAN_FAILS,CONFRONTATION],{}));client=__unpack6154[0];turn=__unpack6154[1];
result=(await pyInvoke(ok,[(await pyInvoke(resolve,[client,`t${turn}-c2`],{"intent":"investigate","goal":"the corpse moves","method":"looks at it","decision":"sanity:check","target":"Walter Corbitt","involuntary":"flee"}))],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"sanity:check")),"tests/kernel/test_haunting_shapes.py:124 assert result[\"decision\"] == \"sanity:check\"");
outcome=pyAt(result,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(outcome,"passed")===false);return pyBool(__left)?(await (async()=>{const __term0=1;const __term1=pyAt(outcome,"san_loss");const __term2=8;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()):__left})())),"tests/kernel/test_haunting_shapes.py:127 assert outcome[\"passed\"] is False and 1 <= outcome[\"san_loss\"] <= 8");
rolled=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(receipts,[client],{})))){if(pyBool(pyEqual(pyAt(r,"id"),`roll:san-loss-t${turn}-c2`))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(rolled,"expression"),"1D8");return pyBool(__left)?pyEqual(pyAt(rolled,"total"),pyAt(outcome,"san_loss")):__left})())),"tests/kernel/test_haunting_shapes.py:129 assert rolled[\"expression\"] == \"1D8\" and rolled[\"total\"] == outcome[\"san_loss\"]");
}
Object.defineProperty(test_sanity_check_on_corbitt_rolls_the_typed_1_1d8,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sanity_check_on_corbitt_rolls_the_typed_1_1d8"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sanity_check_on_corbitt_rolls_the_typed_1_1d8(await acquireFixture(t,()=>table(temporary)));});

export async function end_session(client:any,call_id:any,extra:any={}){
return (await pyInvoke(resolve,[client,call_id],{"intent":"montage","goal":"Corbitt crumbles to dust.","method":"","decision":"development:end-session",...extra}));
}
Object.defineProperty(end_session,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function test_end_session_without_an_expression_takes_the_books_1d6(table:any){
let client:any,turn:any,result:any,rolled:any,san:any;
const __unpack7260=(await pyInvoke(table,[0,CONFRONTATION],{}));client=__unpack7260[0];turn=__unpack7260[1];
result=(await pyInvoke(ok,[(await pyInvoke(end_session,[client,`t${turn}-c2`],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"stated"),({["rule"]:"victory-rewards",["scenario_san_reward_expr"]:"1D6"}))),"tests/kernel/test_haunting_shapes.py:143 assert result[\"stated\"] == {\"rule\": \"victory-rewards\", \"scenario_san_reward_expr\": \"1D6\"}");
rolled=pyAt(pyAt(result,"outcome"),"scenario_san_reward_roll");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(rolled,"expression"),"1D6");return pyBool(__left)?(await (async()=>{const __term0=1;const __term1=pyAt(rolled,"total");const __term2=6;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()):__left})())),"tests/kernel/test_haunting_shapes.py:146 assert rolled[\"expression\"] == \"1D6\" and 1 <= rolled[\"total\"] <= 6");
san=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(receipts,[client],{})))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"delta");return pyBool(__left)?pyEqual(pyAt(r,"resource"),"san"):__left})()))){__rows.push(r);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=san;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(san)){__rows.push(pyEqual(pyAt(r,"basis"),({["rule"]:"victory-rewards"})));}return __rows;})()))):__left})())),"tests/kernel/test_haunting_shapes.py:148 assert san and all(r[\"basis\"] == {\"rule\": \"victory-rewards\"} for r in san)");
}
Object.defineProperty(test_end_session_without_an_expression_takes_the_books_1d6,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_end_session_without_an_expression_takes_the_books_1d6"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_end_session_without_an_expression_takes_the_books_1d6(await acquireFixture(t,()=>table(temporary)));});
export async function test_another_ending_kind_binds_nothing(table:any){
let client:any,turn:any,result:any;
const __unpack7890=(await pyInvoke(table,[0,CONFRONTATION],{}));client=__unpack7890[0];turn=__unpack7890[1];
result=(await pyInvoke(ok,[(await pyInvoke(end_session,[client,`t${turn}-c2`],{"ending":"retreat"}))],{}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(result,"stated");return pyBool(__left)?(pyAt(pyAt(result,"outcome"),"scenario_san_reward_roll")===null):__left})())),"tests/kernel/test_haunting_shapes.py:154 assert \"stated\" not in result and result[\"outcome\"][\"scenario_san_reward_roll\"] is None");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(receipts,[client],{})))){__rows.push((await pyMethod(r,"get",["basis"],{})));}return __rows;})()))))),"tests/kernel/test_haunting_shapes.py:155 assert not any(r.get(\"basis\") for r in receipts(client))");
}
Object.defineProperty(test_another_ending_kind_binds_nothing,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_another_ending_kind_binds_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_another_ending_kind_binds_nothing(await acquireFixture(t,()=>table(temporary)));});

export async function test_the_liber_ivonis_read_check_binds_the_cards_latin(table:any){
let client:any,turn:any,read:any;
const __unpack8345=(await pyInvoke(table,[LATIN_SEED,CHAPEL],{"pregen":"eleanor-reed"}));client=__unpack8345[0];turn=__unpack8345[1];
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(sheet,[client,"eleanor-reed"],{})),"skills"),"Language (Latin)"),40)),"tests/kernel/test_haunting_shapes.py:163 assert sheet(client, \"eleanor-reed\")[\"skills\"][\"Language (Latin)\"] == 40");
read=(await pyInvoke(ok,[(await pyInvoke(resolve,[client,`t${turn}-c2`],{"rule":"liber-ivonis","intent":"investigate","goal":"read the tome","method":"careful reading"}))],{}));
assert.ok(pyBool(pyEqual(pyAt(read,"decision"),"core-check:ordinary-check")),"tests/kernel/test_haunting_shapes.py:165 assert read[\"decision\"] == \"core-check:ordinary-check\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(read,"outcome"),"skill"),"Language (Latin)");return pyBool(__left)?pyEqual(pyAt(pyAt(read,"outcome"),"target"),40):__left})())),"tests/kernel/test_haunting_shapes.py:168 assert read[\"outcome\"][\"skill\"] == \"Language (Latin)\" and read[\"outcome\"][\"target\"] == 40");
assert.ok(pyBool(pyEqual(pyAt(pyAt(read,"stated"),"rule"),"liber-ivonis")),"tests/kernel/test_haunting_shapes.py:169 assert read[\"stated\"][\"rule\"] == \"liber-ivonis\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(receipts,[client],{})))){if(pyBool((await pyMethod(r,"get",["basis"],{})))){__rows.push(r);}}return __rows;})()))),"basis"),"rule"),"liber-ivonis")),"tests/kernel/test_haunting_shapes.py:170 assert next(r for r in receipts(client) if r.get(\"basis\"))[\"basis\"][\"rule\"] == \"liber-ivonis\"");
}
Object.defineProperty(test_the_liber_ivonis_read_check_binds_the_cards_latin,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_liber_ivonis_read_check_binds_the_cards_latin"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_liber_ivonis_read_check_binds_the_cards_latin(await acquireFixture(t,()=>table(temporary)));});
export async function test_a_nested_member_reaches_the_card_only_through_a_group_key(table:any){
let client:any,turn:any,both:any,lore:any;
const __unpack9186=(await pyInvoke(table,[LATIN_SEED,CHAPEL],{"pregen":"eleanor-reed"}));client=__unpack9186[0];turn=__unpack9186[1];
both=(await (async()=>{const __rows:any[]=[];for(const [n,skill] of pyIterable([[2,"Language (Other: Latin)"],[3,"Language (Other) (Latin)"]])){__rows.push((await pyInvoke(ok,[(await pyInvoke(resolve,[client,`t${turn}-c${n}`],{"intent":"investigate","goal":"read the tome","method":"careful reading","skill":skill}))],{})));}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(both)){__rows.push(pyAt(pyAt(r,"outcome"),"skill"));}return __rows;})()),["Language (Latin)","Language (Latin)"])),"tests/kernel/test_haunting_shapes.py:177 assert [r[\"outcome\"][\"skill\"] for r in both] == [\"Language (Latin)\", \"Language (Latin)\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(both)){__rows.push(pyAt(pyAt(r,"outcome"),"target"));}return __rows;})()),[40,40])),"tests/kernel/test_haunting_shapes.py:178 assert [r[\"outcome\"][\"target\"] for r in both] == [40, 40]");
lore=(await pyInvoke(resolve,[client,`t${turn}-c4`],{"intent":"investigate","goal":"read the tome","method":"careful reading","skill":"Lore (Other: Latin)"}));
assert.ok(pyBool((await (async()=>{const __left=!pyBool(pyAt(lore,"ok"));return pyBool(__left)?pyEqual(pyAt(pyAt(lore,"error"),"code"),"needs"):__left;})())),"tests/kernel/test_haunting_shapes.py:181 assert not lore[\"ok\"] and lore[\"error\"][\"code\"] == \"needs\"");
}
Object.defineProperty(test_a_nested_member_reaches_the_card_only_through_a_group_key,"__pySignature",{value:[{"name":"table","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_nested_member_reaches_the_card_only_through_a_group_key"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_nested_member_reaches_the_card_only_through_a_group_key(await acquireFixture(t,()=>table(temporary)));});
