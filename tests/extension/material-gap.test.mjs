/**
 * Contract §205, the pure parts (`runtime/jev/material-gap.ts`): a turn's needs are its sentences (a cut, never a judgement),
 * one closed choice per need and one over the located entries, an unanswered need is never held or missing, the gate on
 * `missing`, and the row the Keeper is handed. The path through the host's preparation is `prescreen-material-gap.test.mjs`;
 * the loop's side (`runtime/jev/evidence-agent.ts`: extra questions, their materials digest, an unknown extra answer never
 * ending the loop) is tested here against the loop itself with a scripted decision port.
 */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {after,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..');
await mkdir(join(ROOT,'.tmp'),{recursive:true});
const temp=await mkdtemp(join(ROOT,'.tmp/material-gap-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({stdin:{contents:`
export * from './runtime/jev/material-gap.ts';
export {runEvidenceAgent,materialsDigest} from './runtime/jev/evidence-agent.ts';
export {supportRequest,keeperSupportView,validateKeeperSupport,MISSING_NOTE} from './runtime/jev/keeper-support-contract.ts';
`,resolveDir:ROOT},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);

test('§205.1 a line\'s needs are its sentences, in order, whatever the script; past six the remainder is the sixth',()=>{
  assert.deepEqual(api.requestNeeds('我盯着他的眼睛：“写信的人死了？什么时候死的，怎么死的？她叫什么名字？尸体现在在哪？”'),
    ['我盯着他的眼睛：“写信的人死了？','什么时候死的，怎么死的？','她叫什么名字？','尸体现在在哪？”']);
  assert.deepEqual(api.requestNeeds('有人在吗？嘉琳娜的家人在哪？'),['有人在吗？','嘉琳娜的家人在哪？']);
  assert.deepEqual(api.requestNeeds('检查遗体：脖子、手腕、指甲，挣扎/勒痕/被按入水的痕迹，别的伤'),['检查遗体：脖子、手腕、指甲，挣扎/勒痕/被按入水的痕迹，别的伤']);
  assert.deepEqual(api.requestNeeds('  Where is the ledger?  I walk to the pier. '),['Where is the ledger?','I walk to the pier.']);
  assert.deepEqual(api.requestNeeds('   '),[]);
  const long='One. Two. Three. Four. Five. Six. Seven! Eight?';
  assert.deepEqual(api.requestNeeds(long),['One.','Two.','Three.','Four.','Five.','Six. Seven! Eight?']);
  assert.equal(api.requestNeeds(long).length,api.MATERIAL_NEEDS);
});

test('§205.2 one closed choice per need, held first, and one over the located entries with none',()=>{
  const view=api.gapView(['Where is the ledger?','I walk on.'],['Silas Crane','Bell Tower',...Array.from({length:9},(_,i)=>`Entry ${i}`)]);
  assert.deepEqual(view.needs,[{alias:'need_1',text:'Where is the ledger?'},{alias:'need_2',text:'I walk on.'}]);
  assert.equal(view.book_entries.length,api.MATERIAL_ENTRIES);
  assert.deepEqual(view.book_entries[0],{alias:'entry_1',label:'Silas Crane'});
  const questions=api.gapQuestions(view);
  assert.deepEqual(questions.map(question=>question.key),['need_1','about_need_1','need_2','about_need_2']);
  assert.deepEqual(Object.keys(questions[0].criteria),['held','missing','none']);
  assert(questions.every(question=>question.type==='choice'));
  assert.deepEqual(Object.keys(questions[1].criteria),[...view.book_entries.map(entry=>entry.alias),'none']);
  assert.equal(questions[1].criteria.entry_1,'Silas Crane');
  // Without entries there is no about question.
  assert.deepEqual(api.gapQuestions(api.gapView(['A?'],[])).map(question=>question.key),['need_1']);
});

const choice=(value,probabilities)=>({status:'answered',type:'choice',choice:value,confidence:1,...(probabilities?{probabilities}:{})});
test('§205.2 verdicts: an unanswered need is unknown; missing is unmet only at the gate; about maps back to the entry',()=>{
  const view=api.gapView(['A?','B?','C?','D?'],['Silas Crane']);
  const verdicts=api.readNeeds({need_1:choice('missing',{held:0.2,missing:0.7,none:0.1}),about_need_1:choice('entry_1'),
    need_2:choice('missing',{held:0.35,missing:0.45,none:0.2}),about_need_2:choice('none'),need_3:{status:'unknown'},need_4:choice('held')},view);
  assert.deepEqual(verdicts,[{need:1,text:'A?',choice:'missing',p_missing:0.7,about:'Silas Crane'},{need:2,text:'B?',choice:'missing',p_missing:0.45},
    {need:3,text:'C?',choice:'unknown'},{need:4,text:'D?',choice:'held'}]);
  assert.deepEqual(verdicts.map(api.unmet),[true,false,false,false]);
  assert.equal(api.unmet({need:1,text:'A?',choice:'missing'}),true,'no distribution: the choice stands');
  assert.deepEqual(api.readNeeds(undefined,view).map(verdict=>verdict.choice),['unknown','unknown','unknown','unknown']);
  assert.deepEqual(api.verdictSummary(verdicts[0]),{need:1,choice:'missing',p_missing:0.7,about:true},'telemetry never carries the words');
});

test('§205.3 the Keeper\'s row: the player\'s words, what it is about, and the read that answers it',()=>{
  const about={need:1,text:'Where is the ledger?',choice:'missing',about:'Silas Crane'},bare={need:2,text:'Who signed it?',choice:'missing'};
  assert.deepEqual(api.missingRow(about,1,true),{alias:'missing_1',need:'Where is the ledger?',about:'Silas Crane',
    read:{tool:'lookup',kind:'source',source_mode:'answer',query:'Silas Crane',question:'Where is the ledger?'}});
  assert.deepEqual(api.missingRow(bare,2,true).read,{tool:'lookup',kind:'source',source_mode:'answer',query:api.GAP_QUERY,question:'Who signed it?'});
  assert.deepEqual(api.missingRow(bare,2,false),{alias:'missing_2',need:'Who signed it?',read:{tool:'lookup',kind:'support',query:'Who signed it?'}});
  // The packet carries it and says what to do only when there is one.
  const base={turn:1,request:'r',materials:[],gaps:[],check:undefined,coverage:{}};
  const named=api.validateKeeperSupport(api.keeperSupportView({...base,missing:[api.missingRow(about,1,true)]}));
  assert.deepEqual(named.missing,[api.missingRow(about,1,true)]);assert(named.note.endsWith(api.MISSING_NOTE));
  const plain=api.validateKeeperSupport(api.keeperSupportView({...base,missing:[]}));
  assert.equal(plain.missing,undefined);assert(!plain.note.includes(api.MISSING_NOTE));
});

/** A scripted loop: each decision is answered by `answer(batch, round)`; a read publishes one material. */
async function loop(answer,{extra=true}={}){
  const materials=[],batches=[],events=[];let round=0;
  const view=api.gapView(['Where is the ledger?'],[]);
  const result=await api.runEvidenceAgent({request:api.supportRequest('Where is the ledger?'),current:{},scope:{owner:'campaign:c',campaign:'c',worldline:'main',loop:0,audience:'keeper'},
    readSet:[],signal:new AbortController().signal,canContinue:()=>true,assessWhenEmpty:true,record:event=>events.push(event),
    ...(extra?{extra:{state:view,questions:api.gapQuestions(view)}}:{}),
    snapshot:()=>({materials,gaps:[],operations:materials.length?[]:[{key:'read:one',tool:'read',label:'One',description:'Read one.',
      execute:async()=>()=>{materials.push({alias:'material_1',content:'one'});}}]}),
    decide:async batch=>{batches.push(batch);round++;const given=answer(batch,round),keys=batch.questions.map(question=>question.key);
      const answers=Object.fromEntries(Object.entries(given).filter(([key])=>keys.includes(key))),
        issues=keys.filter(key=>!answers[key]).map(key=>({key,code:'missing_answer'}));
      return {result:{batchId:batch.id,status:issues.length?'incomplete':'complete',answers,coverage:{required:keys,answered:Object.keys(answers),unknown:[]},issues}};}});
  return {result,batches,events,materials};
}
test('§205.2 the loop asks the extras on every decision and keeps the latest answers with the materials they judged',async()=>{
  const read=await loop((batch,round)=>({operation:choice(round===1?'operation_1':'finish'),coverage:choice('missing'),consistency:choice('clear'),
    need_1:choice(round===1?'missing':'held')}));
  assert.equal(read.batches.length,2);
  assert(read.batches.every(batch=>batch.questions.some(question=>question.key==='need_1')&&batch.state.needs?.[0]?.text==='Where is the ledger?'));
  assert.deepEqual(read.result.extra,{materials:api.materialsDigest(read.materials),answers:{need_1:choice('held')}},
    'the second decision saw the material the first one read');
  assert.equal(read.events.find(event=>event.event==='loop_decision').extra.need_1,'missing');
  // An extra answer the decision left unanswered never ends the loop; an own answer missing still does.
  const unknownExtra=await loop(()=>({operation:choice('finish'),coverage:choice('missing'),consistency:choice('clear')}));
  assert.equal(unknownExtra.result.stop_reason,'finish_partial');assert.deepEqual(unknownExtra.result.extra.answers,{});
  const unknownOwn=await loop(()=>({operation:choice('finish'),consistency:choice('clear'),need_1:choice('held')}));
  assert.equal(unknownOwn.result.stop_reason,'unavailable');
  const without=await loop(()=>({operation:choice('finish'),coverage:choice('sufficient'),consistency:choice('clear')}),{extra:false});
  assert.equal(without.result.extra,undefined);assert(!without.batches[0].questions.some(question=>question.key.startsWith('need_')));
  assert.equal(without.batches[0].state.needs,undefined);
});
