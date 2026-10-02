/**
 * Contract §168.5 (docs/specs/first-sight.md 2.4), the kernel side: the capsule's `first_sight` section, the
 * `first-sight.json` ledger and `table.first_sight`, over the real TS kernel in process.
 *
 * Blood Road (game-717a9e4b, 2026-10-02): the opening and the next two turns described neither the station nor the
 * three men under its awning although the book describes all four. The fixture is the voice-bench teahouse with a
 * book description for the room and two people the book lets the player see.
 */
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {after, before, test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const CONTENT = join(ROOT, 'content');
const ROOM = '门口挂着褪色的蓝布帘，屋里八仙桌挤得满满当当，炉上铜壶咕嘟作响，烟味和茶香混在一起。墙上贴着“莫谈国事”的红纸。';
const WANG = '三十五岁的壮汉，肩膀宽厚，赤着膊，腰里别着扛包的麻绳，嗓门大得盖过雨声。';
let api, bundle, content;
before(async () => {
  await mkdir(join(ROOT, '.tmp'), {recursive: true});
  bundle = await mkdtemp(join(ROOT, '.tmp/first-sight-kernel-test-'));
  await build({stdin: {contents: [
    "export * from './kernel-ts/testing/api.ts';",
    "export * from './kernel-ts/first-sight/index.ts';",
    "export {HEAD_FIRST_SIGHT} from './kernel-ts/read/assemble.ts';",
  ].join('\n'), resolveDir: ROOT, sourcefile: 'first-sight-kernel-entry.ts'}, outfile: join(bundle, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
  api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);
  // A content root whose starters are the shipped ones plus `first-sight-bench`.
  content = await mkdtemp(join(tmpdir(), 'first-sight-content-'));
  for (const entry of await readdir(CONTENT)) if (entry !== 'starters') await symlink(join(CONTENT, entry), join(content, entry));
  await mkdir(join(content, 'starters'));
  for (const entry of await readdir(join(CONTENT, 'starters'))) await symlink(join(CONTENT, 'starters', entry), join(content, 'starters', entry));
  const folder = join(content, 'starters/first-sight-bench');
  await mkdir(folder);
  await cp(join(CONTENT, 'starters/voice-bench/pregens'), join(folder, 'pregens'), {recursive: true});
  const graph = JSON.parse(await readFile(join(CONTENT, 'starters/voice-bench/module-graph.json'), 'utf8'));
  graph.module_id = 'module-first-sight-bench';
  const node = id => graph.nodes.find(entry => entry.node_id === id);
  node('scene-sanyi-teahouse').properties.description = ROOM;
  Object.assign(node('npc-wang-tiezhu'), {visibility: 'player-safe'});
  node('npc-wang-tiezhu').properties = {...node('npc-wang-tiezhu').properties, biography: WANG};
  // Seen, with no biography: the summary is the book's words for them.
  Object.assign(node('npc-zhou-jingzhi'), {visibility: 'player-safe'});
  // Seen, but the book says nothing beyond the name: there is nothing to show.
  Object.assign(node('npc-liu-guizhi'), {visibility: 'player-safe', summary: node('npc-liu-guizhi').name});
  await writeFile(join(folder, 'module-graph.json'), JSON.stringify(graph, null, 2));
});
after(async () => {
  if (bundle) await rm(bundle, {recursive: true, force: true});
  if (content) await rm(content, {recursive: true, force: true});
});

async function table(t) {
  const home = await mkdtemp(join(tmpdir(), 'first-sight-kernel-'));
  const context = await api.createKernelContext({workspace: home, content, seed: 'first-sight', locks: api.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context);
  t.after(async () => { await runtime.close(); await context.git.close?.(); await rm(home, {recursive: true, force: true}); });
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'first-sight-bench', pregen: 'shen-zhiwei', play_language: 'zh-Hans'});
  await call('table.open');
  const directory = join(home, '.coc/campaigns/c1');
  const read = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
  let ordinal = 0;
  return {call, directory, read, next: turn => `t${turn}-c${++ordinal}`,
    record: turn => read(join('turns', `${String(turn).padStart(4, '0')}.json`)),
    telemetry: async () => (await readFile(join(directory, 'telemetry.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))};
}
const ids = section => [...(section?.place ? [`place:${section.place.id}`] : []), ...(section?.people ?? []).map(person => `person:${person.id}`)];

test('the opening capsule carries the place and the people the book lets the player see, before present', async t => {
  const game = await table(t);
  const capsule = await game.call('table.capsule');
  assert.deepEqual(capsule.first_sight.place, {id: 'sanyi-teahouse', name: '三义茶馆', described: ROOM});
  assert.deepEqual(capsule.first_sight.people.map(person => person.name), ['王铁柱', '周敬之'],
    'keeper-only people and a person the book describes by name alone are not owed');
  assert.equal(capsule.first_sight.people[0].described, WANG, 'a person is described by their biography');
  assert.match(capsule.first_sight.people[1].described, /前清秀才/, 'and by the summary when there is none');
  const keys = Object.keys(capsule);
  assert.ok(keys.indexOf('first_sight') < keys.indexOf('present'), 'placed before present');
  assert.ok(capsule.head.includes(api.HEAD_FIRST_SIGHT), 'the head says what the section is, only when it is there');
  assert.equal(capsule.truncated?.includes('first_sight') ?? false, false);
});

test('a check lands: shown leaves for good, what the prose left out stays as missing, and a check that could not quote changes nothing', async t => {
  const game = await table(t);
  const delivered = await game.call('table.narrate', {call_id: game.next(0), text: '雨夜，你推开茶馆的门。'});
  assert.equal(delivered.turn, 0);
  const result = await game.call('table.first_sight', {turn: 0, items: [
    {id: 'sanyi-teahouse', kind: 'place', missing: []},
    // The model retyped the corner-free ASCII quotes; §139 locates the book's own span.
    {id: 'wang-tiezhu', kind: 'person', missing: ['赤着膊', '墙上贴着"莫谈国事"的红纸', '腰里别着扛包的麻绳']},
    // Every excerpt is unanchored: the item stays owed exactly as before, never shown.
    {id: 'zhou-jingzhi', kind: 'person', missing: ['他戴着一顶瓜皮帽']},
  ]});
  assert.deepEqual(result.shown, [{kind: 'place', id: 'sanyi-teahouse'}]);
  assert.deepEqual(result.open, [{kind: 'person', id: 'wang-tiezhu', missing: ['赤着膊', '腰里别着扛包的麻绳']}],
    'an excerpt of another item\'s words is not this item\'s');
  assert.deepEqual(result.dropped, [{index: 1, kind: 'person', id: 'wang-tiezhu', reason: 'excerpt_not_in_book', excerpts: 1},
    {index: 2, kind: 'person', id: 'zhou-jingzhi', reason: 'missing_not_in_book'}]);
  const ledger = await game.read('first-sight.json');
  assert.deepEqual(ledger.shown, {places: ['sanyi-teahouse'], people: []});
  assert.deepEqual(ledger.open.map(row => [row.kind, row.id, row.missing, row.turn]), [['person', 'wang-tiezhu', ['赤着膊', '腰里别着扛包的麻绳'], 0]]);
  assert.deepEqual((await game.record(0)).first_sight.map(row => [row.kind, row.id, row.missing]),
    [['place', 'sanyi-teahouse', []], ['person', 'wang-tiezhu', ['赤着膊', '腰里别着扛包的麻绳']]]);
  const row = (await game.telemetry()).findLast(entry => entry.lane === 'first-sight');
  assert.deepEqual([row.event, row.turn, row.shown, row.open, row.dropped.length], ['recorded', 0, 1, 1, 2]);

  const next = (await game.call('table.player_input', {text: '我找个空位坐下。'})).capsule;
  assert.equal(next.first_sight.place, undefined, 'the shown place is no longer owed');
  assert.deepEqual(next.first_sight.people, [
    {id: 'wang-tiezhu', name: '王铁柱', missing: ['赤着膊', '腰里别着扛包的麻绳']},
    {id: 'zhou-jingzhi', name: '周敬之', described: next.first_sight.people[1].described}]);
  assert.match(next.first_sight.people[1].described, /前清秀才/, 'a check that could not quote leaves the item owed in full');

  // A later check shows the rest; with nothing owed the section and its head sentence are gone.
  await game.call('table.narrate', {call_id: game.next(1), text: '王铁柱赤着膊，腰里别着麻绳。周敬之摇着扇子。'});
  await game.call('table.first_sight', {turn: 1, items: [{id: 'wang-tiezhu', kind: 'person', missing: []}, {id: '周敬之', kind: 'person', missing: []}]});
  const settled = await game.call('table.capsule');
  assert.equal(settled.first_sight, undefined);
  assert.ok(!settled.head.includes(api.HEAD_FIRST_SIGHT));
  assert.deepEqual((await game.read('first-sight.json')).shown.people, ['wang-tiezhu', 'zhou-jingzhi'], 'a name resolves to the handle');
});

test('table.first_sight refuses what is not a checked item of this graph, and a turn that delivered nothing', async t => {
  const game = await table(t);
  const refused = async (params, pattern) => {
    await assert.rejects(game.call('table.first_sight', params), error => error.code === 'invalid_params' && pattern.test(error.message));
  };
  await refused({turn: 0, items: [{id: 'sanyi-teahouse', kind: 'place', missing: []}]}, /no delivery record/);
  await game.call('table.narrate', {call_id: game.next(0), text: '雨夜。'});
  await refused({turn: 0, items: []}, /list of 1 to/);
  await refused({turn: 0, items: [{id: 'sanyi-teahouse', kind: 'room', missing: []}]}, /not place or person/);
  await refused({turn: 0, items: [{id: 'nowhere', kind: 'place', missing: []}]}, /no scene of this campaign/);
  await refused({turn: 0, items: [{id: 'sanyi-teahouse', kind: 'person', missing: []}]}, /no person of this campaign/);
  await refused({turn: 0, items: [{id: 'sanyi-teahouse', kind: 'place', missing: [3]}]}, /excerpts of the book/);
  await refused({turn: 0, items: [{id: 'sanyi-teahouse', kind: 'place'}]}, /excerpts of the book/);
  await refused({turn: -1, items: [{id: 'sanyi-teahouse', kind: 'place', missing: []}]}, /committed turn/);
  assert.deepEqual((await game.call('table.capsule')).first_sight.place, {id: 'sanyi-teahouse', name: '三义茶馆', described: ROOM},
    'nothing refused was recorded');
  // §139: an excerpt whose quotation marks the model retyped is the book's own span.
  const located = await game.call('table.first_sight', {turn: 0, items: [{id: 'sanyi-teahouse', kind: 'place', missing: ['墙上贴着"莫谈国事"的红纸']}]});
  assert.deepEqual(located.open, [{kind: 'place', id: 'sanyi-teahouse', missing: ['墙上贴着“莫谈国事”的红纸']}]);
});

test('an older check never replaces a newer open row, and shown is for good', () => {
  const at = '2026-10-02T00:00:00Z';
  let ledger = api.applyFirstSight(api.firstSightLedger({}), 4, [{kind: 'person', id: 'a', missing: ['x']}], at);
  ledger = api.applyFirstSight(ledger, 3, [{kind: 'person', id: 'a', missing: ['y']}], at);
  assert.deepEqual(ledger.open.map(row => [row.missing, row.turn]), [[['x'], 4]]);
  ledger = api.applyFirstSight(ledger, 3, [{kind: 'person', id: 'a', missing: []}], at);
  assert.deepEqual([ledger.shown.people, ledger.open], [['a'], []]);
  ledger = api.applyFirstSight(ledger, 5, [{kind: 'person', id: 'a', missing: ['z']}], at);
  assert.deepEqual(ledger.open, [], 'a shown person is not owed again');
});

test('the section fits its own budget without losing anyone', () => {
  const long = '旧'.repeat(900);
  const section = {place: {id: 'p', name: 'P', described: long}, people: Array.from({length: 6}, (_, index) => ({id: `n${index}`, name: `N${index}`, described: long}))};
  assert.equal(api.fitFirstSight(section, api.FIRST_SIGHT_BUDGET), true);
  assert.ok(Buffer.byteLength(JSON.stringify(section)) <= api.FIRST_SIGHT_BUDGET);
  assert.deepEqual(section.people.map(person => person.id), ['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  assert.ok(section.people.every(person => person.truncated === true && person.described.length >= 40));
  const small = {place: {id: 'p', name: 'P', described: '短'}};
  assert.equal(api.fitFirstSight(small, api.FIRST_SIGHT_BUDGET), false);
  assert.equal(small.place.truncated, undefined);
});

test('an if fork at an earlier commit carries that turn\'s own first-sight results with the line', async t => {
  const game = await table(t);
  await game.call('table.narrate', {call_id: game.next(0), text: '雨夜。'});
  await game.call('table.player_input', {text: '我进门。'});
  const {turn} = await game.call('table.narrate', {call_id: game.next(1), text: '茶馆里人声鼎沸。'});
  const commit = (await game.record(turn)).commit;
  assert.equal(typeof commit, 'string');
  await game.call('table.first_sight', {turn, items: [{id: 'sanyi-teahouse', kind: 'place', missing: []},
    {id: 'wang-tiezhu', kind: 'person', missing: ['赤着膊']}]});
  await game.call('table.branch', {commit, name: 'side'});
  const carried = await game.read('first-sight.json');
  assert.deepEqual(carried.shown.places, ['sanyi-teahouse'], 'the fork turn showed this line the same room');
  assert.deepEqual(carried.open.map(row => [row.id, row.missing]), [['wang-tiezhu', ['赤着膊']]]);
});

test('an apply fork from an earlier turn carries that turn\'s own first-sight results too', async t => {
  const game = await table(t);
  await game.call('table.narrate', {call_id: game.next(0), text: '雨夜。'});
  await game.call('table.player_input', {text: '我进门。'});
  const {turn} = await game.call('table.narrate', {call_id: game.next(1), text: '茶馆里人声鼎沸。'});
  await game.call('table.player_input', {text: '我再想想。'});
  // The check of turn 1 landed after turn 1's commit; the fork checks out that commit.
  await game.call('table.first_sight', {turn, items: [{id: 'wang-tiezhu', kind: 'person', missing: []}]});
  await game.call('table.apply', {call_id: game.next(2), effects: [{kind: 'fork', name: 'side', mode: 'if', from_turn: turn}]});
  await game.call('table.narrate', {call_id: game.next(2), text: '如果当时……'});
  assert.equal((await game.read('campaign.json')).active_worldline, 'side');
  assert.deepEqual((await game.read('first-sight.json')).shown.people, ['wang-tiezhu']);
});
