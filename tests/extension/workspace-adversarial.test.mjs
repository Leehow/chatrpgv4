import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'workspace-adversarial-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {EvidenceStore, evidenceStoreRoot} from './kernel-ts/read/workspace-store.ts';
`, resolveDir: root, sourcefile: 'workspace-adversarial-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const closers = [];
after(async () => {for (const close of closers) await close();});

async function tree(path, skip = path => false) {
  const result = {};
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, {withFileTypes: true}).catch(() => [])) {
      const absolute = join(current, entry.name), relative = join(prefix, entry.name);
      if (skip(relative)) continue;
      if (entry.isDirectory()) await walk(absolute, relative);
      else result[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
    }
  }
  await walk(path);
  return result;
}

async function openTable(t) {
  const home = await mkdtemp(join(temporary, `table-${t.name}-`));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'workspace-adversarial',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  return {home, base: join(home, '.coc', 'campaigns', 'c1'), call};
}

const input = (locator, body = `Body of ${locator}.`) => ({scope: {campaign: 'c1', worldline: 'main', loop: 0},
  source_revision: 'a'.repeat(64), stateStamp: 'b'.repeat(64), authority: 'table_record', locator, body, coverage: 'complete'});
const binding = value => ({scope: value.scope, source_revision: value.source_revision, stateStamp: value.stateStamp});

test('a tampered index cannot steer a body read outside the store root', async t => {
  const home = await mkdtemp(join(temporary, 'traversal-'));
  const outside = join(home, 'outside-secret.txt');
  await writeFile(outside, 'The vault combination is 31-11-73.');
  await mkdir(join(home, 'cache', 'refs'), {recursive: true});
  const body = await readFile(outside, 'utf8');
  // A corrupt index row claims a traversal id but carries the true hash and size of a file
  // outside the root: exactly what the old isText-only check let through as `valid`.
  const forged = {version: 1, id: '../outside-secret.txt', content_hash: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body), scope: {campaign: 'c1', worldline: 'main', loop: 0}, source_revision: 'a'.repeat(64),
    authority: 'table_record', locator: 'turn:9', coverage: 'complete', refs: [], scene_refs: [], entity_refs: [], thread_refs: []};
  await writeFile(join(home, 'cache', 'refs', `${'f'.repeat(64)}.json`), JSON.stringify(forged));
  const store = new api.EvidenceStore(join(home, 'cache'), {maxEntries: 8, maxBytes: 1 << 20});
  const read = await store.read('f'.repeat(64), binding(forged));
  assert.equal(read.status, 'miss', 'a forged reference id fails closed');
  assert.equal(read.body, undefined, 'no body outside the store is ever returned');
  assert.deepEqual(await store.manifest(binding(forged)), [], 'a tampered index is not manifest material');
  assert.equal(await readFile(outside, 'utf8'), body, 'the outside file was never touched');
  assert.throws(() => store.paths('../../escape'), /invalid/);
  // A valid digest id still resolves; the boundary is id derivation, not availability.
  const reference = await store.put(input('turn:1'));
  assert.equal((await store.read(reference.id, binding(input('turn:1')))).status, 'valid');
});

test('stores do not read across roots', async t => {
  const home = await mkdtemp(join(temporary, 'cross-root-'));
  const one = new api.EvidenceStore(join(home, 'one'), {maxEntries: 8, maxBytes: 1 << 20});
  const two = new api.EvidenceStore(join(home, 'two'), {maxEntries: 8, maxBytes: 1 << 20});
  const reference = await one.put(input('turn:1'));
  assert.equal((await two.read(reference.id, binding(input('turn:1')))).status, 'miss');
  assert.deepEqual(await two.manifest(binding(input('turn:1'))), []);
  assert.equal((await one.read(reference.id, binding(input('turn:1')))).status, 'valid');
});

test('evidence storage stays off the formal campaign, world files and Git', async t => {
  const table = await openTable(t);
  const before = await tree(table.home, relative => relative === join('.coc', 'workspace-cache'));
  const store = new api.EvidenceStore(api.evidenceStoreRoot(table.home), {maxEntries: 8, maxBytes: 1 << 20});
  const reference = await store.put(input('turn:1', 'Captured evidence body.'));
  assert.equal((await store.read(reference.id, binding(input('turn:1')))).status, 'valid');
  await store.put(input('turn:2'));
  const rebuilt = await store.rebuild();
  assert.equal(rebuilt.entries, 2);
  assert.equal((await store.read(reference.id, binding(input('turn:1')))).status, 'valid');
  assert.deepEqual(await tree(table.home, relative => relative === join('.coc', 'workspace-cache')), before,
    'evidence storage never touches campaign, world or Git state');
});

test('a table-minted person carries campaign_adaptation authority while authored nodes stay module_source', async t => {
  const table = await openTable(t);
  await table.call('table.player_input', {text: 'I walk into the hotel lobby.'});
  await table.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: 'Madame Vashta', to: 'here', walk_on: true}]});
  await table.call('table.narrate', {call_id: 't1-c2', text: 'Madame Vashta slides a brass key across the counter without a word.'});
  const snapshot = await table.call('table.workspace.read');
  assert.equal(snapshot.status, 'valid');
  const minted = snapshot.manifest.static.filter(ref => ref.authority === 'campaign_adaptation');
  assert.ok(minted.length >= 1, 'the table-minted person is campaign_adaptation, never book source');
  assert.ok(minted.every(ref => ref.coverage.status === 'complete' && ref.coverage.entity_complete === false),
    'a rehydrated table person exposes complete static fields, never a complete dynamic NPC view');
  assert.ok(snapshot.manifest.static.some(ref => ref.authority === 'module_source'), 'authored nodes stay module_source');
  assert.ok(snapshot.authority.allowed.includes('campaign_adaptation'), 'the checked authority vocabulary names the adaptation authority');
  assert.deepEqual(snapshot.manifest.records.map(ref => ref.locator), ['turn:1']);
});
