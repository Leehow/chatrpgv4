import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as pi from './pi.mjs';

const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'single-keeper-current-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {createHybridEngine} from './runtime/jev/hybrid-engine.ts'; export {installContextPolicy} from './extensions/table/context-runtime.ts'; export {pairedTools,projectedMessages} from './extensions/table/context-policy.ts';",resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const custom=(type,value,details={})=>({role:'custom',customType:type,content:JSON.stringify(value),display:false,timestamp:0,details});

test('a current five-person Keeper request retains the latest real Pi tool pair and one current state owner',async t=>{
  const old=process.env.PI_COC_REQUEST_BYTES;process.env.PI_COC_REQUEST_BYTES='393216';
  t.after(()=>{if(old===undefined)delete process.env.PI_COC_REQUEST_BYTES;else process.env.PI_COC_REQUEST_BYTES=old;});
  const hooks=new Map(),bus=new Map(),rows=[],published=[],capsules=[];
  const host={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>{const list=bus.get(name)??[];list.push(handler);bus.set(name,list);},emit:(name,value)=>{for(const handler of bus.get(name)??[])handler(value);}},sendMessage(){}};
  api.installContextPolicy(host,row=>rows.push(row));
  const engine=api.createHybridEngine({decision:null,env:{PI_COC_JEV_PRESELECT:'0'}});engine.extension(host);
  host.events.on('coc:final-delivery',frame=>published.push(frame));
  host.events.on('coc:capsule',value=>capsules.push(value));
  const binding={version:1,campaign:'fixture',worldline:'main',loop:0,turn:6,source_revision:'a'.repeat(64)};
  const people=Array.from({length:5},(_,index)=>({name:'Person '+index,activity:{status:'idle'},personality:{trait:'PRIVATE_PROFILE_'+index},
    knowledge:['PRIVATE_KNOWLEDGE_'+index],cognition:[{statement:'PRIVATE_COGNITION_'+index}],
    ledger:{intents:[{action:'PRIVATE_INTENT_'+index,status:'planned'}]},profile:'x'.repeat(13600)}));
  const capsule={head:'Fixture state.',_context:binding,where:{scene:'office',clock:{minutes:0}},recent:['x'.repeat(50000)],warnings:['old-warning'],
    skills:{cards:[{name:'PRIVATE_SKILL_CARD'}]},delivery_recovery:[{text:'RECOVERY_PREFIX'}],
    present:people.map(({name,activity,personality})=>({name,activity,personality})),voices:[],turn:{number:6,player_text:'I inspect the office.'},
    mods:{instructions:[{mod:'fixture',version:'1',form:'full',instruction:'x'.repeat(70536)}]}};
  let current=structuredClone(capsule);
  delete current.skills;delete current.delivery_recovery;
  host.events.emit('coc:kernel-bridge',{campaign:'fixture',call:async(method,args)=>{
    if(method==='table.capsule')return current;
    if(method==='table.look')return people.find(person=>person.name===args.name);
    if(method==='table.untold')return {};
    return {cards:[],_snapshot:'fixture'};
  }});
  host.events.emit('coc:capsule',{campaign:'fixture',epoch:'accepted-input',context:binding,capsule,answering:['prior-choice']});
  const prepared=engine.runDriver.prepare({runId:'current-run',inputRevision:'input',rawInput:'I inspect the office.'});
  const first=await prepared.ports.projection.project({stepId:'first',signal:new AbortController().signal});
  const messages=[{role:'system',content:'x'.repeat(100845),timestamp:0},{role:'user',content:[{type:'text',text:'I inspect the office.'}],timestamp:0},
    custom('coc-capsule',capsule,{context:binding,epoch:'accepted-input'}),...first];
  const runner=new pi.ExtensionRunner([{path:'table-context',handlers:new Map([
    ['context',[hooks.get('context')]],['context_with_system',[hooks.get('context_with_system')]],['before_provider_request',[hooks.get('before_provider_request')]],
  ])}],pi.createExtensionRuntime(),root,{getBranch:()=>[],buildSessionProjection:()=>({messages})},{});
  runner.bindCore({}, {getModel:()=>({contextWindow:500000}),abort(){}});
  const errors=[];runner.onError(error=>errors.push(error));
  await runner.emitContext(messages);
  await hooks.get('tool_call')({toolName:'lookup',toolCallId:'source-in-flight',input:{kind:'source',query:'fixture'}});
  current={...structuredClone(capsule),where:{scene:'archive',clock:{minutes:8}}};
  delete current.skills;delete current.delivery_recovery;delete current.warnings;
  messages.push({role:'assistant',content:[{type:'toolCall',id:'latest-read',name:'look',arguments:{focus:'scene'}}],stopReason:'toolUse',timestamp:1},
    {role:'toolResult',toolCallId:'latest-read',toolName:'look',content:[{type:'text',text:'LATEST_TOOL_EVIDENCE '+'x'.repeat(55000)}],isError:false,timestamp:2});
  messages.push(...await prepared.ports.projection.project({stepId:'next',signal:new AbortController().signal}));
  assert.deepEqual(capsules.at(-1).capsule.skills,capsule.skills);
  assert.deepEqual(capsules.at(-1).capsule.delivery_recovery,capsule.delivery_recovery);
  current.mods.instructions[0].instruction+=' FRESH_SOURCE_DETAIL';
  await hooks.get('tool_result')({toolName:'lookup',toolCallId:'source-in-flight',input:{kind:'source'},details:{},content:[{type:'text',text:'The source read completed.'}],isError:false});
  const projected=await runner.emitContext(messages);
  const wire=pi.convertToLlm(projected),serialized=JSON.stringify(wire);
  assert.deepEqual(errors,[]);
  assert.ok(api.pairedTools(projected));
  assert.ok(projected.some(message=>message.role==='toolResult'&&message.toolCallId==='latest-read'),'latest result survives with its call');
  const clerks=projected.filter(message=>message.customType==='coc-clerk').map(message=>JSON.parse(message.content));
  assert.equal(clerks.length,1);
  assert.ok(!Object.hasOwn(clerks[0],'current_state'),'the clerk does not duplicate a full state');
  const updates=projected.filter(message=>message.customType==='coc-capsule-update').map(message=>JSON.parse(message.content));
  assert.equal(updates.at(-1).sections.where.clock.minutes,8);
  assert.equal(updates.at(-1).sections.where.scene,'archive');
  assert.deepEqual(updates.at(-1).removed,['warnings'],'canonical deletion still applies');
  assert.ok(serialized.includes('LATEST_TOOL_EVIDENCE'));
  assert.ok(serialized.includes('FRESH_SOURCE_DETAIL'),'same-input refresh preserves the in-flight source call accounting');
  assert.ok(serialized.includes('PRIVATE_SKILL_CARD'),'the actual read projection retains this input skill cards');
  assert.ok(serialized.includes('RECOVERY_PREFIX'),'the actual read projection retains this input delivery recovery');
  for(let index=0;index<5;index++)for(const prefix of ['PRIVATE_PROFILE_','PRIVATE_KNOWLEDGE_','PRIVATE_COGNITION_','PRIVATE_INTENT_'])assert.ok(serialized.includes(prefix+index));
  assert.ok(!clerks[0].people.some(person=>person.activity||person.personality),'exact same-person fields are supplied once');
  assert.ok(Buffer.byteLength(serialized)<=393216);
  assert.deepEqual(published,[],'Keeper-only preparation is not a public stream');
});

test('a stale Keeper read cannot replace the next accepted input capsule',async()=>{
  const bus=new Map(),emitted=[];
  const host={on(){},events:{on:(name,handler)=>{const list=bus.get(name)??[];list.push(handler);bus.set(name,list);},emit:(name,value)=>{emitted.push({name,value});for(const handler of bus.get(name)??[])handler(value);}}};
  const engine=api.createHybridEngine({decision:null,env:{PI_COC_JEV_PRESELECT:'0'}});engine.extension(host);
  let release;
  const old={_context:{campaign:'fixture',worldline:'main',loop:0,turn:1},present:[],where:{scene:'old-scene'},mods:{}};
  const next={...old,_context:{...old._context,turn:2},where:{scene:'next-scene'}};
  host.events.emit('coc:kernel-bridge',{campaign:'fixture',call:async()=>new Promise(resolve=>{release=resolve;})});
  host.events.emit('coc:capsule',{campaign:'fixture',epoch:'input-one',context:old._context,capsule:old});
  const prior=engine.runDriver.prepare({runId:'run-one',inputRevision:'one',rawInput:'First input.'});
  const pending=prior.ports.projection.project({stepId:'old-read',signal:new AbortController().signal});
  host.events.emit('coc:capsule',{campaign:'fixture',epoch:'input-two',context:next._context,capsule:next});
  engine.runDriver.prepare({runId:'run-two',inputRevision:'two',rawInput:'Second input.'});
  const count=emitted.filter(event=>event.name==='coc:capsule').length;
  release(old);await pending;
  assert.equal(emitted.filter(event=>event.name==='coc:capsule').length,count);
  assert.equal(emitted.filter(event=>event.name==='coc:capsule').at(-1).value.epoch,'input-two');
});

test('single-Keeper clerk pruning preserves foreign and non-host messages and leaves legacy behavior intact',()=>{
  const binding={version:1,campaign:'fixture',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
  const scoped={coc_host:true,campaign:'fixture',turn:1};
  const messages=[{role:'user',content:[{type:'text',text:'I ask.'}]},custom('coc-capsule',{turn:{number:1}},{context:binding}),
    custom('coc-clerk',{step:'old'},scoped),custom('coc-clerk',{step:'player'},{turn:1}),
    custom('coc-clerk',{step:'other-campaign'},{...scoped,campaign:'other'}),custom('coc-clerk',{step:'other-turn'},{...scoped,turn:2}),
    custom('coc-clerk',{step:'current'},scoped)];
  const input={messages,binding,history:{},budget:10000};
  const projected=api.projectedMessages({...input,singleKeeper:true});
  assert.deepEqual(projected.messages.filter(message=>message.customType==='coc-clerk').map(message=>JSON.parse(message.content).step),
    ['player','other-campaign','other-turn','current']);
  assert.equal(api.projectedMessages(input).messages.filter(message=>message.customType==='coc-clerk').length,5);
});
