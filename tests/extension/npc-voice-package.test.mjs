/**
 * The `npc-voice` package (contract §40.5) read by the kernel's own manifest loader, not by a
 * hand-written parser: `packageFiles` walks the shipped directory and `manifestFrom` decides it,
 * exactly as `mods.install` and the builtin catalog do.
 */
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {build} from 'esbuild';
import {authored} from '../../pipicoc/mods-panel.js';

const ROOT = resolve(import.meta.dirname, '../..');
const PACKAGE = join(ROOT, 'mods/npc-voice');

/** The kernel's own loader, bundled the way `ts-kernel-mod-catalog` bundles the catalog reader. */
async function loader(t) {
  const home = await mkdtemp(join(tmpdir(), 'npc-voice-manifest-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  await build({
    stdin: {contents: "export {manifestFrom, packageFiles} from './kernel-ts/read/mods.ts';", resolveDir: ROOT, loader: 'ts'},
    outfile: join(home, 'mods.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm',
    target: 'node22', logLevel: 'silent',
  });
  return import(pathToFileURL(join(home, 'mods.mjs')).href);
}

const read = async name => JSON.parse(await readFile(join(PACKAGE, name), 'utf8'));

/** The package ships what it says it ships: both instruction forms and its own changelog. */
const files_of = files => ['mod.json', 'agent.md', 'brief.md', 'CHANGELOG.md'].every(name => files.has(name));

test('the shipped npc-voice manifest is what §40.5 describes', async t => {
  const api = await loader(t);
  const loaded = api.manifestFrom(await api.packageFiles(PACKAGE));

  assert.equal(loaded.id, 'npc-voice');
  assert.equal(loaded.version, '1.0.0');
  assert.equal(loaded.game_api, 'pipicoc.game.v1');
  assert.equal(loaded.default_enabled, true);
  assert.deepEqual(loaded.requires, ['graph.vocabulary.v1', 'graph.vocabulary.table.v1', 'context.npc.v1']);
  assert.deepEqual(loaded.settings, {coarse_language: true});
  assert.equal(loaded.contributes.instructions, 'agent.md');
  assert.equal(loaded.contributes.brief, 'brief.md');
  const [key] = loaded.contributes.vocabulary.actor_profile_keys;
  assert.equal(key.key, 'sample_lines');
  assert.equal(key.label, 'sounds like');
  assert.match(key.ask, /one at ease and one under strain/);

  // The package's own per-language words are the one authored place for them (§23): the panel reads
  // the session's tag and falls back to whatever wording the manifest does carry.
  const shipped = await read('mod.json');
  for (const field of ['name', 'description']) {
    assert.equal(typeof shipped[field].en, 'string');
    assert.ok(shipped[field].en.trim());
    assert.ok(authored(shipped[field], 'zh-Hans').trim());
  }
  const title = shipped.settings_schema.coarse_language.title;
  assert.equal(authored(title, 'en'), 'Coarse language');
  assert.ok(authored(title, 'zh-Hans').trim());
  assert.notEqual(authored(title, 'en'), authored(title, 'zh-Hans'));
  // A boolean setting is what the sidebar renders as a checkbox, so the schema names no enum.
  assert.equal('enum' in shipped.settings_schema.coarse_language, false);

  assert.ok(files_of(await api.packageFiles(PACKAGE)));
});

test('the per-turn brief stays inside its 250-byte share of the §30.7 ceiling', async t => {
  const brief = await readFile(join(PACKAGE, 'brief.md'));
  assert.ok(brief.byteLength <= 250, `brief.md is ${brief.byteLength} bytes`);
  const text = brief.toString('utf8');
  assert.match(text, /sounds like/);
  assert.match(text, /coarse_language/);
});

test("the lane instruction is authored in English and asks for exactly the shape the lane checks", async () => {
  const instruction = await readFile(join(ROOT, 'content/setup/npc-voice.md'), 'utf8');
  assert.match(instruction, /\{"sample_lines": \["<at ease>", "<under strain>"\]\}/);
  assert.match(instruction, /120 characters/);
  assert.match(instruction, /play_language/);
  assert.match(instruction, /coarse_language/);
  // `content/setup/**` is system content and is guarded against CJK by tests/kernel/test_system_language.py,
  // so the two-mouths example lives here in English and verbatim in the package's own agent.md.
  assert.match(instruction, /Same thought, two mouths/);
});

/**
 * `shape: "lines"` (§40.5) and the kernel that accepts it are one change, pinned together here.
 *
 * `validateVocabulary` in `kernel-ts/read/mods.ts` requires a contributed profile key to carry
 * exactly `ask`, `key` and `label`. The refusal is thrown out of `readModCatalog`, so a manifest
 * that declares `shape` before the kernel knows it does not merely disable this package: the whole
 * builtin catalog fails and a kernel process answers nothing at all (measured 2026-09-15 —
 * `material-identity.test.mjs` hangs rather than failing). So this asserts the pair, in both
 * directions, and goes red on whichever half lands alone.
 */
test('the package declares §40.5 `shape` exactly when the kernel accepts one', async t => {
  const api = await loader(t);
  const files = await api.packageFiles(PACKAGE);
  const manifest = JSON.parse(new TextDecoder().decode(files.get('mod.json')));
  const declared = manifest.contributes.vocabulary.actor_profile_keys[0].shape;
  manifest.contributes.vocabulary.actor_profile_keys[0].shape = 'lines';
  const probe = new Map(files);
  probe.set('mod.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  const refusal = await Promise.resolve()
    .then(() => api.manifestFrom(probe))
    .then(() => undefined, value => value);
  if (declared === undefined) {
    assert.ok(refusal, 'the kernel accepts `shape` now: declare it on sample_lines in mod.json (§40.5)');
    assert.equal(refusal.code, 'invalid_params');
    assert.match(refusal.message, /exactly a key, a label and an ask/);
    return;
  }
  assert.equal(declared, 'lines');
  assert.equal(refusal, undefined, 'mod.json declares `shape` but the kernel still refuses it (§40.5)');
});
