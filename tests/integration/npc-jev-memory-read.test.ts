// Migrated from tests/kernel/test_jev_memory_read.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,campaign_dir,git_log,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {INV,KNOTT,close_turn,first_turn,submit} from "./npc-memory.test.ts";
import {decisions_with,finish_step,play_turn,referenced_job} from "./npc-jev-memory-write.test.ts";








export async function evidence(client:any,action:any,params:any={}){
return (await pyMethod(client,"ok",["memory.evidence",({["campaign"]:CAMPAIGN,["action"]:action,...params})],{}));
}
export async function evidence_error(client:any,action:any,params:any={}){
return (await pyMethod(client,"err",["memory.evidence",({["campaign"]:CAMPAIGN,["action"]:action,...params})],{}));
}
export async function pages(client:any,snapshot:any){
let rows:any,offset:any,page:any;
const __unpack818=[[],0];rows=__unpack818[0];offset=__unpack818[1];
while(pyBool(true)){page=(await evidence(client,"page",({"snapshot":snapshot,"offset":offset})));
assert.ok(pyBool(pyLessEqual((await pyLen(pyAt(page,"rows"))),20)),"tests/kernel/test_jev_memory_read.py:30 assert len(page[\"rows\"]) <= 20");
assert.ok(pyBool(pyLessEqual((await pyLen((await pyMethod((await pyMethod(json,"dumps",[page],{"ensure_ascii":false})),"encode",[],{})))),pyMultiply(12,1024))),"tests/kernel/test_jev_memory_read.py:31 assert len(json.dumps(page, ensure_ascii=False).encode()) <= 12 * 1024");
(await pyMethod(rows,"extend",[pyAt(page,"rows")],{}));
if(pyBool((pyAt(page,"next_offset")===null))){return rows;}
assert.ok(pyBool(pyLess(offset,pyAt(page,"next_offset"))),"tests/kernel/test_jev_memory_read.py:35 assert page[\"next_offset\"] > offset");
offset=pyAt(page,"next_offset");}
}
export async function finish(client:any,snapshot:any,selected:any=[],assessments:any=[],considered:any=[],unknown:any=[]){
return (await evidence(client,"finish",({"snapshot":snapshot,"selected":(await pyList(selected)),"assessments":(await pyList(assessments)),"considered":(await pyList(considered)),"unknown":(await pyList(unknown))})));
}
export async function assessment(alias:any,overrides:any={}){
return ({["alias"]:alias,["relevance"]:"direct",["support"]:"supported",["applicability"]:"current",["contradiction"]:"none",...overrides});
}
export async function fingerprint(client:any){
let root:any,result:any,name:any,path:any;
root=(await campaign_dir(client.workspace));
result=({});
for(name of pyIterable(["campaign.json","world.json","turn.json","events.jsonl","memory/candidates.jsonl","npc-ledger.json"])){
path=pyDivide(root,name);
result[name]=(pyBool((await pyMethod(path,"exists",[],{})))?(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(path,"read_bytes",[],{}))],{})),"hexdigest",[],{})):null);
}
result["git"]=(await git_log(client.workspace));
return result;
}
export async function utf16_slice(text:any,start:any,end:any){
return (await pyMethod(pySlice((await pyMethod(text,"encode",["utf-16-le"],{})),pyMultiply(start,2),pyMultiply(end,2)),"decode",["utf-16-le"],{}));
}
export async function publish_exact_keeper_source(client:any,keeper_text:any,needle:any){
let retained:any,packet:any,matches:any,annotations:any,submitted:any;
(await play_turn(client,"I ask for the exact account.",keeper_text));
retained=null;
while(pyBool(true)){packet=(await referenced_job(client));
matches=(await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyContains(pyAt(segment,"text"),needle))){__rows.push(segment);}}return __rows;})());
annotations=({});
if(pyBool(matches)){assert.ok(pyBool((retained===null)),pyStr("the fixture answer must occupy one exact issued occurrence"));
retained=pyAt(matches,0);
annotations[pyAt(retained,"alias")]=[({["kind"]:"knowledge",["subject"]:INV,["entities"]:[KNOTT]})];}
submitted=(await finish_step(client,packet,(await decisions_with(packet,annotations))));
if(pyBool(pyEqual(pyAt(submitted,"status"),"done"))){assert.ok(pyBool((retained!==null)),"tests/kernel/test_jev_memory_read.py:77 assert retained is not None");
return retained;}
assert.ok(pyBool(pyEqual(pyAt(submitted,"status"),"open")),"tests/kernel/test_jev_memory_read.py:79 assert submitted[\"status\"] == \"open\"");}
}
export async function read_keeper_pages(client:any,snapshot:any,alias:any){
let reads:any,offset:any,result:any,continuation:any;
const __unpack3098=[[],0];reads=__unpack3098[0];offset=__unpack3098[1];
while(pyBool(true)){result=(await evidence(client,"original",({"snapshot":snapshot,"alias":alias,"role":"keeper","offset":offset})));
assert.ok(pyBool(pyLessEqual((await pyLen((await pyMethod((await pyMethod(json,"dumps",[result],{"ensure_ascii":false})),"encode",[],{})))),pyMultiply(12,1024))),"tests/kernel/test_jev_memory_read.py:86 assert len(json.dumps(result, ensure_ascii=False).encode()) <= 12 * 1024");
(await pyMethod(reads,"append",[result],{}));
continuation=(await pyMethod(pyAt(pyAt(result,"context"),0),"get",["next"],{}));
if(pyBool((continuation===null))){return reads;}
assert.ok(pyBool(pyLess(offset,pyAt(continuation,"offset"))),"tests/kernel/test_jev_memory_read.py:91 assert continuation[\"offset\"] > offset");
offset=pyAt(continuation,"offset");}
}
export async function test_wide_candidate_pool_pages_beyond_twelve_and_raw_gap_fallback_is_explicit_and_read_only(kernel:any){
let before:any,snapshot:any,rows:any,widened:any,widened_rows:any,filtered:any,filtered_rows:any;
(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange(12)))){__rows.push(({["kind"]:"knowledge",["subject"]:INV,["entities"]:[KNOTT],["statement"]:`turn one indexed report ${index}`}));}return __rows;})())));
(await close_turn(kernel,2));
(await submit(kernel,"extract:c1:t2",(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange(12)))){__rows.push(({["kind"]:"belief",["subject"]:INV,["entities"]:[KNOTT],["statement"]:`turn two indexed report ${index}`}));}return __rows;})())));
before=(await fingerprint(kernel));
snapshot=(await evidence(kernel,"snapshot",({"query":"Find any retained report about the investigation."})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(snapshot,"indexed"),24);return pyBool(__left)?pyLess(24,pyAt(snapshot,"total")):__left})())),"tests/kernel/test_jev_memory_read.py:109 assert snapshot[\"indexed\"] == 24 and snapshot[\"total\"] > 24");
assert.ok(pyBool(pyEqual(pyAt(pyAt(snapshot,"coverage"),"raw_gap_turns"),[0])),"tests/kernel/test_jev_memory_read.py:110 assert snapshot[\"coverage\"][\"raw_gap_turns\"] == [0]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(snapshot,"coverage"),"raw_unavailable_lines"),[])),"tests/kernel/test_jev_memory_read.py:111 assert snapshot[\"coverage\"][\"raw_unavailable_lines\"] == []");
rows=(await pages(kernel,pyAt(snapshot,"snapshot")));
assert.ok(pyBool(pyEqual((await pyLen(rows)),pyAt(snapshot,"total"))),"tests/kernel/test_jev_memory_read.py:113 assert len(rows) == snapshot[\"total\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"alias"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange((await pyLen(rows)))))){__rows.push(`entry:${index}`);}return __rows;})()))),"tests/kernel/test_jev_memory_read.py:114 assert [row[\"alias\"] for row in rows] == [f\"entry:{index}\" for index in range(len(rows))]");
assert.ok(pyBool(pyEqual((await pySum((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyEqual(pyAt(row,"origin"),"memory"));}return __rows;})()))),24)),"tests/kernel/test_jev_memory_read.py:115 assert sum(row[\"origin\"] == \"memory\" for row in rows) == 24");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"origin"),"raw");return pyBool(__left)?pyEqual(pyAt(row,"status"),"unindexed"):__left})()));}return __rows;})())))),"tests/kernel/test_jev_memory_read.py:116 assert any(row[\"origin\"] == \"raw\" and row[\"status\"] == \"unindexed\" for row in rows)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyEqual(pyAt(row,"authority"),"conversation_report"));}return __rows;})())))),"tests/kernel/test_jev_memory_read.py:117 assert all(row[\"authority\"] == \"conversation_report\" for row in rows)");
widened=(await evidence(kernel,"snapshot",({"query":"Inspect every raw original too.","raw_all":true})));
widened_rows=(await pages(kernel,pyAt(widened,"snapshot")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(widened,"indexed"),24);return pyBool(__left)?pyLess(pyAt(snapshot,"raw"),pyAt(widened,"raw")):__left})())),"tests/kernel/test_jev_memory_read.py:121 assert widened[\"indexed\"] == 24 and widened[\"raw\"] > snapshot[\"raw\"]");
assert.ok(pyBool(pyLess(pyAt(snapshot,"total"),pyAt(widened,"total"))),"tests/kernel/test_jev_memory_read.py:122 assert widened[\"total\"] > snapshot[\"total\"]");
assert.ok(pyBool((await pyMethod(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(widened_rows)){if(pyBool(pyEqual(pyAt(row,"origin"),"raw"))){__rows.push(pyAt(row,"turn"));}}return __rows;})())),"issuperset",[new Set([0,1,2])],{}))),"tests/kernel/test_jev_memory_read.py:123 assert {row[\"turn\"] for row in widened_rows if row[\"origin\"] == \"raw\"}.issuperset({0, 1, 2})");
filtered=(await evidence(kernel,"snapshot",({"query":"Only turn-two beliefs about the investigator.","filters":({["turns"]:[2,2],["about"]:[INV],["kinds"]:["belief"],["include_superseded"]:false})})));
filtered_rows=(await pages(kernel,pyAt(filtered,"snapshot")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(filtered,"indexed"),12);return pyBool(__left)?pyEqual(pyAt(filtered,"raw"),0):__left})())),"tests/kernel/test_jev_memory_read.py:127 assert filtered[\"indexed\"] == 12 and filtered[\"raw\"] == 0");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(filtered_rows)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(row,"kind"),"belief");return pyBool(__left)?pyEqual(pyAt(row,"turn"),2):__left})());return pyBool(__left)?pyEqual(pyAt(row,"subject"),INV):__left})()));}return __rows;})())))),"tests/kernel/test_jev_memory_read.py:128 assert all(row[\"kind\"] == \"belief\" and row[\"turn\"] == 2 and row[\"subject\"] == INV for row in filtered_rows)");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),pyStr("snapshot and paging never write memory, world, events, or Git"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_wide_candidate_pool_pages_beyond_twelve_and_raw_gap_fallback_is_explicit_and_read_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_wide_candidate_pool_pages_beyond_twelve_and_raw_gap_fallback_is_explicit_and_read_only(await kernel(t,{}));});
export async function test_exact_original_preserves_negation_conditions_utf16_refs_and_speaker_while_legacy_summary_is_derived(kernel:any){
let spoken:any,packet:any,source:any,legacy_statement:any,legacy_job:any,before:any,snapshot:any,rows:any,promise:any,legacy:any,refused:any,original:any,keeper:any,primary:any,legacy_original:any,complete:any;
spoken="\"I will not enter if the bell rings 🔔.\"";
(await play_turn(kernel,"I listen carefully.",`A pause. {{say:${KNOTT}}}${spoken}{{/say}}`));
packet=(await referenced_job(kernel));
source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyContains(pyAt(segment,"text"),spoken))){__rows.push(segment);}}return __rows;})())));
(await finish_step(kernel,packet,(await decisions_with(packet,({[pyAt(source,"alias")]:[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INV]})]})))));
(await close_turn(kernel,2));
legacy_statement="Generated legacy summary that is not copied from either original role.";
legacy_job=(await pyMethod(kernel,"ok",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:2})],{}));
(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(legacy_job,"job_id"),["candidates"]:[({["kind"]:"belief",["subject"]:INV,["entities"]:[KNOTT],["statement"]:legacy_statement})]})],{}));
before=(await fingerprint(kernel));
snapshot=(await evidence(kernel,"snapshot",({"query":"What exactly was promised, including its condition and negation?"})));
rows=(await pages(kernel,pyAt(snapshot,"snapshot")));
promise=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"text"),pyAt(source,"text"));return pyBool(__left)?pyEqual(pyAt(row,"kind"),"promise"):__left})()))){__rows.push(row);}}return __rows;})())));
legacy=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyEqual(pyAt(row,"text"),legacy_statement))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(promise,"derived")===false);return pyBool(__left)?pyEqual(pyAt(promise,"attribution"),pyAt(source,"attribution")):__left})())),"tests/kernel/test_jev_memory_read.py:150 assert promise[\"derived\"] is False and promise[\"attribution\"] == source[\"attribution\"]");
assert.ok(pyBool((pyAt(legacy,"derived")===true)),"tests/kernel/test_jev_memory_read.py:151 assert legacy[\"derived\"] is True");
refused=(await evidence_error(kernel,"finish",({"snapshot":pyAt(snapshot,"snapshot"),"selected":[pyAt(promise,"alias")],"assessments":[(await assessment(pyAt(promise,"alias")))],"considered":[pyAt(promise,"alias")],"unknown":[]})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(refused,"message"),"verified original"):__left})())),"tests/kernel/test_jev_memory_read.py:155 assert refused[\"code\"] == \"invalid_params\" and \"verified original\" in refused[\"message\"]");
original=(await evidence(kernel,"original",({"snapshot":pyAt(snapshot,"snapshot"),"alias":pyAt(promise,"alias")})));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(original,"verified")===true);return pyBool(__left)?(pyAt(original,"derived")===false):__left})())),"tests/kernel/test_jev_memory_read.py:157 assert original[\"verified\"] is True and original[\"derived\"] is False");
assert.ok(pyBool(pyEqual(pyAt(pyAt(original,"entry"),"text"),pyAt(source,"text"))),"tests/kernel/test_jev_memory_read.py:158 assert original[\"entry\"][\"text\"] == source[\"text\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(original,"entry"),"attribution"),pyAt(source,"attribution"))),"tests/kernel/test_jev_memory_read.py:159 assert original[\"entry\"][\"attribution\"] == source[\"attribution\"]");
keeper=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(original,"context"))){if(pyBool(pyEqual(pyAt(row,"role"),"keeper"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyContains(pyAt(keeper,"text"),spoken)),"tests/kernel/test_jev_memory_read.py:161 assert spoken in keeper[\"text\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(keeper,"speakers"))){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"name"),KNOTT);return pyBool(__left)?pyEqual(pyAt(row,"kind"),"npc"):__left})()));}return __rows;})())))),"tests/kernel/test_jev_memory_read.py:162 assert any(row[\"name\"] == KNOTT and row[\"kind\"] == \"npc\" for row in keeper[\"speakers\"])");
primary=pyAt(pyAt(original,"refs"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(primary,"sourceType"),"turn");return pyBool(__left)?(await pyMethod(pyAt(primary,"resource"),"endswith",[":keeper"],{})):__left})())),"tests/kernel/test_jev_memory_read.py:164 assert primary[\"sourceType\"] == \"turn\" and primary[\"resource\"].endswith(\":keeper\")");
assert.ok(pyBool(pyEqual(pyAt(primary,"scope"),pyAt(snapshot,"scope"))),"tests/kernel/test_jev_memory_read.py:165 assert primary[\"scope\"] == snapshot[\"scope\"]");
assert.ok(pyBool(pyEqual((await utf16_slice(pyAt(keeper,"text"),pySubtract(pyAt(pyAt(primary,"selector"),"start"),pyAt(pyAt(pyAt(pyAt(original,"refs"),1),"selector"),"start")),pySubtract(pyAt(pyAt(primary,"selector"),"end"),pyAt(pyAt(pyAt(pyAt(original,"refs"),1),"selector"),"start")))),pyAt(source,"text"))),"tests/kernel/test_jev_memory_read.py:166 assert utf16_slice(keeper[\"text\"], primary[\"selector\"][\"start\"] - original[\"refs\"][1][\"selector\"][\"start\"],\n                       primary[\"selector\"][\"end\"] - original[\"refs\"][1][\"selector\"][\"start\"]) == source[\"text\"]");
legacy_original=(await evidence(kernel,"original",({"snapshot":pyAt(snapshot,"snapshot"),"alias":pyAt(legacy,"alias")})));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(legacy_original,"verified")===true);return pyBool(__left)?(pyAt(legacy_original,"derived")===true):__left})())),"tests/kernel/test_jev_memory_read.py:170 assert legacy_original[\"verified\"] is True and legacy_original[\"derived\"] is True");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(legacy_original,"context"))){__rows.push(pyAt(row,"role"));}return __rows;})())),new Set(["player","keeper"]))),"tests/kernel/test_jev_memory_read.py:171 assert {row[\"role\"] for row in legacy_original[\"context\"]} == {\"player\", \"keeper\"}");
complete=(await finish(kernel,pyAt(snapshot,"snapshot"),[pyAt(promise,"alias")],[(await assessment(pyAt(promise,"alias")))],(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"alias"));}return __rows;})()),undefined));
assert.ok(pyBool(pyEqual(pyAt(complete,"status"),"ready")),"tests/kernel/test_jev_memory_read.py:174 assert complete[\"status\"] == \"ready\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(complete,"hits"),0),"entry"),"text"),pyAt(source,"text"))),"tests/kernel/test_jev_memory_read.py:175 assert complete[\"hits\"][0][\"entry\"][\"text\"] == source[\"text\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(complete,"hits"),0),"assessment"),(await assessment(pyAt(promise,"alias"))))),"tests/kernel/test_jev_memory_read.py:176 assert complete[\"hits\"][0][\"assessment\"] == assessment(promise[\"alias\"])");
assert.ok(pyBool(pyAt(complete,"refs")),"tests/kernel/test_jev_memory_read.py:177 assert complete[\"refs\"]");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_memory_read.py:178 assert fingerprint(kernel) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_exact_original_preserves_negation_conditions_utf16_refs_and_speaker_while_legacy_summary_is_derived"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_exact_original_preserves_negation_conditions_utf16_refs_and_speaker_while_legacy_summary_is_derived(await kernel(t,{}));});
export async function test_finish_preserves_separately_read_initial_condition_and_later_answer(kernel:any){
let condition:any,answer:any,source:any,snapshot:any,rows:any,selected:any,original_pages:any,completed:any,combined:any;
condition="Initial condition: the cellar door remains locked until the witness returns.";
answer="Later answer: Knott confirms that the witness returned before midnight.";
source=(await publish_exact_keeper_source(kernel,pyAdd(pyAdd(pyAdd(pyAdd(condition,"\n"),(pyMultiply("quiet corridor; ",285))),"\n"),answer),answer));
snapshot=(await evidence(kernel,"snapshot",({"query":"What condition governed the later answer?"})));
rows=(await pages(kernel,pyAt(snapshot,"snapshot")));
selected=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyEqual(pyAt(row,"text"),pyAt(source,"text")))){__rows.push(row);}}return __rows;})())));
original_pages=(await read_keeper_pages(kernel,pyAt(snapshot,"snapshot"),pyAt(selected,"alias")));
assert.ok(pyBool(pyEqual((await pyLen(original_pages)),2)),"tests/kernel/test_jev_memory_read.py:190 assert len(original_pages) == 2");
completed=(await finish(kernel,pyAt(snapshot,"snapshot"),[pyAt(selected,"alias")],[(await assessment(pyAt(selected,"alias")))],(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"alias"));}return __rows;})()),undefined));
assert.ok(pyBool(pyEqual(pyAt(completed,"status"),"ready")),"tests/kernel/test_jev_memory_read.py:195 assert completed[\"status\"] == \"ready\"");
combined=(await pyMethod("","join",[(await (async()=>{const __rows:any[]=[];for(const piece of pyIterable(pyAt(pyAt(pyAt(completed,"hits"),0),"context"))){__rows.push(pyAt(piece,"text"));}return __rows;})())],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(combined,condition);return pyBool(__left)?pyContains(combined,answer):__left})())),"tests/kernel/test_jev_memory_read.py:197 assert condition in combined and answer in combined");
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(pyAt(completed,"hits"),0),"get",["omitted_context_count",0],{})),0)),"tests/kernel/test_jev_memory_read.py:198 assert completed[\"hits\"][0].get(\"omitted_context_count\", 0) == 0");
assert.ok(pyBool(pyContains(pyAt(completed,"refs"),pyAt(pyAt(pyAt(original_pages,(-1)),"refs"),0))),pyStr("the selected occurrence keeps its primary canonical ref"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_finish_preserves_separately_read_initial_condition_and_later_answer"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_finish_preserves_separately_read_initial_condition_and_later_answer(await kernel(t,{}));});
export async function test_finish_bounds_accumulated_original_pages_and_reports_explicit_context_omission(kernel:any){
let answer:any,source:any,snapshot:any,rows:any,selected:any,original_pages:any,completed:any,hit:any;
answer="Final answer: Knott identifies the sealed room after reviewing every condition.";
source=(await publish_exact_keeper_source(kernel,pyAdd(pyAdd((pyMultiply("long contextual condition; ",720)),"\n"),answer),answer));
snapshot=(await evidence(kernel,"snapshot",({"query":"Which final answer follows the long conditions?"})));
rows=(await pages(kernel,pyAt(snapshot,"snapshot")));
selected=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyEqual(pyAt(row,"text"),pyAt(source,"text")))){__rows.push(row);}}return __rows;})())));
original_pages=(await read_keeper_pages(kernel,pyAt(snapshot,"snapshot"),pyAt(selected,"alias")));
assert.ok(pyBool(pyLessEqual(4,(await pyLen(original_pages)))),"tests/kernel/test_jev_memory_read.py:209 assert len(original_pages) >= 4");
completed=(await finish(kernel,pyAt(snapshot,"snapshot"),[pyAt(selected,"alias")],[(await assessment(pyAt(selected,"alias")))],(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"alias"));}return __rows;})()),undefined));
assert.ok(pyBool(pyEqual(pyAt(completed,"status"),"partial")),"tests/kernel/test_jev_memory_read.py:215 assert completed[\"status\"] == \"partial\"");
hit=pyAt(pyAt(completed,"hits"),0);
assert.ok(pyBool(pyLessEqual(1,pyAt(hit,"omitted_context_count"))),"tests/kernel/test_jev_memory_read.py:217 assert hit[\"omitted_context_count\"] >= 1");
assert.ok(pyBool((await (async()=>{const __left=pyAt(hit,"omitted_context");return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(hit,"omitted_context"))){__rows.push(pyEqual((await pySet(item)),new Set(["role","range"])));}return __rows;})()))):__left})())),"tests/kernel/test_jev_memory_read.py:218 assert hit[\"omitted_context\"] and all(set(item) == {\"role\", \"range\"} for item in hit[\"omitted_context\"])");
assert.ok(pyBool(pyLessEqual((await pyLen((await pyMethod((await pyMethod(json,"dumps",[completed],{"ensure_ascii":false})),"encode",[],{})))),pyMultiply(12,1024))),"tests/kernel/test_jev_memory_read.py:219 assert len(json.dumps(completed, ensure_ascii=False).encode()) <= 12 * 1024");
assert.ok(pyBool(pyContains(pyAt(completed,"refs"),pyAt(pyAt(pyAt(original_pages,(-1)),"refs"),0))),pyStr("context shedding cannot discard the primary ref"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_finish_bounds_accumulated_original_pages_and_reports_explicit_context_omission"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_finish_bounds_accumulated_original_pages_and_reports_explicit_context_omission(await kernel(t,{}));});
export async function test_scope_unissued_alias_and_selection_bounds_fail_closed(kernel:any){
let foreign:any,snapshot:any,rows:any,stale:any,selected:any,too_many:any;
(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange(12)))){__rows.push(({["kind"]:"knowledge",["subject"]:INV,["statement"]:`row ${index}`}));}return __rows;})())));
(await close_turn(kernel,2));
(await submit(kernel,"extract:c1:t2",(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange(12)))){__rows.push(({["kind"]:"belief",["subject"]:INV,["statement"]:`later ${index}`}));}return __rows;})())));
foreign=(await evidence_error(kernel,"snapshot",({"query":"scope","scope":({["owner"]:"foreign",["campaign"]:"other",["worldline"]:"main",["loop"]:0,["audience"]:"keeper"})})));
assert.ok(pyBool(pyEqual(pyAt(foreign,"code"),"invalid_params")),"tests/kernel/test_jev_memory_read.py:232 assert foreign[\"code\"] == \"invalid_params\"");
snapshot=(await evidence(kernel,"snapshot",({"query":"scope"})));
rows=(await pages(kernel,pyAt(snapshot,"snapshot")));
stale=(await evidence_error(kernel,"page",({"snapshot":pyAt(snapshot,"snapshot"),"offset":0,"scope":({...pyAt(snapshot,"scope"),["worldline"]:"foreign"})})));
assert.ok(pyBool(pyEqual(pyAt(stale,"code"),"invalid_params")),"tests/kernel/test_jev_memory_read.py:237 assert stale[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await evidence_error(kernel,"original",({"snapshot":pyAt(snapshot,"snapshot"),"alias":"entry:unissued"}))),"code"),"invalid_params")),"tests/kernel/test_jev_memory_read.py:238 assert evidence_error(kernel, \"original\", snapshot=snapshot[\"snapshot\"], alias=\"entry:unissued\")[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await evidence_error(kernel,"finish",({"snapshot":pyAt(snapshot,"snapshot"),"selected":[],"assessments":[],"considered":["entry:unissued"],"unknown":[]}))),"code"),"invalid_params")),"tests/kernel/test_jev_memory_read.py:239 assert evidence_error(kernel, \"finish\", snapshot=snapshot[\"snapshot\"], selected=[], assessments=[],\n                          considered=[\"entry:unissued\"], unknown=[])[\"code\"] == \"invalid_params\"");
selected=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pySlice(rows,undefined,21))){__rows.push(pyAt(row,"alias"));}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(selected)),21)),"tests/kernel/test_jev_memory_read.py:242 assert len(selected) == 21");
too_many=(await evidence_error(kernel,"finish",({"snapshot":pyAt(snapshot,"snapshot"),"selected":selected,"assessments":(await (async()=>{const __rows:any[]=[];for(const alias of pyIterable(selected)){__rows.push((await assessment(alias)));}return __rows;})()),"considered":selected,"unknown":[]})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(too_many,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(too_many,"message"),"twenty"):__left})())),"tests/kernel/test_jev_memory_read.py:245 assert too_many[\"code\"] == \"invalid_params\" and \"twenty\" in too_many[\"message\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_scope_unissued_alias_and_selection_bounds_fail_closed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_scope_unissued_alias_and_selection_bounds_fail_closed(await kernel(t,{}));});
export async function test_finish_requires_refresh_after_receipt_index_or_committed_source_change(kernel:any,change:any){
let snapshot:any,job:any;
(await first_turn(kernel));
if(pyBool(pyEqual(change,"receipt"))){(await pyMethod(kernel,"table",["player_input"],{"text":"I wait while the task is open."}));}
snapshot=(await evidence(kernel,"snapshot",({"query":`refresh after ${change}`})));
if(pyBool(pyEqual(change,"receipt"))){(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"time",["minutes"]:5})]}));}else if(pyBool(pyEqual(change,"index"))){job=(await pyMethod(kernel,"ok",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:1})],{}));
(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(job,"job_id"),["candidates"]:[({["kind"]:"knowledge",["subject"]:INV,["statement"]:"A new indexed report."})]})],{}));}else{(await close_turn(kernel,2));}
assert.ok(pyBool(pyEqual(pyAt((await finish(kernel,pyAt(snapshot,"snapshot"))),"status"),"refresh")),"tests/kernel/test_jev_memory_read.py:262 assert finish(kernel, snapshot[\"snapshot\"])[\"status\"] == \"refresh\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("change",["receipt","index","source"]))).entries())test("test_finish_requires_refresh_after_receipt_index_or_committed_source_change"+((pyCartesian([{}],pyParametrize("change",["receipt","index","source"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_finish_requires_refresh_after_receipt_index_or_committed_source_change(await kernel(t,{}),row["change"]);});
export async function test_explicit_foreign_line_reads_indexed_rows_but_reports_raw_originals_unavailable(kernel:any){
let commit:any,main:any,main_rows:any,partial:any,any_line:any,any_rows:any,texts:any;
(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",[({["kind"]:"knowledge",["subject"]:INV,["statement"]:"Main-line indexed memory."})]));
commit=pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json"))),"commit");
(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side"}));
(await close_turn(kernel,2));
(await submit(kernel,"extract:c1:t2",[({["kind"]:"belief",["subject"]:INV,["statement"]:"Side-line indexed memory."})]));
main=(await evidence(kernel,"snapshot",({"query":"Read the main line","filters":({["line"]:"main"})})));
main_rows=(await pages(kernel,pyAt(main,"snapshot")));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(main_rows)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"text"),"Main-line indexed memory.");return pyBool(__left)?pyEqual(pyAt(row,"line"),"main"):__left})()));}return __rows;})())))),"tests/kernel/test_jev_memory_read.py:275 assert any(row[\"text\"] == \"Main-line indexed memory.\" and row[\"line\"] == \"main\" for row in main_rows)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(main,"coverage"),"raw_unavailable_lines"),["main"])),"tests/kernel/test_jev_memory_read.py:276 assert main[\"coverage\"][\"raw_unavailable_lines\"] == [\"main\"]");
assert.ok(pyBool(pyEqual(pyAt(main,"raw"),0)),"tests/kernel/test_jev_memory_read.py:277 assert main[\"raw\"] == 0");
partial=(await finish(kernel,pyAt(main,"snapshot"),undefined,undefined,(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(main_rows)){__rows.push(pyAt(row,"alias"));}return __rows;})()),undefined));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(partial,"status"),"partial");return pyBool(__left)?pyEqual(pyAt(pyAt(partial,"coverage"),"raw_unavailable_lines"),["main"]):__left})())),"tests/kernel/test_jev_memory_read.py:279 assert partial[\"status\"] == \"partial\" and partial[\"coverage\"][\"raw_unavailable_lines\"] == [\"main\"]");
any_line=(await evidence(kernel,"snapshot",({"query":"Read both indexed lines","filters":({["line"]:"any"})})));
any_rows=(await pages(kernel,pyAt(any_line,"snapshot")));
texts=new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(any_rows)){__rows.push(pyAt(row,"text"));}return __rows;})()));
assert.ok(pyBool((await pyMethod(new Set(["Main-line indexed memory.","Side-line indexed memory."]),"issubset",[texts],{}))),"tests/kernel/test_jev_memory_read.py:284 assert {\"Main-line indexed memory.\", \"Side-line indexed memory.\"}.issubset(texts)");
assert.ok(pyBool(pyEqual((await pyMethod((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(any_rows)){__rows.push(pyAt(row,"text"));}return __rows;})()),"count",["Main-line indexed memory."],{})),1)),pyStr(("line:any must not duplicate the same inherited candidate occurrence across branches")));
assert.ok(pyBool(pyContains(pyAt(pyAt(any_line,"coverage"),"raw_unavailable_lines"),"main")),"tests/kernel/test_jev_memory_read.py:287 assert \"main\" in any_line[\"coverage\"][\"raw_unavailable_lines\"]");
assert.ok(pyBool(pyEqual(pyAt((await evidence_error(kernel,"snapshot",({"query":"unknown line","filters":({["line"]:"missing-line"})}))),"code"),"invalid_params")),"tests/kernel/test_jev_memory_read.py:288 assert evidence_error(kernel, \"snapshot\", query=\"unknown line\", filters={\"line\": \"missing-line\"})[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_explicit_foreign_line_reads_indexed_rows_but_reports_raw_originals_unavailable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_explicit_foreign_line_reads_indexed_rows_but_reports_raw_originals_unavailable(await kernel(t,{}));});
export async function test_snapshot_include_superseded_filter_controls_closed_relationship_rows(kernel:any){
let old:any,current:any,active:any,active_rows:any,historical:any,historical_rows:any;
(await first_turn(kernel));
old="Knott remains polite but distant.";
current="Knott now trusts the investigator.";
(await submit(kernel,"extract:c1:t1",[({["kind"]:"relationship",["subject"]:KNOTT,["entities"]:[INV],["statement"]:old})]));
(await close_turn(kernel,2));
(await submit(kernel,"extract:c1:t2",[({["kind"]:"relationship",["subject"]:KNOTT,["entities"]:[INV],["statement"]:current})]));
active=(await evidence(kernel,"snapshot",({"query":"What is Knott's current relationship?","filters":({["about"]:[KNOTT],["kinds"]:["relationship"],["include_superseded"]:false})})));
active_rows=(await pages(kernel,pyAt(active,"snapshot")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(active_rows)){if(pyBool(pyEqual(pyAt(row,"origin"),"memory"))){__rows.push(pyAt(row,"text"));}}return __rows;})()),[current])),"tests/kernel/test_jev_memory_read.py:302 assert [row[\"text\"] for row in active_rows if row[\"origin\"] == \"memory\"] == [current]");
historical=(await evidence(kernel,"snapshot",({"query":"How did Knott's relationship change?","filters":({["about"]:[KNOTT],["kinds"]:["relationship"],["include_superseded"]:true})})));
historical_rows=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pages(kernel,pyAt(historical,"snapshot"))))){if(pyBool(pyEqual(pyAt(row,"origin"),"memory"))){__rows.push(row);}}return __rows;})());
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(historical_rows)){__rows.push(pyAt(row,"text"));}return __rows;})())),new Set([old,current]))),"tests/kernel/test_jev_memory_read.py:307 assert {row[\"text\"] for row in historical_rows} == {old, current}");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(historical_rows)){if(pyBool(pyEqual(pyAt(row,"text"),old))){__rows.push(row);}}return __rows;})()))),"status"),"superseded")),"tests/kernel/test_jev_memory_read.py:308 assert next(row for row in historical_rows if row[\"text\"] == old)[\"status\"] == \"superseded\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_snapshot_include_superseded_filter_controls_closed_relationship_rows"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_snapshot_include_superseded_filter_controls_closed_relationship_rows(await kernel(t,{}));});
export async function test_any_line_collapses_inherited_occurrence_but_keeps_same_id_from_distinct_source_commits(kernel:any){
let common:any,turn_commit:any,sealed_main:any,side:any,other:any,snapshot:any,texts:any;
(await first_turn(kernel));
common="One retained occurrence exists before either branch.";
(await submit(kernel,"extract:c1:t1",[({["kind"]:"knowledge",["subject"]:INV,["statement"]:common})]));
turn_commit=pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json"))),"commit");
(await pyMethod(kernel,"table",["branch"],{"commit":turn_commit,"name":"seed"}));
sealed_main=pyAt(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"worldlines"),"main"),"last_commit");
(await pyMethod(kernel,"table",["branch"],{"commit":sealed_main,"name":"side"}));
side="The side branch records its own turn-two statement.";
(await close_turn(kernel,2,side));
(await submit(kernel,"extract:c1:t2",[({["kind"]:"belief",["subject"]:INV,["statement"]:side})]));
(await pyMethod(kernel,"table",["branch"],{"commit":sealed_main,"name":"other"}));
other="The other branch records a distinct turn-two statement.";
(await close_turn(kernel,2,other));
(await submit(kernel,"extract:c1:t2",[({["kind"]:"belief",["subject"]:INV,["statement"]:other})]));
snapshot=(await evidence(kernel,"snapshot",({"query":"Compare memory occurrences across every line.","filters":({["line"]:"any"})})));
texts=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pages(kernel,pyAt(snapshot,"snapshot"))))){if(pyBool(pyEqual(pyAt(row,"origin"),"memory"))){__rows.push(pyAt(row,"text"));}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyMethod(texts,"count",[common],{})),1)),pyStr("one inherited source occurrence must not be repeated for each descendant line"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(texts,"count",[side],{})),1);return pyBool(__left)?pyEqual((await pyMethod(texts,"count",[other],{})),1):__left})())),pyStr(("candidate IDs reused on two branches remain distinct when their canonical source commits differ")));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_any_line_collapses_inherited_occurrence_but_keeps_same_id_from_distinct_source_commits"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_any_line_collapses_inherited_occurrence_but_keeps_same_id_from_distinct_source_commits(await kernel(t,{}));});
export async function test_public_recall_query_requires_typed_host_and_rejects_unissued_continuations(kernel:any){
let ordinary:any,unavailable:any,invalid:any,request:any,repeated:any;
(await first_turn(kernel));
(await submit(kernel,"extract:c1:t1",[({["kind"]:"knowledge",["subject"]:INV,["statement"]:"The ordinary retained-memory row remains directly readable."})]));
ordinary=(await pyMethod(kernel,"table",["recall"],{"what":"memory","about":[INV]}));
unavailable=(await pyMethod(kernel,"table_err",["recall"],{"what":"memory","query":"What was retained?","about":[INV]}));
assert.ok(pyBool(pyEqual(pyAt(unavailable,"code"),"needs")),"tests/kernel/test_jev_memory_read.py:345 assert unavailable[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(unavailable,"details"),"reason"),"memory_query_requires_host")),"tests/kernel/test_jev_memory_read.py:346 assert unavailable[\"details\"][\"reason\"] == \"memory_query_requires_host\"");
assert.ok(pyBool(pyAt(unavailable,"fix")),"tests/kernel/test_jev_memory_read.py:347 assert unavailable[\"fix\"]");
invalid=[({["what"]:"history",["query"]:"What was retained?"}),({["what"]:"memory",["query"]:""}),({["what"]:"memory",["query"]:"What was retained?",["read"]:({["turn"]:1,["role"]:"keeper"})}),({["what"]:"memory",["query"]:"What was retained?",["detail"]:({["section"]:"hits",["index"]:0})}),({["what"]:"memory",["query"]:"What was retained?",["page"]:({["section"]:"hits",["offset"]:1})})];
for(request of pyIterable(invalid)){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{...request})),"code"),"invalid_params")),"tests/kernel/test_jev_memory_read.py:357 assert kernel.table_err(\"recall\", **request)[\"code\"] == \"invalid_params\"");
}
repeated=(await pyMethod(kernel,"table",["recall"],{"what":"memory","about":[INV]}));
assert.ok(pyBool(pyEqual(pyAt(repeated,"hits"),pyAt(ordinary,"hits"))),pyStr("adding query guards cannot alter the existing direct recall path"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_public_recall_query_requires_typed_host_and_rejects_unissued_continuations"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_public_recall_query_requires_typed_host_and_rejects_unissued_continuations(await kernel(t,{}));});
