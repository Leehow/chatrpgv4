import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {admissionRequest} from '../../extensions/kernel/admission.ts';
import {openTable} from './harness.mjs';

const scope={party:['Investigator'],scene:{handle:'study',label:'Study'}};
const take={kind:'object',name:'Chair',from:'here',to:'Investigator'};
const prepare={kind:'usage',object:'Chair',name:'swing',description:'Take the chair and swing it at the opponent.'};
const verdict=verdict=>fauxAssistantMessage(JSON.stringify({verdict,grounds:'Controlled admission response for this transport test.'}));
const responses=effects=>[
  fauxAssistantMessage([fauxToolCall('apply',{effects})],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('narrate',{text:'The proposed action has been considered. The investigator remains attentive to the room.'})],{stopReason:'toolUse'}),
  fauxAssistantMessage('after'),
];

test('physical object movement and chosen usage preparation are reviewed; pure adoption and state bookkeeping are not',()=>{
  assert.ok(admissionRequest('apply',{effects:[take,prepare]},scope));
  assert.ok(admissionRequest('apply',{effects:[prepare]},scope));
  assert.equal(admissionRequest('apply',{effects:[{kind:'define',name:'Chair',description:'An existing chair'},
    {kind:'object',name:'Chair',adopt:'Old equipment row',to:'Investigator'}]},scope),null);
  assert.equal(admissionRequest('apply',{effects:[{kind:'object',name:'Chair',from:'Investigator',to:'Investigator',condition:'damaged',why:'A recorded consequence.'}]},scope),null);
  assert.equal(admissionRequest('resolve',{action:{actor:'NPC',intent:'combat',object:'Chair',usage:'swing'}},scope),null);
});

test('admission keys bind the usage, object, staged definition and order rather than reusing another action permission',()=>{
  const proposal=effects=>admissionRequest('apply',{effects},scope);
  const first=proposal([take,prepare]);
  assert.notEqual(first.key,proposal([take,{...prepare,object:'Bottle'}]).key);
  assert.notEqual(first.key,proposal([take,{...prepare,name:'throw'}]).key);
  assert.notEqual(first.key,proposal([prepare,take]).key);
  const create={kind:'object',name:'Chair',definition:'Wood frame',to:'Investigator'};
  assert.notEqual(proposal([create,prepare]).key,proposal([{...create,definition:'Other frame'},prepare]).key);
  assert.equal(first.key,proposal([{...take,_private:'one'}, {...prepare,_usage:{untrusted:'private'}}]).key);
  const resolve=usage=>admissionRequest('resolve',{action:{intent:'combat',object:'Chair',usage,target:'NPC'}},scope);
  assert.notEqual(resolve('swing').key,resolve('throw').key);
  assert.match(resolve('swing').lines.join(' '),/usage="swing"/);
});

test('a refused pickup plus usage reaches neither the Mod preparation hook nor the kernel',async t=>{
  const table=await openTable({responses:responses([take,prepare]),laneResponses:{admission:[verdict('not_authorized')]}});
  t.after(()=>table.dispose());
  let preparations=0;
  table.emit('coc:mods-bridge',{async prepare(method){if(method==='apply') preparations++;},async after(){}});
  await table.session.prompt('I only look at the chair; I do not pick it up or attack.');
  assert.equal(preparations,0);
  assert.equal(table.kernelRequests().filter(call=>call.method==='table.apply').length,0);
  assert.equal(table.lanes.admission.requests().length,1);
  assert.match(table.lanes.admission.requests()[0],/apply usage:.*object="Chair"/);
});

test('an entailed pickup and usage are admitted together before preparation without a second player input',async t=>{
  const table=await openTable({responses:responses([take,prepare]),laneResponses:{admission:[verdict('entailed')]}});
  t.after(()=>table.dispose());
  let preparations=0;
  table.emit('coc:mods-bridge',{async prepare(method){if(method==='apply') preparations++;},async after(){}});
  await table.session.prompt('I pick up the chair and swing it at the opponent.');
  assert.equal(preparations,1);
  assert.equal(table.kernelRequests().filter(call=>call.method==='table.apply').length,1);
  assert.equal(table.kernelRequests().filter(call=>call.method==='table.player_input').length,1);
  assert.equal(table.lanes.admission.requests().length,1);
});

test('an unavailable usage review fails closed before generation',async t=>{
  const table=await openTable({responses:responses([prepare]),laneResponses:{admission:[fauxAssistantMessage('not a verdict')]}});
  t.after(()=>table.dispose());
  let preparations=0;
  table.emit('coc:mods-bridge',{async prepare(method){if(method==='apply') preparations++;},async after(){}});
  await table.session.prompt('I swing the chair.');
  assert.equal(preparations,0);
  assert.equal(table.kernelRequests().filter(call=>call.method==='table.apply').length,0);
  assert.ok(table.telemetry().some(row=>row.reason==='admission_unavailable'));
});
