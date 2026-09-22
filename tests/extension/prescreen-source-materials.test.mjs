/** #108 original-source material supply. Real public module RPC and a supplied PDF fixture; no model calls. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {after,before,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..');
const sha=value=>createHash('sha256').update(value).digest('hex');
let api,bundle;
before(async()=>{
  await mkdir(join(ROOT,'.tmp'),{recursive:true});bundle=await mkdtemp(join(ROOT,'.tmp/prescreen-source-materials-test-'));
  await build({stdin:{contents:[
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {preparePrescreenSources,checkPrescreenSourceCheckpoint} from './runtime/jev/prescreen-source-provider.ts';",
    "export {sourceInfo,sourceSearch,sourceText,closeSourceDocuments} from './extensions/module/source.ts';",
  ].join('\n'),resolveDir:ROOT,sourcefile:'prescreen-source-materials-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
const stream=text=>`BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;
function textPdf(streams){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${streams.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [i,value] of streams.entries())objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,
    `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`);
  let text='%PDF-1.7\n';const offsets=[0];
  for(const [i,value] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${value}\nendobj\n`;}
  const xref=Buffer.byteLength(text),size=objects.length+1;
  return text+`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
async function fixture(t,pages=['Opening notices.','Unrelated middle.','The harbor bell rings at midnight.','A distant final appendix.'],rawStreams=false){
  const home=await mkdtemp(join(tmpdir(),'prescreen-source-materials-'));
  const pdf=join(home,'book.pdf'),bytes=Buffer.from(textPdf(rawStreams?pages:pages.map(stream)));
  await writeFile(pdf,bytes);
  const context=await api.createKernelContext({workspace:home,content:join(ROOT,'content'),seed:'prescreen-source-materials',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(context),call=(method,params={})=>runtime.handlers[method](params);
  t.after(async()=>{await runtime.close();await context.git.close();await rm(home,{recursive:true,force:true});});
  const {module_id}=await call('module.source.bind',{module_id:'source-book',source:{path:pdf,file_sha256:sha(bytes),page_count:4}});
  const requested=await call('module.read.request',{module_id,purpose:'answer',focus:'Harbor bell',question:'When does the harbor bell ring?',foreground:true});
  const job=await call('module.read.claim',{module_id,owner:'fixture-reader'});assert.equal(job.job_id,requested.job_id);assert.equal(job.purpose,'answer');
  const draft={status:'answered',answer:'The harbor bell rings at midnight.',source_refs:[{page:3}],limitations:'Only the cited authored sentence is established.'};
  const draftPath=join(job.work_dir,'draft.json'),reviewPath=join(job.work_dir,'review.json');
  await writeFile(draftPath,JSON.stringify(draft));
  await writeFile(reviewPath,JSON.stringify({draft_sha256:sha(await readFile(draftPath)),checked:[{
    paths:['/status','/answer','/source_refs','/limitations'],verdict:'supported',source_refs:[{page:3}],reason:'The original page supports the answer and limitation.',
  }],missing:[]}));
  await writeFile(join(job.work_dir,'observations.json'),JSON.stringify({file_sha256:job.source.file_sha256,read_pages:[3],full_pages:[],review_pages:[3]}));
  await call('module.read.finish',{module_id,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:draftPath,review_path:reviewPath});
  return{home,pdf,bytes,moduleId:module_id,call};
}

test('module source material snapshot enumerates integrity-checked accepted answers with their original task',async t=>{
  const f=await fixture(t);
  const snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId,answer_limit:8});
  assert.equal(snapshot.version,1);assert.equal(snapshot.module_id,f.moduleId);assert.equal(snapshot.file_sha256,sha(f.bytes));
  assert.match(snapshot.revision,/^[a-f0-9]{64}$/);assert.match(snapshot.answers_revision,/^[a-f0-9]{64}$/);
  assert.equal(snapshot.checked_answers_invalid,0);assert.equal(snapshot.checked_answers_omitted,0);assert.equal(snapshot.next,null);
  assert.equal(snapshot.checked_answers.length,1);
  const answer=snapshot.checked_answers[0];
  assert.equal(answer.focus,'Harbor bell');assert.equal(answer.question,'When does the harbor bell ring?');
  assert.equal(answer.answer,'The harbor bell rings at midnight.');assert.equal(answer.supported,true);
  assert.deepEqual(answer.source_refs,[{source_id:`pdf:${f.moduleId}`,pdf_index:2}]);
  assert.equal(answer.evidence.record.answer,answer.answer);assert.equal(answer.evidence.accepted_revision,answer.evidence.revision);
});

test('source provider supplies reviewed answers and exact native excerpts beyond literal matches or first pages',async t=>{
  const f=await fixture(t),snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId,answer_limit:8});
  const source={home:f.home,
    sourceInfo:({pdf})=>api.sourceInfo(pdf),
    sourceSearch:({pdf,...options},signal)=>api.sourceSearch(pdf,options,signal),
    sourceText:({pdf,...options},signal)=>api.sourceText(pdf,options,signal)};
  const input={call:f.call,campaign:'c1',moduleId:f.moduleId,scope:{owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},
    query:'When is the signal heard?',capsule:{known:{lead:{source_refs:[0,1,2].map(pdf_index=>({source_id:`pdf:${f.moduleId}`,pdf_index}))}}},
    source,signal:new AbortController().signal,budget:{deadlineAt:Date.now()+5000,candidateBytes:64*1024,materialBytes:32*1024,maxNativePages:3},snapshot};
  const result=await api.preparePrescreenSources(input);
  const reviewed=result.candidates.find(row=>row.authority==='reviewed_source');
  assert(reviewed);assert.equal(reviewed.body,'The harbor bell rings at midnight.');assert.equal(reviewed.data.question,'When does the harbor bell ring?');
  assert(reviewed.refs.length&&reviewed.refs[0].sourceType==='record');
  const native=result.candidates.filter(row=>row.authority==='native_text');
  assert(native.some(row=>row.data.page===3&&row.body.includes('harbor bell')),'current citation seeds the actual page');
  assert(native.some(row=>row.data.page===4),'bounded broader access samples beyond the first pages even without a literal query match');
  assert(native.every(row=>row.coverage.status==='partial'&&row.coverage.supported===false));
  assert(native.every(row=>row.refs.every(ref=>ref.sourceType==='native_text')));
  assert.deepEqual(result.coverage.native.searched_ranges,[[1,4]]);assert.deepEqual(result.coverage.native.unsearched_ranges,[]);
  assert(result.coverage.native.unmaterialized_pages.includes(2));assert(result.readSet.some(row=>row.kind==='extraction'));
  assert.deepEqual(await result.check(),{status:'current',readSet:result.readSet});
  const repeated=await api.preparePrescreenSources(input);
  assert.deepEqual(repeated.candidates.map(row=>row.key),result.candidates.map(row=>row.key));
  const continued=await result.readNativePages([2],new AbortController().signal);
  assert(continued.some(row=>row.data.page===2&&row.body.includes('Unrelated middle.')));
  assert(continued.every(row=>row.authority==='native_text'&&row.coverage.supported===false&&row.refs.length));
  assert(!result.coverage.native.unmaterialized_pages.includes(2));
  await assert.rejects(result.readNativePages([2],new AbortController().signal),/invalid_native_continuation/);
  assert.deepEqual(await result.check(),{status:'current',readSet:result.readSet});
  await api.closeSourceDocuments();
  await writeFile(snapshot.pdf,Buffer.from(textPdf([stream('Changed one.'),stream('Changed two.'),stream('Changed three.'),stream('Changed four.')])));
  assert.deepEqual(await result.check(),{status:'stale',reason:'source_material_changed'});
});

test('source provider revalidates one materialized page against the current extraction version',async t=>{
  const f=await fixture(t),snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId,answer_limit:8});
  let changed=false;const pageCalls=[],scope={owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},deadlineAt=Date.now()+5000;
  const sourceText=async({pdf,...options},signal)=>{
    pageCalls.push([...options.pages]);
    const bundle=await api.sourceText(pdf,options,signal);
    if(!changed)return bundle;
    const extraction_version=bundle.extraction_version+'-changed';
    return{...bundle,extraction_version,snapshots:bundle.snapshots.map(row=>({...row,
      revision:sha(JSON.stringify([extraction_version,bundle.file_sha256,row.page,row.text_sha256]))}))};
  };
  const source={home:f.home,sourceInfo:({pdf})=>api.sourceInfo(pdf),sourceText};
  const result=await api.preparePrescreenSources({call:f.call,campaign:'c1',moduleId:f.moduleId,scope,
    query:'Check the current source extraction',capsule:{},source,signal:new AbortController().signal,
    budget:{deadlineAt,candidateBytes:64*1024,materialBytes:8*1024,maxNativePages:2},snapshot});
  assert(result.readSet.some(row=>row.kind==='extraction'));assert(result.coverage.native.materialized_pages.length>0);
  changed=true;
  assert.deepEqual(await api.checkPrescreenSourceCheckpoint({call:f.call,source,scope,signal:new AbortController().signal,
    deadlineAt,checkpoint:structuredClone(result.checkpoint)}),{status:'stale',reason:'source_extraction_changed'});
  assert.equal(pageCalls.at(-1).length,1,'freshness reads exactly one page already materialized by preparation');
  assert(result.coverage.native.materialized_pages.includes(pageCalls.at(-1)[0]));
  const unread=result.coverage.native.unmaterialized_pages[0];
  if(unread)await assert.rejects(result.readNativePages([unread],new AbortController().signal),/source_extraction_changed/);
});

test('native qualification reuses source policy and owner proof while visual routing stays raw and partial',async t=>{
  const f=await fixture(t),snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId,answer_limit:8});
  const result=await api.preparePrescreenSources({call:f.call,campaign:'c1',moduleId:f.moduleId,
    scope:{owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},query:'When does the harbor bell ring?',capsule:{},
    source:{home:f.home,sourceInfo:({pdf})=>api.sourceInfo(pdf),sourceText:({pdf,...options},signal)=>api.sourceText(pdf,options,signal)},
    signal:new AbortController().signal,budget:{deadlineAt:Date.now()+5000,candidateBytes:64*1024,materialBytes:8*1024,maxNativePages:4},snapshot});
  const native=result.candidates.find(row=>row.authority==='native_text'&&row.body.includes('harbor bell'));assert(native);
  const decide=route=>async({key,batch})=>({batchId:key,status:'complete',issues:[],coverage:{required:batch.questions.map(row=>row.key),
    answered:batch.questions.map(row=>row.key),unknown:[]},answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'choice',
      choice:question.key==='route'?route:question.key==='coverage'?'sufficient':'evidence'}]))});
  const qualified=await result.qualifyNative([native.key],decide('plaintext'));
  assert.equal(qualified.status,'qualified',JSON.stringify(qualified));assert.equal(qualified.calls,2);
  assert.equal(qualified.candidate.authority,'native_consultation');assert.equal(qualified.candidate.coverage.supported,true);
  assert.equal(qualified.candidate.coverage.status,'complete');assert.match(qualified.candidate.body,/harbor bell rings at midnight/);
  assert(qualified.candidate.refs.every(ref=>ref.sourceType==='native_text'));assert.equal(qualified.candidate.data.prepared,false);
  const visual=await result.qualifyNative([native.key],decide('visual'));
  assert.equal(visual.status,'partial');assert.equal(visual.reason,'native_visual');assert.equal(visual.calls,1);
  assert.equal(native.coverage.supported,false,'qualification never mutates or silently promotes the raw candidate');
});

test('qualification keeps unassessed same-page source parts explicit instead of claiming whole-page coverage',async t=>{
  const longPage=label=>`BT /F1 8 Tf 20 190 Td\n${Array.from({length:180},(_,i)=>
    `(${label} line ${String(i+1).padStart(3,'0')} ${'x'.repeat(72)}.) Tj 0 -1 Td`).join('\n')}\nET`;
  const f=await fixture(t,[longPage('Harbor fact'),longPage('Other two'),longPage('Other three'),longPage('Other four')],true),
    snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId});
  const result=await api.preparePrescreenSources({call:f.call,campaign:'c1',moduleId:f.moduleId,
    scope:{owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},query:'What does the first harbor notice say?',capsule:{},
    source:{home:f.home,sourceInfo:({pdf})=>api.sourceInfo(pdf),sourceText:({pdf,...options},signal)=>api.sourceText(pdf,options,signal)},
    signal:new AbortController().signal,budget:{deadlineAt:Date.now()+5000,candidateBytes:64*1024,materialBytes:8*1024,maxNativePages:1},snapshot});
  const native=result.candidates.find(row=>row.authority==='native_text');assert(native);assert.equal(result.nativeQualificationActions([native.key]),2);
  const semanticKeys=[];let evidence=false;
  const qualified=await result.qualifyNative([native.key],async({key,batch})=>{const answers={};
    for(const question of batch.questions){if(question.key==='route')answers[question.key]={status:'answered',type:'choice',choice:'plaintext'};
      else if(question.key==='coverage')answers[question.key]={status:'answered',type:'choice',choice:'sufficient'};
      else{semanticKeys.push(question.key);if(!evidence){evidence=true;answers[question.key]={status:'answered',type:'choice',choice:'evidence'};}else answers[question.key]={status:'unknown'};}}
    return{batchId:key,status:'complete',answers,issues:[],coverage:{required:batch.questions.map(row=>row.key),answered:Object.keys(answers).filter(name=>answers[name].status==='answered'),
      unknown:Object.keys(answers).filter(name=>answers[name].status==='unknown')}};});
  assert.equal(qualified.status,'qualified',JSON.stringify(qualified));assert(semanticKeys.length>1);assert(semanticKeys.every(key=>/^p1_[0-9]+$/.test(key)));
  assert(qualified.candidate.coverage.unknown.some(value=>String(value).startsWith('part:p1_')),
    'same-page parts not assessed as evidence or irrelevant remain explicit unknown coverage');
});

test('long native pages remain selectable across the document before final material delivery is bounded',async t=>{
  const longPage=label=>`BT /F1 8 Tf 20 190 Td\n${Array.from({length:36},(_,i)=>
    `(${label} line ${String(i+1).padStart(2,'0')} ${'x'.repeat(72)}.) Tj 0 -5 Td`).join('\n')}\nET`;
  const pages=[longPage('Archive alpha'),longPage('Archive beta'),longPage('Harbor bell midnight'),longPage('Distant appendix')];
  const f=await fixture(t,pages,true),snapshot=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId});
  const extracted=await api.sourceText(snapshot.pdf,{pages:[1,2,3,4],expected_file_sha256:snapshot.file_sha256});
  assert(extracted.snapshots.every(row=>row.text.length>2500),JSON.stringify(extracted.snapshots.map(row=>row.text.length)));
  const finalMaterialBytes=64;
  const result=await api.preparePrescreenSources({call:f.call,campaign:'c1',moduleId:f.moduleId,
    scope:{owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},query:'No literal source phrase',capsule:{},
    source:{home:f.home,sourceInfo:({pdf})=>api.sourceInfo(pdf),sourceSearch:({pdf,...options},signal)=>api.sourceSearch(pdf,options,signal),
      sourceText:({pdf,...options},signal)=>api.sourceText(pdf,options,signal)},signal:new AbortController().signal,
    budget:{deadlineAt:Date.now()+5000,candidateBytes:64*1024,materialBytes:finalMaterialBytes,maxNativePages:4},snapshot});
  const native=result.candidates.filter(row=>row.authority==='native_text');
  assert.deepEqual([...new Set(native.map(row=>row.data.page))].sort(),[1,2,3,4]);
  assert(native.every(row=>row.body.length<=800));
  const laterPage=native.find(row=>row.data.page===4);
  assert(laterPage);assert(Buffer.byteLength(laterPage.body,'utf8')>finalMaterialBytes,
    `the ${Buffer.byteLength(laterPage.body,'utf8')}-byte later-page candidate must survive the ${finalMaterialBytes}-byte final delivery allowance`);
  const delivered=Buffer.from(laterPage.body,'utf8').subarray(0,finalMaterialBytes);
  assert.equal(delivered.byteLength,finalMaterialBytes,'the host can bound the selected material after selection');
  assert.equal(result.coverage.native.material_omitted,0);
});

test('historical answers recover only from one matching completed task and ambiguity changes the catalog revision',async t=>{
  const f=await fixture(t),current=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId});
  const moduleRoot=dirname(current.pdf),metaPath=join(moduleRoot,'module.json'),queuePath=join(moduleRoot,'deepen-queue.json');
  const meta=JSON.parse(await readFile(metaPath,'utf8')),accepted=Object.values(meta.reading.answers)[0];
  const originalQuestion=accepted.question;accepted.question='A different question that does not match the accepted cache key.';await writeFile(metaPath,JSON.stringify(meta));
  const mismatched=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId});
  assert.equal(mismatched.checked_answers.length,0);assert.equal(mismatched.checked_answers_invalid,1);
  accepted.question=originalQuestion;
  delete accepted.focus;delete accepted.question;await writeFile(metaPath,JSON.stringify(meta));
  const recovered=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId});
  assert.equal(recovered.checked_answers.length,1);assert.equal(recovered.checked_answers[0].question,'When does the harbor bell ring?');
  const queue=JSON.parse(await readFile(queuePath,'utf8')),answerJob=queue.find(row=>row.purpose==='answer');
  queue.push({...answerJob,job_id:'read-historical-duplicate'});await writeFile(queuePath,JSON.stringify(queue));
  const ambiguous=await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.moduleId});
  assert.equal(ambiguous.checked_answers.length,0);assert.equal(ambiguous.checked_answers_invalid,1);
  assert.notEqual(ambiguous.answers_revision,recovered.answers_revision,'validity and recovered task attribution belong to the snapshot revision');
});
