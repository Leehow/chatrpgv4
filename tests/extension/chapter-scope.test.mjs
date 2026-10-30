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
 `export {ReadingService} from './extensions/module/reading-service.ts';`].join('\n'),
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
 assert.match(absent.answer,/^The current chapter \(Diner, pages 6-12\) has nothing on cook\. .*Do not look in other chapters\.$/);
 assert.equal('coverage' in absent||'read_next' in absent||'contents' in absent,false,'no partial, no next page, no contents');
 assert.deepEqual(api.scopeAnswer({status:'pending',focus:'cook'},scope,'cook'),{status:'pending',focus:'cook'},'nothing carried, nothing cut');
 const memo=api.scopeAnswer({status:'memo',answers:[{focus:'cook',...answer},{focus:'road',excerpts:[{page:1,text:'c'}]}]},scope,'x');
 assert.deepEqual(memo.answers.map(row=>row.status),['excerpts','chapter_absent']);
 assert.equal(api.scopeAnswer(answer,undefined,'cook'),answer,'no scope: unchanged');
});

/** A reading service over a fake kernel: a 12-page book whose chapters are Intro p3-5 and Diner p6-12. */
async function service(root,{scene,graph={},notes=[],searched=[],opening,env,bookmarks=[{name:'Intro',page:3},{name:'Diner',page:6}]}={}){
 const pdf=join(root,'book','book.pdf'),cache=join(root,'book','cache');
 await mkdir(cache,{recursive:true});
 await writeFile(join(cache,`blocks-${SHA}.json`),JSON.stringify({layout_version:'v',pages:Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,{page:i+1,blocks:[{id:`b${i+1}-0-x`,text:`Page ${i+1} heading`}]}]))}));
 const state={scene};
 const reading=new api.ReadingService({
  call:async(method,params)=>{
   if(method==='module.source.snapshot')return {pdf,file_sha256:SHA,page_count:12,revision:'r1'};
   if(method==='module.status')return {title:'Blood Road',opening:opening?{start_scene:opening}:{}};
   if(method==='table.capsule')return {where:{scene:state.scene,...(state.shown?{display_name:state.shown}:{})}};
   if(method==='table.lookup')return {entities:graph[params.query]?[{name:params.query,kind:'scene',original_pages:graph[params.query]}]:[]};
   return {};},
  campaign:()=>'c1',home:root,model:()=>({id:'m',vision:true}),progress:()=>{},record:row=>notes.push(row),...(env?{env}:{}),
  runtime:{sourceInfo:async()=>({bookmarks}),
   sourceSearch:async request=>{searched.push(request);return {matches:[{page:2},{page:8}]};},
   sourceBlocks:async()=>{throw new Error('the block cache answers');},
   sourcePageText:async({pages})=>({pages:pages.map(page=>({page,text:`Text of page ${page}.`,layer:'native'}))})},
 });
 reading.books.set('blood-road',{sha:SHA,cache});
 return {reading,state};
}

test('§276.2: the scene\'s book pages name the chapter; a scene the table made keeps it; the opening, then the first chapter, without either',async()=>lean(async()=>{
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
 assert.deepEqual([(await bare.reading.chapterScope('blood-road','c3')).name],['Intro'],'the first chapter after the front matter');
 reading.dispose();fresh.reading.dispose();bare.reading.dispose();
}));

test('§276.2: a scene the graph has no pages for is found in the pointer index by the names it is shown by',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','index-');
 const {reading,state}=await service(root,{scene:'military-camp',graph:{}});
 state.shown='场景 1：营地';
 await mkdir(join(root,'source-skeletons'),{recursive:true});
 await writeFile(join(root,'source-skeletons',`${SHA}.json`),JSON.stringify({complete:true,entities:[{name:'营地',aliases:[],blocks:['b4-0-x','b4-1-x'],pages:[4]}]}));
 assert.deepEqual([(await reading.chapterScope('blood-road','c1')).name,(await reading.chapterScope('blood-road','c1')).resolved],['Intro','scene']);
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

test('§276.5: Jev names the reference chapters, read from any chapter; asked once per book and kept by file hash',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resident-'),notes=[],asked=[];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{const sent=JSON.parse(options.body);asked.push(sent);
  const answers={};for(const [key,question] of Object.entries(sent.questions??{})){const own=sent.state.book_chapters[key.replace(/^resident_/,'')];
   answers[key]={type:'noul',noul:own.heading==='Background'?0.9:0.1};}
  return Response.json({model:sent.model,usage:{input_tokens:10,output_tokens:2},answers});};
 try{
  const bookmarks=[{name:'Background',page:2},{name:'Intro',page:3},{name:'Diner',page:6}];
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},notes,bookmarks,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  const scope=await reading.chapterScope('blood-road','c1');
  assert.deepEqual(scope.resident,[{name:'Background',first:2,last:2}]);
  assert.equal(asked.length,1);
  assert.ok(Object.values(asked[0].state.book_chapters).every(row=>typeof row.text_there==='string'&&row.text_there.startsWith('Text of page')),'heading and first lines');
  assert.equal(api.inChapter(scope,2),true);assert.equal(api.inChapter(scope,4),false);
  const pages=await reading.bookPages('blood-road',{campaign:'c1',pages:[2,4,7]});
  assert.deepEqual(pages.source_answer.excerpts.map(span=>span.page),[2,7]);
  assert.deepEqual(pages.source_answer.chapter.resident,[{name:'Background',first:2,last:2}]);
  const contents=await reading.bookPages('blood-road',{campaign:'c1'});
  assert.deepEqual(contents.source_answer.contents.map(row=>row.name),['Background','Diner']);
  const away=await reading.bookPages('blood-road',{campaign:'c1',pages:[4]});
  assert.match(away.source_answer.answer,/and the book's reference chapters \(Background, pages 2-2\)/);
  await reading.chapterScope('blood-road','c1');
  assert.equal(asked.length,1,'asked once');
  reading.dispose();
  const again=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},bookmarks,env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.deepEqual((await again.reading.chapterScope('blood-road','c1')).resident,[{name:'Background',first:2,last:2}]);
  assert.equal(asked.length,1,'kept on disk by file hash');
  again.reading.dispose();
  assert.equal(notes.find(row=>row.event==='resident_chapters')?.resident?.[0],'Background');
 }finally{globalThis.fetch=oldFetch;}
}));

test('§276.5: a Jev that cannot answer leaves no resident chapter, and the next session asks again',async()=>lean(async()=>{
 const root=playtestScratch('chapter-scope','resident-down-');
 const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('overloaded',{status:529});};
 try{
  const {reading}=await service(root,{scene:'Diner counter',graph:{'Diner counter':[6,9,10]},env:{...process.env,TYPESAFE_API_KEY:'deterministic'}});
  assert.equal((await reading.chapterScope('blood-road','c1')).resident,undefined);
  assert.ok(calls>=1);reading.dispose();
 }finally{globalThis.fetch=oldFetch;}
}));
