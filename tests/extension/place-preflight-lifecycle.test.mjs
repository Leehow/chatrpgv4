/** Real Pi preparation/result seam, controlled provider; not gameplay acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
const call=args=>fauxAssistantMessage([fauxToolCall('place',args)],{stopReason:'toolUse'});
test('stringified arrays receive an actionable structured refusal without parsing or executing them',async t=>{
 const table=await openTable({responses:[call({action:'move',to:'Station',via:'The main entrance',additions:'[{"name":"Station"'}),fauxAssistantMessage('Stopped fixture.')]});
 t.after(()=>table.dispose());await table.session.prompt('I enter the station.');await waitForIdle(table.session);
 const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='place');
 assert.equal(result.details?.coc_error?.details?.reason,'place_array_required');
 assert.equal(result.details.coc_error.details.field,'additions');
 assert.equal(result.details.coc_error.details.transaction_state,'uncommitted');
 assert.match(result.details.coc_error.fix,/JSON array/);
 assert(table.telemetry().some(row=>row.lane==='refusals'&&row.reason==='place_preflight_refused'));
 assert.equal(table.kernelRequests().filter(row=>row.method==='table.apply').length,0);
});
test('an invented road row has a specific structured uncommitted refusal before SDK validation',async t=>{
 const table=await openTable({responses:[call({action:'move',to:'Shop',via:'The street',travel_band:'neighborhood_stroll'}),fauxAssistantMessage('Stopped fixture.')]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the shop.');await waitForIdle(table.session);
 const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='place');
 assert.equal(result.details.coc_error.details.reason,'travel_band_unknown');
 assert.deepEqual(result.details.coc_error.details.options,['adjacent','local_travel','long_travel']);
 assert.equal(result.details.coc_error.details.transaction_state,'uncommitted');
 assert.equal(table.kernelRequests().filter(row=>row.method==='table.apply').length,0);
});
test('unrelated SDK validation errors are not relabeled as owned preflight failures',async t=>{
 const table=await openTable({responses:[call({action:'invented',to:'Shop'}),fauxAssistantMessage('Stopped fixture.')]});
 t.after(()=>table.dispose());await table.session.prompt('I go into the shop.');await waitForIdle(table.session);
 const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='place');
 assert.equal(result.isError,true);assert.equal(result.details?.place_preflight,undefined);
 assert(!table.telemetry().some(row=>row.reason==='place_preflight_refused'));
});
test('three separate failed preparations use the existing class limit and end as failure',async t=>{
 const args={action:'inspect',to:'Shop',via:'The street'};
 const table=await openTable({responses:[call(args),call(args),call(args),call({action:'move',to:'Shop'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I go into the shop.');await waitForIdle(table.session);
 const results=table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='place');
 assert.equal(results.filter(message=>message.details?.place_preflight).length,3);
 assert(results.every(message=>message.isError));
 assert(table.telemetry().some(row=>row.lane==='refusals'&&row.reason==='class_limit'&&row.count===3));
 assert(table.telemetry().some(row=>row.event==='input_ended'&&row.cause==='parameter_protocol_repeated'));
 assert.equal(table.kernelRequests().filter(row=>row.method==='table.apply').length,0);
});
test('conflicting explicit targets retain their refusal without re-routing the rejected write',async t=>{
 const table=await openTable({responses:[call({action:'move',name:'Inn',to:'Shop'}),fauxAssistantMessage('Stopped fixture.')]});
 t.after(()=>table.dispose());await table.session.prompt('I go to the inn.');await waitForIdle(table.session);
 const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='place');
 assert.match(result.details.coc_error.message,/conflicting name and to/);
 assert.equal(table.kernelRequests().filter(row=>row.method==='table.apply').length,0);
});
test('a native read/write conflict retains its structured cause and reaches refusal accounting',async t=>{
 const table=await openTable({responses:[call({action:'inspect',to:'Shop',via:'The street',additions:[{name:'Shop',description:'A shop.'}]}),fauxAssistantMessage('Stopped fixture.') ]});
 t.after(()=>table.dispose());
 await table.session.prompt('I go into the shop.');await waitForIdle(table.session);
 const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='place');
 assert.equal(result.isError,true);assert.equal(result.details?.coc_error?.details?.reason,'place_mode_conflict');
 assert.equal(result.details.coc_error.details.transaction_state,'uncommitted');
 assert.match(result.details.coc_error.fix,/action:"move"/);
 assert(table.telemetry().some(row=>row.lane==='refusals'&&row.reason==='place_preflight_refused'));
 assert.equal(table.kernelRequests().filter(row=>row.method==='table.apply').length,0);
});
