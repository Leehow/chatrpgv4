/** Explicit additional activity composes with travel without a special marker. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,campaignDir,readJson,openTurn} from './support.ts';

test('additional activity before or after travel settles once and retains atomic rollback and replay',async t=>{
  for(const timeIndex of [0,1]){
    const k=await kernel(t);await openTurn(k);
    const effects=[{kind:'time',minutes:5,why:'Return borrowed tools before walking'},
      {kind:'move',to:'newspaper-morgue',travel_minutes:30}];
    if(timeIndex===1)effects.reverse();
    const first=await k.table('apply',{call_id:'t1-c1',effects});
    assert.equal(readJson(join(campaignDir(k.workspace),'world.json')).clock.minutes,35);
    const replay=await k.table('apply',{call_id:'t1-c1',effects});
    assert.deepEqual(replay.receipts,first.receipts);
    assert.equal(readJson(join(campaignDir(k.workspace),'world.json')).clock.minutes,35);
    const beforeRefusal=readJson(join(campaignDir(k.workspace),'world.json'));
    const beforeReceipts=(await k.table('status')).receipts.map((r:any)=>r.id);
    await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:7},{kind:'move',to:'absent-destination'}]});
    assert.equal(readJson(join(campaignDir(k.workspace),'world.json')).clock.minutes,35);
    assert.deepEqual(readJson(join(campaignDir(k.workspace),'world.json')),beforeRefusal);
    assert.deepEqual((await k.table('status')).receipts.map((r:any)=>r.id),beforeReceipts);
  }
});

test('several selected journeys and independent activities share one ordered transaction',async t=>{
  const k=await kernel(t);await openTurn(k);
  await k.table('apply',{call_id:'t1-c1',effects:[
    {kind:'time',minutes:10,why:'Return borrowed tools'},
    {kind:'move',to:'newspaper-morgue',travel_minutes:30},
    {kind:'time',minutes:20,why:'Read the selected papers'},
    {kind:'move',to:'central-library',travel_minutes:40},
  ]});
  const world=readJson(join(campaignDir(k.workspace),'world.json'));
  assert.equal(world.clock.minutes,100);assert.equal(world.active_scene,'central-library');
});
