import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CONTENT = join(ROOT, 'content');
const temporary = await mkdtemp(join(tmpdir(), 'pi-coc material identity '));
const output = join(temporary, 'kernel');
await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({
  entryPoints: { rpc: join(ROOT, 'kernel-ts/rpc.ts') }, outdir: output,
  outExtension: { '.js': '.mjs' }, bundle: true, packages: 'external',
  format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
});
const RPC = process.env.COC_MATERIAL_IDENTITY_RPC || join(output, 'rpc.mjs');
await build({stdin: {contents: "export {createKernelContext} from './kernel-ts/context.ts'; export {ModuleStore} from './kernel-ts/modules/store.ts';", resolveDir: ROOT},
  outfile: join(output, 'publication.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const {createKernelContext, ModuleStore} = await import(pathToFileURL(join(output, 'publication.mjs')).href);

function environment() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
    GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
    COC_TEST_CLOCK: '2000-01-02T03:04:05Z',
    NODE_OPTIONS: `--require ${JSON.stringify(join(ROOT, 'tests/kernel/rpc_clock.cjs'))}`,
    TZ: 'UTC',
  };
}

function client(home) {
  return new KernelClient({
    command: [process.execPath, RPC, '--workspace', home, '--content', CONTENT],
    cwd: ROOT, env: environment(), inheritEnv: false, timeoutMs: 20_000,
  });
}

function sceneHandle(node) {
  return node.properties?.runtime_projection?.record?.scene_id ?? node.node_id.replace(/^scene-/, '');
}

async function preparedTable(t, sceneReady) {
  const home = await mkdtemp(join(temporary, 'table-'));
  t.after(async () => { await rm(home, { recursive: true, force: true }); });
  const first = client(home);
  await first.call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en' });
  await first.close();

  const campaign = join(home, '.coc/campaigns/c1');
  const world = JSON.parse(await readFile(join(campaign, 'world.json'), 'utf8'));
  const store = new ModuleStore(await createKernelContext({workspace: home, content: CONTENT}));
  const graph = await store.readGraph('the-haunting');
  const current = graph.nodes.find(node => node.node_kind === 'scene' && sceneHandle(node) === world.active_scene);
  assert.ok(current, 'the fixture starter supplies the active scene');
  const edge = current.properties.runtime_projection.record.scene_edges.find(entry => typeof entry.to === 'string');
  const destination = graph.nodes.find(node => node.node_kind === 'scene' && sceneHandle(node) === edge.to);
  assert.ok(destination, 'the fixture starter supplies a scene exit');
  const collision = { node_id: `location-${sceneHandle(destination)}`, node_kind: 'location', name: 'unready same-handle location', properties: {} };
  graph.nodes.push(collision);
  const meta = await store.module('the-haunting');
  // A visually read book (§22): the Haunting stands in for one, so it is marked as one. A starter bound
  // to its own window (§14.16) keeps its authored material and has no such gates.
  // Its built-in window is taken away, as before the window shipped: these gates are the subject, not read-ahead.
  meta.reading_version = 1;
  meta.source = 'pdf';
  delete meta.source_document;
  meta.reading = { materials: [{ node_ids: sceneReady ? [current.node_id, destination.node_id] : [current.node_id, collision.node_id] }] };
  await store.writeGraph(meta, graph);
  await store.writeModule(meta);

  const table = client(home);
  t.after(() => table.close());
  await table.call('table.open', { campaign: 'c1' });
  return { home, table, destination: sceneHandle(destination) };
}

test('a ready scene wins over an unready same-handle location at the player-facing material gates', async t => {
  const { table, destination } = await preparedTable(t, true);
  const before = await table.call('table.look', { campaign: 'c1', focus: 'scene' });
  assert.equal(before.where.material, 'ready');
  assert.equal(before.where.exits.find(exit => exit.to === destination)?.material, 'ready');

  await table.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text: 'The investigation begins.' });
  await table.call('table.player_input', { campaign: 'c1', text: 'I take the available route.' });
  const moved = await table.call('table.apply', { campaign: 'c1', call_id: 't1-c1', effects: [{ kind: 'move', to: destination }] });
  assert.equal(moved.world.active_scene, destination);
  assert.equal(moved.material_ready, true);
  assert.equal(moved.material, 'ready');
  assert.deepEqual(moved.deepen_queued, []);
  assert.ok(moved.receipts.some(receipt => receipt.startsWith('move:')));
});

test('an unready scene is still blocked when only its same-handle location is ready', async t => {
  const { home, table, destination } = await preparedTable(t, false);
  const before = await table.call('table.look', { campaign: 'c1', focus: 'scene' });
  assert.equal(before.where.exits.find(exit => exit.to === destination)?.material, 'missing');
  await table.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text: 'The investigation begins.' });
  await table.call('table.player_input', { campaign: 'c1', text: 'I take the available route.' });
  const worldPath = join(home, '.coc/campaigns/c1/world.json');
  const unchanged = await readFile(worldPath, 'utf8');
  await assert.rejects(table.call('table.apply', { campaign: 'c1', call_id: 't1-c1', effects: [{ kind: 'move', to: destination }] }), error => {
    assert.equal(error.code, 'needs');
    assert.equal(error.details.read.focus, destination, 'foreground reading rejoins the same semantic focus used by prefetch');
    return true;
  });
  assert.equal(await readFile(worldPath, 'utf8'), unchanged);
  assert.equal((await table.call('table.view', { campaign: 'c1' })).scene.name, before.where.scene);
});
