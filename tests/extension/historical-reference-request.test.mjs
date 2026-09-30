/** Pi request seam with real TS state and deterministic providers; not live-play evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {EXA_ENV} from '../../runtime/historical-reference.ts';
const excerpt='The period reference describes bound newspaper volumes and a subject index kept for visiting researchers.';
const call=(tool,args)=>fauxAssistantMessage([fauxToolCall(tool,args)],{stopReason:'toolUse'});
test('selected Exa excerpts arrive unchanged in the next main Pi provider request',async t=>{
  const original=globalThis.fetch;let searches=0,selections=0,received=false,readBack=false;
  const lastLookup=context=>JSON.parse(context.messages.findLast(m=>m.role==='toolResult'&&m.toolName==='lookup').content.find(b=>b.type==='text').text);
  globalThis.fetch=async(url,init)=>{
    if(String(url)==='https://api.exa.ai/search'){searches++;return Response.json({results:[{title:'Historical library',url:'https://example.org/library',highlights:[excerpt]}]});}
    if(String(url)==='https://api.typesafe.ai/v1/systemone') {
      const body=JSON.parse(init.body);if(!body.questions.query_kind)selections++;
      return Response.json({model:body.model,answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,
        key==='query_kind'?{type:'choice',choice:'context',confidence:1,probabilities:{context:1,price_anchor:0,item_price:0,unclear:0}}
          : key==='price_disputed'||key.startsWith('anchor_')?{type:'noul',noul:0.01}
          : {type:'choice',choice:'direct',confidence:1,probabilities:{direct:1,analogous:0,uncertain:0,reject:0}}])),usage:{input_tokens:100,output_tokens:10}});
    }
    return original(url,init);
  };
  t.after(()=>{globalThis.fetch=original;});
  const table=await openTable({realKernel:true,env:{[EXA_ENV]:'test-exa-key',TYPESAFE_API_KEY:'test-jev-key'},
    extraExtensions:[pi=>pi.on('tool_call',event=>{if(event.toolName==='lookup')pi.events.emit('coc:model-step',{
      toolCallId:event.toolCallId,run:'history-test',step:'compose',historical_reference:{allowed:!event.input.reference_mode,enabled:true,turn:0,
        scope:{owner:'history-test',audience:'keeper',campaign:'test-camp',worldline:'main',loop:0},context:{period:'1920s'}}});})],
    responses:[call('lookup',{kind:'historical_reference',query:'1920s newspaper reference library'}),async context=>{
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
    },fauxAssistantMessage('Done.')],
  });t.after(()=>table.dispose());
  await table.session.prompt('I wonder how newspaper libraries worked in this period.');
  await waitForIdle(table.session);
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
  assert.deepEqual(queries, [anchorQuery], JSON.stringify({playerInputs, results: table.session.messages.filter(m => m.role === 'toolResult').map(m => ({tool: m.toolName, details: m.details}))}));
  assert.equal(playerInputs.includes('The player disputes this price'), false);
  turn = 2;
  table.faux.setResponses([call('lookup', {kind: 'historical_reference', query: challengeQuery, reference_mode: 'web'}), context => {
    assert.equal(bodyOf(context).pricing.strategy, 'check_challenged_quote');
    return call('narrate', {text: 'The historical reference gives a comparable coffee price; the proposed quotation remains open for discussion.'});
  }, fauxAssistantMessage('Done.')]);
  await table.session.prompt(challenge); await waitForIdle(table.session);
  assert.deepEqual(queries, [anchorQuery, challengeQuery], JSON.stringify({playerInputs,
    lookups: table.session.messages.filter(m => m.role === 'toolResult' && m.toolName === 'lookup').map(m => m.content),
    errors: table.extensionErrors}));
  assert.equal(playerInputs.at(-1), challenge);
  assert.deepEqual(table.extensionErrors, []);
});
