/**
 * Contract §180.6 (docs/specs/creature-kind.md D19, ticket CK-E): the Keeper's own animal is a creature with a stat block
 * from the rules catalog, never a person.
 *
 * Before this, `apply npc walk_on` minted a yard dog into `world.table_people`, and every person feature reached it. Now
 * `apply npc {walk_on: true, creature: "<catalog creature>" | true}` declares a table creature, the kernel pins the
 * entry's block (rolled where the book prints a roll, the printed value where it states one), and the creature is an
 * actor that fights with those numbers. A block can be pinned later on a creature that has none.
 *
 * One fixture book, built here and owing nothing to the shipped starters: a cellar with a warden (a person), a rat swarm
 * that states a stat block, and a moth cloud that states none. Every read and write travels a real entry
 * (`campaign.create`, `table.*`, `npc.*`, `epithets.job`).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {COC_TOOLS, DOSSIER_VALUE_MAX} from '../../extensions/kernel/tools.ts';

const root = resolve(import.meta.dirname, '../..');
const scratch = await mkdtemp(join(tmpdir(), 'table-creature-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'table-creature-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'table-creature-api.ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);
const BEASTS = JSON.parse(await readFile(join(root, 'content/rulesets/coc7/rules-json/beasts.json'), 'utf8')).beasts;
const MONSTERS = JSON.parse(await readFile(join(root, 'content/rulesets/coc7/rules-json/monsters.json'), 'utf8')).monsters;

// ---------------------------------------------------------------------------------------------------
// The fixture book.
// ---------------------------------------------------------------------------------------------------

const MODULE = 'module-walkon-bench', CELLAR = 'scene-cellar';
const RATS = 'Cellar rats', MOTHS = 'Moth cloud', WARDEN = 'Old warden';
const DOG = 'the yard dog', THING = 'the thing in the well', SWARM = 'the swarm by the hive';

function bench() {
  const claims = [], relations = [];
  let n = 0;
  const relate = (kind, from, to) => {
    n += 1;
    const claim_id = `claim-${kind}-${n}`;
    claims.push({claim_id, subject_id: from, predicate: kind, object: {node_id: to}, truth_status: 'authored-fact', visibility: 'keeper-only',
      evidence_span_ids: [], asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1, reason: 'Walk-on bench fixture.'});
    relations.push({relation_id: `relation-${kind}-${n}`, relation_kind: kind, from_node_id: from, to_node_id: to, claim_id, properties: {}});
  };
  const node = (node_id, node_kind, name, summary, properties, visibility = 'keeper-only') =>
    ({node_id, node_kind, name, visibility, aliases: [], summary, evidence_span_ids: [], properties, source_refs: []});
  const meta = {schema_version: 1, scenario_id: 'walkon-bench', source_language: 'en', runtime_projection_contract: 'coc.module-graph-runtime-projection.v1',
    title: 'The Walk-on Bench', opening_scene: 'A cellar with a warden.', one_liner: 'A cellar, a warden, rats and moths.',
    structure_type: 'hub_sandbox', era: '1920s', setting_tags: ['test'], content_flags: ['test-module'], win_condition: 'None; a bench.',
    start_clock: {calendar_mode: 'gregorian', local_datetime: '1925-03-02T21:00:00', timezone: 'America/New_York', display: '1925-03-02 21:00'},
    summary: 'A bench for the Keeper\'s own animals.', player_safe_summary: 'A cellar in Boston.', keeper_secret_summary: 'Rats behind the boards.',
    license: 'Apache-2.0', author: 'chatrpgv4 contributors', attribution: 'Original test content.', copyright_notice: []};
  const cellar = node(CELLAR, 'scene', 'Cellar', 'Cellar, a test place.', {runtime_projection: {document: 'story-graph.json', collection: 'scenes', record: {
    scene_id: 'cellar', is_start: true, location_tags: ['test'], scene_type: 'social', origin: 'source', dramatic_question: 'Who is here?',
    entry_conditions: [], exit_conditions: [], available_clues: [], npc_ids: [], pressure_moves: [], storylet_tags: [], affordances: [], tone: [],
    allowed_improvisation: [], scene_edges: []}}});
  const warden = node('npc-old-warden', 'npc', WARDEN, 'A stooped warden who keeps the cellar keys.', {runtime_projection: {document: 'npc-agendas.json', collection: 'npcs', record: {
    npc_id: 'npc-old-warden', name: WARDEN, origin: 'source', agenda: 'Keep the cellar shut.', fear: 'The boards giving way.', secret: 'He feeds the rats.', voice: 'Gruff.',
    relationship_to_investigators: 'stranger', known_fact_ids: [], revealable_fact_ids: [], disclosure_order: [], facts: [], lie_options: [], deflect_options: [],
    leverage_ids: [], active_reactions: [], availability: {status: 'available'}, schedule: [], keeper_note: 'A person of the bench.',
    biography: `${WARDEN}, in a long coat with a ring of keys.`}}}, 'player-safe');
  const nodes = [
    node(MODULE, 'module', meta.title, meta.one_liner, {asset_root_id: null, source_binding: {},
      runtime_projection: {contract_id: 'coc.module-graph-runtime-projection.v1', documents: [{filename: 'module-meta.json', root: meta}]}}),
    cellar, warden,
    // The book prints the swarm's numbers: a creature with a block of its own.
    {...node('creature-cellar-rats', 'creature', RATS, 'A swarm of rats behind the cellar boards.', {mechanics: {profile: {
      characteristics: {STR: 35, CON: 55, SIZ: 35, DEX: 70, POW: 30}, derived: {HP: 9, MOV: 9},
      skills: {'Fighting (Brawl)': 40, Dodge: 42}, weapons: [{weapon_id: 'bite', skill: 'Fighting (Brawl)', damage: '1D3', uses_per_round: 1, impale: false}]}}}),
      evidence_span_ids: ['span-bench-rats'], source_refs: [{source_id: 'fixture:walkon-bench', pdf_index: 1}]},
    // No numbers: scenery to the engine until a block is pinned on it.
    node('creature-moth-cloud', 'creature', MOTHS, 'A cloud of pale moths around the cellar lamp.', {}),
  ];
  for (const id of nodes.slice(1).map(entry => entry.node_id)) relate('contains', MODULE, id);
  relate('present-in', 'creature-cellar-rats', CELLAR); relate('present-in', 'npc-old-warden', CELLAR); relate('present-in', 'creature-moth-cloud', CELLAR);
  const coverage = Object.fromEntries(['structure', 'world', 'actors', 'relationships', 'events', 'knowledge', 'causal', 'mechanics', 'assets', 'direction'].map(key => [key, 'accepted']));
  return {contract_id: 'coc.module-graph.v3', schema_version: 3, module_id: MODULE, source_languages: ['en'], section_ids: ['section-bench'], coverage,
    coverage_by_section: {'section-bench': coverage}, node_refs_by_section: {'section-bench': nodes.map(entry => entry.node_id)}, nodes, claims, relations, source_refs: []};
}

const content = join(scratch, 'content');
await mkdir(join(content, 'starters', 'walkon-bench'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
await symlink(join(root, 'mods'), join(scratch, 'mods'));
await writeFile(join(content, 'starters', 'walkon-bench', 'module-graph.json'), JSON.stringify(bench(), null, 1));
await writeFile(join(content, 'starters', 'walkon-bench', 'starter-listing.json'), JSON.stringify({contract_id: 'coc.starter-listing.v1', schema_version: 1,
  scenario_id: 'walkon-bench', listed: false, not_listed_reason: 'Test bench.'}));
await cp(join(root, 'content/starters/the-haunting/pregens/thomas-hayes'), join(content, 'starters/walkon-bench/pregens/thomas-hayes'), {recursive: true});

/** A runtime over a workspace; `home` reopens one a previous runtime wrote (the reload). */
async function runtimeAt(t, home, seed) {
  const kernel = await api.createKernelContext({workspace: home, content, seed, locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  // A module's own methods take no campaign: one would scope the read to that campaign's fork of the book.
  call.bare = (method, params = {}) => runtime.handlers[method](params);
  return call;
}
async function table(t, seed = 'walkon') {
  const home = await mkdtemp(join(scratch, 'home-'));
  const call = await runtimeAt(t, home, seed);
  await call('campaign.create', {id: 'c1', module: 'walkon-bench', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The cellar door creaks open.'});
  const opened = await call('table.player_input', {text: 'I look around the cellar.'});
  const world = async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8'));
  const combat = async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/save/combat.json'), 'utf8'));
  let ordinal = 0;
  const id = () => `t${opened._context.turn}-c${++ordinal}`;
  const apply = (...effects) => call('table.apply', {call_id: id(), effects});
  return {call, home, opened, world, combat, id, apply};
}
const rejects = (promise, check) => assert.rejects(promise, error => { check(error); return true; });
const PERSON_FIELDS = ['called', 'untold', 'now', 'personality', 'knows', 'believes', 'would_lie_about', 'ties', 'history', 'relationships',
  'recent_speech', 'commitments', 'reunion', 'from_other_lines'];
/** The range a printed roll `{dice, times}` covers: every die at one, every die at its faces. */
function rollRange({dice, times}) {
  let low = 0, high = 0;
  for (const term of dice.toUpperCase().split('+')) {
    const [count, faces] = term.split('D').map(Number);
    if (faces) { low += count; high += count * faces; } else { low += count; high += count; }
  }
  return [low * times, high * times];
}
const CHARACTERISTIC = {str: 'STR', con: 'CON', siz: 'SIZ', dex: 'DEX', pow: 'POW'};
function assertRolledWithin(characteristics, entry) {
  for (const [field, roll] of Object.entries(entry.rolls)) {
    const value = characteristics[CHARACTERISTIC[field]], [low, high] = rollRange(roll);
    assert.ok(Number.isInteger(value) && value >= low && value <= high && value % roll.times === 0, `${field}: ${value} outside ${low}-${high} by ${roll.times}`);
  }
}
async function nextCapsule(game, text = 'I watch.') {
  await game.call('table.narrate', {call_id: game.id(), text: 'Something moves in the dark.'});
  return (await game.call('table.player_input', {text})).capsule;
}

// ---------------------------------------------------------------------------------------------------
// Declaring one.
// ---------------------------------------------------------------------------------------------------

test('§180.6: walk_on with creature "Dog" declares a table creature, never a person, and pins the Dog\'s block', async t => {
  const game = await table(t);
  const applied = await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'the landlord keeps a dog in the yard'});
  const receipt = (await game.call('table.status')).receipts.find(row => row.id === applied.receipts[0]);
  assert.equal(receipt.established, 'table');
  assert.equal(receipt.creature, 'Dog');
  assert.match(receipt.npc, /^creature-table-[0-9a-f]{20}$/, 'a kernel-minted creature id');
  assert.equal(receipt.handle, DOG, 'the handle is the Keeper\'s own word');
  const world = await game.world();
  assert.deepEqual(world.table_creatures.map(({established_at, ...record}) => record),
    [{name: DOG, turn: game.opened._context.turn, why: 'the landlord keeps a dog in the yard', catalog: 'Dog'}]);
  assert.ok(!(world.table_people ?? []).some(person => person.name === DOG), 'never a table person');
  const dog = BEASTS.Dog, profile = world.npc_profiles[DOG];
  assert.equal(profile.authority, 'table_pinned');
  assert.equal(profile.catalog, 'Dog');
  assert.deepEqual(profile.source, {table: 'beasts.json', page: dog.source_page});
  assert.deepEqual(Object.keys(profile.characteristics).sort(), ['CON', 'DEX', 'POW', 'SIZ', 'STR'], 'the book prints no INT for a dog, so none is made up');
  assertRolledWithin(profile.characteristics, dog);
  assert.deepEqual([...profile.rolled].sort(), ['CON', 'DEX', 'POW', 'SIZ', 'STR']);
  // A value the entry states is kept as stated; MP comes from the derived-attributes table.
  assert.deepEqual(profile.derived, {HP: dog.hp, MP: Math.floor(profile.characteristics.POW / 5), MOV: dog.mov, DB: dog.damage_bonus, Build: dog.build});
  assert.deepEqual(profile.skills, {Fighting: 50, Dodge: 42, Listen: 75, 'Scent Something Interesting': 90});
  assert.deepEqual(profile.weapons, [{weapon_id: 'fighting', name: 'Fighting', skill: 'Fighting', damage: '1D6', adds_damage_bonus: false, uses_per_round: '1', skill_value: 50}]);
  assert.equal(profile.armor_unstated, true);
  assert.ok(!('armor' in profile) && !('sanity_loss' in profile) && !('SAN' in profile.derived));
  assert.deepEqual(receipt.profile, {catalog: 'Dog', characteristics: profile.characteristics, derived: profile.derived, skills: profile.skills, weapons: ['Fighting']});
  // It is a body in the room: a creature row with no person field.
  const row = (await nextCapsule(game)).present.find(entry => entry.name === DOG);
  assert.equal(row?.kind, 'creature', JSON.stringify(row));
  for (const field of PERSON_FIELDS) assert.ok(!(field in row), field);
});

test('§180.6: the same seed rolls the same Dog, and the rolls are rolls, not the printed averages', async t => {
  const profiles = [];
  for (const seed of ['walkon', 'walkon', 'dog-1', 'dog-2', 'dog-3', 'dog-4']) {
    const game = await table(t, seed);
    await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', why: 'a yard dog'});
    profiles.push((await game.world()).npc_profiles[DOG]);
  }
  const rolled = profiles.map(profile => profile.characteristics);
  assert.ok(profiles.some(profile => {
    const total = profile.characteristics.STR + profile.characteristics.SIZ;
    return total < 65 || total > 84;
  }), 'some seed rolled a STR+SIZ whose table damage bonus is not the printed one');
  assert.deepEqual(rolled[0], rolled[1], 'seeded: one seed, one dog');
  for (const characteristics of rolled) assertRolledWithin(characteristics, BEASTS.Dog);
  // The printed damage bonus and build are kept whatever STR and SIZ rolled (the table would give -2 to none over these).
  for (const profile of profiles) assert.deepEqual([profile.derived.DB, profile.derived.Build], [BEASTS.Dog.damage_bonus, BEASTS.Dog.build]);
  assert.ok(new Set(rolled.map(value => JSON.stringify(value))).size > 1, 'different seeds roll different dogs');
});

test('§180.6: the pinned block is what the fight reads -- the Dog is an actor and fights with its numbers', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a yard dog'});
  const started = await game.call('table.resolve', {call_id: game.id(), action: {intent: 'combat', goal: 'drive it off', method: 'fists', target: DOG, weapon: 'unarmed'}});
  assert.equal(started.session.participants.find(entry => entry.name === DOG)?.label, DOG, 'the table\'s word for it labels the fight');
  const fighter = (await game.combat()).participants.find(entry => entry.actor_id === DOG);
  const profile = (await game.world()).npc_profiles[DOG];
  assert.equal(fighter.combat_skill, 50);
  assert.equal(fighter.dodge_skill, 42);
  assert.equal(fighter.hp_max, BEASTS.Dog.hp);
  assert.equal(fighter.damage_bonus, BEASTS.Dog.damage_bonus);
  assert.equal(fighter.build, BEASTS.Dog.build);
  assert.equal(fighter.dex, profile.characteristics.DEX, 'its rolled DEX sets its place in the round');
  assert.deepEqual(fighter.weapons.map(weapon => weapon.weapon_id), ['fighting']);
});

test('§180.6: declared and hurt in one batch -- the pin makes it a body at once', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a yard dog'},
    {kind: 'damage', subject: DOG, dice: '1D3', why: 'a thrown stone'});
  const hp = (await game.world()).npc_resources[DOG].current_hp;
  assert.ok(hp >= BEASTS.Dog.hp - 3 && hp <= BEASTS.Dog.hp - 1, `hit points ${hp} come off the Dog's printed ${BEASTS.Dog.hp}`);
});

test('§180.6: a fight\'s public card names the table creature by the table\'s word for it', async t => {
  // The exchange is dice; the seed that lands a blow either way is found among a short fixed list, never assumed.
  for (const seed of ['card-1', 'card-2', 'card-3', 'card-4', 'card-5', 'card-6', 'card-7', 'card-8']) {
    const game = await table(t, seed);
    await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a yard dog'});
    const resolve = action => game.call('table.resolve', {call_id: game.id(), action});
    let result = await resolve({intent: 'combat', goal: 'drive it off', method: 'fists', target: DOG, weapon: 'unarmed'});
    if (result.session.turn_of === DOG) {
      await resolve({intent: 'combat', goal: 'it bites', method: 'bite', actor: DOG, target: 'Thomas Hayes'});
      await resolve({intent: 'combat', goal: 'combat:defend', method: 'combat:defend', actor: 'thomas-hayes', defense: 'dodge'});
      result = await resolve({intent: 'combat', goal: 'drive it off', method: 'fists', target: DOG, weapon: 'unarmed'});
    }
    if (result.session.pending_defense?.actor === DOG)
      await resolve({intent: 'combat', goal: 'combat:defend', method: 'combat:defend', actor: DOG, defense: 'dodge'});
    const cards = (await game.call('table.status')).receipts.filter(receipt => receipt.kind === 'delta' && receipt.public_combat === true);
    const labelled = cards.flatMap(card => [card.subject === DOG ? card.public_subject_label : undefined, card.public_source_label]).filter(Boolean);
    if (!cards.length) continue;
    assert.ok(labelled.includes(DOG), JSON.stringify(cards));
    return;
  }
  assert.fail('no seed in the list landed a blow between the investigator and the Dog');
});

test('§180.6: a monster entry pins its printed averages, its typed Sanity loss and its readable attacks', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: 'the thing under the stair', walk_on: true, creature: 'Ghoul', to: 'here', why: 'it came up from the vault'});
  const ghoul = MONSTERS.Ghoul, profile = (await game.world()).npc_profiles['the thing under the stair'];
  assert.deepEqual(profile.characteristics, {STR: ghoul.str, DEX: ghoul.dex, INT: ghoul.int, POW: ghoul.pow, CON: ghoul.con, SIZ: ghoul.siz});
  assert.ok(!('rolled' in profile), 'the monsters print averages only: nothing is rolled');
  // HP and Move as printed; damage bonus and build from the STR+SIZ table, which the entry does not print.
  assert.deepEqual(profile.derived, {HP: ghoul.hp, MP: Math.floor(ghoul.pow / 5), MOV: ghoul.mov, DB: '+1D4', Build: 1});
  assert.equal(profile.armor, ghoul.armor);
  assert.deepEqual(profile.sanity_loss, ghoul.san_loss);
  assert.deepEqual(profile.weapons.map(weapon => [weapon.weapon_id, weapon.damage, weapon.adds_damage_bonus]), [['claws', '1D6', true], ['bite', '1D4', true]]);
  assert.deepEqual(profile.skills, {}, 'the monsters print no skill percentages; the engine supplies its own default');
  // A monster whose first printed attack the dice grammar cannot read: no damage on it, the printed text kept, and the
  // readable weapon first, because the engine swings an NPC's first weapon when nobody names one.
  assert.deepEqual(MONSTERS.Shoggoth.attacks.map(attack => attack.weapon), ['engulf', 'pseudopod']);
  await game.apply({kind: 'npc', name: 'the shape in the tunnel', walk_on: true, creature: 'Shoggoth', why: 'it pours out of the tunnel'});
  const shoggoth = (await game.world()).npc_profiles['the shape in the tunnel'];
  assert.deepEqual(shoggoth.weapons.map(weapon => [weapon.weapon_id, weapon.damage ?? null, weapon.damage_printed ?? null]),
    [['pseudopod', '1D6', '1D6+DB'], ['engulf', null, 'special: crush']]);
});

test('§180.6: a beast\'s structured attack reading -- a damage that is the bonus alone, half the bonus, a maneuver', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: 'the thing in the reeds', walk_on: true, creature: 'Crocodile, Nile', why: 'the river bank'},
    {kind: 'npc', name: 'the fin in the water', walk_on: true, creature: 'Shark', why: 'the harbour'});
  const world = await game.world(), crocodile = world.npc_profiles['the thing in the reeds'], shark = world.npc_profiles['the fin in the water'];
  // The crocodile's Fighting prints "damage bonus" and no dice: the damage is the bonus.
  assert.deepEqual(crocodile.weapons[0], {weapon_id: 'fighting', name: 'Fighting', skill: 'Fighting', damage: '0', adds_damage_bonus: true,
    uses_per_round: '1', skill_value: 50, damage_printed: 'damage bonus'});
  assert.equal(crocodile.weapons[1].maneuver, true);
  assert.equal(crocodile.derived.DB, BEASTS['Crocodile, Nile'].damage_bonus);
  assert.equal(crocodile.armor, BEASTS['Crocodile, Nile'].armor);
  assert.deepEqual(shark.weapons[0].special, 'half damage bonus');
  assert.equal(shark.weapons[0].adds_damage_bonus, true);
  assert.equal(shark.weapons[0].damage, '2D3');
});

// ---------------------------------------------------------------------------------------------------
// No block, and a block pinned later.
// ---------------------------------------------------------------------------------------------------

test('§180.6: creature true declares a creature with no stat block -- no profile, no actor -- and one is pinned later', async t => {
  const game = await table(t);
  const declared = await game.apply({kind: 'npc', name: THING, walk_on: true, creature: true, to: 'here', why: 'something splashes in the well'});
  const receipt = (await game.call('table.status')).receipts.find(row => row.id === declared.receipts[0]);
  assert.equal(receipt.creature, true);
  assert.ok(!('profile' in receipt));
  let world = await game.world();
  assert.deepEqual(world.table_creatures.map(({name, catalog}) => ({name, catalog})), [{name: THING, catalog: undefined}]);
  assert.ok(!(THING in (world.npc_profiles ?? {})));
  assert.ok(!(world.table_people ?? []).some(person => person.name === THING));
  assert.ok(!(await nextCapsule(game)).present.some(entry => entry.name === THING), 'no stat block, no actor: scenery to the engine');
  // Pinning later: the same word, a catalog entry, no walk_on.
  await game.apply({kind: 'npc', name: THING, creature: 'Rat Pack', why: 'it is a nest of rats after all'});
  world = await game.world();
  const profile = world.npc_profiles[THING];
  assert.equal(profile.catalog, 'Rat Pack');
  assertRolledWithin(profile.characteristics, BEASTS['Rat Pack']);
  assert.deepEqual(profile.weapons.map(weapon => [weapon.weapon_id, weapon.damage, weapon.maneuver ?? false]), [['fighting', '1D3', false], ['overwhelm-mnvr', '2D6', true]]);
  assert.match(profile.weapons[1].note, /bonus die/);
  assert.equal(world.table_creatures.length, 1, 'pinning writes no second record');
  assert.equal((await nextCapsule(game)).present.find(entry => entry.name === THING)?.kind, 'creature', 'with its block it is an actor in the room');
});

test('§180.6: a book creature the book gave no numbers takes a catalog block later (and the large bat\'s SIZ is rolled)', async t => {
  const game = await table(t);
  assert.ok(!game.opened.capsule.present.some(entry => entry.name === MOTHS));
  await game.apply({kind: 'npc', name: MOTHS, creature: 'Bat, Large', to: 'here', why: 'the cloud is a flock of fruit bats'});
  const profile = (await game.world()).npc_profiles['moth-cloud'];
  assert.equal(profile.catalog, 'Bat, Large');
  // CK-B: the printed SIZ average (15) disagrees with its roll (2D4 x5); the roll is what is used.
  assertRolledWithin(profile.characteristics, BEASTS['Bat, Large']);
  assert.equal(profile.derived.HP, BEASTS['Bat, Large'].hp);
  assert.equal(profile.armor, 0);
  assert.equal((await nextCapsule(game)).present.find(entry => entry.name === MOTHS)?.kind, 'creature');
});

test('§180.6: an entry that prints no stat block declares a creature without one, as true does', async t => {
  const game = await table(t);
  const declared = await game.apply({kind: 'npc', name: SWARM, walk_on: true, creature: 'Wasp and Bee Swarms', to: 'here', why: 'the hive is kicked over'});
  const receipt = (await game.call('table.status')).receipts.find(row => row.id === declared.receipts[0]);
  assert.equal(receipt.creature, 'Wasp and Bee Swarms');
  assert.equal(receipt.no_stat_block, true);
  const world = await game.world();
  assert.ok(!(SWARM in (world.npc_profiles ?? {})));
  assert.equal(world.table_creatures[0].catalog, 'Wasp and Bee Swarms');
});

// ---------------------------------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------------------------------

test('§180.6: an unknown entry is refused with the catalog\'s creature names, and nothing is declared', async t => {
  const game = await table(t);
  await rejects(game.apply({kind: 'npc', name: 'the hound', walk_on: true, creature: 'Hellhound', why: 'test'}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.field, 'npc.creature');
    assert.equal(error.details.options.length, Object.keys(MONSTERS).length + Object.keys(BEASTS).length);
    assert.ok(error.details.options.includes('Dog') && error.details.options.includes('Ghoul'));
  });
  await rejects(game.apply({kind: 'npc', name: 'the hound', walk_on: true, creature: 3, why: 'test'}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.field, 'npc.creature');
  });
  assert.ok(!(await game.world()).table_creatures?.length);
});

test('§180.6: a creature with a block is refused another -- the book\'s or one the table pinned (stat_block_exists)', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', why: 'a yard dog'});
  const before = (await game.world()).npc_profiles[DOG];
  await rejects(game.apply({kind: 'npc', name: DOG, creature: 'Wolf', why: 'test'}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.reason, 'stat_block_exists');
    assert.equal(error.details.catalog, 'Dog');
  });
  await rejects(game.apply({kind: 'npc', name: RATS, creature: 'Rat Pack', why: 'test'}), error => {
    assert.equal(error.details.reason, 'stat_block_exists');
    assert.equal(error.details.authority, 'source_authored');
  });
  assert.deepEqual((await game.world()).npc_profiles[DOG], before, 'the pin is made once');
});

test('§180.5/§180.6: a table creature is no person -- mood and archetype are refused not_a_person, and creature on a person is refused', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a yard dog'});
  for (const [field, value] of [['mood', 'hungry'], ['archetype', 'ordinary_adult']])
    await rejects(game.apply({kind: 'npc', name: DOG, [field]: value, why: 'test'}), error => {
      assert.equal(error.details.reason, 'not_a_person', field);
      assert.equal(error.details.field, `npc.${field}`);
    });
  await rejects(game.apply({kind: 'npc', name: DOG, walk_on: true, to: 'here', why: 'test'}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.reason, 'not_a_person', 'walk_on without creature on a creature');
    assert.equal(error.details.field, 'npc.walk_on');
  });
  await rejects(game.apply({kind: 'npc', name: WARDEN, creature: 'Dog', why: 'test'}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.reason, 'not_a_creature');
  });
  await rejects(game.apply({kind: 'npc', name: MOTHS, walk_on: true, creature: true, why: 'test'}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.field, 'npc.walk_on', 'the book\'s creature is no newcomer');
  });
  // The body's variants still stage on it.
  await game.apply({kind: 'npc', name: DOG, stance: 'hostile', why: 'it bares its teeth'});
});

test('§180.6: creature without walk_on on a word nobody carries is refused, and the refusal carries the declaring call', async t => {
  const game = await table(t);
  await rejects(game.apply({kind: 'npc', name: DOG, creature: 'Dog', to: 'here', why: 'test'}), error => {
    assert.equal(error.code, 'unknown_entity');
    assert.deepEqual(error.details.walk_on, {kind: 'npc', name: DOG, creature: 'Dog', to: 'here', why: 'test', walk_on: true});
  });
  assert.ok(!(await game.world()).table_creatures?.length);
});

// ---------------------------------------------------------------------------------------------------
// No person feature reaches it; it survives a reload; the catalog lists the beasts.
// ---------------------------------------------------------------------------------------------------

test('§180.6: no person feature meets a table creature -- untold roster, epithet lane, personality job, say span', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a yard dog'});
  await game.apply({kind: 'npc', name: THING, walk_on: true, creature: true, to: 'here', why: 'something in the well'});
  const untold = (await game.call('table.untold')).people.map(person => person.name);
  assert.ok(untold.includes(WARDEN) && !untold.includes(DOG) && !untold.includes(THING), JSON.stringify(untold));
  const epithets = (await game.call('epithets.job')).people.map(person => person.id);
  assert.deepEqual(epithets, ['old-warden'], 'the epithet lane is asked about the warden alone');
  const job = await game.call('npc.job');
  assert.equal(job.npc.name, WARDEN);
  await game.call('npc.submit', {job_id: job.job_id, claim: job.claim, personality: {description: 'Patient and wary.'}});
  assert.deepEqual(await game.call('npc.job'), {job_id: null}, 'the dog is never offered a personality job');
  const said = await game.call('table.narrate', {call_id: game.id(), text: `{{say:${DOG}}}"Woof."{{/say}}`});
  assert.deepEqual(said.speech.map(line => line.who), [{label: DOG}], 'a say span naming the creature stays a label');
  const world = await game.world();
  assert.ok(!(world.table_people ?? []).length, 'nobody was established as a person');
});

test('§180.6: a reload reinstalls the table creature and its pinned block; a second declaration writes no second record', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a yard dog'});
  await game.apply({kind: 'npc', name: THING, walk_on: true, creature: true, why: 'something in the well'});
  // A fresh runtime over the same workspace: nothing in memory survives, only the world.
  const call = await runtimeAt(t, game.home, 'reloaded');
  const status = await call('table.status');
  const turn = status.turn?.turn ?? game.opened._context.turn;
  await call('table.apply', {call_id: `t${turn}-c90`, effects: [{kind: 'npc', name: DOG, walk_on: true, creature: true, to: 'here', why: 'still the yard dog'}]});
  await call('table.apply', {call_id: `t${turn}-c91`, effects: [{kind: 'npc', name: THING, to: 'here', why: 'it climbs out'}]});
  const world = JSON.parse(await readFile(join(game.home, '.coc/campaigns/c1/world.json'), 'utf8'));
  assert.deepEqual(world.table_creatures.map(record => record.name), [DOG, THING]);
  assert.equal(world.npc_presence[THING], 'cellar', 'the table creature with no block is still found by its word');
  const started = await call('table.resolve', {call_id: `t${turn}-c92`, action: {intent: 'combat', goal: 'drive it off', method: 'fists', target: DOG, weapon: 'unarmed'}});
  assert.ok(started.session.participants.some(entry => entry.name === DOG), 'after a reload the pinned block still makes it an actor');
});

test('§180.6: lookup kind=catalog kinds=["creature"] lists the beasts beside the monsters', async t => {
  const game = await table(t);
  const dog = await game.call('table.lookup', {kind: 'catalog', query: 'Dog', kinds: ['creature']});
  assert.equal(dog.candidates[0].name, 'Dog');
  assert.equal(dog.candidates[0].source.table, 'beasts.json');
  const ghoul = await game.call('table.lookup', {kind: 'catalog', query: 'Ghoul', kinds: ['creature']});
  assert.equal(ghoul.candidates[0].source.table, 'monsters.json');
});

// ---------------------------------------------------------------------------------------------------
// A book played from its reading: a table creature is no book material, as a table person is not.
// ---------------------------------------------------------------------------------------------------

/** A PDF whose pages carry native text, one line per page (the person-text-landing fixture's). */
function textPdf(lines) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${lines.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${lines.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, line] of lines.entries()) {
    const stream = `BT /F1 10 Tf 10 100 Td (${line}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let text = '%PDF-1.7\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(text), size = objects.length + 1;
  return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.map(value => String(value).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test('§180.6: on a book played from its reading, a declared creature is never held for source material', async t => {
  const home = await mkdtemp(join(scratch, 'read-'));
  const call = await runtimeAt(t, home, 'read');
  const PAGES = ['The harbor dock smells of tar. Old Mae mends nets by the water.', 'The old tower stands beyond the harbor.'];
  const pdf = join(home, 'original.pdf'), bytes = Buffer.from(textPdf(PAGES));
  await writeFile(pdf, bytes);
  const {module_id: mid} = await call.bare('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: createHash('sha256').update(bytes).digest('hex')}});
  const read = async (purpose, draft, paths) => {
    await call.bare('module.read.request', {module_id: mid, purpose});
    const job = await call.bare('module.read.claim', {module_id: mid, owner: 'test-host'});
    await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]}));
    await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
    await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: [{page: 1}], reason: 'fixture support'}], missing: []}));
    await call.bare('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
      draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
  };
  await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor', pages: [[1, 2]], source_refs: [{page: 1}], entities: ['Dock', 'Tower']}]}, []);
  await read('opening', {nodes: [{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: [{page: 1}], properties: {is_entrance: true}},
    {node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'},
    {node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: [{page: 1}], summary: 'A net mender on the dock.'}],
    claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: [{page: 1}]}],
    node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock']}, ['/nodes/0', '/claims/0', '/coverage']);
  await call('campaign.create', {id: 'card-source', module: 'walkon-bench', pregen: 'thomas-hayes', play_language: 'en'});
  const saved = await call('investigator.save', {campaign: 'card-source'});
  await call('campaign.create', {id: 'c1', module: mid, play_language: 'en'});
  await call('investigator.load', {library_id: saved.library_id});
  await call('setup.complete');
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
  const opened = await call('table.player_input', {text: 'I watch the dog by the nets.'});
  const turn = opened._context.turn, DOCK_DOG = 'the dog by the nets';
  await call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'npc', name: DOCK_DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'a dog sleeps on the nets'}]});
  // The control: a book person the reading has not reached is held, so the gate is live here.
  await rejects(call('table.apply', {call_id: `t${turn}-c2`, effects: [{kind: 'npc', name: 'Old Mae', to: 'here', why: 'test'}]}),
    error => assert.equal(error.details?.reason, 'material_pending', JSON.stringify(error.details)));
  await call('table.apply', {call_id: `t${turn}-c3`, effects: [{kind: 'npc', name: DOCK_DOG, stance: 'wary', why: 'it lifts its head'}]});
  const checked = await call('table.resolve', {call_id: `t${turn}-c4`, action: {intent: 'investigate', goal: 'size it up', method: 'watch it a while',
    skill: 'Spot Hidden', decision: 'core-check:ordinary-check', target: DOCK_DOG}});
  assert.ok(checked.receipts?.length, JSON.stringify(checked));
});

// ---------------------------------------------------------------------------------------------------
// The Keeper's tool: `creature` on the npc effect, and the dossier effect (§28.7's table door).
// ---------------------------------------------------------------------------------------------------

const APPLY = COC_TOOLS.find(spec => spec.name === 'apply');
const validApply = effects => validateToolArguments({name: 'apply', description: '', parameters: APPLY.parameters}, {type: 'toolCall', id: 't1', name: 'apply', arguments: {effects}});

test('§180.6: the apply tool takes creature as a catalog name or true, and true reaches the kernel as true', () => {
  const sent = creature => validApply([{kind: 'npc', name: DOG, walk_on: true, creature, why: 'a yard dog'}]).effects[0].creature;
  assert.equal(sent('Dog'), 'Dog');
  assert.equal(sent(true), true, 'not the string "true", which the kernel would read as an unknown catalog entry');
  // The validator coerces a stray scalar to a string (the kernel then refuses it as an unknown entry, with the options);
  // a list or an object is no creature at all.
  for (const creature of [[1], {name: 'Dog'}])
    assert.throws(() => sent(creature), JSON.stringify(creature));
});

test('§28.7: the apply tool carries the dossier effect, bounded as the kernel bounds it, and it lands through table.apply', async t => {
  const speaks = {kind: 'dossier', name: WARDEN, values: {language: 'Irish, and English with a heavy brogue'}, why: 'he swore at the rats in Irish'};
  assert.doesNotThrow(() => validApply([speaks]));
  assert.doesNotThrow(() => validApply([{kind: 'dossier', name: DOG, values: {weaknesses: [{book: 'It flees from fire.'}]}, why: 'the torch drove it off'}]));
  // What the kernel refuses the schema refuses: no words, a word that is no line, a line over the bound.
  for (const values of [{}, {language: ''}, {language: '   '}, {language: 'x'.repeat(DOSSIER_VALUE_MAX + 1)}, {weaknesses: []}, {weaknesses: [{needs: []}]}])
    assert.throws(() => validApply([{...speaks, values}]), JSON.stringify(values).slice(0, 40));
  assert.throws(() => validApply([{kind: 'dossier', values: speaks.values}]), 'the actor is named');
  // A line at the bound is the kernel's too; one over it is the kernel's refusal as well as the schema's.
  const game = await table(t);
  const [validated] = validApply([{...speaks, values: {language: 'y'.repeat(DOSSIER_VALUE_MAX)}}]).effects;
  await game.call('table.apply', {call_id: game.id(), effects: [validated]});
  await rejects(game.apply({...speaks, values: {language: 'z'.repeat(DOSSIER_VALUE_MAX + 1)}}), error => assert.equal(error.details.field, 'dossier.values.language'));
  // natural-npc's `speaks` (key `language`) on a person: the call the schema admits lands, in the package's namespace.
  const landed = await game.call('table.apply', {call_id: game.id(), effects: validApply([speaks]).effects});
  const receipt = (await game.call('table.status')).receipts.find(row => row.id === landed.receipts[0]);
  assert.deepEqual([receipt.kind, receipt.keys, receipt.values], ['dossier', ['language'], {language: speaks.values.language}]);
  assert.equal((await game.world()).mods.state['natural-npc'].dossier['npc-old-warden'].language.value, speaks.values.language);
});

// The two halves together (CK-E's walk-on and tool, CK-D's door): what the Keeper's own animal is like reaches the table
// only through `apply dossier`, which the apply tool did not carry before §180 (§28.7's door had no tool path).
test('§180.6 with §180.8–180.9: a walk-on dog\'s habits and a table weakness, sent through the apply tool, reach its row', async t => {
  const game = await table(t, 'walkon-dossier');
  await game.apply({kind: 'npc', name: DOG, walk_on: true, creature: 'Dog', to: 'here', why: 'the landlord keeps a dog in the yard'});
  const habits = {kind: 'dossier', name: DOG, values: {habits: 'Guards the yard gate; barks at strangers and goes for the legs of anyone who runs.'},
    why: 'the landlord said so when he let them in'};
  const weakness = {kind: 'dossier', name: DOG, values: {weaknesses: [{book: 'A thrown scrap of meat draws it off for a round.'}]},
    why: 'the cook tossed it a bone and it let them pass'};
  const tool = COC_TOOLS.find(definition => definition.name === 'apply');
  assert.doesNotThrow(() => validateToolArguments(tool, {type: 'toolCall', id: 'x', name: 'apply', arguments: {effects: [habits, weakness]}}),
    'the tool admits both writes');
  await game.apply(habits);
  await game.apply(weakness);
  const row = (await nextCapsule(game)).present.find(entry => entry.name === DOG);
  assert.equal(row?.kind, 'creature', JSON.stringify(row));
  assert.equal(row.habits, habits.values.habits, 'the table\'s habits line reaches the creature row');
  assert.deepEqual(row.weaknesses?.map(entry => entry.book), [weakness.values.weaknesses[0].book], 'the table weakness reaches it too');
  for (const field of PERSON_FIELDS) assert.ok(!(field in row), field);
});
