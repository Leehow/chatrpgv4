import assert from 'node:assert/strict';
import{test}from'node:test';
import{entryExcerpt,originalSpans,sourceNameTokens,selectReferencePacket,checkReferenceGuide}from'../../runtime/jev/source-reference.ts';
import{validateReferencePacket,referenceEntryExcerpt}from'../../kernel-ts/modules/reference-contract.ts';
import{createSourceReaderDriver}from'../../runtime/jev/source-reader-driver.ts';
import{packDecisionBatch}from'../../runtime/jev/question-packing.ts';
import{mkdtemp,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
const sourceSha='a'.repeat(64);
test('host source spans reconstruct the original bytes and never normalize or paraphrase content',()=>{
 const text='First line.\n'+('  Exact punctuation — and whitespace.\n'.repeat(60));
 const spans=originalSpans([{page:7,text}],900);
 assert.equal(spans.map(x=>x.text).join(''),text);
 for(const s of spans)assert.equal(text.slice(s.start,s.end),s.text);
});
test('source selection returns host copies and source-backed entrance handles without an author',async()=>{
 const pages=[{page:1,text:'Scenario starts at Harbor in 1925. Players may choose any investigator.'}];let questions=0;
 const packet=await selectReferencePacket({pages,allPages:pages,bookmarks:[{name:'Harbor opening',page:1,children:[]}],sourceSha,pageCount:1,extractionVersion:'fixture',purpose:'guidance',question:'Character creation',signal:AbortSignal.timeout(1000),
  decide:async batch=>{questions+=batch.questions.length;return{status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:.95}]))}}});
 assert.ok(questions>0);assert.equal(packet.excerpts[0].text,pages[0].text);
 assert.deepEqual(packet.entries,[{id:'scene-source-entry-1',name:'Harbor opening',page:1,excerpt_id:`p1-0-${pages[0].text.length}`}]);
 assert.equal(packet.visual_coverage,'unassessed');assert.equal(packet.partial,true);
 assert.throws(()=>validateReferencePacket({...packet,source_sha256:'b'.repeat(64)},1,sourceSha));
 assert.throws(()=>validateReferencePacket({...packet,excerpts:[{...packet.excerpts[0],end:1}]},1,sourceSha));
});
test('guide quality failures carry actionable criteria rather than authoring another dossier',async()=>{
 const result=await checkReferenceGuide({packet:{},text:'An introduction',signal:AbortSignal.timeout(1000),decide:async batch=>({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='plot_disclosure'?.95:.02}]))})});
 assert.equal(result.approved,false);assert.deepEqual(result.issues.map(x=>x.key),['plot_disclosure']);assert.match(result.issues[0].instruction,/hidden antagonist/);
});
test('a long guide retains all checks and candidate sentences in bounded ordinary batches',async()=>{
 const text=Array.from({length:32},(_,i)=>`The traveler ${i} crosses the harbor with a companion and may choose a suitable profession before beginning this investigation.`).join(' ');
 const source='Original source context. '.repeat(500),batches=[];
 const result=await checkReferenceGuide({packet:{excerpts:[{id:'context',page:1,text:source}],fields:{premise:['context']}},text,
  signal:AbortSignal.timeout(1000),decide:async batch=>{
   packDecisionBatch(batch);batches.push(batch);
   return {status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='choice'?{status:'answered',type:'choice',choice:'none',confidence:1}:{status:'answered',type:'noul',noul:.01}]))};
  }});
 assert.equal(result.approved,true);assert.ok(batches.length>1);
 assert.equal(batches.flatMap(batch=>batch.questions).length,10);
 assert.ok(batches.every(batch=>!batch.longContext));
 assert.ok(batches.every(batch=>batch.model==='jev-1.14.0'));
 for(const batch of batches){assert.equal(batch.state.guide,text);assert.equal(batch.state.source[0].text,source);}
});
test('large source context uses one bounded Jev 1.14 long-context batch without losing checks',async()=>{
 const spans=Array.from({length:4},(_,i)=>({id:'span'+i,page:i+1,text:'Source context. '.repeat(625)})),batches=[];
 const result=await checkReferenceGuide({packet:{excerpts:spans,fields:{premise:spans.map(span=>span.id)}},text:'Choose a character at the harbor.',
  signal:AbortSignal.timeout(1000),decide:async(batch,lease)=>{
   const {estimate}=packDecisionBatch(batch);assert.ok(lease.context.budget.remainingInputTokens>=estimate.totalUpperBound);batches.push(batch);
   return {status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='choice'?{status:'answered',type:'choice',choice:'none',confidence:1}:{status:'answered',type:'noul',noul:.01}]))};
  }});
 assert.equal(result.approved,true);assert.equal(batches.length,1);assert.equal(batches[0].longContext,true);
 assert.equal(batches[0].model,'jev-1.14.0');assert.equal(batches[0].questions.length,10);
 assert.deepEqual(batches[0].state.source,spans.map(({page,text})=>({page,text})));
});
test('source context beyond long-context capacity refuses before dispatch rather than truncating evidence',async()=>{
 let calls=0;const spans=Array.from({length:28},(_,i)=>({id:'span'+i,page:i+1,text:'Source context. '.repeat(625)}));
 await assert.rejects(checkReferenceGuide({packet:{excerpts:spans,fields:{premise:spans.map(span=>span.id)}},text:'Choose a character at the harbor.',
  signal:AbortSignal.timeout(1000),decide:async()=>{calls++;throw Error('Must not dispatch');}}),error=>error.failure==='packing_limit');
 assert.equal(calls,0);
});
test('an unavailable guide check retains its failure code and cannot become a prose repair',async()=>{
 await assert.rejects(checkReferenceGuide({packet:{},text:'A public introduction.',signal:AbortSignal.timeout(1000),
  decide:async()=>({status:'unavailable',answers:{},failure:{code:'service_error',retryable:true}})}),
  error=>error.reason==='service_error'&&error.retryable===true);
});
test('orientation review judges the delivered guide even when its source already supplies the missing premise',async()=>{
 const source='1925, Harbor. You are local fishers returning home to a silent quay.',text='Harbor, 1925. Who are you, and why would you come here?';
 let captured;
 const result=await checkReferenceGuide({packet:{excerpts:[{id:'premise',page:1,text:source}],fields:{premise:['premise']}},text,signal:AbortSignal.timeout(1000),decide:async batch=>{
  captured=batch;
  return{status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='choice'?{status:'answered',type:'choice',choice:'none',confidence:.95}:{status:'answered',type:'noul',noul:q.key==='wrong_orientation'?.95:.02}]))};
 }});
 assert.equal(captured.state.guide,text);
 assert.deepEqual(captured.state.source,[{page:1,text:source}]);
 const question=captured.questions.find(q=>q.key==='wrong_orientation');
 for(const requirement of ['delivered guide alone','character role','why that character is here','current situation','character name and role','shared starting premise'])assert.ok(question.instructions.includes(requirement),requirement);
 assert.equal(result.approved,false);
 assert.deepEqual(result.issues.map(row=>row.key),['wrong_orientation']);
 assert.equal(result.issues[0].instruction,question.instructions,'the same actionable finding reaches the existing repair');
});
test('the real native source driver exposes a text-only final guidance tool for reference tasks',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'source-reference-driver-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'guidance',source_reference:'guidance',module_id:'book',source:{page_count:1}}));
 const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf:join(cwd,'source.pdf'),cache:join(cwd,'cache')}});
 const registered=[];driver.registerSourceRequest({registerTool:tool=>registered.push(tool)});
 const submit=registered.find(x=>x.name==='submit_reference_guidance');assert.ok(submit);
 assert.deepEqual(submit.parameters.required,['text']);assert.equal(submit.parameters.properties.draft,undefined);
});

test('source entry context starts at its exact heading after unrelated material',()=>{const text='Private preceding biography.\nA MESSAGE FROM\nAN OLD FRIEND\nMeet in the city.';const span=entryExcerpt({page:94,text},'A Message from an Old Friend');assert.equal(span.text,'A MESSAGE FROM\nAN OLD FRIEND\nMeet in the city.');assert.equal(text.slice(span.start,span.end),span.text);});

test('a moderate place-heading candidate reaches original-page confirmation before publication',async()=>{
 const pages=[{page:1,text:'Esso station. The attendant stands at the pumps.'}];let confirmations=0;
 const packet=await selectReferencePacket({pages,allPages:pages,bookmarks:[{name:'Esso station',page:1}],sourceSha,pageCount:1,extractionVersion:'fixture',purpose:'answer',question:'The town gas station',materializePlace:true,signal:AbortSignal.timeout(1000),
  decide:async batch=>({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>{if(q.key==='concrete')confirmations++;return[q.key,q.type==='choice'?{status:'answered',type:'choice',choice:'p0',confidence:.71}:{status:'answered',type:'noul',noul:.95}]}))})});
 assert.equal(confirmations,1);assert.equal(packet.places[0].name,'Esso station');assert.equal(packet.excerpts[0].text,pages[0].text);
});

test('a PDF without bookmarks selects an evidenced opening rather than requiring visual graph preparation',async()=>{
 const pages=[{page:1,text:'Copyright\nThis page is front matter.'},{page:2,text:'The first morning\nYou receive a letter at Harbor in 1925.'}];
 const packet=await selectReferencePacket({pages,allPages:pages,bookmarks:[],sourceSha,pageCount:2,extractionVersion:'fixture',purpose:'guidance',question:'Character creation',signal:AbortSignal.timeout(1000),
  decide:async batch=>({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='choice'?{status:'answered',type:'choice',choice:batch.family==='source-reference-text-entrances'&&batch.state.page===2?'l0':'none',confidence:.95}:{status:'answered',type:'noul',noul:.95}]))})});
 assert.deepEqual(packet.entries,[{id:'scene-source-entry-2',name:'The first morning',page:2,excerpt_id:`p2-0-${pages[1].text.length}`}]);
 for(const span of packet.excerpts)assert.equal(pages.find(p=>p.page===span.page).text.slice(span.start,span.end),span.text);
});

test('an entry uses its bound original excerpt rather than the last handout on the same page',()=>{
 const entry={id:'scene-source-entry-4',name:'Initial scene',page:4,excerpt_id:'opening'},opening={id:'opening',page:4,start:0,end:24,text:'Initial scene. Read now.'},later={id:'later',page:4,start:24,end:44,text:'Tomorrow handout two'};
 const packet={excerpts:[opening,later],fields:{opening:['opening','later']}};
 assert.equal(referenceEntryExcerpt(packet,entry),opening);
 assert.equal(referenceEntryExcerpt(packet,{...entry,excerpt_id:undefined}),opening,'legacy packets retain the earliest matching entry');
});

test('a place mentioned only in prose gets an exact source identity, and failed name confirmation publishes none',async()=>{
 const text='The night watchman works at Church Cemetery. He saw nothing.',pages=[{page:1,text}],tokens=sourceNameTokens(text);
 for(const [confirmed,same] of [[true,true],[false,true],[true,false]]){
  const packet=await selectReferencePacket({pages,allPages:pages,bookmarks:[],sourceSha,pageCount:1,extractionVersion:'fixture',purpose:'answer',question:'Go to the church cemetery',materializePlace:true,signal:AbortSignal.timeout(1000),
   decide:async batch=>({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='choice'?{status:'answered',type:'choice',choice:q.key==='excerpt'?'e0':'t'+tokens.findIndex(t=>t.text===(q.key==='start'?'Church':'Cemetery')),confidence:.95}:{status:'answered',type:'noul',noul:q.key==='concrete'&&!confirmed||q.key==='same_place'&&!same?.1:.95}]))})});
  if(confirmed&&same){assert.equal(packet.places[0].name,'Church Cemetery');assert.equal(packet.places[0].id,'scene-source-place-1-'+text.indexOf('Church'));}
  else assert.equal(packet.places,undefined);
 }
});
