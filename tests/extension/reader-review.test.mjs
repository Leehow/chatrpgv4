import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {reviewCandidate,reviewUnits,checkReviewEvidence} from '../../extensions/module/reader-review.ts';
import {createRuntime} from '../../runtime/host.ts';

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
 const options={cwd,cacheRoot:join(cwd,'cache'),reviewVersion:'fixture-v1',task:{purpose:'opening'},draft,
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
 await assert.rejects(reviewCandidate(options),/temporary source service failure/);assert.equal(runs,3);
 fail=false;assert.deepEqual((await reviewCandidate({...options,round:2})).sort(),[1,2]);assert.equal(runs,4);
 assert.equal(records.filter(row=>row.reused).length,1);
 await reviewCandidate({...options,round:3});assert.equal(runs,4);
 await reviewCandidate({...options,round:4,draft:{...draft,nodes:[{...draft.nodes[0],summary:'Changed source meaning'},draft.nodes[1]]}});assert.equal(runs,6);
 await reviewCandidate({...options,round:5,source:{...options.source,file_sha256:'b'.repeat(64)}});assert.equal(runs,8);
 await reviewCandidate({...options,round:6,reviewVersion:'fixture-v2'});assert.equal(runs,10);
 const evidence=records.find(row=>row.reused).evidence;await writeFile(evidence,'{}');
 await reviewCandidate({...options,round:7});assert.equal(runs,11,'changed retained proof is a cache miss');
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
