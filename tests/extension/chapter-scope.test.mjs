/**
 * Contract §276: book reads keep to the current chapter. The chapters come from the bookmarks, else the typographic
 * headings; the current one from the party's scene, kept for a scene the table made; every read is cut to it, and a read
 * that finds nothing there answers `chapter_absent`.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const temp=playtestScratch('chapter-scope','suite-');
await build({stdin:{contents:[`export * from './runtime/chapter-scope.ts';`,`export {headingEntries} from './extensions/module/heading-chapters.ts';`,
 `export {ReadingService} from './extensions/module/reading-service.ts';`,
 `export {askResidentChapters, RESIDENT_RETRY, RESIDENT_FAMILY} from './runtime/jev/resident-chapters.ts';`,
 `export {createDecisionAdapter} from './runtime/jev/decision-adapter.ts';`].join('\n'),
 resolveDir:resolve(import.meta.dirname,'../..'),sourcefile:'chapter-scope-api.ts',loader:'ts'},outfile:join(temp,'api.mjs'),bundle:true,platform:'node',format:'esm',
 packages:'external',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
const SHA='c'.repeat(64);
const lean=async(run)=>{const previous=process.env.PI_COC_LEAN_READING;process.env.PI_COC_LEAN_READING='1';
 try{return await run();}finally{if(previous===undefined)delete process.env.PI_COC_LEAN_READING;else process.env.PI_COC_LEAN_READING=previous;}};

const item=(text,baseline,x,height,width=height*text.length)=>({text,baseline,x,width,height});
const body=page=>Array.from({length:30},(_,i)=>item('正文正文正文正文正文正文正文正文',700-i*14,40,11));

test('§276.1: the chapter tier is the largest heading height standing on two pages; same-baseline headings apart are two lines',()=>{
 const pages=[
  {page:1,items:[item('书名',780,40,36),...body(1)]},
  {page:2,items:[item('第一幕',760,40,22),item('介绍',730,40,22),item('小节',700,40,16),...body(2)]},
  {page:7,items:[item('第一部分',760,40,22),item('第二部分：',760,300,22),item('场景描述',760,410,22),...body(7)]},
  {page:9,items:[item('场景1：营地',760,40,16),...body(9)]},
  {page:13,items:[item('第三部分',760,40,22),...body(13)]},
 ];
 assert.deepEqual(api.headingEntries(pages),[{name:'第一幕',page:2},{name:'介绍',page:2},{name:'第一部分',page:7},{name:'第二部分：场景描述',page:7},{name:'第三部分',page:13}],
  'the title stands on one page only; 16 is a lower tier; the two columns of page 7 are two headings');
 assert.deepEqual(api.headingEntries([{page:1,items:body(1)}]),[],'no heading tier');
});

test('§276.1: bookmarks first, then headings, then the whole book; front matter is a chapter of its own',()=>{
 const marked=api.bookChapters({bookmarks:[{name:'Intro',page:3},{name:'Diner',page:6}],headings:[{name:'x',page:1},{name:'y',page:2}]},12);
 assert.equal(marked.source,'bookmarks');
 assert.deepEqual(marked.chapters,[{name:'front matter',first:1,last:2},{name:'Intro',first:3,last:5},{name:'Diner',first:6,last:12}]);
 const headed=api.bookChapters({bookmarks:[],headings:[{name:'第一幕',page:2},{name:'介绍',page:2},{name:'第二部分',page:7},{name:'第三部分',page:13}]},23);
 assert.equal(headed.source,'headings');
 assert.deepEqual(headed.chapters.map(row=>[row.name,row.first,row.last]),[['front matter',1,1],['介绍',2,6],['第二部分',7,12],['第三部分',13,23]]);
 assert.deepEqual(api.bookChapters({bookmarks:[{name:'only',page:1}]},9),{source:'none',chapters:[{name:'whole book',first:1,last:9}]});
});

test('§276.3, §276.4: an answer is cut to the chapter; one left with no page is the receipt; envelopes are cut answer by answer',()=>{
 const scope={name:'Diner',first:6,last:12,source:'bookmarks',resolved:'scene'};
 const answer={status:'excerpts',answer:'Original physical pages 2, 7 are in excerpts, in page order.',excerpts:[{page:2,text:'a'},{page:7,text:'b'}],
  source_refs:[{source_id:'pdf:m',pdf_index:1},{source_id:'pdf:m',pdf_index:6}]};
 const cut=api.scopeAnswer(answer,scope,'cook');
 assert.deepEqual(cut.excerpts.map(span=>span.page),[7]);
 assert.deepEqual(cut.source_refs.map(ref=>ref.pdf_index),[6]);
 assert.equal(cut.answer,'Original physical pages 7 are in excerpts, in page order.');
 assert.deepEqual(cut.chapter,{name:'Diner',first:6,last:12,source:'bookmarks'});
 const absent=api.scopeAnswer({...answer,excerpts:[{page:2,text:'a'}]},scope,'cook');
 assert.equal(absent.status,'chapter_absent');
 assert.match(absent.answer,/^The current chapter \(Diner, pages 6-12\) has nothing on cook\. .*do not search other parts of the book.*memory wins/);
 assert.equal('coverage' in absent||'read_next' in absent||'contents' in absent,false,'no partial, no next page, no contents');
 assert.deepEqual(api.scopeAnswer({status:'pending',focus:'cook'},scope,'cook'),{status:'pending',focus:'cook'},'nothing carried, nothing cut');
 const memo=api.scopeAnswer({status:'memo',answers:[{focus:'cook',...answer},{focus:'road',excerpts:[{page:1,text:'c'}]}]},scope,'x');
 assert.deepEqual(memo.answers.map(row=>row.status),['excerpts','chapter_absent']);
 assert.equal(api.scopeAnswer(answer,undefined,'cook'),answer,'no scope: unchanged');
});

/** A reading service over a fake kernel: a 12-page book whose chapters are Intro p3-5 and Diner p6-12. */
async function service(root,{scene,graph={},notes=[],searched=[],opening,campaignOpening,env,bookmarks=[{name:'Intro',page:3},{name:'Diner',page:6}],pageText=page=>`Text of page ${page}.`,pageCalls=[]}={}){
 const pdf=join(root,'book','book.pdf'),cache=join(root,'book','cache');
 await mkdir(cache,{recursive:true});
 await writeFile(join(cache,`blocks-${SHA}.json`),JSON.stringify({layout_version:'v',pages:Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,{page:i+1,blocks:[{id:`b${i+1}-0-x`,text:`Page ${i+1} heading`}]}]))}));
 const state={scene,campaignOpening};
 const reading=new api.ReadingService({
  call:async(method,params)=>{
   if(method==='module.source.snapshot')return {pdf,file_sha256:SHA,page_count:12,revision:'r1'};
   if(method==='module.status')return {title:'Blood Road',opening:opening?{start_scene:opening}:{},...(state.campaignOpening?{campaign_opening:state.campaignOpening}:{})};
   if(method==='table.capsule')return {where:{scene:state.scene,...(state.shown?{display_name:state.shown}:{})}};
   // A graph entry is its pages (a scene), or {pages, kind, properties, origin, relations} for another structural kind.
   if(method==='table.lookup'){const own=graph[params.query];if(!own)return {entities:[]};
    const entity=Array.isArray(own)?{kind:'scene',original_pages:own}:{kind:own.kind??'scene',...(own.properties?{properties:own.properties}:{}),original_pages:own.pages??[],
     ...(own.origin?{origin:own.origin}:{}),...(own.relations?{relations:own.relations}:{})};
    return {entities:[{name:params.query,...entity}]};}
   return {};},
  campaign:()=>'c1',home:root,model:()=>({id:'m',vision:true}),progress:()=>{},record:row=>notes.push(row),...(env?{env}:{}),
  runtime:{sourceInfo:async()=>({bookmarks}),
   sourceSearch:async request=>{searched.push(request);return {matches:[{page:2},{page:8}]};},
   sourceBlocks:async()=>{throw new Error('the block cache answers');},
   sourcePageText:async({pages})=>{pageCalls.push(pages);return {pages:pages.map(page=>({page,text:pageText(page),layer:'native'}))};}},
 });
 reading.books.set('blood-road',{sha:SHA,cache});
 return {reading,state};
}

test('§276.2: the scene\'s book pages name the chapter; a scene the table made keeps it; the opening, then the whole book unscoped, without either',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resolve-'),notes=[];
 const {reading,state}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10],'Gas station':[4],'Opening road':[3]},notes,opening:'Opening road'});
 assert.deepEqual(await reading.chapterScope('blood-road','c1'),{name:'Diner',first:6,last:12,source:'bookmarks',resolved:'scene'});
 state.scene='a back room the table made';
 assert.equal((await reading.chapterScope('blood-road','c1')).resolved,'kept');
 state.scene='Gas station';
 assert.equal((await reading.chapterScope('blood-road','c1')).name,'Intro','a book scene of another chapter moves the party there');
 assert.deepEqual(notes.filter(row=>row.event==='chapter_scope').map(row=>[row.chapter,row.resolved]),[['Diner','scene'],['Intro','scene']]);
 const fresh=await service(playtestScratch('chapter-scope','opening-'),{scene:'nowhere',graph:{'Opening road':[3]},opening:'Opening road'});
 assert.deepEqual([(await fresh.reading.chapterScope('blood-road','c2')).name,(await fresh.reading.chapterScope('blood-road','c2')).resolved],['Intro','kept']);
 const bare=await service(playtestScratch('chapter-scope','first-'),{scene:'nowhere'});
 assert.deepEqual(Object.values(await bare.reading.chapterScope('blood-road','c3')),['whole book',1,12,'bookmarks','none'],'no evidence: the whole book, unscoped');
 reading.dispose();fresh.reading.dispose();bare.reading.dispose();
}));

test('§276.2: a scene the graph has no pages for is found in the pointer index by the names it is shown by',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','index-');
 const {reading,state}=await service(root,{scene:'military-camp',graph:{}});
 state.shown='场景 1：营地';
 await mkdir(join(root,'source-skeletons'),{recursive:true});
 await writeFile(join(root,'source-skeletons',`${SHA}.json`),JSON.stringify({complete:true,entities:[{name:'营地',aliases:[],blocks:['b4-0-x','b4-1-x'],pages:[4]}]}));
 assert.deepEqual([(await reading.chapterScope('blood-road','c1')).name,(await reading.chapterScope('blood-road','c1')).resolved],['Intro','pointer']);
 reading.dispose();
}));

test('§276.2: only an indexed place places the party, the most specific one, in the chapter most of its pages stand in',async()=>lean(async()=>{
 // live 1030k du: a man's short alias inside a beach's name, and the median of pages spread over several chapters, put
 // the party at a later chapter's event while it searched the beach.
 const root=playtestScratch('chapter-scope','place-');
 const {reading,state}=await service(root,{scene:'beach-docks',graph:{}});
 state.shown='马丁滩码头';
 await mkdir(join(root,'source-skeletons'),{recursive:true});
 await writeFile(join(root,'source-skeletons',`${SHA}.json`),JSON.stringify({complete:true,entities:[
  {name:'马丁·海沃森',aliases:['马丁'],kinds:['npc'],blocks:[],pages:[3,10,11,12]},
  {name:'马丁滩',aliases:[],kinds:['location'],blocks:[],pages:[2,4,6,7,8]},
  {name:'码头',aliases:[],kinds:['location'],blocks:[],pages:[4,8]}]}));
 assert.deepEqual([(await reading.chapterScope('blood-road','c1')).name,(await reading.chapterScope('blood-road','c1')).resolved],['Diner','pointer'],
  'the beach, not the man; more than half of its pages are in Diner');
 assert.equal(api.placeChapter([{name:'Intro',first:3,last:5},{name:'Diner',first:6,last:12}],[4,8]),undefined,
  'a place split evenly decides nothing: the party stays where it was');
 reading.dispose();
}));

test('§276.3, §276.4: an answer reads and searches the chapter only, and answers chapter_absent when it has nothing',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','answer-'),searched=[],notes=[];
 const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10],'Old mill':[2,4]},searched,notes});
 const found=await reading.leanAnswer('blood-road',{campaign:'c1',focus:'cook',question:'What does the cook know?'});
 assert.deepEqual(searched.at(-1),{pdf:join(root,'book','book.pdf'),query:'cook',limit:8,first_page:6,last_page:12});
 assert.deepEqual(found.source_answer.excerpts.map(span=>span.page),[8],'page 2 is another chapter');
 assert.equal(found.source_answer.chapter.name,'Diner');
 assert.equal('coverage' in found.source_answer,false);
 const outside=await reading.leanAnswer('blood-road',{campaign:'c1',focus:'Old mill',question:'Who works the mill?'});
 assert.deepEqual(outside.source_answer.excerpts.map(span=>span.page),[8],'the mill\'s own pages are in another chapter; the search still runs in this one');
 reading.deps.runtime.sourceSearch=async request=>{searched.push(request);return {matches:[]};};
 const none=await reading.leanAnswer('blood-road',{campaign:'c1',focus:'the sheriff\'s cousin',question:'Where does he live?'});
 assert.equal(none.source_answer.status,'chapter_absent');
 assert.deepEqual(none.source_answer.checked,['text_search']);
 assert.match(none.source_answer.answer,/has nothing on the sheriff's cousin/);
 assert.equal(notes.at(-1).chapter_absent,true);
 reading.dispose();
}));

test('§276.3: turning pages keeps to the chapter, and its contents are the chapter\'s rows',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','pages-');
 const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]}});
 const some=await reading.bookPages('blood-road',{campaign:'c1',pages:[4,5,6]});
 assert.deepEqual(some.source_answer.excerpts.map(span=>span.page),[6]);
 assert.deepEqual(some.source_answer.outside_chapter,{pages:[4,5]});
 const away=await reading.bookPages('blood-road',{campaign:'c1',pages:[4]});
 assert.equal(away.source_answer.status,'chapter_absent');
 assert.match(away.source_answer.answer,/^Pages 4 are outside the current chapter \(Diner, pages 6-12\)\./);
 const contents=await reading.bookPages('blood-road',{campaign:'c1'});
 assert.deepEqual(contents.source_answer.contents.map(row=>row.name),['Diner']);
 assert.match(contents.source_answer.answer,/^The current chapter's contents \(Diner, physical pages 6-12\)/);
 reading.dispose();
}));

test('§276.2: the reading service answers other readers through the registered resolver, by campaign',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resolver-');
 const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]}});
 assert.equal(api.chapterResolverSet(),true);
 assert.equal((await api.currentChapter('c1','blood-road')).name,'Diner');
 assert.equal((await api.currentChapter('c1')).name,'Diner','the module its last read named');
 reading.dispose();
 assert.equal(api.chapterResolverSet(),false,'a disposed service no longer answers');
}));

/**
 * A fake Jev for §276.5 v2: every request is one question; `chapter(heading)` answers a chapter's Noul, `story(heading,page)`
 * a long chapter's page; undefined leaves that question unanswered.
 */
function fakeJev(asked,{chapter=()=>0.1,story=()=>0.1}={}){
 return async(_url,options)=>{const sent=JSON.parse(options.body);asked.push(sent);const answers={};
  for(const key of Object.keys(sent.questions??{})){
   const value=key.startsWith('story_')?story(sent.state.chapter.heading,sent.state.page.page):chapter(sent.state.chapter.heading);
   if(value!==undefined)answers[key]={type:'noul',noul:value};}
  return Response.json({model:sent.model,usage:{input_tokens:10,output_tokens:2},answers});};
}
const residentBook=[{name:'Background',page:2},{name:'Intro',page:3},{name:'Diner',page:6}];
const chapterAsks=asked=>asked.filter(sent=>Object.keys(sent.questions).every(key=>key.startsWith('resident_')));
const pageAsks=asked=>asked.filter(sent=>Object.keys(sent.questions).every(key=>key.startsWith('story_')));

test('§276.5: Jev names the reference chapters, read from any chapter; asked once per book and kept by file hash',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resident-'),notes=[],asked=[];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=fakeJev(asked,{chapter:heading=>heading==='Background'?0.9:0.1});
 try{
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},notes,bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  const scope=await reading.chapterScope('blood-road','c1');
  assert.deepEqual(scope.resident,[{name:'Background',first:2,last:2}]);
  // front matter 1-1, Background 2-2, Intro 3-5, Diner 6-12: four chapter questions and Diner's seven pages, one request each.
  assert.equal(chapterAsks(asked).length,4);assert.equal(pageAsks(asked).length,7);assert.equal(asked.length,11);
  assert.ok(asked.every(sent=>Object.keys(sent.questions).length===1&&sent.model==='jev-1.13.0'),'one question per request, pinned model');
  assert.ok(asked.every(sent=>sent.state.book_outline.length===4&&!('book_chapters' in sent.state)),'each request holds the outline and its own chapter');
  assert.equal(api.inChapter(scope,2),true);assert.equal(api.inChapter(scope,4),false);
  const pages=await reading.bookPages('blood-road',{campaign:'c1',pages:[2,4,7]});
  assert.deepEqual(pages.source_answer.excerpts.map(span=>span.page),[2,7]);
  assert.deepEqual(pages.source_answer.chapter.resident,[{name:'Background',first:2,last:2}]);
  const contents=await reading.bookPages('blood-road',{campaign:'c1'});
  assert.deepEqual(contents.source_answer.contents.map(row=>row.name),['Background','Diner']);
  const away=await reading.bookPages('blood-road',{campaign:'c1',pages:[4]});
  assert.match(away.source_answer.answer,/and the book's reference chapters \(Background, pages 2-2\)/);
  await reading.chapterScope('blood-road','c1');
  assert.equal(asked.length,11,'asked once');
  reading.dispose();
  const again=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.deepEqual((await again.reading.chapterScope('blood-road','c1')).resident,[{name:'Background',first:2,last:2}]);
  assert.equal(asked.length,11,'kept on disk by file hash');
  again.reading.dispose();
  const note=notes.find(row=>row.event==='resident_chapters');
  assert.equal(note?.resident?.[0],'Background');assert.equal(note.family_version,'2');assert.equal(note.requests,11);
  assert.deepEqual(note.story_pages.map(([name,rows])=>[name,rows.length]),[['Diner',7]]);
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.5 v2: a chapter of up to six pages is shown whole, each page cut to 1000 characters, read without queuing transcripts',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resident-whole-'),asked=[],pageCalls=[];
 const oldFetch=globalThis.fetch;globalThis.fetch=fakeJev(asked);
 try{
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,pageCalls,
   pageText:page=>`Page ${page} `+'x'.repeat(3000),env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  await reading.chapterScope('blood-road','c1');
  const intro=chapterAsks(asked).find(sent=>sent.state.chapter.heading==='Intro').state.chapter;
  assert.equal(intro.sampled,'every page');
  assert.deepEqual(intro.samples.map(row=>row.page),[3,4,5]);
  assert.ok(intro.samples.every(row=>row.text.length===1000&&row.text.startsWith(`Page ${row.page} `)));
  const diner=chapterAsks(asked).find(sent=>sent.state.chapter.heading==='Diner').state.chapter;
  assert.equal(diner.sampled,'first, middle and last page');
  assert.deepEqual(diner.samples.map(row=>row.page),[6,9,12],'a long chapter: first, middle and last');
  assert.deepEqual(pageAsks(asked).map(sent=>sent.state.page.page).sort((a,b)=>a-b),[6,7,8,9,10,11,12]);
  assert.ok(pageAsks(asked).every(sent=>sent.state.page.text.length===1000));
  assert.deepEqual(pageCalls.flat().sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1),'every page of the book read once for the ask');
  reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.5 v2: one page of a long chapter judged story keeps the whole chapter from being resident',async()=>lean(async()=>{
 const oldFetch=globalThis.fetch;
 try{
  const asked=[];globalThis.fetch=fakeJev(asked,{chapter:heading=>['Background','Diner'].includes(heading)?0.9:0.1,story:(_,page)=>page===10?0.6:0.1});
  const {reading}=await service(playtestScratch('chapter-scope','resident-story-'),{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.deepEqual((await reading.chapterScope('blood-road','c1')).resident,[{name:'Background',first:2,last:2}],'Diner page 10 is story');
  reading.dispose();
  const calm=[];globalThis.fetch=fakeJev(calm,{chapter:heading=>['Background','Diner'].includes(heading)?0.9:0.1,story:()=>0.49});
  // The party is in Intro: a current chapter is not listed again among the resident ones.
  const other=await service(playtestScratch('chapter-scope','resident-calm-'),{scene:'Intro hall',graph:{'Intro hall':[3,4]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.deepEqual((await other.reading.chapterScope('blood-road','c1')).resident.map(row=>row.name),['Background','Diner'],'no page reaches 0.5');
  other.reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.5 v2: a verdict kept under the old version, or another question, is asked again',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resident-stale-'),asked=[];
 const file=join(root,'.coc','chapter-scope',`resident-${SHA}.json`);
 await mkdir(join(root,'.coc','chapter-scope'),{recursive:true});
 await writeFile(file,JSON.stringify({version:'1',resident:[{name:'Diner',first:6,last:12}]})+'\n');
 const oldFetch=globalThis.fetch;globalThis.fetch=fakeJev(asked,{chapter:heading=>heading==='Background'?0.9:0.1});
 try{
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.deepEqual((await reading.chapterScope('blood-road','c1')).resident,[{name:'Background',first:2,last:2}],'the v1 verdict is not used');
  assert.equal(asked.length,11);reading.dispose();
  const kept=JSON.parse(await (await import('node:fs/promises')).readFile(file,'utf8'));
  assert.equal(kept.version,'2');assert.equal(kept.family,'resident-chapters');assert.match(kept.question,/^[0-9a-f]{16}$/);
  await writeFile(file,JSON.stringify({...kept,question:'0'.repeat(16)})+'\n');
  const again=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  await again.reading.chapterScope('blood-road','c1');
  assert.equal(asked.length,22,'another question digest is asked again');
  again.reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.5: a Jev that cannot answer leaves no resident chapter, and the next session asks again',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resident-down-');
 const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('overloaded',{status:529});};
 try{
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.equal((await reading.chapterScope('blood-road','c1')).resident,undefined);
  const asked=calls;assert.ok(asked>=1);
  // audit 1101: the next read of the same session does not ask the book again; only the next session does.
  assert.equal((await reading.chapterScope('blood-road','c1')).resident,undefined);
  assert.equal(calls,asked,'not asked again in this session');reading.dispose();
  const next=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  await next.reading.chapterScope('blood-road','c1');
  assert.ok(calls>asked,'the next session asks again');next.reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.5: a verdict with any question unanswered sets no resident chapter, even one answered yes, and is not kept',async()=>lean(async()=>{
 // audit 1031: the code kept the chapters already answered above the threshold; the contract says none.
 const root=playtestScratch('chapter-scope','resident-partial-');
 const oldFetch=globalThis.fetch;const asked=[];
 globalThis.fetch=fakeJev(asked,{chapter:heading=>heading==='Background'?0.9:heading==='Diner'?undefined:0.1});
 try{
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.equal((await reading.chapterScope('blood-road','c1')).resident,undefined,'no resident chapter at all');
  reading.dispose();
  const first=asked.length;
  const again=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  await again.reading.chapterScope('blood-road','c1');
  assert.equal(asked.length,2*first,'nothing kept: the next session asks again');
  again.reading.dispose();
  // An unanswered page question counts the same.
  const pages=[];globalThis.fetch=fakeJev(pages,{chapter:heading=>heading==='Background'?0.9:0.1,story:(_,page)=>page===8?undefined:0.1});
  const third=await service(playtestScratch('chapter-scope','resident-partial-page-'),{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks:residentBook,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.equal((await third.reading.chapterScope('blood-road','c1')).resident,undefined);
  third.reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.2: an opening with no majority of pages starts in the chapter of its first page, not the first chapter',async()=>lean(async()=>{
 // audit 1031: du's opening on [4,5], cs's on [4,14,17] fell through to the first chapter, the keeper's background.
 const {reading}=await service(playtestScratch('chapter-scope','opening-split-'),{scene:'a place the table made',graph:{'Opening road':[4,7]},opening:'Opening road',
  bookmarks:[{name:'Background',page:2},{name:'Intro',page:3},{name:'Diner',page:6}]});
 const scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.resolved],['Intro','opening']);
 reading.dispose();
}));

test('§276.2: only a place\'s pages place the party: an opening\'s reading anchor or the module root falls through',async()=>lean(async()=>{
 // live7 du-1101a/b: where.scene was the opening's reading anchor (`is_entrance` + `source_reference_anchor`), on the title page
 // and the keeper's background (pages 2-3), and its pages held the party in the background while it played elsewhere.
 const anchor={pages:[2,3],properties:{is_entrance:true,source_reference_anchor:true,opening_pages_text:true}};
 const bookmarks=[{name:'Background',page:2},{name:'Intro',page:4},{name:'Diner',page:6}];
 const notes=[];
 const {reading,state}=await service(playtestScratch('chapter-scope','anchor-scene-'),{scene:'book-title-entry',notes,bookmarks,campaignOpening:'investigator-hook',
  graph:{'book-title-entry':anchor,'investigator-hook':{pages:[4],properties:{is_entrance:true,source_reference_anchor:true}},
   'reference place':{pages:[7],properties:{source_reference_anchor:true}},'read entrance':{pages:[2],properties:{is_entrance:true}},
   'book-module':{kind:'module',pages:[2]}}});
 let scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.resolved],['Intro','opening'],'the anchor decides nothing as the scene; the opening anchor does as the opening');
 state.scene='reference place';
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','scene'],'a place minted from the reference is a place');
 state.scene='book-title-entry';
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','kept'],'back in the anchor, the party keeps its chapter');
 state.scene='book-module';
 assert.equal((await reading.chapterScope('blood-road','c1')).resolved,'kept','the module root is no place');
 state.scene='read entrance';
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Background','scene'],'a read entrance scene is a place');
 reading.dispose();
 // An opening that resolves to the module root has no pages: the book is read unscoped.
 const root=await service(playtestScratch('chapter-scope','anchor-root-'),{scene:'book-title-entry',bookmarks,campaignOpening:'book-module',
  graph:{'book-title-entry':anchor,'book-module':{kind:'module',pages:[6]}}});
 assert.equal((await root.reading.chapterScope('blood-road','c1')).resolved,'none');
 root.reading.dispose();
 assert.deepEqual([api.placesParty({kind:'location'}),api.placesParty({kind:'npc'}),api.placesParty(undefined),api.placesParty({kind:'scene',properties:anchor.properties},'opening')],[true,false,false,true]);
}));

test('§276.2: a place locates the party only when more than half of its pages stand in one chapter',()=>{
 const book=[{name:'front matter',first:1,last:1},{name:'Keeper background',first:2,last:3},{name:'Player hook',first:4,last:4},
  {name:'Town',first:5,last:6},{name:'Beach',first:7,last:14},{name:'Grave',first:15,last:17},{name:'Pregens',first:18,last:20}];
 assert.equal(api.placeChapter(book,[8,9,10,16]).name,'Beach','three of four pages');
 // live 1031 dg: graph pages split evenly between two chapters say nothing about where the party is.
 assert.equal(api.placeChapter(book,[8,9,15,16]),undefined);
 // audit 1031 du: Arkham places named on the background, the hook, the town and a later event: nothing moves.
 assert.equal(api.placeChapter(book,[2,3,4,5,16,17]),undefined);
 // audit 1031 ad: a city named on pages over many chapters, a fifth of them in one: nothing moves.
 assert.equal(api.placeChapter(book,[2,4,5,8,9,15,18]),undefined);
 // Every chapter counts, resident or not: a place on the town's pages is there.
 assert.equal(api.placeChapter(book,[5,6,9]).name,'Town');
 // Known issue, not fixed here: a city named mostly in the pregenerated investigators still lands there.
 assert.equal(api.placeChapter(book,[4,18,19,20]).name,'Pregens');
 assert.equal(api.placeChapter(book,[]),undefined,'no pages decide nothing');
});

test('§276.2: a fork\'s opening is the campaign\'s recorded opening, not the book node id the module names',async()=>lean(async()=>{
 // live 1031 cs/du: module.status named `scene-source-entry-1`, a node id no lookup row of a name-free campaign shows; the
 // campaign recorded its handle `cult-initiation-ceremony`, and the opening never matched.
 const notes=[];
 const {reading}=await service(playtestScratch('chapter-scope','opening-fork-'),{scene:'a place the table made',notes,
  graph:{'cult-initiation-ceremony':[4,7,11]},opening:'scene-source-entry-1',campaignOpening:'cult-initiation-ceremony',
  bookmarks:[{name:'Background',page:2},{name:'Intro',page:3},{name:'Diner',page:6}]});
 const scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.resolved],['Diner','opening'],'two of its three pages stand in Diner');
 assert.deepEqual(notes.filter(row=>row.event==='chapter_scope').map(row=>row.resolved),['opening']);
 reading.dispose();
}));

test('§276.2: with no evidence the book is read unscoped, never kept: a later read with an opening or a scene still locates the party',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','first-stand-in-'),notes=[];
 const {reading,state}=await service(root,{scene:'a place the table made',notes,graph:{'Opening road':[4,5],'Diner counter':[6,9]}});
 const file=join(root,'.coc','chapter-scope');
 assert.deepEqual([(await reading.chapterScope('blood-road','c1')).resolved,(await reading.chapterScope('blood-road','c1')).resolved],['none','none'],'not kept');
 // Unscoped: no chapter restriction, every page reads.
 const all=await reading.bookPages('blood-road',{campaign:'c1',pages:[2,4,9]});
 assert.deepEqual(all.source_answer.excerpts.map(span=>span.page),[2,4,9]);
 assert.equal(all.source_answer.chapter.unscoped,true);
 assert.doesNotMatch(all.source_answer.note,/current chapter's/);
 assert.equal(await (await import('node:fs/promises')).readdir(file).then(rows=>rows.filter(name=>!name.startsWith('resident-')).length,()=>0),0,'nothing written');
 state.campaignOpening='Opening road';
 assert.deepEqual(Object.values(await reading.chapterScope('blood-road','c1')).slice(0,4),['Intro',3,5,'bookmarks']);
 state.scene='Diner counter';
 assert.equal((await reading.chapterScope('blood-road','c1')).resolved,'scene');
 state.scene='a back room the table made';
 assert.deepEqual([(await reading.chapterScope('blood-road','c1')).name,(await reading.chapterScope('blood-road','c1')).resolved],['Diner','kept'],'a located chapter is kept');
 assert.deepEqual(notes.filter(row=>row.event==='chapter_scope').map(row=>[row.chapter,row.resolved]),[['whole book','none'],['Intro','opening'],['Diner','scene']],
  'the unscoped read is noted once');
 reading.dispose();
 const fresh=await service(root,{scene:'a place the table made',graph:{}});
 assert.equal((await fresh.reading.chapterScope('blood-road','c1')).resolved,'kept','a kept chapter is read back from disk');
 fresh.reading.dispose();
}));


test('§276.2: a kept file without the format version or a known source is void; a versioned entry with its evidence is kept',async()=>lean(async()=>{
 const {createHash}=await import('node:crypto'),{readFile}=await import('node:fs/promises');
 const write=async(root,campaign,value)=>{const dir=join(root,'.coc','chapter-scope');await mkdir(dir,{recursive:true});
  const file=join(dir,`${createHash('sha256').update(campaign).digest('hex').slice(0,32)}.json`);await writeFile(file,JSON.stringify(value)+'\n');return file;};
 // Before 2026-11-01 a first-chapter stand-in was written in this shape and read back as kept for good.
 const old=playtestScratch('chapter-scope','kept-legacy-');
 const file=await write(old,'c1',{'blood-road':{name:'Intro',first:3,last:5,campaign:'c1'}});
 const legacy=await service(old,{scene:'a place the table made',graph:{'Opening road':[6,7]},campaignOpening:'Opening road'});
 assert.deepEqual([(await legacy.reading.chapterScope('blood-road','c1')).resolved,(await legacy.reading.chapterScope('blood-road','c1')).name],['opening','Diner'],'the old entry is not kept');
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{version:3,modules:{'blood-road':{name:'Diner',first:6,last:12,campaign:'c1',source:'opening'}}},'overwritten from evidence');
 legacy.reading.dispose();
 for(const entry of [{version:2,modules:{'blood-road':{name:'Intro',first:3,last:5,campaign:'c1'}}},{version:2,modules:{'blood-road':{name:'Intro',first:3,last:5,campaign:'c1',source:'first'}}},
  // A version 2 entry located from the opening was located before the resident threshold.
  {version:2,modules:{'blood-road':{name:'Intro',first:3,last:5,campaign:'c1',source:'opening'}}}]){
  const root=playtestScratch('chapter-scope','kept-void-');await write(root,'c1',entry);
  const {reading}=await service(root,{scene:'a place the table made',graph:{'Opening road':[6,7]},campaignOpening:'Opening road'});
  assert.equal((await reading.chapterScope('blood-road','c1')).resolved,'opening','no source, or an unknown one, is void');reading.dispose();}
 const kept=playtestScratch('chapter-scope','kept-versioned-');
 await write(kept,'c1',{version:2,modules:{'blood-road':{name:'Intro',first:3,last:5,campaign:'c1',source:'pointer_majority'}}});
 const versioned=await service(kept,{scene:'a place the table made',graph:{'Opening road':[6,7]},campaignOpening:'Opening road'});
 assert.deepEqual([(await versioned.reading.chapterScope('blood-road','c1')).name,(await versioned.reading.chapterScope('blood-road','c1')).resolved],['Intro','kept']);
 versioned.reading.dispose();
}));

/**
 * §276.5 retry (audit 1101): the unanswered questions were connection failures (undici UND_ERR_CONNECT_TIMEOUT), which the
 * adapter's default turned into `service_error` and the whole verdict into none. A fake Jev transport: `plan(key, n)` says
 * what the n-th attempt of a question gets: 'ok', a status number, 'reset' (a failed connection) or 'hang'.
 */
function flakyJev(plan,fetches){
 return async(_url,init)=>{const sent=JSON.parse(init.body),key=Object.keys(sent.questions)[0];fetches[key]=(fetches[key]??0)+1;
  const what=plan(key,fetches[key]);
  if(what==='reset')throw new TypeError('fetch failed',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});
  if(what==='hang')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  if(typeof what==='number')return new Response('busy',{status:what,headers:{'retry-after-ms':'5'}});
  return Response.json({model:sent.model,usage:{input_tokens:10,output_tokens:2},answers:{[key]:{type:'noul',noul:key==='resident_c0'?0.9:0.1}}});};
}
const askedBook=[{name:'Background',first:1,last:1,pages:[{page:1,text:'a'}]},{name:'Story',first:2,last:3,pages:[{page:2,text:'b'},{page:3,text:'c'}]}];
const residentAsk=(fetcher,timeoutMs=30_000)=>api.askResidentChapters({moduleId:'m',sourceSha:SHA,timeoutMs,chapters:askedBook},
 api.createDecisionAdapter({apiKey:'deterministic',fetcher,maxConcurrency:4,retryPolicies:{[api.RESIDENT_FAMILY]:api.RESIDENT_RETRY}}));

test('§276.5: a failed connection or a 529 is retried within bound, and the verdict is whole',async()=>{
 const fetches={};
 const asked=await residentAsk(flakyJev((key,n)=>key==='resident_c0'&&n===1?'reset':key==='resident_c1'&&n<3?529:'ok',fetches));
 assert.equal(asked.failed,undefined);assert.deepEqual(asked.resident,[true,false]);
 assert.deepEqual(fetches,{resident_c0:2,resident_c1:3},'a reset once, a 529 twice, each answered on the next attempt');
});

test('§276.5: retries are bounded; a question still refused is unanswered, with its status, and nothing is resident',async()=>{
 const fetches={};
 const asked=await residentAsk(flakyJev(key=>key==='resident_c1'?529:'ok',fetches));
 assert.equal(fetches.resident_c1,1+api.RESIDENT_RETRY.maxRetries,'three attempts, no more');
 assert.equal(asked.failed,'rate_limited');assert.equal(asked.failedStatus,529);
 assert.deepEqual(asked.resident,[false,false],'a partial verdict sets no resident chapter');
 const reset={},down=await residentAsk(flakyJev(key=>key==='resident_c0'?'reset':'ok',reset));
 assert.equal(reset.resident_c0,3);assert.equal(down.failed,'service_error');assert.equal(down.failedStatus,'network_error');
});

test('§276.5: the whole book\'s deadline holds: an attempt with no response ends at it, and the question is unanswered',async()=>{
 const fetches={},began=Date.now();
 const asked=await residentAsk(flakyJev(key=>key==='resident_c1'?'hang':'ok',fetches),300);
 assert.ok(Date.now()-began<2000,'ended by the deadline, not the 4 s attempt timeout');
 assert.equal(asked.failed,'timeout');assert.deepEqual(asked.resident,[false,false]);
});

test('§276.5: the reading service asks with the retry, and notes the retries and a failure\'s status',async()=>lean(async()=>{
 const oldFetch=globalThis.fetch,notes=[];
 try{
  const fetches={};globalThis.fetch=flakyJev((key,n)=>n===1&&key==='resident_c1'?'reset':'ok',fetches);
  const {reading}=await service(playtestScratch('chapter-scope','resident-retry-'),{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},notes,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  const scope=await reading.chapterScope('blood-road','c1');reading.dispose();
  const note=notes.find(row=>row.event==='resident_chapters');
  assert.equal(note.failed,undefined);assert.equal(note.retries,1);assert.equal(fetches.resident_c1,2);
  assert.ok(Array.isArray(scope.resident),'answered on the retry: the verdict stands');
  const down={},more=[];globalThis.fetch=flakyJev(key=>key==='resident_c1'?503:'ok',down);
  const {reading:again}=await service(playtestScratch('chapter-scope','resident-retry-down-'),{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},notes:more,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.equal((await again.chapterScope('blood-road','c1')).resident,undefined);again.dispose();
  const failed=more.find(row=>row.event==='resident_chapters');
  assert.equal(failed.failed,'service_error');assert.equal(failed.failed_status,503);assert.equal(failed.retries,2);
 }finally{globalThis.fetch=oldFetch;}
}));


test('§276.2: an opening whose pages all stand in resident chapters starts play in the first non-resident chapter after them, and is kept',async()=>lean(async()=>{
 // live7 du: the campaign's opening is a reading anchor on the title page and the keeper's background (pages [2,3]), both
 // resident; play starts in the next chapter that is not (here Intro, from page 4).
 const anchor={pages:[2,3],properties:{is_entrance:true,source_reference_anchor:true,opening_pages_text:true}};
 const bookmarks=[{name:'Title',page:2},{name:'Background',page:3},{name:'Intro',page:4},{name:'Diner',page:6}];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=fakeJev([],{chapter:heading=>heading==='Title'||heading==='Background'?0.9:0.1});
 try{
  const root=playtestScratch('chapter-scope','opening-resident-'),notes=[];
  const {reading,state}=await service(root,{scene:'dust-entry',notes,bookmarks,campaignOpening:'dust-entry',env:{...process.env,TYPESAFE_API_KEY:'deterministic'},
   graph:{'dust-entry':anchor,'Diner counter':[6,9,10]}});
  let scope=await reading.chapterScope('blood-road','c1');
  assert.deepEqual([scope.name,scope.first,scope.last,scope.resolved,scope.resident?.map(own=>own.name)],['Intro',4,5,'opening',['Title','Background']],
   'not the background: the chapter after it');
  assert.deepEqual(notes.filter(row=>row.event==='chapter_scope').map(row=>[row.chapter,row.resolved,row.opening_rule]),[['Intro','opening','after_resident']]);
  const {createHash}=await import('node:crypto');
  const kept=JSON.parse(await (await import('node:fs/promises')).readFile(join(root,'.coc','chapter-scope',`${createHash('sha256').update('c1').digest('hex').slice(0,32)}.json`),'utf8'));
  assert.equal(kept.modules['blood-road'].source,'opening','kept as the opening');
  state.scene='a back room the table made';
  assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Intro','kept'],'a place with no pages keeps it');
  state.scene='Diner counter';
  assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','scene'],'a place whose pages hold a majority elsewhere overrides it');
  state.scene='dust-entry';
  assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','kept'],'back in the anchor, the party keeps its chapter');
  reading.dispose();
  // One page outside every resident chapter: the opening's pages are evidence and locate by the majority rule.
  const split=await service(playtestScratch('chapter-scope','opening-resident-split-'),{scene:'dust-entry',bookmarks,campaignOpening:'dust-entry',
   env:{...process.env,TYPESAFE_API_KEY:'deterministic'},graph:{'dust-entry':{...anchor,pages:[3,4]}}});
  assert.deepEqual([(scope=await split.reading.chapterScope('blood-road','c1')).name,scope.resolved],['Background','opening']);
  split.reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
 // No non-resident chapter after the anchor: nothing locates, the book is read unscoped and nothing is kept.
 globalThis.fetch=fakeJev([],{chapter:heading=>heading==='Diner'?0.1:0.9});
 try{
  const root=playtestScratch('chapter-scope','opening-resident-none-');
  const {reading}=await service(root,{scene:'dust-entry',bookmarks:[{name:'Title',page:2},{name:'Background',page:3},{name:'Stats',page:4}],
   campaignOpening:'dust-entry',env:{...process.env,TYPESAFE_API_KEY:'deterministic'},graph:{'dust-entry':anchor}});
  const scope=await reading.chapterScope('blood-road','c1');
  assert.deepEqual([scope.name,scope.first,scope.last,scope.resolved,scope.resident],['whole book',1,12,'none',undefined]);
  const {readdir}=await import('node:fs/promises');
  assert.equal(await readdir(join(root,'.coc','chapter-scope')).then(rows=>rows.filter(name=>!name.startsWith('resident-')).length,()=>0),0,'never kept');
  reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
 const chapters=[{name:'Title',first:2,last:2},{name:'Background',first:3,last:3},{name:'Stats',first:4,last:5},{name:'Diner',first:6,last:12}];
 assert.deepEqual(api.openingChapter(chapters,[2,3],chapters.slice(0,3)),{chapter:chapters[3],rule:'after_resident'},'resident chapters after the anchor are passed over');
 assert.equal(api.openingChapter(chapters,[],chapters.slice(0,2)),undefined,'no pages locate nothing');
}));

test('§276.2: a scene that is the opening\'s reading anchor is judged by the opening rule, before the pointer index',async()=>lean(async()=>{
 // audit integ-1101 bm: the opening scene is an anchor on [4,6,7]; with it skipped as a scene, the pointer index for the name it
 // is shown by (most of its pages in the character list) located the party there before the opening could decide.
 const anchor=pages=>({pages,properties:{is_entrance:true,source_reference_anchor:true}});
 const bookmarks=[{name:'Background',page:2},{name:'Briefing',page:4},{name:'Flight',page:6},{name:'Characters',page:10}];
 const root=playtestScratch('chapter-scope','anchor-opening-'),notes=[];
 const {reading,state}=await service(root,{scene:'briefing-scene',notes,bookmarks,campaignOpening:'briefing-scene',graph:{'briefing-scene':anchor([4,6,7])}});
 state.shown='Briefing room';
 await mkdir(join(root,'source-skeletons'),{recursive:true});
 await writeFile(join(root,'source-skeletons',`${SHA}.json`),JSON.stringify({complete:true,entities:[
  {name:'Briefing room',aliases:[],kinds:['location'],blocks:[],pages:[2,10,11,12]},{name:'Launch pad',aliases:[],kinds:['location'],blocks:[],pages:[10,11]}]}));
 let scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.first,scope.last,scope.resolved],['Flight',6,9,'opening'],'two of the anchor\'s three pages, not the pointer index');
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Flight','kept']);
 state.scene='launch-pad';state.shown='Launch pad';
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Characters','pointer'],'a later place: the pointer index as before');
 reading.dispose();
 // dg: the opening camp is an anchor on [8,9]; the pointer index would agree, but the anchor decides as the opening.
 const camp=await service(playtestScratch('chapter-scope','anchor-camp-'),{scene:'camp',campaignOpening:'camp',
  bookmarks:[{name:'Intro',page:3},{name:'Scenes',page:7}],graph:{'camp':anchor([8,9])}});
 assert.deepEqual([(scope=await camp.reading.chapterScope('blood-road','c1')).name,scope.first,scope.last,scope.resolved],['Scenes',7,12,'opening']);
 camp.reading.dispose();
}));

/** A place the table made (`origin.kind: table`, no pages), registered inside the places `within` names (`located-in`). */
const made=(...within)=>({pages:[],origin:{kind:'table'},relations:[...within.map(to=>({kind:'located-in',to})),{kind:'route-to',to:'Opening road'}]});

test('§276.2 rule A: a place the table made is located by the pages of the place it was registered inside, and kept as scene_parent',async()=>lean(async()=>{
 const {createHash}=await import('node:crypto'),{readFile}=await import('node:fs/promises');
 const root=playtestScratch('chapter-scope','parent-'),notes=[];
 const {reading,state}=await service(root,{scene:'back room',notes,campaignOpening:'Opening road',
  graph:{'back room':made('Diner hall'),'Diner hall':[6,9,10],'Opening road':[3]}});
 let scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.first,scope.last,scope.resolved],['Diner',6,12,'scene_parent'],'the parent\'s pages, not the opening (Intro)');
 const file=join(root,'.coc','chapter-scope',`${createHash('sha256').update('c1').digest('hex').slice(0,32)}.json`);
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{version:3,modules:{'blood-road':{name:'Diner',first:6,last:12,campaign:'c1',source:'scene_parent'}}});
 assert.deepEqual(notes.filter(row=>row.event==='chapter_scope').map(row=>[row.chapter,row.resolved,row.parent_level]),[['Diner','scene_parent',1]]);
 reading.dispose();
 // A scene_parent entry is kept evidence: a fresh service reads it back for a place nothing locates.
 const again=await service(root,{scene:'a place the table made',graph:{'Opening road':[3]},campaignOpening:'Opening road'});
 assert.deepEqual([(scope=await again.reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','kept']);
 again.reading.dispose();
}));

test('§276.2 rule A: the walk passes a parent with no pages to the grandparent, two levels up',async()=>lean(async()=>{
 const notes=[];
 const {reading}=await service(playtestScratch('chapter-scope','grandparent-'),{scene:'cellar',notes,campaignOpening:'Diner counter',
  graph:{'cellar':made('station shed'),'station shed':made('Gas station'),'Gas station':[4],'Diner counter':[6,9,10]}});
 const scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.resolved],['Intro','scene_parent']);
 assert.equal(notes.find(row=>row.event==='chapter_scope').parent_level,2);
 reading.dispose();
}));

test('§276.2 rule A: with no ancestor with pages within three levels the read falls through to the kept chapter',async()=>lean(async()=>{
 const {reading,state}=await service(playtestScratch('chapter-scope','no-parent-'),{scene:'Diner counter',campaignOpening:'Opening road',
  graph:{'Diner counter':[6,9,10],'Opening road':[3],'loft':made('attic'),'attic':made(),
   'deep':made('l1'),'l1':made('l2'),'l2':made('l3'),'l3':made('Gas station'),'Gas station':[4]}});
 assert.equal((await reading.chapterScope('blood-road','c1')).name,'Diner');
 state.scene='loft';
 let scope=await reading.chapterScope('blood-road','c1');
 assert.deepEqual([scope.name,scope.resolved],['Diner','kept'],'the attic has no pages and no parent');
 state.scene='deep';
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','kept'],'the place with pages is four levels up');
 state.scene='an unregistered room';
 assert.deepEqual([(scope=await reading.chapterScope('blood-road','c1')).name,scope.resolved],['Diner','kept'],'no row: as before');
 reading.dispose();
}));

test('§276.2 rule A: a place registered inside itself, or a cycle, ends the walk and falls through to the kept chapter',async()=>lean(async()=>{
 const {reading,state}=await service(playtestScratch('chapter-scope','cycle-'),{scene:'Diner counter',campaignOpening:'Opening road',
  graph:{'Diner counter':[6,9,10],'Opening road':[3],'mirror':made('mirror'),'east':made('west'),'west':made('east')}});
 assert.equal((await reading.chapterScope('blood-road','c1')).name,'Diner');
 for(const scene of ['mirror','east']){state.scene=scene;const scope=await reading.chapterScope('blood-road','c1');
  assert.deepEqual([scope.name,scope.resolved],['Diner','kept'],scene);}
 const lookups=[];
 assert.equal(await api.sceneParentPages({name:'east',kind:'scene',origin:{kind:'table'},relations:[{kind:'located-in',to:'west'}]},
  async handle=>{lookups.push(handle);return {name:'west',kind:'scene',origin:{kind:'table'},relations:[{kind:'part-of',to:'east'}]};}),undefined);
 assert.deepEqual(lookups,['west'],'east is not read again');
 reading.dispose();
}));

test('§276.2 rule A: only a place the table made walks up, by located-in then part-of; a book place with no pages does not',async()=>{
 const book={name:'hall',kind:'scene',relations:[{kind:'located-in',to:'town'}]};
 assert.equal(await api.sceneParentPages(book,async()=>({name:'town',kind:'scene',original_pages:[4]})),undefined);
 assert.deepEqual(api.placeParents({name:'r',relations:[{kind:'part-of',to:'b'},{kind:'route-to',to:'x'},{kind:'located-in',to:'a'},{kind:'located-in',to:'r'}]}),['a','b']);
 const root={name:'m',kind:'module',original_pages:[1,2]},place={name:'p',kind:'location',original_pages:[5]};
 const rows={m:{...root,relations:[{kind:'located-in',to:'p'}]},p:place};
 assert.deepEqual(await api.sceneParentPages({name:'x',kind:'scene',origin:{kind:'table'},relations:[{kind:'located-in',to:'m'}]},async handle=>rows[handle]),
  {name:'p',pages:[5],level:2},'a parent that is no place is passed through');
});
