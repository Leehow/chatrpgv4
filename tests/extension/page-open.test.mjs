/**
 * Contract §261: an opening found and guided from a PDF's text layer alone, installed through the real kernel's
 * `module.reference.publish`. The reader child is a fixture writing answer.json; nothing here asserts model wording.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {basename,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
import {runPageOpen} from '../../extensions/module/page-open.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {DecisionContent,openingPassages} from '../../runtime/decision-content.ts';

const ROOT=resolve(import.meta.dirname,'../..'),evidence=playtestScratch('page-open','direct-');
await build({stdin:{contents:[['modules/index',['createModuleRuntime']],['context',['createKernelContext']],['locks',['createAdvisoryLocks']],
  ['modules/campaign-scope',['ensureCampaignModule','moduleContext']],['modules/store',['ModuleStore']],['modules/source-state',['sourceState']],['modules/visual',['assembleVisual']],['modules/opening-choice',['anchorForkOpening']]]
  .map(([path,names])=>`export {${names.join(',')}} from ${JSON.stringify(join(ROOT,'kernel-ts',path+'.ts'))};`).join('\n'),resolveDir:ROOT,sourcefile:'page-open-api.ts',loader:'ts'},
  outfile:join(evidence,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(evidence,'api.mjs')).href);
const sha=value=>createHash('sha256').update(value).digest('hex');

const PAGES=70;
const pageText=page=>page===16?'Prologue\nThe road runs straight through the desert.\nRead aloud: the gas station sign flickers.'
  :page===17?'Welcome to the station\nThe pumps are rusted.\nKeeper note: the owner hides a shotgun.'
  :page===20?'Ras the owner\nA tall man in overalls.\nNate, his son, leans on the car lift.'
  :page===6?'Introduction\nThe investigators drive into a desert town in 1975.\nA car and Drive Auto 55% are required.'
  :page===18||page===19?'':`Page ${page} heading\nBody text of page ${page}.`;
/** A fake host runtime: the text layer above, and a reader child that answers each step from `answers`. */
function runtime(answers,runs=[]){
  return {
    async sourceInfo({pdf}){return {path:pdf,file_sha256:runtime.sha,page_count:PAGES,labels:null,bookmarks:[{name:'Introduction',page:6,children:[]},{name:'Prologue',page:16,children:[{name:'The station',page:17,children:[]}]}]};},
    async sourceLines({pages}){if(pages.length>32)throw new Error('source text pages must be 1-32 unique positive physical page numbers');return {file_sha256:runtime.sha,extraction_version:'fixture',page_count:PAGES,errors:[],
      pages:pages.map(page=>({page,pdf_label:null,native_sha256:'0'.repeat(64),lines:pageText(page).split('\n').filter(Boolean)}))};},
    async runTask({request}){
      const step=basename(request.cwd),task=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));runs.push({step,task,request});
      const answer=answers[step];if(answer!==undefined)await writeFile(join(request.cwd,'answer.json'),JSON.stringify(typeof answer==='function'?answer(task):answer));
      return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
    },
  };
}
const ANSWERS={
  locate:{openings:[{name:'Prologue',pages:[16,17,20,99]}],setup_pages:[6,18]},
  guide:{era:{text:'1975, the American desert.',pages:[6]},starting_place:{text:'A gas station on the road into town.',pages:[16]},
    public_premise:{text:'The investigators drive into a small desert town. The serpent folk wait.',pages:[6]},creation_advice:{text:'Bring a car; Drive Auto 55% is required.',pages:[6]},era_text:'1975'},
  review:task=>({...task.fields,public_premise:task.fields.public_premise.replace(' The serpent folk wait.','')}),
};

async function bound(t){
  const require=createRequire(import.meta.url),flock=promisify(require('fs-ext').flock),workspace=join(evidence,'kernel-'+Math.random().toString(36).slice(2));
  const pdf=join(evidence,'page-open.pdf'),bytes=Buffer.from('%PDF-1.7\npage-open fixture\n');await writeFile(pdf,bytes);
  const context=await api.createKernelContext({workspace,content:join(ROOT,'content'),locks:api.createAdvisoryLocks(flock)}),modules=api.createModuleRuntime(context);
  t.after(async()=>{await modules.close();await context.git.close();});
  const mid=(await modules.handlers['module.source.bind']({source:{path:pdf,page_count:PAGES,file_sha256:sha(bytes)}})).module_id;
  return {modules,context,mid,sha:sha(bytes),pdf:join(modules.source.store.moduleDir(mid),'source.pdf')};
}

test('the opening and the setup pages are found from the text layer, and the guide is written from those pages alone',async t=>{
  const f=await bound(t),runs=[],host=runtime(ANSWERS,runs);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'zh-Hans',model:{id:'fixture/model'}});
  assert.deepEqual(runs.map(run=>run.step),['locate','guide','review']);
  assert.ok(runs.every(run=>run.request.tools==='read,write'&&!run.request.prompt),'text-only calls: no page images, no reader phase');
  const toc=runs[0].task;
  assert.deepEqual(toc.bookmarks.map(mark=>[mark.name,mark.page]),[['Introduction',6],['Prologue',16],['The station',17]]);
  assert.deepEqual(toc.pages.find(row=>row.page===16).lines,['Prologue','The road runs straight through the desert.','Read aloud: the gas station sign flickers.']);
  assert.deepEqual(runs[1].task.pages.map(row=>row.page),[6,16,17,20],'an image-only page (18) and a page past the book (99) are dropped');
  assert.equal(runs[1].task.play_language,'zh-Hans');
  assert.deepEqual(result.packet.entries,[{id:'scene-source-entry-1',name:'Prologue',page:16,excerpt_id:'page-2',era_text:'1975',era_span:'page-1'}]);
  assert.deepEqual(result.receipt.opening_pages,{'scene-source-entry-1':[16,17,20]});
  assert.equal(result.receipt.checks_policy,'page-text-v1');
  assert.ok(result.text.includes('Drive Auto 55%')&&!result.text.includes('shotgun'));
  assert.deepEqual(runs[2].task.fields.public_premise,'The investigators drive into a small desert town. The serpent folk wait.','the review sees the draft');
  assert.ok(!result.text.includes('serpent')&&result.receipt.public_fields.public_premise.text==='The investigators drive into a small desert town.','the reviewed text is the guide');
  assert.equal(result.receipt.public_fields.era.status,'value');
});

test('an opening whose people continue after its maps keeps that page, and a missing review keeps the draft',async t=>{
  const f=await bound(t),runs=[],rows=[],host=runtime({...ANSWERS,locate:{openings:[{name:'Prologue',pages:[16,17]}],setup_pages:[6]},review:undefined},runs);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'},record:row=>rows.push(row)});
  assert.deepEqual(result.receipt.opening_pages,{'scene-source-entry-1':[16,17,20]},'pages 18 and 19 are maps; 20 holds the people');
  assert.ok(rows.some(row=>row.event==='review_missing'));
  assert.ok(result.text.includes('serpent folk'),'without a review the draft stands');
});

test('§266.12: a guide the provider refuses is asked once more with the setup pages alone, and the opening still stands on its pages',async t=>{
  const f=await bound(t),runs=[],host=runtime({locate:ANSWERS.locate,'guide-narrow':{creation_advice:{text:'Bring a car; Drive Auto 55% is required.',pages:[6]}},review:task=>task.fields},runs);runtime.sha=f.sha;
  const rows=[];
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'},record:row=>rows.push(row)});
  assert.deepEqual(runs.map(run=>run.step),['locate','guide','guide-narrow','review']);
  assert.deepEqual(runs[2].task.pages.map(row=>row.page),[6],'the setup page only');
  assert.ok(rows.some(row=>row.event==='guide_narrowed'));
  assert.deepEqual(result.receipt.opening_pages,{'scene-source-entry-1':[16,17,20]},'the opening keeps every page');
  assert.equal(result.receipt.public_fields.public_premise.status,'unavailable');
});

test('the kernel installs a page-text opening: the anchor scene cites every opening page and the Keeper handoff carries them',async t=>{
  const f=await bound(t),host=runtime(ANSWERS);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const published=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:result.workDir,guidance_key:'e'.repeat(64),play_language:'en'});
  assert.equal(published.setup_ready,true);assert.equal(published.graph_complete,false);
  assert.equal(await f.modules.source.openingReady(f.mid,'Prologue'),true,'the table may open on the anchor');
  const graph=await f.modules.source.store.readGraph(f.mid),anchor=graph.nodes.find(node=>node.name==='Prologue');
  assert.deepEqual(anchor.source_refs.map(ref=>ref.pdf_index+1),[16,17,20]);
  assert.equal(anchor.visibility,'keeper-only');
  assert.ok(anchor.properties.opening_pages_text&&['the gas station sign flickers','the owner hides a shotgun','Nate, his son'].every(words=>anchor.summary.includes(words)),'the anchor holds every opening page');
  const handoff=published.guidance.handoff;
  assert.ok(handoff.length<=4000,'the handoff is one accepted-guidance field');
  for(const page of [16,17,20])assert.ok(handoff.includes(`[Original physical page ${page}]`),`page ${page} in the handoff`);
  assert.ok(handoff.includes('the owner hides a shotgun'),'the Keeper reads the whole page, Keeper notes included');
  assert.ok(handoff.startsWith('The table opens in Prologue.')&&handoff.includes('do not create another scene'),'the Keeper is told to play the scene from its pages');
  assert.ok(!published.guidance.opening.includes('shotgun'),'the public guide does not');
});

test('opening pages the packet does not hold are refused at publish',async t=>{
  const f=await bound(t),host=runtime(ANSWERS);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const receiptPath=join(result.workDir,'source-reference-complete.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8'));
  await writeFile(receiptPath,JSON.stringify({...receipt,opening_pages:{'scene-source-entry-1':[16,3]}}));
  await assert.rejects(f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:result.workDir,guidance_key:'e'.repeat(64),play_language:'en'}),/not held by the reference packet/);
});

test('a missing answer is a failure the guidance falls back from to the ordinary read',async t=>{
  const f=await bound(t),host=runtime({locate:ANSWERS.locate});runtime.sha=f.sha;
  await assert.rejects(runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}}),error=>error.reason==='page_open_guide_missing');
  const rows=[],calls=[];
  const service=new ReadingService({home:evidence,runtime:{...host,sourceReferences:false},model:()=>({id:'fixture/model',vision:true}),record:row=>rows.push(row),progress(){},async call(method){
    calls.push(method);
    if(method==='module.reference.status')return {};
    if(method==='module.source.snapshot')return {pdf:f.pdf,page_count:PAGES,file_sha256:f.sha};
    if(method==='module.read.request')throw new Error('ordinary read');
    throw new Error(method);
  }});
  t.after(()=>service.close());
  await assert.rejects(service.prepare({module_id:f.mid,purpose:'guidance',guidance_key:'b'.repeat(64),play_language:'en'}),/ordinary read/);
  assert.ok(rows.some(row=>row.lane==='page-open'&&row.event==='fallback'&&row.reason==='page_open_guide_missing'));
});

test('with page opening on and no checked reference, guidance is published from the pages without the ordinary read',async t=>{
  const f=await bound(t),host=runtime(ANSWERS);runtime.sha=f.sha;
  const calls=[];
  const service=new ReadingService({home:evidence,runtime:{...host,sourceReferences:false},model:()=>({id:'fixture/model',vision:true}),record(){},progress(){},async call(method,params){
    calls.push(method);
    if(method==='module.reference.status')return {};
    if(method==='module.source.snapshot')return {pdf:f.pdf,page_count:PAGES,file_sha256:f.sha};
    if(method==='module.reference.publish')return f.modules.handlers[method](params);
    if(method==='module.read.request')throw new Error('ordinary read');
    if(method==='module.read.claim')return {job_id:null};
    throw new Error(method);
  }});
  t.after(()=>service.close());
  const prepared=await service.prepare({module_id:f.mid,purpose:'guidance',guidance_key:'b'.repeat(64),play_language:'en'});
  assert.equal(prepared.setup_ready,true);assert.equal(prepared.source_reference,true);
  assert.ok(!calls.includes('module.read.request'));
});

test('the opening pages reach the Keeper as passages it can hand the author, named by page',()=>{
  const long=Array.from({length:30},(_,index)=>`Line ${index} of the station text runs on for a while here.`).join('\n');
  const text=`[Original physical page 16]\nThe road runs straight.\nThe radio plays: Coyote Mike on KBLR.\n\n[Original physical page 17]\n${long}`;
  const passages=openingPassages({scene:'Prologue',text});
  assert.deepEqual(passages[0],{name:'Original page 16, passage 1',text:'The road runs straight.\nThe radio plays: Coyote Mike on KBLR.'});
  assert.ok(passages.length>2&&passages.slice(1).every((passage,index)=>passage.name===`Original page 17, passage ${index+1}`&&passage.text.length<=900+80));
  assert.equal(passages.slice(1).map(passage=>passage.text).join('\n'),long,'whole lines, nothing dropped');
  const owner=new DecisionContent(),issued=owner.prepare('c:1',{opening_pages:{scene:'Prologue',text}},[],[],['Investigator']);
  const radio=issued.facts.find(fact=>fact.value?.name==='Original page 16, passage 1');
  assert.ok(radio&&radio.ref.startsWith('source_'),'issued as a source');
  assert.equal(owner.resolve({source_ref:radio.ref}).value.text.includes('Coyote Mike'),true);
});

test('a bounded live test stops reading at PI_COC_READ_DEADLINE_MS',async t=>{
  const rows=[];process.env.PI_COC_READ_DEADLINE_MS='20';
  const service=new ReadingService({home:evidence,model:()=>({id:'fixture/model'}),record:row=>rows.push(row),progress(){},async call(method){throw new Error(method);}});
  delete process.env.PI_COC_READ_DEADLINE_MS;t.after(()=>service.close());
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.ok(rows.some(row=>row.event==='deadline_stop'&&row.deadline_ms===20));
});

test('live7 du-1101a: a setup that names no opening is not bound to the opening another setup of the same book chose',async t=>{
  // Two setups of one book in one tree: the first chose its opening; the second prepared without one and, through the
  // shared library's recorded choice, got guidance bound to the first one's opening it never chose.
  const two={...ANSWERS,locate:{openings:[{name:'Prologue',pages:[16,17]},{name:'Ras the owner',pages:[20]}],setup_pages:[6]}};
  const f=await bound(t),host=runtime(two);runtime.sha=f.sha;
  const first=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const blocked=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:first.workDir,guidance_key:'a'.repeat(64),play_language:'en'});
  assert.equal(blocked.setup_ready,false,'two openings and no choice: the question, not a guide');
  const scene=blocked.opening.choice.candidates[0].scene;
  const chose=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',focus:scene,model:{id:'fixture/model'}});
  const a=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:chose.workDir,guidance_key:'b'.repeat(64),play_language:'en',start_scene:scene});
  assert.equal(a.setup_ready,true,'the first setup chose and has its guide');
  const other=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const b=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:other.workDir,guidance_key:'c'.repeat(64),play_language:'en'});
  assert.equal(b.setup_ready,false,'the second setup is asked for its own opening, not handed the first one\'s');
  assert.equal(b.guidance,undefined);
});

test('live7 cs-1101b: a setup\'s chosen opening is not written into the shared library, and a library left "preparing" with nothing running reports idle',async t=>{
  const two={...ANSWERS,locate:{openings:[{name:'Prologue',pages:[16,17]},{name:'Ras the owner',pages:[20]}],setup_pages:[6]}};
  const f=await bound(t),host=runtime(two);runtime.sha=f.sha;
  const asked=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const question=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:asked.workDir,guidance_key:'d'.repeat(64),play_language:'en'});
  const scene=question.opening.choice.candidates[1].scene;
  const chose=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',focus:scene,model:{id:'fixture/model'}});
  const guided=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:chose.workDir,guidance_key:'e'.repeat(64),play_language:'en',start_scene:scene});
  assert.equal(guided.setup_ready,true,'the setup that chose has its guide');
  const meta=JSON.parse(await readFile(join(f.modules.source.store.moduleDir(f.mid),'module.json'),'utf8'));
  assert.equal(meta.opening_choice,undefined,'the library keeps no table\'s opening (§14.19.1)');
  const graph=await f.modules.source.store.readGraph(f.mid);
  assert.ok(graph.entry_scene_ids.length>1||graph.nodes.filter(node=>node.properties?.is_entrance).length>1,'both openings stay openings of the shared book');
  // The state live7's book-3 library was left in: "preparing", no opening, no job queued or running.
  assert.equal(meta.reading.state,'preparing');
  const status=await f.modules.handlers['module.status']({module_id:f.mid});
  assert.equal(status.reading.idle,true,'nothing will move it: detectable');
});

test('live7 du-1101b: a stale library opening_choice is not replayed and not cloned: a fork records its campaign\'s own opening',async t=>{
  // Older code wrote one setup's opening into the shared library (entry-2 at 03:30:01); a later table's fork cloned it
  // against its campaign's opening_scene (entry-1).
  const two={...ANSWERS,locate:{openings:[{name:'Prologue',pages:[16,17]},{name:'Ras the owner',pages:[20]}],setup_pages:[6]}};
  const f=await bound(t),host=runtime(two);runtime.sha=f.sha;
  const asked=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const question=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:asked.workDir,guidance_key:'d'.repeat(64),play_language:'en'});
  assert.equal(question.setup_ready,false);
  const store=f.modules.source.store,[first,second]=(await store.readGraph(f.mid)).entry_scene_ids,stale=await store.module(f.mid);
  stale.opening_choice={start_scene:second,at:'2026-11-01T03:30:01Z'};
  await api.sourceState(f.context.stateRoot).update(store.moduleDir(f.mid),{metadata:stale},f.context.locks);
  const graph=await store.readGraph(f.mid),contract=await store.contract(),empty={nodes:[],claims:[],node_refs:[],ready_nodes:[],critical:[],required_review:[],coverage:{},dependencies:[]};
  assert.notDeepEqual(api.assembleVisual(graph,empty,stale,contract).entry_scene_ids,[second],'the library does not replay a stored choice');
  assert.deepEqual(api.assembleVisual(graph,empty,{...stale,campaign_scope:'c-x'},contract).entry_scene_ids,[second],'a fork replays its own');
  // A campaign that recorded the first opening, by the handle its name-free surfaces show.
  const campaign='c-own',dir=join(f.context.campaignsRoot,campaign);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'campaign.json'),JSON.stringify({id:campaign,module_id:f.mid,opening_scene:'own-opening',setup:{node_handles:{[first]:'own-opening',[second]:'other-opening'}}}));
  await api.ensureCampaignModule(f.context,campaign,f.mid);
  const fork=await new api.ModuleStore(api.moduleContext(f.context,campaign)).module(f.mid);
  assert.equal(fork.campaign_scope,campaign);
  assert.equal(fork.opening_choice?.start_scene,first,'the campaign\'s opening, not the library\'s');
  // A fork made before its campaign exists records no opening at all.
  await api.ensureCampaignModule(f.context,'c-setup',f.mid);
  assert.equal((await new api.ModuleStore(api.moduleContext(f.context,'c-setup')).module(f.mid)).opening_choice,undefined);
  // The library's next write drops the stored choice.
  await store.writeModule(await store.module(f.mid));
  assert.equal((await store.module(f.mid)).opening_choice,undefined);
  assert.equal(JSON.parse(await readFile(join(store.moduleDir(f.mid),'module.json'),'utf8')).opening_choice,undefined);
});

test('§14.19.10: a fork made before the anchor holds another opening: the campaign\'s wins on every read, one telemetry row',async t=>{
  const two={...ANSWERS,locate:{openings:[{name:'Prologue',pages:[16,17]},{name:'Ras the owner',pages:[20]}],setup_pages:[6]}};
  const f=await bound(t),host=runtime(two);runtime.sha=f.sha;
  const asked=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:asked.workDir,guidance_key:'e'.repeat(64),play_language:'en'});
  const [first,second]=(await f.modules.source.store.readGraph(f.mid)).entry_scene_ids;
  const campaign='c-old',dir=join(f.context.campaignsRoot,campaign);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'campaign.json'),JSON.stringify({id:campaign,module_id:f.mid,opening_scene:'own-opening',setup:{node_handles:{[first]:'own-opening',[second]:'other-opening'}}}));
  await api.ensureCampaignModule(f.context,campaign,f.mid);
  const fork=new api.ModuleStore(api.moduleContext(f.context,campaign)),stored=await fork.module(f.mid);
  assert.equal(stored.opening_choice.start_scene,first);
  stored.opening_choice={start_scene:second,at:'2026-11-01T03:30:01Z'};
  await api.sourceState(f.context.stateRoot).update(fork.moduleDir(f.mid),{metadata:stored},f.context.locks);
  for(let i=0;i<3;i++)assert.equal((await fork.module(f.mid)).opening_choice.start_scene,first,'the campaign\'s opening, not the stale fork\'s');
  const rows=(await readFile(join(dir,'telemetry.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.event==='fork_opening_mismatch');
  assert.equal(rows.length,1);
  assert.deepEqual({...rows[0],at:undefined},{at:undefined,lane:'reading',event:'fork_opening_mismatch',campaign,module_id:f.mid,fork_choice:second,campaign_opening:first});
  // A campaign that names no opening keeps the fork's value.
  await writeFile(join(dir,'campaign.json'),JSON.stringify({id:campaign,module_id:f.mid,setup:{node_handles:{}}}));
  stored.opening_choice={start_scene:second,at:'2026-11-01T03:30:01Z'};
  await api.sourceState(f.context.stateRoot).update(fork.moduleDir(f.mid),{metadata:stored},f.context.locks);
  assert.equal((await fork.module(f.mid)).opening_choice.start_scene,second);
  // The guard is advisory: a fork whose private module directory is gone is returned as stored, never thrown on.
  await writeFile(join(dir,'campaign.json'),JSON.stringify({id:campaign,module_id:f.mid,opening_scene:'own-opening',setup:{node_handles:{}}}));
  await rm(fork.moduleDir(f.mid),{recursive:true,force:true});
  const gone=await fork.module(f.mid).catch(error=>error);
  assert.notEqual(gone?.code,'internal',`${gone?.message}`);
  // Directly: a scene lookup that dies, or a campaign directory that is absent, leaves the metadata unchanged.
  const meta={id:f.mid,campaign_scope:'c-none',opening_choice:{start_scene:second,at:'x'}};
  await api.anchorForkOpening(f.context,meta,async()=>{throw new Error('ENOENT');});
  assert.deepEqual(meta.opening_choice,{start_scene:second,at:'x'});
  const meta2={id:f.mid,campaign_scope:campaign,opening_choice:{start_scene:second,at:'x'}};
  await api.anchorForkOpening(f.context,meta2,async()=>{throw new Error('ENOENT: realpath');});
  assert.deepEqual(meta2.opening_choice,{start_scene:second,at:'x'});
});

test('§14.19.10: a single-entry book published without start_scene keeps its sole entry in the library; a stale table choice beside it is ignored',async t=>{
  const f=await bound(t),host=runtime(ANSWERS);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:result.workDir,guidance_key:'8'.repeat(64),play_language:'en'});
  const store=f.modules.source.store,book=await store.module(f.mid),sole=book.opening_choice?.start_scene;
  assert.equal(book.opening_choice?.of,'book','the sole entry is recorded as the book\'s, not a table\'s');
  const graph=await store.readGraph(f.mid),contract=await store.contract(),empty={nodes:[],claims:[],node_refs:[],ready_nodes:[],critical:[],required_review:[],coverage:{},dependencies:[]};
  assert.deepEqual(api.assembleVisual(graph,empty,book,contract).entry_scene_ids,[sole],'the library replays the book\'s own opening');
  // A fork whose campaign names no opening keeps the book's; the library's next write keeps it too.
  await api.ensureCampaignModule(f.context,'c-book',f.mid);
  assert.equal((await new api.ModuleStore(api.moduleContext(f.context,'c-book')).module(f.mid)).opening_choice?.start_scene,sole);
  await store.writeModule(await store.module(f.mid));
  assert.equal((await store.module(f.mid)).opening_choice?.of,'book');
  // The same scene stored by an older setup's write (unmarked) is a table's choice: not cloned, dropped on the next write.
  const stale={...await store.module(f.mid),opening_choice:{start_scene:sole,at:'2026-11-01T03:30:01Z'}};
  await api.sourceState(f.context.stateRoot).update(store.moduleDir(f.mid),{metadata:stale},f.context.locks);
  await api.ensureCampaignModule(f.context,'c-stale',f.mid);
  assert.equal((await new api.ModuleStore(api.moduleContext(f.context,'c-stale')).module(f.mid)).opening_choice,undefined);
  await store.writeModule(await store.module(f.mid));
  assert.equal((await store.module(f.mid)).opening_choice,undefined);
});

test('§14.19.9: a publication for an opening the reference does not cover names that reason, so the host reads it instead',async t=>{
  const f=await bound(t),host=runtime(ANSWERS);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  await assert.rejects(f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:result.workDir,guidance_key:'f'.repeat(64),play_language:'en',start_scene:'tongshen'}),
    error=>error.details?.reason==='opening_not_in_reference'&&error.details.start_scene==='tongshen');
  const meta=JSON.parse(await readFile(join(f.modules.source.store.moduleDir(f.mid),'module.json'),'utf8'));
  assert.equal(meta.source_reference,undefined,'nothing was written before the refusal');
});

test('§14.19.8: a reference whose only entry is the book\'s is the book\'s opening, applied in the library as before',async t=>{
  // Full suite 190a8913f: the roster fixtures publish a one-entry reference to the library with no start_scene and create
  // the campaign without one; holding back that book-level entry left three start scenes and refused every campaign.
  const f=await bound(t),host=runtime(ANSWERS);runtime.sha=f.sha;
  const result=await runPageOpen({runtime:host,source:{pdf:f.pdf,file_sha256:f.sha,page_count:PAGES},moduleId:f.mid,language:'en',model:{id:'fixture/model'}});
  const published=await f.modules.handlers['module.reference.publish']({module_id:f.mid,work_dir:result.workDir,guidance_key:'9'.repeat(64),play_language:'en'});
  assert.equal(published.setup_ready,true);
  const meta=JSON.parse(await readFile(join(f.modules.source.store.moduleDir(f.mid),'module.json'),'utf8'));
  assert.ok(meta.opening_choice?.start_scene,'the book\'s sole entry is recorded');
  assert.deepEqual((await f.modules.source.store.readGraph(f.mid)).entry_scene_ids,[meta.opening_choice.start_scene]);
});
