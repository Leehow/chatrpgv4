// Migrated from tests/kernel/test_jev_source_snapshot.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {bind,indexed,opening,finish,request,claim,observed,write,confirmed_investigator,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {prepared,answer_job} from "./world-source-answers.test.ts";







export async function tree(root:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{})))){__rows.push([(await pyStr((await pyMethod(path,"relative_to",[root],{})))),(await pyMethod(path,"read_bytes",[],{}))]);}}return __rows;})()));
}
export async function test_source_snapshot_is_read_only_and_available_before_any_graph(kernel:any,tmp_path:any){
let mid:any,source:any,root:any,before:any,first:any,second:any;
const __unpack560=(await bind(kernel,tmp_path));mid=__unpack560[0];source=__unpack560[1];
root=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid);
before=(await tree(root));
first=(await pyMethod(kernel,"ok",["module.source.snapshot",({["module_id"]:mid})],{}));
second=(await pyMethod(kernel,"ok",["module.source.snapshot",({["module_id"]:mid})],{}));
assert.ok(pyBool(pyEqual(first,second)),"tests/kernel/test_jev_source_snapshot.py:23 assert first == second");
assert.ok(pyBool(pyEqual((await pySet(first)),new Set(["version","module_id","generation","revision","pdf","file_sha256","page_count"]))),"tests/kernel/test_jev_source_snapshot.py:24 assert set(first) == {\"version\", \"module_id\", \"generation\", \"revision\", \"pdf\", \"file_sha256\", \"page_count\"}");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(first,"version"),1);return pyBool(__left)?pyEqual(pyAt(first,"module_id"),mid):__left})());return pyBool(__left)?pyEqual(pyAt(first,"generation"),0):__left})())),"tests/kernel/test_jev_source_snapshot.py:25 assert first[\"version\"] == 1 and first[\"module_id\"] == mid and first[\"generation\"] == 0");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(first,"file_sha256"),pyAt(source,"file_sha256"));return pyBool(__left)?pyEqual(pyAt(first,"page_count"),pyAt(source,"page_count")):__left})())),"tests/kernel/test_jev_source_snapshot.py:26 assert first[\"file_sha256\"] == source[\"file_sha256\"] and first[\"page_count\"] == source[\"page_count\"]");
assert.ok(pyBool(pyEqual(pyAt(first,"pdf"),(await pyStr(pyDivide(root,"source.pdf"))))),"tests/kernel/test_jev_source_snapshot.py:27 assert first[\"pdf\"] == str(root / \"source.pdf\")");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(pyAt(first,"revision"))),64);return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const char of pyIterable(pyAt(first,"revision"))){__rows.push(pyContains("0123456789abcdef",char));}return __rows;})()))):__left})())),"tests/kernel/test_jev_source_snapshot.py:28 assert len(first[\"revision\"]) == 64 and all(char in \"0123456789abcdef\" for char in first[\"revision\"])");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(root,"graph.json")),"exists",[],{})))),"tests/kernel/test_jev_source_snapshot.py:29 assert not (root / \"graph.json\").exists()");
assert.ok(pyBool(pyEqual((await tree(root)),before)),"tests/kernel/test_jev_source_snapshot.py:30 assert tree(root) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_source_snapshot_is_read_only_and_available_before_any_graph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_source_snapshot_is_read_only_and_available_before_any_graph(await kernel(t,{}),temporary);});
export async function test_checked_answer_peek_miss_is_read_only_and_creates_no_job(kernel:any,tmp_path:any){
let mid:any,_:any,root:any,before:any,result:any;
const __unpack1478=(await indexed(kernel,tmp_path));mid=__unpack1478[0];_=__unpack1478[1];
root=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid);
before=(await tree(root));
result=(await pyMethod(kernel,"ok",["module.source.answer.peek",({["module_id"]:mid,["focus"]:"Lena",["question"]:"What does the source say about her work?"})],{}));
assert.ok(pyBool(pyEqual(result,({["cached"]:false}))),"tests/kernel/test_jev_source_snapshot.py:44 assert result == {\"cached\": False}");
assert.ok(pyBool(pyEqual((await tree(root)),before)),"tests/kernel/test_jev_source_snapshot.py:45 assert tree(root) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_checked_answer_peek_miss_is_read_only_and_creates_no_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_checked_answer_peek_miss_is_read_only_and_creates_no_job(await kernel(t,{}),temporary);});
export async function test_checked_answer_peek_rebuilds_from_retained_checked_bytes(kernel:any,tmp_path:any){
let mid:any,root:any,params:any,job:any,draft:any,_:any,accepted:any,module_path:any,meta:any,rows:any,peek:any,evidence:any,review_path:any,review_bytes:any,error:any,changed:any;
const __unpack1932=(await prepared(kernel,tmp_path));mid=__unpack1932[0];root=__unpack1932[1];
const __unpack1975=(await answer_job(kernel,mid));params=__unpack1975[0];job=__unpack1975[1];draft=__unpack1975[2];_=__unpack1975[3];
accepted=pyAt((await finish(kernel,job)),"source_answer");
module_path=pyDivide(root,"module.json");
meta=(await pyMethod(json,"loads",[(await pyMethod(module_path,"read_text",[],{}))],{}));
rows=(await pyList((await pyMethod(pyAt(pyAt(meta,"reading"),"answers"),"values",[],{}))));
assert.ok(pyBool(pyEqual((await pyLen(rows)),1)),"tests/kernel/test_jev_source_snapshot.py:55 assert len(rows) == 1");
pyAt(rows,0)["result"]=({["source_answer"]:({["answer"]:"poisoned duplicate result"})});
(await write(module_path,meta));
peek=(await pyMethod(kernel,"ok",["module.source.answer.peek",({["module_id"]:mid,["focus"]:pyAt(params,"focus"),["question"]:pyAt(params,"question")})],{}));
assert.ok(pyBool((pyAt(peek,"cached")===true)),"tests/kernel/test_jev_source_snapshot.py:65 assert peek[\"cached\"] is True");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(peek,"source_answer"),"answer");const __term1=pyAt(draft,"answer");const __term2=pyAt(accepted,"answer");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_source_snapshot.py:66 assert peek[\"source_answer\"][\"answer\"] == draft[\"answer\"] == accepted[\"answer\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(peek,"source_answer"),"derivation"),"checked_summary")),"tests/kernel/test_jev_source_snapshot.py:67 assert peek[\"source_answer\"][\"derivation\"] == \"checked_summary\"");
assert.ok(pyBool(!pyContains((await pyMethod(json,"dumps",[peek],{})),"poisoned")),"tests/kernel/test_jev_source_snapshot.py:68 assert \"poisoned\" not in json.dumps(peek)");
evidence=pyAt(peek,"evidence");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(evidence,"derived")===true);return pyBool(__left)?pyEqual(pyAt(evidence,"record"),draft):__left})())),"tests/kernel/test_jev_source_snapshot.py:70 assert evidence[\"derived\"] is True and evidence[\"record\"] == draft");
assert.ok(pyBool((await pyMethod(pyAt(evidence,"resource"),"startswith",[`source-answer:${mid}:`],{}))),"tests/kernel/test_jev_source_snapshot.py:71 assert evidence[\"resource\"].startswith(f\"source-answer:{mid}:\")");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(evidence,"revision");const __term1=pyAt(evidence,"accepted_revision");const __term2=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((pyDivide((await Path(pyAt(job,"work_dir"))),"draft.json")),"read_bytes",[],{}))],{})),"hexdigest",[],{}));return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_source_snapshot.py:72 assert evidence[\"revision\"] == evidence[\"accepted_revision\"] == hashlib.sha256(\n        (Path(job[\"work_dir\"]) / \"draft.json\").read_bytes()).hexdigest()");
assert.ok(pyBool(pyEqual(pyAt(evidence,"source_sha256"),pyAt(pyAt(meta,"source_document"),"file_sha256"))),"tests/kernel/test_jev_source_snapshot.py:74 assert evidence[\"source_sha256\"] == meta[\"source_document\"][\"file_sha256\"]");
review_path=pyDivide((await Path(pyAt(job,"work_dir"))),"review.json");
review_bytes=(await pyMethod(review_path,"read_bytes",[],{}));
(await pyMethod(review_path,"write_bytes",[pyAdd(review_bytes," ")],{}));
error=(await pyMethod(kernel,"err",["module.source.answer.peek",({["module_id"]:mid,["focus"]:pyAt(params,"focus"),["question"]:pyAt(params,"question")})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"reason"),"source_answer_integrity"):__left})())),"tests/kernel/test_jev_source_snapshot.py:84 assert error[\"code\"] == \"needs\" and error[\"details\"][\"reason\"] == \"source_answer_integrity\"");
(await pyMethod(review_path,"write_bytes",[review_bytes],{}));
changed=(await pyMethod(json,"loads",[(await pyMethod(module_path,"read_text",[],{}))],{}));
changed["generation"]+=1;
(await write(module_path,changed));
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["module.source.answer.peek",({["module_id"]:mid,["focus"]:pyAt(params,"focus"),["question"]:pyAt(params,"question")})],{})),({["cached"]:false}))),"tests/kernel/test_jev_source_snapshot.py:90 assert kernel.ok(\"module.source.answer.peek\", {\n        \"module_id\": mid,\n        \"focus\": params[\"focus\"],\n        \"question\": params[\"question\"],\n    }) == {\"cached\": False}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_checked_answer_peek_rebuilds_from_retained_checked_bytes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_checked_answer_peek_rebuilds_from_retained_checked_bytes(await kernel(t,{}),temporary);});
export async function test_task_source_revision_ignores_reader_ledger_but_changes_with_graph(kernel:any,tmp_path:any){
let mid:any,_:any,opening_job:any,campaign:any,before:any,module_before:any,after_ledger:any,graph_job:any,module_after:any,changed_campaign:any,after_graph:any;
const __unpack3995=(await indexed(kernel,tmp_path));mid=__unpack3995[0];_=__unpack3995[1];
const __unpack4034=(await opening(kernel,mid));opening_job=__unpack4034[0];_=__unpack4034[1];_=__unpack4034[2];
(await finish(kernel,opening_job));
campaign="source-revision";
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:campaign,["module"]:mid,["play_language"]:"en"})],{}));
(await confirmed_investigator(kernel,({"campaign":campaign,"name":"Reader"})));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:campaign})],{}));
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:campaign})],{}));
before=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:campaign})],{})),"_context");
module_before=(await pyMethod(kernel,"ok",["module.source.snapshot",({["module_id"]:mid})],{}));
assert.ok(pyBool((await pyIsInstance(pyAt(before,"task_source_revision"),pyStr))),"tests/kernel/test_jev_source_snapshot.py:108 assert isinstance(before[\"task_source_revision\"], str)");
(await answer_job(kernel,mid,({"campaign":campaign})));
after_ledger=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:campaign})],{})),"_context");
assert.ok(pyBool(pyEqual(pyAt(after_ledger,"source_revision"),pyAt(before,"source_revision"))),pyStr("existing KIC source binding stays unchanged"));
assert.ok(pyBool(pyEqual(pyAt(after_ledger,"task_source_revision"),pyAt(before,"task_source_revision"))),"tests/kernel/test_jev_source_snapshot.py:113 assert after_ledger[\"task_source_revision\"] == before[\"task_source_revision\"]");
(await request(kernel,mid,"detail",({"focus":"Dock","question":"What does the harbor look like?"})));
graph_job=(await claim(kernel,mid));
(await observed(graph_job));
(await write(pyDivide((await Path(pyAt(graph_job,"work_dir"))),"draft.json"),({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["source_refs"]:[({["page"]:1})],["properties"]:({["keeper_notes"]:"A changed harbor."})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-dock"]})));
(await write(pyDivide((await Path(pyAt(graph_job,"work_dir"))),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:[({["page"]:1})],["reason"]:"Fixture source support."})],["missing"]:[]})));
(await finish(kernel,graph_job));
module_after=(await pyMethod(kernel,"ok",["module.source.snapshot",({["module_id"]:mid})],{}));
assert.ok(pyBool(!pyEqual(pyAt(module_after,"revision"),pyAt(module_before,"revision"))),"tests/kernel/test_jev_source_snapshot.py:131 assert module_after[\"revision\"] != module_before[\"revision\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:campaign})],{})),"_context"),"task_source_revision"),pyAt(before,"task_source_revision"))),"tests/kernel/test_jev_source_snapshot.py:135 assert kernel.ok(\"table.capsule\", {\"campaign\": campaign})[\"_context\"][\"task_source_revision\"] == before[\"task_source_revision\"]");
changed_campaign="source-revision-after-graph";
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:changed_campaign,["module"]:mid,["play_language"]:"en"})],{}));
(await confirmed_investigator(kernel,({"campaign":changed_campaign,"name":"Later Reader"})));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:changed_campaign})],{}));
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:changed_campaign})],{}));
after_graph=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:changed_campaign})],{})),"_context");
assert.ok(pyBool(!pyEqual(pyAt(after_graph,"task_source_revision"),pyAt(before,"task_source_revision"))),"tests/kernel/test_jev_source_snapshot.py:142 assert after_graph[\"task_source_revision\"] != before[\"task_source_revision\"]");
assert.ok(pyBool(!pyEqual(pyAt(after_graph,"source_revision"),pyAt(after_ledger,"source_revision"))),"tests/kernel/test_jev_source_snapshot.py:143 assert after_graph[\"source_revision\"] != after_ledger[\"source_revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_task_source_revision_ignores_reader_ledger_but_changes_with_graph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_task_source_revision_ignores_reader_ledger_but_changes_with_graph(await kernel(t,{}),temporary);});
