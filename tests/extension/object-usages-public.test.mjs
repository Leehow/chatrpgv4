import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table} from './object-usages-fixture.mjs';

async function defineLegacyWeapon(game) {
  const definition = {name: 'Pocket knife', category: 'weapon', description: 'A small folding knife.', basis: 'A mundane carried knife.',
    parameters: {skill: 'Fighting (Brawl)', damage: '1D4', base_range_yards: null, uses_per_round: 1, magazine: null,
      malfunction: null, impale: true, adds_damage_bonus: true},
    player_view: {description: 'A small folding knife.', fields: ['damage']}};
  const job = await game.call('mods.job', {role: 'create', input: {name: definition.name, category: 'weapon', description: definition.description}});
  assert.equal(job.enabled, true);
  await writeFile(join(job.cwd, 'result.json'), JSON.stringify(definition));
  const accepted = await game.call('mods.accept', {job: job.job});
  await game.apply([{kind: 'define', name: definition.name, category: 'weapon', _definition: accepted.definition, _provenance: accepted.provenance},
    {kind: 'object', name: 'Pocket knife', definition: definition.name, to: game.sheet.name}]);
}

function publicInvestigator(view, name) {
  return view.investigators.find(sheet => sheet.name === name);
}

test('public player sheet projects object usage fields from the accepted usage view only', async t => {
  const game = await table(t);
  const legacyLook = await game.call('table.look', {focus: 'object', name: 'Study chair'});
  assert.equal(Object.hasOwn(legacyLook.instance, 'usages'), false, 'old objects without usage records keep the legacy look shape');
  const audit = await game.call('mods.job', {role: 'audit', input: {text: 'Check the chair before any special usage exists.'}});
  const context = JSON.parse(await readFile(join(audit.cwd, 'context.json'), 'utf8'));
  const contextChair = context.objects.instances.find(item => item.name === 'Study chair');
  assert.equal(Object.hasOwn(contextChair, 'usages'), false, 'old objects without usage records keep the legacy context shape');

  const prepared = await game.prepare();
  await game.apply([prepared.effect]);
  await defineLegacyWeapon(game);

  const usageLook = await game.call('table.look', {focus: 'object', name: 'Study chair'});
  assert.ok(usageLook.instance.usages.some(row => row.name === 'swing' && row.parameters.damage === '1D6'));

  const world = await game.world(), definition = Object.values(world.objects.definitions).find(value => value.name === 'Chair frame');
  assert.equal(definition.category, 'item');

  const view = await game.call('table.view'), sheet = publicInvestigator(view, game.sheet.name);
  assert.ok(sheet, 'the player view includes the investigator sheet');
  assert.equal(sheet.objects.filter(item => item.name === 'Study chair').length, 1, 'the usage does not duplicate the physical item');

  assert.equal(sheet.weapons.some(row => row.name === 'Study chair'), false, 'an attack usage does not turn an ordinary item into a weapon');
  assert.equal(sheet.equipment.filter(row => row.name === 'Study chair').length, 1);
  const chair = sheet.objects.find(row => row.name === 'Study chair').usages.find(row => row.name === 'swing');
  assert.ok(chair, 'the ordinary object carries its named attack usage');
  assert.equal(chair.parameters.skill, 'Fighting (Brawl)');
  assert.equal(chair.parameters.damage, '1D6');
  for (const hidden of ['uses_per_round', 'base_range_yards', 'impale', 'impales', 'adds_damage_bonus', 'basis', 'provenance', 'physical_basis', 'digest'])
    assert.equal(Object.hasOwn(chair.parameters, hidden), false, `${hidden} stays private on the player sheet`);

  const legacy = sheet.weapons.find(row => row.name === 'Pocket knife');
  assert.ok(legacy, 'legacy object-backed weapons still project through definition.player_view');
  assert.equal(legacy.damage, '1D4');
  assert.equal(Object.hasOwn(legacy, 'skill'), false);
  assert.equal(Object.hasOwn(legacy, 'uses_per_round'), false);
});

test('an old speculative profile does not leave damage on the current item sheet and can be activated by apply usage', async t => {
  const game = await table(t), prepared = await game.prepare();
  await game.apply([prepared.effect]);
  const world = await game.world(), retained = Object.values(world.objects.usages)[0];
  retained.provenance.prefetched = true;
  const evidence = structuredClone(retained);
  await writeFile(join(game.directory, 'world.json'), JSON.stringify(world));
  const before = publicInvestigator(await game.call('table.view'), game.sheet.name);
  assert.equal(before.weapons.some(row => row.name === 'Study chair'), false);
  assert.equal(before.objects.find(row => row.name === 'Study chair').usages, undefined);
  assert.equal(before.equipment.filter(row => row.name === 'Study chair').length, 1);
  await assert.rejects(game.call('mods.job', {role:'usage', input:{object:'Study chair', propose:true}}), error => error.details.reason === 'usage_requires_action');
  const chosen = await game.prepare();
  assert.equal(chosen.accepted.provenance.reused_usage, retained.id);
  await game.apply([chosen.effect]);
  const after = publicInvestigator(await game.call('table.view'), game.sheet.name);
  assert.equal(after.weapons.some(row => row.name === 'Study chair'), false);
  assert.deepEqual(after.objects.find(row => row.name === 'Study chair').usages, [{name:'swing', parameters:{skill:'Fighting (Brawl)', damage:'1D6'}}]);
  const settled = await game.world();
  assert.deepEqual(settled.objects.usages[retained.id], evidence);
  assert.equal(settled.objects.usage_activations[retained.id], true);
  await game.apply([{kind:'npc', name:'Steven Knott', archetype:'ordinary_adult'}]);
  const attack = await game.call('table.resolve', {call_id:game.next(), action:{intent:'combat', object:'Study chair', usage:'swing', target:'Steven Knott', defense:'none', goal:'strike'}});
  assert.equal(attack.outcome.object_usage.usage, 'swing');
  assert.ok(attack.outcome.rolls.length > 0, 'the activated historical profile reaches the real combat executor');
});
