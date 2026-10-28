/** §259.3: a person's disposition toward the investigator lands in the attitude ledger as the Keeper's own stance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';
import {DecisionContent} from '../../runtime/decision-content.ts';
import {importSource} from '../integration/support.ts';
const {agreementsOf}=await importSource('kernel-ts/npc/communication.ts');

test('a relationship toward the investigator compiles to a stance effect after the rest of the turn',()=>{
 const compiled=compileTurnPacket({version:4,commands:[
  {kind:'relationship',actor:'npc_1',toward:'investigator_1',disposition:'hostile',fear:3},
  {kind:'mood',actor:'npc_1',mood:'他攥紧了拳头。'}]});
 assert.equal(compiled.event.relationships.length,1,'the §258.7 statement is still written');
 const stance=compiled.effects.filter(effect=>effect.kind==='npc'&&effect.stance);
 assert.deepEqual(stance,[{kind:'npc',name:'npc_1',stance:'hostile',why:'The Keeper set how they stand with the investigator after this exchange.'}]);
 const moodAt=compiled.effects.findIndex(effect=>effect.mood),stanceAt=compiled.effects.indexOf(stance[0]);
 assert.ok(stanceAt>moodAt,'it settles after the mood');
 // §259.6: the relationship's fear is the person's own level, set by the Keeper last of all.
 assert.deepEqual(compiled.effects.at(-1),{kind:'npc',name:'npc_1',fear:3,why:'The Keeper set how afraid and how hard pressed they are after this exchange.'});
});

test('a relationship toward another person, or one without a disposition, writes no stance',()=>{
 for(const command of [{kind:'relationship',actor:'npc_1',toward:'npc_2',disposition:'ally'},
  {kind:'relationship',actor:'npc_1',toward:'investigator_1',control:'coerced'}]){
  // (neither carries fear or pressure, so neither writes an affect effect either)
  const compiled=compileTurnPacket({version:4,commands:[command]});
  assert.ok(!compiled.effects.some(effect=>effect.kind==='npc'&&effect.stance),JSON.stringify(command));
 }
});

test('§259.2 an agreement mark on what an investigator said makes the investigator the obligor of a promise to that person',()=>{
 const owner=new DecisionContent();
 const person={ref:'npc_1',display_name:'Russ',party_said:[{content_id:'p:'+'a'.repeat(24),said_by:'investigator_1',to_me:true,gist:'I will bring your brother back by dawn',turn:2}]};
 const fact=owner.prepare('c:1',{},[person],[],['Ada']).facts.find(row=>row.kind==='party_said');
 assert.ok(fact,'the investigator\'s words are an issued fact');
 assert.deepEqual(owner.agreement({proposal:fact.ref,status:'kept'}),{content_id:'p:'+'a'.repeat(24),by:'investigator_1',status:'kept',with:['npc_1']});
 assert.throws(()=>owner.agreement({proposal:fact.ref,status:'declined'}),/what an investigator said: its status is one of accepted, kept, broken, withdrawn/);
 assert.deepEqual(agreementsOf({agreements:[{content_id:'p:'+'a'.repeat(24),by:'investigator_1',status:'broken',with:['npc_1']}]}).length,1);
 assert.deepEqual(agreementsOf({agreements:[{content_id:'p:'+'a'.repeat(24),by:'investigator_1',status:'broken'}]}),[],'a promise is made to someone');
});
