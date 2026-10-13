// Migrated from tests/kernel/test_visual_reading.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
async function waitForProcess(proc:any,seconds:number){if(proc.exitCode!==null||proc.signalCode!==null)return;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{proc.removeListener('exit',done);reject(new Error('Child process did not exit'));},seconds*1000);function done(){clearTimeout(timer);resolve();}proc.once('exit',done);});}

import {confirmed_investigator,CONTENT_DIR,RpcClient,write,bind,request,claim,finish,observed,indexed,opening,handle_of,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
import {RpcError,Store,Table,ModuleGraph,record_of,ModuleStore,Reading,check_draft,random} from "./world-production-support.ts";
const __file__=new URL('../../tests/kernel/test_visual_reading.py',import.meta.url).pathname;


















export async function test_a_reader_cannot_publish_an_arbitrary_local_file_as_a_handout(){
let draft:any;
draft=({["nodes"]:[({["node_id"]:"handout-letter",["node_kind"]:"handout",["name"]:"Letter",["visibility"]:"revealable",["source_refs"]:[({["page"]:1})],["properties"]:({["asset_ref"]:"/unrelated/private.png"})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["critical"]:[],["dependencies"]:[],["ready_nodes"]:["handout-letter"]});
{let __caught1073:any;try{(await pyInvoke(check_draft,[draft,({["module_id"]:"book-1",["source"]:({["page_count"]:1}),["known_nodes"]:[]}),new Set([1])],{}));}catch(error){__caught1073=error;}assert.ok(__caught1073,"Expected exception");assert.ok(__caught1073 instanceof RpcError);assert.match(String(__caught1073),new RegExp("owned by the host"));}
}
Object.defineProperty(test_a_reader_cannot_publish_an_arbitrary_local_file_as_a_handout,"__pySignature",{value:[]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reader_cannot_publish_an_arbitrary_local_file_as_a_handout"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reader_cannot_publish_an_arbitrary_local_file_as_a_handout();});
export async function test_retired_source_commands_are_not_registered(kernel:any){
let method:any;
for(method of pyIterable(["bind","plan","plan.accept","packet","review","accept","assemble","install","deepen.claim","deepen.complete","deepen.enqueue"])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",[`module.${method}`,({})],{})),"code"),"unknown_method")),"tests/kernel/test_visual_reading.py:34 assert kernel.err(f\"module.{method}\", {})[\"code\"] == \"unknown_method\"");
}
}
Object.defineProperty(test_retired_source_commands_are_not_registered,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_retired_source_commands_are_not_registered"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_retired_source_commands_are_not_registered(await kernel(t,{}));});
export async function test_binding_checks_bytes_and_reuses_the_exact_source(kernel:any,tmp_path:any){
let mid:any,source:any,wrong:any;
const __unpack1651=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack1651[0];source=__unpack1651[1];
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"ok",["module.source.bind",({["source"]:source})],{})),({["module_id"]:mid,["replayed"]:true}))),"tests/kernel/test_visual_reading.py:55 assert kernel.ok(\"module.source.bind\", {\"source\": source}) == {\"module_id\": mid, \"replayed\": True}");
wrong=({...source,["file_sha256"]:pyMultiply("0",64)});
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["module.source.bind",({["source"]:wrong})],{})),"code"),"invalid_params")),"tests/kernel/test_visual_reading.py:57 assert kernel.err(\"module.source.bind\", {\"source\": wrong})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid),"source.pdf")),"read_bytes",[],{})),(await pyMethod((await pyInvoke(Path,[pyAt(source,"path")],{})),"read_bytes",[],{})))),"tests/kernel/test_visual_reading.py:58 assert (kernel.workspace / \".coc\" / \"modules\" / mid / \"source.pdf\").read_bytes() == Path(source[\"path\"]).read_bytes()");
}
Object.defineProperty(test_binding_checks_bytes_and_reuses_the_exact_source,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_binding_checks_bytes_and_reuses_the_exact_source"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_binding_checks_bytes_and_reuses_the_exact_source(await kernel(t,{}),temporary);});
export async function test_indexing_requires_actual_full_page_observation(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,error:any;
const __unpack2133=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack2133[0];_=__unpack2133[1];
(await pyInvoke(request,[kernel,mid,"index"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{"full_pages":[1]}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["sections"]:[({["name"]:"Book",["pages"]:[[1,2]]})]})],{}));
error=(await pyMethod(kernel,"err",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{}))})],{}));
assert.ok(pyBool(pyContains(pyAt(error,"message"),"observed source reference")),"tests/kernel/test_visual_reading.py:69 assert \"observed source reference\" in error[\"message\"]");
assert.ok(pyBool(!pyBool(pyAt(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"reading"),"index_complete"))),"tests/kernel/test_visual_reading.py:71 assert not kernel.ok(\"module.status\", {\"module_id\": mid})[\"reading\"][\"index_complete\"]");
}
Object.defineProperty(test_indexing_requires_actual_full_page_observation,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_indexing_requires_actual_full_page_observation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_indexing_requires_actual_full_page_observation(await kernel(t,{}),temporary);});
export async function test_index_publication_recovers_without_exposing_or_duplicating_partial_rows(kernel:any,tmp_path:any,monkeypatch:any){
let mid:any,_:any,store:any,reading:any,job:any,draft:any,patch:any,recovered:any,retry:any;
const __unpack2835=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack2835[0];_=__unpack2835[1];
(await pyInvoke(request,[kernel,mid,"index"],{}));
store=(await pyInvoke(ModuleStore,[kernel.workspace],{}));
reading=(await pyInvoke(Reading,[store],{}));
job=(await pyMethod(reading,"claim",[({["module_id"]:mid})],{}));
draft=({["title"]:"The Harbor",["language"]:"en",["sections"]:[({["name"]:"Harbor",["pages"]:[[1,2]]})]});
(await pyInvoke(observed,[job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
// Python OSError becomes a native I/O error; only this injected EIO instance satisfies the guard.
const ioError=Object.assign(new Error("crash before metadata publication"),{code:"EIO"});
patch=(await pyMethod(monkeypatch,"context",[],{}));try{async function interrupted(_meta:any){
throw ioError;
}
Object.defineProperty(interrupted,"__pySignature",{value:[{"name":"_meta","rest":false,"varargs":false}]});
(await pyMethod(patch,"setattr",[store,"write_module",interrupted],{}));
{let __caught3398:any;try{(await pyMethod(reading,"finish",[({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{}))})],{}));}catch(error){__caught3398=error;}assert.equal(__caught3398,ioError);assert.equal(__caught3398.code,"EIO");}}finally{patch.restore();}
assert.ok(pyBool((await pyMethod((pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"index.json")),"exists",[],{}))),"tests/kernel/test_visual_reading.py:90 assert (Path(job[\"work_dir\"]) / \"index.json\").exists()");
assert.ok(pyBool(pyEqual((await pyMethod(store,"read_sections",[mid],{})),[])),"tests/kernel/test_visual_reading.py:91 assert store.read_sections(mid) == []");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(store,"module",[mid],{})),"reading"),"viewed_pages"),[])),"tests/kernel/test_visual_reading.py:92 assert store.module(mid)[\"reading\"][\"viewed_pages\"] == []");
(await pyMethod(reading,"release",[mid],{}));
recovered=(await pyInvoke(Reading,[(await pyInvoke(ModuleStore,[kernel.workspace],{}))],{}));
retry=(await pyMethod(recovered,"claim",[({["module_id"]:mid})],{}));
(await pyInvoke(observed,[retry],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(retry,"work_dir")],{})),"draft.json"),draft],{}));
(await pyMethod(recovered,"finish",[({["module_id"]:mid,["job_id"]:pyAt(retry,"job_id"),["lease"]:pyAt(retry,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(retry,"work_dir")],{})),"draft.json")],{}))})],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod(store,"read_sections",[mid],{}))],{})),1)),"tests/kernel/test_visual_reading.py:100 assert len(store.read_sections(mid)) == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(store,"module",[mid],{})),"reading"),"viewed_pages"),[0,1])),"tests/kernel/test_visual_reading.py:101 assert store.module(mid)[\"reading\"][\"viewed_pages\"] == [0, 1]");
assert.ok(pyBool((await pyMethod((pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"index.json")),"exists",[],{}))),"tests/kernel/test_visual_reading.py:102 assert (Path(job[\"work_dir\"]) / \"index.json\").exists()");
}
Object.defineProperty(test_index_publication_recovers_without_exposing_or_duplicating_partial_rows,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false},{"name":"monkeypatch","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_index_publication_recovers_without_exposing_or_duplicating_partial_rows"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_index_publication_recovers_without_exposing_or_duplicating_partial_rows(await kernel(t,{}),temporary,pyMonkeypatch(t));});
export async function test_module_review_requires_scope_without_repeated_numeric_transcription(kernel:any,tmp_path:any,required_path:any){
let mid:any,_:any,job:any,draft:any,review:any,missing:any,params:any,result:any,store:any,graph:any;
const __unpack4577=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack4577[0];_=__unpack4577[1];
const __unpack4616=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack4616[0];draft=__unpack4616[1];review=__unpack4616[2];
missing=(await pyMethod(copy,"deepcopy",[review],{}));
missing["checked"]=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(missing,"checked"))){if(pyBool(!pyEqual(pyAt(r,"path"),required_path))){__rows.push(r);}}return __rows;})());
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),missing],{}));
params=({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{})),["review_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json")],{}))});
if(pyBool(pyEqual(required_path,"/coverage"))){assert.ok(pyBool(pyContains(pyAt((await pyMethod(kernel,"err",["module.read.finish",params],{})),"message"),"omitted")),"tests/kernel/test_visual_reading.py:115 assert \"omitted\" in kernel.err(\"module.read.finish\", params)[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"generation"),0)),"tests/kernel/test_visual_reading.py:116 assert kernel.ok(\"module.status\", {\"module_id\": mid})[\"generation\"] == 0");
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),review],{}));}
result=(await pyInvoke(finish,[kernel,job],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(result,"opening_ready")===true);return pyBool(__left)?pyEqual(pyAt(result,"generation"),1):__left;})())),"tests/kernel/test_visual_reading.py:119 assert result[\"opening_ready\"] is True and result[\"generation\"] == 1");
assert.ok(pyBool((pyAt((await pyInvoke(finish,[kernel,job],{})),"replayed")===true)),"tests/kernel/test_visual_reading.py:120 assert finish(kernel, job)[\"replayed\"] is True");
store=(await pyInvoke(ModuleStore,[kernel.workspace],{}));
assert.ok(pyBool(pyContains((await pyInvoke(pyStr,[(await pyMethod(store,"graph_path",[mid],{}))],{})),"generations")),"tests/kernel/test_visual_reading.py:122 assert \"generations\" in str(store.graph_path(mid))");
graph=(await pyMethod(store,"read_graph",[mid],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"npc-lena"))){__rows.push(n);}}return __rows;})()))),"source_refs"),[({["source_id"]:`pdf:${mid}`,["pdf_index"]:0})])),"tests/kernel/test_visual_reading.py:124 assert next(n for n in graph[\"nodes\"] if n[\"node_id\"] == \"npc-lena\")[\"source_refs\"] == [{\"source_id\": f\"pdf:{mid}\", \"pdf_index\": 0}]");
}
Object.defineProperty(test_module_review_requires_scope_without_repeated_numeric_transcription,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false},{"name":"required_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("required_path",["/nodes/2/properties/mechanics/profile/characteristics/STR","/coverage"]))).entries())test("test_module_review_requires_scope_without_repeated_numeric_transcription"+((pyCartesian([{}],pyParametrize("required_path",["/nodes/2/properties/mechanics/profile/characteristics/STR","/coverage"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_module_review_requires_scope_without_repeated_numeric_transcription(await kernel(t,{}),temporary,row["required_path"]);});
export async function test_ready_material_cache_cannot_hide_changed_published_graph_bytes(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,root:any,metadata_bytes:any,graph_path:any,changed:any,params:any,failure:any;
const __unpack5848=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack5848[0];_=__unpack5848[1];
const __unpack5887=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack5887[0];_=__unpack5887[1];_=__unpack5887[2];
(await pyInvoke(finish,[kernel,job],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena"})),"state"),"ready")),"tests/kernel/test_visual_reading.py:131 assert request(kernel, mid, \"detail\", focus=\"Lena\")[\"state\"] == \"ready\"");
root=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid);
metadata_bytes=(await pyMethod((pyDivide(root,"module.json")),"read_bytes",[],{}));
graph_path=pyDivide(root,pyAt((await pyMethod(json,"loads",[metadata_bytes],{})),"graph_file"));
changed=pyAdd((await pyMethod(graph_path,"read_bytes",[],{})),Buffer.from(" ","latin1"));
(await pyMethod(graph_path,"write_bytes",[changed],{}));
for(params of pyIterable([({["purpose"]:"opening"}),({["purpose"]:"detail",["focus"]:"Lena"})])){
failure=(await pyMethod(kernel,"err",["module.read.request",({["module_id"]:mid,...params})],{}));
assert.ok(pyBool(pyEqual(pyAt(failure,"code"),"campaign_not_ready")),"tests/kernel/test_visual_reading.py:139 assert failure[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(failure,"details"),"reason"),"module_graph_integrity")),"tests/kernel/test_visual_reading.py:140 assert failure[\"details\"][\"reason\"] == \"module_graph_integrity\"");
}
assert.ok(pyBool(pyEqual((await pyMethod(graph_path,"read_bytes",[],{})),changed)),"tests/kernel/test_visual_reading.py:141 assert graph_path.read_bytes() == changed");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(root,"module.json")),"read_bytes",[],{})),metadata_bytes)),"tests/kernel/test_visual_reading.py:142 assert (root / \"module.json\").read_bytes() == metadata_bytes");
}
Object.defineProperty(test_ready_material_cache_cannot_hide_changed_published_graph_bytes,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ready_material_cache_cannot_hide_changed_published_graph_bytes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ready_material_cache_cannot_hide_changed_published_graph_bytes(await kernel(t,{}),temporary);});
export async function test_existing_material_does_not_swallow_a_new_question(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,first:any;
const __unpack6766=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack6766[0];_=__unpack6766[1];
const __unpack6805=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack6805[0];_=__unpack6805[1];_=__unpack6805[2];
(await pyInvoke(finish,[kernel,job],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena"})),"state"),"ready")),"tests/kernel/test_visual_reading.py:149 assert request(kernel, mid, \"detail\", focus=\"Lena\")[\"state\"] == \"ready\"");
first=(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"Who does she owe money to?"}));
assert.ok(pyBool(pyEqual(pyAt(first,"state"),"queued")),"tests/kernel/test_visual_reading.py:151 assert first[\"state\"] == \"queued\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"Who does she owe money to?"})),"job_id"),pyAt(first,"job_id"))),"tests/kernel/test_visual_reading.py:152 assert request(kernel, mid, \"detail\", focus=\"Lena\", question=\"Who does she owe money to?\")[\"job_id\"] == first[\"job_id\"]");
assert.ok(pyBool(!pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What does she know of the tower?"})),"job_id"),pyAt(first,"job_id"))),"tests/kernel/test_visual_reading.py:153 assert request(kernel, mid, \"detail\", focus=\"Lena\", question=\"What does she know of the tower?\")[\"job_id\"] != first[\"job_id\"]");
}
Object.defineProperty(test_existing_material_does_not_swallow_a_new_question,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_existing_material_does_not_swallow_a_new_question"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_existing_material_does_not_swallow_a_new_question(await kernel(t,{}),temporary);});
export async function test_queued_preparation_reuses_material_published_by_an_earlier_job(kernel:any,tmp_path:any){
let mid:any,_:any,first:any,queued:any,rows:any,reused:any,new_question:any,active:any;
const __unpack7423=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack7423[0];_=__unpack7423[1];
const __unpack7462=(await pyInvoke(opening,[kernel,mid],{}));first=__unpack7462[0];_=__unpack7462[1];_=__unpack7462[2];
queued=(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena"}));
(await pyInvoke(finish,[kernel,first],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(claim,[kernel,mid],{})),({["job_id"]:null}))),"tests/kernel/test_visual_reading.py:161 assert claim(kernel, mid) == {\"job_id\": None}");
rows=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(kernel.workspace,".coc/modules"),mid),"deepen-queue.json")),"read_text",[],{}))],{}));
reused=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyEqual(pyAt(row,"job_id"),pyAt(queued,"job_id")))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(reused,"state"),"completed");return pyBool(__left)?pyEqual(pyAt(reused,"reused_generation"),1):__left;})())),"tests/kernel/test_visual_reading.py:164 assert reused[\"state\"] == \"completed\" and reused[\"reused_generation\"] == 1");
assert.ok(pyBool(!pyContains(reused,"work_dir")),"tests/kernel/test_visual_reading.py:165 assert \"work_dir\" not in reused");
new_question=(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What is her earlier job?"}));
active=(await pyInvoke(claim,[kernel,mid],{}));
assert.ok(pyBool(pyEqual(pyAt(active,"job_id"),pyAt(new_question,"job_id"))),"tests/kernel/test_visual_reading.py:168 assert active[\"job_id\"] == new_question[\"job_id\"]");
(await pyInvoke(finish,[kernel,active],{"outcome":"cancelled"}));
}
Object.defineProperty(test_queued_preparation_reuses_material_published_by_an_earlier_job,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_queued_preparation_reuses_material_published_by_an_earlier_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_queued_preparation_reuses_material_published_by_an_earlier_job(await kernel(t,{}),temporary);});
export async function test_a_prepared_summary_is_mapped_without_silently_replacing_campaign_values(kernel:any,tmp_path:any){
let mid:any,_:any,first:any,draft:any,page:any,job:any,reviewed:any,params:any,graph:any,mapping:any;
const __unpack8262=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack8262[0];_=__unpack8262[1];
const __unpack8301=(await pyInvoke(opening,[kernel,mid],{}));first=__unpack8301[0];draft=__unpack8301[1];_=__unpack8301[2];
pyAt(pyAt(draft,"nodes"),0)["summary"]="A working harbor.";
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(first,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(finish,[kernel,first],{}));
for(page of pyIterable([1,2])){
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Dock","question":`What does source page ${page} describe?`}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["summary"]:"An abandoned military base.",["source_refs"]:[({["page"]:page})]})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-dock"]})],{}));
reviewed=({["path"]:"/nodes/0",["verdict"]:"supported",["source_refs"]:[({["page"]:page})]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[reviewed],["missing"]:[]})],{}));
params=({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{})),["review_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json")],{}))});
assert.ok(pyBool(pyContains(pyAt((await pyMethod(kernel,"err",["module.read.finish",params],{})),"message"),"/coverage")),"tests/kernel/test_visual_reading.py:189 assert \"/coverage\" in kernel.err(\"module.read.finish\", params)[\"message\"]");
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[reviewed,({...reviewed,["path"]:"/coverage"})],["missing"]:[]})],{}));
(await pyInvoke(finish,[kernel,job],{}));
graph=(await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_graph",[mid],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"scene-dock"))){__rows.push(n);}}return __rows;})()))),"summary"),"A working harbor.")),"tests/kernel/test_visual_reading.py:193 assert next(n for n in graph[\"nodes\"] if n[\"node_id\"] == \"scene-dock\")[\"summary\"] == \"A working harbor.\"");
mapping=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(graph,"source_mappings"))){if(pyBool(pyEqual(pyAt(row,"path"),"/nodes/scene-dock/summary"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(mapping,"established_value"),"A working harbor.")),"tests/kernel/test_visual_reading.py:195 assert mapping[\"established_value\"] == \"A working harbor.\"");
assert.ok(pyBool(pyEqual(pyAt(mapping,"source_value"),"An abandoned military base.")),"tests/kernel/test_visual_reading.py:196 assert mapping[\"source_value\"] == \"An abandoned military base.\"");
}
}
Object.defineProperty(test_a_prepared_summary_is_mapped_without_silently_replacing_campaign_values,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_prepared_summary_is_mapped_without_silently_replacing_campaign_values"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_prepared_summary_is_mapped_without_silently_replacing_campaign_values(await kernel(t,{}),temporary);});
export async function test_further_reading_reuses_an_existing_claim_identity_and_reason(kernel:any,tmp_path:any){
let mid:any,_:any,first:any,draft:any,job:any,graph:any,routes:any;
const __unpack10188=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack10188[0];_=__unpack10188[1];
const __unpack10227=(await pyInvoke(opening,[kernel,mid],{}));first=__unpack10227[0];draft=__unpack10227[1];_=__unpack10227[2];
(await pyMethod(pyAt(pyAt(draft,"claims"),0),"update",[],{"claim_id":"claim-harbor-trail","reason":"The trail connects the dock and tower."}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(first,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(finish,[kernel,first],{}));
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Dock","question":"Where does its trail lead?"}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(job,"known_claims"))){__rows.push(pyEqual((await pyMethod(c,"get",["reason"],{})),"The trail connects the dock and tower."));}return __rows;})())))),"tests/kernel/test_visual_reading.py:208 assert any(c.get(\"reason\") == \"The trail connects the dock and tower.\" for c in job[\"known_claims\"])");
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["source_refs"]:[({["page"]:1})]})],["claims"]:[({["subject_id"]:"scene-dock",["predicate"]:"route-to",["object"]:({["node_id"]:"scene-tower"}),["truth_status"]:"authored-fact",["source_refs"]:[({["page"]:2})]})],["node_refs"]:["scene-tower"],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-dock"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/claims/0","/coverage"],["verdict"]:"supported",["source_refs"]:[({["page"]:1}),({["page"]:2})]})],["missing"]:[]})],{}));
(await pyInvoke(finish,[kernel,job],{}));
graph=(await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_graph",[mid],{}));
routes=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(graph,"claims"))){if(pyBool(pyEqual(pyAt(c,"predicate"),"route-to"))){__rows.push(c);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[routes],{})),1);return pyBool(__left)?pyEqual(pyAt(pyAt(routes,0),"claim_id"),"claim-harbor-trail"):__left;})())),"tests/kernel/test_visual_reading.py:218 assert len(routes) == 1 and routes[0][\"claim_id\"] == \"claim-harbor-trail\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(routes,0),"reason"),"The trail connects the dock and tower.")),"tests/kernel/test_visual_reading.py:219 assert routes[0][\"reason\"] == \"The trail connects the dock and tower.\"");
}
Object.defineProperty(test_further_reading_reuses_an_existing_claim_identity_and_reason,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_further_reading_reuses_an_existing_claim_identity_and_reason"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_further_reading_reuses_an_existing_claim_identity_and_reason(await kernel(t,{}),temporary);});
export async function test_published_material_remains_usable_without_the_original_pdf(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,error:any,opened:any;
const __unpack11767=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack11767[0];_=__unpack11767[1];
const __unpack11806=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack11806[0];_=__unpack11806[1];_=__unpack11806[2];
(await pyInvoke(finish,[kernel,job],{}));
(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid),"source.pdf")),"unlink",[],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"opening"],{})),"state"),"ready")),"tests/kernel/test_visual_reading.py:227 assert request(kernel, mid, \"opening\")[\"state\"] == \"ready\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena"})),"state"),"ready")),"tests/kernel/test_visual_reading.py:228 assert request(kernel, mid, \"detail\", focus=\"Lena\")[\"state\"] == \"ready\"");
error=(await pyMethod(kernel,"err",["module.read.request",({["module_id"]:mid,["purpose"]:"detail",["focus"]:"Lena",["question"]:"Who does she owe money to?"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"reason"),"needs_source")),"tests/kernel/test_visual_reading.py:231 assert error[\"details\"][\"reason\"] == \"needs_source\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"generation"),1)),"tests/kernel/test_visual_reading.py:232 assert kernel.ok(\"module.status\", {\"module_id\": mid})[\"generation\"] == 1");
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"c1",["module"]:mid,["play_language"]:"en"})],{}));
(await pyInvoke(confirmed_investigator,[kernel],{}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"c1"})],{}));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"scene"),"name"),(await pyInvoke(handle_of,[kernel,"c1","Dock"],{})))),"tests/kernel/test_visual_reading.py:237 assert opened[\"scene\"][\"name\"] == handle_of(kernel, \"c1\", \"Dock\")");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"The harbor waits."}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I stay on the dock."}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:5})]})),"world"),"clock"),"minutes"),5)),"tests/kernel/test_visual_reading.py:240 assert kernel.table(\"apply\", call_id=\"t1-c1\", effects=[{\"kind\": \"time\", \"minutes\": 5}])[\"world\"][\"clock\"][\"minutes\"] == 5");
}
Object.defineProperty(test_published_material_remains_usable_without_the_original_pdf,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_published_material_remains_usable_without_the_original_pdf"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_published_material_remains_usable_without_the_original_pdf(await kernel(t,{}),temporary);});
export async function test_distinct_regions_on_the_same_page_keep_their_own_assets_across_publications(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,draft:any,review:any,image:any,left:any,next_job:any,next_draft:any,next_review:any,right:any,chosen:any,asset:any,result:any;
const __unpack13007=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack13007[0];_=__unpack13007[1];
const __unpack13046=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack13046[0];draft=__unpack13046[1];review=__unpack13046[2];
image=(await pyMethod((pyDivide((await pyInvoke(Path,[__file__],{})).parent,"fixtures/bundle-tiny/assets/map-dock.png")),"read_bytes",[],{}));
async function attach(job:any,draft:any,review:any,name:any,box:any){
let position:any,nid:any,path:any;
position=(await pyInvoke(pyLen,[pyAt(draft,"nodes")],{}));
nid=`handout-${name}`;
(await pyMethod(pyAt(draft,"nodes"),"append",[({["node_id"]:nid,["node_kind"]:"handout",["name"]:name,["visibility"]:"revealable",["source_refs"]:[({["page"]:1})],["properties"]:({["image_sources"]:[({["page"]:1,["box"]:box})]})})],{}));
(await pyMethod(pyAt(draft,"ready_nodes"),"append",[nid],{}));
(await pyMethod(pyAt(review,"checked"),"append",[({["path"]:`/nodes/${position}`,["verdict"]:"supported",["source_refs"]:[({["page"]:1})]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),review],{}));
path=pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),`${name}.png`);
(await pyMethod(path,"write_bytes",[image],{}));
return ({["node_id"]:nid,["path"]:(await pyInvoke(pyStr,[path],{})),["sha256"]:(await pyMethod((await pyMethod(hashlib,"sha256",[image],{})),"hexdigest",[],{}))});
}
Object.defineProperty(attach,"__pySignature",{value:[{"name":"job","rest":false,"varargs":false},{"name":"draft","rest":false,"varargs":false},{"name":"review","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"box","rest":false,"varargs":false}]});
left=(await pyInvoke(attach,[job,draft,review,"left",[0,0,0.5,1]],{}));
(await pyInvoke(finish,[kernel,job],{"assets":[left]}));
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"Which second handout does she carry?"}));
next_job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[next_job],{}));
next_draft=({["nodes"]:[],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:[]});
next_review=({["checked"]:[({["path"]:"/coverage",["verdict"]:"supported",["source_refs"]:[({["page"]:1})],["reason"]:"Only the second handout is prepared in this fixture."})],["missing"]:[]});
right=(await pyInvoke(attach,[next_job,next_draft,next_review,"right",[0.5,0,1,1]],{}));
(await pyInvoke(finish,[kernel,next_job],{"assets":[right]}));
chosen=(await pyMethod(kernel,"ok",["module.opening.choose",({["module_id"]:mid,["scene"]:"Dock"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(chosen,"generation"),3);return pyBool(__left)?(pyAt(chosen,"opening_ready")===true):__left;})())),"tests/kernel/test_visual_reading.py:273 assert chosen[\"generation\"] == 3 and chosen[\"opening_ready\"] is True");
for(asset of pyIterable([left,right])){
result=(await pyMethod(kernel,"ok",["module.asset",({["module_id"]:mid,["name"]:pyAt(asset,"node_id")})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"asset"),"path"),pyAt(asset,"path"))),"tests/kernel/test_visual_reading.py:276 assert result[\"asset\"][\"path\"] == asset[\"path\"]");
assert.ok(pyBool((pyAt(result,"player_visible")===true)),"tests/kernel/test_visual_reading.py:277 assert result[\"player_visible\"] is True");
assert.ok(pyBool(pyEqual((await pyMethod((await pyInvoke(Path,[pyAt(pyAt(result,"asset"),"path")],{})),"read_bytes",[],{})),image)),"tests/kernel/test_visual_reading.py:278 assert Path(result[\"asset\"][\"path\"]).read_bytes() == image");
}
}
Object.defineProperty(test_distinct_regions_on_the_same_page_keep_their_own_assets_across_publications,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_distinct_regions_on_the_same_page_keep_their_own_assets_across_publications"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_distinct_regions_on_the_same_page_keep_their_own_assets_across_publications(await kernel(t,{}),temporary);});
export async function test_two_kernel_sessions_cannot_claim_the_same_job(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,other:any,next_job:any;
const __unpack15232=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack15232[0];_=__unpack15232[1];
(await pyInvoke(request,[kernel,mid,"opening"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
other=(new RpcClient(kernel.workspace));
try{assert.ok(pyBool(pyEqual((await pyInvoke(claim,[other,mid],{})),({["job_id"]:null}))),"tests/kernel/test_visual_reading.py:287 assert claim(other, mid) == {\"job_id\": None}");
(await pyInvoke(finish,[kernel,job],{"outcome":"cancelled"}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[other,mid,"opening"],{})),"state"),"blocked")),"tests/kernel/test_visual_reading.py:289 assert request(other, mid, \"opening\")[\"state\"] == \"blocked\"");
(await pyInvoke(request,[other,mid,"opening"],{"retry":true}));
next_job=(await pyInvoke(claim,[other,mid],{}));
assert.ok(pyBool(!pyEqual(pyAt(next_job,"job_id"),pyAt(job,"job_id"))),"tests/kernel/test_visual_reading.py:292 assert next_job[\"job_id\"] != job[\"job_id\"]");
(await pyInvoke(finish,[other,next_job],{"outcome":"cancelled"}));}finally{(await pyMethod(other,"close",[],{}));}
}
Object.defineProperty(test_two_kernel_sessions_cannot_claim_the_same_job,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_two_kernel_sessions_cannot_claim_the_same_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_two_kernel_sessions_cannot_claim_the_same_job(await kernel(t,{}),temporary);});
export async function test_material_preflight_precedes_the_whole_effect_batch_and_rng(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,draft:any,review:any,saved:any,viewed:any,directory:any,before:any,rng:any,table:any,rng_before:any,exc:any,scoped:any,scoped_meta:any,current_graph:any,tower:any,movement:any,result:any,turn:any;
const __unpack15871=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack15871[0];_=__unpack15871[1];
const __unpack15910=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack15910[0];draft=__unpack15910[1];review=__unpack15910[2];
pyAt(pyAt(draft,"nodes"),0)["summary"]="The harbor keeper asks for the missing ledger.";
pyAt(pyAt(pyAt(draft,"nodes"),0),"properties")["mission"]="Find the missing ledger.";
(await pyMethod(pyAt(draft,"nodes"),"append",[({["node_id"]:`module-${mid}`,["node_kind"]:"module",["name"]:"The Harbor",["source_refs"]:[({["page"]:1})],["properties"]:({["era"]:"80 CE"})})],{}));
(await pyMethod(pyAt(draft,"ready_nodes"),"append",[`module-${mid}`],{}));
(await pyMethod(pyAt(review,"checked"),"append",[({["path"]:"/nodes/3",["verdict"]:"supported",["source_refs"]:[({["page"]:1})]})],{}));
// Section 150 exempts ordinary scenes; an unread source clue still gates an entire batch.
draft.nodes.push({node_id:"clue-unread-ledger",node_kind:"clue",name:"Unread ledger",source_refs:[{page:2}],summary:"An indexed ledger awaits source preparation.",properties:{}});
review.checked.push({path:"/nodes/4",verdict:"supported",source_refs:[{page:2}]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),review],{}));
(await pyInvoke(finish,[kernel,job],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"c1",["module"]:mid,["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"card-source",["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyInvoke(confirmed_investigator,[kernel],{"campaign":"card-source"}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"card-source"})],{}));
saved=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:"card-source"})],{}));
(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:"c1",["library_id"]:pyAt(saved,"library_id")})],{}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"c1"})],{}));
(await pyMethod(kernel,"table",["open"],{}));
viewed=(await pyMethod(kernel,"table",["look"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(viewed,"module"),"era"),"80 CE")),"tests/kernel/test_visual_reading.py:321 assert viewed[\"module\"][\"era\"] == \"80 CE\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(viewed,"where"),"summary"),"The harbor keeper asks for the missing ledger.")),"tests/kernel/test_visual_reading.py:322 assert viewed[\"where\"][\"summary\"] == \"The harbor keeper asks for the missing ledger.\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"module","query":"Dock"})),"entities"),0),"properties"),"mission"),"Find the missing ledger.")),"tests/kernel/test_visual_reading.py:323 assert kernel.table(\"lookup\", kind=\"module\", query=\"Dock\")[\"entities\"][0][\"properties\"][\"mission\"] == \"Find the missing ledger.\"");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"The harbor waits."}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I go to the tower."}));
directory=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"campaigns"),"c1");
before=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(["world.json","turn.json"])){__rows.push([f,(await pyMethod((pyDivide(directory,f)),"read_bytes",[],{}))]);}return __rows;})()));
rng=(await pyMethod(random,"Random",[42],{}));
table=(await pyInvoke(Table,[(await pyInvoke(Store,[kernel.workspace],{})),CONTENT_DIR,rng],{"seed_locked":true}));
rng_before=random.Random(42);
{let __caught18041:any;try{(await pyMethod(table,"apply",[({["campaign"]:"c1",["call_id"]:"t1-c1",["effects"]:[({["kind"]:"damage",["cause"]:"fall"}),({["kind"]:"move",["to"]:"Tower"})]})],{}));}catch(error){__caught18041=error;}assert.ok(__caught18041,"Expected exception");assert.ok(__caught18041 instanceof RpcError);exc={value:__caught18041};}
// Section 150.2 supersedes the historical scene-dossier refusal; malformed damage remains malformed.
assert.equal(exc.value.toJson().code,"invalid_params");
assert.match(exc.value.toJson().message,/params\.dice/);
assert.equal(exc.value.toJson().details.index,0);
for(let draw=0;draw<64;draw++)assert.equal(rng.getrandbits(32),rng_before.getrandbits(32),"Preflight must not consume the real native RNG");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(before)){__rows.push([f,(await pyMethod((pyDivide(directory,f)),"read_bytes",[],{}))]);}return __rows;})())),before)),"tests/kernel/test_visual_reading.py:336 assert {f: (directory / f).read_bytes() for f in before} == before");

const unreadHandle=await handle_of(kernel,"c1","Unread ledger");
const preflightFiles=Object.fromEntries(await Promise.all(Object.keys(before).map(async file=>[file,await pyMethod(pyDivide(directory,file),"read_bytes",[],{})])));
const preflightRng=random.Random(42),preflightBefore=random.Random(42);
const preflightTable=await Table(await Store(kernel.workspace),CONTENT_DIR,preflightRng,{seed_locked:true});
await assert.rejects(()=>preflightTable.apply({campaign:"c1",call_id:"t1-c1",effects:[{kind:"damage",cause:"fall"},{kind:"clue",clue:unreadHandle,how:"inspect the ledger"}]}),(error:any)=>{assert.ok(error instanceof RpcError);assert.equal(error.toJson().details.reason,"material_pending");return true;});
for(let draw=0;draw<64;draw++)assert.equal(preflightRng.getrandbits(32),preflightBefore.getrandbits(32),"Unread source clue preflight must not consume the actual native RNG");
for(const file of Object.keys(preflightFiles))assert.deepEqual(await pyMethod(pyDivide(directory,file),"read_bytes",[],{}),preflightFiles[file],"Unread source clue preflight must leave every state byte unchanged");
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Tower","campaign":"c1"}));
job=(await pyMethod(kernel,"ok",["module.read.claim",({["module_id"]:mid,["campaign"]:"c1",["owner"]:"test-host"})],{}));
(await pyInvoke(observed,[job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[({["node_id"]:"scene-tower",["node_kind"]:"scene",["name"]:"Tower",["source_refs"]:[({["page"]:2})],["summary"]:"The tower's upper room holds a ledger.",["properties"]:({["is_final"]:true,["facts"]:["The upper room contains a ledger."]})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-tower"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:[({["page"]:2})]})],["missing"]:[]})],{}));
(await pyInvoke(finish,[kernel,job],{"campaign":"c1"}));
scoped=pyDivide(pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"module-campaigns"),"c1"),"modules"),mid);
scoped_meta=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(scoped,"module.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
current_graph=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(scoped,pyAt(scoped_meta,"graph_file"))),"read_text",[],{"encoding":"utf-8"}))],{}));
tower=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(current_graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"scene-tower"))){__rows.push(n);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(tower,"summary"),"The tower's upper room holds a ledger.")),"tests/kernel/test_visual_reading.py:352 assert tower[\"summary\"] == \"The tower's upper room holds a ledger.\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(record_of,[tower],{})),"facts"),["The upper room contains a ledger."])),"tests/kernel/test_visual_reading.py:353 assert record_of(tower)[\"facts\"] == [\"The upper room contains a ledger.\"]");
movement=({["call_id"]:"t1-c1",["effects"]:[({["kind"]:"move",["to"]:"Tower"})]});
result=(await pyMethod(kernel,"table",["apply"],{...movement}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"world"),"active_scene"),(await pyInvoke(handle_of,[kernel,"c1","Tower"],{})))),"tests/kernel/test_visual_reading.py:356 assert result[\"world\"][\"active_scene\"] == handle_of(kernel, \"c1\", \"Tower\")");
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["apply"],{...movement})),"replayed")===true)),"tests/kernel/test_visual_reading.py:357 assert kernel.table(\"apply\", **movement)[\"replayed\"] is True");
turn=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(directory,"turn.json")),"read_text",[],{}))],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(turn,"receipts"))){if(pyBool(pyEqual(pyAt(r,"kind"),"move"))){__rows.push(r);}}return __rows;})())],{})),1)),"tests/kernel/test_visual_reading.py:359 assert len([r for r in turn[\"receipts\"] if r[\"kind\"] == \"move\"]) == 1");
}
Object.defineProperty(test_material_preflight_precedes_the_whole_effect_batch_and_rng,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_material_preflight_precedes_the_whole_effect_batch_and_rng"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_material_preflight_precedes_the_whole_effect_batch_and_rng(await kernel(t,{}),temporary);});
export async function test_a_reference_alone_cannot_promote_a_thin_node_to_ready(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,err:any;
const __unpack20253=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack20253[0];_=__unpack20253[1];
const __unpack20292=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack20292[0];_=__unpack20292[1];_=__unpack20292[2];
(await pyInvoke(finish,[kernel,job],{}));
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Tower"}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[],["claims"]:[],["node_refs"]:["scene-tower"],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-tower"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[],["missing"]:[]})],{}));
err=(await pyMethod(kernel,"err",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{})),["review_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json")],{}))})],{}));
assert.ok(pyBool(pyContains(pyAt(err,"message"),"independently reviewed")),"tests/kernel/test_visual_reading.py:375 assert \"independently reviewed\" in err[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"generation"),1)),"tests/kernel/test_visual_reading.py:376 assert kernel.ok(\"module.status\", {\"module_id\": mid})[\"generation\"] == 1");
}
Object.defineProperty(test_a_reference_alone_cannot_promote_a_thin_node_to_ready,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reference_alone_cannot_promote_a_thin_node_to_ready"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reference_alone_cannot_promote_a_thin_node_to_ready(await kernel(t,{}),temporary);});
export async function test_registration_does_not_overwrite_an_interrupted_source_copy(kernel:any,tmp_path:any){
let reserved:any,mid:any,_:any;
reserved=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),"book-1");
(await pyMethod(reserved,"mkdir",[],{"parents":true}));
(await pyMethod((pyDivide(reserved,"source.pdf")),"write_bytes",[Buffer.from("interrupted copy","latin1")],{}));
const __unpack21377=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack21377[0];_=__unpack21377[1];
assert.ok(pyBool(pyEqual(mid,"book-2")),"tests/kernel/test_visual_reading.py:384 assert mid == \"book-2\"");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(reserved,"source.pdf")),"read_bytes",[],{})),Buffer.from("interrupted copy","latin1"))),"tests/kernel/test_visual_reading.py:385 assert (reserved / \"source.pdf\").read_bytes() == b\"interrupted copy\"");
}
Object.defineProperty(test_registration_does_not_overwrite_an_interrupted_source_copy,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_registration_does_not_overwrite_an_interrupted_source_copy"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_registration_does_not_overwrite_an_interrupted_source_copy(await kernel(t,{}),temporary);});
export async function test_grouped_review_still_names_every_required_numeric_field(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,review:any,group:any;
const __unpack21599=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack21599[0];_=__unpack21599[1];
const __unpack21638=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack21638[0];_=__unpack21638[1];review=__unpack21638[2];
group=({["checked"]:[({["paths"]:(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(review,"checked"))){__rows.push(pyAt(r,"path"));}return __rows;})()),["verdict"]:"supported",["source_refs"]:[({["page"]:1})],["reason"]:"the listed fields match the page"})],["missing"]:[]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),group],{}));
assert.ok(pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready")),"tests/kernel/test_visual_reading.py:394 assert finish(kernel, job)[\"opening_ready\"]");
}
Object.defineProperty(test_grouped_review_still_names_every_required_numeric_field,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_grouped_review_still_names_every_required_numeric_field"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_grouped_review_still_names_every_required_numeric_field(await kernel(t,{}),temporary);});
export async function test_kernel_crash_reclaims_a_new_attempt_and_rejects_the_old_lease(kernel:any,tmp_path:any){
let mid:any,_:any,old:any,evidence:any,other:any,current:any,err:any;
const __unpack22094=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack22094[0];_=__unpack22094[1];
(await pyInvoke(request,[kernel,mid,"opening"],{}));
old=(await pyInvoke(claim,[kernel,mid],{}));
evidence=pyDivide((await pyInvoke(Path,[pyAt(old,"work_dir")],{})),"unfinished.txt");
(await pyMethod(evidence,"write_text",["retained source work"],{"encoding":"utf-8"}));
(await pyMethod(kernel.proc,"kill",[],{}));
await waitForProcess(kernel.proc,5);
other=(new RpcClient(kernel.workspace));
try{current=(await pyInvoke(claim,[other,mid],{}));
assert.ok(pyBool(pyEqual(pyAt(current,"job_id"),pyAt(old,"job_id"))),"tests/kernel/test_visual_reading.py:409 assert current[\"job_id\"] == old[\"job_id\"]");
assert.ok(pyBool(!pyEqual(pyAt(current,"lease"),pyAt(old,"lease"))),"tests/kernel/test_visual_reading.py:410 assert current[\"lease\"] != old[\"lease\"]");
assert.ok(pyBool(!pyEqual(pyAt(current,"work_dir"),pyAt(old,"work_dir"))),"tests/kernel/test_visual_reading.py:411 assert current[\"work_dir\"] != old[\"work_dir\"]");
assert.ok(pyBool(pyEqual((await pyMethod(evidence,"read_text",[],{"encoding":"utf-8"})),"retained source work")),"tests/kernel/test_visual_reading.py:412 assert evidence.read_text(encoding=\"utf-8\") == \"retained source work\"");
err=(await pyMethod(other,"err",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(old,"job_id"),["lease"]:pyAt(old,"lease"),["outcome"]:"cancelled"})],{}));
assert.ok(pyBool(pyContains(pyAt(err,"message"),"no longer owns")),"tests/kernel/test_visual_reading.py:414 assert \"no longer owns\" in err[\"message\"]");
(await pyInvoke(finish,[other,current],{"outcome":"cancelled"}));}finally{(await pyMethod(other,"close",[],{}));}
}
Object.defineProperty(test_kernel_crash_reclaims_a_new_attempt_and_rejects_the_old_lease,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_kernel_crash_reclaims_a_new_attempt_and_rejects_the_old_lease"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_kernel_crash_reclaims_a_new_attempt_and_rejects_the_old_lease(await kernel(t,{}),temporary);});
export async function test_replaying_a_completed_job_does_not_release_another_active_job(kernel:any,tmp_path:any){
let mid:any,_:any,earlier:any,active:any,result:any,other:any;
const __unpack23146=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack23146[0];_=__unpack23146[1];
earlier=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid),"deepen-queue.json")),"read_text",[],{}))],{})),0);
(await pyInvoke(request,[kernel,mid,"opening"],{}));
active=(await pyInvoke(claim,[kernel,mid],{}));
result=(await pyMethod(kernel,"ok",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(earlier,"job_id"),["lease"]:pyAt(earlier,"lease"),["outcome"]:"completed"})],{}));
assert.ok(pyBool(pyAt(result,"replayed")),"tests/kernel/test_visual_reading.py:426 assert result[\"replayed\"]");
other=(new RpcClient(kernel.workspace));
try{assert.ok(pyBool(pyEqual((await pyInvoke(claim,[other,mid],{})),({["job_id"]:null}))),"tests/kernel/test_visual_reading.py:429 assert claim(other, mid) == {\"job_id\": None}");}finally{(await pyMethod(other,"close",[],{}));}
(await pyInvoke(finish,[kernel,active],{"outcome":"cancelled"}));
}
Object.defineProperty(test_replaying_a_completed_job_does_not_release_another_active_job,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_replaying_a_completed_job_does_not_release_another_active_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_replaying_a_completed_job_does_not_release_another_active_job(await kernel(t,{}),temporary);});
export async function test_an_authored_ending_relation_is_not_a_movement_exit(tmp_path:any){
let path:any,graph:any;
path=pyDivide(tmp_path,"graph.json");
(await pyInvoke(write,[path,({["nodes"]:[({["node_id"]:"module-book",["node_kind"]:"module",["name"]:"Book",["properties"]:({})}),({["node_id"]:"scene-harbor",["node_kind"]:"scene",["name"]:"Harbor",["properties"]:({})}),({["node_id"]:"ending-homecoming",["node_kind"]:"ending",["name"]:"Homecoming",["summary"]:"Once the investigation is resolved.",["properties"]:({})})],["relations"]:[({["relation_id"]:"rel-close",["relation_kind"]:"may-lead-to",["from_node_id"]:"scene-harbor",["to_node_id"]:"ending-homecoming",["properties"]:({})})]})],{}));
graph=(await pyInvoke(ModuleGraph,["book",path],{}));
assert.ok(pyBool(pyEqual((await pyMethod(graph,"scene_exits",[(await pyMethod(graph,"scene",["harbor"],{}))],{})),[])),"tests/kernel/test_visual_reading.py:443 assert graph.scene_exits(graph.scene(\"harbor\")) == []");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(graph,"scene_endings",[(await pyMethod(graph,"scene",["harbor"],{}))],{})),0),"name"),"Homecoming")),"tests/kernel/test_visual_reading.py:444 assert graph.scene_endings(graph.scene(\"harbor\"))[0][\"name\"] == \"Homecoming\"");
}
Object.defineProperty(test_an_authored_ending_relation_is_not_a_movement_exit,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_authored_ending_relation_is_not_a_movement_exit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_authored_ending_relation_is_not_a_movement_exit(temporary);});
export async function test_attaching_original_source_keeps_legacy_material_usable(kernel:any,tmp_path:any){
let mid:any,source:any,job:any,_:any,store:any,directory:any,meta:any,name:any,key:any;
const __unpack24635=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack24635[0];source=__unpack24635[1];
const __unpack24679=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack24679[0];_=__unpack24679[1];_=__unpack24679[2];
(await pyInvoke(finish,[kernel,job],{}));
store=(await pyInvoke(ModuleStore,[kernel.workspace],{}));
directory=(await pyMethod(store,"module_dir",[mid],{}));
meta=(await pyMethod(store,"module",[mid],{}));
for(name of pyIterable(["module-graph.json","module-graph-manifest.json"])){
(await pyMethod(shutil,"copyfile",[pyDivide((await pyMethod(store,"graph_path",[mid],{})).parent,name),pyDivide(directory,name)],{}));
}
for(key of pyIterable(["graph_file","reading_version","reading","source_document"])){
(await pyMethod(meta,"pop",[key,null],{}));
}
(await pyInvoke(write,[pyDivide(directory,"module.json"),meta],{}));
(await pyMethod(kernel,"ok",["module.source.bind",({["source"]:source})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena"})),"state"),"ready")),"tests/kernel/test_visual_reading.py:460 assert request(kernel, mid, \"detail\", focus=\"Lena\")[\"state\"] == \"ready\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What does she know?"})),"state"),"queued")),"tests/kernel/test_visual_reading.py:461 assert request(kernel, mid, \"detail\", focus=\"Lena\", question=\"What does she know?\")[\"state\"] == \"queued\"");
}
Object.defineProperty(test_attaching_original_source_keeps_legacy_material_usable,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_attaching_original_source_keeps_legacy_material_usable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_attaching_original_source_keeps_legacy_material_usable(await kernel(t,{}),temporary);});
export async function test_rebinding_identical_source_repairs_a_missing_original(kernel:any,tmp_path:any){
let mid:any,source:any,original:any;
const __unpack25473=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack25473[0];source=__unpack25473[1];
original=pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid),"source.pdf");
(await pyMethod(original,"rename",[(await pyMethod(original,"with_suffix",[".retained"],{}))],{}));
(await pyMethod(kernel,"ok",["module.source.bind",({["source"]:source})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(original,"read_bytes",[],{})),(await pyMethod((await pyInvoke(Path,[pyAt(source,"path")],{})),"read_bytes",[],{})))),"tests/kernel/test_visual_reading.py:469 assert original.read_bytes() == Path(source[\"path\"]).read_bytes()");
}
Object.defineProperty(test_rebinding_identical_source_repairs_a_missing_original,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rebinding_identical_source_repairs_a_missing_original"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_rebinding_identical_source_repairs_a_missing_original(await kernel(t,{}),temporary);});
export async function test_rebinding_the_matching_original_preserves_corrupted_bytes_and_the_published_graph(kernel:any,tmp_path:any){
let mid:any,source:any,job:any,_:any,directory:any,original:any,copies:any,status:any;
const __unpack25881=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack25881[0];source=__unpack25881[1];
const __unpack25925=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack25925[0];_=__unpack25925[1];_=__unpack25925[2];
(await pyInvoke(finish,[kernel,job],{}));
directory=pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),mid);
original=pyDivide(directory,"source.pdf");
(await pyMethod(original,"write_bytes",[Buffer.from("corrupted source retained for diagnosis","latin1")],{}));
(await pyMethod(kernel,"ok",["module.source.bind",({["source"]:source})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(original,"read_bytes",[],{})),(await pyMethod((await pyInvoke(Path,[pyAt(source,"path")],{})),"read_bytes",[],{})))),"tests/kernel/test_visual_reading.py:480 assert original.read_bytes() == Path(source[\"path\"]).read_bytes()");
copies=(await pyInvoke(pyList,[(await pyMethod(directory,"glob",["source-corrupt-*.pdf"],{}))],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[copies],{})),1);return pyBool(__left)?pyEqual((await pyMethod(pyAt(copies,0),"read_bytes",[],{})),Buffer.from("corrupted source retained for diagnosis","latin1")):__left;})())),"tests/kernel/test_visual_reading.py:482 assert len(copies) == 1 and copies[0].read_bytes() == b\"corrupted source retained for diagnosis\"");
status=(await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(status,"generation"),1);return pyBool(__left)?(pyAt(status,"opening_ready")===true):__left;})())),"tests/kernel/test_visual_reading.py:484 assert status[\"generation\"] == 1 and status[\"opening_ready\"] is True");
}
Object.defineProperty(test_rebinding_the_matching_original_preserves_corrupted_bytes_and_the_published_graph,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rebinding_the_matching_original_preserves_corrupted_bytes_and_the_published_graph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_rebinding_the_matching_original_preserves_corrupted_bytes_and_the_published_graph(await kernel(t,{}),temporary);});
export async function test_ready_npc_question_publishes_new_fields_without_recopying_the_dossier(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,known:any,refs:any,draft:any,graph:any,node:any;
const __unpack26673=(await pyInvoke(indexed,[kernel,tmp_path],{}));mid=__unpack26673[0];_=__unpack26673[1];
const __unpack26712=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack26712[0];_=__unpack26712[1];_=__unpack26712[2];
(await pyInvoke(finish,[kernel,job],{}));
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What does she remember about the tower?"}));
job=(await pyInvoke(claim,[kernel,mid],{}));
known=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(job,"known_nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"npc-lena"))){__rows.push(n);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(known,"source_refs"),[({["page"]:1})])),"tests/kernel/test_visual_reading.py:494 assert known['source_refs'] == [{'page': 1}]");
refs=[({["page"]:2})];
draft=({["nodes"]:[({["node_id"]:"npc-lena",["node_kind"]:"npc",["name"]:"Lena",["properties"]:({["knowledge"]:["She remembers the tower keeper."]}),["source_refs"]:refs})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["npc-lena"]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:refs,["reason"]:"New fact fixture."})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[2],"review_pages":[2]}));
(await pyInvoke(finish,[kernel,job],{}));
graph=(await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_graph",[mid],{}));
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"npc-lena"))){__rows.push(n);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(node,"properties"),"mechanics"),"profile"),"characteristics"),"STR"),50)),"tests/kernel/test_visual_reading.py:506 assert node['properties']['mechanics']['profile']['characteristics']['STR'] == 50");
assert.ok(pyBool(pyEqual(pyAt(pyAt(node,"properties"),"knowledge"),["She remembers the tower keeper."])),"tests/kernel/test_visual_reading.py:507 assert node['properties']['knowledge'] == ['She remembers the tower keeper.']");
}
Object.defineProperty(test_ready_npc_question_publishes_new_fields_without_recopying_the_dossier,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ready_npc_question_publishes_new_fields_without_recopying_the_dossier"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ready_npc_question_publishes_new_fields_without_recopying_the_dossier(await kernel(t,{}),temporary);});
export async function test_reviewed_skeleton_exposes_choices_without_authorizing_play(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,refs:any,draft:any,status:any,chosen:any,opening_job:any;
const __unpack28075=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack28075[0];_=__unpack28075[1];
(await pyInvoke(request,[kernel,mid,"skeleton"],{"foreground":true}));
job=(await pyInvoke(claim,[kernel,mid],{}));
refs=[({["page"]:1})];
draft=({["nodes"]:[({["node_id"]:`module-${mid}`,["node_kind"]:"module",["name"]:"Two entrances",["source_refs"]:refs,["properties"]:({["entry_scene_ids"]:["scene-first","scene-second"]})}),({["node_id"]:"scene-first",["node_kind"]:"scene",["name"]:"First",["source_refs"]:refs,["properties"]:({["is_entrance"]:true})}),({["node_id"]:"scene-second",["node_kind"]:"scene",["name"]:"Second",["source_refs"]:refs,["properties"]:({["is_entrance"]:true})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:["/nodes/0","/nodes/1","/nodes/2"],["ready_nodes"]:[]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:pyAt(draft,"critical"),["verdict"]:"supported",["source_refs"]:refs,["reason"]:"Structure fixture."})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"review_pages":[1]}));
assert.ok(pyBool(!pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready"))),"tests/kernel/test_visual_reading.py:528 assert not finish(kernel, job)['opening_ready']");
status=(await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[pyAt(status,"opening_candidates")],{})),2);return pyBool(__left)?!pyBool(pyAt(status,"opening_ready")):__left;})())),"tests/kernel/test_visual_reading.py:530 assert len(status['opening_candidates']) == 2 and not status['opening_ready']");
chosen=(await pyMethod(kernel,"ok",["module.opening.choose",({["module_id"]:mid,["scene"]:"First"})],{}));
assert.ok(pyBool(!pyBool(pyAt(chosen,"opening_ready"))),"tests/kernel/test_visual_reading.py:532 assert not chosen['opening_ready']");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt((await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_graph",[mid],{})),"nodes")],{})),3)),"tests/kernel/test_visual_reading.py:533 assert len(ModuleStore(kernel.workspace).read_graph(mid)['nodes']) == 3");
(await pyInvoke(request,[kernel,mid,"opening"],{"foreground":true}));
opening_job=(await pyInvoke(claim,[kernel,mid],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(opening_job,"purpose"),"opening");return pyBool(__left)?pyEqual(pyAt(opening_job,"focus"),"scene-first"):__left;})())),"tests/kernel/test_visual_reading.py:536 assert opening_job['purpose'] == 'opening' and opening_job['focus'] == 'scene-first'");
}
Object.defineProperty(test_reviewed_skeleton_exposes_choices_without_authorizing_play,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reviewed_skeleton_exposes_choices_without_authorizing_play"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reviewed_skeleton_exposes_choices_without_authorizing_play(await kernel(t,{}),temporary);});
export async function test_skeleton_cannot_publish_material_readiness(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,refs:any,draft:any,error:any,store:any;
const __unpack29812=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack29812[0];_=__unpack29812[1];
(await pyInvoke(request,[kernel,mid,"skeleton"],{"foreground":true}));
job=(await pyInvoke(claim,[kernel,mid],{}));
refs=[({["page"]:1})];
draft=({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["properties"]:({["is_entrance"]:true}),["source_refs"]:refs})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:["/nodes/0"],["ready_nodes"]:["scene-dock"]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["path"]:"/nodes/0",["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"review_pages":[1]}));
error=(await pyMethod(kernel,"err",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{})),["review_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json")],{}))})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"path"),"/ready_nodes"):__left;})())),"tests/kernel/test_visual_reading.py:556 assert error['code'] == 'invalid_params' and error['details']['path'] == '/ready_nodes'");
store=(await pyInvoke(ModuleStore,[kernel.workspace],{}));
assert.ok(pyBool((await (async()=>{const __left=((await pyMethod(store,"read_graph",[mid],{}))===null);return pyBool(__left)?pyEqual(pyAt(pyAt((await pyMethod(store,"module",[mid],{})),"reading"),"materials"),[]):__left;})())),"tests/kernel/test_visual_reading.py:558 assert store.read_graph(mid) is None and store.module(mid)['reading']['materials'] == []");
draft["ready_nodes"]=[];
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
assert.ok(pyBool(!pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready"))),"tests/kernel/test_visual_reading.py:561 assert not finish(kernel, job)['opening_ready']");
assert.ok(pyBool(!pyBool((await pyMethod((await pyInvoke(Reading,[store],{})),"material_ready",[mid,"Dock"],{})))),"tests/kernel/test_visual_reading.py:562 assert not Reading(store).material_ready(mid, 'Dock')");
}
Object.defineProperty(test_skeleton_cannot_publish_material_readiness,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_skeleton_cannot_publish_material_readiness"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_skeleton_cannot_publish_material_readiness(await kernel(t,{}),temporary);});
export async function test_empty_skeleton_cannot_publish_a_generated_module_as_authored_structure(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,error:any,store:any;
const __unpack31312=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack31312[0];_=__unpack31312[1];
(await pyInvoke(request,[kernel,mid,"skeleton"],{"foreground":true}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:[]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"review_pages":[]}));
error=(await pyMethod(kernel,"err",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{})),["review_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json")],{}))})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"path"),"/nodes"):__left;})())),"tests/kernel/test_visual_reading.py:577 assert error['code'] == 'invalid_params' and error['details']['path'] == '/nodes'");
store=(await pyInvoke(ModuleStore,[kernel.workspace],{}));
assert.ok(pyBool(((await pyMethod(store,"read_graph",[mid],{}))===null)),"tests/kernel/test_visual_reading.py:579 assert store.read_graph(mid) is None");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await pyMethod(store,"module",[mid],{})),"generation"),0);return pyBool(__left)?pyEqual(pyAt(pyAt((await pyMethod(store,"module",[mid],{})),"reading"),"materials"),[]):__left;})())),"tests/kernel/test_visual_reading.py:580 assert store.module(mid)['generation'] == 0 and store.module(mid)['reading']['materials'] == []");
}
Object.defineProperty(test_empty_skeleton_cannot_publish_a_generated_module_as_authored_structure,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_empty_skeleton_cannot_publish_a_generated_module_as_authored_structure"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_empty_skeleton_cannot_publish_a_generated_module_as_authored_structure(await kernel(t,{}),temporary);});
export async function test_unrelated_detail_cannot_unlock_an_unprepared_skeleton_opening(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,refs:any,draft:any,delta:any,status:any;
const __unpack32374=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack32374[0];_=__unpack32374[1];
(await pyInvoke(request,[kernel,mid,"skeleton"],{"foreground":true}));
job=(await pyInvoke(claim,[kernel,mid],{}));
refs=[({["page"]:1})];
draft=({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["properties"]:({["is_entrance"]:true}),["source_refs"]:refs}),({["node_id"]:"scene-tower",["node_kind"]:"scene",["name"]:"Tower",["properties"]:({["is_final"]:true}),["source_refs"]:refs})],["claims"]:[({["subject_id"]:"scene-dock",["predicate"]:"route-to",["object"]:({["node_id"]:"scene-tower"}),["truth_status"]:"authored-fact",["source_refs"]:refs})],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:["/nodes/0"],["ready_nodes"]:[]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/claims/0"],["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"review_pages":[1]}));
assert.ok(pyBool(!pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready"))),"tests/kernel/test_visual_reading.py:601 assert not finish(kernel, job)['opening_ready']");
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"Who is this historian?"}));
job=(await pyInvoke(claim,[kernel,mid],{}));
delta=({...draft,["nodes"]:[({["node_id"]:"npc-lena",["node_kind"]:"npc",["name"]:"Lena",["properties"]:({["biography"]:"A historian from the town."}),["source_refs"]:refs})],["ready_nodes"]:["npc-lena"]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),delta],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/claims/0","/coverage"],["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"review_pages":[1]}));
assert.ok(pyBool(!pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready"))),"tests/kernel/test_visual_reading.py:612 assert not finish(kernel, job)['opening_ready']");
status=(await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{}));
assert.ok(pyBool(!pyBool(pyAt(status,"opening_ready"))),"tests/kernel/test_visual_reading.py:614 assert not status['opening_ready']");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(request,[kernel,mid,"opening"],{"foreground":true})),"state"),"queued")),"tests/kernel/test_visual_reading.py:615 assert request(kernel, mid, 'opening', foreground=True)['state'] == 'queued'");
job=(await pyInvoke(claim,[kernel,mid],{}));
draft["ready_nodes"]=["scene-dock"];
pyAt(pyAt(draft,"nodes"),0)["summary"]="The harbor keeper welcomes the investigators at the dock.";
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/claims/0","/coverage"],["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"review_pages":[1]}));
assert.ok(pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready")),"tests/kernel/test_visual_reading.py:624 assert finish(kernel, job)['opening_ready']");
}
Object.defineProperty(test_unrelated_detail_cannot_unlock_an_unprepared_skeleton_opening,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unrelated_detail_cannot_unlock_an_unprepared_skeleton_opening"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unrelated_detail_cannot_unlock_an_unprepared_skeleton_opening(await kernel(t,{}),temporary);});
export async function test_later_npc_reading_adds_textual_dossier_facts_without_replacing_old_ones(kernel:any,tmp_path:any,field:any,initial:any,addition:any){
let mid:any,_:any,job:any,draft:any,refs:any,delta:any,node:any,before:any,added:any,graph:any,mapping:any;
const __unpack35300=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack35300[0];_=__unpack35300[1];
const __unpack35336=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack35336[0];draft=__unpack35336[1];_=__unpack35336[2];
pyAt(pyAt(pyAt(draft,"nodes"),2),"properties")[field]=initial;
pyAt(pyAt(pyAt(draft,"nodes"),2),"properties")["agenda"]="Recover the ledger.";
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(finish,[kernel,job],{}));
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":`What else belongs in her ${field}?`}));
job=(await pyInvoke(claim,[kernel,mid],{}));
refs=[({["page"]:2})];
delta=({["nodes"]:[({["node_id"]:"npc-lena",["node_kind"]:"npc",["name"]:"Lena",["properties"]:({[field]:addition}),["source_refs"]:refs})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["npc-lena"]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),delta],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[2],"review_pages":[2]}));
(await pyInvoke(finish,[kernel,job],{}));
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt((await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_graph",[mid],{})),"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"npc-lena"))){__rows.push(n);}}return __rows;})())));
before=(pyBool((await pyInvoke(pyIsInstance,[initial,pyStr],{})))?[initial]:initial);
added=(pyBool((await pyInvoke(pyIsInstance,[addition,pyStr],{})))?[addition]:addition);
assert.ok(pyBool(pyEqual(pyAt(pyAt(node,"properties"),field),(await pyInvoke(pyList,[(await pyMethod(pyDict,"fromkeys",[pyAdd(before,added)],{}))],{})))),"tests/kernel/test_visual_reading.py:655 assert node['properties'][field] == list(dict.fromkeys(before + added))");
assert.ok(pyBool(pyEqual(pyAt(pyAt(node,"properties"),"agenda"),"Recover the ledger.")),"tests/kernel/test_visual_reading.py:656 assert node['properties']['agenda'] == 'Recover the ledger.'");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(node,"properties"),"mechanics"),"profile"),"characteristics"),"STR"),50)),"tests/kernel/test_visual_reading.py:657 assert node['properties']['mechanics']['profile']['characteristics']['STR'] == 50");
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"Does she now want to destroy the ledger?"}));
job=(await pyInvoke(claim,[kernel,mid],{}));
pyAt(pyAt(delta,"nodes"),0)["properties"]=({["agenda"]:"Destroy the ledger."});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),delta],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[2],"review_pages":[2]}));
(await pyInvoke(finish,[kernel,job],{}));
graph=(await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_graph",[mid],{}));
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"npc-lena"))){__rows.push(n);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(node,"properties"),"agenda"),"Recover the ledger.")),"tests/kernel/test_visual_reading.py:669 assert node['properties']['agenda'] == 'Recover the ledger.'");
mapping=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(graph,"source_mappings"))){if(pyBool((await pyMethod(pyAt(row,"path"),"endswith",["/properties/agenda"],{})))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(mapping,"established_value"),"Recover the ledger.")),"tests/kernel/test_visual_reading.py:671 assert mapping['established_value'] == 'Recover the ledger.'");
assert.ok(pyBool(pyEqual(pyAt(mapping,"source_value"),"Destroy the ledger.")),"tests/kernel/test_visual_reading.py:672 assert mapping['source_value'] == 'Destroy the ledger.'");
}
Object.defineProperty(test_later_npc_reading_adds_textual_dossier_facts_without_replacing_old_ones,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false},{"name":"field","rest":false,"varargs":false},{"name":"initial","rest":false,"varargs":false},{"name":"addition","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("field,initial,addition",[["knowledge","She knows the harbor keeper.",["She knows the harbor keeper.","She knows the tower route."]],["beliefs",["She believes the harbor is safe."],"She believes the tower is abandoned."],["lies",["She says she has never visited the tower."],["She says she owns no boat."]]]))).entries())test("test_later_npc_reading_adds_textual_dossier_facts_without_replacing_old_ones"+((pyCartesian([{}],pyParametrize("field,initial,addition",[["knowledge","She knows the harbor keeper.",["She knows the harbor keeper.","She knows the tower route."]],["beliefs",["She believes the harbor is safe."],"She believes the tower is abandoned."],["lies",["She says she has never visited the tower."],["She says she owns no boat."]]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_later_npc_reading_adds_textual_dossier_facts_without_replacing_old_ones(await kernel(t,{}),temporary,row["field"],row["initial"],row["addition"]);});
export async function test_an_index_refusal_names_the_sections_without_a_reference_and_the_repair_lands(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,draft:any,error:any,section:any;

const __unpack37920=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack37920[0];_=__unpack37920[1];
(await pyInvoke(request,[kernel,mid,"index"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{"full_pages":[1]}));
draft=({["title"]:"Book",["language"]:"en",["sections"]:[({["name"]:"Contents",["pages"]:[[1,1]]}),({["name"]:"The town",["pages"]:[[2,2]]}),({["name"]:"The mine",["pages"]:[[1,2]]})]});
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
error=(await pyMethod(kernel,"err",["module.read.finish",({["module_id"]:mid,["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json")],{}))})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"sections"),["The town","The mine"])),"tests/kernel/test_visual_reading.py:688 assert error[\"details\"][\"sections\"] == [\"The town\", \"The mine\"]");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyContains(pyAt(error,"fix"),"source_refs");return pyBool(__left)?pyContains(pyAt(error,"fix"),"The town"):__left;})());return pyBool(__left)?!pyContains(pyAt(pyAt(error,"details"),"sections"),"Contents"):__left;})())),"tests/kernel/test_visual_reading.py:689 assert \"source_refs\" in error[\"fix\"] and \"The town\" in error[\"fix\"] and \"Contents\" not in error[\"details\"][\"sections\"]");
for(section of pyIterable(pySlice(pyAt(draft,"sections"),1,undefined))){
section["source_refs"]=[({["page"]:1})];
}
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),draft],{}));
(await pyInvoke(finish,[kernel,job],{}));
assert.ok(pyBool(pyAt(pyAt((await pyMethod(kernel,"ok",["module.status",({["module_id"]:mid})],{})),"reading"),"index_complete")),"tests/kernel/test_visual_reading.py:694 assert kernel.ok(\"module.status\", {\"module_id\": mid})[\"reading\"][\"index_complete\"]");
}
Object.defineProperty(test_an_index_refusal_names_the_sections_without_a_reference_and_the_repair_lands,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_index_refusal_names_the_sections_without_a_reference_and_the_repair_lands"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_index_refusal_names_the_sections_without_a_reference_and_the_repair_lands(await kernel(t,{}),temporary);});
export async function test_read_ahead_follows_authored_exits_not_index_page_order(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,refs:any,ahead:any;

const __unpack39158=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack39158[0];_=__unpack39158[1];
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["module.read.ahead",({["module_id"]:mid})],{})),"reason"),"index")),pyStr("no index: the index is what is asked for"));
(await pyInvoke(request,[kernel,mid,"index"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"full_pages":[1],"review_pages":[1]}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["title"]:"Book",["language"]:"en",["sections"]:[({["name"]:"The dock",["pages"]:[[1,1]]}),({["name"]:"The tower",["pages"]:[[2,2]],["source_refs"]:[({["page"]:1})]})]})],{}));
(await pyInvoke(finish,[kernel,job],{}));
(await pyInvoke(request,[kernel,mid,"opening"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
refs=[({["page"]:1})];
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["summary"]:"The harbor dock.",["source_refs"]:refs,["visibility"]:"player-safe",["properties"]:({["is_entrance"]:true,["is_final"]:true})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:["/nodes/0"],["ready_nodes"]:["scene-dock"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:refs})],["missing"]:[]})],{}));
(await pyInvoke(observed,[job],{"read_pages":[1],"full_pages":[1],"review_pages":[1]}));
assert.ok(pyBool(pyAt((await pyInvoke(finish,[kernel,job],{})),"opening_ready")),"tests/kernel/test_visual_reading.py:716 assert finish(kernel, job)[\"opening_ready\"]");
ahead=(await pyMethod(kernel,"ok",["module.read.ahead",({["module_id"]:mid})],{}));
assert.ok(pyBool(pyEqual(ahead,({["queued"]:[],["scene"]:"scene-dock",["window"]:({["mode"]:"whole",["first"]:1,["last"]:2,["chapters"]:["The dock","The tower"],["complete"]:false,["transcript"]:[[1,2]]})}))),"tests/kernel/test_visual_reading.py:720 assert ahead == {\"queued\": [], \"scene\": \"scene-dock\",\n                     \"window\": {\"mode\": \"whole\", \"first\": 1, \"last\": 2, \"chapters\": [\"The dock\", \"The tower\"], \"complete\": False,\n                                \"transcript\": [[1, 2]]}}");
}
Object.defineProperty(test_read_ahead_follows_authored_exits_not_index_page_order,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_read_ahead_follows_authored_exits_not_index_page_order"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_read_ahead_follows_authored_exits_not_index_page_order(await kernel(t,{}),temporary);});
