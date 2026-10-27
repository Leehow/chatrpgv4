/**
 * Contract §266: page mode. Where the pointer index does not cover a page the Keeper turns the book's pages, cut by the
 * host from its own text; no reader session reads the book for it. The index takes over section by section.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const temp=playtestScratch('page-mode','suite-');
await build({stdin:{contents:[`export * from './extensions/module/page-mode.ts';`,`export {mergeSkeleton,skeletonPath} from './extensions/module/lean-skeleton.ts';`,
 `export {ReadingService} from './extensions/module/reading-service.ts';`,`export {cardBlocks,checkedCard} from './extensions/module/mechanics-card.ts';`].join('\n'),
 resolveDir:resolve(import.meta.dirname,'../..'),sourcefile:'page-mode-api.ts',loader:'ts'},outfile:join(temp,'api.mjs'),bundle:true,platform:'node',format:'esm',
 packages:'external',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
const SHA='a'.repeat(64);

const lean=async(run)=>{const previous=process.env.PI_COC_LEAN_READING;process.env.PI_COC_LEAN_READING='1';
 try{return await run();}finally{if(previous===undefined)delete process.env.PI_COC_LEAN_READING;else process.env.PI_COC_LEAN_READING=previous;}};

test('§266.3: the contents are the bookmarks two levels deep, or each text page\'s first line',()=>{
 const marks=[{name:'Introduction',page:1,children:[{name:'Keeper Notes',page:2,children:[{name:'too deep',page:3}]}]},{name:'The Diner',page:5,children:[]}];
 assert.deepEqual(api.bookContents(marks,8,()=>undefined),[{name:'Introduction',first:1,last:1},{name:'Keeper Notes',first:2,last:4},{name:'The Diner',first:5,last:8}]);
 const lines={1:'BLOOD ROAD   A scenario',2:'',3:'Russ’s Diner sits at the crossroads where the long road bends toward the hills beyond the town of Tassel'};
 const rows=api.bookContents([{name:'only one',page:1}],3,page=>lines[page]);
 assert.deepEqual(rows.map(row=>[row.first,row.name.length<=80]),[[1,true],[3,true]],'a page with no text has no row; names are at most 80 characters');
 assert.equal(rows[0].name,'BLOOD ROAD A scenario');
 assert.equal(api.firstLines({pages:{4:{blocks:[{text:'  '},{text:'Chapter Two'}]}}})(4),'Chapter Two');
});

test('§266.1: a page is indexed only when an indexed, unblocked section covers it; an empty set waits for completeness',()=>{
 const skeleton={complete:false,blocked_pages:[7],sections:[{name:'A',first:1,last:4,status:'indexed'},{name:'B',first:5,last:8,status:'failed'},{name:'C',first:9,last:9,status:'indexed'}]};
 assert.equal(api.inPageMode(undefined,[1]),true,'no skeleton: every page');
 assert.equal(api.inPageMode(skeleton,[2,3]),false);
 assert.equal(api.inPageMode(skeleton,[3,5]),true,'one failed section\'s page is enough');
 assert.equal(api.pageIndexed({...skeleton,sections:[{name:'B',first:5,last:8,status:'indexed'}]},7),false,'a blocked page');
 assert.equal(api.inPageMode(skeleton,[]),true);
 assert.equal(api.inPageMode({...skeleton,complete:true},[]),false);
 const named={...skeleton,entities:[{name:'Russ',aliases:[],blocks:['b2-0-x'],pages:[2]},{name:'Sheriff',aliases:[],blocks:['b6-0-y'],pages:[6]}]};
 assert.equal(api.focusInPageMode(named,'Russ'),false,'a focus on indexed pages');
 assert.equal(api.focusInPageMode(named,'Sheriff'),true,'a focus on a failed section');
 assert.equal(api.focusInPageMode(named,'the hills'),true,'a name the partial index lacks');
 assert.equal(api.focusInPageMode({...named,complete:true},'the hills'),false,'the complete index lacking a name is not page mode');
});

test('§266.4: a request turns its pages, or a contents section\'s first pages, by spelling',()=>{
 const contents=[{name:'Introduction',first:1,last:1},{name:'Russ’s Diner',first:5,last:12}];
 assert.deepEqual(api.requestedPages(contents,{pages:[9,2,2,40,0]},20).pages,[2,9],'pages past the book or repeated are dropped');
 assert.deepEqual(api.requestedPages(contents,{pages:[1,2,3,4,5]},20).pages,[1,2,3],'at most three');
 const diner=api.requestedPages(contents,{section:'russ’s  DINER'},20);
 assert.deepEqual([diner.pages,diner.section.name],[[5,6,7],'Russ’s Diner']);
 assert.equal(api.requestedPages(contents,{section:'Diner'},20).section?.name,'Russ’s Diner','a section named in part');
 assert.deepEqual(api.requestedPages(contents,{section:'Epilogue'},20),{pages:[]});
 assert.deepEqual(api.contentsLines(contents,5),['p1 Introduction','p5-12 Russ’s Diner']);
});

/** A reading service over a fake kernel and runtime: a bound book of 12 pages, its cache under `root`. */
async function service(root,{bookmarks=[],calls=[],notes=[]}={}){
 const pdf=join(root,'book','book.pdf'),cache=join(root,'book','cache');
 await mkdir(cache,{recursive:true});
 await writeFile(join(cache,`blocks-${SHA}.json`),JSON.stringify({layout_version:'v',pages:Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,{page:i+1,blocks:[{id:`b${i+1}-0-x`,text:`Page ${i+1} heading`}]}]))}));
 const reading=new api.ReadingService({
  call:async(method,params)=>{calls.push([method,params]);
   if(method==='module.source.snapshot')return {pdf,file_sha256:SHA,page_count:12,revision:'r1'};
   return {};},
  campaign:()=>'c1',home:root,model:()=>({id:'m',vision:true}),progress:()=>{},record:row=>notes.push(row),
  runtime:{sourceInfo:async()=>({bookmarks}),
   sourceBlocks:async()=>{throw new Error('the block cache answers');},
   sourcePageText:async({pages})=>({pages:pages.map(page=>({page,text:`Text of page ${page}. `.repeat(400),layer:'native'}))})},
 });
 reading.books.set('blood-road',{sha:SHA,cache});
 return reading;
}

test('§266.2, §266.5: the partial index reaches the Keeper section by section, with the note to turn pages until it is complete',async()=>lean(async()=>{
 const root=playtestScratch('page-mode','plans-'),reading=await service(root,{bookmarks:[{name:'Front',page:1},{name:'Diner',page:5}]});
 await reading.bookContentsOf('blood-road','c1');
 const capsule={where:{scene:'Diner',display_name:'Diner'},present:[]};
 const none=reading.bookPlans('blood-road',capsule);
 assert.deepEqual(none.map(row=>row.kind),['book_pages'],'no index yet: only the note');
 assert.deepEqual(none[0].contents,['p1-4 Front','p5-12 Diner']);
 assert.equal(reading.pageMode('blood-road',{pages:[5]}),true);
 await mkdir(join(root,'source-skeletons'),{recursive:true});
 const partial={...api.mergeSkeleton([{section:{name:'Diner',first:5,last:12},status:'indexed',answer:{mentions:[{name:'Diner',aliases:[],kind:'place',blocks:['b5-0-x'],evidence:[]}],
  cross_references:[],conditional_events:[],keeper_truth:[{names:['Diner'],summary:'The cook watches the road.',blocks:['b6-0-x']}],protected_facts:[],release_candidates:[],continuations:[]}}],
  id=>Number(/^b(\d+)/.exec(id)[1]),[],()=>undefined,SHA),source_sha256:SHA,partial:true,complete:false};
 await writeFile(join(root,'source-skeletons',`${SHA}-partial.json`),JSON.stringify(partial));
 assert.equal(reading.pageMode('blood-road',{pages:[5]}),false,'the finished section is indexed');
 assert.equal(reading.pageMode('blood-road',{pages:[2]}),true,'the section still being read is not');
 const some=reading.bookPlans('blood-road',capsule);
 assert.ok(some.some(row=>row.kind==='keeper_truth'),'the landed section\'s truth is in front of the Keeper');
 assert.equal(some.at(-1).kind,'book_pages');
 await writeFile(api.skeletonPath(root,SHA),JSON.stringify({...partial,partial:undefined,complete:true,sections:[{name:'Front',first:1,last:4,status:'indexed'},...partial.sections]}));
 const whole=reading.bookPlans('blood-road',capsule);
 assert.ok(!whole.some(row=>row.kind==='book_pages'),'the complete index drops the note');
 assert.equal(reading.pageMode('blood-road',{pages:[2]}),false);
}));

test('§266.4: turning pages cuts the book\'s own text, three pages at most, each once; no section answers the contents',async()=>lean(async()=>{
 const root=playtestScratch('page-mode','pages-'),notes=[],reading=await service(root,{notes});
 const turned=await reading.bookPages('blood-road',{pages:[3,4,5,6]});
 assert.deepEqual(turned.source_answer.excerpts.map(span=>span.page),[3,4,5]);
 assert.ok(turned.source_answer.excerpts.every(span=>span.text.length===4000&&span.text.startsWith(`Text of page ${span.page}.`)));
 assert.ok(!turned.source_answer.answer.includes('Text of page'),'the text rides in excerpts only');
 assert.equal(turned.source_answer.authority,'original-source-excerpts');
 const contents=await reading.bookPages('blood-road',{});
 assert.equal(contents.source_answer.status,'contents');
 assert.match(contents.source_answer.answer,/p1 Page 1 heading/,'no bookmarks: each page\'s first line');
 const section=await reading.bookPages('blood-road',{section:'page 7 heading'});
 assert.deepEqual(section.source_answer.excerpts.map(span=>span.page),[7]);
 const missing=await reading.bookPages('blood-road',{section:'Epilogue'});
 assert.match(missing.source_answer.answer,/^No contents row matches Epilogue/);
 assert.deepEqual(notes.filter(row=>row.event==='book_pages').map(row=>row.pages.length),[3,0,1,0]);
}));

test('§266.6: a lean detail reading of pages the index does not cover is handed back at claim, not read',async()=>lean(async()=>{
 const root=playtestScratch('page-mode','claim-'),calls=[],notes=[],reading=await service(root,{calls,notes});
 let claims=0;
 const call=reading.deps.call;
 reading.deps.call=async(method,params)=>{
  if(method==='module.read.claim')return ++claims===1?{job_id:'read-1',lease:'L',purpose:'detail',focus:'Diner',pages:[5,6],foreground:true,module_id:'blood-road'}:{};
  return call(method,params);};
 reading.deps.runtime={...reading.deps.runtime,runTask:async()=>{throw new Error('no reader may run in page mode');}};
 await reading.pump('blood-road','c1');
 const finish=calls.find(([method])=>method==='module.read.finish');
 assert.deepEqual(finish?.[1],{module_id:'blood-road',job_id:'read-1',lease:'L',outcome:'cancelled',detail:'page_mode',campaign:'c1'});
 assert.equal(notes.find(row=>row.event==='page_mode_skip')?.foreground,true);
}));

test('§266.10: under pointer reading a lean detail reading of indexed pages is handed back too, unless PI_COC_DETAIL_READS=1',async()=>lean(async()=>{
 const root=playtestScratch('page-mode','pointer-'),calls=[],notes=[],reading=await service(root,{calls,notes});
 await mkdir(join(root,'source-skeletons'),{recursive:true});
 await writeFile(api.skeletonPath(root,SHA),JSON.stringify({complete:true,sections:[{name:'All',first:1,last:12,status:'indexed'}],entities:[]}));
 let claims=0;const call=reading.deps.call;
 reading.deps.call=async(method,params)=>{
  if(method==='module.read.claim')return ++claims===1?{job_id:'read-2',lease:'L',purpose:'detail',focus:'Diner',pages:[5],module_id:'blood-road'}:{};
  return call(method,params);};
 reading.deps.runtime={...reading.deps.runtime,runTask:async()=>{throw new Error('no reader under pointer reading');}};
 assert.equal(reading.detailReads('blood-road'),false);
 await reading.pump('blood-road','c1');
 assert.equal(calls.find(([method])=>method==='module.read.finish')?.[1]?.detail,'pointer_reading');
 process.env.PI_COC_DETAIL_READS='1';
 try{assert.equal(reading.detailReads('blood-road'),true);}finally{delete process.env.PI_COC_DETAIL_READS;}
}));

test('§263.8: a table nobody plays stops background reading and hands back running background readings; the next activity resumes it',async()=>lean(async()=>{
 const root=playtestScratch('page-mode','idle-'),notes=[],reading=await service(root,{notes});
 const background=new AbortController(),waited=new AbortController();
 reading.controllers.set('bg',background);reading.jobs.set('bg',{job_id:'read-9',foreground:false});
 reading.controllers.set('fg',waited);reading.jobs.set('fg',{job_id:'read-8',foreground:true});
 assert.equal(reading.checkIdle(Date.now()),false,'not idle yet');
 assert.equal(reading.checkIdle(Date.now()+20*60*1000+1),true);
 assert.deepEqual([background.signal.aborted,waited.signal.aborted],[true,false],'a reading someone waits on goes on');
 assert.ok(reading.handedOff.has('bg'),'handed back for the next owner, not failed');
 assert.equal(notes.filter(row=>row.event==='idle_stop').length,1);
 reading.controllers.clear();reading.jobs.clear();
 reading.deps.call=async()=>({});
 await reading.prefetch('blood-road','turn-committed').catch(()=>undefined);
 assert.equal(notes.filter(row=>row.event==='idle_resume').length,1,'a committed turn resumes reading');
 reading.dispose();
}));

test('§266.11: a card reads numeric blocks on the pages that print the person, and keeps a number only where its block prints it',()=>{
 const blocks=[{id:'b17-1-a',page:17,text:'Russ Williams, gas station owner. STR 60 CON 55 SIZ 65 DEX 50 HP 12'},
  {id:'b17-2-b',page:17,text:'The station smells of oil and old rubber.'},
  {id:'b40-0-c',page:40,text:'Skills: Mechanical Repair 55%, Drive Auto 40%, Spot Hidden 30% (Russ)'},
  {id:'b41-0-d',page:41,text:'Nate: STR 70 CON 60 SIZ 80'}];
 const picked=api.cardBlocks(blocks,['Russ']);
 assert.deepEqual(picked.map(block=>block.id),['b17-1-a','b40-0-c'],'numeric blocks on pages printing his name; not another page\'s numbers');
 const short=new Map([['k1',blocks[0]],['k2',blocks[2]]]);
 const card=api.checkedCard({characteristics:{STR:{value:60,block:'k1'},DEX:{value:5,block:'k1'},POW:{value:70,block:'k2'}},derived:{HP:{value:'12',block:'k1'}},
  skills:[{name:'Mechanical Repair',value:55,block:'k2'},{name:'Drive Auto',value:45,block:'k2'},{name:'Spot Hidden',value:30,block:'k9'}]},short);
 assert.deepEqual(card.profile,{characteristics:{STR:60},derived:{HP:12},skills:{'Mechanical Repair':55}});
 assert.deepEqual(card.dropped.sort(),['characteristics.DEX','characteristics.POW','skills.Drive Auto','skills.Spot Hidden'],'5 is inside 50; 70 is not on its block; an unknown block is no block');
 assert.deepEqual(card.pages,[17,40]);
});

// 1026i: a source answer whose focus was only the book title came back with the front matter; its scene id, with nothing.
test('a source answer focused on the book title reads the party\'s scene pages; a scene id focus reads that scene\'s pages',async()=>lean(async()=>{
 const root=playtestScratch('page-mode','titled-'),notes=[],calls=[],reading=await service(root,{notes,calls});
 const searched=[];
 reading.deps.runtime={...reading.deps.runtime,sourceSearch:async({query})=>{searched.push(query);return {matches:[{page:1}]};}};
 reading.deps.call=async(method,params)=>{calls.push([method,params]);
  if(method==='module.source.snapshot')return {pdf:join(root,'book','book.pdf'),file_sha256:SHA,page_count:12,revision:'r1'};
  if(method==='module.status')return {title:'[COC模组翻译]血路-Blood Road'};
  if(method==='table.capsule')return {where:{scene:'investigator-information'}};
  if(method==='table.lookup')return params.query==='investigator-information'?{entities:[{name:'investigator-information',display_name:'Diner',kind:'scene',original_pages:[6,7]}]}:{entities:[]};
  return {};};
 const titled=await reading.leanAnswer('blood-road',{campaign:'c1',focus:'血路 Blood Road',question:'Who meets them at the counter?'});
 assert.deepEqual(titled.source_answer.excerpts.map(span=>span.page),[6,7],'the party\'s scene, not the title page');
 assert.deepEqual(searched,[],'the title is never text-searched');
 const byId=await reading.leanAnswer('blood-road',{campaign:'c1',focus:'investigator-information',question:'What does the cook know?'});
 const byIdPages=byId.source_answer.excerpts.map(span=>span.page);
 assert.ok(byIdPages.includes(6)&&byIdPages.includes(7),JSON.stringify(byIdPages));
 const plain=await reading.leanAnswer('blood-road',{campaign:'c1',focus:'Chapel',question:'Who keeps the key?'});
 assert.deepEqual(plain.source_answer.excerpts.map(span=>span.page),[1],'an ordinary focus keeps its text search');
 assert.equal(notes.find(row=>row.event==='lean_answer'&&row.titled)?.anchored,'Diner');
 // 1026k T10: the cut pages ride once, in excerpts, marked for whole delivery; the answer only points at them.
 assert.equal(titled.source_answer.host_pages,true);
 for(const span of titled.source_answer.excerpts)assert.ok(span.text.length&&!titled.source_answer.answer.includes(span.text),'each page\'s text rides once');
 assert.match(titled.source_answer.answer,/pages 6, 7 are in excerpts/);
}));
