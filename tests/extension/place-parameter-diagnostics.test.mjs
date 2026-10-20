/** Structural correction evidence; not live gameplay. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacket} from '../../runtime/turn-packet-prototype.ts';

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
