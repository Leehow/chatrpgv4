/** §264.20: a present person the table already calls by a word has been met; presence alone, or a word alone, has not. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'obligation-meeting-'));
after(() => rm(bundleDir, {recursive: true, force: true}));
await build({stdin: {contents: "export {meetingMet, nextStep} from './kernel-ts/read/obligations.ts';", resolveDir: root, sourcefile: 'obligation-meeting-api.ts', loader: 'ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const {meetingMet, nextStep} = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const person = {node_id: 'npc-arty', node_kind: 'npc', name: 'Arty Wilmot'}, scene = {node_id: 'scene-globe', node_kind: 'scene', name: 'Globe'};
const obligation = {node_id: 'rule-access', properties: {obligation: {scene: 'scene-globe', demand: [{kind: 'meet', npc: 'npc-arty'}, {kind: 'check', skill: 'Persuade'}]}}};
const nodes = new Map([[person.node_id, person], [scene.node_id, scene]]);
const graph = {nodes, handle: node => ({'npc-arty': 'arty-wilmot', 'scene-globe': 'newspaper-morgue'})[node.node_id]};
const here = {npc_presence: {'arty-wilmot': 'newspaper-morgue'}};

test('§264.20: the untold word a present person is shown by counts as the table naming them', () => {
  assert.equal(meetingMet(graph, {...here, person_epithets: {'arty-wilmot': {word: 'the door-keeper'}}}, obligation, 'npc-arty'), true);
  assert.equal(nextStep(graph, {...here, person_epithets: {'arty-wilmot': {word: 'the door-keeper'}}}, obligation).kind, 'check', 'the check is next');
  assert.equal(meetingMet(graph, {...here, person_labels: {'arty-wilmot': {en: 'Arty'}}}, obligation, 'npc-arty'), true, 'a registered label still counts');
  assert.equal(meetingMet(graph, here, obligation, 'npc-arty'), false, 'present but never called anything is not yet met');
  assert.equal(meetingMet(graph, {person_epithets: {'arty-wilmot': {word: 'the door-keeper'}}}, obligation, 'npc-arty'), false, 'a word for someone elsewhere is not a meeting');
});
