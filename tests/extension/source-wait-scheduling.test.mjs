/** Source waits use the production scheduling owner; RPC and virtual time are external seams. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const advance=async(t,ms)=>{for(let left=ms;left>0;){const step=Math.min(150,left);t.mock.timers.tick(step);left-=step;await flush();}};

test('an unchanged running source request backs off without repeatedly claiming an empty queue',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const requests=[],claims=[];let state='reading';
 const service=new ReadingService({home:'/unused',model:()=>{throw Error('No new child belongs to an already running source job');},
  progress(){},record(){},async call(method){
   if(method==='module.read.request'){requests.push(Date.now());return {state,job_id:'read-1',generation:1};}
   if(method==='module.read.claim'){claims.push(Date.now());return {job_id:null};}
   return {};
  }});
 const pending=service.ensure('book',{purpose:'detail',focus:'Archive'});
 t.after(async()=>{state='ready';await advance(t,3000);await pending.catch(()=>undefined);await service.close();});
 await flush();assert.deepEqual(requests,[0]);
 for(const ms of [300,600,1200,2400,3000])await advance(t,ms);
 assert.deepEqual(requests,[0,300,900,2100,4500,7500]);
 assert.deepEqual(claims,[0],'unchanged progress is not a new queue wake');
 state='ready';await advance(t,3000);
 assert.equal((await pending).state,'ready');
});

test('real job, state and generation progress reset the source wait and terminal refusal is preserved',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const responses=[
  ...Array.from({length:3},()=>({state:'reading',job_id:'read-1',generation:1})),
  {state:'queued',job_id:'read-2',generation:1},{state:'reading',job_id:'read-2',generation:1},
  {state:'reading',job_id:'read-2',generation:2},{state:'reading',job_id:'read-2',generation:2},
  {state:'blocked',job_id:'read-2',generation:2,refusal:{message:'The retained source attempt failed.'}},
 ];
 const requests=[],claims=[],finishes=[];
 const service=new ReadingService({home:'/unused',model:()=>{throw Error('No child is queued');},progress(){},record(){},
  async call(method){
   if(method==='module.read.request'){requests.push(Date.now());return responses.shift()??{state:'blocked'};}
   if(method==='module.read.claim'){claims.push(Date.now());return {job_id:null};}
   if(method==='module.read.finish')finishes.push(Date.now());
   return {};
  }});
 t.after(()=>service.close());
 const refused=assert.rejects(service.ensure('book',{purpose:'detail',focus:'Archive'}),/The retained source attempt failed/);
 await flush();await advance(t,3600);await refused;
 assert.deepEqual(requests,[0,300,900,2100,2400,2700,3000,3600]);
 assert.deepEqual(claims,[0,2100,2400,2700]);
 assert.deepEqual(finishes,[],'waiting on a retained failed attempt does not replace its outcome');
});

test('a foreground rejoin resets the shared wait and an explicit queue wake is immediate during backoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const requests=[],claims=[];let state='reading';
 const service=new ReadingService({home:'/unused',model:()=>{throw Error('No child is queued');},progress(){},record(){},
  async call(method,params){
   if(method==='module.read.request'){requests.push([Date.now(),params.foreground]);return {state,job_id:'read-1',generation:1};}
   if(method==='module.read.claim'){claims.push(Date.now());return {job_id:null};}
   return {};
  }});
 const params={purpose:'detail',focus:'Archive'},background=service.ensure('book',params);
 let foreground;
 t.after(async()=>{state='ready';await advance(t,3000);await Promise.allSettled([background,foreground]);await service.close();});
 await flush();await advance(t,4500);
 foreground=service.ensure('book',{...params,foreground:true});
 await service.prefetch('book');await flush();
 assert.equal(claims.at(-1),4500,'the existing explicit wake does not wait for the polling timer');
 await advance(t,3000);await advance(t,300);
 assert.deepEqual(requests.slice(-2),[[7500,true],[7800,true]],'a changed foreground owner resets the delay to 300 ms');
 state='ready';await advance(t,600);
 assert.equal((await background).state,'ready');assert.equal((await foreground).state,'ready');
});

test('an actually claimed source owner wakes its waiter when it completes during the capped delay',async t=>{
 const home=await mkdtemp(join(tmpdir(),'source-running-wait-')),module=join(home,'.coc/modules/book'),work=join(module,'work/read-1/attempt-1');
 await mkdir(work,{recursive:true});
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 let release,started=false,ready=false,claimed=false;const claims=[],requests=[];
 const held=new Promise(resolve=>{release=resolve;});
 const runtime={contentRoot:resolve(import.meta.dirname,'../../content'),async runTask({request},signal){
  if(!started){started=true;await Promise.race([held,new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))]);}
  if(signal.aborted)throw Error('cancelled');
  const cache=join(module,'cache/pages'),image=join(cache,'page-1.png'),id='page-'+request.eventLog;
  await writeFile(join(work,'draft.json'),JSON.stringify({title:'Fixture',language:'en',sections:[{name:'Opening',pages:[[1,1]],source_refs:[{page:1}]}],map_candidates:[]})+'\n');
  await appendFile(join(cache,'requests.jsonl'),JSON.stringify({file_sha256:'fixture-sha',path:image,page:1,box:[0,0,1,1]})+'\n');
  request.onEvent({type:'tool_execution_end',toolCallId:id,isError:false,result:{content:[{type:'image'}],details:{kind:'source_pages',observations:[{path:image,page:1,box:[0,0,1,1]}]}}});
  await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:[id]})+'\n');
  return {ok:true,code:0,ms:1,stderr:'',timedOut:false,command:[]};
 }};
 const service=new ReadingService({home,runtime,model:()=>({id:'fixture/reader',vision:true,thinking:'off'}),progress(){},record(){},
  async call(method){
   if(method==='module.read.request'){requests.push(Date.now());return {state:ready?'ready':'reading',job_id:'read-1',generation:1};}
   if(method==='module.read.claim'){claims.push(Date.now());if(claimed)return {job_id:null};claimed=true;
    return {job_id:'read-1',module_id:'book',purpose:'index',foreground:false,lease:'fixture-lease',concurrency:2,work_dir:work,
     pages:[],known_nodes:[],known_claims:[],source:{path:join(module,'source.pdf'),page_count:1,file_sha256:'fixture-sha'}};}
   if(method==='module.read.finish'){ready=true;return {state:'ready'};}
   return {};
  }});
 t.after(async()=>{release();await service.close();await rm(home,{recursive:true,force:true});});
 const pending=service.ensure('book',{purpose:'index'});let finished=false;
 pending.then(()=>{finished=true;});
 const drain=async check=>{for(let i=0;i<200&&!check();i++)await new Promise(setImmediate);assert.ok(check(),'the real scheduler did not settle');};
 await drain(()=>started);await advance(t,7500);
 assert.deepEqual(requests,[0,300,900,2100,4500,7500]);
 assert.deepEqual(claims,[0,0],'the running pump does not receive an empty claim on every poll');
 release();await drain(()=>finished);
 assert.equal((await pending).state,'ready');assert.equal(Date.now(),7500,'completion wakes before the 10500 ms polling deadline');
});
