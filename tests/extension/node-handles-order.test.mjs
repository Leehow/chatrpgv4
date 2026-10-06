/**
 * Contract §185.5 and §185.11 NFH-03: `handles.job` offers the nodes nearest the table first, so the first table on a book
 * opens with the lane's handles rather than interim hex. On the real kernel over NFH-02's fixture book with 36 crates whose
 * ids sort ahead of the opening's, so in the graph's order the first job of 32 would hold none of the table's nodes:
 * - the campaign form starts from the active scene: the scene, the people standing there, the clues discoverable at it, then
 *   the scenes routed from it and the people there, then the rest in the graph's order;
 * - after the party moves, from the scene it moved to;
 * - the library form, with no campaign, starts from the opening the book offers.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {interim, readerBook} from './name-free-book.mjs';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'node-handles-order-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

// Artifacts: their ids sort ahead of every clue, person and scene, and the published graph keeps its nodes in id order.
const CRATES = Array.from({length: 36}, (_, index) => ({node_id: `artifact-crate-${index + 1}`, node_kind: 'artifact', name: `Crate ${index + 1}`,
	source_refs: [{page: 3}], summary: 'A crate in the cellar.'}));
const CLUE = {node_id: 'clue-tar-stain', node_kind: 'clue', name: 'Tar stain', source_refs: [{page: 1}], summary: 'Fresh tar on the planks.'};
const FERRYMAN = {node_id: 'npc-ferryman', node_kind: 'npc', name: 'Ferryman', source_refs: [{page: 2}], summary: 'Rows people out to the tower.'};
const TABLE = ['scene-dock', 'npc-old-mae', 'clue-tar-stain', 'scene-tower', 'npc-ferryman'];

/** The crates come first in the graph; the opening, its clue and the ferryman at the tower after them. */
const buried = t => readerBook(api, {root, temporary, t, seed: 'node-handles-order', before: CRATES, after: [CLUE, FERRYMAN], claims: [
	{subject_id: 'clue-tar-stain', predicate: 'discoverable-at', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: [{page: 1}]},
	{subject_id: 'npc-ferryman', predicate: 'present-in', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: [{page: 2}]}]});

/** The job's node ids, after checking the cut matters: a full job that leaves crates for the next one. */
function offered(job) {
	const ids = job.nodes.map(node => node.id);
	assert.equal(ids.length, 32, 'one job of HANDLES_PER_JOB nodes');
	assert.ok(CRATES.some(crate => !ids.includes(crate.node_id)), 'some crates wait for the next job');
	return ids;
}

test('§185.5: in graph order the table\'s nodes come last; the campaign form offers the active scene and what stands around it first', async t => {
	const book = await buried(t);
	// The book's own order: every node of the table sits past the first job.
	const meta = JSON.parse(await readFile(join(book.home, '.coc', 'modules', book.mid, 'module.json'), 'utf8'));
	const order = JSON.parse(await readFile(join(book.home, '.coc', 'modules', book.mid, meta.graph_file), 'utf8')).nodes.map(node => node.node_id);
	for (const id of TABLE) assert.ok(order.indexOf(id) >= 32, `${id} at ${order.indexOf(id)} in the graph's order`);
	const c1 = await book.campaign('c1');
	const ids = offered(await c1.call('handles.job'));
	assert.deepEqual(ids.slice(0, TABLE.length), TABLE, 'the dock, Old Mae there, its clue, the tower routed from it and the ferryman there');
	// The rest keep the graph's order.
	assert.deepEqual(ids.slice(TABLE.length), order.filter(id => id.startsWith('artifact-crate-')).slice(0, 32 - TABLE.length));
});

test('§185.5: after the party moves, the scene it stands in comes first, with whoever the world says stands there', async t => {
	const book = await buried(t);
	const c1 = await book.campaign('c1', {seated: true});
	await c1.call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
	await c1.call('table.player_input', {text: 'I walk out to the tower, and the old woman comes along.'});
	// The book puts Old Mae on the dock; the table walks her to the tower.
	await c1.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'Tower'}, {kind: 'npc', name: interim('npc', 'npc-old-mae'), to: 'here'}]});
	const world = await c1.file('world.json');
	assert.equal(world.active_scene, interim('scene', 'scene-tower'), 'the party left the opening');
	assert.equal(world.npc_presence[interim('npc', 'npc-old-mae')], world.active_scene);
	const ids = offered(await c1.call('handles.job'));
	assert.deepEqual(ids.slice(0, 3), ['scene-tower', 'npc-old-mae', 'npc-ferryman'], 'the tower, Old Mae standing there now, and the ferryman the book puts there');
});

test('§185.5: the library form, with no campaign, offers the book\'s opening and what stands around it first', async t => {
	const book = await buried(t);
	const ids = offered(await book.raw('handles.job', {module: book.mid}));
	assert.deepEqual(ids.slice(0, TABLE.length), TABLE);
});
