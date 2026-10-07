/** Pi request seam with real TS state and deterministic providers; not live-play evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {EXA_ENV,sceneFacts,historyContext} from '../../runtime/historical-reference.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const excerpt='The period reference describes bound newspaper volumes and a subject index kept for visiting researchers.';
const call=(tool,args)=>fauxAssistantMessage([fauxToolCall(tool,args)],{stopReason:'toolUse'});
test('selected Exa excerpts arrive unchanged in the next main Pi provider request',async t=>{
  const original=globalThis.fetch, observed=[];let searches=0,selections=0,received=false,readBack=false;
  const lastLookup=context=>JSON.parse(context.messages.findLast(m=>m.role==='toolResult'&&m.toolName==='lookup').content.find(b=>b.type==='text').text);
  globalThis.fetch=async(url,init)=>{
    if(String(url)==='https://api.exa.ai/search'){searches++;return Response.json({results:[{title:'Historical library',url:'https://example.org/library',highlights:[excerpt]}]});}
    if(String(url)==='https://api.typesafe.ai/v1/systemone') {
      const body=JSON.parse(init.body);if(body.questions.reference_1)selections++;
      const state=typeof body.state==='string'?JSON.parse(body.state):body.state;
      if(body.questions.query_kind||body.questions.reference_1||body.questions.saved_1)
        observed.push({player_input:state.player_input,period:state.setting?.period});
      return Response.json({model:body.model,answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,
        key==='query_kind'?{type:'choice',choice:'context',confidence:1,probabilities:{context:1,price_anchor:0,item_price:0,unclear:0}}
          : key==='price_disputed'||key.startsWith('anchor_')?{type:'noul',noul:0.01}
          : key.startsWith('period_')?{type:'noul',noul:0.99}
          : {type:'choice',choice:'direct',confidence:1,probabilities:{direct:1,analogous:0,uncertain:0,reject:0}}])),usage:{input_tokens:100,output_tokens:10}});
    }
    return original(url,init);
  };
  t.after(()=>{globalThis.fetch=original;});
  const table=await openTable({realKernel:true,env:{[EXA_ENV]:'test-exa-key',TYPESAFE_API_KEY:'test-jev-key'},
    extraExtensions:[pi=>pi.on('tool_call',event=>{if(event.toolName==='lookup')pi.events.emit('coc:model-step',{
      toolCallId:event.toolCallId,run:'history-test',step:'compose',historical_reference:{allowed:!event.input.reference_mode,enabled:true,turn:1,
        scope:{owner:'history-test',audience:'keeper',campaign:'test-camp',worldline:'main',loop:0},context:{period:'1920s'}}});})],
    responses:[call('look',{}),call('narrate',{text:'You are in the office. Knott waits by the desk with the commission still open.'})],
  });t.after(()=>table.dispose());
  await waitForIdle(table.session);
  table.faux.setResponses([call('lookup',{kind:'historical_reference',query:'1920s newspaper reference library'}),async context=>{
      const body=JSON.stringify(context.messages);
      assert(body.includes(excerpt),'the actual next request contains the original excerpt');
      assert(body.includes('advisory_external_excerpt'));
      assert(!body.includes('test-exa-key')); received=true;
      return call('lookup',{kind:'historical_reference',reference_mode:'catalog'});
    },async context=>{
      const index=lastLookup(context);assert.equal(index.materials.length,0);assert.equal(index.catalogue.length,1);
      return call('lookup',{kind:'historical_reference',reference_mode:'read',name:index.catalogue[0].name});
    },async context=>{
      const saved=lastLookup(context);assert.equal(saved.origin,'library');assert.deepEqual(saved.materials[0].excerpts,[excerpt]);readBack=true;
      return call('narrate',{text:'The reference offers background on period libraries; you remain in the office with the commission still to discuss.'});
    },fauxAssistantMessage('Done.')]);
  await table.session.prompt('I wonder how newspaper libraries worked in this period.');
  await waitForIdle(table.session);
  assert.deepEqual(observed,observed.map(()=>({player_input:'I wonder how newspaper libraries worked in this period.',period:'1920s'})),'fresh and named saved selection receive the latest host-owned question and authored era');
  assert.deepEqual(table.extensionErrors,[]);assert.equal(received,true,JSON.stringify(table.session.messages.filter(m=>m.role==='toolResult')));
  assert.equal(readBack,true,JSON.stringify({searches,selections,history:table.telemetry().filter(r=>r.lane==='historical-reference').map(({reason,selection_failure,ms})=>({reason,selection_failure,ms}))}));assert.equal(searches,1);assert.equal(selections,2);
  assert.equal(table.kernelRequests().some(r=>r.method==='table.lookup'&&r.params.kind==='historical_reference'),false,'the kernel never executes external search');
});

test('real Pi price lookup reads player consent from the host and reuses anchors for ordinary quotes', async t => {
  const original = globalThis.fetch, queries = [], playerInputs = [];
  const anchorQuery = '1920 Boston representative everyday prices and wages';
  const challengeQuery = '1920 Boston coffee menu price';
  const challenge = 'Ten dollars for coffee in 1920 sounds wrong. Please check that quoted price.';
  const anchor = 'Boston in 1920, in US dollars: coffee per cup $0.05, sandwich $0.15, ordinary daily wage $4.';
  let turn = 1;
  const bodyOf = context => JSON.parse(context.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'lookup').content.find(b => b.type === 'text').text);
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.exa.ai/search') {
      queries.push(JSON.parse(init.body).query);
      return Response.json({results: [{title: '1920 Boston price scale', url: 'https://example.org/prices', highlights: [anchor]}]});
    }
    if (String(url) === 'https://api.typesafe.ai/v1/systemone') {
      const body = JSON.parse(init.body), state = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;
      if (body.questions.query_kind) playerInputs.push(state.player_input);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key,
        key === 'query_kind' ? {type: 'choice', choice: state.query === anchorQuery ? 'price_anchor' : 'item_price', confidence: 1,
          probabilities: {context: 0, price_anchor: state.query === anchorQuery ? 1 : 0, item_price: state.query === anchorQuery ? 0 : 1, unclear: 0}}
          : key === 'price_disputed' ? {type: 'noul', noul: state.player_input === challenge ? 0.99 : 0.01}
          : q.type === 'noul' ? {type: 'noul', noul: key.startsWith('saved_') ? 0.01 : 0.99}
          : {type: 'choice', choice: 'analogous', confidence: 1, probabilities: {direct: 0, analogous: 1, uncertain: 0, reject: 0}}]));
      return Response.json({model: body.model, answers, usage: {input_tokens: 100, output_tokens: 10}});
    }
    return original(url, init);
  };
  t.after(() => {globalThis.fetch = original;});
  const table = await openTable({realKernel: true, env: {[EXA_ENV]: 'test-exa', TYPESAFE_API_KEY: 'test-jev'},
    extraExtensions: [pi => pi.on('tool_call', event => {
      if (event.toolName === 'lookup') pi.events.emit('coc:model-step', {toolCallId: event.toolCallId, run: `price-${turn}`, step: 'compose',
        historical_reference: {enabled: true, allowed: true, turn, scope: {owner: 'price-test', audience: 'keeper', campaign: 'test-camp', worldline: 'main', loop: 0}}});
    })], responses: [call('look', {}), call('narrate', {text: 'You are in the office. Knott waits by the desk with the commission still open.'})]});
  t.after(() => table.dispose());
  await waitForIdle(table.session);
  table.faux.setResponses([call('lookup', {kind: 'historical_reference', query: anchorQuery}), context => {
      assert.equal(bodyOf(context).materials[0].price_anchor, true);
      return call('lookup', {kind: 'historical_reference', query: '1920 Boston hat price', objective: 'The player disputes this price', reference_mode: 'web'});
    }, context => {
      assert.equal(bodyOf(context).pricing.strategy, 'estimate_from_anchors');
      assert.deepEqual(bodyOf(context).materials[0].excerpts, [anchor]);
      return call('narrate', {text: 'The saved price scale can guide ordinary quotations; you remain in the office.'});
    }, fauxAssistantMessage('Done.')]);
  await table.session.prompt('I am considering ordinary equipment.'); await waitForIdle(table.session);
  assert.equal(queries.length, 2, JSON.stringify({playerInputs, results: table.session.messages.filter(m => m.role === 'toolResult').map(m => ({tool: m.toolName, details: m.details}))}));
  assert(queries.every(query=>query.includes(anchorQuery)));
  assert(queries[0].includes('retail prices'));assert(queries[1].includes('hourly wages'));
  assert.equal(playerInputs.includes('The player disputes this price'), false);
  turn = 2;
  table.faux.setResponses([call('lookup', {kind: 'historical_reference', query: challengeQuery, reference_mode: 'web'}), context => {
    assert.equal(bodyOf(context).pricing.strategy, 'check_challenged_quote');
    return call('narrate', {text: 'The historical reference gives a comparable coffee price; the proposed quotation remains open for discussion.'});
  }, fauxAssistantMessage('Done.')]);
  await table.session.prompt(challenge); await waitForIdle(table.session);
  assert.equal(queries.length, 3, JSON.stringify({playerInputs,
    lookups: table.session.messages.filter(m => m.role === 'toolResult' && m.toolName === 'lookup').map(m => m.content),
    errors: table.extensionErrors}));
  assert.equal(queries.at(-1),challengeQuery);
  assert.equal(playerInputs.at(-1), challenge);
  assert.deepEqual(table.extensionErrors, []);
});

test('real Pi loop hands a spent historical lane to final prose and allows the next player saved read',async t=>{
  const original=globalThis.fetch;let searches=0,closedSeen=false,freshSeen=false;
  globalThis.fetch=async(url,init)=>{
    if(String(url)==='https://api.exa.ai/search'){
      searches++;
      if(searches===1)return Response.json({results:[{title:'Historical archive',url:'https://example.org/archive',highlights:[excerpt]}]});
      return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    }
    if(String(url)==='https://api.typesafe.ai/v1/systemone'){
      const body=JSON.parse(init.body),questions=Object.entries(body.questions);
      return Response.json({model:body.model,answers:Object.fromEntries(questions.map(([key,q])=>[key,
        key==='query_kind'?{type:'choice',choice:'context',confidence:1,probabilities:{context:1,price_anchor:0,item_price:0,unclear:0}}
          : q.type==='noul'?{type:'noul',noul:key.startsWith('saved_')||key.startsWith('period_')?.99:.01}
          : {type:'choice',choice:'direct',confidence:1,probabilities:{direct:1,analogous:0,uncertain:0,reject:0}}])),usage:{input_tokens:100,output_tokens:10}});
    }
    return original(url,init);
  };
  t.after(()=>{globalThis.fetch=original;});
  const env={[EXA_ENV]:'test-exa',TYPESAFE_API_KEY:'test-jev',PI_COC_JEV_PRESELECT:'0'};
  const decision={async decide(batch){return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>{
    if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key==='historical_reference_needed'?.99:.01}];
    const choice='finish' in q.criteria?'finish':'later' in q.criteria?'later':Object.keys(q.criteria)[0];
    return[q.key,{status:'answered',type:'choice',choice,confidence:1,probabilities:{[choice]:1}}];
  })),{inputTokens:1,outputTokens:1,costUsd:0});}};
  const engine=createHybridEngine({env,decision,npcAct:null,interactionScope:{mode:'reference',reason:'test_reference_scope',calls:0}});
  const reply='The saved excerpt describes bound newspaper volumes and a subject index. Other details are not established by that excerpt.';
  const table=await openTable({realKernel:true,env,runDriver:engine.runDriver,extraExtensions:[{name:'history-loop',factory:engine.extension}],
    prepareWorkspace:workspace=>{
      const root=resolve(import.meta.dirname,'../..'),calls=[['table.open',{}],['table.player_input',{text:'I wait in the office.'}],
        ['table.narrate',{call_id:'t1-c1',text:'You remain beside the desk while Knott waits.'}]];
      const r=spawnSync(process.execPath,[join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],
        {cwd:root,encoding:'utf8',input:calls.map(([method,params],id)=>JSON.stringify({id:String(id),method,params:{campaign:'test-camp',...params}})).join('\n')+'\n'});
      assert.equal(r.status,0,r.stderr);for(const line of r.stdout.trim().split('\n')){const frame=JSON.parse(line);if(!frame.progress)assert.equal(frame.ok,true,JSON.stringify(frame));}
    },responses:[call('lookup',{kind:'historical_reference',query:'1920 newspaper archive'}),context=>{
      assert(JSON.stringify(context.messages).includes(excerpt));
      return call('lookup',{kind:'historical_reference',reference_mode:'web',query:'1920 archive additional detail'});
    },context=>{
      const result=context.messages.findLast(m=>m.role==='toolResult'&&m.toolName==='lookup');
      assert.equal(JSON.parse(result.content.find(c=>c.type==='text').text).retrieval.state,'closed');
      const body=JSON.stringify(context.messages);
      assert(body.includes('Historical retrieval is closed for this input'));assert(body.includes(excerpt));closedSeen=true;
      return fauxAssistantMessage(reply);
    }]});
  t.after(()=>table.dispose());
  await table.session.prompt('This is an out-of-fiction request for archive background.');await waitForIdle(table.session);
  assert(closedSeen,JSON.stringify({searches,errors:table.extensionErrors,messages:table.session.messages.filter(m=>m.role==='toolResult'||m.role==='assistant'),
    history:table.telemetry().filter(r=>r.lane==='historical-reference')}));
  assert.equal(searches,2);assert.equal(table.session.lastDrivenRun.status,'delivered');
  assert.equal(table.telemetry().filter(r=>r.lane==='historical-reference'&&r.event==='closed_received').length,1);
  table.faux.setResponses([call('lookup',{kind:'historical_reference',reference_mode:'saved',query:'1920 newspaper archive'}),context=>{
    const result=JSON.parse(context.messages.findLast(m=>m.role==='toolResult'&&m.toolName==='lookup').content.find(c=>c.type==='text').text);
    assert.equal(result.status,'ready');assert.equal(result.retrieval,undefined);freshSeen=true;return fauxAssistantMessage(reply);
  }]);
  await table.session.prompt('And the source? Read the saved excerpt.');await waitForIdle(table.session);
  assert(freshSeen);assert.equal(searches,2);assert.deepEqual(table.extensionErrors,[]);
});

test('a closed optional lookup does not cancel the delivery following it in the same real Pi batch',async t=>{
  const text='You remain in the office beside the desk. The commission is still open, and the room is quiet while you consider it.';
  const table=await openTable({realKernel:true,env:{[EXA_ENV]:'test-exa',TYPESAFE_API_KEY:'test-jev'},
    extraExtensions:[pi=>pi.on('tool_call',event=>{
      if(event.toolName==='lookup')pi.events.emit('coc:model-step',{toolCallId:event.toolCallId,run:'closed-read',step:'compose',
        historical_reference:{enabled:true,allowed:false,turn:0,scope:{owner:'test',audience:'keeper',campaign:'test-camp',worldline:'main',loop:0},
          retrieval:{state:'closed',reason:'turn_budget_exhausted'}}});
    })],responses:[fauxAssistantMessage([fauxToolCall('lookup',{kind:'historical_reference',reference_mode:'catalog'}),
      fauxToolCall('narrate',{text})],{stopReason:'toolUse'}),fauxAssistantMessage('Done.')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I remain in the office.');await waitForIdle(table.session);
  const lookup=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='lookup');
  assert.equal(lookup.isError,false);assert.equal(lookup.details.reason,'turn_budget_exhausted');
  const delivery=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='narrate');
  assert(delivery);assert.equal(delivery.isError,false);assert.equal(delivery.details.rendered_text,text);
  assert.deepEqual(table.extensionErrors,[]);
});

// §124.12 (owner, 2026-10-02): the host's scene lookup replaces the forced Keeper round. On the real path -- hybrid engine,
// real kernel, the kernel's own HistoricalReference -- a granted need searches Exa once with the query sceneQuery builds
// from the capsule, and the Keeper's first request already carries the excerpt; the Keeper only narrates.
function historyServices(exa){
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(String(url)==='https://api.exa.ai/search'){exa.push(JSON.parse(init.body));return Response.json({results:[{title:'Historical office',url:'https://example.org/office',highlights:[excerpt]}]});}
    if(String(url)==='https://api.typesafe.ai/v1/systemone'){
      const body=JSON.parse(init.body);
      return Response.json({model:body.model,answers:Object.fromEntries(Object.entries(body.questions).map(([key,q])=>[key,
        key==='query_kind'?{type:'choice',choice:'context',confidence:1,probabilities:{context:1,price_anchor:0,item_price:0,unclear:0}}
          : q.type==='noul'?{type:'noul',noul:key.startsWith('period_')?.99:.01}
          : {type:'choice',choice:'direct',confidence:1,probabilities:{direct:1,analogous:0,uncertain:0,reject:0}}])),usage:{input_tokens:100,output_tokens:10}});
    }
    return original(url,init);
  };
  return ()=>{globalThis.fetch=original;};
}
const historyEnv={[EXA_ENV]:'test-exa',TYPESAFE_API_KEY:'test-jev',PI_COC_JEV_PRESELECT:'0'};
function kernelSteps(workspace,calls){
  const root=resolve(import.meta.dirname,'../..');
  const r=spawnSync(process.execPath,[join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],
    {cwd:root,encoding:'utf8',input:calls.map(([method,params],id)=>JSON.stringify({id:String(id),method,params:{campaign:'test-camp',...params}})).join('\n')+'\n'});
  assert.equal(r.status,0,r.stderr);
  const frames=r.stdout.trim().split('\n').map(line=>JSON.parse(line)).filter(frame=>!frame.progress);
  for(const frame of frames)assert.equal(frame.ok,true,JSON.stringify(frame));
  return frames.map(frame=>frame.result);
}
test('on the hybrid engine a granted need searches once with the fast model\'s English query, and the Keeper\'s first request carries the excerpt',async t=>{
  const exa=[];t.after(historyServices(exa));
  let capsule,seen=false;
  // The fast model's lane (runtime/jev/history-query.ts) as a fixture: it reads the authored facts and answers in English.
  const asked=[],written={query:'1920s Boston lawyer\'s office',objective:'Appearance and daily work of a 1920s Boston law office, as it was then.'};
  const historyQuery={async write(facts){asked.push(facts);return {ok:true,...written,ms:5,model:'fixture/fast'};}};
  const decision={async decide(batch){return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>{
    if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key==='historical_reference_needed'?.99:.01}];
    const choice='finish' in q.criteria?'finish':'later' in q.criteria?'later':'none' in q.criteria?'none':Object.keys(q.criteria)[0];
    return[q.key,{status:'answered',type:'choice',choice,confidence:1,probabilities:{[choice]:1}}];
  })),{inputTokens:1,outputTokens:1,costUsd:0});}};
  const engine=createHybridEngine({env:historyEnv,decision,npcAct:null,historyQuery,interactionScope:{mode:'world',reason:'test_world_scope',calls:0}});
  const text='You look around the office. Ledgers and carbon copies are stacked on the desk, and Knott waits with the commission still open.';
  const table=await openTable({realKernel:true,env:historyEnv,runDriver:engine.runDriver,extraExtensions:[{name:'history-loop',factory:engine.extension}],
    prepareWorkspace:workspace=>{
      capsule=kernelSteps(workspace,[['table.open',{}],['table.player_input',{text:'I wait in the office.'}],
        ['table.narrate',{call_id:'t1-c1',text:'You remain beside the desk while Knott waits.'}],['table.capsule',{}]]).at(-1);
    },responses:[context=>{
      assert(JSON.stringify(context.messages).includes(excerpt),'the first Keeper request already holds the host lookup\'s excerpt');
      seen=true;return call('narrate',{text});
    }]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around the office.');await waitForIdle(table.session);
  const facts=sceneFacts(historyContext(capsule));
  assert(facts,'the starter authors an era and its scene a name');
  const rows=table.telemetry().filter(r=>r.lane==='historical-reference');
  assert.equal(seen,true,JSON.stringify({exa,rows,errors:table.extensionErrors}));
  assert.deepEqual(asked,[facts],'the lane reads the authored era, scene and background');
  assert.deepEqual(exa.map(body=>[body.query,body.objective]),[[written.query,written.objective]],'Exa gets the English query, not the authored wording');
  assert(rows.some(r=>r.event==='prefetch'&&r.phase==='started'&&r.query_source==='fast_model'),JSON.stringify(rows));
  assert(rows.some(r=>r.requested_by==='host'&&r.library_match==='exact'),JSON.stringify(rows));
  assert(rows.some(r=>r.requested_by==='host'&&r.status==='ready'),JSON.stringify(rows));
  assert(rows.some(r=>r.event==='prefetch'&&r.phase==='delivered'&&r.materials===1),JSON.stringify(rows));
  assert(!rows.some(r=>r.event==='preparation_request'||r.requested_by==='keeper'),'no Keeper lookup round');
  assert.equal(table.session.lastDrivenRun.status,'delivered');
  assert.deepEqual(table.extensionErrors,[]);
});
test('the kernel\'s historical port spends no search on a grant bound to another campaign line',async t=>{
  const exa=[];t.after(historyServices(exa));
  let port;
  const table=await openTable({realKernel:true,env:historyEnv,responses:[],
    extraExtensions:[{name:'history-port-probe',factory:pi=>pi.events.on('coc:historical-reference',value=>{port=value;})}]});
  t.after(()=>table.dispose());
  assert.equal(typeof port?.search,'function','the kernel extension publishes the port with the table');
  const result=await port.search({run:'probe',turn:1,scope:{owner:'probe',campaign:'another-camp',worldline:'main',loop:0,audience:'keeper'},
    query:'1920s office',objective:'Period detail for an office.'});
  assert.equal(result.reason,'not_selected');
  assert.equal(exa.length,0);
});
// The App's third table (2026-10-02): a move inside the turn ran the scene lookup twice -- the scene left and the
// destination -- and the first spent the input's allowance, so the destination's came back budget_exhausted. Each
// scene's host lookup has its own allowance: three scenes in one turn all reach Exa (one shared binding allows two).
test('each scene\'s host lookup has its own retrieval allowance within one turn',async t=>{
  const exa=[];t.after(historyServices(exa));
  let port,binding;
  const table=await openTable({realKernel:true,env:historyEnv,responses:[],
    prepareWorkspace:workspace=>{binding=kernelSteps(workspace,[['table.open',{}],['table.capsule',{}]]).at(-1)._context;},
    extraExtensions:[{name:'history-port-probe',factory:pi=>pi.events.on('coc:historical-reference',value=>{port=value;})}]});
  t.after(()=>table.dispose());
  const scope={owner:'probe',campaign:binding.campaign,worldline:binding.worldline,loop:binding.loop,audience:'keeper'};
  const results=[];
  for(const scene of ['bar','station','store'])
    results.push(await port.search({run:'one-run',scene,turn:binding.turn,scope,query:`1970s West Texas ${scene} first-hand account`,objective:'How it was then.'}));
  assert.deepEqual(results.map(result=>result.reason),['selected','selected','selected'],JSON.stringify(results.map(result=>result.reason)));
  assert.equal(exa.length,3);
});
