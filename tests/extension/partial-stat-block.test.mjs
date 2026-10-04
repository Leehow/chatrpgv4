/**
 * Contract §180.6 (CK-F2): an actor whose authored stat block lacks what the engine builds a participant from is refused
 * with the call that completes it, and a creature's block is completed from the rules catalog.
 *
 * Before this, Mystery House's chapel familiar (an authored gym creature with skills and no characteristics) was an actor
 * and present, and a fight or a chase against it threw `NpcProfileError` out of `npcCombatParticipant`: an internal error.
 * `apply npc {name, creature}` refused it with `stat_block_exists`, and an archetype refused a person's partial block as
 * "printed numbers", so nothing could complete either. Now every entry that builds a participant refuses first, naming
 * what is missing and the completion (`creature` for a creature, `archetype` for a person); the completion builds the
 * source's block as a fresh pin does, rolls and all, and every value the authored block states wins over it.
 *
 * One fixture book, built here and owing nothing to the shipped starters: a cellar with a hound whose block states skills,
 * DEX, HP and a weapon; a warden (a person) whose block states STR, SIZ and two skills; and rats with a whole block. The
 * product path then opens a new Mystery House campaign and fights the real familiar. Every read and write travels a real
 * entry (`campaign.create`, `table.*`).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const scratch = await mkdtemp(join(tmpdir(), 'partial-stat-block-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'partial-stat-block-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'partial-stat-block-api.ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);
const rules = async name => JSON.parse(await readFile(join(root, 'content/rulesets/coc7/rules-json', `${name}.json`), 'utf8'));
const BEASTS = (await rules('beasts')).beasts, MONSTERS = (await rules('monsters')).monsters;
const ARCHETYPES = (await rules('npc-stat-archetypes')).archetypes, DAMAGE = await rules('damage-bonus-build');
const CATALOG = [...Object.keys(MONSTERS), ...Object.keys(BEASTS)];

// ---------------------------------------------------------------------------------------------------
// The fixture book.
// ---------------------------------------------------------------------------------------------------

const MODULE = 'module-partial-bench', CELLAR = 'scene-cellar';
const HOUND = 'Belfry hound', WARDEN = 'Old warden', RATS = 'Cellar rats', PORTER = 'Night porter';
// What each partial block states. Every value lies outside what its completion would give, so a value that survives is
// the authored one: no Rat Pack rolls a DEX of 85 or prints HP 14, no capable_adult rolls STR 95 or Dodge 10.
const HOUND_BLOCK = {profile_kind: 'actor', characteristic_scale: 'percentile', characteristics: {DEX: 85}, derived: {HP: 14},
  skills: {'Fighting (Brawl)': 50, Dodge: 40, Stealth: 60},
  weapons: [{weapon_id: 'fighting', name: 'Bite', skill: 'Fighting (Brawl)', damage: '1D8', uses_per_round: 1, impale: false}]};
const WARDEN_BLOCK = {profile_kind: 'actor', characteristic_scale: 'percentile', characteristics: {STR: 95, SIZ: 90},
  skills: {'Fighting (Brawl)': 70, Dodge: 10}};

function bench() {
  const claims = [], relations = [];
  let n = 0;
  const relate = (kind, from, to) => {
    n += 1;
    const claim_id = `claim-${kind}-${n}`;
    claims.push({claim_id, subject_id: from, predicate: kind, object: {node_id: to}, truth_status: 'authored-fact', visibility: 'keeper-only',
      evidence_span_ids: [], asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1, reason: 'Partial stat block fixture.'});
    relations.push({relation_id: `relation-${kind}-${n}`, relation_kind: kind, from_node_id: from, to_node_id: to, claim_id, properties: {}});
  };
  const node = (node_id, node_kind, name, summary, properties, visibility = 'keeper-only') =>
    ({node_id, node_kind, name, visibility, aliases: [], summary, evidence_span_ids: [], properties, source_refs: []});
  // A node stating a mechanic cites the page that states it (§136).
  const cited = (entry, page) => ({...entry, evidence_span_ids: [`span-bench-${page}`], source_refs: [{source_id: 'fixture:partial-bench', pdf_index: page}]});
  const meta = {schema_version: 1, scenario_id: 'partial-bench', source_language: 'en', runtime_projection_contract: 'coc.module-graph-runtime-projection.v1',
    title: 'The Partial Bench', opening_scene: 'A cellar with a warden.', one_liner: 'A cellar, a warden, a hound and rats.',
    structure_type: 'hub_sandbox', era: '1920s', setting_tags: ['test'], content_flags: ['test-module'], win_condition: 'None; a bench.',
    start_clock: {calendar_mode: 'gregorian', local_datetime: '1925-03-02T21:00:00', timezone: 'America/New_York', display: '1925-03-02 21:00'},
    summary: 'A bench for blocks stated in part.', player_safe_summary: 'A cellar in Boston.', keeper_secret_summary: 'A hound in the belfry.',
    license: 'Apache-2.0', author: 'chatrpgv4 contributors', attribution: 'Original test content.', copyright_notice: []};
  const cellar = node(CELLAR, 'scene', 'Cellar', 'Cellar, a test place.', {runtime_projection: {document: 'story-graph.json', collection: 'scenes', record: {
    scene_id: 'cellar', is_start: true, location_tags: ['test'], scene_type: 'social', origin: 'source', dramatic_question: 'Who is here?',
    entry_conditions: [], exit_conditions: [], available_clues: [], npc_ids: [], pressure_moves: [], storylet_tags: [], affordances: [], tone: [],
    allowed_improvisation: [], scene_edges: []}}});
  const warden = node('npc-old-warden', 'npc', WARDEN, 'A stooped warden who keeps the cellar keys.', {runtime_projection: {document: 'npc-agendas.json', collection: 'npcs', record: {
    npc_id: 'npc-old-warden', name: WARDEN, origin: 'source', agenda: 'Keep the cellar shut.', fear: 'The boards giving way.', secret: 'He feeds the hound.', voice: 'Gruff.',
    relationship_to_investigators: 'stranger', known_fact_ids: [], revealable_fact_ids: [], disclosure_order: [], facts: [], lie_options: [], deflect_options: [],
    leverage_ids: [], active_reactions: [], availability: {status: 'available'}, schedule: [], keeper_note: 'A person of the bench.',
    biography: `${WARDEN}, in a long coat with a ring of keys.`, mechanics: {profile: WARDEN_BLOCK}}}}, 'player-safe');
  const nodes = [
    node(MODULE, 'module', meta.title, meta.one_liner, {asset_root_id: null, source_binding: {},
      runtime_projection: {contract_id: 'coc.module-graph-runtime-projection.v1', documents: [{filename: 'module-meta.json', root: meta}]}}),
    cellar, cited(warden, 1),
    cited(node('creature-belfry-hound', 'creature', HOUND, 'A lean hound that sleeps in the belfry.', {origin: 'authored-gym', mechanics: {profile: HOUND_BLOCK}}), 2),
    node('npc-night-porter', 'npc', PORTER, 'A porter who sleeps by the furnace; the book gives him no numbers.', {}, 'player-safe'),
    cited(node('creature-cellar-rats', 'creature', RATS, 'A swarm of rats behind the cellar boards.', {mechanics: {profile: {
      characteristics: {STR: 35, CON: 55, SIZ: 35, DEX: 70, POW: 30}, derived: {HP: 9, MOV: 9},
      skills: {'Fighting (Brawl)': 40, Dodge: 42}, weapons: [{weapon_id: 'bite', skill: 'Fighting (Brawl)', damage: '1D3', uses_per_round: 1, impale: false}]}}}), 3),
  ];
  for (const id of nodes.slice(1).map(entry => entry.node_id)) relate('contains', MODULE, id);
  for (const id of ['npc-old-warden', 'npc-night-porter', 'creature-belfry-hound', 'creature-cellar-rats']) relate('present-in', id, CELLAR);
  const coverage = Object.fromEntries(['structure', 'world', 'actors', 'relationships', 'events', 'knowledge', 'causal', 'mechanics', 'assets', 'direction'].map(key => [key, 'accepted']));
  return {contract_id: 'coc.module-graph.v3', schema_version: 3, module_id: MODULE, source_languages: ['en'], section_ids: ['section-bench'], coverage,
    coverage_by_section: {'section-bench': coverage}, node_refs_by_section: {'section-bench': nodes.map(entry => entry.node_id)}, nodes, claims, relations, source_refs: []};
}

// One content root: the shipped content, the bench starter, and Mystery House with a pregen beside it (it ships none).
const content = join(scratch, 'content');
await mkdir(join(content, 'starters', 'partial-bench'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
await symlink(join(root, 'mods'), join(scratch, 'mods'));
await writeFile(join(content, 'starters', 'partial-bench', 'module-graph.json'), JSON.stringify(bench(), null, 1));
await writeFile(join(content, 'starters', 'partial-bench', 'starter-listing.json'), JSON.stringify({contract_id: 'coc.starter-listing.v1', schema_version: 1,
  scenario_id: 'partial-bench', listed: false, not_listed_reason: 'Test bench.'}));
const PREGEN = join(root, 'content/starters/the-haunting/pregens/thomas-hayes');
await cp(PREGEN, join(content, 'starters/partial-bench/pregens/thomas-hayes'), {recursive: true});
const mystery = join(content, 'starters', 'mystery-house'), shippedMystery = join(root, 'content/starters/mystery-house');
await mkdir(mystery, {recursive: true});
for (const name of await readdir(shippedMystery)) await symlink(join(shippedMystery, name), join(mystery, name));
await cp(PREGEN, join(mystery, 'pregens/thomas-hayes'), {recursive: true});

async function table(t, module = 'partial-bench', seed = 'partial') {
  const home = await mkdtemp(join(scratch, 'home-'));
  const kernel = await api.createKernelContext({workspace: home, content, seed, locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module, pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The cellar door creaks open.'});
  const opened = await call('table.player_input', {text: 'I look around.'});
  const world = async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8'));
  const saved = async name => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/save', name), 'utf8').catch(() => 'null'));
  let ordinal = 0;
  const id = () => `t${opened._context.turn}-c${++ordinal}`;
  const apply = (...effects) => call('table.apply', {call_id: id(), effects});
  const resolveAction = action => call('table.resolve', {call_id: id(), action});
  const receipts = async () => (await call('table.status')).receipts;
  return {call, world, saved, apply, resolve: resolveAction, receipts};
}
const fight = target => ({intent: 'combat', goal: 'drive it off', method: 'fists', target, weapon: 'unarmed'});
/** The refusal an entry gives; it must be the kernel's own `needs`, never an internal error. */
async function refusal(promise) {
  const error = await promise.then(() => null, error => error);
  assert.ok(error, 'the entry was refused');
  assert.notEqual(error.name, 'NpcProfileError', error.stack);
  assert.equal(error.code, 'needs', `${error.name}: ${error.message}`);
  return error;
}
const sortedPaths = paths => [...paths].sort();
/** The rulebook's damage bonus and build for a STR+SIZ total (§34.10's table). */
const damageFor = total => DAMAGE.find(entry => total >= entry.min && total <= entry.max);

// ---------------------------------------------------------------------------------------------------
// The refusal before completion.
// ---------------------------------------------------------------------------------------------------

test('CK-F2: a fight against a creature whose block lacks characteristics is refused with the catalog completion', async t => {
  const game = await table(t);
  const before = (await game.receipts()).length;
  const error = await refusal(game.resolve(fight(HOUND)));
  assert.equal(error.message, `${HOUND}'s stat block has no characteristics.STR, characteristics.SIZ, characteristics.CON: a fight against ${HOUND} reads them, and none is assumed`);
  assert.equal(error.details.reason, 'stat_block_incomplete');
  assert.equal(error.details.npc, 'belfry-hound');
  assert.equal(error.details.kind, 'creature');
  assert.deepEqual(error.details.missing, ['characteristics.STR', 'characteristics.SIZ', 'characteristics.CON'], 'DEX is stated, so it is not missing');
  assert.deepEqual(error.details.needs, {field: 'creature', options: CATALOG});
  assert.deepEqual(error.details.options, CATALOG, 'the options CK-E\'s unknown-entry refusal gives');
  assert.match(error.fix, /^complete the block first with apply npc \{name: "Belfry hound", creature: <the rules-catalog creature it is, one of details\.needs\.options>/);
  assert.match(error.fix, /fills only details\.missing, and every number Belfry hound's block states is kept/);
  assert.equal((await game.receipts()).length, before, 'nothing was rolled');
  assert.equal(await game.saved('combat.json'), null, 'no fight was filed');
});

test('CK-F2: a chase with that creature is refused the same way -- as the quarry, and as the pursuer', async t => {
  const game = await table(t);
  const quarry = await refusal(game.resolve({decision: 'chase:start', intent: 'move', goal: 'run it down', method: 'after it', target: HOUND}));
  assert.equal(quarry.details.reason, 'quarry_numbers_missing', 'the quarry keeps its reason (§143.12)');
  assert.deepEqual(quarry.details.missing, ['characteristics.STR', 'characteristics.CON', 'characteristics.SIZ', 'derived.MOV']);
  assert.deepEqual(quarry.details.needs, {field: 'creature', options: CATALOG}, 'the completion, no longer a dead end');
  assert.match(quarry.message, /a chase of Belfry hound reads them, and none is assumed/);
  const pursuer = await refusal(game.resolve({decision: 'chase:start', intent: 'flee', goal: 'get away', method: 'up the stairs', target: HOUND}));
  assert.equal(pursuer.details.reason, 'stat_block_incomplete');
  assert.deepEqual(pursuer.details.needs.field, 'creature');
  assert.match(pursuer.message, /a chase by Belfry hound reads them/);
  assert.equal(await game.saved('chase.json'), null, 'no chase was filed');
});

test('CK-F2: a fight against a person whose block lacks characteristics is refused with the archetype completion', async t => {
  const game = await table(t);
  const error = await refusal(game.resolve(fight(WARDEN)));
  assert.equal(error.details.reason, 'stat_block_incomplete');
  assert.equal(error.details.kind, 'npc');
  assert.deepEqual(error.details.missing, ['characteristics.DEX', 'characteristics.CON']);
  assert.deepEqual(error.details.needs, {field: 'archetype', options: ARCHETYPES.map(entry => entry.archetype_id)},
    'the field the host\'s band recovery answers (§138.6)');
  assert.match(error.fix, /^complete the block first with apply npc \{name: "Old warden", archetype: <one of details\.needs\.options, chosen from who this person is>/);
  // The no-stat-block refusal's list of who can be fought counts only a block that lacks nothing.
  const none = await refusal(game.resolve(fight(PORTER)));
  assert.match(none.message, /has no stat block/);
  assert.deepEqual(none.details.needs.fightable, ['cellar-rats'], 'the hound and the warden have a block, but no fight can be built on it');
});

// ---------------------------------------------------------------------------------------------------
// Completion.
// ---------------------------------------------------------------------------------------------------

test('CK-F2: apply npc creature completes the hound\'s block -- the catalog fills the gaps, every authored value wins', async t => {
  const game = await table(t);
  const applied = await game.apply({kind: 'npc', name: HOUND, creature: 'Rat Pack', why: 'the hound fights like a cornered rat'});
  const profile = (await game.world()).npc_profiles['belfry-hound'], pack = BEASTS['Rat Pack'];
  assert.equal(profile.authority, 'table_pinned');
  assert.equal(profile.catalog, 'Rat Pack');
  assert.equal(profile.completed_from, 'Rat Pack');
  assert.deepEqual(sortedPaths(profile.filled), sortedPaths(['characteristics.STR', 'characteristics.CON', 'characteristics.SIZ', 'characteristics.POW',
    'derived.MP', 'derived.MOV', 'derived.DB', 'derived.Build', 'skills.Fighting', 'weapons.overwhelm-mnvr']));
  // Characteristics: the stated DEX stands; the rest are the entry's rolls.
  assert.equal(profile.characteristics.DEX, 85);
  for (const key of ['STR', 'CON', 'SIZ', 'POW']) {
    const roll = pack.rolls[key.toLowerCase()], [count, faces, plus] = roll.dice.match(/^(\d+)D(\d+)(?:\+(\d+))?$/).slice(1).map(Number);
    const low = (count + (plus || 0)) * roll.times, high = (count * faces + (plus || 0)) * roll.times, value = profile.characteristics[key];
    assert.ok(value >= low && value <= high && value % roll.times === 0, `${key} ${value} is a ${roll.dice} x${roll.times} roll`);
  }
  assert.deepEqual([...profile.rolled].sort(), ['CON', 'POW', 'SIZ', 'STR'], 'a stated characteristic is not a rolled one');
  // Derived: the stated HP wins over the printed 9; the rest as the entry prints or the tables derive.
  assert.deepEqual(profile.derived, {HP: 14, MP: Math.floor(profile.characteristics.POW / 5), MOV: pack.mov, DB: pack.damage_bonus, Build: pack.build});
  // Skills by key: the stated Dodge 40 wins over the printed 42; the entry's Fighting fills a key the block lacks.
  assert.deepEqual(profile.skills, {Fighting: 40, Dodge: 40, 'Fighting (Brawl)': 50, Stealth: 60});
  // Weapons by id: the stated `fighting` (in the engine's spelling) replaces the entry's; the entry's maneuver is added.
  assert.deepEqual(profile.weapons[0], {weapon_id: 'fighting', name: 'Bite', skill: 'Fighting (Brawl)', damage: '1D8', uses_per_round: '1', impales: false});
  assert.deepEqual(profile.weapons.map(weapon => weapon.weapon_id), ['fighting', 'overwhelm-mnvr']);
  assert.equal(profile.armor_unstated, true, 'the entry prints no armor, and nothing is made up');
  const receipt = (await game.receipts()).find(row => row.id === applied.receipts[0]);
  assert.equal(receipt.profile.completed_from, 'Rat Pack');
  assert.deepEqual(receipt.profile.filled, profile.filled, 'the Keeper reads what the catalog filled on the receipt');
  // The fight then resolves, with the completed block's numbers.
  const started = await game.resolve(fight(HOUND));
  assert.ok(started.session.participants.some(entry => entry.name === 'belfry-hound' && entry.label === HOUND), JSON.stringify(started.session));
  const fighter = (await game.saved('combat.json')).participants.find(entry => entry.actor_id === 'belfry-hound');
  assert.deepEqual([fighter.hp_max, fighter.combat_skill, fighter.dodge_skill, fighter.dex, fighter.damage_bonus, fighter.build],
    [14, 50, 40, 85, pack.damage_bonus, pack.build]);
});

test('CK-F2: a complete block still refuses a catalog creature (stat_block_exists), and so does a completed one', async t => {
  const game = await table(t);
  const rats = await game.apply({kind: 'npc', name: RATS, creature: 'Rat Pack', why: 'test'}).then(() => null, error => error);
  assert.equal(rats?.details?.reason, 'stat_block_exists', 'a block that lacks nothing is the book\'s, whole');
  assert.equal(rats.details.authority, 'source_authored');
  await game.apply({kind: 'npc', name: HOUND, creature: 'Dog', why: 'a hound'});
  const completed = (await game.world()).npc_profiles['belfry-hound'];
  const again = await game.apply({kind: 'npc', name: HOUND, creature: 'Wolf', why: 'test'}).then(() => null, error => error);
  assert.equal(again?.details?.reason, 'stat_block_exists', 'the completion is made once');
  assert.equal(again.details.catalog, 'Dog');
  assert.deepEqual((await game.world()).npc_profiles['belfry-hound'], completed);
});

test('CK-F2: apply npc archetype completes the warden\'s block -- the book\'s STR and SIZ feed the derivation and win', async t => {
  const game = await table(t);
  await game.apply({kind: 'npc', name: WARDEN, archetype: 'capable_adult', why: 'a warden who has hauled coal all his life'});
  const profile = (await game.world()).npc_profiles['old-warden'], tier = ARCHETYPES.find(entry => entry.archetype_id === 'capable_adult');
  assert.equal(profile.archetype, 'capable_adult');
  assert.equal(profile.completed_from, 'capable_adult');
  assert.deepEqual(sortedPaths(profile.filled), sortedPaths(['characteristics.CON', 'characteristics.DEX', 'characteristics.POW',
    'derived.HP', 'derived.MP', 'derived.SAN', 'derived.MOV', 'derived.DB', 'derived.Build', 'skills.Persuade', 'skills.Psychology', 'skills.Spot Hidden']));
  assert.deepEqual([profile.characteristics.STR, profile.characteristics.SIZ], [95, 90], 'outside capable_adult\'s ranges: the book\'s');
  for (const key of ['CON', 'DEX', 'POW']) {
    const [low, high] = tier.characteristics[key];
    assert.ok(profile.characteristics[key] >= low && profile.characteristics[key] <= high, key);
  }
  assert.deepEqual([profile.skills['Fighting (Brawl)'], profile.skills.Dodge], [70, 10]);
  // Derived from the book's STR 95 and SIZ 90 (185: +1D6), which no capable_adult roll reaches.
  const table185 = damageFor(185);
  assert.deepEqual([profile.derived.DB, profile.derived.Build], [table185.damage_bonus, table185.build]);
  assert.equal(profile.derived.HP, Math.floor((profile.characteristics.CON + 90) / 10));
  const started = await game.resolve(fight(WARDEN));
  assert.ok(started.session.participants.some(entry => entry.name === 'old-warden'), JSON.stringify(started.session));
  const fighter = (await game.saved('combat.json')).participants.find(entry => entry.actor_id === 'old-warden');
  assert.deepEqual([fighter.combat_skill, fighter.dodge_skill], [70, 10]);
});

// ---------------------------------------------------------------------------------------------------
// The product path: a new Mystery House campaign and the real familiar.
// ---------------------------------------------------------------------------------------------------

test('CK-F2: Mystery House -- the chapel familiar is refused with its completion, completed from the catalog, and fought', async t => {
  const game = await table(t, 'mystery-house');
  const graph = JSON.parse(await readFile(join(root, 'content/starters/mystery-house/module-graph.json'), 'utf8'));
  const authored = graph.nodes.find(node => node.node_id === 'creature-chapel-familiar').properties.mechanics.profile;
  await game.apply({kind: 'npc', name: 'Chapel familiar', to: 'here', why: 'it drops from the rafters'});
  // Its body cannot be settled either: no HP, and no CON or SIZ to read them from (§66's patient).
  const stone = await refusal(game.apply({kind: 'damage', subject: 'Chapel familiar', dice: '1D3', why: 'a thrown stone'}));
  assert.equal(stone.details.reason, 'stat_block_incomplete');
  assert.deepEqual(stone.details.missing, ['characteristics.CON', 'characteristics.SIZ']);
  assert.equal((await game.world()).npc_resources?.['chapel-familiar'], undefined, 'no hit points were written');
  const error = await refusal(game.resolve(fight('Chapel familiar')));
  assert.equal(error.details.reason, 'stat_block_incomplete');
  assert.deepEqual(error.details.missing, ['characteristics.STR', 'characteristics.SIZ', 'characteristics.DEX', 'characteristics.CON']);
  assert.deepEqual(error.details.options, CATALOG);
  await game.apply({kind: 'npc', name: 'Chapel familiar', creature: 'Dog', why: 'the familiar is the size and temper of a dog'});
  const profile = (await game.world()).npc_profiles['chapel-familiar'];
  assert.equal(profile.completed_from, 'Dog');
  for (const [skill, value] of Object.entries(authored.skills)) assert.equal(profile.skills[skill], value, skill);
  assert.ok(profile.filled.includes('characteristics.STR') && !profile.filled.some(path => path.startsWith('skills.Dodge')));
  const started = await game.resolve(fight('Chapel familiar'));
  assert.ok(started.session.participants.some(entry => entry.name === 'chapel-familiar' && entry.label === 'Chapel familiar'), JSON.stringify(started.session));
  const fighter = (await game.saved('combat.json')).participants.find(entry => entry.actor_id === 'chapel-familiar');
  assert.deepEqual([fighter.combat_skill, fighter.dodge_skill, fighter.hp_max], [50, 40, BEASTS.Dog.hp]);
});

test('CK-F2: once completed, the familiar\'s body takes damage from its completed hit points', async t => {
  const game = await table(t, 'mystery-house');
  await game.apply({kind: 'npc', name: 'Chapel familiar', to: 'here', why: 'it drops from the rafters'},
    {kind: 'npc', name: 'Chapel familiar', creature: 'Dog', why: 'the size and temper of a dog'});
  await game.apply({kind: 'damage', subject: 'Chapel familiar', dice: '1D3', why: 'a thrown stone'});
  const hp = (await game.world()).npc_resources['chapel-familiar'].current_hp;
  assert.ok(hp >= BEASTS.Dog.hp - 3 && hp <= BEASTS.Dog.hp - 1, `hit points ${hp} come off the completed ${BEASTS.Dog.hp}`);
});
