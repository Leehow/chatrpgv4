/** Actual Pi tool -> shared Jev loop -> next request. Controlled Keeper decisions, not gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall,getCurrentTools} from '@earendil-works/pi-ai';
import {openTable,waitFor} from './harness.mjs';
import {supportWire} from './support-agent-helpers.mjs';
import {validateKeeperSupport} from '../../runtime/jev/keeper-support-contract.ts';
const tool=(name,args)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});
// SL-87: waits are on the delivery the test reads next, never on an idle heuristic. On a loaded box the opening run is still
// settling when the player speaks, so the table holds the input and replays it after the settle (the kernel extension's
// `input` hook), and a short idle poll returned before that turn had begun. The support allowance is not this test's
// subject: it runs at the most the product accepts (`PRESELECT_ALLOWANCE_MAX_MS`), not the 12 s default a loaded box outlasts.
const delivered=(session,text)=>session.messages.some(message=>message.role==='toolResult'&&message.toolName==="output"
  &&(message.content??[]).some(block=>block.text?.includes(text)));

test('Keeper explicitly requests support with preload off, receives the fixed packet, then uses ordinary lookup and recall',async t=>{
  const payloads=[],decisions=[],fetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);decisions.push(body);
    return Response.json(supportWire(body,candidate=>candidate.kind==='graph_entity'&&candidate.label.startsWith("Knott's Office")?'necessary':'skip'));};
  t.after(()=>{globalThis.fetch=fetch;});
  const table=await openTable({realKernel:true,campaign:'support-lookup-host',env:{EXT_JEV_APIKEY:'mechanical-support-key',PI_COC_JEV_PRESELECT:'0',
    PI_COC_JEV_PRESELECT_ALLOWANCE_MS:'30000'},responses:[tool("output",{text:'Knott waits in his office.'})]});
  t.after(()=>table.dispose());
  await waitFor(()=>delivered(table.session,'Knott waits in his office.'),{timeoutMs:120_000,label:'the opening delivery'});
  const query='Connect the office scene conditions with its authored exits.',player='I ask Knott where I can begin my inquiries.';
  table.faux.setResponses([tool('lookup',{kind:'support',query}),tool('lookup',{kind:'module',query:"Knott's Office"}),
    tool('recall',{what:'transcript'}),tool("output",{text:'Knott explains the available research leads.'})]
    .map(response=>(context)=>{payloads.push(JSON.stringify(context));return response;}));
  await table.session.prompt(player);
  await waitFor(()=>delivered(table.session,'Knott explains the available research leads.'),{timeoutMs:120_000,label:'the support turn\'s delivery'});
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

test('an unconfigured support provider is absent from the actual Pi request tool kinds',async t=>{
  const payloads=[];
  const table=await openTable({env:{EXT_JEV_APIKEY:'',TYPESAFE_API_KEY:''},responses:[context=>{
    payloads.push(getCurrentTools(context.messages));
    return tool('output',{text:'The ordinary desk remains available.'});
  },fauxAssistantMessage('The ordinary desk remains available.')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I ask about the office.');
  await waitFor(()=>delivered(table.session,'The ordinary desk remains available.'),{timeoutMs:120_000,label:'the ordinary delivery'});
  const lookup=payloads.find(row=>row.some(tool=>tool.name==='lookup'))?.find(tool=>tool.name==='lookup');
  assert(lookup,'the actual model request must contain lookup');
  assert(!lookup.parameters.properties.kind.enum.includes('support'),'a missing provider must not be an offered kind');
  for(const kind of ['module','source','rule','catalog','continuity'])assert(lookup.parameters.properties.kind.enum.includes(kind),kind);
  assert.match(lookup.description,/support is unavailable in this session/);
  assert.deepEqual(table.extensionErrors,[]);
});
