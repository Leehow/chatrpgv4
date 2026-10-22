/** §250.4: a packet command is checked against its own kind's schema, and a refusal names a stray declared field. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacket,turnPacketParameterSchema} from '../../runtime/turn-packet-prototype.ts';

const brief={version:4,interactions:[],reveal:[]};
const scene={kind:'scene',service:'limited',crowd:'quiet',review_after_minutes:45};

test('a scene command carrying a place action is refused as a scene command, naming the stray field (live el-v2-20261022h T12)',()=>{
 for(const schema of [undefined,turnPacketParameterSchema()])
  assert.throws(()=>turnPacket(JSON.stringify({...brief,commands:[{...scene,action:'observe'}]}),schema),error=>{
   assert.doesNotMatch(error.message,/facts/,'a scene command is not a place observation');
   assert.match(error.message,/commands\[0\]\/<additional-property>.*\baction\b/);
   return true;
  });
 assert.equal(turnPacket(JSON.stringify({...brief,commands:[scene]}),turnPacketParameterSchema()).commands[0].crowd,'quiet');
});

test('a key no command declares stays unnamed in the refusal',()=>{
 assert.throws(()=>turnPacket(JSON.stringify({...brief,commands:[{...scene,whisper_to_the_keeper:'x'}]})),error=>{
  assert.match(error.message,/<additional-property>/);assert.ok(!error.message.includes('whisper_to_the_keeper'));return true;
 });
});

test('a place observation without facts still asks for facts',()=>{
 assert.throws(()=>turnPacket(JSON.stringify({...brief,commands:[{kind:'place',action:'observe',to:'here'}]})),/facts/);
});
