import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {checkReviewEvidence} from '../../extensions/module/reader-review.ts';

const ROOT=resolve(import.meta.dirname,'../..');

test('a misspelled review citation field asks for schema repair, not repeated page views',()=>{
 const review={checked:[{path:'/answer',verdict:'supported',original_source_refs:[{page:1}],reason:'Read already.'}],missing:[]};
 assert.throws(()=>checkReviewEvidence(review,['/answer'],new Set([1])),/exact field name.*schema error/);
});

test('an in-flight answer pins its first context and never silently queues another generation',async t=>{
 const calls=[],unwaited=[];
 const service=new ReadingService({home:ROOT,model:()=>({id:'fixture/vision',vision:true}),progress(){},record(){},async call(method,params){
  if(method==='module.read.request'){
   calls.push(params);
   if(calls.length===1)return{state:'queued',job_id:'read-a',generation:3};
   assert.equal(params.context_generation,3);
   throw new KernelError({code:'needs',message:'source context changed',details:{reason:'source_context_changed',read:{purpose:'answer',focus:'Menu',question:'Hours?'}}});
  }
  if(method==='module.read.claim')return{job_id:null};
  if(method==='module.read.unwait'){unwaited.push(params.job_id);return{foreground:false};}
  throw new Error(method);
 }});t.after(()=>service.close());
 await assert.rejects(service.ensure('book',{purpose:'answer',focus:'Menu',question:'Hours?',foreground:true}),error=>error.details?.reason==='source_context_changed');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);assert.deepEqual(unwaited,['read-a']);
 assert.equal(calls[0].context_generation,undefined);
});
test('an answer uses one scoped independent review and delivers immutable evidence to finish',async t=>{
 const home=await mkdtemp(join(tmpdir(),'coc-answer-service-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const cwd=join(home,'work','attempt-1'),cache=join(home,'.coc','modules','book','cache','pages');await mkdir(cwd,{recursive:true});
 const tasks=[],finished=[];
 const draft={status:'answered',answer:'The page lists food but no exact price.',source_refs:[{page:2}],limitations:'Only the source passage is established.'};
 const runtime={contentRoot:join(ROOT,'content'),async check(){return{ok:true,required_view_pages:[2]};},
  async runTask({request}){
   tasks.push(request);assert.equal(request.prompt.answer,true);assert.equal(request.submission,true);assert.equal(request.imageHistory,4);
   const call='view',page=2,path=join(cache,'page-2.png');
   if(request.prompt.phase==='read'){
    await writeFile(join(request.cwd,'draft.json'),JSON.stringify(draft)+'\n');
    await appendFile(join(cache,'requests.jsonl'),JSON.stringify({file_sha256:'source-sha',path,page,box:[0,0,1,1]})+'\n');
   }else{
    const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));
    assert.deepEqual(task.required_review,['/status','/answer','/source_refs','/limitations']);assert.deepEqual(task.review_scope_pages,[2]);
    await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:[{page}],reason:'The original page supports the answer and its limits.'}],missing:[]})+'\n');
   }
   request.onEvent({type:'tool_execution_end',toolCallId:call,isError:false,result:{content:[{type:'image'}],details:{kind:'source_pages',observations:[{path,page}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:[call]})+'\n');
   return{ok:true,code:0,timedOut:false,ms:2,stderr:'',command:[]};
  }};
 const service=new ReadingService({home,runtime,model:()=>({id:'fixture/vision',vision:true,thinking:'off'}),progress(){},record(){},async call(method,params){assert.equal(method,'module.read.finish');finished.push(params);return{state:'ready'};}});t.after(()=>service.close());
 await service.runJob({job_id:'read-1',module_id:'book',purpose:'answer',focus:'Menu',question:'What price is printed?',foreground:true,lease:'lease-1',work_dir:cwd,source:{path:join(home,'.coc','modules','book','source.pdf'),page_count:3,file_sha256:'source-sha'},index:[],known_nodes:[],known_claims:[],vocabulary:{},coverage_domains:[]},new AbortController().signal,'campaign-a');
 assert.equal(tasks.length,2);assert.deepEqual(tasks.map(t=>t.prompt.phase),['read','verify']);
 const review=JSON.parse(await readFile(join(cwd,'review.json'),'utf8'));
 assert.equal(review.draft_sha256,createHash('sha256').update(await readFile(join(cwd,'draft.json'))).digest('hex'));
 assert.equal(finished[0].outcome,'completed');assert.deepEqual(finished[0].assets,[]);
 const observed=JSON.parse(await readFile(join(cwd,'observations.json'),'utf8'));assert.deepEqual(observed.read_pages,[2]);assert.deepEqual(observed.review_pages,[2]);
});
