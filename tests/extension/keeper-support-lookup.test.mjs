/** Shared explicit lookup contract; controlled decisions are not gameplay. */
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {supportDecision} from './support-agent-helpers.mjs';
const root=resolve(import.meta.dirname,'../..'),dir=await mkdtemp(join(root,'.tmp/support-lookup-'));
after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
await build({stdin:{resolveDir:root,contents:"export {lookupKeeperSupport} from './extensions/table/keeper-support-lookup.ts';"},
  outfile:join(dir,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const {lookupKeeperSupport}=await import(pathToFileURL(join(dir,'api.mjs')).href),binding={version:1,campaign:'c1',worldline:'main',loop:0,turn:2,source_revision:'a'.repeat(64)},
  player='I inspect the desk.',query='Find the prior owner and relevant scene conditions.',capsule={turn:{number:2,state:'active',player_text:player},where:{scene:'Office'}},
  options={version:1,profiles:[],decisions:[],revision:'options',world_revision:'world',context:{_binding:{campaign:'c1',worldline:'main',loop:0,turn:2},declared_action:player}},
  snapshot={status:'valid',authority:{checked:true},binding:{...binding,stateStamp:'world'},materials:{version:2,candidates:[
    {key:'host-private-source-key',kind:'graph_entity',label:'Office',authority:'module_source',summary:'Exact office conditions.',body:'The desk belongs to Knott.',coverage:{status:'complete'}}],coverage:{}}};
function fixture(overrides={}){
  const calls=[],batches=[];return {calls,batches,input:{campaign:'c1',query,env:{EXT_JEV_APIKEY:'test-only',PI_COC_JEV_PRESELECT:'0'},record:()=>{},
    decision:{decide:async(batch,lease)=>{batches.push(batch);return supportDecision().decide(batch,lease);}},call:async(method,args)=>{
      calls.push({method,args});assert.equal(args.campaign,'c1');
      if(method==='table.capsule')return {_context:binding,...capsule};
      if(method==='table.resolve.options')return options;
      assert.equal(method,'table.workspace.read');return snapshot;
    },...overrides}};
}
test('manual lookup uses its own query while check advice stays bound to the actual player declaration',async()=>{
  const f=fixture(),packet=await lookupKeeperSupport(f.input);
  assert.equal(packet.kind,'keeper_support');assert.equal(packet.request,query);assert.equal(packet.materials[0].content,'The desk belongs to Knott.');
  assert.equal(packet.check.basis[0].text,player);assert.equal(packet.check.disposition,'no_roll');
  assert(f.batches.filter(batch=>batch.family==='keeper-support-agent').every(batch=>batch.state.purpose==='lookup'&&batch.state.request===query));
  assert(f.batches.filter(batch=>batch.family==='ordinary-resolve').every(batch=>batch.state.rawInput===player));
  assert(!JSON.stringify(packet).includes('host-private-source-key'));assert(!JSON.stringify(packet).includes('stateStamp'));
});
test('waiting for the player permits evidence lookup but never treats the query as a new action',async()=>{
  const f=fixture(),call=f.input.call;f.input.call=(method,args)=>method==='table.capsule'?Promise.resolve({_context:binding,...capsule,
    turn:{number:2,state:'awaiting_player',player_text:''}}):call(method,args);
  const packet=await lookupKeeperSupport(f.input);assert.equal(packet.materials.length,1);assert.equal(packet.check.disposition,'unknown');
  assert(!f.calls.some(row=>row.method==='table.resolve.options'));
});
test('unconfigured or unmounted Jev performs no reads, and invalid queries are rejected',async()=>{
  for(const env of [{},{EXT_JEV_APIKEY:'stale',PIPIUI_SPAWN_CONTRACT:'{}',PIPIUI_MOUNTED_EXTENSIONS:'kernel'}]){
    const f=fixture({env});await assert.rejects(lookupKeeperSupport(f.input),error=>error.details?.reason==='support_not_configured');assert.equal(f.calls.length,0);
  }
  await assert.rejects(lookupKeeperSupport(fixture({query:' '}).input),error=>error.code==='invalid_params');
});
test('stale final material and parent cancellation cannot publish a support packet',async()=>{
  // §124.11: the owner names the material a volatile change reaches; it leaves the packet, which says so.
  const f=fixture(),call=f.input.call;f.input.call=async(method,args)=>method==='table.workspace.read'&&args.binding
    ?args.preselect?.mode==='check'?{...snapshot,status:'unverifiable',authority:{checked:false},binding:{...snapshot.binding,stateStamp:'changed'},
      materials:{version:2,candidates:[],coverage:{},check:{status:'stale',changed:['stateStamp'],keys:args.preselect.keys,stale_keys:args.preselect.keys}}}
      :{...snapshot,binding:{...snapshot.binding,stateStamp:'changed'}}:call(method,args);
  const packet=await lookupKeeperSupport(f.input);
  assert.equal(packet.materials.length,0);assert(!JSON.stringify(packet).includes('The desk belongs to Knott.'));
  assert(packet.gaps.some(gap=>gap.reason==='binding_changed'&&gap.label==='Office'));
  // A run key (the scene) voids the whole preparation.
  const moved=fixture(),inner=moved.input.call;moved.input.call=async(method,args)=>method==='table.workspace.read'&&args.binding
    ?{...snapshot,binding:{...snapshot.binding,scene:'Street'}}:inner(method,args);
  await assert.rejects(lookupKeeperSupport(moved.input),error=>error.details?.reason==='support_unavailable');
  const controller=new AbortController(),entered=Promise.withResolvers(),cancelled=fixture({signal:controller.signal,call:async()=>{entered.resolve();return new Promise(()=>{});}});
  const work=lookupKeeperSupport(cancelled.input);await entered.promise;controller.abort();await assert.rejects(work);
});
test('an exhausted parent budget is not replaced with an independent provider allowance',async()=>{
  let reservations=0,decisions=0;const f=fixture({parent:{signal:new AbortController().signal,deadlineAt:Date.now()+6000,
    reserve:async()=>{reservations++;throw Error('parent budget exhausted');}},decision:{decide:async()=>{decisions++;throw Error('must not dispatch');}}});
  const packet=await lookupKeeperSupport(f.input);assert(reservations>0);assert.equal(decisions,0);assert.equal(packet.materials.length,0);
  assert.equal(packet.assessment.coverage,'uncertain');
});
