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
    stdin: {contents: "export {manifestFrom, packageFiles, runtimePackageFiles} from './kernel-ts/read/mods.ts';", resolveDir: ROOT, loader: 'ts'},
    outfile: join(home, 'mods.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm',
    target: 'node22', logLevel: 'silent',
  });
  return import(pathToFileURL(join(home, 'mods.mjs')).href);
}

const read = async name => JSON.parse(await readFile(join(PACKAGE, name), 'utf8'));

/** §101: the runtime package ships both instruction forms and no engineering changelog. */
const files_of = files => ['mod.json', 'agent.md', 'brief.md'].every(name => files.has(name)) && !files.has('CHANGELOG.md');

test('the shipped npc-voice manifest is what §40.5 describes', async t => {
  const api = await loader(t);
  const loaded = api.manifestFrom(await api.packageFiles(PACKAGE));

  assert.equal(loaded.id, 'npc-voice');
  assert.equal(loaded.version, '1.1.2');
  assert.equal(loaded.game_api, 'pipicoc.game.v1');
  assert.equal(loaded.default_enabled, true);
  assert.deepEqual(loaded.requires, ['graph.vocabulary.v1', 'graph.vocabulary.table.v1', 'context.npc.v1', 'mods.package-files.v1']);
  assert.deepEqual(loaded.settings, {coarse_language: true});
  assert.equal(loaded.contributes.instructions, 'agent.md');
  assert.equal(loaded.contributes.brief, 'brief.md');
  // §40.7: two lines-shaped words, a mask of one line and three exchanges, in this order.
  const [mask, exchanges] = loaded.contributes.vocabulary.actor_profile_keys;
  assert.deepEqual([mask.key, mask.label, mask.shape], ['voice_mask', 'mask', 'lines']);
  assert.match(mask.ask, /sentence-ending habit/);
  assert.deepEqual([exchanges.key, exchanges.label, exchanges.shape], ['exchanges', 'in exchange', 'lines']);
  assert.match(exchanges.ask, /up to three exchanges/);

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

  const source = await api.packageFiles(PACKAGE);
  assert.ok(files_of(api.runtimePackageFiles(source, loaded)));
});

test('the per-turn brief stays inside its 250-byte share of the §30.7 ceiling', async t => {
  const brief = await readFile(join(PACKAGE, 'brief.md'));
  assert.ok(brief.byteLength <= 250, `brief.md is ${brief.byteLength} bytes`);
  const text = brief.toString('utf8');
  assert.match(text, /`mask`/);
  assert.match(text, /never read out/);
  assert.match(text, /coarse_language/);
});

test("the lane instruction is authored in English and asks for exactly the shape the lane checks", async () => {
  const instruction = await readFile(join(ROOT, 'content/setup/npc-voice.md'), 'utf8');
  assert.match(instruction, /\{"voice": \{"mask": "<one line>", "exchanges": \["<stranger> → <reply>", "<stranger> → <reply>", "<stranger> → <reply>"\]\}\}/);
  assert.match(instruction, /200 characters/);
  assert.match(instruction, /taken_masks/);
  assert.match(instruction, /play_language/);
  assert.match(instruction, /coarse_language/);
  // `content/setup/**` is system content and is guarded against CJK by tests/kernel/test_system_language.py,
  // so the two-mouths example lives here in English and verbatim in the package's own agent.md.
  assert.match(instruction, /Same thought, two mouths/);
});

/**
 * `shape: "lines"` (§40.5) and the kernel that accepts it are one change, pinned together here.
 *
 * `validateVocabulary` in `kernel-ts/read/mods.ts` decides which field names a contributed profile
 * key may carry. A manifest that declared `shape` before the kernel knew it used to throw out of
 * `readModCatalog` and take the whole builtin catalog with it — every `table.open` and every
 * `table.player_input` refused (measured 2026-09-15; `material-identity.test.mjs` hung rather than
 * failed). That blast radius is gone: contract §28.9 makes a field name this build does not know
 * disable its own package and raise one operator notice (`mod-build-skew.test.mjs`). The pair must
 * still land together — a package this build cannot read is a package that does not run — so this
 * asserts it in both directions, and goes red on whichever half lands alone.
 */
test('the package declares §40.5 `shape` exactly when the kernel accepts one (both words, §40.7)', async t => {
  const api = await loader(t);
  const files = await api.packageFiles(PACKAGE);
  const manifest = JSON.parse(new TextDecoder().decode(files.get('mod.json')));
  const declared = manifest.contributes.vocabulary.actor_profile_keys[0].shape;
  manifest.contributes.vocabulary.actor_profile_keys[0].shape = 'lines';
  const probe = new Map(files);
  probe.set('mod.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  let loaded;
  const refusal = await Promise.resolve()
    .then(() => { loaded = api.manifestFrom(probe); })
    .then(() => undefined, value => value);
  if (declared === undefined) {
    // A build that does not know `shape` records a `kernel_gap` instead of throwing (§28.9), so the
    // probe comes back as a manifest that is disabled rather than as a refusal: either way this half
    // has landed alone and the package must declare what the kernel now reads.
    assert.ok(refusal || loaded?.kernel_gap,
      'the kernel accepts `shape` now: declare it on voice_mask and exchanges in mod.json (§40.7)');
    return;
  }
  assert.equal(declared, 'lines');
  assert.equal(refusal, undefined, 'mod.json declares `shape` but the kernel still refuses it (§40.5)');
});
