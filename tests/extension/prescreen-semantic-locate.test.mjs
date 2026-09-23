import {supportDecision} from './support-agent-helpers.mjs';
/**
 * Contract §124.10: semantic locate over the closed entity index, documented Jev packing limits, the
 * configurable per-input allowance and loop outcome telemetry.
 *
 * The controlled decision port stands in for Jev: it maps a fixed request to the handles a test declares
 * relevant, so these tests prove the host carries a semantic judgment from the index to the catalog, the
 * reads and the packet. They do not measure Jev's own locate quality, latency or Keeper adoption.
 */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {PRESELECT_ALLOWANCE_DEFAULT_MS,PRESELECT_ALLOWANCE_KEY,SETTINGS_ENV,readJevPreselectAllowanceMs} from '../../extensions/jev/agent/config.js';

const root=resolve(import.meta.dirname,'../..');
await mkdir(join(root,'.tmp'),{recursive:true});
const temp=await mkdtemp(join(root,'.tmp/prescreen-semantic-locate-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({stdin:{contents:`
export {prepareKeeperSupport} from './extensions/table/prescreen.ts';
export {installContextPolicy} from './extensions/table/context-runtime.ts';
export {PRESCREEN_TYPE} from './extensions/table/context-policy.ts';
export {supportRequest} from './runtime/jev/keeper-support-contract.ts';
export {packDecisionBatch,PackingError,JEV_MODEL,JEV_REQUEST_TOKEN_LIMIT,JEV_STATE_QUESTION_TOKEN_LIMIT,ESTIMATE_PROVENANCE} from './runtime/jev/question-packing.ts';
export {locateCards,locatedSelection,LOCATE_FAMILY} from './runtime/jev/semantic-locate.ts';
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
`,resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);

const answered=choice=>({status:'answered',type:'choice',choice});
/** Stand-in for Jev: the handles a request needs are declared by the test, never inferred from words. */
function semanticPort(relevantLabels,{finishCoverage='sufficient'}={}){
  const seen={locate:[],loop:[]},fallback=supportDecision(()=> 'skip');
  return {seen,async decide(batch){
    if(batch.family===api.LOCATE_FAMILY){
      seen.locate.push(structuredClone(batch));
      const cards=new Map(batch.state.cards.map(card=>[card.alias,card]));
      return {batchId:batch.id,status:'complete',attempts:1,usage:{inputTokens:100,outputTokens:1},coverage:{required:[],answered:[],unknown:[]},issues:[],
        answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',
          noul:relevantLabels.has(cards.get(question.target)?.name)?0.92:0.04}]))};
    }
    if(batch.family==='keeper-support-agent'){
      seen.loop.push(structuredClone(batch));
      return {batchId:batch.id,status:'complete',attempts:1,usage:{inputTokens:100,outputTokens:1},coverage:{required:[],answered:[],unknown:[]},issues:[],
        answers:Object.fromEntries(batch.questions.map(question=>[question.key,
          answered(question.key==='operation'?'finish':question.key==='coverage'?finishCoverage:question.key==='consistency'?'clear':'skip')]))};
    }
    return fallback.decide(batch);
  }};
}
const entityOf=material=>{try{return JSON.parse(material.content).entity?.name;}catch{return undefined;}};

async function haunting(t,id,language){
  const home=await mkdtemp(join(temp,`${id}-`));
  const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:id,locks:api.nativeAdvisoryLocks(),
    env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(context);t.after(async()=>{await runtime.close();await rm(home,{recursive:true,force:true});});
  const call=(method,params={})=>runtime.handlers[method]({campaign:id,...params});
  await call('campaign.create',{id,module:'the-haunting',pregen:'thomas-hayes',play_language:language});
  await call('table.open');
  return call;
}

test('two different non-English requests reach different located material through the real kernel',{timeout:600_000},async t=>{
  const call=await haunting(t,'locate-zh','zh-Hans');
  const history='这栋房子以前发生过什么？',newspapers='我想去查旧报纸，哪里能查到？';
  await call('table.player_input',{text:history});
  const {_context:binding,...capsule}=await call('table.capsule',{rehydrate:true});
  const index=await call('table.workspace.read',{query:history,candidate_limit:1,preselect:{version:2,mode:'index'}});
  assert.equal(index.status,'valid');assert.deepEqual(index.materials.candidates,[]);
  const entities=index.materials.index.entities,labelOf=handle=>entities.find(entity=>entity.handle===handle).label;
  assert(entities.length>=100&&entities.every(entity=>entity.handle&&entity.label&&entity.kind),'the closed index names every graph entity');
  assert.equal(index.materials.index.entities_total,entities.length);assert(index.materials.index.rules.length>0);
  // A summary that only restates the name gives Jev nothing to judge; the card carries authored content instead.
  const knott=entities.find(entity=>entity.handle==='steven-knott');assert(knott.summary&&knott.summary!==knott.label,JSON.stringify(knott));
  // Structural discovery alone is identical for both requests: the query string no longer orders graph material.
  const plainA=await call('table.workspace.read',{query:history,candidate_limit:48,preselect:{version:2,mode:'catalog',cursor:0,limit:48}}),
    plainB=await call('table.workspace.read',{query:newspapers,candidate_limit:48,preselect:{version:2,mode:'catalog',cursor:0,limit:48}});
  assert.equal(plainA.materials.coverage.graph_entity.ranking,'structural');
  assert.deepEqual(plainA.materials.candidates.filter(row=>row.kind==='graph_entity').map(row=>row.key),
    plainB.materials.candidates.filter(row=>row.kind==='graph_entity').map(row=>row.key));
  const cases=[{request:undefined,query:history,wanted:['house-built-1835','neighbor-lawsuit-1852'],unwanted:'newspaper-morgue'},
    {request:api.supportRequest(newspapers,'lookup'),query:newspapers,wanted:['newspaper-morgue'],unwanted:'house-built-1835'}];
  const outcomes=[];
  for(const item of cases){
    const port=semanticPort(new Set(item.wanted.map(labelOf))),events=[];
    const prepared=await api.prepareKeeperSupport({call,campaign:binding.campaign,binding,capsule,decision:port,signal:new AbortController().signal,
      record:event=>events.push(event),timeoutMs:300_000,byteBudget:16*1024,suppliedMessages:[],...(item.request?{request:item.request}:{})});
    assert(prepared,JSON.stringify(events.filter(event=>event.lane==='prescreen').slice(-2)));
    const packet=JSON.parse(prepared.content),delivered=packet.materials.map(entityOf).filter(Boolean);
    for(const handle of item.wanted)assert(delivered.includes(handle),`${handle} reaches the packet: ${JSON.stringify(delivered)}`);
    assert(!delivered.includes(item.unwanted),`${item.unwanted} is not supplied for this request`);
    // Every card of the closed index was judged exactly once, in bounded parallel batches.
    const judged=port.seen.locate.flatMap(batch=>batch.state.cards.map(card=>card.name)).filter(name=>entities.some(entity=>entity.label===name));
    assert.equal(port.seen.locate.filter(batch=>batch.state.index==='module entities').reduce((sum,batch)=>sum+batch.state.cards.length,0),entities.length);
    assert(judged.length>=entities.length);
    for(const batch of port.seen.locate){assert(batch.state.cards.length<=64);assert.doesNotThrow(()=>api.packDecisionBatch(batch));
      assert.equal(batch.state.materials,undefined,'a locate batch carries no materials');}
    const note=events.find(event=>event.lane==='prescreen'&&event.event==='prepared');
    assert.equal(note.stop_reason,'sufficient');assert.equal(note.locate.status,'judged');assert(note.locate.seeded>0);
    assert.equal(note.choices[0].choice,'finish');assert.equal(note.assessment.coverage,'sufficient');
    assert(Array.isArray(note.loop_trace)&&note.loop_trace.some(event=>event.event==='loop_decision'));
    assert(note.jev_input_upper_bound>=note.jev_input_tokens,'the byte upper bound is recorded beside provider usage');
    outcomes.push({delivered,offered:port.seen.loop[0].state.operations.map(operation=>operation.label)});
  }
  assert.notDeepEqual(outcomes[0].offered,outcomes[1].offered,'different requests receive different offers');
  assert.notDeepEqual(outcomes[0].delivered,outcomes[1].delivered);
});

test('priority orders only exact issued handles and is refused outside catalog or read',{timeout:300_000},async t=>{
  const call=await haunting(t,'locate-priority','en');
  const catalog=await call('table.workspace.read',{query:'anything',candidate_limit:48,
    preselect:{version:2,mode:'catalog',cursor:0,limit:48,priority:['newspaper-morgue','not-an-issued-handle','Newspaper Morgue']}});
  assert.equal(catalog.materials.coverage.graph_entity.ranking,'semantic_locate');
  assert.deepEqual(catalog.materials.coverage.graph_entity.priority,{requested:3,resolved:1});
  assert.equal(catalog.materials.candidates.find(row=>row.kind==='graph_entity').read.query,'newspaper-morgue');
  const plain=await call('table.workspace.read',{query:'anything',candidate_limit:48,preselect:{version:2,mode:'catalog',cursor:0,limit:48}});
  assert.notEqual(plain.materials.candidates.find(row=>row.kind==='graph_entity').read.query,'newspaper-morgue','the lead is the priority, not structure');
  await assert.rejects(call('table.workspace.read',{preselect:{version:2,mode:'check',priority:['newspaper-morgue']}}),/priority/);
  await assert.rejects(call('table.workspace.read',{preselect:{version:2,mode:'index',priority:['newspaper-morgue']}}),/priority/);
  await assert.rejects(call('table.workspace.read',{preselect:{version:2,mode:'catalog',priority:['']}}),/priority/);
});

test('documented Jev limits pack a state the old single 32,768-byte bound rejected',()=>{
  const batch=(stateText,questionText='Is this useful?')=>({id:'b',model:api.JEV_MODEL,family:'f',familyVersion:'1',scope:{owner:'o',audience:'keeper'},readSet:[],
    state:{text:stateText},questions:[{key:'q',target:'t',type:'noul',instructions:questionText}]});
  // The real table's failing batch: state 26,376 + longest question 1,811 bytes, 33,851 bytes in total.
  const failing={...batch('x'.repeat(26_360)),questions:Array.from({length:5},(_,index)=>({key:`q${index}`,target:`t${index}`,type:'noul',instructions:'y'.repeat(1_450)}))},
    {estimate}=api.packDecisionBatch(failing);
  assert(estimate.totalUpperBound>32_768&&estimate.stateUpperBound+estimate.longestQuestionUpperBound<=32_000);
  assert.equal(estimate.provenance,api.ESTIMATE_PROVENANCE);assert.equal(estimate.provenance,'utf8_json_bytes_token_upper_bound');
  assert.equal(estimate.requestLimit,64_000);assert.equal(estimate.stateQuestionLimit,32_000);
  // Many materials in state plus many questions: under 64k in total, and each question with the state under 32k.
  const questions=Array.from({length:120},(_,index)=>({key:`q${index}`,target:`t${index}`,type:'noul',instructions:'z'.repeat(240)}));
  assert.doesNotThrow(()=>api.packDecisionBatch({...batch('m'.repeat(20_000)),questions}));
  // A CJK state is still bounded by its UTF-8 bytes: 10,000 characters fit, 11,000 do not.
  assert.doesNotThrow(()=>api.packDecisionBatch(batch('鬼'.repeat(10_000))));
  assert.throws(()=>api.packDecisionBatch(batch('鬼'.repeat(11_000))),error=>error instanceof api.PackingError&&error.failure==='packing_limit');
  assert.throws(()=>api.packDecisionBatch({...batch('m'.repeat(30_000)),questions:Array.from({length:160},(_,index)=>({key:`q${index}`,target:'t',type:'noul',instructions:'z'.repeat(240)}))}),
    error=>error instanceof api.PackingError&&error.estimate.totalUpperBound>64_000);
});

test('locate partitions mechanically, judges every card and keeps failed batches unjudged',async()=>{
  const cards=Array.from({length:150},(_,index)=>({family:'entity',handle:`h${index}`,label:`Entity ${index}`,kind:'clue',summary:`Summary ${index}`}));
  const scope={owner:'o',audience:'keeper'},readSet=[],seen=[];
  const result=await api.locateCards({request:api.supportRequest('Where is the thing?'),context:{},cards,scope,readSet,decide:async batch=>{
    seen.push(batch);if(seen.length===2)return {reason:'timeout'};
    return {result:{batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>[question.key,
      {status:'answered',type:'noul',noul:question.target==='entity_7'?0.9:question.target==='entity_8'?0.5:0.1}])),coverage:{required:[],answered:[],unknown:[]},issues:[]}};
  }});
  assert.equal(seen.length,3);assert(seen.every(batch=>batch.questions.length<=64));
  assert.equal(result.failedBatches,1);assert.equal(result.judged+result.unjudged,150);assert(result.unjudged>0);
  const selection=api.locatedSelection(result);
  assert.deepEqual(selection.priority,['h6','h7']);assert.deepEqual(selection.seed,['h6']);
});

test('the prepared note says why the loop ended, including a partial finish, and the allowance is configurable',async t=>{
  assert.equal(readJevPreselectAllowanceMs({}),PRESELECT_ALLOWANCE_DEFAULT_MS);
  assert.equal(readJevPreselectAllowanceMs({PI_COC_JEV_PRESELECT_ALLOWANCE_MS:'20000'}),20000);
  assert.equal(readJevPreselectAllowanceMs({PI_COC_JEV_PRESELECT_ALLOWANCE_MS:'999999'}),30000);
  assert.equal(readJevPreselectAllowanceMs({PI_COC_JEV_PRESELECT_ALLOWANCE_MS:'1'}),2000);
  assert.equal(readJevPreselectAllowanceMs({PIPIUI_SPAWN_CONTRACT:'{}',PIPIUI_MOUNTED_EXTENSIONS:'jev',PI_COC_JEV_PRESELECT_ALLOWANCE_MS:'20000',
    [SETTINGS_ENV]:JSON.stringify({[PRESELECT_ALLOWANCE_KEY]:9000})}),9000,'managed sessions obey mounted settings, not the CLI override');
  const binding={version:1,campaign:'c1',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
  const capsule={turn:{number:1,player_text:'What is in the archive?'},where:{scene:'office'},present:[],known:{}};
  const snapshot={status:'valid',authority:{checked:true},binding:{...binding,stateStamp:'b'.repeat(64),rules_revision:'c',memory_revision:'d',npc_revision:'e',
    records_revision:'f',catalog_revision:'1',scene:'office',adapter:'static-evidence-v2'},materials:{version:2,candidates:[{key:'graph:A',kind:'graph_entity',
      label:'Archive',summary:'Archive',authority:'module_source',coverage:{status:'complete'},body:JSON.stringify({entity:{name:'archive',summary:'Archive'},authored:{prose:'Shelves.'}})}],
    coverage:{graph_entity:{inspected:1,emitted:1,omitted:0,unavailable:0,status:'complete'}}}};
  const events=[],port=semanticPort(new Set(),{finishCoverage:'missing'});
  const prepared=await api.prepareKeeperSupport({call:async()=>snapshot,campaign:'c1',binding,capsule,decision:port,signal:new AbortController().signal,
    record:event=>events.push(event),timeoutMs:5000,byteBudget:8192,suppliedMessages:[{role:'user',content:capsule.turn.player_text},
      {role:'custom',customType:'coc-capsule',content:JSON.stringify(capsule)}]});
  assert(prepared);const note=events.find(event=>event.event==='prepared');
  assert.equal(note.stop_reason,'finish_partial','a finish with missing coverage is not reported as sufficient');
  assert.deepEqual(note.choices,[{round:1,choice:'finish',tool:'finish',coverage:'missing',consistency:'clear'}]);
  assert.equal(note.locate.status,'index_unavailable');assert(note.allowance_ms>0&&note.allowance_remaining_ms<=note.allowance_ms);
  // The capsule travels once (as the overview), and graph previews omit the repeated entity stub.
  const state=port.seen.loop[0].state;
  assert(!state.current_context.supplied.messages.some(message=>message.custom_type==='coc-capsule'));
  assert.deepEqual(state.current_context.supplied.carried_elsewhere,['coc-capsule']);
  const preview=state.operations.find(operation=>operation.tool==='read').basis.preview;
  assert(preview.includes('Shelves')&&!preview.includes('"entity"'));
});

test('the context hook arms the configured allowance once per accepted input',async t=>{
  const saved={flag:process.env.PI_COC_JEV_PRESELECT,key:process.env.TYPESAFE_API_KEY,allowance:process.env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS};
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';process.env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS='17000';
  t.after(()=>{for(const [name,value] of [['PI_COC_JEV_PRESELECT',saved.flag],['TYPESAFE_API_KEY',saved.key],['PI_COC_JEV_PRESELECT_ALLOWANCE_MS',saved.allowance]])
    if(value===undefined)delete process.env[name];else process.env[name]=value;});
  const binding={version:1,campaign:'c1',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
  const capsule={turn:{number:1,player_text:'Look around.'},where:{scene:'office'},present:[],known:{}};
  const hooks=new Map(),bus=new Map(),events=[];
  api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  await hooks.get('session_start')();
  bus.get('coc:kernel-bridge')({campaign:'c1',call:async method=>{if(method==='table.capsule')return {...capsule,_context:binding};
    if(method==='table.recall')return {cards:[],hits:[],_snapshot:'h'};return {status:'unverifiable',binding:null,authority:{checked:false}};}});
  bus.get('coc:capsule')({capsule,context:binding,epoch:'input-1'});
  const ctx={model:{contextWindow:1000000},getSystemPrompt:()=>''},messages=[{role:'user',content:capsule.turn.player_text}];
  await hooks.get('context')({messages,type:'context'},ctx);await hooks.get('context')({messages,type:'context'},ctx);
  const armed=events.filter(event=>event.lane==='prescreen'&&event.event==='allowance_started');
  assert.equal(armed.length,1,'repeated context hooks never rearm the allowance');assert.equal(armed[0].allowance_ms,17000);
  await hooks.get('session_shutdown')();
});
