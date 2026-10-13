/** Native corrections through kernel-ts/turn-events.ts, using the existing disclosure authority. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,type Row} from './support.ts';

for(const kind of ['player-input-to-reply','already-read-to-reply','observed-to-player-speech'])test(`speech activation feedback repairs ${kind} without weakening disclosure`,async t=>{
  const k=await kernel(t);await openTurn(k,'I tell Knott what I saw and read in my notebook.');
  const investigator=(await k.table('view')).investigators[0].name,npc='Steven Knott';
  const playerSpeech=kind==='observed-to-player-speech';
  const speaker=playerSpeech?investigator:npc,audience=[playerSpeech?npc:investigator];
  const actor=kind==='player-input-to-reply'||playerSpeech?npc:investigator;
  const acquired={actor,statement:`PRIVATE_ACQUIRED_${kind}`,mode:kind==='player-input-to-reply'?'heard':kind==='already-read-to-reply'?'read':'observed',
    ...(kind==='player-input-to-reply'?{source:investigator}:{}),state:'uncertain'};
  const materials=[{name:'room',kind:'description',visibility:'player',text:'A desk stands beside the window.'},
    {name:'reply',kind:'speech',visibility:'player',speaker,audience,text:'The office is open.'}];
  const event={name:'Already acquired account',summary:'An account was already acquired.',materials,
    knowledge:[{actor:investigator,statement:'A desk stands here.',mode:'observed',state:'accurate'},{...acquired,material:'reply'}]};
  const worldPath=join(campaignDir(k.workspace),'world.json'),world=readJson(worldPath),receipts=(await k.table('status')).receipts;
  const refused=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:5}],event});
  assert.equal(refused.code,'invalid_params');assert.match(refused.message,/speech cognition must match/);
  assert.deepEqual(readJson(worldPath),world);assert.deepEqual((await k.table('status')).receipts,receipts);
  assert.equal(refused.details.field,'event.knowledge[1].material');
  assert.equal(refused.details.knowledge_index,1);assert.equal(refused.details.material_index,1);
  assert.deepEqual(refused.details.mismatches,kind==='player-input-to-reply'?['source','audience']:['mode','source']);
  assert.deepEqual(refused.details.expected,{mode:'heard',source:speaker,actor_in_audience:audience});

  // Already acquired input/reading/observation is independent; no other knowledge row is discarded.
  const corrected=await k.table('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:5}],event:{...event,knowledge:[event.knowledge[0],acquired]}});
  assert.equal(corrected.outcome.knowledge_changes.length,2);
  assert.ok(corrected.outcome.knowledge_changes.every((item:Row)=>item.status==='active'));
  assert.equal((await k.table('capsule')).where.clock.minutes,5);
  const owner=actor===investigator?(await k.table('capsule')).player_knows:await k.ok('npc.perspective',{campaign:'c1',name:actor});
  assert.ok(owner.cognition.some((item:Row)=>item.statement===acquired.statement));

  // A genuine prospective hearing uses the offered relation and waits for accepted delivery.
  const expected=refused.details.expected;
  const futureHeard='PRIVATE_FUTURE_HEARD',futureRead='PRIVATE_FUTURE_NONSPEECH';
  const prospective=await k.table('apply',{call_id:'t1-c3',effects:[],event:{name:'Prospective acquisition',summary:'An acquisition awaits its delivery.',
    materials:[{...materials[1],name:'future-reply'},
      {name:'future-view',kind:'description',visibility:'player',text:'The notice is visible beside the door.'}],
    knowledge:[{actor:expected.actor_in_audience[0],source:expected.source,mode:expected.mode,state:'uncertain',statement:futureHeard,material:'future-reply'},
      {actor:investigator,mode:'observed',state:'accurate',statement:futureRead,material:'future-view'}]}});
  const pending=prospective.outcome.knowledge_changes.filter((item:Row)=>[futureHeard,futureRead].includes(item.statement));
  assert.equal(pending.length,2);assert.ok(pending.every((item:Row)=>item.status==='pending'));
  let capsule=await k.table('capsule');
  assert.equal(JSON.stringify(capsule.player_knows).includes(futureHeard),false);assert.equal(JSON.stringify(capsule.player_knows).includes(futureRead),false);
  const published=await k.table('narrate',{call_id:'t1-c4',text:'You pause before any reply.'});
  assert.deepEqual(published.disclosures,[],'unselected prospective materials are not activated by other prose');
  capsule=await k.table('capsule');
  assert.equal(JSON.stringify(capsule.player_knows).includes(futureHeard),false);assert.equal(JSON.stringify(capsule.player_knows).includes(futureRead),false);
  const saved=readJson(join(campaignDir(k.workspace),'turns','0001.json'));
  const future=saved.receipts.find((item:Row)=>item.kind==='event'&&item.event.name==='Prospective acquisition');
  assert.equal(future.event.knowledge.length,2,'prospective non-speech bindings retain the same stored contract');
  assert.equal(future.event.knowledge[1].mode,'observed');assert.ok(future.event.knowledge[1].material.endsWith('/future-view'));
});
