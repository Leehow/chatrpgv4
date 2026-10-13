import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, chmodSync, existsSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, customMessages} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';

const root = resolve(import.meta.dirname, '../..');
function seedOpening(workspace, choice=false) {
  const input = [['table.open',{}], ['table.narrate',{call_id:'t0-c1',text:'You are in the office. Knott waits beside his desk.'}]];
  if(choice)input.push(['table.player_input',{text:'I consider whether to push the failed attempt.'}],
    ['table.ask',{call_id:'t1-c1',kind:'mechanics',options:['accept','push'],text:'You pause before deciding.'}]);
  const result = spawnSync(process.execPath,[join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],{
    cwd:root,encoding:'utf8',input:input.map(([method,params],id)=>JSON.stringify({id:String(id),method,params:{campaign:'test-camp',...params}})).join('\n')+'\n'});
  assert.equal(result.status,0,result.stderr);
  for (const line of result.stdout.trim().split('\n')) {const frame=JSON.parse(line);if(!frame.progress)assert.equal(frame.ok,true,JSON.stringify(frame));}
}
const plan = {version: 1, materials: [
  {name: 'cold room', text: 'The room is cold.', kind: 'description', visibility: 'player', required: true},
  {name: 'culprit', text: 'PRIVATE_CULPRIT', kind: 'context', visibility: 'keeper'},
], required: ['cold room']};

test('repeated material checks remain private and only explicit output publishes once', async t => {
  let table,midpoint;
  const check=()=>fauxAssistantMessage([fauxToolCall('narrate',{delivery:plan})],{stopReason:'toolUse'});
  table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},
    responses:[check(),check(),()=>{
      midpoint={writerStarts:table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,
        published:existsSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'))};
      return fauxAssistantMessage([fauxToolCall('output',{})],{stopReason:'toolUse'});
    }]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.deepEqual(midpoint,{writerStarts:0,published:false});
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.ok(record.commit);
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,1);
});

test('selected final output publishes the writer artifact and retains its provenance for memory', async t => {
  const table = await openTable({legacyDeliveryFixtures:false,realKernel: true, prepareWorkspace:seedOpening, env: {
    PI_COC_READER_CMD: JSON.stringify([process.execPath, join(root, 'tests/extension/fixtures/final-output-writer.mjs')]),
  }, responses: [fauxAssistantMessage([fauxToolCall('output', {delivery: plan})], {stopReason: 'toolUse'})]});
  t.after(() => table.dispose());
  assert.deepEqual(table.extensionErrors, []);
  assert.ok(table.activeTools().includes('narrate'));
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors, []);
  const errors = table.session.messages.filter(m => m.role === 'toolResult' && m.details?.coc_error).map(m => m.details.coc_error);
  assert.deepEqual(errors, [], JSON.stringify(errors));
  const path = join(table.workspace, '.coc/campaigns/test-camp/turns/0001.json');
  assert.ok(existsSync(path), JSON.stringify(table.session.messages.map(m=>({role:m.role,stop:m.stopReason,error:m.errorMessage,content:m.content})))+' '+JSON.stringify(readdirSync(join(table.workspace,'.coc/campaigns/test-camp/turns'))));
  const record = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(record.rendered_text, 'The room is chilly.');
  assert.ok(record.commit, 'publication follows the canonical Git owner');
  assert.equal(record.delivery_evidence.version, 1);
  assert.equal(record.delivery_evidence.coverage[0].name, 'cold room');
  assert.equal(record.delivery_evidence.coverage[0].start,0);
  assert.equal(record.delivery_evidence.coverage[0].end,19);
  assert.ok(!JSON.stringify(record.delivery_evidence).includes('PRIVATE_CULPRIT'));
  assert.equal(customMessages(table.session, 'coc-mechanics').length, 0);
  const packet = await table.runtimeBridges().at(-1).call('memory.job',{campaign:'test-camp',turn:1});
  assert.equal(packet.delivery_evidence.coverage[0].name,'cold room');
  assert.ok(!packet.committed_facts.some(text=>text.includes('The room is cold.')), 'a portrayal proposal is not promoted into a settled fact');
});

test('a direct OOC answer never starts the final writer or changes fictional state', async t => {
  const decision = {async decide(batch) {return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q =>
    q.type === 'noul' ? [q.key,{status:'answered',type:'noul',noul:q.key==='system_request'?.99:.01}]
      : [q.key,{status:'answered',type:'choice',choice:'finish',confidence:1,probabilities:{finish:1}}])),{inputTokens:1,outputTokens:1,costUsd:0});}};
  const engine = createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision,npcAct:null});
  const answer = 'A bonus die changes the tens digit selection; this explanation does not advance the scene.';
  let world;
  const table = await openTable({legacyDeliveryFixtures:false,realKernel:true,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},runDriver:engine.runDriver,
    extraExtensions:[{name:'scope-engine',factory:engine.extension}],prepareWorkspace:workspace=>{seedOpening(workspace);world=readFileSync(join(workspace,'.coc/campaigns/test-camp/world.json'),'utf8');},
    responses:[fauxAssistantMessage(answer)]});
  t.after(()=>table.dispose());
  await table.session.prompt('Pause the fiction. Explain bonus dice to me as the player.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'),world);
  assert.ok(table.session.messages.some(m=>m.role==='assistant'&&m.content?.some(c=>c.type==='text'&&c.text===answer)));
  assert.equal(customMessages(table.session,'coc-delivery').filter(m=>m.display===true&&m.content===answer).length,0,
    'the direct answer is not repeated by the pending story-delivery backstop');
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output').length,0);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.interaction_scope,'reference');
  assert.equal(record.rendered_text,answer);
  assert.equal(record.receipts.length,0);
  assert.equal(record.delivery_evidence,undefined);
});

test('an ordinary direct answer stays visible when optional Jev is unconfigured', async t => {
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
  const answer='Visible sounds are described directly; uncertain hidden sounds may require a check. The fiction remains paused.';
  let world;
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,
    prepareWorkspace:workspace=>{seedOpening(workspace);world=readFileSync(join(workspace,'.coc/campaigns/test-camp/world.json'),'utf8');},
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},runDriver:engine.runDriver,extraExtensions:[{name:'unconfigured-scope',factory:engine.extension}],
    responses:[fauxAssistantMessage(answer)]});
  t.after(()=>table.dispose());
  await table.session.prompt('Pause the game. Explain when hearing calls for a check.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.ok(table.session.messages.some(m=>m.role==='assistant'&&m.content?.some(c=>c.type==='text'&&c.text===answer)));
  assert.equal(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'),world);
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output').length,0);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.interaction_scope,'reference');
  assert.deepEqual(record.receipts,[]);
  assert.deepEqual(record.speech,[]);
});

test('apply-carried writing runs after the settled effects and publishes once', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},
    responses:[fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:1}],delivery:plan})],{stopReason:'toolUse'}),fauxAssistantMessage([fauxToolCall('output',{})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I spend one minute looking around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.equal(record.receipts.filter(r=>r.kind==='time').length,1);
  assert.ok(record.delivery_evidence);
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,1);
});

test('ask can select the same writer without replacing its pending mechanical choice', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},
    responses:[fauxAssistantMessage([fauxToolCall('output',{delivery:plan,choice:{kind:'mechanics',options:['accept','push']}})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I pause before deciding whether to take the risk.');
  assert.deepEqual(table.extensionErrors,[]);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.closed_by,'ask');
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.ok(record.delivery_evidence);
  const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(status.state,'asked');
  assert.deepEqual(status.pending_choice.options,['accept','push']);
});

test('an OOC explanation preserves an already pending choice for the next player input', async t => {
  const decision={async decide(batch){return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>q.type==='noul'
    ?[q.key,{status:'answered',type:'noul',noul:q.key==='system_request'?.99:.01}]
    :[q.key,{status:'answered',type:'choice',choice:'finish',confidence:1,probabilities:{finish:1}}])),{inputTokens:1,outputTokens:1,costUsd:0});}};
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision,npcAct:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:workspace=>seedOpening(workspace,true),
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},runDriver:engine.runDriver,extraExtensions:[{name:'scope-engine',factory:engine.extension}],
    responses:[fauxAssistantMessage('Pushing attempts the task again and carries greater consequences on failure. You have not chosen yet.')]});
  t.after(()=>table.dispose());
  const bridge=table.runtimeBridges().at(-1);
  const before=await bridge.call('table.status',{campaign:'test-camp'});
  await table.session.prompt('Pause the fiction. Explain pushing before I choose.');
  assert.deepEqual(table.extensionErrors,[]);
  const after=await bridge.call('table.status',{campaign:'test-camp'});
  assert.deepEqual(after.pending_choice,before.pending_choice);
  assert.equal(table.telemetry().filter(r=>r.lane==='final-output').length,0);
});

test('a rejected writer artifact cannot become an implicitly delivered raw fallback', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')]),PI_COC_TEST_BAD_COVERAGE:'1'},
    responses:[fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'}),fauxAssistantMessage('RAW_FALLBACK_MUST_STAY_PRIVATE')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  const path=join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json');
  if(existsSync(path)) {
    const retained=JSON.parse(readFileSync(path,'utf8'));
    assert.ok(!retained.commit,'an unfinished retained record is not a publication');
    assert.ok(!String(retained.rendered_text??retained.text??'').includes('RAW_FALLBACK'));
  }
  assert.ok(!table.session.messages.filter(m=>m.role==='assistant').some(m=>m.content?.some(c=>c.type==='text'&&c.text.includes('RAW_FALLBACK'))));
});

test('a failed Git commit retries the exact accepted artifact without another writer task', async t => {
  const reply=()=>fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:workspace=>{
    seedOpening(workspace);
    const hook=join(workspace,'.coc/repos/test-camp.git/hooks/pre-commit');
    writeFileSync(hook,'#!/bin/sh\nmarker="$(git rev-parse --git-dir)/commit-once-marker"\nif test -e "$marker"; then exit 0; fi\ntouch "$marker"\nexit 1\n');
    chmodSync(hook,0o700);
  },env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},responses:[reply(),reply()]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.ok(record.commit);
  assert.equal(table.telemetry().filter(r=>r.lane==='final-output'&&r.event==='start').length,1);
});

test('mixed input displays the framed OOC reply separately from the selected story artifact', async t => {
  let visibilityRemembered=false;
  const decision={async decide(batch){return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>q.type==='noul'
    ?[q.key,{status:'answered',type:'noul',noul:['system_request','world_action'].includes(q.key)?.99:.01}]
    :[q.key,{status:'answered',type:'choice',choice:'finish',confidence:1,probabilities:{finish:1}}])),{inputTokens:1,outputTokens:1,costUsd:0});}};
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision,npcAct:null});
  const explanation='Bonus dice change which tens digit is selected.';
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',
    PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},
    runDriver:engine.runDriver,extraExtensions:[{name:'scope-engine',factory:engine.extension}],
    responses:[fauxAssistantMessage([{type:'text',text:`{{ooc}}${explanation}{{/ooc}}`},fauxToolCall('narrate',{delivery:plan})],{stopReason:'toolUse'}),context=>{
      visibilityRemembered=context.messages.some(message=>(typeof message.content==='string'?message.content:JSON.stringify(message.content)).includes('already queued for display'));
      return fauxAssistantMessage([fauxToolCall('output',{})],{stopReason:'toolUse'});
    }]});
  t.after(()=>table.dispose());
  await table.session.prompt('Explain bonus dice to me, then I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(table.session.messages.filter(m=>m.customType==='coc-delivery'&&m.details?.reference_reply&&m.content===explanation).length,1);
  assert.equal(visibilityRemembered,true,'the next Keeper step knows the direct reply is queued for display');
  assert.ok(!table.session.messages.some(m=>m.role==='assistant'&&m.content?.some(c=>c.type==='text'&&c.text===explanation)));
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.ok(!record.text.includes(explanation));
  assert.ok(!JSON.stringify(record.delivery_evidence).includes('already queued for display'),'private reply status is never writer material');
  assert.equal(table.telemetry().filter(r=>r.lane==='final-output'&&r.event==='start').length,1);
});

test('an issued public transcript source is materialized without the Keeper retyping its text', async t => {
  let observed;
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')]),PI_COC_TEST_EXPECT_SOURCE:'1'},
    responses:[fauxAssistantMessage([fauxToolCall('recall',{what:'transcript',read:{turn:0,role:'keeper'}})],{stopReason:'toolUse'}),context=>{
      const last=context.messages.filter(m=>m.role==='toolResult').at(-1);
      const read=JSON.parse(last.content.find(c=>c.type==='text').text);
      const inventory=table.runtimeBridges().at(-1).materialSources(1);
      const name=inventory.at(-1).name;
      const body=context.messages.map(m=>typeof m.content==='string'?m.content:(m.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')).join('\n');
      observed={name,visible:body.includes(name),contexts:table.telemetry().filter(row=>row.lane==='context').slice(-4),
        roles:context.messages.map(m=>({role:m.role,custom:m.customType,tail:(typeof m.content==='string'?m.content:JSON.stringify(m.content)).slice(-180)}))};
      assert.ok(typeof read.text==='string',JSON.stringify(read));
      return fauxAssistantMessage([fauxToolCall('output',{delivery:{...plan,sources:[name]}})],{stopReason:'toolUse'});
    }]});
  t.after(()=>table.dispose());
  await table.session.prompt('I recall what was said, then look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(observed?.visible,true,JSON.stringify(observed));
  assert.deepEqual(table.session.messages.filter(m=>m.role==='toolResult'&&m.details?.coc_error).map(m=>m.details.coc_error),[]);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.',JSON.stringify(table.session.messages.filter(m=>m.role==='assistant').map(m=>({stop:m.stopReason,error:m.errorMessage,content:m.content}))).slice(-2500));
  assert.ok(record.delivery_evidence.materials.some(row=>row.authority==='reference_only'&&row.text.includes('You are in the office.')));
});

test('a fabricated source reference refuses the selected writer before it starts', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    responses:[fauxAssistantMessage([fauxToolCall('output',{delivery:{...plan,sources:['unissued source']}})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(table.telemetry().filter(r=>r.lane==='final-output'&&r.event==='start').length,0);
  assert.ok(table.session.messages.some(m=>m.role==='toolResult'&&m.content?.some(c=>c.type==='text'&&c.text.includes('not issued'))));
});

for (const raw of [JSON.stringify({delivery:plan}), JSON.stringify(plan)]) test('an unselected delivery object stays private until an explicit tool call: '+raw.slice(0,25), async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},
    responses:[fauxAssistantMessage(raw),fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.ok(!table.session.messages.some(m=>m.role==='assistant'&&m.content?.some(c=>c.type==='text'&&c.text===raw)));
  const path=join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json');
  if(existsSync(path))assert.equal(JSON.parse(readFileSync(path,'utf8')).rendered_text,'The room is chilly.');
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,1);
});

test('a restarted writing owner reuses the accepted artifact before canonical publication', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])}});
  t.after(()=>table.dispose());
  const bridge=table.runtimeBridges().at(-1),events=[];
  await bridge.call('table.player_input',{campaign:'test-camp',text:'I look around.'});
  const deps={runtime:()=>bridge.runtime,call:bridge.call,record:async row=>events.push(row),model:()=>({provider:'test',id:'writer'})};
  const first=await createFinalOutputOwner(deps).write('test-camp',1,plan);
  const recovered=await createFinalOutputOwner(deps).write('test-camp',1,plan);
  assert.deepEqual(recovered,first);
  assert.equal(events.filter(row=>row.event==='start').length,1);
  assert.equal(events.filter(row=>row.event==='cache_reused').length,1);
  assert.equal(existsSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')),false);
});

test('an invalid first artifact can retry the same immutable checker and publish one valid result', async t => {
  const response=()=>fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')]),PI_COC_TEST_BAD_ONCE:'1'},
    responses:[response(),response()]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(record.commit);
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,2);
});

test('a settled change during inference rejects the frozen draft and preserves the effect', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])}});
  t.after(()=>table.dispose());
  const bridge=table.runtimeBridges().at(-1);
  await bridge.call('table.player_input',{campaign:'test-camp',text:'I spend one minute looking around.'});
  const runtime={...bridge.runtime,async runTask(task,signal){
    const outcome=await bridge.runtime.runTask(task,signal);
    await bridge.call('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'time',minutes:1}]});
    return outcome;
  }};
  const owner=createFinalOutputOwner({runtime:()=>runtime,call:bridge.call,record:async()=>{},model:()=>({provider:'test',id:'writer'})});
  await assert.rejects(owner.write('test-camp',1,plan),/snapshot changed/);
  const status=await bridge.call('table.status',{campaign:'test-camp'});
  assert.equal(status.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(existsSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')),false);
});

test('Keeper continuity receipts remain canonical but never enter the player author packet',async t=>{
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])},
    responses:[fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'note',name:'PRIVATE_CULPRIT',text:'Recheck the private source before drawing conclusions.'}]})],{stopReason:'toolUse'}),
      fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());await table.session.prompt('I look around without touching anything.');
  const path=join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json');
  assert.ok(existsSync(path),'the selected author publishes the public portrayal');
  const record=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.ok(record.receipts.some(r=>r.kind==='note'),'private continuity remains in canonical state');
});

const writerEnv={PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])};
const shownTexts=table=>table.session.messages.filter(m=>m.role==='assistant').flatMap(m=>(m.content??[]).filter(c=>c.type==='text').map(c=>c.text));
const scopeEngine=worldAction=>createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},npcAct:null,decision:{async decide(batch){
  return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>q.type==='noul'
    ?[q.key,{status:'answered',type:'noul',noul:q.key==='world_action'?worldAction:q.key==='system_request'?1-worldAction:.01}]
    :[q.key,{status:'answered',type:'choice',choice:'finish',confidence:1,probabilities:{finish:1}}])),{inputTokens:1,outputTokens:1,costUsd:0});}}});

test('bare story prose after settled effects is never published as a reference answer (§233.10)', async t => {
  const prose='BARE_STORY_PROSE You wait. {{say:Knott}}"Sit down."{{/say}}';
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv,
    responses:[fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:1}]})],{stopReason:'toolUse'}),
      fauxAssistantMessage(prose),fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait one minute.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.ok(!shownTexts(table).some(text=>text.includes('BARE_STORY_PROSE')),'the unselected prose never reaches the player');
  assert.ok(table.telemetry().some(row=>row.lane==='delivery'&&row.reason==='explicit_output_not_selected'&&row.owed==='receipts'));
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.interaction_scope,undefined,'the world turn is not recorded as an out-of-fiction answer');
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.equal(record.receipts.filter(r=>r.kind==='time').length,1);
  assert.ok(record.facts,'the settled turn keeps its fact path for memory');
  assert.ok(!JSON.stringify(record).includes('BARE_STORY_PROSE'));
});

test('a settled world verdict keeps bare prose private even before any effect lands', async t => {
  const engine=scopeEngine(.99);
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1',...writerEnv},runDriver:engine.runDriver,extraExtensions:[{name:'scope-engine',factory:engine.extension}],
    responses:[fauxAssistantMessage('BARE_WORLD_PROSE Knott looks up from his desk.')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I walk over to Knott and greet him.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.ok(!shownTexts(table).some(text=>text.includes('BARE_WORLD_PROSE')));
  assert.ok(table.telemetry().some(row=>row.lane==='delivery'&&row.reason==='explicit_output_not_selected'&&row.owed==='world_scope'));
  const path=join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json');
  if(existsSync(path))assert.notEqual(JSON.parse(readFileSync(path,'utf8')).interaction_scope,'reference');
});

test('a framed reply with story text beside it shows the reply alone, frame and tokens removed', async t => {
  const explanation='Pushing repeats the attempt with harsher consequences.';
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv,
    responses:[fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:1}]})],{stopReason:'toolUse'}),
      fauxAssistantMessage(`{{ooc}}${explanation}{{/ooc}}\nFRAMED_STORY {{say:Knott}}"Go on."{{/say}}`),
      fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('What does pushing do? I wait one minute.');
  assert.deepEqual(table.extensionErrors,[]);
  const shown=shownTexts(table);
  assert.ok(!shown.some(text=>/\{\{(ooc|\/ooc|say:)/.test(text)),JSON.stringify(shown));
  assert.ok(!shown.some(text=>text.includes('FRAMED_STORY')));
  assert.equal(table.session.messages.filter(m=>m.customType==='coc-delivery'&&m.details?.reference_reply&&m.content===explanation).length,1);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
});

test('an unframed direct answer is shown as the kernel recorded it, never with raw tokens', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    responses:[fauxAssistantMessage('{{ooc}}A bonus die keeps the better tens digit.{{/ooc}}')]});
  t.after(()=>table.dispose());
  await table.session.prompt('Pause. How do bonus dice work?');
  assert.deepEqual(table.extensionErrors,[]);
  const shown=shownTexts(table);
  assert.deepEqual(shown,['A bonus die keeps the better tens digit.']);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.interaction_scope,'reference');
  assert.deepEqual(record.receipts,[]);
});

test('the selected author runs on the Keeper model, not a fixed one', async t => {
  let keeper;
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv,
    responses:[context=>fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  keeper=`${table.session.model.provider}/${table.session.model.id}`;
  assert.notEqual(keeper,'grok-build/grok-4.5');
  const start=table.telemetry().find(row=>row.lane==='final-output'&&row.event==='start');
  assert.equal(start.model,keeper);
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.rendered_text,'The room is chilly.');
  assert.equal(record.delivery_evidence.model,keeper);
});

test('an author that ran on another model than the Keeper is refused', async t => {
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{...writerEnv,PI_COC_TEST_WRITER_ACTUAL:'grok-build/grok-4.5'},
    responses:[fauxAssistantMessage([fauxToolCall('output',{delivery:plan})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I look around without touching anything.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.ok(table.session.messages.some(m=>m.role==='toolResult'&&m.content?.some(c=>c.type==='text'&&c.text.includes('did not verify the expected model'))));
  const path=join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json');
  if(existsSync(path))assert.ok(!JSON.parse(readFileSync(path,'utf8')).commit);
});
