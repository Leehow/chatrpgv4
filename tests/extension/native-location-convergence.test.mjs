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

test('native place is inspection-only at registration and both provider detail levels',()=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_LEAN_APPLY:'0',EXT_JEV_APIKEY:'fixture'};
 const tools=offeredTools(COC_TOOLS,env),read={op:'inspect',need:'observation',name:'Street'},write={op:'submit',change:{action:'move',to:'Street'}};
 for(const view of [tools,locationToolDeclarations(tools),locationToolDeclarations(tools,true)]){
  const place=view.find(row=>row.name==='place');
  assert(Check(place.parameters,read));assert(!Check(place.parameters,write),'native writes belong to output.commands');
 }
 const kinds=tools.find(row=>row.name==='apply').parameters.properties.effects.items.anyOf.map(row=>row.properties.kind.const??row.properties.kind.enum?.[0]);
 assert(!kinds.includes('place'));assert(kinds.includes('move'),'issued owed moves and existing mixed atomic transactions retain their mechanical route');
 assert(Check(COC_TOOLS.find(row=>row.name==='place').parameters,write),'legacy canonical route remains available');
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
