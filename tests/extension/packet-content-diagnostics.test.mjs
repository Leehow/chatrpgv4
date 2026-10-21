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
