// Migrated from tests/kernel/test_person_junction.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {campaign_dir,narrate,open_turn,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {ACCESS,FAIL,FLAG,PASS,morgue,resolve as gate3} from "./world-obligation-fold.test.ts";





export let KNOTT:any="Steven Knott";
export let CORBITT:any="Walter Corbitt";
export let EPITHET:any="门口的房东";

export let SHARED:any="那个人";

export let SOCIAL:any=({["intent"]:"social",["goal"]:"get the keys and the story",["method"]:"persuade him",["stakes"]:"he clams up"});
export async function name(client:any,who:any,word:any,call_id:any="t1-c1"){
(await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"person",["who"]:who,["name"]:word})]}));
}
export async function share_one_word(client:any){
let path:any,world:any;

path=pyDivide((await campaign_dir(client.workspace)),"world.json");
world=(await read_json(path));
(await pyMethod((await pyMethod(world,"setdefault",["person_labels",({})],{})),"update",[({["steven-knott"]:({["name"]:SHARED}),["walter-corbitt"]:({["name"]:SHARED})})],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
}
export async function give_directly(client:any,handle:any,word:any){
let path:any,world:any;

path=pyDivide((await campaign_dir(client.workspace)),"world.json");
world=(await read_json(path));
(await pyMethod((await pyMethod(world,"setdefault",["person_labels",({})],{})),"setdefault",[handle,({})],{}))["name"]=word;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
}
export async function receipts(client:any,kind:any){
return (await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"kind"),kind))){__rows.push(r);}}return __rows;})());
}
export async function ledger(client:any){
return (await read_json(pyDivide((await campaign_dir(client.workspace)),"npc-ledger.json")));
}

export async function test_a_table_word_as_target_reaches_the_social_adjudication(kernel:any){
let settled:any,roll:any,interaction:any;
(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
settled=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c2","action":({...SOCIAL,["target"]:EPITHET})}));
assert.ok(pyBool(pyEqual(pyAt(settled,"decision"),"social:adjudicate-difficulty")),pyStr(pyAt(settled,"decision")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(settled,"outcome"),"npc"),"steven-knott");return pyBool(__left)?pyEqual(pyAt(pyAt(settled,"outcome"),"approach"),"persuade"):__left})())),"tests/kernel/test_person_junction.py:66 assert settled[\"outcome\"][\"npc\"] == \"steven-knott\" and settled[\"outcome\"][\"approach\"] == \"persuade\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(settled,"outcome"),"motive"),"evidence_refs"),"npc_agenda:steven-knott")),"tests/kernel/test_person_junction.py:67 assert \"npc_agenda:steven-knott\" in settled[\"outcome\"][\"motive\"][\"evidence_refs\"]");
const __unpack3518=(await receipts(kernel,"roll"));roll=__unpack3518[0];
assert.ok(pyBool(pyEqual(pyAt(roll,"npc"),"steven-knott")),pyStr(roll));
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c2","action":({...SOCIAL,["target"]:EPITHET})})),({...settled,["replayed"]:true}))),"tests/kernel/test_person_junction.py:71 assert kernel.table(\"resolve\", call_id=\"t1-c2\", action={**SOCIAL, \"target\": EPITHET}) == {**settled, \"replayed\": True}");
(await narrate(kernel,"t1-c3","他看着她，没有马上回答。"));
interaction=pyAt(pyAt(pyAt((await ledger(kernel)),"npc-steven-knott"),"interactions"),(-1));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(interaction,"kind"),"social");return pyBool(__left)?pyEqual(pyAt(interaction,"receipt"),pyAt(roll,"id")):__left})())),"tests/kernel/test_person_junction.py:74 assert interaction[\"kind\"] == \"social\" and interaction[\"receipt\"] == roll[\"id\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_word_as_target_reaches_the_social_adjudication"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_word_as_target_reaches_the_social_adjudication(await kernel(t,{}));});
export async function test_a_table_word_as_actor_is_that_npcs_own_roll(kernel:any){
let settled:any,roll:any;
(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
settled=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c2","action":({["intent"]:"investigate",["goal"]:"size up the visitor",["method"]:"he looks her over",["actor"]:EPITHET,["skill"]:"Spot Hidden"})}));
assert.ok(pyBool(pyEqual(pyAt(settled,"decision"),"core-check:ordinary-check")),"tests/kernel/test_person_junction.py:83 assert settled[\"decision\"] == \"core-check:ordinary-check\"");
const __unpack4425=(await receipts(kernel,"roll"));roll=__unpack4425[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(roll,"actor"),"steven-knott");return pyBool(__left)?(pyAt(roll,"actor_is_investigator")===false):__left})())),pyStr(roll));
assert.ok(pyBool(pyEqual(pyAt(roll,"visibility"),"keeper")),"tests/kernel/test_person_junction.py:86 assert roll[\"visibility\"] == \"keeper\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_word_as_actor_is_that_npcs_own_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_word_as_actor_is_that_npcs_own_roll(await kernel(t,{}));});
export async function test_a_table_word_as_target_settles_exactly_as_the_book_name_does(morgue:any){
let by_name:any,by_word:any;

by_name=(await gate3((await morgue(PASS)),undefined,undefined,({"target":"Arty Wilmot"})));
by_word=(await gate3((await morgue(PASS)),undefined,undefined,({"target":"Arty"})));
assert.ok(pyBool(pyEqual(by_word,by_name)),"tests/kernel/test_person_junction.py:94 assert by_word == by_name");
assert.ok(pyBool(pyEqual(pyAt(by_word,"obligation"),({["handle"]:ACCESS,["step"]:1,["counted"]:"folded",["settled"]:true}))),"tests/kernel/test_person_junction.py:95 assert by_word[\"obligation\"] == {\"handle\": ACCESS, \"step\": 1, \"counted\": \"folded\", \"settled\": True}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_word_as_target_settles_exactly_as_the_book_name_does"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_word_as_target_settles_exactly_as_the_book_name_does(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_an_obligation_claimed_against_the_table_word_is_that_persons(morgue:any){
let client:any,result:any;

client=(await morgue(FAIL));
result=(await gate3(client,undefined,undefined,({"target":"Arty","obligation":ACCESS})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(result,"obligation"),"handle"),ACCESS);return pyBool(__left)?(pyAt(pyAt(result,"obligation"),"settled")===false):__left})())),"tests/kernel/test_person_junction.py:103 assert result[\"obligation\"][\"handle\"] == ACCESS and result[\"obligation\"][\"settled\"] is False");
assert.ok(pyBool(!pyContains((await pyMethod((await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json"))),"get",["flags",({})],{})),FLAG)),"tests/kernel/test_person_junction.py:104 assert FLAG not in read_json(campaign_dir(client.workspace) / \"world.json\").get(\"flags\", {})");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_obligation_claimed_against_the_table_word_is_that_persons"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_obligation_claimed_against_the_table_word_is_that_persons(await acquireFixture(t,()=>morgue(temporary)));});
export async function test_a_seat_the_graph_answers_is_the_graphs_person_whatever_the_table_called_someone_else(kernel:any){
let settled:any;

(await open_turn(kernel));
(await give_directly(kernel,"walter-corbitt",KNOTT));
settled=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c2","action":({...SOCIAL,["target"]:KNOTT})}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(settled,"outcome"),"npc"),"steven-knott")),"tests/kernel/test_person_junction.py:112 assert settled[\"outcome\"][\"npc\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"id"),"steven-knott")),"tests/kernel/test_person_junction.py:113 assert kernel.table(\"look\", focus=\"npc\", name=KNOTT)[\"id\"] == \"steven-knott\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_seat_the_graph_answers_is_the_graphs_person_whatever_the_table_called_someone_else"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_seat_the_graph_answers_is_the_graphs_person_whatever_the_table_called_someone_else(await kernel(t,{}));});
export async function test_a_word_two_people_carry_refuses_resolve_before_anything_rolls(kernel:any){
let refused:any;
(await open_turn(kernel));
(await share_one_word(kernel));
refused=(await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t1-c2","action":({...SOCIAL,["target"]:SHARED})}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"unknown_entity")),pyStr(refused));
assert.ok(pyBool(pyEqual((await pySorted((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(refused,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})()))),["steven-knott","walter-corbitt"])),"tests/kernel/test_person_junction.py:121 assert sorted(c[\"name\"] for c in refused[\"details\"][\"candidates\"]) == [\"steven-knott\", \"walter-corbitt\"]");
assert.ok(pyBool(pyEqual((await receipts(kernel,"roll")),[])),"tests/kernel/test_person_junction.py:122 assert receipts(kernel, \"roll\") == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_word_two_people_carry_refuses_resolve_before_anything_rolls"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_word_two_people_carry_refuses_resolve_before_anything_rolls(await kernel(t,{}));});

export async function test_look_focus_npc_reads_the_table_word(kernel:any){
let view:any;
(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
view=(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":EPITHET}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(view,"id"),"steven-knott");return pyBool(__left)?pyEqual(pyAt(pyAt(view,"called"),"name"),EPITHET):__left})())),"tests/kernel/test_person_junction.py:131 assert view[\"id\"] == \"steven-knott\" and view[\"called\"][\"name\"] == EPITHET");
assert.ok(pyBool(pyEqual(view,(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})))),"tests/kernel/test_person_junction.py:132 assert view == kernel.table(\"look\", focus=\"npc\", name=KNOTT)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_look_focus_npc_reads_the_table_word"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_look_focus_npc_reads_the_table_word(await kernel(t,{}));});
export async function test_look_focus_npc_refuses_a_word_two_people_carry(kernel:any){
let refused:any;
(await open_turn(kernel));
(await share_one_word(kernel));
refused=(await pyMethod(kernel,"table_err",["look"],{"focus":"npc","name":SHARED}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"unknown_entity")),"tests/kernel/test_person_junction.py:139 assert refused[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyEqual((await pySorted((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(refused,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})()))),["steven-knott","walter-corbitt"])),"tests/kernel/test_person_junction.py:140 assert sorted(c[\"name\"] for c in refused[\"details\"][\"candidates\"]) == [\"steven-knott\", \"walter-corbitt\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_look_focus_npc_refuses_a_word_two_people_carry"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_look_focus_npc_refuses_a_word_two_people_carry(await kernel(t,{}));});
export async function test_npc_perspective_reads_the_table_word(kernel:any){
let params:any;
(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
params=({["campaign"]:"c1"});
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["npc.perspective",({...params,["name"]:EPITHET})],{})),(await pyMethod(kernel,"ok",["npc.perspective",({...params,["name"]:KNOTT})],{})))),"tests/kernel/test_person_junction.py:147 assert kernel.ok(\"npc.perspective\", {**params, \"name\": EPITHET}) == kernel.ok(\"npc.perspective\", {**params, \"name\": KNOTT})");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_npc_perspective_reads_the_table_word"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_npc_perspective_reads_the_table_word(await kernel(t,{}));});
export async function test_npc_job_reads_the_table_word(kernel:any){
let packet:any;
(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
packet=(await pyMethod(kernel,"ok",["npc.job",({["campaign"]:"c1",["name"]:EPITHET})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"npc"),"name"),KNOTT)),"tests/kernel/test_person_junction.py:154 assert packet[\"npc\"][\"name\"] == KNOTT");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["npc.job",({["campaign"]:"c1",["name"]:KNOTT})],{})),"job_id"),pyAt(packet,"job_id"))),"tests/kernel/test_person_junction.py:156 assert kernel.ok(\"npc.job\", {\"campaign\": \"c1\", \"name\": KNOTT})[\"job_id\"] == packet[\"job_id\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_npc_job_reads_the_table_word"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_npc_job_reads_the_table_word(await kernel(t,{}));});
export async function test_the_npc_act_reads_read_the_table_word(kernel:any){
let params:any,stakes:any,situation:any,options:any;

(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
params=({["campaign"]:"c1"});
stakes=(await pyMethod(kernel,"ok",["npc.stakes",({...params,["name"]:EPITHET})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["npc.stakes",({...params,["name"]:KNOTT})],{})),stakes)),"tests/kernel/test_person_junction.py:168 assert kernel.ok(\"npc.stakes\", {**params, \"name\": KNOTT}) == stakes");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(kernel,"roll")))){if(pyBool(pyEqual((await pyMethod(r,"get",["family"],{})),"stakes"))){__rows.push(pyEqual(pyAt(r,"actor"),"steven-knott"));}}return __rows;})())))),"tests/kernel/test_person_junction.py:169 assert all(r[\"actor\"] == \"steven-knott\" for r in receipts(kernel, \"roll\") if r.get(\"family\") == \"stakes\")");
situation=(await pyMethod(kernel,"ok",["npc.situation",({...params,["name"]:EPITHET})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(situation,"npc"),"handle"),"steven-knott")),"tests/kernel/test_person_junction.py:171 assert situation[\"npc\"][\"handle\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual(situation,(await pyMethod(kernel,"ok",["npc.situation",({...params,["name"]:KNOTT})],{})))),"tests/kernel/test_person_junction.py:172 assert situation == kernel.ok(\"npc.situation\", {**params, \"name\": KNOTT})");
options=(await pyMethod(kernel,"ok",["npc.act.options",({...params,["name"]:EPITHET})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(options,"npc"),"handle"),"steven-knott")),"tests/kernel/test_person_junction.py:174 assert options[\"npc\"][\"handle\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual(options,(await pyMethod(kernel,"ok",["npc.act.options",({...params,["name"]:KNOTT})],{})))),"tests/kernel/test_person_junction.py:175 assert options == kernel.ok(\"npc.act.options\", {**params, \"name\": KNOTT})");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_npc_act_reads_read_the_table_word"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_npc_act_reads_read_the_table_word(await kernel(t,{}));});
export async function test_the_npc_act_reads_refuse_a_word_two_people_carry(kernel:any){
let method:any,refused:any;
(await open_turn(kernel));
(await share_one_word(kernel));
for(method of pyIterable(["npc.stakes","npc.situation","npc.act.options"])){
refused=(await pyMethod(kernel,"err",[method,({["campaign"]:"c1",["name"]:SHARED})],{}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"unknown_entity")),pyStr([method,refused]));
assert.ok(pyBool(pyEqual((await pySorted((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(refused,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})()))),["steven-knott","walter-corbitt"])),pyStr(method));
}
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(kernel,"roll")))){if(pyBool(pyEqual((await pyMethod(r,"get",["family"],{})),"stakes"))){__rows.push(r);}}return __rows;})()))),pyStr("a refused word rolls nothing"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_npc_act_reads_refuse_a_word_two_people_carry"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_npc_act_reads_refuse_a_word_two_people_carry(await kernel(t,{}));});

export async function test_apply_clue_from_reads_the_table_word(kernel:any){
let clue:any;
(await open_turn(kernel));
(await name(kernel,KNOTT,EPITHET));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys",["from"]:EPITHET})]}));
const __unpack10209=(await receipts(kernel,"clue"));clue=__unpack10209[0];
assert.ok(pyBool(pyEqual(pyAt(clue,"from"),"steven-knott")),pyStr(clue));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_clue_from_reads_the_table_word"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_clue_from_reads_the_table_word(await kernel(t,{}));});
export async function test_apply_person_who_refuses_a_word_two_people_carry(kernel:any){
let refused:any,labels:any;
(await open_turn(kernel));
(await share_one_word(kernel));
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"person",["who"]:SHARED,["address"]:"先生"})]}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"unknown_entity")),pyStr(refused));
assert.ok(pyBool(pyEqual((await pySorted((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(refused,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})()))),["steven-knott","walter-corbitt"])),"tests/kernel/test_person_junction.py:203 assert sorted(c[\"name\"] for c in refused[\"details\"][\"candidates\"]) == [\"steven-knott\", \"walter-corbitt\"]");
labels=pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"person_labels");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(labels,"steven-knott"),"address");return pyBool(__left)?!pyContains(pyAt(labels,"walter-corbitt"),"address"):__left})())),"tests/kernel/test_person_junction.py:205 assert \"address\" not in labels[\"steven-knott\"] and \"address\" not in labels[\"walter-corbitt\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_person_who_refuses_a_word_two_people_carry"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_person_who_refuses_a_word_two_people_carry(await kernel(t,{}));});

export async function test_a_say_token_two_people_carry_stays_a_label(kernel:any){
let delivered:any;
(await open_turn(kernel));
(await share_one_word(kernel));
delivered=(await narrate(kernel,"t1-c2",`门外有人开口。{{say:${SHARED}}}「走吧。」{{/say}}`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(delivered,"speech"),0),"who"),({["label"]:SHARED}))),pyStr(pyAt(delivered,"speech")));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_say_token_two_people_carry_stays_a_label"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_say_token_two_people_carry_stays_a_label(await kernel(t,{}));});
