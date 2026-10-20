import test from 'node:test';
import assert from 'node:assert/strict';
import {turnPacketProviderPayload,turnPacketParameterSchema,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {Errors} from 'typebox/value';
import {prefixSnapshot} from '../../extensions/anthropic-cache/shared/policy.js';

const model={provider:'minimax-cn',id:'MiniMax-M3.1-Flash-Preview',api:'anthropic-messages'};
const body=()=>({model:model.id,tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}],system:[{type:'text',text:'Stable instructions'}],messages:[{role:'user',content:[{type:'text',text:'Retained exact history'}]}]});
const bindings=n=>({people:['npc_'+n,'investigator_1'],entities:['npc_'+n,'place_'+n],places:['place_'+n],facts:['fact_'+n],sources:[]});

test('native tool restrictions match the current request while actual messages remain untouched',()=>{
 const schema1=turnPacketParameterSchema(false,['brief'],[{kind:'move',to:'place_1',travel_minutes:30}],true,bindings(1));
 const schema2=turnPacketParameterSchema(false,['long'],[{kind:'move',to:'place_2',requires_via:true,travel_bands:['long']}],false,bindings(2));
 const first=turnPacketProviderPayload(body(),schema1),next=turnPacketProviderPayload(body(),schema2);
 assert.deepEqual(first.tools[0].input_schema,schema1);assert.deepEqual(next.tools[0].input_schema,schema2);
 assert.notDeepEqual(first.tools,next.tools,'do not preserve a misleading static declaration for cache reuse');
 assert.deepEqual(first.messages,body().messages);assert.deepEqual(next.messages,body().messages);
 assert.deepEqual(first.system,next.system);assert.deepEqual(body().tools[0].input_schema,TURN_PACKET_PARAMETERS);
 const a=prefixSnapshot(first,model),b=prefixSnapshot(next,model);
 assert.notDeepEqual(a.prefixes,b.prefixes,'cache reuse is measured, not assumed unchanged');
});

test('the exact native schema still declares retired references, wrong routes and missing assessment invalid',()=>{
 const schema=turnPacketParameterSchema(false,['brief'],[{kind:'move',to:'place_1',travel_minutes:30}],true,bindings(1));
 const packet={version:4,commands:[{kind:'move',to:'place_1'},{kind:'scene',service:'open',crowd:'quiet'}],interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}]}]};
 assert.equal(Errors(schema,packet).length,0);
 for(const change of [p=>p.interactions[0].content[0].fact_ref='fact_2',p=>p.interactions[0].actor='npc_2',p=>p.commands[0].to='place_2',p=>p.commands[0].via='invented',p=>p.commands.pop()]){
  const altered=structuredClone(packet);change(altered);assert.ok(Errors(schema,altered).length);
 }
 const settled=turnPacketParameterSchema(true,['brief'],[],false,bindings(1));
 assert.ok(Errors(settled,packet).length);
});
