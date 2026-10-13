// Migrated from tests/kernel/test_parallel_indexing.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {Reading,ModuleStore} from "./world-production-support.ts";
import {observed,write,opening,finish,request,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_parallel_indexing.py',import.meta.url).pathname;






export async function book(kernel:any,tmp_path:any,pages:any=669){
let source:any;
source=pyDivide(tmp_path,"source.pdf");
(await pyMethod(source,"write_bytes",[Buffer.from("%PDF-unit-source","latin1")],{}));
return pyAt((await pyMethod(kernel,"ok",["module.source.bind",({["source"]:({["path"]:(await pyInvoke(pyStr,[source],{})),["file_sha256"]:(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(source,"read_bytes",[],{}))],{})),"hexdigest",[],{})),["page_count"]:pages})})],{})),"module_id");
}
Object.defineProperty(book,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false},{"name":"pages","rest":false,"varargs":false}]});
export async function test_cold_long_book_queues_opening_directly_and_new_questions_revisit_ready_entities(kernel:any,tmp_path:any){
let mid:any,job:any,draft:any,review:any,store:any,first:any,same:any,other:any,focused:any,automatic:any;
mid=(await pyInvoke(book,[kernel,tmp_path],{}));
const __unpack722=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack722[0];draft=__unpack722[1];review=__unpack722[2];
store=(await pyInvoke(ModuleStore,[kernel.workspace],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod(store,"read_queue",[mid],{}))],{})),2)),"tests/kernel/test_parallel_indexing.py:21 assert len(store.read_queue(mid)) == 2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(job,"pages"),[]);return pyBool(__left)?pyEqual(pyAt(job,"purpose"),"opening"):__left})())),"tests/kernel/test_parallel_indexing.py:22 assert job['pages'] == [] and job['purpose'] == 'opening'");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyMethod(store,"read_queue",[mid],{})))){__rows.push(pyAt(row,"purpose"));}return __rows;})()),["opening","index"])),"tests/kernel/test_parallel_indexing.py:23 assert [row['purpose'] for row in store.read_queue(mid)] == ['opening', 'index']");
assert.ok(pyBool(!pyBool(pyAt(pyAt((await pyMethod(store,"module",[mid],{})),"reading"),"index_complete"))),"tests/kernel/test_parallel_indexing.py:24 assert not store.module(mid)['reading']['index_complete']");
(await pyInvoke(finish,[kernel,job],{}));
first=(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What does she know about the tower?"}));
same=(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What does she know about the tower?"}));
other=(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Lena","question":"What is her biography?"}));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(first,"job_id");const __term1=pyAt(same,"job_id");const __term2=pyAt(other,"job_id");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"!=");})())),"tests/kernel/test_parallel_indexing.py:29 assert first['job_id'] == same['job_id'] != other['job_id']");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod(store,"read_queue",[mid],{}))],{})),4)),"tests/kernel/test_parallel_indexing.py:30 assert len(store.read_queue(mid)) == 4");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(store,"module",[mid],{})),"reading"),"viewed_pages"),[0,1])),"tests/kernel/test_parallel_indexing.py:31 assert store.module(mid)['reading']['viewed_pages'] == [0, 1]");
focused=(await pyMethod(kernel,"ok",["module.read.claim",({["module_id"]:mid})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(focused,"purpose"),"detail");return pyBool(__left)?pyEqual(pyAt(focused,"question"),"What does she know about the tower?"):__left})())),pyStr((await pyMethod(store,"read_queue",[mid],{}))));
automatic=(await pyMethod(kernel,"ok",["module.read.claim",({["module_id"]:mid})],{}));
assert.ok(pyBool(pyEqual(pyAt(automatic,"purpose"),"index")),"tests/kernel/test_parallel_indexing.py:35 assert automatic['purpose'] == 'index'");
}
Object.defineProperty(test_cold_long_book_queues_opening_directly_and_new_questions_revisit_ready_entities,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cold_long_book_queues_opening_directly_and_new_questions_revisit_ready_entities"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cold_long_book_queues_opening_directly_and_new_questions_revisit_ready_entities(await kernel(t,{}),temporary);});
export async function test_selective_navigation_is_one_owned_job_and_unread_ranges_remain_navigation(kernel:any,tmp_path:any){
let mid:any,first:any,other:any,abandoned:any,recovered:any,state:any;
mid=(await pyInvoke(book,[kernel,tmp_path],{}));
const __unpack2002=[(await pyInvoke(Reading,[(await pyInvoke(ModuleStore,[kernel.workspace],{}))],{})),(await pyInvoke(Reading,[(await pyInvoke(ModuleStore,[kernel.workspace],{}))],{}))];first=__unpack2002[0];other=__unpack2002[1];
try{(await pyMethod(first,"request",[({["module_id"]:mid,["purpose"]:"index"})],{}));
abandoned=(await pyMethod(first,"claim",[({["module_id"]:mid})],{}));
assert.ok(pyBool(pyEqual(pyAt(abandoned,"pages"),[])),"tests/kernel/test_parallel_indexing.py:44 assert abandoned['pages'] == []");
assert.ok(pyBool(pyEqual((await pyMethod(other,"claim",[({["module_id"]:mid})],{})),({["job_id"]:null}))),"tests/kernel/test_parallel_indexing.py:45 assert other.claim({'module_id': mid}) == {'job_id': None}");
(await pyMethod(first,"release",[mid],{}));
recovered=(await pyMethod(other,"claim",[({["module_id"]:mid})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(recovered,"job_id"),pyAt(abandoned,"job_id"));return pyBool(__left)?!pyEqual(pyAt(recovered,"lease"),pyAt(abandoned,"lease")):__left})())),"tests/kernel/test_parallel_indexing.py:48 assert recovered['job_id'] == abandoned['job_id'] and recovered['lease'] != abandoned['lease']");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(recovered,"attempts"),2);return pyBool(__left)?(await pyMethod((await pyInvoke(Path,[pyAt(abandoned,"work_dir")],{})),"exists",[],{})):__left})())),"tests/kernel/test_parallel_indexing.py:49 assert recovered['attempts'] == 2 and Path(abandoned['work_dir']).exists()");
(await pyInvoke(observed,[recovered],{"read_pages":[5],"full_pages":[5]}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(recovered,"work_dir")],{})),"draft.json"),({["sections"]:[({["name"]:"An authored chapter",["pages"]:[[50,93]],["source_refs"]:[({["page"]:5})]})]})],{}));
(await pyMethod(other,"finish",[({["module_id"]:mid,["job_id"]:pyAt(recovered,"job_id"),["lease"]:pyAt(recovered,"lease"),["outcome"]:"completed",["draft_path"]:(await pyInvoke(pyStr,[pyDivide((await pyInvoke(Path,[pyAt(recovered,"work_dir")],{})),"draft.json")],{}))})],{}));
state=pyAt((await pyMethod(other.store,"module",[mid],{})),"reading");
assert.ok(pyBool((await (async()=>{const __left=pyAt(state,"index_complete");return pyBool(__left)?pyEqual(pyAt(state,"viewed_pages"),[4]):__left})())),"tests/kernel/test_parallel_indexing.py:56 assert state['index_complete'] and state['viewed_pages'] == [4]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(other.store,"read_sections",[mid],{})),0),"pages"),[[49,92]])),"tests/kernel/test_parallel_indexing.py:57 assert other.store.read_sections(mid)[0]['pages'] == [[49, 92]]");}finally{(await pyMethod(first,"release",[mid],{}));
(await pyMethod(other,"release",[mid],{}));}
}
Object.defineProperty(test_selective_navigation_is_one_owned_job_and_unread_ranges_remain_navigation,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_selective_navigation_is_one_owned_job_and_unread_ranges_remain_navigation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_selective_navigation_is_one_owned_job_and_unread_ranges_remain_navigation(await kernel(t,{}),temporary);});
export async function test_foreground_question_claims_a_slot_while_background_reading_is_running(kernel:any,tmp_path:any){
 const mid=await book(kernel,tmp_path),first=Reading(await ModuleStore(kernel.workspace)),other=Reading(await ModuleStore(kernel.workspace));
 try{
  await first.request({module_id:mid,purpose:'detail',focus:'Museum'});const background=await first.claim({module_id:mid}),capacity=background.concurrency;
  assert.ok(Number.isInteger(capacity)&&capacity>=2);await first.request({module_id:mid,purpose:'detail',focus:'Hotel'});
  for(let occupied=1;occupied<capacity-1;occupied++){await first.request({module_id:mid,purpose:'detail',focus:'Background filler '+occupied});const filler=await first.claim({module_id:mid});assert.ok(filler.job_id);assert.equal(filler.foreground,false);}
  assert.deepEqual(await other.claim({module_id:mid}),{job_id:null});
  await other.request({module_id:mid,purpose:'detail',focus:'Dinner',question:'What evidence is shown?',foreground:true});const foreground=await other.claim({module_id:mid});
  assert.equal(foreground.focus,'Dinner');assert.equal(foreground.concurrency,capacity);assert.notEqual(background.job_id,foreground.job_id);assert.deepEqual(await first.claim({module_id:mid}),{job_id:null});
 }finally{await first.release(mid);await other.release(mid);}
}
Object.defineProperty(test_foreground_question_claims_a_slot_while_background_reading_is_running,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_foreground_question_claims_a_slot_while_background_reading_is_running"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_foreground_question_claims_a_slot_while_background_reading_is_running(await kernel(t,{}),temporary);});
export async function test_empty_detail_requests_never_dispatch_an_unbounded_reader(kernel:any,tmp_path:any){
let mid:any,error:any;
mid=(await pyInvoke(book,[kernel,tmp_path],{}));
error=(await pyMethod(kernel,"err",["module.read.request",({["module_id"]:mid,["purpose"]:"detail"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_parallel_indexing.py:84 assert error['code'] == 'invalid_params'");
assert.ok(pyBool(pyEqual((await pyMethod((await pyInvoke(ModuleStore,[kernel.workspace],{})),"read_queue",[mid],{})),[])),"tests/kernel/test_parallel_indexing.py:85 assert ModuleStore(kernel.workspace).read_queue(mid) == []");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["module.read.request",({["module_id"]:mid,["purpose"]:"detail",["question"]:"What is the route?"})],{})),"code"),"invalid_params")),"tests/kernel/test_parallel_indexing.py:86 assert kernel.err('module.read.request', {'module_id': mid, 'purpose': 'detail', 'question': 'What is the route?'})['code'] == 'invalid_params'");
}
Object.defineProperty(test_empty_detail_requests_never_dispatch_an_unbounded_reader,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_empty_detail_requests_never_dispatch_an_unbounded_reader"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_empty_detail_requests_never_dispatch_an_unbounded_reader(await kernel(t,{}),temporary);});
export async function test_same_focus_waits_for_background_publication_instead_of_racing_its_dossier(kernel:any,tmp_path:any){
 const mid=await book(kernel,tmp_path),first=Reading(await ModuleStore(kernel.workspace)),other=Reading(await ModuleStore(kernel.workspace));
 try{
  await first.request({module_id:mid,purpose:'detail',focus:'Meeting Nayra'});const background=await first.claim({module_id:mid});
  const originalRequest={module_id:mid,purpose:'detail',focus:'meeting nayra',question:'Who introduces the investigators?',foreground:true},attached=await other.request(originalRequest);assert.equal(attached.attached,true);assert.equal(attached.job_id,background.job_id);const unrelated=await other.claim({module_id:mid});
  if(unrelated.job_id!==null){assert.notEqual(unrelated.job_id,background.job_id);assert.ok(unrelated.purpose!=='detail'||unrelated.focus.toLowerCase()!=='meeting nayra');}
  await first.finish({module_id:mid,job_id:background.job_id,lease:background.lease,outcome:'cancelled'});
  const queued=await other.request(originalRequest);assert.equal(queued.state,'queued');assert.notEqual(queued.job_id,background.job_id);assert.equal((await other.claim({module_id:mid})).question,'Who introduces the investigators?');
 }finally{await first.release(mid);await other.release(mid);}
}
Object.defineProperty(test_same_focus_waits_for_background_publication_instead_of_racing_its_dossier,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_same_focus_waits_for_background_publication_instead_of_racing_its_dossier"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_same_focus_waits_for_background_publication_instead_of_racing_its_dossier(await kernel(t,{}),temporary);});
