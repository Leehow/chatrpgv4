/**
 * Contract §196 (PU-01..PU-03) through the real entry: the host's Keeper prescreen (`installContextPolicy`'s context hook),
 * the real kernel, a real 40-page PDF, page transcripts made by the real assembly and published by the real store, and the
 * host's §191.7 reader (`readSourcePageText`) over that store. Jev is a deterministic wire: it locates one entity and reads
 * the candidates a test names; no model is called and nothing here plays a table.
 */
import {supportWire} from './support-agent-helpers.mjs';
import {bookFixture} from './book-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {after,before,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content'),PRESCREEN_TYPE='coc-prescreen';
let api,bundle;
before(async()=>{
  await mkdir(join(ROOT,'.tmp'),{recursive:true});bundle=await mkdtemp(join(ROOT,'.tmp/prescreen-paragraph-units-'));
  await build({stdin:{contents:[
    "export * from './extensions/table/context-policy.ts';",
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {checkDraft} from './kernel-ts/modules/visual.ts';",
    "export {sourceInfo,sourceLines,sourceSearch,sourceText,sourceTextVersion,closeSourceDocuments} from './extensions/module/source.ts';",
    "export {assembleLayout} from './extensions/module/page-transcript.ts';",
    "export {TRANSCRIPT_RECORD_SCHEMA,TranscriptStore} from './extensions/module/transcript-store.ts';",
    "export {readSourcePageText} from './extensions/module/source-page-text.ts';",
    "export {preparePrescreenSources} from './runtime/jev/prescreen-source-provider.ts';",
    "export {publicMaterial} from './extensions/table/prescreen-types.ts';",
    "export {convertToLlm} from './build/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';",
  ].join('\n'),resolveDir:ROOT,sourcefile:'prescreen-paragraph-units-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,
    packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{await api?.closeSourceDocuments?.();if(bundle)await rm(bundle,{recursive:true,force:true});});

/** Forty pages of native lines; the transcribed ones are laid out below, every other page is filler read natively. */
const PAGES=Array.from({length:40},(_,index)=>[`Filler page ${index+1} holds nothing of note.`,String(index+1)]);
PAGES[0]=['Harbor District','The Bell Tower','The bell tower stands at the end of the pier.','Its door is never locked.',
  'The keeper of the bell is a man the dock','workers call','1'];
PAGES[1]=['Old Tom, who rings it at midnight and drinks','at the Anchor afterwards.','The Warehouse','The red warehouse holds the smuggled crates.','2'];
PAGES[12]=['The Lighthouse','The lighthouse keeper Marta Vane saw the ship burn.','13'];
PAGES[32]=['Marta Vane keeps her logbook under the stairs.','33'];
const LAYOUTS={
  1:'# {L1}\n\n## {L2}\n\n{L3-L4}\n\n{L5-L6}\n\n<!-- drop: L7 -->',
  2:'{L1-L2}\n\n## {L3}\n\n{L4}\n\n<!-- drop: L5 -->',
  13:'## {L1}\n\n{L2}\n\n<!-- drop: L3 -->',
  33:'{L1}\n\n<!-- drop: L2 -->',
};
async function fixture(t){
  return bookFixture(t,api,CONTENT,{seed:'prescreen-paragraph-units',pages:PAGES,layouts:LAYOUTS,
    index:{sections:[{name:'Harbor District',pages:[[1,40]],topics:['opening'],entities:['Pier','Lighthouse'],references:[],source_refs:[{page:1}]}]},
    opening:{nodes:[
      {node_id:'scene-pier',node_kind:'scene',name:'Pier',source_refs:[{page:1}],properties:{is_entrance:true}},
      {node_id:'scene-lighthouse',node_kind:'scene',name:'Lighthouse',source_refs:[{page:13}],properties:{is_final:true}},
      {node_id:'npc-marta',node_kind:'npc',name:'Marta Vane',summary:'The lighthouse keeper.',properties:{},source_refs:[{page:13}]}],
      claims:[{subject_id:'scene-pier',predicate:'route-to',object:{node_id:'scene-lighthouse'},truth_status:'authored-fact',source_refs:[{page:1}]},
        {subject_id:'npc-marta',predicate:'present-in',object:{node_id:'scene-lighthouse'},truth_status:'authored-fact',source_refs:[{page:13}]}],
      ready_nodes:['scene-pier','scene-lighthouse','npc-marta']},openingPages:[1,13],
    text:'Who rings the harbor bell at night, and where can I find the lighthouse keeper?'});
}

/**
 * A deterministic Jev: the locate finds `locate` (a card name) and nothing else; the loop reads the source candidates
 * `select` names and skips the rest. `seen` collects every read operation offered, as Jev was shown it.
 */
function wire({locate,select,seen}){return async(_url,options)=>{
  const sent=JSON.parse(options.body),cards=new Map((sent.state?.cards??[]).map(card=>[card.alias,card]));
  for(const operation of sent.state?.operations??[])if(operation.tool==='read')seen.push(operation);
  const answer=supportWire(sent,candidate=>candidate.kind==='source'&&select(candidate)?'necessary':'skip');
  for(const [key,question] of Object.entries(sent.questions??{}))if(question.type==='noul')
    answer.answers[key]={type:'noul',noul:cards.get(key.replace(/^relevant_/,''))?.name===locate?0.9:0};
  return Response.json(answer);
};}
async function project(t,f,jev){
  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='deterministic-paragraph-test';globalThis.fetch=wire(jev);
  t.after(()=>{if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
    if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;globalThis.fetch=oldFetch;});
  const hooks=new Map(),bus=new Map(),events=[];api.installContextPolicy({on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler)},
    getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  bus.get('coc:kernel-bridge')({campaign:'c1',call:f.call,runtime:f.source});bus.get('coc:table-open')({campaign:'c1',open:f.opened});
  bus.get('coc:capsule')({capsule:f.capsule,context:f.binding,epoch:f.input.epoch??'paragraph-units'});
  const projected=await hooks.get('context')({type:'context',messages:[{role:'user',content:f.capsule.turn.player_text}]},{model:{contextWindow:1000000},getSystemPrompt:()=>''});
  t.after(()=>hooks.get('session_shutdown')?.());
  return{hooks,events,projected,packet:projected.messages.find(row=>row.customType===PRESCREEN_TYPE)};
}
const catalogRow=events=>events.find(row=>row.lane==='prescreen'&&row.event==='source_catalog');
const BROKEN='The keeper of the bell is a man the dock\nworkers call\nOld Tom, who rings it at midnight and drinks\nat the Anchor afterwards.';

test('§196.1-196.3 the Keeper gets a paragraph broken by a page break whole, with its section, citing both pages; Jev saw it so',async t=>{
  const f=await fixture(t),seen=[];
  const result=await project(t,f,{locate:'Marta Vane',seen,select:candidate=>candidate.label.startsWith('Original PDF page')&&candidate.label.endsWith('The Bell Tower')});
  assert(result.packet,JSON.stringify(result.events.filter(row=>row.lane==='prescreen')));
  const materials=JSON.parse(result.packet.content).materials,native=materials.filter(row=>row.authority==='native_text');
  const whole=native.find(row=>row.provenance?.pages);
  assert(whole,JSON.stringify(materials));
  assert.equal(whole.content,BROKEN,'both halves, in reading order, exactly the text layer');
  assert.equal(whole.label,'Original PDF pages 1-2 › Harbor District › The Bell Tower');
  assert.deepEqual(whole.provenance,{kind:'native_page',page:1,pages:[1,2],section:'Harbor District › The Bell Tower'});
  // The page's other paragraph under the same heading is a unit of its own, whole.
  assert.deepEqual(native.filter(row=>row!==whole).map(row=>[row.label,row.content,row.provenance]),[['Original PDF page 1 › Harbor District › The Bell Tower',
    'The bell tower stands at the end of the pier.\nIts door is never locked.',{kind:'native_page',page:1,section:'Harbor District › The Bell Tower'}]],
    'a whole paragraph per unit; the broken one is one material, not two halves');
  // Jev was offered the broken paragraph once, under its section, and no half of it alone: past the first previews a source
  // unit's label is all Jev sees of it.
  const offered=[...new Set(seen.filter(operation=>operation.basis?.authority==='native_text').map(operation=>operation.label))];
  assert.deepEqual(offered.filter(label=>/Bell Tower/.test(label)).sort(),['Original PDF page 1 › Harbor District › The Bell Tower',
    'Original PDF pages 1-2 › Harbor District › The Bell Tower'],JSON.stringify(offered));
  const coverage=catalogRow(result.events).coverage.native;
  assert.deepEqual(coverage.continuation_pages,[2],'page 2 was read for the paragraph that runs on to it');
  assert.deepEqual(coverage.paragraph_pages,[1,2,13,33]);
  // §195.1: what was supplied is bound per page; the check reads both back.
  const prepared=result.events.find(row=>row.lane==='prescreen'&&row.event==='prepared');
  assert.equal(prepared?.source_check?.status,'current',JSON.stringify(prepared?.source_check));
  await result.hooks.get('before_provider_request')({type:'before_provider_request',payload:{model:'fixture',input:api.convertToLlm(structuredClone(result.projected.messages))}},{});
  assert.equal(result.events.findLast(row=>row.lane==='prescreen'&&row.event==='delivered')?.delivered,true);
});

test('§196 (PU-03) the located entity chooses its pages, and its name is searched: pages outside the blind spread are read',async t=>{
  const f=await fixture(t),seen=[];
  const result=await project(t,f,{locate:'Marta Vane',seen,select:candidate=>['Original PDF page 13 › The Lighthouse','Original PDF page 33'].includes(candidate.label)});
  const coverage=catalogRow(result.events).coverage.native;
  // spreadPages(40, 16) is 1, 4, 6, 9, 11, 14, 16, 19, 22, 24, 27, 30, 32, 35, 37, 40: neither 13 nor 33.
  assert.deepEqual(coverage.located_pages,[13],'the located entity cites page 13');
  assert(coverage.materialized_pages.includes(13)&&coverage.materialized_pages.includes(33),JSON.stringify(coverage));
  assert.equal(coverage.search_queries,2,'the request and the located name');
  assert(coverage.search_layers.transcript>=2,JSON.stringify(coverage.search_layers));
  const materials=JSON.parse(result.packet.content).materials.filter(row=>row.authority==='native_text');
  assert.deepEqual(materials.map(row=>[row.label,row.content]).sort(),[
    ['Original PDF page 13 › The Lighthouse','The lighthouse keeper Marta Vane saw the ship burn.'],
    ['Original PDF page 33','Marta Vane keeps her logbook under the stairs.']]);
});

test('§196.3 a broken paragraph too large for the selected-body allowance is offered as its halves, each saying where it goes on',async t=>{
  const f=await fixture(t),scope={owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
  const prepare=async materialBytes=>api.preparePrescreenSources({call:(method,params)=>f.call(method,{...params,campaign:'c1'}),campaign:'c1',moduleId:f.mid,scope,
    query:'Who rings the bell?',capsule:{},source:f.source,signal:new AbortController().signal,
    budget:{deadlineAt:Date.now()+20000,candidateBytes:256*1024,materialBytes,maxNativePages:16},
    snapshot:await f.call('module.source.materials.snapshot',{campaign:'c1',module_id:f.mid,answer_limit:8})});
  const bell=result=>result.candidates.filter(row=>row.authority==='native_text'&&/keeper of the bell|Old Tom/.test(row.body));
  const roomy=bell(await prepare(16*1024));
  assert.deepEqual(roomy.map(row=>[row.label,row.body,row.data.pages,row.refs.map(ref=>ref.resource.split(':')[3])]),
    [['Original PDF pages 1-2 › Harbor District › The Bell Tower',BROKEN,[1,2],['1','2']]]);
  const whole=Buffer.byteLength(JSON.stringify(roomy[0]),'utf8'),tight=bell(await prepare(whole-1)).sort((a,b)=>a.data.page-b.data.page);
  assert.deepEqual(tight.map(row=>[row.label,row.data.page,row.data.continues,row.data.continued_from]),[
    ['Original PDF page 1 › Harbor District › The Bell Tower',1,2,undefined],['Original PDF page 2 › Harbor District › The Bell Tower',2,undefined,1]]);
  assert.deepEqual(tight.map(row=>api.publicMaterial(row,'a').provenance),[
    {kind:'native_page',page:1,section:'Harbor District › The Bell Tower',continues_on_page:2},
    {kind:'native_page',page:2,section:'Harbor District › The Bell Tower',continued_from_page:1}],'the Keeper sees where a half goes on');
});
