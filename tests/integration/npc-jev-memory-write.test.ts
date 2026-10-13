// Migrated from tests/kernel/test_jev_memory_write.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,read_jsonl,pyObjectFromEntries,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";






export let INVESTIGATOR:any="托马斯·海斯";
export let KNOTT:any="Steven Knott";
export let DOOLEY:any="Mr. Dooley";
export let DOOLEY_LABEL:any="Old Newsman";
export async function memory_dir(client:any){
return pyDivide((await campaign_dir(client.workspace)),"memory");
}
export async function referenced_job(client:any,turn:any=1){
return (await pyMethod(client,"ok",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:turn,["mode"]:"referenced"})],{}));
}
export async function referenced_submit(client:any,packet:any,decisions:any,story:any=null){
let referenced:any;
referenced=({["step"]:pyAt(pyAt(packet,"step"),"key"),["decisions"]:decisions});
if(pyBool((story!==null))){referenced["story"]=story;}
return (await pyMethod(client,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["referenced"]:referenced})],{}));
}
export async function referenced_submit_error(client:any,packet:any,decisions:any,story:any=null){
let referenced:any;
referenced=({["step"]:pyAt(pyAt(packet,"step"),"key"),["decisions"]:decisions});
if(pyBool((story!==null))){referenced["story"]=story;}
return (await pyMethod(client,"err",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["referenced"]:referenced})],{}));
}
export async function skip_decisions(packet:any){
return (await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){__rows.push(({["source"]:pyAt(segment,"alias"),["outcome"]:"skip"}));}return __rows;})());
}
export async function decisions_with(packet:any,annotations:any,default_value:any="skip"){
return (await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){__rows.push((pyBool(pyContains(annotations,pyAt(segment,"alias")))?({["source"]:pyAt(segment,"alias"),["outcome"]:"retain",["annotations"]:(await deepcopy(pyAt(annotations,pyAt(segment,"alias"))))}):({["source"]:pyAt(segment,"alias"),["outcome"]:default_value})));}return __rows;})());
}
export async function unclear_story(packet:any){
if(pyBool(!pyContains(packet,"story_context"))){return null;}
return ({["status"]:"unclear",["thread"]:null,["frame_source"]:null,["bridge_delivered"]:false,["delivery_source"]:null});
}
export async function finish_step(client:any,packet:any,decisions:any){
return (await referenced_submit(client,packet,decisions,(await unclear_story(packet))));
}
export async function play_turn(client:any,player:any,keeper:any,turn:any=1){
if(pyBool(pyEqual(turn,1))){(await open_turn(client,player));}else{(await pyMethod(client,"table",["player_input"],{"text":player}));}
return (await narrate(client,`t${turn}-c1`,keeper));
}
export async function utf16_length(value:any){
return Math.floor((await pyLen((await pyMethod(value,"encode",["utf-16-le"],{}))))/2);
}
export async function candidate_rows(client:any){
return (await read_jsonl(pyDivide((await memory_dir(client)),"candidates.jsonl")));
}
export let LONG_PLAYER_LINES:any=["诺特答应送来钥匙。\r\n","诺特答应送来钥匙。\r\n","第三句保留两个空格  和组合字符 Café。\r\n","第四句含有 emoji 🔑。\r\n","第五句。\r\n","第六句。\r\n","第七句。\r\n","第八句。\r\n","第九句。\r\n","第十句。\r\n","第十一句。\r\n","第十二句。\r\n","第十三句。\r\n","第十四句。"];
export let LONG_PLAYER:any=(await pyMethod("","join",[LONG_PLAYER_LINES],{}));
export let LONG_KEEPER:any="诺特没有回答。\r\n钟声响了一次。";
export async function test_referenced_job_pages_every_exact_source_segment_and_publishes_without_copied_statements(kernel:any){
let narrated:any,first:any,first_segments:any,segment:any,ref:any,malformed:any,error:any,first_decisions:any,accepted:any,replay:any,changed:any,conflict:any,second:any,all_segments:any,second_decisions:any,deferred:any,third:any,completed:any,rows:any,stored:any,coverage:any;
narrated=(await play_turn(kernel,LONG_PLAYER,LONG_KEEPER));
first=(await referenced_job(kernel));
assert.ok(pyBool(pyEqual(pyAt(first,"protocol"),"memory-reference-v1")),"tests/kernel/test_jev_memory_write.py:109 assert first[\"protocol\"] == \"memory-reference-v1\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(first,"turn"),1);return pyBool(__left)?pyEqual((await pyLen(pyAt(first,"commit"))),40):__left})());return pyBool(__left)?(await pyMethod(pyAt(first,"commit"),"startswith",[pyAt(narrated,"commit")],{})):__left})())),"tests/kernel/test_jev_memory_write.py:110 assert first[\"turn\"] == 1 and len(first[\"commit\"]) == 40 and first[\"commit\"].startswith(narrated[\"commit\"])");
assert.ok(pyBool(pyEqual((await pySet(first)),new Set(["protocol","job_id","turn","commit","origin","status","step","known_entities","prior","prior_coverage","story_context","story_sources","story_complete"]))),"tests/kernel/test_jev_memory_write.py:111 assert set(first) == {\"protocol\", \"job_id\", \"turn\", \"commit\", \"origin\", \"status\", \"step\", \"known_entities\",\n                          \"prior\", \"prior_coverage\", \"story_context\", \"story_sources\", \"story_complete\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(first,"origin"),"scope"),({["owner"]:`campaign:${CAMPAIGN}`,["campaign"]:CAMPAIGN,["worldline"]:"main",["loop"]:0,["audience"]:"keeper"}))),"tests/kernel/test_jev_memory_write.py:113 assert first[\"origin\"][\"scope\"] == {\"owner\": f\"campaign:{CAMPAIGN}\", \"campaign\": CAMPAIGN,\n                                         \"worldline\": \"main\", \"loop\": 0, \"audience\": \"keeper\"}");
assert.ok(pyBool(pyAt(pyAt(first,"origin"),"revision")),"tests/kernel/test_jev_memory_write.py:115 assert first[\"origin\"][\"revision\"]");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(pyAt(first,"step"),"segments"))),12)),"tests/kernel/test_jev_memory_write.py:116 assert len(first[\"step\"][\"segments\"]) == 12");
assert.ok(pyBool(pyEqual(pyAt(pyAt(first,"step"),"sequence"),0)),"tests/kernel/test_jev_memory_write.py:117 assert first[\"step\"][\"sequence\"] == 0");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(first,"step"),"remaining");const __term1=pyAt(pyAt(first,"step"),"total");const __term2=12;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,">");})())),"tests/kernel/test_jev_memory_write.py:118 assert first[\"step\"][\"remaining\"] == first[\"step\"][\"total\"] > 12");
first_segments=pyAt(pyAt(first,"step"),"segments");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(first_segments)){__rows.push(pyAt(segment,"alias"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange(12)))){__rows.push(`player:${index}`);}return __rows;})()))),"tests/kernel/test_jev_memory_write.py:121 assert [segment[\"alias\"] for segment in first_segments] == [f\"player:{index}\" for index in range(12)]");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(first_segments,0),"text");const __term1=pyAt(pyAt(first_segments,1),"text");const __term2=pyAt(LONG_PLAYER_LINES,0);return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_memory_write.py:122 assert first_segments[0][\"text\"] == first_segments[1][\"text\"] == LONG_PLAYER_LINES[0]");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(first_segments,0),"ref"),pyAt(pyAt(first_segments,1),"ref"))),pyStr("equal occurrences retain distinct coordinates"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(first_segments,2),"text"),pyAt(LONG_PLAYER_LINES,2))),"tests/kernel/test_jev_memory_write.py:124 assert first_segments[2][\"text\"] == LONG_PLAYER_LINES[2]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(first_segments,3),"text"),pyAt(LONG_PLAYER_LINES,3))),"tests/kernel/test_jev_memory_write.py:125 assert first_segments[3][\"text\"] == LONG_PLAYER_LINES[3]");
for(segment of pyIterable(first_segments)){
ref=pyAt(segment,"ref");
assert.ok(pyBool(pyEqual(pyAt(ref,"scope"),pyAt(pyAt(first,"origin"),"scope"))),"tests/kernel/test_jev_memory_write.py:128 assert ref[\"scope\"] == first[\"origin\"][\"scope\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(ref,"sourceType"),"turn");return pyBool(__left)?pyEqual(pyAt(ref,"resource"),"turn:1:player"):__left})())),"tests/kernel/test_jev_memory_write.py:129 assert ref[\"sourceType\"] == \"turn\" and ref[\"resource\"] == \"turn:1:player\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(ref,"selector"),"kind"),"utf16")),"tests/kernel/test_jev_memory_write.py:130 assert ref[\"selector\"][\"kind\"] == \"utf16\"");
assert.ok(pyBool(pyEqual(pySubtract(pyAt(pyAt(ref,"selector"),"end"),pyAt(pyAt(ref,"selector"),"start")),(await utf16_length(pyAt(segment,"text"))))),"tests/kernel/test_jev_memory_write.py:131 assert ref[\"selector\"][\"end\"] - ref[\"selector\"][\"start\"] == utf16_length(segment[\"text\"])");
}
malformed=(await decisions_with(first,({["player:0"]:[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INVESTIGATOR],["statement"]:pyAt(pyAt(first_segments,0),"text")})]})));
error=(await referenced_submit_error(kernel,first,malformed));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_jev_memory_write.py:136 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide((await memory_dir(kernel)),"candidates.jsonl")),"exists",[],{})))),pyStr("copied statement text never becomes authority"));
first_decisions=(await decisions_with(first,({["player:0"]:[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INVESTIGATOR]})],["player:1"]:[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INVESTIGATOR]})]})));
accepted=(await referenced_submit(kernel,first,first_decisions));
assert.ok(pyBool(pyEqual(pyAt(accepted,"status"),"open")),"tests/kernel/test_jev_memory_write.py:144 assert accepted[\"status\"] == \"open\"");
replay=(await referenced_submit(kernel,first,first_decisions));
assert.ok(pyBool(pyEqual(replay,({...accepted,["replayed"]:true}))),"tests/kernel/test_jev_memory_write.py:146 assert replay == {**accepted, \"replayed\": True}");
changed=(await deepcopy(first_decisions));
pyAt(changed,(-1))["outcome"]="defer";
conflict=(await referenced_submit_error(kernel,first,changed));
assert.ok(pyBool(pyEqual(pyAt(conflict,"code"),"idempotency_conflict")),"tests/kernel/test_jev_memory_write.py:150 assert conflict[\"code\"] == \"idempotency_conflict\"");
second=(await referenced_job(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"step"),"sequence"),1)),"tests/kernel/test_jev_memory_write.py:153 assert second[\"step\"][\"sequence\"] == 1");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(second,"step"),"key"),pyAt(pyAt(first,"step"),"key"))),"tests/kernel/test_jev_memory_write.py:154 assert second[\"step\"][\"key\"] != first[\"step\"][\"key\"]");
assert.ok(pyBool(pyLess((await pyLen(pyAt(pyAt(second,"step"),"segments"))),12)),"tests/kernel/test_jev_memory_write.py:155 assert len(second[\"step\"][\"segments\"]) < 12");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"step"),"remaining"),(await pyLen(pyAt(pyAt(second,"step"),"segments"))))),"tests/kernel/test_jev_memory_write.py:156 assert second[\"step\"][\"remaining\"] == len(second[\"step\"][\"segments\"])");
all_segments=pyAdd(first_segments,pyAt(pyAt(second,"step"),"segments"));
assert.ok(pyBool(pyLess(12,(await pyLen(all_segments)))),"tests/kernel/test_jev_memory_write.py:158 assert len(all_segments) > 12");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(all_segments)){__rows.push(pyAt(segment,"alias"));}return __rows;})()),[...(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange((await pyLen(LONG_PLAYER_LINES)))))){__rows.push(`player:${index}`);}return __rows;})()),"keeper:0","keeper:1"])),"tests/kernel/test_jev_memory_write.py:159 assert [segment[\"alias\"] for segment in all_segments] == [\n        *[f\"player:{index}\" for index in range(len(LONG_PLAYER_LINES))], \"keeper:0\", \"keeper:1\"]");
assert.ok(pyBool(pyEqual((await pyMethod("","join",[(await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(all_segments)){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(pyAt(segment,"text"));}}return __rows;})())],{})),LONG_PLAYER)),"tests/kernel/test_jev_memory_write.py:161 assert \"\".join(segment[\"text\"] for segment in all_segments if segment[\"role\"] == \"player\") == LONG_PLAYER");
assert.ok(pyBool(pyEqual((await pyMethod("","join",[(await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(all_segments)){if(pyBool(pyEqual(pyAt(segment,"role"),"keeper"))){__rows.push(pyAt(segment,"text"));}}return __rows;})())],{})),LONG_KEEPER)),"tests/kernel/test_jev_memory_write.py:162 assert \"\".join(segment[\"text\"] for segment in all_segments if segment[\"role\"] == \"keeper\") == LONG_KEEPER");
second_decisions=(await skip_decisions(second));
pyAt(second_decisions,(-1))["outcome"]="defer";
deferred=(await finish_step(kernel,second,second_decisions));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(deferred,"status"),"pending");return pyBool(__left)?pyEqual(pyAt(deferred,"remaining"),1):__left})())),"tests/kernel/test_jev_memory_write.py:167 assert deferred[\"status\"] == \"pending\" and deferred[\"remaining\"] == 1");
third=(await referenced_job(kernel));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(third,"status"),"pending");return pyBool(__left)?(pyAt(third,"story_complete")===true):__left})())),"tests/kernel/test_jev_memory_write.py:169 assert third[\"status\"] == \"pending\" and third[\"story_complete\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(third,"step"),"sequence"),2);return pyBool(__left)?pyEqual(pyAt(pyAt(third,"step"),"remaining"),1):__left})())),"tests/kernel/test_jev_memory_write.py:170 assert third[\"step\"][\"sequence\"] == 2 and third[\"step\"][\"remaining\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(third,"step"),"segments"),[pyAt(pyAt(pyAt(second,"step"),"segments"),(-1))])),"tests/kernel/test_jev_memory_write.py:171 assert third[\"step\"][\"segments\"] == [second[\"step\"][\"segments\"][-1]]");
completed=(await referenced_submit(kernel,third,(await skip_decisions(third))));
assert.ok(pyBool(pyEqual(pyAt(completed,"status"),"done")),"tests/kernel/test_jev_memory_write.py:173 assert completed[\"status\"] == \"done\"");
rows=(await candidate_rows(kernel));
assert.ok(pyBool(pyEqual((await pyLen(rows)),2)),"tests/kernel/test_jev_memory_write.py:175 assert len(rows) == 2");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"statement"));}return __rows;})()),[pyAt(LONG_PLAYER_LINES,0),pyAt(LONG_PLAYER_LINES,1)])),"tests/kernel/test_jev_memory_write.py:176 assert [row[\"statement\"] for row in rows] == [LONG_PLAYER_LINES[0], LONG_PLAYER_LINES[1]]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"kind"),"promise");return pyBool(__left)?pyEqual(pyAt(row,"status"),"candidate"):__left})()));}return __rows;})())))),"tests/kernel/test_jev_memory_write.py:177 assert all(row[\"kind\"] == \"promise\" and row[\"status\"] == \"candidate\" for row in rows)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"memory_version"),2);return pyBool(__left)?pyEqual(pyAt(row,"statement_ref"),pyAt(pyAt(row,"source_refs"),0)):__left})()));}return __rows;})())))),"tests/kernel/test_jev_memory_write.py:178 assert all(row[\"memory_version\"] == 2 and row[\"statement_ref\"] == row[\"source_refs\"][0] for row in rows)");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"statement_ref"));}return __rows;})()),[pyAt(pyAt(first_segments,0),"ref"),pyAt(pyAt(first_segments,1),"ref")])),"tests/kernel/test_jev_memory_write.py:179 assert [row[\"statement_ref\"] for row in rows] == [first_segments[0][\"ref\"], first_segments[1][\"ref\"]]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"relations"),[]);return pyBool(__left)?!pyContains(row,"superseded_by"):__left})()));}return __rows;})())))),pyStr(("two independent promises with the same parties coexist unless the model links an exact prior occurrence")));
stored=(await read_json(pyDivide(pyDivide((await memory_dir(kernel)),"jobs"),`${pyAt(first,"job_id")}.json`)));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(stored,"record_commit"),pyAt(narrated,"commit"));return pyBool(__left)?pyEqual(pyAt(stored,"commit"),pyAt(first,"commit")):__left})())),"tests/kernel/test_jev_memory_write.py:183 assert stored[\"record_commit\"] == narrated[\"commit\"] and stored[\"commit\"] == first[\"commit\"]");
coverage=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"_context"),"memory_coverage");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(coverage,"committed"),2);return pyBool(__left)?pyEqual(pyAt(coverage,"completed"),1):__left})());return pyBool(__left)?pyEqual(pyAt(coverage,"gaps"),1):__left})())),"tests/kernel/test_jev_memory_write.py:185 assert coverage[\"committed\"] == 2 and coverage[\"completed\"] == 1 and coverage[\"gaps\"] == 1");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(coverage,"recent"))){__rows.push((await (async()=>{const __term0=pyAt(item,"from");const __term1=1;const __term2=pyAt(item,"to");return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()));}return __rows;})()))))),pyStr(("the completed v2 job binds the retained short commit and must not reappear as missing")));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_referenced_job_pages_every_exact_source_segment_and_publishes_without_copied_statements"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_referenced_job_pages_every_exact_source_segment_and_publishes_without_copied_statements(await kernel(t,{}));});
export async function publish_single(client:any,player:any,keeper:any,annotation:any,turn:any){
let packet:any,source:any,result:any;
(await play_turn(client,player,keeper,turn));
packet=(await referenced_job(client,turn));
source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(pyAt(segment,"alias"));}}return __rows;})())));
result=(await finish_step(client,packet,(await decisions_with(packet,({[source]:[annotation]})))));
assert.ok(pyBool(pyEqual(pyAt(result,"status"),"done")),"tests/kernel/test_jev_memory_write.py:195 assert result[\"status\"] == \"done\"");
return [packet,source,result];
}
export async function test_correction_closes_only_the_selected_duplicate_occurrence(kernel:any){
let duplicate:any,first:any,duplicates:any,original:any,correction:any,offered:any,stored:any,target_id:any,correction_source:any,rows:any,untouched_id:any,new_value:any;
duplicate="诺特说门已经锁好。";
(await play_turn(kernel,pyAdd(duplicate,duplicate),"房间里很安静。",1));
first=(await referenced_job(kernel,1));
duplicates=(await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(first,"step"),"segments"))){if(pyBool(pyEqual(pyAt(segment,"text"),duplicate))){__rows.push(segment);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(duplicates)),2)),"tests/kernel/test_jev_memory_write.py:204 assert len(duplicates) == 2");
(await finish_step(kernel,first,(await decisions_with(first,({[pyAt(pyAt(duplicates,0),"alias")]:[({["kind"]:"knowledge",["subject"]:INVESTIGATOR,["entities"]:[KNOTT]})],[pyAt(pyAt(duplicates,1),"alias")]:[({["kind"]:"knowledge",["subject"]:INVESTIGATOR,["entities"]:[KNOTT]})]})))));
original=(await candidate_rows(kernel));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(original)),2);return pyBool(__left)?(await (async()=>{const __term0=pyAt(pyAt(original,0),"statement");const __term1=pyAt(pyAt(original,1),"statement");const __term2=duplicate;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})()):__left})())),"tests/kernel/test_jev_memory_write.py:210 assert len(original) == 2 and original[0][\"statement\"] == original[1][\"statement\"] == duplicate");
(await play_turn(kernel,"我更正先前的一次记录。","其中一次记录被明确撤回。",2));
correction=(await referenced_job(kernel,2));
offered=(await (async()=>{const __rows:any[]=[];for(const prior of pyIterable(pyAt(correction,"prior"))){if(pyBool(pyEqual(pyAt(prior,"statement"),duplicate))){__rows.push(prior);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(offered)),2);return pyBool(__left)?!pyEqual(pyAt(pyAt(offered,0),"alias"),pyAt(pyAt(offered,1),"alias")):__left})())),"tests/kernel/test_jev_memory_write.py:215 assert len(offered) == 2 and offered[0][\"alias\"] != offered[1][\"alias\"]");
stored=(await read_json(pyDivide(pyDivide((await memory_dir(kernel)),"jobs"),`${pyAt(correction,"job_id")}.json`)));
target_id=(await pyNext((await (async()=>{const __rows:any[]=[];for(const target of pyIterable(pyAt(stored,"targets"))){if(pyBool(pyEqual(pyAt(target,"alias"),pyAt(pyAt(offered,0),"alias")))){__rows.push(pyAt(target,"id"));}}return __rows;})())));
correction_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(correction,"step"),"segments"))){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(pyAt(segment,"alias"));}}return __rows;})())));
(await finish_step(kernel,correction,(await decisions_with(correction,({[correction_source]:[({["kind"]:"keeper_correction",["subject"]:INVESTIGATOR,["relations"]:[({["relation"]:"correction",["target"]:pyAt(pyAt(offered,0),"alias")})]})]})))));
rows=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await candidate_rows(kernel)))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
untouched_id=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(original)){if(pyBool(!pyEqual(pyAt(row,"id"),target_id))){__rows.push(pyAt(row,"id"));}}return __rows;})())));
new_value=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod(rows,"values",[],{})))){if(pyBool(pyEqual(pyAt(row,"valid_from_turn"),2))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,target_id),"status"),"superseded");return pyBool(__left)?pyEqual(pyAt(pyAt(rows,target_id),"superseded_by"),pyAt(new_value,"id")):__left})())),"tests/kernel/test_jev_memory_write.py:227 assert rows[target_id][\"status\"] == \"superseded\" and rows[target_id][\"superseded_by\"] == new[\"id\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,untouched_id),"status"),"candidate");return pyBool(__left)?!pyContains(pyAt(rows,untouched_id),"superseded_by"):__left})())),"tests/kernel/test_jev_memory_write.py:228 assert rows[untouched_id][\"status\"] == \"candidate\" and \"superseded_by\" not in rows[untouched_id]");
assert.ok(pyBool(pyEqual(pyAt(new_value,"relations"),[({["relation"]:"correction",["target"]:target_id})])),"tests/kernel/test_jev_memory_write.py:229 assert new[\"relations\"] == [{\"relation\": \"correction\", \"target\": target_id}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_correction_closes_only_the_selected_duplicate_occurrence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_correction_closes_only_the_selected_duplicate_occurrence(await kernel(t,{}));});
export async function test_temporal_change_keeps_the_old_occurrence_as_addressable_history(kernel:any){
let first:any,_:any,old:any,packet:any,prior:any,source:any,rows:any,current:any;
const __unpack11235=(await publish_single(kernel,"我相信诺特仍在办公室。","门后传来脚步声。",({["kind"]:"belief",["subject"]:INVESTIGATOR,["entities"]:[KNOTT]}),1));first=__unpack11235[0];_=__unpack11235[1];_=__unpack11235[2];
old=pyAt((await candidate_rows(kernel)),0);
(await play_turn(kernel,"后来我看见诺特离开了办公室。","走廊尽头的门合上了。",2));
packet=(await referenced_job(kernel,2));
prior=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(packet,"prior"))){if(pyBool(pyEqual(pyAt(item,"statement"),pyAt(old,"statement")))){__rows.push(item);}}return __rows;})())));
source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(pyAt(segment,"alias"));}}return __rows;})())));
(await finish_step(kernel,packet,(await decisions_with(packet,({[source]:[({["kind"]:"belief",["subject"]:INVESTIGATOR,["entities"]:[KNOTT],["relations"]:[({["relation"]:"temporal_change",["target"]:pyAt(prior,"alias")})]})]})))));
rows=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await candidate_rows(kernel)))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
current=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod(rows,"values",[],{})))){if(pyBool(pyEqual(pyAt(row,"valid_from_turn"),2))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,pyAt(old,"id")),"status"),"superseded")),"tests/kernel/test_jev_memory_write.py:248 assert rows[old[\"id\"]][\"status\"] == \"superseded\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,pyAt(old,"id")),"valid_until_turn"),2)),"tests/kernel/test_jev_memory_write.py:249 assert rows[old[\"id\"]][\"valid_until_turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,pyAt(old,"id")),"superseded_by"),pyAt(current,"id"))),"tests/kernel/test_jev_memory_write.py:250 assert rows[old[\"id\"]][\"superseded_by\"] == current[\"id\"]");
assert.ok(pyBool(pyEqual(pyAt(current,"relations"),[({["relation"]:"temporal_change",["target"]:pyAt(old,"id")})])),"tests/kernel/test_jev_memory_write.py:251 assert current[\"relations\"] == [{\"relation\": \"temporal_change\", \"target\": old[\"id\"]}]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,pyAt(old,"id")),"statement"),pyAt(old,"statement"))),pyStr("closing a temporal occurrence preserves its exact history"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_temporal_change_keeps_the_old_occurrence_as_addressable_history"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_temporal_change_keeps_the_old_occurrence_as_addressable_history(await kernel(t,{}));});
export async function test_publication_rejects_changed_committed_original_or_active_scope(kernel:any,change:any){
let narrated:any,packet:any,decisions:any,path:any,record:any,error:any;
narrated=(await play_turn(kernel,"我查看诺特留下的信。","信纸仍在桌上。"));
packet=(await referenced_job(kernel));
decisions=(await skip_decisions(packet));
if(pyBool(pyEqual(change,"source"))){path=pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json");
record=(await read_json(path));
record["player_text"]+="被修改";
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[record],{"ensure_ascii":false}))],{"encoding":"utf-8"}));}else{(await pyMethod(kernel,"table",["branch"],{"commit":pyAt(narrated,"commit"),"name":"memory-scope-change"}));}
error=(await referenced_submit_error(kernel,packet,decisions,(await unclear_story(packet))));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_jev_memory_write.py:269 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide((await memory_dir(kernel)),"candidates.jsonl")),"exists",[],{})))),"tests/kernel/test_jev_memory_write.py:270 assert not (memory_dir(kernel) / \"candidates.jsonl\").exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("change",["source","scope"]))).entries())test("test_publication_rejects_changed_committed_original_or_active_scope"+((pyCartesian([{}],pyParametrize("change",["source","scope"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_publication_rejects_changed_committed_original_or_active_scope(await kernel(t,{}),row["change"]);});
export async function test_story_assessment_uses_issued_source_aliases_instead_of_copied_text(kernel:any){
let player:any,packet:any,player_source:any,copied:any,error:any,selected:any,result:any,story:any;
player="我怀疑诺特隐瞒了事实。";
(await play_turn(kernel,player,"诺特沉默了。"));
packet=(await referenced_job(kernel));
assert.ok(pyBool(pyAt(pyAt(packet,"story_context"),"threads")),"tests/kernel/test_jev_memory_write.py:277 assert packet[\"story_context\"][\"threads\"]");
player_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(packet,"story_sources"))){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(segment);}}return __rows;})())));
copied=({["status"]:"misframed",["thread"]:pyAt(pyAt(pyAt(pyAt(packet,"story_context"),"threads"),0),"thread"),["frame"]:player,["bridge_delivered"]:false,["delivery_quote"]:null});
error=(await referenced_submit_error(kernel,packet,(await skip_decisions(packet)),copied));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_jev_memory_write.py:282 assert error[\"code\"] == \"invalid_params\"");
selected=({["status"]:"misframed",["thread"]:pyAt(pyAt(pyAt(pyAt(packet,"story_context"),"threads"),0),"thread"),["frame_source"]:pyAt(player_source,"alias"),["bridge_delivered"]:false,["delivery_source"]:null});
result=(await referenced_submit(kernel,packet,(await skip_decisions(packet)),selected));
assert.ok(pyBool(pyEqual(pyAt(result,"status"),"done")),"tests/kernel/test_jev_memory_write.py:287 assert result[\"status\"] == \"done\"");
story=pyAt((await read_jsonl(pyDivide((await memory_dir(kernel)),"story.jsonl"))),(-1));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(story,"frame");const __term1=pyAt(player_source,"text");const __term2=player;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_memory_write.py:289 assert story[\"frame\"] == player_source[\"text\"] == player");
assert.ok(pyBool(pyEqual(pyAt(story,"frame_ref"),pyAt(player_source,"ref"))),"tests/kernel/test_jev_memory_write.py:290 assert story[\"frame_ref\"] == player_source[\"ref\"]");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(story,"delivery_quote")===null);return pyBool(__left)?!pyContains(story,"delivery_ref"):__left})())),"tests/kernel/test_jev_memory_write.py:291 assert story[\"delivery_quote\"] is None and \"delivery_ref\" not in story");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_story_assessment_uses_issued_source_aliases_instead_of_copied_text"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_story_assessment_uses_issued_source_aliases_instead_of_copied_text(await kernel(t,{}));});
export async function test_duplicate_spoken_occurrences_publish_exact_refs_and_distinct_canonical_speakers(kernel:any){
let spoken:any,player:any,keeper:any,packet:any,speech:any,result:any,rows:any,row:any,source:any,recalled:any,capsule:any;
spoken="\"The key is on the desk.\"";
player="I listen to both speakers.";
keeper=(`The lamp flickers. {{say:${KNOTT}}}${spoken}{{/say}} `+`{{say:${DOOLEY}}}${spoken}{{/say}} The clock strikes.`);
(await play_turn(kernel,player,keeper));
packet=(await referenced_job(kernel));
speech=(await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(segment,"attribution"),"kind"),"speech");return pyBool(__left)?pyEqual((await pyMethod(pyAt(segment,"text"),"strip",[],{})),spoken):__left})()))){__rows.push(segment);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyLen(speech)),2)),"tests/kernel/test_jev_memory_write.py:303 assert len(speech) == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(speech,0),"text"),pyAt(pyAt(speech,1),"text"))),"tests/kernel/test_jev_memory_write.py:304 assert speech[0][\"text\"] == speech[1][\"text\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyEqual(pyAt(pyAt(speech,0),"alias"),pyAt(pyAt(speech,1),"alias"));return pyBool(__left)?!pyEqual(pyAt(pyAt(speech,0),"ref"),pyAt(pyAt(speech,1),"ref")):__left})())),"tests/kernel/test_jev_memory_write.py:305 assert speech[0][\"alias\"] != speech[1][\"alias\"] and speech[0][\"ref\"] != speech[1][\"ref\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(speech)){__rows.push(pyAt(segment,"attribution"));}return __rows;})()),[({["kind"]:"speech",["speaker"]:({["name"]:KNOTT,["kind"]:"npc"})}),({["kind"]:"speech",["speaker"]:({["name"]:DOOLEY,["kind"]:"npc"})})])),"tests/kernel/test_jev_memory_write.py:306 assert [segment[\"attribution\"] for segment in speech] == [\n        {\"kind\": \"speech\", \"speaker\": {\"name\": KNOTT, \"kind\": \"npc\"}},\n        {\"kind\": \"speech\", \"speaker\": {\"name\": DOOLEY, \"kind\": \"npc\"}},\n    ]");
result=(await finish_step(kernel,packet,(await decisions_with(packet,({[pyAt(pyAt(speech,0),"alias")]:[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INVESTIGATOR]})],[pyAt(pyAt(speech,1),"alias")]:[({["kind"]:"knowledge",["subject"]:INVESTIGATOR,["knowers"]:[INVESTIGATOR],["entities"]:[KNOTT]})]})))));
assert.ok(pyBool(pyEqual(pyAt(result,"status"),"done")),"tests/kernel/test_jev_memory_write.py:316 assert result[\"status\"] == \"done\"");
rows=(await candidate_rows(kernel));
assert.ok(pyBool(pyEqual((await pyLen(rows)),2)),"tests/kernel/test_jev_memory_write.py:318 assert len(rows) == 2");
for([row,source] of pyIterable((await pyZip(rows,speech,({"strict":true}))))){
assert.ok(pyBool(pyEqual(pyAt(row,"statement"),pyAt(source,"text"))),"tests/kernel/test_jev_memory_write.py:320 assert row[\"statement\"] == source[\"text\"]");
assert.ok(pyBool(pyEqual(pyAt(row,"statement_ref"),pyAt(source,"ref"))),"tests/kernel/test_jev_memory_write.py:321 assert row[\"statement_ref\"] == source[\"ref\"]");
assert.ok(pyBool(pyEqual(pyAt(row,"source_refs"),[pyAt(source,"ref")])),"tests/kernel/test_jev_memory_write.py:322 assert row[\"source_refs\"] == [source[\"ref\"]]");
assert.ok(pyBool(pyEqual(pyAt(row,"attribution"),pyAt(source,"attribution"))),"tests/kernel/test_jev_memory_write.py:323 assert row[\"attribution\"] == source[\"attribution\"]");
}
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"kind"));}return __rows;})()),["promise","knowledge"])),"tests/kernel/test_jev_memory_write.py:324 assert [row[\"kind\"] for row in rows] == [\"promise\", \"knowledge\"]");
recalled=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory"})),"hits"))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
capsule=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"memory"))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
for(row of pyIterable(rows)){
assert.ok(pyBool(pyEqual(pyAt(pyAt(recalled,pyAt(row,"id")),"attribution"),pyAt(row,"attribution"))),"tests/kernel/test_jev_memory_write.py:328 assert recalled[row[\"id\"]][\"attribution\"] == row[\"attribution\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,pyAt(row,"id")),"attribution"),pyAt(row,"attribution"))),"tests/kernel/test_jev_memory_write.py:329 assert capsule[row[\"id\"]][\"attribution\"] == row[\"attribution\"]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_duplicate_spoken_occurrences_publish_exact_refs_and_distinct_canonical_speakers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_duplicate_spoken_occurrences_publish_exact_refs_and_distinct_canonical_speakers(await kernel(t,{}));});
export async function test_world_event_rejects_player_and_spoken_reports_but_accepts_exact_keeper_narration(kernel:any){
let spoken:any,packet:any,player_source:any,speech_source:any,narration_source:any,world_event:any,source:any,error:any,result:any,rows:any;
spoken="\"The bell rang.\"";
(await play_turn(kernel,"The player says the bell rang.",`The actual bell rings. {{say:${KNOTT}}}${spoken}{{/say}} The echo fades.`));
packet=(await referenced_job(kernel));
player_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(pyAt(segment,"attribution"),"kind"),"player"))){__rows.push(segment);}}return __rows;})())));
speech_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(pyAt(segment,"attribution"),"kind"),"speech"))){__rows.push(segment);}}return __rows;})())));
narration_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(pyAt(segment,"attribution"),"kind"),"keeper_narration"))){__rows.push(segment);}}return __rows;})())));
world_event=async (alias:any)=>(await decisions_with(packet,({[alias]:[({["kind"]:"world_event",["subject"]:"world"})]})));
for(source of pyIterable([player_source,speech_source])){
error=(await referenced_submit_error(kernel,packet,(await world_event(pyAt(source,"alias"))),(await unclear_story(packet))));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_jev_memory_write.py:345 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains((await pyMethod(pyAt(error,"message"),"lower",[],{})),"world event")),"tests/kernel/test_jev_memory_write.py:346 assert \"world event\" in error[\"message\"].lower()");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide((await memory_dir(kernel)),"candidates.jsonl")),"exists",[],{})))),"tests/kernel/test_jev_memory_write.py:347 assert not (memory_dir(kernel) / \"candidates.jsonl\").exists()");
}
result=(await referenced_submit(kernel,packet,(await world_event(pyAt(narration_source,"alias"))),(await unclear_story(packet))));
assert.ok(pyBool(pyEqual(pyAt(result,"status"),"done")),"tests/kernel/test_jev_memory_write.py:350 assert result[\"status\"] == \"done\"");
rows=(await candidate_rows(kernel));
assert.ok(pyBool(pyEqual((await pyLen(rows)),1)),"tests/kernel/test_jev_memory_write.py:352 assert len(rows) == 1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,0),"kind"),"world_event");return pyBool(__left)?pyEqual(pyAt(pyAt(rows,0),"subject"),"world"):__left})())),"tests/kernel/test_jev_memory_write.py:353 assert rows[0][\"kind\"] == \"world_event\" and rows[0][\"subject\"] == \"world\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,0),"statement"),pyAt(narration_source,"text"))),"tests/kernel/test_jev_memory_write.py:354 assert rows[0][\"statement\"] == narration_source[\"text\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,0),"statement_ref"),pyAt(narration_source,"ref"))),"tests/kernel/test_jev_memory_write.py:355 assert rows[0][\"statement_ref\"] == narration_source[\"ref\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,0),"source_refs"),[pyAt(narration_source,"ref")])),"tests/kernel/test_jev_memory_write.py:356 assert rows[0][\"source_refs\"] == [narration_source[\"ref\"]]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,0),"attribution"),({["kind"]:"keeper_narration"}))),"tests/kernel/test_jev_memory_write.py:357 assert rows[0][\"attribution\"] == {\"kind\": \"keeper_narration\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_world_event_rejects_player_and_spoken_reports_but_accepts_exact_keeper_narration"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_world_event_rejects_player_and_spoken_reports_but_accepts_exact_keeper_narration(await kernel(t,{}));});
export async function test_offstage_speaker_and_table_alias_bind_one_entity_and_reach_actual_promise_consumers(kernel:any){
let player_promise:any,canonical_promise:any,alias_report:any,packet:any,names:any,player_source:any,canonical_source:any,alias_source:any,result:any,rows:any,promises:any,knowledge:any,capsule:any,obligations:any,dooley:any,history:any,source:any;
player_promise="I report that Mr. Dooley promised to return tomorrow.";
canonical_promise="\"I promise to return tomorrow.\"";
alias_report="\"I remember where the key is.\"";
(await open_turn(kernel,player_promise));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:DOOLEY,["name"]:DOOLEY_LABEL,["why"]:"the table established this name"})]}));
(await narrate(kernel,"t1-c2",(`The shop is closed. {{say:${DOOLEY}}}${canonical_promise}{{/say}} `+`{{say:${DOOLEY_LABEL}}}${alias_report}{{/say}}`)));
packet=(await referenced_job(kernel));
names=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(packet,"known_entities"))){__rows.push([pyAt(row,"name"),pyAt(row,"kind")]);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyContains(names,[DOOLEY,"npc"]);return pyBool(__left)?pyContains(names,[DOOLEY_LABEL,"npc"]):__left})())),"tests/kernel/test_jev_memory_write.py:371 assert (DOOLEY, \"npc\") in names and (DOOLEY_LABEL, \"npc\") in names");
player_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(pyAt(segment,"attribution"),"kind"),"player"))){__rows.push(segment);}}return __rows;})())));
canonical_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyContains(pyAt(segment,"text"),canonical_promise))){__rows.push(segment);}}return __rows;})())));
alias_source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyContains(pyAt(segment,"text"),alias_report))){__rows.push(segment);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(canonical_source,"attribution");const __term1=pyAt(alias_source,"attribution");const __term2=({["kind"]:"speech",["speaker"]:({["name"]:DOOLEY_LABEL,["kind"]:"npc"})});return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_memory_write.py:375 assert canonical_source[\"attribution\"] == alias_source[\"attribution\"] == {\n        \"kind\": \"speech\", \"speaker\": {\"name\": DOOLEY_LABEL, \"kind\": \"npc\"}}");
result=(await finish_step(kernel,packet,(await decisions_with(packet,({[pyAt(player_source,"alias")]:[({["kind"]:"promise",["subject"]:DOOLEY,["entities"]:[INVESTIGATOR]})],[pyAt(canonical_source,"alias")]:[({["kind"]:"promise",["subject"]:DOOLEY_LABEL,["entities"]:[INVESTIGATOR]})],[pyAt(alias_source,"alias")]:[({["kind"]:"knowledge",["subject"]:DOOLEY_LABEL,["knowers"]:[DOOLEY,DOOLEY_LABEL],["entities"]:[INVESTIGATOR]})]})))));
assert.ok(pyBool(pyEqual(pyAt(result,"status"),"done")),"tests/kernel/test_jev_memory_write.py:384 assert result[\"status\"] == \"done\"");
rows=(await candidate_rows(kernel));
promises=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyEqual(pyAt(row,"kind"),"promise"))){__rows.push(row);}}return __rows;})());
knowledge=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyEqual(pyAt(row,"kind"),"knowledge"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(promises)),2);return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(promises)){__rows.push(pyEqual(pyAt(row,"subject"),DOOLEY));}return __rows;})()))):__left})())),"tests/kernel/test_jev_memory_write.py:388 assert len(promises) == 2 and all(row[\"subject\"] == DOOLEY for row in promises)");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(knowledge,"subject"),DOOLEY);return pyBool(__left)?pyEqual(pyAt(knowledge,"knowers"),[DOOLEY]):__left})())),"tests/kernel/test_jev_memory_write.py:389 assert knowledge[\"subject\"] == DOOLEY and knowledge[\"knowers\"] == [DOOLEY]");
assert.ok(pyBool(pyEqual(pyAt(knowledge,"entities"),[INVESTIGATOR])),pyStr("two issued names for Dooley bind and deduplicate to one entity"));
(await pyMethod(kernel,"table",["player_input"],{"text":"I meet the newsman on his corner."}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:"neighborhood-gossip"}),({["kind"]:"npc",["name"]:DOOLEY,["to"]:"here",["why"]:"make the promise consumer visible"})]}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
obligations=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(capsule,"obligations"))){if(pyBool(pyEqual(pyAt(row,"kind"),"promise"))){__rows.push([pyAt(row,"state"),row]);}}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(obligations,pyAt(player_source,"text")),"authority"),"conversation_report")),"tests/kernel/test_jev_memory_write.py:399 assert obligations[player_source[\"text\"]][\"authority\"] == \"conversation_report\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(obligations,pyAt(player_source,"text")),"attribution"),({["kind"]:"player"}))),"tests/kernel/test_jev_memory_write.py:400 assert obligations[player_source[\"text\"]][\"attribution\"] == {\"kind\": \"player\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(obligations,pyAt(canonical_source,"text")),"authority"),"conversation_report")),"tests/kernel/test_jev_memory_write.py:401 assert obligations[canonical_source[\"text\"]][\"authority\"] == \"conversation_report\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(obligations,pyAt(canonical_source,"text")),"attribution"),pyAt(canonical_source,"attribution"))),"tests/kernel/test_jev_memory_write.py:402 assert obligations[canonical_source[\"text\"]][\"attribution\"] == canonical_source[\"attribution\"]");
dooley=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(capsule,"present"))){if(pyBool((await pyMethod((await pyMethod(row,"get",["history",({})],{})),"get",["promises"],{})))){__rows.push(row);}}return __rows;})())));
history=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(dooley,"history"),"promises"))){__rows.push([pyAt(row,"statement"),row]);}return __rows;})()));
for(source of pyIterable([player_source,canonical_source])){
assert.ok(pyBool(pyEqual(pyAt(pyAt(history,pyAt(source,"text")),"authority"),"conversation_report")),"tests/kernel/test_jev_memory_write.py:406 assert history[source[\"text\"]][\"authority\"] == \"conversation_report\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(history,pyAt(source,"text")),"attribution"),pyAt(source,"attribution"))),"tests/kernel/test_jev_memory_write.py:407 assert history[source[\"text\"]][\"attribution\"] == source[\"attribution\"]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_offstage_speaker_and_table_alias_bind_one_entity_and_reach_actual_promise_consumers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_offstage_speaker_and_table_alias_bind_one_entity_and_reach_actual_promise_consumers(await kernel(t,{}));});
export async function test_unresolved_speaker_label_remains_attributed_text_but_never_becomes_an_entity(kernel:any){
let label:any,packet:any,source:any,error:any;
label="The stranger by the window";
(await open_turn(kernel,"I listen."));
(await narrate(kernel,"t1-c1",`{{say:${label}}}\"Wait here.\"{{/say}}`));
packet=(await referenced_job(kernel));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(packet,"known_entities"))){__rows.push(pyEqual(pyAt(row,"name"),label));}return __rows;})()))))),"tests/kernel/test_jev_memory_write.py:415 assert not any(row[\"name\"] == label for row in packet[\"known_entities\"])");
source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(pyAt(segment,"attribution"),"kind"),"speech"))){__rows.push(segment);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(source,"attribution"),({["kind"]:"speech",["speaker"]:({["name"]:label,["kind"]:"label"})}))),"tests/kernel/test_jev_memory_write.py:417 assert source[\"attribution\"] == {\"kind\": \"speech\", \"speaker\": {\"name\": label, \"kind\": \"label\"}}");
error=(await referenced_submit_error(kernel,packet,(await decisions_with(packet,({[pyAt(source,"alias")]:[({["kind"]:"promise",["subject"]:label,["entities"]:[INVESTIGATOR]})]}))),(await unclear_story(packet))));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_jev_memory_write.py:421 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains(pyAt(error,"message"),label)),"tests/kernel/test_jev_memory_write.py:422 assert label in error[\"message\"]");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide((await memory_dir(kernel)),"candidates.jsonl")),"exists",[],{})))),"tests/kernel/test_jev_memory_write.py:423 assert not (memory_dir(kernel) / \"candidates.jsonl\").exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unresolved_speaker_label_remains_attributed_text_but_never_becomes_an_entity"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unresolved_speaker_label_remains_attributed_text_but_never_becomes_an_entity(await kernel(t,{}));});
export async function test_default_referenced_dispatch_retries_pending_once_and_exclusions_advance_to_another_turn(kernel:any){
let packet:any,deferred:any,result:any,retry:any,another:any;
(await play_turn(kernel,"第一回合的原文。","第一回合的回应。",1));
(await play_turn(kernel,"第二回合仍有不确定内容。","第二回合的回应。",2));
packet=(await referenced_job(kernel,2));
deferred=(await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){__rows.push(({["source"]:pyAt(segment,"alias"),["outcome"]:"defer"}));}return __rows;})());
result=(await referenced_submit(kernel,packet,deferred,(await unclear_story(packet))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"status"),"pending");return pyBool(__left)?pyEqual(pyAt(result,"remaining"),(await pyLen(pyAt(pyAt(packet,"step"),"segments")))):__left})())),"tests/kernel/test_jev_memory_write.py:432 assert result[\"status\"] == \"pending\" and result[\"remaining\"] == len(packet[\"step\"][\"segments\"])");
retry=(await pyMethod(kernel,"ok",["memory.job",({["campaign"]:CAMPAIGN,["mode"]:"referenced"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(retry,"turn"),2);return pyBool(__left)?pyEqual(pyAt(retry,"status"),"pending"):__left})())),"tests/kernel/test_jev_memory_write.py:435 assert retry[\"turn\"] == 2 and retry[\"status\"] == \"pending\"");
another=(await pyMethod(kernel,"ok",["memory.job",({["campaign"]:CAMPAIGN,["mode"]:"referenced",["exclude_turns"]:[2]})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(another,"turn"),1);return pyBool(__left)?pyEqual(pyAt(another,"protocol"),"memory-reference-v1"):__left})())),"tests/kernel/test_jev_memory_write.py:437 assert another[\"turn\"] == 1 and another[\"protocol\"] == \"memory-reference-v1\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_default_referenced_dispatch_retries_pending_once_and_exclusions_advance_to_another_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_default_referenced_dispatch_retries_pending_once_and_exclusions_advance_to_another_turn(await kernel(t,{}));});
export async function test_referenced_jobs_are_committed_only_and_do_not_convert_started_legacy_jobs(kernel:any){
let error:any,legacy:any,same:any,completed:any;
(await create_campaign(kernel));
(await narrate_opening(kernel));
(await pyMethod(kernel,"table",["player_input"],{"text":"这一回合还没有提交。"}));
error=(await pyMethod(kernel,"err",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:1,["mode"]:"referenced"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_jev_memory_write.py:445 assert error[\"code\"] == \"invalid_params\"");
(await narrate(kernel,"t1-c1","现在整回合已经提交。"));
legacy=(await pyMethod(kernel,"ok",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:1})],{}));
assert.ok(pyBool(!pyContains(legacy,"protocol")),"tests/kernel/test_jev_memory_write.py:449 assert \"protocol\" not in legacy");
same=(await referenced_job(kernel,1));
assert.ok(pyBool(pyEqual(same,legacy)),pyStr("an already-open legacy job is not silently converted"));
completed=(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(legacy,"job_id"),["candidates"]:[]})],{}));
assert.ok(pyBool(pyEqual(pyAt(completed,"candidates"),0)),"tests/kernel/test_jev_memory_write.py:453 assert completed[\"candidates\"] == 0");
assert.ok(pyBool(pyEqual((await referenced_job(kernel,1)),legacy)),pyStr("completed legacy packets remain readable"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_referenced_jobs_are_committed_only_and_do_not_convert_started_legacy_jobs"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_referenced_jobs_are_committed_only_and_do_not_convert_started_legacy_jobs(await kernel(t,{}));});
export async function test_a_canonically_completed_campaign_accepts_its_committed_memory_job(kernel:any){
let narrated:any,packet:any,result:any;
(await open_turn(kernel,"我结束这次调查。"));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"montage",["goal"]:"Account for the source-reviewed conclusion.",["method"]:"",["decision"]:"development:end-session"})}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"ending",["scope"]:"campaign",["summary"]:"The investigation is over."})]}));
narrated=(await narrate(kernel,"t1-c3","调查到此结束。"));
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"status"),"completed")),"tests/kernel/test_jev_memory_write.py:465 assert read_json(campaign_dir(kernel.workspace) / \"campaign.json\")[\"status\"] == \"completed\"");
packet=(await referenced_job(kernel,1));
assert.ok(pyBool((await pyMethod(pyAt(packet,"commit"),"startswith",[pyAt(narrated,"commit")],{}))),"tests/kernel/test_jev_memory_write.py:468 assert packet[\"commit\"].startswith(narrated[\"commit\"])");
result=(await finish_step(kernel,packet,(await skip_decisions(packet))));
assert.ok(pyBool(pyEqual(pyAt(result,"status"),"done")),"tests/kernel/test_jev_memory_write.py:470 assert result[\"status\"] == \"done\"");
assert.ok(pyBool(pyEqual(pyAt((await referenced_job(kernel,1)),"status"),"done")),"tests/kernel/test_jev_memory_write.py:471 assert referenced_job(kernel, 1)[\"status\"] == \"done\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_canonically_completed_campaign_accepts_its_committed_memory_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_canonically_completed_campaign_accepts_its_committed_memory_job(await kernel(t,{}));});
export async function test_prepared_referenced_step_recovers_after_process_restart(tmp_path:any){
let workspace:any,first:any,packet:any,job_path:any,before:any,source:any,decisions:any,completed:any,durable:any,prepared:any,second:any,recovered:any,rows:any,replay:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await play_turn(first,"我记得诺特答应送来钥匙。","诺特没有否认。"));
packet=(await referenced_job(first));
job_path=pyDivide(pyDivide((await memory_dir(first)),"jobs"),`${pyAt(packet,"job_id")}.json`);
before=(await read_json(job_path));
source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(pyAt(segment,"alias"));}}return __rows;})())));
decisions=(await decisions_with(packet,({[source]:[({["kind"]:"promise",["subject"]:KNOTT,["entities"]:[INVESTIGATOR]})]})));
completed=(await finish_step(first,packet,decisions));
assert.ok(pyBool(pyEqual(pyAt(completed,"status"),"done")),"tests/kernel/test_jev_memory_write.py:486 assert completed[\"status\"] == \"done\"");
durable=(await read_json(job_path));
assert.ok(pyBool(pyEqual((await pyLen(pyAt(durable,"steps"))),1)),"tests/kernel/test_jev_memory_write.py:488 assert len(durable[\"steps\"]) == 1");
prepared=pyAt(pyAt(pyAt(durable,"steps"),0),"prepared");}finally{(await pyMethod(first,"close",[],{}));}
(await pyMethod(job_path,"write_text",[(await pyMethod(json,"dumps",[({...before,["prepared"]:prepared})],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
second=(new RpcClient(workspace));
try{recovered=(await referenced_job(second));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(recovered,"status"),"done");return pyBool(__left)?pyEqual(pyAt(pyAt(recovered,"step"),"remaining"),0):__left})())),"tests/kernel/test_jev_memory_write.py:498 assert recovered[\"status\"] == \"done\" and recovered[\"step\"][\"remaining\"] == 0");
rows=(await candidate_rows(second));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(rows)),1);return pyBool(__left)?pyEqual(pyAt(pyAt(rows,0),"statement_ref"),pyAt(pyAt(pyAt(pyAt(packet,"step"),"segments"),0),"ref")):__left})())),"tests/kernel/test_jev_memory_write.py:500 assert len(rows) == 1 and rows[0][\"statement_ref\"] == packet[\"step\"][\"segments\"][0][\"ref\"]");
assert.ok(pyBool(pyEqual((await pyLen((await (async()=>{const __rows:any[]=[];for(const event of pyIterable((await read_jsonl(pyDivide((await campaign_dir(workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(event,"type"),"memory-written"))){__rows.push(event);}}return __rows;})()))),1)),"tests/kernel/test_jev_memory_write.py:501 assert len([event for event in read_jsonl(campaign_dir(workspace) / \"events.jsonl\")\n                    if event[\"type\"] == \"memory-written\"]) == 1");
replay=(await referenced_submit(second,packet,decisions,(await unclear_story(packet))));
assert.ok(pyBool((pyAt(replay,"replayed")===true)),"tests/kernel/test_jev_memory_write.py:504 assert replay[\"replayed\"] is True");
assert.ok(pyBool(pyEqual((await pyLen((await candidate_rows(second)))),1)),"tests/kernel/test_jev_memory_write.py:505 assert len(candidate_rows(second)) == 1");}finally{(await pyMethod(second,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_prepared_referenced_step_recovers_after_process_restart"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_prepared_referenced_step_recovers_after_process_restart(temporary);});
export async function test_prepared_recovery_rejects_semantic_row_drift_before_secondary_projection(tmp_path:any,field:any,replacement:any){
let workspace:any,first:any,packet:any,source:any,decisions:any,job_path:any,before:any,durable:any,prepared:any,candidates_path:any,changed:any,unchanged_statement:any,unchanged_ref:any,restored:any,projection_paths:any,projections:any,second:any,error:any,path:any,before_bytes:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await play_turn(first,"I remember the exact report.","The room remains quiet."));
packet=(await referenced_job(first));
source=(await pyNext((await (async()=>{const __rows:any[]=[];for(const segment of pyIterable(pyAt(pyAt(packet,"step"),"segments"))){if(pyBool(pyEqual(pyAt(segment,"role"),"player"))){__rows.push(pyAt(segment,"alias"));}}return __rows;})())));
decisions=(await decisions_with(packet,({[source]:[({["kind"]:"knowledge",["subject"]:INVESTIGATOR,["knowers"]:[INVESTIGATOR],["entities"]:[KNOTT]})]})));
job_path=pyDivide(pyDivide((await memory_dir(first)),"jobs"),`${pyAt(packet,"job_id")}.json`);
before=(await read_json(job_path));
assert.ok(pyBool(pyEqual(pyAt((await finish_step(first,packet,decisions)),"status"),"done")),"tests/kernel/test_jev_memory_write.py:528 assert finish_step(first, packet, decisions)[\"status\"] == \"done\"");
durable=(await read_json(job_path));
prepared=pyAt(pyAt(pyAt(durable,"steps"),0),"prepared");}finally{(await pyMethod(first,"close",[],{}));}
candidates_path=pyDivide((await memory_dir(first)),"candidates.jsonl");
changed=(await read_jsonl(candidates_path));
assert.ok(pyBool(pyEqual((await pyLen(changed)),1)),"tests/kernel/test_jev_memory_write.py:536 assert len(changed) == 1");
unchanged_statement=pyAt(pyAt(changed,0),"statement");
unchanged_ref=(await deepcopy(pyAt(pyAt(changed,0),"statement_ref")));
pyAt(changed,0)[field]=replacement;
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(changed,0),"statement"),unchanged_statement);return pyBool(__left)?pyEqual(pyAt(pyAt(changed,0),"statement_ref"),unchanged_ref):__left})())),"tests/kernel/test_jev_memory_write.py:540 assert changed[0][\"statement\"] == unchanged_statement and changed[0][\"statement_ref\"] == unchanged_ref");
(await pyMethod(candidates_path,"write_text",[(await pyMethod("","join",[(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(changed)){__rows.push(pyAdd((await pyMethod(json,"dumps",[row],{"ensure_ascii":false})),"\n"));}return __rows;})())],{}))],{"encoding":"utf-8"}));
restored=({...before,["prepared"]:prepared});
(await pyMethod(job_path,"write_text",[(await pyMethod(json,"dumps",[restored],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
projection_paths=[pyDivide((await campaign_dir(workspace)),"npc-ledger.json"),pyDivide((await campaign_dir(workspace)),"events.jsonl"),pyDivide((await memory_dir(first)),"story.jsonl")];
projections=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable(projection_paths)){__rows.push([path,(pyBool((await pyMethod(path,"exists",[],{})))?(await pyMethod(path,"read_bytes",[],{})):null)]);}return __rows;})()));
second=(new RpcClient(workspace));
try{error=(await pyMethod(second,"err",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:1,["mode"]:"referenced"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"idempotency_conflict")),"tests/kernel/test_jev_memory_write.py:551 assert error[\"code\"] == \"idempotency_conflict\"");
assert.ok(pyBool(pyContains(pyAt(error,"message"),"different content")),"tests/kernel/test_jev_memory_write.py:552 assert \"different content\" in error[\"message\"]");}finally{(await pyMethod(second,"close",[],{}));}
assert.ok(pyBool(pyEqual((await read_json(job_path)),restored)),pyStr("the conflicting prepared step does not advance its durable cursor"));
assert.ok(pyBool(pyEqual((await read_jsonl(candidates_path)),changed)),pyStr("recovery does not overwrite the conflicting retained occurrence"));
for([path,before_bytes] of pyIterable((await pyMethod(projections,"items",[],{})))){
assert.ok(pyBool(pyEqual(((pyBool((await pyMethod(path,"exists",[],{})))?(await pyMethod(path,"read_bytes",[],{})):null)),before_bytes)),pyStr(`${path.name} changed before immutable-row acceptance`));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("field,replacement",[["kind","promise"],["subject",KNOTT],["knowers",[KNOTT]],["privacy","keeper_only"],["relations",[({["relation"]:"independent",["target"]:"mem:t0-1"})]]]))).entries())test("test_prepared_recovery_rejects_semantic_row_drift_before_secondary_projection"+((pyCartesian([{}],pyParametrize("field,replacement",[["kind","promise"],["subject",KNOTT],["knowers",[KNOTT]],["privacy","keeper_only"],["relations",[({["relation"]:"independent",["target"]:"mem:t0-1"})]]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_prepared_recovery_rejects_semantic_row_drift_before_secondary_projection(temporary,row["field"],row["replacement"]);});
