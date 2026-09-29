/**
 * Contract §150.6: the setup catalog the kernel issues carries what the driven setup run chooses from -- the
 * characteristics `aptitude` names, and `listed: false` on the skills a creation skill list never holds (Credit
 * Rating, Cthulhu Mythos), so the clerk never offers them as named skills. The TS kernel is bundled in process; no
 * emitted build is read.
 */
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
let bundle, home, runtime;
before(async () => {
  // Inside the repository, so the bundle's external packages resolve through its node_modules (the check-preflight pattern).
  await mkdir(join(root, '.tmp'), {recursive: true});
  bundle = await mkdtemp(join(root, '.tmp/setup-catalog-bundle-'));
  await build({stdin: {contents: [
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
  ].join('\n'), resolveDir: root, sourcefile: 'setup-catalog-entry.ts'}, outfile: join(bundle, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
  const api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);
  home = await mkdtemp(join(tmpdir(), 'setup-catalog-home-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'setup-catalog', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  runtime = api.createKernelRuntime(kernel);
  await runtime.handlers['campaign.create']({id: 'c1', module: 'the-haunting', play_language: 'zh-Hans'});
});
after(async () => {
  await runtime?.close();
  for (const dir of [bundle, home]) if (dir) await rm(dir, {recursive: true, force: true});
});

test('§150.6: setup.catalog names the characteristics aptitude takes and marks the skills a list never holds', async () => {
  const catalog = await runtime.handlers['setup.catalog']({campaign: 'c1'});
  assert.deepEqual(catalog.characteristics.map(row => row.abbr), ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'], 'every characteristic but Luck');
  assert.equal(catalog.characteristics.find(row => row.abbr === 'STR').name, 'Strength');
  const unlisted = catalog.skills.filter(row => row.listed === false).map(row => row.name).sort();
  assert.deepEqual(unlisted, ['Credit Rating', 'Cthulhu Mythos']);
  assert.ok(catalog.skills.some(row => row.name === 'Spot Hidden' && row.listed === undefined), 'an ordinary skill carries no mark');
});
