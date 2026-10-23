/**
 * Contract §258: an opening found and guided from a PDF's text layer alone, installed through the real kernel's
 * `module.reference.publish`. The reader child is a fixture writing answer.json; nothing here asserts model wording.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {basename,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
import {runPageOpen} from '../../extensions/module/page-open.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const ROOT=resolve(import.meta.dirname,'../..'),evidence=playtestScratch('page-open','direct-');
await build({stdin:{contents:[['modules/index',['createModuleRuntime']],['context',['createKernelContext']],['locks',['createAdvisoryLocks']]]
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
  return {modules,mid,sha:sha(bytes),pdf:join(modules.source.store.moduleDir(mid),'source.pdf')};
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
