import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {reviewCandidate,reviewUnits} from '../../extensions/module/reader-review.ts';
import {createRuntime} from '../../runtime/host.ts';

test('review grouping retains numeric children and critical nested pointers',()=>{
 const groups=reviewUnits({nodes:[{properties:{mechanics:{HP:10},image_sources:[{page:2}]}}],claims:[],critical:['/nodes/0/properties/mechanics']});
 assert.deepEqual(groups,[['/nodes/0','/nodes/0/properties/mechanics/HP','/nodes/0/properties/mechanics']]);
});

test('forty source reviewers run concurrently and all owned children drain on cancellation',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-pool-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const abort=new AbortController();let active=0,peak=0;
 const draft={nodes:Array.from({length:45},(_,i)=>({node_id:`npc-${i}`,properties:{}})),claims:[],critical:[]};
 const work=reviewCandidate({cwd,task:{},draft,instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:abort.signal,progress(){},record(){},
   async run(request){active++;peak=Math.max(peak,active);await new Promise(resolve=>request.signal.addEventListener('abort',resolve,{once:true}));active--;return {ok:false,stderr:'cancelled'};}});
 const deadline=Date.now()+3000;
 while(peak<40&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(peak,40);abort.abort();await assert.rejects(work,/cancelled/);assert.equal(active,0);
});

test('source and review runs share forty permits and cancelled waiters consume none',async()=>{
 const {acquireReaderSlot}=await import('../../extensions/module/reader.ts');
 const permits=await Promise.all(Array.from({length:40},()=>acquireReaderSlot()));
 const abort=new AbortController();const cancelled=acquireReaderSlot(abort.signal);abort.abort();assert.equal(await cancelled,null);
 let granted=false;const waiting=acquireReaderSlot().then(release=>{granted=true;return release});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(granted,false);
 permits.pop()();const last=await waiting;assert.equal(granted,true);
 for(const release of permits)release();last();last();
 const reusable=await acquireReaderSlot();reusable();
});

test('every independent reviewer attempt uses the owner timeout despite ambient changes', {timeout:5000}, async t => {
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-timeout-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const prior=process.env.PI_COC_READER_TIMEOUT_MS;
 t.after(()=>{if(prior===undefined)delete process.env.PI_COC_READER_TIMEOUT_MS;else process.env.PI_COC_READER_TIMEOUT_MS=prior;});
 const runtime=createRuntime({owner:'preparation',home:cwd},{resourceRoot:resolve(import.meta.dirname,'../..'),env:{...process.env,
  PI_COC_READER_TIMEOUT_MS:'80',PI_COC_READER_CMD:JSON.stringify([process.execPath,'-e','setInterval(()=>{},1000)'])}});
 t.after(()=>runtime.close());
 const outcomes=[];
 const options={cwd,task:{},draft:{nodes:[{properties:{}},{properties:{}}],claims:[]},instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,progress(){},record(){},
  async run(request){const result=await runtime.runTask({kind:'reader',request},request.signal);outcomes.push(result);return result;}};
 process.env.PI_COC_READER_TIMEOUT_MS='600000';
 await assert.rejects(reviewCandidate(options),/reviewer timed out/);
 assert.equal(outcomes.length,4);assert.ok(outcomes.every(result=>result.timedOut && !result.ok));
 outcomes.length=0;process.env.PI_COC_READER_TIMEOUT_MS='0';
 await assert.rejects(reviewCandidate({...options,round:2}),/reviewer timed out/);
 assert.equal(outcomes.length,4);assert.ok(outcomes.every(result=>result.timedOut && !result.ok));
});
