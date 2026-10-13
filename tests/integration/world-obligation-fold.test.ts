// Migrated from tests/kernel/test_obligation_fold.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,RpcClient,campaign_dir,read_json,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_obligation_fold.py',import.meta.url).pathname;







export let MORGUE:any="newspaper-morgue";
const __unpack901=["globe-clippings-access","globe-archivist"];export let ACCESS:any=__unpack901[0];export let ARCHIVIST:any=__unpack901[1];
export let FLAG:any="newspaper-morgue-clippings-access";
export let FAILURE_LINE:any=("Arty refuses access to the clipping room; the investigator may try another route or propose a "+"changed method for a pushed attempt.");
export let PUSH_LINE:any="Arty has the investigator ejected and permanently bars them from the newspaper clipping room.";
export let ORDINARY_OUTCOME:any=new Set(["kind","skill","target","difficulty","threshold","roll","level","passed","bonus","penalty","pushed"]);

export let GATE3:any=({["intent"]:"social",["goal"]:"请剪报室编辑调出科比特宅这些年的旧剪报",["method"]:"说明自己是受房东委托查证的私家侦探，请求按街道地址调出相关旧报",["target"]:"Arty Wilmot",["skill"]:"Persuade",["modifiers"]:({["bonus_dice"]:1,["reason"]:"来意具体：受房东委托、按地址查旧报，给了他一个可以当成自己量裁的理由"})});

export let PASS:any=2;

export let FAIL:any=4;

export let PUSH:any=3;


export let AMBIGUOUS_PASS:any=5;


const __unpack2296=["globe-fire-archive","newspaper-morgue-fire-archive"];export let SECOND:any=__unpack2296[0];export let SECOND_FLAG:any=__unpack2296[1];
export async function second_obligation(root:any){
let path:any,graph:any,access:any,node_id:any,claim_id:any;

(await pyMethod(shutil,"copytree",[CONTENT_DIR,root],{}));
path=pyDivide(pyDivide(pyDivide(root,"starters"),"the-haunting"),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
access=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(node,"node_id"),`requirement-${ACCESS}`))){__rows.push(node);}}return __rows;})())));
node_id=`requirement-${SECOND}`;
(await pyMethod(pyAt(graph,"nodes"),"append",[({["node_id"]:node_id,["node_kind"]:"requirement",["name"]:"The Globe fire archive",["visibility"]:"keeper-only",["aliases"]:[],["summary"]:"Arty also keeps the fire-insurance files; a regular Persuade or Charm opens them.",["evidence_span_ids"]:pyAt(access,"evidence_span_ids"),["source_refs"]:pyAt(access,"source_refs"),["properties"]:({["obligation"]:({["scene"]:"scene-newspaper-morgue",["trigger"]:({["kind"]:"attempt",["guards"]:({["clues"]:["clue-globe-fire-cutoff"]})}),["who"]:"npc-arty-wilmot",["demand"]:[({["kind"]:"meet",["npc"]:"npc-arty-wilmot"}),({["kind"]:"check",["scope"]:"actor-target",["target"]:"npc-arty-wilmot",["selection"]:"approach",["values"]:[({["path"]:"skills.Persuade",["label"]:"Persuade"}),({["path"]:"skills.Charm",["label"]:"Charm"})],["difficulty"]:"regular",["results"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const level of pyIterable(["critical","extreme","hard","regular","failure","fumble"])){__rows.push([level,({["settles"]:!pyContains(["failure","fumble"],level)})]);}return __rows;})()))})],["settles"]:({["kind"]:"flag_set",["flag_id"]:SECOND_FLAG})})})})],{}));
claim_id=`claim-has-requirement-${SECOND}`;
(await pyMethod(pyAt(graph,"claims"),"append",[({["claim_id"]:claim_id,["subject_id"]:"scene-newspaper-morgue",["predicate"]:"has-requirement",["object"]:({["node_id"]:node_id}),["truth_status"]:"authored-fact",["visibility"]:"keeper-only",["evidence_span_ids"]:pyAt(access,"evidence_span_ids"),["asserted_by_ids"]:[],["known_by_ids"]:[],["validity"]:null,["confidence"]:1.0,["reason"]:"Derived for the §134.17 ambiguity case."})],{}));
(await pyMethod(pyAt(graph,"relations"),"append",[({["relation_id"]:`relation-has-requirement-${SECOND}`,["relation_kind"]:"has-requirement",["from_node_id"]:"scene-newspaper-morgue",["to_node_id"]:node_id,["claim_id"]:claim_id,["properties"]:({})})],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
return root;
}
Object.defineProperty(second_obligation,"__pySignature",{value:[{"name":"root","rest":false,"varargs":false}]});
export async function* morgue(tmp_path:any){
let clients:any,client:any;
clients=[];
async function open_at(seed:any,content:any=null,meet:any=true){
let client:any;
client=(new RpcClient(pyDivide(pyDivide(tmp_path,`s${seed}-${(await pyInvoke(pyLen,[clients],{}))}`),"ws"),({"env":({["COC_KERNEL_SEED"]:(await pyInvoke(pyStr,[seed],{}))}),"content":content})));
(await pyMethod(clients,"append",[client],{}));
(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t0-c1","text":"The opening."}));
(await pyMethod(client,"table",["player_input"],{"text":"我说明来意，请他帮忙调出科比特宅这些年的旧剪报。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:MORGUE})]}));
if(pyBool(meet)){(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"person",["who"]:"Arty Wilmot",["name"]:"Arty"})]}));}
return client;
}
Object.defineProperty(open_at,"__pySignature",{value:[{"name":"seed","rest":false,"varargs":false},{"name":"content","rest":false,"varargs":false},{"name":"meet","rest":false,"varargs":false}]});
yield open_at;
for(client of pyIterable(clients)){
(await pyMethod(client,"close",[],{}));
}
}
Object.defineProperty(morgue,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
export async function resolve(client:any,call_id:any="t1-c3",drop:any=[],changes:any={}){
let action:any,result:any;
action=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [key,value] of pyIterable((await pyMethod(({...GATE3,...changes}),"items",[],{})))){if(pyBool(!pyContains(drop,key))){__rows.push([key,value]);}}return __rows;})()));
result=(await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:call_id,["action"]:action})],{}));
assert.ok(pyBool(pyAt(result,"ok")),pyStr((await pyMethod(result,"get",["error"],{}))));
return pyAt(result,"result");
}
Object.defineProperty(resolve,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"drop","rest":false,"varargs":false},{"name":"changes","rest":true,"varargs":false}]});
export async function world(client:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"world.json")],{}));
}
Object.defineProperty(world,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function receipt(client:any,receipt_id:any){
return (await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turn.json")],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),receipt_id))){__rows.push(r);}}return __rows;})())));
}
Object.defineProperty(receipt,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"receipt_id","rest":false,"varargs":false}]});
export async function rows(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(client,"ok",["table.apply.options",({["campaign"]:CAMPAIGN})],{})),"obligations"))){__rows.push([pyAt(row,"handle"),row]);}return __rows;})()));
}
Object.defineProperty(rows,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function events(client:any){
let lines:any;
lines=(await pyMethod((await pyMethod((pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"events.jsonl")),"read_text",[],{"encoding":"utf-8"})),"splitlines",[],{}));
return (await (async()=>{const __rows:any[]=[];for(const line of pyIterable(lines)){if(pyBool((await pyMethod(line,"strip",[],{})))){__rows.push((await pyMethod(json,"loads",[line],{})));}}return __rows;})());
}
Object.defineProperty(events,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function assert_counted_as_nothing(client:any,result:any){
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyContains(result,"obligation");return pyBool(__left)?!pyContains(result,"obligation_ambiguous"):__left;})());return pyBool(__left)?!pyContains(result,"note"):__left;})())),"tests/kernel/test_obligation_fold.py:122 assert \"obligation\" not in result and \"obligation_ambiguous\" not in result and \"note\" not in result");
if(pyBool((await pyMethod(result,"get",["receipt"],{})))){assert.ok(pyBool(!pyContains((await pyInvoke(receipt,[client,pyAt(result,"receipt")],{})),"obligation")),"tests/kernel/test_obligation_fold.py:124 assert \"obligation\" not in receipt(client, result[\"receipt\"])");}
assert.ok(pyBool(!pyContains((await pyMethod((await pyInvoke(world,[client],{})),"get",["flags",({})],{})),FLAG)),"tests/kernel/test_obligation_fold.py:125 assert FLAG not in world(client).get(\"flags\", {})");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"open")),"tests/kernel/test_obligation_fold.py:126 assert rows(client)[ACCESS][\"state\"] == \"open\"");
}
Object.defineProperty(assert_counted_as_nothing,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"result","rest":false,"varargs":false}]});

export async function test_the_gate3_call_without_the_claim_is_the_attempt_and_a_pass_settles_it(morgue:any){
let client:any,result:any,roll:any,flagged:any,issued:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyInvoke(resolve,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"core-check:ordinary-check")),"tests/kernel/test_obligation_fold.py:135 assert result[\"decision\"] == \"core-check:ordinary-check\"");
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[pyAt(result,"outcome")],{})),ORDINARY_OUTCOME)),"tests/kernel/test_obligation_fold.py:137 assert set(result[\"outcome\"]) == ORDINARY_OUTCOME");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(result,"outcome"),"skill"),"Persuade");return pyBool(__left)?pyEqual(pyAt(pyAt(result,"outcome"),"difficulty"),"regular"):__left;})())),"tests/kernel/test_obligation_fold.py:138 assert result[\"outcome\"][\"skill\"] == \"Persuade\" and result[\"outcome\"][\"difficulty\"] == \"regular\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(result,"outcome"),"bonus"),1);return pyBool(__left)?(pyAt(pyAt(result,"outcome"),"passed")===true):__left;})())),"tests/kernel/test_obligation_fold.py:139 assert result[\"outcome\"][\"bonus\"] == 1 and result[\"outcome\"][\"passed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(result,"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:true}))),"tests/kernel/test_obligation_fold.py:140 assert result[\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": True}");
roll=(await pyInvoke(receipt,[client,pyAt(result,"receipt")],{}));
assert.ok(pyBool(pyEqual(pyAt(roll,"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:true}))),"tests/kernel/test_obligation_fold.py:142 assert roll[\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": True}");
assert.ok(pyBool(pyEqual(pyAt(roll,"modifier_reason"),pyAt(pyAt(GATE3,"modifiers"),"reason"))),"tests/kernel/test_obligation_fold.py:143 assert roll[\"modifier_reason\"] == GATE3[\"modifiers\"][\"reason\"]");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(world,[client],{})),"flags"),FLAG)===true)),"tests/kernel/test_obligation_fold.py:145 assert world(client)[\"flags\"][FLAG] is True");
flagged=(await (async()=>{const __rows:any[]=[];for(const event of pyIterable((await pyInvoke(events,[client],{})))){if(pyBool(pyEqual((await pyMethod(event,"get",["type"],{})),"flag-set"))){__rows.push(event);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[flagged],{})),1);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(flagged,0),"data"),"name"),FLAG):__left;})());return pyBool(__left)?pyEqual(pyAt(pyAt(flagged,0),"receipt"),pyAt(result,"receipt")):__left;})())),"tests/kernel/test_obligation_fold.py:147 assert len(flagged) == 1 and flagged[0][\"data\"][\"name\"] == FLAG and flagged[0][\"receipt\"] == result[\"receipt\"]");
issued=(await pyInvoke(rows,[client],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(issued,ACCESS),"state"),"settled");return pyBool(__left)?pyEqual(pyAt(pyAt(issued,ARCHIVIST),"state"),"open"):__left;})())),"tests/kernel/test_obligation_fold.py:149 assert issued[ACCESS][\"state\"] == \"settled\" and issued[ARCHIVIST][\"state\"] == \"open\"");
assert.ok(pyBool(pyEqual(pyAt(result,"note"),`This Persuade roll was the attempt at obligation ${ACCESS} (demand step 1) and settled it; do not roll it again.`)),"tests/kernel/test_obligation_fold.py:151 assert result[\"note\"] == f\"This Persuade roll was the attempt at obligation {ACCESS} (demand step 1) and settled it; do not roll it again.\"");
}
Object.defineProperty(test_the_gate3_call_without_the_claim_is_the_attempt_and_a_pass_settles_it,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_gate3_call_without_the_claim_is_the_attempt_and_a_pass_settles_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_gate3_call_without_the_claim_is_the_attempt_and_a_pass_settles_it(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_folded_failure_records_the_attempt_and_hands_the_book_price(morgue:any){
let client:any,before:any,result:any,after:any;
client=(await pyInvoke(morgue,[FAIL],{}));
before=(await pyInvoke(world,[client],{}));
result=(await pyInvoke(resolve,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"outcome"),"level"),"failure")),"tests/kernel/test_obligation_fold.py:158 assert result[\"outcome\"][\"level\"] == \"failure\"");
assert.ok(pyBool(pyEqual(pyAt(result,"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:false,["book"]:FAILURE_LINE,["push"]:PUSH_LINE}))),"tests/kernel/test_obligation_fold.py:159 assert result[\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": False,\n                                    \"book\": FAILURE_LINE, \"push\": PUSH_LINE}");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(receipt,[client,pyAt(result,"receipt")],{})),"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:false}))),"tests/kernel/test_obligation_fold.py:161 assert receipt(client, result[\"receipt\"])[\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": False}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(result,"note"),"did not settle it");return pyBool(__left)?pyContains(pyAt(result,"note"),"a push"):__left;})())),"tests/kernel/test_obligation_fold.py:162 assert \"did not settle it\" in result[\"note\"] and \"a push\" in result[\"note\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),[pyAt(result,"receipt")])),"tests/kernel/test_obligation_fold.py:164 assert result[\"receipts\"] == [result[\"receipt\"]]");
after=(await pyInvoke(world,[client],{}));
assert.ok(pyBool(!pyContains((await pyMethod(after,"get",["flags",({})],{})),FLAG)),"tests/kernel/test_obligation_fold.py:166 assert FLAG not in after.get(\"flags\", {})");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(after,"clock"),pyAt(before,"clock"));return pyBool(__left)?pyEqual(pyAt(after,"npc_presence"),pyAt(before,"npc_presence")):__left;})())),"tests/kernel/test_obligation_fold.py:167 assert after[\"clock\"] == before[\"clock\"] and after[\"npc_presence\"] == before[\"npc_presence\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"open")),"tests/kernel/test_obligation_fold.py:168 assert rows(client)[ACCESS][\"state\"] == \"open\"");
}
Object.defineProperty(test_a_folded_failure_records_the_attempt_and_hands_the_book_price,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_folded_failure_records_the_attempt_and_hands_the_book_price"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_folded_failure_records_the_attempt_and_hands_the_book_price(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_push_continues_the_fold(morgue:any){
let client:any,pushed:any;
client=(await pyInvoke(morgue,[PUSH],{}));
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(resolve,[client],{})),"obligation"),"settled")===false)),"tests/kernel/test_obligation_fold.py:173 assert resolve(client)[\"obligation\"][\"settled\"] is False");
pushed=(await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c4",["action"]:({["intent"]:"social",["push"]:true,["method"]:"lean on the old newsroom debt",["stakes"]:PUSH_LINE})})],{}));
assert.ok(pyBool(pyAt(pushed,"ok")),pyStr((await pyMethod(pushed,"get",["error"],{}))));
assert.ok(pyBool((pyAt(pyAt(pyAt(pushed,"result"),"outcome"),"passed")===true)),"tests/kernel/test_obligation_fold.py:177 assert pushed[\"result\"][\"outcome\"][\"passed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pushed,"result"),"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:true}))),"tests/kernel/test_obligation_fold.py:178 assert pushed[\"result\"][\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": True}");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(world,[client],{})),"flags"),FLAG)===true)),"tests/kernel/test_obligation_fold.py:179 assert world(client)[\"flags\"][FLAG] is True");
}
Object.defineProperty(test_a_push_continues_the_fold,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_push_continues_the_fold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_push_continues_the_fold(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_the_book_difficulty_replaces_the_keepers_and_nothing_is_refused(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyInvoke(resolve,[client],{"modifiers":({...pyAt(GATE3,"modifiers"),["difficulty"]:"hard"})}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"outcome"),"difficulty"),"regular")),"tests/kernel/test_obligation_fold.py:185 assert result[\"outcome\"][\"difficulty\"] == \"regular\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"obligation"),"counted"),"folded")),"tests/kernel/test_obligation_fold.py:186 assert result[\"obligation\"][\"counted\"] == \"folded\"");
}
Object.defineProperty(test_the_book_difficulty_replaces_the_keepers_and_nothing_is_refused,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_book_difficulty_replaces_the_keepers_and_nothing_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_book_difficulty_replaces_the_keepers_and_nothing_is_refused(await acquireFixture(t,()=>morgue(temporary)));});

export async function test_the_explicit_claim_is_unchanged(morgue:any){
let client:any,result:any,refused:any;
client=(await pyInvoke(morgue,[FAIL],{}));
result=(await pyInvoke(resolve,[client],{"obligation":ACCESS}));
assert.ok(pyBool(pyEqual(pyAt(result,"obligation"),({["handle"]:ACCESS,["settled"]:false,["book"]:FAILURE_LINE,["push"]:PUSH_LINE}))),"tests/kernel/test_obligation_fold.py:195 assert result[\"obligation\"] == {\"handle\": ACCESS, \"settled\": False, \"book\": FAILURE_LINE, \"push\": PUSH_LINE}");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(receipt,[client,pyAt(result,"receipt")],{})),"obligation"),({["handle"]:ACCESS,["settled"]:false}))),"tests/kernel/test_obligation_fold.py:196 assert receipt(client, result[\"receipt\"])[\"obligation\"] == {\"handle\": ACCESS, \"settled\": False}");
assert.ok(pyBool(!pyContains(result,"note")),"tests/kernel/test_obligation_fold.py:197 assert \"note\" not in result");
refused=(await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c4",["action"]:({...GATE3,["obligation"]:ACCESS,["modifiers"]:({...pyAt(GATE3,"modifiers"),["difficulty"]:"hard"})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=!pyBool(pyAt(refused,"ok"));return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(refused,"error"),"details"),"reason"),"obligation_difficulty"):__left;})())),"tests/kernel/test_obligation_fold.py:201 assert not refused[\"ok\"] and refused[\"error\"][\"details\"][\"reason\"] == \"obligation_difficulty\"");
}
Object.defineProperty(test_the_explicit_claim_is_unchanged,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_explicit_claim_is_unchanged"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_explicit_claim_is_unchanged(await acquireFixture(t,()=>morgue(temporary)));});

export async function test_no_target_no_fold_even_when_the_words_name_the_person(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyInvoke(resolve,[client],{"drop":["target"],"method":"ask Arty Wilmot, the city editor, to open the clippings room","goal":"get Arty Wilmot to let me into the clippings"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"decision"),"core-check:ordinary-check");return pyBool(__left)?(pyAt(pyAt(result,"outcome"),"passed")===true):__left;})())),"tests/kernel/test_obligation_fold.py:211 assert result[\"decision\"] == \"core-check:ordinary-check\" and result[\"outcome\"][\"passed\"] is True");
(await pyInvoke(assert_counted_as_nothing,[client,result],{}));
}
Object.defineProperty(test_no_target_no_fold_even_when_the_words_name_the_person,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_target_no_fold_even_when_the_words_name_the_person"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_target_no_fold_even_when_the_words_name_the_person(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_no_skill_no_fold(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyInvoke(resolve,[client],{"drop":["skill"],"decision":"core-check:ordinary-check","method":"persuade him with the landlord's letter"}));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"core-check:ordinary-check")),"tests/kernel/test_obligation_fold.py:218 assert result[\"decision\"] == \"core-check:ordinary-check\"");
(await pyInvoke(assert_counted_as_nothing,[client,result],{}));
}
Object.defineProperty(test_no_skill_no_fold,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_skill_no_fold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_skill_no_fold(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_skill_outside_the_approaches_is_no_fold(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyInvoke(resolve,[client],{"skill":"Credit Rating","decision":"core-check:ordinary-check"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"decision"),"core-check:ordinary-check");return pyBool(__left)?pyEqual(pyAt(pyAt(result,"outcome"),"skill"),"Credit Rating"):__left;})())),"tests/kernel/test_obligation_fold.py:225 assert result[\"decision\"] == \"core-check:ordinary-check\" and result[\"outcome\"][\"skill\"] == \"Credit Rating\"");
(await pyInvoke(assert_counted_as_nothing,[client,result],{}));
}
Object.defineProperty(test_a_skill_outside_the_approaches_is_no_fold,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_skill_outside_the_approaches_is_no_fold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_skill_outside_the_approaches_is_no_fold(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_the_social_adjudication_named_is_no_fold(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyInvoke(resolve,[client],{"decision":"social:adjudicate-difficulty"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"decision"),"social:adjudicate-difficulty");return pyBool(__left)?pyEqual(pyAt(pyAt(result,"outcome"),"kind"),"social"):__left;})())),"tests/kernel/test_obligation_fold.py:232 assert result[\"decision\"] == \"social:adjudicate-difficulty\" and result[\"outcome\"][\"kind\"] == \"social\"");
(await pyInvoke(assert_counted_as_nothing,[client,result],{}));
}
Object.defineProperty(test_the_social_adjudication_named_is_no_fold,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_social_adjudication_named_is_no_fold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_social_adjudication_named_is_no_fold(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_before_arty_is_met_the_obligation_is_not_at_its_check(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{"meet":false}));
result=(await pyInvoke(resolve,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"social:adjudicate-difficulty")),"tests/kernel/test_obligation_fold.py:239 assert result[\"decision\"] == \"social:adjudicate-difficulty\"");
(await pyInvoke(assert_counted_as_nothing,[client,result],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"next"),({["kind"]:"meet",["person"]:"Arty Wilmot"}))),"tests/kernel/test_obligation_fold.py:241 assert rows(client)[ACCESS][\"next\"] == {\"kind\": \"meet\", \"person\": \"Arty Wilmot\"}");
}
Object.defineProperty(test_before_arty_is_met_the_obligation_is_not_at_its_check,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_before_arty_is_met_the_obligation_is_not_at_its_check"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_before_arty_is_met_the_obligation_is_not_at_its_check(await acquireFixture(t,()=>morgue(temporary)));});

export async function test_a_check_that_fits_two_open_obligations_folds_into_none(morgue:any,tmp_path:any){
let client:any,issued:any,adjudicated:any,result:any,flags:any,claimed:any;
client=(await pyInvoke(morgue,[AMBIGUOUS_PASS],{"content":(await pyInvoke(second_obligation,[pyDivide(tmp_path,"content")],{}))}));
issued=(await pyInvoke(rows,[client],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(issued,ACCESS),"state"),"open");return pyBool(__left)?pyEqual(pyAt(pyAt(issued,SECOND),"state"),"open"):__left;})())),"tests/kernel/test_obligation_fold.py:250 assert issued[ACCESS][\"state\"] == \"open\" and issued[SECOND][\"state\"] == \"open\"");
adjudicated=(await pyInvoke(resolve,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(adjudicated,"decision"),"social:adjudicate-difficulty")),"tests/kernel/test_obligation_fold.py:253 assert adjudicated[\"decision\"] == \"social:adjudicate-difficulty\"");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(adjudicated,"obligation");return pyBool(__left)?!pyContains(adjudicated,"obligation_ambiguous"):__left;})())),"tests/kernel/test_obligation_fold.py:254 assert \"obligation\" not in adjudicated and \"obligation_ambiguous\" not in adjudicated");
result=(await pyInvoke(resolve,[client,"t1-c4"],{"decision":"core-check:ordinary-check"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"decision"),"core-check:ordinary-check");return pyBool(__left)?(pyAt(pyAt(result,"outcome"),"passed")===true):__left;})())),"tests/kernel/test_obligation_fold.py:257 assert result[\"decision\"] == \"core-check:ordinary-check\" and result[\"outcome\"][\"passed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(result,"obligation_ambiguous"),[ACCESS,SECOND])),"tests/kernel/test_obligation_fold.py:258 assert result[\"obligation_ambiguous\"] == [ACCESS, SECOND]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(result,"obligation");return pyBool(__left)?!pyContains((await pyInvoke(receipt,[client,pyAt(result,"receipt")],{})),"obligation"):__left;})())),"tests/kernel/test_obligation_fold.py:259 assert \"obligation\" not in result and \"obligation\" not in receipt(client, result[\"receipt\"])");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyContains(pyAt(result,"note"),ACCESS);return pyBool(__left)?pyContains(pyAt(result,"note"),SECOND):__left;})());return pyBool(__left)?pyContains(pyAt(result,"note"),"action.obligation"):__left;})())),"tests/kernel/test_obligation_fold.py:260 assert ACCESS in result[\"note\"] and SECOND in result[\"note\"] and \"action.obligation\" in result[\"note\"]");
flags=(await pyMethod((await pyInvoke(world,[client],{})),"get",["flags",({})],{}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(flags,FLAG);return pyBool(__left)?!pyContains(flags,SECOND_FLAG):__left;})())),"tests/kernel/test_obligation_fold.py:262 assert FLAG not in flags and SECOND_FLAG not in flags");
issued=(await pyInvoke(rows,[client],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(issued,ACCESS),"state"),"open");return pyBool(__left)?pyEqual(pyAt(pyAt(issued,SECOND),"state"),"open"):__left;})())),"tests/kernel/test_obligation_fold.py:264 assert issued[ACCESS][\"state\"] == \"open\" and issued[SECOND][\"state\"] == \"open\"");
claimed=(await pyInvoke(resolve,[client,"t1-c5"],{"obligation":SECOND,"skill":"Charm"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(claimed,"obligation"),"handle"),SECOND)),"tests/kernel/test_obligation_fold.py:267 assert claimed[\"obligation\"][\"handle\"] == SECOND");
}
Object.defineProperty(test_a_check_that_fits_two_open_obligations_folds_into_none,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_check_that_fits_two_open_obligations_folds_into_none"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_check_that_fits_two_open_obligations_folds_into_none(await acquireFixture(t,()=>morgue(temporary)),temporary);});
