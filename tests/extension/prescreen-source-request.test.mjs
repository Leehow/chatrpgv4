import {supportDecision,supportWire,supportChoices} from './support-agent-helpers.mjs';
/** Real source-owner to final-provider request regression. Deterministic selection, no model or play claim. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {after,before,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..'),PRESCREEN_TYPE='coc-prescreen',sha=value=>createHash('sha256').update(value).digest('hex');
let api,bundle;
before(async()=>{
  await mkdir(join(ROOT,'.tmp'),{recursive:true});bundle=await mkdtemp(join(ROOT,'.tmp/prescreen-source-request-'));
  await build({stdin:{contents:[
    "export * from './extensions/table/context-policy.ts';",
    "export * from './extensions/table/prescreen-types.ts';",
    "export * from './extensions/table/prescreen.ts';",
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {createHybridEngine} from './runtime/jev/hybrid-engine.ts';",
    "export {createDecisionAdapter} from './runtime/jev/decision-adapter.ts';",
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {checkDraft} from './kernel-ts/modules/visual.ts';",
    "export {sourceInfo,sourceText,closeSourceDocuments} from './extensions/module/source.ts';",
    "export {convertToLlm} from './build/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';",
  ].join('\n'),resolveDir:ROOT,sourcefile:'prescreen-source-request-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,
    packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{await api?.closeSourceDocuments?.();if(bundle)await rm(bundle,{recursive:true,force:true});});

function sourcePdf(){
  const source='ORIGINAL NOTICE: The harbor bell rings at midnight beside the red warehouse.';
  const stream=`BT /F1 10 Tf 20 160 Td (${source}) Tj ET`,objects=['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.7\n';const offsets=[0];for(const [index,value] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${value}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);return Buffer.from(pdf+`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const save=(path,value)=>writeFile(path,JSON.stringify(value));

async function fixture(t,{answer=true}={}){
  const home=await mkdtemp(join(tmpdir(),'prescreen-source-request-')),pdf=join(home,'source.pdf'),bytes=sourcePdf();await writeFile(pdf,bytes);
  const context=await api.createKernelContext({workspace:home,content:join(ROOT,'content'),seed:'prescreen-source-request',
    locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context);
  t.after(async()=>{await runtime.close();await context.git.close();await api.closeSourceDocuments();
    await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const call=(method,params={})=>runtime.handlers[method](params),refs=[{page:1}],contract={
    graph:JSON.parse(await readFile(join(ROOT,'content/modules/module-graph-contract-v3.json'),'utf8')),
    template:JSON.parse(await readFile(join(ROOT,'content/modules/module-graph-template-v1.json'),'utf8'))};
  const {module_id:mid}=await call('module.source.bind',{module_id:'source-book',title:'Harbor Source',source:{path:pdf,file_sha256:sha(bytes),page_count:1}});
  const finish=async(job,draft,campaign)=>{
    const checked=job.purpose==='index'?[]:api.checkDraft(draft,job,contract,new Set([1])).required_review;
    await Promise.all([save(join(job.work_dir,'draft.json'),draft),save(join(job.work_dir,'review.json'),{
      checked:checked.length?[{paths:checked,verdict:'supported',source_refs:refs,reason:'The supplied original page supports these fields.'}]:[],missing:[]}),
      save(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:[1],full_pages:[1],review_pages:[1]})]);
    return call('module.read.finish',{...(campaign?{campaign}:{}),module_id:mid,job_id:job.job_id,lease:job.lease,outcome:'completed',
      draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')});
  };
  const claim=async params=>{const queued=await call('module.read.request',{module_id:mid,...params});assert.equal(queued.state,'queued');
    const job=await call('module.read.claim',{module_id:mid,owner:'source-request-fixture'});assert.equal(job.job_id,queued.job_id);return job;};
  await finish(await claim({purpose:'index'}),{title:'Harbor Source',language:'en',sections:[{name:'Harbor opening',pages:[[1,1]],topics:['opening'],entities:['Dock','Warehouse'],references:[]}]});
  const opening=await claim({purpose:'opening'}),draft={nodes:[
    {node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:refs,properties:{is_entrance:true}},
    {node_id:'scene-warehouse',node_kind:'scene',name:'Warehouse',source_refs:refs,properties:{is_final:true}}],
    claims:[{subject_id:'scene-dock',predicate:'route-to',object:{node_id:'scene-warehouse'},truth_status:'authored-fact',source_refs:refs}],
    node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-dock','scene-warehouse']};
  await finish(opening,draft);
  const acceptAnswer=async(campaign,question,answer)=>{
    const scope=campaign?{campaign}:{},requested=await call('module.read.request',{module_id:mid,...scope,purpose:'answer',focus:'Harbor bell',question,foreground:true,memo:false});
    // memo:false (§22.4.3): the fixture accepts a new answer on a focus the campaign already consulted, so it reads past the memo.
    const job=await call('module.read.claim',{module_id:mid,...scope,owner:'source-answer-fixture'});assert.equal(job.job_id,requested.job_id);
    const answerDraft={status:'answered',answer,source_refs:refs,limitations:'Only the cited authored notice is established.'},draftPath=join(job.work_dir,'draft.json'),reviewPath=join(job.work_dir,'review.json');
    await save(draftPath,answerDraft);await save(reviewPath,{draft_sha256:sha(await readFile(draftPath)),checked:[{
      paths:['/status','/answer','/source_refs','/limitations'],verdict:'supported',source_refs:refs,reason:'The original notice supports the answer.'}],missing:[]});
    await save(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:[1],full_pages:[],review_pages:[1]});
    return call('module.read.finish',{module_id:mid,...scope,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:draftPath,review_path:reviewPath});
  };
  if(answer)await acceptAnswer(undefined,'When does the harbor bell ring?','The harbor bell rings at midnight.');
  await call('campaign.create',{id:'card-source',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const saved=await call('investigator.save',{campaign:'card-source'});await call('campaign.create',{id:'c1',module:mid,play_language:'en'});
  await call('investigator.load',{campaign:'c1',library_id:saved.library_id});await call('setup.complete',{campaign:'c1'});
  const opened=await call('table.open',{campaign:'c1'}),input=await call('table.player_input',{campaign:'c1',text:'When does the harbor bell ring, and what exactly does the original notice say?'}),view=await call('table.capsule',{campaign:'c1',rehydrate:true});
  const {_context,...capsule}=view,source={home,sourceInfo:({pdf:path})=>api.sourceInfo(path),sourceText:({pdf:path,...options},signal)=>api.sourceText(path,options,signal)};
  // §195.1: a reading that publishes to the campaign's book during play (a new generation), about something the prescreen
  // never supplied.
  const publishUnrelated=async()=>{
    await call('module.read.request',{campaign:'c1',module_id:mid,purpose:'detail',focus:'Dock',question:'Who keeps the dock at night?'});
    const job=await call('module.read.claim',{campaign:'c1',module_id:mid,owner:'publish-fixture'});
    return finish(job,{nodes:[{node_id:'npc-watchman',node_kind:'npc',name:'Watchman',summary:'An authored night watchman.',properties:{},source_refs:refs}],
      claims:[{subject_id:'npc-watchman',predicate:'present-in',object:{node_id:'scene-dock'},truth_status:'authored-fact',source_refs:refs}],
      node_refs:['scene-dock'],coverage:{},dependencies:[],critical:[],ready_nodes:['npc-watchman']},'c1');
  };
  return{home,mid,call,finish,opened,input,capsule,binding:_context,source,acceptAnswer,publishUnrelated,fileSha:sha(bytes)};
}

/** `onFirst` runs once, before answering the first request `trigger` accepts (by default the first request of all). */
const SOURCES=c=>c.kind==='source'?'necessary':'skip';
function deterministicFetch(onFirst,trigger=()=>true,select=SOURCES){let fired=false;return async(_url,options)=>{const sent=JSON.parse(options.body);
if(!fired&&onFirst&&trigger(sent)){fired=true;await onFirst();}
return Response.json(supportWire(sent,select,{qualify:true}));};}
/** The first request of the preparation's loop (its `operation` question): the source materials were read before it. */
const loopRequest=sent=>Object.hasOwn(sent.questions??{},'operation');

async function project(t,f,onFirst,trigger,select){
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='deterministic-request-test';globalThis.fetch=deterministicFetch(onFirst,trigger,select);
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  const hooks=new Map(),bus=new Map(),events=[];api.installContextPolicy({on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler)},
    getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  assert.equal(api.prescreenEnabled(),true);
  bus.get('coc:kernel-bridge')({campaign:'c1',call:f.call,runtime:f.source});bus.get('coc:table-open')({campaign:'c1',open:f.opened});
  bus.get('coc:capsule')({capsule:f.capsule,context:f.binding,epoch:f.input.epoch??'source-request'});
  const projected=await hooks.get('context')({type:'context',messages:[{role:'user',content:f.capsule.turn.player_text}]},{model:{contextWindow:1000000},getSystemPrompt:()=>''});
  return{hooks,events,projected};
}

test('current native PDF and checked answer evidence reach the actual provider payload with their authority intact',async t=>{
  const f=await fixture(t),result=await project(t,f),packet=result.projected.messages.find(row=>row.customType===PRESCREEN_TYPE);assert(packet,JSON.stringify(result.events));
  const content=JSON.parse(packet.content),native=content.materials.find(row=>row.authority==='native_consultation'),checked=content.materials.find(row=>row.authority==='reviewed_source');
  assert(native,JSON.stringify({content,events:result.events}));assert.match(native.content.excerpts[0].text,/ORIGINAL NOTICE: The harbor bell rings at midnight/);
  assert.equal(native.coverage.supported,true);assert.equal(native.coverage.derived,false);assert.equal(native.coverage.status,'complete');
  assert.equal(native.content.question,f.capsule.turn.player_text);assert.equal(native.content.supported,true);assert.equal(native.content.prepared,false);
  assert.match(native.label,/When does the harbor bell ring/);assert.equal(native.provenance.kind,'native_consultation');
  assert.equal(native.provenance.question,f.capsule.turn.player_text);assert.deepEqual(native.provenance.pages,[1]);
  assert(checked);assert.equal(checked.content,'The harbor bell rings at midnight.');assert.equal(checked.coverage.status,'complete');
  assert.equal(checked.coverage.supported,true);assert.equal(checked.provenance.kind,'checked_source_answer');
  assert.equal(checked.provenance.question,'When does the harbor bell ring?');assert.equal(checked.provenance.focus,'Harbor bell');
  assert(!packet.content.includes(f.fileSha));assert(!packet.content.includes('selector'),packet.content);
  const input=api.convertToLlm(structuredClone(result.projected.messages)),payload={model:'fixture',input};
  assert.match(JSON.stringify(payload),/ORIGINAL NOTICE: The harbor bell rings at midnight/);assert.match(JSON.stringify(payload),/The harbor bell rings at midnight\./);
  await result.hooks.get('before_provider_request')({type:'before_provider_request',payload},{});
  const delivered=result.events.findLast(row=>row.lane==='prescreen'&&row.event==='delivered');assert.equal(delivered?.delivered,true,JSON.stringify(result.events));
  assert(delivered.retained.some(row=>row.coverage.status==='complete'&&row.coverage.supported===true&&row.coverage.derived===false));
  assert(delivered.retained.some(row=>row.coverage.status==='complete'&&row.coverage.supported===true));
  await result.hooks.get('session_shutdown')();
});

// §124.11.1 (SL-44): the reading store's revision is not a prescreen binding key. An answer that lands before the source
// materials are read is read with them: the packet is current, not stale, and is published.
test('a source-owner answer landing before the source materials are read is part of the packet, which is current and reaches the provider (§124.11.1)',async t=>{
  const f=await fixture(t),result=await project(t,f,()=>f.acceptAnswer('c1','Who posted the harbor notice?','The inspected notice does not name its author.'));
  const packet=result.projected.messages.find(row=>row.customType===PRESCREEN_TYPE);assert(packet,JSON.stringify(result.events));
  assert(JSON.parse(packet.content).materials.some(row=>row.provenance?.question==='Who posted the harbor notice?'),'the landed answer is among the materials: the packet is current');
  assert.notEqual(f.binding.source_revision,(await f.call('table.capsule',{campaign:'c1'}))._context.source_revision,'the landing moved source_revision after the run was bound');
  assert.equal(result.events.find(row=>row.lane==='prescreen'&&row.event==='fallback'),undefined);
  await result.hooks.get('before_provider_request')({type:'before_provider_request',payload:{model:'fixture',input:api.convertToLlm(structuredClone(result.projected.messages))}},{});
  const delivered=result.events.findLast(row=>row.lane==='prescreen'&&row.event==='delivered');assert.equal(delivered?.delivered,true,JSON.stringify(result.events));
  await result.hooks.get('session_shutdown')();
});

// §195.1 (supersedes the §124.11.1 case "an answer landing after they were read voids them"): the check reads back what the
// prescreen supplied. An answer landing on another question after the source materials were read moves the materials
// revision and changes nothing the packet carries: it is delivered, and the prepared row says it was revalidated.
const prepared=events=>events.find(row=>row.lane==='prescreen'&&row.event==='prepared');
const fallback=events=>events.find(row=>row.lane==='prescreen'&&row.event==='fallback');
async function deliver(result){
  await result.hooks.get('before_provider_request')({type:'before_provider_request',payload:{model:'fixture',input:api.convertToLlm(structuredClone(result.projected.messages))}},{});
  return result.events.findLast(row=>row.lane==='prescreen'&&row.event==='delivered');
}
test('§195.1 an unrelated answer landing after the source materials were read leaves the packet current: delivered, revalidated',async t=>{
  const f=await fixture(t),result=await project(t,f,()=>f.acceptAnswer('c1','Who posted the harbor notice?','The inspected notice does not name its author.'),loopRequest);
  assert.equal(fallback(result.events),undefined,JSON.stringify(fallback(result.events)));
  const packet=result.projected.messages.find(row=>row.customType===PRESCREEN_TYPE);assert(packet,JSON.stringify(result.events));
  const current=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.mid,answer_limit:8});
  assert(current.checked_answers.some(row=>row.question==='Who posted the harbor notice?'),'the public owner change actually landed');
  assert(JSON.parse(packet.content).materials.some(row=>row.content==='The harbor bell rings at midnight.'),'the supplied answer is delivered');
  assert.equal(prepared(result.events)?.revalidated,true,'kept across the change');
  assert.equal(prepared(result.events)?.source_check?.status,'current');
  assert.equal((await deliver(result))?.delivered,true,JSON.stringify(result.events));
  await result.hooks.get('session_shutdown')();
});

// §195.1, TR-F's shape: a book with no checked answers, read during play. A reading publishes a new generation about
// something else while the prescreen runs; the native pages it supplied read back unchanged, so the packet is delivered.
test('§195.1 a library publish of unrelated nodes during the prescreen does not discard it: the supplied pages read back, the packet is delivered',async t=>{
  const f=await fixture(t,{answer:false}),before=await f.call('module.status',{campaign:'c1',module_id:f.mid});
  const result=await project(t,f,()=>f.publishUnrelated(),loopRequest);
  const after=await f.call('module.status',{campaign:'c1',module_id:f.mid});
  assert(after.generation>before.generation,'the reading published a new generation during the prescreen');
  assert.equal(fallback(result.events),undefined,JSON.stringify(fallback(result.events)));
  const packet=result.projected.messages.find(row=>row.customType===PRESCREEN_TYPE);assert(packet,JSON.stringify(result.events));
  assert.match(packet.content,/ORIGINAL NOTICE: The harbor bell rings at midnight/,'the supplied original page is delivered');
  const row=prepared(result.events);
  assert.equal(row?.revalidated,true);assert(row.source_check.supplied>0,JSON.stringify(row.source_check));
  assert.equal((await deliver(result))?.delivered,true,JSON.stringify(result.events));
  await result.hooks.get('session_shutdown')();
});

// §195.1: the check is of what was supplied, not of everything the provider offered. The publish retires the checked
// answer the provider offered, but the prescreen chose only the original page: nothing it used changed.
test('§195.1 a publish that retires an offered answer the prescreen did not supply leaves the packet current',async t=>{
  const f=await fixture(t);
  const result=await project(t,f,()=>f.publishUnrelated(),loopRequest,c=>c.kind==='source'&&c.authority!=='reviewed_source'?'necessary':'skip');
  assert.equal(fallback(result.events),undefined,JSON.stringify(fallback(result.events)));
  const packet=result.projected.messages.find(row=>row.customType===PRESCREEN_TYPE);assert(packet,JSON.stringify(result.events));
  assert(!JSON.parse(packet.content).materials.some(row=>row.authority==='reviewed_source'),'the answer was offered, not supplied');
  const check=prepared(result.events)?.source_check;
  assert.deepEqual([check?.status,check?.changed,check?.revalidated],['current',undefined,true],JSON.stringify(check));
  assert.equal((await deliver(result))?.delivered,true,JSON.stringify(result.events));
  await result.hooks.get('session_shutdown')();
});

// §195.1: a publish that changes what the prescreen supplied. The new generation retires the checked answer it delivered
// (an answer is bound to its context generation, §22.4.3) and the same question is answered again under it; the one
// re-selection takes that answer, the set reads back current, and the packet is delivered with it.
test('§195.1 a publish that changes a supplied answer re-selects it once against the current materials',async t=>{
  const f=await fixture(t);
  const result=await project(t,f,async()=>{await f.publishUnrelated();
    await f.acceptAnswer('c1','When does the harbor bell ring?','The harbor bell rings at midnight, twice.');},loopRequest);
  assert.equal(fallback(result.events),undefined,JSON.stringify(fallback(result.events)));
  const packet=result.projected.messages.find(row=>row.customType===PRESCREEN_TYPE);assert(packet,JSON.stringify(result.events));
  const materials=JSON.parse(packet.content).materials;
  assert(materials.some(row=>row.content==='The harbor bell rings at midnight, twice.'),'the answer accepted now is delivered');
  assert(!materials.some(row=>row.content==='The harbor bell rings at midnight.'),'the retired answer is not');
  const check=prepared(result.events)?.source_check;
  assert.deepEqual([check?.status,check?.reason,check?.changed],['current','source_answer_changed',1],JSON.stringify(check));
  assert(check.reselected>=1);
  assert.equal((await deliver(result))?.delivered,true,JSON.stringify(result.events));
  await result.hooks.get('session_shutdown')();
});

// §195.1: when the re-selection cannot make the supplied set current, the fallback stands and its row names the check's
// own reason, not only "stale".
test('§195.1 a supplied page whose PDF changed falls back with the actual reason',async t=>{
  const f=await fixture(t,{answer:false});
  const result=await project(t,f,async()=>{
    const snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.mid,answer_limit:1});
    await api.closeSourceDocuments();await writeFile(snapshot.pdf,Buffer.concat([await readFile(snapshot.pdf),Buffer.from('\n% changed\n')]));},loopRequest);
  const row=fallback(result.events);
  assert.equal(row?.reason,'source_material_changed',JSON.stringify(row));
  assert.equal(row.source_check.status,'stale');assert.equal(row.source_check.reselect,'failed');
  assert(!result.projected.messages.some(message=>message.customType===PRESCREEN_TYPE));
  await result.hooks.get('session_shutdown')();
});

test('the actual hybrid read port receives original PDF evidence before any Keeper inference',async t=>{
 const f=await fixture(t),events=[],bus=new Map();let nativeReads=0;
 const engine=api.createHybridEngine({env:{PI_COC_JEV_PRESELECT:'1',EXT_JEV_APIKEY:'fixture'},npcAct:null,record:row=>events.push(row),
  decision:api.createDecisionAdapter({apiKey:'fixture',fetcher:deterministicFetch()})});
 engine.extension({on(){},events:{on:(name,handler)=>bus.set(name,handler),emit(){}},getActiveTools:()=>[]});
 bus.get('coc:kernel-bridge')({campaign:'c1',moduleId:f.mid,call:f.call,runtime:{...f.source,sourceText:async(...args)=>{nativeReads++;return f.source.sourceText(...args);}}});
 const prepared=await engine.runDriver.prepare({runId:'source-before-keeper',inputRevision:'fixture-v1',rawInput:f.capsule.turn.player_text,session:{}});
 const read=await prepared.ports.read.read({operation:'read',origin:'policy'},{signal:AbortSignal.timeout(20000),stepId:'read-original'});
 assert(nativeReads>0,'hybrid must pass its source runtime to the evidence owner');
 assert.match(JSON.stringify(read.artifact.read.materials),/ORIGINAL NOTICE: The harbor bell rings at midnight/);
 assert(events.some(row=>row.event==='source_catalog'&&row.candidates>0));
});

test('a missing destination does not start a mandatory source preparation before Keeper inference',async t=>{
 const f=await fixture(t),events=[],bus=new Map(),questions=[];
 const adapter=api.createDecisionAdapter({apiKey:'fixture',fetcher:deterministicFetch()});
 const engine=api.createHybridEngine({env:{PI_COC_JEV_PRESELECT:'0',EXT_JEV_APIKEY:'fixture'},npcAct:null,record:row=>events.push(row),
  decision:{decide:(batch,lease)=>{questions.push(batch.family);return adapter.decide(batch,lease);}}});
 engine.extension({on(){},events:{on:(name,handler)=>bus.set(name,handler),emit(){}},getActiveTools:()=>[]});
 bus.get('coc:kernel-bridge')({campaign:'c1',moduleId:f.mid,call:f.call,runtime:f.source});
 const prepared=await engine.runDriver.prepare({runId:'unlisted-destination',inputRevision:'fixture-v1',rawInput:'I visit a photographic shop.',session:{}});
 const read=await prepared.ports.read.read({operation:'read',origin:'policy'},{signal:AbortSignal.timeout(20000),stepId:'first'});
 assert(read.artifact);
 assert(!questions.includes('source-destination-intake'));
 assert(!events.some(row=>row.event==='destination_preflight'));
});

test('a bound PDF accepts an ordinary off-book place, person and clue without a source job',async t=>{
 const f=await fixture(t),base={campaign:'c1'};
 const before=await f.call('module.status',{module_id:f.mid,campaign:'c1'});
 const result=await f.call('table.apply',{...base,call_id:'t1-c1',effects:[
  {kind:'move',to:'Riverside photographic shop',establish:{summary:'A photographic shop with a public counter.'},via:'Walk along the street'},
  {kind:'npc',name:'the shopkeeper',walk_on:true,to:'here'},
  {kind:'clue',clue:'Shop collection slip',establish:{summary:'The plates may be collected this afternoon.'},how:'The shopkeeper gives the collection time.',from:'the shopkeeper'}]});
 assert.equal(result.world.active_scene,'Riverside photographic shop');
 assert.equal(result.material_ready,true);
 const found=await f.call('table.lookup',{...base,kind:'module',query:'Shop collection slip'});
 assert.equal(found.entities[0].material,'ready');
 assert.equal(found.entities[0].origin.kind,'table');
 const after=await f.call('module.status',{module_id:f.mid,campaign:'c1'});
 assert.equal(after.generation,before.generation,'ordinary additions do not publish a source graph');
});

test('late source actors have conditional initial-presence options without overwriting recorded locations',async t=>{
 const f=await fixture(t),params={campaign:'c1',module_id:f.mid};
 await f.call('module.read.request',{...params,purpose:'detail',focus:'Dock',question:'Prepare the newly read dock occupant'});
 const job=await f.call('module.read.claim',{...params,owner:'presence-fixture'});
 await f.finish(job,{nodes:[{node_id:'npc-mae',node_kind:'npc',name:'Mae',summary:'An authored dock occupant.',properties:{},source_refs:[{page:1}]}],claims:[{subject_id:'npc-mae',predicate:'present-in',object:{node_id:'scene-dock'},truth_status:'authored-fact',source_refs:[{page:1}]}],node_refs:['scene-dock'],coverage:{},dependencies:[],critical:[],ready_nodes:['npc-mae']},'c1');
 const option=(await f.call('table.apply.options',{campaign:'c1'})).candidates.find(row=>row.description.kind==='source_presence');
 // A campaign on a reader-built book shows name-free handles (§185), not the book's slugs: the kernel says which.
 const handleOf=async name=>(await f.call('table.lookup',{campaign:'c1',kind:'module',query:name})).entities[0]?.name;
 assert.deepEqual(option.effect,{kind:'npc',name:await handleOf('Mae'),to:await handleOf('Dock')});
 await f.call('table.apply',{campaign:'c1',call_id:'t1-c1',effects:[{kind:'npc',name:'mae',to:'warehouse',why:'A prior table event placed Mae away from the dock.'}]});
 assert(!(await f.call('table.apply.options',{campaign:'c1'})).candidates.some(row=>row.description.kind==='source_presence'),'the book cannot teleport a recorded actor back');
});
