/** A walk_on's new_N is accepted wherever the packet's commands name a person; the host seats the newcomer first. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacket,compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';

test('npc and relationship commands accept the new_N of a walk_on in the same packet',()=>{
 const packet=turnPacket(JSON.stringify({version:4,commands:[{kind:'walk_on',slot:'new_1',label:'the dock clerk',reason:'On shift.'},
  {kind:'npc',actor:'new_1',to:'here',reason:'Stays at the desk.'},
  {kind:'relationship',actor:'new_1',toward:'investigator_1',disposition:'friendly',trust:2}]}));
 const compiled=compileTurnPacket(packet);
 assert.ok(compiled.effects.filter(e=>e.kind==='npc').every(e=>e.name==='the dock clerk'));
 assert.deepEqual(compiled.event.relationships.map(r=>r.actor),['the dock clerk'],'the directed statement names the seat too');
});

test('a relationship that changes only trust or fear is a whole command',()=>{
 const packet=turnPacket(JSON.stringify({version:4,commands:[{kind:'relationship',actor:'npc_1',toward:'investigator_1',trust:3}]}));
 const compiled=compileTurnPacket(packet);
 assert.equal(JSON.parse(compiled.event.relationships[0].statement).trust,3);
 assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{kind:'relationship',actor:'npc_1',toward:'investigator_1'}]})),'an empty change is still refused');
});
