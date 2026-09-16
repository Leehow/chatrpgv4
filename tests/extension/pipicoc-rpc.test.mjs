import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keeperArguments } from '../../pipicoc/rpc.mjs';
import { registerSheetPanel } from '../../pipicoc/sheet.ts';

/**
 * A content root of this build's own shape: `en` holds the authored captions, `zz` ships a seed
 * beside them, and the file names which is which (contract §23). There is no registry of tags.
 */
async function contentRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pipicoc-words-'));
  await writeFile(join(root, 'languages.json'), JSON.stringify({source: 'en', default: 'zz', suggested: ['zz', 'en']}));
  await mkdir(join(root, 'setup'), {recursive: true});
  await writeFile(join(root, 'setup/ui-presentation.md'), 'project the captions');
  for (const tag of ['zz', 'en']) {
    await mkdir(join(root, 'ui', tag), {recursive: true});
    await writeFile(join(root, 'ui', tag, 'sheet.json'), JSON.stringify({clues: `${tag} clues`}));
  }
  return root;
}

/**
 * A runtime the panel can read words through and project them with. `runTask` records what it was
 * asked, so a test can tell one background projection from none and from several.
 */
function runtime(contentRoot, home, rounds = [], onTask = () => {}) {
  return {contentRoot, home, signal: new AbortController().signal,
    async runTask(task) {rounds.push(task); onTask(task); return {ok: false};}, rounds};
}

/** The pack's invoke handlers, registered on the well-known registry the way PipiUI does. */
function sheetHandlers() {
  const symbol = Symbol.for('pipiui.ext-invoke.registry');
  const prior = globalThis[symbol];
  const handlers = new Map();
  globalThis[symbol] = {version: 1, register(_id, method, handler) {handlers.set(method, handler); return () => {};}};
  const pi = {events: new EventEmitter(), on() {}};
  try {registerSheetPanel(pi);} finally {globalThis[symbol] = prior;}
  return {pi, sheet: handlers.get('sheet')};
}

test('UI transport survives while coding persona and tools cannot replace the Keeper', () => {
  const result = keeperArguments(['--mode','rpc','--session','/tmp/ui.jsonl',
    '--system-prompt','coding','--append-system-prompt=host','--tools','bash,read',
    '-e','/host/coding.ts','--model','provider/model'], '/repo');
  assert.deepEqual(result.slice(0,6), ['--mode','rpc','--session','/tmp/ui.jsonl','--model','provider/model']);
  assert.ok(!result.includes('coding'));
  assert.ok(!result.includes('/host/coding.ts'));
  const mounted = result.flatMap((value, index) => value === '-e' ? [result[index + 1]] : []);
  assert.deepEqual(mounted, [
    '/repo/build/host/runtime/kernel/pipiui-ext-invoke.mjs',
    ...['kernel','mods','onboarding','module','memory','table','npc-journal','npc-voice'].map(name => `/repo/build/extensions/${name}/index.mjs`),
    '/repo/build/pipicoc/agent.mjs',
    '/repo/build/extensions/image-gen/agent/index.mjs',
  ]);
  assert.ok(!result.some(value => value.startsWith('/repo/') && value.endsWith('.ts')));
  const explicitNoExtensions = keeperArguments(['--no-extensions'], '/repo');
  assert.equal(explicitNoExtensions.filter(value => value === '--no-extensions').length, 2,
    'desktop keeps the user flag and adds its controlled mount gate');
});

test('the sheet sends bundled identity art only when requested, without changing the kernel read', async () => {
  const {pi, sheet} = sheetHandlers();
  const calls = [];
  pi.events.emit('coc:kernel-bridge', {campaign:'c1', call:async (method, params) => {
    calls.push([method, params]);
    return {investigators:[{name:'Test investigator'}]};
  }});
  assert.equal((await sheet()).identity_art, undefined);
  const decorated = await sheet({include_identity_art:true});
  assert.match(decorated.identity_art.backplate, /^data:image\/png;base64,/);
  assert.match(decorated.identity_art.seal, /^data:image\/png;base64,/);
  assert.deepEqual(Object.keys(decorated.identity_art), ['backplate', 'seal']);
  assert.equal((await sheet({})).identity_art, undefined);
  assert.deepEqual(calls, Array.from({length:3}, () => ['table.view', {campaign:'c1'}]));
});

test('the standalone installer places every sheet image beside the copied agent', async () => {
  const installer = await readFile(new URL('../../pipicoc/install', import.meta.url), 'utf8');
  for (const name of ['paper-texture.jpg', 'investigator-backplate.png', 'investigator-seal.png']) {
    assert.match(installer, new RegExp(`['"]${name.replaceAll('.', '\\.')}['"]`), `${name} is installed`);
  }
  assert.match(installer, /join\(destination,'pipicoc\/assets',asset\)/, 'the images sit beside pipicoc/agent.mjs');
});
test('setup uses canonical setup mode and rejects unknown modes or broken arguments', () => {
  assert.equal(keeperArguments(['--mode','rpc'], '/repo', 'setup')[0], 'setup');
  assert.throws(() => keeperArguments([], '/repo', 'other'));
  assert.throws(() => keeperArguments(['-e'], '/repo'));
});

test('every sheet answer the pack serves carries the words it is drawn with, and a coded reason', async () => {
  const root = await contentRoot();
  const {pi, sheet} = sheetHandlers();
  // Before any bridge there is no content root either, so the answer names no language at all
  // rather than one the build did not choose.
  const nothing = await sheet();
  assert.deepEqual(nothing, {view: null, campaign: null, code: 'table_not_open', reason: 'the table is not open'});
  const home = await mkdtemp(join(tmpdir(), 'pipicoc-home-'));
  pi.events.emit('coc:kernel-bridge', {runtime: runtime(root, home), call: undefined});
  const closed = await sheet();
  assert.equal(closed.code, 'table_not_open');
  assert.equal(closed.ui.tag, 'zz', 'a session with no campaign reads in the language the data calls the default');
  assert.equal(closed.ui.words.sheet.clues, 'zz clues');
  let answer = {play_language: 'en', labels: {}};
  let failure;
  pi.events.emit('coc:kernel-bridge', {runtime: runtime(root, home),
    call: async () => {if (failure) throw failure; return answer;}});
  const unbound = await sheet();
  assert.equal(unbound.code, 'campaign_not_open');
  assert.equal(unbound.ui.tag, 'zz');
  pi.events.emit('coc:table-open', {campaign: 'carried', open: {campaign: {play_language: 'en'}}});
  const ready = await sheet();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.campaign, 'carried');
  assert.equal(ready.ui.tag, 'en');
  assert.equal(ready.ui.words.sheet.clues, 'en clues');
  // A kernel refusal keeps its own code; the panel looks that word up, not this English message --
  // which is what this test said all along, while asserting the message came through anyway.
  //
  // Under §48 it does not. The text of a caught exception never becomes a player-bound message,
  // and no boundary may inspect the string to decide: `The turn is closed` reads like a sentence
  // for a player, `Invalid PDF structure.` reads exactly the same way, and a stack arrives on the
  // same field. So the trade is explicit -- a kernel code whose refusal deserves a word gets that
  // word by being registered in `content/ui/en/errors.json`, where the lane projects it into every
  // language, and not by leaking one language's sentence to everyone.
  failure = Object.assign(new Error('The turn is closed'), {code: 'turn_closed'});
  const refused = await sheet();
  assert.equal(refused.status, 'error');
  assert.equal(refused.code, 'turn_closed');
  assert.equal(refused.reason, 'The table could not be read just now. Nothing was changed; retry the read.');
  assert.notEqual(refused.reason, 'The turn is closed');
  assert.equal(refused.ui.tag, 'en', 'a failed read still says which words the panel should draw');
  failure = new Error('the kernel went away');
  assert.equal((await sheet()).code, 'kernel_error');
});

/**
 * A tag with no words yet is answered at once with the authored ones (§23), and one projection is
 * started for it -- one, however many times the panel reads the sheet, because the sheet is read on
 * every commit and a run per read would run the same lane a dozen times a turn.
 */
test('a tag with no projection is answered in the authored words, and starts exactly one lane run', {timeout:5000}, async () => {
  const root = await contentRoot();
  const home = await mkdtemp(join(tmpdir(), 'pipicoc-home-'));
  const {pi, sheet} = sheetHandlers();
  const rounds = [];
  const started = Promise.withResolvers();
  pi.events.emit('coc:kernel-bridge', {runtime: runtime(root, home, rounds, started.resolve),
    call: async () => ({play_language: 'pt-BR', labels: {}})});
  pi.events.emit('coc:table-open', {campaign: 'carried', open: {campaign: {play_language: 'pt-BR'}}});

  const first = await sheet();
  assert.equal(first.ui.tag, 'pt-BR', 'the answer names the tag the table asked for');
  assert.equal(first.ui.projected, false);
  assert.equal(first.ui.source, 'default');
  assert.equal(first.ui.words.sheet.clues, 'en clues', 'the authored words stand in, never another language\'s');
  await sheet(); await sheet();
  // The lane is started, never awaited: the answer is what the panel draws now, and the projection
  // runs behind it. Observe that runner starting instead of guessing a scheduling delay.
  await started.promise;
  assert.equal(rounds.length, 1, 'three reads, one lane run');
  assert.equal(rounds[0].kind, 'mod');
  assert.equal(JSON.parse(await readFile(join(rounds[0].request.cwd, 'texts.json'), 'utf8')).play_language, 'pt-BR');

  // A tag the build ships a seed for is projected already: it answers projected and starts nothing.
  const seeded = sheetHandlers();
  const seedRounds = [];
  seeded.pi.events.emit('coc:kernel-bridge', {runtime: runtime(root, home, seedRounds),
    call: async () => ({play_language: 'zz', labels: {}})});
  seeded.pi.events.emit('coc:table-open', {campaign: 'carried', open: {campaign: {play_language: 'zz'}}});
  const shipped = await seeded.sheet();
  assert.equal(shipped.ui.projected, true);
  assert.equal(shipped.ui.source, 'seed');
  assert.equal(shipped.ui.words.sheet.clues, 'zz clues');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(seedRounds, [], 'a shipped seed pays no model call');
});
