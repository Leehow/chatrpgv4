import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {build} from 'esbuild';

const CAPABILITY = 'npc.voice.generation.v2';

test('generation-v2 voice packages cannot activate on a runtime without generation-v2 support', async t => {
  const root = resolve(import.meta.dirname, '../..');
  const manifest = JSON.parse(await readFile(join(root, 'mods/npc-voice/mod.json'), 'utf8'));
  assert.ok(manifest.requires.includes(CAPABILITY), 'the package must require the runtime that can regenerate and bind its jobs');
  const home = await mkdtemp(join(tmpdir(), 'voice-generation-compatibility-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  await build({
    stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {MOD_CAPABILITIES, readModCatalog} from './kernel-ts/read/mods.ts';`, resolveDir: root, loader: 'ts'},
    outfile: join(home, 'catalog.mjs'), bundle: true, packages: 'external', platform: 'node',
    format: 'esm', target: 'node22', logLevel: 'silent',
  });
  const api = await import(pathToFileURL(join(home, 'catalog.mjs')).href);
  assert.ok(api.MOD_CAPABILITIES.has(CAPABILITY));
  async function voiceCatalog(workspace) {
    const context = await api.createKernelContext({workspace, content: join(root, 'content')});
    t.after(() => context.git.close());
    return [...(await api.readModCatalog(context)).values()].find(row => row.id === 'npc-voice' && row.version === manifest.version);
  }
  assert.equal((await voiceCatalog(join(home, 'current'))).compatible, true);
  api.MOD_CAPABILITIES.delete(CAPABILITY);
  try {
    const oldRuntime = await voiceCatalog(join(home, 'older'));
    assert.ok(oldRuntime, 'incompatible packages remain visible rather than silently disappearing');
    assert.equal(oldRuntime.compatible, false);
  } finally {
    api.MOD_CAPABILITIES.add(CAPABILITY);
  }
});
