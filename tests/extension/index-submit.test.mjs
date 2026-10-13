/** Index submission is a saved artifact; the existing native index publication owns acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {Agent} from './pi-agent-core.mjs';
import {playtestScratch} from './playtest-scratch.mjs';
import readerSubmit from '../../extensions/module/reader-submit.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {readerInstructionText} from '../../runtime/reader-instructions.ts';
import {nativeSourceReaderEnabled} from '../../extensions/module/reader.ts';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
const draft={title:'Navigation fixture',language:'en',sections:[{name:'Opening',pages:[[1,1]],source_refs:[{page:1}],topics:['First contact']}],map_candidates:[]};
const save=(file,value)=>writeFile(file,JSON.stringify(value)+'\n');
let api;
async function nativeApi(dir){
 if(!api){const file=join(dir,'native.mjs');await build({stdin:{contents:[
  "export {createKernelContext} from './kernel-ts/context.ts';",
  "export {createKernelRuntime} from './kernel-ts/registry.ts';",
  "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"
 ].join('\n'),resolveDir:ROOT},outfile:file,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});api=await import(pathToFileURL(file).href);}
 return api;
}

test('Pi index submission saves its navigation draft and leaves source acceptance to the native index consumer',async t=>{
 const home=await mkdtemp(join(playtestScratch('index-submit'),'case-')),cwd=process.cwd();
 t.after(async()=>{process.chdir(cwd);await rm(home,{recursive:true,force:true});});
 const native=await nativeApi(home),context=await native.createKernelContext({workspace:home,content:CONTENT,seed:'index-submit',locks:native.nativeAdvisoryLocks()});
 const kernel=native.createKernelRuntime(context);t.after(()=>kernel.close());
 const call=(method,params={})=>kernel.handlers[method](params);
 const pdf=join(home,'original.pdf'),bytes=Buffer.from('%PDF-1.7\nIndex fixture\n%%EOF\n');await writeFile(pdf,bytes);
 const sha=createHash('sha256').update(bytes).digest('hex');
 const bound=await call('module.source.bind',{source:{path:pdf,page_count:1,file_sha256:sha}}),mid=bound.module_id;
 await call('module.read.request',{module_id:mid,purpose:'index'});
 const job=await call('module.read.claim',{module_id:mid,owner:'index-test'});
 await save(join(job.work_dir,'task.json'),{purpose:'index',module_id:mid,source:{page_count:1},required_review:['/not-an-index-review']});
 process.chdir(job.work_dir);let tool,checks=0;
 await readerSubmit({on(){},registerTool(value){tool=value},async exec(){checks++;throw Error('The graph checker must not consume an index');}});
 let requests=0;const model={id:'fixture',provider:'fixture',api:'openai-completions'};
 const agent=new Agent({initialState:{model,tools:[tool]},streamFn(){requests++;const stream=createAssistantMessageEventStream();
  const message={role:'assistant',provider:'fixture',model:'fixture',api:'openai-completions',timestamp:Date.now(),stopReason:'toolUse',
   usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
   content:[{type:'toolCall',id:'save-index',name:'submit_reading',arguments:{draft}}]};
  queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end();});return stream;}});
 await agent.prompt('Save this index navigation artifact.');
 assert.equal(requests,1,'the successful private submission terminates the actual Pi tool loop');
 assert.equal(checks,0,'an index never goes through the graph draft checker');
 assert.deepEqual(JSON.parse(await readFile(join(job.work_dir,'draft.json'),'utf8')),draft,'the navigation fields survive without graph normalization');
 await assert.rejects(readFile(join(job.work_dir,'review.json')),{code:'ENOENT'},'an index completeness pass does not submit a semantic review');
 const result=agent.state.messages.find(message=>message.role==='toolResult');
 assert.match(result.content[0].text,/saved/i);assert.doesNotMatch(result.content[0].text,/checked|accepted/i);
 await save(join(job.work_dir,'observations.json'),{file_sha256:sha,read_pages:[1],full_pages:[],review_pages:[]});
 const publish={module_id:mid,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json')};
 await assert.rejects(call('module.read.finish',publish),/index pages were not viewed/,'the original publication owner still requires full-page evidence');
 await save(join(job.work_dir,'observations.json'),{file_sha256:sha,read_pages:[1],full_pages:[1],review_pages:[]});
 const accepted=await call('module.read.finish',publish);assert.equal(accepted.state,'preparing');
 const meta=JSON.parse(await readFile(join(home,'.coc/modules',mid,'module.json'),'utf8'));
 assert.equal(meta.reading.index_complete,true);
 const index=JSON.parse(await readFile(join(home,'.coc/modules',mid,meta.index_file),'utf8'));
 assert.equal(index[0].name,'Opening');assert.deepEqual(index[0].pages,[[0,0]]);
});

test('index authors and completeness passes mount the same draft submission without switching source drivers',async t=>{
 const home=await mkdtemp(join(playtestScratch('index-submit'),'mount-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const work=join(home,'.coc/modules/book/work/read-1/attempt-1'),cache=join(home,'.coc/modules/book/cache/pages');
 await mkdir(work,{recursive:true});await mkdir(cache,{recursive:true});
 const requests=[],finished=[];
 const runtime={contentRoot:CONTENT,async runTask({request}){
  requests.push(request);await save(join(work,'draft.json'),draft);
  const image=join(cache,'page-1.png'),call=`page-${requests.length}`;
  await appendFile(join(cache,'requests.jsonl'),JSON.stringify({file_sha256:'fixture-sha',path:image,page:1,box:[0,0,1,1]})+'\n');
  request.onEvent?.({type:'tool_execution_end',toolCallId:call,isError:false,result:{content:[{type:'image'}],details:{kind:'source_pages',observations:[{path:image,page:1,box:[0,0,1,1]}]}}});
  await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:[call]})+'\n');
  return {ok:true,code:0,ms:1,stderr:'',timedOut:false,command:[]};
 },async check(){throw Error('The graph checker must not consume an index');}};
 const service=new ReadingService({home,runtime,model:()=>({id:'fixture/reader',vision:true,thinking:'off'}),progress(){},record(){},
  async call(method,params){if(method==='module.read.finish')finished.push(params);return {state:params?.outcome??'ready'};}});
 t.after(()=>service.close());
 await service.runJob({job_id:'read-1',key:'index',module_id:'book',purpose:'index',focus:'',question:'',pages:[],foreground:false,lease:'fixture-lease',
  work_dir:work,source:{path:join(home,'.coc/modules/book/source.pdf'),page_count:1,file_sha256:'fixture-sha'},known_nodes:[],known_claims:[]},new AbortController().signal);
 assert.equal(requests.length,2,'the existing author and completeness pass are retained');
 for(const request of requests){assert.equal(request.submission,true);assert.equal(request.prompt.phase,'index');assert.match(request.brief,/submit_reading/);
  assert.equal(nativeSourceReaderEnabled(request,{EXT_JEV_APIKEY:'fixture-only'}),false,'index stays on the existing tool-enabled source reader');}
 assert.equal(finished.find(row=>row.outcome==='completed')?.draft_path,join(work,'draft.json'));
});

test('index instructions lead with navigation and omit contact preparation policy',async()=>{
 const index=await readerInstructionText(CONTENT,{phase:'index'});
 assert.ok(index.startsWith('## Index phase'));
 assert.doesNotMatch(index,/Module reference policy: logic and campaign continuity|Prepare a concise conversational boundary/);
 assert.match(index,/submit_reading/);
 for(const phase of ['read','verify'])assert.match(await readerInstructionText(CONTENT,{phase,purpose:'detail'}),/Module reference policy: logic and campaign continuity/);
});

test('a successful index process exit without draft.json remains failed and never promotes Markdown',async t=>{
 const home=await mkdtemp(join(playtestScratch('index-submit'),'missing-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const work=join(home,'.coc/modules/book/work/read-1/attempt-1'),cache=join(home,'.coc/modules/book/cache/pages');
 await mkdir(work,{recursive:true});await mkdir(cache,{recursive:true});await writeFile(join(cache,'requests.jsonl'),'{}\n');
 const finished=[];let runs=0;
 const runtime={contentRoot:CONTENT,async runTask({request}){runs++;await writeFile(join(request.cwd,'usable-authored-material.md'),'A prose artifact is not an index.\n');
  return {ok:true,code:0,ms:1,stderr:'',timedOut:false,command:[]};}};
 const service=new ReadingService({home,runtime,model:()=>({id:'fixture/reader',vision:true,thinking:'off'}),progress(){},record(){},
  async call(method,params){if(method==='module.read.finish')finished.push(params);return {state:params?.outcome??'ready'};}});
 t.after(()=>service.close());
 await service.runJob({job_id:'read-1',key:'index',module_id:'book',purpose:'index',focus:'',question:'',pages:[],foreground:false,lease:'fixture-lease',
  work_dir:work,source:{path:join(home,'.coc/modules/book/source.pdf'),page_count:1,file_sha256:'fixture-sha'},known_nodes:[],known_claims:[]},new AbortController().signal);
 assert.equal(runs,2,'the existing bounded attempt count is unchanged');
 assert.equal(finished.length,1);assert.equal(finished[0].outcome,'failed');assert.match(finished[0].detail,/ENOENT.*draft\.json/);
 await assert.rejects(readFile(join(work,'draft.json')),{code:'ENOENT'});
 assert.match(await readFile(join(work,'usable-authored-material.md'),'utf8'),/prose artifact/);
});
