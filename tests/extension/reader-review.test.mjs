import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {reviewCandidate,reviewUnits,checkReviewEvidence,detailReviewInput,readReviewPlan,REVIEW_PLAN_FILE} from '../../extensions/module/reader-review.ts';
import {createRuntime} from '../../runtime/host.ts';

test('opening review retains kernel-issued retranscription pointers and reviews the interaction choice once',()=>{
 const draft={nodes:[{node_id:'scene-entry',source_refs:[{page:1}],properties:{}}],claims:[],ready_nodes:['scene-entry'],
  critical:['/interaction_scene'],interaction_scene:'scene-entry',coverage:{},dependencies:[],node_refs:[]};
 const units=reviewUnits(draft,['/nodes/0/visibility','/interaction_scene']);
 assert.ok(units.some(paths=>paths.includes('/nodes/0')&&paths.includes('/nodes/0/visibility')));
 assert.equal(units.flat().filter(path=>path==='/interaction_scene').length,1);
 assert.ok(units.some(paths=>paths.includes('/coverage')&&paths.includes('/interaction_scene')));
 const input=detailReviewInput({purpose:'opening',opening_scope:'first_interaction'},draft,['/coverage','/interaction_scene']);
 assert.equal(input.task.opening_scope,'first_interaction');
 assert.equal(input.coverage_context.interaction_scene,'scene-entry');
});

test('bounded first-interaction review packs nearby evidence without losing any required pointer',()=>{
 const draft={nodes:Array.from({length:9},(_,i)=>({node_id:'npc-'+i,source_refs:[{page:i%3+1}],properties:{value:i}})),claims:[],critical:[],ready_nodes:['npc-0'],coverage:{}};
 const ordinary=reviewUnits(draft).flat().sort(),packed=reviewUnits(draft,[],4);
 assert.deepEqual(packed.flat().sort(),ordinary);
 assert.equal(packed.length,3,'eight fact records, one remaining fact, and independent coverage');
 assert.deepEqual(packed.at(-1),['/coverage']);
});

test('module logic detail review shares bounded page context and keeps independent coverage',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'logic-review-groups-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const draft={nodes:Array.from({length:8},(_,i)=>({node_id:'npc-'+i,source_refs:[{page:i%3+1}],properties:{score:50}})),claims:[],critical:[],ready_nodes:['npc-0'],coverage:{}};
 const assigned=[];
 await reviewCandidate({cwd,task:{purpose:'detail',review_policy:'module-logic-v1',source:{page_count:3}},draft,instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,record(){},progress(){},
  async run(request){
   const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));assigned.push(task.required_review);
   const seen=[1,2,3];request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:seen.map(page=>({page}))}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:seen.map(page=>({page}))}],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }});
 assert.equal(assigned.length,2,'one bounded fact group and a separate omission/coverage group');
 assert.deepEqual(assigned.flat().sort(),['/coverage',...draft.nodes.map((_,i)=>'/nodes/'+i)].sort());
});

test('detail first input preserves original pointers and connected context without authoring catalogs',()=>{
 const draft={nodes:[{node_id:'scene-road',source_refs:[{page:1}],properties:{difficulty:2}},{node_id:'npc-guide',source_refs:[{page:2}],properties:{}}],claims:[{subject_id:'npc-guide',predicate:'present-in',object:{node_id:'scene-road'}}],ready_nodes:['scene-road'],coverage:{setting:'prepared'},dependencies:[],node_refs:[]};
 const task={purpose:'detail',focus:'Road',question:'What is visible now?',source:{page_count:20},required_review:['/nodes/0','/nodes/0/properties/difficulty'],index:[{name:'Unrelated appendix'}],vocabulary:{large:'x'.repeat(30000)},known_nodes:[{node_id:'module-book',node_kind:'module',summary:'Global source setting'},{node_id:'scene-road',summary:'Accepted road'},{node_id:'npc-guide',summary:'Accepted guide'},{node_id:'npc-elsewhere',summary:'Omitted but retained'}],known_claims:[{subject_id:'npc-guide',predicate:'present-in',object:{node_id:'scene-road'}},{subject_id:'npc-elsewhere',predicate:'present-in',object:{node_id:'scene-elsewhere'}}]};
 const before=JSON.stringify({task,draft}),input=detailReviewInput(task,draft,task.required_review);
 assert.deepEqual(input.task.required_review,task.required_review);assert.deepEqual(Object.keys(input.review_records),['/nodes/0']);
 assert.deepEqual(input.review_records['/nodes/0'],draft.nodes[0]);
 assert.deepEqual(input.known_context.nodes.map(n=>n.node_id),['module-book','scene-road','npc-guide']);
 assert.deepEqual(input.candidate_context.nodes,[draft.nodes[1]]);assert.equal(input.known_context.claims.length,1);
 assert.equal(input.task.vocabulary,undefined);assert.equal(input.task.index,undefined);assert.equal(input.omitted_context.known_nodes,1);
 assert.equal(input.omitted_context.full_task,'task.json');assert.equal(input.omitted_context.full_candidate,'draft.json');
 assert.equal(JSON.stringify({task,draft}),before);assert.ok(JSON.stringify(input).length<JSON.stringify({task,draft}).length/5);
 const coverage=detailReviewInput({...task,required_review:['/coverage'],review_scope_pages:[1,2]},draft,['/coverage']);
 assert.deepEqual(Object.keys(coverage.review_records),['/nodes/0','/nodes/1','/claims/0']);assert.deepEqual(coverage.task.review_scope_pages,[1,2]);assert.deepEqual(coverage.coverage_context.ready_nodes,['scene-road']);
});

test('focused records retain legal negative and signed array pointer spellings',()=>{
 const draft={nodes:[{node_id:'scene-first',properties:{'a/b':1}},{node_id:'scene-last',properties:{danger:2}}],claims:[]};
 for(const [spelling,index] of [['-1',1],['+0',0],['00',0],[' 1 ',1]]){
  const path=`/nodes/${spelling}/properties/${index?'danger':'a~1b'}`,task={purpose:'detail',required_review:[path]};
  const input=JSON.parse(JSON.stringify(detailReviewInput(task,draft,[path])));
  assert.deepEqual(input.task.required_review,[path]);
  assert.deepEqual(input.review_records[`/nodes/${spelling}`],draft.nodes[index]);
 }
});

test('review grouping retains numeric children and critical nested pointers',()=>{
 const groups=reviewUnits({nodes:[{properties:{mechanics:{HP:10},image_sources:[{page:2}]}}],claims:[],critical:['/nodes/0/properties/mechanics']});
 assert.deepEqual(groups,[['/nodes/0','/nodes/0/properties/mechanics/HP','/nodes/0/properties/mechanics']]);
});

test('prepared scopes get an independent coverage unit even without proposed investigation nodes',()=>{
 const draft={nodes:[{node_id:'scene-room',properties:{},source_refs:[{page:1}]}],claims:[],critical:[],coverage:{},ready_nodes:['scene-room']};
 assert.deepEqual(reviewUnits(draft),[['/nodes/0'],['/coverage']]);
 assert.deepEqual(reviewUnits({...draft,ready_nodes:[]}),[['/nodes/0']]);
});

test('scope coverage must observe its own source pages, not only report a supported verdict',()=>{
 const review={checked:[{path:'/coverage',verdict:'supported',source_refs:[{page:1}]}],missing:[]};
 assert.throws(()=>checkReviewEvidence(review,['/coverage'],new Set([1]),[1,2]),/did not view every assigned source page/);
 assert.doesNotThrow(()=>checkReviewEvidence(review,['/coverage'],new Set([1,2]),[1,2]));
});

test('only coverage receives all observed pages while every unit retains the exact requested use',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-scope-review-')),tasks=[];
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 const pages=await reviewCandidate({cwd,task:{purpose:'detail',focus:'Room',question:'Prepare the authored map and safe reveal regions.',review_scope_pages:[1,2]},
 draft:{nodes:[{node_id:'scene-room',properties:{},source_refs:[{page:1}]}],claims:[],coverage:{},ready_nodes:['scene-room']},
 instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,
 record(){},progress(){},async run(request){
  const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));tasks.push(task);
  const scope=task.required_review.includes('/coverage'),seen=scope?[1,2]:[1];
  request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:seen.map(page=>({page}))}}});
  await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
  await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:seen.map(page=>({page})),reason:'Compared this assigned scope.'}],missing:scope?['A sourced discoverable proposition is absent.']:[]}));
  return {ok:true,ms:1,stderr:''};
 }});
 assert.deepEqual(pages.sort(),[1,2]);
 assert.equal(tasks.filter(task=>task.required_review.includes('/coverage')).length,1);
 for(const task of tasks){
  assert.equal(task.focus,'Room');
  assert.equal(task.question,'Prepare the authored map and safe reveal regions.');
  assert.deepEqual(task.review_scope_pages,task.required_review.includes('/coverage')?[1,2]:undefined);
 }
 const review=JSON.parse(await readFile(join(cwd,'review.json'),'utf8'));
 assert.deepEqual(review.missing,['A sourced discoverable proposition is absent.']);
 assert.ok(review.checked.some(item=>item.paths.includes('/coverage')));
});

test('a large review packet stays line-readable so coverage can see every assigned page',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-readable-review-task-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 let sawLarge=false;
 const index=Array.from({length:120},(_,i)=>({name:`Section ${i}`,topics:[`bounded-${i}-${'x'.repeat(600)}`]}));
 const pages=await reviewCandidate({cwd,task:{purpose:'detail',focus:'Time circle',question:'How does the table return?',review_scope_pages:[4,15],index},
  draft:{nodes:[{node_id:'rule-return',source_refs:[{page:4}],properties:{}}],claims:[],coverage:{},ready_nodes:['rule-return']},
  instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,
  record(){},progress(){},async run(request){
   const raw=await readFile(join(request.cwd,'task.json'),'utf8'),task=JSON.parse(raw);
   sawLarge ||= Buffer.byteLength(raw)>50_000;
   assert.equal(request.submission,true);
   assert.ok(!request.brief.includes('bounded-119-'),'the full navigation catalog is not initial reviewer input');
   const focused=JSON.parse(await readFile(join(request.cwd,'review-input.json'),'utf8'));
   assert.equal(focused.task.index,undefined);assert.deepEqual(focused.task.required_review,task.required_review);
   assert.ok(Math.max(...raw.split('\n').map(line=>Buffer.byteLength(line)))<50_000,'no packet line exceeds the reader limit');
   const seen=task.required_review.includes('/coverage')?task.review_scope_pages:[4];
   request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:seen.map(page=>({page}))}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:seen.map(page=>({page}))}],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }});
 assert.equal(sawLarge,true);
 assert.deepEqual(pages.sort((a,b)=>a-b),[4,15]);
});

test('guidance review inspects a host-assigned alternate entrance outside the author citations',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'guidance-opening-omission-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const nested='/nodes/1/properties/investigator_setup/place';
 const draft={nodes:[{node_id:'module-book',node_kind:'module',source_refs:[{page:1}],properties:{}},
  {node_id:'scene-prologue',node_kind:'scene',source_refs:[{page:1}],properties:{is_entrance:true,investigator_setup:{place:'Lima'}}}],claims:[],ready_nodes:[]};
 await writeFile(join(cwd,'draft.json'),JSON.stringify(draft));
 await writeFile(join(cwd,'guidance.json'),JSON.stringify({opening:'An opening question.',advice:'Source advice.',scene:'Prologue',guide:'',handoff:'Continue.'}));
 const publicFields=Object.fromEntries(['era','starting_place','public_premise','creation_advice'].map(field=>[field,{status:'value',text:'Public '+field,source_refs:[{page:2}]}]));
 await writeFile(join(cwd,'public-fields.json'),JSON.stringify(publicFields));
 const observed=await reviewCandidate({cwd,task:{purpose:'guidance',focus:'',review_scope_pages:[1,94],required_review:['/nodes/0','/nodes/1',nested],source:{page_count:100}},draft,
  instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,
  record(){},progress(){},async run(request){
   const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));
   assert.deepEqual(task.review_scope_pages,[1,2,94]);
   assert.deepEqual(JSON.parse(await readFile(join(request.cwd,'public-fields.json'),'utf8')),publicFields);
   assert.match(request.brief,/public_fields/);
   assert.ok(task.required_review.includes(nested));
   request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:[{page:1},{page:2},{page:94}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:[{page:1},{page:94}]}],
    missing:['The authored later entrance on physical page 94 was omitted.'],guidance:{approved:false,issues:['Present both starts.']}}));
   return {ok:true,ms:1,stderr:''};
  }});
 assert.deepEqual(observed.sort((a,b)=>a-b),[1,2,94]);
 assert.match(JSON.parse(await readFile(join(cwd,'review.json'),'utf8')).guidance.public_fields_sha256,/^[a-f0-9]{64}$/);
});

test('an oversized focused input names its own readable file instead of forcing full-task ingestion',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-focused-review-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await reviewCandidate({cwd,task:{purpose:'detail',focus:'Road',question:'What is visible?',vocabulary:{noise:'not-needed'}},draft:{nodes:[{node_id:'scene-road',summary:'x'.repeat(30000),source_refs:[{page:1}],properties:{}}],claims:[]},instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,record(){},progress(){},async run(request){
  assert.match(request.brief,/^Read review-input.json/);assert.equal(request.submission,true);
  const focused=JSON.parse(await readFile(join(request.cwd,'review-input.json'),'utf8'));
  assert.equal(focused.review_records['/nodes/0'].summary.length,30000);
  assert.equal(JSON.parse(await readFile(join(request.cwd,'draft.json'),'utf8')).nodes[0].summary.length,30000);
  const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));
  request.onEvent({type:'tool_execution_end',toolCallId:'p',isError:false,result:{details:{kind:'source_pages',observations:[{page:1}]}}});
  await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['p']})+'\n');
  await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:[{page:1}]}],missing:[]}));
  return{ok:true,ms:1,stderr:''};
 }});
});

test('omitted fields retry only their unit and retained complete units survive a resumed batch',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-omission-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const counts=new Map(),records=[];let omit=true;
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture',task:{purpose:'detail',focus:'Room',question:'',review_scope_pages:[1,2,3]},
  draft:{nodes:[{node_id:'scene-room',source_refs:[{page:1}],properties:{}},{node_id:'rule-cold',source_refs:[{page:2}],properties:{temperature:3}}],claims:[],ready_nodes:['scene-room']},
  instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(row){records.push(row)},
  async run(request){
   const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8')),root=task.required_review[0];
   counts.set(root,(counts.get(root)||0)+1);
   const pages=root==='/coverage'?[1,2,3]:root==='/nodes/0'?[1]:[2];
   assert.equal(task.question,'');
   request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:pages.map(page=>({page}))}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   const paths=omit&&root==='/nodes/1'?[root]:task.required_review;
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths,verdict:'supported',source_refs:pages.map(page=>({page}))}],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }};
 await assert.rejects(reviewCandidate(options),/review omitted assigned fields/);
 assert.equal(counts.get('/nodes/0'),1);assert.equal(counts.get('/coverage'),1);assert.equal(counts.get('/nodes/1'),2);
 omit=false;
 assert.deepEqual((await reviewCandidate({...options,round:2})).sort(),[1,2,3]);
 assert.equal(counts.get('/nodes/0'),1);assert.equal(counts.get('/coverage'),1);assert.equal(counts.get('/nodes/1'),3);
 assert.equal(records.filter(row=>row.reused).length,2);
 const review=JSON.parse(await readFile(join(cwd,'review.json'),'utf8'));
 assert.ok(review.checked.some(row=>row.paths.includes('/nodes/1/properties/temperature')));
});

test('a source reviewer keeps recovered provider errors as evidence without repeating the review',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-recovered-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 let runs=0;const rows=[];
 const pages=await reviewCandidate({cwd,task:{},draft:{nodes:[{properties:{}}],claims:[]},instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,progress(){},record(row){rows.push(row)},
  async run(request){
   runs++;
   request.onEvent({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'Provider 500'}});
   request.onEvent({type:'auto_retry_end',success:true});
   request.onEvent({type:'tool_execution_end',toolCallId:'page-call',isError:false,result:{details:{kind:'source_pages',observations:[{page:1}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['page-call']})+'\n');
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{path:'/nodes/0',source_refs:[{page:1}],verdict:'supported',reason:'Fixture evidence'}],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }});
 assert.equal(runs,1);
 assert.deepEqual(pages,[1]);
 // Each row says which unit and attempt it is, and the verify row which physical pages that reviewer viewed (#65).
 const concurrency=rows.find(row=>row.event==='review_concurrency');
 assert.deepEqual([concurrency.unit,concurrency.attempt],[1,1]);
 const verified=rows.find(row=>row.phase==='verify');
 assert.deepEqual([verified.unit,verified.attempt,verified.pages,verified.ok],[1,1,[1],true]);
});

test('forty source reviewers run concurrently and all owned children drain on cancellation',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-pool-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const abort=new AbortController();let active=0,peak=0;
 const draft={nodes:Array.from({length:45},(_,i)=>({node_id:`npc-${i}`,properties:{}})),claims:[],critical:[]};
 const work=reviewCandidate({cwd,task:{},draft,instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:abort.signal,progress(){},record(){},
   async run(request){active++;peak=Math.max(peak,active);await new Promise(resolve=>request.signal.addEventListener('abort',resolve,{once:true}));active--;return {ok:false,stderr:'cancelled'};}});
 const deadline=Date.now()+3000;
 while(peak<40&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(peak,40);abort.abort();await assert.rejects(work,/cancelled/);assert.equal(active,0);
});

test('source and review runs share forty permits and cancelled waiters consume none',async()=>{
 const {acquireReaderSlot}=await import('../../extensions/module/reader.ts');
 const permits=await Promise.all(Array.from({length:40},()=>acquireReaderSlot()));
 const abort=new AbortController();const cancelled=acquireReaderSlot(abort.signal);abort.abort();assert.equal(await cancelled,null);
 let granted=false;const waiting=acquireReaderSlot().then(release=>{granted=true;return release});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(granted,false);
 permits.pop()();const last=await waiting;assert.equal(granted,true);
 for(const release of permits)release();last();last();
 const reusable=await acquireReaderSlot();reusable();
});

test('every independent reviewer attempt uses the owner timeout despite ambient changes', {timeout:5000}, async t => {
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-timeout-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const prior=process.env.PI_COC_READER_TIMEOUT_MS;
 t.after(()=>{if(prior===undefined)delete process.env.PI_COC_READER_TIMEOUT_MS;else process.env.PI_COC_READER_TIMEOUT_MS=prior;});
 const runtime=createRuntime({owner:'preparation',home:cwd},{resourceRoot:resolve(import.meta.dirname,'../..'),env:{...process.env,
  PI_COC_READER_TIMEOUT_MS:'80',PI_COC_READER_CMD:JSON.stringify([process.execPath,'-e','setInterval(()=>{},1000)'])}});
 t.after(()=>runtime.close());
 const outcomes=[];
 const options={cwd,task:{},draft:{nodes:[{properties:{}},{properties:{}}],claims:[]},instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,progress(){},record(){},
  async run(request){const result=await runtime.runTask({kind:'reader',request},request.signal);outcomes.push(result);return result;}};
 process.env.PI_COC_READER_TIMEOUT_MS='600000';
 await assert.rejects(reviewCandidate(options),/reviewer timed out/);
 assert.equal(outcomes.length,4);assert.ok(outcomes.every(result=>result.timedOut && !result.ok));
 outcomes.length=0;process.env.PI_COC_READER_TIMEOUT_MS='0';
 await assert.rejects(reviewCandidate({...options,round:2}),/reviewer timed out/);
 assert.equal(outcomes.length,4);assert.ok(outcomes.every(result=>result.timedOut && !result.ok));
});

test('source-page groups bound work without dropping root, numeric or critical checks',()=>{
 const nodes=Array.from({length:10},(_,i)=>({node_id:`npc-${i}`,source_refs:[{page:2}],properties:{HP:i+1}}));
 const groups=reviewUnits({nodes,claims:[{source_refs:[{page:3}]}],critical:['/nodes/9/properties']});
 assert.equal(groups.length,3);
 const paths=groups.flat();assert.equal(new Set(paths).size,paths.length);
 for(let i=0;i<10;i++){assert.ok(paths.includes(`/nodes/${i}`));assert.ok(paths.includes(`/nodes/${i}/properties/HP`));}
 assert.ok(paths.includes('/claims/0'));assert.ok(paths.includes('/nodes/9/properties'));
});

test('unchanged source retries reuse only completed positive review groups and invalidate changed inputs',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-reuse-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const draft={nodes:[{node_id:'npc-one',source_refs:[{page:1}],properties:{}},{node_id:'npc-two',source_refs:[{page:2}],properties:{}}],claims:[]};
 let fail=true,runs=0;const records=[];
 // A run that fails without timing out is a transport loss and gets its own retries (below); zero waits keep the case quick.
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',task:{purpose:'opening'},draft,transportBackoffMs:[0,0,0],
  instructions:'unused',round:1,model:{id:'fixture/vision',thinking:'low'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(row){records.push(row)},
  async run(request){
   runs++;assert.match(request.brief, /input_json/);const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));const pointer=task.required_review[0];
   const page=pointer==='/nodes/0'?1:2;
   if(fail&&page===2)return {ok:false,stderr:'temporary source service failure'};
   request.onEvent({type:'tool_execution_end',toolCallId:'page',isError:false,result:{details:{kind:'source_pages',observations:[{page}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['page']})+'\n');
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,source_refs:[{page}],verdict:'supported'}],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }};
 await assert.rejects(reviewCandidate(options),/temporary source service failure/);assert.equal(runs,5,'one run for the unit that passed, one plus three transport retries for the one the service dropped');
 fail=false;assert.deepEqual((await reviewCandidate({...options,round:2})).sort(),[1,2]);assert.equal(runs,6);
 assert.equal(records.filter(row=>row.reused).length,1);
 await reviewCandidate({...options,round:3});assert.equal(runs,6);
 // §151.2.1: a unit is keyed by its own records and their connected context; the edited record's unit alone re-runs.
 await reviewCandidate({...options,round:4,draft:{...draft,nodes:[{...draft.nodes[0],summary:'Changed source meaning'},draft.nodes[1]]}});assert.equal(runs,7);
 await reviewCandidate({...options,round:5,source:{...options.source,file_sha256:'b'.repeat(64)}});assert.equal(runs,9);
 await reviewCandidate({...options,round:6,reviewVersion:'fixture-v2'});assert.equal(runs,11);
 const evidence=records.find(row=>row.reused).evidence;await writeFile(evidence,'{}');
 await reviewCandidate({...options,round:7});assert.equal(runs,12,'changed retained proof is a cache miss');
});

test('semantic rejections are never reused as successful review results',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-negative-'));t.after(()=>rm(cwd,{recursive:true,force:true}));let runs=0;
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',task:{},draft:{nodes:[{properties:{},source_refs:[{page:1}]}],claims:[]},instructions:'unused',round:1,
 model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,record(){},progress(){},
 async run(request){runs++;request.onEvent({type:'tool_execution_end',toolCallId:'page',isError:false,result:{details:{kind:'source_pages',observations:[{page:1}]}}});
 await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['page']})+'\n');
 await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{path:'/nodes/0',source_refs:[{page:1}],verdict:'unsupported'}],missing:[]}));return {ok:true,ms:1,stderr:''};}};
 await reviewCandidate(options);await reviewCandidate({...options,round:2});assert.equal(runs,2);
});


test('an unavailable advisory cache does not repeat or reject a successful source review',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-no-cache-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const cacheRoot=join(cwd,'not-a-directory');await writeFile(cacheRoot,'retained');let runs=0;const records=[];
 const pages=await reviewCandidate({cwd,cacheRoot,reviewVersion:'fixture-v1',task:{},draft:{nodes:[{properties:{}}],claims:[]},instructions:'unused',round:1,
 model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(row){records.push(row)},
 async run(request){runs++;request.onEvent({type:'tool_execution_end',toolCallId:'page',isError:false,result:{details:{kind:'source_pages',observations:[{page:1}]}}});
 await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['page']})+'\n');
 await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{path:'/nodes/0',source_refs:[{page:1}],verdict:'supported'}],missing:[]}));return {ok:true,ms:1,stderr:''};}});
 assert.equal(runs,1);assert.deepEqual(pages,[1]);assert.equal(await readFile(cacheRoot,'utf8'),'retained');
 assert.ok(records.some(row=>row.event==='review_cache_unavailable'));
});

/**
 * A reviewer's slip is not the book's (contract §81).
 *
 * `Masks of Nyarlathotep`, 669 pages, 2026-09-17. A guidance reading finished, nothing was
 * unsupported and nothing was missing, and the publication gate refused it anyway:
 *
 *   invalid_params: review path does not exist in the draft
 *   details: { reason: "reading_failed", path: "/nodes/0/claims/0" }
 *
 * Claims are top-level; they are never under a node. The reviewer had answered for a pointer it
 * invented, this host's transport gate passed it because it only asked whether the *assigned*
 * paths had been answered, and the kernel's refusal was then charged to the reading — 25 minutes
 * of work, a whole book, lost to one reviewer typing the wrong pointer.
 *
 * The unit already had a second attempt; it had nothing to trigger it, and nothing to tell it.
 */
test('a reviewer-invented pointer retries its own unit, and the retry is told why',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-bogus-pointer-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const briefs=[],failureSeen=[];let attempts=0;
 const draft={nodes:[{node_id:'npc-larkin',source_refs:[{page:4}],properties:{}}],claims:[],ready_nodes:[]};
 const options={cwd,task:{purpose:'detail',focus:'Larkin',question:''},draft,
  instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},
  signal:new AbortController().signal,record(){},progress(){},
  async run(request){
   attempts++;
   briefs.push(request.brief);
   failureSeen.push(await readFile(join(request.cwd,'failure.json'),'utf8').catch(()=>null));
   request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:[{page:4}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   // The first attempt answers the assigned pointer and also invents one; the second does not.
   const checked=[{paths:['/nodes/0'],verdict:'supported',source_refs:[{page:4}],reason:'assigned'}];
   if(attempts===1)checked.push({paths:['/nodes/0/claims/0'],verdict:'unsupported',source_refs:[{page:4}],reason:'invented'});
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked,missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }};
 assert.deepEqual(await reviewCandidate(options),[4]);
 assert.equal(attempts,2,'the invented pointer costs its own unit a retry, not the book');
 assert.equal(failureSeen[0],null,'the first attempt has nothing to read');
 assert.match(failureSeen[1],/does not exist in the draft/,'the retry starts with the reason in its own directory');
 assert.match(failureSeen[1],/nodes\/0\/claims\/0/,'and the reason names the pointer');
 assert.doesNotMatch(briefs[0],/failure\.json/);
 assert.match(briefs[1],/failure\.json holds the reason/,'the retry is pointed at it');
 const review=JSON.parse(await readFile(join(cwd,'review.json'),'utf8'));
 assert.deepEqual(review.checked.map(row=>row.paths),[['/nodes/0']],'only the clean answer is published');
});

test('an assigned pointer is never the reviewer’s mistake, even when it is not a draft key',()=>{
 // `/coverage` is synthesised by this host and is not a key in the draft at all.
 const draft={nodes:[{node_id:'scene-room',source_refs:[{page:1}],properties:{}}],claims:[],ready_nodes:['scene-room']};
 const review={checked:[{paths:['/coverage'],verdict:'supported',source_refs:[{page:1}],reason:'scope'}],missing:[]};
 assert.doesNotThrow(()=>checkReviewEvidence(review,['/coverage'],new Set([1]),[],draft));
 const invented={checked:[{paths:['/coverage'],verdict:'supported',source_refs:[{page:1}],reason:'scope'},
  {paths:['/nodes/9'],verdict:'supported',source_refs:[{page:1}],reason:'invented'}],missing:[]};
 assert.throws(()=>checkReviewEvidence(invented,['/coverage'],new Set([1]),[],draft),/does not exist in the draft/);
});

test('a reviewer the transport dropped is asked again after a wait, and only a lasting outage fails its unit',async t=>{
 // Cold Harvest, 2026-09-13/14: `Request timed out.`, `Connection error.`, `500 "Auth context expired."` on a
 // handful of units failed four whole readings of one scene. A dropped reviewer never answered, so there is
 // nothing to repair -- the same request is made again, later, and no failure.json is written for it.
 const cwd=await mkdtemp(join(tmpdir(),'coc-review-transport-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const failureSeen=[],rows=[];let runs=0,drops=2;
 const options={cwd,task:{purpose:'detail',focus:'Farm',question:''},draft:{nodes:[{node_id:'scene-farm',source_refs:[{page:3}],properties:{}}],claims:[]},
  instructions:'unused',round:1,model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused'},signal:new AbortController().signal,
  transportBackoffMs:[1,1,1],progress(){},record(row){rows.push(row)},
  async run(request){
   runs++;
   failureSeen.push(await readFile(join(request.cwd,'failure.json'),'utf8').catch(()=>null));
   if(drops-->0)return {ok:false,timedOut:false,ms:1,stderr:'',error:'OpenAI API error (500): 500 "Auth context expired."'};
   request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:[{page:3}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:['/nodes/0'],verdict:'supported',source_refs:[{page:3}],reason:'seen'}],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }};
 assert.deepEqual(await reviewCandidate(options),[3]);
 assert.equal(runs,3,'two drops, then the answer');
 assert.deepEqual(failureSeen,[null,null,null],'a transport retry is not told it was rejected');
 const retries=rows.filter(row=>row.event==='review_transport_retry');
 assert.deepEqual(retries.map(row=>[row.unit,row.attempt,row.wait_ms]),[[1,1,1],[1,2,1]]);
 assert.match(retries[0].detail,/Auth context expired/);
 const verified=rows.filter(row=>row.phase==='verify');
 assert.deepEqual(verified.map(row=>[row.attempt,row.ok]),[[3,true]],'the answer is one row, on the attempt that gave it');
 // A lasting outage: the retries run out, the unit fails, and the failure leaves a row where the review should be.
 runs=0;drops=99;rows.length=0;
 await assert.rejects(reviewCandidate({...options,round:2}),/Auth context expired/);
 assert.equal(runs,4,'one attempt and three transport retries');
 assert.equal(rows.filter(row=>row.event==='review_transport_retry').length,3);
 assert.deepEqual(rows.filter(row=>row.phase==='verify').map(row=>[row.attempt,row.ok,row.reason]),[[4,false,'transport']]);
 // A reviewer that answered wrongly is still repaired, not re-rolled: one retry, with the reason.
 runs=0;drops=0;rows.length=0;failureSeen.length=0;
 const wrong={...options,round:3,async run(request){
  runs++;failureSeen.push(await readFile(join(request.cwd,'failure.json'),'utf8').catch(()=>null));
  request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:[{page:3}]}}});
  await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
  await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[],missing:[]}));
  return {ok:true,ms:1,stderr:''};
 }};
 await assert.rejects(reviewCandidate(wrong),/omitted assigned fields/);
 assert.equal(runs,2);
 assert.equal(failureSeen[0],null);assert.match(failureSeen[1],/omitted assigned fields/);
 assert.deepEqual(rows.filter(row=>row.phase==='verify').map(row=>[row.attempt,row.ok,row.reason]),[[2,false,'review']]);
});

/**
 * §151.2.1 (spec jev-decides-llm-writes D-B B1). The review cache key used to contain the whole draft and the whole task:
 * on Blood05 pages 19-20 a repair touching 3 of 29 claims re-reviewed every unit, and a repair round's own bookkeeping
 * (`task.repair`) missed even an unchanged draft. A fact unit is now keyed by its own records and their connected context.
 */
function unitReviewer(ran){
 return async request=>{
  const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));ran.push(task.required_review);
  const seen=task.review_scope_pages??[1,2,3];
  request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:seen.map(page=>({page}))}}});
  await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
  await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:seen.map(page=>({page})),reason:'fixture'}],missing:[]}));
  return {ok:true,ms:1,stderr:''};
 };
}
test('§151.2.1 an edit to one record re-runs only its unit and coverage; round bookkeeping never misses, a connected edit does',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-unit-identity-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const ran=[],rows=[];
 const draft={nodes:[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{}},
  {node_id:'npc-sailor',node_kind:'npc',name:'Sailor',source_refs:[{page:2}],properties:{}},
  {node_id:'npc-keeper',node_kind:'npc',name:'Keeper',source_refs:[{page:3}],properties:{}}],
  claims:[{subject_id:'npc-keeper',predicate:'present-in',object:{node_id:'scene-dock'},source_refs:[{page:3}]}],ready_nodes:['scene-dock'],coverage:{}};
 const task={purpose:'detail',focus:'Dock',question:'',review_scope_pages:[1,2,3]};
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',extractionVersion:'native-v1',task,draft,instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(row){rows.push(row)},run:unitReviewer(ran)};
 await reviewCandidate(options);
 assert.deepEqual(ran.map(paths=>paths[0]).sort(),['/coverage','/nodes/0','/nodes/1','/nodes/2']);
 // The sailor is edited, and the round carries a repair's bookkeeping and another coverage scope.
 ran.length=0;rows.length=0;
 const sailor={...draft,nodes:[draft.nodes[0],{...draft.nodes[1],summary:'Now with a summary.'},draft.nodes[2]]};
 await reviewCandidate({...options,round:2,draft:sailor,task:{...task,review_scope_pages:[1,2,3,4],must_view_pages:[],review_retry:{refused:[]},
  repair:{draft:'draft.json',baseline:'baseline.json',findings:{error:'refused'}}}});
 assert.deepEqual(ran.map(paths=>paths[0]).sort(),['/coverage','/nodes/1'],'only the edited record and coverage are reviewed again');
 assert.equal(rows.filter(row=>row.reused).length,2,'the dock and the keeper with its claim are reused');
 // The keeper is edited: its own unit re-runs, and so does the dock, whose connected context holds the keeper.
 ran.length=0;
 const keeper={...sailor,nodes:[sailor.nodes[0],sailor.nodes[1],{...sailor.nodes[2],summary:'Keeps the lamp.'}]};
 await reviewCandidate({...options,round:3,draft:keeper});
 assert.deepEqual(ran.map(paths=>paths[0]).sort(),['/coverage','/nodes/0','/nodes/2'],'a changed dependency is a changed unit; the sailor is untouched');
});

test('§151.2.1 a deleted record keeps every surviving unit whole, and reused rows move to the records\' new positions',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-unit-carry-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const ran=[],rows=[];
 const claim=i=>({subject_id:`npc-${i}`,predicate:'present-in',object:{node_id:`scene-${i}`},truth_status:'authorial',source_refs:[{page:3}]});
 const draft={nodes:[],claims:Array.from({length:17},(_,i)=>claim(i))};
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',task:{purpose:'detail',focus:'Street',question:''},draft,instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(row){rows.push(row)},run:unitReviewer(ran)};
 await reviewCandidate(options);
 assert.deepEqual(ran.map(paths=>paths.length).sort((a,b)=>a-b),[1,8,8]);
 const plan=readReviewPlan(await readFile(join(cwd,REVIEW_PLAN_FILE),'utf8'));
 assert.ok(plan,'the round leaves its plan beside its review');
 // A repair deletes claim 1. Batched afresh, every later claim would slide into another unit and no unit would match.
 ran.length=0;rows.length=0;
 const repaired={...draft,claims:draft.claims.filter((_,i)=>i!==1)};
 await reviewCandidate({...options,round:2,draft:repaired,previousPlan:plan});
 assert.deepEqual(ran,[['/claims/0','/claims/1','/claims/2','/claims/3','/claims/4','/claims/5','/claims/6']],'only the unit that lost a record is reviewed again');
 assert.equal(rows.filter(row=>row.reused).length,2);
 const review=JSON.parse(await readFile(join(cwd,'review.json'),'utf8'));
 const answered=review.checked.flatMap(row=>row.paths).sort();
 assert.deepEqual(answered,repaired.claims.map((_,i)=>`/claims/${i}`).sort(),'every claim answered once, at its new position');
});

test('§151.2.1 a reused unit review never carries a row about a record outside the unit',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'coc-unit-foreign-row-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const draft={nodes:[{node_id:'npc-one',source_refs:[{page:1}],properties:{}},{node_id:'npc-two',source_refs:[{page:2}],properties:{}}],claims:[]};
 let runs=0;
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',task:{purpose:'detail',focus:'',question:''},draft,instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(){},
  async run(request){
   runs++;const task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));
   request.onEvent({type:'tool_execution_end',toolCallId:'pages',isError:false,result:{details:{kind:'source_pages',observations:[{page:1},{page:2}]}}});
   await writeFile(request.eventLog+'.images.jsonl',JSON.stringify({included:['pages']})+'\n');
   // The second unit's reviewer also volunteers a verdict on the first unit's record.
   const extra=task.required_review[0]==='/nodes/1'?[{paths:['/nodes/0'],verdict:'supported',source_refs:[{page:1}],reason:'volunteered'}]:[];
   await writeFile(join(request.cwd,'review.json'),JSON.stringify({checked:[{paths:task.required_review,verdict:'supported',source_refs:[{page:1}],reason:'assigned'},...extra],missing:[]}));
   return {ok:true,ms:1,stderr:''};
  }};
 await reviewCandidate(options);assert.equal(runs,2);
 assert.equal(JSON.parse(await readFile(join(cwd,'review.json'),'utf8')).checked.filter(row=>row.paths.includes('/nodes/0')).length,2);
 // The first record changes: its own unit answers for it, and the second unit's reused review brings no stale verdict on it.
 await reviewCandidate({...options,round:2,draft:{...draft,nodes:[{...draft.nodes[0],summary:'Changed.'},draft.nodes[1]]}});
 assert.equal(runs,3);
 const merged=JSON.parse(await readFile(join(cwd,'review.json'),'utf8'));
 assert.deepEqual(merged.checked.filter(row=>row.paths.includes('/nodes/0')).map(row=>row.reason),['assigned']);
});

/**
 * §151.2.1, lead decision 2026-09-28: a unit's connected context is checked, not keyed. Removing a connected record
 * cannot turn the unit's own supported records unsupported (removal is what refused records get); changing or adding
 * one can. Blood05 read-6: every fact unit touched an endpoint of a deleted claim, so keying the context reused none.
 */
function harborUnits(){
 const node=(node_id,page)=>({node_id,node_kind:node_id.split('-')[0],name:node_id,source_refs:[{page}],properties:{}});
 const claim=(subject_id,target,page,predicate='present-in')=>({subject_id,predicate,object:{node_id:target},source_refs:[{page}]});
 // Units: the dock (p1), the sailor (p2), the keeper with its claim on the dock (p3), the sailor's claim on the dock (p4), coverage.
 return {node,claim,draft:{nodes:[node('scene-dock',1),node('npc-sailor',2),node('npc-keeper',3)],
  claims:[claim('npc-keeper','scene-dock',3),claim('npc-sailor','scene-dock',4)],ready_nodes:['scene-dock'],coverage:{}}};
}
async function contextFixture(t){
 const cwd=await mkdtemp(join(tmpdir(),'coc-unit-context-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const ran=[],{node,claim,draft}=harborUnits();
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',task:{purpose:'detail',focus:'Dock',question:'',review_scope_pages:[1,2,3,4,5]},draft,instructions:'unused',round:1,
  model:{id:'fixture/vision'},source:{pdf:'unused',cache:'unused',file_sha256:'a'.repeat(64)},signal:new AbortController().signal,progress(){},record(){},run:unitReviewer(ran)};
 await reviewCandidate(options);
 assert.equal(ran.length,5);ran.length=0;
 const again=async changed=>{ran.length=0;await reviewCandidate({...options,round:2,draft:changed});return ran.map(paths=>paths.join(',')).sort();};
 return {node,claim,draft,again};
}
test('§151.2.1 removing a connected record reuses every unit whose own records are unchanged',async t=>{
 const {draft,again}=await contextFixture(t);
 // The sailor's claim on the dock is removed: the dock and the sailor lose it from their context, nothing else changes.
 assert.deepEqual(await again({...draft,claims:[draft.claims[0]]}),['/coverage']);
});
test('§151.2.1 a changed connected record re-runs the units that saw it',async t=>{
 const {draft,again}=await contextFixture(t);
 const claims=[draft.claims[0],{...draft.claims[1],reason:'Now a regular at the dock.'}];
 assert.deepEqual(await again({...draft,claims}),['/claims/1','/coverage','/nodes/0','/nodes/1','/nodes/2,/claims/0'],
  'its own unit, and the dock, the sailor and the keeper (through the dock), whose context holds it');
});
test('§151.2.1 an added connected record re-runs the units it connects to, and only those',async t=>{
 const {claim,draft,again}=await contextFixture(t);
 const claims=[...draft.claims,claim('npc-sailor','npc-keeper',5,'knows')];
 assert.deepEqual(await again({...draft,claims}),['/claims/1','/claims/2','/coverage','/nodes/1','/nodes/2,/claims/0'],
  'the new claim, and every unit holding the sailor or the keeper; the dock is not connected to it and is reused');
});
