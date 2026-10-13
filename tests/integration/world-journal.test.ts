import {exactlyOne} from './world-native-support.ts';
// Migrated from tests/kernel/test_journal.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {MODULE,narrate,CAMPAIGN,campaign_dir,create_campaign,open_turn,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./world-native-support.ts";



let INV:any="托马斯·海斯";
let KNOTT:any="Steven Knott";
let KNOTT_ID:any="npc-steven-knott";
let CORBITT:any="Walter Corbitt";
export async function journal_dir(workspace:any){
return pyDivide((await campaign_dir(workspace)),"npc-journal");
}
export async function journal_path(workspace:any){
return pyDivide((await campaign_dir(workspace)),"npc-journal.json");
}
export async function job(client:any,params:any={}){
return (await pyMethod(client,"ok",["journal.job",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function job_err(client:any,params:any={}){
return (await pyMethod(client,"err",["journal.job",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function submit(client:any,job_id:any,entries:any){
return (await pyMethod(client,"ok",["journal.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["entries"]:entries})],{}));
}
export async function submit_err(client:any,job_id:any,entries:any){
return (await pyMethod(client,"err",["journal.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["entries"]:entries})],{}));
}
export async function close_turn(client:any,n:any,text:any="继续。"){

(await pyMethod(client,"table",["player_input"],{"text":`第 ${n} 回合。`}));
return (await narrate(client,`t${n}-c1`,text));
}
export async function first_turn(client:any){
(await open_turn(client,"我仔细观察诺特。"));
(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"看他的表情",["method"]:"心理学",["skill"]:"Psychology",["target"]:KNOTT})}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys",["label"]:"钥匙"})]}));
return (await narrate(client,"t1-c3","诺特叹了口气。\n\n他把钥匙推过来。"));
}

export async function test_job_packet_shape_and_the_closed_recordable_set(kernel:any){
let narrated:any=(await first_turn(kernel));
let packet:any=(await job(kernel));
assert.ok(pyBool(pyEqual((await pySet(packet)),new Set(["job_id","turn","commit","scene","present","investigators","player_text","keeper_text","speech","recordable","unnamed","prior","budget","instruction"]))),"tests/kernel/test_journal.py:60 assert set(packet) == {\"job_id\", \"turn\", \"commit\", \"scene\", \"present\", \"investigators\", \"player_text\",\n                           \"keeper_text\", \"speech\", \"recordable\", \"unnamed\", \"prior\", \"budget\", \"instruction\"}");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(packet,"job_id"),"journal:c1:t1");return pyBool(__left)?pyEqual(pyAt(packet,"turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(packet,"commit"),pyAt(narrated,"commit")):__left})())),"tests/kernel/test_journal.py:62 assert packet[\"job_id\"] == \"journal:c1:t1\" and packet[\"turn\"] == 1 and packet[\"commit\"] == narrated[\"commit\"]");
assert.ok(pyBool(pyEqual(pyAt(packet,"scene"),({["name"]:"commission-briefing",["display_name"]:"Knott's Office"}))),"tests/kernel/test_journal.py:63 assert packet[\"scene\"] == {\"name\": \"commission-briefing\", \"display_name\": \"Knott's Office\"}");
assert.ok(pyBool(pyEqual(pyAt(packet,"present"),[KNOTT])),"tests/kernel/test_journal.py:64 assert packet[\"present\"] == [KNOTT]");
assert.ok(pyBool(pyEqual(pyAt(packet,"investigators"),[({["id"]:"thomas-hayes",["name"]:INV})])),"tests/kernel/test_journal.py:65 assert packet[\"investigators\"] == [{\"id\": \"thomas-hayes\", \"name\": INV}]");
assert.ok(pyBool(pyEqual(pyAt(packet,"player_text"),"我仔细观察诺特。")),"tests/kernel/test_journal.py:66 assert packet[\"player_text\"] == \"我仔细观察诺特。\"");
assert.ok(pyBool(pyEqual(pyAt(packet,"keeper_text"),"诺特叹了口气。\n\n他把钥匙推过来。")),"tests/kernel/test_journal.py:67 assert packet[\"keeper_text\"] == \"诺特叹了口气。\\n\\n他把钥匙推过来。\"");
assert.ok(pyBool(pyEqual(pyAt(packet,"recordable"),[KNOTT])),"tests/kernel/test_journal.py:70 assert packet[\"recordable\"] == [KNOTT]");
assert.ok(pyBool(!pyContains(pyAt(packet,"recordable"),CORBITT)),"tests/kernel/test_journal.py:71 assert CORBITT not in packet[\"recordable\"]");
assert.ok(pyBool(pyEqual(pyAt(packet,"prior"),[])),"tests/kernel/test_journal.py:72 assert packet[\"prior\"] == []");
assert.ok(pyBool(pyEqual(pyAt(packet,"unnamed"),[KNOTT])),"tests/kernel/test_journal.py:75 assert packet[\"unnamed\"] == [KNOTT]");
assert.ok(pyBool(pyEqual(pyAt(packet,"budget"),({["max_entries"]:6,["max_description_chars"]:300,["max_exchange_chars"]:200,["max_label_chars"]:60,["max_named_quote_chars"]:200}))),"tests/kernel/test_journal.py:76 assert packet[\"budget\"] == {\"max_entries\": 6, \"max_description_chars\": 300, \"max_exchange_chars\": 200,\n                                \"max_label_chars\": 60, \"max_named_quote_chars\": 200}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(packet,"instruction"),"recordable");return pyBool(__left)?pyContains(pyAt(packet,"instruction"),"zh-Hans"):__left})())),"tests/kernel/test_journal.py:78 assert \"recordable\" in packet[\"instruction\"] and \"zh-Hans\" in packet[\"instruction\"]");
let stored:any=(await read_json(pyDivide(pyDivide((await journal_dir(kernel.workspace)),"jobs"),"journal:c1:t1.json")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(stored,"status"),"open");return pyBool(__left)?pyEqual(pyAt(pyAt(stored,"packet"),"job_id"),"journal:c1:t1"):__left})())),"tests/kernel/test_journal.py:80 assert stored[\"status\"] == \"open\" and stored[\"packet\"][\"job_id\"] == \"journal:c1:t1\"");
assert.ok(pyBool(pyEqual(pyAt((await job_err(kernel,({"turn":9}))),"code"),"invalid_params")),"tests/kernel/test_journal.py:82 assert job_err(kernel, turn=9)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await job_err(kernel,({"turn":9}))),"details"),"committed_turns"),[0,1])),"tests/kernel/test_journal.py:83 assert job_err(kernel, turn=9)[\"details\"][\"committed_turns\"] == [0, 1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_job_packet_shape_and_the_closed_recordable_set"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_job_packet_shape_and_the_closed_recordable_set(await kernel(t,{}));});
export async function test_recordable_also_covers_receipt_references_and_journal_names(kernel:any){

(await open_turn(kernel,"我接过那封信。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission",["from"]:CORBITT})]}));
(await narrate(kernel,"t1-c2","诺特把委托说清楚了，信是科比特写的。"));
let packet:any=(await job(kernel,({"turn":1})));
assert.ok(pyBool(pyEqual(pyAt(packet,"recordable"),[KNOTT,CORBITT])),pyStr("present ∪ receipt-referenced"));
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:CORBITT,["label"]:"写信的人",["description"]:"写信的人。",["exchange"]:"他的信到了调查员手上。"})]));
(await close_turn(kernel,2));
packet=(await job(kernel,({"turn":2})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"present"),[KNOTT]);return pyBool(__left)?pyEqual(pyAt(packet,"recordable"),[KNOTT,CORBITT]):__left})())),pyStr("turn 2 has no receipt naming Corbitt: he is recordable only through the journal"));
assert.ok(pyBool(pyEqual(pyAt(packet,"prior"),[({["name"]:CORBITT,["label"]:"写信的人",["description"]:"写信的人。",["last_seen_turn"]:1})])),"tests/kernel/test_journal.py:102 assert packet[\"prior\"] == [{\"name\": CORBITT, \"label\": \"写信的人\", \"description\": \"写信的人。\", \"last_seen_turn\": 1}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recordable_also_covers_receipt_references_and_journal_names"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recordable_also_covers_receipt_references_and_journal_names(await kernel(t,{}));});

export async function test_submit_merges_entries_and_counts_a_turn_once(kernel:any){
(await first_turn(kernel));
let result:any=(await submit(kernel,"journal:c1:t1",[({["name"]:KNOTT,["named"]:true,["named_quote"]:"诺特叹了口气。",["named_as"]:"诺特",["description"]:"房东先生，有些心不在焉。",["exchange"]:"他把钥匙推过来。"}),({["name"]:KNOTT,["exchange"]:"他叹了口气。"})]));
assert.ok(pyBool(pyEqual(result,({["job_id"]:"journal:c1:t1",["turn"]:1,["entries"]:2}))),"tests/kernel/test_journal.py:114 assert result == {\"job_id\": \"journal:c1:t1\", \"turn\": 1, \"entries\": 2}");
let entries:any=pyAt((await read_json((await journal_path(kernel.workspace)))),"entries");
assert.ok(pyBool(pyEqual((await pyList(entries)),[KNOTT_ID])),"tests/kernel/test_journal.py:116 assert list(entries) == [KNOTT_ID]");
let knott:any=pyAt(entries,KNOTT_ID);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knott,"name"),KNOTT);return pyBool(__left)?pyEqual(pyAt(knott,"description"),"房东先生，有些心不在焉。"):__left})())),"tests/kernel/test_journal.py:118 assert knott[\"name\"] == KNOTT and knott[\"description\"] == \"房东先生，有些心不在焉。\"");
assert.ok(pyBool(pyEqual([pyAt(knott,"first_seen_turn"),pyAt(knott,"last_seen_turn"),pyAt(knott,"seen_count")],[1,1,1])),"tests/kernel/test_journal.py:119 assert (knott[\"first_seen_turn\"], knott[\"last_seen_turn\"], knott[\"seen_count\"]) == (1, 1, 1)");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(knott,"exchanges"))){if(pyBool(true))__rows.push(pyAt(e,"summary"));}return __rows;})()),["他把钥匙推过来。","他叹了口气。"])),"tests/kernel/test_journal.py:120 assert [e[\"summary\"] for e in knott[\"exchanges\"]] == [\"他把钥匙推过来。\", \"他叹了口气。\"]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(knott,"exchanges"))){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(e,"turn"),1);return pyBool(__left)?pyEqual(pyAt(e,"scene"),"Knott's Office"):__left})()));}return __rows;})())))),"tests/kernel/test_journal.py:121 assert all(e[\"turn\"] == 1 and e[\"scene\"] == \"Knott's Office\" for e in knott[\"exchanges\"])");
(await close_turn(kernel,2));
(await submit(kernel,"journal:c1:t2",[({["name"]:KNOTT,["exchange"]:"他又点点头。"})]));
knott=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool(pyEqual([pyAt(knott,"first_seen_turn"),pyAt(knott,"last_seen_turn"),pyAt(knott,"seen_count")],[1,2,2])),"tests/kernel/test_journal.py:126 assert (knott[\"first_seen_turn\"], knott[\"last_seen_turn\"], knott[\"seen_count\"]) == (1, 2, 2)");
assert.ok(pyBool(pyEqual(pyAt(knott,"description"),"房东先生，有些心不在焉。")),"tests/kernel/test_journal.py:127 assert knott[\"description\"] == \"房东先生，有些心不在焉。\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(knott,"exchanges"))){if(pyBool(true))__rows.push(pyAt(e,"turn"));}return __rows;})()),[1,1,2])),"tests/kernel/test_journal.py:128 assert [e[\"turn\"] for e in knott[\"exchanges\"]] == [1, 1, 2]");
(await close_turn(kernel,3));
(await submit(kernel,"journal:c1:t3",[({["name"]:KNOTT,["description"]:"焦虑的房东。"})]));
knott=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knott,"description"),"焦虑的房东。");return pyBool(__left)?pyEqual(pyAt(knott,"seen_count"),3):__left})())),"tests/kernel/test_journal.py:133 assert knott[\"description\"] == \"焦虑的房东。\" and knott[\"seen_count\"] == 3");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(knott,"exchanges"))),3)),pyStr("no exchange given this turn: nothing appended"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_submit_merges_entries_and_counts_a_turn_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_submit_merges_entries_and_counts_a_turn_once(await kernel(t,{}));});

export async function test_each_rejection_points_at_the_entry_and_nothing_lands(kernel:any){
(await first_turn(kernel));
let job_id:any=pyAt((await job(kernel)),"job_id");
let ok:any=({["name"]:KNOTT,["named"]:true,["named_quote"]:"诺特叹了口气。",["named_as"]:"诺特",["exchange"]:"点头。"});
let cases:any=[["unknown field",[({...ok,["mood"]:"happy"})],0,"mood"],["machine key",[({...ok,["turn"]:1})],0,"turn"],["machine key id",[({...ok,["id"]:"npc-x"})],0,"id"],["not recordable",[({["name"]:CORBITT,["exchange"]:"x"})],0,KNOTT],["empty name",[({["name"]:"  ",["exchange"]:"x"})],0,KNOTT],["description too long",[({...ok,["description"]:pyMultiply("长",301)})],0,"300"],["exchange too long",[({...ok,["exchange"]:pyMultiply("长",201)})],0,"200"],["one bad row spoils the batch",[ok,({["name"]:CORBITT})],1,CORBITT]];
for(const [label,entries,index,named] of pyIterable(cases)){
let error:any=(await submit_err(kernel,job_id,entries));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr(label));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"index"),index)),pyStr(label));
assert.ok(pyBool(pyContains(pyAdd(((await (async()=>{const __left=(await pyMethod(error,"get",["fix"],{}));return pyBool(__left)?__left:""})())),pyAt(error,"message")),named)),pyStr([label,error]));
}
let unrecordable:any=(await submit_err(kernel,job_id,[({["name"]:CORBITT,["exchange"]:"x"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(unrecordable,"details"),"recordable"),[KNOTT]);return pyBool(__left)?pyContains(pyAt(unrecordable,"fix"),KNOTT):__left})())),"tests/kernel/test_journal.py:159 assert unrecordable[\"details\"][\"recordable\"] == [KNOTT] and KNOTT in unrecordable[\"fix\"]");
assert.ok(pyBool(!pyBool((await pyMethod((await journal_path(kernel.workspace)),"exists",[],{})))),"tests/kernel/test_journal.py:161 assert not journal_path(kernel.workspace).exists()");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await journal_dir(kernel.workspace)),"jobs"),`${job_id}.json`))),"status"),"open")),"tests/kernel/test_journal.py:162 assert read_json(journal_dir(kernel.workspace) / \"jobs\" / f\"{job_id}.json\")[\"status\"] == \"open\"");
let backlog:any=(await read_jsonl(pyDivide((await journal_dir(kernel.workspace)),"backlog.jsonl")));
assert.ok(pyBool(pyEqual((await pyLen(backlog)),pyAdd((await pyLen(cases)),1))),"tests/kernel/test_journal.py:164 assert len(backlog) == len(cases) + 1");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(backlog)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"job_id"),job_id);return pyBool(__left)?pyEqual(pyAt(r,"turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(r,"reason"),"invalid"):__left})());return pyBool(__left)?pyEqual(pyAt(r,"status"),"pending"):__left})()));}return __rows;})())))),"tests/kernel/test_journal.py:165 assert all(r[\"job_id\"] == job_id and r[\"turn\"] == 1 and r[\"reason\"] == \"invalid\" and r[\"status\"] == \"pending\"\n               for r in backlog)");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),0)),"tests/kernel/test_journal.py:167 assert job(kernel)[\"turn\"] == 0");
let result:any=(await submit(kernel,job_id,[ok,({["name"]:KNOTT,["description"]:"房东。"})]));
assert.ok(pyBool(pyEqual(pyAt(result,"entries"),2)),"tests/kernel/test_journal.py:170 assert result[\"entries\"] == 2");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await read_jsonl(pyDivide((await journal_dir(kernel.workspace)),"backlog.jsonl"))))){if(pyBool(true))__rows.push(pyAt(r,"status"));}return __rows;})())),new Set(["recovered"]))),"tests/kernel/test_journal.py:171 assert {r[\"status\"] for r in read_jsonl(journal_dir(kernel.workspace) / \"backlog.jsonl\")} == {\"recovered\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_each_rejection_points_at_the_entry_and_nothing_lands"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_each_rejection_points_at_the_entry_and_nothing_lands(await kernel(t,{}));});
export async function test_replay_is_idempotent_and_divergence_conflicts(kernel:any){
(await first_turn(kernel));
let entries:any=[({["name"]:KNOTT,["named"]:true,["named_quote"]:"诺特叹了口气。",["named_as"]:"诺特",["description"]:"房东。",["exchange"]:"给了钥匙。"})];
let first:any=(await submit(kernel,"journal:c1:t1",entries));
let again:any=(await submit(kernel,"journal:c1:t1",entries));
assert.ok(pyBool(pyEqual(again,({...first,["replayed"]:true}))),"tests/kernel/test_journal.py:179 assert again == {**first, \"replayed\": True}");
let knott:any=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knott,"seen_count"),1);return pyBool(__left)?pyEqual((await pyLen(pyAt(knott,"exchanges"))),1):__left})())),pyStr("a replay merges nothing twice"));
let written:any=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),"journal-written")))__rows.push(e);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(written)),1);return pyBool(__left)?pyEqual(pyAt(pyAt(written,0),"turn"),1):__left})())),"tests/kernel/test_journal.py:184 assert len(written) == 1 and written[0][\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(written,0),"data"),({["job_id"]:"journal:c1:t1",["turn"]:1,["entries"]:1}))),"tests/kernel/test_journal.py:185 assert written[0][\"data\"] == {\"job_id\": \"journal:c1:t1\", \"turn\": 1, \"entries\": 1}");
let conflict:any=(await submit_err(kernel,"journal:c1:t1",[({["name"]:KNOTT,["exchange"]:"别的话。"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(conflict,"code"),"idempotency_conflict");return pyBool(__left)?pyEqual(pyAt(pyAt(conflict,"details"),"job_id"),"journal:c1:t1"):__left})())),"tests/kernel/test_journal.py:187 assert conflict[\"code\"] == \"idempotency_conflict\" and conflict[\"details\"][\"job_id\"] == \"journal:c1:t1\"");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,"journal:c9:t1",entries)),"code"),"invalid_params")),"tests/kernel/test_journal.py:188 assert submit_err(kernel, \"journal:c9:t1\", entries)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,"journal:c1:t7",entries)),"code"),"invalid_params")),"tests/kernel/test_journal.py:189 assert submit_err(kernel, \"journal:c1:t7\", entries)[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_replay_is_idempotent_and_divergence_conflicts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_replay_is_idempotent_and_divergence_conflicts(await kernel(t,{}));});

export async function test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it(kernel:any){
(await first_turn(kernel));
(await close_turn(kernel,2));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),2)),"tests/kernel/test_journal.py:197 assert job(kernel)[\"turn\"] == 2");
let failed:any=(await pyMethod(kernel,"ok",["journal.fail",({["campaign"]:CAMPAIGN,["job_id"]:"journal:c1:t2",["reason"]:"model_error",["detail"]:"timeout after 60s"})],{}));
assert.ok(pyBool(pyEqual(failed,({["job_id"]:"journal:c1:t2",["turn"]:2,["status"]:"pending",["reason"]:"model_error"}))),"tests/kernel/test_journal.py:200 assert failed == {\"job_id\": \"journal:c1:t2\", \"turn\": 2, \"status\": \"pending\", \"reason\": \"model_error\"}");
let backlog:any=(await read_jsonl(pyDivide((await journal_dir(kernel.workspace)),"backlog.jsonl")));
assert.ok(pyBool(pyEqual(backlog,[({...pyAt(backlog,0),["job_id"]:"journal:c1:t2",["turn"]:2,["reason"]:"model_error",["detail"]:"timeout after 60s",["status"]:"pending"})])),"tests/kernel/test_journal.py:202 assert backlog == [{**backlog[0], \"job_id\": \"journal:c1:t2\", \"turn\": 2, \"reason\": \"model_error\",\n                        \"detail\": \"timeout after 60s\", \"status\": \"pending\"}]");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await journal_dir(kernel.workspace)),"jobs"),"journal:c1:t2.json"))),"status"),"failed")),"tests/kernel/test_journal.py:204 assert read_json(journal_dir(kernel.workspace) / \"jobs\" / \"journal:c1:t2.json\")[\"status\"] == \"failed\"");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),1)),"tests/kernel/test_journal.py:205 assert job(kernel)[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel,({"turn":2}))),"job_id"),"journal:c1:t2")),"tests/kernel/test_journal.py:206 assert job(kernel, turn=2)[\"job_id\"] == \"journal:c1:t2\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["journal.fail",({["campaign"]:CAMPAIGN,["job_id"]:"journal:c1:t2",["reason"]:"bored"})],{})),"code"),"invalid_params")),"tests/kernel/test_journal.py:207 assert kernel.err(\"journal.fail\", {\"campaign\": CAMPAIGN, \"job_id\": \"journal:c1:t2\", \"reason\": \"bored\"})[\"code\"] == \"invalid_params\"");
(await submit(kernel,"journal:c1:t2",[]));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await read_jsonl(pyDivide((await journal_dir(kernel.workspace)),"backlog.jsonl"))),0),"status"),"recovered")),"tests/kernel/test_journal.py:209 assert read_jsonl(journal_dir(kernel.workspace) / \"backlog.jsonl\")[0][\"status\"] == \"recovered\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await journal_dir(kernel.workspace)),"jobs"),"journal:c1:t2.json"))),"status"),"done")),"tests/kernel/test_journal.py:210 assert read_json(journal_dir(kernel.workspace) / \"jobs\" / \"journal:c1:t2.json\")[\"status\"] == \"done\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it(await kernel(t,{}));});

export async function test_table_view_projects_the_journal_for_the_player(kernel:any){
(await first_turn(kernel));
(await submit(kernel,"journal:c1:t1",[({["name"]:KNOTT,["named"]:true,["named_quote"]:"诺特叹了口气。",["named_as"]:"诺特",["description"]:"房东先生。",["exchange"]:"他把钥匙推过来。"})]));
let path:any=(await journal_path(kernel.workspace));
let data:any=(await read_json(path));
pyAt(pyAt(data,"entries"),KNOTT_ID)["exchanges"]=(await (async()=>{const __rows:any[]=[];for(const t of pyIterable((await pyRange(1,9)))){if(pyBool(true))__rows.push(({["turn"]:t,["scene"]:"Knott's Office",["summary"]:`第 ${t} 句。`}));}return __rows;})());
pyAt(data,"entries")["npc-walter-corbitt"]=({["name"]:CORBITT,["description"]:"只闻其名。",["first_seen_turn"]:3,["last_seen_turn"]:3,["seen_count"]:1,["exchanges"]:[]});
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[data],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
let ledger_path:any=pyDivide((await campaign_dir(kernel.workspace)),"npc-ledger.json");
let ledger:any=(pyBool((await pyMethod(ledger_path,"exists",[],{})))?(await read_json(ledger_path)):({}));
(await pyMethod(ledger,"setdefault",[KNOTT_ID,({})],{}))["dead"]=({["turn"]:5});
(await pyMethod(ledger_path,"write_text",[(await pyMethod(json,"dumps",[ledger],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
let journal:any=pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(journal)){if(pyBool(true))__rows.push(pyAt(e,"name"));}return __rows;})()),[CORBITT,KNOTT])),pyStr("newest last_seen_turn first"));
let [corbitt,knott]=journal;
assert.ok(pyBool(pyEqual((await pySet(corbitt)),new Set(["id","name","named","description","seen_count","last_seen_turn","exchanges"]))),"tests/kernel/test_journal.py:236 assert set(corbitt) == {\"id\", \"name\", \"named\", \"description\", \"seen_count\", \"last_seen_turn\", \"exchanges\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(corbitt,"id"),"walter-corbitt");return pyBool(__left)?pyEqual(pyAt(knott,"id"),"steven-knott"):__left})())),"tests/kernel/test_journal.py:237 assert corbitt[\"id\"] == \"walter-corbitt\" and knott[\"id\"] == \"steven-knott\"");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(corbitt,"named")===true);return pyBool(__left)?(pyAt(knott,"named")===true):__left})())),"tests/kernel/test_journal.py:239 assert corbitt[\"named\"] is True and knott[\"named\"] is True");
assert.ok(pyBool(!pyContains(corbitt,"dead_since_turn")),"tests/kernel/test_journal.py:240 assert \"dead_since_turn\" not in corbitt");
assert.ok(pyBool(pyEqual((await pySet(knott)),new Set(["id","name","named","description","seen_count","last_seen_turn","dead_since_turn","exchanges"]))),"tests/kernel/test_journal.py:241 assert set(knott) == {\"id\", \"name\", \"named\", \"description\", \"seen_count\", \"last_seen_turn\", \"dead_since_turn\", \"exchanges\"}");
assert.ok(pyBool(pyEqual(pyAt(knott,"dead_since_turn"),5)),"tests/kernel/test_journal.py:242 assert knott[\"dead_since_turn\"] == 5");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knott,"seen_count"),1);return pyBool(__left)?pyEqual(pyAt(knott,"last_seen_turn"),1):__left})())),"tests/kernel/test_journal.py:243 assert knott[\"seen_count\"] == 1 and knott[\"last_seen_turn\"] == 1");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(knott,"exchanges"))){if(pyBool(true))__rows.push(pyAt(e,"turn"));}return __rows;})()),[8,7,6,5,4,3])),pyStr("at most six, newest first"));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(knott,"exchanges"))){if(pyBool(true))__rows.push(pyEqual((await pySet(e)),new Set(["turn","scene","summary"])));}return __rows;})())))),"tests/kernel/test_journal.py:245 assert all(set(e) == {\"turn\", \"scene\", \"summary\"} for e in knott[\"exchanges\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_view_projects_the_journal_for_the_player"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_view_projects_the_journal_for_the_player(await kernel(t,{}));});
export async function test_table_view_setting_up_has_the_empty_journal_shape(kernel:any){
let created:any=(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:MODULE,["play_language"]:"zh-Hans"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(created,"campaign"),"status"),"setting_up")),"tests/kernel/test_journal.py:250 assert created[\"campaign\"][\"status\"] == \"setting_up\"");
let view:any=(await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(view,"state"),"setting_up");return pyBool(__left)?pyEqual(pyAt(view,"npcs"),({["journal"]:[]})):__left})())),"tests/kernel/test_journal.py:252 assert view[\"state\"] == \"setting_up\" and view[\"npcs\"] == {\"journal\": []}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_view_setting_up_has_the_empty_journal_shape"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_view_setting_up_has_the_empty_journal_shape(await kernel(t,{}));});

export async function test_a_person_the_prose_never_named_is_journaled_under_a_label(kernel:any){

(await first_turn(kernel));
let packet:any=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"unnamed"),[KNOTT])),"tests/kernel/test_journal.py:264 assert packet[\"unnamed\"] == [KNOTT]");
let missing:any=(await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["description"]:"办公桌后的男人。"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(missing,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(missing,"details"),({["index"]:0,["field"]:"label",["name"]:KNOTT,["unnamed"]:[KNOTT]})):__left})())),"tests/kernel/test_journal.py:268 assert missing[\"code\"] == \"invalid_params\" and missing[\"details\"] == {\"index\": 0, \"field\": \"label\", \"name\": KNOTT, \"unnamed\": [KNOTT]}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(missing,"fix"),"label");return pyBool(__left)?pyContains(pyAt(missing,"fix"),"named"):__left})())),"tests/kernel/test_journal.py:269 assert \"label\" in missing[\"fix\"] and \"named\" in missing[\"fix\"]");
let carrying:any=(await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["label"]:`${KNOTT} at the desk`})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(carrying,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(carrying,"details"),({["index"]:0,["field"]:"label",["name"]:KNOTT})):__left})())),"tests/kernel/test_journal.py:271 assert carrying[\"code\"] == \"invalid_params\" and carrying[\"details\"] == {\"index\": 0, \"field\": \"label\", \"name\": KNOTT}");
let described:any=(await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["label"]:"办公桌后的男人",["description"]:`${KNOTT} 坐在桌后。`})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(described,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(described,"details"),"field"),"description"):__left})())),"tests/kernel/test_journal.py:273 assert described[\"code\"] == \"invalid_params\" and described[\"details\"][\"field\"] == \"description\"");
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["label"]:"办公桌后的男人",["description"]:"戴着遮阳帽舌的男子。",["exchange"]:"他把钥匙推过来。"})]));
let stored:any=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(stored,"name"),KNOTT);return pyBool(__left)?pyEqual(pyAt(stored,"label"),"办公桌后的男人"):__left})());return pyBool(__left)?!pyContains(stored,"named_at"):__left})())),"tests/kernel/test_journal.py:276 assert stored[\"name\"] == KNOTT and stored[\"label\"] == \"办公桌后的男人\" and \"named_at\" not in stored");
let [knott]=exactlyOne(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(knott,"id"),"steven-knott");return pyBool(__left)?pyEqual(pyAt(knott,"name"),"办公桌后的男人"):__left})());return pyBool(__left)?(pyAt(knott,"named")===false):__left})())),"tests/kernel/test_journal.py:279 assert knott[\"id\"] == \"steven-knott\" and knott[\"name\"] == \"办公桌后的男人\" and knott[\"named\"] is False");
(await pyMethod(kernel,"table",["player_input"],{"text":"我等他开口。"}));
let capsule:any=(await pyMethod(kernel,"table",["look"],{"focus":"npc"}));
let [present]=exactlyOne(pyAt(capsule,"present"));
assert.ok(pyBool(pyEqual(pyAt(present,"name"),KNOTT)),"tests/kernel/test_journal.py:284 assert present[\"name\"] == KNOTT");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(present,"untold"),"label"),"办公桌后的男人");return pyBool(__left)?pyContains(pyAt(pyAt(present,"untold"),"use"),"say token"):__left})())),"tests/kernel/test_journal.py:285 assert present[\"untold\"][\"label\"] == \"办公桌后的男人\" and \"say token\" in present[\"untold\"][\"use\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold"),"label"),"办公桌后的男人")),"tests/kernel/test_journal.py:286 assert kernel.table(\"look\", focus=\"npc\", name=KNOTT)[\"untold\"][\"label\"] == \"办公桌后的男人\"");
(await narrate(kernel,"t2-c1",`${KNOTT} 终于站起来，自报了姓名。`));
packet=(await job(kernel,({"turn":2})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"unnamed"),[]);return pyBool(__left)?pyEqual(pyAt(packet,"prior"),[({["name"]:KNOTT,["description"]:"戴着遮阳帽舌的男子。",["last_seen_turn"]:1})]):__left})())),"tests/kernel/test_journal.py:291 assert packet[\"unnamed\"] == [] and packet[\"prior\"] == [{\"name\": KNOTT, \"description\": \"戴着遮阳帽舌的男子。\", \"last_seen_turn\": 1}]");
let named_already:any=(await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["label"]:"另一个称谓"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(named_already,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(named_already,"details"),({["index"]:0,["field"]:"label",["name"]:KNOTT,["unnamed"]:[]})):__left})())),"tests/kernel/test_journal.py:293 assert named_already[\"code\"] == \"invalid_params\" and named_already[\"details\"] == {\"index\": 0, \"field\": \"label\", \"name\": KNOTT, \"unnamed\": []}");
(await submit(kernel,pyAt(packet,"job_id"),[]));
stored=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(stored,"named_at"),2);return pyBool(__left)?pyEqual(pyAt(stored,"label"),"办公桌后的男人"):__left})())),pyStr("the label stays on file; the name takes over the card"));
[knott]=exactlyOne(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knott,"name"),KNOTT);return pyBool(__left)?(pyAt(knott,"named")===true):__left})())),"tests/kernel/test_journal.py:298 assert knott[\"name\"] == KNOTT and knott[\"named\"] is True");
(await pyMethod(kernel,"table",["player_input"],{"text":"我点头。"}));
[present]=exactlyOne(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc"})),"present"));
assert.ok(pyBool(!pyContains(present,"untold")),"tests/kernel/test_journal.py:301 assert \"untold\" not in present");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_person_the_prose_never_named_is_journaled_under_a_label"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_person_the_prose_never_named_is_journaled_under_a_label(await kernel(t,{}));});
export async function test_the_lane_can_name_a_person_the_scan_cannot_see(kernel:any){

(await first_turn(kernel));
(await submit(kernel,"journal:c1:t1",[({["name"]:KNOTT,["label"]:"办公桌后的男人",["description"]:"戴着遮阳帽舌的男子。"})]));
(await close_turn(kernel,2,"诺特自报了姓名。"));
let packet:any=(await job(kernel,({"turn":2})));
assert.ok(pyBool(pyEqual(pyAt(packet,"unnamed"),[KNOTT])),pyStr("诺特 is not a word the scan reads as the name"));
assert.ok(pyBool(pyEqual(pyAt(packet,"prior"),[({["name"]:KNOTT,["label"]:"办公桌后的男人",["description"]:"戴着遮阳帽舌的男子。",["last_seen_turn"]:1})])),"tests/kernel/test_journal.py:312 assert packet[\"prior\"] == [{\"name\": KNOTT, \"label\": \"办公桌后的男人\", \"description\": \"戴着遮阳帽舌的男子。\", \"last_seen_turn\": 1}]");
let wrong:any=(await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["named"]:"yes"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(wrong,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(wrong,"details"),({["index"]:0,["field"]:"named"})):__left})())),"tests/kernel/test_journal.py:314 assert wrong[\"code\"] == \"invalid_params\" and wrong[\"details\"] == {\"index\": 0, \"field\": \"named\"}");
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["named"]:true,["named_quote"]:"诺特自报了姓名。",["named_as"]:"诺特",["exchange"]:"他说了自己的名字。"})]));
let stored:any=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool(pyEqual(pyAt(stored,"named_at"),2)),"tests/kernel/test_journal.py:317 assert stored[\"named_at\"] == 2");
let [knott]=exactlyOne(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knott,"name"),KNOTT);return pyBool(__left)?(pyAt(knott,"named")===true):__left})())),"tests/kernel/test_journal.py:319 assert knott[\"name\"] == KNOTT and knott[\"named\"] is True");
(await close_turn(kernel,3));
packet=(await job(kernel,({"turn":3})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"unnamed"),[]);return pyBool(__left)?!pyContains(pyAt(pyAt(packet,"prior"),0),"label"):__left})())),"tests/kernel/test_journal.py:322 assert packet[\"unnamed\"] == [] and \"label\" not in packet[\"prior\"][0]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["label"]:"那个人"})])),"details"),"field"),"label")),"tests/kernel/test_journal.py:324 assert submit_err(kernel, packet[\"job_id\"], [{\"name\": KNOTT, \"label\": \"那个人\"}])[\"details\"][\"field\"] == \"label\"");
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["exchange"]:"他又点点头。"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at"),2)),"tests/kernel/test_journal.py:326 assert read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID][\"named_at\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_lane_can_name_a_person_the_scan_cannot_see"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_lane_can_name_a_person_the_scan_cannot_see(await kernel(t,{}));});
export async function test_named_needs_the_words_that_named_them(kernel:any){

(await first_turn(kernel));
let job_id:any=pyAt((await job(kernel)),"job_id");
let both:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["label"]:"办公桌后的男人",["named"]:true,["named_quote"]:"诺特叹了口气。"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(both,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(both,"details"),({["index"]:0,["field"]:"label",["name"]:KNOTT})):__left})())),"tests/kernel/test_journal.py:337 assert both[\"code\"] == \"invalid_params\" and both[\"details\"] == {\"index\": 0, \"field\": \"label\", \"name\": KNOTT}");
let bare:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["named"]:true,["exchange"]:"点头。"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(bare,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(bare,"details"),({["index"]:0,["field"]:"named_quote",["name"]:KNOTT})):__left})())),"tests/kernel/test_journal.py:339 assert bare[\"code\"] == \"invalid_params\" and bare[\"details\"] == {\"index\": 0, \"field\": \"named_quote\", \"name\": KNOTT}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(bare,"fix"),"named_quote");return pyBool(__left)?pyContains(pyAt(bare,"fix"),"label"):__left})())),"tests/kernel/test_journal.py:340 assert \"named_quote\" in bare[\"fix\"] and \"label\" in bare[\"fix\"]");
let elsewhere:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["named"]:true,["named_quote"]:"我叫史蒂文·诺特。"})]));
assert.ok(pyBool(pyEqual(pyAt(elsewhere,"details"),({["index"]:0,["field"]:"named_quote",["name"]:KNOTT}))),pyStr("words the delivery does not contain"));
let stray:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["label"]:"办公桌后的男人",["named_quote"]:"诺特叹了口气。"})]));
assert.ok(pyBool(pyEqual(pyAt(stray,"details"),({["index"]:0,["field"]:"named_quote"}))),"tests/kernel/test_journal.py:344 assert stray[\"details\"] == {\"index\": 0, \"field\": \"named_quote\"}");
assert.ok(pyBool(!pyBool((await pyMethod((await journal_path(kernel.workspace)),"exists",[],{})))),pyStr("nothing landed"));
assert.ok(pyBool(pyContains((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold")),pyStr("still untold: the Keeper is still not given the name"));
(await close_turn(kernel,2,"他抬起头：“叫我诺特就行。”"));
(await submit(kernel,job_id,[({["name"]:KNOTT,["label"]:"办公桌后的男人",["description"]:"戴着遮阳帽舌的男子。"})]));
let packet:any=(await job(kernel,({"turn":2})));
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["named"]:true,["named_quote"]:"\"叫我诺特就行。\"",["named_as"]:"诺特"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at"),2)),"tests/kernel/test_journal.py:352 assert read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID][\"named_at\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_named_needs_the_words_that_named_them"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_named_needs_the_words_that_named_them(await kernel(t,{}));});
export async function test_a_name_the_book_does_not_give_them_is_asked_about_once(kernel:any){

(await open_turn(kernel,"我问他怎么称呼。"));
(await narrate(kernel,"t1-c1","他擦了擦眼镜：“叫我沃尔特就行。”"));
let job_id:any=pyAt((await job(kernel)),"job_id");
let other:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["named"]:true,["named_quote"]:"“叫我沃尔特就行。”"})]));
assert.ok(pyBool(pyEqual(pyAt(other,"code"),"invalid_params")),"tests/kernel/test_journal.py:365 assert other[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(other,"details"),({["index"]:0,["field"]:"named_as",["name"]:KNOTT,["reason"]:"not_a_book_name"}))),"tests/kernel/test_journal.py:366 assert other[\"details\"] == {\"index\": 0, \"field\": \"named_as\", \"name\": KNOTT, \"reason\": \"not_a_book_name\"}");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyContains(pyAt(other,"fix"),"another spelling, script or transliteration");return pyBool(__left)?pyContains(pyAt(other,"fix"),"a different name"):__left})());return pyBool(__left)?pyContains(pyAt(other,"fix"),"leave named out"):__left})())),"tests/kernel/test_journal.py:367 assert \"another spelling, script or transliteration\" in other[\"fix\"] and \"a different name\" in other[\"fix\"] and \"leave named out\" in other[\"fix\"]");
let stray:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["named"]:true,["named_quote"]:"“叫我沃尔特就行。”",["named_as"]:"诺特"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(stray,"details"),"field"),"named_as")),pyStr("named_as must be words of the quote"));
let lone:any=(await submit_err(kernel,job_id,[({["name"]:KNOTT,["label"]:"擦眼镜的房东",["named_as"]:"沃尔特"})]));
assert.ok(pyBool(pyEqual(pyAt(lone,"details"),({["index"]:0,["field"]:"named_as"}))),pyStr("named_as goes only with named"));
(await submit(kernel,job_id,[({["name"]:KNOTT,["label"]:"擦眼镜的房东",["exchange"]:"他说可以叫他沃尔特。"})]));
assert.ok(pyBool(!pyContains(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at")),"tests/kernel/test_journal.py:374 assert \"named_at\" not in read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID]");
assert.ok(pyBool(pyContains((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold")),pyStr("the Keeper is still not handed the book's name"));
(await close_turn(kernel,2,"他点点头：“我是Steven Knott。”"));
assert.ok(pyBool(!pyContains((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold")),"tests/kernel/test_journal.py:378 assert \"untold\" not in kernel.table(\"look\", focus=\"npc\", name=KNOTT)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_name_the_book_does_not_give_them_is_asked_about_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_name_the_book_does_not_give_them_is_asked_about_once(await kernel(t,{}));});
export async function test_a_name_in_another_script_is_taken_with_its_words(kernel:any){

(await open_turn(kernel,"我问他怎么称呼。"));
(await narrate(kernel,"t1-c1","他擦了擦眼镜：“叫我诺特就行。”"));
let job_id:any=pyAt((await job(kernel)),"job_id");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await submit_err(kernel,job_id,[({["name"]:KNOTT,["named"]:true,["named_quote"]:"“叫我诺特就行。”"})])),"details"),"reason"),"not_a_book_name")),"tests/kernel/test_journal.py:386 assert submit_err(kernel, job_id, [{\"name\": KNOTT, \"named\": True, \"named_quote\": \"“叫我诺特就行。”\"}])[\"details\"][\"reason\"] == \"not_a_book_name\"");
(await submit(kernel,job_id,[({["name"]:KNOTT,["named"]:true,["named_quote"]:"“叫我诺特就行。”",["named_as"]:"诺特"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at"),1)),"tests/kernel/test_journal.py:388 assert read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID][\"named_at\"] == 1");
assert.ok(pyBool(!pyContains((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold")),"tests/kernel/test_journal.py:389 assert \"untold\" not in kernel.table(\"look\", focus=\"npc\", name=KNOTT)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_name_in_another_script_is_taken_with_its_words"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_name_in_another_script_is_taken_with_its_words(await kernel(t,{}));});
export async function test_one_word_for_one_person(kernel:any){

(await open_turn(kernel,"我接过那封信。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:"擦汗的房东"}),({["kind"]:"clue",["clue"]:"knott-commission",["from"]:CORBITT})]}));
let taken:any=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"person",["who"]:CORBITT,["name"]:" 擦汗的房东 "})]}));
assert.ok(pyBool(pyEqual(pyAt(taken,"code"),"invalid_params")),"tests/kernel/test_journal.py:401 assert taken[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["field","name","taken","in_use"])){if(pyBool(true))__rows.push([key,pyAt(pyAt(taken,"details"),key)]);}return __rows;})())),({["field"]:"person.name",["name"]:"擦汗的房东",["taken"]:"擦汗的房东",["in_use"]:["擦汗的房东"]}))),"tests/kernel/test_journal.py:402 assert {key: taken[\"details\"][key] for key in (\"field\", \"name\", \"taken\", \"in_use\")} == \\\n        {\"field\": \"person.name\", \"name\": \"擦汗的房东\", \"taken\": \"擦汗的房东\", \"in_use\": [\"擦汗的房东\"]}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(taken,"fix"),"one visible thing only they have here");return pyBool(__left)?pyContains(pyAt(taken,"fix"),"擦汗的房东"):__left})())),"tests/kernel/test_journal.py:404 assert \"one visible thing only they have here\" in taken[\"fix\"] and \"擦汗的房东\" in taken[\"fix\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:"擦汗的房东"})]}));
(await narrate(kernel,"t1-c4","房东擦了擦汗，把一封信推过来。"));
let packet:any=(await job(kernel,({"turn":1})));
let clash:any=(await submit_err(kernel,pyAt(packet,"job_id"),[({["name"]:CORBITT,["label"]:"擦汗的房东",["description"]:"写信的人。"})]));
assert.ok(pyBool(pyEqual(pyAt(clash,"code"),"invalid_params")),"tests/kernel/test_journal.py:409 assert clash[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(clash,"details"),({["index"]:0,["field"]:"label",["name"]:CORBITT,["taken"]:"擦汗的房东"}))),"tests/kernel/test_journal.py:410 assert clash[\"details\"] == {\"index\": 0, \"field\": \"label\", \"name\": CORBITT, \"taken\": \"擦汗的房东\"}");
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["description"]:"满头大汗的男人。"}),({["name"]:CORBITT,["label"]:"写信的人",["description"]:"写信的人。"})]));
let entries:any=pyAt((await read_json((await journal_path(kernel.workspace)))),"entries");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(entries,KNOTT_ID),"label"),"擦汗的房东");return pyBool(__left)?!pyContains(pyAt(entries,KNOTT_ID),"named_at"):__left})())),"tests/kernel/test_journal.py:415 assert entries[KNOTT_ID][\"label\"] == \"擦汗的房东\" and \"named_at\" not in entries[KNOTT_ID]");
(await close_turn(kernel,2,"房东又擦了擦汗。"));
(await submit(kernel,pyAt((await job(kernel,({"turn":2}))),"job_id"),[({["name"]:KNOTT,["label"]:"胖男人",["exchange"]:"他又擦了擦汗。"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"label"),"擦汗的房东")),pyStr("the table's word, not the lane's"));
let names:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"))){if(pyBool(true))__rows.push([pyAt(row,"id"),pyAt(row,"name")]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(names,"steven-knott"),"擦汗的房东")),"tests/kernel/test_journal.py:420 assert names[\"steven-knott\"] == \"擦汗的房东\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_one_word_for_one_person"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_one_word_for_one_person(await kernel(t,{}));});
export async function test_the_lane_is_told_what_the_table_calls_each_person(kernel:any){

(await open_turn(kernel,"我看着他。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:"擦汗的房东"})]}));
(await narrate(kernel,"t1-c2","房东擦了擦汗。"));
let packet:any=(await pyMethod(kernel,"ok",["journal.job",({["campaign"]:CAMPAIGN,["turn"]:1,["mode"]:"referenced"})],{}));
assert.ok(pyBool(pyEqual(pyAt(packet,"recordable"),[({["alias"]:"person:0",["name"]:KNOTT,["epithet"]:"擦汗的房东"})])),"tests/kernel/test_journal.py:430 assert packet[\"recordable\"] == [{\"alias\": \"person:0\", \"name\": KNOTT, \"epithet\": \"擦汗的房东\"}]");
assert.ok(pyBool(pyContains(pyAt(packet,"instruction"),"listed with an epithet")),"tests/kernel/test_journal.py:431 assert \"listed with an epithet\" in packet[\"instruction\"]");
assert.ok(pyBool(pyContains(pyAt(packet,"instruction"),"this person's own name -- the name recordable gives them, in any spelling, script or transliteration")),"tests/kernel/test_journal.py:433 assert \"this person's own name -- the name recordable gives them, in any spelling, script or transliteration\" in packet[\"instruction\"]");
assert.ok(pyBool(pyContains(pyAt(packet,"instruction"),"A different name -- one they go by, a nickname, any name that is not that one -- does not name them")),"tests/kernel/test_journal.py:434 assert \"A different name -- one they go by, a nickname, any name that is not that one -- does not name them\" in packet[\"instruction\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_lane_is_told_what_the_table_calls_each_person"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_lane_is_told_what_the_table_calls_each_person(await kernel(t,{}));});
export async function test_a_handle_is_not_what_the_table_calls_anyone(kernel:any){

(await open_turn(kernel,"我看着他。"));
let own:any=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:"steven-knott"})]}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(own,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(own,"details"),"field"),"person.name"):__left})());return pyBool(__left)?pyContains(pyAt(own,"fix"),"epithet"):__left})())),"tests/kernel/test_journal.py:443 assert own[\"code\"] == \"invalid_params\" and own[\"details\"][\"field\"] == \"person.name\" and \"epithet\" in own[\"fix\"]");
let other:any=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:"walter-corbitt"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(other,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(other,"details"),"field"),"person.name"):__left})())),"tests/kernel/test_journal.py:445 assert other[\"code\"] == \"invalid_params\" and other[\"details\"][\"field\"] == \"person.name\"");
let stray:any=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"person",["who"]:"steven-knott",["name"]:"steven-knott",["label"]:"擦汗的房东"})]}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(stray,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(stray,"details"),"fields"),["label"]):__left})());return pyBool(__left)?pyContains(pyAt(stray,"fix"),"goes in name"):__left})())),"tests/kernel/test_journal.py:448 assert stray[\"code\"] == \"invalid_params\" and stray[\"details\"][\"fields\"] == [\"label\"] and \"goes in name\" in stray[\"fix\"]");
let path:any=pyDivide((await campaign_dir(kernel.workspace)),"world.json");
let state:any=(await read_json(path));
(await pyMethod(state,"setdefault",["person_labels",({})],{}))["steven-knott"]=({["name"]:"steven-knott"});
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[state],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
(await narrate(kernel,"t1-c4","房东擦了擦汗。"));
let packet:any=(await pyMethod(kernel,"ok",["journal.job",({["campaign"]:CAMPAIGN,["turn"]:1,["mode"]:"referenced"})],{}));
assert.ok(pyBool(pyEqual(pyAt(packet,"recordable"),[({["alias"]:"person:0",["name"]:KNOTT})])),"tests/kernel/test_journal.py:456 assert packet[\"recordable\"] == [{\"alias\": \"person:0\", \"name\": KNOTT}]");
(await pyMethod(kernel,"ok",["journal.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["protocol"]:pyAt(packet,"protocol"),["selection_binding"]:pyAt(packet,"selection_binding"),["entries"]:[({["person"]:"person:0",["label"]:"擦汗的房东",["description"]:"满头大汗的男人。"})]})],{}));
let [card]=exactlyOne(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"name"),"擦汗的房东");return pyBool(__left)?(pyAt(card,"named")===false):__left})())),"tests/kernel/test_journal.py:461 assert card[\"name\"] == \"擦汗的房东\" and card[\"named\"] is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_handle_is_not_what_the_table_calls_anyone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_handle_is_not_what_the_table_calls_anyone(await kernel(t,{}));});
export async function test_untold_starts_at_opening_without_a_journal(kernel:any){
(await create_campaign(kernel));
(await pyMethod(kernel,"table",["open"],{}));
let capsule:any=(await pyMethod(kernel,"table",["capsule"],{}));
let person:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"present"))){if(pyBool(pyEqual(pyAt(p,"name"),KNOTT)))__rows.push(p);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyContains(person,"untold");return pyBool(__left)?!pyContains(pyAt(person,"untold"),"label"):__left})())),"tests/kernel/test_journal.py:469 assert \"untold\" in person and \"label\" not in person[\"untold\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(pyAt(person,"untold"),"use"),"label is the table's word");return pyBool(__left)?!pyContains(pyAt(pyAt(person,"untold"),"use"),"apply person"):__left})())),"tests/kernel/test_journal.py:471 assert \"label is the table's word\" in person[\"untold\"][\"use\"] and \"apply person\" not in person[\"untold\"][\"use\"]");
assert.ok(pyBool(!pyBool((await pyMethod((await journal_path(kernel.workspace)),"exists",[],{})))),"tests/kernel/test_journal.py:472 assert not journal_path(kernel.workspace).exists()");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold"),pyAt(person,"untold"))),"tests/kernel/test_journal.py:473 assert kernel.table(\"look\", focus=\"npc\", name=KNOTT)[\"untold\"] == person[\"untold\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc"})),"present"),0),"untold"),pyAt(person,"untold"))),"tests/kernel/test_journal.py:474 assert kernel.table(\"look\", focus=\"npc\")[\"present\"][0][\"untold\"] == person[\"untold\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"scene"})),"present"),0),"untold"),pyAt(person,"untold"))),"tests/kernel/test_journal.py:475 assert kernel.table(\"look\", focus=\"scene\")[\"present\"][0][\"untold\"] == person[\"untold\"]");
(await narrate(kernel,"t0-c1","The man waits quietly."));
let later:any=(await pyMethod(kernel,"table",["player_input"],{"text":"I wait."}));
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(later,"capsule"),"present"),0),"untold")),pyStr("journal lag must not remove the reminder"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_untold_starts_at_opening_without_a_journal"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_untold_starts_at_opening_without_a_journal(await kernel(t,{}));});
export async function test_a_table_epithet_is_not_disclosure_and_is_shared_by_player_surfaces(kernel:any){
(await open_turn(kernel,"I wait for the man to speak."));
let label:any="The man with the keys";
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:label})]}));
let delivery:any=(await narrate(kernel,"t1-c2",`${label} looks up. {{say:${label}}}"Please sit."{{/say}}`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(delivery,"speech"),0),"who"),({["npc"]:"steven-knott",["name"]:label}))),"tests/kernel/test_journal.py:486 assert delivery[\"speech\"][0][\"who\"] == {\"npc\": \"steven-knott\", \"name\": label}");
let packet:any=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"unnamed"),[KNOTT])),pyStr("neither the epithet in prose nor its resolved speaker is a true name"));
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["label"]:"The seated man",["description"]:`${label} waits.`})]));
let stored:any=pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID);
assert.ok(pyBool(!pyContains(stored,"named_at")),"tests/kernel/test_journal.py:491 assert \"named_at\" not in stored");
let [person]=exactlyOne(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(person,"name"),label);return pyBool(__left)?(pyAt(person,"named")===false):__left})())),"tests/kernel/test_journal.py:493 assert person[\"name\"] == label and person[\"named\"] is False");
let later:any=(await pyMethod(kernel,"table",["player_input"],{"text":"I look at the keys."}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(later,"capsule"),"present"),0),"untold"),"label"),label)),"tests/kernel/test_journal.py:495 assert later[\"capsule\"][\"present\"][0][\"untold\"][\"label\"] == label");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold"),"label"),label)),"tests/kernel/test_journal.py:496 assert kernel.table(\"look\", focus=\"npc\", name=KNOTT)[\"untold\"][\"label\"] == label");
(await narrate(kernel,"t2-c1",`${label} nods. {{say:${label}}}"They fit the house."{{/say}}`));
packet=(await job(kernel,({"turn":2})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"unnamed"),[KNOTT]);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(packet,"prior"),0),"label"),label):__left})())),"tests/kernel/test_journal.py:499 assert packet[\"unnamed\"] == [KNOTT] and packet[\"prior\"][0][\"label\"] == label");
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["exchange"]:"He nodded."})]));
assert.ok(pyBool(!pyContains(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at")),"tests/kernel/test_journal.py:501 assert \"named_at\" not in read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID]");
(await pyMethod(kernel,"table",["player_input"],{"text":"I ask his name."}));
let staged:any=(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"person",["who"]:label,["name"]:KNOTT})]}));
assert.ok(pyBool(pyEqual(pyAt(staged,"names_pending_delivery"),[({["who"]:KNOTT,["name"]:KNOTT})])),"tests/kernel/test_journal.py:506 assert staged[\"names_pending_delivery\"] == [{\"who\": KNOTT, \"name\": KNOTT}]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold"),"label"),label)),"tests/kernel/test_journal.py:507 assert kernel.table(\"look\", focus=\"npc\", name=KNOTT)[\"untold\"][\"label\"] == label");
let delivered:any=(await narrate(kernel,"t3-c2",`{{say:${label}}}"My name is {{name:${label}}}."{{/say}}`));
assert.ok(pyBool(pyContains(pyAt(delivered,"rendered_text"),`My name is ${KNOTT}.`)),"tests/kernel/test_journal.py:509 assert f\"My name is {KNOTT}.\" in delivered[\"rendered_text\"]");
later=(await pyMethod(kernel,"table",["player_input"],{"text":"I nod."}));
assert.ok(pyBool(!pyContains(pyAt(pyAt(pyAt(later,"capsule"),"present"),0),"untold")),pyStr("the committed introduction works before journal processing"));
packet=(await job(kernel,({"turn":3})));
assert.ok(pyBool(pyEqual(pyAt(packet,"unnamed"),[])),"tests/kernel/test_journal.py:513 assert packet[\"unnamed\"] == []");
(await submit(kernel,pyAt(packet,"job_id"),[]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at"),3)),"tests/kernel/test_journal.py:515 assert read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID][\"named_at\"] == 3");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"npcs"),"journal"),0),"name"),KNOTT)),"tests/kernel/test_journal.py:516 assert kernel.ok(\"table.view\", {\"campaign\": CAMPAIGN})[\"npcs\"][\"journal\"][0][\"name\"] == KNOTT");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_epithet_is_not_disclosure_and_is_shared_by_player_surfaces"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_epithet_is_not_disclosure_and_is_shared_by_player_surfaces(await kernel(t,{}));});
export async function test_committed_name_is_known_before_the_journal_runs(kernel:any){
(await create_campaign(kernel));
(await narrate(kernel,"t0-c1",`The man says, "I am ${KNOTT}."`));
let later:any=(await pyMethod(kernel,"table",["player_input"],{"text":"I nod."}));
assert.ok(pyBool(!pyContains(pyAt(pyAt(pyAt(later,"capsule"),"present"),0),"untold")),"tests/kernel/test_journal.py:523 assert \"untold\" not in later[\"capsule\"][\"present\"][0]");
assert.ok(pyBool(!pyContains((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":KNOTT})),"untold")),"tests/kernel/test_journal.py:524 assert \"untold\" not in kernel.table(\"look\", focus=\"npc\", name=KNOTT)");
assert.ok(pyBool(!pyContains(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc"})),"present"),0),"untold")),"tests/kernel/test_journal.py:525 assert \"untold\" not in kernel.table(\"look\", focus=\"npc\")[\"present\"][0]");
assert.ok(pyBool(!pyBool((await pyMethod((await journal_path(kernel.workspace)),"exists",[],{})))),"tests/kernel/test_journal.py:526 assert not journal_path(kernel.workspace).exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_committed_name_is_known_before_the_journal_runs"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_committed_name_is_known_before_the_journal_runs(await kernel(t,{}));});
export async function test_a_resolved_authored_token_displayed_as_epithet_does_not_disclose_name(kernel:any){
(await open_turn(kernel));
let label:any="The letting agent";
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:KNOTT,["name"]:label})]}));
let delivery:any=(await narrate(kernel,"t1-c2",`{{say:${KNOTT}}}"Sit down."{{/say}}`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(delivery,"speech"),0),"who"),"name"),label)),"tests/kernel/test_journal.py:534 assert delivery[\"speech\"][0][\"who\"][\"name\"] == label");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"unnamed"),[KNOTT])),pyStr("the displayed word, not the raw token or identity, is the floor"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_resolved_authored_token_displayed_as_epithet_does_not_disclose_name"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_resolved_authored_token_displayed_as_epithet_does_not_disclose_name(await kernel(t,{}));});
export async function test_a_say_span_of_theirs_shows_the_player_the_name(kernel:any){

(await open_turn(kernel,"我等他开口。"));
(await narrate(kernel,"t1-c1",`房东抬起头。{{say:${KNOTT}}}「请坐。」{{/say}}`));
let packet:any=(await job(kernel));
assert.ok(pyBool(pyEqual(pyAt(packet,"unnamed"),[])),"tests/kernel/test_journal.py:544 assert packet[\"unnamed\"] == []");
(await submit(kernel,pyAt(packet,"job_id"),[({["name"]:KNOTT,["description"]:"房东。",["exchange"]:"他请调查员坐下。"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await read_json((await journal_path(kernel.workspace)))),"entries"),KNOTT_ID),"named_at"),1)),"tests/kernel/test_journal.py:546 assert read_json(journal_path(kernel.workspace))[\"entries\"][KNOTT_ID][\"named_at\"] == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_say_span_of_theirs_shows_the_player_the_name"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_say_span_of_theirs_shows_the_player_the_name(await kernel(t,{}));});
