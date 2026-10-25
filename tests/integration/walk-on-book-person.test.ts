/** §270.4: a walk-on under a name the book already has seats that person; a table-made person is not reselected. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn,type Row} from './support.ts';

test('a newcomer slot labelled with a book person\'s name seats the book person instead of refusing',async t=>{
  const k=await kernel(t);await openTurn(k,'I wait for Knott.');
  const seated=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'here',walk_on:true,_new_person:true,why:'He comes back in.'}]});
  assert.ok(seated.receipts.length,'the book person is seated, not refused');
  const capsule=await k.table('capsule',{});
  assert.ok(capsule.present.some((row:Row)=>row.name==='Steven Knott'));
});

test('a newcomer slot still refuses a person this table made',async t=>{
  const k=await kernel(t);await openTurn(k,'I wait.');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'the night porter',to:'here',walk_on:true,why:'A porter comes in.'}]});
  const refused=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'npc',name:'the night porter',to:'here',walk_on:true,_new_person:true,why:'Again.'}]});
  assert.equal(refused.code,'invalid_params');assert.match(refused.message,/existing person/);
});
