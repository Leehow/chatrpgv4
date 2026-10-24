/** Structural correction evidence; not live gameplay. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Errors} from 'typebox/value';
import {turnPacket,turnPacketParameterSchema,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';

test('a declared location action reports its actual discriminator without rewriting the command',()=>{
 const command={kind:'move',action:'observe',to:'Courtyard',sense:'sight',access:'limited',scope:'The yard.',facts:[]};
 const text=JSON.stringify({version:4,commands:[command]});
 assert.throws(()=>turnPacket(text),error=>{
  assert.match(error.message,/commands\[0\]\/kind.*place/);
  assert.ok(error.fields.some(field=>field.startsWith('commands[0]/kind:')));
  return true;
 });
 assert.equal(command.kind,'move');assert.equal(JSON.stringify({version:4,commands:[command]}),text);
 assert.equal(turnPacket(JSON.stringify({version:4,commands:[{...command,kind:'place'}]})).commands[0].kind,'place');
 assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{...command,kind:'place',action:'invented'}]})));
 assert.equal(turnPacket(JSON.stringify({version:4,commands:[{kind:'move',to:'Lobby'}]})).commands[0].kind,'move');
});

test('an active location provider has one party-movement constructor while base tables retain their issued route',()=>{
 const choices=[{kind:'move',to:'Lobby',via:'Stairs'}];
 const active=turnPacketParameterSchema(false,undefined,choices,false,undefined,true);
 const base=turnPacketParameterSchema(false,undefined,choices,false,undefined,false);
 // §250: no command-array guard demands a scene beside a move; an unassessed arrival is recorded as unknown.
 assert.equal(active.properties.commands.anyOf[0].allOf,undefined);assert.equal(base.properties.commands.anyOf[0].allOf,undefined);
 const legacy={version:4,commands:[{kind:'move',to:'Lobby'},{kind:'scene',service:'open',crowd:'quiet'}]};
 assert.equal(Errors(base,legacy).length,0);assert.ok(Errors(active,legacy).length);
 const local={version:4,commands:[{kind:'place',action:'move',to:'Lobby'},{kind:'scene',service:'open',crowd:'quiet'}]};
 assert.equal(Errors(active,local).length,0);assert.doesNotThrow(()=>turnPacket(JSON.stringify(local),active));
 const offered=locationToolDeclarations([{name:'output',parameters:TURN_PACKET_PARAMETERS}],true)[0].parameters;
 assert.ok(Errors(offered,legacy).length);assert.equal(Errors(offered,local).length,0);
 assert.equal(Errors(TURN_PACKET_PARAMETERS,legacy).length,0,'the canonical validator remains unchanged');
 const observation={version:4,commands:[{kind:'place',action:'observe',to:'Lobby',sense:'sight',access:'limited',scope:'The front desk.',facts:[]}]};
 assert.equal(Errors(active,observation).length,0);
});

test('§264.29: an unassessed current scene is not demanded; an empty packet is accepted',()=>{
 assert.doesNotThrow(()=>turnPacket(JSON.stringify({version:4,commands:[]}),turnPacketParameterSchema(false,undefined,undefined,true)));
});
