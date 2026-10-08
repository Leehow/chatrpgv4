/**
 * Contract §196.7 (PU-05) through the real entry: the host's `prepareKeeperSupport`, the real kernel, a real 40-page PDF,
 * page transcripts made by the real assembly and published by the real store, and the host's §191.7 reader over that store.
 * Jev is a deterministic wire that answers the passage family by the passage's own text, the entity family by name, and
 * reads nothing in the loop unless told; no model is called and nothing here plays a table.
 *
 * The book: eighteen wards (pages 5-22), each a heading, a one-line "Map" paragraph and three long notes, so that the
 * prescreen's 32 KiB of source candidates is spent before a page's third note is reached. Two facts: where the ferryman
 * keeps the ledger is page 17's last note, and it runs on to page 18; where the spare key lies is page 12's last note.
 */
import {supportWire} from './support-agent-helpers.mjs';
import {bookFixture} from './book-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {after,before,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
let api,bundle;
before(async()=>{
  await mkdir(join(ROOT,'.tmp'),{recursive:true});bundle=await mkdtemp(join(ROOT,'.tmp/prescreen-book-passages-'));
  await build({stdin:{contents:[
    "export {prepareKeeperSupport} from './extensions/table/prescreen.ts';",
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {checkDraft} from './kernel-ts/modules/visual.ts';",
    "export {sourceInfo,sourceLines,sourceSearch,sourceText,sourceTextVersion,closeSourceDocuments} from './extensions/module/source.ts';",
    "export {assembleLayout} from './extensions/module/page-transcript.ts';",
    "export {TRANSCRIPT_RECORD_SCHEMA,TranscriptStore} from './extensions/module/transcript-store.ts';",
    "export {readSourcePageText} from './extensions/module/source-page-text.ts';",
    "export {preparePrescreenSources} from './runtime/jev/prescreen-source-provider.ts';",
    "export {bookPassages} from './runtime/jev/book-passages.ts';",
  ].join('\n'),resolveDir:ROOT,sourcefile:'prescreen-book-passages-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,
    packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{await api?.closeSourceDocuments?.();if(bundle)await rm(bundle,{recursive:true,force:true});});

const notes=(ward,note)=>Array.from({length:4},(_,line)=>`Ward ${ward} note ${note} line ${line+1}: the lane passes shuttered houses and a closed chandlery by the water`);
const LEDGER=['The ferryman Silas Crane keeps the harbor ledger hidden inside the crown of the old bell,',
  'where no customs officer has thought to look in twenty years of searching the pier and',
  'its warehouses; on the first night of every month he climbs up to add the names of the',
  'ships that paid him and wraps the book again in oilcloth'];
const CONTINUED='and seals it with red wax before he climbs back down.';
const KEY=['The spare key to the bell tower lies under the third loose stone of the quay steps,',
  'below the mooring ring that the fishermen painted red after the storm of the last winter;',
  'whoever lifts the stone at low tide finds it wrapped in a scrap of sail and tied with twine.',
  'Only the harbor master and his widow have ever known that it is kept there.'];
const FACT=`${LEDGER.join('\n')}\n${CONTINUED}`;
const PAGES=Array.from({length:40},(_,index)=>[`Filler page ${index+1} holds nothing of note.`,String(index+1)]),LAYOUTS={};
for(let ward=5;ward<=22;ward++){
  if(ward===18){
    PAGES[17]=[CONTINUED,'Ward 18','Map 18',...notes(18,1),...notes(18,2),'18'];
    LAYOUTS[18]='{L1}\n\n# {L2}\n\n{L3}\n\n{L4-L7}\n\n{L8-L11}\n\n<!-- drop: L12 -->';continue;
  }
  PAGES[ward-1]=[`Ward ${ward}`,`Map ${ward}`,...notes(ward,1),...notes(ward,2),...(ward===17?LEDGER:ward===12?KEY:notes(ward,3)),String(ward)];
  LAYOUTS[ward]='# {L1}\n\n{L2}\n\n{L3-L6}\n\n{L7-L10}\n\n{L11-L14}\n\n<!-- drop: L15 -->';
}
const fixture=t=>bookFixture(t,api,CONTENT,{seed:'prescreen-book-passages',pages:PAGES,layouts:LAYOUTS,
  index:{sections:[{name:'Harbor Wards',pages:[[1,40]],topics:['opening'],entities:['Pier','Bell Tower'],references:[],source_refs:[{page:1}]}]},
  opening:{nodes:[
    {node_id:'scene-pier',node_kind:'scene',name:'Pier',source_refs:[{page:5}],properties:{is_entrance:true}},
    {node_id:'scene-bell',node_kind:'scene',name:'Bell Tower',source_refs:[{page:20}],properties:{is_final:true}},
    {node_id:'npc-silas',node_kind:'npc',name:'Silas Crane',summary:'The ferryman.',properties:{},source_refs:[{page:17}]}],
    claims:[{subject_id:'scene-pier',predicate:'route-to',object:{node_id:'scene-bell'},truth_status:'authored-fact',source_refs:[{page:5}]},
      {subject_id:'npc-silas',predicate:'present-in',object:{node_id:'scene-pier'},truth_status:'authored-fact',source_refs:[{page:17}]}],
    ready_nodes:['scene-pier','scene-bell','npc-silas']},openingPages:[5,17,20],text:'Where does the ferryman keep the harbor ledger?'});

/**
 * A deterministic Jev. The locate answers an entity card by its name (`entity`) and a passage card by its text (`passage`);
 * with `outage` every passage-family request fails as an overloaded provider does. The loop reads what `select` names
 * (by kind, label and preview) and otherwise finishes. `windows` collects every loop decision's offered operations.
 */
function wire({entity={},passage=()=>0,outage=false,select=()=> 'skip',windows=[],passageRequests=[]}){return async(_url,options)=>{
  const sent=JSON.parse(options.body);
  if(sent.state?.index==='module book passages'){passageRequests.push(sent);if(outage)return new Response('overloaded',{status:529});}
  if(Array.isArray(sent.state?.operations))windows.push(sent.state.operations);
  const cards=new Map((sent.state?.cards??[]).map(card=>[card.alias,card])),answer=supportWire(sent,select);
  for(const [key,question] of Object.entries(sent.questions??{}))if(question.type==='noul'){
    const card=cards.get(key.replace(/^relevant_/,''));
    answer.answers[key]={type:'noul',noul:card?.text!==undefined?passage(card):entity[card?.name]??0};
  }
  return Response.json(answer);
};}
/** One preparation through the host's entry; `store: false` is a runtime that names no transcript store (no passages). */
async function prepare(t,f,jev,{store=true}={}){
  const oldFetch=globalThis.fetch;globalThis.fetch=wire(jev);t.after(()=>{globalThis.fetch=oldFetch;});
  const env={...process.env,TYPESAFE_API_KEY:'deterministic-book-passages',PI_COC_JEV_PRESELECT:'1'};delete env.PI_COC_CONTENT_ROOT;
  const runtime=store?f.source:{...f.source,contentRoot:undefined},events=[];
  try{
    const message=await api.prepareKeeperSupport({call:(method,params)=>f.call(method,params),campaign:'c1',binding:f.binding,capsule:f.capsule,
      signal:new AbortController().signal,source:{moduleId:f.mid,runtime},env,record:event=>events.push(event),byteBudget:16*1024,deadlineAt:Date.now()+30000});
    return {message,events,packet:message?JSON.parse(message.content):undefined,
      prepared:events.find(row=>row.event==='prepared'),catalog:events.find(row=>row.event==='source_catalog')};
  }finally{globalThis.fetch=oldFetch;}
}
const ledgerPassage=card=>card.text.includes('harbor ledger');
const facts=packet=>packet.materials.filter(row=>typeof row.content==='string'&&row.content.includes('harbor ledger'));

test('§196.7 the page rotation never offers a fact under a page\'s first units; the located passages are offered first',async t=>{
  const f=await fixture(t),scope={owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
  const book=await api.bookPassages({source:f.source,roots:{home:f.home,contentRoot:CONTENT},signal:new AbortController().signal,
    snapshot:await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.mid,answer_limit:8})});
  const fact=book.passages.find(row=>row.text.startsWith('The spare key')),ledger=book.passages.find(ledgerPassage),
    note=book.passages.find(row=>row.text.startsWith('Ward 21 note 2'));
  assert(fact&&ledger&&note,JSON.stringify(book.passages.map(row=>row.text.slice(0,40))));
  assert.deepEqual([fact.page,fact.section,fact.text],[12,['Ward 12'],KEY.join('\n')]);
  assert.deepEqual([ledger.page,ledger.section,ledger.text],[17,['Ward 17'],LEDGER.join('\n')]);
  const located=[{label:'Silas Crane',refs:[{source_id:`pdf:${f.mid}`,pdf_index:11},{source_id:`pdf:${f.mid}`,pdf_index:16}]}];
  const prepareSources=async passages=>api.preparePrescreenSources({call:(method,params)=>f.call(method,{...params,campaign:'c1'}),campaign:'c1',moduleId:f.mid,scope,
    query:'Where does the ferryman keep the harbor ledger?',capsule:{},source:f.source,signal:new AbortController().signal,
    budget:{deadlineAt:Date.now()+20000,candidateBytes:32*1024,materialBytes:16*1024,maxNativePages:16},
    snapshot:await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.mid,answer_limit:8}),located,...(passages?{passages}:{})});
  // Today's path: page 12 is read (the located entity cites it), its "Map 12" unit is offered, the fact never is.
  const blind=await prepareSources();
  assert(blind.coverage.native.materialized_pages.includes(12));assert(blind.coverage.native.candidate_omitted>0,'the budget binds');
  assert(blind.candidates.some(row=>row.body==='Map 12'),'the page\'s first unit is offered');
  assert(!blind.candidates.some(row=>row.body?.startsWith('The spare key')),'the fact is crowded out');
  // PU-05: the located passages are the first candidates, most relevant first; a broken one is whole across the page break; a
  // passage's page is read for it although nothing else would read it (page 21 is in no spread, citation or search).
  assert(!blind.coverage.native.materialized_pages.includes(21));
  const sighted=await prepareSources([fact,ledger,note].map(({handle,page,start,end})=>({handle,page,start,end})));
  const [first,second,third]=sighted.candidates;
  assert.equal(third.body,note.text);assert.equal(third.label,'Original PDF page 21 › Ward 21');
  assert.equal(first.body,KEY.join('\n'));assert.equal(first.label,'Original PDF page 12 › Ward 12');
  assert.equal(second.body,FACT);assert.equal(second.label,'Original PDF pages 17-18 › Ward 17');assert.deepEqual(second.data.pages,[17,18]);
  assert.deepEqual(sighted.passages,[{handle:fact.handle,key:first.key},{handle:ledger.handle,key:second.key},{handle:note.handle,key:third.key}]);
  assert.deepEqual([sighted.coverage.native.located_passages,sighted.coverage.native.passage_pages,sighted.coverage.native.passages_offered],[3,[12,17,21],3]);
  // The envelope carries what its consumers read, one reference per page.
  assert.equal(second.summary,undefined);assert.deepEqual(Object.keys(second.data).sort(),['page','pages','section']);
  assert.deepEqual(second.coverage,{status:'partial',supported:false,derived:false,omitted:['visual_verification','consultation_coverage']});
  assert.deepEqual(second.refs.map(ref=>ref.resource.split(':')[3]),['17','18']);
});

test('§196.7 a passage the locate found reaches the Keeper with its section and both pages; Jev judged the book\'s paragraphs',async t=>{
  const f=await fixture(t),passageRequests=[];
  const result=await prepare(t,f,{entity:{'Silas Crane':0.9},passage:card=>ledgerPassage(card)?0.9:0,passageRequests});
  assert(result.packet,JSON.stringify(result.events.filter(row=>['fallback','skipped'].includes(row.event))));
  const [supplied]=facts(result.packet);
  assert(supplied,JSON.stringify(result.packet.materials.map(row=>row.label)));
  assert.equal(supplied.content,FACT);assert.equal(supplied.authority,'native_text');
  assert.equal(supplied.label,'Original PDF pages 17-18 › Ward 17');
  assert.deepEqual(supplied.provenance,{kind:'native_page',page:17,pages:[17,18],section:'Ward 17'});
  // Jev was shown every paragraph of the book as {alias, section, text}, never a page's line slices.
  const cards=passageRequests.flatMap(sent=>sent.state.cards);
  assert(cards.length>=50&&cards.every(card=>Object.keys(card).join()==='alias,section,text'));
  assert(cards.some(card=>card.text==='Map 17'&&card.section==='Ward 17'));
  assert(cards.some(card=>card.text===LEDGER.join('\n')),'the fact is one card, the paragraph as cut');
  const passages=result.prepared.locate.passages;
  assert.equal(passages.status,'built');assert.equal(passages.cards,cards.length);assert.equal(passages.judged,cards.length);
  assert.deepEqual([passages.located,passages.sent,passages.seeded,passages.offered],[1,1,1,1]);
  assert(passages.batches>=1&&passages.failed_batches===0&&Number.isFinite(passages.ms)&&Number.isFinite(passages.index_ms));
  assert.deepEqual(result.catalog.coverage.native.passage_pages,[17]);
  assert.equal(result.prepared.source_check?.status,'current','the supplied passage reads back current');
  // Without a transcript store the same preparation never supplies it: the rotation's first units take the budget.
  const blind=await prepare(t,f,{entity:{'Silas Crane':0.9},passage:card=>ledgerPassage(card)?0.9:0},{store:false});
  assert.deepEqual(facts(blind.packet),[]);assert.equal(blind.prepared.locate.passages.status,'no_store');
});

test('§196.7 located passages enter Jev\'s window at their locate rank among the located entity\'s candidates',async t=>{
  const f=await fixture(t),windows=[];
  // The ferryman is located (0.5) but not found; the ledger (0.6) outranks him, a Ward 20 note (0.45) does not. The spare key
  // (0.9) is found and read before the loop, so it holds no slot in the window.
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},windows,
    passage:card=>ledgerPassage(card)?0.6:card.text.startsWith('Ward 20 note 2')?0.45:card.text.startsWith('The spare key')?0.9:0});
  assert(result.packet&&windows.length,JSON.stringify(result.events.filter(row=>['fallback','skipped'].includes(row.event))));
  const window=windows[0],reads=window.filter(operation=>operation.tool==='read');
  const at=predicate=>window.findIndex(predicate);
  const fact=at(operation=>operation.basis?.kind==='source'&&operation.basis?.preview?.includes('harbor ledger'));
  const note=at(operation=>operation.basis?.kind==='source'&&operation.basis?.preview?.startsWith('Ward 20 note 2'));
  const silas=at(operation=>operation.basis?.kind==='graph_entity'&&operation.label.startsWith('Silas Crane'));
  assert(fact>=0&&note>=0&&silas>=0,JSON.stringify(window.map(operation=>[operation.tool,operation.basis?.kind,operation.label])));
  assert(fact<silas&&silas<note,`fact ${fact}, ferryman ${silas}, note ${note}`);
  // Both carry a preview (the first sixteen reads do) and precede every source unit the page rotation offered.
  const rotation=reads.findIndex(operation=>operation.basis?.kind==='source'&&!operation.basis?.preview?.includes('harbor ledger')
    &&!operation.basis?.preview?.startsWith('Ward 20 note 2'));
  assert(rotation<0||window.indexOf(reads[rotation])>note,JSON.stringify(window.map(operation=>operation.label)));
  assert.deepEqual([result.prepared.locate.passages.located,result.prepared.locate.passages.seeded,result.prepared.locate.passages.offered],[3,1,3]);
  assert(result.packet.materials.some(row=>row.content===KEY.join('\n')),'the found passage was supplied before the loop');
  assert(!window.some(operation=>operation.basis?.preview?.startsWith('The spare key')));
});

test('§196.7 a Jev outage on the passages leaves today\'s path as it was',async t=>{
  const f=await fixture(t),passageRequests=[],downWindows=[],todayWindows=[];
  const jev={entity:{'Silas Crane':0.9},passage:card=>ledgerPassage(card)?0.9:0};
  const down=await prepare(t,f,{...jev,outage:true,passageRequests,windows:downWindows});
  assert(passageRequests.length>=1,'the passages were sent');
  assert(down.packet,JSON.stringify(down.events.filter(row=>['fallback','skipped'].includes(row.event))));
  const passages=down.prepared.locate.passages;
  assert.deepEqual([passages.status,passages.judged,passages.located,passages.offered],['built',0,0,0]);
  assert.equal(passages.failed_batches,passages.batches);assert.equal(down.prepared.locate.status,'judged','the entity cards were judged');
  assert.equal(down.catalog.coverage.native.located_passages,0);
  const today=await prepare(t,f,{...jev,windows:todayWindows},{store:false});
  const view=packet=>packet.materials.map(row=>[row.kind,row.label,row.authority,row.content]);
  assert.deepEqual(view(down.packet),view(today.packet),'the same materials as a host with no passages');
  assert(view(today.packet).length>0);
  const offered=windows=>windows.map(window=>window.map(operation=>[operation.tool,operation.label,operation.basis?.kind,operation.basis?.preview]));
  assert(todayWindows.length>0);assert.deepEqual(offered(downWindows),offered(todayWindows),'Jev is offered the same operations in the same order');
});
