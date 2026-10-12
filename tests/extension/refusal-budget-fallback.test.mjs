/** Runaway aborts preserve settled effects without silently selecting a final writer. */
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
const barrage=fauxAssistantMessage(Array.from({length:16},(_,i)=>fauxToolCall('resolve',{
  action:{intent:'combat',goal:`Stop the attacker ${i}`,method:'Strike without a weapon'}
},{id:`r${i}`})),{stopReason:'toolUse'});
for(const reason of [undefined,'intent_result_owed','repeated_line']) test(`runaway abort never selects an automatic output (${reason??'no publication error'})`,async t=>{
  const table=await openTable({legacyDeliveryFixtures:false,responses:[barrage],env:reason?{
    FAKE_KERNEL_ERRORS:JSON.stringify({'table.narrate':{code:'needs',message:`Refused ${reason}`,details:{reason}}}),FAKE_KERNEL_ERRORS_ONCE:'1'
  }:{}});
  t.after(()=>table.dispose());await table.session.prompt('I attack without choosing a weapon.');await waitForIdle(table.session);
  assert.ok(table.telemetry().some(row=>row.lane==='runaway'&&row.after==='refusal_budget'&&row.aborted));
  assert.equal(table.telemetry().filter(row=>row.lane==='delivery'&&row.reason==='refusal_budget').length,1);
  assert.equal(table.kernelRequests().filter(row=>row.method==='table.narrate').length,0);
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0);
  assert.equal(table.committed().length,0);
  assert.ok(table.kernelRequests().some(row=>row.method==='table.release'&&row.params.release==='stranded'));
});
