/** Real Pi and production TS kernel: unrelated parameter errors must not strand a corrected turn. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const CAMPAIGN='test-camp';
const call=effects=>fauxAssistantMessage([fauxToolCall('apply',{effects})],{stopReason:'toolUse'});
const time=minutes=>({kind:'time',minutes,why:'Wait here for the response.'});

async function preparedTable(t,responses){
  let scene;
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},extraExtensions:[{name:'driver',factory:engine.extension}],
    async prepareWorkspace(workspace){
      const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'refusal-identity',
        locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
      const runtime=api.createKernelRuntime(context);
      try{
        await runtime.handlers['table.open']({campaign:CAMPAIGN});
        const capsule=await runtime.handlers['table.capsule']({campaign:CAMPAIGN});
        scene=capsule.where.scene;
        assert.equal(typeof scene,'string');
        await runtime.handlers['table.narrate']({campaign:CAMPAIGN,call_id:'t0-c1',text:'The previous conversation is complete.'});
      }finally{await runtime.close();}
    },responses:responses(()=>scene)});
  t.after(()=>table.dispose());
  await table.session.prompt('I stay here and wait five minutes for the response.');
  assert.deepEqual(table.extensionErrors,[]);
  return table;
}

const results=table=>table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply');
const text=message=>(message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');

test('two invalid durations and a different parameter error leave the corrected action and public delivery available',async t=>{
  const prose='You remain where you are. Five minutes pass as you wait for the response.';
  const table=await preparedTable(t,scene=>[
    call([time(-1)]),call([time(-2)]),()=>call([{kind:'move',to:scene()}]),call([time(5)]),
    fauxAssistantMessage('{{public}}'+prose)]);
  const applied=results(table);
  assert.equal(applied.length,4);
  assert.deepEqual(applied.slice(0,3).map(result=>result.details.coc_error?.code),['invalid_params','invalid_params','invalid_params']);
  assert.equal(applied[0].details.coc_error.message,'minutes must be a non-negative integer');
  assert.equal(applied[1].details.coc_error.message,'minutes must be a non-negative integer');
  assert.match(applied[2].details.coc_error.message,/is where the party already stands/);
  assert.equal(applied[3].isError,false,'the corrected action must reach the real kernel after the unrelated error');
  assert.ok(applied[3].details.receipts.some(receipt=>String(receipt).startsWith('time:')));
  const committed=table.committed();
  assert.equal(committed.length,1);
  assert.equal(committed[0].rendered_text,prose,'the canonical public response is committed and delivered on the public bus');
  const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:CAMPAIGN,projection:'receipts',
    expected_turn:committed[0].turn,expected_commit:committed[0].commit});
  assert.equal(status.receipts.find(receipt=>receipt.kind==='time')?.minutes,5);
  assert.equal(table.telemetry().some(row=>row.lane==='refusals'&&row.reason==='class_limit'),false);
  assert.equal(table.telemetry().some(row=>row.reason==='refusal_budget'),false);
});

test('unchanged invalid calls still stop after the existing two parameter refusals',async t=>{
  const table=await preparedTable(t,()=>[
    call([time(-1)]),call([time(-1)]),call([time(-1)]),
    fauxAssistantMessage('{{public}}You remain where you are; no waiting interval has been settled.')]);
  const applied=results(table);
  assert.equal(applied.length,3);
  assert.equal(applied[0].details.coc_error.message,'minutes must be a non-negative integer');
  assert.equal(applied[1].details.coc_error.message,'minutes must be a non-negative integer');
  assert.match(text(applied[2]),/refused these parameters 2 times/);
  assert.equal(table.telemetry().filter(row=>row.code==='blocked'&&String(row.reason).includes('refused these parameters 2 times')).length,1);
});

test('changing parameters without fixing the same error still reaches the existing three-strike class limit',async t=>{
  const table=await preparedTable(t,()=>[
    call([time(-1)]),call([time(-2)]),call([time(-3)]),call([time(-4)]),
    fauxAssistantMessage('{{public}}You remain where you are; no waiting interval has been settled.')]);
  const applied=results(table);
  assert.equal(applied.length,4);
  assert.ok(applied.slice(0,3).every(result=>result.details.coc_error?.message==='minutes must be a non-negative integer'));
  assert.match(text(applied[3]),/refused 3 times this turn for the same reason/);
  assert.equal(table.telemetry().filter(row=>row.lane==='refusals'&&row.reason==='class_limit').length,1);
  assert.equal(table.telemetry().filter(row=>row.code==='blocked'&&row.reason==='refusal_budget').length,1);
});
