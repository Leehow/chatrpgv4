/** Deterministic committed-turn fixtures, never real Keeper acceptance. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable, waitFor} from './harness.mjs';
import {MEMORY_ATTRIBUTION_POLICY, MEMORY_ATTRIBUTION_INSTRUCTION} from '../../kernel-ts/memory/attribution.ts';
import {npcMemoryPayloadDigests} from '../../extensions/npc/profile-observation.ts';
const root=resolve(import.meta.dirname,'../..'),parent=join(root,'.pi/memory-attribution-tests');
await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'run-'));
await writeFile(join(directory,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
await build({stdin:{contents:`export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts';`,resolveDir:root,sourcefile:'memory-attribution-api.ts'},outfile:join(directory,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(directory,'api.mjs')).href),closers=[];
after(async()=>{for(const close of closers)await close();});
const pledge={kind:'promise',subject:'Thomas Hayes',entities:['Steven Knott'],knowers:['Thomas Hayes','Steven Knott'],statement:'Thomas Hayes promised to return a verified report to Steven Knott after investigating.'};
const relation={kind:'relationship',subject:'Steven Knott',entities:['Thomas Hayes'],knowers:['Steven Knott'],statement:'After the verified report, Steven Knott agreed to bounded cooperation with Thomas Hayes.'};
async function table(){
 const home=await mkdtemp(join(directory,'campaign-'));
 const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'attribution',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 const runtime=api.createKernelRuntime(context);closers.push(()=>runtime.close());
 const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
 await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 await call('table.open');await call('table.narrate',{call_id:'t0-c1',text:'Thomas Hayes made a conditional reporting promise to Steven Knott, who heard and acknowledged it.'});
 return {home,base:join(home,'.coc/campaigns/c1'),runtime,context,call};
}
test('new extraction requires attributed promises atomically; private hearers are never inferred',async()=>{
 const t=await table(),job=await t.call('memory.job',{turn:0});
 assert.equal(job.attribution_policy,MEMORY_ATTRIBUTION_POLICY);assert(job.instruction.includes(MEMORY_ATTRIBUTION_INSTRUCTION));
 for(const knowers of [undefined,[],['Unknown Listener']]){
  const bad={...pledge};if(knowers===undefined)delete bad.knowers;else bad.knowers=knowers;
  await assert.rejects(t.call('memory.submit',{job_id:job.job_id,candidates:[relation,bad]}),/knowers|known name/);
 }
 assert.equal((await readFile(join(t.base,'memory/candidates.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})).trim(),'');
 const privatePledge={...pledge,knowers:['Thomas Hayes'],statement:'Thomas Hayes privately resolved to send a report later; Knott had not heard that undertaking.'};
 await t.call('memory.submit',{job_id:job.job_id,candidates:[privatePledge]});
 const view=await t.call('npc.perspective',{name:'Steven Knott'});assert.equal(view.commitments.length,0);
 const stored=JSON.parse((await readFile(join(t.base,'memory/candidates.jsonl'),'utf8')).trim());assert.deepEqual(stored.knowers,[job.investigators[0].name]);
});
test('heard promises and one-way cooperation reach NPC and voice views and survive a fresh reader',async()=>{
 const t=await table(),job=await t.call('memory.job',{turn:0});
 const submitted=await t.call('memory.submit',{job_id:job.job_id,candidates:[pledge,relation]});
 assert.equal((await t.call('memory.submit',{job_id:job.job_id,candidates:[pledge,relation]})).replayed,true);
 const view=await t.call('npc.perspective',{name:'Steven Knott'});
 assert.equal(view.commitments[0].statement,pledge.statement);assert.equal(view.relationships[0].toward,job.investigators[0].name);
 assert.equal(view.relationships[0].evidence[0].statement,relation.statement);
 const voice=await t.call('voice.job');assert.equal(voice.npc.commitments[0].statement,pledge.statement);assert.deepEqual(voice.npc.relationships,view.relationships);
 const rows=(await readFile(join(t.base,'memory/candidates.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(rows.filter(r=>r.kind==='relationship').length,1,'no automatic inverse or synthetic trust');
 assert.equal(rows.find(r=>r.kind==='promise').status,'candidate','pledge is not a settled world effect');
 const second=api.createKernelRuntime(await api.createKernelContext({workspace:t.home,content:join(root,'content'),locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}));closers.push(()=>second.close());
 assert.equal((await second.handlers['npc.perspective']({campaign:'c1',name:'Steven Knott'})).commitments[0].statement,pledge.statement);
 assert.equal(submitted.candidates,2);
});
test('a retained legacy packet can finish without rewriting its old attribution contract',async()=>{
 const t=await table(),packet=await t.call('memory.job',{turn:0}),path=join(t.base,'memory/jobs',packet.job_id+'.json');
 const job=JSON.parse(await readFile(path,'utf8'));delete job.packet.attribution_policy;await writeFile(path,JSON.stringify(job));
 const old={...pledge};delete old.knowers;await t.call('memory.submit',{job_id:packet.job_id,candidates:[old]});
 const row=JSON.parse((await readFile(join(t.base,'memory/candidates.jsonl'),'utf8')).trim());assert.deepEqual(row.knowers,[]);
});
test('the real extraction extension retries omitted promise attribution and preserves the corrected hearer',async t=>{
 const bad={...pledge};delete bad.knowers;
 const game=await openTable({retainAt:directory,env:{PI_COC_MEMORY_BACKFILL:'0'},laneResponses:{memory:[fauxAssistantMessage(JSON.stringify({candidates:[bad]})),fauxAssistantMessage(JSON.stringify({candidates:[pledge,relation]}))]}});t.after(()=>game.dispose());
 const submitted=[],packet={job_id:'extract:fixture:t1',turn:1,attribution_policy:MEMORY_ATTRIBUTION_POLICY,present:['Steven Knott'],investigators:[{name:'Thomas Hayes'}],known_entities:[{name:'Thomas Hayes',kind:'investigator'},{name:'Steven Knott',kind:'npc'}],player_text:'I will bring you the verified report after investigating.',keeper_text:'Knott acknowledged the reporting promise.',instruction:MEMORY_ATTRIBUTION_INSTRUCTION};
 game.emit('coc:kernel-bridge',{campaign:'fixture',call:async(method,params)=>{if(method==='memory.job')return packet;if(method==='memory.submit'){submitted.push(params);return {candidates:2};}return {};}});
 game.emit('coc:turn-committed',{campaign:'fixture',turn:1});await waitFor(()=>submitted.length===1);
 assert.deepEqual(submitted[0].candidates.map(x=>x.knowers),[pledge.knowers,relation.knowers]);
});

test('valid attributed reports reach native storage and NPC perspective without a second model veto',async t=>{
 const native=await table();
 await native.call('table.player_input',{text:'I will bring you a verified report after investigating.'});
 await native.call('table.narrate',{call_id:'t1-c1',text:'Thomas Hayes made a conditional reporting promise to Steven Knott, who heard and acknowledged it.'});
 const packet=await native.call('memory.job',{turn:1});
 const extracted={candidates:[pledge,relation],...(packet.story_context?.threads?.length?{story:{status:'unclear',thread:null,frame:null,bridge_delivered:false,delivery_quote:null}}:{})},mistakenReview={verdict:'repair',issues:[{
  candidate:'candidate 1',source_quote:'Thomas Hayes made a conditional reporting promise',reason:'The promisor is missing from knowers.'}]};
 const game=await openTable({retainAt:directory,env:{PI_COC_MEMORY_BACKFILL:'0'},laneResponses:{memory:
  [extracted,mistakenReview,extracted,mistakenReview].map(value=>fauxAssistantMessage(JSON.stringify(value)))}});
 t.after(()=>game.dispose());
 game.emit('coc:kernel-bridge',{campaign:'c1',call:(method,params)=>method==='memory.job'?packet:native.call(method,params)});
 game.emit('coc:turn-committed',{campaign:'c1',turn:1});
 await waitFor(()=>game.telemetry('c1').some(row=>row.lane==='memory'&&typeof row.ok==='boolean'));
 assert.equal(game.telemetry('c1').find(row=>row.lane==='memory'&&typeof row.ok==='boolean').ok,true);
 const rows=(await readFile(join(native.base,'memory/candidates.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,2);
 const view=await native.call('npc.perspective',{name:'Steven Knott'});
 assert.equal(view.commitments[0].statement,pledge.statement);
 assert.equal(view.relationships[0].evidence[0].statement,relation.statement);
 assert.equal(game.telemetry('c1').filter(row=>row.lane==='lane-call'&&row.phase==='start'&&row.subsession==='memory').length,1);
 assert.equal(JSON.parse(await readFile(join(native.base,'memory/jobs',packet.job_id+'.json'),'utf8')).status,'done');
});

test('actual adapter observation binds statement digests to the NPC receiving them without logging prose',()=>{
 const view={name:'Steven Knott',commitments:[pledge],relationships:[{toward:'Thomas Hayes',evidence:[relation]}]},before=structuredClone(view);
 const observed=npcMemoryPayloadDigests({messages:[{role:'tool',content:JSON.stringify(view)}]});
 assert.equal(observed.length,1);assert.equal(observed[0].npc,'Steven Knott');
 assert.equal(observed[0].commitment_digests.length,1);assert.equal(observed[0].relationship_digests.length,1);
 assert(!JSON.stringify(observed).includes(pledge.statement));assert.deepEqual(view,before);
 assert.deepEqual(npcMemoryPayloadDigests({memory:[pledge,relation]}),[],'global memory alone is not proof of NPC-scoped delivery');
 const compact={name:'Steven Knott',history:{promises:[{statement:pledge.statement,turn:1}]}};
 const compactObserved=npcMemoryPayloadDigests({messages:[{role:'tool',content:JSON.stringify(compact)}]});
 assert.equal(compactObserved[0].promise_history_digests.length,1,'owned promises already in history remain observable after capsule deduplication');
 assert.deepEqual(compactObserved[0].commitment_digests,[],'do not invent omitted subject/entities');
 assert(!JSON.stringify(compactObserved).includes(pledge.statement));
 assert.equal(npcMemoryPayloadDigests({...compact,history:{promises:[{statement:pledge.statement,turn:9}]}})[0].promise_history_digests[0],
  compactObserved[0].promise_history_digests[0],'delivery digest tracks compact statement, not host turn bookkeeping');
});
