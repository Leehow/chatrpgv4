import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {boundProviderRequest,createTaskProviderBudget,providerSpend,independentProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {runReader} from '../../extensions/module/reader.ts';
import {composeRuntimeContext} from '../../runtime/host.ts';
import {runLane} from '../../extensions/lanes/subsession.ts';
const ROOT=resolve(import.meta.dirname,'../..');
const model={provider:'test',id:'bounded',api:'openai-responses',maxTokens:100,contextWindow:10000,cost:{input:1,output:2,cacheRead:0.5,cacheWrite:1,tiers:[{input:3,output:4,cacheRead:1,cacheWrite:5}]}};
const usage={input:10,output:5,cacheRead:2,cacheWrite:3,cost:{total:0.00004}};
const lease=(overrides={})=>new TaskLease({owner:'test-root',goal:'Account actual nested calls',scope:{owner:'test',audience:'keeper'},readSet:[],capabilities:[],budget:{deadlineAt:Date.now()+10000,remainingInputTokens:20000,remainingOutputTokens:1000,remainingCostUsd:1,remainingActions:10,...overrides}});
const bound=()=>boundProviderRequest(model,{model:model.id,input:'hello'});

test('closed API output caps and worst price tiers bind the actual request',()=>{
 const prepared=bound();assert.equal(prepared.payload.max_output_tokens,100);assert.equal(providerSpend(prepared.bound).costUsd,(prepared.bound.inputTokens*5+100*4)/1e6);
 for(const [api,payload,path] of [['openai-completions',{},['max_tokens']],['anthropic-messages',{},['max_tokens']],['pi-messages',{},['options','maxTokens']],['google-generative-ai',{},['config','maxOutputTokens']],['google-vertex',{},['config','maxOutputTokens']],['bedrock-converse-stream',{},['inferenceConfig','maxTokens']]]){
  const p=boundProviderRequest({...model,api},payload,20);assert.equal(path.reduce((v,k)=>v[k],p.payload),20);
 }
 assert.throws(()=>boundProviderRequest({...model,api:'unknown'},{}),/provider_output_bound_unsupported/);
 assert.throws(()=>boundProviderRequest({...model,cost:undefined},{}),/provider_bound_unavailable/);
 const image=boundProviderRequest(model,{input:[{type:'input_image',image_url:'data:image/png;base64,small'}]});assert.equal(image.bound.inputTokens,model.contextWindow);
});

test('actual usage, unknown usage and child reservations debit the same ancestors',async()=>{
 const root=lease(), child=root.child({owner:'operation',goal:'One operation',capabilities:[],budget:root.context.budget});
 const events=[],budget=createTaskProviderBudget(child,{record:e=>events.push(e)}), before=root.context.budget;
 const first=await budget.reserve(bound().bound);first.settle(usage);
 assert.equal(root.context.budget.remainingInputTokens,before.remainingInputTokens-15);
 assert.equal(child.context.budget.remainingInputTokens,root.context.budget.remainingInputTokens);
 const second=await budget.reserve(bound().bound);second.settle();
 assert.equal(root.context.budget.remainingInputTokens,before.remainingInputTokens-15-bound().bound.inputTokens);
 assert.equal(events.at(-1).known,false);assert.equal(events[0].rootId,root.context.id);root.close();
});

test('provider grants wait for durable reservations and reject storage failure or intervening cancellation',async()=>{
 for(const outcome of ['saved','failed','cancelled']) {
  const root=lease(),before=root.context.budget,entered=Promise.withResolvers(),gate=Promise.withResolvers();
  const budget=createTaskProviderBudget(root,{changed:async()=>{entered.resolve();await gate.promise;}});
  let dispatched=0;const request=budget.reserve(bound().bound).then(charge=>{dispatched++;return charge;});
  await entered.promise;assert.equal(dispatched,0,'No caller can dispatch while its reservation is not durable');
  if(outcome==='saved'){gate.resolve();const charge=await request;assert.equal(dispatched,1);charge.settle();}
  else {
   const refused=assert.rejects(request,outcome==='failed'?/storage unavailable/:/task_cancelled/);
   if(outcome==='failed')gate.reject(new Error('storage unavailable'));
   else {root.cancel();gate.resolve();}
   await refused;assert.equal(dispatched,0);assert.equal(root.context.budget.remainingActions,before.remainingActions);
  }
  root.close();
 }
});

test('queued cancellation never steals a refunded reservation and exhaustion rejects before dispatch',async()=>{
 const root=lease({remainingActions:1}),budget=createTaskProviderBudget(root),first=await budget.reserve(bound().bound);
 const abort=new AbortController(),pending=budget.reserve(bound().bound,abort.signal);abort.abort();
 await assert.rejects(pending);first.release();assert.equal(root.context.budget.remainingActions,1);
 const spent=await budget.reserve(bound().bound);spent.settle(usage);
 await assert.rejects(budget.reserve(bound().bound),/task_budget_exhausted/);root.close();
});

test('queue resumes on actual refund while the absolute parent deadline is unchanged',async()=>{
 const root=lease({remainingInputTokens:bound().bound.inputTokens}),budget=createTaskProviderBudget(root),deadline=root.context.budget.deadlineAt;
 const first=await budget.reserve(bound().bound);let granted=false;
 const queued=budget.reserve(bound().bound).then(value=>{granted=true;return value;});await Promise.resolve();assert.equal(granted,false);
 first.release();const second=await queued;assert.equal(root.context.budget.deadlineAt,deadline);second.release();root.close();
});

test('actual overrun retains debt and cancels root; independent work survives another root closing',async()=>{
 const root=lease(),budget=createTaskProviderBudget(root),charge=await budget.reserve(bound().bound);
 assert.throws(()=>charge.settle({...usage,output:101}),/task_budget_overrun/);assert.equal(root.signal.aborted,true);
 const separate=independentProviderBudget('background');assert.equal(separate.budget.signal.aborted,false);
 const next=await separate.budget.reserve(bound().bound);next.settle(usage);separate.close();
});

test('lane reserves in the real completion onPayload seam and exposes actual usage',async()=>{
 const root=lease(),before=root.context.budget,events=[];let dispatched=0;
 const result=await runLane({ctx:{model,modelRegistry:{complete:async(_m,_c,options)=>{
   const body=await options.onPayload({model:model.id,input:'hello'});assert.equal(body.max_output_tokens,100);assert.equal(options.maxRetries,0);
   assert.equal(root.context.budget.remainingActions,before.remainingActions-1);dispatched++;
   return {stopReason:'stop',content:[{type:'text',text:'{"okay":true}'}],usage};
 }},sessionManager:{getSessionId:()=>undefined}},providerBudget:createTaskProviderBudget(root,{record:e=>events.push(e)}),envName:'T15_UNUSED_MODEL',lane:'test',systemPrompt:'Return JSON',input:'test',shape:x=>x});
 assert.equal(result.ok,true);assert.equal(dispatched,1);assert.equal(result.usage.inputTokens,15);assert.equal(events.at(-1).known,true);root.close();
});

test('timed out completion that ignores abort retains an unknown charge without a refundable hold',async()=>{
 const root=lease({remainingActions:1}),budget=createTaskProviderBudget(root);
 const keepAlive=setInterval(()=>{},1000);
 const result=await runLane({ctx:{model,modelRegistry:{complete:async(_m,_c,options)=>{
  await options.onPayload({model:model.id,input:'hello'});return await new Promise(()=>{});
 }},sessionManager:{getSessionId:()=>undefined}},providerBudget:budget,timeoutMs:20,envName:'T15_UNUSED_MODEL',lane:'test',systemPrompt:'Return JSON',input:'test',shape:x=>x});
 clearInterval(keepAlive);assert.equal(result.ok,false);assert.equal(result.reason,'timeout');
 await assert.rejects(budget.reserve(bound().bound),/task_budget_exhausted/);root.close();
});

async function fixture(t,mode){
 const home=await mkdtemp(join(tmpdir(),'jev-provider-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const cli=join(home,'pi-fixture.mjs'),marker=join(home,'dispatched');
 await writeFile(cli,`import {writeFileSync} from 'node:fs';\nimport readerContext from ${JSON.stringify(join(ROOT,'extensions/module/reader-context.ts'))};
 import {ExtensionRunner,createExtensionRuntime} from ${JSON.stringify(join(ROOT,'node_modules/@earendil-works/pi-coding-agent/dist/index.js'))};
 const handlers=new Map();readerContext({on:(name,fn)=>{const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);}}, {env:process.env});
 const ctx={model:${JSON.stringify(model)},abort(){}};
 const runner=new ExtensionRunner([{path:"budget-conformance",handlers}],createExtensionRuntime(),process.cwd(),{},{});
 runner.bindCore({}, {getModel:()=>ctx.model,abort:()=>ctx.abort()});
 let calls=0;for(let n=0;n<${mode==='two'?2:1};n++){
  let payload={model:ctx.model.id,input:'hello'};
  payload=await runner.emitBeforeProviderRequest(payload);
  if(payload.max_output_tokens!==100)throw Error('output is not capped');
  writeFileSync(${JSON.stringify(marker)},String(++calls));
  if(${JSON.stringify(mode)}==='crash')process.exit(1);
  const message={role:'assistant',stopReason:'stop',usage:${JSON.stringify(usage)}};
  await runner.emitMessageEnd({type:'message_end',message});
  console.log(JSON.stringify({type:'message_end',message}));
 }
 process.disconnect();`);
 const base=composeRuntimeContext({owner:'preparation',home},{resourceRoot:ROOT,env:{...process.env,PI_COC_HOME:home}});
 return {home,marker,context:{...base,entrypoints:{...base.entrypoints,pi:cli}}};
}

test('real child IPC gates two calls before dispatch and aggregates actual usage',async t=>{
 const f=await fixture(t,'two'),root=lease();t.after(()=>root.close());
 const outcome=await runReader({cwd:f.home,brief:'Conformance only',model:'test/bounded',providerBudget:createTaskProviderBudget(root),timeoutMs:5000},f.context);
 assert.equal(outcome.ok,true,JSON.stringify(outcome));assert.equal(await readFile(f.marker,'utf8'),'2');
 assert.deepEqual(outcome.usage,{inputTokens:30,outputTokens:10,costUsd:0.00008,actions:2,unknownCalls:0});assert.equal(root.context.budget.remainingActions,8);
 const settings=JSON.parse(await readFile(join(f.home,'.pi/settings.json'),'utf8'));assert.equal(settings.retry.provider.maxRetries,0);
});

test('child IPC cannot dispatch when reservation persistence fails',async t=>{
 const f=await fixture(t,'one'),root=lease();t.after(()=>root.close());
 const outcome=await runReader({cwd:f.home,brief:'Persistence conformance only',model:'test/bounded',
  providerBudget:createTaskProviderBudget(root,{changed:async()=>{throw new Error('storage unavailable');}}),timeoutMs:5000},f.context);
 assert.equal(outcome.ok,false);await assert.rejects(readFile(f.marker,'utf8'),{code:'ENOENT'});
 assert.equal(root.context.budget.remainingActions,10,'An undispatched request does not consume actual usage');
});

test('exhausted child is killed without dispatch even when extension errors would be swallowed',async t=>{
 const f=await fixture(t,'one'),root=lease({remainingActions:0});t.after(()=>root.close());
 const outcome=await runReader({cwd:f.home,brief:'Conformance only',model:'test/bounded',providerBudget:createTaskProviderBudget(root),timeoutMs:5000},f.context);
 assert.equal(outcome.ok,false);await assert.rejects(readFile(f.marker,'utf8'),{code:'ENOENT'});assert.equal(root.context.budget.remainingActions,0);
});

test('child crash without usage retains granted reservation; budgeted override cannot bypass handshake',async t=>{
 const f=await fixture(t,'crash'),root=lease();t.after(()=>root.close());
 const outcome=await runReader({cwd:f.home,brief:'Conformance only',model:'test/bounded',providerBudget:createTaskProviderBudget(root),timeoutMs:5000},f.context);
 assert.equal(outcome.ok,false);assert.equal(outcome.usage.unknownCalls,1);assert.equal(root.context.budget.remainingActions,9);
 const denied=await runReader({cwd:f.home,brief:'No bypass',providerBudget:createTaskProviderBudget(root)},{...f.context,env:{...f.context.env,PI_COC_READER_CMD:JSON.stringify([process.execPath,'-e','process.exit(0)'])}});
 assert.equal(denied.ok,false);assert.match(denied.error,/private provider handshake/);
});
