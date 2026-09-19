import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'workspace-read-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {EvidenceStore, evidenceStoreRoot} from './kernel-ts/read/workspace-store.ts';
`, resolveDir: root, sourcefile: 'workspace-read-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const closers = [];
after(async () => {for (const close of closers) await close();});

async function tree(path) {
  const result = {};
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const absolute = join(current, entry.name), relative = join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else result[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
    }
  }
  await walk(path);
  return result;
}

async function openTable(t) {
  const home = await mkdtemp(join(temporary, `table-${t.name}-`));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'workspace-read',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  return {home, base: join(home, '.coc', 'campaigns', 'c1'), call};
}

test('workspace read returns one bound snapshot without changing formal campaign files', async t => {
  const table = await openTable(t);
  const before = await tree(table.base);
  const first = await table.call('table.workspace.read');
  assert.equal(first.status, 'valid');
  assert.equal(first.binding.campaign, 'c1');
  assert.equal(first.binding.worldline, 'main');
  assert.equal(typeof first.binding.source_revision, 'string');
  assert.match(first.binding.source_revision, /^[0-9a-f]{64}$/);
  assert.match(first.binding.stateStamp, /^[0-9a-f]{64}$/);
  assert.notEqual(String(first.binding.stateStamp), String(first.binding.turn), 'stateStamp is not a turn ordinal');
  assert.equal(first.manifest.version, 1);
  assert.ok(Array.isArray(first.manifest.static));
  assert.equal(first.authority.checked, true);
  for (const forbidden of ['call_id', 'receipt', 'event', 'job', 'world', 'touchActing'])
    assert.equal(Object.hasOwn(first, forbidden), false, `workspace read leaked ${forbidden}`);
  assert.deepEqual(await tree(table.base), before);

  const same = await table.call('table.workspace.read', {binding: first.binding});
  assert.deepEqual(same, first, 'the same snapshot has the same source and state binding');
  const stale = await table.call('table.workspace.read', {binding: {...first.binding, stateStamp: '0'.repeat(64)}});
  assert.equal(stale.status, 'unverifiable');
  const crossLine = await table.call('table.workspace.read', {binding: {...first.binding, worldline: 'other-line'}});
  assert.equal(crossLine.status, 'unverifiable');
  assert.deepEqual(await tree(table.base), before, 'validation misses do not write formal records');

  await table.call('table.player_input', {text: 'I examine the desk.'});
  const changed = await table.call('table.workspace.read');
  assert.notEqual(changed.binding.stateStamp, first.binding.stateStamp, 'dynamic state invalidates independently of source identity');
  assert.equal(changed.binding.source_revision, first.binding.source_revision);
});

test('committed narrate records reach the manifest and cannot be crowded out by statics', async t => {
  const table = await openTable(t);
  await table.call('table.player_input', {text: 'I examine the desk.'});
  await table.call('table.narrate', {call_id: 't1-c1', text: 'The desk yields a faded letter, its seal unbroken.'});
  const snapshot = await table.call('table.workspace.read');
  assert.equal(snapshot.status, 'valid');
  assert.ok(snapshot.manifest.records.length >= 1, 'a committed record reaches the manifest');
  assert.equal(snapshot.manifest.records[0].locator, 'turn:1');
  assert.equal(snapshot.manifest.records[0].authority, 'table_record');
  assert.equal(snapshot.manifest.records[0].turn, 1);
  assert.equal(snapshot.coverage.records.status, 'complete');
  assert.equal(snapshot.coverage.records.count, 1);
  assert.ok(snapshot.manifest.static.length >= 1, 'static references share the same manifest');
  // Reserved record slots: the 48-node static module fills at most 23 of 24 slots when a record exists.
  assert.ok(snapshot.manifest.static.length < 24, `statics leave the reserved record slot free: ${snapshot.manifest.static.length}`);
  for (const ref of [...snapshot.manifest.static, ...snapshot.manifest.records]) {
    assert.equal(Object.hasOwn(ref, 'content_hash'), false, 'a manifest identity is not a body hash');
    assert.match(String(ref.identity), /^[0-9a-f]{64}$/);
  }
});

test('ask and implicit records never poison an otherwise valid snapshot', async t => {
  const table = await openTable(t);
  // Turn 0 closes implicitly (no commit) the moment the first player input opens turn 1.
  await table.call('table.player_input', {text: 'I examine the desk.'});
  await table.call('table.narrate', {call_id: 't1-c1', text: 'The desk yields a faded letter, its seal unbroken.'});
  await table.call('table.player_input', {text: 'I read the letter by the window.'});
  // ask closes turn 2 without a campaign commit; it carries no record authority.
  await table.call('table.ask', {call_id: 't2-c1', prompt: 'Will you follow the gardener?', options: ['follow', 'stay'], binds: 'gardener',
    text: 'The gardener looks up from the flowerbed, waiting for an answer.'});
  const snapshot = await table.call('table.workspace.read');
  assert.equal(snapshot.status, 'valid', 'ask/implicit records never downgrade the snapshot');
  assert.deepEqual(snapshot.manifest.records.map(ref => ref.locator), ['turn:1']);
  assert.equal(snapshot.coverage.records.status, 'complete');
});

test('quota truncation is reported on a valid snapshot, never as unverifiable', async t => {
  const table = await openTable(t);
  for (let i = 1; i <= 26; i++) {
    await table.call('table.player_input', {text: `I press on, round ${i}.`});
    await table.call('table.narrate', {call_id: `t${i}-c1`, text: `The house watches as round ${i} settles into its walls.`});
  }
  const snapshot = await table.call('table.workspace.read');
  assert.equal(snapshot.status, 'valid', 'omitted references truncate; they never poison');
  assert.equal(snapshot.manifest.truncated, true);
  assert.equal(snapshot.coverage.records.status, 'complete');
  assert.equal(snapshot.coverage.records.count, 12, 'only the bounded recent record window is inspected');
  assert.equal(snapshot.manifest.records.length, 12, 'records take their reserved slots');
  assert.ok(snapshot.coverage.records.omitted >= 14, 'uninspected record files are explicit omissions');
  assert.equal(snapshot.manifest.static.length, 12, 'statics share the remaining budget');
});

test('stateStamp covers party state before any dynamic view binds to it', async t => {
  const table = await openTable(t);
  const first = await table.call('table.workspace.read');
  const sheetPath = join(table.base, 'party', 'thomas-hayes.json');
  const sheet = JSON.parse(await readFile(sheetPath, 'utf8'));
  sheet.current_hp = Number(sheet.current_hp) - 1;
  await writeFile(sheetPath, JSON.stringify(sheet));
  const changed = await table.call('table.workspace.read');
  assert.notEqual(changed.binding.stateStamp, first.binding.stateStamp, 'party state is inside the dynamic stamp');
  assert.equal(changed.binding.source_revision, first.binding.source_revision, 'source identity does not move with party state');
});

test('rules carry an independent version and an oversized dependency group is never a complete body', async t => {
  const table = await openTable(t);
  const snapshot = await table.call('table.workspace.read', {rules: ['rule:coc7:chase:barriers'], candidate_limit: 16});
  assert.match(snapshot.binding.rules_revision, /^[a-f0-9]{64}$/);
  assert.notEqual(snapshot.binding.rules_revision, snapshot.binding.source_revision);
  assert.ok(snapshot.inspected <= 16);
  const rule = snapshot.candidates.static.find(ref => ref.authority === 'rules_source');
  assert.ok(rule);
  assert.equal(rule.rules_revision, snapshot.binding.rules_revision);
  if (rule.coverage.status === 'complete') {
    const body = JSON.parse(rule.body);
    assert.ok(Array.isArray(body.source_group) && Array.isArray(body.relations));
    assert.ok(Buffer.byteLength(rule.body, 'utf8') <= 8192);
  } else {
    assert.equal(rule.coverage.status, 'partial');
    assert.equal(rule.body, undefined);
    assert.ok(rule.coverage.omitted.includes('rule_dependency_group'));
  }
});

test('evidence store round-trips atomically and fails closed for corruption, scope, state, and incomplete coverage', async t => {
  const home = await mkdtemp(join(temporary, `store-${t.name}-`));
  const store = new api.EvidenceStore(join(home, 'cache'), {maxEntries: 4, maxBytes: 1024});
  const input = {scope: {campaign: 'c1', worldline: 'main', loop: 0}, source_revision: 'a'.repeat(64), stateStamp: 'b'.repeat(64),
    authority: 'table_record', locator: 'turn:3', body: 'A verified record.', coverage: 'complete'};
  const reference = await store.put(input);
  assert.equal((await store.read(reference.id, {scope: input.scope, source_revision: input.source_revision, stateStamp: input.stateStamp})).status, 'valid');
  assert.equal((await store.read(reference.id, {scope: {...input.scope, campaign: 'other'}, source_revision: input.source_revision, stateStamp: input.stateStamp})).status, 'unverifiable');
  assert.equal((await store.read(reference.id, {scope: input.scope, source_revision: input.source_revision, stateStamp: 'c'.repeat(64)})).status, 'stale');
  await assert.rejects(store.put({...input, coverage: 'partial'}), /incomplete evidence/);
  const paths = store.paths(reference.id);
  await writeFile(paths.body, 'corrupted');
  assert.equal((await store.read(reference.id, {scope: input.scope, source_revision: input.source_revision, stateStamp: input.stateStamp})).status, 'miss');
  assert.deepEqual((await readdir(join(home, 'cache', 'refs'))).filter(name => name.endsWith('.tmp')), []);
  assert.deepEqual(await store.manifest({scope: input.scope, source_revision: input.source_revision, stateStamp: input.stateStamp}), [reference]);
});
