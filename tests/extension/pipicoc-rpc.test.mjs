import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keeperArguments } from '../../pipicoc/rpc.mjs';
import { registerSheetPanel } from '../../pipicoc/sheet.ts';

/** A content root of this build's own shape: declared languages, and one surface per language. */
async function contentRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pipicoc-words-'));
  await writeFile(join(root, 'languages.json'), JSON.stringify({default: 'zz',
    languages: {zz: {autonym: 'Zz'}, en: {autonym: 'English'}}}));
  for (const tag of ['zz', 'en']) {
    await mkdir(join(root, 'ui', tag), {recursive: true});
    await writeFile(join(root, 'ui', tag, 'sheet.json'), JSON.stringify({clues: `${tag} clues`}));
  }
  return root;
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
  for (const name of ['kernel','mods','onboarding','module','memory','table'])
    assert.equal(result.filter(v => v === `/repo/build/extensions/${name}/index.mjs`).length, 1);
  assert.equal(result.filter(v => v === '/repo/build/pipicoc/agent.mjs').length, 1);
  assert.ok(!result.some(value => value.startsWith('/repo/') && value.endsWith('.ts')));
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
  pi.events.emit('coc:kernel-bridge', {runtime: {contentRoot: root}, call: undefined});
  const closed = await sheet();
  assert.equal(closed.code, 'table_not_open');
  assert.equal(closed.ui.tag, 'zz', 'a session with no campaign reads in the language the data calls the default');
  assert.equal(closed.ui.words.sheet.clues, 'zz clues');
  let answer = {play_language: 'en', labels: {}};
  let failure;
  pi.events.emit('coc:kernel-bridge', {runtime: {contentRoot: root},
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
  // A kernel refusal keeps its own code; the panel looks that word up, not this English message.
  failure = Object.assign(new Error('The turn is closed'), {code: 'turn_closed'});
  const refused = await sheet();
  assert.equal(refused.status, 'error');
  assert.equal(refused.code, 'turn_closed');
  assert.equal(refused.reason, 'The turn is closed');
  assert.equal(refused.ui.tag, 'en', 'a failed read still says which words the panel should draw');
  failure = new Error('the kernel went away');
  assert.equal((await sheet()).code, 'kernel_error');
});
