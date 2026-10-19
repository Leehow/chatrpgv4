import test from 'node:test';
import assert from 'node:assert/strict';
import {turnPacketProviderPayload,turnPacketParameterSchema,requireTurnPacketParameters,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {prefixSnapshot} from '../../extensions/anthropic-cache/shared/policy.js';

const model={provider:'minimax-cn',id:'MiniMax-M3.1-Flash-Preview',api:'anthropic-messages'};
const body=()=>({model:model.id,tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}],system:[{type:'text',text:'Stable instructions'}],messages:[{role:'user',content:[{type:'text',text:'Retained exact history'}]}]});
const bindings=n=>({people:['npc_'+n,'investigator_1'],entities:['npc_'+n,'place_'+n],places:['place_'+n],facts:['fact_'+n],sources:[]});

test('current decision references and route restrictions do not invalidate the tool/system/history prefix',()=>{
 const first=turnPacketProviderPayload(body(),false,true,['brief'],[{kind:'move',to:'place_1',travel_minutes:30}],true,bindings(1));
 const next=turnPacketProviderPayload(body(),false,true,['long'],[{kind:'move',to:'place_2',requires_via:true,travel_bands:['long']}],false,bindings(2));
 assert.deepEqual(first.tools,next.tools,'issued values belong in the request tail, never the reusable tool head');
 const a=prefixSnapshot(first,model),b=prefixSnapshot(next,model);
 assert.deepEqual(a.prefixes.slice(0,3),b.prefixes.slice(0,3),'tools, system and retained history remain identical');
 const tail=sent=>JSON.parse(sent.messages.at(-1).content.at(-1).text).output_parameters;
 assert.ok(JSON.stringify(tail(first)).includes('fact_1'));
 assert.ok(JSON.stringify(tail(next)).includes('fact_2'));
 assert.notDeepEqual(tail(first),tail(next),'the exact current restrictions are still supplied');
 assert.deepEqual(tail(first),{journey_settled:false,scene_required:true,time_bands:['brief'],move_choices:[{kind:'move',to:'place_1',travel_minutes:30}],npc_destinations:['here','away','place_1'],references:bindings(1)});
 assert.ok(Buffer.byteLength(first.messages.at(-1).content[0].text)<1024,'do not resend the structural schema at the tail');
 assert.equal(first.messages[0].content[0].text,'Retained exact history');
 assert.deepEqual(body().tools[0].input_schema,TURN_PACKET_PARAMETERS);
});

test('tail constraints reject retired references, wrong routes and missing scene assessment before execution',()=>{
 const schema=turnPacketParameterSchema(false,['brief'],[{kind:'move',to:'place_1',travel_minutes:30}],true,bindings(1));
 const packet={version:4,commands:[{kind:'move',to:'place_1'},{kind:'scene',service:'open',crowd:'quiet'}],interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}]}]};
 assert.doesNotThrow(()=>requireTurnPacketParameters(packet,schema));
 for(const change of [p=>p.interactions[0].content[0].fact_ref='fact_2',p=>p.interactions[0].actor='npc_2',p=>p.commands[0].to='place_2',p=>p.commands[0].via='invented',p=>p.commands.pop()]){
  const altered=structuredClone(packet);change(altered);assert.throws(()=>requireTurnPacketParameters(altered,schema),/Invalid decision command/);
 }
 const settled=turnPacketParameterSchema(true,['brief'],[],false,bindings(1));
 assert.throws(()=>requireTurnPacketParameters(packet,settled),/Invalid decision command/);
});
