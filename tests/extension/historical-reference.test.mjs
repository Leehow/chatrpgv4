import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HistoricalReference, readExaKey, historyCandidates, historyNeed, historyBindingMatches, HISTORY_NEED, EXA_ENV} from '../../runtime/historical-reference.ts';
import {contextPolicy} from './fixtures/history-policy.mjs';

const env = {[EXA_ENV]:'test-exa-credential', TYPESAFE_API_KEY:'test-jev-credential'};
const raw = {results:[{title:'Archive visitor guide', url:'https://example.org/archive', publishedDate:'2025-01-01',
  highlights:['In 1920 visitors used an index of names before requesting a volume.']}]};
const decision = async batch => contextPolicy(batch) ?? ({status:'complete', answers:Object.fromEntries(batch.questions.map(q=>[q.key,
  {status:'answered', type:'choice', choice:'direct'}]))});
async function fixture(t, overrides={}) {
  const home=await mkdtemp(join(tmpdir(),'coc-history-')); t.after(()=>rm(home,{recursive:true,force:true}));
  const requests=[], records=[];
  const service=new HistoricalReference({home,env,decide:decision,fetcher:async(url,init)=>{
    requests.push({url,init}); return Response.json(raw);
  },record:e=>records.push(e),...overrides});
  const input={binding:'test:main:1',scope:{owner:'history-test',audience:'keeper',campaign:'test'},turn:1,enabled:true,allowed:true,
    query:'1920 archive visitor procedures',context:{period:'1920',region:'Boston'},signal:new AbortController().signal,current:()=>true};
  return {service,input,requests,records,home};
}
test('credential resolution respects managed mounts, clear and CLI isolation',()=>{
  assert.equal(readExaKey({EXA_API_KEY:' cli '}),'cli');
  assert.equal(readExaKey({PIPIUI_HOST_PROTOCOL:'1',EXA_API_KEY:'cli'}),undefined);
  assert.equal(readExaKey({PIPIUI_HOST_PROTOCOL:'1',PIPIUI_MOUNTED_EXTENSIONS:'coc-keeper',[EXA_ENV]:'vault'}),'vault');
  assert.equal(readExaKey({PIPIUI_EXT_SETTINGS_COC_KEEPER:'{}',EXA_API_KEY:'cli'}),undefined);
});
test('one search and one selection deliver verbatim excerpts without an answer-generation request',async t=>{
  const f=await fixture(t); const result=await f.service.search(f.input);
  assert.equal(result.status,'ready'); assert.deepEqual(result.materials[0].excerpts,raw.results[0].highlights);
  assert.equal(result.materials[0].published_at,'2025-01-01'); assert.equal(result.authority,'advisory_external_excerpt');
  const payload=JSON.parse(f.requests[0].init.body);
  assert.equal(payload.type,'fast'); assert.equal(payload.contents.maxAgeHours,-1);
  for(const key of ['summary','outputSchema','apiKey'])assert.equal(payload[key],undefined);
  assert.equal(f.requests[0].init.headers['x-api-key'],env[EXA_ENV]);
  assert(!JSON.stringify({result,records:f.records,payload}).includes(env[EXA_ENV]));
});
test('off, missing grant and missing credentials make no external request',async t=>{
  const f=await fixture(t);
  assert.equal((await f.service.search({...f.input,enabled:false})).reason,'disabled');
  assert.equal((await f.service.search({...f.input,allowed:false})).reason,'not_selected');
  const g=await fixture(t,{env:{}}); assert.equal((await g.service.search(g.input)).reason,'unconfigured');
  assert.equal(f.requests.length+g.requests.length,0);
});
test('warm source cache skips Exa but rechecks applicability for another turn',async t=>{
  let selections=0; const f=await fixture(t,{decide:async batch=>{if(batch.family==='historical-reference')selections++;return decision(batch);}});
  await f.service.search(f.input);
  const result=await f.service.search({...f.input,binding:'test:main:2',turn:2});
  assert.equal(result.cached,true); assert.equal(f.requests.length,1); assert.equal(selections,2);
  assert.deepEqual(result.materials[0].excerpts,raw.results[0].highlights);
});
test('same pending query is coalesced and keeps its complete body',async t=>{
  const f=await fixture(t); const [a,b]=await Promise.all([f.service.search(f.input),f.service.search(f.input)]);
  assert.deepEqual(a,b); assert.equal(f.requests.length,1);
});
test('source-less results and unselected excerpts stay empty',async t=>{
  const f=await fixture(t,{fetcher:async()=>Response.json({results:[{url:'https://example.org',title:'Title only'}]})});
  assert.equal((await f.service.search(f.input)).status,'empty');
  const g=await fixture(t,{decide:async batch=>contextPolicy(batch)??({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'choice',choice:'reject'}]))})});
  assert.equal((await g.service.search(g.input)).reason,'no_applicable_excerpts');
});
test('analogous material retains its limited applicability',async t=>{
  const f=await fixture(t,{decide:async batch=>contextPolicy(batch)??({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'choice',choice:'analogous'}]))})});
  assert.equal((await f.service.search(f.input)).materials[0].applicability,'analogous');
});
test('401 and 429 return bounded failures without echoing provider payloads',async t=>{
  for(const [status,reason] of [[401,'authentication_failed'],[429,'rate_limited']]) {
    let calls=0;const f=await fixture(t,{fetcher:async()=>{calls++;return new Response(env[EXA_ENV],{status});}});
    const result=await f.service.search(f.input); assert.equal(result.reason,reason);assert.equal(calls,1);
    assert(!JSON.stringify(result).includes(env[EXA_ENV]));
  }
});
test('cancelled or stale selections never reach the Keeper',async t=>{
  let current=true;const f=await fixture(t,{decide:async batch=>{current=false;return decision(batch);}});
  const result=await f.service.search({...f.input,current:()=>current});
  assert.equal(result.reason,'stale_or_cancelled'); assert.deepEqual(result.materials,[]);
});
test('a deadline aborts a slow request and repeat calls do not renew it',async t=>{
  const f=await fixture(t,{fetcher:async(_url,init)=>new Promise((_ok,fail)=>init.signal.addEventListener('abort',()=>fail(new Error('abort')),{once:true}))});
  const started=Date.now(), result=await f.service.search({...f.input,deadlineAt:Date.now()+35});
  assert.equal(result.reason,'budget_exhausted'); assert(Date.now()-started<500);
  assert.equal((await f.service.search({...f.input,query:'different question'})).reason,'budget_exhausted');
});
test('candidate validation deduplicates sources, rejects non-web URLs and preserves exact text',()=>{
  assert.equal(historyCandidates({results:[...raw.results,...raw.results,{url:'javascript:bad',highlights:['x']}]}).length,1);
  assert.equal(historyNeed({answers:{[HISTORY_NEED]:{status:'answered',type:'noul',noul:0.9}}}),true);
  assert.equal(historyNeed({answers:{[HISTORY_NEED]:{status:'answered',type:'noul',noul:0.59}}}),true);
  assert.equal(historyNeed({answers:{[HISTORY_NEED]:{status:'answered',type:'noul',noul:0.23}}}),false);
  assert.equal(historyNeed({answers:{[HISTORY_NEED]:{status:'unknown'}}}),false);
});
test('a worldline, loop or turn change invalidates an issued historical read',()=>{
  const scope={campaign:'c',worldline:'main',loop:0,owner:'test',audience:'keeper'};
  const capsule={_context:{...scope,turn:3},mods:{active:[{id:'historical-reference'}]}};
  assert.equal(historyBindingMatches(capsule,scope,3),true);
  for(const patch of [{worldline:'other'},{loop:1},{campaign:'other'},{turn:4}])
    assert.equal(historyBindingMatches({...capsule,_context:{...capsule._context,...patch}},scope,3),false);
});
