/**
 * Contract §180.8–§180.11 (docs/specs/creature-kind.md D3–D6, D18–D20; ticket CK-D): the Hostile Creatures package and
 * the kernel capabilities it needs -- a creature's words (`habits`), the weakness shape `actor.weaknesses.v1` and its
 * chain on the actor rows, the table door for both, and §183's person and creature gates.
 *
 * Binding is a build's, never a campaign's (§28.2), so every case that reads a bound word builds its book through the real
 * reading path: a PDF bound with `module.source.bind`, an index and an opening job claimed and finished with
 * `module.read.claim` / `module.read.finish`, the drafts written as a reader writes them and reviewed whole. The book is
 * this file's own and owes nothing to the shipped starters: a hall where an old warden (a person with four stated
 * weaknesses, one learnable through a conclusion three clues support, and a false lead about him) stands beside a rat
 * swarm with a stat block and its habits, and a moth cloud with neither. The table is played through `table.*`.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {speechRoster} from '../../extensions/kernel/speech-roster.ts';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = await mkdtemp(join(tmpdir(), 'hostile-creatures-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'hostile-creatures-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents: [
  `export {createKernelContext} from './kernel-ts/context.ts';`,
  `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
  `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
  `export {pythonJsonDumps} from './kernel-ts/json.ts';`,
  `export {checkSourceDraft} from './kernel-ts/check.ts';`,
  `export {buildVocabulary} from './kernel-ts/read/mods.ts';`,
  `export {kernelGates, parseSections, cutInstruction, KERNEL_GATES} from './kernel-ts/read/sections.ts';`,
  `export {weaknessChain} from './kernel-ts/read/weaknesses.ts';`,
  `export {ModuleGraph, dossierWith} from './kernel-ts/read/module-graph.ts';`,
].join('\n'), resolveDir: root, sourcefile: 'hostile-creatures-api.ts', loader: 'ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);
const PACKAGE = 'hostile-creatures';
const shipped = async file => readFile(join(root, 'mods', PACKAGE, file), 'utf8');

async function kernel(t) {
  const workspace = await mkdtemp(join(scratch, 'home-'));
  const context = await api.createKernelContext({workspace, content, seed: 'hostile-creatures', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
  const call = async (method, params = {}) => {
    try { return wire(await runtime.handlers[method](params)); }
    catch (error) { throw typeof error?.toJson === 'function' ? Object.assign(new Error(error.message), wire(error.toJson())) : error; }
  };
  return {workspace, context, call};
}
const rejects = (promise, check) => assert.rejects(promise, error => { check(error); return true; });
const array = value => Array.isArray(value) ? value : [];

// ---------------------------------------------------------------------------------------------------
// The fixture book.
// ---------------------------------------------------------------------------------------------------

const WARDEN = 'Old warden', RATS = 'Cellar rats', MOTHS = 'Moth cloud', HAYES = 'Thomas Hayes';
const W_KEY = 'Struck with the iron key his own hand forged, his binding breaks and he crumbles to rust.';
const W_SALT = 'A line of salt laid across a threshold holds him back for one night, though it must be laid again each evening, by someone who has not slept, before the moon clears the roof, or it fails.';
const W_SUN = 'Sunlight weakens him; the book leaves to the Keeper whether it ends him.';
const W_BELL = 'The chapel bell rung at midnight stills him for one round.';
const HABITS = 'They nest behind the cellar boards, swarm one intruder at a time, and scatter once one of them dies.';
const RAT_NOTE = 'The swarm breaks and flees once one rat is killed.';
const REFS = [{page: 1}];
const node = (node_id, node_kind, name, properties = {}, summary = `${name}.`) => ({node_id, node_kind, name, summary, source_refs: REFS, properties});
const claim = (subject_id, predicate, object) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: REFS});
const CLUES = ['clue-forge-ledger', 'clue-warden-diary', 'clue-locksmith-tale'];

function opening() {
  const nodes = [
    {node_id: 'scene-hall', node_kind: 'scene', name: 'Hall', source_refs: REFS, summary: 'The hall of the warden\'s house.', properties: {is_entrance: true}},
    {node_id: 'scene-cellar', node_kind: 'scene', name: 'Cellar', source_refs: [{page: 2}], summary: 'A cellar under the house.', properties: {is_final: true}},
    node('npc-old-warden', 'npc', WARDEN, {agenda: 'Keep the cellar shut.', weaknesses: [
      {book: W_KEY, needs: ['artifact-iron-key', 'spell-ward-of-iron', 'scene-cellar'], learned_by: 'conclusion-iron-key-binds-warden'},
      {book: W_SALT}, {book: W_SUN}, {book: W_BELL}]}, 'A stooped warden who keeps the cellar keys.'),
    node('artifact-iron-key', 'artifact', 'Iron key', {}, 'An iron key the warden forged.'),
    node('spell-ward-of-iron', 'spell', 'Ward of Iron'),
    node('tome-iron-psalter', 'tome', 'Iron Psalter', {spells: ['Ward of Iron']}),
    node('conclusion-iron-key-binds-warden', 'conclusion', 'The iron key unbinds the warden'),
    node(CLUES[0], 'clue', 'Forge ledger'), node(CLUES[1], 'clue', 'Warden diary'), node(CLUES[2], 'clue', 'Locksmith tale'),
    node('clue-silver-lore', 'clue', 'Silver lore', {}, 'Folk say silver drives the warden off.'),
    node('creature-cellar-rats', 'creature', RATS, {habits: HABITS, keeper_note: RAT_NOTE,
      mechanics: {profile: {characteristics: {STR: 35, DEX: 70}}}}, 'A swarm of rats behind the cellar boards.'),
    node('creature-moth-cloud', 'creature', MOTHS, {}, 'A cloud of pale moths around the lamp.'),
  ];
  const claims = [
    claim('scene-hall', 'route-to', 'scene-cellar'),
    claim('npc-old-warden', 'present-in', 'scene-hall'), claim('creature-cellar-rats', 'present-in', 'scene-hall'), claim('creature-moth-cloud', 'present-in', 'scene-hall'),
    ...CLUES.map(id => claim(id, 'supports', 'conclusion-iron-key-binds-warden')),
    ...[...CLUES, 'clue-silver-lore'].map(id => claim(id, 'discoverable-at', 'scene-hall')),
    claim('clue-silver-lore', 'misleads', 'npc-old-warden'),
    claim('artifact-iron-key', 'located-in', 'scene-cellar'),
  ];
  return {nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: nodes.map(entry => entry.node_id)};
}

/** A two-page PDF the kernel can bind. */
function pdf() {
  const streams = ['0 0 1 rg 0 0 100 100 re f', '0 0.6 0 rg 0 0 200 100 re f'];
  const pages = streams.map((stream, index) => ({page: 3 + index * 2, content: 4 + index * 2, stream}));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map(row => `${row.page} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    ...pages.flatMap(row => [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents ${row.content} 0 R >>`,
      `<< /Length ${row.stream.length} >>\nstream\n${row.stream}\nendstream`])];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(text), size = objects.length + 1;
  text += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return text;
}

/** The book built through the reader's real path: bind, index, opening. Returns the module, the opening packet and its provenance. */
async function buildBook(game, draft = opening()) {
  const file = join(game.workspace, `original-${Date.now()}.pdf`);
  await writeFile(file, pdf());
  const sha = createHash('sha256').update(await readFile(file)).digest('hex');
  const {module_id: mid} = await game.call('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
  const call = (method, params = {}) => game.call(method, {module_id: mid, ...params});
  const publish = async (job, body) => {
    await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]}));
    await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(body));
    const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(content, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
    await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []}));
    return call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
  };
  await call('module.read.request', {purpose: 'index'});
  await publish(await call('module.read.claim', {owner: 'test-host'}), {title: 'The Warden\'s House', language: 'en',
    sections: [{name: 'House', pages: [[1, 2]], entities: ['Hall', 'Cellar']}], map_candidates: []});
  await call('module.read.request', {purpose: 'opening'});
  const job = await call('module.read.claim', {owner: 'test-host'});
  const packet = JSON.parse(await readFile(join(job.work_dir, 'packet.json'), 'utf8'));
  const result = await publish(job, draft);
  assert.equal(result.opening_ready, true, JSON.stringify(result));
  const meta = JSON.parse(await readFile(join(game.workspace, '.coc', 'modules', mid, 'module.json'), 'utf8'));
  return {mid, packet, meta};
}

/** A campaign on the built book, the library path of §21.5: an investigator saved from a starter pregen, loaded here. */
async function played(game, mid, id = 'book') {
  if (!game.library) {
    await game.call('campaign.create', {id: 'source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    game.library = (await game.call('investigator.save', {campaign: 'source'})).library_id;
  }
  await game.call('campaign.create', {id, module: mid, play_language: 'en'});
  await game.call('investigator.load', {campaign: id, library_id: game.library});
  await game.call('setup.complete', {campaign: id});
  await game.call('table.open', {campaign: id});
  const call = (method, params = {}) => game.call(method, {campaign: id, ...params});
  await call('table.narrate', {call_id: 't0-c1', text: 'The hall is cold.'});
  let turn = 1, ordinal = 0;
  const opened = await call('table.player_input', {text: 'I look around the hall.'});
  const row = (capsule, name) => capsule.present.find(entry => entry.name === name);
  return {
    call, opened, row,
    id: () => `t${turn}-c${++ordinal}`,
    /** Close this turn with a narration and open the next; the capsule the next input publishes. */
    next: async (text = 'I wait and watch.') => {
      await call('table.narrate', {call_id: `t${turn}-c${++ordinal}`, text: 'The hall settles.'});
      turn += 1; ordinal = 0;
      return (await call('table.player_input', {text})).capsule;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// §180.11: the package.
// ---------------------------------------------------------------------------------------------------

test('§180.11: the shipped package -- id, version, default on, requires exactly the five capabilities, the habits word, no brief', async t => {
  const manifest = JSON.parse(await shipped('mod.json'));
  assert.equal(manifest.id, PACKAGE);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.default_enabled, true);
  assert.deepEqual([...manifest.requires].sort(), ['actor.weaknesses.v1', 'graph.vocabulary.table.v1', 'graph.vocabulary.v1', 'instructions.sections.v1', 'mods.package-files.v1']);
  assert.deepEqual(manifest.package_files, ['agent.md', 'sections.json']);
  assert.equal(manifest.contributes.brief, undefined);
  assert.deepEqual(manifest.contributes.vocabulary, {creature_profile_keys: [{key: 'habits', label: 'habits',
    ask: 'how this creature lives and acts as the book states: where it lairs, how it hunts or attacks, what draws it, when it breaks off or flees'}]});
  assert.equal(manifest.name.en, 'Hostile Creatures');
  const agent = await shipped('agent.md');
  assert.ok(Buffer.byteLength(agent, 'utf8') <= 4096, `agent.md is ${Buffer.byteLength(agent, 'utf8')} bytes`);
  // The catalog reads it as this kernel build's, compatible and on by default.
  const game = await kernel(t);
  const listed = (await game.call('mods.list')).mods.find(row => row.id === PACKAGE);
  assert.ok(listed, 'the built-in package is in the catalog');
  assert.equal(listed.compatible, true, JSON.stringify(listed));
});

test('§180.10/§183.1: the sections parse against agent.md and cover it; the preamble is resident and carries the walk-on line', async () => {
  const manifest = JSON.parse(await shipped('mod.json')), agent = await shipped('agent.md');
  const sections = api.parseSections(manifest, JSON.parse(await shipped('sections.json')), agent);
  const {preamble, parts} = api.cutInstruction(agent);
  assert.equal(sections.length, parts.length + 1);
  assert.deepEqual(sections.map(section => [section.heading, section.kind, [...section.triggers]]), [
    [null, 'resident', []],
    ['Playing a creature', 'situational', ['state:creature_present']],
    ['Weaknesses', 'situational', ['state:weakness_here', 'before_resolve:combat']]]);
  assert.equal(sections[0].text, preamble);
  for (const part of parts) assert.ok(sections.some(section => section.text === `## ${part.heading}\n\n${part.body}`), part.heading);
  // The walk-on line rides before the first such call, so in the resident text (§180.11).
  assert.match(preamble, /apply npc \{name, walk_on: true, creature:/);
  assert.match(preamble, /apply dossier \{name, values: \{habits:/);
});

// ---------------------------------------------------------------------------------------------------
// §180.8: the creature words, accepted and collected.
// ---------------------------------------------------------------------------------------------------

/** A copy of the shipped package under a new id, its manifest changed by `change`. */
async function variant(game, name, change) {
  const path = join(game.workspace, `variant-${name}`);
  await cp(join(root, 'mods', PACKAGE), path, {recursive: true});
  const manifest = JSON.parse(await readFile(join(path, 'mod.json'), 'utf8'));
  await writeFile(join(path, 'mod.json'), JSON.stringify(change({...manifest, id: name, default_enabled: false})));
  return path;
}
const withWords = (manifest, vocabulary) => ({...manifest, contributes: {...manifest.contributes, vocabulary}});

test('§180.8: a package may contribute creature words; one key is one spine\'s; a creature word carries no shape', async t => {
  const game = await kernel(t);
  const installed = await game.call('mods.install', {path: await variant(game, 'lairs', manifest => withWords(manifest,
    {creature_profile_keys: [{key: 'lair', label: 'lair', ask: 'where this creature lairs, as the book states'}]}))});
  assert.equal(installed.id, 'lairs');
  const refused = async (name, vocabulary, pattern) => rejects(game.call('mods.install', {path: await variant(game, name, manifest => withWords(manifest, vocabulary))}), error => {
    assert.equal(error.code, 'invalid_params', name);
    assert.match(error.message, pattern, name);
  });
  const word = {key: 'lair', label: 'lair', ask: 'where it lairs'};
  await refused('both-spines', {actor_profile_keys: [word], creature_profile_keys: [word]}, /contributed twice/);
  await refused('shaped', {creature_profile_keys: [{...word, shape: 'lines'}]}, /creature key .* carries shape/);
  await refused('empty', {creature_profile_keys: []}, /creature profile keys must be a list of one to eight/);
  // A spine this build does not know is skew: the package refuses itself, named, instead of failing the catalog.
  await game.call('mods.install', {path: await variant(game, 'ahead', manifest => withWords(manifest, {place_profile_keys: [word]}))});
  const ahead = (await game.call('mods.list')).mods.find(row => row.id === 'ahead');
  assert.equal(ahead.compatible, false);
});

test('§180.20: creature words follow consumer defaults, while source weaknesses always bind', async t => {
  const game = await kernel(t);
  const built = await api.buildVocabulary(game.context);
  assert.deepEqual(built.creature_profile_keys.map(entry => [entry.key, entry.label, entry.mod]), [['habits', 'habits', PACKAGE]]);
  assert.deepEqual(built.actor_weaknesses, {source: 'module-source', version: 1});
  assert.ok(!built.actor_profile_keys.some(entry => entry.key === 'habits'));
  // A later package claiming `language` as a creature word is displaced by Natural NPC's person word: one key, one spine.
  await game.call('mods.install', {path: await variant(game, 'zz-tongues', manifest => ({...withWords(manifest,
    {creature_profile_keys: [{key: 'language', label: 'cries', ask: 'the sounds it makes'}]}), default_enabled: true,
    requires: manifest.requires.filter(capability => capability !== 'actor.weaknesses.v1')}))});
  const again = await api.buildVocabulary(game.context);
  assert.ok(!again.creature_profile_keys.some(entry => entry.key === 'language'));
  assert.deepEqual(again.displaced.filter(entry => entry.key === 'language'), [{key: 'language', mod: 'zz-tongues', kept_by: 'natural-npc'}]);
  // Consumer defaults affect contributed words, not original-source facts.
  await game.call('mods.defaults', {id: PACKAGE, enabled: false});
  const off = await api.buildVocabulary(game.context);
  assert.deepEqual(off.actor_weaknesses, {source: 'module-source', version: 1});
  assert.ok(!array(off.creature_profile_keys).some(entry => entry.key === 'habits'));
});
// ---------------------------------------------------------------------------------------------------
// §180.8–§180.9 on the real reading path, and the table.
// ---------------------------------------------------------------------------------------------------

test('§180.8–§180.9: a build with the package on asks for habits and weaknesses and records both in its provenance', async t => {
  const game = await kernel(t);
  const {packet, meta} = await buildBook(game);
  assert.deepEqual(packet.vocabulary.creature_dossier.contributed.map(entry => entry.key), ['habits'], 'the reader is asked the creature word');
  assert.ok(packet.vocabulary.actor_weaknesses, 'the reader is asked the weakness shape, and the checker holds it');
  assert.deepEqual(meta.vocabulary.creature_profile_keys.map(entry => [entry.key, entry.mod]), [['habits', PACKAGE]]);
  assert.deepEqual(meta.vocabulary.actor_weaknesses, {source: 'module-source', version: 1});
});

test('§180.4/§180.9: the rows carry the words and the chain, budgeted; the single reads carry all of it', async t => {
  const game = await kernel(t);
  const {mid} = await buildBook(game);
  const table = await played(game, mid);
  const {capsule} = table.opened;
  const warden = table.row(capsule, WARDEN), rats = table.row(capsule, RATS);
  assert.deepEqual(capsule.present.map(entry => [entry.name, entry.kind]), [[WARDEN, undefined], [RATS, 'creature']]);
  assert.deepEqual(warden.weaknesses, [
    {book: W_KEY, needs: [{name: 'Iron key', kind: 'artifact'}, {name: 'Ward of Iron', kind: 'spell', taught_by: ['Iron Psalter']}, {name: 'Cellar', kind: 'scene'}],
      learned_by: {conclusion: 'iron-key-binds-warden', found: 0, of: 3}},
    {book: [...W_SALT].slice(0, 160).join('')},
    {book: W_SUN}], 'at most three entries, each book cut to 160 characters');
  assert.deepEqual(warden.false_leads, [{clue: 'silver-lore', discovered: false}]);
  assert.equal(warden.wants, 'Keep the cellar shut.', 'the person dossier is unchanged');
  assert.deepEqual(rats, {name: RATS, kind: 'creature', what: 'A swarm of rats behind the cellar boards.', habits: HABITS, keeper_note: RAT_NOTE});
  assert.deepEqual(Object.keys(rats), ['name', 'kind', 'what', 'habits', 'keeper_note'], 'habits sits between the body and the note');

  // The single-person read carries every entry, uncut, and no raw node id.
  const person = await table.call('table.look', {focus: 'npc', name: WARDEN});
  assert.deepEqual(person.weaknesses.map(entry => entry.book), [W_KEY, W_SALT, W_SUN, W_BELL]);
  assert.equal(person.properties?.weaknesses, undefined, 'the chain names the means; the raw ids stay off the card');
  // The creature read (§180.4, CK-A's open point): a body's card, with its words and chain.
  const card = await table.call('table.look', {focus: 'npc', name: RATS});
  assert.equal(card.kind, 'creature');
  assert.equal(card.habits, HABITS);
  assert.equal(card.keeper_note, RAT_NOTE);
  assert.ok(card.combat_tactic, 'a stat-block creature carries how it defends');
  for (const field of ['called', 'untold', 'personality', 'knows', 'ties', 'relationships']) assert.ok(!(field in card), field);
  const moths = await table.call('table.look', {focus: 'npc', name: MOTHS});
  assert.equal(moths.kind, 'creature', 'a creature without a stat block is read too');
  await rejects(table.call('table.look', {focus: 'npc', name: 'Nobody at all'}), error => assert.equal(error.code, 'unknown_entity'));
});

test('§180.9: the chain moves as a supporting clue and the false lead are found and the key changes hands', async t => {
  const game = await kernel(t);
  const {mid} = await buildBook(game);
  const table = await played(game, mid);
  await table.call('table.apply', {call_id: table.id(), effects: [{kind: 'clue', clue: 'forge-ledger', how: 'read the ledger'},
    {kind: 'clue', clue: 'silver-lore', how: 'heard the folk tale'}]});
  let capsule = await table.next('I read the ledger again.');
  let warden = table.row(capsule, WARDEN);
  assert.deepEqual(warden.weaknesses[0].learned_by, {conclusion: 'iron-key-binds-warden', found: 1, of: 3});
  assert.deepEqual(warden.false_leads, [{clue: 'silver-lore', discovered: true}]);
  assert.equal(warden.weaknesses[0].needs[0].held_by, undefined, 'nobody holds the key yet');
  // The investigator is the pregen the library carried over, under the sheet's own name.
  const investigator = table.opened.capsule.known.investigator.name;
  await table.call('table.apply', {call_id: table.id(), effects: [{kind: 'item', name: 'Iron key', to: investigator, why: 'found it in the hall'}]});
  capsule = await table.next('I turn the key over.');
  warden = table.row(capsule, WARDEN);
  assert.deepEqual(warden.weaknesses[0].needs[0], {name: 'Iron key', kind: 'artifact', held_by: investigator});
});

test('§180.10: the gates -- creature_present and weakness_here hold, the people gates count the person only', async t => {
  const game = await kernel(t);
  const {mid} = await buildBook(game);
  const previous = process.env.COC_INSTRUCTION_BUDGET;
  process.env.COC_INSTRUCTION_BUDGET = '1';
  t.after(() => { if (previous === undefined) delete process.env.COC_INSTRUCTION_BUDGET; else process.env.COC_INSTRUCTION_BUDGET = previous; });
  const table = await played(game, mid);
  const rows = capsule => new Map(capsule.mods.instructions.map(row => [row.mod, row]));
  const section = (capsule, mod, heading) => rows(capsule).get(mod).sections.find(entry => entry.heading === heading);
  let capsule = table.opened.capsule;
  assert.equal(rows(capsule).get(PACKAGE).form, 'indexed');
  assert.equal(section(capsule, PACKAGE, 'Playing a creature').due, true);
  assert.equal(section(capsule, PACKAGE, 'Weaknesses').due, true);
  assert.equal(section(capsule, 'natural-npc', 'First impression').gates_open, true, 'the warden has no history');
  // The warden leaves: the rats alone are no person and have no history to lack, and carry no chain.
  await table.call('table.apply', {call_id: table.id(), effects: [{kind: 'npc', name: WARDEN, to: 'Cellar', why: 'he goes down'}]});
  capsule = await table.next('I watch the rats.');
  assert.deepEqual(capsule.present.map(entry => entry.name), [RATS]);
  assert.equal(section(capsule, 'natural-npc', 'First impression').gates_open, false, 'present_without_history counts persons only');
  assert.equal(section(capsule, PACKAGE, 'Playing a creature').due, true);
  assert.equal(section(capsule, PACKAGE, 'Weaknesses').due, false, 'no present row carries weaknesses or false_leads');
});

test('§180.10: kernelGates over assembled rows: person rows carry no kind, creature rows say so, a chain opens weakness_here', () => {
  const facts = present => ({opening: false, present, handed: 0, undiscovered: 0, stalled_turns: 0, stall_threshold: 3, beat: 'BUILD', repeat_input: false, threat_clocks: 0});
  const gates = present => api.kernelGates(facts(present), {}, {});
  assert.ok(api.KERNEL_GATES.includes('creature_present') && api.KERNEL_GATES.includes('weakness_here'));
  const creature = gates([{name: RATS, kind: 'creature'}]);
  assert.equal(creature.people_present, false);
  assert.equal(creature.present_without_history, false);
  assert.equal(creature.creature_present, true);
  assert.equal(creature.weakness_here, false);
  const person = gates([{name: WARDEN, history: {last_spoke_turn: 2}}]);
  assert.equal(person.people_present, true);
  assert.equal(person.present_without_history, false);
  assert.equal(person.creature_present, false);
  assert.equal(gates([{name: WARDEN}]).present_without_history, true);
  assert.equal(gates([{name: WARDEN, false_leads: [{clue: 'x', discovered: false}]}]).weakness_here, true);
  assert.equal(gates([{name: RATS, kind: 'creature', weaknesses: [{book: 'Fire.'}]}]).weakness_here, true);
});

// ---------------------------------------------------------------------------------------------------
// The table door (§180.8, §180.9).
// ---------------------------------------------------------------------------------------------------

test('§180.8–§180.9: the table door takes a creature word on a creature and weakness entries on either; the book stands', async t => {
  const game = await kernel(t);
  const {mid} = await buildBook(game);
  const table = await played(game, mid);
  const dossier = (name, values) => table.call('table.apply', {call_id: table.id(), effects: [{kind: 'dossier', name, values, why: 'seen in play'}]});
  await dossier(MOTHS, {habits: 'They circle the lamp and scatter at a draught.'});
  await rejects(dossier(RATS, {habits: 'They sleep.'}), error => { assert.equal(error.code, 'invalid_params'); assert.match(error.message, /source already gives/); });
  await rejects(dossier(WARDEN, {habits: 'He paces.'}), error => { assert.equal(error.code, 'invalid_params'); assert.match(error.message, /creature's word/); });
  await rejects(dossier(RATS, {language: 'Squeaks.'}), error => { assert.equal(error.code, 'invalid_params'); assert.match(error.message, /person's word/); });
  await rejects(dossier(RATS, {weaknesses: [{book: 'Fire.', learned_by: 'iron-key-binds-warden'}]}), error => {
    assert.equal(error.code, 'invalid_params'); assert.equal(error.details.field, 'dossier.values.weaknesses[0].learned_by'); });
  await rejects(dossier(RATS, {weaknesses: [{book: 'Fire.', needs: ['a flamethrower']}]}), error => assert.equal(error.code, 'unknown_entity'));
  assert.equal((await dossier(RATS, {weaknesses: [{book: 'A lantern thrust at them drives the swarm back.', needs: ['Iron key']}]})).receipts.length, 1);
  await dossier(WARDEN, {weaknesses: [{book: 'Iron filings in his path slow him.'}]});
  await dossier(WARDEN, {weaknesses: [{book: 'Cold iron chains hold him while they stay shut.'}]});
  const capsule = await table.next('I raise the lantern.');
  assert.deepEqual(table.row(capsule, RATS).weaknesses, [{book: 'A lantern thrust at them drives the swarm back.', needs: [{name: 'Iron key', kind: 'artifact'}]}]);
  const warden = await table.call('table.look', {focus: 'npc', name: WARDEN});
  assert.deepEqual(warden.weaknesses.map(entry => entry.book), [W_KEY, W_SALT, W_SUN, W_BELL, 'Iron filings in his path slow him.',
    'Cold iron chains hold him while they stay shut.'], 'appended after the book\'s, a later write after an earlier one');
  assert.equal((await table.call('table.look', {focus: 'npc', name: MOTHS})).habits, 'They circle the lamp and scatter at a draught.');
  // The act author reads a creature's habits (§180.5).
  assert.equal((await table.call('npc.situation', {name: RATS})).who.habits, HABITS);

  // Disabled: what the table established goes with the package; what the build bound stays (§28.5, §28.7).
  await table.call('table.narrate', {call_id: table.id(), text: 'The lantern gutters.'});
  await table.call('mods.configure', {id: PACKAGE, enabled: false});
  const off = (await table.call('table.player_input', {text: 'I look again.'})).capsule;
  assert.deepEqual(table.row(off, RATS).weaknesses, undefined);
  assert.equal(table.row(off, RATS).habits, HABITS, 'the bound word outlives the package');
  assert.deepEqual(table.row(off, WARDEN).weaknesses.map(entry => entry.book.slice(0, 20)), [W_KEY, W_SALT, W_SUN].map(book => book.slice(0, 20)));
  assert.equal((await table.call('table.look', {focus: 'npc', name: MOTHS})).habits, undefined);
  const words = (await table.call('mods.context')).vocabulary.words.find(entry => entry.key === 'habits');
  assert.deepEqual(words, {key: 'habits', label: 'habits', mod: null, bound: true});
});

test('§180.20: a PDF built with the consumer off checks, persists and projects source weaknesses', async t => {
  const game = await kernel(t);
  await game.call('mods.defaults', {id: PACKAGE, enabled: false});
  const {mid, packet, meta} = await buildBook(game);
  assert.ok(packet.vocabulary.actor_weaknesses);
  assert.equal(packet.vocabulary.creature_dossier.contributed, undefined);
  assert.deepEqual(meta.vocabulary.actor_weaknesses, {source: 'module-source', version: 1});
  assert.equal(meta.vocabulary?.creature_profile_keys, undefined);
  const persisted = JSON.parse(await readFile(join(game.workspace, '.coc', 'modules', mid, meta.graph_file), 'utf8'));
  assert.deepEqual(persisted.nodes.find(node => node.node_id === 'npc-old-warden').properties.weaknesses,
    opening().nodes.find(node => node.node_id === 'npc-old-warden').properties.weaknesses);
  const table = await played(game, mid);
  const {capsule} = table.opened;
  assert.deepEqual(table.row(capsule, WARDEN).weaknesses.map(entry => entry.book), [W_KEY, W_SALT, W_SUN].map(book => book.slice(0, 160)));
  assert.equal((await table.call('table.look', {focus: 'npc', name: WARDEN})).weaknesses.length, 4);
  assert.equal(table.row(capsule, RATS).habits, undefined);
  // The false lead is a relation the base reads whatever was bound.
  assert.deepEqual(table.row(capsule, WARDEN).false_leads, [{clue: 'silver-lore', discovered: false}]);
  await table.call('mods.configure', {id: PACKAGE, version: '1.0.0', enabled: true});
  await table.next('I inspect the same source facts with the consumer enabled.');
  const words = (await table.call('mods.context')).vocabulary.words.find(entry => entry.key === 'habits');
  assert.deepEqual(words, {key: 'habits', label: 'habits', mod: PACKAGE, bound: false}, 'on, and unbound: the package can tell');
});

// ---------------------------------------------------------------------------------------------------
// Readings the fixture table cannot reach on its own: an instance's holder and a spell an investigator knows.
// ---------------------------------------------------------------------------------------------------

test('§180.9: held_by follows the instance\'s root owner; known_by reads the investigator\'s magic state', () => {
  const draft = opening();
  const graph = new api.ModuleGraph('book', {nodes: draft.nodes, relations: draft.claims.map((entry, index) => ({relation_id: `r${index}`,
    relation_kind: entry.predicate, from_node_id: entry.subject_id, to_node_id: entry.object.node_id}))}, '', api.dossierWith({}, {actor_weaknesses: {mod: PACKAGE}}));
  const warden = graph.nodes.get('npc-old-warden');
  const world = {discovered_clues: ['warden-diary'], clock: {minutes: 60}, objects: {definitions: {d1: {name: 'Iron key'}}, instances: {
    'object-satchel-1': {id: 'object-satchel-1', name: 'Satchel', owner: {kind: 'npc', id: 'old-warden', name: WARDEN}, changed_turn: 1},
    'object-iron-key-2': {id: 'object-iron-key-2', name: 'old key', definition: 'd1', owner: {kind: 'object', id: 'object-satchel-1', name: 'Satchel'}, changed_turn: 2}}}};
  const reads = {party: [{id: 'inv-1', name: HAYES}, {id: 'inv-2', name: 'Lydia Lau'}], magic: id => id === 'inv-2' ? {learned_spells: ['Ward of Iron']} : null};
  const [first] = api.weaknessChain(graph, world, warden, reads).weaknesses;
  assert.deepEqual(first.needs, [{name: 'Iron key', kind: 'artifact', held_by: WARDEN},
    {name: 'Ward of Iron', kind: 'spell', known_by: ['Lydia Lau'], taught_by: ['Iron Psalter']}, {name: 'Cellar', kind: 'scene'}]);
  assert.deepEqual(first.learned_by, {conclusion: 'iron-key-binds-warden', found: 1, of: 3});
  // Not bound, nothing authored is read.
  const unbound = new api.ModuleGraph('book', {nodes: draft.nodes, relations: []}, '', {});
  assert.deepEqual(api.weaknessChain(unbound, world, unbound.nodes.get('npc-old-warden'), reads), {});
});

// ---------------------------------------------------------------------------------------------------
// §180.3: the open points CK-A left -- unnamed perspectives and the speech roster are persons only.
// ---------------------------------------------------------------------------------------------------

test('§180.3: npc.perspectives without a name lists the persons present, never the creature', async t => {
  const game = await kernel(t);
  const {mid} = await buildBook(game);
  const table = await played(game, mid);
  const views = (await table.call('npc.perspectives')).views.map(view => view.name);
  assert.deepEqual(views, [WARDEN]);
});

test('§180.3: speech attribution\'s roster is the people present; a creature row, whole or a stub, is left out', () => {
  const roster = speechRoster([{name: WARDEN, untold: {label: 'the old man'}}, {name: RATS, kind: 'creature', habits: HABITS},
    {name: MOTHS, kind: 'creature', truncated: true}, {name: 'Lena', called: {name: 'Lena', address: 'Miss Lena'}}]);
  assert.deepEqual(roster, [{name: WARDEN, untold: true, label: 'the old man'}, {name: 'Lena', untold: false, called: 'Lena', address: 'Miss Lena'}]);
});
