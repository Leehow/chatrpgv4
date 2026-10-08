/** §204.6 through the actual visual checker and vocabulary: a portrait has a person identity, with no person-named place. */
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
let temporary, api, contract;
before(async () => {
  temporary = await mkdtemp(join(ROOT, '.tmp/visual-person-'));
  await build({stdin: {contents: "export {checkDraft} from './kernel-ts/modules/visual.ts'; export {loadModuleContract,vocabulary,scopedVocabulary} from './kernel-ts/modules/contract.ts'; export {snapshots} from './kernel-ts/snapshots.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {isPlace,personNamedLocations} from './kernel-ts/read/places.ts';", resolveDir: ROOT},
    outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
  api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
  contract = await api.loadModuleContract({content: join(ROOT, 'content'), snapshots: api.snapshots});
});
after(async () => {if (temporary) await rm(temporary, {recursive: true, force: true});});
const person = {node_id: 'npc-lena-smith', node_kind: 'npc', name: 'Lena Smith', aliases: ['L. Smith'], source_refs: [{page: 1}], properties: {}};
const asset = {node_id: 'asset-portrait', node_kind: 'asset', name: 'Portrait', visibility: 'revealable', source_refs: [{page: 1}], properties: {image_sources: [{page: 1, box: [0, 0, 1, 1]}]}};
const delta = nodes => ({nodes, claims: [], node_refs: [], ready_nodes: [asset.node_id], critical: [], coverage: {}, dependencies: []});
function packet(known = []) {
  const job = {purpose: 'detail', visual_asset: {page: 1}, source: {page_count: 1}, known_nodes: known, known_claims: []};
  return {...job, vocabulary: api.scopedVocabulary(api.vocabulary(contract), job)};
}

test('the real visual vocabulary admits a thin person identity, but no biography or ready person', () => {
  const task = packet();
  assert(task.vocabulary.node_kinds.includes('npc'));
  assert.doesNotThrow(() => api.checkDraft(delta([asset, person]), task, contract, new Set([1])));
  assert.throws(() => api.checkDraft(delta([asset, {...person, properties: {biography: 'A dossier.'}}]), task, contract, new Set([1])), /thin identity|dossier/i);
  assert.throws(() => api.checkDraft({...delta([asset, person]), ready_nodes: [asset.node_id, person.node_id]}, task, contract, new Set([1])), /readiness/i);
});
test('a portrait cannot create a place under a person name or normalized alias already on the roster', () => {
  const location = {node_id: 'location-lena-smith', node_kind: 'location', name: '  l. smith  ', source_refs: [{page: 1}], properties: {}};
  assert.throws(() => api.checkDraft(delta([asset, location]), packet([person]), contract, new Set([1])), /person.*name|person/i);
  assert.doesNotThrow(() => api.checkDraft(delta([asset, {...location, name: 'Smith house'}]), packet([person]), contract, new Set([1])));
});
test('legacy person-named locations are excluded by identity equality, while the house remains a place', () => {
  const location = {node_id: 'location-lena', node_kind: 'location', name: 'lena smith', properties: {}};
  const house = {node_id: 'location-house', node_kind: 'location', name: 'Smith house', properties: {}};
  const graph = new api.ModuleGraph('book', {nodes: [person, location, house], claims: [], relations: []}, '', {});
  assert.deepEqual([...api.personNamedLocations(graph)], [location.node_id]);
  assert.equal(api.isPlace(graph, graph.nodes.get(location.node_id)), false);
  assert.equal(api.isPlace(graph, graph.nodes.get(house.node_id)), true);
});
