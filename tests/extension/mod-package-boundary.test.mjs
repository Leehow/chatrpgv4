import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODS = join(ROOT, 'mods');
const FILE_CONTRIBUTIONS = ['instructions', 'brief', 'setup_instructions', 'setup_slots', 'materializer', 'auditor', 'craft_reference'];

test('every shipped Mod declares the exact runtime package boundary', async () => {
  for (const id of await readdir(MODS)) {
    const root = join(MODS, id);
    let manifest;
    try { manifest = JSON.parse(await readFile(join(root, 'mod.json'), 'utf8')); }
    catch { continue; }
    assert.ok(manifest.requires.includes('mods.package-files.v1'), `${id} must require the scoped-package capability`);
    const referenced = FILE_CONTRIBUTIONS.map(field => manifest.contributes?.[field]).filter(value => typeof value === 'string');
    if (manifest.contributes?.craft_reference) {
      assert.ok(manifest.requires.includes('context.craft-reference.v2'));
      const descriptor = JSON.parse(await readFile(join(root, manifest.contributes.craft_reference), 'utf8'));
      assert.deepEqual(Object.keys(descriptor).sort(), ['candidates', 'catalog', 'schema_version']);
      assert.equal(descriptor.schema_version, 1);
      referenced.push(descriptor.catalog, descriptor.candidates);
    }
    assert.deepEqual([...manifest.package_files].sort(), [...new Set(referenced)].sort(), `${id} packages exactly its referenced runtime files`);
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
