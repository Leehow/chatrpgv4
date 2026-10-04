/**
 * Contract §180.6 with §87.1: a creature the table declared on one worldline survives a merge, as a table person does, and
 * its pinned catalog block travels with it. Before this the merge unioned `table_people` only, so a dog declared on the
 * second line vanished, or came back without the numbers it fights with.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'table-creature-merge-'));
after(() => rm(bundleDir, {recursive: true, force: true}));
await build({stdin: {contents: `export {report} from './kernel-ts/worldline/confluence-plan.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`, resolveDir: root, sourcefile: 'table-creature-merge-api.ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const scene = {node_id: 'scene-yard', node_kind: 'scene', name: 'Yard', visibility: 'player-safe', aliases: [], summary: 'A yard.',
  evidence_span_ids: [], properties: {}, source_refs: []};
const graph = new api.ModuleGraph('merge-bench', {nodes: [scene], claims: [], relations: []}, 'merge-bench', {});
const DOG = 'the yard dog', MULE = 'the mule', PORTER = 'the porter';
const dogBlock = {authority: 'table_pinned', catalog: 'Dog', characteristics: {STR: 40, CON: 60, SIZ: 25, DEX: 65, POW: 35}, derived: {HP: 8}};
const porterBlock = {authority: 'table_pinned', archetype: 'ordinary_adult', characteristics: {STR: 50}};

function world(extra) {
  return {active_scene: 'yard', visited_scenes: [], discovered_clues: [], discovered_echoes: [], handouts_shown: [], maps_presented: [],
    clock: {minutes: 0}, flags: {}, npc_presence: {}, ...extra};
}
const state = (line, extra) => ({line, world: world(extra), party: {}, candidates: [], spent: new Set(), engines: {}});

test('§180.6: a creature declared on the second line joins the merge with its pinned block', () => {
  const main = state('main', {table_creatures: [{name: MULE, turn: 2, catalog: true}]});
  const side = state('side', {
    table_creatures: [{name: DOG, turn: 5, catalog: 'Dog'}, {name: MULE, turn: 7, catalog: true}],
    table_people: [{name: PORTER, turn: 6}],
    npc_profiles: {[DOG]: dogBlock, [PORTER]: porterBlock},
  });
  const merged = api.report(graph, [main, side], null).world;
  assert.deepEqual(merged.table_creatures.map(record => [record.name, record.turn]), [[MULE, 2], [DOG, 5]],
    'a union by name; the first line to declare one keeps its record');
  assert.deepEqual(merged.npc_profiles[DOG], dogBlock, 'the dog\'s catalog block comes with it from the line that declared it');
  assert.ok(!(PORTER in merged.npc_profiles), 'only a creature\'s catalog block is carried; a person\'s pins are not this rule\'s');
  assert.ok(!(merged.table_people ?? []).some(person => person.name === DOG), 'a creature never joins the people');
});

test('§180.6: a block the merged line already holds is kept, not replaced by another line\'s', () => {
  const ownBlock = {...dogBlock, characteristics: {...dogBlock.characteristics, STR: 30}};
  const main = state('main', {table_creatures: [{name: DOG, turn: 3, catalog: 'Dog'}], npc_profiles: {[DOG]: ownBlock}});
  const side = state('side', {table_creatures: [{name: DOG, turn: 4, catalog: 'Dog'}], npc_profiles: {[DOG]: dogBlock}});
  const merged = api.report(graph, [main, side], null).world;
  assert.deepEqual(merged.npc_profiles[DOG], ownBlock);
});
