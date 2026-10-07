/** Historical retrieval transport and persistence checks, not Keeper playtest evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HistoricalReference,EXA_ENV,historyCandidates,selectionBatch} from '../../runtime/historical-reference.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {HistoricalReferenceLibrary} from '../../runtime/historical-reference-library.ts';
import {checkReferenceQueries,mergeReferenceCandidates} from '../../runtime/historical-reference-plan.ts';
import {HistoricalReferenceBackground} from '../../runtime/historical-reference-background.ts';

const original='In 1975 white bread cost 36 cents per one-pound loaf and production workers earned 4.47 US dollars per hour.';
const raw=(url='https://example.org/original',excerpt=original)=>({results:[{title:'Original period report',url,highlights:[excerpt]}]});
const env={[EXA_ENV]:'fixture-exa',TYPESAFE_API_KEY:'fixture-jev'};
const decision=(batch,kind='context')=>({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,
  q.key==='query_kind'?{status:'answered',type:'choice',choice:kind,confidence:1}
    :q.key==='price_disputed'?{status:'answered',type:'noul',noul:0.01}
    :q.key.startsWith('anchor_')||q.key.startsWith('saved_')?{status:'answered',type:'noul',noul:0.99}
    :q.type==='noul'?{status:'answered',type:'noul',noul:0.9}:{status:'answered',type:'choice',choice:'direct'}]))});
async function fixture(t,patch={}){
  const home=await mkdtemp(join(tmpdir(),'coc-history-focused-')),requests=[],records=[],services=[];
  const create=extra=>{const service=new HistoricalReference({home,env,background:false,decide:async b=>decision(b),
    fetcher:async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json(raw());},record:r=>records.push(r),...patch,...extra});services.push(service);return service;};
  t.after(async()=>{await Promise.all(services.map(s=>s.dispose()));await rm(home,{recursive:true,force:true});});
  const input={binding:'first',scope:{owner:'history-test',audience:'keeper',campaign:'c',worldline:'main',loop:0},turn:1,
    enabled:true,allowed:true,query:'How did a 1975 Texas store operate?',objective:'Concrete historical detail.',context:{period:'1975',region:'Texas'},
    signal:new AbortController().signal,current:()=>true};
  return {home,requests,records,create,input};
}
async function until(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,5));}throw Error('preparation did not settle');}

test('query plans reject unknown scopes, excess requests and invalid questions before spending credit',async t=>{
  const f=await fixture(t),s=f.create();
  for(const reference_queries of [[],[{query:'q',scope:'fiction_fact'}],Array(3).fill({query:'q',scope:'exact'})])
    assert.equal((await s.search({...f.input,reference_queries})).reason,'invalid_reference_queries');
  assert.equal(f.requests.length,0);
  assert.equal(checkReferenceQueries([{query:'q',scope:'exact',focus:'emotions'}]),undefined);
  assert.deepEqual(mergeReferenceCandidates([[{url:'a'},{url:'b'}],[{url:'a'},{url:'c'}]],3).map(x=>x.url),['a','b','c']);
});

test('an omitted objective remains valid JSON in the actual Jev packing path',async t=>{
  const f=await fixture(t);const rows=historyCandidates(raw(),{query:'q',objective:undefined,scope:'exact',method:'fast'});
  assert.equal(Object.hasOwn(rows[0].search,'objective'),false);
  assert.doesNotThrow(()=>packDecisionBatch(selectionBatch({...f.input,objective:undefined},rows)));
});

test('an analogy is separately searched, remains analogous, and keeps its original region through restart',async t=>{
  const excerpt='Round Top, Texas, 1970: work clothes covered tables and buckets hung from the ceiling.';
  const f=await fixture(t,{fetcher:async(_url,init)=>{const body=JSON.parse(init.body);f.requests.push(body);
    return Response.json(body.query==='precise question'?{results:[]}:raw('https://example.org/round-top',excerpt));}});
  const plan=[{query:'precise question',scope:'exact'},{query:'regional analogue question',scope:'analogous',focus:'context'}];
  const result=await f.create().search({...f.input,reference_queries:plan});
  assert.equal(f.requests.length,2);assert.equal(result.materials[0].applicability,'analogous');
  assert.deepEqual(result.materials[0].excerpts,[excerpt]);assert.equal(result.materials[0].search.scope,'analogous');
  const restored=await f.create({env:{TYPESAFE_API_KEY:'fixture-jev'}}).search({...f.input,binding:'restart',turn:2,
    allowed:false,reference_queries:plan,reference_mode:'saved'});
  assert.equal(restored.materials[0].applicability,'analogous');assert.deepEqual(restored.materials[0].excerpts,[excerpt]);
  assert.equal(restored.materials[0].search.query,'regional analogue question');assert.equal(f.requests.length,2);
});

test('a fresh price baseline searches retail prices and hourly wages concurrently and future quotations reuse both',async t=>{
  let release;const both=new Promise(r=>release=r);let count=0;
  const f=await fixture(t,{decide:async b=>decision(b,'price_anchor'),fetcher:async(_url,init)=>{
    const body=JSON.parse(init.body);f.requests.push(body);const index=count++;if(count===2)release();await both;
    return Response.json(raw(`https://example.org/${index}`,index===0?'US,1975: milk 78.5 cents per half gallon.':'US,1975: production workers 4.47 dollars per hour.'));
  }});
  const started=Date.now(),service=f.create(),result=await service.search({...f.input,query:'What were representative US prices and wages in 1975?'});
  assert(Date.now()-started<1500,'the two provider requests run together');
  assert.equal(f.requests.length,2);assert.deepEqual(new Set(result.materials.map(r=>r.search.focus)),new Set(['retail_prices','hourly_wages']));
  assert(result.materials.every(r=>r.price_anchor));
  const later=await service.search({...f.input,binding:'later',turn:2,query:'Estimate another ordinary quotation.',allowed:false});
  assert.equal(later.origin,'library');assert.equal(f.requests.length,2);
});

test('a focus label cannot bypass the existing actual-player price-challenge gate',async t=>{
  const f=await fixture(t,{decide:async b=>decision(b,'item_price')});
  const result=await f.create().search({...f.input,reference_queries:[{query:'Find the price of a hat.',scope:'exact',focus:'context'}]});
  assert.equal(result.reason,'price_anchors_needed');assert.equal(f.requests.length,0);
});

test('slow Deep-lite does not delay the fast result and selected originals replace rejected candidates on a later local read',async t=>{
  let release,deepStarted=false;
  const gate=new Promise(r=>release=r);
  const select=async batch=>{const d=decision(batch);if(batch.family==='historical-reference')for(const [i,row]of batch.state.candidates.entries())
    if(row.url.includes('/modern/'))d.answers[`period_${i+1}`].noul=0.01;return d;};
  const f=await fixture(t,{background:true,decide:select,fetcher:async(_url,init)=>{
    const body=JSON.parse(init.body);f.requests.push(body);
    if(body.type==='deep-lite'){deepStarted=true;await gate;return Response.json({...raw('https://example.org/deep'),output:{content:'Invented summary must never enter the library.'}});}
    return Response.json({results:Array.from({length:5},(_,i)=>({title:'Modern directory',url:`https://example.org/modern/${i}`,highlights:['Current opening hours and contact details.']}))});
  }});
  const service=f.create(),started=Date.now(),result=await service.search(f.input);
  assert(Date.now()-started<500);assert.equal(result.status,'empty');assert.equal(result.background.state,'pending');
  await until(()=>deepStarted);release();
  await until(()=>f.records.some(r=>r.event==='background'&&r.phase==='returned'));
  const later=await service.search({...f.input,binding:'later',turn:2,allowed:false,reference_mode:'saved'});
  assert.equal(later.status,'ready');assert.deepEqual(later.materials[0].excerpts,[original]);
  assert.equal(later.materials[0].search.method,'deep-lite');assert.equal(f.requests.filter(r=>r.type==='deep-lite').length,1);
  const restored=await f.create({env:{TYPESAFE_API_KEY:'fixture-jev'}}).search({...f.input,binding:'restored',turn:3,allowed:false,reference_mode:'saved'});
  assert.deepEqual(restored.materials[0].excerpts,[original]);
  assert(!JSON.stringify(await new HistoricalReferenceLibrary(f.home).inventory(f.input.scope)).includes('Invented summary'));
});

test('preparation survives a normal turn boundary but cannot publish after its campaign/worldline/Mod fence closes',async t=>{
  for(const keepScope of [true,false]){
    let release,turn=1,currentScope=true;const gate=new Promise(r=>release=r);
    const f=await fixture(t,{background:true,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);f.requests.push(body);
      if(body.type==='deep-lite'){await gate;return Response.json(raw('https://example.org/deep'));}return Response.json({results:[]});}});
    const service=f.create();await service.search({...f.input,current:()=>turn===1,backgroundCurrent:()=>currentScope});
    await until(()=>f.requests.some(r=>r.type==='deep-lite'));turn=2;currentScope=keepScope;release();
    await until(()=>f.records.some(r=>r.event==='background'&&r.phase==='returned'));
    const inventory=await new HistoricalReferenceLibrary(f.home).inventory(f.input.scope);
    assert.equal(inventory.entries.length,keepScope?1:0);
  }
});

test('unavailable Jev, generated-answer-only responses and cancellation never create prepared originals',async t=>{
  for(const mode of ['selection_unavailable','generated_only','cancelled']){
    const f=await fixture(t,{background:true,decide:async b=>b.family==='historical-reference'?{status:'unavailable',answers:{}}:decision(b),
      fetcher:async(_url,init)=>{const body=JSON.parse(init.body);f.requests.push(body);if(body.type==='fast')return Response.json({results:[]});
        if(mode==='cancelled')return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
        return Response.json(mode==='generated_only'?{results:[],output:{content:original}}:raw());}});
    const service=f.create();await service.search(f.input);await until(()=>f.requests.some(r=>r.type==='deep-lite'));
    if(mode==='cancelled')await service.dispose();else await until(()=>f.records.some(r=>r.event==='background'&&r.phase==='returned'));
    assert.equal((await new HistoricalReferenceLibrary(f.home).inventory(f.input.scope)).entries.length,0);
  }
});

test('background preparations coalesce across inputs and a cached evidence gap can prepare after restart',async t=>{
  let release;const gate=new Promise(r=>release=r);
  const rejected=async batch=>{const d=decision(batch);if(batch.family==='historical-reference')for(const key of Object.keys(d.answers))
    if(key.startsWith('period_'))d.answers[key].noul=0.01;return d;};
  const f=await fixture(t,{decide:rejected,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);f.requests.push(body);
    if(body.type==='deep-lite'){await gate;return Response.json({results:[]});}return Response.json(raw());}});
  await f.create().search(f.input);
  assert.equal(f.requests.length,1);
  const service=f.create({background:true});
  const cached=await service.search({...f.input,binding:'restart'});
  assert.equal(cached.origin,'query_cache');assert.equal(cached.background.state,'pending');
  await until(()=>f.requests.some(r=>r.type==='deep-lite'));
  const again=await service.search({...f.input,binding:'another-input',turn:2});
  assert.equal(again.background.state,'pending');assert.equal(f.requests.filter(r=>r.type==='deep-lite').length,1);
  release();await until(()=>f.records.some(r=>r.event==='background'&&r.phase==='returned'));
});

test('volatile scene changes do not hide a preparation, while campaign/worldline/loop changes retain isolation',async t=>{
  const f=await fixture(t),queue=new HistoricalReferenceBackground(()=>{});
  const base={...f.input,context:{period:'1975',scenario:{era:'1975'},where:{scene:'Store',back:[],assets:[]}}};
  const next={...base,turn:2,context:{...base.context,where:{scene:'Store',back:['Road'],assets:['Newspaper']}}};
  assert.equal(queue.key(base),queue.key(next));
  for(const scope of [{...base.scope,campaign:'other'},{...base.scope,worldline:'other'},{...base.scope,loop:1}])
    assert.notEqual(queue.key(base),queue.key({...next,scope}));
  await queue.dispose();
});

test('background price research retains the whole baseline goal and does not mislabel wage results as retail evidence',async t=>{
  const f=await fixture(t,{background:true,decide:async batch=>decision(batch,'price_anchor'),fetcher:async(_url,init)=>{
    const body=JSON.parse(init.body);f.requests.push(body);
    return Response.json(body.type==='fast'?{results:[]}:raw('https://example.org/hourly-wages','US,1975: production workers earned 4.47 dollars per hour.'));
  }});
  const service=f.create();await service.search({...f.input,query:'What were representative US retail prices and hourly wages in 1975?'});
  await until(()=>f.records.some(r=>r.event==='background'&&r.phase==='returned'));
  const payload=f.requests.find(r=>r.type==='deep-lite');
  assert.equal(payload.query,'What were representative US retail prices and hourly wages in 1975?');assert.equal(payload.additionalQueries.length,2);
  const saved=await new HistoricalReferenceLibrary(f.home).inventory(f.input.scope);
  assert.equal(saved.entries[0].search.focus,'context');assert.equal(saved.entries[0].price_anchor,true);
});
