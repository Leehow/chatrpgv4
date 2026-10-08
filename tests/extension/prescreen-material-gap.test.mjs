/**
 * Contract §205 through the real entry: the host's `prepareKeeperSupport` (`extensions/table/prescreen.ts`), the real kernel,
 * a real PDF, page transcripts made by the real assembly and published by the real store, the §196.7 passages, and the
 * kernel's own capsule head (`kernel-ts/read/assemble.ts`). Jev is a deterministic wire: the locate answers a passage by its
 * text and by the request it is judged against, the loop reads what `select` names and otherwise finishes, and each need's
 * choice is scripted per test. No model is called and nothing here plays a table.
 *
 * The book: wards 2-7, each a heading, a one-line "Map" paragraph and three notes; where the ferryman keeps the harbor ledger
 * is ward 4's last note, where the spare key lies is ward 6's. The line has two sentences: a question and an action.
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
  await mkdir(join(ROOT,'.tmp'),{recursive:true});bundle=await mkdtemp(join(ROOT,'.tmp/prescreen-material-gap-'));
  await build({stdin:{contents:[
    "export {prepareKeeperSupport,reusePrescreen} from './extensions/table/prescreen.ts';",
    "export {MISSING_NOTE} from './runtime/jev/keeper-support-contract.ts';",
    "export {HEAD} from './kernel-ts/read/assemble.ts';",
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {checkDraft} from './kernel-ts/modules/visual.ts';",
    "export {sourceInfo,sourceLines,sourceSearch,sourceText,sourceTextVersion,closeSourceDocuments} from './extensions/module/source.ts';",
    "export {assembleLayout} from './extensions/module/page-transcript.ts';",
    "export {TRANSCRIPT_RECORD_SCHEMA,TranscriptStore} from './extensions/module/transcript-store.ts';",
    "export {readSourcePageText} from './extensions/module/source-page-text.ts';",
  ].join('\n'),resolveDir:ROOT,sourcefile:'prescreen-material-gap-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,
    packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{await api?.closeSourceDocuments?.();if(bundle)await rm(bundle,{recursive:true,force:true});});

const notes=(ward,note)=>Array.from({length:4},(_,line)=>`Ward ${ward} note ${note} line ${line+1}: the lane passes shuttered houses and a closed chandlery by the water`);
const LEDGER=['The ferryman Silas Crane keeps the harbor ledger hidden inside the crown of the old bell,',
  'where no customs officer has thought to look in twenty years of searching the pier and',
  'its warehouses; on the first night of every month he climbs up to add the names of the',
  'ships that paid him and wraps the book again in oilcloth.'];
const KEY=['The spare key to the bell tower lies under the third loose stone of the quay steps,',
  'below the mooring ring that the fishermen painted red after the storm of the last winter;',
  'whoever lifts the stone at low tide finds it wrapped in a scrap of sail and tied with twine.',
  'Only the harbor master and his widow have ever known that it is kept there.'];
const PAGES=Array.from({length:10},(_,index)=>[`Filler page ${index+1} holds nothing of note.`,String(index+1)]),LAYOUTS={};
for(let ward=2;ward<=7;ward++){
  PAGES[ward-1]=[`Ward ${ward}`,`Map ${ward}`,...notes(ward,1),...notes(ward,2),...(ward===4?LEDGER:ward===6?KEY:notes(ward,3)),String(ward)];
  LAYOUTS[ward]='# {L1}\n\n{L2}\n\n{L3-L6}\n\n{L7-L10}\n\n{L11-L14}\n\n<!-- drop: L15 -->';
}
const QUESTION='Where does the ferryman keep the harbor ledger?',LINE=`${QUESTION} I walk down to the pier.`;
const fixture=(t,text=LINE)=>bookFixture(t,api,CONTENT,{seed:'prescreen-material-gap',pages:PAGES,layouts:LAYOUTS,
  index:{sections:[{name:'Harbor Wards',pages:[[1,10]],topics:['opening'],entities:['Pier','Bell Tower'],references:[],source_refs:[{page:1}]}]},
  opening:{nodes:[
    {node_id:'scene-pier',node_kind:'scene',name:'Pier',source_refs:[{page:2}],properties:{is_entrance:true}},
    {node_id:'scene-bell',node_kind:'scene',name:'Bell Tower',source_refs:[{page:7}],properties:{is_final:true}},
    {node_id:'npc-silas',node_kind:'npc',name:'Silas Crane',summary:'The ferryman.',properties:{},source_refs:[{page:4}]}],
    claims:[{subject_id:'scene-pier',predicate:'route-to',object:{node_id:'scene-bell'},truth_status:'authored-fact',source_refs:[{page:2}]},
      {subject_id:'npc-silas',predicate:'present-in',object:{node_id:'scene-pier'},truth_status:'authored-fact',source_refs:[{page:4}]}],
    ready_nodes:['scene-pier','scene-bell','npc-silas']},openingPages:[2,4,7],text});

const scripted=(question,value)=>({type:'choice',choice:value,confidence:1,
  probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===value?1:0]))});
/**
 * A deterministic Jev. The locate answers an entity card by name and a passage card by `passage(card, request)`, so the
 * turn's locate and a need's own lookup can differ. `needs` scripts each need's choice by alias (default: the helper's first
 * candidate, held), `about` each need's entry, `coverage` the loop's whole-request answer; `drop(key, sent)` leaves an answer
 * out, as a wire that did not answer it. Every request is kept in `sent`.
 */
function wire({entity={},passage=()=>0,needs={},about={},coverage,select=()=> 'skip',drop=()=>false,sent=[]}){return async(_url,options)=>{
  const body=JSON.parse(options.body);sent.push(body);
  const cards=new Map((body.state?.cards??[]).map(card=>[card.alias,card])),answer=supportWire(body,select);
  for(const [key,question] of Object.entries(body.questions??{})){
    if(question.type==='noul'){const card=cards.get(key.replace(/^relevant_/,''));
      answer.answers[key]={type:'noul',noul:card?.text!==undefined?passage(card,body.state.request):entity[card?.name]??0};}
    else if(needs[key])answer.answers[key]=scripted(question,needs[key]);
    else if(key.startsWith('about_')&&about[key.slice(6)])answer.answers[key]=scripted(question,about[key.slice(6)]);
    else if(key==='coverage'&&coverage)answer.answers[key]=scripted(question,coverage);
    if(drop(key,body))delete answer.answers[key];
  }
  return Response.json(answer);
};}
async function prepare(t,f,jev){
  const oldFetch=globalThis.fetch;globalThis.fetch=wire(jev);t.after(()=>{globalThis.fetch=oldFetch;});
  const env={...process.env,TYPESAFE_API_KEY:'deterministic-material-gap',PI_COC_JEV_PRESELECT:'1'};delete env.PI_COC_CONTENT_ROOT;
  const events=[];
  try{
    const message=await api.prepareKeeperSupport({call:(method,params)=>f.call(method,params),campaign:'c1',binding:f.binding,capsule:f.capsule,
      signal:new AbortController().signal,source:{moduleId:f.mid,runtime:f.source},env,record:event=>events.push(event),byteBudget:16*1024,deadlineAt:Date.now()+30000});
    const prepared=events.find(row=>row.event==='prepared');
    assert(message&&prepared,JSON.stringify(events.filter(row=>['fallback','skipped'].includes(row.event))));
    return {message,events,prepared,packet:JSON.parse(message.content),gap:prepared.material_gap};
  }finally{globalThis.fetch=oldFetch;}
}
const ledger=card=>card.text.includes('harbor ledger');
const isLoop=body=>Array.isArray(body.state?.operations);
const isClosing=body=>!isLoop(body)&&Array.isArray(body.state?.needs);
const ledgers=packet=>packet.materials.filter(row=>typeof row.content==='string'&&row.content.includes('harbor ledger'));

test('§205.4 the capsule head forbids looking only for what is present, never for a need named missing',async t=>{
  const f=await fixture(t);
  assert.equal(f.capsule.head.startsWith(api.HEAD),true,'the kernel\'s own head');
  assert.match(f.capsule.head,/Do not look\/lookup for what is already here; that holds only for what is present\./);
  assert.match(f.capsule.head,/A need this turn's keeper_support lists under missing is not here: make its read before you narrate that part/);
  assert.doesNotMatch(f.capsule.head,/for what is already here; director is advice/,'the blanket form is gone');
});

test('§205.3 an unmet need the turn\'s located passages answer is supplied by the host, and nothing is named',async t=>{
  const f=await fixture(t),sent=[];
  // The ledger is located for the whole line (0.5: offered, not found, not read); judged against the need alone it is found.
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},sent,needs:{need_1:'missing',need_2:'none'},about:{need_1:'entry_1'},
    passage:(card,request)=>ledger(card)?(request===QUESTION?0.9:0.5):0});
  assert.equal(ledgers(result.packet).length,1,JSON.stringify(result.packet.materials.map(row=>row.label)));
  assert.equal(ledgers(result.packet)[0].label,'Original PDF page 4 › Ward 4');
  assert.equal(result.packet.missing,undefined);assert(!result.packet.note.includes(api.MISSING_NOTE));
  assert.equal(result.gap.status,'host');assert.equal(result.gap.judged_by,'loop');
  assert.deepEqual([result.gap.needs,result.gap.unmet,result.gap.host_supplied,result.gap.named],[2,1,1,0]);
  assert.deepEqual(result.gap.verdicts,[{need:1,choice:'missing',p_missing:1,about:true},{need:2,choice:'none',p_missing:0,about:true}]);
  assert.equal(result.gap.host.supplied,1);assert.equal(result.gap.host.found,1);
  // The loop's own decision judged the needs: the state carried them, and no closing decision was added.
  const loops=sent.filter(isLoop);
  assert(loops.length>=1&&loops.every(body=>body.state.needs.length===2&&body.questions.need_1&&body.questions.about_need_2));
  assert.equal(sent.filter(isClosing).length,0);
  // The need's own lookup was the locate's passage judgment with the need as the request, over the offered passages only.
  const lookups=sent.filter(body=>body.state?.index==='module book passages'&&body.state.request===QUESTION);
  assert.equal(lookups.length,1);assert.equal(lookups[0].state.purpose,'lookup');
  assert(lookups[0].state.cards.some(ledger));
  assert.equal(result.events.filter(row=>row.event==='gap_locate').length,1);
});

test('§205.3 an unmet need nothing supplied holds is named to the Keeper with the read that answers it',async t=>{
  const f=await fixture(t),sent=[];
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},sent,needs:{need_1:'missing',need_2:'none'},about:{need_1:'entry_1'},
    passage:card=>ledger(card)?0.5:0});
  assert.deepEqual(ledgers(result.packet),[]);
  const entry=sent.find(isLoop).state.book_entries[0].label;
  assert(entry.startsWith('Silas Crane'),entry);
  assert.deepEqual(result.packet.missing,[{alias:'missing_1',need:QUESTION,about:entry,
    read:{tool:'lookup',kind:'source',source_mode:'answer',query:entry,question:QUESTION}}]);
  assert(result.packet.note.endsWith(api.MISSING_NOTE));
  assert.equal(result.gap.status,'named');assert.deepEqual([result.gap.unmet,result.gap.host_supplied,result.gap.named],[1,0,1]);
  assert.equal(result.gap.host.found,0);
});

test('§205.2 a covered turn names nothing and adds no decision',async t=>{
  const f=await fixture(t),sent=[];
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},sent,needs:{need_1:'held',need_2:'none'},passage:card=>ledger(card)?0.5:0});
  assert.equal(result.packet.missing,undefined);assert(!result.packet.note.includes(api.MISSING_NOTE));
  assert.equal(result.gap.status,'covered');assert.equal(result.gap.judged_by,'loop');assert.equal(result.gap.host,undefined);
  assert.equal(sent.filter(isClosing).length,0);
  assert.equal(sent.filter(body=>body.state?.index==='module book passages'&&body.state.request===QUESTION).length,0,'no host lookup');
  assert.equal(result.events.filter(row=>row.event==='gap_locate').length,0);
});

test('§205.2 when the loop read after its last judgment, one closing decision judges the needs over the final materials',async t=>{
  const f=await fixture(t),sent=[];let loops=0;
  // The loop reads the ferryman's card, then its next decision leaves its own operation unanswered and the loop ends: the needs
  // it judged first saw the materials before that read.
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},sent,needs:{need_1:'missing',need_2:'none'},
    select:row=>row.kind==='graph_entity'&&row.label.startsWith('Silas Crane')?'necessary':'skip',
    drop:(key,body)=>key==='operation'&&isLoop(body)&&++loops>=2,passage:card=>ledger(card)?0.5:0});
  const closing=sent.filter(isClosing);
  assert.equal(closing.length,1,JSON.stringify(result.gap));
  assert.deepEqual(Object.keys(closing[0].questions).sort(),['about_need_1','about_need_2','need_1','need_2']);
  assert(result.packet.materials.length>0);
  assert.deepEqual(closing[0].state.materials,result.packet.materials,'the closing decision saw the final materials');
  assert.equal(result.gap.judged_by,'closing');assert.equal(result.gap.unmet,1);
});

test('§205.2 a single need cannot reuse coverage judged before the loop\'s final read',async t=>{
  const f=await fixture(t,QUESTION),sent=[];let loops=0;
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},sent,coverage:'missing',needs:{need_1:'held'},
    select:row=>row.kind==='graph_entity'&&row.label.startsWith('Silas Crane')?'necessary':'skip',
    drop:(key,body)=>key==='operation'&&isLoop(body)&&++loops>=2,passage:card=>ledger(card)?0.5:0});
  const closing=sent.filter(isClosing);
  assert.equal(closing.length,1,JSON.stringify(result.gap));
  assert(result.packet.materials.length>0);
  assert.deepEqual(closing[0].state.materials,result.packet.materials);
  assert.equal(result.gap.judged_by,'closing');assert.equal(result.gap.status,'covered');
  assert.equal(result.packet.missing,undefined);
});

test('§205.2 a one-sentence line uses the loop\'s own coverage answer when the per-need answer is missing; no call is added',async t=>{
  const f=await fixture(t,QUESTION),sent=[];
  const result=await prepare(t,f,{entity:{'Silas Crane':0.5},sent,coverage:'missing',passage:card=>ledger(card)?0.5:0,
    drop:key=>key==='need_1'||key==='about_need_1'});
  assert.equal(sent.filter(isClosing).length,0);
  assert.equal(result.gap.judged_by,'coverage');assert.equal(result.gap.status,'named');
  const [row]=result.packet.missing;
  assert.equal(row.need,QUESTION);assert.equal(row.about,undefined,'relevance rank does not identify the need\'s subject');
  assert.deepEqual(row.read,{tool:'lookup',kind:'source',source_mode:'answer',query:'Authored source consultation',question:QUESTION});
});

test('§205.4 a reused packet keeps what is missing only while its materials need no reassessment',async t=>{
  const f=await fixture(t);
  // The ferryman is found (his units are read before the loop), so the packet has material to reuse.
  const named=await prepare(t,f,{entity:{'Silas Crane':0.9},needs:{need_1:'missing',need_2:'none'},passage:card=>ledger(card)?0.5:0});
  assert.equal(named.packet.missing.length,1);assert(named.packet.materials.length>0);
  // The reuse checks run on the product's own 500 ms allowance; on a saturated test box one can run out, which is a refusal
  // to reuse, not what this test is about. A refusal is retried; whatever is reused is checked.
  const reuse=async suppliedMessages=>{
    for(let attempt=0;attempt<5;attempt++){
      const reused=await api.reusePrescreen({call:(method,params)=>f.call(method,params),campaign:'c1',binding:f.binding,query:LINE,
        message:named.message,suppliedMessages,byteBudget:16*1024,signal:new AbortController().signal,source:{moduleId:f.mid,runtime:f.source}});
      if(reused)return reused;
    }
  };
  const same=await reuse([]);
  assert(same,'reused');assert.deepEqual(JSON.parse(same.content).missing,named.packet.missing);
  const moved=await reuse([{role:'custom',customType:'coc-history',content:JSON.stringify({quotes:[]})}]);
  assert(moved,'reused');const packet=JSON.parse(moved.content);
  assert.equal(packet.missing,undefined);assert(!packet.note.includes(api.MISSING_NOTE));
  assert(packet.gaps.some(gap=>gap.reason==='reassessment_required'));
});
