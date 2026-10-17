/** Actual TS evidence owner: batched reads preserve originals and reuse immutable Git objects. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {api,root} from './object-usages-fixture.mjs';

test('canonical batches validate all aliases, retain bounded proofs and load each immutable turn once',async t=>{
 const workspace=await mkdtemp(join(tmpdir(),'memory-originals-'));
 t.after(()=>rm(workspace,{recursive:true,force:true}));
 const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'originals',
  locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 let shows=0;const run=context.git.run.bind(context.git);
 const runtime=api.createKernelRuntime({...context,git:{...context.git,
  run:async(campaign,args,...rest)=>{if(args[0]==='show')shows++;return run(campaign,args,...rest);}}});t.after(()=>runtime.close());
 const campaign='originals-test',call=(method,params={})=>runtime.handlers[method]({campaign,...params});
 await runtime.handlers['campaign.create']({id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 await call('table.open');
 const text='A retained canonical report describes the envelope and its written condition. '.repeat(45);
 await call('table.narrate',{call_id:'t0-c1',text});
 const snapshot=await call('memory.evidence',{action:'snapshot',query:'Read the earlier report.',filters:{turns:[0,0]},raw_all:true});
 const page=await call('memory.evidence',{action:'page',snapshot:snapshot.snapshot,offset:0});
 assert.ok(page.rows.length>=3);
 shows=0;
 const request=requests=>call('memory.evidence',{action:'originals',snapshot:snapshot.snapshot,requests});
 for(const requests of [[],Array.from({length:9},()=>({alias:page.rows[0].alias})),
  [{alias:page.rows[0].alias},{alias:'entry:foreign'}],[{alias:page.rows[0].alias,role:'other'}],
  [{alias:page.rows[0].alias,offset:-1}],[{alias:page.rows[0].alias,extra:true}]])await assert.rejects(request(requests));
 assert.equal(shows,0,'malformed requests must be rejected before any original load');
 const result=await request(page.rows.slice(0,3).map(row=>({alias:row.alias})));
 assert.deepEqual(result.results.map(row=>row.alias),page.rows.slice(0,3).map(row=>row.alias));
 assert.ok(result.results.every(row=>row.verified===true&&row.verification_scope==='canonical_original_integrity_only'
  &&row.refs.length>0&&Buffer.byteLength(JSON.stringify(row))<=12*1024));
 assert.equal(shows,2,'three occurrences share one turn blob and one campaign blob');
 const scalar=await call('memory.evidence',{action:'original',snapshot:snapshot.snapshot,alias:page.rows[0].alias});
 assert.deepEqual(scalar,result.results[0]);assert.equal(shows,2,'continuations and repeated scalar reads reuse the same immutable commit');
});
