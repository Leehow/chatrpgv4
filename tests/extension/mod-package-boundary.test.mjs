import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODS = join(ROOT, 'mods');
const FILE_CONTRIBUTIONS = ['instructions', 'brief', 'sections', 'setup_instructions', 'setup_slots', 'materializer', 'auditor', 'style', 'voice_lane', 'voice_lane_addendum', 'speech_edit_lane', 'expression_cards'];

test('every shipped Mod declares the exact runtime package boundary', async () => {
  for (const id of await readdir(MODS)) {
    const root = join(MODS, id);
    let manifest;
    try { manifest = JSON.parse(await readFile(join(root, 'mod.json'), 'utf8')); }
    catch { continue; }
    assert.ok(manifest.requires.includes('mods.package-files.v1'), `${id} must require the scoped-package capability`);
    const referenced = FILE_CONTRIBUTIONS.map(field => manifest.contributes?.[field]).filter(value => typeof value === 'string').sort();
    assert.deepEqual([...manifest.package_files].sort(), referenced, `${id} packages exactly its referenced runtime files`);
    assert.ok(!manifest.package_files.includes('CHANGELOG.md'), `${id} must not ship its engineering changelog`);
  }
});

test('keeper-context is a default-off policy package with no executable or authority surface', async () => {
  const manifest = JSON.parse(await readFile(join(MODS, 'keeper-context', 'mod.json'), 'utf8'));
  assert.equal(manifest.default_enabled, false);
  assert.ok(manifest.requires.includes('context.workspace.v1'));
  assert.deepEqual(manifest.package_files.sort(), ['agent.md', 'brief.md']);
  assert.deepEqual(Object.keys(manifest.contributes).sort(), ['brief', 'instructions']);
  assert.deepEqual(manifest.settings, {
    mode: 'off', workspace_bytes: 24576, candidate_limit: 128, rerank_candidates: 48,
    workpad_enabled: true, rerank_enabled: false, rerank_allow_remote: false,
  });
  assert.deepEqual(manifest.settings_schema.mode.enum, ['off', 'shadow', 'on']);
  for (const name of manifest.package_files)
    assert.match(await readFile(join(MODS, 'keeper-context', name), 'utf8'), /[A-Za-z]/);
  const catalog = await readFile(join(ROOT, 'kernel-ts', 'read', 'mods.ts'), 'utf8');
  assert.match(catalog, /context\.workspace\.v1/);
});

test('shipped runtime prompts contain no retained-table identifiers or acceptance notes', async () => {
  const forbidden = /\bgame-[0-9a-f-]{8,}\b|midgame-[a-z0-9-]*live|Retained (?:live|failed|blocking|deadlock|false-revision|wrong-direction)/i;
  for (const id of await readdir(MODS)) {
    const root = join(MODS, id);
    let manifest;
    try { manifest = JSON.parse(await readFile(join(root, 'mod.json'), 'utf8')); }
    catch { continue; }
    const referenced = FILE_CONTRIBUTIONS.map(field => manifest.contributes?.[field]).filter(value => typeof value === 'string');
    for (const name of manifest.package_files ?? referenced) {
      if (!name.endsWith('.md')) continue;
      assert.doesNotMatch(await readFile(join(root, name), 'utf8'), forbidden, `${id}/${name} contains retained-table evidence`);
    }
  }
});

test('the player-facing Mods panel has no changelog consumer', async () => {
  assert.doesNotMatch(await readFile(join(ROOT, 'pipicoc/mods-panel.js'), 'utf8'), /changelog/i);
});

async function packageApi(t) {
  const home = await mkdtemp(join(tmpdir(), 'manifest-only-mod-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  await symlink(join(ROOT, 'node_modules'), join(home, 'node_modules'), 'dir');
  await build({stdin: {contents: `export {manifestFrom} from './kernel-ts/read/mods.ts';
export {createKernelContext} from './kernel-ts/context.ts';
export {ModRuntime} from './kernel-ts/mods/runtime.ts';`, resolveDir: ROOT, loader: 'ts'},
    outfile: join(home, 'api.mjs'), bundle: true, packages: 'external', platform: 'node',
    format: 'esm', target: 'node22', logLevel: 'silent'});
  return {home, api: await import(pathToFileURL(join(home, 'api.mjs')).href)};
}

test('a manifest-only clock package freezes only mod.json and preserves the legacy version', async t => {
  const {home, api} = await packageApi(t);
  const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content')});
  t.after(() => context.git.close());
  const runtime = new api.ModRuntime(context);
  const manifest = JSON.parse(await readFile(join(MODS, 'game-clock/mod.json'), 'utf8'));
  assert.equal(manifest.version, '1.0.1');
  assert.deepEqual(manifest.package_files, []);
  const legacy = {...manifest, version: '1.0.0', requires: ['ui.clock.v1']};
  delete legacy.package_files;
  const oldSource = join(home, 'old-source'), source = join(home, 'source');
  for (const [directory, value] of [[oldSource, legacy], [source, manifest]]) {
    await mkdir(directory);
    await writeFile(join(directory, 'mod.json'), JSON.stringify(value));
    await writeFile(join(directory, 'notes.md'), 'An unlisted engineering note.');
  }
  await runtime.install(oldSource);
  const oldPackage = join(context.stateRoot, 'mods/packages/game-clock/1.0.0');
  const oldBytes = await readFile(join(oldPackage, 'mod.json'), 'utf8');
  assert.ok((await readdir(oldPackage)).includes('notes.md'));
  // Use the shipped bytes so the builtin and import have the same immutable identity.
  await writeFile(join(source, 'mod.json'), await readFile(join(MODS, 'game-clock/mod.json')));
  await runtime.install(source);
  const frozen = join(context.stateRoot, 'mods/packages/game-clock/1.0.1');
  assert.deepEqual(await readdir(frozen), ['mod.json']);
  await writeFile(join(source, 'notes.md'), 'Changed engineering material stays outside the digest.');
  assert.deepEqual(await runtime.install(source), {id: 'game-clock', version: '1.0.1', reused: true});
  assert.equal(await readFile(join(oldPackage, 'mod.json'), 'utf8'), oldBytes);
  await writeFile(join(source, 'mod.json'), JSON.stringify({...manifest, description: 'Changed published bytes'}));
  await assert.rejects(runtime.install(source), error => error.code === 'invalid_params'
    && error.message.includes('different bytes'));
});

test('an empty allowlist still refuses missing capabilities, omitted contributions and invalid paths', async t => {
  const {api} = await packageApi(t);
  const base = JSON.parse(await readFile(join(MODS, 'game-clock/mod.json'), 'utf8'));
  const refuses = (manifest, extra = {}) => assert.throws(() => api.manifestFrom(new Map([
    ['mod.json', Buffer.from(JSON.stringify(manifest))], ...Object.entries(extra).map(([name, text]) => [name, Buffer.from(text)]),
  ])), error => error.code === 'invalid_params');
  const withoutField = {...base}; delete withoutField.package_files;
  refuses(withoutField);
  refuses({...base, requires: ['ui.clock.v1']});
  refuses({...base, contributes: {instructions: 'agent.md'}}, {'agent.md': 'An actual instruction.'});
  refuses({...base, package_files: ['agent.md', 'agent.md']}, {'agent.md': 'An actual instruction.'});
  refuses({...base, package_files: ['../agent.md']}, {'../agent.md': 'An escaping instruction.'});
  refuses({...base, package_files: ['CHANGELOG.md']}, {'CHANGELOG.md': 'Engineering history.'});
});
