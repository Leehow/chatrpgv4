import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function api() {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-pacing-'));
  await build({stdin:{contents:"export * from './kernel-ts/read/pacing.ts';",resolveDir:ROOT,sourcefile:'pacing-test.ts'},
    outfile:join(temporary,'api.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',logLevel:'silent'});
  const loaded = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
  return {loaded, temporary};
}

async function kernelApi() {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-pacing-kernel-'));
  await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  await build({stdin:{contents:"export * from './kernel-ts/testing/api.ts';",resolveDir:ROOT,sourcefile:'pacing-kernel-test.ts'},
    outfile:join(temporary,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node22',logLevel:'silent'});
  const loaded = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
  return {loaded, temporary};
}

const party = [{id: 'inv-1', name: 'Thomas Hayes', derived: {HP: 11}}];
const record = (turn, receipts, player_text = 'I act.') => ({turn, player_text, receipts});
const blow = (before, after, extra = {}) => ({kind: 'delta', resource: 'hp', subject: 'inv-1', before, after, subject_is_investigator: true, ...extra});

test('a close call is a major-wound blow or a drop to zero, counted once per closed turn (p.209, p.119)', async () => {
  const {loaded, temporary} = await api();
  try {
    assert.equal(loaded.FAIR_WARNING_THRESHOLD, 3);
    const records = [
      record(1, [blow(11, 8)]),                          // a scratch: not a call
      record(2, [blow(8, 2), blow(2, 1)]),               // 6 in one blow on 11 max: one call, the second blow does not add
      record(3, [blow(1, 0)]),                           // to zero: a call
      record(4, [blow(11, 5, {subject_is_investigator: false})]), // an NPC's wound is not the party's call
      record(5, [blow(11, 4)], null),                    // no player text: an opening or implicit close, not a played turn
      record(6, [blow(11, 4)]),                          // 7 in one blow: a call
    ];
    assert.equal(loaded.closeCalls(records, party, Number.MAX_SAFE_INTEGER), 3);
    assert.equal(loaded.closeCalls(records, party, 3), 1);
    assert.equal(loaded.closeCalls(records, [], Number.MAX_SAFE_INTEGER), 1, 'without a maximum only the drop to zero counts');
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});

test('the actual TypeScript capsule never projects mandatory recovery debt', async t => {
  const {loaded, temporary} = await kernelApi();
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await loaded.createKernelContext({
    workspace: home,
    content: join(ROOT, 'content'),
    seed: 'pacing-no-recovery-debt',
    locks: loaded.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'},
  });
  const runtime = loaded.createKernelRuntime(context);
  t.after(async () => { await runtime.close(); await rm(temporary, {recursive:true, force:true}); });
  const call = (method, params = {}) => runtime.handlers[method]({campaign:'c1', ...params});
  await call('campaign.create', {id:'c1', module:'the-haunting', pregen:'thomas-hayes', play_language:'en'});
  await call('table.open');
  const {capsule} = await call('table.player_input', {text:'I stay here and listen.'});

  assert.ok(capsule.director && typeof capsule.director.beat === 'string');
  assert.equal(Object.hasOwn(capsule.director, 'recovery'), false);
  assert.equal(Object.hasOwn(capsule.director, 'owed'), false);
  assert.equal(Object.hasOwn(capsule.director, 'takes'), false);
});
