import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {table, usage, root, temporary} from './object-usages-fixture.mjs';

await build({stdin:{contents:"export {CombatSession} from './kernel-ts/combat/engine.ts'; export {RuleTables} from './kernel-ts/rules/tables.ts'; export {PythonRandom} from './kernel-ts/random.ts'; export * from './kernel-ts/testing/api.ts';",resolveDir:root,sourcefile:'stateful-engine-api.ts'},outfile:join(temporary,'stateful-engine-api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node22',logLevel:'silent'});
const engineApi = await import(pathToFileURL(join(temporary, 'stateful-engine-api.mjs')).href);

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
async function updateSheet(game, mutate) {
  const sheet = await readJson(game.sheetPath);
  mutate(sheet);
  await writeJson(game.sheetPath, sheet);
  return sheet;
}
async function prepareFor(game, object, value) {
  const input = {object, name: value.name, description: value.description};
  const job = await game.call('mods.job', {role: 'usage', input});
  assert.equal(job.enabled, true);
  if (!job.accepted) await writeFile(join(job.cwd, 'result.json'), JSON.stringify(value));
  const accepted = await game.call('mods.accept', {job: job.job});
  return {job, accepted, effect: {kind: 'usage', ...input, _usage: accepted}};
}
async function events(game) {
  try { return (await readFile(join(game.directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function addNpc(game) {
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult'}]);
}

const firearm = (name = 'close shot', malfunction = null, damage = '1D10') => ({
  name, description: 'Fire the same retained test pistol.', basis: 'The recorded loaded pistol.', mode: 'firearm',
  parameters: {skill: 'Firearms (Handgun)', damage, base_range_yards: 15, uses_per_round: 1, magazine: 6,
    malfunction, impale: true, adds_damage_bonus: false},
  player_view: {description: 'A retained pistol firing profile.', fields: ['skill', 'damage', 'magazine']},
});
async function addPistol(game) {
  const definition = {name: 'Test pistol', category: 'weapon', description: 'A retained six-shot handgun.', basis: 'Isolated test fixture.',
    parameters: {skill: 'Firearms (Handgun)', damage: '1D10', base_range_yards: 15, uses_per_round: 1, magazine: 6,
      malfunction: null, initial_ammo: 6, impale: true, adds_damage_bonus: false},
    player_view: {description: 'A test pistol.', fields: ['skill', 'damage', 'magazine']}};
  const job = await game.call('mods.job', {role: 'create', input: {name: definition.name, category: 'weapon', description: definition.description}});
  await writeFile(join(job.cwd, 'result.json'), JSON.stringify(definition));
  const accepted = await game.call('mods.accept', {job: job.job});
  await game.apply([{kind: 'define', name: definition.name, category: 'weapon', _definition: accepted.definition, _provenance: accepted.provenance},
    {kind: 'object', name: 'Shared pistol', definition: definition.name, to: game.sheet.name}]);
}

test('reload progress is shared by object id when switching firearm usages', async () => {
  const home = await mkdtemp(join(temporary, 'reload-home-'));
  const context = await engineApi.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'reload-usage', locks: engineApi.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const tables = new engineApi.RuleTables(context), object = 'object-pistol-1';
  const weapon = id => ({weapon_id: id, object_id: object, usage_id: id, usage: id, usage_mode: 'firearm', name: 'Shared pistol', display_name: 'Shared pistol',
    skill: 'Firearms (Handgun)', damage: '1D10', uses_per_round: '1', magazine: 6, ammo: 0, reload_rounds: 2, reload_kind: 'shells', ammo_per_reload_round: 1,
    malfunction: null, impales: true, adds_damage_bonus: false});
  const session = await engineApi.CombatSession.create('reload-object-pool', 'scene/test', 1, new engineApi.PythonRandom('reload-usage'), tables, [weapon('usage-a'), weapon('usage-b')]);
  session.addParticipant('actor', 'investigator', {dex: 50, combatSkill: 25, build: 0, hpMax: 10, firearmsSkill: 60, hasReadyFirearm: true,
    damageBonus: 'none', weapons: [{weapon_id: 'usage-a'}, {weapon_id: 'usage-b'}], conditions: []});
  session.addParticipant('target', 'npc', {dex: 40, combatSkill: 25, build: 0, hpMax: 10, weapons: ['unarmed'], conditions: []});
  session.beginRound();
  session.setAmmo('actor', 'usage-a', 0);
  const first = session.declareAndResolveTurn('actor', 'reload first usage', {weaponId: 'usage-a', resolutionHint: 'reload'});
  assert.equal(first.outcome, 'reload_in_progress');
  assert.deepEqual(session.participants.actor._reload_remaining, {[object]: 1});
  assert.equal(session.participants.actor._ammo[object], 1);
  const second = session.declareAndResolveTurn('actor', 'reload second usage', {weaponId: 'usage-b', resolutionHint: 'reload'});
  assert.equal(second.outcome, 'reload_complete');
  assert.deepEqual(session.participants.actor._reload_remaining, {});
  assert.equal(session.participants.actor._ammo[object], 2);
});

test('selected melee and thrown usages drive real rolls; a settled throw lands once with a receipt and event', async t => {
  const game = await table(t);
  await updateSheet(game, sheet => {
    sheet.skills['Fighting (Brawl)'] = 99;
    sheet.skills.Throw = 0;
    sheet.derived.DB = '1D4';
    sheet.current_hp = 99;
    sheet.derived.HP = 99;
  });
  const swingUse = usage(), throwUse = usage('throw', 'thrown');
  swingUse.parameters.damage = '1D1';
  throwUse.parameters.damage = '1D1';
  await game.apply([(await game.prepare(swingUse)).effect, (await game.prepare(throwUse)).effect]);
  await addNpc(game);

  const swing = await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', object: 'Study chair', usage: 'swing', target: 'Steven Knott', defense: 'none', goal: 'strike'}});
  assert.equal(swing.outcome.object_usage.usage, 'swing');
  assert.equal(swing.outcome.rolls[0].skill, 'Fighting (Brawl)');
  assert.equal(swing.outcome.rolls[0].target, 99);
  assert.ok(swing.outcome.damage.some(row => String(row.expression).startsWith('1D1+')), 'melee damage used the current actor damage bonus');

  await game.call('table.resolve', {call_id: game.next(), action: {actor: 'Steven Knott', intent: 'combat', target: game.sheet.name, goal: 'keep fighting'}});
  await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', defense: 'none'}});
  let combat = await readJson(join(game.directory, 'save/combat.json'));
  assert.equal(combat.status, 'active');
  const orderBefore = JSON.stringify(combat.current_initiative), historyBeforeThrow = structuredClone(combat.rounds);
  const callId = game.next();
  const thrown = await game.call('table.resolve', {call_id: callId, action: {intent: 'combat', object: 'Study chair', usage: 'throw', target: 'Steven Knott', defense: 'none', goal: 'throw'}});
  assert.equal(thrown.outcome.object_usage.usage, 'throw');
  assert.equal(thrown.outcome.rolls[0].skill, 'Throw');
  assert.equal(thrown.outcome.rolls[0].target, 1, 'Throw 0 is not allowed to fall back to Brawl');
  const world = await game.world();
  const chair = Object.values(world.objects.instances).find(item => item.name === 'Study chair');
  assert.equal(chair.owner.kind, 'scene');
  assert.equal(chair.owner.id, world.active_scene);
  assert.ok(thrown.receipts.some(id => id.startsWith('item:')), 'settled throw returned the transfer receipt');
  assert.ok((await events(game)).some(event => event.type === 'item-transferred' && event.data.name === 'Study chair' && event.receipt?.startsWith('item:')));
  const afterThrowCombat = await readJson(join(game.directory, 'save/combat.json'));
  assert.equal(afterThrowCombat.combat_id, combat.combat_id);
  assert.equal(afterThrowCombat.status, 'active');
  assert.equal(JSON.stringify(afterThrowCombat.current_initiative), orderBefore, 'changing usage did not rebuild initiative order');
  assert.deepEqual(afterThrowCombat.rounds[0].turns.slice(0, historyBeforeThrow[0].turns.length), historyBeforeThrow[0].turns, 'changing usage extended the existing turn history prefix');

  const beforeTransfers = (await events(game)).filter(event => event.type === 'item-transferred' && event.data.name === 'Study chair').length;
  await game.call('table.resolve', {call_id: callId, action: {intent: 'combat', object: 'Study chair', usage: 'throw', target: 'Steven Knott', defense: 'none', goal: 'throw'}});
  assert.equal((await events(game)).filter(event => event.type === 'item-transferred' && event.data.name === 'Study chair').length, beforeTransfers, 'idempotent replay did not transfer the thrown object again');
  await assert.rejects(game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', object: 'Study chair', usage: 'throw', target: 'Steven Knott', defense: 'none', goal: 'throw again'}}), /carry/);
});

test('pending thrown attacks revalidate owner and usage freshness before defense dice or landing', async t => {
  const game = await table(t);
  await updateSheet(game, sheet => { sheet.skills.Throw = 80; });
  await game.apply([(await game.prepare(usage('throw', 'thrown'))).effect]);
  await addNpc(game);
  const declared = await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', object: 'Study chair', usage: 'throw', target: 'Steven Knott', goal: 'throw and wait for defense'}});
  assert.match(declared.pending_choice.name, /^defense:/);
  let world = await game.world();
  const chair = () => Object.values(world.objects.instances).find(item => item.name === 'Study chair');
  assert.equal(chair().owner.id, game.sheet.id);
  let combat = await readJson(join(game.directory, 'save/combat.json'));
  assert.equal(combat.pending_attack.usage, 'throw');
  assert.equal(combat.rounds[0].turns.length, 0);
  const transferEvents = (await events(game)).filter(event => event.type === 'item-transferred' && event.data.name === 'Study chair').length;

  await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott'}]);
  await assert.rejects(game.call('table.resolve', {call_id: game.next(), action: {actor: 'Steven Knott', intent: 'combat', defense: 'none'}}), /stale|carry|holder|physical state/i);
  world = await game.world();
  assert.equal(chair().owner.id, 'steven-knott');
  assert.equal((await events(game)).filter(event => event.type === 'item-transferred' && event.data.name === 'Study chair').length, transferEvents + 1, 'failed defense did not land the thrown object');
  combat = await readJson(join(game.directory, 'save/combat.json'));
  assert.equal(combat.pending_attack.usage, 'throw');
  assert.equal(combat.rounds[0].turns.length, 0, 'failed stale defense did not record dice or a combat turn');

  await game.apply([{kind: 'object', name: 'Study chair', from: 'Steven Knott', to: game.sheet.name}]);
  const settled = await game.call('table.resolve', {call_id: game.next(), action: {actor: 'Steven Knott', intent: 'combat', defense: 'none'}});
  assert.equal(settled.outcome.object_usage.usage, 'throw');
  world = await game.world();
  assert.equal(chair().owner.kind, 'scene');
});

test('PC and NPC use the same transferred instance in an active fight without reopening the session', async t => {
  const game = await table(t);
  await updateSheet(game, sheet => { sheet.characteristics.DEX = 1; sheet.current_hp = 99; sheet.derived.HP = 99; });
  const safeSwing = usage();
  safeSwing.parameters.damage = '1D1';
  await game.apply([(await game.prepare(safeSwing)).effect]);
  await addNpc(game);
  const opened = await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', object: 'Study chair', usage: 'swing', target: 'Steven Knott', defense: 'none', goal: 'strike'}});
  assert.equal(opened.outcome.started, true);
  assert.equal(opened.outcome.rolls.length, 0, 'the slow investigator opened an active fight without taking the first turn');
  const before = await readJson(join(game.directory, 'save/combat.json'));
  assert.equal(before.status, 'active');

  await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott'}]);
  const world = await game.world();
  const chair = Object.values(world.objects.instances).find(item => item.name === 'Study chair');
  assert.equal(chair.owner.kind, 'npc');
  assert.equal(chair.owner.id, 'steven-knott');
  const npc = await game.call('table.resolve', {call_id: game.next(), action: {actor: 'Steven Knott', intent: 'combat', object: 'Study chair', usage: 'swing', target: game.sheet.name, defense: 'none', goal: 'swing it back'}});
  assert.equal(npc.outcome.started ?? false, false);
  assert.equal(npc.outcome.object_usage.instance, chair.id);
  const after = await readJson(join(game.directory, 'save/combat.json'));
  assert.equal(after.combat_id, before.combat_id);
  assert.equal(after.started_at_turn, before.started_at_turn);
  assert.equal(after.status, 'active');
  assert.deepEqual(after.rounds[0].turns.slice(0, before.rounds[0].turns.length), before.rounds[0].turns, 'the existing turn history prefix was preserved');
  assert.ok(after.rounds[0].turns.length > before.rounds[0].turns.length, 'the existing turn history was extended, not replaced');
});

test('firearm usages share the object ammo pool and jam state blocks new firing usages without blocking a new melee usage', async t => {
  const game = await table(t);
  await addPistol(game);
  await updateSheet(game, sheet => { sheet.skills['Firearms (Handgun)'] = 99; sheet.current_hp = 99; sheet.derived.HP = 99; });
  await game.apply([(await prepareFor(game, 'Shared pistol', firearm('close shot', null, '1D1'))).effect,
    (await prepareFor(game, 'Shared pistol', firearm('careful shot', null, '1D1'))).effect]);
  await addNpc(game);

  await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', object: 'Shared pistol', usage: 'close shot', target: 'Steven Knott', defense: 'none', goal: 'fire'}});
  let world = await game.world();
  let pistol = Object.values(world.objects.instances).find(item => item.name === 'Shared pistol');
  assert.equal(pistol.state.ammo, 5);
  let combat = await readJson(join(game.directory, 'save/combat.json'));
  const actor = combat.participants.find(item => item.actor_id === game.sheet.id);
  assert.deepEqual(Object.keys(actor._ammo), [pistol.id]);
  assert.equal(actor._ammo[pistol.id], 5);
  assert.ok(!Object.keys(actor._ammo).some(key => key.startsWith('usage-')), 'ammo is keyed by the physical object, not by a usage id');
  await game.call('table.resolve', {call_id: game.next(), action: {actor: 'Steven Knott', intent: 'combat', target: game.sheet.name, goal: 'keep fighting'}});
  await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', defense: 'none'}});
  const second = await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', object: 'Shared pistol', usage: 'careful shot', target: 'Steven Knott', defense: 'none', goal: 'fire again'}});
  assert.equal(second.outcome.object_usage.usage, 'careful shot');
  world = await game.world();
  pistol = Object.values(world.objects.instances).find(item => item.name === 'Shared pistol');
  assert.equal(pistol.state.ammo, 4);
  combat = await readJson(join(game.directory, 'save/combat.json'));
  const actorAfterSecond = combat.participants.find(item => item.actor_id === game.sheet.id);
  assert.deepEqual(Object.keys(actorAfterSecond._ammo), [pistol.id]);
  assert.equal(actorAfterSecond._ammo[pistol.id], 4);

  const jamGame = await table(t);
  await addPistol(jamGame);
  await updateSheet(jamGame, sheet => { sheet.skills['Firearms (Handgun)'] = 99; });
  await jamGame.apply([(await prepareFor(jamGame, 'Shared pistol', firearm('jam shot', 1))).effect]);
  await addNpc(jamGame);
  await jamGame.call('table.resolve', {call_id: jamGame.next(), action: {intent: 'combat', object: 'Shared pistol', usage: 'jam shot', target: 'Steven Knott', defense: 'none', goal: 'force a jam'}});
  world = await jamGame.world();
  pistol = Object.values(world.objects.instances).find(item => item.name === 'Shared pistol');
  assert.equal(pistol.state.condition, 'jammed');
  await assert.rejects(jamGame.apply([(await prepareFor(jamGame, 'Shared pistol', firearm('bypass jam'))).effect]), /jammed|broken|firing/);
  const pistolWhip = usage('pistol whip', 'melee');
  pistolWhip.description = 'Strike with the jammed pistol as a hand weapon.';
  pistolWhip.basis = 'The jammed pistol remains a solid handheld object.';
  await jamGame.apply([(await prepareFor(jamGame, 'Shared pistol', pistolWhip)).effect]);
  assert.ok(Object.values((await jamGame.world()).objects.usages).some(row => row.name === 'pistol whip' && row.physical_basis.condition === 'jammed'));
});
