/** Runtime-owned clock receipts and restart boundaries from test_table_clocks.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,RpcClient,campaignDir,readJson,openTurn,type Row} from './support.ts';
const NEIGHBOURS='the neighbours downstairs',PATROLMAN='a patrolman comes up the stairs';
const mint=(k:RpcClient,call_id:string,args:Row={})=>k.table('apply',{call_id,effects:[{kind:'threat',mint:true,name:NEIGHBOURS,length:4,on_full:PATROLMAN,why:'the fight is loud',...args}]});
const receipt=async(k:RpcClient,applied:Row)=>(await k.table('status')).receipts.find((row:Row)=>applied.receipts.includes(row.id));
test('test_a_table_clock_is_started_advanced_by_its_name_and_lands',async t=>{
  const k=await kernel(t);await openTurn(k,'I shove him into the desk.');const started=await receipt(k,await mint(k,'t1-c1'));
  assert.equal(started.kind,'threat');assert.equal(started.minted,true);assert.equal(started.name,NEIGHBOURS);assert.deepEqual([started.before,started.after,started.segments,started.full],[0,1,4,false]);
  const handle=started.threat;assert.ok(handle.startsWith('table-threat-'));const world=readJson(join(campaignDir(k.workspace),'world.json'));
  assert.equal(world.table_threats[handle].on_full,PATROLMAN);assert.deepEqual(world.threat_clocks[handle],{clock:1});
  const capsule=await k.table('capsule'),pressed=capsule.pressures.find((row:Row)=>row.minted);
  assert.deepEqual([pressed.name,pressed.state,pressed.on_full],[NEIGHBOURS,'1/4',PATROLMAN]);
  const pacing=capsule.mods.pacing.threat_clocks.filter((row:Row)=>row.minted);assert.equal(pacing.length,1);
  assert.equal(pacing[0].threat,handle);assert.equal(pacing[0].state,'1/4');assert.ok(pacing[0].next.includes(PATROLMAN));
  const advanced=await receipt(k,await k.table('apply',{call_id:'t1-c2',effects:[{kind:'threat',name:NEIGHBOURS}]}));assert.deepEqual([advanced.before,advanced.after,advanced.full],[1,2,false]);
  const landed=await receipt(k,await k.table('apply',{call_id:'t1-c3',effects:[{kind:'threat',name:NEIGHBOURS,segments:2}]}));assert.deepEqual([landed.after,landed.full,landed.on_full],[4,true,PATROLMAN]);
  assert.deepEqual((await k.table('capsule')).pressures.filter((row:Row)=>row.minted),[]);
});
test('test_a_table_clock_survives_a_restart_and_is_listed_when_a_name_misses',async t=>{
  const k=await kernel(t);await openTurn(k,'I shove him into the desk.');await mint(k,'t1-c1');await k.table('narrate',{call_id:'t1-c2',text:'Somewhere below, a door opens.'});await k.close();
  const resumed=new RpcClient(k.workspace);t.after(()=>resumed.close());await resumed.table('player_input',{text:'I keep at it.'});
  const moved=await receipt(resumed,await resumed.table('apply',{call_id:'t2-c1',effects:[{kind:'threat',name:NEIGHBOURS}]}));assert.deepEqual([moved.before,moved.after],[1,2]);
  assert.ok((await resumed.tableErr('apply',{call_id:'t2-c2',effects:[{kind:'threat',name:'the landlady'}]})).details.options.includes(NEIGHBOURS));
});
test('test_minting_is_refused_for_the_books_threats_a_second_time_and_without_its_terms',async t=>{
  const k=await kernel(t);await openTurn(k,'I shove him into the desk.');
  assert.equal((await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'threat',mint:true,name:'corbitt-haunting',length:4,on_full:PATROLMAN}]})).details.field,'threat.name');await mint(k,'t1-c2');
  assert.equal((await k.tableErr('apply',{call_id:'t1-c3',effects:[{kind:'threat',mint:true,name:NEIGHBOURS,length:4,on_full:PATROLMAN}]})).details.field,'threat.name');
  for(const [bad,field] of [[{length:1},'threat.length'],[{length:13},'threat.length'],[{on_full:''},'threat.on_full'],[{on_full:'{{say:x}}'},'threat.on_full'],[{segments:9},'threat.segments']] as const)
    assert.equal((await k.tableErr('apply',{call_id:'t1-c4',effects:[Object.assign({kind:'threat',mint:true,name:'the telephone call',length:4,on_full:PATROLMAN},bad)]})).details.field,field);
});
test('test_a_table_clock_can_be_the_result_of_someones_intention',async t=>{
  const k=await kernel(t);await openTurn(k,'I shove him into the desk.');const declared=await receipt(k,await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',intends:'Shout down the stairwell for help.',outcome:'attempted'}]}));
  const ref=declared.intent.ref,started=await receipt(k,await mint(k,'t1-c2',{intent_ref:ref}));assert.deepEqual(started.intent,{ref,npc:'steven-knott',text:'Shout down the stairwell for help.',outcome:'done'});
});
