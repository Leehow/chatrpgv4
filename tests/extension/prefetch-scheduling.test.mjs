/** Scheduler/transport checks only, not a substitute for real Keeper play. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import moduleExtension from '../../extensions/module/index.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {acquireReaderSlot,wakeReaderSlots} from '../../extensions/module/reader.ts';
import {createRuntime} from '../../runtime/host.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate());}

test('table binding and queued movement wake prefetch before agent_end, in either startup order',async t=>{
 for(const earlyTable of [true,false]){
  const home=await mkdtemp(join(tmpdir(),'prefetch-events-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const events=new EventEmitter(),hooks=new Map(),claims=[];
  moduleExtension({events,on(name,fn){hooks.set(name,fn)},appendEntry(){},getThinkingLevel(){return 'low'}});
  const ctx={model:{provider:'fixture',id:'vision'},modelRegistry:{find(){return {input:['image']}}}};
  const binding=()=>events.emit('coc:table-open',{campaign:'test',open:{module_reading:true,campaign:{module_id:'book'}}});
  events.emit('coc:kernel-bridge',{campaign:'test',runtime:{home,readerModel:'fixture/vision'},async call(method,args){assert.equal(method,'module.read.claim');claims.push(args);return {job_id:null}}});
  if(earlyTable)binding();await hooks.get('session_start')({},ctx);if(!earlyTable)binding();
  await until(()=>claims.length===1);assert.equal(hooks.has('agent_end'),false);
  events.emit('coc:source-work-queued',{campaign:'test',module_id:'book'});await until(()=>claims.length===2);
  events.emit('coc:turn-committed',{campaign:'test'});await until(()=>claims.length===3);
  events.emit('coc:source-work-queued',{module_id:'other'});await tick();assert.equal(claims.length,3);
  events.emit('coc:source-work-queued',{campaign:'other',module_id:'book'});
  events.emit('coc:turn-committed',{campaign:'other'});
  events.emit('coc:table-open',{campaign:'other',open:{module_reading:true,campaign:{module_id:'book'}}});
  await tick();assert.equal(claims.length,3);
  await hooks.get('session_shutdown')();events.emit('coc:turn-committed',{});await tick();assert.equal(claims.length,3);
 }
});

test('a wake arriving during an empty claim is retained rather than waiting for another turn',async()=>{
 let resolveEmpty,queued=false,first=true;const started=[];
 const service=new ReadingService({home:'/unused',model(){return {}},progress(){},record(){},async call(){
  if(first){first=false;return new Promise(resolve=>{resolveEmpty=resolve})}
  if(queued){queued=false;return {job_id:'late',concurrency:3,foreground:false}}return {job_id:null};}});
 service.runJob=async(job,signal)=>{started.push(job.job_id);await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))};
 const initial=service.prefetch('book');await until(()=>resolveEmpty);
 queued=true;void service.prefetch('book');resolveEmpty({job_id:null});await until(()=>started.length===1);
 await service.close();await initial;assert.deepEqual(started,['late']);
});

test('background permits cannot exhaust foreground capacity and queued promotion does not restart work',async()=>{
 const held=await Promise.all(Array.from({length:8},()=>acquireReaderSlot(undefined,'background')));
 const cancel=new AbortController();let pendingGranted=false;
 const pending=acquireReaderSlot(cancel.signal,'background').then(release=>{pendingGranted=!!release;return release});
 let priority='background';const promoted=acquireReaderSlot(undefined,()=>priority);
 const foreground=await acquireReaderSlot(undefined,'foreground');assert.ok(foreground);
 await tick();assert.equal(pendingGranted,false);
 priority='foreground';wakeReaderSlots();const promotedRelease=await promoted;assert.ok(promotedRelease);
 assert.equal(pendingGranted,false);cancel.abort();assert.equal(await pending,null);
 for(const release of held)release();foreground();promotedRelease();
 const again=await acquireReaderSlot(undefined,'background');again();
});

test('real TS leases allow two background focuses while preserving one foreground slot across clients',async t=>{
 const home=await mkdtemp(join(tmpdir(),'prefetch-native-'));
 const owners=Array.from({length:3},()=>createRuntime({owner:'preparation',home},{resourceRoot:resolve(import.meta.dirname,'../..'),nodeExecutable:process.execPath}));
 t.after(async()=>{await Promise.all(owners.map(owner=>owner.close()));await rm(home,{recursive:true,force:true})});
 const clients=owners.map(owner=>owner.openKernel());
 const bytes=Buffer.from('%PDF-1.7\nsource identity for scheduler transport only\n');const pdf=join(home,'fixture.pdf');await writeFile(pdf,bytes);
 const {module_id}=await clients[0].call('module.source.bind',{source:{path:pdf,page_count:1,file_sha256:createHash('sha256').update(bytes).digest('hex')}});
 const request=(client,focus,foreground=false,question)=>client.call('module.read.request',{module_id,purpose:'detail',focus,foreground,...(question?{question}:{})});
 const claim=client=>client.call('module.read.claim',{module_id});
 const finish=(client,job)=>client.call('module.read.finish',{module_id,job_id:job.job_id,lease:job.lease,outcome:'failed',detail:'End scheduler fixture without publishing a graph'});
 for(const focus of ['A','B','C'])await request(clients[0],focus);
 const a=await claim(clients[0]),b=await claim(clients[1]);
 assert.deepEqual([a.focus,b.focus],['A','B']);assert.equal(a.concurrency,3);
 assert.equal((await claim(clients[2])).job_id,null,'third background cannot consume foreground slot');
 await request(clients[2],'Needed',true);const needed=await claim(clients[2]);assert.equal(needed.focus,'Needed');
 await finish(clients[0],a);const c=await claim(clients[0]);assert.equal(c.focus,'C','background failure does not suspend unrelated queue work');
 await finish(clients[2],needed);const promoted=await request(clients[2],'B',true);assert.equal(promoted.job_id,b.job_id);
 await request(clients[2],'B',true,'A different question');assert.equal((await claim(clients[2])).job_id,null,'same-focus work cannot race publication');
 await request(clients[2],'E');const e=await claim(clients[2]);assert.equal(e.focus,'E','promotion frees a background slot without duplicating the original job');
});

/**
 * Contract §61. Retained evidence, M-DETOUR `game-3d8ab658` (2026-09-16): `read-6` (focus
 * `Bar Cordano`, turn 25) held the single foreground lease from 15:17:37 to 15:29:11, while the
 * Keeper's own wait on it had ended at 15:19:37. The party moved to the museum on turn 26; the
 * turn-27 read of where they were standing queued at 15:26:01, was refused by `claim` three times
 * (`claim_empty` at 15:28:31 with a job queued), and only started at 15:29:11 with
 * `queue_wait_ms: 190344` -- long after its own 120 s wait had expired.
 */
test('a foreground reading nobody waits on gives its lease back to the read the table is blocked on',async t=>{
 const home=await mkdtemp(join(tmpdir(),'prefetch-unwait-'));
 const owner=createRuntime({owner:'preparation',home},{resourceRoot:resolve(import.meta.dirname,'../..'),nodeExecutable:process.execPath});
 t.after(async()=>{await owner.close();await rm(home,{recursive:true,force:true})});
 const client=owner.openKernel();
 const bytes=Buffer.from('%PDF-1.7\nsource identity for the unwait fixture only\n');const pdf=join(home,'fixture.pdf');await writeFile(pdf,bytes);
 const {module_id}=await client.call('module.source.bind',{source:{path:pdf,page_count:1,file_sha256:createHash('sha256').update(bytes).digest('hex')}});
 const request=(focus,foreground)=>client.call('module.read.request',{module_id,purpose:'detail',focus,foreground});
 const claim=()=>client.call('module.read.claim',{module_id});
 await request('Bar Cordano',true);
 const left=await claim();assert.equal(left.focus,'Bar Cordano');
 await request('museo-de-arqueologia',true);
 assert.equal((await claim()).job_id,null,'the running foreground read holds the only foreground lease');
 assert.deepEqual(await client.call('module.read.unwait',{module_id,job_id:left.job_id}),{job_id:left.job_id,foreground:false});
 const here=await claim();
 assert.equal(here.focus,'museo-de-arqueologia','the read the table is blocked on takes the freed foreground lease');
 // The demoted reading was not cancelled: it still runs, still owns its lease, and still publishes.
 assert.deepEqual(await client.call('module.read.finish',{module_id,job_id:left.job_id,lease:left.lease,outcome:'failed',detail:'End the fixture without publishing a graph'}),{state:'failed'});
 // Idempotent, and no state change for a job that is over or was never in the foreground.
 assert.deepEqual(await client.call('module.read.unwait',{module_id,job_id:left.job_id}),{job_id:left.job_id,foreground:false});
 await client.call('module.read.finish',{module_id,job_id:here.job_id,lease:here.lease,outcome:'failed',detail:'End the fixture without publishing a graph'});
});

test('joining an active prefetch promotes its queued child without creating a second reader',async()=>{
 const held=await Promise.all(Array.from({length:8},()=>acquireReaderSlot(undefined,'background')));
 let first=true,ready=false,runs=0,priority;const entered=[];
 const service=new ReadingService({home:'/unused',model(){return {}},progress(){},record(){},async call(method){
  if(method==='module.read.request')return {state:ready?'ready':'reading',job_id:'shared'};
  if(method==='module.read.claim'&&first){first=false;return {job_id:'shared',foreground:false,concurrency:3};}
  return {job_id:null};}});
 service.runJob=async(job,signal)=>{runs++;priority=()=>job.foreground===false?'background':'foreground';const release=await acquireReaderSlot(signal,priority);if(release){entered.push(job.job_id);ready=true;release();}};
 try{
  const background=service.prefetch('book');await until(()=>priority);await tick();assert.deepEqual(entered,[]);
  const result=await service.ensure('book',{purpose:'detail',focus:'Needed',foreground:true});
  assert.equal(result.state,'ready');await background;assert.equal(runs,1);assert.deepEqual(entered,['shared']);
 }finally{await service.close();for(const release of held)release();}
});

test('bridge replacement and shutdown close retired readers and drain their cleanup',async()=>{
 const original=ReadingService.prototype.close;let closed=0;
 ReadingService.prototype.close=async function(){closed++;await original.call(this)};
 const events=new EventEmitter(),hooks=new Map();
 try{
  moduleExtension({events,on(name,fn){hooks.set(name,fn)},appendEntry(){},getThinkingLevel(){return 'low'}});
  await hooks.get('session_start')({},{});
  const runtime={home:'/unused'};const call=async()=>({job_id:null});
  events.emit('coc:kernel-bridge',{runtime,call,campaign:'one'});
  events.emit('coc:kernel-bridge',{runtime,call,campaign:'two'});
  await hooks.get('session_shutdown')();assert.equal(closed,2);
 }finally{ReadingService.prototype.close=original;}
});
