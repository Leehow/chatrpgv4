/** Deterministic packet diagnostics; not live-play evidence. */
import test from 'node:test';import assert from 'node:assert/strict';
import {turnPacket,turnPacketParameterSchema,normalizeTurnPacketArguments} from '../../runtime/turn-packet-prototype.ts';
const bindings={entities:['npc_28','investigator_1','Inn'],people:['npc_28','investigator_1'],places:['Inn'],facts:['fact_1'],sources:[]};
const schema=turnPacketParameterSchema(false,['speak_briefly'],[],false,bindings,true);
const answer=content=>({version:4,interactions:[{actor:'npc_28',act:'answer',to:['investigator_1'],content}]});
test('a content constructor reports its own constraint, not every union branch (§250)',()=>{
 assert.throws(()=>turnPacket(JSON.stringify(answer([{new:{predicate:'input_requirements',topic:'An unissued topic',fields:['subject_name']}}])),schema),
  error=>/content\/0\/new\/topic: must be equal to one of the allowed values/.test(error.message)&&!/fact_ref/.test(error.message));
 assert.throws(()=>turnPacket(JSON.stringify(answer([{new:{predicate:'room_for_rent',topic:'Inn'}}])),schema),
  error=>/content\/0\/new\/predicate: must be one of \[.*"input_requirements".*\]/.test(error.message));
 assert.throws(()=>turnPacket(JSON.stringify(answer([{fact_ref:'fact_9'}])),schema),error=>/content\/0\/fact_ref/.test(error.message));
 assert.doesNotThrow(()=>turnPacket(JSON.stringify(answer([{new:{predicate:'input_requirements',topic:'Inn',fields:['subject_name']}}])),schema));
});
test('a constructor with required alternatives stays one variant: directions are accepted and judged on their own fields',()=>{
 for(const route of [{via:['Inn']},{heading:'north'},{retrace:true}])
  assert.doesNotThrow(()=>turnPacket(JSON.stringify(answer([{new:{predicate:'directions',to:'Inn',...route}}])),schema),JSON.stringify(route));
 assert.throws(()=>turnPacket(JSON.stringify(answer([{new:{predicate:'directions',to:'Inn'}}])),schema),
  error=>/content\/0\/new/.test(error.message)&&!/predicate: must be one of/.test(error.message));
});
test('a command with a place action and no kind is a place command (live el-v2-20261021b T19)',()=>{
 const normalized=normalizeTurnPacketArguments({version:4,commands:[{action:'move',to:'here',spot:'by the window'},{kind:'time',minutes:2,reason:'Wait.'},{action:'sing'}]});
 assert.equal(normalized.placeKindRepairs,1);
 assert.deepEqual(normalized.args.commands.map(row=>row.kind),['place','time',undefined],'an unknown action is left for validation');
 assert.equal(normalizeTurnPacketArguments({version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]}).placeKindRepairs,undefined);
});
test('an NPC can give directions to a nameable place the party has not visited (§250.7, live el-v2-20261021c T6)',async()=>{
 const {DecisionContent}=await import('../../runtime/decision-content.ts');
 const content=new DecisionContent();
 const capsule={where:{scene:'Inn',exits:[],back:[],places:[],known_places:[{to:'central-library',display_name:'Central Library'}]},present:[{ref:'npc_28',display_name:'the regular'}]};
 content.prepare('c:1',capsule,[],[],['Investigator']);
 const places=content.bindings().places;
 assert.ok(places.includes('central-library'),'a book place is a nameable destination');
 const scoped=turnPacketParameterSchema(false,['speak_briefly'],[],false,content.bindings(),true);
 assert.doesNotThrow(()=>turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_28',act:'answer',to:['investigator_1'],content:[{new:{predicate:'directions',to:'central-library',heading:'north'}}]}]}),scoped));
});
test('an NPC sent to the place this packet just reached is sent here; before the move it is left alone (live el-v2-20261021d T21)',()=>{
 const npc={kind:'npc',actor:'npc_28',to:'Inn',reason:'The waiter is on shift.'};
 const after=normalizeTurnPacketArguments({version:4,commands:[{kind:'place',action:'move',to:'Inn'},npc]});
 assert.equal(after.npcHereRepairs,1);assert.equal(after.args.commands[1].to,'here');
 const before=normalizeTurnPacketArguments({version:4,commands:[npc,{kind:'place',action:'move',to:'Inn'}]});
 assert.equal(before.npcHereRepairs,undefined);assert.equal(before.args.commands[0].to,'Inn');
});
test('a command is diagnosed against its own kind, not every union branch (live el-v2-20261021d T21)',()=>{
 const scoped=turnPacketParameterSchema(false,['speak_briefly'],[],false,bindings,true);
 assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{kind:'npc',actor:'npc_28',to:'Somewhere else',reason:'Walks off.'}]}),scoped),
  error=>/commands\[0\]\/to/.test(error.message)&&!/required properties action/.test(error.message));
});
