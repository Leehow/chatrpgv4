/**
 * Contract §180.12 (ticket CK-F): the starters' creature data, and how a starter binds the package words its data carries.
 *
 * A starter is authored, so `registerStarter` derives its binding from the data: every word an installed package
 * contributes that a being of its own kind carries (a person's word on an npc, a creature's on a creature), and the
 * weakness shape when any being carries `weaknesses` -- recorded in `meta.vocabulary` as a built module's provenance is,
 * and held to the reader's checker (§180.7, §180.9) before any byte of the generation is written.
 *
 * Every registration travels the real entry (`module.register`, which `campaign.create` calls) over a content root that
 * is the shipped one except for the one starter graph a case edits, with the built-in packages beside it. The product
 * path opens a new haunting campaign and reads the real capsule and the single-person read.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = await mkdtemp(join(tmpdir(), 'starter-creatures-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'starter-creatures-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents: [
  `export {createKernelContext} from './kernel-ts/context.ts';`,
  `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
  `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
  `export {pythonJsonDumps} from './kernel-ts/json.ts';`,
  `export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
  `export {beingPairs} from './kernel-ts/modules/being-shape.ts';`,
  `export {graphManifest} from './kernel-ts/write/source.ts';`,
].join('\n'), resolveDir: root, sourcefile: 'starter-creatures-api.ts', loader: 'ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const STARTERS = ['mystery-house', 'the-haunting', 'the-haunting-rulebook', 'voice-bench'];
const shippedGraph = async id => JSON.parse(await readFile(join(content, 'starters', id, 'module-graph.json'), 'utf8'));
const HOSTILE = (await readFile(join(root, 'mods', 'hostile-creatures', 'mod.json'), 'utf8')).toString();
const HABITS_WORD = {...JSON.parse(HOSTILE).contributes.vocabulary.creature_profile_keys[0], mod: 'hostile-creatures', version: JSON.parse(HOSTILE).version};
const WEAKNESS_SHAPE = {mod: 'hostile-creatures', version: JSON.parse(HOSTILE).version};
const NATURAL = JSON.parse(await readFile(join(root, 'mods', 'natural-npc', 'mod.json'), 'utf8'));
const LANGUAGE_WORD = {...NATURAL.contributes.vocabulary.actor_profile_keys.find(word => word.key === 'language'), mod: 'natural-npc', version: NATURAL.version};

/**
 * A content root that is the shipped one except for one starter's graph, which `mutate` edits; the built-in packages sit
 * beside it, where the kernel's catalog reads them (`<content>/../mods`). No `mutate`: the shipped content itself.
 */
async function contentWith(id, mutate) {
  if (!mutate) return content;
  const base = await mkdtemp(join(scratch, 'root-')), dir = join(base, 'content');
  await mkdir(join(dir, 'starters'), {recursive: true});
  await symlink(join(root, 'mods'), join(base, 'mods'));
  for (const name of await readdir(content))
    if (name !== 'starters') await symlink(join(content, name), join(dir, name));
  for (const other of await readdir(join(content, 'starters')))
    if (other !== id) await symlink(join(content, 'starters', other), join(dir, 'starters', other));
  const starter = join(dir, 'starters', id), shipped = join(content, 'starters', id);
  await mkdir(starter);
  for (const name of await readdir(shipped))
    if (name !== 'module-graph.json') await symlink(join(shipped, name), join(starter, name));
  const graph = await shippedGraph(id);
  mutate(graph);
  await writeFile(join(starter, 'module-graph.json'), JSON.stringify(graph, null, 2));
  return dir;
}
async function kernel(t, contentRoot = content, workspace = null) {
  workspace ??= await mkdtemp(join(scratch, 'home-'));
  const context = await api.createKernelContext({workspace, content: contentRoot, seed: 'starter-creatures', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
  const call = async (method, params = {}) => {
    try { return wire(await runtime.handlers[method](params)); }
    catch (error) { throw typeof error?.toJson === 'function' ? Object.assign(new Error(error.message), wire(error.toJson())) : error; }
  };
  const meta = async id => JSON.parse(await readFile(join(workspace, '.coc', 'modules', id, 'module.json'), 'utf8'));
  return {workspace, call, meta, close: () => runtime.close()};
}
/** Registers `id` (edited by `mutate`) in a fresh home; returns the installed module.json. */
async function registered(t, id, mutate, before = async () => {}) {
  const game = await kernel(t, await contentWith(id, mutate));
  await before(game);
  await game.call('module.register', {module_id: id});
  return game.meta(id);
}
/** Registers `id` (edited by `mutate`) expecting the being refusal; returns its refusals and the home it left. */
async function refused(t, id, mutate) {
  const game = await kernel(t, await contentWith(id, mutate));
  const error = await game.call('module.register', {module_id: id}).then(() => null, error => error);
  assert.ok(error, 'the starter registered');
  assert.equal(error.code, 'invalid_params', error.message);
  assert.equal(error.details?.reason, 'beings_invalid', error.message);
  return {refusals: error.details.refusals, game};
}
const node = (graph, id) => graph.nodes.find(entry => entry.node_id === id);
const exists = path => stat(path).then(() => true, () => false);
const keyed = words => words.map(({ask: _ask, ...word}) => word);

// ---------------------------------------------------------------------------------------------------
// How a starter binds words (§180.12).
// ---------------------------------------------------------------------------------------------------

test('§180.12: each shipped starter binds exactly the words its data carries, under the package that contributes them', async t => {
  const game = await kernel(t);
  for (const id of STARTERS) await game.call('module.register', {module_id: id});
  // The haunting's rats carry habits and Corbitt carries weaknesses: both bound, named for Hostile Creatures.
  assert.deepEqual((await game.meta('the-haunting')).vocabulary,
    {actor_profile_keys: [], creature_profile_keys: [HABITS_WORD], actor_weaknesses: WEAKNESS_SHAPE});
  assert.deepEqual((await game.meta('mystery-house')).vocabulary,
    {actor_profile_keys: [], creature_profile_keys: [HABITS_WORD], actor_weaknesses: WEAKNESS_SHAPE});
  // The rulebook twin's rats carry habits and nobody carries weaknesses: the shape is not bound.
  assert.deepEqual((await game.meta('the-haunting-rulebook')).vocabulary, {actor_profile_keys: [], creature_profile_keys: [HABITS_WORD]});
  // A starter that carries no contributed word binds none, as before.
  assert.equal(Object.hasOwn(await game.meta('voice-bench'), 'vocabulary'), false);
});

test('§180.12: a word binds only where a being of its own kind carries it -- a person\'s on an npc, a creature\'s on a creature', async t => {
  const persons = graph => graph.nodes.filter(entry => entry.node_kind === 'npc');
  // A creature's word on a person is not a word of that person: nothing is bound.
  const creatureWordOnPerson = await registered(t, 'voice-bench', graph => { persons(graph)[0].properties.habits = 'Sits by the stove.'; });
  assert.equal(Object.hasOwn(creatureWordOnPerson, 'vocabulary'), false);
  // A person's word on a person, in the projection record a starter keeps it in, binds under its package's label.
  const personWord = await registered(t, 'voice-bench', graph => { persons(graph)[1].properties.runtime_projection.record.language = 'Tianjin dialect'; });
  assert.deepEqual(keyed(personWord.vocabulary.actor_profile_keys), [keyed([LANGUAGE_WORD])[0]]);
  assert.equal(personWord.vocabulary.actor_profile_keys[0].label, 'speaks');
  assert.equal(Object.hasOwn(personWord.vocabulary, 'creature_profile_keys'), false);
  assert.equal(Object.hasOwn(personWord.vocabulary, 'actor_weaknesses'), false);
  // A key no installed package contributes is the author's own property, never a bound word.
  const unknown = await registered(t, 'voice-bench', graph => { persons(graph)[2].properties.lair = 'The back room.'; });
  assert.equal(Object.hasOwn(unknown, 'vocabulary'), false);
});

test('§180.12: the binding is the data\'s, so a package the defaults leave off still names the words it contributes', async t => {
  const meta = await registered(t, 'the-haunting', () => {}, game => game.call('mods.defaults', {id: 'hostile-creatures', enabled: false}));
  assert.deepEqual(meta.vocabulary, {actor_profile_keys: [], creature_profile_keys: [HABITS_WORD], actor_weaknesses: WEAKNESS_SHAPE});
});

test('§180.18: an unchanged old registration repairs its binding and real capsule without rewriting its graph or campaign', async t => {
  const first = await kernel(t), id = 'the-haunting';
  await first.call('campaign.create', {id: 'old-haunt', module: id, pregen: 'thomas-hayes', play_language: 'en'});
  const dir = join(first.workspace, '.coc/modules', id), metaFile = join(dir, 'module.json');
  const old = await first.meta(id); delete old.vocabulary;
  await first.close();
  await writeFile(metaFile, JSON.stringify(old));
  const game = await kernel(t, content, first.workspace);
  const call = (method, params = {}) => game.call(method, {campaign: 'old-haunt', ...params});
  const before = await call('table.capsule');
  assert.equal(before.mods.vocabulary.words.find(word => word.key === 'habits').bound, false);
  assert.equal((await call('table.look', {focus: 'npc', name: 'Rat pack'})).habits, undefined);
  const tree = async dir => {
    const out = {};
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      if ((await stat(path)).isDirectory()) {
        for (const [child, bytes] of Object.entries(await tree(path))) out[`${name}/${child}`] = bytes;
      } else out[name] = (await readFile(path)).toString('base64');
    }
    return out;
  };
  const savedGraph = await readFile(join(dir, 'module-graph.json'));
  const manifest = await readFile(join(dir, 'module-graph-manifest.json'));
  const campaign = join(first.workspace, '.coc/campaigns/old-haunt'), history = await tree(campaign);
  await game.call('module.register', {module_id: id});
  const repaired = await game.meta(id), {vocabulary, updated_at: _updated, ...rest} = repaired;
  const {updated_at: _oldUpdated, ...oldRest} = old;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(vocabulary, {actor_profile_keys: [], creature_profile_keys: [HABITS_WORD], actor_weaknesses: WEAKNESS_SHAPE});
  assert.deepEqual(await readFile(join(dir, 'module-graph.json')), savedGraph);
  assert.deepEqual(await readFile(join(dir, 'module-graph-manifest.json')), manifest);
  assert.deepEqual(await tree(campaign), history);
  assert.equal((await call('table.capsule')).mods.vocabulary.words.find(word => word.key === 'habits').bound, true);
  assert.equal((await call('table.look', {focus: 'npc', name: 'Rat pack'})).habits,
    node(await shippedGraph(id), 'creature-rat-pack').properties.habits);
  assert.equal((await call('table.look', {focus: 'npc', name: 'Walter Corbitt'})).weaknesses.length, 2);
  const once = await readFile(metaFile);
  await game.call('module.register', {module_id: id});
  assert.deepEqual(await readFile(metaFile), once, 'the repair is idempotent');
});

test('§180.18: missing bindings are added while existing keys, labels and weakness provenance remain unchanged', async t => {
  for (const vocabulary of [
    {actor_profile_keys: [{key: 'language', label: 'old language', mod: 'old-package', version: '0.1.0'}], audit: 'keep'},
    {creature_profile_keys: [{...HABITS_WORD, label: 'old habits', version: '0.1.0'}], actor_weaknesses: false},
    {actor_profile_keys: [{...HABITS_WORD, label: 'claimed on the other spine'}], actor_weaknesses: {mod: 'old-package', version: '0.1.0'}},
  ]) {
    const game = await kernel(t), id = 'the-haunting';
    await game.call('module.register', {module_id: id});
    const meta = await game.meta(id); meta.vocabulary = vocabulary;
    await writeFile(join(game.workspace, '.coc/modules', id, 'module.json'), JSON.stringify(meta));
    await game.call('module.register', {module_id: id});
    const next = (await game.meta(id)).vocabulary;
    for (const [field, value] of Object.entries(vocabulary)) assert.deepEqual(next[field], value);
    if (!Object.hasOwn(vocabulary, 'actor_weaknesses')) assert.deepEqual(next.actor_weaknesses, WEAKNESS_SHAPE);
    if (!vocabulary.actor_profile_keys?.some(word => word.key === 'habits') && !vocabulary.creature_profile_keys)
      assert.deepEqual(next.creature_profile_keys, [HABITS_WORD]);
    if (vocabulary.actor_profile_keys?.some(word => word.key === 'habits')) assert.equal(next.creature_profile_keys, undefined);
  }
});

test('§180.18: edited graph bytes or malformed old metadata refuse without overwriting either', async t => {
  for (const edit of ['graph', 'vocabulary']) {
    const game = await kernel(t), id = 'the-haunting';
    await game.call('module.register', {module_id: id});
    const dir = join(game.workspace, '.coc/modules', id), meta = await game.meta(id);
    delete meta.vocabulary;
    if (edit === 'graph') await writeFile(join(dir, 'module-graph.json'), JSON.stringify({user_authored: true}));
    else meta.vocabulary = {creature_profile_keys: null};
    await writeFile(join(dir, 'module.json'), JSON.stringify(meta));
    const before = await Promise.all(['module.json', 'module-graph.json'].map(file => readFile(join(dir, file))));
    const error = await game.call('module.register', {module_id: id}).then(() => null, error => error);
    assert.equal(error?.code, 'campaign_not_ready');
    assert.equal(error.details.reason, edit === 'graph' ? 'module_graph_integrity' : 'starter_vocabulary_invalid');
    assert.deepEqual(await Promise.all(['module.json', 'module-graph.json'].map(file => readFile(join(dir, file)))), before);
  }
});

test('§180.18: a user/PDF provenance is not inferred, and an unavailable contribution remains unbound', async t => {
  const game = await kernel(t), id = 'the-haunting';
  await game.call('module.register', {module_id: id});
  const meta = await game.meta(id); meta.source = 'pdf'; delete meta.vocabulary;
  await writeFile(join(game.workspace, '.coc/modules', id, 'module.json'), JSON.stringify(meta));
  await game.call('module.register', {module_id: id});
  assert.equal((await game.meta(id)).vocabulary, undefined);
  const dir = await mkdtemp(join(scratch, 'no-packages-'));
  await mkdir(join(dir, 'content'));
  for (const name of await readdir(content)) await symlink(join(content, name), join(dir, 'content', name));
  const other = await kernel(t), twin = 'the-haunting-rulebook';
  await other.call('module.register', {module_id: twin});
  const legacy = await other.meta(twin); delete legacy.vocabulary;
  await other.close();
  const file = join(other.workspace, '.coc/modules', twin, 'module.json');
  await writeFile(file, JSON.stringify(legacy));
  const unavailable = await kernel(t, join(dir, 'content'), other.workspace);
  const before = await readFile(file);
  await unavailable.call('module.register', {module_id: twin});
  assert.deepEqual(await readFile(file), before, 'there is no provider from which to derive the habit word');
  assert.equal((await unavailable.meta(twin)).vocabulary, undefined);
});

test('§180.18: a legacy malformed weakness is checked before any repaired binding is published', async t => {
  const id = 'the-haunting', old = await registered(t, id), contentRoot = await contentWith(id, graph => {
    node(graph, 'npc-walter-corbitt').properties.weaknesses[0].needs = ['clue-rusted-basement-dagger'];
  });
  delete old.vocabulary;
  const game = await kernel(t, contentRoot), dir = join(game.workspace, '.coc/modules', id);
  const bytes = await readFile(join(contentRoot, 'starters', id, 'module-graph.json'));
  old.graph_digest = createHash('sha256').update(bytes).digest('hex');
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'module-graph.json'), bytes);
  await writeFile(join(dir, 'module-graph-manifest.json'), JSON.stringify(api.graphManifest(JSON.parse(bytes), id, old.generation)));
  await writeFile(join(dir, 'module.json'), JSON.stringify(old));
  const before = await readFile(join(dir, 'module.json'));
  const error = await game.call('module.register', {module_id: id}).then(() => null, error => error);
  assert.equal(error?.details?.reason, 'beings_invalid');
  assert.equal(error.details.refusals[0].path, 'properties.weaknesses[0].needs[0]');
  assert.deepEqual(await readFile(join(dir, 'module.json')), before);
  assert.deepEqual(await readFile(join(dir, 'module-graph.json')), bytes);
});

test('§180.12: a starter whose weakness is malformed is refused before any byte of the generation is written', async t => {
  const corbitt = graph => node(graph, 'npc-walter-corbitt').properties;
  const cases = [
    [graph => { corbitt(graph).weaknesses[0].needs = ['clue-rusted-basement-dagger']; },
      {node: 'npc-walter-corbitt', rule: 'shape_unresolved', path: 'properties.weaknesses[0].needs[0]'}],
    [graph => { corbitt(graph).weaknesses[0].learned_by = 'conclusion-nobody-reaches'; },
      {node: 'npc-walter-corbitt', rule: 'shape_unresolved', path: 'properties.weaknesses[0].learned_by'}],
    [graph => { delete corbitt(graph).weaknesses[1].book; },
      {node: 'npc-walter-corbitt', rule: 'shape_unresolved', path: 'properties.weaknesses[1].book'}],
    [graph => { node(graph, 'creature-rat-pack').properties.weaknesses = 'fire'; },
      {node: 'creature-rat-pack', rule: 'shape_prose', path: 'properties.weaknesses'}],
  ];
  for (const [mutate, expected] of cases) {
    const {refusals, game} = await refused(t, 'the-haunting', mutate);
    assert.deepEqual(refusals.map(({node, rule, path}) => ({node, rule, path})), [expected]);
    const folder = join(game.workspace, '.coc', 'modules', 'the-haunting');
    assert.equal(await exists(join(folder, 'module.json')), false, 'no generation is published');
    assert.equal(await exists(join(folder, 'module-graph.json')), false, 'no byte of the graph is written');
  }
  // On a starter that carries no other word, a malformed weakness is what binds the shape -- and so it is held too.
  const {refusals} = await refused(t, 'voice-bench', graph => {
    graph.nodes.find(entry => entry.node_kind === 'npc').properties.runtime_projection.record.weaknesses = [{needs: []}];
  });
  assert.deepEqual(refusals.map(({rule, path}) => [rule, path]), [['shape_unresolved', 'properties.runtime_projection.record.weaknesses[0].book']]);
});

test('§180.7: a starter that carries one being as two nodes, or a misleads between the wrong kinds, is refused whatever it binds', async t => {
  const person = graph => graph.nodes.find(entry => entry.node_kind === 'npc');
  // voice-bench binds nothing: the being checks are the base's and hold anyway.
  const twin = await refused(t, 'voice-bench', graph => {
    const npc = person(graph);
    graph.nodes.push({node_id: `creature-${npc.node_id.slice('npc-'.length)}`, node_kind: 'creature', name: npc.name, visibility: 'keeper-only',
      aliases: [], summary: npc.name, evidence_span_ids: [], properties: {}, source_refs: []});
  });
  assert.deepEqual(twin.refusals.map(({rule, path}) => [rule, path]), [['one_being_two_nodes', 'node_id']]);
  assert.match(twin.refusals[0].message, /npc npc-[a-z-]+ and creature creature-[a-z-]+ share the name/);
  const misleads = await refused(t, 'voice-bench', graph => {
    const scene = graph.nodes.find(entry => entry.node_kind === 'scene');
    graph.relations.push({relation_id: 'relation-misleads-test', relation_kind: 'misleads', from_node_id: scene.node_id, to_node_id: person(graph).node_id, properties: {}});
  });
  assert.deepEqual(misleads.refusals.map(({rule, path}) => [rule, path]), [['relation_endpoints', `relations[${(await shippedGraph('voice-bench')).relations.length}]`]]);
});

// ---------------------------------------------------------------------------------------------------
// The shipped data (§180.12, §180.7).
// ---------------------------------------------------------------------------------------------------

test('§180.7: no shipped starter carries one being as two nodes', async () => {
  for (const id of STARTERS)
    assert.deepEqual(api.beingPairs(new api.ModuleGraph(id, await shippedGraph(id), 'digest', {})), [], id);
});

/** Keeper Rulebook 40th Anniversary, PDF p. 458 (printed 446): the RAT PACK stat block. */
const RAT_PACK = {characteristics: {STR: 35, CON: 55, SIZ: 35, POW: 50, DEX: 70}, derived: {HP: 9, MOV: 9, Build: -1, DB: '-1'},
  skills: {Fighting: 40, Dodge: 42}, weapons: [['claws', '1D3'], ['overwhelm', '2D6']]};
const PERSON_FIELDS = ['agenda', 'fear', 'secret', 'voice', 'relationship_to_investigators', 'social_role', 'lie_options', 'deflect_options', 'runtime_projection'];
function bookRats(rats) {
  const {profile} = rats.properties.mechanics;
  assert.deepEqual([profile.characteristics, profile.derived, profile.skills], [RAT_PACK.characteristics, RAT_PACK.derived, RAT_PACK.skills]);
  assert.deepEqual(profile.weapons.map(weapon => [weapon.weapon_id, weapon.damage]), RAT_PACK.weapons);
  assert.deepEqual(rats.properties.combat, {disposition: 'fights_then_flees'});
  assert.match(rats.properties.habits, /crawl space behind the cellar's boards/);
  assert.match(rats.properties.habits, /Overwhelm/);
  assert.match(rats.properties.habits, /Once one rat is killed the rest flee/);
  for (const field of PERSON_FIELDS) assert.equal(Object.hasOwn(rats.properties, field), false, field);
}

test('§180.12: the haunting -- one creature with the book\'s numbers and habits, and Corbitt\'s weaknesses with their route', async () => {
  const graph = await shippedGraph('the-haunting'), text = JSON.stringify(graph);
  assert.equal(text.includes('npc-rat-pack'), false, 'the npc twin, its claims, relations and projection record are gone');
  const rats = node(graph, 'creature-rat-pack');
  bookRats(rats);
  assert.deepEqual(graph.relations.filter(r => r.from_node_id === 'creature-rat-pack').map(r => [r.relation_kind, r.to_node_id]), [['present-in', 'scene-basement-rites']]);
  const weaknesses = node(graph, 'npc-walter-corbitt').properties.weaknesses;
  assert.equal(weaknesses.length, 2);
  assert.deepEqual(Object.keys(weaknesses[0]).sort(), ['book', 'learned_by', 'needs']);
  assert.deepEqual(Object.keys(weaknesses[1]), ['book'], 'sunlight is the Keeper\'s to decide: no means, no route');
  assert.equal(node(graph, weaknesses[0].needs[0]).node_kind, 'artifact');
  const supports = graph.relations.filter(r => r.relation_kind === 'supports' && r.to_node_id === weaknesses[0].learned_by).map(r => r.from_node_id);
  assert.equal(node(graph, weaknesses[0].learned_by).node_kind, 'conclusion');
  assert.deepEqual(supports.map(id => node(graph, id)?.node_kind), ['clue', 'clue', 'clue', 'clue'], 'the route\'s clues exist');
});

test('§180.12: the rulebook twin\'s rats state a typed stat block, and no loose number beside it', async () => {
  const rats = node(await shippedGraph('the-haunting-rulebook'), 'creature-rat-pack');
  bookRats(rats);
  assert.deepEqual(Object.keys(rats.properties).sort(), ['combat', 'habits', 'mechanics']);
});

test('§180.12: mystery-house -- the prefix follows the kind, the handles stay, the person fields go', async () => {
  const graph = await shippedGraph('mystery-house'), text = JSON.stringify(graph);
  for (const id of ['npc-rat-swarm', 'npc-chapel-familiar']) assert.equal(text.includes(`"${id}"`), false, id);
  const swarm = node(graph, 'creature-rat-swarm'), familiar = node(graph, 'creature-chapel-familiar');
  assert.deepEqual([swarm.node_kind, familiar.node_kind], ['creature', 'creature']);
  const view = new api.ModuleGraph('mystery-house', graph, 'digest', {});
  assert.deepEqual([view.handle(swarm), view.handle(familiar)], ['rat-swarm', 'chapel-familiar']);
  for (const being of [swarm, familiar])
    for (const field of PERSON_FIELDS) assert.equal(Object.hasOwn(being.properties, field), false, `${being.node_id} ${field}`);
  // The gym's own authored material: its agenda is how the familiar behaves, its fear what drives it off, its skills its numbers.
  assert.equal(familiar.properties.habits, 'Drive living things out of the ruined chapel, then flee toward the yard.');
  assert.deepEqual(familiar.properties.weaknesses, [{book: 'Fears fire and loud groups.'}]);
  assert.deepEqual(familiar.properties.mechanics.profile.skills, {'Fighting (Brawl)': 50, Dodge: 40, Stealth: 60});
  assert.ok(view.isActor(familiar) && view.isActor(swarm));
  const chapel = node(graph, 'scene-ruined-chapel');
  assert.deepEqual(chapel.properties.runtime_projection.record.npc_ids, ['creature-chapel-familiar']);
  assert.ok(graph.relations.some(r => r.relation_kind === 'present-in' && r.from_node_id === 'creature-chapel-familiar' && r.to_node_id === chapel.node_id));
});

// ---------------------------------------------------------------------------------------------------
// The product path: a new haunting campaign (§180.15 step 2, through the real RPC entry).
// ---------------------------------------------------------------------------------------------------

test('§180.12: a new haunting campaign shows the rats as a creature at the basement, and Corbitt\'s weakness chain', async t => {
  const game = await kernel(t), graph = await shippedGraph('the-haunting');
  const call = (method, params = {}) => game.call(method, {campaign: 'haunt', ...params});
  await game.call('campaign.create', {id: 'haunt', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'We head for the house.'});
  let n = 0;
  for (const to of ['corbitt-house-ground', 'basement-rites'])
    await call('table.apply', {call_id: `t1-c${++n}`, effects: [{kind: 'move', to, travel_minutes: 0}]});
  const basement = await call('table.capsule');
  const rats = node(graph, 'creature-rat-pack');
  assert.deepEqual(basement.present, [{name: 'Rat pack', kind: 'creature', what: rats.summary, habits: rats.properties.habits}],
    'the rats are a body: their habits, and no person field');

  const chain = [
    {book: node(graph, 'npc-walter-corbitt').properties.weaknesses[0].book,
      needs: [{name: 'Corbitt\'s ritual dagger', kind: 'artifact'}],
      learned_by: {conclusion: 'own-dagger-ends-corbitt', found: 0, of: 4}},
    {book: node(graph, 'npc-walter-corbitt').properties.weaknesses[1].book},
  ];
  const card = await call('table.look', {focus: 'npc', name: 'Walter Corbitt'});
  assert.deepEqual(card.weaknesses, chain, 'the means names itself (no one holds the dagger yet) and the route counts its clues');
  assert.equal(card.properties?.weaknesses, undefined, 'the chain names the means; the raw ids stay off the card');
  // The route moves as its clues are found: the dagger among the basement's tools is one of them.
  await call('table.apply', {call_id: `t1-c${++n}`, effects: [{kind: 'clue', clue: 'rusted-basement-dagger', how: 'A search of the tool pile turns up an old knife.'}]});
  chain[0].learned_by.found = 1;
  assert.deepEqual((await call('table.look', {focus: 'npc', name: 'Walter Corbitt'})).weaknesses, chain);

  await call('table.apply', {call_id: `t1-c${++n}`, effects: [{kind: 'move', to: 'corbitt-confrontation', travel_minutes: 0}]});
  const lair = await call('table.capsule');
  const corbitt = lair.present.find(row => row.name === 'Walter Corbitt');
  assert.deepEqual(corbitt.weaknesses, chain, 'his row carries the chain');
  assert.equal(Object.hasOwn(corbitt, 'kind'), false, 'Corbitt is a person');
  assert.equal(lair.present.some(row => row.name === 'Rat pack'), false, 'the rats stay in their crawl space');
});
