/** Real Pi background-lane transport with deterministic replies, never live-play acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable, waitFor} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {RpcClient} from '../integration/support.ts';
import {MEMORY_ATTRIBUTION_POLICY} from '../../kernel-ts/memory/attribution.ts';
import {REPLY_EVIDENCE_BYTES} from '../../extensions/lanes/subsession.ts';

const privateMarker='PRIVATE_MEMORY_DIAGNOSTIC';
const publicText='The clerk waits beside the desk.';
const candidate={kind:'knowledge',subject:'Thomas Hayes',statement:'Hayes heard the clerk offer an appointment.',knowers:['Thomas Hayes'],privacy:'player_safe',state:'accurate'};
const story={status:'unclear',thread:null,frame:null,bridge_delivered:false,delivery_quote:null};
const packet=(turn,overrides={})=>({job_id:`extract:test-camp:t${turn}`,turn,player_text:'I ask for an appointment.',keeper_text:publicText,
  known_entities:[{name:'Thomas Hayes',kind:'investigator'}],...overrides});
const promptText=context=>context.messages.filter(row=>row.role==='user').flatMap(row=>row.content??[])
  .filter(block=>block.type==='text').map(block=>block.text).join('\n');
const outcomeRows=table=>table.telemetry().filter(row=>row.lane==='memory'&&typeof row.ok==='boolean');

test('malformed attempts retain bounded private stages without changing retries, submits or outage accounting',{timeout:20000},async t=>{
  const badCandidates=JSON.stringify({marker:privateMarker,candidates:privateMarker+'é'.repeat(600)});
  const badStory=JSON.stringify({candidates:[candidate],story:{marker:privateMarker,padding:'é'.repeat(600)}});
  const badReview=JSON.stringify({marker:privateMarker,verdict:'supported',issues:[],padding:'é'.repeat(600)});
  const requests=[],replies=[badCandidates,badCandidates,badStory,badStory,JSON.stringify({candidates:[candidate]}),badReview,JSON.stringify({candidates:[candidate]}),badReview];
  const statuses=[],statusEvents=[];
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
    env:{PI_COC_MEMORY_BACKFILL:'0',PI_COC_LOOP_ENGINE:'hybrid-v1'},extraExtensions:[{name:'driver',factory:engine.extension},
      {name:'status-probe',factory:pi=>{pi.events.on('coc:lane-status',status=>statusEvents.push(status));}}],
    async prepareWorkspace(workspace){const seed=new RpcClient(workspace);try{
      await seed.ok('table.open',{campaign:'test-camp'});
      await seed.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You are in the office with the clerk.'});
    }finally{await seed.close();}},
    laneResponses:{memory:replies.map(raw=>context=>{requests.push(promptText(context));return fauxAssistantMessage(raw);})},
    responses:[fauxAssistantMessage('{{public}}'+publicText)]});
  t.after(()=>table.dispose());
  const submits=[],fails=[];
  table.emit('coc:kernel-bridge',{campaign:'test-camp',call:async(method,params)=>{
    if(method==='memory.job')return packet(params.turn,params.turn===2?{story_context:{threads:[{thread:'appointment'}]}}:
      params.turn===3?{attribution_policy:MEMORY_ATTRIBUTION_POLICY}:{});
    if(method==='memory.submit')submits.push(params);
    if(method==='memory.fail')fails.push(params);
    return {};
  }});
  // The first job is queued by the real Pi delivery; later committed fixture events use the same existing queue.
  await table.session.prompt('I ask for an appointment.');
  await waitFor(()=>outcomeRows(table).length===1);
  assert.equal(table.entries('coc-lane-status').length,0,'one failed job is one outage observation');
  for(const turn of [2,3]){
    table.emit('coc:turn-committed',{campaign:'test-camp',turn});
    await waitFor(()=>outcomeRows(table).length===turn);
    if(turn===2)assert.equal(table.entries('coc-lane-status').length,0,'diagnostics do not double-count attempts');
  }
  assert.equal(requests.length,8,'two extraction tries, with review only after accepted extraction');
  assert.equal(submits.length,0);
  assert.equal(fails.length,3);
  assert.ok(fails.every(row=>row.reason==='model_error'&&row.detail==='the JSON is not the shape this lane asked for'));
  const diagnostics=table.telemetry().filter(row=>row.lane==='memory'&&row.event==='malformed_reply');
  assert.equal(diagnostics.length,6,'first and retry failures are both retained');
  assert.deepEqual(table.entries('coc-telemetry').filter(row=>row.lane==='memory'&&row.event==='malformed_reply'),diagnostics,
    'the existing session and campaign private telemetry retain the same evidence');
  assert.deepEqual(diagnostics.map(row=>row.stage),['candidates','candidates','story','story','attribution_review','attribution_review']);
  for(const row of diagnostics){
    assert.equal(row.reason,'bad_output');
    assert.equal(Object.hasOwn(row,'ok'),false);
    assert.equal(Object.hasOwn(row,'detail'),false);
    assert.equal(row.reply.stop_reason,'stop');
    assert.deepEqual(row.reply.blocks,['text']);
    assert.ok(row.reply.text_bytes>REPLY_EVIDENCE_BYTES);
    assert.ok(Buffer.byteLength(row.reply.head)<=REPLY_EVIDENCE_BYTES);
    assert.ok(Buffer.byteLength(row.reply.tail??'')<=REPLY_EVIDENCE_BYTES);
    assert.ok(JSON.stringify(row.reply).includes(privateMarker));
  }
  for(const [index,stage] of [[1,'candidates'],[3,'story'],[6,'attribution_review'],[7,'attribution_review']]){
    const feedback=requests[index].split('[Previous attempt failed:')[1];
    assert.ok(feedback?.includes(stage),'retry names the structural stage');
    assert.ok(!feedback.includes(privateMarker),'retry feedback never quotes the reply');
  }
  statuses.push(...table.entries('coc-lane-status'));
  assert.equal(statuses.length,1);assert.equal(statuses[0].streak,3);
  assert.deepEqual(statusEvents,statuses);
  const publicFrames=table.entries('coc-final-delivery');
  assert.ok(publicFrames.some(row=>row.event==='delta'),'the fixture crosses the actual public-delivery stream');
  assert.ok(!JSON.stringify([...publicFrames,...statuses]).includes(privateMarker));
  assert.deepEqual(table.extensionErrors,[]);
});

test('successful candidate, story and attribution review retain the original submission and outcome',{timeout:10000},async t=>{
  const submits=[],fails=[];
  const table=await openTable({env:{PI_COC_MEMORY_BACKFILL:'0'},laneResponses:{memory:[
    fauxAssistantMessage(JSON.stringify({candidates:[candidate],story})),
    fauxAssistantMessage(JSON.stringify({verdict:'supported',issues:[]}))]}});
  t.after(()=>table.dispose());
  table.emit('coc:kernel-bridge',{campaign:'test-camp',call:async(method,params)=>{
    if(method==='memory.job')return packet(1,{attribution_policy:MEMORY_ATTRIBUTION_POLICY,story_context:{threads:[{thread:'appointment'}]}});
    if(method==='memory.submit')submits.push(params);
    if(method==='memory.fail')fails.push(params);
    return {};
  }});
  table.emit('coc:turn-committed',{campaign:'test-camp',turn:1});
  await waitFor(()=>outcomeRows(table).length===1);
  assert.deepEqual(submits,[{campaign:'test-camp',job_id:'extract:test-camp:t1',candidates:[candidate],story}]);
  assert.deepEqual(fails,[]);
  assert.equal(table.telemetry().filter(row=>row.lane==='lane-call'&&row.phase==='start'&&row.subsession==='memory').length,2);
  assert.equal(outcomeRows(table)[0].ok,true);
  assert.equal(outcomeRows(table)[0].story_status,'unclear');
  assert.equal(table.telemetry().filter(row=>row.event==='attribution_review').length,1);
  assert.equal(table.telemetry().filter(row=>row.event==='malformed_reply').length,0);
  assert.deepEqual(table.extensionErrors,[]);
});

test('missing JSON and conflicting accepted answers do not invent a candidate or story failure stage',{timeout:10000},async t=>{
  const fails=[],submits=[],requests=[];
  const table=await openTable({env:{PI_COC_MEMORY_BACKFILL:'0'},laneResponses:{memory:[
    context=>{requests.push(promptText(context));return fauxAssistantMessage(privateMarker+' no JSON');},
    context=>{requests.push(promptText(context));return fauxAssistantMessage(JSON.stringify({candidates:'invalid'})+'\n'+JSON.stringify({candidates:[candidate]})+'\n'+JSON.stringify({candidates:[]}));}]}});
  t.after(()=>table.dispose());
  table.emit('coc:kernel-bridge',{campaign:'test-camp',call:async(method,params)=>{
    if(method==='memory.job')return packet(1);
    if(method==='memory.fail')fails.push(params);
    if(method==='memory.submit')submits.push(params);
    return {};
  }});
  table.emit('coc:turn-committed',{campaign:'test-camp',turn:1});
  await waitFor(()=>outcomeRows(table).length===1);
  assert.deepEqual(table.telemetry().filter(row=>row.event==='malformed_reply').map(row=>row.stage),['extraction','extraction']);
  assert.equal(table.telemetry().filter(row=>row.lane==='lane-call'&&row.phase==='start'&&row.subsession==='memory').length,2);
  assert.equal(fails.length,1);assert.equal(fails[0].detail,'the reply held conflicting answers');
  const feedback=requests[1].split('[Previous attempt failed:')[1];
  assert.match(feedback,/no JSON object/);
  assert.match(feedback,/extraction/);
  assert.equal(feedback.includes(privateMarker),false,'no-object retry feedback never quotes the private reply');
  assert.deepEqual(submits,[]);
  assert.deepEqual(table.extensionErrors,[]);
});
