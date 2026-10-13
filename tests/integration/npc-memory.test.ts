// Migrated from tests/kernel/test_memory.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,CAMPAIGN,campaign_dir,open_turn,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export let INV:any="托马斯·海斯";
export let KNOTT:any="Steven Knott";
export async function memory_dir(workspace:any){
return pyDivide((await campaign_dir(workspace)),"memory");
}
export async function job(client:any,params:any={}){
return (await pyMethod(client,"ok",["memory.job",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function submit(client:any,job_id:any,candidates:any){
return (await pyMethod(client,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["candidates"]:candidates})],{}));
}
export async function submit_err(client:any,job_id:any,candidates:any){
return (await pyMethod(client,"err",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["candidates"]:candidates})],{}));
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

export async function test_job_packet_is_names_only(kernel:any){
let narrated:any,packet:any,prompt_material:any,stored:any;
narrated=(await first_turn(kernel));
assert.ok(pyBool(pyEqual(pyAt(narrated,"extraction"),({["job_id"]:"extract:c1:t1"}))),"tests/kernel/test_memory.py:48 assert narrated[\"extraction\"] == {\"job_id\": \"extract:c1:t1\"}");
packet=(await job(kernel));
assert.ok(pyBool(pyEqual((await pySet(packet)),new Set(["job_id","turn","commit","scene","present","investigators","player_text","keeper_text","committed_facts","known_entities","prior","story_context","budget","instruction","attribution_policy"]))),"tests/kernel/test_memory.py:50 assert set(packet) == {\"job_id\", \"turn\", \"commit\", \"scene\", \"present\", \"investigators\", \"player_text\",\n                           \"keeper_text\", \"committed_facts\", \"known_entities\", \"prior\", \"story_context\", \"budget\", \"instruction\", \"attribution_policy\"}");
assert.ok(pyBool(pyEqual(pyAt(packet,"attribution_policy"),"heard-participants-v1")),"tests/kernel/test_memory.py:52 assert packet[\"attribution_policy\"] == \"heard-participants-v1\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(packet,"job_id"),"extract:c1:t1");return pyBool(__left)?pyEqual(pyAt(packet,"turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(packet,"commit"),pyAt(narrated,"commit")):__left})())),"tests/kernel/test_memory.py:53 assert packet[\"job_id\"] == \"extract:c1:t1\" and packet[\"turn\"] == 1 and packet[\"commit\"] == narrated[\"commit\"]");
assert.ok(pyBool(pyEqual(pyAt(packet,"scene"),({["name"]:"commission-briefing",["display_name"]:"Knott's Office"}))),"tests/kernel/test_memory.py:54 assert packet[\"scene\"] == {\"name\": \"commission-briefing\", \"display_name\": \"Knott's Office\"}");
assert.ok(pyBool(pyEqual(pyAt(packet,"present"),[KNOTT])),"tests/kernel/test_memory.py:55 assert packet[\"present\"] == [KNOTT]");
assert.ok(pyBool(pyEqual(pyAt(packet,"investigators"),[({["id"]:"thomas-hayes",["name"]:INV})])),"tests/kernel/test_memory.py:56 assert packet[\"investigators\"] == [{\"id\": \"thomas-hayes\", \"name\": INV}]");
assert.ok(pyBool(pyEqual(pyAt(packet,"player_text"),"我仔细观察诺特。")),"tests/kernel/test_memory.py:57 assert packet[\"player_text\"] == \"我仔细观察诺特。\"");
assert.ok(pyBool(pyEqual(pyAt(packet,"keeper_text"),"诺特叹了口气。\n\n他把钥匙推过来。")),"tests/kernel/test_memory.py:58 assert packet[\"keeper_text\"] == \"诺特叹了口气。\\n\\n他把钥匙推过来。\"");
assert.ok(pyBool(pyEqual(pyAt(packet,"committed_facts"),pyAt(pyAt(narrated,"facts"),"committed"))),"tests/kernel/test_memory.py:59 assert packet[\"committed_facts\"] == narrated[\"facts\"][\"committed\"]");
assert.ok(pyBool(pyEqual(pyAt(packet,"known_entities"),[({["name"]:INV,["kind"]:"investigator"}),({["name"]:KNOTT,["kind"]:"npc"}),({["name"]:"Knott's Office",["kind"]:"scene"}),({["name"]:"knott-keys",["kind"]:"clue"})])),"tests/kernel/test_memory.py:60 assert packet[\"known_entities\"] == [{\"name\": INV, \"kind\": \"investigator\"}, {\"name\": KNOTT, \"kind\": \"npc\"},\n                                        {\"name\": \"Knott's Office\", \"kind\": \"scene\"}, {\"name\": \"knott-keys\", \"kind\": \"clue\"}]");
assert.ok(pyBool(pyEqual(pyAt(packet,"prior"),[])),"tests/kernel/test_memory.py:62 assert packet[\"prior\"] == []");
assert.ok(pyBool(pyAt(pyAt(packet,"story_context"),"threads")),"tests/kernel/test_memory.py:63 assert packet[\"story_context\"][\"threads\"]");
assert.ok(pyBool(pyEqual((await pySet(pyAt(pyAt(pyAt(packet,"story_context"),"threads"),0))),new Set(["thread","claim","importance","supporting","contradicting"]))),"tests/kernel/test_memory.py:64 assert set(packet[\"story_context\"][\"threads\"][0]) == {\"thread\", \"claim\", \"importance\", \"supporting\", \"contradicting\"}");
assert.ok(pyBool((pyAt(pyAt(packet,"story_context"),"last_assessment")===null)),"tests/kernel/test_memory.py:65 assert packet[\"story_context\"][\"last_assessment\"] is None");
assert.ok(pyBool(pyEqual(pyAt(packet,"budget"),({["max_candidates"]:12,["max_statement_chars"]:400}))),"tests/kernel/test_memory.py:66 assert packet[\"budget\"] == {\"max_candidates\": 12, \"max_statement_chars\": 400}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(packet,"instruction"),"known_entities");return pyBool(__left)?pyContains(pyAt(packet,"instruction"),"world"):__left})())),"tests/kernel/test_memory.py:67 assert \"known_entities\" in packet[\"instruction\"] and \"world\" in packet[\"instruction\"]");
prompt_material=(await pyMethod(json,"dumps",[Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(packet,"items",[],{})))){if(pyBool(!pyContains(["turn","commit"],k)))__rows.push([k,v]);}return __rows;})()))],{"ensure_ascii":false}));
assert.ok(pyBool(!pyBool((await pyMethod(re,"search",["[0-9a-f]{40}",prompt_material],{})))),"tests/kernel/test_memory.py:70 assert not re.search(r\"[0-9a-f]{40}\", prompt_material)");
assert.ok(pyBool(!pyBool((await pyMethod(re,"search",["\\b(roll|move|clue|delta|time|session):[a-z]",prompt_material],{})))),"tests/kernel/test_memory.py:71 assert not re.search(r\"\\b(roll|move|clue|delta|time|session):[a-z]\", prompt_material)");
assert.ok(pyBool(!pyBool((await pyMethod(re,"search",["\\bt\\d+-c\\d+\\b",prompt_material],{})))),"tests/kernel/test_memory.py:72 assert not re.search(r\"\\bt\\d+-c\\d+\\b\", prompt_material)");
stored=(await read_json(pyDivide(pyDivide((await memory_dir(kernel.workspace)),"jobs"),"extract:c1:t1.json")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(stored,"status"),"open");return pyBool(__left)?pyEqual(pyAt(pyAt(stored,"packet"),"job_id"),"extract:c1:t1"):__left})())),"tests/kernel/test_memory.py:74 assert stored[\"status\"] == \"open\" and stored[\"packet\"][\"job_id\"] == \"extract:c1:t1\"");
assert.ok(pyBool(pyEqual(pyAt(stored,"receipts"),["roll:psychology-t1-c1","clue:knott-keys-t1"])),"tests/kernel/test_memory.py:75 assert stored[\"receipts\"] == [\"roll:psychology-t1-c1\", \"clue:knott-keys-t1\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_job_packet_is_names_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_job_packet_is_names_only(await kernel(t,{}));});
export async function test_default_job_is_the_latest_committed_turn_without_a_done_job(kernel:any){
(await first_turn(kernel));
(await close_turn(kernel,2));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),2)),"tests/kernel/test_memory.py:81 assert job(kernel)[\"turn\"] == 2");
(await submit(kernel,"extract:c1:t2",[]));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),1)),"tests/kernel/test_memory.py:83 assert job(kernel)[\"turn\"] == 1");
(await submit(kernel,"extract:c1:t1",[]));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),0)),"tests/kernel/test_memory.py:85 assert job(kernel)[\"turn\"] == 0");
(await submit(kernel,"extract:c1:t0",[]));
assert.ok(pyBool(pyEqual((await job(kernel)),({["job_id"]:null,["turn"]:null}))),"tests/kernel/test_memory.py:87 assert job(kernel) == {\"job_id\": None, \"turn\": None}");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel,({"turn":1}))),"job_id"),"extract:c1:t1")),"tests/kernel/test_memory.py:89 assert job(kernel, turn=1)[\"job_id\"] == \"extract:c1:t1\"");
(await pyMethod(kernel,"table",["player_input"],{"text":"推门？"}));
(await pyMethod(kernel,"table",["ask"],{"call_id":"t3-c1","prompt":"进吗？","options":["进","不进"]}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:3})],{})),"code"),"invalid_params")),"tests/kernel/test_memory.py:92 assert kernel.err(\"memory.job\", {\"campaign\": CAMPAIGN, \"turn\": 3})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"err",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:9})],{})),"details"),"committed_turns"),[0,1,2])),"tests/kernel/test_memory.py:93 assert kernel.err(\"memory.job\", {\"campaign\": CAMPAIGN, \"turn\": 9})[\"details\"][\"committed_turns\"] == [0, 1, 2]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_default_job_is_the_latest_committed_turn_without_a_done_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_default_job_is_the_latest_committed_turn_without_a_done_job(await kernel(t,{}));});
export async function test_job_can_be_rebuilt_without_episode_or_job_file(kernel:any){
let packet:any,result:any;
(await first_turn(kernel));
(await pyMethod((pyDivide((await memory_dir(kernel.workspace)),"episodes.jsonl")),"unlink",[],{}));
packet=(await job(kernel,({"turn":1})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(packet,"known_entities"),1),({["name"]:KNOTT,["kind"]:"npc"}))),"tests/kernel/test_memory.py:100 assert packet[\"known_entities\"][1] == {\"name\": KNOTT, \"kind\": \"npc\"}");
(await pyMethod((pyDivide(pyDivide((await memory_dir(kernel.workspace)),"jobs"),"extract:c1:t1.json")),"unlink",[],{}));
result=(await submit(kernel,"extract:c1:t1",[({["kind"]:"world_event",["subject"]:"world",["statement"]:"诺特交出了钥匙。"})]));
assert.ok(pyBool(pyEqual(pyAt(result,"written"),["mem:t1-1"])),"tests/kernel/test_memory.py:104 assert result[\"written\"] == [\"mem:t1-1\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_job_can_be_rebuilt_without_episode_or_job_file"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_job_can_be_rebuilt_without_episode_or_job_file(await kernel(t,{}));});
export async function test_a_person_who_leaves_during_the_turn_remains_a_valid_memory_subject(kernel:any){
let packet:any,result:any;
(await open_turn(kernel,"我拒绝委托，诺特随后离开。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:KNOTT,["to"]:"away",["why"]:"The meeting ended."})]}));
(await narrate(kernel,"t1-c2","诺特说完最后一句话，拿起钥匙离开了办公室。"));
packet=(await job(kernel,({"turn":1})));
assert.ok(pyBool(pyContains(pyAt(packet,"present"),KNOTT)),"tests/kernel/test_memory.py:113 assert KNOTT in packet[\"present\"]");
assert.ok(pyBool(pyContains(pyAt(packet,"known_entities"),({["name"]:KNOTT,["kind"]:"npc"}))),"tests/kernel/test_memory.py:114 assert {\"name\": KNOTT, \"kind\": \"npc\"} in packet[\"known_entities\"]");
result=(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["candidates"]:[({["kind"]:"knowledge",["subject"]:KNOTT,["statement"]:"诺特知道海斯拒绝了委托。"})]})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"candidates"),1);return pyBool(__left)?pyEqual(pyAt(result,"written"),["mem:t1-1"]):__left})())),"tests/kernel/test_memory.py:117 assert result[\"candidates\"] == 1 and result[\"written\"] == [\"mem:t1-1\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_person_who_leaves_during_the_turn_remains_a_valid_memory_subject"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_person_who_leaves_during_the_turn_remains_a_valid_memory_subject(await kernel(t,{}));});

export async function test_submit_lands_candidates_and_writes_the_files(kernel:any){
let narrated:any,packet:any,result:any,rows:any,stored:any,episodes:any,written:any;
narrated=(await first_turn(kernel));
packet=(await job(kernel));
result=(await submit(kernel,pyAt(packet,"job_id"),[({["kind"]:"world_event",["subject"]:"world",["statement"]:"诺特把房子的钥匙交给了调查员。"}),({["kind"]:"knowledge",["subject"]:INV,["knowers"]:[INV],["entities"]:["steven-knott"],["statement"]:"诺特急着把房子租出去。"}),({["kind"]:"relationship",["subject"]:KNOTT,["entities"]:["thomas-hayes"],["statement"]:"雇主与雇员。",["privacy"]:"keeper_only",["state"]:"uncertain",["confidence"]:0.6})]));
assert.ok(pyBool(pyEqual(result,({["job_id"]:"extract:c1:t1",["turn"]:1,["candidates"]:3,["written"]:["mem:t1-1","mem:t1-2","mem:t1-3"],["superseded"]:[]}))),"tests/kernel/test_memory.py:132 assert result == {\"job_id\": \"extract:c1:t1\", \"turn\": 1, \"candidates\": 3,\n                      \"written\": [\"mem:t1-1\", \"mem:t1-2\", \"mem:t1-3\"], \"superseded\": []}");
rows=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"candidates.jsonl")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){if(pyBool(true))__rows.push(pyAt(r,"id"));}return __rows;})()),["mem:t1-1","mem:t1-2","mem:t1-3"])),"tests/kernel/test_memory.py:135 assert [r[\"id\"] for r in rows] == [\"mem:t1-1\", \"mem:t1-2\", \"mem:t1-3\"]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"status"),"candidate");return pyBool(__left)?pyEqual(pyAt(r,"valid_from_turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(r,"job_id"),"extract:c1:t1"):__left})()));}return __rows;})())))),"tests/kernel/test_memory.py:136 assert all(r[\"status\"] == \"candidate\" and r[\"valid_from_turn\"] == 1 and r[\"job_id\"] == \"extract:c1:t1\" for r in rows)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,0),"source"),({["turn"]:1,["commit"]:pyAt(narrated,"commit"),["episode_id"]:"ep:t1",["receipts"]:["roll:psychology-t1-c1","clue:knott-keys-t1"]}))),"tests/kernel/test_memory.py:137 assert rows[0][\"source\"] == {\"turn\": 1, \"commit\": narrated[\"commit\"], \"episode_id\": \"ep:t1\",\n                                 \"receipts\": [\"roll:psychology-t1-c1\", \"clue:knott-keys-t1\"]}");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,1),"subject"),INV);return pyBool(__left)?pyEqual(pyAt(pyAt(rows,1),"knowers"),[INV]):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(rows,1),"entities"),[KNOTT]):__left})())),"tests/kernel/test_memory.py:139 assert rows[1][\"subject\"] == INV and rows[1][\"knowers\"] == [INV] and rows[1][\"entities\"] == [KNOTT]");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,1),"privacy"),"player_safe");return pyBool(__left)?pyEqual(pyAt(pyAt(rows,1),"state"),"accurate"):__left})());return pyBool(__left)?(pyAt(pyAt(rows,1),"confidence")===null):__left})())),"tests/kernel/test_memory.py:140 assert rows[1][\"privacy\"] == \"player_safe\" and rows[1][\"state\"] == \"accurate\" and rows[1][\"confidence\"] is None");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,2),"entities"),[INV]);return pyBool(__left)?pyEqual(pyAt(pyAt(rows,2),"privacy"),"keeper_only"):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(rows,2),"confidence"),0.6):__left})())),"tests/kernel/test_memory.py:141 assert rows[2][\"entities\"] == [INV] and rows[2][\"privacy\"] == \"keeper_only\" and rows[2][\"confidence\"] == 0.6");
stored=(await read_json(pyDivide(pyDivide((await memory_dir(kernel.workspace)),"jobs"),"extract:c1:t1.json")));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(stored,"status"),"done");return pyBool(__left)?pyEqual(pyAt(stored,"result"),result):__left})());return pyBool(__left)?pyAt(stored,"candidates_sha256"):__left})())),"tests/kernel/test_memory.py:143 assert stored[\"status\"] == \"done\" and stored[\"result\"] == result and stored[\"candidates_sha256\"]");
episodes=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"episodes.jsonl")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(episodes)){if(pyBool(true))__rows.push(pyAt(e,"episode_id"));}return __rows;})()),["ep:t0","ep:t1"])),"tests/kernel/test_memory.py:145 assert [e[\"episode_id\"] for e in episodes] == [\"ep:t0\", \"ep:t1\"]");
assert.ok(pyBool(pyEqual(pyAt(episodes,1),({...pyAt(episodes,1),["turn"]:1,["commit"]:pyAt(narrated,"commit"),["scene"]:"commission-briefing",["present"]:[KNOTT],["investigators"]:["thomas-hayes"],["receipts"]:["roll:psychology-t1-c1","clue:knott-keys-t1"],["clues_discovered"]:["钥匙"],["player_chars"]:8}))),"tests/kernel/test_memory.py:146 assert episodes[1] == {**episodes[1], \"turn\": 1, \"commit\": narrated[\"commit\"], \"scene\": \"commission-briefing\",\n                           \"present\": [KNOTT], \"investigators\": [\"thomas-hayes\"],\n                           \"receipts\": [\"roll:psychology-t1-c1\", \"clue:knott-keys-t1\"], \"clues_discovered\": [\"钥匙\"],\n                           \"player_chars\": 8}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(episodes,1),"keeper_chars"),(await pyLen(pyAt(narrated,"rendered_text"))))),"tests/kernel/test_memory.py:150 assert episodes[1][\"keeper_chars\"] == len(narrated[\"rendered_text\"])");
written=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),"memory-written")))__rows.push(e);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(written)),1);return pyBool(__left)?pyEqual(pyAt(pyAt(written,0),"turn"),1):__left})())),"tests/kernel/test_memory.py:152 assert len(written) == 1 and written[0][\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(written,0),"data"),({["job_id"]:"extract:c1:t1",["turn"]:1,["candidates"]:3,["superseded"]:0}))),"tests/kernel/test_memory.py:153 assert written[0][\"data\"] == {\"job_id\": \"extract:c1:t1\", \"turn\": 1, \"candidates\": 3, \"superseded\": 0}");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide((await memory_dir(kernel.workspace)),"backlog.jsonl")),"exists",[],{})))),"tests/kernel/test_memory.py:154 assert not (memory_dir(kernel.workspace) / \"backlog.jsonl\").exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_submit_lands_candidates_and_writes_the_files"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_submit_lands_candidates_and_writes_the_files(await kernel(t,{}));});
export async function test_an_entity_name_that_matches_nothing_is_dropped_and_the_batch_still_lands(kernel:any){
let job_id:any,ok:any,result:any,landed:any,promise:any;

(await first_turn(kernel));
job_id=pyAt((await job(kernel)),"job_id");
ok=({["kind"]:"knowledge",["subject"]:INV,["statement"]:"好的。"});
result=(await submit(kernel,job_id,[({...ok,["entities"]:["knott-keys","二楼卧室"]}),({...ok,["statement"]:"另一条。"})]));
assert.ok(pyBool(pyEqual(pyAt(result,"candidates"),2)),pyStr("the candidate keeps its statement and the batch keeps the rest"));
assert.ok(pyBool(pyEqual(pyAt(result,"dropped_entities"),["二楼卧室"])),pyStr("and the result says which name matched nothing"));
landed=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"candidates.jsonl")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(landed)){if(pyBool(true))__rows.push(pyAt(row,"entities"));}return __rows;})()),[["knott-keys"],[]])),"tests/kernel/test_memory.py:170 assert [row[\"entities\"] for row in landed] == [[\"knott-keys\"], []]");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt((await job(kernel)),"job_id"),[({...ok,["subject"]:"Walter Corbitt"})])),"code"),"invalid_params")),"tests/kernel/test_memory.py:173 assert submit_err(kernel, job(kernel)[\"job_id\"], [{**ok, \"subject\": \"Walter Corbitt\"}])[\"code\"] == \"invalid_params\"");
promise=[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:["a stranger"],["statement"]:"x"})];
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,pyAt((await job(kernel)),"job_id"),promise)),"code"),"invalid_params")),"tests/kernel/test_memory.py:175 assert submit_err(kernel, job(kernel)[\"job_id\"], promise)[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_entity_name_that_matches_nothing_is_dropped_and_the_batch_still_lands"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_entity_name_that_matches_nothing_is_dropped_and_the_batch_still_lands(await kernel(t,{}));});
export async function test_each_rejection_points_at_the_candidate_and_names_usable_names(kernel:any){
let job_id:any,ok:any,cases:any,label:any,candidates:any,index:any,named:any,error:any,unresolved:any,backlog:any;
(await first_turn(kernel));
job_id=pyAt((await job(kernel)),"job_id");
ok=({["kind"]:"knowledge",["subject"]:INV,["statement"]:"好的。"});
cases=[["unknown field",[({...ok,["mood"]:"happy"})],0,"mood"],["machine key",[ok,({...ok,["commit"]:"abc"})],1,"commit"],["machine key id",[({...ok,["id"]:"mem:t1-9"})],0,"id"],["unknown kind",[({...ok,["kind"]:"rumor"})],0,"world_event"],["unresolvable subject",[ok,ok,({...ok,["subject"]:"Walter Corbitt"})],2,KNOTT],["scene is not a knower",[({...ok,["knowers"]:["Knott's Office"]})],0,KNOTT],["world_event with a person",[({["kind"]:"world_event",["subject"]:KNOTT,["statement"]:"x"})],0,"world"],["relationship without entity",[({["kind"]:"relationship",["subject"]:KNOTT,["statement"]:"x"})],0,"entities"],["relationship with two",[({["kind"]:"relationship",["subject"]:KNOTT,["entities"]:[INV,"knott-keys"],["statement"]:"x"})],0,"entities"],["statement too long",[({...ok,["statement"]:pyMultiply("长",401)})],0,"400"],["empty statement",[({...ok,["statement"]:"  "})],0,"statement"],["bad privacy",[({...ok,["privacy"]:"secret"})],0,"keeper_only"],["bad state",[({...ok,["state"]:"wrong"})],0,"distorted"],["bad confidence",[({...ok,["confidence"]:2})],0,"0"],["too many",pyMultiply([ok],13),12,"12"]];
for([label,candidates,index,named] of pyIterable(cases)){
error=(await submit_err(kernel,job_id,candidates));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr(label));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"index"),index)),pyStr(label));
assert.ok(pyBool(pyContains(pyAdd(((await (async()=>{const __left=(await pyMethod(error,"get",["fix"],{}));return pyBool(__left)?__left:""})())),pyAt(error,"message")),named)),pyStr([label,error]));
}
unresolved=(await submit_err(kernel,job_id,[({...ok,["subject"]:"Walter Corbitt"})]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(unresolved,"details"),"candidates"),[INV,KNOTT,"Knott's Office","knott-keys"])),"tests/kernel/test_memory.py:206 assert unresolved[\"details\"][\"candidates\"] == [INV, KNOTT, \"Knott's Office\", \"knott-keys\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(unresolved,"fix"),INV);return pyBool(__left)?pyContains(pyAt(unresolved,"fix"),"knott-keys"):__left})())),"tests/kernel/test_memory.py:207 assert INV in unresolved[\"fix\"] and \"knott-keys\" in unresolved[\"fix\"]");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide((await memory_dir(kernel.workspace)),"candidates.jsonl")),"exists",[],{})))),"tests/kernel/test_memory.py:209 assert not (memory_dir(kernel.workspace) / \"candidates.jsonl\").exists()");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await memory_dir(kernel.workspace)),"jobs"),`${job_id}.json`))),"status"),"open")),"tests/kernel/test_memory.py:210 assert read_json(memory_dir(kernel.workspace) / \"jobs\" / f\"{job_id}.json\")[\"status\"] == \"open\"");
backlog=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"backlog.jsonl")));
assert.ok(pyBool(pyEqual((await pyLen(backlog)),pyAdd((await pyLen(cases)),1))),"tests/kernel/test_memory.py:212 assert len(backlog) == len(cases) + 1");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(backlog)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"job_id"),job_id);return pyBool(__left)?pyEqual(pyAt(r,"turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(r,"reason"),"invalid"):__left})());return pyBool(__left)?pyEqual(pyAt(r,"status"),"pending"):__left})());return pyBool(__left)?pyAt(r,"detail"):__left})());return pyBool(__left)?pyAt(r,"at"):__left})()));}return __rows;})())))),"tests/kernel/test_memory.py:213 assert all(r[\"job_id\"] == job_id and r[\"turn\"] == 1 and r[\"reason\"] == \"invalid\" and r[\"status\"] == \"pending\"\n               and r[\"detail\"] and r[\"at\"] for r in backlog)");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),0)),"tests/kernel/test_memory.py:215 assert job(kernel)[\"turn\"] == 0");
(await submit(kernel,job_id,[ok]));
backlog=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"backlog.jsonl")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(backlog)){if(pyBool(true))__rows.push(pyAt(r,"status"));}return __rows;})())),new Set(["recovered"]));return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(backlog)){if(pyBool(true))__rows.push(pyAt(r,"recovered_at"));}return __rows;})()))):__left})())),"tests/kernel/test_memory.py:219 assert {r[\"status\"] for r in backlog} == {\"recovered\"} and all(r[\"recovered_at\"] for r in backlog)");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(e,"type"),"memory-written");return pyBool(__left)?!pyEqual(pyAt(pyAt(e,"data"),"candidates"),1):__left})())))__rows.push(e);}return __rows;})()))),"tests/kernel/test_memory.py:220 assert not [e for e in read_jsonl(campaign_dir(kernel.workspace) / \"events.jsonl\")\n                if e[\"type\"] == \"memory-written\" and e[\"data\"][\"candidates\"] != 1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_each_rejection_points_at_the_candidate_and_names_usable_names"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_each_rejection_points_at_the_candidate_and_names_usable_names(await kernel(t,{}));});
export async function test_ambiguous_name_is_rejected_with_ids_to_choose_from(kernel:any){
let party:any,twin:any,packet:any,error:any,result:any,rows:any;
(await first_turn(kernel));
party=pyDivide((await campaign_dir(kernel.workspace)),"party");
twin=(await read_json(pyDivide(party,"thomas-hayes.json")));
const __unpack13958=["knott-twin",KNOTT];twin["id"]=__unpack13958[0];twin["name"]=__unpack13958[1];
(await pyMethod((pyDivide(party,"knott-twin.json")),"write_text",[(await pyMethod(json,"dumps",[twin],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
packet=(await job(kernel,({"turn":1})));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(packet,"known_entities"))){if(pyBool(pyEqual(pyAt(e,"name"),KNOTT)))__rows.push(pyAt(e,"name"));}return __rows;})()),[KNOTT,KNOTT])),"tests/kernel/test_memory.py:232 assert [e[\"name\"] for e in packet[\"known_entities\"] if e[\"name\"] == KNOTT] == [KNOTT, KNOTT]");
error=(await submit_err(kernel,pyAt(packet,"job_id"),[({["kind"]:"knowledge",["subject"]:KNOTT,["statement"]:"x"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"index"),0):__left})())),"tests/kernel/test_memory.py:234 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"index\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"candidates"),[({["name"]:KNOTT,["kind"]:"investigator",["id"]:"knott-twin"}),({["name"]:KNOTT,["kind"]:"npc",["id"]:"npc-steven-knott"})])),"tests/kernel/test_memory.py:235 assert error[\"details\"][\"candidates\"] == [{\"name\": KNOTT, \"kind\": \"investigator\", \"id\": \"knott-twin\"},\n                                              {\"name\": KNOTT, \"kind\": \"npc\", \"id\": \"npc-steven-knott\"}]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(error,"fix"),"knott-twin");return pyBool(__left)?pyContains(pyAt(error,"fix"),"npc-steven-knott"):__left})())),"tests/kernel/test_memory.py:237 assert \"knott-twin\" in error[\"fix\"] and \"npc-steven-knott\" in error[\"fix\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await submit_err(kernel,pyAt(packet,"job_id"),[({["kind"]:"knowledge",["subject"]:"steven-knott",["statement"]:"x"})])),"details"),"index"),0)),"tests/kernel/test_memory.py:239 assert submit_err(kernel, packet[\"job_id\"], [{\"kind\": \"knowledge\", \"subject\": \"steven-knott\", \"statement\": \"x\"}])[\"details\"][\"index\"] == 0");
result=(await submit(kernel,pyAt(packet,"job_id"),[({["kind"]:"knowledge",["subject"]:"npc-steven-knott",["statement"]:"x"}),({["kind"]:"knowledge",["subject"]:"knott-twin",["statement"]:"y"})]));
rows=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"candidates.jsonl")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"candidates"),2);return pyBool(__left)?pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(rows)){if(pyBool(true))__rows.push(pyAt(r,"subject"));}return __rows;})()),[KNOTT,KNOTT]):__left})())),"tests/kernel/test_memory.py:243 assert result[\"candidates\"] == 2 and [r[\"subject\"] for r in rows] == [KNOTT, KNOTT]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ambiguous_name_is_rejected_with_ids_to_choose_from"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ambiguous_name_is_rejected_with_ids_to_choose_from(await kernel(t,{}));});
export async function test_relationship_supersession_keeps_both_records(kernel:any){
let result:any,rows:any,old:any,event:any,hits:any,with_closed:any,closed:any;
(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",[({["kind"]:"relationship",["subject"]:KNOTT,["entities"]:[INV],["statement"]:"雇主，客气而疏远。"}),({["kind"]:"knowledge",["subject"]:KNOTT,["entities"]:[INV],["statement"]:"知道调查员的名字。"})]));
(await close_turn(kernel,2));
result=(await submit(kernel,"extract:c1:t2",[({["kind"]:"relationship",["subject"]:KNOTT,["entities"]:["thomas-hayes"],["statement"]:"开始信任调查员。"}),({["kind"]:"relationship",["subject"]:INV,["entities"]:[KNOTT],["statement"]:"觉得诺特有所隐瞒。"}),({["kind"]:"knowledge",["subject"]:KNOTT,["entities"]:[INV],["statement"]:"知道调查员受过伤。"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"superseded"),["mem:t1-1"]);return pyBool(__left)?pyEqual(pyAt(result,"written"),["mem:t2-1","mem:t2-2","mem:t2-3"]):__left})())),"tests/kernel/test_memory.py:258 assert result[\"superseded\"] == [\"mem:t1-1\"] and result[\"written\"] == [\"mem:t2-1\", \"mem:t2-2\", \"mem:t2-3\"]");
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"candidates.jsonl"))))){if(pyBool(true))__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyLen(rows)),5)),"tests/kernel/test_memory.py:260 assert len(rows) == 5");
old=pyAt(rows,"mem:t1-1");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(old,"status"),"superseded");return pyBool(__left)?pyEqual(pyAt(old,"valid_until_turn"),2):__left})());return pyBool(__left)?pyEqual(pyAt(old,"superseded_by"),"mem:t2-1"):__left})())),"tests/kernel/test_memory.py:262 assert old[\"status\"] == \"superseded\" and old[\"valid_until_turn\"] == 2 and old[\"superseded_by\"] == \"mem:t2-1\"");
assert.ok(pyBool(pyEqual(pyAt(old,"statement"),"雇主，客气而疏远。")),"tests/kernel/test_memory.py:263 assert old[\"statement\"] == \"雇主，客气而疏远。\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,"mem:t2-1"),"status"),"candidate");return pyBool(__left)?!pyContains(pyAt(rows,"mem:t2-1"),"superseded_by"):__left})())),"tests/kernel/test_memory.py:264 assert rows[\"mem:t2-1\"][\"status\"] == \"candidate\" and \"superseded_by\" not in rows[\"mem:t2-1\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"mem:t1-2"),"status"),"candidate")),"tests/kernel/test_memory.py:265 assert rows[\"mem:t1-2\"][\"status\"] == \"candidate\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"mem:t2-2"),"status"),"candidate")),"tests/kernel/test_memory.py:266 assert rows[\"mem:t2-2\"][\"status\"] == \"candidate\"");
event=pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),"memory-written")))__rows.push(e);}return __rows;})()),(-1));
assert.ok(pyBool(pyEqual(pyAt(pyAt(event,"data"),"superseded"),1)),"tests/kernel/test_memory.py:268 assert event[\"data\"][\"superseded\"] == 1");
hits=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":[KNOTT],"kinds":["relationship"]})),"hits");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(hits)){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),["mem:t2-1","mem:t2-2"])),"tests/kernel/test_memory.py:270 assert [h[\"id\"] for h in hits] == [\"mem:t2-1\", \"mem:t2-2\"]");
with_closed=(await pyMethod(kernel,"table",["recall"],{"what":"memory","about":[KNOTT],"kinds":["relationship"],"include_superseded":true}));
closed=pyAt((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt(with_closed,"hits"))){if(pyBool(pyEqual(pyAt(h,"id"),"mem:t1-1")))__rows.push(h);}return __rows;})()),0);
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(closed,"status"),"superseded");return pyBool(__left)?pyEqual(pyAt(closed,"superseded_by"),"mem:t2-1"):__left})());return pyBool(__left)?pyEqual(pyAt(closed,"valid_until_turn"),2):__left})())),"tests/kernel/test_memory.py:273 assert closed[\"status\"] == \"superseded\" and closed[\"superseded_by\"] == \"mem:t2-1\" and closed[\"valid_until_turn\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_relationship_supersession_keeps_both_records"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_relationship_supersession_keeps_both_records(await kernel(t,{}));});
export async function test_replay_is_idempotent_and_divergence_conflicts(kernel:any){
let candidates:any,first:any,again:any,conflict:any;
(await first_turn(kernel));
candidates=[({["kind"]:"belief",["subject"]:INV,["statement"]:"房子里有东西。"})];
first=(await submit(kernel,"extract:c1:t1",candidates));
again=(await submit(kernel,"extract:c1:t1",candidates));
assert.ok(pyBool(pyEqual(again,({...first,["replayed"]:true}))),"tests/kernel/test_memory.py:281 assert again == {**first, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await pyLen((await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"candidates.jsonl"))))),1)),"tests/kernel/test_memory.py:282 assert len(read_jsonl(memory_dir(kernel.workspace) / \"candidates.jsonl\")) == 1");
assert.ok(pyBool(pyEqual((await pyLen((await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),"memory-written")))__rows.push(e);}return __rows;})()))),1)),"tests/kernel/test_memory.py:283 assert len([e for e in read_jsonl(campaign_dir(kernel.workspace) / \"events.jsonl\") if e[\"type\"] == \"memory-written\"]) == 1");
conflict=(await submit_err(kernel,"extract:c1:t1",[({["kind"]:"belief",["subject"]:INV,["statement"]:"房子里没东西。"})]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(conflict,"code"),"idempotency_conflict");return pyBool(__left)?pyEqual(pyAt(pyAt(conflict,"details"),"job_id"),"extract:c1:t1"):__left})())),"tests/kernel/test_memory.py:285 assert conflict[\"code\"] == \"idempotency_conflict\" and conflict[\"details\"][\"job_id\"] == \"extract:c1:t1\"");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,"extract:c9:t1",candidates)),"code"),"invalid_params")),"tests/kernel/test_memory.py:286 assert submit_err(kernel, \"extract:c9:t1\", candidates)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await submit_err(kernel,"extract:c1:t7",candidates)),"code"),"invalid_params")),"tests/kernel/test_memory.py:287 assert submit_err(kernel, \"extract:c1:t7\", candidates)[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_replay_is_idempotent_and_divergence_conflicts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_replay_is_idempotent_and_divergence_conflicts(await kernel(t,{}));});
export async function test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it(kernel:any){
let failed:any,backlog:any;
(await first_turn(kernel));
(await close_turn(kernel,2));
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),2)),"tests/kernel/test_memory.py:293 assert job(kernel)[\"turn\"] == 2");
failed=(await pyMethod(kernel,"ok",["memory.fail",({["campaign"]:CAMPAIGN,["job_id"]:"extract:c1:t2",["reason"]:"model_error",["detail"]:"timeout after 60s"})],{}));
assert.ok(pyBool(pyEqual(failed,({["job_id"]:"extract:c1:t2",["turn"]:2,["status"]:"pending",["reason"]:"model_error"}))),"tests/kernel/test_memory.py:296 assert failed == {\"job_id\": \"extract:c1:t2\", \"turn\": 2, \"status\": \"pending\", \"reason\": \"model_error\"}");
backlog=(await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"backlog.jsonl")));
assert.ok(pyBool(pyEqual(backlog,[({...pyAt(backlog,0),["job_id"]:"extract:c1:t2",["turn"]:2,["reason"]:"model_error",["detail"]:"timeout after 60s",["status"]:"pending"})])),"tests/kernel/test_memory.py:298 assert backlog == [{**backlog[0], \"job_id\": \"extract:c1:t2\", \"turn\": 2, \"reason\": \"model_error\",\n                        \"detail\": \"timeout after 60s\", \"status\": \"pending\"}]");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await memory_dir(kernel.workspace)),"jobs"),"extract:c1:t2.json"))),"status"),"failed")),"tests/kernel/test_memory.py:300 assert read_json(memory_dir(kernel.workspace) / \"jobs\" / \"extract:c1:t2.json\")[\"status\"] == \"failed\"");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel)),"turn"),1)),"tests/kernel/test_memory.py:301 assert job(kernel)[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel,({"turn":2}))),"job_id"),"extract:c1:t2")),"tests/kernel/test_memory.py:302 assert job(kernel, turn=2)[\"job_id\"] == \"extract:c1:t2\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["memory.fail",({["campaign"]:CAMPAIGN,["job_id"]:"extract:c1:t2",["reason"]:"bored"})],{})),"code"),"invalid_params")),"tests/kernel/test_memory.py:303 assert kernel.err(\"memory.fail\", {\"campaign\": CAMPAIGN, \"job_id\": \"extract:c1:t2\", \"reason\": \"bored\"})[\"code\"] == \"invalid_params\"");
(await submit(kernel,"extract:c1:t2",[]));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await read_jsonl(pyDivide((await memory_dir(kernel.workspace)),"backlog.jsonl"))),0),"status"),"recovered")),"tests/kernel/test_memory.py:305 assert read_jsonl(memory_dir(kernel.workspace) / \"backlog.jsonl\")[0][\"status\"] == \"recovered\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await memory_dir(kernel.workspace)),"jobs"),"extract:c1:t2.json"))),"status"),"done")),"tests/kernel/test_memory.py:306 assert read_json(memory_dir(kernel.workspace) / \"jobs\" / \"extract:c1:t2.json\")[\"status\"] == \"done\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it(await kernel(t,{}));});

export async function seed_recall(kernel:any){
(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",[({["kind"]:"knowledge",["subject"]:INV,["entities"]:[KNOTT],["statement"]:"k1：调查员知道诺特急着出租。"}),({["kind"]:"world_event",["subject"]:"world",["statement"]:"w1：钥匙易手。"})]));
(await close_turn(kernel,2));
(await submit(kernel,"extract:c1:t2",[({["kind"]:"knowledge",["subject"]:KNOTT,["statement"]:"k2：诺特知道调查员来过。"}),({["kind"]:"belief",["subject"]:INV,["statement"]:"b2：调查员觉得房子有问题。"})]));
}
export async function test_recall_memory_ranks_by_overlap_then_recency_and_narrows_on_about(kernel:any){
let default_value:any,hit:any,unknown:any,requested:any;
(await seed_recall(kernel));
default_value=(await pyMethod(kernel,"table",["recall"],{"what":"memory"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(default_value,"what"),"memory");return pyBool(__left)?pyEqual(pyAt(default_value,"about"),[KNOTT,INV]):__left})())),"tests/kernel/test_memory.py:327 assert default[\"what\"] == \"memory\" and default[\"about\"] == [KNOTT, INV]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt(default_value,"hits"))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),["mem:t1-1","mem:t2-1","mem:t2-2","mem:t1-2"])),"tests/kernel/test_memory.py:328 assert [h[\"id\"] for h in default[\"hits\"]] == [\"mem:t1-1\", \"mem:t2-1\", \"mem:t2-2\", \"mem:t1-2\"]");
hit=pyAt(pyAt(default_value,"hits"),0);
assert.ok(pyBool(pyEqual(pyAt(hit,"authority"),"conversation_report")),"tests/kernel/test_memory.py:330 assert hit[\"authority\"] == \"conversation_report\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(hit,"source"),"turn"),1);return pyBool(__left)?pyAt(pyAt(hit,"source"),"commit"):__left})())),"tests/kernel/test_memory.py:331 assert hit[\"source\"][\"turn\"] == 1 and hit[\"source\"][\"commit\"]");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(hit,"items",[],{})))){if(pyBool(!pyContains(new Set(["authority","source"]),k)))__rows.push([k,v]);}return __rows;})())),({["id"]:"mem:t1-1",["kind"]:"knowledge",["subject"]:INV,["knowers"]:[],["entities"]:[KNOTT],["statement"]:"k1：调查员知道诺特急着出租。",["privacy"]:"player_safe",["state"]:"accurate",["confidence"]:null,["status"]:"candidate",["turn"]:1,["worldline"]:"main",["loop"]:0}))),"tests/kernel/test_memory.py:332 assert {k: v for k, v in hit.items() if k not in {\"authority\", \"source\"}} == {\"id\": \"mem:t1-1\", \"kind\": \"knowledge\", \"subject\": INV, \"knowers\": [], \"entities\": [KNOTT],\n                   \"statement\": \"k1：调查员知道诺特急着出租。\", \"privacy\": \"player_safe\", \"state\": \"accurate\",\n                   \"confidence\": None, \"status\": \"candidate\", \"turn\": 1,\n                   # §15.5: which worldline and which circuit of the loop remembered it.\n                   \"worldline\": \"main\", \"loop\": 0}");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["steven-knott"]})),"hits"))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),["mem:t2-1","mem:t1-1"])),"tests/kernel/test_memory.py:338 assert [h[\"id\"] for h in kernel.table(\"recall\", what=\"memory\", about=[\"steven-knott\"])[\"hits\"]] == [\"mem:t2-1\", \"mem:t1-1\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["world"]})),"hits"))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),["mem:t1-2"])),"tests/kernel/test_memory.py:339 assert [h[\"id\"] for h in kernel.table(\"recall\", what=\"memory\", about=[\"world\"])[\"hits\"]] == [\"mem:t1-2\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Knott's Office"]})),"hits"),[])),"tests/kernel/test_memory.py:340 assert kernel.table(\"recall\", what=\"memory\", about=[\"Knott's Office\"])[\"hits\"] == []");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","kinds":["belief","world_event"]})),"hits"))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),["mem:t2-2","mem:t1-2"])),"tests/kernel/test_memory.py:341 assert [h[\"id\"] for h in kernel.table(\"recall\", what=\"memory\", kinds=[\"belief\", \"world_event\"])[\"hits\"]] == [\"mem:t2-2\", \"mem:t1-2\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","turns":[2,2]})),"hits"))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),["mem:t2-1","mem:t2-2"])),"tests/kernel/test_memory.py:342 assert [h[\"id\"] for h in kernel.table(\"recall\", what=\"memory\", turns=[2, 2])[\"hits\"]] == [\"mem:t2-1\", \"mem:t2-2\"]");
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","limit":1})),"hits"))),1)),"tests/kernel/test_memory.py:343 assert len(kernel.table(\"recall\", what=\"memory\", limit=1)[\"hits\"]) == 1");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Corbitt"]})),"about"),["Walter Corbitt"])),"tests/kernel/test_memory.py:346 assert kernel.table(\"recall\", what=\"memory\", about=[\"Corbitt\"])[\"about\"] == [\"Walter Corbitt\"]");
unknown=(await pyMethod(kernel,"table_err",["recall"],{"what":"memory","about":["Atlantis"]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(unknown,"code"),"unknown_entity");return pyBool(__left)?pyEqual(pyAt(pyAt(unknown,"details"),"query"),"Atlantis"):__left})())),"tests/kernel/test_memory.py:348 assert unknown[\"code\"] == \"unknown_entity\" and unknown[\"details\"][\"query\"] == \"Atlantis\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"memory","kinds":["rumor"]})),"code"),"invalid_params")),"tests/kernel/test_memory.py:349 assert kernel.table_err(\"recall\", what=\"memory\", kinds=[\"rumor\"])[\"code\"] == \"invalid_params\"");
requested=(await pyMethod(kernel,"table",["recall"],{"what":"memory","limit":31}));
assert.ok(pyBool(pyEqual(pyAt(requested,"hits"),pyAt(default_value,"hits"))),"tests/kernel/test_memory.py:351 assert requested[\"hits\"] == default[\"hits\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(requested,"page"),"count"),4);return pyBool(__left)?pyEqual(pyAt(pyAt(requested,"page"),"total"),4):__left})())),"tests/kernel/test_memory.py:352 assert requested[\"page\"][\"count\"] == 4 and requested[\"page\"][\"total\"] == 4");
assert.ok(pyBool(!pyContains(requested,"next")),"tests/kernel/test_memory.py:353 assert \"next\" not in requested");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"memory","limit":0})),"code"),"invalid_params")),"tests/kernel/test_memory.py:354 assert kernel.table_err(\"recall\", what=\"memory\", limit=0)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"memory","limit":(-1)})),"code"),"invalid_params")),"tests/kernel/test_memory.py:355 assert kernel.table_err(\"recall\", what=\"memory\", limit=-1)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"state"),"awaiting_player")),"tests/kernel/test_memory.py:357 assert kernel.table(\"status\")[\"state\"] == \"awaiting_player\"");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":[INV]})),"hits")),"tests/kernel/test_memory.py:358 assert kernel.table(\"recall\", what=\"memory\", about=[INV])[\"hits\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recall_memory_ranks_by_overlap_then_recency_and_narrows_on_about"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recall_memory_ranks_by_overlap_then_recency_and_narrows_on_about(await kernel(t,{}));});
export async function test_recall_memory_ranks_by_kind_after_overlap_and_before_recency(kernel:any){
let hits:any,capsule:any,fields:any;

(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",[({["kind"]:"knowledge",["subject"]:INV,["entities"]:[KNOTT],["statement"]:"k1"}),({["kind"]:"player_assertion",["subject"]:INV,["entities"]:[KNOTT],["statement"]:"a1"})]));
(await close_turn(kernel,2));
(await submit(kernel,"extract:c1:t2",[({["kind"]:"player_assertion",["subject"]:INV,["entities"]:[KNOTT],["statement"]:"a2"}),({["kind"]:"belief",["subject"]:INV,["entities"]:[KNOTT],["statement"]:"b2"}),({["kind"]:"world_event",["subject"]:"world",["statement"]:"w2"}),({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INV],["knowers"]:[KNOTT,INV],["statement"]:"p2"})]));
hits=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory"})),"hits");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(hits)){if(pyBool(true))__rows.push([pyAt(h,"kind"),pyAt(h,"turn")]);}return __rows;})()),[["promise",2],["knowledge",1],["belief",2],["player_assertion",2],["player_assertion",1],["world_event",2]])),"tests/kernel/test_memory.py:377 assert [(h[\"kind\"], h[\"turn\"]) for h in hits] == [\n        (\"promise\", 2), (\"knowledge\", 1),        # tier 0, newest first\n        (\"belief\", 2),                           # tier 1, though newer than the knowledge\n        (\"player_assertion\", 2), (\"player_assertion\", 1),  # tier 2, newest first\n        (\"world_event\", 2),                      # overlap 0 still ranks last of all\n    ]");
(await pyMethod(kernel,"table",["player_input"],{"text":"第 3 回合。"}));
capsule=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"memory");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(capsule)){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),pySlice((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(hits)){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),undefined,6))),"tests/kernel/test_memory.py:386 assert [h[\"id\"] for h in capsule] == [h[\"id\"] for h in hits][:6]");
fields=new Set(["id","kind","statement","subject","turn","status","state","authority"]);
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(capsule)){if(pyBool(true))__rows.push(pyEqual((await pySet(h)),pyUnion(fields,((pyBool(pyEqual(pyAt(h,"kind"),"promise"))?new Set(["fulfillment"]):(await pySet()))))));}return __rows;})())))),"tests/kernel/test_memory.py:388 assert all(set(h) == fields | ({\"fulfillment\"} if h[\"kind\"] == \"promise\" else set()) for h in capsule)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(capsule)){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(h,"authority"),"conversation_report");return pyBool(__left)?pyEqual(pyAt(h,"status"),"candidate"):__left})()));}return __rows;})())))),"tests/kernel/test_memory.py:389 assert all(h[\"authority\"] == \"conversation_report\" and h[\"status\"] == \"candidate\" for h in capsule)");
assert.ok(pyBool(pyEqual(pyAt(capsule,0),({["id"]:"mem:t2-4",["kind"]:"promise",["statement"]:"p2",["subject"]:KNOTT,["turn"]:2,["status"]:"candidate",["state"]:"accurate",["authority"]:"conversation_report",["fulfillment"]:({["status"]:"open",["terms"]:[]})}))),"tests/kernel/test_memory.py:390 assert capsule[0] == {\"id\": \"mem:t2-4\", \"kind\": \"promise\", \"statement\": \"p2\", \"subject\": KNOTT,\n                          \"turn\": 2, \"status\": \"candidate\", \"state\": \"accurate\", \"authority\": \"conversation_report\",\n                          \"fulfillment\": {\"status\": \"open\", \"terms\": []}}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recall_memory_ranks_by_kind_after_overlap_and_before_recency"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recall_memory_ranks_by_kind_after_overlap_and_before_recency(await kernel(t,{}));});
export async function test_prior_in_the_job_packet_follows_the_same_ranking(kernel:any){
let prior:any;
(await seed_recall(kernel));
(await close_turn(kernel,3));
prior=pyAt((await job(kernel,({"turn":3}))),"prior");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(prior)){if(pyBool(true))__rows.push(pyAt(p,"id"));}return __rows;})()),["mem:t1-1","mem:t2-1","mem:t2-2","mem:t1-2"])),"tests/kernel/test_memory.py:399 assert [p[\"id\"] for p in prior] == [\"mem:t1-1\", \"mem:t2-1\", \"mem:t2-2\", \"mem:t1-2\"]");
assert.ok(pyBool(pyEqual(pyAt(prior,0),({["id"]:"mem:t1-1",["kind"]:"knowledge",["subject"]:INV,["statement"]:"k1：调查员知道诺特急着出租。",["status"]:"candidate",["turn"]:1}))),"tests/kernel/test_memory.py:400 assert prior[0] == {\"id\": \"mem:t1-1\", \"kind\": \"knowledge\", \"subject\": INV, \"statement\": \"k1：调查员知道诺特急着出租。\",\n                        \"status\": \"candidate\", \"turn\": 1}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_prior_in_the_job_packet_follows_the_same_ranking"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_prior_in_the_job_packet_follows_the_same_ranking(await kernel(t,{}));});

export async function test_post_commit_failures_are_telemetry_not_errors(kernel:any){
let result:any,status:any,telemetry:any,kernel_rows:any;
(await open_turn(kernel));
(await pyMethod((pyDivide((await memory_dir(kernel.workspace)),"episodes.jsonl")),"unlink",[],{}));
(await pyMethod((pyDivide((await memory_dir(kernel.workspace)),"episodes.jsonl")),"mkdir",[],{}));
result=(await narrate(kernel,"t1-c1","第一回合。"));
assert.ok(pyBool((await (async()=>{const __left=pyAt(result,"commit");return pyBool(__left)?pyEqual(pyAt(result,"extraction"),({["job_id"]:"extract:c1:t1"})):__left})())),"tests/kernel/test_memory.py:412 assert result[\"commit\"] and result[\"extraction\"] == {\"job_id\": \"extract:c1:t1\"}");
status=(await pyMethod(kernel,"table",["status"],{}));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["turn","state","receipts","mechanics","pending_choice"])){if(pyBool(true))__rows.push([key,pyAt(status,key)]);}return __rows;})())),({["turn"]:2,["state"]:"awaiting_player",["receipts"]:[],["mechanics"]:[],["pending_choice"]:null}))),"tests/kernel/test_memory.py:414 assert {key: status[key] for key in (\"turn\", \"state\", \"receipts\", \"mechanics\", \"pending_choice\")} == {\n        \"turn\": 2, \"state\": \"awaiting_player\", \"receipts\": [], \"mechanics\": [], \"pending_choice\": None}");
assert.ok(pyBool(pyAt(status,"labels")),"tests/kernel/test_memory.py:416 assert status[\"labels\"]");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"save"),"continuation"),"latest.json"))),"turn"),1)),"tests/kernel/test_memory.py:417 assert read_json(campaign_dir(kernel.workspace) / \"save\" / \"continuation\" / \"latest.json\")[\"turn\"] == 1");
telemetry=(await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"telemetry.jsonl")));
kernel_rows=(await (async()=>{const __rows:any[]=[];for(const t of pyIterable(telemetry)){if(pyBool(pyEqual(pyAt(t,"lane"),"kernel")))__rows.push(t);}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(kernel_rows)){if(pyBool(true))__rows.push([pyAt(t,"lane"),pyAt(t,"step"),pyAt(t,"turn"),pyAt(t,"ok")]);}return __rows;})()),[["kernel","episode",1,false]])),"tests/kernel/test_memory.py:421 assert [(t[\"lane\"], t[\"step\"], t[\"turn\"], t[\"ok\"]) for t in kernel_rows] == [(\"kernel\", \"episode\", 1, False)]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(pyAt(kernel_rows,0),"error"),"episodes.jsonl");return pyBool(__left)?__left:pyContains(pyAt(pyAt(kernel_rows,0),"error"),"Is a directory")})())),"tests/kernel/test_memory.py:422 assert \"episodes.jsonl\" in kernel_rows[0][\"error\"] or \"Is a directory\" in kernel_rows[0][\"error\"]");
assert.ok(pyBool(pyEqual(pyAt((await job(kernel,({"turn":1}))),"present"),[KNOTT])),"tests/kernel/test_memory.py:424 assert job(kernel, turn=1)[\"present\"] == [KNOTT]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_post_commit_failures_are_telemetry_not_errors"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_post_commit_failures_are_telemetry_not_errors(await kernel(t,{}));});
