/** Writer accounting and lifecycle conformance. No provider calls, live play, or kernel fixture. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {ContractError} from '../../runtime/jev/contracts.ts';
import {boundedPlanPresentation,reserveWriterBudget,PLAN_RESULT_BYTES} from '../../runtime/jev/writer-budget.ts';
import {createTaskHostAdapter} from '../../runtime/jev/task-host-session.ts';
import {createCanonicalOperationDispatcher} from '../../extensions/kernel/canonical-operation-dispatcher.ts';
const model={provider:'contract',id:'keeper',api:'openai-responses',maxTokens:8192,contextWindow:1000000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
const scope={owner:'session:writer-contract',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
const budget=(input=250000)=>({deadlineAt:Date.now()+60000,remainingInputTokens:input,remainingOutputTokens:100000,remainingCostUsd:10,remainingActions:100});
const lease=(input=250000)=>new TaskLease({owner:'keeper',goal:'Answer this turn',scope,capabilities:['look'],readSet:[],budget:budget(input)});
const spend=inputTokens=>({inputTokens,outputTokens:0,costUsd:0,actions:0});
const error=code=>value=>value?.code===code;
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test('writer escrow cannot fund a dependent queued request, including through a child lease',async()=>{
 const root=lease(),held=reserveWriterBudget(root,model,100,50),child=root.child({owner:'reader',goal:'Read',capabilities:['look'],budget:budget()});
 try {
  let outcome='waiting';const request=root.reserveQueued(spend(root.context.budget.remainingInputTokens+1)).then(()=>outcome='granted',reason=>outcome=reason.code);
  await flush();assert.equal(outcome,'task_budget_exhausted','A dependent call cannot wait for its future writer to finish');await request;
  await assert.rejects(child.reserveQueued(spend(root.context.budget.remainingInputTokens+1)),error('task_budget_exhausted'));
  const left=root.context.budget.remainingInputTokens,work=root.reserve(spend(left));work.settle();
  assert.equal(root.context.budget.remainingInputTokens,0);held.reservation.release();assert.equal(root.context.budget.remainingInputTokens,held.spend.inputTokens);
 }finally{root.close();child.close();}
});
test('exact writer funding transfers to actual payload charge and closed escrow release refunds once',()=>{
 const probe=lease(),estimate=reserveWriterBudget(probe,model,100,50).spend;probe.close();
 const root=lease(estimate.inputTokens),held=reserveWriterBudget(root,model,100,50);
 assert.equal(root.context.budget.remainingInputTokens,0);held.reservation.release();
 const actualBytes=estimate.inputTokens-100;const actual=root.reserve({...spend(actualBytes),outputTokens:100,actions:1});
 assert.equal(root.context.budget.remainingInputTokens,100);actual.settle({inputTokens:actualBytes,outputTokens:80,costUsd:0,actions:1});
 assert.throws(()=>root.reserve(spend(101)),error('task_budget_exhausted'));root.close();
 const closed=lease(),baseline=closed.context.budget.remainingInputTokens,escrow=reserveWriterBudget(closed,model,10,10);closed.close();escrow.reservation.release();
 assert.equal(closed.context.budget.remainingInputTokens,baseline);assert.throws(()=>escrow.reservation.release(),error('reservation_already_settled'));
});
test('oversized plan presentation keeps real status, handed verbs and explicit omitted coverage',()=>{
 for(const status of ['complete','partial','failed','pending','needs_player','unresolved']) {
  const original={status,remainingNeeds:['The actual missing condition.'],coverage:{used:['source'],omitted:['Unseen page'],unknown:['Unverified condition']},
   observations:[{operation:'lookup',status:'succeeded',data:'x'.repeat(100000)},{operation:'apply',status:'refused',data:{reason:'actual refusal'}}],replan:true,handoff:{verbs:['apply'],instruction:'Use the actual owner.'}};
  const result=boundedPlanPresentation(original);
  assert.ok(bytes(result)<=PLAN_RESULT_BYTES);assert.equal(result.status,status==='complete'?'partial':status);assert.deepEqual(result.handoff,original.handoff);assert.equal(result.replan,true);
  assert.ok(result.coverage.omitted.length);assert.ok(result.coverage.unknown.includes('Unverified condition'));assert.equal(original.observations.length,2);assert.equal(result.observations[0].status,'refused');
 }
 const huge={status:'needs_player',remainingNeeds:['x'.repeat(100000)],coverage:{used:[],omitted:[],unknown:['y'.repeat(100000)]},observations:[],handoff:{verbs:['resolve']}};
 const bounded=boundedPlanPresentation(huge);assert.ok(bytes(bounded)<=PLAN_RESULT_BYTES);assert.equal(bounded.status,'needs_player');assert.deepEqual(bounded.handoff.verbs,['resolve']);assert.ok(bounded.coverage.omitted.length);assert.ok(bounded.coverage.unknown.length);
});
test('a bound nested dispatcher port enforces child limits and never borrows its foreground parent',async()=>{
 const root=lease(),child=root.child({owner:'source',goal:'Read',capabilities:['look'],budget:{...budget(10),remainingOutputTokens:10}}),dispatcher=createCanonicalOperationDispatcher();
 const proposal={id:'nested-read',taskId:child.context.id,operation:'look',capability:'look',args:{focus:'scene'},scope,readSet:[],basis:[]};
 const release=await dispatcher.bindReadScope('nested-read',proposal,{task:child,journal:{load:async()=>undefined,save:async()=>{}},validateCurrent:async()=>{},recover:async()=>({status:'absent',activeTurn:1}),trace:()=>{}});
 try {
  const port=dispatcher.providerBudget('nested-read');assert.equal(port.signal,child.signal);
  await assert.rejects(port.reserve({model,inputTokens:11,outputTokens:1}),error('task_budget_exhausted'));
  const before=root.context.budget.remainingInputTokens,charge=await port.reserve({model,inputTokens:5,outputTokens:1});charge.settle();assert.equal(root.context.budget.remainingInputTokens,before-5);
  child.close();await assert.rejects(port.reserve({model,inputTokens:1,outputTokens:1}),error('task_closed'));assert.equal(root.signal.aborted,false);
  assert.equal(dispatcher.providerBudget('nested-read'),port);
 }finally{release();root.close();child.close();}
});

async function host(t){
 const hooks=new Map(),listeners=new Map(),tools=new Map(),events=new Map(),traces=[],records=new Map();let active=[],aborts=0;
 const session={sessionId:'writer-contract',model,messages:[],isStreaming:false,abort:async()=>{aborts++;}};
 const pi={on:(name,handler)=>{hooks.set(name,handler);},events:{on:(name,handler)=>{const list=listeners.get(name)??[];list.push(handler);listeners.set(name,list);},emit:(name,value)=>{events.set(name,value);for(const handler of listeners.get(name)??[])handler(value);}},
  registerTool:tool=>tools.set(tool.name,tool),getActiveTools:()=>active,setActiveTools:value=>{active=value;},appendEntry:(_type,value)=>traces.push(value)};
 const adapter=createTaskHostAdapter(()=>session,{decide:async()=>{throw new ContractError('task_budget_exhausted');}},{store:{load:async id=>structuredClone(records.get(id)),save:async value=>{records.set(value.checkpoint.context.id,structuredClone(value));}}});
 adapter.extension(pi);const context={campaign:'c1',turn:1,worldline:'main',loop:0,source_revision:'s1',world_revision:'w1'};
 pi.events.emit('coc:kernel-bridge',{campaign:'c1',runtime:{home:'/tmp',signal:new AbortController().signal},call:async()=>({_context:context})});
 pi.events.emit('coc:operation-dispatcher',{dispatch:async()=>{throw new Error('This fixture must not execute a kernel operation');}});
 pi.events.emit('coc:capsule',{campaign:'c1',turn:1,epoch:'epoch',capsule:{},context});
 const ctx={abort:()=>{aborts++;}};await hooks.get('session_start')({},ctx);await hooks.get('input')({text:'Answer this one question.',source:'rpc'},ctx);
 await hooks.get('before_agent_start')({prompt:'Answer this one question.',systemPrompt:'Contract fixture.'},ctx);
 const invoke=async(name,event)=>{if(name==='message_end')session.messages.push(event.message);return hooks.get(name)(event,ctx);};
 const assistant=input=>({role:'assistant',provider:model.provider,model:model.id,content:[{type:'text',text:'A bounded writer response.'}],stopReason:'stop',usage:{input,output:10,cacheRead:0,cacheWrite:0,cost:{total:0}}});
 t.after(async()=>{await hooks.get('session_shutdown')({},ctx);});
 return {adapter,invoke,pi,tools,events,traces,assistant,aborts:()=>aborts,status:()=>adapter.status().task,port:()=>events.get('coc:task-provider-budget')()};
}
async function fundedWriter(t){
 const f=await host(t),first={messages:[{role:'user',content:'Question'}],max_output_tokens:8192};
 await f.invoke('before_provider_request',{payload:first});await f.invoke('message_end',{message:f.assistant(bytes(first))});
 const held=await f.invoke('tool_call',{toolCallId:'plan',toolName:'submit_plan_packet',input:{}});assert.equal(held,undefined);
 const remaining=f.status().checkpoint.context.budget.remainingInputTokens,charge=await f.port().reserve({model,inputTokens:remaining,outputTokens:1});charge.settle();await flush();
 return f;
}
test('host charges the actual next writer payload and catches a delta beyond protected funds',async t=>{
 const f=await fundedWriter(t),held=f.traces.findLast(value=>value.kind==='writer-budget-held').reserved;
 const next={messages:[{role:'tool',content:'x'.repeat(30000)}],max_output_tokens:8192};await f.invoke('before_provider_request',{payload:next});
 assert.equal(f.status().checkpoint.context.budget.remainingInputTokens,held.inputTokens-bytes(next));
 await f.invoke('message_end',{message:f.assistant(bytes(next))});
 const other=await fundedWriter(t),otherHeld=other.traces.findLast(value=>value.kind==='writer-budget-held').reserved;
 await assert.rejects(other.invoke('before_provider_request',{payload:{messages:[{role:'tool',content:'x'.repeat(otherHeld.inputTokens+1)}],max_output_tokens:8192}}),error('task_budget_exhausted'));
 assert.equal(other.aborts(),1);assert.equal(other.status().checkpoint.context.budget.remainingInputTokens,0,'Failed request has no new reservation; persisted state is the last accepted checkpoint');
});
async function limitedDelivery(t){
 const f=await fundedWriter(t),plan={goal:'Answer this question.',subgoals:[],constraints:[],evidenceRequired:[],completion:['Give a supported answer or explicit limit.'],capabilities:['look'],replanWhen:[],returnWhen:[]};
 const packet=await f.tools.get('submit_plan_packet').execute('plan',plan,new AbortController().signal);assert.equal(packet.details.status,'failed');assert.ok(packet.details.remainingNeeds.includes('task_budget_exhausted'));
 const next={messages:[{role:'tool',content:'x'.repeat(30000)}],max_output_tokens:8192};await f.invoke('before_provider_request',{payload:next});await f.invoke('message_end',{message:f.assistant(bytes(next))});
 return f;
}
for(const tool of ['narrate','ask'])test(`a budget-limited task can still commit its already-funded ${tool} delivery`,async t=>{
 const f=await limitedDelivery(t),before=f.status().checkpoint.context.budget.remainingInputTokens;
 const delivery=await f.invoke('tool_call',{toolCallId:'delivery',toolName:tool,input:{text:'The checked material does not settle that question.'}});
 assert.equal(delivery,undefined,'The already-generated terminal delivery must not require a second future-writer escrow');
 const guard=f.events.get('coc:task-delivery-guard');await guard(undefined,'auditing');
 const audit=await f.port().reserve({model,inputTokens:100,outputTokens:20});audit.settle({input:80,output:10,cacheRead:0,cacheWrite:0,cost:{total:0}});await flush();
 assert.equal(f.status().checkpoint.context.budget.remainingInputTokens,before-80,'Delivery review is still charged to the original task');
 await guard(undefined,'committing');
 if(tool==='narrate'){f.pi.events.emit('coc:turn-committed',{campaign:'c1',turn:1,commit:'actual-contract-commit'});await flush();}
 else await f.invoke('tool_result',{toolCallId:'delivery',toolName:tool,details:{pending_choice:{name:'The missing choice'}},isError:false});
 assert.equal(f.status().status,'closed');assert.equal(f.status().phase,'terminal');
 assert.equal(f.status().result.status,'failed','Delivering an honest limit does not upgrade the failed evidence task');
 assert.equal(f.traces.filter(value=>value.kind==='writer-budget-held').length,1);
});
test('review refusal can fund a real corrective writer but never renews its budget or deadline',async t=>{
 const f=await limitedDelivery(t),before=f.status().checkpoint.context.budget;
 await f.invoke('tool_call',{toolCallId:'refused',toolName:'narrate',input:{text:'A draft needing correction.'}});
 const guard=f.events.get('coc:task-delivery-guard');await guard(undefined,'auditing');
 const audit=await f.port().reserve({model,inputTokens:100,outputTokens:10});audit.settle();
 await f.invoke('tool_result',{toolCallId:'refused',toolName:'narrate',isError:true,details:{coc_error:{code:'needs'}}});
 assert.equal(f.status().status,'ready');assert.equal(f.status().phase,'auditing');
 const correction={messages:[{role:'tool',content:'Correct the unsupported claim.'}],max_output_tokens:8192};
 await f.invoke('before_provider_request',{payload:correction});await f.invoke('message_end',{message:f.assistant(bytes(correction))});
 assert.equal(f.status().checkpoint.context.budget.remainingInputTokens,before.remainingInputTokens-100-bytes(correction));
 assert.equal(f.status().checkpoint.context.budget.deadlineAt,before.deadlineAt);
 assert.equal(await f.invoke('tool_call',{toolCallId:'corrected',toolName:'narrate',input:{text:'A supported correction.'}}),undefined);
 await guard(undefined,'auditing');await guard(undefined,'committing');
 f.pi.events.emit('coc:turn-committed',{campaign:'c1',turn:1,commit:'corrected-contract-commit'});await flush();
 assert.equal(f.status().status,'closed');assert.equal(f.aborts(),0);
});
test('exhausted delivery review and corrective writer refuse without exempt accounting or false completion',async t=>{
 const f=await limitedDelivery(t);await f.invoke('tool_call',{toolCallId:'delivery',toolName:'ask',input:{text:'A reviewed choice.'}});
 await f.events.get('coc:task-delivery-guard')(undefined,'auditing');
 const remaining=f.status().checkpoint.context.budget.remainingInputTokens;
 const audit=await f.port().reserve({model,inputTokens:remaining,outputTokens:1});audit.settle();await flush();
 await assert.rejects(f.port().reserve({model,inputTokens:1,outputTokens:1}),error('task_budget_exhausted'));
 await f.invoke('tool_result',{toolCallId:'delivery',toolName:'ask',isError:true,details:{coc_error:{code:'needs'}}});
 await assert.rejects(f.invoke('before_provider_request',{payload:{messages:[],max_output_tokens:1}}),error('task_budget_exhausted'));
 assert.equal(f.aborts(),1);assert.equal(f.status().status,'ready');assert.equal(f.status().phase,'auditing');
 assert.equal(f.traces.filter(value=>value.kind==='keeper-reservation').length,2,'No correction request was funded');
});
test('cancellation releases only unused escrow and blocks late delivery and nested requests',async t=>{
 const f=await fundedWriter(t),held=f.traces.findLast(value=>value.kind==='writer-budget-held').reserved;
 await f.invoke('model_select',{});await flush();
 assert.equal(f.status().status,'closed');assert.equal(f.status().result.status,'cancelled');
 assert.equal(f.status().checkpoint.context.budget.remainingInputTokens,held.inputTokens,'Consumed dependent work is not refunded');
 const result=await f.invoke('tool_call',{toolCallId:'late',toolName:'narrate',input:{text:'Late delivery.'}});
 assert.equal(result.block,true);assert.equal(result.terminate,true);
 await assert.rejects(f.events.get('coc:task-delivery-guard')(undefined,'committing'));
 await assert.rejects(f.port().reserve({model,inputTokens:1,outputTokens:1}));
});
test('closing a delivered task releases its held writer reservation before the lease is sealed',async t=>{
 const f=await host(t),first={messages:[{role:'user',content:'Question'}],max_output_tokens:8192};await f.invoke('before_provider_request',{payload:first});await f.invoke('message_end',{message:f.assistant(bytes(first))});
 const baseline=f.status().checkpoint.context.budget.remainingInputTokens;await f.invoke('tool_call',{toolCallId:'plan',toolName:'submit_plan_packet',input:{}});
 const guard=f.events.get('coc:task-delivery-guard');await guard(undefined,'auditing');await guard(undefined,'committing');
 await f.invoke('tool_result',{toolCallId:'delivery',toolName:'ask',details:{pending_choice:{name:'The missing choice'}},isError:false});
 assert.equal(f.status().status,'closed');assert.equal(f.status().checkpoint.context.budget.remainingInputTokens,baseline);
 await assert.rejects(f.port().reserve({model,inputTokens:1,outputTokens:1}),error('task_closed'));
});
