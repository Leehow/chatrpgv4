import {packDecisionBatch,JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourcePageQuestionState,createSourceReaderDriver,continueSourceSearch,topLevelSectionRanges,childSectionRanges,selectedEntrySourcePages,neighboringOpeningProbePages,assignedReviewPages,sourceFocusContext} from '../../runtime/jev/source-reader-driver.ts';

test('native fact review receives only assigned source pages while coverage retains its broader scope',()=>{
 const draft={nodes:[{source_refs:[{page:4}]},{source_refs:[{page:120}]}],claims:[{source_refs:[{page:9}]}]};
 assert.deepEqual(assignedReviewPages({required_review:['/nodes/0/properties/damage','/claims/0']},draft),[4,9]);
 assert.deepEqual(assignedReviewPages({required_review:['/nodes/-1']},draft),[120]);
 assert.deepEqual(assignedReviewPages({required_review:['/coverage'],review_scope_pages:[4,9,120]},draft),[4,9,120]);
});

test('the locator receives accepted focus context using the issued semantic scene handle',()=>{
 const node={node_id:'scene-old-friend',node_kind:'scene',name:'Old Friend',summary:'A friend asks for a meeting in the city.',
  source_refs:[{page:94}],properties:{runtime_projection:{record:{scene_id:'old-friend'}}}};
 assert.equal(sourceFocusContext('old-friend',[node])?.summary,node.summary);
 assert.equal(sourceFocusContext('an invented translated handle',[node]),null);
});

test('a source policy falls back to the real Pi reader and re-enters a new source need',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'source-driver-policy-'));
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'answer',module_id:'book',focus:'Current scene',question:'Who is present?',source:{page_count:2}}));
 const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf:join(cwd,'source.pdf'),cache:join(cwd,'cache')}});
 const {policy,maxSteps}=await driver.prepare({runId:'source-run',inputRevision:'v1',rawInput:'Read the source',session:{}});
 assert.ok(maxSteps>=2*800+16,'operation steps accommodate the existing maximum provider lease');
 const request=(state,lastObservation)=>policy.next({policyState:state,pendingProposals:[],lastObservation,steps:0});
 const observe=(state,observation)=>policy.reduce(state,observation,{});
 const initial=policy.initial({});
 assert.equal(request(initial).proposals?.[0].operation,'source.catalog');
 const unavailable=observe(initial,{kind:'operate',origin:'policy',status:'refused',outcomes:[]});
 assert.equal(request(unavailable).kind,'infer','an unavailable source decision cannot block the tool-enabled reader');
 let state=observe(initial,{kind:'operate',origin:'policy',status:'ok',outcomes:[{artifact:{kind:'catalog'}}]});
 assert.equal(request(state).kind,'decide');
 state=observe(state,{kind:'decide',status:'ok'});
 assert.equal(request(state).proposals?.[0].operation,'source.project');
 state=observe(state,{kind:'operate',origin:'policy',status:'ok',outcomes:[{artifact:{kind:'projected'}}]});
 assert.equal(request(state).kind,'infer');
 for(let call=0;call<25;call++){
   state=observe(state,{kind:'infer',status:'ok'});
   state=observe(state,{kind:'operate',origin:'model',status:'ok',outcomes:[]});
   assert.equal(request(state).kind,'infer');
 }
 state=observe(state,{kind:'infer',status:'ok'});
 state=observe(state,{kind:'operate',origin:'model',status:'ok',outcomes:[{artifact:{kind:'source_need'}}]});
 assert.equal(request(state).kind,'decide','the same run searches a newly requested source dependency');
 state=observe(state,{kind:'operate',origin:'model',status:'ok',outcomes:[{artifact:{kind:'source_submission'}}]});
 const finished=request(state);
 assert.deepEqual([finished.kind,finished.outcome,finished.reason],['finish','undelivered','checked_source_candidate_no_player_delivery']);
});

test('a checked source gap from submission re-enters native retrieval in the same opening run',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'source-gap-reentry-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'opening',module_id:'book',focus:'Dock',source:{page_count:2}}));
 const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf:join(cwd,'source.pdf'),cache:join(cwd,'cache'),file_sha256:'a'.repeat(64)}});
 const {policy,ports}=await driver.prepare({runId:'source-gap-run',inputRevision:'v1',rawInput:'Prepare the scene',session:{}});
 const need={kind:'source_read',focus:'Witness',question:'Which identity governs this conversation?',reason:'A current role is missing.',trigger:'Before preparing the interaction.',source_refs:[{page:1}]};
 const outcome=await ports.operations.execute({origin:'model',toolCall:{name:'submit_reading',arguments:{}}},{signal:AbortSignal.timeout(1000),
  executeModelTool:async()=>({content:[{type:'text',text:'Source gap retained'}],details:{kind:'source_need_batch',requests:[need]}})});
 assert.equal(outcome.artifact.kind,'source_need_batch');
 const state=policy.reduce({catalog:true,located:true,projected:true,submitted:false,fallback:false,inferred:true},
  {kind:'operate',origin:'model',status:'ok',outcomes:[outcome]},{});
 const next=policy.next({policyState:state,pendingProposals:[],lastObservation:{kind:'operate'},steps:3});
 assert.equal(next.kind,'decide');assert.equal(next.purpose,'classify_source_need');
});

test('the host consumes a literal PDF search cursor and retains incomplete coverage',async()=>{
 const calls=[];
 const initial={next_cursor:'cursor-50',truncated:true,scope:{searched_first_page:1,searched_last_page:50,complete:false},matches:[{page:8}],text_availability:{extraction_errors:[]}};
 const responses=[
  {next_cursor:'cursor-100',truncated:true,scope:{searched_first_page:51,searched_last_page:100,complete:false},matches:[],text_availability:{extraction_errors:[]}},
  {next_cursor:null,truncated:false,scope:{searched_first_page:101,searched_last_page:111,complete:false},matches:[{page:105}],text_availability:{extraction_errors:[]}}
 ];
 const result=await continueSourceSearch({query:'book'},initial,async options=>{calls.push(options.cursor);return responses.shift()},AbortSignal.timeout(1000));
 assert.deepEqual(calls,['cursor-50','cursor-100']);
 assert.deepEqual(result.matches.map(row=>row.page),[8,105]);
 assert.equal(result.next_cursor,null);
 assert.equal(result.coverage.complete,true);
 const capped=await continueSourceSearch({query:'book'},initial,async()=>responses[0]??{...initial,next_cursor:'still-open'},AbortSignal.timeout(1000),0);
 assert.equal(capped.coverage.complete,false);
 assert.equal(capped.next_cursor,'cursor-50');
});

test('a parent bookmark range includes its child pages until the next top-level section',()=>{
 const outline=[{name:'Introduction',page:5,children:[{name:'Character creation',page:8,children:[]}]},
  {name:'Opening',page:12,children:[{name:'Meeting',page:13,children:[]}]},
  {name:'Later chapter',page:40,children:[]}];
 assert.deepEqual(topLevelSectionRanges(outline,60),[
  {name:'Introduction',first:5,last:11},
  {name:'Opening',first:12,last:39},
  {name:'Later chapter',first:40,last:60}
 ]);
});

test('a long selected parent can narrow to child ranges without losing its preface',()=>{
 const parent={name:'Introduction',first:10,last:49};
 const children=[{name:'Book Structure',page:12},{name:'Preparing for Play',page:27},{name:'Key NPCs',page:33}];
 assert.deepEqual(childSectionRanges(parent,children),[
  {name:'Introduction (before child sections)',first:10,last:11},
  {name:'Book Structure',first:12,last:26},
  {name:'Preparing for Play',first:27,last:32},
  {name:'Key NPCs',first:33,last:49}
 ]);
});

test('a chosen accepted entrance reuses its source refs and retains alternate-start probes',()=>{
 const nodes=[{node_kind:'module',source_refs:[{page:11},{page:29}]},
  {node_kind:'scene',node_id:'scene-start-lima',name:'Start: Lima',source_refs:[{page:53},{page:64}]},
  {node_kind:'scene',node_id:'scene-the-big-apple',name:'The Big Apple',source_refs:[{page:94},{page:102}]}];
 assert.deepEqual(selectedEntrySourcePages('the-big-apple',nodes,669),{selected:[94,102,11,29],openingProbes:[53,94]});
 assert.equal(selectedEntrySourcePages('not-an-entry',nodes,669),null);
});

test('a possible opening keeps adjacent chapter starts available for independent review',()=>{
 const sections=[{name:'Optional prologue',first:50,last:93},{name:'Campaign beginning',first:94,last:101},
  {name:'Next chapter',first:102,last:179}];
 assert.deepEqual(neighboringOpeningProbePages(sections,[1]),[50,94,102]);
});


test('first-pass page decisions cross the real strict packing boundary without a follow-up need',()=>{
 const batch={id:'page-first-pass',model:JEV_MODEL,family:'source-page-lead',familyVersion:'1',scope:{owner:'test',audience:'keeper'},readSet:[],
  state:sourcePageQuestionState('Prepare the first interaction',undefined,null,[{page:1,text:'A road leads to the station.'}]),
  questions:[{key:'p1',target:'pages[0]',type:'noul',instructions:'Does this page contain the requested interaction?'}]};
 assert.doesNotThrow(()=>packDecisionBatch(batch));
});

// §150.4 (ticket 04): a background need read decides answered / unlocated / carried before any inference, with a fake
// decision port over a real four-page PDF and the driver's own policy and ports.
function needPdf(texts){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${texts.map((_,index)=>`${4+index*2} 0 R`).join(' ')}] /Count ${texts.length} >>`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(const [index,text] of texts.entries()){const stream=`BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`,
   `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
 let pdf='%PDF-1.7\n';const offsets=[0];
 for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf),size=objects.length+1;
 return pdf+`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const NEED_QUESTION='Any later appendix combat profile for Lena if printed separately';
/** A fake port: the answered Noul, and per-page need leads; every other facet stays under the lead gate. */
function needPort({answered=0.2,leads={},unavailable=false}={}){
 const batches=[];
 return {batches,async decide(batch){
  batches.push(batch);
  if(unavailable)return {batchId:batch.id,status:'unavailable',answers:{},coverage:{required:[],answered:[],unknown:[]},issues:[],failure:{code:'service_error',retryable:true}};
  const answers=Object.fromEntries(batch.questions.map(question=>{
   if(batch.family==='source-need-answered')return [question.key,{status:'answered',type:'noul',noul:answered}];
   const match=/^p(\d+)_source_need$/.exec(question.key);
   return [question.key,question.type==='noul'?{status:'answered',type:'noul',noul:match?leads[Number(match[1])]??0.05:0.05}
    :{status:'answered',type:'choice',choice:'none_of_the_above',confidence:0.9,probabilities:{none_of_the_above:1}}];
  }));
  return {batchId:batch.id,status:'complete',answers,coverage:{required:[],answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:1,outputTokens:0}};
 }};
}
async function needDriver(t,{port,unread=[],cache}){
 const cwd=await mkdtemp(join(tmpdir(),'source-need-driver-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const pdf=join(cwd,'source.pdf');
 await writeFile(pdf,needPdf(['Harbor. Lena keeps the ledgers at the dock.','The dock office and its clerks.','Appendix of later profiles.','Closing notes.']));
 const task={purpose:'detail',module_id:'book',focus:'lena',question:NEED_QUESTION,pages:[],source:{page_count:4},
  known_nodes:[{node_id:'npc-lena',node_kind:'npc',name:'Lena',summary:'A harbor clerk.',properties:{agenda:'Keeps the ledgers.',runtime_projection:{record:{}}},source_refs:[{page:1}],ready:true},
   {node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}]}],
  known_claims:[{subject_id:'npc-lena',predicate:'present-in',object:{node_id:'scene-dock'},truth_status:'authored-fact',reason:'She works at the dock.'}],
  source_need:{key:'need-key',kind:'deferred',node_id:'npc-lena',focus:'lena',question:NEED_QUESTION,reason:'Not printed here.',trigger:'If a fight starts.',
   source_refs:[{page:1}],accepted_pages:[1],material_digest:'d'.repeat(64),unread_units:unread}};
 await writeFile(join(cwd,'task.json'),JSON.stringify(task));
 const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf,cache:join(cache??join(cwd,'cache'),'pages')},adapter:port});
 const {policy,ports}=await driver.prepare({runId:'need-run',inputRevision:'v1',rawInput:'Read the source',session:{}});
 // Drive the policy's own decide/operate steps until it finishes or reaches a model step (projection or inference).
 let state=policy.initial({});
 for(let steps=0;steps<12;steps++){
  const next=policy.next({policyState:state,pendingProposals:[],steps});
  if(next.kind==='finish'||next.kind==='infer'||next.kind==='operate'&&next.proposals[0].operation==='source.project')
   return {next,cwd,receipt:await readFile(join(cwd,'need-disposition.json'),'utf8').then(JSON.parse,()=>null)};
  if(next.kind==='decide'){const outcome=await ports.decision.decide({question:next.question,signal:AbortSignal.timeout(10000)});
   state=policy.reduce(state,{kind:'decide',status:outcome.status,artifact:outcome.artifact},{});continue;}
  const outcome=await ports.operations.execute(next.proposals[0],{signal:AbortSignal.timeout(10000)});
  state=policy.reduce(state,{kind:'operate',origin:'policy',status:outcome.status,outcomes:[outcome]},{});
 }
 throw new Error('the source policy did not settle');
}

test('a need the accepted material answers settles before the catalog, with no locate and no inference',async t=>{
 const port=needPort({answered:0.95});
 const {next,receipt}=await needDriver(t,{port});
 assert.deepEqual([next.kind,next.reason],['finish','source_need_settled_without_reading']);
 assert.deepEqual(port.batches.map(batch=>batch.family),['source-need-answered'],'no page lead is asked for an answered need');
 const state=port.batches[0].state;
 assert.equal(state.question,NEED_QUESTION);
 assert.deepEqual(state.accepted_claims,[{subject:'Lena',predicate:'present-in',object:'Dock',note:'She works at the dock.'}]);
 assert.equal(state.entity.properties.runtime_projection,undefined,'kernel projection fields are not accepted material');
 assert.equal(port.batches[0].questions.length,1);
 assert.equal(receipt.disposition,'answered');assert.equal(receipt.distribution.noul,0.95);assert.equal(receipt.gate,0.85);
 assert.equal(receipt.key,'need-key');assert.equal(receipt.material_digest,'d'.repeat(64));
});

test('a need whose leads fall only on its accepted pages is retained unlocated, and the cached locate decides the same',async t=>{
 const cache=await mkdtemp(join(tmpdir(),'source-need-cache-'));t.after(()=>rm(cache,{recursive:true,force:true}));
 const port=needPort({leads:{1:0.9}});
 const {next,receipt}=await needDriver(t,{port,cache});
 assert.deepEqual([next.kind,next.reason],['finish','source_need_settled_without_reading']);
 assert.equal(receipt.disposition,'unlocated');
 assert.deepEqual(receipt.evidence.need_leads,[{page:1,score:0.9}]);assert.deepEqual(receipt.evidence.accepted_pages,[1]);
 const leadQuestions=port.batches.filter(batch=>batch.family==='source-page-lead').flatMap(batch=>batch.questions.map(question=>question.key));
 assert.ok(leadQuestions.includes('p3_source_need'),'every searched page is asked the need itself');
 const again=needPort({leads:{3:0.9}}),cached=await needDriver(t,{port:again,cache});
 assert.equal(cached.receipt.disposition,'unlocated');assert.equal(cached.receipt.evidence.cached,true);
 assert.deepEqual(again.batches.map(batch=>batch.family),['source-need-answered'],'the cached navigation keeps the need leads');
});

test('a need located only inside an unread source unit is carried by that unit, not read',async t=>{
 const unit={section:'Original pages 3-4',first:3,last:4};
 const {next,receipt}=await needDriver(t,{port:needPort({leads:{1:0.9,3:0.8}}),unread:[{section:'Original pages 1-2',first:1,last:2},unit]});
 assert.deepEqual([next.kind,next.reason],['finish','source_need_settled_without_reading']);
 assert.equal(receipt.disposition,'carried');assert.deepEqual(receipt.units,[unit]);
});

test('a need with a new located page outside unread units reads as today on its located pages',async t=>{
 const {next,receipt}=await needDriver(t,{port:needPort({leads:{3:0.8}})});
 assert.equal(next.kind,'operate');assert.equal(next.proposals[0].operation,'source.project');
 assert.equal(receipt.disposition,'read');
 assert.ok(receipt.evidence.candidates.includes(3),'the need facet lead joins the read candidates');
});

test('a Jev outage in the answered check and the locate reads as today',async t=>{
 const port=needPort({unavailable:true});
 const {next,receipt}=await needDriver(t,{port,unread:[{section:'Original pages 3-4',first:3,last:4}]});
 assert.equal(next.kind,'operate');assert.equal(next.proposals[0].operation,'source.project');
 assert.equal(receipt.disposition,'read');
 assert.ok(port.batches.some(batch=>batch.family==='source-need-answered')&&port.batches.some(batch=>batch.family==='source-page-lead'));
});

test('a review child and a task without a need never run the need decisions',async t=>{
 for(const variant of [{required_review:['/nodes/0']},{source_need:undefined}]){
  const cwd=await mkdtemp(join(tmpdir(),'source-need-none-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  await writeFile(join(cwd,'draft.json'),JSON.stringify({nodes:[{source_refs:[{page:1}]}]}));
  await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'detail',module_id:'book',focus:'lena',question:'q',source:{page_count:4},
   source_need:{key:'k',node_id:'npc-lena',question:'q',material_digest:'d'.repeat(64),accepted_pages:[],unread_units:[]},...variant}));
  const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf:join(cwd,'source.pdf'),cache:join(cwd,'cache')},adapter:needPort()});
  const {policy}=await driver.prepare({runId:'none',inputRevision:'v1',rawInput:'Read',session:{}});
  const first=policy.next({policyState:policy.initial({}),pendingProposals:[],steps:0});
  assert.notEqual(first.purpose,'check_source_need');
 }
});
