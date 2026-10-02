/**
 * A one-investigator table says so on every turn: the book speaks to a group, and so does everything prepared from it.
 *
 * Installed App, Blood Road, 2026-10-02: with one investigator driving alone the opening's owner explained knowing her
 * name by "someone in the car called you", and on a later table locals still said "you people" to a lone salesman. The
 * opening is told the party (§168.2); this is the turn-by-turn half, in the capsule's `known.investigator`.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'party-alone-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'party-alone-api.ts'},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('a party of one carries alone in known.investigator, every turn', async t => {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'alone', locks: api.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  await call('table.player_input', {text: 'I look around.'});
  const answer = await call('table.capsule');
  const capsule = answer.capsule ?? answer;
  assert.match(capsule.known?.investigator?.alone ?? JSON.stringify(Object.keys(capsule)), /Nobody travels with this investigator: people speak to and of them as one person/);
});
