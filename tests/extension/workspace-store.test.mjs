import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'workspace-store-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {EvidenceStore, evidenceStoreRoot} from './kernel-ts/read/workspace-store.ts';
export {withWorkspaceCacheLock, reserveWorkspaceBytes} from './kernel-ts/read/workspace-cache.ts';`,
  resolveDir: root, sourcefile: 'workspace-store-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const input = (locator, body = `Body of ${locator}.`) => ({scope: {campaign: 'c1', worldline: 'main', loop: 0},
  source_revision: 'a'.repeat(64), stateStamp: 'b'.repeat(64), authority: 'table_record', locator, body, coverage: 'complete'});
const binding = value => ({scope: value.scope, source_revision: value.source_revision, stateStamp: value.stateStamp});
const hex = char => char.repeat(64);

test('concurrent puts serialize: Promise.all cannot break maxEntries or maxBytes', async t => {
  const home = await mkdtemp(join(temporary, 'concurrent-'));
  const store = new api.EvidenceStore(join(home, 'cache'), {maxEntries: 4, maxBytes: 4096});
  const settled = await Promise.allSettled(Array.from({length: 10}, (_, i) => store.put(input(`turn:${i}`))));
  const kept = settled.filter(row => row.status === 'fulfilled').map(row => row.value);
  const refused = settled.filter(row => row.status === 'rejected');
  assert.equal(kept.length, 4, `exactly the quota is stored: ${kept.length}`);
  assert.equal(refused.length, 6);
  for (const row of refused) assert.match(row.reason.message, /quota exceeded/);
  const refs = (await readdir(join(home, 'cache', 'refs'))).filter(name => name.endsWith('.json'));
  assert.equal(refs.length, 4, 'no entry slipped past the quota between check and write');
  for (const reference of kept)
    assert.equal((await store.read(reference.id, binding(input('turn:0')))).status, 'valid');
});

test('orphan bodies and abandoned temporaries are quota-visible and rebuildable', async t => {
  const home = await mkdtemp(join(temporary, 'orphan-'));
  const store = new api.EvidenceStore(join(home, 'cache'), {maxEntries: 8, maxBytes: 4096});
  const first = await store.put(input('turn:1', 'Small body.'));
  await writeFile(join(home, 'cache', 'bodies', hex('c')), 'x'.repeat(5000));
  await writeFile(join(home, 'cache', 'bodies', `${hex('d')}.tmp`), 'partial write');
  // The 5 KB orphan alone busts maxBytes; the store self-heals by rebuilding before giving up,
  // so the next valid put succeeds and the orphan is gone.
  const second = await store.put(input('turn:2', 'Another body.'));
  assert.equal((await store.read(second.id, binding(input('turn:2')))).status, 'valid');
  const kept = (await readdir(join(home, 'cache', 'bodies'))).sort();
  assert.deepEqual(kept, [first.id, second.id].sort());
  const rebuilt = await store.rebuild();
  assert.equal(rebuilt.droppedOrphans, 0);
  assert.equal(rebuilt.droppedTemporaries, 0);
  // Quota still binds once only valid entries remain.
  await assert.rejects(store.put(input('turn:3', 'x'.repeat(4096))), /quota exceeded/);
});

test('a valid put still exceeds the entry quota after a rebuild, and rebuild drops orphans on demand', async t => {
  const home = await mkdtemp(join(temporary, 'entry-quota-'));
  const store = new api.EvidenceStore(join(home, 'cache'), {maxEntries: 2, maxBytes: 4096});
  await store.put(input('turn:1'));
  await store.put(input('turn:2'));
  await writeFile(join(home, 'cache', 'bodies', hex('e')), 'orphan');
  const rebuilt = await store.rebuild();
  assert.equal(rebuilt.droppedOrphans, 1);
  assert.equal(rebuilt.entries, 2);
  await assert.rejects(store.put(input('turn:3')), /quota exceeded/, 'orphan dropping cannot manufacture entry room');
});

test('a matching put repairs a corrupted body; missing bodies are healed the same way', async t => {
  const home = await mkdtemp(join(temporary, 'repair-'));
  const store = new api.EvidenceStore(join(home, 'cache'), {maxEntries: 8, maxBytes: 4096});
  const reference = await store.put(input('turn:3', 'The original text.'));
  await writeFile(store.paths(reference.id).body, 'corrupted');
  assert.equal((await store.read(reference.id, binding(input('turn:3')))).status, 'miss');
  const again = await store.put(input('turn:3', 'The original text.'));
  assert.equal(again.id, reference.id);
  const healed = await store.read(reference.id, binding(input('turn:3')));
  assert.equal(healed.status, 'valid');
  assert.equal(healed.body, 'The original text.');
  await rm(store.paths(reference.id).body);
  await store.put(input('turn:3', 'The original text.'));
  assert.equal((await store.read(reference.id, binding(input('turn:3')))).status, 'valid', 'a deleted body is rewritten, not treated as fresh quota');
});

test('separate evidence store instances cannot race past one entry quota', async () => {
  const home = await mkdtemp(join(temporary, 'two-writers-')), root = join(home, 'cache');
  const outcomes = await Promise.allSettled([new api.EvidenceStore(root, {maxEntries: 1, maxBytes: 4096}).put(input('first')),
    new api.EvidenceStore(root, {maxEntries: 1, maxBytes: 4096}).put(input('second'))]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await readdir(join(root, 'refs'))).filter(name => name.endsWith('.json')).length, 1);
});

test('the common governor reserves metadata and temporary bytes without touching formal files', async () => {
  const home = await mkdtemp(join(temporary, 'governor-')), root = api.evidenceStoreRoot(home);
  const store = new api.EvidenceStore(root);
  await store.put(input('governed', 'x'.repeat(1000)));
  const marker = join(home, 'formal-evidence.json'); await writeFile(marker, 'retained');
  await api.withWorkspaceCacheLock(root, () => api.reserveWorkspaceBytes(root, 'c1', 1024, [], {campaign: 2048, total: 2048}));
  const remaining = await store.manifest(binding(input('governed')));
  // Evicting a body or reference is a rebuildable miss; neither can turn into authority.
  for (const ref of remaining) assert.notEqual((await store.read(ref.id, binding(input('governed')))).status, 'valid');
  assert.equal(await readFile(marker, 'utf8'), 'retained');
});
