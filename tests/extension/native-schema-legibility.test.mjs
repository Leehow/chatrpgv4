/** Declaration evidence only; real model adherence is a separate live gate. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Errors} from 'typebox/value';
import {turnPacket,turnPacketParameterSchema,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {legibleClosedSchema} from '../../shared/native-schema.ts';

test('location command fields are explicit without replacing their original union guards',()=>{
 const schema=turnPacketParameterSchema(false,['brief'],[],false,undefined,true);
 assert.equal(schema.properties.commands.type,'array');
 const items=schema.properties.commands.items;
 assert.equal(items.type,'object');assert.ok(items.properties.action.enum.includes('observe'));
 assert.ok(items.properties.action.enum.includes('move'));
 assert.ok(items.properties.kind.enum.includes('place'));assert.ok(!items.properties.kind.enum.includes('move'));
 assert.ok(Array.isArray(schema.properties.commands.anyOf));
 const observation={version:4,commands:[{kind:'place',action:'observe',to:'Lobby',sense:'sight',access:'limited',scope:'The desk.',facts:[]}]};
 assert.equal(Errors(schema,observation).length,0);
 for(const command of [{...observation.commands[0],action:'move'},{...observation.commands[0],kind:'move'},{...observation.commands[0],access:'invented'},{...observation.commands[0],extra:true}])
  assert.ok(Errors(schema,{version:4,commands:[command]}).length);
 assert.equal(TURN_PACKET_PARAMETERS.properties.commands.type,undefined,'the canonical schema is immutable');
});

test('redundant views accept exactly the same valid and mixed command shapes',()=>{
 const original={anyOf:[
  {type:'array',items:{anyOf:[
   {type:'object',properties:{action:{type:'string',const:'move'},to:{type:'string',minLength:1}},required:['action','to'],additionalProperties:false},
   {type:'object',properties:{action:{type:'string',const:'observe'},to:{type:'string',minLength:1},facts:{type:'array',items:{type:'string'}}},required:['action','to','facts'],additionalProperties:false}
  ]},maxItems:3},
  {type:'array',items:{type:'object',properties:{action:{type:'string',const:'wait'},minutes:{type:'integer',minimum:0}},required:['action','minutes'],additionalProperties:false},maxItems:3}
 ]};
 const before=structuredClone(original),view=legibleClosedSchema(original);
 assert.deepEqual(original,before);assert.deepEqual(view.anyOf,original.anyOf);
 const seeds=[{action:'move',to:'Lobby'},{action:'observe',to:'Lobby',facts:[]},{action:'wait',minutes:3}];
 const cases=[[],...seeds.map(value=>[value]),seeds,[...seeds,seeds[0]],null,{},'invalid'];
 for(const seed of seeds)for(const key of ['action','to','facts','minutes','extra'])for(const value of [null,'',true,2,[],{},'move','observe','wait'])cases.push([{...seed,[key]:value}]);
 for(const value of cases)assert.equal(Errors(view,value).length===0,Errors(original,value).length===0,JSON.stringify(value));
 const open={anyOf:[{type:'object',properties:{a:{type:'string'}},additionalProperties:true},{type:'object',properties:{b:{type:'string'}},additionalProperties:false}]};
 assert.deepEqual(legibleClosedSchema(open),open);
 const patterned={anyOf:[{type:'object',properties:{},patternProperties:{'^x':{type:'integer'}},additionalProperties:false},{type:'object',properties:{tag:{const:'closed'}},additionalProperties:false}]};
 assert.deepEqual(legibleClosedSchema(patterned),patterned);
});

test('already projected properties expose closed enums without changing their accepted records',()=>{
 const branch=action=>({type:'object',properties:{action:{type:'string',const:action}},required:['action'],additionalProperties:false});
 const original={type:'object',properties:{action:{anyOf:[{const:'move',type:'string'},{const:'observe',type:'string'}]}},required:['action'],additionalProperties:false,anyOf:[branch('move'),branch('observe')]};
 const view=legibleClosedSchema(original);
 assert.deepEqual(view.properties.action.enum,['move','observe']);
 assert.deepEqual(view.anyOf,original.anyOf);
 for(const value of [{action:'move'},{action:'observe'},{action:'inspect'},{action:'move',change:{}},{},null])
  assert.equal(Errors(view,value).length===0,Errors(original,value).length===0,JSON.stringify(value));
 assert.equal(original.properties.action.enum,undefined);
});

test('a valid movement missing its conditional assessment reports that assessment without an incompatible reason field',()=>{
 const schema=turnPacketParameterSchema(false,['quick_observation'],[],false,undefined,true);
 const packet={version:4,commands:[{kind:'place',action:'move',to:'Tea room'},
  {kind:'time',band:'quick_observation',reason:'Look back from the doorway.',beyond_travel:true},
  {kind:'place',action:'observe',to:'Street',sense:'sight',access:'clear',scope:'The corner.',facts:[]}]};
 assert.ok(Errors(schema,packet).length);
 assert.throws(()=>turnPacket(JSON.stringify(packet),schema),error=>{
  assert.match(error.message,/scene assessment command/);assert.doesNotMatch(error.message,/required properties reason|additional-property/);return true;
 });
 const corrected={...packet,commands:[...packet.commands,{kind:'scene',service:'open',crowd:'unknown'}]};
 assert.equal(Errors(schema,corrected).length,0);assert.doesNotThrow(()=>turnPacket(JSON.stringify(corrected),schema));
 assert.throws(()=>turnPacket(JSON.stringify({...corrected,commands:corrected.commands.map((command,index)=>index?command:{...command,reason:'Walk back.'})}),schema),/additional-property/);
 const stationary={version:4,commands:[packet.commands[1],packet.commands[2]]};assert.doesNotThrow(()=>turnPacket(JSON.stringify(stationary),schema));
});
