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

async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),'prescreen-source-request-')),pdf=join(home,'source.pdf'),bytes=sourcePdf();await writeFile(pdf,bytes);
  const context=await api.createKernelContext({workspace:home,content:join(ROOT,'content'),seed:'prescreen-source-request',
    locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context);
  t.after(async()=>{await runtime.close();await context.git.close();await api.closeSourceDocuments();
    await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const call=(method,params={})=>runtime.handlers[method](params),refs=[{page:1}],contract={
    graph:JSON.parse(await readFile(join(ROOT,'content/modules/module-graph-contract-v3.json'),'utf8')),
    template:JSON.parse(await readFile(join(ROOT,'content/modules/module-graph-template-v1.json'),'utf8'))};
  const {module_id:mid}=await call('module.source.bind',{module_id:'source-book',title:'Harbor Source',source:{path:pdf,file_sha256:sha(bytes),page_count:1}});
  const finish=async(job,draft)=>{
    const checked=job.purpose==='index'?[]:api.checkDraft(draft,job,contract,new Set([1])).required_review;
    await Promise.all([save(join(job.work_dir,'draft.json'),draft),save(join(job.work_dir,'review.json'),{
      checked:checked.length?[{paths:checked,verdict:'supported',source_refs:refs,reason:'The supplied original page supports these fields.'}]:[],missing:[]}),
      save(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:[1],full_pages:[1],review_pages:[1]})]);
    return call('module.read.finish',{module_id:mid,job_id:job.job_id,lease:job.lease,outcome:'completed',
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
  await acceptAnswer(undefined,'When does the harbor bell ring?','The harbor bell rings at midnight.');
  await call('campaign.create',{id:'card-source',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const saved=await call('investigator.save',{campaign:'card-source'});await call('campaign.create',{id:'c1',module:mid,play_language:'en'});
  await call('investigator.load',{campaign:'c1',library_id:saved.library_id});await call('setup.complete',{campaign:'c1'});
  const opened=await call('table.open',{campaign:'c1'}),input=await call('table.player_input',{campaign:'c1',text:'When does the harbor bell ring, and what exactly does the original notice say?'}),view=await call('table.capsule',{campaign:'c1',rehydrate:true});
  const {_context,...capsule}=view,source={home,sourceInfo:({pdf:path})=>api.sourceInfo(path),sourceText:({pdf:path,...options},signal)=>api.sourceText(path,options,signal)};
  return{home,mid,call,opened,input,capsule,binding:_context,source,acceptAnswer,fileSha:sha(bytes)};
}

function deterministicFetch(onFirst){let calls=0;return async(_url,options)=>{if(calls++===0&&onFirst)await onFirst();
return Response.json(supportWire(JSON.parse(options.body),c=>c.kind==='source'?'necessary':'skip',{qualify:true}));};}

async function project(t,f,onFirst){
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='deterministic-request-test';globalThis.fetch=deterministicFetch(onFirst);
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

test('a public source-owner answer change during selection prevents the stale packet from reaching provider conversion',async t=>{
  const f=await fixture(t),result=await project(t,f,()=>f.acceptAnswer('c1','Who posted the harbor notice?','The inspected notice does not name its author.'));
  assert(!result.projected.messages.some(row=>row.customType===PRESCREEN_TYPE),JSON.stringify(result.events));
  const current=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.mid,answer_limit:8,answer_cursor:0});
  assert(current.checked_answers.some(row=>row.question==='Who posted the harbor notice?'),'the public owner change actually landed');
  await result.hooks.get('before_provider_request')({type:'before_provider_request',payload:{model:'fixture',input:api.convertToLlm(result.projected.messages)}},{});
  assert(!result.events.some(row=>row.lane==='prescreen'&&row.event==='delivered'&&row.delivered===true));
  await result.hooks.get('session_shutdown')();
});
