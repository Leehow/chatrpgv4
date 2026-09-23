/** Read-only §126.2 check-preflight component seam; controlled decisions are not gameplay. */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {supportWire} from './support-agent-helpers.mjs';

const root=resolve(import.meta.dirname,'../..'),homes=[];await mkdir(join(root,'.tmp'),{recursive:true});
const bundle=await mkdtemp(join(root,'.tmp/check-preflight-api-'));homes.push(bundle);
await build({stdin:{contents:`export {prepareCheckPreflight} from './runtime/jev/check-preflight.ts';
export {createKernelContext} from './kernel-ts/context.ts';export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {installContextPolicy} from './extensions/table/context-runtime.ts';
export {validateKeeperSupport} from './runtime/jev/keeper-support-contract.ts';
export {convertToLlm} from './build/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';`,resolveDir:root,sourcefile:'check-preflight-api.ts'},outfile:join(bundle,'api.mjs'),
  bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
after(async()=>{for(const home of homes)await rm(home,{recursive:true,force:true});});

function decisionPort(seen){return{async decide(batch){
  seen.push(structuredClone(batch));const raw=Object.fromEntries(batch.questions.map(question=>{
    let choice;
    if(question.key==='route')choice='ordinary';else if(question.key==='consent')choice='authorized';else if(question.key==='actor')choice='actor_0';
    else if(question.key==='intent')choice='investigate';else if(question.key==='difficulty')choice='hard';else if(question.key==='bonus')choice='one';
    else if(question.key==='penalty')choice='none';else if(question.key==='profile')choice=Object.entries(question.criteria).find(([,value])=>value?.skill==='Spot Hidden')?.[0]??'unknown';
    return[question.key,{status:'answered',type:'choice',choice,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===choice?1:0]))}];
  }));return bindDecisionAnswers(batch,raw,{inputTokens:1,outputTokens:1,costUsd:0});
}};}

test('real resolve options prepare one advisory ordinary check without settling it',async t=>{
  const home=await mkdtemp(join(root,'.tmp/check-preflight-'));homes.push(home);
  const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'check-preflight',locks:api.nativeAdvisoryLocks(),
    env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
  t.after(()=>runtime.close());const calls=[];
  const call=(method,params={})=>{calls.push({method,params:structuredClone(params)});return runtime.handlers[method]({campaign:'check-preflight',...params});};
  await call('campaign.create',{id:'check-preflight',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
  const input='I carefully search the office desk for a hidden note.';await call('table.player_input',{text:input});
  const before=await call('table.status'),scope={owner:'check-preflight',campaign:'check-preflight',worldline:'main',loop:0,audience:'keeper'},
    readSet=[{kind:'world',resource:'check-preflight',revision:'world-r1'}],lease=new TaskLease({owner:'check-preflight',goal:input,scope,
      capabilities:['decision'],readSet,budget:{deadlineAt:Date.now()+10_000,remainingInputTokens:100_000,remainingOutputTokens:10_000,remainingCostUsd:1,remainingActions:2}}),seen=[];
  t.after(()=>lease.close());
  const prepared=await api.prepareCheckPreflight({campaign:'check-preflight',turn:1,rawInput:input,goal:'Search the desk for a hidden note.',scope,readSet,
    call,decision:decisionPort(seen),lease});
  assert.equal(prepared.advice.disposition,'ordinary');assert.deepEqual(prepared.advice.action,{actor:'托马斯·海斯',intent:'investigate',
    goal:'Search the desk for a hidden note.',method:input,skill:'Spot Hidden',decision:'core-check:ordinary-check',
    modifiers:{difficulty:'hard',bonus_dice:1,penalty_dice:0,reason:input}});
  assert.equal(seen.length,2);assert.deepEqual(seen.map(batch=>batch.questions.map(question=>question.key)),[
    ['route','consent','actor','intent','difficulty','bonus','penalty'],['profile']]);
  assert.equal(calls.filter(row=>row.method==='table.resolve.options').length,1);assert.equal(calls.some(row=>row.method==='table.resolve'),false);
  assert.deepEqual(await call('table.status'),before,'advice preparation has no receipts or turn mutation');
  assert.equal((await prepared.check()).status,'current');assert.equal(calls.filter(row=>row.method==='table.resolve.options').length,2);

  const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
  process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='mechanical-test-key';
  t.after(()=>{globalThis.fetch=oldFetch;for(const [key,value] of [['PI_COC_JEV_PRESELECT',oldFlag],['TYPESAFE_API_KEY',oldKey]])
    if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const decisions=[],hooks=new Map(),bus=new Map(),events=[];
  globalThis.fetch=async(_url,request)=>{const sent=JSON.parse(request.body);decisions.push(sent);
    return Response.json(supportWire(sent,candidate=>candidate.kind==='investigator'?'necessary':'skip',
      {check:'ordinary',difficulty:'hard',bonus:'one',skill:'Spot Hidden'}));};
  api.installContextPolicy({on:(name,fn)=>hooks.set(name,fn),events:{on:(name,fn)=>bus.set(name,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
  t.after(()=>hooks.get('session_shutdown')());
  const {_context:binding,...capsule}=await call('table.capsule',{rehydrate:true});
  capsule.mods={instructions:[{mod:'keeper-context',settings:{mode:'on',workpad_enabled:false}}]};
  const start=calls.length;
  bus.get('coc:kernel-bridge')({campaign:'check-preflight',call});bus.get('coc:capsule')({capsule,context:binding,epoch:'support-preload'});
  const projected=await hooks.get('context')({messages:[{role:'user',content:input}],type:'context'},
    {model:{contextWindow:1_000_000},getSystemPrompt:()=>''});
  const message=projected.messages.find(row=>row.customType==='coc-prescreen');assert(message,JSON.stringify(events));
  const support=api.validateKeeperSupport(JSON.parse(message.content));
  assert.equal(support.schema_version,1);assert.equal(support.kind,'keeper_support');assert.equal(support.request,input);
  assert(support.parameters.people.length);assert.equal(support.check.disposition,'ordinary');
  assert.equal(support.check.action.skill,'Spot Hidden');assert.equal(support.check.action.modifiers.difficulty,'hard');
  assert.equal(support.check.action.modifiers.bonus_dice,1);assert.equal(support.check.authorization,'advisory_only');assert.equal(support.check.settled,false);
  assert(decisions.find(row=>row.state.operations)?.questions.operation,'retrieval starts with an operation decision');
  assert(!decisions.some(row=>Object.keys(row.questions).some(key=>key.startsWith('candidate_'))));
  assert(!projected.messages.some(row=>row.customType==='coc-workspace'));
  assert(calls.slice(start).filter(row=>row.method==='table.workspace.read').every(row=>row.params.preselect?.version===2));
  assert(!calls.slice(start).some(row=>['table.resolve','table.apply'].includes(row.method)));
  const payload={input:api.convertToLlm(projected.messages)};
  assert(JSON.stringify(payload).includes(JSON.stringify(message.content).slice(1,-1)));
  await hooks.get('before_provider_request')({payload,type:'before_provider_request'},{});
  assert.equal(events.findLast(row=>row.lane==='prescreen'&&row.event==='delivered')?.delivered,true);
  assert.deepEqual(await call('table.status'),before,'preload advice creates no receipts or world mutation');
});
