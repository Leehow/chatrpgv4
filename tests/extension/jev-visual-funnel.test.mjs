import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {packDecisionBatch,JEV_MODEL,JEV_VISUAL_MODEL} from '../../runtime/jev/question-packing.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {visualFunnel,pdfVisualSheet,originalPageBox} from '../../runtime/jev/visual-funnel.ts';
import {sourceInfo} from '../../extensions/module/source.ts';
import {createSourceReaderDriver,sourcePageQuestionState,packSourcePageBatch,groupSourcePages} from '../../runtime/jev/source-reader-driver.ts';

const scope={owner:'visual-test',audience:'keeper'},readSet=[];
const image=()=>({type:'image',format:'png',width:280,height:280,data_base64:createCanvas(280,280).toBuffer('image/png').toString('base64')});
const base=()=>({id:'visual',model:JEV_VISUAL_MODEL,family:'visual-test',familyVersion:'1',scope,readSet,state:{photo:'owned-image-reference'},
  assets:{'owned-image-reference':image()},questions:[{key:'exists',target:'photo',type:'noul',instructions:'Is the target present?'},
    {key:'region',target:'photo',type:'box',instructions:'Locate the target.'}]});
const owner=()=>new TaskLease({owner:'visual-test',goal:'Find a printed target',scope,readSet,capabilities:['decision'],
  budget:{deadlineAt:Date.now()+10000,remainingInputTokens:1_000_000,remainingOutputTokens:10000,remainingCostUsd:1,remainingActions:20}});

test('real transport sends image assets and opt-in headers, binds Box, and preserves the pinned model',async()=>{
  const batch=base(), lease=owner();let request;
  const adapter=createDecisionAdapter({apiKey:'test-only',fetcher:async(_url,init)=>{
    request=init;return new Response(JSON.stringify({model:JEV_VISUAL_MODEL,answers:{exists:{type:'noul',noul:0.9},
      region:{type:'box',confidence:0.8,box:{left:0.2,top:0.3,right:0.7,bottom:0.9}}},usage:{input_tokens:1000,output_tokens:30}}));
  }});
  try{const result=await adapter.decide(batch,lease);assert.equal(result.status,'complete');
    assert.equal(result.answers.region.box.left,0.2);assert.equal(request.headers['TypeSafe-Danger-Zone-Images'],'true');
    assert.equal(request.headers['TypeSafe-Danger-Zone-Long-Context'],undefined);
    assert.equal(JSON.parse(request.body).assets['owned-image-reference'].width,undefined);
    assert.equal(packDecisionBatch(batch).estimate.totalUpperBound,64000);
    assert.equal(packDecisionBatch(batch).estimate.provenance,'configured_image_context_reservation');
  }finally{lease.close();}
});

test('invalid dimensions, unused images, unsupported model and malformed coordinates cannot masquerade as valid geometry',async()=>{
  for(const change of [batch=>batch.assets['owned-image-reference'].width=300,batch=>batch.state.photo='unused',batch=>batch.model=JEV_MODEL]){
    const batch=base();change(batch);assert.throws(()=>packDecisionBatch(batch));
  }
  const lease=owner(),adapter=createDecisionAdapter({apiKey:'test-only',fetcher:async()=>new Response(JSON.stringify({model:JEV_VISUAL_MODEL,
    answers:{exists:{type:'noul',noul:0.9},region:{type:'box',confidence:0.9,box:{left:0.9,top:0,right:0.2,bottom:1}}},usage:{input_tokens:1000,output_tokens:30}}))});
  try{const result=await adapter.decide(base(),lease);assert.equal(result.status,'incomplete');assert.deepEqual(result.coverage.unknown,['region']);}
  finally{lease.close();}
});

test('long page text survives intact and long context is sent only when normal packing cannot fit',async()=>{
  const text='x'.repeat(40_000)+' END-OF-PAGE-CONDITION';
  const small={id:'text',model:JEV_MODEL,family:'source-page-lead',familyVersion:'2',scope,readSet,
    state:sourcePageQuestionState('Locate the condition',undefined,null,[{page:1,text:'A short page.'}]),
    questions:[{key:'p1',target:'pages[0]',type:'noul',instructions:'Does this page contain the requested condition?'}]};
  assert.equal(packSourcePageBatch(small).longContext,undefined);
  const batch=packSourcePageBatch({...small,state:sourcePageQuestionState('Locate the condition',undefined,null,[{page:1,text}])});
  assert.equal(batch.longContext,true);assert.equal(batch.state.pages[0].text,text);assert.equal(packDecisionBatch(batch).estimate.requestLimit,262000);
  const lease=owner();let headers;
  const adapter=createDecisionAdapter({apiKey:'test-only',fetcher:async(_url,init)=>{headers=init.headers;
    return new Response(JSON.stringify({model:JEV_MODEL,answers:{p1:{type:'noul',noul:0.9}},usage:{input_tokens:10000,output_tokens:1}}));}});
  try{assert.equal((await adapter.decide(batch,lease)).status,'complete');assert.equal(headers['TypeSafe-Danger-Zone-Long-Context'],'true');
    assert.equal(headers['TypeSafe-Danger-Zone-Images'],undefined);}finally{lease.close();}
  assert.throws(()=>packSourcePageBatch({...batch,longContext:false,state:{text:'x'.repeat(270000)}}),/packing_limit/);
});

test('padding transforms recover original page geometry and refuse a box crossing a label',()=>{
  assert.deepEqual(originalPageBox({left:0.3,top:0.3,right:0.7,bottom:0.7},[0.1,0.1,0.9,0.9]).map(n=>Math.round(n*100)),[25,25,75,75]);
  assert.equal(originalPageBox({left:0,top:0,right:1,bottom:1},[0.1,0.1,0.9,0.9]),undefined);
});

test('ordinary context groups preserve full text and isolate oversized pages before long-context fallback',()=>{
  const makeBatch=pages=>({id:'text-groups',model:JEV_MODEL,family:'source-page-lead',familyVersion:'2',scope,readSet,
    state:sourcePageQuestionState('Locate the condition',undefined,null,pages),
    questions:pages.map((_,i)=>({key:'p'+i,target:'pages['+i+']',type:'noul',instructions:'Does the page contain the condition?'}))});
  const pages=Array.from({length:6},(_,i)=>({page:i+1,text:'x'.repeat(14000)+' TAIL-'+i}));
  const groups=groupSourcePages(pages,makeBatch);
  assert.deepEqual(groups.map(group=>group.length),[2,2,2]);
  assert.deepEqual(groups.flat(),pages);
  for(const group of groups)assert.equal(packSourcePageBatch(makeBatch(group)).longContext,undefined);
  const wide={page:7,text:'x'.repeat(40000)+' WIDE-TAIL'},huge={page:8,text:'x'.repeat(270000)};
  const mixed=groupSourcePages([pages[0],wide,pages[1],huge,pages[2]],makeBatch);
  assert.deepEqual(mixed.map(group=>group.map(row=>row.page)),[[1],[7],[2],[8],[3]]);
  assert.equal(packSourcePageBatch(makeBatch(mixed[1])).longContext,true);
  assert.equal(makeBatch(mixed[1]).state.pages[0].text,wide.text);
  assert.throws(()=>packSourcePageBatch(makeBatch(mixed[3])),/packing_limit/);
  assert.equal(packSourcePageBatch(makeBatch(mixed[4])).longContext,undefined);
  assert.deepEqual(groupSourcePages(Array.from({length:17},(_,i)=>({page:i+1,text:'Short'})),makeBatch).map(g=>g.length),[16,1]);
  assert.throws(()=>groupSourcePages(pages,group=>({...makeBatch(group),model:'unknown'})),/schema_error/);
});

const pdf=resolve('content/starters/the-haunting/source.pdf');
function decisions(calls,{fail=false}={}){return {async decide(batch){calls.push(batch);
  if(fail)throw new Error('Transport unavailable');
  const answers=Object.fromEntries(batch.questions.map(question=>[question.key,question.type==='box'
    ?{status:'answered',type:'box',confidence:0.9,box:{left:0.3,top:0.3,right:0.6,bottom:0.6}}
    :question.key==='p5'?{status:'unknown'}:{status:'answered',type:'noul',noul:['p2','p3'].includes(question.key)?0.9:0.01}]));
  return {batchId:batch.id,status:Object.values(answers).some(a=>a.status==='unknown')?'incomplete':'complete',answers,
    coverage:{required:[],answered:[],unknown:[]},issues:[],attempts:1,usage:{inputTokens:100,outputTokens:1,costUsd:0.0000042}};
}};}

test('found pages stop without Box and skip intermediate reclassification when Box is required',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'visual-found-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const info=await sourceInfo(pdf),pages=Array.from({length:16},(_,i)=>i+1),calls=[];
  const decision={async decide(batch){calls.push(batch);return {status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,
    q.type==='box'?{status:'answered',type:'box',confidence:0.8,box:{left:0,top:0,right:1,bottom:1}}:
      {status:'answered',type:'noul',noul:0.9}])),attempts:1};}};
  const options={pdf,cache,sourceSha:info.file_sha256,pages,question:'Printed target',scope,readSet,signal:AbortSignal.timeout(30000),decision};
  const identified=await visualFunnel(options);
  assert.equal(calls.length,1);assert.equal(identified.leads.length,16);assert.ok(identified.leads.every(l=>l.status==='found'));
  calls.length=0;
  const located=await visualFunnel({...options,boxes:true});
  assert.equal(calls.length,17,'one coarse decision and sixteen direct localization requests');
  assert.ok(calls.slice(1).every(batch=>batch.questions.length===2));
  assert.ok(calls.slice(1).every(batch=>batch.state.page.image&&batch.state.sheet===undefined&&batch.questions.every(q=>q.target==='page')));
  assert.ok(located.leads.every(l=>l.box?.every((n,i)=>n===[0,0,1,1][i])));
  const single=await pdfVisualSheet(pdf,cache,[2],info.file_sha256,options.signal);
  assert.notEqual(single.image.width,single.image.height,'a portrait page is not embedded into a square');
  assert.deepEqual(single.tiles[0].rect,[0,0,1,1]);
});

test('an unusually narrow original gets only API-minimum padding with an explicit page rectangle',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'visual-narrow-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const file=join(cache,'narrow.pdf'),stream='q 0.8 0.8 0.8 rg 0 0 10 1000 re f Q';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 1000] /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let bytes='%PDF-1.4\n';const offsets=[0];
  for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(bytes));bytes+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(bytes);bytes+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(at=>String(at).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(file,bytes);const info=await sourceInfo(file);
  const sheet=await pdfVisualSheet(file,cache,[1],info.file_sha256,AbortSignal.timeout(10000));
  assert.equal(sheet.image.width,256);assert.equal(sheet.image.height,1568);
  assert.ok(sheet.tiles[0].rect[0]>0);assert.equal(sheet.tiles[0].rect[1],0);assert.equal(sheet.tiles[0].rect[3],1);
  assert.equal(originalPageBox({left:0,top:0,right:1,bottom:1},sheet.tiles[0].rect),undefined);
  const batch=base();batch.assets['owned-image-reference']=sheet.image;assert.doesNotThrow(()=>packDecisionBatch(batch));
});

test('ambiguous judgments refine while known found pages keep their first result',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'visual-ambiguous-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const info=await sourceInfo(pdf),calls=[];
  const decision={async decide(batch){calls.push(batch);return {status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,
    {status:'answered',type:'noul',noul:q.key==='p2'?0.9:['p3','p4'].includes(q.key)?(calls.length===1?0.45:0.9):0.01}])),attempts:1};}};
  const result=await visualFunnel({pdf,cache,sourceSha:info.file_sha256,pages:[1,2,3,4,5,6],question:'Printed target',scope,readSet,
    signal:AbortSignal.timeout(10000),decision});
  assert.equal(calls.length,2);assert.deepEqual(calls[1].questions.map(q=>q.key),['p3','p4']);
  assert.deepEqual(result.leads.map(l=>l.page),[2,3,4]);assert.equal(result.leads.find(l=>l.page===2).score,0.9);
});

test('production montage funnel retains several targets and uncertain pages, suppresses absent boxes, and keeps failures as leads',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'visual-funnel-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const info=await sourceInfo(pdf),calls=[];
  const options={pdf,cache,sourceSha:info.file_sha256,pages:[1,2,3,4,5,6],question:'Printed maps',scope,readSet,signal:AbortSignal.timeout(10000),boxes:true};
  const result=await visualFunnel({...options,decision:decisions(calls)});
  assert.deepEqual(result.leads.map(row=>row.page),[2,3,5]);assert.deepEqual(result.rejected,[1,4,6]);
  assert.ok(result.leads.find(row=>row.page===2).box);assert.equal(result.leads.find(row=>row.page===5).box,undefined);
  assert.equal(result.leads.find(row=>row.page===5).status,'uncertain');assert.equal(result.partial,true);
  assert.equal(calls[0].questions.length,6);assert.equal(calls.filter(batch=>batch.questions.some(q=>q.type==='box')).length,3);
  const failed=await visualFunnel({...options,pages:[1,2],decision:decisions([],{fail:true})});
  assert.equal(failed.partial,true);assert.deepEqual(failed.leads.map(row=>row.page),[1,2]);assert.deepEqual(failed.rejected,[]);
  await assert.rejects(visualFunnel({...options,signal:AbortSignal.abort(),decision:decisions([])}),/abort/i);
});

test('the actual visual asset driver supplies original pages and advisory mapped regions to the existing reader',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'visual-driver-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  const info=await sourceInfo(pdf),calls=[];
  await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'detail',visual_asset:{page:2},source:{page_count:info.page_count}}));
  const driver=await createSourceReaderDriver({cwd,env:{PI_COC_JEV_VISUAL:'on'},source:{pdf,cache:join(cwd,'cache')},adapter:decisions(calls)});
  const {ports}=await driver.prepare({runId:'visual-regression',inputRevision:'v1',rawInput:'Read the asset',session:{}});
  for(const operation of ['source.catalog','source.project'])assert.equal((await ports.operations.execute({origin:'policy',operation},{signal:AbortSignal.timeout(10000)})).status,'ok');
  const messages=ports.projection.project({}),packet=JSON.parse(messages[0].content[0].text);
  assert.ok(packet.advisory_visual_leads[0].box);assert.equal(messages[0].details.pages[0].page,2);
  assert.deepEqual(messages[0].details.pages[0].box,[0,0,1,1]);assert.equal(messages[0].content.filter(c=>c.type==='image').length,1);
  assert.equal(calls.length,1,'a single target page goes directly to the final existence and Box pass');
});

test('a lower-scored possibility stays available without paying for every refinement stage',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'visual-uncertain-'));t.after(()=>rm(cache,{recursive:true,force:true}));
  const info=await sourceInfo(pdf),calls=[],port=decisions(calls);
  const decision={async decide(batch,lease){const result=await port.decide(batch,lease);
    if(result.answers.p4)result.answers.p4={status:'answered',type:'noul',noul:0.2};
    if(result.answers.box2)result.answers.box2.confidence=0.4;return result;}};
  const result=await visualFunnel({pdf,cache,sourceSha:info.file_sha256,pages:[1,2,3,4,5,6],question:'Printed maps',
    scope,readSet,decision,signal:AbortSignal.timeout(10000),boxes:true});
  assert.equal(result.leads.find(row=>row.page===4).status,'uncertain');
  assert.equal(calls.filter(batch=>batch.questions.some(q=>q.key==='p4')).length,1);
  assert.equal(result.rejected.includes(4),false);
  assert.equal(result.leads.find(row=>row.page===2).boxStatus,'tentative');
  assert.ok(result.leads.find(row=>row.page===2).box);
});

test('an image-only page with a negative visual decision cannot close a current source need without the original reader',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'visual-empty-text-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  const imagePdf=join(cwd,'source.pdf'),stream='q 0.8 0.8 0.8 rg 10 10 80 80 re f Q';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let bytes='%PDF-1.4\n';const offsets=[0];
  for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(bytes));bytes+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(bytes);bytes+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(at=>String(at).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(imagePdf,bytes);
  const task={purpose:'detail',module_id:'book',focus:'Map',question:'Find the secret passage.',pages:[],source:{page_count:1},
    known_nodes:[{node_id:'scene-map',node_kind:'scene',name:'Map',summary:'A printed map.',source_refs:[{page:1}]}],known_claims:[],
    source_need:{key:'map-need',kind:'source_read',node_id:'scene-map',focus:'Map',question:'Find the secret passage.',reason:'Required now.',
      trigger:'Before completing this use.',source_refs:[{page:1}],accepted_pages:[1],material_digest:'d'.repeat(64),unread_units:[]}};
  await writeFile(join(cwd,'task.json'),JSON.stringify(task));
  const calls=[],decision={async decide(batch){calls.push(batch);return {batchId:batch.id,status:'complete',
    answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:0.01}])),
    coverage:{required:[],answered:[],unknown:[]},issues:[],attempts:1,usage:{inputTokens:100,outputTokens:1,costUsd:0.0000042}};}};
  const driver=await createSourceReaderDriver({cwd,env:{PI_COC_JEV_VISUAL:'on'},source:{pdf:imagePdf,cache:join(cwd,'cache')},adapter:decision});
  const {policy,ports}=await driver.prepare({runId:'negative-visual-need',inputRevision:'1',rawInput:'Read source',session:{}});
  let state=policy.initial({});
  for(let step=0;step<10;step++){
    const next=policy.next({policyState:state,pendingProposals:[],steps:step});
    assert.notEqual(next.kind,'finish','navigation cannot settle this current source need');
    if(next.kind==='infer')break;
    if(next.kind==='decide'){const result=await ports.decision.decide({...next,signal:AbortSignal.timeout(10000)});
      state=policy.reduce(state,{kind:'decide',...result},{});}
    else if(next.kind==='operate'){const result=await ports.operations.execute(next.proposals[0],{signal:AbortSignal.timeout(10000)});
      state=policy.reduce(state,{kind:'operate',origin:'policy',status:result.status,outcomes:[result]},{});}
  }
  assert.ok(calls.some(batch=>batch.family==='source-visual-funnel'));
  assert.equal(state.needSettled,false);assert.equal(state.projected,true);
});
