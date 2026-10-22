/**
 * Contract §255, the kernel side: `table.looks.job`, `table.looks`, the `looks` field of `first-sight.json` and the
 * capsule's `kept_looks` section, over the real TS kernel in process. The fixture is first sight's teahouse: a book
 * description for the room, 王铁柱 with a biography, and 刘桂芝 whom the book gives no words.
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
  bundle = await mkdtemp(join(ROOT, '.tmp/kept-looks-kernel-test-'));
  await build({stdin: {contents: [
    "export * from './kernel-ts/testing/api.ts';",
    "export * from './kernel-ts/first-sight/index.ts';",
    "export * from './kernel-ts/first-sight/looks.ts';",
    "export {HEAD_KEPT_LOOKS} from './kernel-ts/read/assemble.ts';",
  ].join('\n'), resolveDir: ROOT, sourcefile: 'kept-looks-kernel-entry.ts'}, outfile: join(bundle, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
  api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);
  // A content root whose starters are the shipped ones plus `first-sight-bench`.
  content = await mkdtemp(join(tmpdir(), 'kept-looks-content-'));
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
  const home = await mkdtemp(join(tmpdir(), 'kept-looks-kernel-'));
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

const LOOK = '柜台后坐着个五十来岁的妇人，灰白头发在脑后挽成髻，袖口磨得发亮。';
const ROOM_ADDED = '靠窗的条凳缺了一条腿，用砖头垫着。';
const PROSE = `雨夜，你推开茶馆的门。${ROOM_ADDED}${LOOK}她抬眼看了看你，又低头拨算盘。`;
const find = (targets, id) => targets.find(entry => entry.id === id);

test('the job names what the scene still wants beside the delivered text, and a submission keeps only delivered words', async t => {
  const game = await table(t);
  await game.call('table.narrate', {call_id: game.next(0), text: PROSE});
  const job = await game.call('table.looks.job', {turn: 0});
  assert.equal(job.prose, PROSE);
  assert.deepEqual(job.targets[0], {kind: 'place', id: 'sanyi-teahouse', name: '三义茶馆', want: ['look']}, 'the place first');
  assert.deepEqual(find(job.targets, 'liu-guizhi').want, ['look', 'pronoun']);
  assert.ok(job.targets.length <= api.LOOK_TARGETS_MAX);

  const result = await game.call('table.looks', {turn: 0, items: [
    {kind: 'place', id: 'sanyi-teahouse', excerpts: [ROOM_ADDED]},
    // The second excerpt is the checker's own words, never delivered: it is dropped.
    {kind: 'person', id: 'liu-guizhi', excerpts: [LOOK, '她穿着一件蓝布褂子。'], pronoun: 'she'},
    // Nothing delivered and no pronoun: nothing is recorded for him.
    {kind: 'person', id: 'wang-tiezhu', excerpts: ['他光着膀子。']},
  ]});
  assert.deepEqual(result.kept, [{kind: 'place', id: 'sanyi-teahouse', fields: ['look']}, {kind: 'person', id: 'liu-guizhi', fields: ['look', 'pronoun']}]);
  assert.deepEqual(result.dropped.map(row => [row.id, row.reason]), [['liu-guizhi', 'excerpt_not_delivered'], ['wang-tiezhu', 'excerpt_not_delivered']]);
  const ledger = await game.read('first-sight.json');
  assert.deepEqual(ledger.looks.people['liu-guizhi'].excerpts, [LOOK]);
  assert.equal(ledger.looks.people['liu-guizhi'].pronoun, 'she');
  assert.deepEqual((await game.record(0)).looks.map(row => [row.kind, row.id]), [['place', 'sanyi-teahouse'], ['person', 'liu-guizhi']]);
  const row = (await game.telemetry()).findLast(entry => entry.event === 'looks_recorded');
  assert.equal(row.kept, 2);

  const capsule = (await game.call('table.player_input', {text: '我找个空位坐下。'})).capsule;
  assert.deepEqual(capsule.kept_looks.place, {id: 'sanyi-teahouse', look: ROOM_ADDED});
  assert.deepEqual(capsule.kept_looks.people.find(person => person.id === 'liu-guizhi'), {id: 'liu-guizhi', look: LOOK, pronoun: 'she'});
  assert.ok(capsule.head.includes(api.HEAD_KEPT_LOOKS));
  const keys = Object.keys(capsule);
  assert.ok(keys.indexOf('kept_looks') < keys.indexOf('present'), 'read before the dossiers');
});

test('a field is written once, and a field asked for long enough without an answer stops being asked', async t => {
  const game = await table(t);
  await game.call('table.narrate', {call_id: game.next(0), text: PROSE});
  await game.call('table.looks', {turn: 0, items: [{kind: 'person', id: 'liu-guizhi', excerpts: [LOOK], pronoun: 'she'}]});
  const again = await game.call('table.looks', {turn: 0, items: [{kind: 'person', id: 'liu-guizhi', excerpts: [ROOM_ADDED], pronoun: 'he'}]});
  assert.deepEqual(again.kept, [], 'the first delivered look is the table\'s look');
  assert.deepEqual((await game.read('first-sight.json')).looks.people['liu-guizhi'], {excerpts: [LOOK], pronoun: 'she', turn: 0,
    at: (await game.read('first-sight.json')).looks.people['liu-guizhi'].at});
  assert.equal(find((await game.call('table.looks.job', {turn: 0})).targets, 'liu-guizhi'), undefined, 'nothing left to want');

  for (let i = 0; i < api.LOOK_TRIES_MAX; i++)
    await game.call('table.looks', {turn: 0, items: i ? [] : [{kind: 'place', id: 'sanyi-teahouse', excerpts: [ROOM_ADDED]}]});
  const job = await game.call('table.looks.job', {turn: 0});
  assert.equal(find(job.targets, 'wang-tiezhu'), undefined, 'four checks without a look or pronoun for him: he is no longer asked');
});

test('shapes are refused: an unknown person, a pronoun outside the list, a pronoun for a place', async t => {
  const game = await table(t);
  await game.call('table.narrate', {call_id: game.next(0), text: PROSE});
  for (const item of [{kind: 'person', id: 'nobody-here', excerpts: [LOOK]}, {kind: 'person', id: 'liu-guizhi', pronoun: 'female'},
    {kind: 'place', id: 'sanyi-teahouse', pronoun: 'she'}, {kind: 'thing', id: 'x'}])
    await assert.rejects(game.call('table.looks', {turn: 0, items: [item]}), error => error.code === 'invalid_params');
  await assert.rejects(game.call('table.looks.job', {turn: 7}), error => error.code === 'invalid_params');
});

test('an if fork at an earlier commit carries that turn\'s kept looks with the line', async t => {
  const game = await table(t);
  await game.call('table.narrate', {call_id: game.next(0), text: '雨夜。'});
  await game.call('table.player_input', {text: '我进门。'});
  const {turn} = await game.call('table.narrate', {call_id: game.next(1), text: PROSE});
  const commit = (await game.record(turn)).commit;
  await game.call('table.looks', {turn, items: [{kind: 'person', id: 'liu-guizhi', excerpts: [LOOK], pronoun: 'she'}]});
  await game.call('table.branch', {commit, name: 'side'});
  const carried = await game.read('first-sight.json');
  assert.deepEqual([carried.looks.people['liu-guizhi'].excerpts, carried.looks.people['liu-guizhi'].pronoun], [[LOOK], 'she']);
});
