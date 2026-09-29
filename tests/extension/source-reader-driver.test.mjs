import {packDecisionBatch,JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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

/** A PDF whose pages carry native text, one line per page. */
function textPdf(lines){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${lines.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${lines.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(const [i,line] of lines.entries()){const stream=`BT /F1 10 Tf 10 100 Td (${line}) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
 let text='%PDF-1.7\n';const offsets=[];
 for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(text),size=objects.length+1;
 return text+`xref\n0 ${size}\n0000000000 65535 f \n${offsets.map(value=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

// §150.2.2: a targeted repair reads the refused records' own pages -- projected as original images with their native text --
// instead of locating the whole question again.
test('a targeted repair projects exactly the refused records\' pages without locating again',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'source-targeted-repair-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const pdf=join(cwd,'source.pdf');await writeFile(pdf,textPdf(['The harbor dock.','The old tower stands on the hill.','The cellar floods.']));
 const sha=createHash('sha256').update(await readFile(pdf)).digest('hex');
 await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'detail',module_id:'book',focus:'Tower',question:'',source:{page_count:3},
  repair:{draft:'draft.json',baseline:'baseline.json',findings:{},kind:'targeted',refused:[{path:'/claims/0',verdict:'unsupported',reason:'not stated'}],pages:[2]}}));
 const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf,cache:join(cwd,'cache','pages'),file_sha256:sha}});
 const {ports}=await driver.prepare({runId:'targeted-run',inputRevision:'v1',rawInput:'Repair the refused records',session:{}});
 const signal=AbortSignal.timeout(20000);
 assert.equal((await ports.operations.execute({origin:'policy',operation:'source.catalog',readOnly:true},{signal})).status,'ok');
 const located=await ports.decision.decide({question:{kind:'source_pages'},signal});
 assert.deepEqual([located.status,located.artifact.pages],['ok',[2]]);
 assert.equal((await ports.operations.execute({origin:'policy',operation:'source.project',readOnly:true},{signal})).artifact.original_images,1);
 const [message]=ports.projection.project();
 assert.deepEqual(message.details.pages.map(row=>row.page),[2],'only the refused record\'s page is supplied as an image');
 const navigation=JSON.parse(message.content[0].text);
 assert.deepEqual(navigation.pages.map(row=>[row.page,row.text.includes('tower')]),[[2,true]],'with its native text');
});
