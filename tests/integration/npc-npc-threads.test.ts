// Migrated from tests/kernel/test_npc_threads.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,narrate,open_turn,read_json,read_jsonl,resolve,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export let KNOTT:any="Steven Knott";
export let HANDLE:any="steven-knott";
export let PAPERS:any="诺特把文件推回来：「先带介绍信来，我照章程办。」";
export let SILENT:any="诺特把钥匙揣进口袋，走到门边，按着门把手瞪着海斯。";
export let AGAIN:any=`诺特没有让开。{{say:${KNOTT}}}「昨天的话不变：带介绍信来，带人来，随你挑。」{{/say}}`;
export async function* knott(tmp_path:any){
let client:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
(await open_turn(client,"我请诺特把旧档案借我。"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:KNOTT,["archetype"]:"ordinary_adult",["why"]:"an office man"})]}));
yield client;
(await pyMethod(client,"close",[],{}));
}
export async function receipts(client:any){
return pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
}
export async function ref_of(client:any,line:any){
return pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(client)))){if(pyBool(pyEqual((await pyMethod((await pyMethod(r,"get",["intent",({})],{})),"get",["text"],{})),line)))__rows.push(r);}return __rows;})()))),"intent"),"ref");
}
export async function table_act(client:any,call_id:any,line:any){

(await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"npc",["name"]:KNOTT,["intends"]:line,["outcome"]:"attempted",["_generated"]:true})]}));
return (await ref_of(client,line));
}
export async function threads(client:any,text:any){
return (await pyMethod(client,"ok",["npc.threads",({["campaign"]:"c1",["text"]:text})],{}));
}
export async function papers_then_silence(client:any){
let papers:any,silent:any;

papers=(await table_act(client,"t1-c2",PAPERS));
(await narrate(client,"t1-c3",`诺特把文件推回来。{{say:${KNOTT}}}「先带介绍信来，我照章程办。」{{/say}}`));
(await pyMethod(client,"table",["player_input"],{"text":"我拿侦探执照押在这儿，行不行？"}));
silent=(await table_act(client,"t2-c1",SILENT));
return [papers,silent];
}
export async function turn_json(client:any){
return (await read_json(pyDivide((await campaign_dir(client.workspace,"c1")),"turn.json")));
}
export async function record(client:any,turn:any){
return (await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace,"c1")),"turns"),`${pyFormat(turn,"04d")}.json`)));
}
export async function delivery_rows(client:any){
return (await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await read_jsonl(pyDivide((await campaign_dir(client.workspace,"c1")),"telemetry.jsonl"))))){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(row,"get",["lane"],{})),"delivery");return pyBool(__left)?pyEqual((await pyMethod(row,"get",["reason"],{})),"purpose_repeated"):__left})())))__rows.push(row);}return __rows;})());
}
export async function test_the_keepers_line_against_a_row_under_way_since_an_earlier_turn_is_listed_and_this_turns_act_is_not(knott:any){
let papers:any,silent:any,found:any,person:any,error:any;
const __unpack3447=(await papers_then_silence(knott));papers=__unpack3447[0];silent=__unpack3447[1];
found=(await threads(knott,AGAIN));
assert.ok(pyBool(pyEqual(pyAt(found,"turn"),2)),"tests/kernel/test_npc_threads.py:81 assert found[\"turn\"] == 2");
const __unpack3559=pyAt(found,"people");person=__unpack3559[0];
assert.ok(pyBool(pyEqual([pyAt(person,"npc"),pyAt(person,"name"),pyAt(person,"trigger")],[HANDLE,KNOTT,"act"])),pyStr(person));
assert.ok(pyBool(pyEqual(pyAt(person,"lines"),["「昨天的话不变：带介绍信来，带人来，随你挑。」"])),"tests/kernel/test_npc_threads.py:84 assert person[\"lines\"] == [\"「昨天的话不变：带介绍信来，带人来，随你挑。」\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(person,"threads"))){if(pyBool(true))__rows.push(pyAt(row,"ref"));}return __rows;})()),[papers])),pyStr("the row set out on turn 1; this turn's silent act is what the prose renders"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(person,"threads"),0),"status"),"attempted");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(person,"threads"),0),"since_turn"),1):__left})())),"tests/kernel/test_npc_threads.py:86 assert person[\"threads\"][0][\"status\"] == \"attempted\" and person[\"threads\"][0][\"since_turn\"] == 1");
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(person,"threads"))){if(pyBool(true))__rows.push(pyAt(row,"ref"));}return __rows;})()),silent)),"tests/kernel/test_npc_threads.py:87 assert silent not in [row[\"ref\"] for row in person[\"threads\"]]");
assert.ok(pyBool(pyEqual(pyAt((await threads(knott,"诺特没有说话。")),"people"),[])),"tests/kernel/test_npc_threads.py:89 assert threads(knott, \"诺特没有说话。\")[\"people\"] == []");
error=(await pyMethod(knott,"err",["npc.threads",({["campaign"]:"c1"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"text"):__left})())),"tests/kernel/test_npc_threads.py:91 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"field\"] == \"text\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_keepers_line_against_a_row_under_way_since_an_earlier_turn_is_listed_and_this_turns_act_is_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_keepers_line_against_a_row_under_way_since_an_earlier_turn_is_listed_and_this_turns_act_is_not(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_delivery_naming_the_row_goes_out_first_time_with_a_finding(knott:any){
let papers:any,_:any,named:any,delivered:any,warnings:any,finding:any;

const __unpack4616=(await papers_then_silence(knott));papers=__unpack4616[0];_=__unpack4616[1];
named=[({["npc"]:HANDLE,["ref"]:papers})];
delivered=(await pyMethod(knott,"table",["narrate"],{"call_id":"t2-c2","text":AGAIN,"purpose_repeats":named}));
assert.ok(pyBool(pyEqual(pyAt(delivered,"turn"),2)),"tests/kernel/test_npc_threads.py:100 assert delivered[\"turn\"] == 2");
warnings=(await pyMethod((await record(knott,2)),"get",["warnings",[]],{}));
finding=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(warnings)){if(pyBool(pyEqual(pyAt(row,"kind"),"purpose_repeated")))__rows.push(row);}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(finding)){if(pyBool(true))__rows.push([pyAt(row,"lane"),pyAt(row,"ref")]);}return __rows;})()),[["speech",papers]])),pyStr(finding));
assert.ok(pyBool(pyEqual(pyAt(pyAt(finding,0),"quote"),"「昨天的话不变：带介绍信来，带人来，随你挑。」")),"tests/kernel/test_npc_threads.py:104 assert finding[0][\"quote\"] == \"「昨天的话不变：带介绍信来，带人来，随你挑。」\"");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(finding,0),"why"),"startswith",[`${KNOTT} already set out on turn 1 to "${PAPERS}" and it has no result`],{}))),pyStr(pyAt(pyAt(finding,0),"why")));
assert.ok(pyBool(pyContains(pyAt(pyAt(finding,0),"fix"),"do not have them say")),pyStr(pyAt(pyAt(finding,0),"fix")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(warnings)){if(pyBool(pyEqual(pyAt(row,"kind"),"intent_result_owed")))__rows.push(pyAt(row,"ref"));}return __rows;})()),[papers])),"tests/kernel/test_npc_threads.py:109 assert [row[\"ref\"] for row in warnings if row[\"kind\"] == \"intent_result_owed\"] == [papers]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await delivery_rows(knott)))){if(pyBool(true))__rows.push([pyAt(row,"ok"),pyAt(row,"outcome"),pyAt(row,"call_id")]);}return __rows;})()),[[true,"delivered","t2-c2"]])),"tests/kernel/test_npc_threads.py:110 assert [(row[\"ok\"], row[\"outcome\"], row[\"call_id\"]) for row in delivery_rows(knott)] == [(True, \"delivered\", \"t2-c2\")]");
assert.ok(pyBool(!pyContains((await turn_json(knott)),"purpose_gate")),"tests/kernel/test_npc_threads.py:111 assert \"purpose_gate\" not in turn_json(knott)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_delivery_naming_the_row_goes_out_first_time_with_a_finding"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_delivery_naming_the_row_goes_out_first_time_with_a_finding(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_row_given_up_turns_ago_is_a_thread_and_a_row_settled_by_the_dice_is_not(knott:any){
let papers:any,listen:any,person:any,finding:any;
papers=(await table_act(knott,"t1-c2",PAPERS));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:papers,["intent_outcome"]:"abandoned",["why"]:"he lets it go"})]}));
(await narrate(knott,"t1-c4",`诺特摆摆手。{{say:${KNOTT}}}「算了。」{{/say}}`));
(await pyMethod(knott,"table",["player_input"],{"text":"我等着。"}));
listen=(await table_act(knott,"t2-c1","诺特侧耳听走廊里的动静。"));
(await resolve(knott,"t2-c2",({"actor":KNOTT,"intent":"investigate","skill":"Listen","goal":"listen","method":"listen","intent_ref":listen,"_generated":true})));
(await narrate(knott,"t2-c3",`诺特听了听走廊。{{say:${KNOTT}}}「没人。」{{/say}}`));
(await pyMethod(knott,"table",["player_input"],{"text":"我还是等着。"}));
(await table_act(knott,"t3-c1",SILENT));
const __unpack6526=pyAt((await threads(knott,AGAIN)),"people");person=__unpack6526[0];
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(person,"threads"))){if(pyBool(true))__rows.push([pyAt(row,"ref"),pyAt(row,"status")]);}return __rows;})()),[[papers,"abandoned"]])),pyStr("given up two turns ago is still never carried out; the Listen the dice settled is not a thread"));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(knott,"table",["narrate"],{"call_id":"t3-c2","text":AGAIN,"purpose_repeats":[({["npc"]:HANDLE,["ref"]:papers})]})),"turn"),3)),"tests/kernel/test_npc_threads.py:129 assert knott.table(\"narrate\", call_id=\"t3-c2\", text=AGAIN, purpose_repeats=[{\"npc\": HANDLE, \"ref\": papers}])[\"turn\"] == 3");
const __unpack7057=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod((await record(knott,3)),"get",["warnings",[]],{})))){if(pyBool(pyEqual(pyAt(row,"kind"),"purpose_repeated")))__rows.push(row);}return __rows;})());finding=__unpack7057[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(finding,"ref"),papers);return pyBool(__left)?pyContains(pyAt(finding,"why"),"gave it up on turn 1"):__left})())),pyStr(finding));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await delivery_rows(knott)))){if(pyBool(true))__rows.push([pyAt(row,"ok"),pyAt(row,"outcome"),pyAt(row,"call_id")]);}return __rows;})()),[[true,"delivered","t3-c2"]])),"tests/kernel/test_npc_threads.py:132 assert [(row[\"ok\"], row[\"outcome\"], row[\"call_id\"]) for row in delivery_rows(knott)] == [(True, \"delivered\", \"t3-c2\")]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_row_given_up_turns_ago_is_a_thread_and_a_row_settled_by_the_dice_is_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_row_given_up_turns_ago_is_a_thread_and_a_row_settled_by_the_dice_is_not(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_row_set_out_this_turn_by_the_keeper_is_what_the_prose_renders_and_not_a_thread(knott:any){
let papers:any,silent:any,own:any,person:any;
const __unpack7477=(await papers_then_silence(knott));papers=__unpack7477[0];silent=__unpack7477[1];
own="诺特打算打电话叫楼下的看门人上来。";
(await pyMethod(knott,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"npc",["name"]:KNOTT,["intends"]:own,["outcome"]:"attempted",["why"]:"he reaches for the phone"})]}));
const __unpack7714=pyAt((await threads(knott,AGAIN)),"people");person=__unpack7714[0];
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(person,"threads"))){if(pyBool(true))__rows.push(pyAt(row,"ref"));}return __rows;})()),[papers])),pyStr("the table's act and the Keeper's own of this turn are both this turn's"));
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(person,"threads"))){if(pyBool(true))__rows.push(pyAt(row,"ref"));}return __rows;})()),(await ref_of(knott,own)))),"tests/kernel/test_npc_threads.py:141 assert ref_of(knott, own) not in [row[\"ref\"] for row in person[\"threads\"]]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_row_set_out_this_turn_by_the_keeper_is_what_the_prose_renders_and_not_a_thread"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_row_set_out_this_turn_by_the_keeper_is_what_the_prose_renders_and_not_a_thread(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_person_neither_acted_for_nor_in_the_conversation_is_not_held_and_a_wrong_reading_refuses_nothing(knott:any){
let papers:any,delivered:any;
papers=(await table_act(knott,"t1-c2",PAPERS));
(await pyMethod(knott,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:papers,["intent_outcome"]:"abandoned",["why"]:"he lets it go"})]}));
(await narrate(knott,"t1-c4","诺特低头看报纸。"));
(await pyMethod(knott,"table",["player_input"],{"text":"我翻看架子上的旧报。"}));
(await narrate(knott,"t2-c1","你翻了半天旧报。"));
(await pyMethod(knott,"table",["player_input"],{"text":"我回头问诺特。"}));
assert.ok(pyBool(pyEqual(pyAt((await threads(knott,AGAIN)),"people"),[])),"tests/kernel/test_npc_threads.py:152 assert threads(knott, AGAIN)[\"people\"] == []");
delivered=(await pyMethod(knott,"table",["narrate"],{"call_id":"t3-c1","text":AGAIN,"purpose_repeats":[({["npc"]:HANDLE,["ref"]:papers}),({["npc"]:"arty-wilmot",["ref"]:papers})]}));
assert.ok(pyBool(pyEqual(pyAt(delivered,"turn"),3)),"tests/kernel/test_npc_threads.py:155 assert delivered[\"turn\"] == 3");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod((await record(knott,3)),"get",["warnings",[]],{})))){if(pyBool(pyEqual(pyAt(row,"kind"),"purpose_repeated")))__rows.push(row);}return __rows;})()))),"tests/kernel/test_npc_threads.py:156 assert not [row for row in record(knott, 3).get(\"warnings\", []) if row[\"kind\"] == \"purpose_repeated\"]");
assert.ok(pyBool(pyEqual((await delivery_rows(knott)),[])),"tests/kernel/test_npc_threads.py:157 assert delivery_rows(knott) == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_person_neither_acted_for_nor_in_the_conversation_is_not_held_and_a_wrong_reading_refuses_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_person_neither_acted_for_nor_in_the_conversation_is_not_held_and_a_wrong_reading_refuses_nothing(await acquireFixture(t,()=>knott(temporary)));});
export async function test_a_line_the_host_wrapped_is_never_held(knott:any){
let papers:any,_:any,delivered:any;
const __unpack9164=(await papers_then_silence(knott));papers=__unpack9164[0];_=__unpack9164[1];
(await pyMethod(knott,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"npc",["name"]:KNOTT,["intent_ref"]:papers,["intent_outcome"]:"abandoned",["why"]:"he drops it"})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt((await threads(knott,AGAIN)),"people"),0),"threads"),0),"ref"),papers)),pyStr("given up, it is still his thread"));
delivered=(await pyMethod(knott,"table",["narrate"],{"call_id":"t2-c3","text":AGAIN,"host_attributed":[0],"purpose_repeats":[({["npc"]:HANDLE,["ref"]:papers})]}));
assert.ok(pyBool(pyEqual(pyAt(delivered,"turn"),2)),"tests/kernel/test_npc_threads.py:166 assert delivered[\"turn\"] == 2");
assert.ok(pyBool(pyEqual((await delivery_rows(knott)),[])),"tests/kernel/test_npc_threads.py:167 assert delivery_rows(knott) == []");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod((await record(knott,2)),"get",["warnings",[]],{})))){if(pyBool(pyEqual(pyAt(row,"kind"),"purpose_repeated")))__rows.push(row);}return __rows;})()))),"tests/kernel/test_npc_threads.py:168 assert not [row for row in record(knott, 2).get(\"warnings\", []) if row[\"kind\"] == \"purpose_repeated\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_line_the_host_wrapped_is_never_held"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_line_the_host_wrapped_is_never_held(await acquireFixture(t,()=>knott(temporary)));});
