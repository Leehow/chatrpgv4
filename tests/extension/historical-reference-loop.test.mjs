import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {EXA_ENV,HISTORY_NEED,HISTORY_CLOSED,historyFinalAnswerPayload} from '../../runtime/historical-reference.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';

test('selected background preparation reaches the native tool channel once, then releases normal narration',async()=>{
  const f=await table({narrator:false});
  const tools=[{type:'function',name:'lookup'},{type:'function',name:'narrate'}],payload={input:[],tools};
  const prepare=f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}});
  assert.deepEqual(prepare?.tool_choice,{type:'function',name:'lookup'},'a selected read cannot silently become prose-only');
  assert.equal(prepare.tools,tools,'the declared tools stay stable');
  await f.call('historical_reference',{}, {kind:'historical_reference',status:'ready',materials:[{excerpts:['Period document practice.']}]});
  await f.project('world');
  assert.equal(f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined,'the completed read releases ordinary gameplay and narration');
});
test('a selected preparation cannot execute a different read, and a refused attempt does not rearm it',async()=>{
  const f=await table({narrator:false}),payload={input:[],tools:[{type:'function',name:'lookup'}]};
  f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}});
  const wrong=await f.call('module');
  assert.equal(wrong.refuse_code,'historical_preparation','only the selected historical read is admitted in this preparation step');
  await f.project('world');
  assert.equal(f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined);
});
test('immediate interruption suppresses preparation without changing the read-value threshold',async()=>{
  const f=await table({narrator:false,urgent:true});
  const payload={input:[],tools:[{type:'function',name:'lookup'}]};
  assert.equal(f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined);
});
test('disabled, declined, unavailable and unsupported preparation never leave a native tool constraint behind',async()=>{
  const payload={input:[],tools:[{type:'function',name:'lookup'}]};
  for(const options of [{enabled:false},{needed:false}]){
    const f=await table(options);
    assert.equal(f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined);
  }
  const f=await table({narrator:false});
  f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}});
  await f.call('historical_reference',{}, {kind:'historical_reference',status:'unavailable',reason:'unconfigured',materials:[]});
  await f.project('world');
  assert.equal(f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined);
  const unsupported=await table({narrator:false});
  assert.equal(unsupported.handlers.get('before_provider_request')({payload},{model:{api:'unsupported'}}),undefined);
  await unsupported.project('world');
  assert.equal(unsupported.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined,'an unsupported attempt is not rearmed');
});

test('need decision and model lookup grant share the current authored setting after refresh',async()=>{
  const setting={era:'October 1937',starting_place:'Kuybyshev, USSR',background:'NKVD and sovkhoz state farms'};
  const f=await table({setting});
  assert.deepEqual(f.batches[0].state.historical_reference_setting.scenario,setting);
  assert.equal(f.batches[0].state.historical_reference_setting.period,'October 1937');
  await f.refresh();
  const grant=await f.call('historical_reference');
  assert.deepEqual(grant.historical_reference.context.scenario,setting);
  assert.equal(grant.historical_reference.context.period,'October 1937');
});

async function table({enabled=true,needed=true,narrator=true,now,setting,urgent=false}={}) {
  const bus=new Map(),handlers=new Map(),announced=[],batches=[];
  let scene='archive';
  const pi={events:{on:(name,fn)=>bus.set(name,fn),emit:(name,value)=>{if(name==='coc:model-step')announced.push(value);bus.get(name)?.(value);}},
    on:(name,fn)=>handlers.set(name,fn),registerTool:()=>{},getActiveTools:()=>['look','lookup','recall','apply','resolve','narrate','ask'],setActiveTools:()=>{}};
  const engine=createHybridEngine({env:{[EXA_ENV]:'test-exa-key',TYPESAFE_API_KEY:'test-jev-key',COC_NARRATOR_ONLY:narrator?'on':'off'},
    ...(now?{now}:{}),
    npcAct:null,decision:{decide:async batch=>{batches.push(batch);return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='historical_reference_interrupts_action'?urgent?0.95:0.01:q.key===HISTORY_NEED&&needed?0.95:0.01}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}}});
  engine.extension(pi);
  pi.events.emit('coc:kernel-bridge',{campaign:'c',call:async method=>method==='table.capsule'
    ?{where:{scene},historical_setting:setting,mods:{active:enabled?[{id:'historical-reference',version:'1.0.0'}]:[]},present:[],known:{},
      _context:{version:1,campaign:'c',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)}}
    :method==='table.status'?{turn:1,state:'open',receipts:[]}:method==='table.apply.options'?{candidates:[]}:{}});
  const plan=engine.runDriver.prepare({runId:'r',inputRevision:'input',rawInput:'I look around the archive',session:{}});
  const signal=new AbortController().signal;
  await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},{runId:'r',stepId:'read',operationId:'read-op',origin:'policy',inputRevision:'input',scopeId:'root',signal});
  await plan.ports.decision.decide({runId:'r',stepId:'compile',purpose:'compile',signal,question:{candidates:[],batch:{id:'base',model:JEV_MODEL,
    family:'single-loop-compile',familyVersion:'1',scope:{owner:'test',audience:'keeper'},readSet:[],state:{player_input:'I look around the archive'},questions:[]}}});
  const messages=await plan.ports.projection.project({view:{policyState:{view:{}}},stepId:'compose',step:{kind:'infer',purpose:'compose',reason:'ready'}});
  let serial=0;
  async function call(kind, params={},details={}) {
    const id=`call-${++serial}`;
    await plan.ports.operations.execute({origin:'model',operation:'lookup',params:{kind,query:'archive details',...params},assistantMessage:{serial},toolCall:{id}},
      {runId:'r',stepId:'tool-batch',operationId:id,origin:'model',inputRevision:'input',scopeId:'root',signal,
        executeModelTool:async()=>({isError:!!announced.at(-1)?.refuse,details,content:[{type:'text',text:announced.at(-1)?.refuse??'result'}]})});
    return announced.at(-1);
  }
  const project=async(mode='reference')=>(await plan.ports.projection.project({view:{policyState:{view:{interactionScope:{mode,reason:'test_scope',calls:0}}}},
    stepId:'after-read',step:{kind:'infer',purpose:'compose',reason:'reference_request'}})).map(m=>m.content).join('');
  const refresh=async()=>{scene='street';await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},
    {runId:'r',stepId:'scene-refresh',operationId:'refresh-op',origin:'policy',inputRevision:'input',scopeId:'root',signal});};
  return {batches,note:messages.map(m=>m.content).join(''),call,project,refresh,handlers,engine};
}
for(const narrator of [false,true])test(`one existing decision offers history and permits only its lookup subtype (narrator=${narrator})`,async()=>{
  const f=await table({narrator});assert.equal(f.batches.length,1);assert(f.batches[0].questions.some(q=>q.key===HISTORY_NEED));
  assert.match(f.note,/Historical reference is available/);
  const history=await f.call('historical_reference');assert.equal(history.refuse,undefined);assert.equal(history.historical_reference.allowed,true);
  const other=await f.call('module');if(narrator)assert.match(other.refuse,/not in this narrator-only/);
});
test('a declined historical need or disabled Mod does not grant the narrowed read',async()=>{
  for(const options of [{needed:false},{enabled:false}]) {
    const f=await table(options);assert(!f.note.includes('Historical reference is available'));
    assert.match((await f.call('historical_reference')).refuse,/not in this narrator-only/);
  }
});
test('saved reads remain available without a web grant in narrator-only composition',async()=>{
  const f=await table({needed:false});
  for(const reference_mode of ['catalog','read','saved'])
    assert.equal((await f.call('historical_reference',{reference_mode,name:'An issued saved title'})).refuse,undefined);
  assert.match((await f.call('historical_reference',{reference_mode:'web'})).refuse,/not in this narrator-only/);
});
for(const narrator of [false,true])test(`terminal history result reaches the next note and gates every historical mode (narrator=${narrator})`,async()=>{
  const f=await table({narrator});
  await f.call('historical_reference',{}, {kind:'historical_reference',status:'unavailable',reason:'budget_exhausted',
    retrieval:{state:'closed',reason:'budget_exhausted'}});
  const note=await f.project();assert(note.includes(HISTORY_CLOSED));assert(!note.includes('Historical reference is available'));
  await f.refresh();assert((await f.project()).includes(HISTORY_CLOSED),'a scene refresh cannot reopen the same input resource');
  for(const reference_mode of ['auto','web','saved','catalog','read']){
    const result=await f.call('historical_reference',{reference_mode,query:'another topic',name:'Another source'});
    assert.equal(result.refuse,undefined,'optional resource closure is advisory, not a batch-cancelling error');
    assert.equal(result.historical_reference.allowed,false);
    assert.deepEqual(result.historical_reference.retrieval,{state:'closed',reason:'budget_exhausted'});
  }
  const tools=[{type:'function',name:'lookup'},{type:'function',name:'narrate'}];
  const request={input:[{role:'user',content:'Answer from the saved excerpts.'}],tools};
  const final=f.handlers.get('before_provider_request')({payload:request},{model:{api:'openai-responses'}});
  assert.equal(final.tool_choice,'none');assert.equal(final.tools,tools);assert.equal(request.tool_choice,undefined);
  f.handlers.get('agent_end')();assert.equal(f.handlers.get('before_provider_request')({payload:request},{model:{api:'openai-responses'}}),undefined);
  await f.project('world');assert.equal(f.handlers.get('before_provider_request')({payload:request},{model:{api:'openai-responses'}}),undefined,
    'historical resource closure does not disable a world compose');
  if(!narrator)assert.equal((await f.call('rule')).refuse,undefined,'other reference reads retain their ordinary authority');
  f.engine.runDriver.prepare({runId:'new-player-input',inputRevision:'next',rawInput:'And the source?',session:{}});
  assert.equal(f.handlers.get('before_provider_request')({payload:request},{model:{api:'openai-responses'}}),undefined,'a new run does not inherit no-tool mode');
});
test('native final-answer modes keep the stable tool definitions and transport fields',()=>{
  for(const api of ['openai-responses','azure-openai-responses','openai-codex-responses','openai-completions','anthropic-messages']){
    const tools=[{name:'lookup'}],messages=[{role:'user',content:'Reference request'}],payload={tools,messages,max_tokens:2048};
    const final=historyFinalAnswerPayload(api,payload);assert.equal(final.tools,tools);assert.equal(final.messages,messages);
    assert.equal(final.max_tokens,2048);assert.deepEqual(final.tool_choice,api==='anthropic-messages'?{type:'none'}:'none');
    assert.equal(payload.tool_choice,undefined);
  }
  const abortSignal=new AbortController().signal,tools=[{functionDeclarations:[{name:'lookup'}]}];
  for(const api of ['google-generative-ai','google-vertex']){
    const payload={contents:[],config:{tools,abortSignal,maxOutputTokens:2048,
      toolConfig:{functionCallingConfig:{mode:'ANY',allowedFunctionNames:['lookup']}}}};
    const final=historyFinalAnswerPayload(api,payload);assert.equal(final.config.tools,tools);assert.equal(final.config.abortSignal,abortSignal);
    assert.equal(final.config.maxOutputTokens,2048);assert.equal(final.config.toolConfig.functionCallingConfig.mode,'NONE');
    assert.equal(final.config.toolConfig.functionCallingConfig.allowedFunctionNames,undefined);
    assert.equal(payload.config.toolConfig.functionCallingConfig.mode,'ANY');
  }
  assert.equal(historyFinalAnswerPayload('unsupported',{}),undefined);
});
test('the existing whole-turn budget closes optional history even when local reads are fast',async()=>{
  let elapsed=0;const f=await table({now:()=>elapsed,narrator:false});
  await f.call('historical_reference',{reference_mode:'saved'},{kind:'historical_reference',status:'ready',materials:[{excerpts:['A saved period fact.']}]});
  assert(!(await f.project()).includes(HISTORY_CLOSED),'the first successful read did not itself exhaust the resource');
  elapsed=45001;
  const note=await f.project();assert(note.includes(HISTORY_CLOSED));assert(note.includes('turn_budget_exhausted'));
  const attempted=await f.call('historical_reference',{reference_mode:'catalog'});
  assert.equal(attempted.refuse,undefined);
  assert.deepEqual(attempted.historical_reference.retrieval,{state:'closed',reason:'turn_budget_exhausted'});
  const final=f.handlers.get('before_provider_request')({payload:{input:[],tools:[]}},{model:{api:'openai-responses'}});
  assert.equal(final.tool_choice,'none');
});
