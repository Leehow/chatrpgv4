/** Preserve rule semantics through composition and the actual SDK payload seam. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {readFileSync} from 'node:fs';
import {streamSimple as responses} from '@earendil-works/pi-ai/api/openai-responses';
import {streamSimple as messages} from '@earendil-works/pi-ai/api/anthropic-messages';
import {turnPacket,turnPacketParameterSchema,turnPacketProviderPayload} from '../../runtime/turn-packet-prototype.ts';
import {locationCommandOwner} from '../../shared/place-structures.ts';

const rows=[{handle:'momentary',covers:'A gesture or a single word.'},{handle:'quick_observation',covers:'A look or listen from the current position.'},{handle:'unissued',covers:'Unissued meaning must stay absent.'}];
const bands=['momentary','quick_observation'];
const schema=locations=>turnPacketParameterSchema(false,bands,undefined,false,undefined,locations,rows);
const meanings=wire=>{
 for(const row of rows.slice(0,2))assert.ok(wire.description?.includes(`${row.handle}: ${row.covers}`),row.handle+' meaning reaches the request');
 assert.ok(!wire.description.includes(rows[2].covers));
};
test('no additional time is omission, not a zero-minute native cost',()=>{
 const local=[{kind:'place',action:'move',to:'Inn',at:'Counter'},{kind:'scene',service:'open',crowd:'unknown'}];
 const plain={version:4,commands:local};
 assert.doesNotThrow(()=>turnPacket(JSON.stringify(plain)));
 for(const minutes of [0,-1,1.5])assert.throws(()=>turnPacket(JSON.stringify({...plain,commands:[...local,{kind:'time',minutes,reason:'No extra pause',beyond_travel:true}]})));
 for(const duration of [{minutes:5},{band:'momentary'}])assert.doesNotThrow(()=>turnPacket(JSON.stringify({...plain,commands:[...local,{kind:'time',...duration,reason:'Selected activity',beyond_travel:true}]})));
});
test('location ownership composes time annotations without mutation or repetition',()=>{
 const plain=schema(false),original=structuredClone(plain);
 meanings(plain);
 const projected=locationCommandOwner(plain),direct=schema(true);
 meanings(projected);meanings(direct);
 assert.deepEqual(plain,original);
 assert.deepEqual(locationCommandOwner(projected),projected);
 assert.deepEqual(locationCommandOwner(direct),direct);
 const bare=turnPacketParameterSchema(false,bands,undefined,false,undefined,true);
 for(const band of [...bands,'invented'])for(const reason of ['Selected activity','']){
  const input={version:4,commands:[{kind:'time',band,reason}]};
  assert.equal(Check(direct,input),Check(bare,input));
 }
 assert.ok(direct.description.includes('The location provider owns party movement'));
});
for(const transport of ['responses','messages'])test(transport+' request retains current time meanings with the location provider',async()=>{
 const model=transport==='responses'?{id:'grok-4.5',name:'Fixture',api:'openai-responses',provider:'grok-build',baseUrl:'https://invalid.example/v1',reasoning:true,input:['text'],contextWindow:128000,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}:
  {...JSON.parse(readFileSync(new URL('../../node_modules/@earendil-works/pi-ai/dist/providers/data/minimax-cn.json',import.meta.url)))['anthropic-messages']['chat:MiniMax-M2.7'],id:'MiniMax-M3.1-Flash-Preview',compat:{forceAdaptiveThinking:true}};
 const controller=new AbortController();let payload;
 const canonical=schema(true),original=structuredClone(canonical);
 await(transport==='responses'?responses:messages)(model,{messages:[{role:'system',content:'Fixture',toolsAdded:[{name:'output',description:'Fixture',parameters:{type:'object',properties:{}}}],timestamp:0},{role:'user',content:'Fixture',timestamp:0}]},
  {apiKey:'fixture',signal:controller.signal,onPayload:body=>{
   payload=turnPacketProviderPayload(body,canonical);controller.abort();return payload;
  }}).result();
 assert.ok(payload,'the actual SDK request callback ran before transport');
 const output=payload.tools.find(tool=>tool.name==='output'),wire=output.input_schema??output.parameters;
 meanings(wire);assert.deepEqual(canonical,original);
 const position={version:4,commands:[{kind:'place',action:'move',to:'Inn',spot:'quiet corner',relation:'standing'},{kind:'scene',service:'open',crowd:'unknown'}]};
 assert.ok(Check(wire,position),'descriptive positions survive the actual SDK request');
 assert.ok(!Check(wire,{...position,commands:[{...position.commands[0],at:'Counter'},position.commands[1]]}),'wire preserves the mutually exclusive anchors');
 assert.ok(Check(wire,{version:4,commands:[{kind:'time',band:'momentary',reason:'Selected gesture'}]}));
 assert.ok(!Check(wire,{version:4,commands:[{kind:'time',band:'invented',reason:'Selected gesture'}]}));
 assert.ok(!Check(wire,{version:4,commands:[{kind:'time',minutes:0,reason:'No extra pause'}]}),'the actual request must forbid a placeholder zero cost');
});
