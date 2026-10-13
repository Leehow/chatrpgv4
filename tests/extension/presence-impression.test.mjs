/**
 * Contract §224.3 (user ruling 2026-10-10, re-rules §178 per the Keeper Rulebook: Credit Rating gauges first impressions,
 * p.60; roll only when there is tension and something at stake, pp.82-83): a Mod check declared `trigger: "presence"`
 * (natural-npc's first impression) is no longer rolled by the kernel when people meet. While a person shares a scene with an
 * investigator the pair is offered in `mods.pending_contacts`; the Keeper invokes it only when it matters (§237.1), through
 * `resolve`, and the receipt keeps §178's shape (`trigger`, `public_target_label`) so the card still names whom it is about.
 *
 * The Haunting stands in: Knott seats the start scene, the newspaper morgue seats Ruth Blake and Arty Wilmot, the fixture's
 * start scene also seats a creature.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'presence-impression-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts'; export {manifestFrom} from './kernel-ts/read/mods.ts'; export {mechanicsOf} from './kernel-ts/read/mechanics.ts'; export {report as confluenceReport} from './kernel-ts/worldline/confluence-plan.ts';",
  resolveDir: root, sourcefile: 'presence-api.ts'},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/**
 * A content root whose built-in Mods (`<content>/../mods`) are the repository's, optionally with one more package, and
 * whose starters are the repository's plus `presence-fixture`: the Haunting with a creature that states a stat block (an
 * actor, §136.12) seated at the start scene beside Knott.
 */
async function contentRoot(name, extra) {
  const base = join(temporary, name), content = join(base, 'content');
  await mkdir(join(content, 'starters'), {recursive: true});
  for (const entry of await readdir(join(root, 'content'))) if (entry !== 'starters') await symlink(join(root, 'content', entry), join(content, entry));
  for (const entry of await readdir(join(root, 'content/starters'))) await symlink(join(root, 'content/starters', entry), join(content, 'starters', entry));
  await cp(join(root, 'content/starters/the-haunting'), join(content, 'starters/presence-fixture'), {recursive: true});
  const graphPath = join(content, 'starters/presence-fixture/module-graph.json'), graph = JSON.parse(await readFile(graphPath, 'utf8'));
  graph.module_id = 'presence-fixture';
  // A creature no person shadows (the Haunting's rat pack is also an `npc` node, so its handle finds the person first).
  const knott = graph.nodes.find(node => node.node_id === 'npc-steven-knott');
  graph.nodes.push({node_id: 'creature-cellar-hound', node_kind: 'creature', name: 'Cellar Hound', visibility: 'keeper-only', aliases: [],
    summary: 'A hound kept in the cellar.', evidence_span_ids: knott.evidence_span_ids, source_refs: knott.source_refs,
    properties: {mechanics: {profile: {characteristics: {STR: 55, CON: 50}, derived: {HP: 10}}}}});
  graph.relations.push({relation_id: 'rel-hound-present-in-briefing', relation_kind: 'present-in', from_node_id: 'creature-cellar-hound',
    to_node_id: 'scene-commission-briefing', claim_id: null, properties: {}});
  await writeFile(graphPath, JSON.stringify(graph));
  await cp(join(root, 'mods'), join(base, 'mods'), {recursive: true});
  if (extra) await extra(join(base, 'mods'));
  return content;
}
const plain = await contentRoot('plain');
// natural-npc's check as 1.4.4 declared it: `contact`, which waits for the Keeper or the clerk to resolve it.
const withContact = await contentRoot('contact', async mods => {
  await cp(join(mods, 'natural-npc'), join(mods, 'contact-npc'), {recursive: true});
  const path = join(mods, 'contact-npc/mod.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.id = 'contact-npc'; manifest.version = '1.0.0';
  manifest.requires = manifest.requires.filter(value => value !== 'checks.presence.v1');
  manifest.contributes.checks = manifest.contributes.checks.map(check => ({...check, name: 'contact-npc:first-impression', trigger: 'contact', legacy: undefined}));
  await writeFile(path, JSON.stringify(manifest, null, 2));
});

async function table(t, content = plain, module = 'the-haunting') {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content, seed: 'presence', locks: api.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module, pregen: 'thomas-hayes', play_language: 'en'});
  const file = name => join(home, '.coc/campaigns/c1', name);
  const read = async name => JSON.parse(await readFile(file(name), 'utf8'));
  const write = async (name, value) => writeFile(file(name), JSON.stringify(value));
  return {call, read, write};
}
const impressions = receipts => receipts.filter(receipt => receipt.kind === 'roll' && receipt.decision === 'natural-npc:first-impression');

const offered = capsule => capsule.mods.pending_contacts.filter(row => row.rule.trigger === 'presence').map(row => row.handle).sort();

test('§224.3: the opening rolls nothing; the start scene\'s person is offered as a presence pair', async t => {
  const {call, read} = await table(t);
  await call('table.open');
  assert.deepEqual(impressions((await read('turn.json')).receipts), []);
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  const input = await call('table.player_input', {text: 'I go on.'});
  assert.deepEqual(impressions((await read('turn.json')).receipts), [], 'a turn start rolls nothing either');
  assert.deepEqual(offered(input.capsule), ['steven-knott']);
  assert.match(input.capsule.mods.pending_contacts[0].when, /matters this turn/);
  assert.deepEqual(input.capsule.mods.relationships, []);
});

test('§224.3: a move or a walk-on rolls nothing; the people met are offered instead', async t => {
  const {call} = await table(t);
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  await call('table.player_input', {text: 'I go to the newspaper morgue.'});
  const moved = await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue'}]});
  const staged = await call('table.apply', {call_id: 't1-c2', effects: [{kind: 'npc', name: 'a dock worker', to: 'here', why: 'he walks in from the street', walk_on: true}]});
  for (const result of [moved, staged]) assert.equal(result.first_impressions, undefined);
  assert.deepEqual(impressions((await call('table.status')).receipts), []);
  await call('table.narrate', {call_id: 't1-c3', text: 'The morgue.'});
  const input = await call('table.player_input', {text: 'I look around.'});
  for (const handle of ['ruth-blake', 'a dock worker']) assert.ok(offered(input.capsule).includes(handle), `${handle} is offered`);
});

test('§237.1: an offered pair the Keeper resolves keeps §178\'s receipt shape and the card names the person in the table\'s word', async t => {
  const {call, read, write} = await table(t);
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  await call('table.player_input', {text: 'I go to the newspaper morgue.'});
  const world = await read('world.json');
  world.person_epithets = {...world.person_epithets, 'ruth-blake': {word: 'the archivist', by: 'graph'}};
  await write('world.json', world);
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue'}]});
  await call('table.narrate', {call_id: 't1-c2', text: 'The morgue.'});
  await call('table.player_input', {text: 'I ask the archivist for the 1918 clippings.'});
  const resolved = await call('table.resolve', {call_id: 't2-c1', action: {intent: 'social', decision: 'natural-npc:first-impression', target: 'Ruth Blake'}});
  assert.ok(resolved.outcome.impression, 'the impression is the outcome');
  const [rolled] = impressions((await call('table.status')).receipts);
  assert.deepEqual([rolled.npc, rolled.trigger, rolled.public_target_label], ['ruth-blake', 'presence', 'the archivist']);
  const narrated = await call('table.narrate', {call_id: 't2-c2', text: 'She looks up.'});
  assert.deepEqual(narrated.mechanics.filter(row => row.kind === 'roll').map(row => row.target_label), ['the archivist']);
  assert.ok(!JSON.stringify(narrated.mechanics).includes('Ruth Blake'), 'the book name of someone untold never reaches the card');
  const input = await call('table.player_input', {text: 'I thank her.'});
  assert.deepEqual(input.capsule.mods.relationships.map(row => [row.handle, row.since_turn]), [['ruth-blake', 2]]);
  assert.equal(offered(input.capsule).includes('ruth-blake'), false, 'a recorded pair is no longer offered');
});

test('a creature shares the scene and is not offered', async t => {
  const {call, read} = await table(t, plain, 'presence-fixture');
  await call('table.open');
  const world = await read('world.json');
  assert.equal(world.npc_presence['cellar-hound'], world.active_scene, 'the hound is an actor at the start scene');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  const input = await call('table.player_input', {text: 'I go on.'});
  assert.deepEqual(offered(input.capsule), ['steven-knott']);
});

test('a contact check pends beside the presence one, and neither is rolled by the kernel', async t => {
  const {call} = await table(t, withContact);
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  const input = await call('table.player_input', {text: 'I go on.'});
  assert.deepEqual(input.capsule.mods.pending_contacts.map(row => [row.decision, row.handle, row.rule.trigger]).sort(),
    [['contact-npc:first-impression', 'steven-knott', 'contact'], ['natural-npc:first-impression', 'steven-knott', 'presence']]);
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue'}]});
  assert.deepEqual((await call('table.status')).receipts.filter(receipt => receipt.kind === 'roll' && receipt.family === 'mod'), []);
});

test('a package that declares a presence check must require checks.presence.v1', async () => {
  const files = new Map([['mod.json', await readFile(join(root, 'mods/natural-npc/mod.json'))]]);
  for (const name of JSON.parse(files.get('mod.json').toString('utf8')).package_files) files.set(name, await readFile(join(root, 'mods/natural-npc', name)));
  assert.equal(api.manifestFrom(files).version, '1.6.2');
  const manifest = JSON.parse(files.get('mod.json').toString('utf8'));
  manifest.requires = manifest.requires.filter(value => value !== 'checks.presence.v1');
  files.set('mod.json', Buffer.from(JSON.stringify(manifest)));
  assert.throws(() => api.manifestFrom(files), error => error.code === 'invalid_params'
    && error.details.refusals.some(refusal => refusal.rule === 'check_trigger' && /checks\.presence\.v1/.test(refusal.message)));
});

test('the card projection names the person for a meeting roll the player may see, and nobody for a hidden one', () => {
  const receipt = {id: 'roll:mod-natural-npc-t1-c1', kind: 'roll', roll_kind: 'mod_check', family: 'mod', skill: 'Appearance', roll: 12, target: 50, threshold: 50,
    difficulty: 'regular', level: 'hard', passed: true, visibility: 'public', actor: 'thomas-hayes', actor_label: 'Thomas Hayes', actor_is_investigator: true,
    npc: 'ruth-blake', public_target_label: 'the archivist', trigger: 'presence'};
  assert.equal(api.mechanicsOf(receipt).target_label, 'the archivist');
  assert.equal(api.mechanicsOf({...receipt, visibility: 'concealed'}).target_label, undefined);
  assert.equal(api.mechanicsOf({...receipt, visibility: 'keeper'}).target_label, undefined);
});

test('a confluence joins the lines\' first impressions pair by pair, the earliest standing; anything else in the Mods\' state is still a choice', () => {
  const record = (turn, level) => ({turn, actor: 'thomas-hayes', target: 'npc-x', receipt: {id: `roll:${turn}`}, result: {outcome: {level}}});
  const state = (line, checks, extra = {}) => ({line, party: {}, candidates: [], spent: new Set(), engines: {},
    world: {active_scene: 'office', flags: {}, npc_presence: {}, clock: {minutes: 0}, mods: {active: {'natural-npc': {version: '1.5.0'}, ...extra}, state: {'natural-npc': {checks}}}}});
  // Nobody is anywhere, so the graph is asked for nothing but empty kinds.
  const graph = {kind: () => [], actor: () => null, find: () => null, handle: node => node, displayName: node => node};
  const joined = api.confluenceReport(graph, [state('main', {knott: record(3, 'hard'), shared: record(6, 'failure')}),
    state('side', {dooley: record(5, 'regular'), shared: record(4, 'extreme')})], null);
  assert.deepEqual(joined.conflicts.filter(conflict => conflict.class === 'mod_state'), [], 'meeting different people is not a choice');
  const checks = joined.world.mods.state['natural-npc'].checks;
  assert.deepEqual(Object.keys(checks).sort(), ['dooley', 'knott', 'shared']);
  assert.equal(checks.shared.result.outcome.level, 'extreme', 'a pair both lines met keeps its earliest record');
  const apart = api.confluenceReport(graph, [state('main', {knott: record(3, 'hard')}), state('side', {}, {'zh-optimize': {version: '1.1.0'}})], null);
  assert.equal(apart.conflicts.filter(conflict => conflict.class === 'mod_state').length, 1, 'a different Mod set is still the Keeper\'s choice');
});
