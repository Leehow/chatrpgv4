/** Locked place craft reaches the actual author without another model or world write. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {locationDescription,LOCATION_DESCRIPTION_HEADING} from '../../extensions/kernel/location-description.ts';
import {writeIsolatedExpression,EXPRESSION_PROFILE} from '../../runtime/isolated-expression.ts';

const section={key:'places@1.2.0#1',mod:'places',version:'1.2.0',heading:LOCATION_DESCRIPTION_HEADING,text:'LOCATION_CRAFT_FROM_THE_LOCKED_PACKAGE'};
const capsule={mods:{location_context:{mod:'places',version:'1.2.0'},instructions:[{mod:'places',version:'1.2.0',sections:[{key:section.key,heading:section.heading}]}]}};
test('only the issued active location section is loaded, and a stale replacement fails closed',async()=>{
 let reads=0;const read=async keys=>{reads++;assert.deepEqual(keys,[section.key]);return {sections:[section]};};
 const selected=await locationDescription(capsule,read);assert.equal(selected.instruction,section.text);assert.equal(reads,1);
 for(const value of [{mods:{}},{mods:{...capsule.mods,location_context:{mod:'other',version:'1.2.0'}}},{mods:{...capsule.mods,location_context:{mod:'places',version:'1.1.7'}}}])
  assert.equal(await locationDescription(value,read),undefined);
 assert.equal(reads,1,'inactive and replaced providers add no read or author context');
 await assert.rejects(()=>locationDescription(capsule,async()=>({sections:[{...section,version:'2.0.0'}]})),/locked location description/);
});
test('the sole final author receives locked location craft once alongside current input and canonical scene',async t=>{
 const home=await mkdtemp(join(tmpdir(),'place-author-'));t.after(()=>rm(home,{recursive:true,force:true}));let calls=0;
 const location_description=await locationDescription(capsule,async()=>({sections:[section]}));
 const runtime={home,async runTask({request}){
  calls++;assert.equal(request.systemPrompt.split(section.text).length-1,1);assert(!request.brief.includes(section.text));
  const packet=JSON.parse(request.brief);assert.equal(packet.player_input,'I look around the lunchroom.');
  assert.deepEqual(packet.decision_context.location_description,{mod:'places',version:'1.2.0',key:section.key});
  assert.equal(packet.decision_context.scene.name,'Lunchroom');assert.equal(request.maxRequests,1);
  request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'The counter runs along the left wall.'}});
  const [provider,...name]=EXPRESSION_PROFILE.model.split('/');
  request.onEvent({type:'message_end',message:{role:'assistant',provider,model:name.join('/'),stopReason:'stop',content:[{type:'text',text:'The counter runs along the left wall.'}]}});
  return {ok:true,ms:1};
 }};
 const text=[];await writeIsolatedExpression({runtime,campaign:'fixture',turn:1,run:'r',language:'en',playerText:'I look around the lunchroom.',
  decision:{scene:{name:'Lunchroom'},clock:{},people:[],responses:[],recent_public:[],location_description},stream:{push:delta=>text.push(delta)},record:async()=>{}});
 assert.equal(calls,1);assert.equal(text.join(''),'The counter runs along the left wall.');
});
