/** POW harm regression through the existing native settlement and persistence paths. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {RpcClient,campaignDir,readJson} from './support.ts';
import {derivedTable,savedReceipts as receipts,savedSheet as sheet,apply,ok} from './rules-derived-support.ts';
const table=(t:any)=>derivedTable(t,1,{});

test('source-stated POW loss changes the selected body rather than hit points and survives restart',async t=>{
  const k=await table(t),before=structuredClone(sheet(k));
  const result=ok(await apply(k,'t1-c1',{kind:'damage',resource:'pow',dice:'2D10',why:'loss after an opposed POW attack'}));
  const landed=receipts(k).filter((r:any)=>result.receipts.includes(r.id)),dice=landed.find((r:any)=>r.kind==='roll');
  const after=sheet(k);
  assert.equal(after.characteristics.POW,Math.max(0,before.characteristics.POW-dice.total));
  assert.equal(after.current_hp,before.current_hp);
  assert.deepEqual(after.conditions,before.conditions);
  assert.deepEqual(landed.filter((r:any)=>r.kind==='delta').map((r:any)=>r.resource),['pow','mp']);
  assert.equal(after.derived.MP,Math.floor(after.characteristics.POW/5));
  assert.equal(after.current_mp,after.derived.MP);
  ok(await apply(k,'t1-c2',{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult',why:'establish an ordinary adult profile'}));
  const worldPath=join(campaignDir(k.workspace),'world.json'),oldWorld=readJson(worldPath),npcPow=oldWorld.npc_profiles['steven-knott'].characteristics.POW;
  ok(await apply(k,'t1-c3',{kind:'damage',resource:'pow',subject:'Steven Knott',dice:'10D1',why:'source-stated power drain'}));
  const npcResources=readJson(worldPath).npc_resources['steven-knott'];
  assert.equal(npcResources.characteristics.POW,npcPow-10);
  assert.equal(npcResources.derived.MP,Math.floor((npcPow-10)/5));
  assert.equal(npcResources.current_mp,npcResources.derived.MP);
  const workspace=k.workspace,content=k.content;await k.close();
  const reopened=new RpcClient(workspace,{content});t.after(()=>reopened.close());
  await reopened.ok('table.open',{campaign:'c1'});
  assert.equal(sheet(reopened).characteristics.POW,after.characteristics.POW);
  const opposed=ok(await reopened.call('table.resolve',{campaign:'c1',call_id:'t1-c4',action:{intent:'investigate',decision:'core-check:opposed-check',skill:'POW',target:'Steven Knott',goal:'resist a contest of power',method:'oppose their power'}}));
  const roll=receipts(reopened).find((r:any)=>opposed.receipts.includes(r.id)&&r.kind==='roll'&&r.roll_kind==='opposed_check');
  assert.equal(roll.target,after.characteristics.POW);
  assert.equal(roll.check.opponent_target,npcPow-10);
});

test('an invalid damage resource refuses atomically instead of silently damaging HP',async t=>{
  const k=await table(t),before=structuredClone(sheet(k)),old=structuredClone(receipts(k));
  const result=await apply(k,'t1-c1',{kind:'damage',resource:'unknown',dice:'1D1',why:'invalid resource fixture'});
  assert.equal(result.ok,false);
  assert.deepEqual(sheet(k),before);
  assert.deepEqual(receipts(k),old);
});

test('POW loss updates an active combat snapshot and clamps at zero without a wound',async t=>{
  const k=await table(t);
  ok(await apply(k,'t1-c1',{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult',why:'establish an ordinary adult profile'}));
  ok(await k.call('table.resolve',{campaign:'c1',call_id:'t1-c2',action:{intent:'combat',decision:'combat:attack',target:'Steven Knott',weapon:'unarmed',defense:'dodge',goal:'strike the opponent',method:'an unarmed strike'}}));
  const combatPath=join(campaignDir(k.workspace),'save/combat.json'),before=readJson(combatPath),pc=before.participants.find((p:any)=>p.actor_id==='thomas-hayes');
  assert.equal(before.status,'active');
  ok(await apply(k,'t1-c3',{kind:'damage',resource:'pow',dice:'100D1',why:'source-stated power loss'}));
  const after=readJson(combatPath),changed=after.participants.find((p:any)=>p.actor_id==='thomas-hayes');
  assert.equal(sheet(k).characteristics.POW,0);
  assert.equal(changed.characteristics.POW,0);
  assert.equal(changed.magic_points,0);
  assert.equal(changed.hp_current,pc.hp_current);
  assert.deepEqual(changed.conditions,pc.conditions);
});

test('POW loss lowers the existing MP ceiling and rest cannot restore the obsolete maximum',async t=>{
  const k=await table(t);
  ok(await apply(k,'t1-c1',{kind:'time',minutes:60,activity:'rest',why:'establish the existing regeneration clock'}));
  const statePath=join(campaignDir(k.workspace),'save/mp-state/thomas-hayes.json');
  assert(readJson(statePath).mp_max>0);
  ok(await apply(k,'t1-c2',{kind:'damage',resource:'pow',dice:'100D1',why:'source-stated power loss'}));
  assert.equal(sheet(k).derived.MP,0);
  assert.equal(sheet(k).current_mp,0);
  assert.equal(readJson(statePath).mp_max,0);
  ok(await apply(k,'t1-c3',{kind:'time',minutes:120,activity:'rest',why:'rest after power loss'}));
  assert.equal(sheet(k).current_mp,0);
  assert.equal(readJson(statePath).mp_max,0);
});
