/** §259.3: a person's disposition toward the investigator lands in the attitude ledger as the Keeper's own stance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';

test('a relationship toward the investigator compiles to a stance effect after the rest of the turn',()=>{
 const compiled=compileTurnPacket({version:4,commands:[
  {kind:'relationship',actor:'npc_1',toward:'investigator_1',disposition:'hostile',fear:3},
  {kind:'mood',actor:'npc_1',mood:'他攥紧了拳头。'}]});
 assert.equal(compiled.event.relationships.length,1,'the §258.7 statement is still written');
 const stance=compiled.effects.filter(effect=>effect.kind==='npc'&&effect.stance);
 assert.deepEqual(stance,[{kind:'npc',name:'npc_1',stance:'hostile',why:'The Keeper set how they stand with the investigator after this exchange.'}]);
 assert.equal(compiled.effects.at(-1),stance[0],'it settles last, after the mood');
});

test('a relationship toward another person, or one without a disposition, writes no stance',()=>{
 for(const command of [{kind:'relationship',actor:'npc_1',toward:'npc_2',disposition:'ally'},
  {kind:'relationship',actor:'npc_1',toward:'investigator_1',control:'coerced'}]){
  const compiled=compileTurnPacket({version:4,commands:[command]});
  assert.ok(!compiled.effects.some(effect=>effect.kind==='npc'&&effect.stance),JSON.stringify(command));
 }
});
