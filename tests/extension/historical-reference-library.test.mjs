import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HistoricalReference, EXA_ENV} from '../../runtime/historical-reference.ts';
import {HistoricalReferenceLibrary} from '../../runtime/historical-reference-library.ts';
import {contextPolicy} from './fixtures/history-policy.mjs';

const excerpt = 'In 1920 the newspaper library kept clippings in subject files and reference books on separate shelves.';
const env = {[EXA_ENV]:'test-exa-key',TYPESAFE_API_KEY:'test-jev-key'};
const decide = async batch => contextPolicy(batch) ?? ({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,
  q.type==='noul'?{status:'answered',type:'noul',noul:0.9}:{status:'answered',type:'choice',choice:'direct'}]))});
async function fixture(t) {
  const home=await mkdtemp(join(tmpdir(),'coc-reference-library-'));t.after(()=>rm(home,{recursive:true,force:true}));
  let network=0;
  const fetcher=async(_url,init)=>{network++;const query=JSON.parse(init.body).query;
    return Response.json({results:[{title:query.includes('second')?'Second source':'Boston newspaper library',
      url:query.includes('second')?'https://example.org/second':'https://example.org/library',highlights:[excerpt]}]});};
  const create=(extra={})=>new HistoricalReference({home,env,fetcher,decide,...extra});
  const input={binding:'input-1',scope:{owner:'test',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},turn:1,
    enabled:true,allowed:true,query:'1920 Boston newspaper reference library',context:{scene:'newspaper'},signal:new AbortController().signal,current:()=>true};
  return {home,create,input,network:()=>network};
}
test('restart and a paraphrased query reuse stored originals without Exa or its key',async t=>{
  const f=await fixture(t);await f.create().search(f.input);
  await rm(join(f.home,'.coc/reference-cache'),{recursive:true,force:true});
  const result=await f.create({env:{TYPESAFE_API_KEY:env.TYPESAFE_API_KEY}}).search({...f.input,binding:'input-2',turn:2,
    query:'How were old stories filed at this paper?',context:{scene:'later visit'},allowed:false});
  assert.equal(result.status,'ready');assert.equal(result.origin,'library');assert.equal(f.network(),1);
  assert.deepEqual(result.materials[0].excerpts,[excerpt]);
});
test('catalogue needs no credentials and named reading restores the complete body after context loss',async t=>{
  const f=await fixture(t);await f.create().search(f.input);
  const catalogue=await f.create({env:{}}).search({...f.input,query:'',allowed:false,reference_mode:'catalog'});
  assert.equal(catalogue.catalogue.length,1);assert.equal(catalogue.materials.length,0);
  assert(!JSON.stringify(catalogue).includes(excerpt));
  const read=await f.create({env:{TYPESAFE_API_KEY:env.TYPESAFE_API_KEY}}).search({...f.input,binding:'read-2',turn:2,query:'',
    allowed:false,reference_mode:'read',name:catalogue.catalogue[0].name});
  assert.equal(read.origin,'library');assert.deepEqual(read.materials[0].excerpts,[excerpt]);assert.equal(f.network(),1);
});
test('campaign, worldline and loop namespaces cannot read one another',async t=>{
  const f=await fixture(t);await f.create().search(f.input);
  for(const patch of [{campaign:'c2'},{worldline:'alternate'},{loop:1}]) {
    const result=await f.create().search({...f.input,scope:{...f.input.scope,...patch},reference_mode:'saved',allowed:false});
    assert.equal(result.status,'empty');assert.deepEqual(result.materials,[]);
    const list=await f.create({env:{}}).search({...f.input,scope:{...f.input.scope,...patch},reference_mode:'catalog',allowed:false});
    assert.deepEqual(list.catalogue,[]);
  }
  assert.equal(f.network(),1);
});
test('disabling preserves the library and re-enabling can reuse it',async t=>{
  const f=await fixture(t);const service=f.create();await service.search(f.input);
  assert.equal((await service.search({...f.input,enabled:false,reference_mode:'catalog'})).reason,'disabled');
  const read=await f.create().search({...f.input,binding:'enabled-again',allowed:false,reference_mode:'saved'});
  assert.equal(read.origin,'library');assert.equal(f.network(),1);
});
test('unselected originals are retained and can be useful to a later question',async t=>{
  const f=await fixture(t);
  const reject=async batch=>contextPolicy(batch)??({status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'choice',choice:'reject'}]))});
  assert.equal((await f.create({decide:reject}).search(f.input)).status,'empty');
  const catalogue=await f.create({env:{}}).search({...f.input,reference_mode:'catalog'});
  assert.equal(catalogue.catalogue[0].prior_applicability,'reject');
  const result=await f.create().search({...f.input,binding:'another-purpose',reference_mode:'saved',allowed:false});
  assert.equal(result.status,'ready');assert.equal(f.network(),1);
});
test('independent saved packets preserve concurrent results and catalogue pagination',async t=>{
  const f=await fixture(t);await Promise.all([f.create().search(f.input),f.create().search({...f.input,query:'second historical topic'})]);
  const library=new HistoricalReferenceLibrary(f.home);
  const inventory=await library.inventory(f.input.scope);assert.equal(inventory.entries.length,2);
  const first=inventory.entries[0];
  for(let i=0;i<13;i++)await library.save({...f.input,query:`topic ${i}`},[{...first,title:`Source ${i}`,url:`https://example.org/item/${i}`}]);
  const service=f.create({env:{}}), a=await service.search({...f.input,reference_mode:'catalog'});
  assert.equal(a.catalogue.length,12);assert.equal(a.next_cursor,12);
  const b=await service.search({...f.input,reference_mode:'catalog',reference_cursor:a.next_cursor});
  assert.equal(b.catalogue.length,3);assert.equal(b.next_cursor,null);
});
test('corrupt packets remain visible as unreadable coverage and do not corrupt valid material',async t=>{
  const f=await fixture(t);await f.create().search(f.input);const library=new HistoricalReferenceLibrary(f.home);
  await writeFile(join(library.directory(f.input.scope),'a'.repeat(64)+'.json'),'not json');
  const result=await f.create().search({...f.input,reference_mode:'catalog'});
  assert.equal(result.catalogue.length,1);assert.equal(result.library.unreadable,1);
});
test('time spent by the main model between local reads does not consume the preparation allowance',async t=>{
  const f=await fixture(t),service=f.create();await service.search(f.input);
  const now=Date.now;Date.now=()=>now()+10000;
  try {
    const result=await service.search({...f.input,query:'How did reporters find an old clipping?',reference_mode:'saved',allowed:false});
    assert.equal(result.status,'ready');assert.equal(f.network(),1);
  } finally {Date.now=now;}
});
test('equal titles on different pages get distinct readable names',async t=>{
  const f=await fixture(t),library=new HistoricalReferenceLibrary(f.home);
  const base={title:'Library guide',retrieved_at:'2026-09-30T08:00:00.000Z',published_at:null,excerpts:[excerpt]};
  await library.save(f.input,[{...base,url:'https://example.org/one'},{...base,url:'https://example.org/two'}]);
  const result=await f.create({env:{}}).search({...f.input,reference_mode:'catalog'});
  assert.equal(new Set(result.catalogue.map(row=>row.name)).size,2);
  const read=await f.create().search({...f.input,reference_mode:'read',query:'',name:result.catalogue[1].name,allowed:false});
  assert.equal(read.materials.length,1);assert.equal(read.materials[0].url,'https://example.org/two');assert.equal(f.network(),0);
});
test('a failed selector does not throw away an already obtained source snapshot',async t=>{
  const f=await fixture(t);
  assert.equal((await f.create({decide:async batch=>contextPolicy(batch)??({status:'unavailable',answers:{}})}).search(f.input)).reason,'selection_unavailable');
  const index=await f.create({env:{}}).search({...f.input,reference_mode:'catalog'});
  assert.equal(index.catalogue.length,1);assert.equal(index.catalogue[0].prior_applicability,null);
  const recovered=await f.create().search({...f.input,binding:'retry-locally',reference_mode:'saved',allowed:false});
  assert.equal(recovered.status,'ready');assert.equal(f.network(),1);
});
