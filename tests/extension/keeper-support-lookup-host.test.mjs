/** Actual Pi tool -> shared Jev loop -> next request. Controlled Keeper decisions, not gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {supportWire} from './support-agent-helpers.mjs';
import {validateKeeperSupport} from '../../runtime/jev/keeper-support-contract.ts';
const tool=(name,args)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});

test('Keeper explicitly requests support with preload off, receives the fixed packet, then uses ordinary lookup and recall',async t=>{
  const payloads=[],decisions=[],fetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);decisions.push(body);
    return Response.json(supportWire(body,candidate=>candidate.kind==='graph_entity'&&candidate.label.startsWith("Knott's Office")?'necessary':'skip'));};
  t.after(()=>{globalThis.fetch=fetch;});
  const table=await openTable({realKernel:true,campaign:'support-lookup-host',env:{EXT_JEV_APIKEY:'mechanical-support-key',PI_COC_JEV_PRESELECT:'0'},
    responses:[tool('narrate',{text:'Knott waits in his office.'})]});
  t.after(()=>table.dispose());await waitForIdle(table.session,{timeoutMs:60000});
  const query='Connect the office scene conditions with its authored exits.',player='I ask Knott where I can begin my inquiries.';
  table.faux.setResponses([tool('lookup',{kind:'support',query}),tool('lookup',{kind:'module',query:"Knott's Office"}),
    tool('recall',{what:'transcript'}),tool('narrate',{text:'Knott explains the available research leads.'})]
    .map(response=>(context)=>{payloads.push(JSON.stringify(context));return response;}));
  await table.session.prompt(player);await waitForIdle(table.session,{timeoutMs:60000});
  const results=table.session.messages.filter(message=>message.role==='toolResult'),support=results.find(message=>message.toolName==='lookup'&&message.content?.[0]?.text.includes('keeper_support'));
  assert(support,JSON.stringify(results.map(row=>row.content)));
  const packet=validateKeeperSupport(JSON.parse(support.content[0].text));assert.equal(packet.request,query);assert.equal(packet.materials.length>0,true);
  assert.equal(packet.check.basis[0].text,player);assert(decisions.some(row=>row.state.purpose==='lookup'&&row.state.request===query));
  assert(payloads.some(payload=>payload.includes(JSON.stringify(support.content[0].text).slice(1,-1))),'the exact tool packet reaches the next converted Keeper request');
  assert(!support.content[0].text.includes('prepared_digest'));assert(!support.content[0].text.includes('stateStamp'));assert(!support.content[0].text.includes('graph-unit:'));
  const ordinary=results.find(row=>row.toolName==='lookup'&&row!==support);assert(ordinary);assert(!ordinary.content[0].text.includes('keeper_support'));
  assert(results.some(row=>row.toolName==='recall'));assert(!results.some(row=>['resolve','apply'].includes(row.toolName)));
  assert(table.telemetry().some(row=>row.lane==='keeper-support'&&row.event==='prepared'));assert.deepEqual(table.extensionErrors,[]);
});
