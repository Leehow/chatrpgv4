/**
 * The portrait mount's host lane (contract §22.7, the 2026-09-11-later decision).
 *
 * The vendor boundary is stubbed at the seam `registerSheetPanel` exposes, so the suite is
 * deterministic: what is verified is the lane's own contract -- the prompt it builds, the one
 * file per campaign it writes, the data-URL transport, and the refusal codes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSheetPanel } from '../../pipicoc/sheet.ts';

/** The pack's invoke handlers, registered on the well-known registry the way PipiUI does. */
function sheetHandlers(deps) {
  const symbol = Symbol.for('pipiui.ext-invoke.registry');
  const prior = globalThis[symbol];
  const handlers = new Map();
  globalThis[symbol] = {version: 1, register(_id, method, handler) {handlers.set(method, handler); return () => {};}};
  const pi = {events: new EventEmitter(), on() {}};
  try {registerSheetPanel(pi, deps);} finally {globalThis[symbol] = prior;}
  return {pi, sheet: handlers.get('sheet')};
}

const VIEW = {
  play_language: 'en',
  investigators: [{name: 'Test investigator', era: '1920s',
    backstory: {personal_description: 'a tall man with a scar over one eye'}}],
};

async function table({generate, view = VIEW} = {}) {
  const home = await mkdtemp(join(tmpdir(), 'pipicoc-portrait-'));
  await mkdir(join(home, '.coc', 'campaigns', 'c1'), {recursive: true});
  const {pi, sheet} = sheetHandlers({generatePortrait: generate});
  pi.events.emit('coc:kernel-bridge', {campaign: 'c1',
    runtime: {contentRoot: home, home, signal: new AbortController().signal},
    call: async (method) => {assert.equal(method, 'table.view'); return view;}});
  return {home, sheet};
}

test('generate writes one campaign file and answers with it as a data URL', async () => {
  const prompts = [];
  const {home, sheet} = await table({generate: async (_ctx, request) => {
    prompts.push(request);
    return {bytes: Buffer.from('first'), mime: 'image/png'};
  }});
  const answer = await sheet({portrait: 'generate'});
  assert.equal(answer.status, 'ready');
  assert.equal(answer.campaign, 'c1');
  assert.match(answer.identity_art.portrait, /^data:image\/png;base64,/);
  assert.match(answer.identity_art.backplate, /^data:image\/png;base64,/, 'the full block comes back, the panel caches it wholesale');
  // The prompt is the fixed style and the era in the lane, the description verbatim from the sheet.
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].prompt, /^1920s sepia archival portrait photograph/);
  assert.match(prompts[0].prompt, /1920s/);
  assert.match(prompts[0].prompt, /a tall man with a scar over one eye$/);
  assert.deepEqual(await readFile(join(home, '.coc', 'campaigns', 'c1', 'portrait.png'), 'utf8'), 'first');
  assert.deepEqual(await readdir(join(home, '.coc', 'campaigns', 'c1')), ['portrait.png'], 'one file per campaign');
});

test('regenerating overwrites, whatever format the last run left', async () => {
  const {home, sheet} = await table({generate: async () => ({bytes: Buffer.from('second'), mime: 'image/jpeg'})});
  await writeFile(join(home, '.coc', 'campaigns', 'c1', 'portrait.png'), 'stale');
  const answer = await sheet({portrait: 'generate'});
  assert.match(answer.identity_art.portrait, /^data:image\/jpeg;base64,/);
  assert.deepEqual(await readdir(join(home, '.coc', 'campaigns', 'c1')), ['portrait.jpg']);
});

test('a read attaches the stored portrait, and only when artwork is requested', async () => {
  const {home, sheet} = await table();
  await writeFile(join(home, '.coc', 'campaigns', 'c1', 'portrait.jpg'), 'kept');
  assert.equal((await sheet({})).identity_art, undefined);
  const decorated = await sheet({include_identity_art: true});
  assert.equal(decorated.identity_art.portrait,
    `data:image/jpeg;base64,${Buffer.from('kept').toString('base64')}`);
  assert.deepEqual(Object.keys(decorated.identity_art), ['backplate', 'seal', 'portrait']);
});

test('an investigator without a description refuses with its code and writes nothing', async () => {
  const view = {play_language: 'en', investigators: [{name: 'No description', backstory: {}}]};
  const {home, sheet} = await table({view, generate: async () => {throw new Error('must not be called');}});
  const answer = await sheet({portrait: 'generate'});
  assert.equal(answer.status, 'error');
  assert.equal(answer.code, 'portrait_no_description');
  assert.deepEqual(await readdir(join(home, '.coc', 'campaigns', 'c1')), []);
});

test('a vendor failure answers with an error code and the mount stays empty', async () => {
  const {home, sheet} = await table({generate: async () => {throw new Error('no credential anywhere');}});
  const answer = await sheet({portrait: 'generate'});
  assert.equal(answer.status, 'error');
  assert.equal(answer.code, 'portrait_unavailable');
  assert.equal(answer.reason, 'no credential anywhere');
  assert.equal(answer.identity_art, undefined);
  assert.deepEqual(await readdir(join(home, '.coc', 'campaigns', 'c1')), []);
});
