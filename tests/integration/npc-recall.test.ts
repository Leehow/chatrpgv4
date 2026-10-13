// Migrated from tests/kernel/test_recall.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {OPENING_SCENE,campaign_dir,open_turn,read_json,read_jsonl,open_turn as _open_turn,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";



export async function rewrite_transcript(workspace:any,turn:any,role:any,text:any){
let path:any,rows:any,row:any;
path=pyDivide((await campaign_dir(workspace)),"transcript.jsonl");
rows=(await read_jsonl(path));
for(row of pyIterable(rows)){
if(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"turn"),turn);return pyBool(__left)?pyEqual(pyAt(row,"role"),role):__left})()))){row["text"]=text;}
}
(await pyMethod(path,"write_text",[(await pyMethod("","join",[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){__rows.push(pyAdd((await pyMethod(json,"dumps",[r],{"ensure_ascii":false})),"\n"));}return __rows;})())],{}))],{"encoding":"utf-8"}));
}
export async function three_turns(client:any){
let first:any,second:any;
(await open_turn(client,"第一回合的话。"));
first=(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合的交付。\n\n第二段。"}));
(await pyMethod(client,"table",["player_input"],{"text":"第二回合的话。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"time",["minutes"]:5})]}));
second=(await pyMethod(client,"table",["narrate"],{"call_id":"t2-c2","text":"第二回合的交付。过了 5 分钟。"}));
(await pyMethod(client,"table",["player_input"],{"text":"第三回合的话。"}));
return [first,second];
}
export async function transcript_card(turn:any,role:any,chars:any,head:any){
return ({["turn"]:turn,["role"]:role,["chars"]:chars,["head"]:head,["read"]:({["what"]:"transcript",["read"]:({["turn"]:turn,["role"]:role,["offset"]:0,["limit"]:4096})})});
}
export async function test_transcript_cards_then_verified_read(kernel:any){
let first:any,second:any,default_value:any,wide:any,keeper:any,player:any,missing:any;
const __unpack1311=(await three_turns(kernel));first=__unpack1311[0];second=__unpack1311[1];
default_value=(await pyMethod(kernel,"table",["recall"],{"what":"transcript"}));
assert.ok(pyBool(pyEqual(pyAt(default_value,"turns"),[1,3])),"tests/kernel/test_recall.py:36 assert default[\"turns\"] == [1, 3]");
assert.ok(pyBool(pyEqual(pyAt(default_value,"cards"),[(await transcript_card(1,"player",7,"第一回合的话。")),(await transcript_card(1,"keeper",(await pyLen(pyAt(first,"rendered_text"))),"第一回合的交付。\n\n第二段。")),(await transcript_card(2,"player",7,"第二回合的话。")),(await transcript_card(2,"keeper",(await pyLen(pyAt(second,"rendered_text"))),"第二回合的交付。过了 5 分钟。")),(await transcript_card(3,"player",7,"第三回合的话。"))])),"tests/kernel/test_recall.py:37 assert default[\"cards\"] == [\n        transcript_card(1, \"player\", 7, \"第一回合的话。\"),\n        transcript_card(1, \"keeper\", len(first[\"rendered_text\"]), \"第一回合的交付。\\n\\n第二段。\"),\n        transcript_card(2, \"player\", 7, \"第二回合的话。\"),\n        transcript_card(2, \"keeper\", len(second[\"rendered_text\"]), \"第二回合的交付。过了 5 分钟。\"),\n        transcript_card(3, \"player\", 7, \"第三回合的话。\"),\n    ]");
assert.ok(pyBool(!pyContains(default_value,"entries")),"tests/kernel/test_recall.py:44 assert \"entries\" not in default");
wide=(await pyMethod(kernel,"table",["recall"],{"what":"transcript","turns":[0,3]}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(wide,"entries");return pyBool(__left)?pyEqual(pyAt(pyAt(wide,"cards"),0),(await transcript_card(0,"keeper",15,"开场。\n\n诺特把钥匙拍在桌上。"))):__left})())),"tests/kernel/test_recall.py:46 assert \"entries\" not in wide and wide[\"cards\"][0] == transcript_card(0, \"keeper\", 15, \"开场。\\n\\n诺特把钥匙拍在桌上。\")");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","role":"keeper"})),"cards"))){__rows.push(pyAt(c,"role"));}return __rows;})()),["keeper","keeper"])),"tests/kernel/test_recall.py:47 assert [c[\"role\"] for c in kernel.table(\"recall\", what=\"transcript\", role=\"keeper\")[\"cards\"]] == [\"keeper\", \"keeper\"]");
keeper=(await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:1,["role"]:"keeper"})}));
assert.ok(pyBool((await pyIsInstance((await pyMethod(keeper,"pop",["_snapshot"],{})),pyStr))),"tests/kernel/test_recall.py:50 assert isinstance(keeper.pop(\"_snapshot\"), str)");
assert.ok(pyBool(pyEqual(keeper,({["what"]:"transcript",["turn"]:1,["role"]:"keeper",["text"]:pyAt(first,"rendered_text"),["verified"]:true,["verification_scope"]:"record_integrity_only",["total_chars"]:(await pyLen(pyAt(first,"rendered_text"))),["range"]:({["offset"]:0,["end"]:(await pyLen(pyAt(first,"rendered_text")))}),["truncated"]:false}))),"tests/kernel/test_recall.py:51 assert keeper == {\"what\": \"transcript\", \"turn\": 1, \"role\": \"keeper\", \"text\": first[\"rendered_text\"], \"verified\": True,\n                      \"verification_scope\": \"record_integrity_only\", \"total_chars\": len(first[\"rendered_text\"]),\n                      \"range\": {\"offset\": 0, \"end\": len(first[\"rendered_text\"])}, \"truncated\": False}");
player=(await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:2,["role"]:"player"})}));
(await pyMethod(player,"pop",["_snapshot"],{}));
assert.ok(pyBool(pyEqual(player,({["what"]:"transcript",["turn"]:2,["role"]:"player",["text"]:"第二回合的话。",["verified"]:true,["verification_scope"]:"record_integrity_only",["total_chars"]:7,["range"]:({["offset"]:0,["end"]:7}),["truncated"]:false}))),"tests/kernel/test_recall.py:56 assert player == {\"what\": \"transcript\", \"turn\": 2, \"role\": \"player\", \"text\": \"第二回合的话。\", \"verified\": True,\n                      \"verification_scope\": \"record_integrity_only\", \"total_chars\": 7,\n                      \"range\": {\"offset\": 0, \"end\": 7}, \"truncated\": False}");
missing=(await pyMethod(kernel,"table_err",["recall"],{"what":"transcript","read":({["turn"]:3,["role"]:"keeper"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(missing,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(missing,"details"),({["turn"]:3,["role"]:"keeper"})):__left})())),"tests/kernel/test_recall.py:60 assert missing[\"code\"] == \"invalid_params\" and missing[\"details\"] == {\"turn\": 3, \"role\": \"keeper\"}");
assert.ok(pyBool(pyContains(pyAt(missing,"fix"),"card")),"tests/kernel/test_recall.py:61 assert \"card\" in missing[\"fix\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"transcript","read":({["turn"]:"1",["role"]:"keeper"})})),"code"),"invalid_params")),"tests/kernel/test_recall.py:62 assert kernel.table_err(\"recall\", what=\"transcript\", read={\"turn\": \"1\", \"role\": \"keeper\"})[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_transcript_cards_then_verified_read"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_transcript_cards_then_verified_read(await kernel(t,{}));});
export async function test_transcript_read_flags_a_row_that_drifted_from_the_turn_record(kernel:any){
let first:any,_:any,drifted:any;
const __unpack3589=(await three_turns(kernel));first=__unpack3589[0];_=__unpack3589[1];
(await rewrite_transcript(kernel.workspace,1,"keeper","第一回合的交付。\n\n被改过的第二段。"));
drifted=(await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:1,["role"]:"keeper"})}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(drifted,"verified")===false);return pyBool(__left)?pyEqual(pyAt(drifted,"text"),"第一回合的交付。\n\n被改过的第二段。"):__left})())),"tests/kernel/test_recall.py:69 assert drifted[\"verified\"] is False and drifted[\"text\"] == \"第一回合的交付。\\n\\n被改过的第二段。\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json"))),"rendered_text"),pyAt(first,"rendered_text"))),"tests/kernel/test_recall.py:70 assert read_json(campaign_dir(kernel.workspace) / \"turns\" / \"0001.json\")[\"rendered_text\"] == first[\"rendered_text\"]");
(await rewrite_transcript(kernel.workspace,2,"player","第二回合被改的话。"));
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:2,["role"]:"player"})})),"verified")===false)),"tests/kernel/test_recall.py:72 assert kernel.table(\"recall\", what=\"transcript\", read={\"turn\": 2, \"role\": \"player\"})[\"verified\"] is False");
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:2,["role"]:"keeper"})})),"verified")===true)),"tests/kernel/test_recall.py:74 assert kernel.table(\"recall\", what=\"transcript\", read={\"turn\": 2, \"role\": \"keeper\"})[\"verified\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_transcript_read_flags_a_row_that_drifted_from_the_turn_record"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_transcript_read_flags_a_row_that_drifted_from_the_turn_record(await kernel(t,{}));});
export async function history_campaign(client:any){
let roll:any,first:any,dice:any,delta:any,second:any;
(await open_turn(client,"我去档案馆。"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"}),({["kind"]:"move",["to"]:"hall-of-records",["travel_minutes"]:20})]}));
(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c2","action":({["intent"]:"investigate",["goal"]:"找档案",["method"]:"翻找",["skill"]:"Spot Hidden"})}));
roll=pyAt(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"),(-1));
first=(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c3","text":`到了（${pyAt(roll,"roll")}／${pyAt(roll,"target")}）。\n\n灰尘很厚。`}));
(await pyMethod(client,"table",["player_input"],{"text":"我推开柜子。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"damage",["dice"]:"1D3",["why"]:"柜子倒了"})]}));
const __unpack5065=pyAt((await pyMethod(client,"table",["status"],{})),"receipts");dice=__unpack5065[0];delta=__unpack5065[1];
second=(await pyMethod(client,"table",["narrate"],{"call_id":"t2-c2","text":`疼。${pyAt(dice,"total")} 点，${pyAt(delta,"before")} 到 ${pyAt(delta,"after")}。`}));
(await pyMethod(client,"table",["player_input"],{"text":"我等一下。"}));
return [first,second];
}
export async function head_of(result:any){
return pySlice((await pyMethod(" ","join",[(await pyMethod(pyAt(result,"rendered_text"),"split",[],{}))],{})),undefined,60);
}
export async function test_history_timeline_events_and_diff(kernel:any){
let first:any,second:any,hp_before:any,hp_after:any,result:any,events:any,all_types:any,moves:any,later:any,path:any,record:any;
const __unpack5445=(await history_campaign(kernel));first=__unpack5445[0];second=__unpack5445[1];
hp_before=pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json"))),"world"),"investigators"),0),"hp");
hp_after=pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0002.json"))),"world"),"investigators"),0),"hp");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(hp_before,12);return pyBool(__left)?pyLess(hp_after,hp_before):__left})())),"tests/kernel/test_recall.py:103 assert hp_before == 12 and hp_after < hp_before");
result=(await pyMethod(kernel,"table",["recall"],{"what":"history"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"what"),"history");return pyBool(__left)?pyEqual(pyAt(result,"turns"),[0,3]):__left})())),"tests/kernel/test_recall.py:106 assert result[\"what\"] == \"history\" and result[\"turns\"] == [0, 3]");
assert.ok(pyBool(pyEqual(pyAt(result,"timeline"),[({["turn"]:0,["commit"]:pyAt(pyAt(pyAt(result,"timeline"),0),"commit"),["scene"]:OPENING_SCENE,["clock"]:0,["closed_by"]:"narrate",["receipts"]:({["roll"]:0,["move"]:0,["clue"]:0,["delta"]:0,["session"]:0,["time"]:0,["clock"]:0}),["head"]:"开场。 诺特把钥匙拍在桌上。"}),({["turn"]:1,["commit"]:pyAt(first,"commit"),["scene"]:"hall-of-records",["clock"]:20,["closed_by"]:"narrate",["receipts"]:({["roll"]:1,["move"]:1,["clue"]:1,["delta"]:0,["session"]:0,["time"]:0,["clock"]:0}),["head"]:(await head_of(first))}),({["turn"]:2,["commit"]:pyAt(second,"commit"),["scene"]:"hall-of-records",["clock"]:20,["closed_by"]:"narrate",["receipts"]:({["roll"]:1,["move"]:0,["clue"]:0,["delta"]:1,["session"]:0,["time"]:0,["clock"]:0}),["head"]:(await head_of(second))})])),"tests/kernel/test_recall.py:107 assert result[\"timeline\"] == [\n        {\"turn\": 0, \"commit\": result[\"timeline\"][0][\"commit\"], \"scene\": OPENING_SCENE, \"clock\": 0, \"closed_by\": \"narrate\",\n         # §224.3: opening on Knott rolls no first impression.\n         \"receipts\": {\"roll\": 0, \"move\": 0, \"clue\": 0, \"delta\": 0, \"session\": 0, \"time\": 0, \"clock\": 0}, \"head\": \"开场。 诺特把钥匙拍在桌上。\"},\n        # §224.3: meeting the records clerk on arrival rolls nothing; turn 1's one roll is the test's own.\n        {\"turn\": 1, \"commit\": first[\"commit\"], \"scene\": \"hall-of-records\", \"clock\": 20, \"closed_by\": \"narrate\",\n         \"receipts\": {\"roll\": 1, \"move\": 1, \"clue\": 1, \"delta\": 0, \"session\": 0, \"time\": 0, \"clock\": 0}, \"head\": head_of(first)},\n        {\"turn\": 2, \"commit\": second[\"commit\"], \"scene\": \"hall-of-records\", \"clock\": 20, \"closed_by\": \"narrate\",\n         \"receipts\": {\"roll\": 1, \"move\": 0, \"clue\": 0, \"delta\": 1, \"session\": 0, \"time\": 0, \"clock\": 0}, \"head\": head_of(second)},\n    ]");
assert.ok(pyBool(pyAt(pyAt(pyAt(result,"timeline"),0),"commit")),"tests/kernel/test_recall.py:117 assert result[\"timeline\"][0][\"commit\"]");
assert.ok(pyBool(!pyContains(result,"events")),"tests/kernel/test_recall.py:118 assert \"events\" not in result");
events=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history","page":({["section"]:"events"})})),"events");
all_types=new Set((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){__rows.push(pyAt(e,"type"));}return __rows;})()));
assert.ok(pyBool(pyLessEqual(new Set(["turn-started","player-declared","scene-moved","clue-discovered","time-advanced","roll-resolved","resource-changed","turn-finalized"]),all_types)),"tests/kernel/test_recall.py:121 assert {\"turn-started\", \"player-declared\", \"scene-moved\", \"clue-discovered\", \"time-advanced\", \"roll-resolved\",\n            \"resource-changed\", \"turn-finalized\"} <= all_types");
assert.ok(pyBool(pyEqual(events,(await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))),"tests/kernel/test_recall.py:123 assert events == read_jsonl(campaign_dir(kernel.workspace) / \"events.jsonl\")");
moves=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history","types":["scene-moved"]})),"events");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(moves)){__rows.push([pyAt(e,"turn"),pyAt(pyAt(e,"data"),"to")]);}return __rows;})()),[[1,"hall-of-records"]])),"tests/kernel/test_recall.py:126 assert [(e[\"turn\"], e[\"data\"][\"to\"]) for e in moves] == [(1, \"hall-of-records\")]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history","turns":[2,2]})),"timeline"),0),"turn"),2)),"tests/kernel/test_recall.py:127 assert kernel.table(\"recall\", what=\"history\", turns=[2, 2])[\"timeline\"][0][\"turn\"] == 2");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history","turns":[2,2],"page":({["section"]:"events"})})),"events"))){__rows.push(pyEqual(pyAt(e,"turn"),2));}return __rows;})())))),"tests/kernel/test_recall.py:128 assert all(e[\"turn\"] == 2 for e in kernel.table(\"recall\", what=\"history\", turns=[2, 2], page={\"section\": \"events\"})[\"events\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"history","types":["dreamed"]})),"code"),"invalid_params")),"tests/kernel/test_recall.py:129 assert kernel.table_err(\"recall\", what=\"history\", types=[\"dreamed\"])[\"code\"] == \"invalid_params\"");
result=(await pyMethod(kernel,"table",["recall"],{"what":"history","diff":[0,2]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"from"),0);return pyBool(__left)?pyEqual(pyAt(result,"to"),2):__left})())),"tests/kernel/test_recall.py:132 assert result[\"from\"] == 0 and result[\"to\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(result,"diff"),[({["kind"]:"scene",["from"]:OPENING_SCENE,["to"]:"hall-of-records"}),({["kind"]:"clock",["from"]:0,["to"]:20}),({["kind"]:"clue",["clue"]:"knott-keys"}),({["kind"]:"resource",["subject"]:"thomas-hayes",["resource"]:"hp",["from"]:12,["to"]:hp_after}),({["kind"]:"move",["turn"]:1,["from"]:OPENING_SCENE,["to"]:"hall-of-records"})])),"tests/kernel/test_recall.py:133 assert result[\"diff\"] == [\n        {\"kind\": \"scene\", \"from\": OPENING_SCENE, \"to\": \"hall-of-records\"},\n        {\"kind\": \"clock\", \"from\": 0, \"to\": 20},\n        {\"kind\": \"clue\", \"clue\": \"knott-keys\"},\n        {\"kind\": \"resource\", \"subject\": \"thomas-hayes\", \"resource\": \"hp\", \"from\": 12, \"to\": hp_after},\n        {\"kind\": \"move\", \"turn\": 1, \"from\": OPENING_SCENE, \"to\": \"hall-of-records\"},\n    ]");
later=(await pyMethod(kernel,"table",["recall"],{"what":"history","diff":[1,2]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(later,"from"),1);return pyBool(__left)?pyEqual(pyAt(later,"to"),2):__left})())),"tests/kernel/test_recall.py:141 assert later[\"from\"] == 1 and later[\"to\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(later,"diff"),[({["kind"]:"scene",["from"]:"hall-of-records",["to"]:"hall-of-records"}),({["kind"]:"clock",["from"]:20,["to"]:20}),({["kind"]:"resource",["subject"]:"thomas-hayes",["resource"]:"hp",["from"]:12,["to"]:hp_after})])),"tests/kernel/test_recall.py:142 assert later[\"diff\"] == [\n        {\"kind\": \"scene\", \"from\": \"hall-of-records\", \"to\": \"hall-of-records\"},\n        {\"kind\": \"clock\", \"from\": 20, \"to\": 20},\n        {\"kind\": \"resource\", \"subject\": \"thomas-hayes\", \"resource\": \"hp\", \"from\": 12, \"to\": hp_after},\n    ]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"history","diff":[0,3]})),"details"),"closed_turns"),[0,1,2])),"tests/kernel/test_recall.py:147 assert kernel.table_err(\"recall\", what=\"history\", diff=[0, 3])[\"details\"][\"closed_turns\"] == [0, 1, 2]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"history","diff":[2,1]})),"code"),"invalid_params")),"tests/kernel/test_recall.py:148 assert kernel.table_err(\"recall\", what=\"history\", diff=[2, 1])[\"code\"] == \"invalid_params\"");
path=pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json");
record=(await read_json(path));
record["receipts"]=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(record,"receipts"))){if(pyBool(!pyEqual(pyAt(r,"kind"),"clue"))){__rows.push(r);}}return __rows;})());
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[record],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history","diff":[0,2]})),"diff"))){if(pyBool(pyEqual(pyAt(r,"kind"),"clue"))){__rows.push(r);}}return __rows;})()),[])),"tests/kernel/test_recall.py:154 assert [r for r in kernel.table(\"recall\", what=\"history\", diff=[0, 2])[\"diff\"] if r[\"kind\"] == \"clue\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_history_timeline_events_and_diff"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_history_timeline_events_and_diff(await kernel(t,{}));});
export async function test_recall_memory_about_takes_one_word_of_a_name_people_first(kernel:any){
let hits:any,corbitt:any,error:any;

(await _open_turn(kernel));
hits=(await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Knott"]}));
assert.ok(pyBool(pyEqual(pyAt(hits,"about"),["Steven Knott"])),pyStr("a whole word of an NPC name resolves; the clues knott-keys/knott-commission lose to the person"));
corbitt=(await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Corbitt"]}));
assert.ok(pyBool(pyEqual(pyAt(corbitt,"about"),["Walter Corbitt"])),"tests/kernel/test_recall.py:163 assert corbitt[\"about\"] == [\"Walter Corbitt\"]");
error=(await pyMethod(kernel,"table_err",["recall"],{"what":"memory","about":["Atlantis"]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"unknown_entity")),"tests/kernel/test_recall.py:165 assert error[\"code\"] == \"unknown_entity\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recall_memory_about_takes_one_word_of_a_name_people_first"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recall_memory_about_takes_one_word_of_a_name_people_first(await kernel(t,{}));});
