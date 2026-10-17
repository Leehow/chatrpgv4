import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const sha=value=>createHash('sha256').update(value).digest('hex');
const outcome={ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
async function fixture(t,failures){
 const home=await mkdtemp(join(tmpdir(),'guidance-recovery-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const calls=[],runs=[],rows=[],sourceSha='a'.repeat(64),text='A public harbor introduction.';
 const packet={protocol:'source-reference-v1',source_sha256:sourceSha,extraction_version:'fixture',purpose:'guidance',question:'Create a character',
  excerpts:[{id:'intro',page:1,start:0,end:text.length,text}],fields:Object.fromEntries(['era','place','premise','advice','warnings','opening'].map(key=>[key,['intro']])),
  entries:[{id:'scene-source-entry-1',name:'Harbor',page:1,excerpt_id:'intro'}],partial:true,visual_coverage:'unassessed',unavailable_pages:[]};
 const runtime={sourceReferences:true,async runTask({request}){
  runs.push(request);
  const failure=failures[runs.length-1];
  if(failure){
   if(failure==='visual')request.onEvent({type:'run_end',reason:'source_reference_requires_existing_visual_fallback'});
   else request.onEvent({type:'tool_execution_end',toolName:'submit_reference_guidance',isError:true,result:{details:{kind:'source_reference_unavailable',...failure}}});
   return {...outcome,ok:false,error:'Reference did not complete'};
  }
  const task=await readFile(join(request.cwd,'task.json'));
  const bytes=JSON.stringify(packet)+'\n';
  await writeFile(join(request.cwd,'source-reference.json'),bytes);
  await writeFile(join(request.cwd,'reference-guidance.txt'),text);
  await writeFile(join(request.cwd,'source-reference-complete.json'),JSON.stringify({protocol:'source-reference-v1',kind:'guidance',source_sha256:sourceSha,
   task_sha256:sha(task),packet_sha256:sha(bytes),text_sha256:sha(text)}));
  request.onEvent({type:'tool_execution_end',toolName:'submit_reference_guidance',isError:false,result:{details:{kind:'source_reference_ready'}}});
  return outcome;
 }};
 const service=new ReadingService({home,runtime,model:()=>({id:'fixture/model',vision:true}),record:row=>rows.push(row),progress(){},async call(method){
  calls.push(method);
  if(method==='module.reference.status')return {};
  if(method==='module.source.snapshot')return {pdf:join(home,'.coc/modules/book/source.pdf'),page_count:1,file_sha256:sourceSha};
  if(method==='module.reference.publish')return {setup_ready:true,state:'ready'};
  if(method==='module.read.request')throw new Error('Unexpected graph fallback');
  if(method==='module.read.claim')return {job_id:null};
  throw new Error(method);
 }});
 t.after(()=>service.close());
 return {service,calls,runs,rows,prepare:(options={})=>service.prepare({module_id:'book',purpose:'guidance',guidance_key:'b'.repeat(64),play_language:'en'},undefined,options)};
}
test('a retryable reference failure retries directly without starting or waiting on a graph reader',async t=>{
 const f=await fixture(t,[{reason:'service_error',retryable:true}]);
 const providerBudget={};const result=await f.prepare({providerBudget});
 assert.equal(result.setup_ready,true);assert.equal(f.runs.length,2);
 assert.ok(f.runs.every(request=>request.providerBudget===providerBudget),'the retry retains the original provider owner');
 assert.ok(!f.calls.includes('module.read.request'));
 assert.ok(f.rows.some(row=>row.event==='guidance_retry'&&row.reason==='service_error'));
});
test('a permanent check failure stays unready without graph fallback or another model attempt',async t=>{
 const f=await fixture(t,[{reason:'packing_limit',retryable:false}]);
 await assert.rejects(f.prepare(),error=>error.code==='preparation_failed'&&error.details?.reason==='packing_limit');
 assert.equal(f.runs.length,1);assert.ok(!f.calls.includes('module.read.request'));
});
test('two transient failures exhaust the one reference retry without entering the slow fallback',async t=>{
 const f=await fixture(t,Array.from({length:2},()=>({reason:'service_error',retryable:true})));
 await assert.rejects(f.prepare(),error=>error.code==='preparation_failed');
 assert.equal(f.runs.length,2);assert.ok(!f.calls.includes('module.read.request'));
});
test('only the explicit source-driver visual fallback starts the ordinary graph reader',async t=>{
 const f=await fixture(t,['visual']);
 await assert.rejects(f.prepare(),/Unexpected graph fallback/);
 assert.equal(f.runs.length,1);assert.ok(f.calls.includes('module.read.request'));
});
