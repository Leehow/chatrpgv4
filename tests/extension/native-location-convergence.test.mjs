/** Actual native registration and provider projection must describe one write owner. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {admissionRefusalScope} from '../../extensions/kernel/refusal-scope.ts';
import {PendingAnswers} from '../../extensions/kernel/source-answers.ts';
import {placeModeConflict} from '../../extensions/kernel/place-operation.ts';
import {streamSimple} from '@earendil-works/pi-ai/api/anthropic-messages';
import {readFileSync} from 'node:fs';

test('actual non-strict Anthropic wire retains actions and required fields after session schema roundtrip',async()=>{
 const model={...JSON.parse(readFileSync(new URL('../../node_modules/@earendil-works/pi-ai/dist/providers/data/minimax-cn.json',import.meta.url)))['anthropic-messages']['chat:MiniMax-M2.7'],id:'MiniMax-M3.1-Flash-Preview',compat:{forceAdaptiveThinking:true}};
 const tools=offeredTools(COC_TOOLS,{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',EXT_JEV_APIKEY:'fixture'});
 for(const restored of [tools,structuredClone(tools),JSON.parse(JSON.stringify(tools))])for(const detail of [false,true]){
  const place=locationToolDeclarations(restored,detail).find(row=>row.name==='place');let payload;
  const controller=new AbortController();
  await streamSimple(model,{messages:[{role:'system',content:'Fixture',toolsAdded:[place],timestamp:0},{role:'user',content:'Fixture',timestamp:0}]},{apiKey:'fixture',signal:controller.signal,onPayload:body=>{payload=body;controller.abort();}}).result();
  const schema=payload.tools[0].input_schema;
  assert.equal(schema.anyOf,undefined,'exercise the actual non-strict serializer limitation');
  assert.deepEqual(schema.properties.action.enum,['inspect','move','establish','feature','relate','observe']);
  assert.deepEqual(schema.required,['action'],'restoring JSON must not erase the action discriminator');
  if(detail){assert.equal(schema.properties.facts.type,'array');assert.equal(schema.properties.scope.type,'string');assert(schema.properties.access);}
  assert.equal(schema.properties.to.type,'string');assert.equal(schema.properties.relation.type,'string');
  assert.match(schema.properties.action.description,/No op or change wrapper/);
  assert.match(schema.properties.action.description,/feature requires to and at, optional state\/passable/);
  assert.match(schema.properties.action.description,/establish requires additions/);
  assert.match(schema.properties.action.description,/no description field/);
  assert.equal(schema.properties.op,undefined);assert.equal(schema.properties.change,undefined);
 }
 assert(placeModeConflict({op:'inspect',change:{action:'move',to:'Street'}}));
 assert(placeModeConflict({action:'inspect',to:'Street',relation:'beside'}));
 assert(!placeModeConflict({op:'submit',change:{action:'move',to:'Street'}}));
 assert(!placeModeConflict({op:'inspect',name:'Street'}));
 assert(!placeModeConflict({action:'inspect',name:'Street',at:'corner'}));
});

test('native place can commit a step before later mechanics with compact provider context',()=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_LEAN_APPLY:'0',EXT_JEV_APIKEY:'fixture'};
 const tools=offeredTools(COC_TOOLS,env),read={action:'inspect',need:'observation',name:'Street'},write={action:'move',to:'Street'};
 for(const view of [tools,locationToolDeclarations(tools),locationToolDeclarations(tools,true)]){
  const place=view.find(row=>row.name==='place');
  assert(Check(place.parameters,read));assert(Check(place.parameters,write),'a nonpublishing location step must be available before a later wait or service');
  assert(!Check(place.parameters,{...write,action:'inspect'}),'a read declaration never accepts a state-changing payload');
 }
 assert(JSON.stringify(locationToolDeclarations(tools).find(row=>row.name==='place').parameters).length<JSON.stringify(tools.find(row=>row.name==='place').parameters).length/2,'full location fields remain demand-only provider context');
 assert(!Check(tools.find(row=>row.name==='place').parameters,{...write,travel_minutes:0}),'the native validator still prohibits invented travel arithmetic');
 const kinds=tools.find(row=>row.name==='apply').parameters.properties.effects.items.anyOf.map(row=>row.properties.kind.const??row.properties.kind.enum?.[0]);
 assert(!kinds.includes('place'));assert(kinds.includes('move'),'issued owed moves and existing mixed atomic transactions retain their mechanical route');
 assert(Check(COC_TOOLS.find(row=>row.name==='place').parameters,{op:'submit',change:{action:'move',to:'Street'}}),'legacy canonical route remains available');
});

test('uncertain admission tells the Keeper which operation was held without leaking unrelated details',()=>{
 const error=new KernelError({code:'needs',message:'The typed consent decision is uncertain',details:{reason:'action_admission_uncertain',
  proposed:['Give an additional letter to the investigator.'],grounds:'The selected scope is uncertain.',private_state:{secret:'Never expose'}}});
 const text=error.toToolText();assert.match(text,/Give an additional letter/);assert.match(text,/selected scope is uncertain/);
 assert(!text.includes('Never expose'));assert(!new KernelError({code:'needs',message:'Other',details:{reason:'other',proposed:['Unrelated']}}).toToolText().includes('Unrelated'));
});

test('uncertain object admission cannot exhaust an independent location or cash family',()=>{
 const scoped=effects=>admissionRefusalScope('apply',{effects});
 const blocked=new Map([[scoped([{kind:'define'},{kind:'object'}]),'held']]);
 assert.equal(blocked.get(scoped([{kind:'object',name:'Reworded letter'},{kind:'define'}])),'held');
 assert.equal(blocked.get(scoped([{kind:'place',action:'move'}])),undefined);
 assert.equal(blocked.get(scoped([{kind:'cash'}])),undefined);
 assert.equal(admissionRefusalScope('resolve',{action:{intent:'investigate'}}),'resolve');
});

test('pending focus reuse never crosses an input owner, turn, focus or worldline',async()=>{
 const owner=new PendingAnswers(()=>{});let finish;const done=new Promise(resolve=>{finish=resolve;});
 owner.register('table',{focus:'Library',question:'Opening hours?'},2,undefined,done,'answer','Office',{worldline:'main',loop:0},'module/run-a');
 const at={scene:'Office',turn:2,focus:'Library',scope:{worldline:'main',loop:0},owner:'module/run-a'};
 assert.deepEqual(owner.pendingFor('table',at),{focus:'Library',question:'Opening hours?'});
 for(const change of [{owner:'module/run-b'},{turn:3},{focus:'Shop'},{scene:'Street'},{scope:{worldline:'branch',loop:0}}])assert.equal(owner.pendingFor('table',{...at,...change}),undefined);
 finish({state:'ready',source_answer:{status:'answered',answer:'Original result.'}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(owner.pendingFor('table',at),undefined);
});
