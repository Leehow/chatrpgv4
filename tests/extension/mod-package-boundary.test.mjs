import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODS = join(ROOT, 'mods');
const FILE_CONTRIBUTIONS = ['instructions', 'brief', 'setup_instructions', 'setup_slots', 'materializer', 'auditor'];

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
