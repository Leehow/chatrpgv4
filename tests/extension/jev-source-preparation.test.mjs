/** Source preparation owner conformance. Deterministic fixtures, no model calls or play acceptance. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {runOwnedSourcePreparation} from '../../runtime/jev/source-preparation.ts';
import {advanceSourceReadSet} from '../../runtime/jev/read-set.ts';
const root=resolve(import.meta.dirname,'../..'),scope={owner:'session:source-preparation-contract',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
const budget=()=>({deadlineAt:Date.now()+120000,remainingInputTokens:10000,remainingOutputTokens:10000,remainingCostUsd:10,remainingActions:30});
const sets=from=>[{kind:'source',resource:'c1',revision:from},{kind:'world',resource:'c1',revision:'unchanged-world'}];
const makeLease=()=>new TaskLease({owner:'table',goal:'Move to the tower',scope,capabilities:['apply'],budget:budget(),readSet:sets('before')});
const proposal=task=>({id:'operation-1',taskId:task.context.id,operation:'apply',capability:'apply',scope:task.context.scope,args:{effects:[{kind:'move',to:'Tower'}]},readSet:task.context.readSet});
const pending={details:{reason:'material_pending',read:{purpose:'detail',focus:'Tower'}}};
const authority=task=>({version:1,owner:'module-reading',token:'request-token',taskId:task.context.id,rootId:task.context.rootId,operationId:'operation-1',callId:'t1-c1',campaign:'c1',moduleId:'book',scope,turn:1,from:'before'});
const advance=task=>({...authority(task),publicationId:'publication-1',jobId:'read-1',lease:'source-lease',to:'after'});
const code=expected=>error=>error?.code===expected||error?.details?.reason===expected;
let api,bundle;
before(async()=>{
 await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/source-preparation-test-'));
 await build({stdin:{contents:["export {createKernelContext} from './kernel-ts/context.ts';","export {createKernelRuntime} from './kernel-ts/registry.ts';","export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';","export {CampaignWriter} from './kernel-ts/write/store.ts';","export {sourcePreparationSnapshot} from './kernel-ts/modules/reading.ts';","export {ModuleStore} from './kernel-ts/modules/store.ts';"].join('\n'),resolveDir:root,sourcefile:'source-preparation-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
 api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
test('source advance is exact, source-only, branch-bound and idempotent across checkpoints',()=>{
 const parent=makeLease(),child=parent.child({owner:'source-dependent-operation',goal:'Move',capabilities:['apply'],budget:budget()}),sibling=parent.child({owner:'other',goal:'Other',capabilities:['apply'],budget:budget()});
 const publication=advance(child),{to:_to,...expected}=publication;
 try {
  child.advanceSource(publication,expected);assert.deepEqual(child.context.readSet,sets('after'));assert.deepEqual(parent.context.readSet,sets('after'));assert.deepEqual(sibling.context.readSet,sets('before'));
  child.advanceSource(Object.fromEntries(Object.entries(publication).reverse()),expected);assert.deepEqual(parent.context.readSet,sets('after'));
  assert.throws(()=>sibling.advanceSource(publication,expected),code('source_preparation_task_mismatch'));
  assert.throws(()=>child.advanceSource({...publication,to:'foreign'},expected),code('source_publication_replay_mismatch'));
  const checkpoint=parent.checkpoint('planning',[],'Continue'),resumed=TaskLease.resume(checkpoint,{currentReadSet:sets('after'),authorizeResume:()=>true});resumed.close();
  assert.equal(checkpoint.sourceAdvances[0].publicationId,publication.publicationId);assert.equal(checkpoint.settledReceipts.length,0);
 } finally {parent.close();child.close();sibling.close();}
});
test('foreign module, operation, lease scope, old source and answer-only requests cannot advance',async()=>{
 const task=makeLease(),valid=advance(task),{to:_to,...expected}=valid;
 try {
  for(const changed of [{jobId:'foreign'},{lease:'foreign'},{publicationId:'foreign'},{moduleId:'foreign'},{operationId:'foreign'},{campaign:'foreign'},{scope:{...scope,loop:1}},{scope:{...scope,owner:'session:foreign'}},{taskId:'foreign'},{rootId:'foreign'},{callId:'foreign'},{token:'foreign'},{from:'old'}])assert.throws(()=>advanceSourceReadSet(sets('before'),{...valid,...changed},expected));
  for(const [p,failure] of [[{...proposal(task),operation:'look',capability:'look'},pending],[proposal(task),{details:{reason:'material_pending',read:{purpose:'answer',focus:'Tower',question:'What is it?'}}}],[proposal(task),{details:{reason:'unrelated',read:{purpose:'detail',focus:'Tower'}}}]]) {
   let calls=0;await assert.rejects(runOwnedSourcePreparation({task,proposal:p,callId:'t1-c1',moduleId:'book',failure,validateCurrent:async()=>{},ensure:async()=>{calls++;return {};}}));assert.equal(calls,0);
  }
  assert.deepEqual(task.context.readSet,sets('before'));
 } finally {task.close();}
});
test('host preparation borrows only a tracked mutation and persists after exact accepted publication',async()=>{
 const task=makeLease();let ensured=0,validated=0,persisted=0;
 try {
  const result=await runOwnedSourcePreparation({task,proposal:proposal(task),callId:'t1-c1',moduleId:'book',failure:pending,
   validateCurrent:async()=>{validated++;},advanced:async()=>{persisted++;},ensure:async(params,signal)=>{
    ensured++;assert.equal(signal,task.signal);assert.deepEqual(params._task_prepare.read,pending.details.read);assert.equal(params.purpose,'detail');
    assert.equal(task.context.capabilities.includes('source.prepare'),false);
    return {_task_source_advance:{...params._task_prepare.authority,publicationId:'accepted-source',jobId:'read-3',lease:'lease-3',to:'after'}};
   }});
  assert.equal(result.jobId,'read-3');assert.equal(ensured,1);assert.equal(validated,2);assert.equal(persisted,1);assert.deepEqual(task.context.readSet,sets('after'));
 } finally {task.close();}
});
const write=(path,value)=>writeFile(path,JSON.stringify(value));
async function visualFixture(){
 const base=join(root,'.coc/playtests/jev-source-preparation-contracts');await mkdir(base,{recursive:true});const home=await mkdtemp(join(base,'suite-'));
 await write(join(home,'classification.json'),{kind:'contract-fixture',live_play:false,model_calls:0});
 const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'source-preparation',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
 const call=(method,params={})=>runtime.handlers[method](params),bytes=Buffer.from('%PDF-1.7\nSynthetic deterministic source-owner contract fixture, not PDF or play acceptance.\n'),path=join(home,'source.pdf');await writeFile(path,bytes);
 const {module_id:mid}=await call('module.source.bind',{module_id:'source-book',source:{path,file_sha256:createHash('sha256').update(bytes).digest('hex'),page_count:2}});
 const observed=job=>write(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:[1,2],full_pages:[1,2],review_pages:[1,2]});
 const finish=(job,campaign)=>call('module.read.finish',{module_id:mid,...(campaign?{campaign}:{}),job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')});
 await call('module.read.request',{module_id:mid,purpose:'index'});let job=await call('module.read.claim',{module_id:mid,owner:'contract-source-owner'});await observed(job);
 await write(join(job.work_dir,'draft.json'),{title:'Harbor',language:'en',sections:[{name:'Dock and tower',pages:[[1,2]],topics:['opening'],entities:['Dock','Tower','Lena'],references:[]}]});await finish(job);
 await call('module.read.request',{module_id:mid,purpose:'opening'});job=await call('module.read.claim',{module_id:mid,owner:'contract-source-owner'});await observed(job);
 const refs=[{page:1}],draft={nodes:[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:refs,properties:{is_entrance:true}},
 {node_id:'scene-tower',node_kind:'scene',name:'Tower',summary:'An old tower.',source_refs:[{page:2}],properties:{is_final:true}},
 {node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:refs,properties:{mechanics:{profile:{characteristics:{STR:50}}}}}],
 claims:[['scene-dock','route-to','scene-tower'],['npc-lena','present-in','scene-dock']].map(([subject_id,predicate,id])=>({subject_id,predicate,object:{node_id:id},truth_status:'authored-fact',source_refs:refs})),node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-dock','npc-lena']};
 await write(join(job.work_dir,'draft.json'),draft);await write(join(job.work_dir,'review.json'),{checked:['/nodes/0','/nodes/2','/nodes/2/properties/mechanics/profile/characteristics/STR','/claims/0','/claims/1','/coverage'].map(path=>({path,verdict:'supported',source_refs:refs,reason:'Contract source evidence'})),missing:[]});await finish(job);
 await call('campaign.create',{id:'card-source',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 const saved=await call('investigator.save',{campaign:'card-source'});await call('campaign.create',{id:'c1',module:mid,play_language:'en'});
 await call('investigator.load',{campaign:'c1',library_id:saved.library_id});await call('setup.complete',{campaign:'c1'});await call('table.open',{campaign:'c1'});
 await call('table.narrate',{campaign:'c1',call_id:'t0-c1',text:'The harbor waits.'});await call('table.player_input',{campaign:'c1',text:'I go to the tower.'});
 return {home,kernel,runtime,call,mid,observed,finish};
}
test('actual pending mutation uses scoped source publication and retries unchanged call exactly once',async()=>{
 const f=await visualFixture();let task;
 try {
  const args={campaign:'c1',call_id:'t1-c1',effects:[{kind:'move',to:'Tower'}]},before=await f.call('table.capsule',{campaign:'c1'}),context=before._context;
  let failure;try{await f.call('table.apply',args);}catch(error){failure=error;}assert.equal(failure?.details?.reason,'material_pending');
  task=new TaskLease({owner:'table',goal:'Move to the tower',scope:{...scope,worldline:context.worldline,loop:context.loop},capabilities:['apply'],budget:budget(),readSet:[{kind:'source',resource:'c1',revision:context.task_source_revision}]});
  const request=proposal(task);let publication,job,params;
  await runOwnedSourcePreparation({task,proposal:request,callId:'t1-c1',moduleId:f.mid,failure,
   validateCurrent:async()=>{const current=(await f.call('table.capsule',{campaign:'c1'}))._context;assert.equal(task.revalidate([{kind:'source',resource:'c1',revision:current.task_source_revision}]).status,'current');},
   ensure:async value=>{
    params={...value,campaign:'c1',module_id:f.mid};const queued=await f.call('module.read.request',params);assert.ok(queued.job_id);
    // Refuse a changed/foreign owner instead of treating any module publication as this operation's work.
    await assert.rejects(f.call('module.read.request',{...params,_task_prepare:{...value._task_prepare,authority:{...value._task_prepare.authority,operationId:'foreign'}}}));
    job=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'contract-source-owner'});assert.equal(job.job_id,queued.job_id);assert.equal(job.task_preparation,undefined);await f.observed(job);
    const refs=[{page:2}],draft={nodes:[{node_id:'scene-tower',node_kind:'scene',name:'Tower',summary:'An old tower.',source_refs:refs,properties:{is_final:true}}],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-tower']};
    await write(join(job.work_dir,'draft.json'),draft);await write(join(job.work_dir,'review.json'),{checked:['/nodes/0','/coverage'].map(path=>({path,verdict:'supported',source_refs:refs,reason:'Contract source evidence'})),missing:[]});
    publication=await f.finish(job,'c1');assert.ok(publication._task_source_advance);assert.equal(publication._task_source_advance.from,context.task_source_revision);
    const replay=await f.finish(job,'c1');assert.deepEqual(replay._task_source_advance,publication._task_source_advance);
    return f.call('module.read.request',params);
   }});
  assert.equal(publication._task_source_advance.operationId,request.id);assert.equal(publication._task_source_advance.lease,job.lease);
  const result=await f.call('table.apply',args),replay=await f.call('table.apply',args);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipts,result.receipts);
  const turn=await new api.CampaignWriter(f.kernel,'c1').readTurn();assert.equal(turn.receipts.filter(value=>value.kind==='move').length,1);
  assert.equal(task.context.capabilities.includes('source.prepare'),false);
 }finally{task?.close();await f.runtime.close();}
});
async function draftDetail(f,job,node={node_id:'scene-tower',node_kind:'scene',name:'Tower',summary:'An old tower.',source_refs:[{page:2}],properties:{is_final:true}}){
 await f.observed(job);const refs=node.source_refs;
 await write(join(job.work_dir,'draft.json'),{nodes:[node],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[node.node_id]});
 await write(join(job.work_dir,'review.json'),{checked:['/nodes/0','/coverage'].map(path=>({path,verdict:'supported',source_refs:refs,reason:'Contract source evidence'})),missing:[]});
}
for(const state of ['running'])test(`tracked preparation cannot adopt an unowned ${state} source job`,async()=>{
 const f=await visualFixture();let task;
 try {
  const params={campaign:'c1',module_id:f.mid,purpose:'detail',focus:'Tower',foreground:false};
  const queued=await f.call('module.read.request',params);
  let job=state==='running'?await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'background-owner'}):undefined;
  const binding=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);
  task=new TaskLease({owner:'table',goal:'Move',scope:{...binding.scope,owner:scope.owner},capabilities:['apply'],budget:budget(),readSet:[{kind:'source',resource:'c1',revision:binding.revision}]});
  const owned={authority:{...authority(task),scope:task.context.scope,moduleId:f.mid,from:binding.revision},read:{purpose:'detail',focus:'Tower'}};
  const queuePath=join(f.home,'.coc/module-campaigns/c1/modules',f.mid,'deepen-queue.json'),before=await readFile(queuePath,'utf8');
  for(let attempt=0;attempt<2;attempt++) {
   await assert.rejects(f.call('module.read.request',{...params,foreground:true,retry:attempt>0,_task_prepare:owned}),code('source_preparation_foreign_job'));
   assert.equal(await readFile(queuePath,'utf8'),before,'refusal must not promote, cancel or attach authority to the background job');
  }
  job??=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'background-owner'});
  assert.equal(job.job_id,queued.job_id);await draftDetail(f,job);
  const published=await f.finish(job,'c1');assert.equal(published._task_source_advance,undefined);
  await assert.rejects(f.call('module.read.request',{...params,_task_prepare:owned}),code('source_preparation_stale'));
  assert.equal(task.context.readSet[0].revision,binding.revision);
 }finally{task?.close();await f.runtime.close();}
});
test('only one exact operation can initially bind an untouched queued prefetch',async()=>{
 const f=await visualFixture();let task;
 try {
  const read={purpose:'detail',focus:'Tower'},params={campaign:'c1',module_id:f.mid,...read};
  const queued=await f.call('module.read.request',params),binding=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);
  task=new TaskLease({owner:'table',goal:'Move',scope:{...binding.scope,owner:scope.owner},capabilities:['apply'],budget:budget(),readSet:[{kind:'source',resource:'c1',revision:binding.revision}]});
  const a={authority:{...authority(task),scope:task.context.scope,moduleId:f.mid,from:binding.revision},read};
  const b={...a,authority:{...a.authority,token:'second-token',operationId:'second-operation'}};
  const replies=await Promise.allSettled([a,b].map(_task_prepare=>f.call('module.read.request',{...params,foreground:true,_task_prepare})));
  assert.equal(replies.filter(row=>row.status==='fulfilled').length,1);
  const accepted=replies.findIndex(row=>row.status==='fulfilled'),winner=[a,b][accepted];
  assert.equal(replies[accepted].value.job_id,queued.job_id,'Initial ownership reuses the untouched queue entry');
  assert.equal(replies[1-accepted].reason.details.reason,'source_preparation_foreign_job');
  const queue=JSON.parse(await readFile(join(f.home,'.coc/module-campaigns/c1/modules',f.mid,'deepen-queue.json'),'utf8'));
  const job=queue.find(row=>row.job_id===queued.job_id);assert.equal(job.task_preparation.request.authority.token,winner.authority.token);
  assert.equal(job.foreground,true);assert.equal(job.state,'queued');assert.equal(job.attempts,0);assert.equal(job.lease,undefined);
 }finally{task?.close();await f.runtime.close();}
});
test('exact source authority can rejoin queued and running jobs while foreign authority cannot',async()=>{
 const f=await visualFixture();let task;
 try {
  const binding=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);
  task=new TaskLease({owner:'table',goal:'Move',scope:{...binding.scope,owner:scope.owner},capabilities:['apply'],budget:budget(),readSet:[{kind:'source',resource:'c1',revision:binding.revision}]});
  const owned={authority:{...authority(task),scope:task.context.scope,moduleId:f.mid,from:binding.revision},read:{purpose:'detail',focus:'Tower'}};
  const params={...owned.read,campaign:'c1',module_id:f.mid,_task_prepare:owned,foreground:true};
  const queued=await f.call('module.read.request',params),queuePath=join(f.home,'.coc/module-campaigns/c1/modules',f.mid,'deepen-queue.json');
  let job;
  for(const state of ['queued','reading']) {
   assert.equal((await f.call('module.read.request',structuredClone(params))).job_id,queued.job_id);
   assert.equal((await f.call('module.read.request',params)).state,state);
   const before=await readFile(queuePath,'utf8'),current=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);
   const foreign={...owned,authority:{...owned.authority,token:'foreign-token',operationId:'foreign-operation',from:current.revision}};
   await assert.rejects(f.call('module.read.request',{...params,_task_prepare:foreign}),code('source_preparation_foreign_job'));
   assert.equal(await readFile(queuePath,'utf8'),before);
   if(!job)job=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'owned-owner'});
  }
  await draftDetail(f,job);const published=await f.finish(job,'c1');assert.equal(published._task_source_advance.token,owned.authority.token);
 }finally{task?.close();await f.runtime.close();}
});
test('actual source owner emits no advance for answer-only, cancelled, or foreign publication',async()=>{
 const f=await visualFixture();let task;
 try {
  const request={campaign:'c1',module_id:f.mid,purpose:'answer',focus:'Lena',question:'What does the source say about her work?',foreground:true};
  await f.call('module.read.request',request);const answer=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'answer-owner'});assert.equal(answer.purpose,'answer');
  const metaPath=join(f.home,'.coc/module-campaigns/c1/modules',f.mid,'module.json'),meta=JSON.parse(await readFile(metaPath,'utf8'));meta.updated_at='2000-01-01T00:00:00Z';await write(metaPath,meta);
  const legacyBefore=(await f.call('table.capsule',{campaign:'c1'}))._context.source_revision;
  const answerBefore=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);await f.observed(answer);
  await write(join(answer.work_dir,'draft.json'),{status:'answered',answer:'She works at the harbor.',source_refs:[{page:1}],limitations:'Only the inspected pages.'});
  await write(join(answer.work_dir,'review.json'),{checked:[{paths:['/status','/answer','/source_refs','/limitations'],verdict:'supported',source_refs:[{page:1}],reason:'Contract source evidence'}],missing:[],draft_sha256:createHash('sha256').update(await readFile(join(answer.work_dir,'draft.json'))).digest('hex')});
  const answered=await f.finish(answer,'c1');assert.equal(answered._task_source_advance,undefined);assert.equal(answered.source_answer.prepared,false);
  assert.equal((await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid)).revision,answerBefore.revision);
  assert.notEqual((await f.call('table.capsule',{campaign:'c1'}))._context.source_revision,legacyBefore);
  const binding=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);task=new TaskLease({owner:'table',goal:'Move',scope:{...binding.scope,owner:scope.owner},capabilities:['apply'],budget:budget(),readSet:[{kind:'source',resource:'c1',revision:binding.revision}]});
  const owned={authority:{...authority(task),scope:task.context.scope,moduleId:f.mid,from:binding.revision},read:{purpose:'detail',focus:'Tower'}};
  const params={...owned.read,campaign:'c1',module_id:f.mid,_task_prepare:owned,foreground:true};
  await f.call('module.read.request',params);const cancelled=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'cancelled-owner'});
  const stopped=await f.call('module.read.finish',{campaign:'c1',module_id:f.mid,job_id:cancelled.job_id,lease:cancelled.lease,outcome:'cancelled'});assert.equal(stopped._task_source_advance,undefined);assert.equal(stopped.state,'cancelled');
  await f.call('module.read.request',{...params,retry:true});const pendingJob=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'owned-owner'});assert.ok(pendingJob.work_dir,JSON.stringify(pendingJob));await draftDetail(f,pendingJob);
  await f.call('module.read.request',{campaign:'c1',module_id:f.mid,purpose:'detail',focus:'Dock',question:'An independent recheck.',foreground:false});
  const foreign=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'foreign-owner'});assert.notEqual(foreign.job_id,pendingJob.job_id);await draftDetail(f,foreign,{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{is_entrance:true}});
  const published=await f.finish(foreign,'c1');assert.equal(published._task_source_advance,undefined);
  await assert.rejects(f.finish(pendingJob,'c1'),code('source_preparation_stale'));
  await assert.rejects(f.call('module.read.request',params),code('source_preparation_stale'));
  assert.equal(task.context.readSet[0].revision,binding.revision);
 }finally{task?.close();await f.runtime.close();}
});
for(const fault of ['after-graph','before-completion','after-completion','before-queue'])test(`owned publication survives ${fault} interruption without durable completion missing its proof`,async()=>{
 const f=await visualFixture();let task,restarted;
 const prototype=api.ModuleStore.prototype,original={writeGraph:prototype.writeGraph,writeModule:prototype.writeModule,writeQueue:prototype.writeQueue};
 const restore=()=>{for(const [name,method] of Object.entries(original))prototype[name]=method;};
 try {
  const mutation={campaign:'c1',call_id:'t1-c1',effects:[{kind:'move',to:'Tower'}]};
  await assert.rejects(f.call('table.apply',mutation),code('material_pending'));
  const binding=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid);
  task=new TaskLease({owner:'table',goal:'Move',scope:{...binding.scope,owner:scope.owner},capabilities:['apply'],budget:budget(),readSet:[{kind:'source',resource:'c1',revision:binding.revision}]});
  const owned={authority:{...authority(task),scope:task.context.scope,moduleId:f.mid,from:binding.revision},read:{purpose:'detail',focus:'Tower'}};
  const params={...owned.read,campaign:'c1',module_id:f.mid,_task_prepare:owned,foreground:true};
  await f.call('module.read.request',params);const job=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'fault-contract-owner'});await draftDetail(f,job);
  const finishParams={campaign:'c1',module_id:f.mid,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')};
  const directory=join(f.home,'.coc/module-campaigns/c1/modules',f.mid),metaPath=join(directory,'module.json'),queuePath=join(directory,'deepen-queue.json');
  const beforeBytes=await readFile(metaPath,'utf8'),beforeMeta=JSON.parse(beforeBytes),beforeSource=await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid),beforeDirectories=await readdir(join(directory,'generations'));
  let faulted=false,completionWrites=0,proofAtBoundary;
  const interrupt=()=>{faulted=true;throw new Error(`source-publication-fault:${fault}`);};
  prototype.writeGraph=async function(meta,graph){
   const result=await original.writeGraph.call(this,meta,graph);
   if(!faulted&&fault==='after-graph'&&meta.id===f.mid&&meta.campaign_scope==='c1')interrupt();return result;
  };
  prototype.writeModule=async function(meta){
   const completed=meta.id===f.mid&&meta.campaign_scope==='c1'&&meta.reading?.completed?.[job.job_id];
   if(completed){completionWrites++;assert.ok(completed._task_source_advance,'Completion must include its proof before the first durable metadata write');proofAtBoundary=structuredClone(completed._task_source_advance);}
   if(completed&&!faulted&&fault==='before-completion')interrupt();
   await original.writeModule.call(this,meta);
   if(completed&&!faulted&&fault==='after-completion')interrupt();
  };
  prototype.writeQueue=async function(mid,queue){
   if(!faulted&&fault==='before-queue'&&mid===f.mid&&queue.some(value=>value.job_id===job.job_id&&value.lease===job.lease&&value.state==='completed'))interrupt();
   return original.writeQueue.call(this,mid,queue);
  };
  await assert.rejects(f.call('module.read.finish',finishParams),new RegExp(`source-publication-fault:${fault}`));assert.equal(faulted,true);restore();
  const published=['after-completion','before-queue'].includes(fault),interrupted=JSON.parse(await readFile(metaPath,'utf8'));
  assert.equal(completionWrites,fault==='after-graph'?0:1);
  assert.ok((await readdir(join(directory,'generations'))).length>beforeDirectories.length,'Unpublished generation files are retained as evidence');
  if(published){
   assert.deepEqual(interrupted.reading.completed[job.job_id]._task_source_advance,proofAtBoundary);
   assert.equal(interrupted.generation,beforeMeta.generation+1);
  } else {
   assert.equal(await readFile(metaPath,'utf8'),beforeBytes);assert.equal(interrupted.reading.completed[job.job_id],undefined);
   assert.equal((await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid)).revision,beforeSource.revision);
  }
  assert.equal(JSON.parse(await readFile(queuePath,'utf8')).find(value=>value.job_id===job.job_id).state,'running');
  await f.runtime.close();restarted=api.createKernelRuntime(f.kernel);const call=(method,args)=>restarted.handlers[method](args);
  const coldRequest=await call('module.read.request',params);
  if(published)assert.deepEqual(coldRequest._task_source_advance,proofAtBoundary);
  else assert.equal(coldRequest.state,'reading');
  const accepted=await call('module.read.finish',finishParams),advance=accepted._task_source_advance;
  assert.ok(advance);assert.equal(advance.operationId,owned.authority.operationId);assert.equal(advance.moduleId,f.mid);assert.equal(advance.jobId,job.job_id);assert.equal(advance.lease,job.lease);assert.equal(advance.from,binding.revision);
  if(published){assert.equal(accepted.replayed,true);assert.deepEqual(advance,proofAtBoundary);}
  assert.equal((await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid)).revision,advance.to);
  assert.equal(JSON.parse(await readFile(metaPath,'utf8')).generation,beforeMeta.generation+1);
  const replay=await call('module.read.finish',finishParams);assert.equal(replay.replayed,true);assert.deepEqual(replay._task_source_advance,advance);
  assert.deepEqual((await call('module.read.request',params))._task_source_advance,advance);
  if(fault==='before-queue'){
   await call('module.read.request',{campaign:'c1',module_id:f.mid,purpose:'detail',focus:'Dock',question:'An independent later publication.'});
   const foreign=await call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'foreign-contract-owner'});await draftDetail(f,foreign,{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{is_entrance:true}});
   await call('module.read.finish',{...finishParams,job_id:foreign.job_id,lease:foreign.lease,draft_path:join(foreign.work_dir,'draft.json'),review_path:join(foreign.work_dir,'review.json')});
   await assert.rejects(call('module.read.request',params),code('source_preparation_stale'));
   assert.deepEqual((await call('module.read.finish',finishParams))._task_source_advance,advance,'Historical completion never reanchors itself to a later source');
   assert.notEqual((await api.sourcePreparationSnapshot(f.kernel,'c1',f.mid)).revision,advance.to);
  }else{
   const applied=await call('table.apply',mutation),again=await call('table.apply',mutation);assert.equal(again.replayed,true);assert.deepEqual(again.receipts,applied.receipts);
   assert.equal((await new api.CampaignWriter(f.kernel,'c1').readTurn()).receipts.filter(value=>value.kind==='move').length,1);
  }
 } finally {restore();task?.close();await restarted?.close();await f.runtime.close();}
});
