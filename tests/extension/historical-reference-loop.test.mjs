import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {EXA_ENV,HISTORY_NEED,HISTORY_CLOSED,HISTORY_SUPPLIED,historyFinalAnswerPayload} from '../../runtime/historical-reference.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';

// §124.12 (owner, 2026-10-02): the host looks the scene up when Jev grants the need, from authored fields, and hands the
// result to the first step that writes; a scene already looked up gets its result again without a search. The forced
// lookup round this replaces cost 4-21 s of a Keeper call on 16 of 18 turns of the installed App's two tables.
const SETTING={era:'October 1937',starting_place:'Kuybyshev, USSR',background:'NKVD and sovkhoz state farms'};
const EXCERPT='Card catalogues stood in oak drawers along the reading-room wall.';
const READY={kind:'historical_reference',status:'ready',reason:'selected',authority:'advisory_external_excerpt',cached:false,usage:'Use these excerpts as background.',
  materials:[{alias:'reference_1',title:'Period archive',url:'https://example.org/a',excerpts:[EXCERPT],applicability:'analogous',published_at:null,retrieved_at:'2026-10-02T00:00:00Z'}]};
const prefetchRows=(f,phase)=>f.rows.filter(row=>row.lane==='historical-reference'&&row.event==='prefetch'&&row.phase===phase);

test('a granted need looks the scene up with the host query and hands the result to the first writing step; no lookup round is forced',async()=>{
  const f=await table({setting:SETTING,port:()=>READY});
  assert.equal(f.searches.length,1);
  assert.deepEqual({query:f.searches[0].query,run:f.searches[0].run,turn:f.searches[0].turn},{query:'October 1937 Archive Hall',run:'r',turn:1});
  assert.match(f.searches[0].objective,/Reading room with card catalogues/);
  assert.match(f.searches[0].objective,/NKVD and sovkhoz state farms/);
  const supplied=f.clerk.historical_reference_materials;
  assert.equal(supplied.origin,'host_scene_lookup');
  assert.deepEqual(supplied.materials.map(row=>row.excerpts),[[EXCERPT]]);
  assert.equal(f.clerk.historical_reference,HISTORY_SUPPLIED);
  assert.equal(f.clerk.historical_reference_preparation,undefined);
  const payload={input:[],tools:[{type:'function',name:'lookup'},{type:'function',name:'narrate'}]};
  assert.equal(f.handlers.get('before_provider_request')({payload},{model:{api:'openai-responses'}}),undefined,'the Keeper\'s request is not rewritten to force a lookup');
  assert.deepEqual(prefetchRows(f,'delivered').map(row=>[row.status,row.materials,row.reused]),[['ready',1,false]]);
});
test('a later turn at the same scene gets the earlier result again without a search; another scene is looked up itself',async()=>{
  const f=await table({setting:SETTING,port:()=>READY});
  const again=await f.turn('r2');
  assert.equal(f.searches.length,1,'the same scene is not searched again');
  assert.equal(again.historical_reference_materials.origin,'host_scene_reused');
  assert.deepEqual(again.historical_reference_materials.materials.map(row=>row.excerpts),[[EXCERPT]]);
  assert.equal(prefetchRows(f,'reused').length,1);
  const moved=await f.turn('r3','street');
  assert.equal(f.searches.length,2);
  assert.equal(f.searches[1].query,'October 1937 Main Street');
  assert.equal(moved.historical_reference_materials.origin,'host_scene_lookup');
});
test('an unavailable result is not kept, so the next turn at the scene searches again',async()=>{
  const f=await table({setting:SETTING,port:(_,n)=>n===1?{kind:'historical_reference',status:'unavailable',reason:'provider_unavailable',materials:[]}:READY});
  assert.equal(f.clerk.historical_reference_materials.status,'unavailable');
  const again=await f.turn('r2');
  assert.equal(f.searches.length,2);
  assert.equal(again.historical_reference_materials.origin,'host_scene_lookup');
});
test('nothing is searched when the need is declined, the action is urgent, the Mod is off or the scenario has no era',async()=>{
  for(const options of [{needed:false},{urgent:true},{enabled:false},{setting:{background:'No era authored'}}]){
    const f=await table({setting:SETTING,port:()=>READY,...options});
    assert.equal(f.searches.length,0,JSON.stringify(options));
    assert.equal(f.clerk?.historical_reference_materials,undefined,JSON.stringify(options));
    if(options.setting)assert.deepEqual(prefetchRows(f,'skipped').map(row=>row.reason),['no_setting']);
  }
});
test('a search still running is waited for within the turn budget; past it only a result already back is handed over',async()=>{
  const slow=await table({setting:SETTING,port:()=>new Promise(resolve=>setTimeout(()=>resolve(READY),30))});
  assert.deepEqual(slow.clerk.historical_reference_materials.materials.map(row=>row.excerpts),[[EXCERPT]]);
  let elapsed=0;
  const spent=await table({setting:SETTING,now:()=>elapsed,port:()=>{elapsed=46000;return new Promise(resolve=>setTimeout(()=>resolve(READY),1500));}});
  assert.equal(spent.clerk?.historical_reference_materials,undefined,'a spent turn does not wait for the search');
  assert.deepEqual(prefetchRows(spent,'delivered').map(row=>row.status),['not_back']);
  elapsed=0;
  const back=await table({setting:SETTING,now:()=>elapsed,port:()=>{elapsed=46000;return READY;}});
  assert.deepEqual(back.clerk.historical_reference_materials.materials.map(row=>row.excerpts),[[EXCERPT]],'a result already back costs no time');
});

// Owner 2026-10-02: the fast model writes the scene's query in English (runtime/jev/history-query.ts), once per scene.
const writer=(answers)=>{const calls=[];return {calls,async write(facts){calls.push(facts);const next=answers.shift();return next;}};};
test('the fast model\'s English query is what the scene searches, written once per scene from the authored facts',async()=>{
  const lane=writer([{ok:true,query:'1937 Soviet provincial archive reading room',objective:'How such a reading room looked and worked in 1937.',ms:4},
    {ok:true,query:'1937 Soviet provincial town main street',objective:'Street life of a 1937 Soviet provincial town.',ms:4}]);
  const f=await table({setting:SETTING,port:()=>READY,historyQuery:lane});
  assert.deepEqual(lane.calls,[{era:'October 1937',place:'Archive Hall',summary:'Reading room with card catalogues',background:'NKVD and sovkhoz state farms'}]);
  assert.deepEqual(f.searches.map(request=>request.query),['1937 Soviet provincial archive reading room']);
  assert.equal(f.searches[0].objective,'How such a reading room looked and worked in 1937.');
  assert.deepEqual(prefetchRows(f,'started').map(row=>[row.query_source,row.query]),[['fast_model','1937 Soviet provincial archive reading room']]);
  assert.equal(f.clerk.historical_reference_materials.query,'1937 Soviet provincial archive reading room');
  const again=await f.turn('r2');
  assert.equal(lane.calls.length,1,'a scene already looked up asks the lane nothing');
  assert.equal(again.historical_reference_materials.query,'1937 Soviet provincial archive reading room');
  await f.turn('r3','street');
  assert.equal(lane.calls.length,2);
  assert.equal(f.searches.at(-1).query,'1937 Soviet provincial town main street');
});
test('a lane that fails searches the fixed-shape query and says why',async()=>{
  const lane=writer([{ok:false,reason:'timeout',detail:'no answer within 6000 ms',ms:6000}]);
  const f=await table({setting:SETTING,port:()=>READY,historyQuery:lane});
  assert.deepEqual(f.searches.map(request=>request.query),['October 1937 Archive Hall']);
  assert.deepEqual(prefetchRows(f,'started').map(row=>[row.query_source,row.query_failure]),[['fixed_shape','timeout']]);
  assert.deepEqual(f.clerk.historical_reference_materials.materials.map(row=>row.excerpts),[[EXCERPT]]);
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

async function table({enabled=true,needed=true,narrator=true,now,setting,urgent=false,port,historyQuery=null}={}) {
  const bus=new Map(),handlers=new Map(),announced=[],batches=[],rows=[],searches=[];
  const places={archive:{display_name:'Archive Hall',summary:'Reading room with card catalogues'},street:{display_name:'Main Street'}};
  let scene='archive';
  const pi={events:{on:(name,fn)=>bus.set(name,fn),emit:(name,value)=>{if(name==='coc:model-step')announced.push(value);bus.get(name)?.(value);}},
    on:(name,fn)=>handlers.set(name,fn),registerTool:()=>{},getActiveTools:()=>['look','lookup','recall','apply','resolve','narrate','ask'],setActiveTools:()=>{}};
  const engine=createHybridEngine({env:{[EXA_ENV]:'test-exa-key',TYPESAFE_API_KEY:'test-jev-key',COC_NARRATOR_ONLY:narrator?'on':'off'},
    ...(now?{now}:{}),record:row=>rows.push(row),historyQuery,
    npcAct:null,decision:{decide:async batch=>{batches.push(batch);return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='historical_reference_interrupts_action'?urgent?0.95:0.01:q.key===HISTORY_NEED&&needed?0.95:0.01}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}}});
  engine.extension(pi);
  pi.events.emit('coc:kernel-bridge',{campaign:'c',call:async method=>method==='table.capsule'
    ?{where:{scene,...places[scene]},historical_setting:setting,mods:{active:enabled?[{id:'historical-reference',version:'1.0.0'}]:[]},present:[],known:{},
      _context:{version:1,campaign:'c',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)}}
    :method==='table.status'?{turn:1,state:'open',receipts:[]}:method==='table.apply.options'?{candidates:[]}:{}});
  if(port)pi.events.emit('coc:historical-reference',{campaign:'c',search:async request=>{searches.push(request);return port(request,searches.length);}});
  const signal=new AbortController().signal;
  // One player input up to its first compose: the run's read, the compile decision that asks the need, the compose note.
  async function begin(runId){
    const plan=engine.runDriver.prepare({runId,inputRevision:'input',rawInput:'I look around the archive',session:{}});
    await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},{runId,stepId:'read',operationId:'read-op',origin:'policy',inputRevision:'input',scopeId:'root',signal});
    await plan.ports.decision.decide({runId,stepId:'compile',purpose:'compile',signal,question:{candidates:[],batch:{id:'base',model:JEV_MODEL,
      family:'single-loop-compile',familyVersion:'1',scope:{owner:'test',audience:'keeper'},readSet:[],state:{player_input:'I look around the archive'},questions:[]}}});
    const messages=await plan.ports.projection.project({view:{policyState:{view:{}}},stepId:'compose',step:{kind:'infer',purpose:'compose',reason:'ready'}})??[];
    const clerk=messages.find(m=>m.customType==='coc-clerk');
    return {plan,messages,clerk:clerk?JSON.parse(clerk.content):undefined};
  }
  const first=await begin('r'),plan=first.plan,messages=first.messages;
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
  const turn=async(runId,at=scene)=>{scene=at;return (await begin(runId)).clerk;};
  return {batches,note:messages.map(m=>m.content).join(''),clerk:first.clerk,call,project,refresh,turn,handlers,engine,rows,searches};
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
