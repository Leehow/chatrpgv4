// Migrated from tests/kernel/test_scene_obligations.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,RpcClient,campaign_dir,read_json,written,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_scene_obligations.py',import.meta.url).pathname;






export let MORGUE:any="newspaper-morgue";
const __unpack730=["globe-clippings-access","globe-archivist"];export let ACCESS:any=__unpack730[0];export let ARCHIVIST:any=__unpack730[1];
export let FLAG:any="newspaper-morgue-clippings-access";
export let GUARDED:any=new Set(["globe-unpublished-story","macario-tragedy"]);
export let APPROACHES:any=["Persuade","Intimidate","Charm","Fast Talk"];
export let FAILURE_LINE:any=("Arty refuses access to the clipping room; the investigator may try another route or propose a "+"changed method for a pushed attempt.");
export let PUSH_LINE:any="Arty has the investigator ejected and permanently bars them from the newspaper clipping room.";

export let PASS:any=4;

export let FAIL:any=1;

export let PUSH:any=1;


export let LEDGER_PASS:any=4;
export async function kernel_with(tmp_path:any,seed:any){
return (new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:(await pyInvoke(pyStr,[seed],{}))})})));
}
Object.defineProperty(kernel_with,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"seed","rest":false,"varargs":false}]});
export async function* morgue(tmp_path:any){
let clients:any,client:any;
clients=[];
async function open_at(seed:any){
let client:any;
client=(await pyInvoke(kernel_with,[pyDivide(tmp_path,`s${seed}-${(await pyInvoke(pyLen,[clients],{}))}`),seed],{}));
(await pyMethod(clients,"append",[client],{}));
(await pyInvoke(at_morgue,[client],{}));
return client;
}
Object.defineProperty(open_at,"__pySignature",{value:[{"name":"seed","rest":false,"varargs":false}]});
yield open_at;
for(client of pyIterable(clients)){
(await pyMethod(client,"close",[],{}));
}
}
Object.defineProperty(morgue,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
export async function at_morgue(client:any){
(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t0-c1","text":"The opening."}));
(await pyMethod(client,"table",["player_input"],{"text":"I go to the Globe and ask for the old clippings on the Corbitt House."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:MORGUE})]}));
}
Object.defineProperty(at_morgue,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function meet_arty(client:any,call_id:any="t1-c2"){
return (await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"person",["who"]:"Arty Wilmot",["name"]:"Arty"})]}));
}
Object.defineProperty(meet_arty,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false}]});
export async function persuade(client:any,call_id:any="t1-c3",claim:any=true,action:any={}){
let body:any;
body=({["intent"]:"social",["skill"]:"Persuade",["goal"]:"get into the clippings room",["method"]:"remind him the Globe owes an old colleague a favour",...action});
if(pyBool(claim)){(await pyMethod(body,"setdefault",["obligation",ACCESS],{}));}else{(await pyMethod(body,"setdefault",["target","Arty Wilmot"],{}));
(await pyMethod(body,"setdefault",["decision","core-check:ordinary-check"],{}));}
return (await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:call_id,["action"]:body})],{}));
}
Object.defineProperty(persuade,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"claim","rest":false,"varargs":false},{"name":"action","rest":true,"varargs":false}]});
export async function options(client:any){
return (await pyMethod(client,"ok",["table.apply.options",({["campaign"]:CAMPAIGN})],{}));
}
Object.defineProperty(options,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function rows(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyInvoke(options,[client],{})),"obligations"))){__rows.push([pyAt(row,"handle"),row]);}return __rows;})()));
}
Object.defineProperty(rows,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function scene_rows(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(client,"table",["capsule"],{})),"obligations"))){if(pyBool(pyEqual(pyAt(row,"kind"),"scene"))){__rows.push([pyAt(row,"name"),row]);}}return __rows;})()));
}
Object.defineProperty(scene_rows,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function world(client:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"world.json")],{}));
}
Object.defineProperty(world,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function turn_receipts(client:any){
return pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turn.json")],{})),"receipts");
}
Object.defineProperty(turn_receipts,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function clue_candidates(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyInvoke(options,[client],{})),"candidates"))){if(pyBool(pyEqual(pyAt(pyAt(row,"effect"),"kind"),"clue"))){__rows.push([pyAt(pyAt(row,"effect"),"clue"),row]);}}return __rows;})()));
}
Object.defineProperty(clue_candidates,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function assert_capsule_agrees(client:any){
let issued:any,capsule:any,handle:any,row:any;

const __unpack4258=[(await pyInvoke(rows,[client],{})),(await pyInvoke(scene_rows,[client],{}))];issued=__unpack4258[0];capsule=__unpack4258[1];
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[capsule],{})),(await pyInvoke(pyList,[issued],{})))),"tests/kernel/test_scene_obligations.py:102 assert list(capsule) == list(issued)");
for([handle,row] of pyIterable((await pyMethod(issued,"items",[],{})))){
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,handle),"state"),pyAt(row,"state"))),"tests/kernel/test_scene_obligations.py:104 assert capsule[handle][\"state\"] == row[\"state\"]");
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(capsule,handle),"get",["who"],{})),(await pyMethod(row,"get",["who"],{})))),"tests/kernel/test_scene_obligations.py:105 assert capsule[handle].get(\"who\") == row.get(\"who\")");
}
}
Object.defineProperty(assert_capsule_agrees,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function refusal(result:any){
assert.ok(pyBool(!pyBool(pyAt(result,"ok"))),pyStr((await pyMethod(result,"get",["result"],{}))));
return [pyAt(pyAt(result,"error"),"code"),pyAt(pyAt(pyAt(result,"error"),"details"),"reason")];
}
Object.defineProperty(refusal,"__pySignature",{value:[{"name":"result","rest":false,"varargs":false}]});

export async function test_the_morgue_issues_the_gate_open_and_the_archivist_blocked(morgue:any){
let client:any,issued:any,access:any,archivist:any,clues:any,name:any,capsule:any;
client=(await pyInvoke(morgue,[PASS],{}));
issued=(await pyInvoke(rows,[client],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[issued],{})),[ACCESS,ARCHIVIST])),"tests/kernel/test_scene_obligations.py:119 assert list(issued) == [ACCESS, ARCHIVIST]");
const __unpack4960=[pyAt(issued,ACCESS),pyAt(issued,ARCHIVIST)];access=__unpack4960[0];archivist=__unpack4960[1];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(access,"state"),"open");return pyBool(__left)?pyEqual(pyAt(access,"next"),({["kind"]:"meet",["person"]:"Arty Wilmot"})):__left})())),"tests/kernel/test_scene_obligations.py:121 assert access[\"state\"] == \"open\" and access[\"next\"] == {\"kind\": \"meet\", \"person\": \"Arty Wilmot\"}");
assert.ok(pyBool(pyEqual(pyAt(access,"then"),({["kind"]:"check",["target"]:"Arty Wilmot",["selection"]:"approach",["approaches"]:(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(APPROACHES)){__rows.push(({["skill"]:name}));}return __rows;})()),["difficulty"]:"regular"}))),"tests/kernel/test_scene_obligations.py:123 assert access[\"then\"] == {\"kind\": \"check\", \"target\": \"Arty Wilmot\", \"selection\": \"approach\",\n                              \"approaches\": [{\"skill\": name} for name in APPROACHES], \"difficulty\": \"regular\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(access,"who"),"Arty Wilmot");return pyBool(__left)?pyEqual(pyAt(access,"trigger"),({["kind"]:"attempt",["guards"]:({["clues"]:["globe-unpublished-story","macario-tragedy"]})})):__left})())),"tests/kernel/test_scene_obligations.py:125 assert access[\"who\"] == \"Arty Wilmot\" and access[\"trigger\"] == {\"kind\": \"attempt\", \"guards\": {\"clues\": [\"globe-unpublished-story\", \"macario-tragedy\"]}}");
assert.ok(pyBool(pyEqual(pyAt(access,"book"),({["failure"]:FAILURE_LINE,["fumble"]:pyAt(pyAt(access,"book"),"fumble"),["push"]:PUSH_LINE}))),"tests/kernel/test_scene_obligations.py:126 assert access[\"book\"] == {\"failure\": FAILURE_LINE, \"fumble\": access[\"book\"][\"fumble\"], \"push\": PUSH_LINE}");
assert.ok(pyBool(pyEqual(pyAt(access,"source"),[({["page"]:448,["anchor"]:"Arty Wilmot"})])),"tests/kernel/test_scene_obligations.py:127 assert access[\"source\"] == [{\"page\": 448, \"anchor\": \"Arty Wilmot\"}]");
assert.ok(pyBool(pyEqual(pyAt(access,"reaction"),"preordained")),"tests/kernel/test_scene_obligations.py:129 assert access[\"reaction\"] == \"preordained\"");
assert.ok(pyBool(pyEqual(pyAt(access,"mod_contact"),[({["mod"]:"natural-npc",["check"]:"natural-npc:first-impression",["clerk"]:false})])),"tests/kernel/test_scene_obligations.py:130 assert access[\"mod_contact\"] == [{\"mod\": \"natural-npc\", \"check\": \"natural-npc:first-impression\", \"clerk\": False}]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(archivist,"state"),"blocked");return pyBool(__left)?!pyContains(archivist,"next"):__left})())),"tests/kernel/test_scene_obligations.py:131 assert archivist[\"state\"] == \"blocked\" and \"next\" not in archivist");
assert.ok(pyBool(pyEqual(pyAt(archivist,"trigger"),({["kind"]:"after",["after"]:ACCESS}))),"tests/kernel/test_scene_obligations.py:132 assert archivist[\"trigger\"] == {\"kind\": \"after\", \"after\": ACCESS}");
clues=(await pyInvoke(clue_candidates,[client],{}));
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const [name,row] of pyIterable((await pyMethod(clues,"items",[],{})))){if(pyBool(pyEqual((await pyMethod(row,"get",["guarded_by"],{})),ACCESS))){__rows.push(name);}}return __rows;})())),GUARDED)),"tests/kernel/test_scene_obligations.py:135 assert {name for name, row in clues.items() if row.get(\"guarded_by\") == ACCESS} == GUARDED");
assert.ok(pyBool(!pyContains(pyAt(clues,"globe-fire-cutoff"),"guarded_by")),"tests/kernel/test_scene_obligations.py:136 assert \"guarded_by\" not in clues[\"globe-fire-cutoff\"]");
for(name of pyIterable(GUARDED)){
assert.ok(pyBool((await pyMethod(pyAt(pyAt(pyAt(clues,name),"description"),"gate"),"endswith",[`; guarded by obligation ${ACCESS}`],{}))),"tests/kernel/test_scene_obligations.py:138 assert clues[name][\"description\"][\"gate\"].endswith(f\"; guarded by obligation {ACCESS}\")");
}
capsule=(await pyMethod(client,"table",["capsule"],{}));
assert.ok(pyBool((await pyMethod(pyAt(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(capsule,"known"),"clues_here"))){__rows.push([pyAt(row,"name"),pyAt(row,"gate")]);}return __rows;})())),"macario-tragedy"),"endswith",[`guarded by obligation ${ACCESS}`],{}))),"tests/kernel/test_scene_obligations.py:140 assert {row[\"name\"]: row[\"gate\"] for row in capsule[\"known\"][\"clues_here\"]}[\"macario-tragedy\"].endswith(f\"guarded by obligation {ACCESS}\")");
assert.ok(pyBool(!pyContains(pyAt(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(capsule,"known"),"clues_here"))){__rows.push([pyAt(row,"name"),pyAt(row,"gate")]);}return __rows;})())),"globe-fire-cutoff"),"obligation")),"tests/kernel/test_scene_obligations.py:141 assert \"obligation\" not in {row[\"name\"]: row[\"gate\"] for row in capsule[\"known\"][\"clues_here\"]}[\"globe-fire-cutoff\"]");
(await pyInvoke(assert_capsule_agrees,[client],{}));
assert.ok(pyBool((await pyMethod(pyAt(pyAt((await pyInvoke(scene_rows,[client],{})),ACCESS),"cue"),"startswith",["next: meet Arty Wilmot"],{}))),"tests/kernel/test_scene_obligations.py:143 assert scene_rows(client)[ACCESS][\"cue\"].startswith(\"next: meet Arty Wilmot\")");
}
Object.defineProperty(test_the_morgue_issues_the_gate_open_and_the_archivist_blocked,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_morgue_issues_the_gate_open_and_the_archivist_blocked"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_morgue_issues_the_gate_open_and_the_archivist_blocked(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_meeting_arty_makes_the_check_the_next_step(morgue:any){
let client:any,access:any;
client=(await pyInvoke(morgue,[PASS],{}));
(await pyInvoke(meet_arty,[client],{}));
access=pyAt((await pyInvoke(rows,[client],{})),ACCESS);
assert.ok(pyBool(pyEqual(pyAt(access,"state"),"open")),"tests/kernel/test_scene_obligations.py:150 assert access[\"state\"] == \"open\"");
assert.ok(pyBool(pyEqual(pyAt(access,"next"),({["kind"]:"check",["target"]:"Arty Wilmot",["selection"]:"approach",["approaches"]:(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(APPROACHES)){__rows.push(({["skill"]:name}));}return __rows;})()),["difficulty"]:"regular"}))),"tests/kernel/test_scene_obligations.py:151 assert access[\"next\"] == {\"kind\": \"check\", \"target\": \"Arty Wilmot\", \"selection\": \"approach\",\n                              \"approaches\": [{\"skill\": name} for name in APPROACHES], \"difficulty\": \"regular\"}");
assert.ok(pyBool(!pyContains(access,"then")),pyStr("a check that is itself next leads nowhere further"));
assert.ok(pyBool(pyContains(pyAt(pyAt((await pyInvoke(scene_rows,[client],{})),ACCESS),"cue"),"resolve with action.obligation")),"tests/kernel/test_scene_obligations.py:154 assert \"resolve with action.obligation\" in scene_rows(client)[ACCESS][\"cue\"]");
(await pyInvoke(assert_capsule_agrees,[client],{}));
}
Object.defineProperty(test_meeting_arty_makes_the_check_the_next_step,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_meeting_arty_makes_the_check_the_next_step"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_meeting_arty_makes_the_check_the_next_step(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_scene_without_obligations_reads_as_before(tmp_path:any){
let client:any;
client=(await pyInvoke(kernel_with,[tmp_path,PASS],{}));
try{(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t0-c1","text":"The opening."}));
(await pyMethod(client,"table",["player_input"],{"text":"I walk over to the Central Library."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"central-library"})]}));
assert.ok(pyBool(!pyContains((await pyInvoke(options,[client],{})),"obligations")),"tests/kernel/test_scene_obligations.py:166 assert \"obligations\" not in options(client)");
assert.ok(pyBool(!pyBool((await pyInvoke(scene_rows,[client],{})))),"tests/kernel/test_scene_obligations.py:167 assert not scene_rows(client)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyInvoke(options,[client],{})),"candidates"))){__rows.push(!pyContains(row,"guarded_by"));}return __rows;})())))),"tests/kernel/test_scene_obligations.py:168 assert all(\"guarded_by\" not in row for row in options(client)[\"candidates\"])");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_scene_without_obligations_reads_as_before,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_scene_without_obligations_reads_as_before"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_scene_without_obligations_reads_as_before(temporary);});

export async function test_a_claimed_pass_sets_the_flag_in_the_same_call(morgue:any){
let client:any,result:any,settled:any,roll:any,events:any,flagged:any,issued:any,clues:any;
client=(await pyInvoke(morgue,[PASS],{}));
(await pyInvoke(meet_arty,[client],{}));
result=(await pyInvoke(persuade,[client],{}));
assert.ok(pyBool(pyAt(result,"ok")),pyStr((await pyMethod(result,"get",["error"],{}))));
settled=pyAt(result,"result");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(settled,"outcome"),"passed")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(settled,"outcome"),"skill"),"Persuade"):__left})())),"tests/kernel/test_scene_obligations.py:182 assert settled[\"outcome\"][\"passed\"] is True and settled[\"outcome\"][\"skill\"] == \"Persuade\"");
assert.ok(pyBool(pyEqual(pyAt(settled,"obligation"),({["handle"]:ACCESS,["settled"]:true}))),"tests/kernel/test_scene_obligations.py:183 assert settled[\"obligation\"] == {\"handle\": ACCESS, \"settled\": True}");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(world,[client],{})),"flags"),FLAG)===true)),"tests/kernel/test_scene_obligations.py:185 assert world(client)[\"flags\"][FLAG] is True");
roll=(await pyNext((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable((await pyInvoke(turn_receipts,[client],{})))){if(pyBool(pyEqual(pyAt(receipt,"id"),pyAt(settled,"receipt")))){__rows.push(receipt);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(roll,"obligation"),({["handle"]:ACCESS,["settled"]:true}));return pyBool(__left)?pyEqual(pyAt(roll,"difficulty"),"regular"):__left})())),"tests/kernel/test_scene_obligations.py:187 assert roll[\"obligation\"] == {\"handle\": ACCESS, \"settled\": True} and roll[\"difficulty\"] == \"regular\"");
events=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await pyMethod((await pyMethod((pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"events.jsonl")),"read_text",[],{})),"splitlines",[],{})))){if(pyBool((await pyMethod(line,"strip",[],{})))){__rows.push((await pyMethod(json,"loads",[line],{})));}}return __rows;})());
flagged=(await (async()=>{const __rows:any[]=[];for(const event of pyIterable(events)){if(pyBool(pyEqual((await pyMethod(event,"get",["type"],{})),"flag-set"))){__rows.push(event);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[flagged],{})),1);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(flagged,0),"data"),"name"),FLAG):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(flagged,0),"receipt"),pyAt(settled,"receipt")):__left})())),"tests/kernel/test_scene_obligations.py:190 assert len(flagged) == 1 and flagged[0][\"data\"][\"name\"] == FLAG and flagged[0][\"receipt\"] == settled[\"receipt\"]");
issued=(await pyInvoke(rows,[client],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(issued,ACCESS),"state"),"settled");return pyBool(__left)?!pyContains(pyAt(issued,ACCESS),"next"):__left})())),"tests/kernel/test_scene_obligations.py:193 assert issued[ACCESS][\"state\"] == \"settled\" and \"next\" not in issued[ACCESS]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(issued,ARCHIVIST),"state"),"open");return pyBool(__left)?pyEqual(pyAt(pyAt(issued,ARCHIVIST),"next"),({["kind"]:"meet",["person"]:"Ruth Blake"})):__left})())),"tests/kernel/test_scene_obligations.py:194 assert issued[ARCHIVIST][\"state\"] == \"open\" and issued[ARCHIVIST][\"next\"] == {\"kind\": \"meet\", \"person\": \"Ruth Blake\"}");
clues=(await pyInvoke(clue_candidates,[client],{}));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod(clues,"values",[],{})))){__rows.push((await (async()=>{const __left=!pyContains(row,"guarded_by");return pyBool(__left)?!pyContains(pyAt(pyAt(row,"description"),"gate"),"obligation"):__left})()));}return __rows;})())))),"tests/kernel/test_scene_obligations.py:196 assert all(\"guarded_by\" not in row and \"obligation\" not in row[\"description\"][\"gate\"] for row in clues.values())");
(await pyInvoke(assert_capsule_agrees,[client],{}));
}
Object.defineProperty(test_a_claimed_pass_sets_the_flag_in_the_same_call,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_claimed_pass_sets_the_flag_in_the_same_call"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_claimed_pass_sets_the_flag_in_the_same_call(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_claimed_failure_leaves_it_open_with_the_book_line_and_no_consequence(morgue:any){
let client:any,before:any,result:any,failed:any,after:any;
client=(await pyInvoke(morgue,[FAIL],{}));
(await pyInvoke(meet_arty,[client],{}));
before=(await pyInvoke(world,[client],{}));
result=(await pyInvoke(persuade,[client],{}));
assert.ok(pyBool(pyAt(result,"ok")),pyStr((await pyMethod(result,"get",["error"],{}))));
failed=pyAt(result,"result");
assert.ok(pyBool(pyEqual(pyAt(pyAt(failed,"outcome"),"level"),"failure")),"tests/kernel/test_scene_obligations.py:207 assert failed[\"outcome\"][\"level\"] == \"failure\"");
assert.ok(pyBool(pyEqual(pyAt(failed,"obligation"),({["handle"]:ACCESS,["settled"]:false,["book"]:FAILURE_LINE,["push"]:PUSH_LINE}))),"tests/kernel/test_scene_obligations.py:208 assert failed[\"obligation\"] == {\"handle\": ACCESS, \"settled\": False, \"book\": FAILURE_LINE, \"push\": PUSH_LINE}");
assert.ok(pyBool(pyEqual(pyAt(failed,"receipts"),[pyAt(failed,"receipt")])),"tests/kernel/test_scene_obligations.py:210 assert failed[\"receipts\"] == [failed[\"receipt\"]]");
after=(await pyInvoke(world,[client],{}));
assert.ok(pyBool(!pyContains((await pyMethod(after,"get",["flags",({})],{})),FLAG)),"tests/kernel/test_scene_obligations.py:212 assert FLAG not in after.get(\"flags\", {})");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(after,"clock"),pyAt(before,"clock"));return pyBool(__left)?pyEqual(pyAt(after,"npc_presence"),pyAt(before,"npc_presence")):__left})())),"tests/kernel/test_scene_obligations.py:213 assert after[\"clock\"] == before[\"clock\"] and after[\"npc_presence\"] == before[\"npc_presence\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"open")),"tests/kernel/test_scene_obligations.py:214 assert rows(client)[ACCESS][\"state\"] == \"open\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(clue_candidates,[client],{})),"macario-tragedy"),"guarded_by"),ACCESS)),"tests/kernel/test_scene_obligations.py:215 assert clue_candidates(client)[\"macario-tragedy\"][\"guarded_by\"] == ACCESS");
}
Object.defineProperty(test_a_claimed_failure_leaves_it_open_with_the_book_line_and_no_consequence,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_claimed_failure_leaves_it_open_with_the_book_line_and_no_consequence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_claimed_failure_leaves_it_open_with_the_book_line_and_no_consequence(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_push_continues_the_claim_it_pushes(morgue:any){
let client:any,pushed:any;
client=(await pyInvoke(morgue,[PUSH],{}));
(await pyInvoke(meet_arty,[client],{}));
assert.ok(pyBool((pyAt(pyAt(pyAt((await pyInvoke(persuade,[client],{})),"result"),"obligation"),"settled")===false)),"tests/kernel/test_scene_obligations.py:221 assert persuade(client)[\"result\"][\"obligation\"][\"settled\"] is False");
pushed=(await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c4",["action"]:({["intent"]:"social",["push"]:true,["method"]:"lean on the old newsroom debt",["stakes"]:PUSH_LINE})})],{}));
assert.ok(pyBool(pyAt(pushed,"ok")),pyStr((await pyMethod(pushed,"get",["error"],{}))));
assert.ok(pyBool((pyAt(pyAt(pyAt(pushed,"result"),"outcome"),"passed")===true)),"tests/kernel/test_scene_obligations.py:225 assert pushed[\"result\"][\"outcome\"][\"passed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pushed,"result"),"obligation"),({["handle"]:ACCESS,["settled"]:true}))),"tests/kernel/test_scene_obligations.py:226 assert pushed[\"result\"][\"obligation\"] == {\"handle\": ACCESS, \"settled\": True}");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(world,[client],{})),"flags"),FLAG)===true)),"tests/kernel/test_scene_obligations.py:227 assert world(client)[\"flags\"][FLAG] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"settled")),"tests/kernel/test_scene_obligations.py:228 assert rows(client)[ACCESS][\"state\"] == \"settled\"");
}
Object.defineProperty(test_a_push_continues_the_claim_it_pushes,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_push_continues_the_claim_it_pushes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_push_continues_the_claim_it_pushes(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_the_same_skill_without_the_claim_is_the_folded_attempt(morgue:any){
let client:any,result:any;
client=(await pyInvoke(morgue,[PASS],{}));
(await pyInvoke(meet_arty,[client],{}));
result=(await pyInvoke(persuade,[client],{"claim":false}));
assert.ok(pyBool(pyAt(result,"ok")),pyStr((await pyMethod(result,"get",["error"],{}))));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(pyAt(result,"result"),"outcome"),"passed")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(result,"result"),"outcome"),"skill"),"Persuade"):__left})())),"tests/kernel/test_scene_obligations.py:238 assert result[\"result\"][\"outcome\"][\"passed\"] is True and result[\"result\"][\"outcome\"][\"skill\"] == \"Persuade\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"result"),"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:true}))),"tests/kernel/test_scene_obligations.py:239 assert result[\"result\"][\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": True}");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(world,[client],{})),"flags"),FLAG)===true)),"tests/kernel/test_scene_obligations.py:240 assert world(client)[\"flags\"][FLAG] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"settled")),"tests/kernel/test_scene_obligations.py:241 assert rows(client)[ACCESS][\"state\"] == \"settled\"");
}
Object.defineProperty(test_the_same_skill_without_the_claim_is_the_folded_attempt,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_same_skill_without_the_claim_is_the_folded_attempt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_same_skill_without_the_claim_is_the_folded_attempt(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_apply_flag_waives_and_reopens_with_ordinary_receipts(morgue:any){
let client:any,waived:any,receipt:any,reopened:any;
client=(await pyInvoke(morgue,[PASS],{}));
waived=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"flag",["name"]:FLAG,["value"]:true,["why"]:"Arty owes the investigator"})]}));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(turn_receipts,[client],{})))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(pyAt(waived,"receipts"),0)))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"kind"),"flag");return pyBool(__left)?pyEqual(pyAt(receipt,"name"),FLAG):__left})());return pyBool(__left)?(pyAt(receipt,"value")===true):__left})())),"tests/kernel/test_scene_obligations.py:248 assert receipt[\"kind\"] == \"flag\" and receipt[\"name\"] == FLAG and receipt[\"value\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"waived");return pyBool(__left)?pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ARCHIVIST),"state"),"open"):__left})())),"tests/kernel/test_scene_obligations.py:249 assert rows(client)[ACCESS][\"state\"] == \"waived\" and rows(client)[ARCHIVIST][\"state\"] == \"open\"");
(await pyInvoke(assert_capsule_agrees,[client],{}));
reopened=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"flag",["name"]:FLAG,["value"]:false})]}));
assert.ok(pyBool((pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(turn_receipts,[client],{})))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(pyAt(reopened,"receipts"),0)))){__rows.push(r);}}return __rows;})()))),"value")===false)),"tests/kernel/test_scene_obligations.py:252 assert next(r for r in turn_receipts(client) if r[\"id\"] == reopened[\"receipts\"][0])[\"value\"] is False");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"open");return pyBool(__left)?pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ARCHIVIST),"state"),"blocked"):__left})())),"tests/kernel/test_scene_obligations.py:253 assert rows(client)[ACCESS][\"state\"] == \"open\" and rows(client)[ARCHIVIST][\"state\"] == \"blocked\"");
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"flag",["name"]:FLAG,["value"]:true})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),ACCESS),"state"),"settled")),"tests/kernel/test_scene_obligations.py:255 assert rows(client)[ACCESS][\"state\"] == \"settled\"");
}
Object.defineProperty(test_apply_flag_waives_and_reopens_with_ordinary_receipts,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_flag_waives_and_reopens_with_ordinary_receipts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_flag_waives_and_reopens_with_ordinary_receipts(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_guarded_clue_lands_while_open_and_says_so(morgue:any){
let client:any,result:any,receipt:any,plain:any,both:any;
client=(await pyInvoke(morgue,[PASS],{}));
result=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"macario-tragedy"})]}));
assert.ok(pyBool(pyEqual(pyAt(result,"obligation_open"),ACCESS)),"tests/kernel/test_scene_obligations.py:261 assert result[\"obligation_open\"] == ACCESS");
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(turn_receipts,[client],{})))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(pyAt(result,"receipts"),0)))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"kind"),"clue");return pyBool(__left)?pyEqual(pyAt(receipt,"obligation_open"),ACCESS):__left})())),"tests/kernel/test_scene_obligations.py:263 assert receipt[\"kind\"] == \"clue\" and receipt[\"obligation_open\"] == ACCESS");
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(world,[client],{})),"discovered_clues"),"macario-tragedy")),"tests/kernel/test_scene_obligations.py:264 assert \"macario-tragedy\" in world(client)[\"discovered_clues\"]");
plain=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"clue",["clue"]:"globe-fire-cutoff"})]}));
assert.ok(pyBool(!pyContains(plain,"obligation_open")),"tests/kernel/test_scene_obligations.py:267 assert \"obligation_open\" not in plain");
both=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"flag",["name"]:FLAG,["value"]:true,["why"]:"Arty waves them through"}),({["kind"]:"clue",["clue"]:"globe-unpublished-story"})]}));
assert.ok(pyBool(!pyContains(both,"obligation_open")),"tests/kernel/test_scene_obligations.py:271 assert \"obligation_open\" not in both");
}
Object.defineProperty(test_a_guarded_clue_lands_while_open_and_says_so,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_guarded_clue_lands_while_open_and_says_so"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_guarded_clue_lands_while_open_and_says_so(await acquireFixture(t,()=>morgue(temporary)));});

export async function test_a_claim_is_refused_by_name_when_it_does_not_fit(morgue:any){
let client:any,missing:any;
client=(await pyInvoke(morgue,[PASS],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c2"],{}))],{})),["invalid_params","obligation_step"])),"tests/kernel/test_scene_obligations.py:279 assert refusal(persuade(client, \"t1-c2\")) == (\"invalid_params\", \"obligation_step\")");
(await pyInvoke(meet_arty,[client,"t1-c3"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c4"],{"obligation":"no-such-gate"}))],{})),["unknown_entity","obligation_unknown"])),"tests/kernel/test_scene_obligations.py:281 assert refusal(persuade(client, \"t1-c4\", obligation=\"no-such-gate\")) == (\"unknown_entity\", \"obligation_unknown\")");
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c5"],{"obligation":ARCHIVIST}))],{})),["invalid_params","obligation_not_open"])),"tests/kernel/test_scene_obligations.py:282 assert refusal(persuade(client, \"t1-c5\", obligation=ARCHIVIST)) == (\"invalid_params\", \"obligation_not_open\")");
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c6"],{"skill":"Spot Hidden"}))],{})),["invalid_params","obligation_skill"])),"tests/kernel/test_scene_obligations.py:283 assert refusal(persuade(client, \"t1-c6\", skill=\"Spot Hidden\")) == (\"invalid_params\", \"obligation_skill\")");
missing=(await pyInvoke(persuade,[client,"t1-c7"],{"skill":null}));
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[missing],{})),["needs","obligation_skill"])),"tests/kernel/test_scene_obligations.py:285 assert refusal(missing) == (\"needs\", \"obligation_skill\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(missing,"error"),"details"),"needs"),"options"),APPROACHES)),"tests/kernel/test_scene_obligations.py:286 assert missing[\"error\"][\"details\"][\"needs\"][\"options\"] == APPROACHES");
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c8"],{"modifiers":({["difficulty"]:"hard",["reason"]:"he is busy"})}))],{})),["invalid_params","obligation_difficulty"])),"tests/kernel/test_scene_obligations.py:287 assert refusal(persuade(client, \"t1-c8\", modifiers={\"difficulty\": \"hard\", \"reason\": \"he is busy\"})) == (\"invalid_params\", \"obligation_difficulty\")");
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c9"],{"target":"Ruth Blake"}))],{})),["invalid_params","obligation_target"])),"tests/kernel/test_scene_obligations.py:288 assert refusal(persuade(client, \"t1-c9\", target=\"Ruth Blake\")) == (\"invalid_params\", \"obligation_target\")");
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c10"],{"decision":"core-check:opposed-check"}))],{})),["invalid_params","obligation_decision"])),"tests/kernel/test_scene_obligations.py:289 assert refusal(persuade(client, \"t1-c10\", decision=\"core-check:opposed-check\")) == (\"invalid_params\", \"obligation_decision\")");
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c11"],{"intent":"idle"}))],{})),["invalid_params","obligation_intent"])),"tests/kernel/test_scene_obligations.py:290 assert refusal(persuade(client, \"t1-c11\", intent=\"idle\")) == (\"invalid_params\", \"obligation_intent\")");
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c12","effects":[({["kind"]:"move",["to"]:"central-library"})]}));
assert.ok(pyBool(pyEqual((await pyInvoke(refusal,[(await pyInvoke(persuade,[client,"t1-c13"],{}))],{})),["not_here","obligation_not_here"])),"tests/kernel/test_scene_obligations.py:292 assert refusal(persuade(client, \"t1-c13\")) == (\"not_here\", \"obligation_not_here\")");
assert.ok(pyBool(!pyContains((await pyMethod((await pyInvoke(world,[client],{})),"get",["flags",({})],{})),FLAG)),"tests/kernel/test_scene_obligations.py:294 assert FLAG not in world(client).get(\"flags\", {})");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(written,[(await pyInvoke(turn_receipts,[client],{}))],{})))){if(pyBool(pyEqual(pyAt(r,"kind"),"roll"))){__rows.push(r);}}return __rows;})()))),"tests/kernel/test_scene_obligations.py:295 assert not [r for r in written(turn_receipts(client)) if r[\"kind\"] == \"roll\"]");
}
Object.defineProperty(test_a_claim_is_refused_by_name_when_it_does_not_fit,"__pySignature",{value:[{"name":"morgue","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_claim_is_refused_by_name_when_it_does_not_fit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_claim_is_refused_by_name_when_it_does_not_fit(await acquireFixture(t,()=>morgue(temporary)));});

export async function test_the_offer_ledger_counts_the_obligation_and_marks_it_taken(tmp_path:any){
let client:any,capsule:any,telemetry:any,ledger:any,nxt:any;
client=(await pyInvoke(kernel_with,[tmp_path,LEDGER_PASS],{}));
try{(await pyInvoke(at_morgue,[client],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c2","text":"The Globe's lobby smells of ink."}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"I ask the editor to let me into the clippings room."})),"capsule");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(capsule,"obligations"))){if(pyBool(pyEqual(pyAt(row,"kind"),"scene"))){__rows.push([pyAt(row,"name"),pyAt(row,"state")]);}}return __rows;})())),({[ACCESS]:"open",[ARCHIVIST]:"blocked"}))),"tests/kernel/test_scene_obligations.py:307 assert {row[\"name\"]: row[\"state\"] for row in capsule[\"obligations\"] if row[\"kind\"] == \"scene\"} == {ACCESS: \"open\", ARCHIVIST: \"blocked\"}");
(await pyInvoke(meet_arty,[client,"t2-c1"],{}));
assert.ok(pyBool((pyAt(pyAt(pyAt((await pyInvoke(persuade,[client,"t2-c2"],{})),"result"),"obligation"),"settled")===true)),"tests/kernel/test_scene_obligations.py:309 assert persuade(client, \"t2-c2\")[\"result\"][\"obligation\"][\"settled\"] is True");
(await pyMethod(client,"table",["narrate"],{"call_id":"t2-c3","text":"Arty relents and waves you downstairs."}));
telemetry=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await pyMethod((await pyMethod((pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"telemetry.jsonl")),"read_text",[],{})),"splitlines",[],{})))){if(pyBool((await pyMethod(line,"strip",[],{})))){__rows.push((await pyMethod(json,"loads",[line],{})));}}return __rows;})());
ledger=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(telemetry)){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(row,"get",["lane"],{})),"offers");return pyBool(__left)?pyEqual(pyAt(row,"turn"),2):__left})()))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(ledger,"offered"),`obligation:${ACCESS}`);return pyBool(__left)?pyContains(pyAt(ledger,"taken"),`obligation:${ACCESS}`):__left})())),"tests/kernel/test_scene_obligations.py:313 assert f\"obligation:{ACCESS}\" in ledger[\"offered\"] and f\"obligation:{ACCESS}\" in ledger[\"taken\"]");
assert.ok(pyBool(!pyContains(pyAt(ledger,"offered"),`obligation:${ARCHIVIST}`)),"tests/kernel/test_scene_obligations.py:314 assert f\"obligation:{ARCHIVIST}\" not in ledger[\"offered\"]");
nxt=pyAt((await pyMethod(client,"table",["player_input"],{"text":"I follow him."})),"capsule");
assert.ok(pyBool(!pyContains((await pyMethod(json,"dumps",[pyAt(nxt,"obligations")],{})),"offers")),"tests/kernel/test_scene_obligations.py:317 assert \"offers\" not in json.dumps(nxt[\"obligations\"])");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_offer_ledger_counts_the_obligation_and_marks_it_taken,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_offer_ledger_counts_the_obligation_and_marks_it_taken"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_offer_ledger_counts_the_obligation_and_marks_it_taken(temporary);});

const __unpack17822=["knott-accept-commission","knott-commission-accepted"];export let COMMISSION:any=__unpack17822[0];export let COMMISSION_FLAG:any=__unpack17822[1];
export let COMMISSION_YIELDS:any=({["clues"]:["knott-research-leads","knott-keys"],["items"]:["Corbitt House key"],["cash"]:20});
export async function at_office(client:any){
(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t0-c1","text":"The opening."}));
(await pyMethod(client,"table",["player_input"],{"text":"I take the job."}));
}
Object.defineProperty(at_office,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function test_a_fresh_campaign_carries_the_commission_as_an_open_accept_with_its_settlement(tmp_path:any){
let client:any,issued:any,commission:any,clues:any,code:any,reason:any;
client=(await pyInvoke(kernel_with,[tmp_path,PASS],{}));
try{(await pyInvoke(at_office,[client],{}));
issued=(await pyInvoke(rows,[client],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[issued],{})),[COMMISSION])),"tests/kernel/test_scene_obligations.py:339 assert list(issued) == [COMMISSION]");
commission=pyAt(issued,COMMISSION);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(commission,"state"),"open");return pyBool(__left)?pyEqual(pyAt(commission,"who"),"Steven Knott"):__left})())),"tests/kernel/test_scene_obligations.py:341 assert commission[\"state\"] == \"open\" and commission[\"who\"] == \"Steven Knott\"");
assert.ok(pyBool(pyEqual(pyAt(commission,"trigger"),({["kind"]:"attempt",["guards"]:({["clues"]:["knott-keys","knott-research-leads"]})}))),"tests/kernel/test_scene_obligations.py:342 assert commission[\"trigger\"] == {\"kind\": \"attempt\", \"guards\": {\"clues\": [\"knott-keys\", \"knott-research-leads\"]}}");
assert.ok(pyBool(pyEqual(pyAt(commission,"yields"),COMMISSION_YIELDS)),"tests/kernel/test_scene_obligations.py:343 assert commission[\"yields\"] == COMMISSION_YIELDS");
assert.ok(pyBool(pyEqual(pyAt(commission,"next"),({["kind"]:"accept",["person"]:"Steven Knott",["settle"]:[({["kind"]:"flag",["name"]:COMMISSION_FLAG,["value"]:true}),({["kind"]:"clue",["clue"]:"knott-research-leads",["from"]:"Steven Knott"}),({["kind"]:"clue",["clue"]:"knott-keys",["from"]:"Steven Knott"}),({["kind"]:"item",["name"]:"Corbitt House key",["from"]:"Steven Knott"}),({["kind"]:"cash",["delta"]:20,["source"]:"quote",["with"]:"Steven Knott"})]}))),"tests/kernel/test_scene_obligations.py:344 assert commission[\"next\"] == {\"kind\": \"accept\", \"person\": \"Steven Knott\", \"settle\": [\n            {\"kind\": \"flag\", \"name\": COMMISSION_FLAG, \"value\": True},\n            {\"kind\": \"clue\", \"clue\": \"knott-research-leads\", \"from\": \"Steven Knott\"},\n            {\"kind\": \"clue\", \"clue\": \"knott-keys\", \"from\": \"Steven Knott\"},\n            {\"kind\": \"item\", \"name\": \"Corbitt House key\", \"from\": \"Steven Knott\"},\n            {\"kind\": \"cash\", \"delta\": 20, \"source\": \"quote\", \"with\": \"Steven Knott\"}]}");
clues=(await pyInvoke(clue_candidates,[client],{}));
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const [name,row] of pyIterable((await pyMethod(clues,"items",[],{})))){if(pyBool(pyEqual((await pyMethod(row,"get",["guarded_by"],{})),COMMISSION))){__rows.push(name);}}return __rows;})())),new Set(["knott-keys","knott-research-leads"]))),"tests/kernel/test_scene_obligations.py:351 assert {name for name, row in clues.items() if row.get(\"guarded_by\") == COMMISSION} == {\"knott-keys\", \"knott-research-leads\"}");
assert.ok(pyBool((await pyMethod(pyAt(pyAt((await pyInvoke(scene_rows,[client],{})),COMMISSION),"cue"),"startswith",["next: accept Steven Knott's offer; one apply settles it"],{}))),"tests/kernel/test_scene_obligations.py:352 assert scene_rows(client)[COMMISSION][\"cue\"].startswith(\"next: accept Steven Knott's offer; one apply settles it\")");
(await pyInvoke(assert_capsule_agrees,[client],{}));
const __unpack19779=(await pyInvoke(refusal,[(await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c1",["action"]:({["intent"]:"social",["skill"]:"Persuade",["goal"]:"take the job",["method"]:"agree",["obligation"]:COMMISSION})})],{}))],{}));code=__unpack19779[0];reason=__unpack19779[1];
assert.ok(pyBool(pyEqual([code,reason],["invalid_params","obligation_step"])),"tests/kernel/test_scene_obligations.py:357 assert (code, reason) == (\"invalid_params\", \"obligation_step\")");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_fresh_campaign_carries_the_commission_as_an_open_accept_with_its_settlement,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_fresh_campaign_carries_the_commission_as_an_open_accept_with_its_settlement"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_fresh_campaign_carries_the_commission_as_an_open_accept_with_its_settlement(temporary);});
export async function test_the_accept_settlement_files_its_yields_in_one_apply_and_crosses_nothing(tmp_path:any){
let client:any,settle:any,result:any,receipts:any,cash:any,moves:any;
client=(await pyInvoke(kernel_with,[tmp_path,PASS],{}));
try{(await pyInvoke(at_office,[client],{}));
settle=pyAt(pyAt(pyAt((await pyInvoke(rows,[client],{})),COMMISSION),"next"),"settle");
result=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":settle}));
assert.ok(pyBool(!pyContains(result,"obligation_open")),pyStr("the flag comes first: the guarded clues cross nothing"));
receipts=(await pyInvoke(written,[(await pyInvoke(turn_receipts,[client],{}))],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(receipts)){__rows.push(pyAt(receipt,"kind"));}return __rows;})()),["flag","clue","clue","item","cash"])),"tests/kernel/test_scene_obligations.py:370 assert [receipt[\"kind\"] for receipt in receipts] == [\"flag\", \"clue\", \"clue\", \"item\", \"cash\"]");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(receipts)){if(pyBool(pyEqual(pyAt(receipt,"kind"),"clue"))){__rows.push((await pyMethod(receipt,"get",["clue"],{})));}}return __rows;})())),new Set(["knott-research-leads","knott-keys"]))),"tests/kernel/test_scene_obligations.py:371 assert {receipt.get(\"clue\") for receipt in receipts if receipt[\"kind\"] == \"clue\"} == {\"knott-research-leads\", \"knott-keys\"}");
cash=(await pyNext((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(receipts)){if(pyBool(pyEqual(pyAt(receipt,"kind"),"cash"))){__rows.push(receipt);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(cash,"delta"),20);return pyBool(__left)?pyEqual(pyAt(cash,"source"),"quote"):__left})())),"tests/kernel/test_scene_obligations.py:373 assert cash[\"delta\"] == 20 and cash[\"source\"] == \"quote\"");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(receipts)){if(pyBool(pyEqual(pyAt(receipt,"kind"),"item"))){__rows.push(receipt);}}return __rows;})()))),"name"),"Corbitt House key")),"tests/kernel/test_scene_obligations.py:374 assert next(receipt for receipt in receipts if receipt[\"kind\"] == \"item\")[\"name\"] == \"Corbitt House key\"");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(receipts)){__rows.push(!pyContains(receipt,"obligation_open"));}return __rows;})())))),"tests/kernel/test_scene_obligations.py:375 assert all(\"obligation_open\" not in receipt for receipt in receipts)");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(world,[client],{})),"flags"),COMMISSION_FLAG)===true)),"tests/kernel/test_scene_obligations.py:376 assert world(client)[\"flags\"][COMMISSION_FLAG] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(rows,[client],{})),COMMISSION),"state"),"settled")),"tests/kernel/test_scene_obligations.py:377 assert rows(client)[COMMISSION][\"state\"] == \"settled\"");
moves=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyInvoke(options,[client],{})),"candidates"))){if(pyBool(pyEqual(pyAt(pyAt(row,"effect"),"kind"),"move"))){__rows.push([pyAt(pyAt(row,"effect"),"to"),pyAt(row,"description")]);}}return __rows;})()));
assert.ok(pyBool((pyAt(pyAt(pyAt(moves,"newspaper-morgue"),"unlock_when"),"met")===true)),"tests/kernel/test_scene_obligations.py:380 assert moves[\"newspaper-morgue\"][\"unlock_when\"][\"met\"] is True");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_accept_settlement_files_its_yields_in_one_apply_and_crosses_nothing,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_accept_settlement_files_its_yields_in_one_apply_and_crosses_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_accept_settlement_files_its_yields_in_one_apply_and_crosses_nothing(temporary);});
