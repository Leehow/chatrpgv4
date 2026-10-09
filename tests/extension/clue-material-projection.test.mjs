/** §22.4.9: source-clue invitations expose checked preparation, without bypassing discovery's transaction gate. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {readerBook} from './name-free-book.mjs';
import {playtestScratch} from './playtest-scratch.mjs';
import {buildCandidates} from '../../runtime/jev/candidates.ts';

const root = resolve(import.meta.dirname, '../..');
const temporary = playtestScratch('clue-material-projection');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {loadCampaignModule} from './kernel-ts/read/campaign.ts';
export {recordOf} from './kernel-ts/read/module-graph.ts';
export {cluesHere, whereSection, knownSection} from './kernel-ts/read/capsule.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const clue = {node_id: 'clue-tar', node_kind: 'clue', name: 'Tar on the dock', summary: 'The dock smells of tar.',
  source_refs: [{page: 1}], properties: {delivery_kind: 'observation'}};
const relation = {subject_id: clue.node_id, predicate: 'discoverable-at', object: {node_id: 'scene-dock'},
  truth_status: 'authored-fact', source_refs: [{page: 1}]};

test('a missing source clue offers its same-handle prepare action, then real publication makes it ready', async t => {
  const book = await readerBook(api, {root, temporary, t, seed: 'clue-readiness', after: [clue], claims: [relation]});
  const table = await book.campaign('clue-readiness', {seated: true});
  const before = await table.call('table.look', {focus: 'clues'});
  const offered = before.clues_here.find(row => row.summary === clue.summary);
  assert.ok(offered);
  assert.equal(offered.material, 'missing');
  assert.deepEqual(offered.next, {tool: 'lookup', kind: 'source', source_mode: 'prepare', query: offered.name,
    question: 'Prepare this clue.'});
  assert.match(offered.note, /before discovery/);
  await table.call('table.narrate', {call_id: 't0-c1', text: 'The audit begins.'});
  await table.call('table.player_input', {text: 'I examine the dock.'});
  const options = await table.call('table.apply.options');
  assert.equal(options.candidates.find(row => row.effect.kind === 'clue' && row.effect.clue === offered.name).description.material, 'missing');
  const projected = buildCandidates({applyOptions: options}, 'I examine the dock.').find(row => row.family === 'clue' && row.bound.clue === offered.name);
  assert.equal(projected.detail.material, 'missing');
  assert.deepEqual(projected.detail.next, offered.next);
  await assert.rejects(table.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: offered.name}]}),
    error => error.code === 'needs' && error.details?.reason === 'material_pending');
  const world = await table.file('world.json');
  const module = await api.loadCampaignModule(book.context, book.mid, world, table.id);
  const scene = module.graph.scene(world.active_scene);
  const affordanceScene = {...scene, properties: {...scene.properties, runtime_projection: {...scene.properties.runtime_projection,
    record: {...api.recordOf(scene), affordances: [{id: 'tar', cue: 'Inspect the dock', grants_clue_ids: [clue.node_id]}]}}}};
  const where = api.whereSection(module.graph, world, affordanceScene, module.material);
  assert.equal(where.affordances[0].clues[0].material, 'missing');
  assert.equal(where.affordances[0].clues[0].next.query, offered.name);
  assert.equal(api.knownSection(module.graph, world, scene, [], [], module.material).clues_here[0].material, 'missing');
  await book.raw('module.read.request', {module_id: book.mid, campaign: table.id, purpose: 'detail', focus: offered.name, question: offered.next.question});
  const job = await book.raw('module.read.claim', {module_id: book.mid, campaign: table.id, owner: 'regression-host'});
  const sha = createHash('sha256').update(await readFile(join(book.home, 'harbor.pdf'))).digest('hex');
  await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1], full_pages: [1], review_pages: [1]}));
  await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify({nodes: [clue], claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: [clue.node_id]}));
  await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths: ['/nodes/0', '/coverage'], verdict: 'supported', source_refs: [{page: 1}], reason: 'Controlled component fixture support.'}], missing: []}));
  await book.raw('module.read.finish', {module_id: book.mid, campaign: table.id, job_id: job.job_id, lease: job.lease,
    outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
  const after = (await table.call('table.look', {focus: 'clues'})).clues_here.find(row => row.name === offered.name);
  assert.equal(after.material, 'ready');
  assert.equal(after.next, undefined);
  const applied = await table.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'clue', clue: offered.name}]});
  assert.ok(applied.receipts.some(receipt => receipt.startsWith('clue:')));
});

test('table-created and already-discovered clues get no unnecessary source preparation invitation', async t => {
  const book = await readerBook(api, {root, temporary, t, seed: 'clue-readiness-exempt', after: [clue], claims: [relation]});
  const table = await book.campaign('clue-readiness-exempt', {seated: true});
  const world = await table.file('world.json');
  const module = await api.loadCampaignModule(book.context, book.mid, world, table.id);
  const scene = module.graph.scene(world.active_scene), handle = module.graph.handle(module.graph.nodes.get(clue.node_id));
  const discovered = api.cluesHere(module.graph, {...world, discovered_clues: [handle]}, scene, () => 'missing')[0];
  assert.equal(discovered.material, 'missing');
  assert.equal(discovered.next, undefined);
  const minted = module.graph.addTableEntity({id: 'clue-table-fixture', kind: 'clue', name: 'Wet notebook', summary: 'The audit notebook is wet.', scene: module.graph.handle(scene)});
  const added = api.cluesHere(module.graph, world, scene, () => 'missing').find(row => row.name === module.graph.handle(minted));
  assert.equal(added.material, 'ready');
  assert.equal(added.next, undefined);
});
