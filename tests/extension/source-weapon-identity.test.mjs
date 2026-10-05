/** §180.19: source identity survives usage; the ordinary combat executor owns the effect. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {root, table} from './object-usages-fixture.mjs';
import {sourceWeapon, enterSourceEncounter, setFixtureSkill} from './source-weapon-fixture.mjs';

const temporary=await mkdtemp(join(tmpdir(),'source-weapon-identity-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await symlink(join(root,'node_modules'),join(temporary,'node_modules'),'dir');
await build({stdin:{contents:`export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {combatOperationFor,authoredWeaponMatches} from './kernel-ts/combat/profiles.ts';`,resolveDir:root,sourcefile:'source-weapon-api.ts'},
  outfile:join(temporary,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',logLevel:'silent'});
const api=await import(pathToFileURL(join(temporary,'api.mjs')).href);
const raw=JSON.parse(await readFile(join(root,'content/starters/the-haunting/module-graph.json'),'utf8'));
const graph=new api.ModuleGraph('the-haunting',raw,'',{}), scene=graph.nodes.get('scene-corbitt-confrontation');
const identity={module_id:'the-haunting',node_id:'artifact-corbitt-ritual-dagger'};
const managed={weapon_id:'usage-controlled',object_id:'physical-1',usage_mode:'melee',source_object:identity};

test('canonical and managed source identities select the authored rule; labels, scope and attack mode cannot grant it',()=>{
  const operation=weapon=>api.combatOperationFor(graph,scene,'walter-corbitt',weapon)[1];
  assert.equal(operation('corbitt-ritual-dagger').rulebook_exception,'own_dagger_ignores_spells');
  assert.equal(operation({weapon_id:'corbitt-ritual-dagger',skill:'Fighting (Knife)'}).rulebook_exception,'own_dagger_ignores_spells');
  assert.equal(operation(managed).on_success.kind,'destroy_target');
  assert.equal(operation({...managed,name:'A renamed retained blade'}).rulebook_exception,'own_dagger_ignores_spells');
  for(const weapon of [
    {...managed,source_object:undefined,name:"Corbitt's ritual dagger"},
    {...managed,source_object:undefined,weapon_id:'corbitt-ritual-dagger'},
    {...managed,source_object:{...identity,module_id:'other-module'}},
    {...managed,source_object:{...identity,node_id:'object-floating-dagger'}},
    {...managed,usage_mode:'thrown'}, {...managed,usage_mode:'firearm'},
    {weapon_id:'corbitt-ritual-dagger',skill:'Throw'},
  ]) assert.equal(operation(weapon).rulebook_exception,undefined);
  assert.equal(api.combatOperationFor(graph,scene,'steven-knott',managed)[0],null);
});

test('explicit first placement binds one source; rebinding, nonphysical handles and duplicate copies fail atomically',async t=>{
  const game=await table(t), dagger=await sourceWeapon(game);
  assert.deepEqual(dagger.item.source_object,identity);
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.deepEqual(sheet.weapons.find(row=>row.usage_id===dagger.usage.id).source_object,identity);
  const before=await game.world();
  for(const effect of [
    {kind:'object',name:'Study chair',to:game.sheet.name,source_object:'corbitt-ritual-dagger'},
    {kind:'object',name:dagger.name,to:game.sheet.name,source_object:'walter-corbitt'},
    {kind:'object',name:'Extra source copy',definition:dagger.definition.name,to:game.sheet.name,source_object:'corbitt-ritual-dagger'},
    {kind:'object',name:'Stacked source',definition:dagger.definition.name,to:game.sheet.name,source_object:'corbitt-ritual-dagger',quantity:2},
    {kind:'object',name:'Alias is not a handle',definition:dagger.definition.name,to:game.sheet.name,source_object:"Corbitt's ritual dagger"},
  ]) {
    await assert.rejects(game.apply([effect]));
    assert.deepEqual((await game.world()).objects,before.objects);
  }
  await game.apply([{kind:'object',name:dagger.name,from:game.sheet.name,to:'here'}]);
  assert.deepEqual((await game.world()).objects.instances[dagger.item.id].source_object,identity);
  await assert.rejects(game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:'stab',target:'Steven Knott',defense:'none'}}),/carry|owner|held/i);
});

for(const config of [{label:'source stabbing',bound:true,mode:'melee',special:true},
  {label:'same-name ordinary dagger',bound:false,mode:'melee',special:false},
  {label:'throwing the source dagger',bound:true,mode:'thrown',special:false}]) {
  test(`real resolve: ${config.label}`,async t=>{
    const game=await table(t); await setFixtureSkill(game);
    const dagger=await sourceWeapon(game,config); await enterSourceEncounter(game);
    const result=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:dagger.usage.name,target:'Walter Corbitt',defense:'none',goal:'Controlled source-rule acceptance'}});
    const combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
    assert.ok(result.outcome.rolls.length>0,'an attack actually rolled');
    assert.equal(combat.weapon_catalog[dagger.usage.id].weapon_id,dagger.usage.id);
    assert.equal(combat.status==='concluded',config.special);
    if(config.special) {
      assert.equal(combat.outcome,'investigators_win');
      assert.equal(combat.participants.find(row=>row.actor_id==='walter-corbitt').hp_current,0);
      assert.ok(combat.participants.find(row=>row.actor_id==='walter-corbitt').conditions.includes('dead'));
      const turn=JSON.parse(await readFile(join(game.directory,'turn.json'),'utf8'));
      assert.ok(turn.receipts.some(row=>row.kind==='session'&&row.transition==='end'&&result.receipts.includes(row.id)));
      assert.equal((await game.world()).npc_resources['walter-corbitt'].current_hp,0);
    } else assert.ok(combat.participants.find(row=>row.actor_id==='walter-corbitt').hp_current>0);
  });
}

test('the same source dagger does not execute the encounter effect against another actor',async t=>{
  const game=await table(t); await setFixtureSkill(game); const dagger=await sourceWeapon(game);
  await game.apply([{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult'}]);
  await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:'stab',target:'Steven Knott',defense:'none'}});
  const combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.notEqual(combat.outcome,'investigators_win');
  assert.ok(combat.participants.find(row=>row.actor_id==='steven-knott').hp_current>0);
});

test('a missed source stabbing leaves Corbitt alive and the fight active',async t=>{
  const game=await table(t); await setFixtureSkill(game,1); const dagger=await sourceWeapon(game); await enterSourceEncounter(game);
  const result=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:'stab',target:'Walter Corbitt',defense:'none'}});
  const combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.equal(result.outcome.turn_outcome,'miss');
  assert.equal(combat.status,'active');
  assert.ok(combat.participants.find(row=>row.actor_id==='walter-corbitt').hp_current>0);
  assert.ok(!combat.participants.find(row=>row.actor_id==='walter-corbitt').conditions.includes('dead'));
});

test('a historical unmanaged canonical weapon still executes the authored effect',async t=>{
  const game=await table(t); await setFixtureSkill(game);
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  sheet.weapons.push({weapon_id:'corbitt-ritual-dagger',name:'Retained historical source weapon',skill:'Fighting (Brawl)',damage:'1D4',impales:true});
  await writeFile(game.sheetPath,JSON.stringify(sheet));
  await enterSourceEncounter(game);
  const result=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',weapon:'corbitt-ritual-dagger',target:'Walter Corbitt',defense:'none'}});
  const combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.equal(combat.outcome,'investigators_win');
  assert.equal(combat.participants.find(row=>row.actor_id==='walter-corbitt').hp_current,0);
  assert.ok(result.outcome.rolls.length>0);
});

test('a source dagger chosen after ordinary combat opens obtains its own per-attack rule',async t=>{
  const game=await table(t); await setFixtureSkill(game); const dagger=await sourceWeapon(game); await enterSourceEncounter(game);
  await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',weapon:'unarmed',target:'Walter Corbitt',defense:'none'}});
  let combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.equal(combat.status,'active');
  const operation=JSON.parse(await readFile(join(game.directory,'save/combat-operation.json'),'utf8'));
  assert.equal(operation.operation.rulebook_exception,undefined);
  await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',actor:'Walter Corbitt',weapon:'unarmed',target:game.sheet.name,defense:'none'}});
  const result=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:'stab',target:'Walter Corbitt',defense:'none'}});
  combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.equal(combat.outcome,'investigators_win');
  assert.equal(combat.participants.find(row=>row.actor_id==='walter-corbitt').hp_current,0);
  assert.ok(result.outcome.rolls.length>0);
});

test('another holder cannot use the investigators source dagger; a pending attack refuses a transferred object',async t=>{
  const game=await table(t); await setFixtureSkill(game); const dagger=await sourceWeapon(game); await enterSourceEncounter(game);
  await assert.rejects(game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',actor:'Walter Corbitt',object:dagger.name,usage:'stab',target:game.sheet.name,defense:'none'}}),/carry|owner|held/i);
  await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:'stab',target:'Walter Corbitt'}});
  const before=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.equal(before.pending_attack.rulebook_exception,'own_dagger_ignores_spells');
  await game.apply([{kind:'object',name:dagger.name,from:game.sheet.name,to:'here'}]);
  await assert.rejects(game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',decision:'combat:defend',actor:'Walter Corbitt',defense:'none'}}),/carry|owner|held|stale/i);
  const after=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.deepEqual(after.damage_chain,before.damage_chain);
  assert.equal(after.status,'active');
  assert.ok(after.participants.find(row=>row.actor_id==='walter-corbitt').hp_current>0);
});
