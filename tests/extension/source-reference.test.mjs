import assert from 'node:assert/strict';
import{test}from'node:test';
import{entryExcerpt,originalSpans,sourceNameTokens,selectReferencePacket,checkReferenceGuide}from'../../runtime/jev/source-reference.ts';
import{validateReferencePacket,referenceEntryExcerpt}from'../../kernel-ts/modules/reference-contract.ts';
import{createSourceReaderDriver}from'../../runtime/jev/source-reader-driver.ts';
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
