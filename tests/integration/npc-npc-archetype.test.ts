// Migrated from tests/kernel/test_npc_archetype.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,campaign_dir,narrate,open_turn,read_json,resolve,resolve_err,walk_to_confrontation,RpcClient,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export let ARCHETYPES:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"npc-stat-archetypes.json")),"read_text",[],{"encoding":"utf-8"}))],{})),"archetypes"))){if(pyBool(true))__rows.push([pyAt(a,"archetype_id"),a]);}return __rows;})()));
export let DERIVED:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"derived-attributes.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
export async function attack_knott(client:any,call_id:any,extra:any={}){
return (await resolve_err(client,call_id,({"intent":"combat","goal":"打诺特","method":"挥拳","actor":"Thomas Hayes","target":"Steven Knott",...extra})));
}
export async function test_the_refusal_offers_the_rulebook_archetypes_and_the_source_read(kernel:any){
let error:any,needs:any,fix:any;
(await open_turn(kernel,"我想把你打一顿"));
// §264.28: a person the book gives no block is pinned ordinary_adult instead of refused with `needs archetype`.
error=(await resolve(kernel,"t1-c1",({"intent":"combat","goal":"打诺特","method":"挥拳","weapon":"unarmed","actor":"Thomas Hayes","target":"Steven Knott"})));
assert.ok(pyBool(error.adjusted.some((row:any)=>row.field==='npc.archetype'&&row.reason==='default_stat_block')),JSON.stringify(error.adjusted));
assert.equal(error.family,'combat');
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_refusal_offers_the_rulebook_archetypes_and_the_source_read"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_refusal_offers_the_rulebook_archetypes_and_the_source_read(await kernel(t,{}));});
export async function test_a_pinned_archetype_rolls_inside_its_ranges_and_derives_the_rest(seeded_kernel:any){
let result:any,receipt:any,profile:any,spec:any,key:any,lo:any,hi:any,c:any,world:any,pinned:any;
(await open_turn(seeded_kernel,"我想把你打一顿"));
result=(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"房东，没打过架"})]}));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"kind"),"npc")))__rows.push(r);}return __rows;})())));
profile=pyAt(receipt,"profile");
assert.ok(pyBool(pyEqual(pyAt(profile,"archetype"),"ordinary_adult")),"tests/kernel/test_npc_archetype.py:40 assert profile[\"archetype\"] == \"ordinary_adult\"");
spec=pyAt(ARCHETYPES,"ordinary_adult");
for([key,[lo,hi]] of pyIterable((await pyMethod(pyAt(spec,"characteristics"),"items",[],{})))){
assert.ok(pyBool((await (async()=>{const __term0=lo;const __term1=pyAt(pyAt(profile,"characteristics"),key);const __term2=hi;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),pyStr(key));
}
for([key,[lo,hi]] of pyIterable((await pyMethod(pyAt(spec,"skills"),"items",[],{})))){
assert.ok(pyBool((await (async()=>{const __term0=lo;const __term1=pyAt(pyAt(profile,"skills"),key);const __term2=hi;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),pyStr(key));
}
c=pyAt(profile,"characteristics");
assert.ok(pyBool(pyEqual(pyAt(pyAt(profile,"derived"),"HP"),Math.floor((pyAdd(pyAt(c,"CON"),pyAt(c,"SIZ")))/pyAt(pyAt(DERIVED,"hit_points"),"divisor")))),"tests/kernel/test_npc_archetype.py:47 assert profile[\"derived\"][\"HP\"] == (c[\"CON\"] + c[\"SIZ\"]) // DERIVED[\"hit_points\"][\"divisor\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(profile,"derived"),"MP"),Math.floor(pyAt(c,"POW")/pyAt(pyAt(DERIVED,"magic_points"),"divisor")))),"tests/kernel/test_npc_archetype.py:48 assert profile[\"derived\"][\"MP\"] == c[\"POW\"] // DERIVED[\"magic_points\"][\"divisor\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(profile,"derived"),"SAN"),pyAt(c,"POW"))),"tests/kernel/test_npc_archetype.py:49 assert profile[\"derived\"][\"SAN\"] == c[\"POW\"]");
assert.ok(pyBool(pyContains([7,8,9],pyAt(pyAt(profile,"derived"),"MOV"))),"tests/kernel/test_npc_archetype.py:50 assert profile[\"derived\"][\"MOV\"] in (7, 8, 9)");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(profile,"derived"),"DB");return pyBool(__left)?pyContains(pyAt(profile,"derived"),"Build"):__left})())),"tests/kernel/test_npc_archetype.py:51 assert \"DB\" in profile[\"derived\"] and \"Build\" in profile[\"derived\"]");
world=(await read_json(pyDivide((await campaign_dir(seeded_kernel.workspace)),"world.json")));
pinned=pyAt(pyAt(world,"npc_profiles"),"steven-knott");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pinned,"authority"),"table_pinned");return pyBool(__left)?pyEqual(pyAt(pinned,"why"),"房东，没打过架"):__left})());return pyBool(__left)?pyEqual(pyAt(pinned,"pinned_turn"),1):__left})())),"tests/kernel/test_npc_archetype.py:54 assert pinned[\"authority\"] == \"table_pinned\" and pinned[\"why\"] == \"房东，没打过架\" and pinned[\"pinned_turn\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pinned,"characteristics"),c);return pyBool(__left)?pyEqual(pyAt(pinned,"weapons"),[]):__left})())),"tests/kernel/test_npc_archetype.py:55 assert pinned[\"characteristics\"] == c and pinned[\"weapons\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pinned_archetype_rolls_inside_its_ranges_and_derives_the_rest"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pinned_archetype_rolls_inside_its_ranges_and_derives_the_rest(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_the_same_seed_rolls_the_same_profile(tmp_path:any){
let rolled:any,n:any,client:any;

rolled=[];
for(n of pyIterable((await pyRange(2)))){
client=(new RpcClient(pyDivide(tmp_path,`ws${n}`),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await open_turn(client,"我想把你打一顿"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"capable_adult"})]}));
(await pyMethod(rolled,"append",[pyAt(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json"))),"npc_profiles"),"steven-knott"),"characteristics")],{}));}finally{(await pyMethod(client,"close",[],{}));}
}
assert.ok(pyBool(pyEqual(pyAt(rolled,0),pyAt(rolled,1))),"tests/kernel/test_npc_archetype.py:69 assert rolled[0] == rolled[1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_same_seed_rolls_the_same_profile"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_same_seed_rolls_the_same_profile(temporary);});
export async function test_combat_opens_against_the_pinned_person(seeded_kernel:any){
let attack:any,kinds:any,started:any,labels:any;
(await open_turn(seeded_kernel,"我想把你打一顿"));
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"房东"})]}));
attack=(await resolve(seeded_kernel,"t1-c2",({"intent":"combat","goal":"打诺特","method":"挥拳","actor":"Thomas Hayes","target":"Steven Knott","weapon":"unarmed"})));
assert.ok(pyBool((await pyMethod(pyAt(attack,"decision"),"startswith",["combat:"],{}))),"tests/kernel/test_npc_archetype.py:76 assert attack[\"decision\"].startswith(\"combat:\")");
kinds=new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))){if(pyBool(true))__rows.push(pyAt(r,"kind"));}return __rows;})()));
assert.ok(pyBool(pyContains(kinds,"session")),"tests/kernel/test_npc_archetype.py:78 assert \"session\" in kinds");
started=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(seeded_kernel,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"session");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["transition"],{})),"start"):__left})())))__rows.push(r);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=started;return pyBool(__left)?pyEqual(pyAt(pyAt(started,0),"family"),"combat"):__left})())),"tests/kernel/test_npc_archetype.py:80 assert started and started[0][\"family\"] == \"combat\"");
labels=(await pyMethod(seeded_kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"}));
assert.ok(pyBool(labels),"tests/kernel/test_npc_archetype.py:83 assert labels");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_combat_opens_against_the_pinned_person"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_combat_opens_against_the_pinned_person(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_the_pin_is_made_once_and_survives_turns(seeded_kernel:any){
let again:any,attack:any;
(await open_turn(seeded_kernel,"我想把你打一顿"));
(await pyMethod(seeded_kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult"})]}));
again=(await pyMethod(seeded_kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"dangerous_actor"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(again,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(again,"message"),"already has a pinned ordinary_adult profile"):__left})())),"tests/kernel/test_npc_archetype.py:90 assert again[\"code\"] == \"invalid_params\" and \"already has a pinned ordinary_adult profile\" in again[\"message\"]");
(await narrate(seeded_kernel,"t1-c3","诺特往后一缩。"));
(await pyMethod(seeded_kernel,"table",["player_input"],{"text":"我再打。"}));
attack=(await resolve(seeded_kernel,"t2-c1",({"intent":"combat","goal":"打诺特","method":"挥拳","actor":"Thomas Hayes","target":"Steven Knott","weapon":"unarmed"})));
assert.ok(pyBool((await pyMethod(pyAt(attack,"decision"),"startswith",["combat:"],{}))),"tests/kernel/test_npc_archetype.py:94 assert attack[\"decision\"].startswith(\"combat:\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_pin_is_made_once_and_survives_turns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_pin_is_made_once_and_survives_turns(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_an_unknown_archetype_is_refused_with_the_options(kernel:any){
let error:any;
(await open_turn(kernel,"我想把你打一顿"));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"boxer"})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_npc_archetype.py:100 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"options"),(await pyList(ARCHETYPES)))),"tests/kernel/test_npc_archetype.py:101 assert error[\"details\"][\"options\"] == list(ARCHETYPES)");
assert.ok(pyBool(pyContains(pyAt(error,"fix"),"ordinary_adult")),"tests/kernel/test_npc_archetype.py:102 assert \"ordinary_adult\" in error[\"fix\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unknown_archetype_is_refused_with_the_options"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unknown_archetype_is_refused_with_the_options(await kernel(t,{}));});
export async function test_the_books_numbers_cannot_be_replaced_by_an_archetype(kernel:any){
let error:any;
(await open_turn(kernel,"我打量四周。"));
(await walk_to_confrontation(kernel));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c9","effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["archetype"]:"dangerous_actor"})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_npc_archetype.py:109 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains(pyAt(error,"message"),"prints Walter Corbitt's numbers")),"tests/kernel/test_npc_archetype.py:110 assert \"prints Walter Corbitt's numbers\" in error[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"authority"),"source_authored")),"tests/kernel/test_npc_archetype.py:111 assert error[\"details\"][\"authority\"] == \"source_authored\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_books_numbers_cannot_be_replaced_by_an_archetype"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_books_numbers_cannot_be_replaced_by_an_archetype(await kernel(t,{}));});

export async function _pin_faster_knott(tmp_path:any){
let seed:any,client:any,dex:any;


for(seed of pyIterable(["1","2","3","4","5","6","7","8","9","10","11","12"])){
client=(new RpcClient(pyDivide(tmp_path,`ws-${seed}`),({"env":({["COC_KERNEL_SEED"]:seed})})));
(await open_turn(client,"我想把你打一顿"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"dangerous_actor",["why"]:"test"})]}));
dex=pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json"))),"npc_profiles"),"steven-knott"),"characteristics"),"DEX");
if(pyBool(pyLess(60,dex))){return [client,dex];}
(await pyMethod(client,"close",[],{}));
}
throw new Error("raise AssertionError(\"no seed in the list rolled a DEX above 60 for dangerous_actor (range 45-80)\")");
}
export async function test_a_fight_against_someone_faster_opens_and_hands_them_the_first_action(tmp_path:any){
let client:any,dex:any,opened:any,receipts:any,again:any,knott:any,pending:any;
const __unpack7629=(await _pin_faster_knott(tmp_path));client=__unpack7629[0];dex=__unpack7629[1];
try{opened=(await resolve(client,"t1-c2",({"intent":"combat","goal":"打诺特","method":"挥拳","actor":"Thomas Hayes","target":"Steven Knott","weapon":"unarmed"})));
assert.ok(pyBool((await pyMethod(pyAt(opened,"decision"),"startswith",["combat:"],{}))),"tests/kernel/test_npc_archetype.py:135 assert opened[\"decision\"].startswith(\"combat:\")");
receipts=pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"session");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["transition"],{})),"start"):__left})()));}return __rows;})())))),pyStr("the start receipt landed"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){if(pyBool(true))__rows.push(pyEqual(pyAt(r,"kind"),"roll"));}return __rows;})()))))),pyStr("no blow was rolled: the first action is Knott's"));
again=(await pyMethod(client,"table_err",["resolve"],{"call_id":"t1-c3","action":({["intent"]:"combat",["goal"]:"打诺特",["method"]:"挥拳",["actor"]:"Thomas Hayes",["target"]:"Steven Knott",["weapon"]:"unarmed"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(again,"code"),"turn_state");return pyBool(__left)?pyContains(pyAt(again,"message"),"steven-knott's turn"):__left})())),"tests/kernel/test_npc_archetype.py:141 assert again[\"code\"] == \"turn_state\" and \"steven-knott's turn\" in again[\"message\"]");
knott=(await resolve(client,"t1-c4",({"intent":"combat","goal":"推开海斯","method":"抡椅子","actor":"steven-knott","target":"Thomas Hayes","weapon":"unarmed"})));
assert.ok(pyBool((await pyMethod(pyAt(knott,"decision"),"startswith",["combat:"],{}))),"tests/kernel/test_npc_archetype.py:143 assert knott[\"decision\"].startswith(\"combat:\")");
pending=(await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=(await pyMethod(knott,"get",["pending_choice"],{}));return pyBool(__left)?__left:(await pyMethod(((await (async()=>{const __left=(await pyMethod(knott,"get",["outcome"],{}));return pyBool(__left)?__left:({})})())),"get",["pending_choice"],{}))})());return pyBool(__left)?__left:(await pyMethod((await pyMethod(client,"table",["open"],{})),"get",["pending_choice"],{}))})());return pyBool(__left)?__left:({})})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(pending,"get",["for"],{})),"player");return pyBool(__left)?pyLessEqual(new Set(["dodge","fight_back"]),(await pySet((await pyMethod(pending,"get",["options",[]],{}))))):__left})())),pyStr(`Hayes must answer Knott's attack: ${pySlice((await pyMethod(json,"dumps",[knott],{"ensure_ascii":false})),undefined,600)}`));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_fight_against_someone_faster_opens_and_hands_them_the_first_action"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_fight_against_someone_faster_opens_and_hands_them_the_first_action(temporary);});
