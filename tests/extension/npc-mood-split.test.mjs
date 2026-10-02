/**
 * Contract §161.1: the host sends a mood that shares its npc effect with another change as the two effects the kernel's
 * refusal asks for. Dust to Dust (2026-10-02): `{walk_on, to, stance, mood}` in one effect, refused, then resent split by
 * hand -- a model round trip on two turns running.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';

// kernel-ts imports its siblings as `.js`; the runtime build bundles them, and so does this test.
const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'npc-mood-split-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export {splitNpcMood} from './extensions/kernel/npc-mood-split.ts'; export {MOOD_CONFLICTS} from './kernel-ts/npc/mood.ts';",
  resolveDir: root, sourcefile: 'npc-mood-split-api.ts'}, outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm',
  platform: 'node', target: 'node22', logLevel: 'silent'});
const {splitNpcMood, MOOD_CONFLICTS} = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('a mood beside a move, a stance or a walk-on goes second, as its own effect; the rest is untouched', () => {
  const effects = [
    {kind: 'time', band: 'speak_briefly'},
    {kind: 'npc', name: '守夜人', walk_on: true, to: 'here', stance: 'wary', mood: '先把规矩问清楚。', why: '在场'},
    {kind: 'npc', name: '值班警官', mood: '语气更硬。'},
    {kind: 'npc', name: '值班警官', to: 'here'},
  ];
  assert.equal(splitNpcMood(effects), 1);
  assert.deepEqual(effects, [
    {kind: 'time', band: 'speak_briefly'},
    {kind: 'npc', name: '守夜人', walk_on: true, to: 'here', stance: 'wary', why: '在场'},
    {kind: 'npc', name: '守夜人', mood: '先把规矩问清楚。'},
    {kind: 'npc', name: '值班警官', mood: '语气更硬。'},
    {kind: 'npc', name: '值班警官', to: 'here'},
  ]);
  for (const key of MOOD_CONFLICTS) {
    const one = [{kind: 'npc', name: 'x', mood: 'm', [key]: 1}];
    assert.equal(splitNpcMood(one), 1, key);
    assert.deepEqual(one.map(effect => Object.keys(effect).includes('mood')), [false, true]);
  }
  assert.equal(splitNpcMood(undefined), 0);
  assert.equal(splitNpcMood([{kind: 'item', mood: 'm', to: 'x'}]), 0, 'only npc effects');
});

test('the kernel extension splits the Keeper\'s own apply before admission, never a host call', () => {
  const source = readFileSync(new URL('../../extensions/kernel/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('const moodSplit = spec.name === "apply" && !host ? splitNpcMood(params.effects) : 0;'));
  assert.ok(source.indexOf('splitNpcMood(params.effects)') < source.indexOf('leaveOutUnknownOwed(params.effects'), 'before the owed pass and admission');
});
