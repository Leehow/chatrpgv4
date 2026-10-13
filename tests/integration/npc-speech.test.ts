// Migrated from tests/kernel/test_speech.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,campaign_dir,narrate,open_turn,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";


export let INV:any="托马斯·海斯";
export let KNOTT:any="Steven Knott";
export let KNOTT_HANDLE:any="steven-knott";
export let KNOTT_ID:any="npc-steven-knott";
export async function record(client:any,turn:any){
return (await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable((await pySorted((await pyMethod((pyDivide((await campaign_dir(client.workspace)),"turns")),"iterdir",[],{})))))){if(pyBool((await (async()=>{const __left=pyEqual(p.suffix,".json");return pyBool(__left)?pyEqual((await pyMethod((await read_json(p)),"get",["turn"],{})),turn):__left})())))__rows.push((await read_json(p)));}return __rows;})())));
}
export async function keeper_lines(client:any){
return (await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await read_jsonl(pyDivide((await campaign_dir(client.workspace)),"transcript.jsonl"))))){if(pyBool(pyEqual((await pyMethod(row,"get",["role"],{})),"keeper")))__rows.push(pyAt(row,"text"));}return __rows;})());
}
export async function test_a_say_token_wraps_a_line_and_resolves_to_the_person_present(kernel:any){
(await open_turn(kernel));
let result:any=(await narrate(kernel,"t1-c1",`诺特把钥匙推过来。{{say:${KNOTT}}}「钥匙在这儿。」{{/say}}他没有起身。`));
assert.ok(pyBool(pyEqual(pyAt(result,"speech"),[({["who"]:({["npc"]:KNOTT_HANDLE,["name"]:KNOTT}),["text"]:"「钥匙在这儿。」"})])),"tests/kernel/test_speech.py:29 assert result[\"speech\"] == [{\"who\": {\"npc\": KNOTT_HANDLE, \"name\": KNOTT}, \"text\": \"「钥匙在这儿。」\"}]");
assert.ok(pyBool(!pyContains((await pyStr(result)),KNOTT_ID)),"tests/kernel/test_speech.py:31 assert KNOTT_ID not in str(result)");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"{{")),"tests/kernel/test_speech.py:32 assert \"{{\" not in result[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"诺特把钥匙推过来。「钥匙在这儿。」他没有起身。")),"tests/kernel/test_speech.py:33 assert result[\"rendered_text\"] == \"诺特把钥匙推过来。「钥匙在这儿。」他没有起身。\"");
assert.ok(pyBool(pyContains(pyAt(result,"marked_text"),`{{say:${KNOTT}}}「钥匙在这儿。」{{/say}}`)),"tests/kernel/test_speech.py:35 assert f\"{{{{say:{KNOTT}}}}}「钥匙在这儿。」{{{{/say}}}}\" in result[\"marked_text\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(result,"unresolved_speakers");return pyBool(__left)?!pyContains(result,"dropped_markers"):__left})())),"tests/kernel/test_speech.py:36 assert \"unresolved_speakers\" not in result and \"dropped_markers\" not in result");
let stored:any=(await record(kernel,1));
assert.ok(pyBool(pyEqual(pyAt(stored,"speech"),pyAt(result,"speech"))),"tests/kernel/test_speech.py:38 assert stored[\"speech\"] == result[\"speech\"]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await keeper_lines(kernel)))){if(pyBool(true))__rows.push(!pyContains(line,"{{"));}return __rows;})())))),"tests/kernel/test_speech.py:39 assert all(\"{{\" not in line for line in keeper_lines(kernel))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_say_token_wraps_a_line_and_resolves_to_the_person_present"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_say_token_wraps_a_line_and_resolves_to_the_person_present(await kernel(t,{}));});
export async function test_the_investigator_and_a_stranger_resolve_their_own_way(kernel:any){
(await open_turn(kernel));
let result:any=(await narrate(kernel,"t1-c1",`{{say:${INV}}}「我要看看那栋房子。」{{/say}}角落里有人开口。{{say:穿黑袍的女人}}「滚出去。」{{/say}}`));
let who:any=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(result,"speech"))){if(pyBool(true))__rows.push(pyAt(line,"who"));}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(who,0),"name"),INV);return pyBool(__left)?pyAt(pyAt(who,0),"investigator"):__left})())),"tests/kernel/test_speech.py:47 assert who[0][\"name\"] == INV and who[0][\"investigator\"]");
assert.ok(pyBool(pyEqual(pyAt(who,1),({["label"]:"穿黑袍的女人"}))),"tests/kernel/test_speech.py:48 assert who[1] == {\"label\": \"穿黑袍的女人\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"unresolved_speakers"),"names"),["穿黑袍的女人"])),"tests/kernel/test_speech.py:50 assert result[\"unresolved_speakers\"][\"names\"] == [\"穿黑袍的女人\"]");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"{{")),"tests/kernel/test_speech.py:51 assert \"{{\" not in result[\"rendered_text\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_investigator_and_a_stranger_resolve_their_own_way"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_investigator_and_a_stranger_resolve_their_own_way(await kernel(t,{}));});
test('published NPC speech keeps its speaker across paragraphs and leaves intervening narration outside',async t=>{
    const client=await kernel(t,{});
    await open_turn(client);
    const first='"I woke in the night. It was beside the bed.\n\n"When it was angry, the dishes flew.\n\n"It hated my husband most."';
    const last='"Please do not ask everything at once."';
    const marked=`{{say:${KNOTT}}}${first}{{/say}}\n\nHe turns toward the window.\n\n{{say:${KNOTT}}}${last}{{/say}}`;
    const result=await narrate(client,'t1-c1',marked);
    assert.equal(result.marked_text,marked,'explicit paired speech markers preserve every spoken paragraph');
    assert.deepEqual(result.speech,[
        {who:{npc:KNOTT_HANDLE,name:KNOTT},text:first},
        {who:{npc:KNOTT_HANDLE,name:KNOTT},text:last},
    ]);
    assert.equal(result.rendered_text,`${first}\n\nHe turns toward the window.\n\n${last}`);
});
export async function test_the_shape_is_repaired_never_refused(kernel:any){
(await open_turn(kernel));
let text:any=(`{{say:${KNOTT}}}「先听我说。」{{say:${INV}}}「说。」{{/say}}{{/say}}\n\n`+`{{say:${KNOTT}}}「房子锁了二十年。」\n\n他站起来。`);
let result:any=(await narrate(kernel,"t1-c1",text));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(result,"speech"))){if(pyBool(true))__rows.push(pyAt(line,"text"));}return __rows;})()),["「先听我说。」","「说。」","「房子锁了二十年。」"])),"tests/kernel/test_speech.py:61 assert [line[\"text\"] for line in result[\"speech\"]] == [\"「先听我说。」\", \"「说。」\", \"「房子锁了二十年。」\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"marked_text"),(`{{say:${KNOTT}}}「先听我说。」{{/say}}{{say:${INV}}}「说。」{{/say}}\n\n`+`{{say:${KNOTT}}}「房子锁了二十年。」{{/say}}\n\n他站起来。`))),"tests/kernel/test_speech.py:62 assert result[\"marked_text\"] == (f\"{{{{say:{KNOTT}}}}}「先听我说。」{{{{/say}}}}{{{{say:{INV}}}}}「说。」{{{{/say}}}}\\n\\n\"\n                                     f\"{{{{say:{KNOTT}}}}}「房子锁了二十年。」{{{{/say}}}}\\n\\n他站起来。\")");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"{{")),"tests/kernel/test_speech.py:64 assert \"{{\" not in result[\"rendered_text\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_shape_is_repaired_never_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_shape_is_repaired_never_refused(await kernel(t,{}));});
export async function test_a_span_with_no_words_is_unwrapped_and_never_recorded(kernel:any){
(await open_turn(kernel));
let result:any=(await narrate(kernel,"t1-c1",`他沉默着。{{say:${KNOTT}}}{{/say}}然后摇头。`));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"speech"),[]);return pyBool(__left)?!pyContains(result,"marked_text"):__left})())),"tests/kernel/test_speech.py:70 assert result[\"speech\"] == [] and \"marked_text\" not in result");
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),"他沉默着。然后摇头。")),"tests/kernel/test_speech.py:71 assert result[\"rendered_text\"] == \"他沉默着。然后摇头。\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_span_with_no_words_is_unwrapped_and_never_recorded"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_span_with_no_words_is_unwrapped_and_never_recorded(await kernel(t,{}));});
export async function test_a_mechanics_marker_inside_a_line_moves_after_it_and_still_binds(kernel:any){
(await open_turn(kernel));
let rolled:any=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"找线索",["method"]:"翻找",["skill"]:"Spot Hidden"})}));
let marker:any=pyAt(pyAt(rolled,"markers"),0);
let result:any=(await narrate(kernel,"t1-c2",`{{say:${KNOTT}}}「看这里。{{${marker}}}」{{/say}}你低头看。`));
assert.ok(pyBool((await pyMethod(pyAt(result,"marked_text"),"startswith",[`{{say:${KNOTT}}}「看这里。」{{/say}}{{${marker}}}`],{}))),"tests/kernel/test_speech.py:79 assert result[\"marked_text\"].startswith(f\"{{{{say:{KNOTT}}}}}「看这里。」{{{{/say}}}}{{{{{marker}}}}}\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"speech"),0),"text"),"「看这里。」")),"tests/kernel/test_speech.py:80 assert result[\"speech\"][0][\"text\"] == \"「看这里。」\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"mechanics"))){if(pyBool((await pyMethod(row,"get",["marker"],{}))))__rows.push(pyAt(row,"marker"));}return __rows;})()),[marker])),"tests/kernel/test_speech.py:81 assert [row[\"marker\"] for row in result[\"mechanics\"] if row.get(\"marker\")] == [marker]");
assert.ok(pyBool(!pyContains(result,"dropped_markers")),"tests/kernel/test_speech.py:82 assert \"dropped_markers\" not in result");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_mechanics_marker_inside_a_line_moves_after_it_and_still_binds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_mechanics_marker_inside_a_line_moves_after_it_and_still_binds(await kernel(t,{}));});
export async function test_a_say_token_is_never_a_dropped_marker(kernel:any){

(await open_turn(kernel));
let result:any=(await narrate(kernel,"t1-c1","{{say:steven-knott}}「进来。」{{/say}}"));
assert.ok(pyBool(!pyContains(result,"dropped_markers")),"tests/kernel/test_speech.py:90 assert \"dropped_markers\" not in result");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"speech"),0),"who"),({["npc"]:KNOTT_HANDLE,["name"]:KNOTT,["shown"]:""}))),"tests/kernel/test_speech.py:92 assert result[\"speech\"][0][\"who\"] == {\"npc\": KNOTT_HANDLE, \"name\": KNOTT, \"shown\": \"\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_say_token_is_never_a_dropped_marker"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_say_token_is_never_a_dropped_marker(await kernel(t,{}));});
export async function test_ask_takes_the_same_token(kernel:any){
(await open_turn(kernel));
let result:any=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","kind":"story","prompt":"你要不要接？","options":["接","不接"],"text":`{{say:${KNOTT}}}「接不接？」{{/say}}`}));
assert.ok(pyBool(pyEqual(pyAt(result,"speech"),[({["who"]:({["npc"]:KNOTT_HANDLE,["name"]:KNOTT}),["text"]:"「接不接？」"})])),"tests/kernel/test_speech.py:99 assert result[\"speech\"] == [{\"who\": {\"npc\": KNOTT_HANDLE, \"name\": KNOTT}, \"text\": \"「接不接？」\"}]");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"{{")),"tests/kernel/test_speech.py:100 assert \"{{\" not in result[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt((await record(kernel,1)),"speech"),pyAt(result,"speech"))),"tests/kernel/test_speech.py:101 assert record(kernel, 1)[\"speech\"] == result[\"speech\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ask_takes_the_same_token"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ask_takes_the_same_token(await kernel(t,{}));});
export async function test_who_spoke_reaches_the_ledger_the_capsule_and_the_journal(kernel:any){
(await open_turn(kernel));
(await narrate(kernel,"t1-c1",`{{say:${KNOTT}}}「钥匙在这儿。」{{/say}}`));
let ledger:any=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"npc-ledger.json")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(ledger,KNOTT_ID),"spoke"),({["turns"]:1,["last_turn"]:1}))),"tests/kernel/test_speech.py:108 assert ledger[KNOTT_ID][\"spoke\"] == {\"turns\": 1, \"last_turn\": 1}");
let capsule:any=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我等他继续。"})),"capsule");
let knott:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"present"))){if(pyBool(pyEqual(pyAt(p,"name"),KNOTT)))__rows.push(p);}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(knott,"history"),"last_spoke_turn"),1)),"tests/kernel/test_speech.py:112 assert knott[\"history\"][\"last_spoke_turn\"] == 1");
let packet:any=(await pyMethod(kernel,"ok",["journal.job",({["campaign"]:CAMPAIGN,["turn"]:1})],{}));
assert.ok(pyBool(pyEqual(pyAt(packet,"speech"),[({["name"]:KNOTT,["text"]:"「钥匙在这儿。」"})])),"tests/kernel/test_speech.py:115 assert packet[\"speech\"] == [{\"name\": KNOTT, \"text\": \"「钥匙在这儿。」\"}]");
assert.ok(pyBool(pyContains(pyAt(packet,"recordable"),KNOTT)),"tests/kernel/test_speech.py:116 assert KNOTT in packet[\"recordable\"]");
let journal:any=pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(journal,[]);return pyBool(__left)?__left:(await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(journal)){if(pyBool(true))__rows.push(pyContains(row,"id"));}return __rows;})())))})())),"tests/kernel/test_speech.py:118 assert journal == [] or all(\"id\" in row for row in journal)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_who_spoke_reaches_the_ledger_the_capsule_and_the_journal"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_who_spoke_reaches_the_ledger_the_capsule_and_the_journal(await kernel(t,{}));});
export async function test_a_line_left_unmarked_is_a_verifier_finding(kernel:any){
(await open_turn(kernel));
(await narrate(kernel,"t1-c1","诺特说：「钥匙在这儿。」"));
let accepted:any=(await pyMethod(kernel,"ok",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:1,["lane"]:"verifier",["findings"]:[({["kind"]:"unmarked_speech",["quote"]:"「钥匙在这儿。」",["why"]:"a spoken line outside any say span"})]})],{}));
assert.ok(pyBool((pyBool(pyContains(accepted,"accepted"))?pyEqual(pyAt(accepted,"accepted"),1):true)),"tests/kernel/test_speech.py:126 assert accepted[\"accepted\"] == 1 if \"accepted\" in accepted else True");
let error:any=(await pyMethod(kernel,"err",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:1,["lane"]:"verifier",["findings"]:[({["kind"]:"loud_speech",["quote"]:"「钥匙在这儿。」",["why"]:"not a kind"})]})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"fix"),"unmarked_speech"):__left})())),"tests/kernel/test_speech.py:129 assert error[\"code\"] == \"invalid_params\" and \"unmarked_speech\" in error[\"fix\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_line_left_unmarked_is_a_verifier_finding"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_line_left_unmarked_is_a_verifier_finding(await kernel(t,{}));});
export async function repeat_findings(client:any,turn:any){
return (await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod((await record(client,turn)),"get",["warnings",[]],{})))){if(pyBool(pyEqual(pyAt(row,"kind"),"repeated_line")))__rows.push(row);}return __rows;})());
}
export async function test_a_line_a_person_already_said_is_delivered_with_a_finding_and_a_moved_line_is_not(kernel:any){

(await open_turn(kernel));
let line:any="「钥匙在这儿，拿去就是，别再问我第二遍了。」";
(await narrate(kernel,"t1-c1",`诺特把钥匙推过来。{{say:${KNOTT}}}${line}{{/say}}`));
(await pyMethod(kernel,"table",["player_input"],{"text":"我再问一次钥匙的事。"}));
let again:any=(await narrate(kernel,"t2-c1",`诺特叹气。{{say:${KNOTT}}}${line}{{/say}}`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(again,"repeated_lines"),"lines"),[({["name"]:KNOTT,["line"]:line,["earlier_turn"]:1})])),"tests/kernel/test_speech.py:145 assert again[\"repeated_lines\"][\"lines\"] == [{\"name\": KNOTT, \"line\": line, \"earlier_turn\": 1}]");
const __unpack8018=(await repeat_findings(kernel,2));let finding:any=__unpack8018[0];
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(finding,"lane"),"speech");return pyBool(__left)?pyEqual(pyAt(finding,"quote"),line):__left})());return pyBool(__left)?pyContains(pyAt(finding,"why"),"at turn 1"):__left})())),pyStr(finding));
(await pyMethod(kernel,"table",["player_input"],{"text":"我还是问钥匙的事。"}));
let dressed_line:any="「行吧……钥匙在这儿，拿去就是，别再问我第二遍了，听见没？」";
let dressed:any=(await narrate(kernel,"t3-c1",`{{say:${KNOTT}}}${dressed_line}{{/say}}`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(dressed,"repeated_lines"),"lines"),[({["name"]:KNOTT,["line"]:dressed_line,["earlier_turn"]:1})])),"tests/kernel/test_speech.py:152 assert dressed[\"repeated_lines\"][\"lines\"] == [{\"name\": KNOTT, \"line\": dressed_line, \"earlier_turn\": 1}]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await repeat_findings(kernel,3)))){if(pyBool(true))__rows.push(pyAt(row,"quote"));}return __rows;})()),[dressed_line])),"tests/kernel/test_speech.py:153 assert [row[\"quote\"] for row in repeat_findings(kernel, 3)] == [dressed_line]");
(await pyMethod(kernel,"table",["player_input"],{"text":"我接过钥匙。"}));
let moved:any=(await narrate(kernel,"t4-c1",`{{say:${KNOTT}}}「够了。钥匙你拿着，门在楼上，别让我再看见你。」{{/say}}`));
assert.ok(pyBool((await pyMethod(pyAt(pyAt(pyAt(moved,"speech"),0),"text"),"startswith",["「够了"],{}))),"tests/kernel/test_speech.py:157 assert moved[\"speech\"][0][\"text\"].startswith(\"「够了\")");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(moved,"repeated_lines");return pyBool(__left)?pyEqual((await repeat_findings(kernel,4)),[]):__left})())),"tests/kernel/test_speech.py:158 assert \"repeated_lines\" not in moved and repeat_findings(kernel, 4) == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_line_a_person_already_said_is_delivered_with_a_finding_and_a_moved_line_is_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_line_a_person_already_said_is_delivered_with_a_finding_and_a_moved_line_is_not(await kernel(t,{}));});
