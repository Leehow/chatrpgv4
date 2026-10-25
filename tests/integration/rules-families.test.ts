// Migrated from tests/kernel/test_rules_families.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,narrate,open_turn,read_json,read_jsonl,written,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";



export let CONFRONTATION_PATH:any=["corbitt-house-ground","basement-rites","corbitt-confrontation"];
export async function resolve(client:any,call_id:any,action:any={}){
return (await pyMethod(client,"table",["resolve"],{"call_id":call_id,"action":action}));
}
export async function resolve_err(client:any,call_id:any,action:any={}){
return (await pyMethod(client,"table_err",["resolve"],{"call_id":call_id,"action":action}));
}
export async function seed_wound(workspace:any,hp:any,conditions:any=[],minutes_ago:any=0){
let directory:any,sheet_path:any,sheet:any,clock:any,healing:any;

directory=(await campaign_dir(workspace));
sheet_path=pyDivide(pyDivide(directory,"party"),"thomas-hayes.json");
sheet=(await read_json(sheet_path));
sheet["current_hp"]=hp;
(await pyMethod(sheet_path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
clock=pyAt(pyAt((await read_json(pyDivide(directory,"world.json"))),"clock"),"minutes");
healing=pyDivide(pyDivide(directory,"save"),"healing-state");
(await pyMethod(healing,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod((pyDivide(healing,"thomas-hayes.json")),"write_text",[(await pyMethod(json,"dumps",[({["investigator_id"]:"thomas-hayes",["current_hp"]:hp,["conditions"]:(await pyList(conditions)),["wound_ledger"]:[({["wound_id"]:"wound-seeded",["source_damage_roll_id"]:null,["occurred_elapsed_minutes"]:(await pyMax(0,pySubtract(clock,minutes_ago))),["status"]:"active"})]})],{}))],{"encoding":"utf-8"}));
}
export async function events_after(workspace:any,count:any){
return (await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pySlice((await read_jsonl(pyDivide((await campaign_dir(workspace)),"events.jsonl"))),count,undefined))){__rows.push(pyAt(e,"type"));}return __rows;})());
}
export async function event_count(workspace:any){
return (await pyLen((await read_jsonl(pyDivide((await campaign_dir(workspace)),"events.jsonl")))));
}
export async function first_failure(client:any,prefix:any,action:any={}){
let n:any,call_id:any,result:any;

for(n of pyIterable((await pyRange(1,25)))){
call_id=`${prefix}${n}`;
result=(await resolve(client,call_id,({...action})));
if(pyBool((await (async()=>{const __left=!pyBool(pyAt(pyAt(result,"outcome"),"passed"));return pyBool(__left)?!pyEqual(pyAt(pyAt(result,"outcome"),"level"),"fumble"):__left;})()))){return [call_id,result];}
}
throw new Error("raise AssertionError(\"no ordinary failure in 24 seeded rolls\")");
}
export async function first_success(client:any,prefix:any,action:any={}){
let n:any,call_id:any,result:any;
for(n of pyIterable((await pyRange(1,25)))){
call_id=`${prefix}${n}`;
result=(await resolve(client,call_id,({...action})));
if(pyBool(pyAt(pyAt(result,"outcome"),"passed"))){return [call_id,result];}
}
throw new Error("raise AssertionError(\"no success in 24 seeded rolls\")");
}
export async function walk_to_confrontation(client:any,start:any=1){
let i:any,scene:any;
for([i,scene] of pyIterable((await pyEnumerate(CONFRONTATION_PATH,({"start":start}))))){
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${i}`,"effects":[({["kind"]:"move",["to"]:scene,["travel_minutes"]:0})]}));
}
return pyAdd(start,(await pyLen(CONFRONTATION_PATH)));
}

export async function test_opposed_check_rolls_both_parties(seeded_kernel:any,tmp_path:any){
let n:any,result:any,outcome:any,receipts:any,npc_roll:any,rolls:any,other:any,m:any,again:any;
(await open_turn(seeded_kernel,"我和科比特掰手腕。"));
n=(await walk_to_confrontation(seeded_kernel));
result=(await resolve(seeded_kernel,`t1-c${n}`,({"intent":"investigate","goal":"把他压制住","method":"用力量硬顶","target":"Walter Corbitt","decision":"core-check:opposed-check"})));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"core-check:opposed-check")),"tests/kernel/test_rules_families.py:78 assert result[\"decision\"] == \"core-check:opposed-check\"");
outcome=pyAt(result,"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"opposed");return pyBool(__left)?pyEqual(pyAt(outcome,"skill"),"STR"):__left;})())),"tests/kernel/test_rules_families.py:80 assert outcome[\"kind\"] == \"opposed\" and outcome[\"skill\"] == \"STR\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(outcome,"investigator"),"target"),60);return pyBool(__left)?pyEqual(pyAt(pyAt(outcome,"opponent"),"target"),90):__left;})())),"tests/kernel/test_rules_families.py:81 assert outcome[\"investigator\"][\"target\"] == 60 and outcome[\"opponent\"][\"target\"] == 90");
assert.ok(pyBool(pyEqual(pyAt(outcome,"opponent_id"),"walter-corbitt")),"tests/kernel/test_rules_families.py:82 assert outcome[\"opponent_id\"] == \"walter-corbitt\"");
assert.ok(pyBool(pyContains(["investigator","opponent","none"],pyAt(outcome,"winner"))),"tests/kernel/test_rules_families.py:83 assert outcome[\"winner\"] in (\"investigator\", \"opponent\", \"none\")");
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),[`roll:str-t1-c${n}`,`roll:str-walter-corbitt-t1-c${n}`])),"tests/kernel/test_rules_families.py:84 assert result[\"receipts\"] == [f\"roll:str-t1-c{n}\", f\"roll:str-walter-corbitt-t1-c{n}\"]");
receipts=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"kind"),"roll"))){__rows.push([pyAt(r,"id"),r]);}}return __rows;})()));
npc_roll=pyAt(receipts,`roll:str-walter-corbitt-t1-c${n}`);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(npc_roll,"actor"),"walter-corbitt");return pyBool(__left)?pyEqual(pyAt(npc_roll,"visibility"),"public"):__left;})())),"tests/kernel/test_rules_families.py:87 assert npc_roll[\"actor\"] == \"walter-corbitt\" and npc_roll[\"visibility\"] == \"public\"");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(npc_roll,"actor_is_investigator")===false);return pyBool(__left)?pyEqual(pyAt(npc_roll,"actor_label"),"Walter Corbitt"):__left;})())),"tests/kernel/test_rules_families.py:88 assert npc_roll[\"actor_is_investigator\"] is False and npc_roll[\"actor_label\"] == \"Walter Corbitt\"");
assert.ok(pyBool(pyEqual(pyAt(result,"continuations"),[])),"tests/kernel/test_rules_families.py:89 assert result[\"continuations\"] == []");
rolls=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt((await narrate(seeded_kernel,`t1-c${pyAdd(n,1)}`,"他的手像石头。")),"mechanics"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(m,"kind"),"roll");return pyBool(__left)?pyContains(pyAt(result,"receipts"),pyAt(m,"receipt")):__left;})()))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(rolls)),2)),"tests/kernel/test_rules_families.py:93 assert len(rolls) == 2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rolls,0),"skill"),"STR");return pyBool(__left)?pyEqual(pyAt(pyAt(rolls,0),"actor"),"thomas-hayes"):__left;})())),"tests/kernel/test_rules_families.py:95 assert rolls[0][\"skill\"] == \"STR\" and rolls[0][\"actor\"] == \"thomas-hayes\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rolls,0),"actor_label"),"托马斯·海斯")),"tests/kernel/test_rules_families.py:96 assert rolls[0][\"actor_label\"] == \"托马斯·海斯\"");
assert.ok(pyBool((pyAt(pyAt(rolls,0),"actor_is_investigator")===true)),"tests/kernel/test_rules_families.py:97 assert rolls[0][\"actor_is_investigator\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rolls,1),"skill"),"STR");return pyBool(__left)?(pyAt(pyAt(rolls,1),"actor_is_investigator")===false):__left;})())),"tests/kernel/test_rules_families.py:98 assert rolls[1][\"skill\"] == \"STR\" and rolls[1][\"actor_is_investigator\"] is False");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(rolls,1),"actor");return pyBool(__left)?!pyContains(pyAt(rolls,1),"actor_label"):__left;})())),"tests/kernel/test_rules_families.py:99 assert \"actor\" not in rolls[1] and \"actor_label\" not in rolls[1]");
other=(new RpcClient(pyDivide(tmp_path,"ws-2"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await open_turn(other,"我和科比特掰手腕。"));
m=(await walk_to_confrontation(other));
again=(await resolve(other,`t1-c${m}`,({"intent":"investigate","goal":"把他压制住","method":"用力量硬顶","target":"Walter Corbitt","decision":"core-check:opposed-check"})));
assert.ok(pyBool(pyEqual([pyAt(pyAt(pyAt(again,"outcome"),"investigator"),"roll"),pyAt(pyAt(pyAt(again,"outcome"),"opponent"),"roll")],[pyAt(pyAt(outcome,"investigator"),"roll"),pyAt(pyAt(outcome,"opponent"),"roll")])),"tests/kernel/test_rules_families.py:108 assert (again[\"outcome\"][\"investigator\"][\"roll\"], again[\"outcome\"][\"opponent\"][\"roll\"]) == (\n            outcome[\"investigator\"][\"roll\"], outcome[\"opponent\"][\"roll\"])");}finally{(await pyMethod(other,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_opposed_check_rolls_both_parties"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_opposed_check_rolls_both_parties(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}),temporary);});
export async function test_opposed_check_needs_an_authored_opponent_value(kernel:any){
let error:any;
(await open_turn(kernel));
error=(await resolve_err(kernel,"t1-c1",({"intent":"investigate","goal":"x","method":"用侦查","target":"Steven Knott","decision":"core-check:opposed-check"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"skill"):__left;})())),"tests/kernel/test_rules_families.py:118 assert error[\"code\"] == \"needs\" and error[\"details\"][\"needs\"][\"field\"] == \"skill\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_opposed_check_needs_an_authored_opponent_value"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_opposed_check_needs_an_authored_opponent_value(await kernel(t,{}));});
export async function test_combined_check_one_roll_many_targets(seeded_kernel:any){
let result:any,outcome:any,offered:any,error:any;
(await open_turn(seeded_kernel));
result=(await resolve(seeded_kernel,"t1-c1",({"intent":"investigate","goal":"找出暗门","method":"同时看和听","decision":"core-check:combined-check","skills":["Spot Hidden","Listen"],"mode":"any"})));
outcome=pyAt(result,"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"combined");return pyBool(__left)?pyEqual(pyAt(outcome,"mode"),"any"):__left;})())),"tests/kernel/test_rules_families.py:126 assert outcome[\"kind\"] == \"combined\" and outcome[\"mode\"] == \"any\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(pyAt(outcome,"targets"))){__rows.push(pyAt(t,"label"));}return __rows;})()),["Spot Hidden","Listen"])),"tests/kernel/test_rules_families.py:127 assert [t[\"label\"] for t in outcome[\"targets\"]] == [\"Spot Hidden\", \"Listen\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(pyAt(outcome,"targets"))){__rows.push(pyAt(t,"value"));}return __rows;})()),[55,45])),"tests/kernel/test_rules_families.py:128 assert [t[\"value\"] for t in outcome[\"targets\"]] == [55, 45]");
assert.ok(pyBool(pyEqual(pyAt(outcome,"passed"),(await pyAny((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(pyAt(outcome,"targets"))){__rows.push(pyAt(t,"success"));}return __rows;})()))))),"tests/kernel/test_rules_families.py:129 assert outcome[\"passed\"] == any(t[\"success\"] for t in outcome[\"targets\"])");
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),["roll:spot-hidden-listen-t1-c1"])),"tests/kernel/test_rules_families.py:130 assert result[\"receipts\"] == [\"roll:spot-hidden-listen-t1-c1\"]");
offered=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(result,"continuations"))){if(pyBool((await pyMethod(pyAt(c,"decision"),"startswith",["push-luck:"],{})))){__rows.push(pyAt(c,"decision"));}}return __rows;})());
if(pyBool(pyContains(["critical","fumble"],pyAt(outcome,"level")))){assert.ok(pyBool(pyEqual(offered,[])),"tests/kernel/test_rules_families.py:137 assert offered == []");}else if(pyBool(pyAt(outcome,"passed"))){assert.ok(pyBool(pyEqual(offered,["push-luck:luck-spend"])),"tests/kernel/test_rules_families.py:139 assert offered == [\"push-luck:luck-spend\"]");}else{assert.ok(pyBool(pyEqual(offered,["push-luck:pushed-roll","push-luck:luck-spend"])),"tests/kernel/test_rules_families.py:141 assert offered == [\"push-luck:pushed-roll\", \"push-luck:luck-spend\"]");}
error=(await resolve_err(seeded_kernel,"t1-c2",({"intent":"investigate","goal":"x","method":"y","decision":"core-check:combined-check","skills":["Spot Hidden"]})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"skills"):__left;})())),"tests/kernel/test_rules_families.py:144 assert error[\"code\"] == \"needs\" and error[\"details\"][\"needs\"][\"field\"] == \"skills\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_combined_check_one_roll_many_targets"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_combined_check_one_roll_many_targets(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_investigate_on_npc_needs_choice_then_decision_picks(kernel:any){
let error:any,names:any,picked:any,outcome:any,receipt:any,realized:any,result:any,rolls:any,plain:any;
(await open_turn(kernel));
error=(await resolve_err(kernel,"t1-c1",({"intent":"investigate","goal":"看他是不是在隐瞒什么","method":"盯着他的表情","target":"Steven Knott"})));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs_choice")),"tests/kernel/test_rules_families.py:153 assert error[\"code\"] == \"needs_choice\"");
names=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(error,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})());
assert.ok(pyBool(pyEqual(names,["core-check:ordinary-check","psychology:observe-concealed"])),"tests/kernel/test_rules_families.py:155 assert names == [\"core-check:ordinary-check\", \"psychology:observe-concealed\"]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(error,"details"),"candidates"))){__rows.push(pyAt(c,"when"));}return __rows;})())))),"tests/kernel/test_rules_families.py:156 assert all(c[\"when\"] for c in error[\"details\"][\"candidates\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_rules_families.py:157 assert kernel.table(\"status\")[\"receipts\"] == []");
picked=(await resolve(kernel,"t1-c1",({"intent":"investigate","goal":"看他是不是在隐瞒什么","method":"盯着他的表情","target":"Steven Knott","decision":"psychology:observe-concealed"})));
assert.ok(pyBool(pyEqual(pyAt(picked,"decision"),"psychology:observe-concealed")),"tests/kernel/test_rules_families.py:161 assert picked[\"decision\"] == \"psychology:observe-concealed\"");
outcome=pyAt(picked,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"psychology");return pyBool(__left)?pyEqual(pyAt(outcome,"status"),"observed"):__left;})());return pyBool(__left)?(pyAt(outcome,"concealed")===true):__left;})())),"tests/kernel/test_rules_families.py:163 assert outcome[\"kind\"] == \"psychology\" and outcome[\"status\"] == \"observed\" and outcome[\"concealed\"] is True");
assert.ok(pyBool(pyContains(["deep_conflict","motive_link","immediate_intent","uncertain"],pyAt(outcome,"inference_depth"))),"tests/kernel/test_rules_families.py:164 assert outcome[\"inference_depth\"] in (\"deep_conflict\", \"motive_link\", \"immediate_intent\", \"uncertain\")");
assert.ok(pyBool(pyEqual(pyAt(outcome,"npc"),"steven-knott")),"tests/kernel/test_rules_families.py:165 assert outcome[\"npc\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(picked,"continuations"))){__rows.push(pyAt(c,"decision"));}return __rows;})()),["psychology:realize-player-safe"])),"tests/kernel/test_rules_families.py:166 assert [c[\"decision\"] for c in picked[\"continuations\"]] == [\"psychology:realize-player-safe\"]");
receipt=pyAt(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"id"),"roll:psychology-t1-c1");return pyBool(__left)?pyEqual(pyAt(receipt,"visibility"),"concealed"):__left;})())),"tests/kernel/test_rules_families.py:172 assert receipt[\"id\"] == \"roll:psychology-t1-c1\" and receipt[\"visibility\"] == \"concealed\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(picked,"outcome"),"roll_visibility"),"concealed")),"tests/kernel/test_rules_families.py:173 assert picked[\"outcome\"][\"roll_visibility\"] == \"concealed\"");
realized=(await resolve(kernel,"t1-c2",({"intent":"investigate","goal":"x","method":"他避开你的视线，手指敲着桌面","target":"Steven Knott","decision":"psychology:realize-player-safe"})));
assert.ok(pyBool(pyEqual(pyAt(realized,"outcome"),({["kind"]:"psychology",["status"]:"realized",["npc"]:"steven-knott",["insight_id"]:pyAt(outcome,"insight_id"),["external_behavior"]:"他避开你的视线，手指敲着桌面"}))),"tests/kernel/test_rules_families.py:177 assert realized[\"outcome\"] == {\"kind\": \"psychology\", \"status\": \"realized\", \"npc\": \"steven-knott\",\n                                   \"insight_id\": outcome[\"insight_id\"],\n                                   \"external_behavior\": \"他避开你的视线，手指敲着桌面\"}");
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"他笑了笑。"}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"他笑了笑。")),"tests/kernel/test_rules_families.py:183 assert result[\"rendered_text\"] == \"他笑了笑。\"");
rolls=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(result,"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"roll"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=rolls;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(rolls)){__rows.push(pyEqual(pyAt(m,"visibility"),"concealed"));}return __rows;})()))):__left;})())),"tests/kernel/test_rules_families.py:185 assert rolls and all(m[\"visibility\"] == \"concealed\" for m in rolls)");
(await pyMethod(kernel,"table",["player_input"],{"text":"我再看看。"}));
plain=(await resolve(kernel,"t2-c1",({"intent":"investigate","goal":"看他的桌子","method":"用侦查扫过桌面","target":"Steven Knott"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(plain,"decision"),"core-check:ordinary-check");return pyBool(__left)?pyEqual(pyAt(pyAt(plain,"outcome"),"skill"),"Spot Hidden"):__left;})())),"tests/kernel/test_rules_families.py:190 assert plain[\"decision\"] == \"core-check:ordinary-check\" and plain[\"outcome\"][\"skill\"] == \"Spot Hidden\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_investigate_on_npc_needs_choice_then_decision_picks"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_investigate_on_npc_needs_choice_then_decision_picks(await kernel(t,{}));});
export async function test_unknown_decision_and_absent_target(kernel:any){
let error:any,absent:any;
(await open_turn(kernel));
// §264.33: an unknown decision is set aside and routes by intent (tests/integration/mod-combat.test.ts); only the absent target refuses here.
absent=(await resolve_err(kernel,"t1-c1",({"intent":"social","goal":"x","method":"用说服","target":"Arty Wilmot"})));
assert.ok(pyBool(pyEqual(pyAt(absent,"code"),"unknown_entity")),"tests/kernel/test_rules_families.py:198 assert absent[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(absent,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})()),["steven-knott"])),"tests/kernel/test_rules_families.py:199 assert [c[\"name\"] for c in absent[\"details\"][\"candidates\"]] == [\"steven-knott\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_decision_and_absent_target"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_decision_and_absent_target(await kernel(t,{}));});

export async function test_social_adjudication_against_arty(seeded_kernel:any){
let unclear:any,result:any,outcome:any,continuations:any,intimidate:any;
(await open_turn(seeded_kernel,"我去报社。"));
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"newspaper-morgue"})]}));
unclear=(await resolve_err(seeded_kernel,"t1-c2",({"intent":"social","goal":"让阿蒂放我们进剪报室","method":"跟他聊聊","target":"Arty Wilmot"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(unclear,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(unclear,"details"),"needs"),"field"),"skill"):__left;})())),"tests/kernel/test_rules_families.py:209 assert unclear[\"code\"] == \"needs\" and unclear[\"details\"][\"needs\"][\"field\"] == \"skill\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(unclear,"details"),"needs"),"options"),["Charm","Fast Talk","Intimidate","Persuade"])),"tests/kernel/test_rules_families.py:210 assert unclear[\"details\"][\"needs\"][\"options\"] == [\"Charm\", \"Fast Talk\", \"Intimidate\", \"Persuade\"]");
result=(await resolve(seeded_kernel,"t1-c2",({"intent":"social","goal":"让阿蒂放我们进剪报室","method":"用说服跟他讲道理","target":"Arty Wilmot","stakes":"他会叫人把我们赶出去"})));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"social:adjudicate-difficulty")),"tests/kernel/test_rules_families.py:214 assert result[\"decision\"] == \"social:adjudicate-difficulty\"");
outcome=pyAt(result,"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"social");return pyBool(__left)?pyEqual(pyAt(outcome,"npc"),"arty-wilmot"):__left;})())),"tests/kernel/test_rules_families.py:216 assert outcome[\"kind\"] == \"social\" and outcome[\"npc\"] == \"arty-wilmot\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"approach"),"persuade");return pyBool(__left)?pyEqual(pyAt(outcome,"approach_skill"),"Persuade"):__left;})())),"tests/kernel/test_rules_families.py:217 assert outcome[\"approach\"] == \"persuade\" and outcome[\"approach_skill\"] == \"Persuade\"");
assert.ok(pyBool(pyEqual(pyAt(outcome,"feasibility"),"roll")),"tests/kernel/test_rules_families.py:218 assert outcome[\"feasibility\"] == \"roll\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"base_difficulty"),"regular");return pyBool(__left)?pyEqual(pyAt(outcome,"final_difficulty"),"regular"):__left;})())),"tests/kernel/test_rules_families.py:220 assert outcome[\"base_difficulty\"] == \"regular\" and outcome[\"final_difficulty\"] == \"regular\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(outcome,"motive"),"evidence_refs"),["npc_agenda:arty-wilmot","npc_secret:arty-wilmot"])),"tests/kernel/test_rules_families.py:221 assert outcome[\"motive\"][\"evidence_refs\"] == [\"npc_agenda:arty-wilmot\", \"npc_secret:arty-wilmot\"]");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"skill"),"Persuade");return pyBool(__left)?pyEqual(pyAt(outcome,"target"),40):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"threshold"),40):__left;})())),"tests/kernel/test_rules_families.py:222 assert outcome[\"skill\"] == \"Persuade\" and outcome[\"target\"] == 40 and outcome[\"threshold\"] == 40");
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),["roll:persuade-t1-c2"])),"tests/kernel/test_rules_families.py:223 assert result[\"receipts\"] == [\"roll:persuade-t1-c2\"]");
assert.ok(pyBool(pyContains(pyAt(result,"rule_refs"),"rule:coc7:social:canonical-motive-evidence-binding")),"tests/kernel/test_rules_families.py:224 assert \"rule:coc7:social:canonical-motive-evidence-binding\" in result[\"rule_refs\"]");
if(pyBool((await (async()=>{const __left=pyAt(outcome,"passed");return pyBool(__left)?__left:pyEqual(pyAt(outcome,"level"),"fumble");})()))){assert.ok(pyBool(pyEqual(pyAt(result,"continuations"),[])),"tests/kernel/test_rules_families.py:226 assert result[\"continuations\"] == []");}else{continuations=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(result,"continuations"))){__rows.push([pyAt(c,"decision"),pyAt(c,"action")]);}return __rows;})()));
assert.ok(pyBool(pyEqual(continuations,({["push-luck:pushed-roll"]:["push"],["push-luck:luck-spend"]:["luck"]}))),"tests/kernel/test_rules_families.py:229 assert continuations == {\"push-luck:pushed-roll\": [\"push\"], \"push-luck:luck-spend\": [\"luck\"]}");}
intimidate=(await resolve(seeded_kernel,"t1-c3",({"intent":"social","goal":"吓唬他","method":"用恐吓","target":"Arty Wilmot","motive":({["direction"]:"oppose",["intensity"]:1})})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(intimidate,"outcome"),"approach"),"intimidate")),"tests/kernel/test_rules_families.py:233 assert intimidate[\"outcome\"][\"approach\"] == \"intimidate\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(intimidate,"outcome"),"final_difficulty"),"hard")),"tests/kernel/test_rules_families.py:234 assert intimidate[\"outcome\"][\"final_difficulty\"] == \"hard\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_social_adjudication_against_arty"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_social_adjudication_against_arty(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_push_executes_against_last_failure_and_refuses_a_second(seeded_kernel:any){
let no_check:any,failed_id:any,failed:any,n:any,pushed:any,outcome:any,receipt:any,again:any,luck:any,rolls:any;
(await open_turn(seeded_kernel,"我爬。"));
no_check=(await resolve_err(seeded_kernel,"t1-c1",({"intent":"investigate","goal":"x","method":"y","stakes":"z","push":true})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(no_check,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(no_check,"details"),"reason"),"no_source"):__left;})())),"tests/kernel/test_rules_families.py:242 assert no_check[\"code\"] == \"turn_state\" and no_check[\"details\"][\"reason\"] == \"no_source\"");
const __unpack13963=(await first_failure(seeded_kernel,"t1-c",({"intent":"investigate","goal":"爬上二楼的窗","method":"用攀爬"})));assert.equal(__unpack13963.length,2,"Original tuple unpacking requires exact arity");failed_id=__unpack13963[0];failed=__unpack13963[1];
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(failed,"continuations"))){__rows.push(pyAt(c,"decision"));}return __rows;})()),["push-luck:pushed-roll","push-luck:luck-spend"])),"tests/kernel/test_rules_families.py:245 assert [c[\"decision\"] for c in failed[\"continuations\"]] == [\"push-luck:pushed-roll\", \"push-luck:luck-spend\"]");
n=(await pyInt(pyAt((await pyMethod(failed_id,"split",["-c"],{})),1)));
pushed=(await resolve(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"爬上二楼的窗","method":"换条排水管","stakes":"排水管断裂，摔下去受伤","push":true})));
assert.ok(pyBool(pyEqual(pyAt(pushed,"decision"),"push-luck:pushed-roll")),"tests/kernel/test_rules_families.py:250 assert pushed[\"decision\"] == \"push-luck:pushed-roll\"");
outcome=pyAt(pushed,"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"push");return pyBool(__left)?(pyAt(outcome,"pushed")===true):__left;})())),"tests/kernel/test_rules_families.py:252 assert outcome[\"kind\"] == \"push\" and outcome[\"pushed\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"skill"),"Climb");return pyBool(__left)?pyEqual(pyAt(outcome,"target"),30):__left;})())),"tests/kernel/test_rules_families.py:253 assert outcome[\"skill\"] == \"Climb\" and outcome[\"target\"] == 30");
assert.ok(pyBool(pyEqual(pyAt(outcome,"source_receipt"),pyAt(failed,"receipt"))),"tests/kernel/test_rules_families.py:254 assert outcome[\"source_receipt\"] == failed[\"receipt\"]");
assert.ok(pyBool(pyEqual(pyAt(outcome,"failure_consequence"),"排水管断裂，摔下去受伤")),"tests/kernel/test_rules_families.py:255 assert outcome[\"failure_consequence\"] == \"排水管断裂，摔下去受伤\"");
assert.ok(pyBool(pyEqual(pyAt(pushed,"continuations"),[])),"tests/kernel/test_rules_families.py:256 assert pushed[\"continuations\"] == []");
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(pushed,"receipt")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(receipt,"pushed")===true);return pyBool(__left)?pyEqual(pyAt(receipt,"source_receipt"),pyAt(failed,"receipt")):__left;})())),"tests/kernel/test_rules_families.py:258 assert receipt[\"pushed\"] is True and receipt[\"source_receipt\"] == failed[\"receipt\"]");
again=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,2)}`,({"intent":"investigate","goal":"再试","method":"再换","stakes":"x","push":true})));
assert.ok(pyBool(pyEqual(pyAt(again,"code"),"turn_state")),"tests/kernel/test_rules_families.py:261 assert again[\"code\"] == \"turn_state\"");
if(pyBool(!pyBool(pyAt(outcome,"passed")))){luck=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,2)}`,({"intent":"investigate","goal":"x","method":"y","luck":5})));
assert.ok(pyBool(pyEqual(pyAt(luck,"code"),"turn_state")),"tests/kernel/test_rules_families.py:265 assert luck[\"code\"] == \"turn_state\"");}
rolls=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt((await narrate(seeded_kernel,`t1-c${pyAdd(n,3)}`,"窗框吱呀作响。")),"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"roll"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rolls,(-1)),"skill"),"Climb");return pyBool(__left)?(pyAt(pyAt(rolls,(-1)),"pushed")===true):__left;})())),"tests/kernel/test_rules_families.py:268 assert rolls[-1][\"skill\"] == \"Climb\" and rolls[-1][\"pushed\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_push_executes_against_last_failure_and_refuses_a_second"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_push_executes_against_last_failure_and_refuses_a_second(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_push_without_a_foreshadowed_consequence_is_legal(seeded_kernel:any){
let failed_id:any,failed:any,n:any,pushed:any,receipt:any,protocol:any;

(await open_turn(seeded_kernel,"我爬。"));
const __unpack15863=(await first_failure(seeded_kernel,"t1-c",({"intent":"investigate","goal":"爬上二楼的窗","method":"用攀爬"})));assert.equal(__unpack15863.length,2,"Original tuple unpacking requires exact arity");failed_id=__unpack15863[0];failed=__unpack15863[1];
n=(await pyInt(pyAt((await pyMethod(failed_id,"split",["-c"],{})),1)));
pushed=(await resolve(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"爬上二楼的窗","method":"换条排水管","push":true})));
assert.ok(pyBool(pyEqual(pyAt(pushed,"decision"),"push-luck:pushed-roll")),"tests/kernel/test_rules_families.py:278 assert pushed[\"decision\"] == \"push-luck:pushed-roll\"");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(pushed,"outcome"),"pushed")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(pushed,"outcome"),"source_receipt"),pyAt(failed,"receipt")):__left;})())),"tests/kernel/test_rules_families.py:279 assert pushed[\"outcome\"][\"pushed\"] is True and pushed[\"outcome\"][\"source_receipt\"] == failed[\"receipt\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pushed,"outcome"),"failure_consequence"),"")),"tests/kernel/test_rules_families.py:280 assert pushed[\"outcome\"][\"failure_consequence\"] == \"\"");
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(pushed,"receipt")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((pyAt(receipt,"pushed")===true)),"tests/kernel/test_rules_families.py:282 assert receipt[\"pushed\"] is True");
protocol=(await (async()=>{const __left=(await pyMethod(((await (async()=>{const __left=(await pyMethod(receipt,"get",["check"],{}));return pyBool(__left)?__left:({});})())),"get",["pushed_roll_protocol"],{}));return pyBool(__left)?__left:({});})());
assert.ok(pyBool(pyEqual((await pyMethod(protocol,"get",["failure_consequence_source"],{})),"keeper_free_rein")),"tests/kernel/test_rules_families.py:284 assert protocol.get(\"failure_consequence_source\") == \"keeper_free_rein\"");
assert.ok(pyBool(((await pyMethod(protocol,"get",["keeper_foreshadowed_failure"],{}))===false)),"tests/kernel/test_rules_families.py:285 assert protocol.get(\"keeper_foreshadowed_failure\") is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_push_without_a_foreshadowed_consequence_is_legal"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_push_without_a_foreshadowed_consequence_is_legal(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_luck_spend_and_insufficient_luck(seeded_kernel:any){
let failed_id:any,failed:any,n:any,too_much:any,spent:any,outcome:any,bought:any,both:any,changes:any,events:any,changed:any;
(await open_turn(seeded_kernel,"我搜。"));
const __unpack16808=(await first_failure(seeded_kernel,"t1-c",({"intent":"investigate","goal":"找到暗格","method":"用侦查","modifiers":({["difficulty"]:"hard"})})));assert.equal(__unpack16808.length,2,"Original tuple unpacking requires exact arity");failed_id=__unpack16808[0];failed=__unpack16808[1];
n=(await pyInt(pyAt((await pyMethod(failed_id,"split",["-c"],{})),1)));
too_much=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"x","method":"y","luck":99})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(too_much,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(too_much,"details"),"reason"),"insufficient_luck"):__left;})())),"tests/kernel/test_rules_families.py:294 assert too_much[\"code\"] == \"invalid_params\" and too_much[\"details\"][\"reason\"] == \"insufficient_luck\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(too_much,"details"),"current_luck"),50)),"tests/kernel/test_rules_families.py:295 assert too_much[\"details\"][\"current_luck\"] == 50");
spent=(await resolve(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"x","method":"y","luck":3})));
assert.ok(pyBool(pyEqual(pyAt(spent,"decision"),"push-luck:luck-spend")),"tests/kernel/test_rules_families.py:298 assert spent[\"decision\"] == \"push-luck:luck-spend\"");
outcome=pyAt(spent,"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"luck");return pyBool(__left)?pyEqual(pyAt(outcome,"points"),3):__left;})())),"tests/kernel/test_rules_families.py:300 assert outcome[\"kind\"] == \"luck\" and outcome[\"points\"] == 3");
assert.ok(pyBool(pyEqual([pyAt(outcome,"luck_before"),pyAt(outcome,"luck_after")],[50,47])),"tests/kernel/test_rules_families.py:301 assert (outcome[\"luck_before\"], outcome[\"luck_after\"]) == (50, 47)");
assert.ok(pyBool(pyEqual(pyAt(outcome,"roll"),pySubtract(pyAt(pyAt(failed,"outcome"),"roll"),3))),"tests/kernel/test_rules_families.py:302 assert outcome[\"roll\"] == failed[\"outcome\"][\"roll\"] - 3");
assert.ok(pyBool(pyEqual(pyAt(outcome,"source_receipt"),pyAt(failed,"receipt"))),"tests/kernel/test_rules_families.py:303 assert outcome[\"source_receipt\"] == failed[\"receipt\"]");
assert.ok(pyBool(pyEqual(pyAt(spent,"effects"),[({["kind"]:"luck",["subject"]:"thomas-hayes",["before"]:50,["after"]:47})])),"tests/kernel/test_rules_families.py:304 assert spent[\"effects\"] == [{\"kind\": \"luck\", \"subject\": \"thomas-hayes\", \"before\": 50, \"after\": 47}]");
assert.ok(pyBool(pyEqual(pyAt(spent,"receipts"),[`delta:luck-t1-c${pyAdd(n,1)}`,`roll:spot-hidden-t1-c${pyAdd(n,1)}`])),"tests/kernel/test_rules_families.py:310 assert spent[\"receipts\"] == [f\"delta:luck-t1-c{n + 1}\", f\"roll:spot-hidden-t1-c{n + 1}\"]");
bought=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await read_json(pyDivide((await campaign_dir(seeded_kernel.workspace)),"turn.json"))),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),`roll:spot-hidden-t1-c${pyAdd(n,1)}`))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(bought,"roll_kind"),"luck_bought");return pyBool(__left)?pyEqual(pyAt(bought,"source_receipt"),pyAt(failed,"receipt")):__left;})())),"tests/kernel/test_rules_families.py:313 assert bought[\"roll_kind\"] == \"luck_bought\" and bought[\"source_receipt\"] == failed[\"receipt\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(bought,"roll"),pyAt(outcome,"roll"));return pyBool(__left)?pyEqual(pyAt(bought,"passed"),pyAt(outcome,"passed")):__left;})())),"tests/kernel/test_rules_families.py:316 assert bought[\"roll\"] == outcome[\"roll\"] and bought[\"passed\"] == outcome[\"passed\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(bought,"level"),pyAt(outcome,"level"));return pyBool(__left)?pyEqual(pyAt(bought,"luck_spent"),3):__left;})())),"tests/kernel/test_rules_families.py:317 assert bought[\"level\"] == outcome[\"level\"] and bought[\"luck_spent\"] == 3");
assert.ok(pyBool(!pyContains(["skill_check","characteristic_check"],pyAt(bought,"roll_kind"))),"tests/kernel/test_rules_families.py:319 assert bought[\"roll_kind\"] not in (\"skill_check\", \"characteristic_check\")");
assert.ok(pyBool(pyContains(pyAt(spent,"rule_refs"),"core.optional.spending_luck")),"tests/kernel/test_rules_families.py:320 assert \"core.optional.spending_luck\" in spent[\"rule_refs\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(seeded_kernel,"table",["look"],{"focus":"investigator"})),"luck"),47)),"tests/kernel/test_rules_families.py:321 assert seeded_kernel.table(\"look\", focus=\"investigator\")[\"luck\"] == 47");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(seeded_kernel.workspace)),"party"),"thomas-hayes.json"))),"current_luck"),47)),"tests/kernel/test_rules_families.py:322 assert read_json(campaign_dir(seeded_kernel.workspace) / \"party\" / \"thomas-hayes.json\")[\"current_luck\"] == 47");
both=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,2)}`,({"intent":"investigate","goal":"x","method":"换法子","stakes":"z","push":true})));
assert.ok(pyBool(pyEqual(pyAt(both,"code"),"turn_state")),"tests/kernel/test_rules_families.py:326 assert both[\"code\"] == \"turn_state\"");
changes=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt((await narrate(seeded_kernel,`t1-c${pyAdd(n,3)}`,"你眯起眼。")),"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"change"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool(pyContains(changes,({["kind"]:"change",["marker"]:"change:luck",["receipt"]:pyAt(pyAt(changes,(-1)),"receipt"),["resource"]:"luck",["subject"]:"thomas-hayes",["subject_label"]:"托马斯·海斯",["subject_is_investigator"]:true,["before"]:50,["after"]:47,["call"]:`t1-c${pyAdd(n,1)}`,["family"]:"push-luck"}))),"tests/kernel/test_rules_families.py:329 assert {\"kind\": \"change\", \"marker\": \"change:luck\", \"receipt\": changes[-1][\"receipt\"], \"resource\": \"luck\", \"subject\": \"thomas-hayes\",\n            \"subject_label\": \"托马斯·海斯\", \"subject_is_investigator\": True, \"before\": 50, \"after\": 47,\n            \"call\": f\"t1-c{n + 1}\", \"family\": \"push-luck\"} in changes");
events=(await read_jsonl(pyDivide((await campaign_dir(seeded_kernel.workspace)),"events.jsonl")));
changed=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(pyEqual(pyAt(e,"type"),"resource-changed"))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool(pyEqual(pyAt(pyAt(changed,(-1)),"data"),({["resource"]:"luck",["subject"]:"thomas-hayes",["before"]:50,["after"]:47}))),"tests/kernel/test_rules_families.py:334 assert changed[-1][\"data\"] == {\"resource\": \"luck\", \"subject\": \"thomas-hayes\", \"before\": 50, \"after\": 47}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_luck_spend_and_insufficient_luck"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_luck_spend_and_insufficient_luck(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_first_aid_on_a_wounded_investigator(seeded_kernel:any){
let healthy:any,situations:any,before:any,result:any,outcome:any,mechanics:any,again:any;
(await open_turn(seeded_kernel,"我包扎。"));
healthy=(await resolve_err(seeded_kernel,"t1-c1",({"intent":"investigate","goal":"给自己包扎","method":"用急救处理伤口"})));
assert.ok(pyBool(pyEqual(pyAt(healthy,"code"),"needs")),"tests/kernel/test_rules_families.py:342 assert healthy[\"code\"] == \"needs\"");
assert.ok(pyBool(pyContains((await pyMethod(json,"dumps",[pyAt(pyAt(healthy,"details"),"unmet")],{})),"time.minutes_since_injury")),"tests/kernel/test_rules_families.py:343 assert \"time.minutes_since_injury\" in json.dumps(healthy[\"details\"][\"unmet\"])");
(await seed_wound(seeded_kernel.workspace,8));
situations=pyAt(pyAt((await pyMethod(seeded_kernel,"table",["look"],{})),"where"),"situations");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(situations)){__rows.push(pyAt(s,"decision"));}return __rows;})()),["healing:first-aid-ordinary"])),"tests/kernel/test_rules_families.py:347 assert [s[\"decision\"] for s in situations] == [\"healing:first-aid-ordinary\"]");
before=(await event_count(seeded_kernel.workspace));
result=(await resolve(seeded_kernel,"t1-c1",({"intent":"investigate","goal":"给自己包扎","method":"用急救处理伤口"})));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"healing:first-aid-ordinary")),"tests/kernel/test_rules_families.py:351 assert result[\"decision\"] == \"healing:first-aid-ordinary\"");
outcome=pyAt(result,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"healing");return pyBool(__left)?pyEqual(pyAt(outcome,"skill"),"First Aid"):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"hp_before"),8):__left;})())),"tests/kernel/test_rules_families.py:353 assert outcome[\"kind\"] == \"healing\" and outcome[\"skill\"] == \"First Aid\" and outcome[\"hp_before\"] == 8");
assert.ok(pyBool(pyEqual(pyAt(outcome,"target"),30)),"tests/kernel/test_rules_families.py:354 assert outcome[\"target\"] == 30");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"receipts"),0),"roll:first-aid-t1-c1")),"tests/kernel/test_rules_families.py:355 assert result[\"receipts\"][0] == \"roll:first-aid-t1-c1\"");
if(pyBool(pyAt(outcome,"passed"))){assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"hp_after"),9);return pyBool(__left)?pyEqual(pyAt(outcome,"hp_gained"),1):__left;})())),"tests/kernel/test_rules_families.py:357 assert outcome[\"hp_after\"] == 9 and outcome[\"hp_gained\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(result,"effects"),[({["kind"]:"hp",["subject"]:"thomas-hayes",["before"]:8,["after"]:9})])),"tests/kernel/test_rules_families.py:358 assert result[\"effects\"] == [{\"kind\": \"hp\", \"subject\": \"thomas-hayes\", \"before\": 8, \"after\": 9}]");
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),["roll:first-aid-t1-c1","delta:hp-t1-c1"])),"tests/kernel/test_rules_families.py:359 assert result[\"receipts\"] == [\"roll:first-aid-t1-c1\", \"delta:hp-t1-c1\"]");
assert.ok(pyBool(pyEqual((await events_after(seeded_kernel.workspace,before)),["roll-resolved","resource-changed","decision-settled"])),"tests/kernel/test_rules_families.py:360 assert events_after(seeded_kernel.workspace, before) == [\"roll-resolved\", \"resource-changed\", \"decision-settled\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(seeded_kernel,"table",["look"],{"focus":"investigator"})),"hp"),9)),"tests/kernel/test_rules_families.py:361 assert seeded_kernel.table(\"look\", focus=\"investigator\")[\"hp\"] == 9");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(seeded_kernel.workspace)),"save"),"healing-state"),"thomas-hayes.json"))),"current_hp"),9)),"tests/kernel/test_rules_families.py:362 assert read_json(campaign_dir(seeded_kernel.workspace) / \"save\" / \"healing-state\" / \"thomas-hayes.json\")[\"current_hp\"] == 9");
mechanics=pyAt((await narrate(seeded_kernel,"t1-c2","你缠好绷带。")),"mechanics");
assert.ok(pyBool(pyContains(mechanics,({["kind"]:"change",["marker"]:"change:hp",["receipt"]:"delta:hp-t1-c1",["resource"]:"hp",["subject"]:"thomas-hayes",["subject_label"]:"托马斯·海斯",["subject_is_investigator"]:true,["before"]:8,["after"]:9}))),"tests/kernel/test_rules_families.py:364 assert {\"kind\": \"change\", \"marker\": \"change:hp\", \"receipt\": \"delta:hp-t1-c1\", \"resource\": \"hp\", \"subject\": \"thomas-hayes\",\n                \"subject_label\": \"托马斯·海斯\", \"subject_is_investigator\": True, \"before\": 8, \"after\": 9} in mechanics");}else{assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"hp_after"),8);return pyBool(__left)?pyEqual(pyAt(result,"effects"),[]):__left;})())),"tests/kernel/test_rules_families.py:367 assert outcome[\"hp_after\"] == 8 and result[\"effects\"] == []");
assert.ok(pyBool(pyEqual((await events_after(seeded_kernel.workspace,before)),["roll-resolved","decision-settled"])),"tests/kernel/test_rules_families.py:368 assert events_after(seeded_kernel.workspace, before) == [\"roll-resolved\", \"decision-settled\"]");
again=(await resolve(seeded_kernel,"t1-c2",({"intent":"investigate","goal":"再试","method":"用急救"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(again,"outcome"),"hp_after"),8);return pyBool(__left)?pyEqual(pyAt(again,"receipts"),[]):__left;})())),"tests/kernel/test_rules_families.py:371 assert again[\"outcome\"][\"hp_after\"] == 8 and again[\"receipts\"] == []");}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_aid_on_a_wounded_investigator"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_aid_on_a_wounded_investigator(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_first_aid_can_rouse_an_unconscious_npc_without_an_injury_clock(seeded_kernel:any){
let missing:any,result:any,world:any,conditions:any;
(await open_turn(seeded_kernel,"我给昏迷的诺特做急救。"));
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"his body now matters"})]}));
missing=(await resolve_err(seeded_kernel,"t1-c2",({"intent":"investigate","goal":"唤醒诺特","method":"清理气道并做急救","target":"Steven Knott","stakes":"他仍不醒"})));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(missing,"fix"),"apply npc");return pyBool(__left)?pyContains(pyAt(missing,"fix"),"conditions"):__left;})())),"tests/kernel/test_rules_families.py:381 assert \"apply npc\" in missing[\"fix\"] and \"conditions\" in missing[\"fix\"]");
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["conditions"]:({["gained"]:["unconscious"]}),["why"]:"the poison took hold"})]}));
result=(await resolve(seeded_kernel,"t1-c4",({"intent":"investigate","goal":"唤醒诺特","method":"清理气道并做急救","target":"Steven Knott","stakes":"他仍不醒"})));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"healing:first-aid-ordinary")),"tests/kernel/test_rules_families.py:392 assert result[\"decision\"] == \"healing:first-aid-ordinary\"");
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(result,"outcome"),"get",["patient",(await pyMethod(pyAt(result,"outcome"),"get",["subject"],{}))],{})),"steven-knott")),"tests/kernel/test_rules_families.py:393 assert result[\"outcome\"].get(\"patient\", result[\"outcome\"].get(\"subject\")) == \"steven-knott\"");
world=(await read_json(pyDivide((await campaign_dir(seeded_kernel.workspace)),"world.json")));
conditions=pyAt(pyAt(pyAt(world,"npc_resources"),"steven-knott"),"conditions");
assert.ok(pyBool(((!pyContains(conditions,"unconscious"))===pyAt(pyAt(result,"outcome"),"passed"))),"tests/kernel/test_rules_families.py:396 assert (\"unconscious\" not in conditions) is result[\"outcome\"][\"passed\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_aid_can_rouse_an_unconscious_npc_without_an_injury_clock"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_aid_can_rouse_an_unconscious_npc_without_an_injury_clock(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_situations_show_the_dying_clock(kernel:any){
let situations:any,clock:any;
(await open_turn(kernel,"我倒下了。"));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{})),"where"),"situations"),[])),"tests/kernel/test_rules_families.py:401 assert kernel.table(\"look\")[\"where\"][\"situations\"] == []");
(await seed_wound(kernel.workspace,0,["dying","unconscious"],undefined));
situations=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{})),"where"),"situations"))){__rows.push([pyAt(s,"decision"),s]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pySet(situations)),new Set(["healing:dying-round-clock","healing:first-aid-stabilization"]))),"tests/kernel/test_rules_families.py:404 assert set(situations) == {\"healing:dying-round-clock\", \"healing:first-aid-stabilization\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(situations,"healing:dying-round-clock"),"because"),["actor.conditions.dying = True","actor.resources.hp = 0"])),"tests/kernel/test_rules_families.py:405 assert situations[\"healing:dying-round-clock\"][\"because\"] == [\"actor.conditions.dying = True\", \"actor.resources.hp = 0\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(situations,"healing:dying-round-clock"),"investigator"),"thomas-hayes")),"tests/kernel/test_rules_families.py:406 assert situations[\"healing:dying-round-clock\"][\"investigator\"] == \"thomas-hayes\"");
clock=(await resolve(kernel,"t1-c1",({"intent":"investigate","goal":"撑住","method":"","decision":"healing:dying-round-clock"})));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(clock,"outcome"),"kind"),"healing");return pyBool(__left)?pyEqual(pyAt(pyAt(clock,"outcome"),"skill"),"CON"):__left;})());return pyBool(__left)?pyEqual(pyAt(pyAt(clock,"outcome"),"target"),55):__left;})())),"tests/kernel/test_rules_families.py:409 assert clock[\"outcome\"][\"kind\"] == \"healing\" and clock[\"outcome\"][\"skill\"] == \"CON\" and clock[\"outcome\"][\"target\"] == 55");
assert.ok(pyBool(pyEqual(pyAt(pyAt(clock,"receipts"),0),"roll:con-t1-c1")),"tests/kernel/test_rules_families.py:410 assert clock[\"receipts\"][0] == \"roll:con-t1-c1\"");
if(pyBool(!pyBool(pyAt(pyAt(clock,"outcome"),"passed")))){assert.ok(pyBool(pyContains(pyAt(pyAt(clock,"outcome"),"conditions"),"dead")),"tests/kernel/test_rules_families.py:412 assert \"dead\" in clock[\"outcome\"][\"conditions\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(clock,"effects"),0),"kind"),"condition")),"tests/kernel/test_rules_families.py:413 assert clock[\"effects\"][0][\"kind\"] == \"condition\"");}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_situations_show_the_dying_clock"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_situations_show_the_dying_clock(await kernel(t,{}));});
export async function test_a_condition_change_lands_a_receipt_so_a_death_can_be_told(kernel:any){
let n:any,clock:any,death:any,delivered:any,card:any;

(await open_turn(kernel,"我撑住。"));
(await seed_wound(kernel.workspace,0,["dying","unconscious"],undefined));
for(n of pyIterable((await pyRange(1,25)))){
clock=(await resolve(kernel,`t1-c${n}`,({"intent":"investigate","goal":"撑住","method":"","decision":"healing:dying-round-clock"})));
if(pyBool(!pyBool(pyAt(pyAt(clock,"outcome"),"passed")))){break;}
}
assert.equal(clock.outcome.passed,false,"no failed CON roll in 24 attempts");
assert.ok(pyBool(pyContains(pyAt(pyAt(clock,"outcome"),"conditions"),"dead")),"tests/kernel/test_rules_families.py:430 assert \"dead\" in clock[\"outcome\"][\"conditions\"]");
death=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"kind"),"condition"))){__rows.push(r);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(death)),1)),pyStr((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))){__rows.push(pyAt(r,"kind"));}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(death,0),"gained"),["dead"]);return pyBool(__left)?pyEqual(pyAt(pyAt(death,0),"subject"),"thomas-hayes"):__left;})())),"tests/kernel/test_rules_families.py:433 assert death[0][\"gained\"] == [\"dead\"] and death[0][\"subject\"] == \"thomas-hayes\"");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(death,0),"subject_is_investigator")===true);return pyBool(__left)?pyContains(pyAt(clock,"receipts"),pyAt(pyAt(death,0),"id")):__left;})())),"tests/kernel/test_rules_families.py:434 assert death[0][\"subject_is_investigator\"] is True and death[0][\"id\"] in clock[\"receipts\"]");
delivered=(await narrate(kernel,`t1-c${pyAdd(n,1)}`,"他的胸口不再起伏。"));
card=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"condition"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=card;return pyBool(__left)?pyEqual(pyAt(pyAt(card,0),"gained"),["dead"]):__left;})());return pyBool(__left)?pyEqual(pyAt(pyAt(card,0),"receipt"),pyAt(pyAt(death,0),"id")):__left;})())),"tests/kernel/test_rules_families.py:438 assert card and card[0][\"gained\"] == [\"dead\"] and card[0][\"receipt\"] == death[0][\"id\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(pyAt(delivered,"facts"),"committed"))){__rows.push(pyContains(line,"is now dead"));}return __rows;})())))),pyStr(pyAt(pyAt(delivered,"facts"),"committed")));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_condition_change_lands_a_receipt_so_a_death_can_be_told"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_condition_change_lands_a_receipt_so_a_death_can_be_told(await kernel(t,{}));});

export async function test_magic_learn_then_cast_from_the_catalog(seeded_kernel:any){
let unknown:any,absent:any,start:any,n:any,learned:any,due:any,early:any,cast:any,outcome:any,investigator:any,magic_state:any,unpriced:any;
(await open_turn(seeded_kernel,"我研读。"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(seeded_kernel,"table",["lookup"],{"kind":"catalog","query":"Flesh Ward","kinds":["spell"]})),"candidates"),0),"source"),({["table"]:"spells.json"}))),"tests/kernel/test_rules_families.py:446 assert seeded_kernel.table(\"lookup\", kind=\"catalog\", query=\"Flesh Ward\", kinds=[\"spell\"])[\"candidates\"][0][\"source\"] == {\"table\": \"spells.json\"}");
unknown=(await resolve_err(seeded_kernel,"t1-c1",({"intent":"cast","goal":"x","method":"y","spell":"Flesh Ward"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(unknown,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(unknown,"details"),"needs"),"field"),"spell"):__left;})())),"tests/kernel/test_rules_families.py:448 assert unknown[\"code\"] == \"needs\" and unknown[\"details\"][\"needs\"][\"field\"] == \"spell\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(unknown,"details"),"needs"),"options"),[])),"tests/kernel/test_rules_families.py:449 assert unknown[\"details\"][\"needs\"][\"options\"] == []");
absent=(await resolve_err(seeded_kernel,"t1-c1",({"intent":"investigate","goal":"学会肉体守护","method":"研读","spell":"Flesh Ward","target":"Walter Corbitt"})));
assert.ok(pyBool(pyEqual(pyAt(absent,"code"),"unknown_entity")),"tests/kernel/test_rules_families.py:454 assert absent[\"code\"] == \"unknown_entity\"");
start=(await walk_to_confrontation(seeded_kernel));
for(n of pyIterable((await pyRange(start,pyAdd(start,24))))){
learned=(await resolve(seeded_kernel,`t1-c${n}`,({"intent":"investigate","goal":"学会肉体守护","method":"研读","spell":"Flesh Ward","target":"Walter Corbitt"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(learned,"decision"),"magic:learn-spell");return pyBool(__left)?pyEqual(pyAt(pyAt(learned,"outcome"),"kind"),"magic"):__left;})())),"tests/kernel/test_rules_families.py:459 assert learned[\"decision\"] == \"magic:learn-spell\" and learned[\"outcome\"][\"kind\"] == \"magic\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(learned,"outcome"),"source"),"person");return pyBool(__left)?pyEqual(pyAt(pyAt(learned,"outcome"),"spell"),"Flesh Ward"):__left;})())),"tests/kernel/test_rules_families.py:460 assert learned[\"outcome\"][\"source\"] == \"person\" and learned[\"outcome\"][\"spell\"] == \"Flesh Ward\"");
if(pyBool(pyEqual(pyAt(pyAt(learned,"outcome"),"status"),"studying"))){break;}
assert.ok(pyBool(pyEqual(pyAt(pyAt(learned,"outcome"),"status"),"failed")),"tests/kernel/test_rules_families.py:463 assert learned[\"outcome\"][\"status\"] == \"failed\"");
}
assert.equal(learned.outcome.status,"studying","no successful Hard INT roll in 24 attempts");
assert.ok(pyBool(pyEqual(pyAt(learned,"receipts"),[`roll:int-t1-c${n}`])),"tests/kernel/test_rules_families.py:466 assert learned[\"receipts\"] == [f\"roll:int-t1-c{n}\"]");
due=pyAt(pyAt(learned,"outcome"),"study_due_minutes");
assert.ok(pyBool(pyEqual(due,pyMultiply(pyAt(pyAt(learned,"outcome"),"study_days"),1440))),"tests/kernel/test_rules_families.py:468 assert due == learned[\"outcome\"][\"study_days\"] * 1440");
early=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"cast","goal":"护住自己","method":"施法","spell":"Flesh Ward"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(early,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(early,"details"),"needs"),"field"),"spell"):__left;})())),"tests/kernel/test_rules_families.py:471 assert early[\"code\"] == \"needs\" and early[\"details\"][\"needs\"][\"field\"] == \"spell\"");
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":`t1-c${pyAdd(n,1)}`,"effects":[({["kind"]:"time",["minutes"]:due})]}));
cast=(await resolve(seeded_kernel,`t1-c${pyAdd(n,2)}`,({"intent":"cast","goal":"护住自己","method":"施法","spell":"Flesh Ward"})));
assert.ok(pyBool(pyEqual(pyAt(cast,"decision"),"magic:cast-spell")),"tests/kernel/test_rules_families.py:475 assert cast[\"decision\"] == \"magic:cast-spell\"");
outcome=pyAt(cast,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"magic");return pyBool(__left)?pyEqual(pyAt(outcome,"spell"),"Flesh Ward"):__left;})());return pyBool(__left)?(pyAt(outcome,"first_cast")===true):__left;})())),"tests/kernel/test_rules_families.py:477 assert outcome[\"kind\"] == \"magic\" and outcome[\"spell\"] == \"Flesh Ward\" and outcome[\"first_cast\"] is True");
assert.ok(pyBool(pyContains(["cast","failed"],pyAt(outcome,"status"))),"tests/kernel/test_rules_families.py:478 assert outcome[\"status\"] in (\"cast\", \"failed\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(cast,"receipts"),0),`roll:pow-t1-c${pyAdd(n,2)}`)),"tests/kernel/test_rules_families.py:479 assert cast[\"receipts\"][0] == f\"roll:pow-t1-c{n + 2}\"");
investigator=(await pyMethod(seeded_kernel,"table",["look"],{"focus":"investigator"}));
if(pyBool(pyEqual(pyAt(outcome,"status"),"cast"))){assert.ok(pyBool(pyLessEqual(1,pyAt(outcome,"san_lost"))),"tests/kernel/test_rules_families.py:482 assert outcome[\"san_lost\"] >= 1");
assert.ok(pyBool(pyLessEqual(new Set(["san"]),new Set((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(cast,"effects"))){__rows.push(pyAt(e,"kind"));}return __rows;})())))),"tests/kernel/test_rules_families.py:483 assert {e[\"kind\"] for e in cast[\"effects\"]} >= {\"san\"}");
assert.ok(pyBool(pyEqual(pyAt(investigator,"san"),pySubtract(55,pyAt(outcome,"san_lost")))),"tests/kernel/test_rules_families.py:484 assert investigator[\"san\"] == 55 - outcome[\"san_lost\"]");
assert.ok(pyBool((pyBool(pyLessEqual(pyAt(outcome,"mp_spent"),11))?pyEqual(pyAt(investigator,"mp"),pySubtract(11,pyAt(outcome,"mp_spent"))):pyEqual(pyAt(investigator,"mp"),0))),"tests/kernel/test_rules_families.py:485 assert investigator[\"mp\"] == 11 - outcome[\"mp_spent\"] if outcome[\"mp_spent\"] <= 11 else investigator[\"mp\"] == 0");}
magic_state=(await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(seeded_kernel.workspace)),"save"),"magic-state"),"thomas-hayes.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(magic_state,"studying_spells"),0),"spell"),"Flesh Ward")),"tests/kernel/test_rules_families.py:487 assert magic_state[\"studying_spells\"][0][\"spell\"] == \"Flesh Ward\"");
unpriced=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,3)}`,({"intent":"cast","goal":"x","method":"y","spell":"Dominate (variant)"})));
assert.ok(pyBool(pyEqual(pyAt(unpriced,"code"),"needs")),"tests/kernel/test_rules_families.py:490 assert unpriced[\"code\"] == \"needs\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_magic_learn_then_cast_from_the_catalog"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_magic_learn_then_cast_from_the_catalog(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_development_end_session_and_settle_ending(seeded_kernel:any){
let passed_id:any,_:any,n:any,ticks:any,pending:any,ended:any,outcome:any,luck:any,investigator:any,improved:any,directory:any,capsule:any,settled:any;
(await open_turn(seeded_kernel,"我们收工。"));
const __unpack30317=(await first_success(seeded_kernel,"t1-c",({"intent":"investigate","goal":"看清楚","method":"用侦查"})));assert.equal(__unpack30317.length,2,"Original tuple unpacking requires exact arity");passed_id=__unpack30317[0];_=__unpack30317[1];
n=(await pyInt(pyAt((await pyMethod(passed_id,"split",["-c"],{})),1)));
ticks=pyAt((await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(seeded_kernel.workspace)),"save"),"development-state"),"thomas-hayes.json"))),"ticks");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable((await pyMethod(ticks,"values",[],{})))){__rows.push(pyAt(t,"skill"));}return __rows;})()),["Spot Hidden"])),"tests/kernel/test_rules_families.py:500 assert [t[\"skill\"] for t in ticks.values()] == [\"Spot Hidden\"]");
pending=(await resolve_err(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"montage","goal":"x","method":"","decision":"development:settle-ending"})));
assert.ok(pyBool(pyEqual(pyAt(pending,"code"),"needs")),"tests/kernel/test_rules_families.py:504 assert pending[\"code\"] == \"needs\"");
ended=(await resolve(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"montage","goal":"调查员撤出宅子，把钥匙交还。","method":"","decision":"development:end-session","ending":"retreat"})));
assert.ok(pyBool(pyEqual(pyAt(ended,"decision"),"development:end-session")),"tests/kernel/test_rules_families.py:508 assert ended[\"decision\"] == \"development:end-session\"");
outcome=pyAt(ended,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"development");return pyBool(__left)?pyEqual(pyAt(outcome,"ending_kind"),"retreat"):__left;})());return pyBool(__left)?(await pyMethod(pyAt(outcome,"ending_id"),"startswith",["ending-"],{})):__left;})())),"tests/kernel/test_rules_families.py:510 assert outcome[\"kind\"] == \"development\" and outcome[\"ending_kind\"] == \"retreat\" and outcome[\"ending_id\"].startswith(\"ending-\")");
luck=pyAt(outcome,"luck_recovery");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(luck,"luck_before"),50);return pyBool(__left)?pyEqual(pyAt(luck,"luck_after"),pyAdd(50,pyAt(luck,"gained"))):__left;})())),"tests/kernel/test_rules_families.py:512 assert luck[\"luck_before\"] == 50 and luck[\"luck_after\"] == 50 + luck[\"gained\"]");
investigator=(await pyMethod(seeded_kernel,"table",["look"],{"focus":"investigator"}));
assert.ok(pyBool(pyEqual(pyAt(investigator,"luck"),pyAt(luck,"luck_after"))),"tests/kernel/test_rules_families.py:514 assert investigator[\"luck\"] == luck[\"luck_after\"]");
improved=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(outcome,"skills_improved"))){__rows.push([pyAt(row,"skill"),row]);}return __rows;})()));
if(pyBool(pyContains(improved,"Spot Hidden"))){assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(investigator,"skills"),"Spot Hidden");const __term1=pyAt(pyAt(improved,"Spot Hidden"),"after");const __term2=55;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,">");})())),"tests/kernel/test_rules_families.py:517 assert investigator[\"skills\"][\"Spot Hidden\"] == improved[\"Spot Hidden\"][\"after\"] > 55");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(ended,"effects"))){__rows.push(pyEqual(pyAt(e,"kind"),"skill"));}return __rows;})())))),"tests/kernel/test_rules_families.py:518 assert any(e[\"kind\"] == \"skill\" for e in ended[\"effects\"])");}else{assert.ok(pyBool(pyEqual(pyAt(pyAt(investigator,"skills"),"Spot Hidden"),55)),"tests/kernel/test_rules_families.py:520 assert investigator[\"skills\"][\"Spot Hidden\"] == 55");}
directory=pyDivide(pyDivide(pyDivide(pyDivide((await campaign_dir(seeded_kernel.workspace)),"save"),"development-settlements"),"endings"),pyAt(outcome,"ending_id"));
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod((pyDivide(directory,"capsule.json")),"exists",[],{}));return pyBool(__left)?(await pyMethod((pyDivide(directory,"thomas-hayes.json")),"exists",[],{})):__left;})())),"tests/kernel/test_rules_families.py:522 assert (directory / \"capsule.json\").exists() and (directory / \"thomas-hayes.json\").exists()");
capsule=(await read_json(pyDivide(directory,"capsule.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(capsule,"development_inputs"),"thomas-hayes"),"skills_checked"),["Spot Hidden"])),"tests/kernel/test_rules_families.py:524 assert capsule[\"development_inputs\"][\"thomas-hayes\"][\"skills_checked\"] == [\"Spot Hidden\"]");
assert.ok(pyBool(pyEqual(pyAt(capsule,"decision_id"),`t1-c${pyAdd(n,1)}`)),"tests/kernel/test_rules_families.py:525 assert capsule[\"decision_id\"] == f\"t1-c{n + 1}\"");
(await pyMethod((pyDivide(directory,"thomas-hayes.json")),"unlink",[],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(seeded_kernel,"table",["look"],{})),"where"),"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})()),["development:settle-ending"])),"tests/kernel/test_rules_families.py:529 assert [s[\"decision\"] for s in seeded_kernel.table(\"look\")[\"where\"][\"situations\"]] == [\"development:settle-ending\"]");
settled=(await resolve(seeded_kernel,`t1-c${pyAdd(n,2)}`,({"intent":"montage","goal":"x","method":"","decision":"development:settle-ending"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(settled,"outcome"),"kind"),"development");return pyBool(__left)?pyEqual(pyAt(pyAt(settled,"outcome"),"status"),"settled"):__left;})())),"tests/kernel/test_rules_families.py:532 assert settled[\"outcome\"][\"kind\"] == \"development\" and settled[\"outcome\"][\"status\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(settled,"outcome"),"ending_id"),pyAt(outcome,"ending_id"))),"tests/kernel/test_rules_families.py:533 assert settled[\"outcome\"][\"ending_id\"] == outcome[\"ending_id\"]");
assert.ok(pyBool((await pyMethod((pyDivide(directory,"thomas-hayes.json")),"exists",[],{}))),"tests/kernel/test_rules_families.py:534 assert (directory / \"thomas-hayes.json\").exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_development_end_session_and_settle_ending"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_development_end_session_and_settle_ending(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_lookup_rule_and_catalog(kernel:any){
let rules:any,one_reroll:any,catalog:any,weapons:any,tome:any,family:any,module:any;
(await open_turn(kernel));
rules=pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"rule","query":"pushed roll"})),"rules");
assert.ok(pyBool((await (async()=>{const __term0=0;const __term1=(await pyLen(rules));const __term2=8;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_rules_families.py:542 assert 0 < len(rules) <= 8");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rules)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=(await pyMethod(pyAt(r,"name"),"startswith",["rule:coc7:"],{}));return pyBool(__left)?pyAt(r,"family"):__left;})());return pyBool(__left)?(await pyIsInstance(pyAt(r,"evidence_span_ids"),pyList)):__left;})()));}return __rows;})())))),"tests/kernel/test_rules_families.py:543 assert all(r[\"name\"].startswith(\"rule:coc7:\") and r[\"family\"] and isinstance(r[\"evidence_span_ids\"], list) for r in rules)");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rules)){__rows.push(pyEqual(pyAt(r,"family"),"push-luck"));}return __rows;})())))),"tests/kernel/test_rules_families.py:544 assert any(r[\"family\"] == \"push-luck\" for r in rules)");
one_reroll=pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"rule","query":"one reroll"})),"rules"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(one_reroll,"name"),"rule:coc7:push-luck:one-reroll");return pyBool(__left)?pyAt(one_reroll,"evidence_span_ids"):__left;})())),"tests/kernel/test_rules_families.py:546 assert one_reroll[\"name\"] == \"rule:coc7:push-luck:one-reroll\" and one_reroll[\"evidence_span_ids\"]");
catalog=(await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Walter Corbitt"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(catalog,"candidates"),0),"kind"),"creature");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(catalog,"candidates"),0),"summary"),"hp"),16):__left;})())),"tests/kernel/test_rules_families.py:549 assert catalog[\"candidates\"][0][\"kind\"] == \"creature\" and catalog[\"candidates\"][0][\"summary\"][\"hp\"] == 16");
weapons=(await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"revolver","kinds":["weapon"]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(weapons,"kinds"),["weapon"]);return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(weapons,"candidates"))){__rows.push(pyEqual(pyAt(c,"kind"),"weapon"));}return __rows;})()))):__left;})())),"tests/kernel/test_rules_families.py:551 assert weapons[\"kinds\"] == [\"weapon\"] and all(c[\"kind\"] == \"weapon\" for c in weapons[\"candidates\"])");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(weapons,"candidates"))){__rows.push((await pyMethod(pyAt(c,"params"),"get",["damage_die"],{})));}return __rows;})())))),"tests/kernel/test_rules_families.py:552 assert any(c[\"params\"].get(\"damage_die\") for c in weapons[\"candidates\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Journalist","kinds":["occupation"]})),"candidates"),0),"name"),"Journalist")),"tests/kernel/test_rules_families.py:553 assert kernel.table(\"lookup\", kind=\"catalog\", query=\"Journalist\", kinds=[\"occupation\"])[\"candidates\"][0][\"name\"] == \"Journalist\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Acrophobia"})),"candidates"),0),"kind"),"phobia")),"tests/kernel/test_rules_families.py:554 assert kernel.table(\"lookup\", kind=\"catalog\", query=\"Acrophobia\")[\"candidates\"][0][\"kind\"] == \"phobia\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Ablutomania"})),"candidates"),0),"kind"),"mania")),"tests/kernel/test_rules_families.py:555 assert kernel.table(\"lookup\", kind=\"catalog\", query=\"Ablutomania\")[\"candidates\"][0][\"kind\"] == \"mania\"");
tome=pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Necronomicon","kinds":["tome"]})),"candidates"),0);
assert.ok(pyBool(pyAt(pyAt(tome,"params"),"sanity_cost")),"tests/kernel/test_rules_families.py:557 assert tome[\"params\"][\"sanity_cost\"]");
family=(await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Summon/Bind Byakhee","kinds":["spell"]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(family,"candidates"),0),"parameterisation"),"canonical_name"),"Summon/Bind Byakhee")),"tests/kernel/test_rules_families.py:559 assert family[\"candidates\"][0][\"parameterisation\"][\"canonical_name\"] == \"Summon/Bind Byakhee\"");
module=pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"catalog","query":"Dominate (variant)","kinds":["spell"]})),"candidates"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(module,"module_authored"),"authority"),"module_authored_spell");return pyBool(__left)?(pyAt(pyAt(pyAt(module,"module_authored"),"costs"),"authored")===false):__left;})())),"tests/kernel/test_rules_families.py:561 assert module[\"module_authored\"][\"authority\"] == \"module_authored_spell\" and module[\"module_authored\"][\"costs\"][\"authored\"] is False");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["lookup"],{"kind":"catalog","query":"x","kinds":["planet"]})),"code"),"invalid_params")),"tests/kernel/test_rules_families.py:562 assert kernel.table_err(\"lookup\", kind=\"catalog\", query=\"x\", kinds=[\"planet\"])[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lookup_rule_and_catalog"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lookup_rule_and_catalog(await kernel(t,{}));});

export async function test_replay_and_needs_fixes(seeded_kernel:any){
let action:any,fixed:any,first:any,replay:any,conflict:any,events:any;
(await open_turn(seeded_kernel,"我去报社。"));
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"newspaper-morgue"})]}));
action=({["intent"]:"social",["goal"]:"让阿蒂放我们进剪报室",["method"]:"跟他聊聊",["target"]:"Arty Wilmot"});
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(seeded_kernel,"table_err",["resolve"],{"call_id":"t1-c2","action":action})),"code"),"needs")),"tests/kernel/test_rules_families.py:571 assert seeded_kernel.table_err(\"resolve\", call_id=\"t1-c2\", action=action)[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual((await pyLen((await written(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))))),1)),pyStr("the move alone (and Ruth Blake's first impression, §178.3)"));
fixed=({...action,["skill"]:"Charm"});
first=(await pyMethod(seeded_kernel,"table",["resolve"],{"call_id":"t1-c2","action":fixed}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(first,"outcome"),"approach"),"charm")),"tests/kernel/test_rules_families.py:575 assert first[\"outcome\"][\"approach\"] == \"charm\"");
replay=(await pyMethod(seeded_kernel,"table",["resolve"],{"call_id":"t1-c2","action":fixed}));
assert.ok(pyBool(pyEqual(replay,({...first,["replayed"]:true}))),"tests/kernel/test_rules_families.py:577 assert replay == {**first, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await pyLen((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await written(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))))){if(pyBool(pyEqual(pyAt(r,"kind"),"roll"))){__rows.push(r);}}return __rows;})()))),1)),"tests/kernel/test_rules_families.py:578 assert len([r for r in written(seeded_kernel.table(\"status\")[\"receipts\"]) if r[\"kind\"] == \"roll\"]) == 1");
conflict=(await pyMethod(seeded_kernel,"table_err",["resolve"],{"call_id":"t1-c2","action":({...fixed,["skill"]:"Persuade"})}));
assert.ok(pyBool(pyEqual(pyAt(conflict,"code"),"idempotency_conflict")),"tests/kernel/test_rules_families.py:580 assert conflict[\"code\"] == \"idempotency_conflict\"");
events=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(seeded_kernel.workspace)),"events.jsonl"))))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(e,"type"),"decision-settled");return pyBool(__left)?!pyEqual(pyAt(pyAt(e,"data"),"decision"),"natural-npc:first-impression"):__left;})()))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(events)),1);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(events,0),"data"),"decision"),"social:adjudicate-difficulty"):__left;})())),"tests/kernel/test_rules_families.py:583 assert len(events) == 1 and events[0][\"data\"][\"decision\"] == \"social:adjudicate-difficulty\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_replay_and_needs_fixes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_replay_and_needs_fixes(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
