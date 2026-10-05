/** Prerequisite-gate mechanisms only: controlled read RPC answers, no Keeper or provider. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkCreaturePrerequisites, REQUIRED_FILES} from '../../scripts/creature-acceptance-preflight.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'creature-preflight-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const app = join(dir, 'Reviewed.app'), root = join(app, 'Contents/Resources/pi-coc');
  const files = {};
  for (const file of REQUIRED_FILES) {
    await mkdir(join(root, file, '..'), {recursive: true});
    const bytes = `reviewed artifact: ${file}`;
    await writeFile(join(root, file), bytes); files[file] = sha(bytes);
  }
  const receipt = join(dir, 'receipt.json'), commit = '1'.repeat(40);
  const bytes = JSON.stringify({app, commit}); await writeFile(receipt, bytes);
  const mod_locks = Object.fromEntries(['hostile-creatures', 'natural-npc', 'narration-craft'].map((id, i) => [id,
    {version: `1.0.${i}`, digest: String(i + 1).repeat(64), state_version: 1, enabled: true, settings: {}}]));
  const expected = {commit, receipt_sha256: sha(bytes), files, mod_locks, requirements: {
    creature: 'Source swarm', habits: 'Survivors flee after a member is killed.',
    weakness_actor: 'Source antagonist', weakness_books: ['Its own blade ends it.'],
  }};
  const home = join(dir, 'home'), campaign = 'gate-fixture', worldFile = join(home, '.coc/campaigns', campaign, 'world.json');
  await mkdir(join(worldFile, '..'), {recursive: true});
  const world = {mods: {active: structuredClone(mod_locks), pending: {}}};
  const saveWorld = () => writeFile(worldFile, JSON.stringify(world)); await saveWorld();
  const replies = {
    'mods.list': {mods: Object.entries(mod_locks).map(([id, lock]) => ({id, version: lock.version, compatible: true, active: lock}))},
    'table.capsule': {mods: {vocabulary: {words: [{key: 'habits', label: 'habits', bound: true}]}}},
    creature: {kind: 'creature', habits: expected.requirements.habits},
    antagonist: {weaknesses: [{book: expected.requirements.weakness_books[0]}]},
  };
  const calls = [], read = async (method, params) => {
    assert.equal(params.campaign, campaign); calls.push(method);
    if (method === 'table.look') return params.name === expected.requirements.creature ? replies.creature : replies.antagonist;
    assert.ok(['mods.list', 'table.capsule'].includes(method), 'only reads are permitted');
    return replies[method];
  };
  return {root, home, campaign, receipt, expected, read, dir, replies, calls, world, saveWorld,
    check: overrides => checkCreaturePrerequisites({root, home, campaign, receipt, expected, read, ...overrides})};
}

test('§180.18: matching artifact, actual locks and projected facts pass prerequisites only through four reads', async t => {
  const f = await fixture(t), report = await f.check();
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.scope, 'prerequisites_only');
  assert.equal(report.no_model_calls, true);
  assert.deepEqual(f.calls, ['mods.list', 'table.capsule', 'table.look', 'table.look']);
});

test('§180.18: two identical stale copies under the correct source commit cannot satisfy reviewed artifact hashes', async t => {
  const f = await fixture(t), other = join(f.dir, 'source-copy');
  for (const file of REQUIRED_FILES.filter(file => file.startsWith('build/'))) await writeFile(join(f.root, file), 'same old build');
  await cp(f.root, other, {recursive: true});
  for (const file of REQUIRED_FILES) assert.deepEqual(await readFile(join(f.root, file)), await readFile(join(other, file)));
  const report = await f.check();
  assert.equal(report.ok, false);
  assert.equal(report.checks.filter(check => !check.pass).length, 3);
  assert.ok(report.checks.filter(check => !check.pass).every(check => check.gate === 'artifact'));
  assert.deepEqual(f.calls, [], 'no kernel starts before identity passes');
  assert.equal((await f.check({root: other})).ok, false, 'a source copy is also outside the receipt resource root');
});

test('§180.18: absent hashes or a changed receipt refuse before kernel reads', async t => {
  const f = await fixture(t);
  for (const expected of [{}, {...f.expected, files: {}}]) assert.equal((await f.check({expected})).ok, false);
  await writeFile(f.receipt, JSON.stringify({app: join(f.dir, 'Reviewed.app'), commit: '2'.repeat(40)}));
  assert.equal((await f.check()).ok, false);
  assert.deepEqual(f.calls, []);
});

test('§180.18: missing/wrong lock or pending settings refuse before capsule and actor reads', async t => {
  for (const change of [
    world => {delete world.mods.active['hostile-creatures'];},
    world => {world.mods.active['natural-npc'].digest = '0'.repeat(64);},
    world => {world.mods.active['narration-craft'].settings = {different: true};},
    world => {world.mods.pending['hostile-creatures'] = {enabled: true};},
    world => {world.mods.pending_order = [];},
  ]) {
    const f = await fixture(t); change(f.world); await f.saveWorld();
    assert.equal((await f.check()).ok, false);
    assert.deepEqual(f.calls, ['mods.list']);
  }
});

test('§180.18: a loaded Mod with unbound habits, missing habit text or absent weakness projection fails', async t => {
  for (const change of [
    replies => {replies['table.capsule'].mods.vocabulary.words[0].bound = false;},
    replies => {delete replies.creature.habits;},
    replies => {replies.antagonist.weaknesses = [];},
  ]) {
    const f = await fixture(t); change(f.replies);
    const report = await f.check();
    assert.equal(report.ok, false);
    assert.ok(report.checks.some(check => check.gate === 'bindings' && !check.pass));
  }
});

test('§180.18: a failed read reports unavailable and never treats absent evidence as a pass', async t => {
  const f = await fixture(t), report = await f.check({read: async () => {throw new Error('Read unavailable');}});
  assert.equal(report.ok, false);
  assert.match(report.checks.at(-1).error, /Read unavailable/);
});
