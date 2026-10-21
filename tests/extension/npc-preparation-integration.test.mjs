/**
 * Contract §143.6: the per-turn NPC response advice and its bank are retired. Through the real kernel, the NPC
 * extension and the table's context policy: a table played for three turns sends the Keeper no `coc-npc-advice`, asks
 * Jev nothing about a person and writes no advice telemetry, while the material prescreen still reaches the provider
 * payload; a copy of the retired message recorded by an older session never reaches the model; and a replaced player
 * input still cannot resume the old input's discovery on the new signal.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {cpSync,readFileSync,writeFileSync} from 'node:fs';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import npc from '../../extensions/npc/index.ts';
import {supportWire} from './support-agent-helpers.mjs';
import {PRESELECT_ALLOWANCE_MAX_MS} from '../../extensions/jev/agent/config.js';
import {openTable,waitFor} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {RpcClient,rpcCommand} from '../integration/support.ts';

const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'.pi/npc-prescreen-integration/tests');
await mkdir(evidence,{recursive:true});
const emitted=await mkdtemp(join(evidence,'runtime-'));
await build({stdin:{contents:"export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {installContextPolicy} from './extensions/table/context-runtime.ts'; export {projectedMessages,customMessage} from './extensions/table/context-policy.ts'; export {convertToLlm} from './build/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';",resolveDir:root},outfile:join(emitted,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(emitted,'api.mjs')).href);
async function readyNpc(t){
 const home=await mkdtemp(join(evidence,'campaign-')),context=await api.createKernelContext({workspace:home,content:join(root,'content'),locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context);
 t.after(async()=>{await runtime.close();await context.git.close();});
 const campaign='npc-preparation',call=(method,params={})=>runtime.handlers[method]({campaign,...params});
 await call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
 await call('table.player_input',{text:'Thank you. I am leaving now.'});
 const personality=await call('npc.job',{name:'Steven Knott'});await call('npc.submit',{job_id:personality.job_id,claim:personality.claim,personality:{description:'Practical and attentive to verifiable evidence.'}});
 return {campaign,home,call};
}
function host(t,table,integrated=false){
 const events=new EventEmitter(),hooks=new Map(),records=[];
 const old={PI_COC_MODE:process.env.PI_COC_MODE,PI_COC_NPC_BACKFILL:process.env.PI_COC_NPC_BACKFILL,EXT_JEV_APIKEY:process.env.EXT_JEV_APIKEY};
 Object.assign(process.env,{PI_COC_MODE:'play',PI_COC_NPC_BACKFILL:'0',EXT_JEV_APIKEY:'test-only-credential'});
 t.after(async()=>{for(const fn of hooks.get('session_shutdown')??[])await fn({});for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const pi={events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:(...row)=>records.push(row),getActiveTools:()=>[],getAllTools:()=>[]};npc(pi);
 if(integrated)api.installContextPolicy(pi,row=>records.push(row));
 events.emit('coc:kernel-bridge',{campaign:table.campaign,call:table.call});
 return {events,hooks,records,start:async()=>{for(const fn of hooks.get('session_start')??[])await fn({}, {cwd:table.home,model:{provider:'test',id:'author'},modelRegistry:{}});}};
}
/** Every telemetry row the session wrote, whichever writer: lane rows ride `coc-telemetry` entries, context rows are bare. */
const rows=records=>records.map(value=>Array.isArray(value)?(value[0]==='coc-telemetry'?value[1]:undefined):value).filter(Boolean);

test('a table played three turns sends no NPC advice, asks Jev nothing about a person, and the prescreen still arrives (§143.6)',async t=>{
 const table=await readyNpc(t),session=host(t,table,true),oldFlag=process.env.PI_COC_JEV_PRESELECT,oldFetch=globalThis.fetch;
 process.env.PI_COC_JEV_PRESELECT='1';t.after(()=>{globalThis.fetch=oldFetch;if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;});
 const batches=[];
 globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);batches.push(body);
  return Response.json(supportWire(body,candidate=>candidate.kind==='npc'&&candidate.label==='Steven Knott'?'necessary':'skip'));};
 await session.start();
 session.events.emit('coc:table-open',{campaign:table.campaign,open:await table.call('table.open')});
 const ctx={cwd:table.home,model:{contextWindow:1000000},getSystemPrompt:()=>'',getContextUsage:()=>undefined,sessionManager:{getBranch:()=>[]}};
 const lines=['Thank you. I am leaving now.','I ask Knott who else has a key.','I ask Knott about the last tenant.'],supported=[];
 for(const [index,line] of lines.entries()){
  const turn=index+1;
  if(turn>1){for(const fn of session.hooks.get('input')??[])await fn({text:line});await table.call('table.player_input',{text:line});}
  const {_context,...view}=await table.call('table.capsule',{rehydrate:true});
  session.events.emit('coc:capsule',{campaign:table.campaign,epoch:`input-${turn}`,capsule:view,context:_context});
  const messages=[{role:'user',content:line}];
  for(const fn of session.hooks.get('before_agent_start')??[]){const result=await fn({prompt:line},ctx);if(result?.message)messages.push({role:'custom',...result.message,timestamp:Date.now()});}
  let current=messages;for(const fn of session.hooks.get('context')??[]){const result=await fn({messages:current},ctx);if(result?.messages)current=result.messages;}
  assert(!current.some(message=>message.customType==='coc-npc-advice'),`turn ${turn}: no NPC advice message`);
  const converted=JSON.stringify(api.convertToLlm(current));
  assert(!converted.includes('npc_response_advice'),`turn ${turn}: no advice packet reaches the provider conversion`);
  supported.push(converted.includes('keeper_support'));
  await table.call('table.narrate',{call_id:`t${turn}-c1`,text:'Knott answers what he knows and goes back to his ledger.'});
 }
 assert(supported[0],'the material prescreen still reaches the provider payload');
 assert(batches.length>0,'the prescreen asked Jev, so an NPC lane had its chance to ask too');
 assert(!batches.some(body=>body.state?.npc!==undefined),'no decision batch is about a person\'s response');
 const file=await readFile(join(table.home,'.coc','campaigns',table.campaign,'telemetry.jsonl'),'utf8').catch(()=>'');
 const telemetry=[...rows(session.records),...file.split('\n').filter(Boolean).map(line=>JSON.parse(line))];
 const advice=telemetry.filter(row=>row.lane==='npc'&&(['advice','responses','decision'].includes(row.kind)||['finalized','delivered'].includes(row.event)));
 assert.deepEqual(advice,[],'no advice, finalize, delivery or bank rows');
 assert(!telemetry.some(row=>row.lane==='preparation'),'no NPC-only preparation allowance');
});

test('a coc-npc-advice an older session recorded never reaches the model',async t=>{
 const table=await readyNpc(t),session=host(t,table,true);await session.start();
 session.events.emit('coc:table-open',{campaign:table.campaign,open:await table.call('table.open')});
 const {_context,...view}=await table.call('table.capsule',{rehydrate:true});
 session.events.emit('coc:capsule',{campaign:table.campaign,epoch:'legacy-input',capsule:view,context:_context});
 const legacy=api.customMessage('coc-npc-advice',{kind:'npc_response_advice',advice:[{npc:'Steven Knott',selected:{intent:'Accept the farewell and return to work.',when:'The visitor leaves.'}}]});
 const messages=[{role:'user',content:'Thank you. I am leaving now.'},{role:'custom',...legacy,timestamp:Date.now()}];
 const ctx={cwd:table.home,model:{contextWindow:1000000},getSystemPrompt:()=>''};
 let current=messages;for(const fn of session.hooks.get('context')??[]){const result=await fn({messages:current},ctx);if(result?.messages)current=result.messages;}
 assert(!current.some(message=>message.customType==='coc-npc-advice'));
 assert(!JSON.stringify(current).includes('Accept the farewell and return to work.'));
 assert(current.some(message=>message.role==='user'&&message.content==='Thank you. I am leaving now.'),'the player\'s words stay');
});

for(const phase of ['hydration','preselect'])test(`a replaced player input cannot resume old discovery after ${phase} on the new cancellation signal`,{timeout:30000},async t=>{
 const table=await readyNpc(t),entered=Promise.withResolvers(),release=Promise.withResolvers(),originalCall=table.call;
 let held=false;
 const delayed={...table,call:async(method,params)=>{const result=await originalCall(method,params);if(!held&&(phase==='hydration'?method==='table.untold':method==='table.workspace.read'&&params?.preselect)){held=true;entered.resolve();await release.promise;}return result;}};
 const session=host(t,delayed,true),oldFlag=process.env.PI_COC_JEV_PRESELECT,oldFetch=globalThis.fetch;let dispatches=0;
 process.env.PI_COC_JEV_PRESELECT='1';globalThis.fetch=async(_url,init)=>{
  // §248: the first input's package topic judgement starts when its capsule is published, before any hold; it is not discovery.
  if(!String(init.body).includes('"purpose":"the topics this turn involves"'))dispatches++;return Response.json(supportWire(JSON.parse(init.body),()=>'skip'));};
 t.after(()=>{release.resolve();globalThis.fetch=oldFetch;if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;});
 await session.start();
 const publish=async epoch=>{const {_context,...capsule}=await originalCall('table.capsule',{rehydrate:true});session.events.emit('coc:capsule',{campaign:table.campaign,epoch,capsule,context:_context});};
 await publish('first-input');
 const ctx={model:{contextWindow:1000000},getSystemPrompt:()=>''};
 const pending=(async()=>{let messages=[{role:'user',content:'Thank you. I am leaving now.'}];for(const fn of session.hooks.get('context')??[]){const result=await fn({messages},ctx);if(result?.messages)messages=result.messages;}return messages;})();
 await entered.promise;
 const beforeReplacement=dispatches;
 for(const fn of session.hooks.get('input')??[])await fn({text:'I pause at the door.'});
 release.resolve();await pending;
 assert.equal(dispatches,beforeReplacement,'a retired request cannot spend the new input\'s provider capacity');
 if(phase==='hydration')assert.equal(dispatches,0,'no applicability or discovery request starts after retired hydration');
});

async function personalityIdentityTable(t,{legacy}={}){
 const calls=[],outcomes=[],tasks=[],frames=[];
 let handles,offstage;
 const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,seedCampaign:false,
  runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand()),
   PI_COC_NPC_BACKFILL:'1',PI_COC_NPC_MODEL:undefined},
  prepareWorkspace:async workspace=>{
   const content=join(workspace,'personality-content');cpSync(join(root,'content'),content,{recursive:true});
   const file=join(content,'starters/the-haunting/module-graph.json'),graph=JSON.parse(readFileSync(file,'utf8'));
   for(const node of graph.nodes)if(node.properties?.runtime_projection?.record?.is_start)node.properties.runtime_projection.record.is_start=false;
   graph.nodes.push(
    {node_id:'scene-personality-office',node_kind:'scene',name:'Personality office',summary:'A public office.',visibility:'public',
     properties:{runtime_projection:{kind:'scene',record:{scene_id:'personality-office',is_start:true}}}},
    {node_id:'scene-personality-offstage',node_kind:'scene',name:'Separate office',summary:'A separate office.',visibility:'keeper-only',properties:{}},
    ...['first','second','offstage'].map((role,index)=>({node_id:'npc-personality-'+role,node_kind:'npc',
     name:legacy===undefined?'Avery':['First clerk','Second clerk','Absent clerk'][index],summary:role==='offstage'?'PRIVATE_OFFSTAGE_PERSONALITY':'A clerk attending the public office.',visibility:'keeper-only',
     properties:{runtime_projection:{kind:'npc',record:{npc_id:'personality-'+role,display_name:legacy===undefined?'Avery':['First clerk','Second clerk','Absent clerk'][index]}}}})));
   graph.relations.push(...['first','second','offstage'].map(role=>({relation_id:'personality-location-'+role,
    from_node_id:'npc-personality-'+role,relation_kind:'present-in',to_node_id:role==='offstage'?'scene-personality-offstage':'scene-personality-office',properties:{}})));
   writeFileSync(file,JSON.stringify(graph));
   const client=new RpcClient(workspace,{content});
   try{
    await client.ok('campaign.create',{id:'test-camp',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
    const present=await client.ok('table.look',{campaign:'test-camp',focus:'npc'});
    assert.equal(present.present.length,2);
    handles=present.present.map(person=>person.id);
    offstage=(await client.ok('table.look',{campaign:'test-camp',focus:'npc',name:'npc-personality-offstage'})).id;
    if(legacy===undefined){
     const ambiguous=await client.call('npc.job',{campaign:'test-camp',name:'Avery'});
     assert.equal(ambiguous.ok,false);assert.equal(ambiguous.error.code,'unknown_entity');
     assert.equal(ambiguous.error.details.candidates.length,3,'an explicit ambiguous native request never chooses a person');
    }
    await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You wait in the public office.'});
   }finally{await client.close();}
   process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',content]);
  },
  extraExtensions:[{name:'personality-identity-driver',factory:engine.extension},
   {name:'personality-identity-stream',factory:pi=>pi.events.on('coc:final-delivery',frame=>frames.push(frame))},
   {name:'personality-identity-background',factory:pi=>{
    // Only the external tool-enabled author task is doubled; Pi and every native job/claim/publication remain real.
    const events={...pi.events,on:(name,listener)=>pi.events.on(name,name==='coc:kernel-bridge'?binding=>{
     if(!binding?.call||!binding.runtime)return listener(binding);
     const call=async(method,params,...rest)=>{
      if(method==='npc.job')calls.push(params.name);
      const value=await binding.call(method,params,...rest);
      if(method!=='table.look'||params.focus!=='npc'||params.name!==undefined||legacy===undefined)return value;
      return {...value,present:value.present.map(person=>{const row={...person};
       if(legacy==='missing')delete row.id;else row.id=legacy==='spaced'?' '+person.id+' ':legacy;return row;})};
     };
     listener({...binding,call,runtime:{home:binding.runtime.home,runTask:async task=>{
      tasks.push(task);await writeFile(join(task.request.cwd,'draft.json'),JSON.stringify({personality:{description:'Careful with commitments, but willing to explain practical details.'}}));
      return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:['deterministic-author-boundary']};
     }}});
    }:listener)};
    npc({...pi,events,appendEntry:(type,row)=>{if(type==='coc-telemetry'&&row.lane==='npc'&&typeof row.ok==='boolean')outcomes.push(row);return pi.appendEntry(type,row);}});
   }}],responses:[fauxAssistantMessage('{{public}}You wait quietly in the office.')]});
 t.after(()=>table.dispose());
 await waitFor(()=>outcomes.length>0,{timeoutMs:5000,label:'native personality attempt finishes'});
 return {table,calls,outcomes,tasks,frames,handles,offstage};
}

test('the real Pi background personality bridge preserves distinct present identities with the same display name',async t=>{
 const {table,calls,outcomes,tasks,frames,handles,offstage}=await personalityIdentityTable(t);
 assert.deepEqual([...new Set(calls)].sort(),[...handles].sort(),'each present person uses its supplied identity before deduplication');
 assert.equal(calls.includes('Avery'),false);assert.equal(calls.includes(offstage),false);
 await waitFor(()=>outcomes.filter(row=>row.ok&&row.kind==='personality').length===2,{timeoutMs:5000})
  .catch(()=>assert.fail(JSON.stringify({calls,outcomes,tasks:tasks.length})));
 assert.equal(tasks.length,2);
 assert.ok(tasks.every(task=>task.request.tools==='read,write,edit,bash'&&task.request.priority==='background'));
 for(const task of tasks)assert.equal((await readFile(join(task.request.cwd,'packet.json'),'utf8')).includes('PRIVATE_OFFSTAGE_PERSONALITY'),false);
 const native=table.runtimeBridges().at(-1);
 for(const name of handles){const full=await native.call('table.look',{campaign:'test-camp',focus:'npc',name});
  assert.equal(full.personality.description,'Careful with commitments, but willing to explain practical details.');}
 const world=JSON.parse(await readFile(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
 assert.equal(world.npc_character?.['npc-personality-offstage'],undefined,'the offstage person has no published personality');
 await table.session.prompt('I wait quietly in the office.');
 assert.equal(tasks.length,2,'already accepted personalities are not authored again');
 assert.equal(JSON.stringify(frames).includes('PRIVATE_OFFSTAGE_PERSONALITY'),false);
 assert.equal(frames.at(-1)?.status,'completed');assert.deepEqual(table.extensionErrors,[]);
});

for(const [label,legacy]of [['missing','missing'],['empty',''],['whitespace','   '],['spaced','spaced']])
test(`the real Pi background personality bridge preserves ${label} identity compatibility`,async t=>{
 const {table,calls,outcomes,tasks,handles,offstage}=await personalityIdentityTable(t,{legacy});
 const expected=legacy==='spaced'?handles.map(id=>' '+id+' '):['First clerk','Second clerk'];
 assert.deepEqual([...new Set(calls)].sort(),expected.sort(),'legacy rows keep names and nonempty identities remain verbatim');
 assert.equal(calls.includes(offstage),false);
 await waitFor(()=>outcomes.filter(row=>row.ok&&row.kind==='personality').length===2,{timeoutMs:5000})
  .catch(()=>assert.fail(JSON.stringify({calls,outcomes,tasks:tasks.length})));
 assert.equal(tasks.length,2);
 assert.equal(outcomes.some(row=>row.ok===false),false);
 assert.deepEqual(table.extensionErrors,[]);
});
