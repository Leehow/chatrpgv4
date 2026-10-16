/** Unstated harm obligations follow actual failed rolls and actual damage receipts. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {RpcClient,campaignDir,readJson} from './support.ts';
import {derivedTable,savedReceipts as receipts,savedSheet as sheet,apply,ok} from './rules-derived-support.ts';
const check=(path:string,extra:any={})=>({scope:'actor',values:[{path,label:path.split('.')[1]}],selection:'maximum',difficulty:'regular',...extra});
const rules={'dark-ledge':{hazard:{trigger:{kind:'keeper'},steps:[check('skills.Jump',{results:{failure:{effects:[{kind:'damage',dice_unstated:true}],book:'They fall into the dark.'},fumble:{effects:[{kind:'damage',dice_unstated:true}]}},push:{allowed:true}})]}},'chapel-floor':{hazard:{trigger:{kind:'keeper'},steps:[check('skills.Jump',{results:{failure:{effects:[{kind:'damage',dice:'1D6'}]}}})]}}};
const table=(t:any,seed=1)=>derivedTable(t,seed,rules);
const options=(k:any)=>k.ok('table.apply.options',{campaign:'c1'});
const resolve=(k:any,call_id:string,action:any)=>k.call('table.resolve',{campaign:'c1',call_id,action:{intent:'move',goal:'keep their footing',method:'careful steps',...action}});

test('source-stated POW loss changes the selected body rather than hit points and survives restart',async t=>{
  const k=await table(t),before=structuredClone(sheet(k));
  const result=ok(await apply(k,'t1-c1',{kind:'damage',resource:'pow',dice:'2D10',why:'loss after an opposed POW attack'}));
  const landed=receipts(k).filter((r:any)=>result.receipts.includes(r.id)),dice=landed.find((r:any)=>r.kind==='roll');
  const after=sheet(k);
  assert.equal(after.characteristics.POW,Math.max(0,before.characteristics.POW-dice.total));
  assert.equal(after.current_hp,before.current_hp);
  assert.deepEqual(after.conditions,before.conditions);
  assert.deepEqual(landed.filter((r:any)=>r.kind==='delta').map((r:any)=>r.resource),['pow']);
  ok(await apply(k,'t1-c2',{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult',why:'establish an ordinary adult profile'}));
  const worldPath=join(campaignDir(k.workspace),'world.json'),oldWorld=readJson(worldPath),npcPow=oldWorld.npc_profiles['steven-knott'].characteristics.POW;
  ok(await apply(k,'t1-c3',{kind:'damage',resource:'pow',subject:'Steven Knott',dice:'1D1',why:'source-stated power drain'}));
  assert.equal(readJson(worldPath).npc_resources['steven-knott'].characteristics.POW,npcPow-1);
  const workspace=k.workspace,content=k.content;await k.close();
  const reopened=new RpcClient(workspace,{content});t.after(()=>reopened.close());
  await reopened.ok('table.open',{campaign:'c1'});
  assert.equal(sheet(reopened).characteristics.POW,after.characteristics.POW);
  const opposed=ok(await reopened.call('table.resolve',{campaign:'c1',call_id:'t1-c4',action:{intent:'investigate',decision:'core-check:opposed-check',skill:'POW',target:'Steven Knott',goal:'resist a contest of power',method:'oppose their power'}}));
  const roll=receipts(reopened).find((r:any)=>opposed.receipts.includes(r.id)&&r.kind==='roll'&&r.roll_kind==='opposed_check');
  assert.equal(roll.target,after.characteristics.POW);
  assert.equal(roll.check.opponent_target,npcPow-1);
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
  assert.equal(changed.hp_current,pc.hp_current);
  assert.deepEqual(changed.conditions,pc.conditions);
});
test('test_a_reached_step_whose_damage_the_book_leaves_unstated_is_issued_until_harm_on_that_actor_lands',async t=>{const k=await table(t),before=await options(k);assert.ok(!('unstated_damage' in before));const rolled=ok(await resolve(k,'t1-c1',{rule:'dark-ledge'}));assert.equal(rolled.stated.level,'failure');assert.deepEqual(rolled.stated.effects,[{kind:'damage',dice_unstated:true}]);const roll=receipts(k).find((r:any)=>r.kind==='roll'),issued=(await options(k)).unstated_damage;assert.deepEqual(issued,[{alias:'unstated:0',rule:'dark-ledge',step:0,level:'failure',actor:'thomas-hayes',actor_label:roll.actor_label,book:'They fall into the dark.',receipt:roll.id}]);const again=await options(k);assert.deepEqual(again.unstated_damage,issued);assert.equal(again.revision,(await options(k)).revision);assert.notEqual(again.revision,before.revision);assert.deepEqual(receipts(k).map((r:any)=>r.kind),['roll']);const hp=sheet(k).current_hp,landed=ok(await apply(k,'t1-c2',{kind:'damage',band:'severe',subject:'thomas-hayes',why:'the fall'})),minted=receipts(k).filter((r:any)=>landed.receipts.includes(r.id));assert.ok(minted.every((r:any)=>r.basis==='banded'&&r.band==='severe'));const dice=minted.find((r:any)=>r.kind==='roll');assert.equal(dice.expression,'1D10');assert.equal(sheet(k).current_hp,hp-dice.total);assert.ok(!('unstated_damage' in await options(k)));});
test('test_a_stated_dice_issues_no_row_and_a_passed_step_issues_none',async t=>{const k=await table(t),rolled=ok(await resolve(k,'t1-c1',{rule:'chapel-floor'}));assert.equal(rolled.stated.level,'failure');assert.deepEqual(rolled.stated.effects,[{kind:'damage',dice:'1D6'}]);assert.ok(!('unstated_damage' in await options(k)));await k.close();const passed=await table(t,15),r=ok(await resolve(passed,'t1-c1',{rule:'dark-ledge'}));assert.ok(!['failure','fumble'].includes(r.stated.level));assert.ok(!('unstated_damage' in await options(passed)));});
test('test_the_keepers_own_damage_settles_the_row_and_a_passed_push_withdraws_it',async t=>{const k=await table(t);ok(await resolve(k,'t1-c1',{rule:'dark-ledge'}));assert.equal((await options(k)).unstated_damage.length,1);ok(await apply(k,'t1-c2',{kind:'damage',dice:'1D4',why:'the fall'}));assert.ok(!('unstated_damage' in await options(k)));await k.close();const pushed=await table(t),first=ok(await resolve(pushed,'t1-c1',{rule:'dark-ledge'}));assert.equal(first.stated.level,'failure');assert.deepEqual(first.stated.push,{allowed:true});assert.equal((await options(pushed)).unstated_damage.length,1);const push=ok(await resolve(pushed,'t1-c2',{push:true,stakes:'they fall',method:'a running leap'}));assert.equal(push.stated.rule,'dark-ledge');assert.ok(!['failure','fumble'].includes(push.stated.level));assert.ok(!('unstated_damage' in await options(pushed)));});
test('test_a_hit_point_delta_upward_settles_nothing_only_harm_does',async t=>{const k=await table(t);ok(await apply(k,'t1-c1',{kind:'damage',dice:'1D3',why:'a splinter'}));ok(await resolve(k,'t1-c2',{rule:'dark-ledge'}));assert.equal((await options(k)).unstated_damage.length,1);const aid=ok(await k.call('table.resolve',{campaign:'c1',call_id:'t1-c3',action:{intent:'investigate',goal:'bind the wound',method:'first aid on the wound'}}));assert.equal(aid.decision,'healing:first-aid-ordinary');assert.equal(aid.outcome.passed,true);assert.ok(aid.receipts.includes('delta:hp-t1-c3'));const healed=receipts(k).find((r:any)=>r.id==='delta:hp-t1-c3');assert.ok(healed.after>healed.before);assert.equal((await options(k)).unstated_damage.length,1);ok(await apply(k,'t1-c4',{kind:'damage',band:'minor',subject:'thomas-hayes',why:'the fall'}));assert.ok(!('unstated_damage' in await options(k)));});
