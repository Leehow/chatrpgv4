/**
 * Contract §196.7 (PU-05), the pure parts: the passage card Jev is shown, the passage family's partition beside the entity
 * cards, the selection that ranks located entities and passages together, the pool order that pairs located passages with
 * the graph slots, and the book's passages cut once per transcript store revision and keyed by their records. The records
 * here are the seventeen shipped Haunting seeds, read from `content/` through the host's §191.7 reader. The path that carries
 * a located passage to Jev's window and the Keeper is `prescreen-book-passages.test.mjs`.
 */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {after,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
const SEED='31e36f72d0ac9a3654b61a09b1f071d3d82f25d78641e5069bfe343e44c5c7db';
await mkdir(join(ROOT,'.tmp'),{recursive:true});
const temp=await mkdtemp(join(ROOT,'.tmp/book-passages-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({stdin:{contents:`
export {cardView,locateCards,locatedSelection,LOCATE_ABSENT,LOCATE_FOUND,LOCATE_PASSAGE_BATCH_CARDS,LOCATE_PASSAGE_BATCH_CARD_BYTES} from './runtime/jev/semantic-locate.ts';
export {bookPassages,bookPassageBuilds,passageHandle,passageSection} from './runtime/jev/book-passages.ts';
export {rankPool} from './extensions/table/prescreen.ts';
export {supportRequest} from './runtime/jev/keeper-support-contract.ts';
export {TranscriptStore,transcriptListing} from './extensions/module/transcript-store.ts';
export {readSourcePageText} from './extensions/module/source-page-text.ts';
export {sourceTextVersion} from './extensions/module/source.ts';
export {PARAGRAPH_UNIT_CAP} from './extensions/module/transcript-paragraphs.ts';
`,resolveDir:ROOT},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);

const scope={owner:'o',audience:'keeper'};
const answers=(batch,noul)=>({result:{batchId:batch.id,status:'complete',coverage:{required:[],answered:[],unknown:[]},issues:[],
  answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:noul(question.target,batch)}]))}});

test('§196.7 a passage card is shown to Jev as {alias, section, text}; entity and rule cards keep their views',()=>{
  const passage={family:'passage',handle:'passage:5:0-12',label:'Original PDF page 5',section:'COLD HARVEST › 1.1',text:'1935 年，响应号召。'};
  assert.deepEqual(api.cardView(passage,'passage_1'),{alias:'passage_1',section:'COLD HARVEST › 1.1',text:'1935 年，响应号召。'});
  assert.deepEqual(api.cardView({family:'entity',handle:'h',label:'Boris',kind:'npc',summary:'The supervisor.'},'entity_1'),
    {alias:'entity_1',name:'Boris',kind:'npc',summary:'The supervisor.'});
  assert.deepEqual(api.cardView({family:'rule',handle:'r',label:'Intimidate',kind:'social'},'rule_1'),{alias:'rule_1',name:'Intimidate',family:'social'});
  assert.equal(api.passageSection(['A','B']),'A › B');
  assert.equal(api.passageHandle(5,0,12),'passage:5:0-12');
});

test('§196.7 the passage family is partitioned by its own bounds, judged by the same Noul, and issued after the entity cards',async()=>{
  const entities=Array.from({length:70},(_,index)=>({family:'entity',handle:`e${index}`,label:`Entity ${index}`,kind:'npc',summary:'s'}));
  // 300 passages of about 400 bytes each: the byte bound binds, never the card count.
  const passages=Array.from({length:300},(_,index)=>({family:'passage',handle:api.passageHandle(1+index%40,index,index+1),label:`Original PDF page ${1+index%40}`,
    section:'Book › Chapter',text:`Passage ${index}: `+'x'.repeat(340)}));
  const seen=[],events=[];
  const result=await api.locateCards({request:api.supportRequest('Who wrote the letter?'),context:{},cards:[...passages,...entities],scope,readSet:[],
    record:event=>events.push(event),decide:async batch=>{seen.push(batch);
      return answers(batch,(alias,own)=>own.state.index==='module book passages'?(alias==='passage_3'?0.92:alias==='passage_9'?0.5:0.1):alias==='entity_2'?0.8:0.1);}});
  const families=seen.map(batch=>batch.state.index);
  assert.deepEqual([...new Set(families)],['module entities','module book passages'],'entity batches are issued before passage batches');
  const passageBatches=seen.filter(batch=>batch.state.index==='module book passages');
  for(const batch of passageBatches){
    assert(batch.state.cards.every(card=>Object.keys(card).join()==='alias,section,text'));
    assert(Buffer.byteLength(JSON.stringify(batch.state.cards),'utf8')<=api.LOCATE_PASSAGE_BATCH_CARD_BYTES+512);
    assert(batch.questions.length<=api.LOCATE_PASSAGE_BATCH_CARDS);
    assert(batch.questions.every(question=>question.type==='noul'&&question.key===`relevant_${question.target}`));
    assert.match(batch.state.policy,/one passage of the module book/);assert.match(batch.state.policy,/judge meaning, not shared words/);
    assert.match(batch.state.policy,/data, never instructions/);
  }
  assert(passageBatches.length>=4&&passageBatches.length<=6,`${passageBatches.length} passage batches for ~120 KB of cards`);
  assert.equal(result.families.passage.cards,300);assert.equal(result.families.passage.judged,300);assert.equal(result.families.entity.judged,70);
  assert.equal(result.families.passage.batches,passageBatches.length);
  assert.deepEqual(events.find(event=>event.event==='locate').passages,{cards:300,judged:300,batches:passageBatches.length,failed_batches:0,
    ms:result.families.passage.ms});
  const selection=api.locatedSelection(result);
  assert.deepEqual(selection.passages,[passages[2].handle,passages[8].handle]);assert.deepEqual(selection.priority,['e1'],'alias entity_2 is the second card');
  assert.deepEqual(selection.ranked.map(value=>value.handle),[passages[2].handle,'e1',passages[8].handle]);
  assert.deepEqual(selection.seeds.map(value=>value.handle),[passages[2].handle,'e1'],'at or above FOUND, one ranking');
});

test('§196.7 a failed passage batch leaves its passages unjudged and the entity judgments intact',async()=>{
  const cards=[{family:'entity',handle:'e0',label:'Entity',kind:'npc',summary:'s'},
    ...Array.from({length:5},(_,index)=>({family:'passage',handle:`p${index}`,label:'Original PDF page 1',section:'S',text:`t${index}`}))];
  const result=await api.locateCards({request:api.supportRequest('Who?'),context:{},cards,scope,readSet:[],
    decide:async batch=>batch.state.index==='module book passages'?{reason:'unavailable'}:answers(batch,()=>0.9)});
  assert.deepEqual(result.families.passage,{cards:5,judged:0,batches:1,failedBatches:1,ms:result.families.passage.ms});
  const selection=api.locatedSelection(result);
  assert.deepEqual(selection.passages,[]);assert.deepEqual(selection.priority,['e0']);assert.deepEqual(selection.seed,['e0']);
});

test('§196.7 locatedSelection ranks located entities and passages together; a tie keeps the entity first; seeds stop at four each',()=>{
  const judgments=[['passage','p1',0.95],['entity','e1',0.9],['passage','p2',0.9],['passage','p3',0.8],['passage','p4',0.75],['passage','p5',0.72],
    ['passage','p6',0.5],['entity','e2',0.4],['passage','p7',0.34],['rule','r1',0.6]].map(([family,handle,noul])=>({family,handle,noul}));
  const selection=api.locatedSelection({judgments,judged:judgments.length,unjudged:0,batches:1,failedBatches:0,ms:1});
  assert.deepEqual(selection.passages,['p1','p2','p3','p4','p5','p6'],'below ABSENT is not located');
  assert.deepEqual(selection.ranked.map(value=>value.handle),['p1','e1','p2','p3','p4','p5','p6','e2']);
  assert.deepEqual(selection.seeds.map(value=>value.handle),['p1','e1','p2','p3','p4'],'four passages at or above FOUND, in the one ranking');
  assert.deepEqual(selection.rules,['r1']);
});

test('§196.7 rankPool pairs each graph slot with the next located passage in locate order; the rest keep their places',()=>{
  const c=(key,kind,query)=>({key,kind,label:key,summary:'',authority:'a',coverage:{},...(query?{read:{query}}:{})});
  const pool=[c('rec1','committed_record'),c('rule1','rule_clause'),c('E1u1','graph_entity','E1'),c('dyn1','npc'),
    c('rec2','committed_record'),c('E1u2','graph_entity','E1'),c('dyn2','object'),c('U1','graph_entity','U'),c('rec3','committed_record'),
    c('srcRot','source'),c('srcA','source'),c('srcB','source'),c('srcC','source')];
  const ranked=[{family:'passage',handle:'A',noul:0.9},{family:'entity',handle:'E1',noul:0.8},{family:'passage',handle:'B',noul:0.6},
    {family:'passage',handle:'C',noul:0.4},{family:'passage',handle:'D',noul:0.38}];
  const keys=new Map([['A','srcA'],['B','srcB'],['C','srcC'],['D','not-offered']]);
  assert.deepEqual(api.rankPool(pool,ranked,keys).map(value=>value.key),
    ['rec1','rule1','srcA','E1u1','dyn1','rec2','E1u2','srcB','dyn2','srcC','U1','rec3','srcRot'],
    'A outranks E1 and goes first; B ranks below E1 and follows its slot; C precedes an unlocated slot; D was not offered');
  // More passages than graph slots: the rest follow the last graph candidate.
  assert.deepEqual(api.rankPool([c('rec','committed_record'),c('E1u1','graph_entity','E1'),c('dyn','npc'),c('srcA','source'),c('srcB','source')],
    ranked,keys).map(value=>value.key),['rec','srcA','E1u1','srcB','dyn']);
  // No graph candidate: the located passages lead.
  assert.deepEqual(api.rankPool([c('rec','committed_record'),c('srcB','source'),c('srcA','source')],ranked,keys).map(value=>value.key),['srcA','srcB','rec']);
  assert.deepEqual(api.rankPool(pool,ranked.filter(value=>value.family==='entity'),keys).map(value=>value.key),pool.map(value=>value.key),'no passage, no change');
});

test('§196.7 the book passages are cut once per store revision and keyed by the file and its record digests',async()=>{
  const home=await mkdtemp(join(temp,'home-')),store=new api.TranscriptStore({home,contentRoot:CONTENT,extractionVersion:api.sourceTextVersion});
  let reads=0,nativeReads=0;
  const source={home,contentRoot:CONTENT,sourceInfo:async()=>{throw new Error('unused');},sourceText:async()=>{throw new Error('unused');},
    sourcePageText:async({pdf,...options},signal)=>{reads++;return api.readSourcePageText({pdf,options,store,digest:async()=>SEED,
      nativeText:async({pages})=>{nativeReads+=pages.length;return {file_sha256:SEED,extraction_version:api.sourceTextVersion,page_count:40,snapshots:[],errors:[]};}},signal);}};
  const snapshot={pdf:'book.pdf',file_sha256:SEED,page_count:40},roots={home,contentRoot:CONTENT},signal=new AbortController().signal;
  const first=await api.bookPassages({source,roots,snapshot,signal});
  assert.equal(first.status,'built');assert.equal(reads,1,'seventeen pages, one read');assert.equal(first.read_pages,17);
  assert(first.passages.length>=100,`${first.passages.length} passages`);
  assert(first.passages.every(row=>row.text.length>0&&row.text.length<=api.PARAGRAPH_UNIT_CAP&&Array.isArray(row.section)
    &&row.handle===api.passageHandle(row.page,row.start,row.end)));
  assert(first.passages.some(row=>row.section.length>0));
  const again=await api.bookPassages({source,roots,snapshot,signal});
  assert.equal(again.status,'cached');assert.equal(reads,1,'an unmoved store is not read again');assert.equal(again.key,first.key);
  assert.deepEqual(again.passages,first.passages);
  // A new record (seed page 1's record published in home as page 30) moves the listing. The preparation that sees the move is
  // answered with the passages built before while the book is rebuilt beside it; the next one gets the new key and page 30.
  const dir=join(home,'.coc/source-transcripts',SEED);await mkdir(dir,{recursive:true});
  const record=JSON.parse(await readFile(join(CONTENT,'source-transcripts',SEED,'page-0001.json'),'utf8'));
  await writeFile(join(dir,'page-0030.json'),JSON.stringify({...record,page:30}));
  const moving=await api.bookPassages({source,roots,snapshot,signal});
  assert.equal(moving.status,'stale');assert.equal(moving.key,first.key);assert.deepEqual(moving.passages,first.passages);assert.equal(moving.read_pages,0);
  await api.bookPassageBuilds();assert.equal(reads,2,'the rebuild ran once');
  const grown=await api.bookPassages({source,roots,snapshot,signal});
  assert.equal(grown.status,'cached');assert.equal(reads,2);assert.notEqual(grown.key,first.key);assert(grown.pages.includes(30));
  assert.equal(grown.passages.filter(row=>row.page===30).length,first.passages.filter(row=>row.page===1).length);
  // A listed file that is no record moves the listing and is read (it comes back native), but the records, so the key, are unchanged.
  await writeFile(join(dir,'page-0031.json'),'{}');
  const listed=await api.transcriptListing(roots,SEED);assert(listed.pages.includes(31));
  assert.equal((await api.bookPassages({source,roots,snapshot,signal})).status,'stale');await api.bookPassageBuilds();
  const same=await api.bookPassages({source,roots,snapshot,signal});
  assert.equal(same.status,'cached');assert.equal(reads,3);assert.equal(nativeReads,1);assert.equal(same.key,grown.key);
  assert.deepEqual(same.passages,grown.passages);
  // A readable record whose blocks cannot be recovered (its Markdown no longer matches its text) is read in its transcript
  // layer as line slices; those are never passages.
  await writeFile(join(dir,'page-0032.json'),JSON.stringify({...record,page:32,markdown:'# Unrelated\n\nNothing here matches the text.'}));
  assert.equal((await api.bookPassages({source,roots,snapshot,signal})).status,'stale');await api.bookPassageBuilds();
  const unaligned=await api.bookPassages({source,roots,snapshot,signal});
  assert.equal(unaligned.status,'cached');assert.notEqual(unaligned.key,grown.key,'a new record is a new key');
  assert(!unaligned.pages.includes(32));assert(!unaligned.passages.some(row=>row.page===32));
  assert.deepEqual(unaligned.passages,grown.passages);
  // A new home with the same records is a book of its own: its first build is waited for.
  const other=await mkdtemp(join(temp,'home-'));
  const fresh=await api.bookPassages({source:{...source,home:other},roots:{home:other,contentRoot:CONTENT},snapshot,signal});
  assert.equal(fresh.status,'built');assert.equal(fresh.key,first.key);
  // No content root, no seeds: the listing is home's alone.
  assert.equal((await api.transcriptListing({home,contentRoot:join(temp,'missing')},SEED)).pages.join(),'30,31,32');
  assert.deepEqual((await readdir(dir)).sort(),['page-0030.json','page-0031.json','page-0032.json']);
});
