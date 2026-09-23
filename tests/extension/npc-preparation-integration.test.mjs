/** Shared preparation through real NPC publication, the host bridge and final request validation. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import npc from '../../extensions/npc/index.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {supportWire} from './support-agent-helpers.mjs';

const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'.pi/npc-prescreen-integration/tests');
await mkdir(evidence,{recursive:true});
const emitted=await mkdtemp(join(evidence,'runtime-'));
await build({stdin:{contents:"export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {installContextPolicy} from './extensions/table/context-runtime.ts'; export {projectedMessages,customMessage} from './extensions/table/context-policy.ts'; export {convertToLlm} from './node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';",resolveDir:root},outfile:join(emitted,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(emitted,'api.mjs')).href);
async function readyNpc(t){
 const home=await mkdtemp(join(evidence,'campaign-')),context=await api.createKernelContext({workspace:home,content:join(root,'content'),locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context);
 t.after(async()=>{await runtime.close();await context.git.close();});
 const campaign='npc-preparation',call=(method,params={})=>runtime.handlers[method]({campaign,...params});
 await call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
 await call('table.player_input',{text:'Thank you. I am leaving now.'});
 const personality=await call('npc.job',{name:'Steven Knott'});await call('npc.submit',{job_id:personality.job_id,claim:personality.claim,personality:{description:'Practical and attentive to verifiable evidence.'}});
 const bank=await call('npc.responses.job',{name:'Steven Knott'});await call('npc.responses.submit',{job_id:bank.job_id,claim:bank.claim,responses:[{intent:'Accept the farewell and return to work.',when:'The visitor has chosen to end the exchange.'}]});
 return {campaign,home,call};
}
function externalAnswer(_url,init){
 const body=JSON.parse(init.body);return Promise.resolve(Response.json({model:body.model,usage:{input_tokens:200,output_tokens:20},answers:Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{
  const choice=key==='choose'?'response:1':key==='respond'?'respond':'supported';
  return [key,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];
 }))}));
}
function host(t,table,integrated=false){
 const events=new EventEmitter(),hooks=new Map(),records=[];let bridge;
 const old={PI_COC_MODE:process.env.PI_COC_MODE,PI_COC_NPC_BACKFILL:process.env.PI_COC_NPC_BACKFILL,EXT_JEV_APIKEY:process.env.EXT_JEV_APIKEY};
 Object.assign(process.env,{PI_COC_MODE:'play',PI_COC_NPC_BACKFILL:'0',EXT_JEV_APIKEY:'test-only-credential'});
 t.after(async()=>{for(const fn of hooks.get('session_shutdown')??[])await fn({});for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 events.on('coc:npc-bridge',value=>{bridge=value;});const pi={events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:(...row)=>records.push(row),getActiveTools:()=>[],getAllTools:()=>[]};npc(pi);
 if(integrated)api.installContextPolicy(pi,row=>records.push(row));
 events.emit('coc:kernel-bridge',{campaign:table.campaign,call:table.call});
 return {events,hooks,records,get bridge(){return bridge;},start:async()=>{for(const fn of hooks.get('session_start')??[])await fn({}, {cwd:table.home,model:{provider:'test',id:'author'},modelRegistry:{}});}};
}

test('an early NPC intention is rechecked after other preparation and cannot survive a newly recorded death',async t=>{
 const table=await readyNpc(t),session=host(t,table);await session.start();
 const decision=createDecisionAdapter({env:process.env,fetcher:externalAnswer}),signal=new AbortController().signal;
 const prepared=await session.bridge.prepare({campaign:table.campaign,decision,signal,automatic:true,deadlineAt:Date.now()+2000});
 assert.equal(prepared.result.advice[0].status,'ready');
 await table.call('table.apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',dead:true}]});
 const final=await session.bridge.finalize(prepared,{campaign:table.campaign,signal,deadlineAt:Date.now()+1000});
 assert.equal(final.advice[0].status,'stale');assert.equal(final.advice[0].selected,undefined);
 assert(!JSON.stringify(final).includes('view_revision'),'revision checkpoints never become Keeper content');
});

test('actual Keeper preparation overlaps NPC and material decisions and delivers both in one provider payload',async t=>{
 const table=await readyNpc(t),session=host(t,table,true),oldFlag=process.env.PI_COC_JEV_PRESELECT,oldFetch=globalThis.fetch;
 process.env.PI_COC_JEV_PRESELECT='1';t.after(()=>{globalThis.fetch=oldFetch;if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;});
 let npcActive=0,materialActive=0,overlap=false;const waiting=new Set();
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body),isNpc=Boolean(body.state.npc);if(isNpc)npcActive++;else materialActive++;
  let release,abort;const gate=new Promise((resolve,reject)=>{release=resolve;abort=()=>reject(init.signal.reason);init.signal?.addEventListener('abort',abort,{once:true});});
  waiting.add(release);
  if(npcActive&&materialActive){overlap=true;for(const resolve of waiting)resolve();waiting.clear();}
  try{
   if(!overlap)await gate;
   if(isNpc)return externalAnswer(url,init);
   return Response.json(supportWire(body,candidate=>candidate.kind==='npc'&&candidate.label==='Steven Knott'?'necessary':'skip'));
  }finally{waiting.delete(release);init.signal?.removeEventListener('abort',abort);if(isNpc)npcActive--;else materialActive--;}
 };
 await session.start();const opened=await table.call('table.open'),capsule=await table.call('table.capsule',{rehydrate:true}),{_context,...view}=capsule;
 session.events.emit('coc:table-open',{campaign:table.campaign,open:opened});
 session.events.emit('coc:capsule',{campaign:table.campaign,epoch:'integrated-input',capsule:view,context:_context});
 const ctx={cwd:table.home,model:{contextWindow:1000000},getSystemPrompt:()=>'',getContextUsage:()=>undefined,sessionManager:{getBranch:()=>[]}};
 const messages=[{role:'user',content:'Thank you. I am leaving now.'}];
 for(const fn of session.hooks.get('before_agent_start')??[]){const result=await fn({prompt:messages[0].content},ctx);if(result?.message)messages.push({role:'custom',...result.message,timestamp:Date.now()});}
 let current=messages;for(const fn of session.hooks.get('context')??[]){const result=await fn({messages:current},ctx);if(result?.messages)current=result.messages;}
 assert.equal(overlap,true,'independent NPC and material decisions must coexist rather than taking serial wait windows');
 const converted=JSON.stringify(api.convertToLlm(current));
 assert(converted.includes('npc_response_advice'),'NPC intentions reach the actual Keeper message conversion: '+JSON.stringify(session.records));
 assert(converted.includes('keeper_support'),'the fixed support packet is delivered alongside the NPC intention');
 const support=JSON.parse(current.find(row=>row.customType==='coc-prescreen').content);
 assert(support.materials.some(row=>row.kind==='npc'&&row.label==='Steven Knott'),'actual selected dossier is delivered');
 assert(converted.includes('Accept the farewell and return to work.'));
});

test('the host material snapshot can supply the same limited NPC perspectives without substituting Keeper dossiers',async t=>{
 const table=await readyNpc(t);
 const catalog=await table.call('table.workspace.read',{preselect:{version:2,mode:'catalog',limit:48},query:'I speak to Knott.',npc_perspectives:true});
 const ordinary=await table.call('npc.perspectives');
 assert.deepEqual(catalog.npc_perspectives,ordinary.views);
 assert(!JSON.stringify(catalog.npc_perspectives).includes('keeper_note'));
 assert.equal(catalog.npc_perspectives[0].availability.present,true);
});

test('a replaced player input cannot resume old shared discovery on the new cancellation signal',async t=>{
 const table=await readyNpc(t),entered=Promise.withResolvers(),release=Promise.withResolvers(),originalCall=table.call;
 const delayed={...table,call:async(method,params)=>{const result=await originalCall(method,params);if(method==='table.workspace.read'&&params.npc_perspectives){entered.resolve();await release.promise;}return result;}};
 const session=host(t,delayed,true),oldFlag=process.env.PI_COC_JEV_PRESELECT,oldFetch=globalThis.fetch;let dispatches=0;
 process.env.PI_COC_JEV_PRESELECT='1';globalThis.fetch=async(url,init)=>{dispatches++;return externalAnswer(url,init);};
 t.after(()=>{release.resolve();globalThis.fetch=oldFetch;if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;});
 await session.start();
 const publish=async epoch=>{const {_context,...capsule}=await originalCall('table.capsule',{rehydrate:true});session.events.emit('coc:capsule',{campaign:table.campaign,epoch,capsule,context:_context});};
 await publish('first-input');
 const ctx={model:{contextWindow:1000000},getSystemPrompt:()=>''};
 const pending=(async()=>{let messages=[{role:'user',content:'Thank you. I am leaving now.'}];for(const fn of session.hooks.get('context')??[]){const result=await fn({messages},ctx);if(result?.messages)messages=result.messages;}return messages;})();
 await entered.promise;
 for(const fn of session.hooks.get('input')??[])await fn({text:'I pause at the door.'});
 release.resolve();await pending;
 assert.equal(dispatches,0,'a retired request cannot spend the new input\'s provider capacity');
});

test('optional NPC advice fits around paired current evidence and cannot remove it to make room',()=>{
 const binding={version:1,campaign:'c1',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
 const fact='Verified promise and its conditions. '+'.'.repeat(2400),intent='Conditional intention. '+'.'.repeat(2000);
 const messages=[{role:'user',content:'What did Knott promise?'},{role:'custom',customType:'coc-capsule',content:JSON.stringify({turn:{number:1}}),details:{context:binding}},
  {role:'assistant',content:[{type:'toolCall',id:'known-read',name:'look',arguments:{focus:'npc',name:'Steven Knott'}}]},
  {role:'toolResult',toolCallId:'known-read',toolName:'look',content:[{type:'text',text:fact}]}];
 const npc=api.customMessage('coc-npc-advice',{kind:'npc_response_advice',advice:[{npc:'Steven Knott',selected:{intent,when:'The player asks about the promise.'}}]});
 for(const [budget,expected]of [[4096,false],[8192,true]]){
  const result=api.projectedMessages({messages,binding,history:{},budget,npc});
  assert(result.messages.some(row=>row.role==='toolResult'&&row.content[0].text===fact));
  assert.equal(Boolean(result.npcKept),expected);
  assert.equal(result.messages.some(row=>row.customType==='coc-npc-advice'),expected);
 }
});

test('compatible simultaneous NPC preparation shares provider work and a canonical state change invalidates reuse',async t=>{
 const table=await readyNpc(t),session=host(t,table);await session.start();let calls=0;
 const decision=createDecisionAdapter({env:process.env,fetcher:async(url,init)=>{calls++;return externalAnswer(url,init);}});
 const request={campaign:table.campaign,automatic:true,decision,signal:new AbortController().signal,deadlineAt:Date.now()+4000};
 const [first,second]=await Promise.all([session.bridge.prepare(request),session.bridge.prepare(request)]);
 assert.equal(first.result.advice[0].status,'ready');assert.equal(second.result.advice[0].status,'ready');assert.equal(calls,1);
 await table.call('table.apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:1}]});
 const old=await session.bridge.finalize(first,{campaign:table.campaign,signal:request.signal,deadlineAt:Date.now()+1000});
 assert.equal(old.advice[0].status,'stale');
 await session.bridge.prepare({...request,deadlineAt:Date.now()+2000});assert.equal(calls,2);
});

test('automatic NPC preparation stops after canonical delivery closes the player input',async t=>{
 const table=await readyNpc(t),session=host(t,table);await session.start();let dispatched=0;
 await table.call('table.narrate',{call_id:'t1-c1',text:'Knott accepts the farewell.'});
 const decision=createDecisionAdapter({env:process.env,fetcher:async(url,init)=>{dispatched++;return externalAnswer(url,init);}});
 const prepared=await session.bridge.prepare({campaign:table.campaign,automatic:true,decision,signal:new AbortController().signal,deadlineAt:Date.now()+2000});
 assert.equal(prepared.result.status,'unavailable');assert.equal(dispatched,0);
});

test('foreign shared NPC views are refused before provider dispatch',async t=>{
 const table=await readyNpc(t),session=host(t,table);await session.start();let dispatched=0;
 const {views}=await table.call('npc.perspectives');views[0].scope.campaign='another-campaign';
 const decision=createDecisionAdapter({env:process.env,fetcher:async(url,init)=>{dispatched++;return externalAnswer(url,init);}});
 const prepared=await session.bridge.prepare({campaign:table.campaign,automatic:true,decision,snapshots:views,signal:new AbortController().signal,deadlineAt:Date.now()+2000});
 assert.equal(prepared.result.reason,'perspective_campaign_mismatch');assert.equal(dispatched,0);
});
