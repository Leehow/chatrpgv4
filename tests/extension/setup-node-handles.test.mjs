/** Contract §185.14: kernel-ts/read/node-handles.ts and kernel-ts/write/index.ts keep an unread opening resolvable. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile, access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {readerBook} from './name-free-book.mjs';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..');
const temporary = playtestScratch('setup-node-handles');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {createWriteRuntime} from './kernel-ts/write/index.ts';
export {createModuleRuntime} from './kernel-ts/modules/index.ts';
export {createSetupHandlers} from './kernel-ts/setup/index.ts';
export {pythonJsonDumps} from './kernel-ts/json.ts';
export {loadModule} from './kernel-ts/read/campaign.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const NAMED = [{id: 'scene-dock', handle: 'tar-smelling-dock'}, {id: 'npc-old-mae', handle: 'net-mender-by-the-water'}];

async function pending(t, id) {
	const book = await readerBook(api, {root, temporary, t, seed: 'setup-handles'});
	await book.raw('handles.job', {module: book.mid});
	await book.raw('handles.submit', {module: book.mid, entries: NAMED});
	let ready = false;
	// Only material readiness is controlled: campaign writes, graph resolution and setup are the real kernel owners.
	const modules = api.createModuleRuntime(book.context);
	t.after(() => modules.close());
	const writer = api.createWriteRuntime(book.context, {openingReady: async () => ready, sourceGraphPath: modules.source.graphPath});
	const setup = api.createSetupHandlers(book.context, writer);
	const created = await writer.handlers['campaign.create']({id, module: book.mid, start_scene: 'scene-dock', play_language: 'en'});
	assert.ok(!api.pythonJsonDumps(created).includes('"scene-dock"'), 'the public creation result never exposes the private node map');
	assert.ok(!api.pythonJsonDumps(created).includes('"npc-old-mae"'), 'the guide identity stays in the private binding');
	const directory = join(book.home, '.coc/campaigns', id);
	const file = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
	const call = (method, params = {}) => setup[method]({campaign: id, ...params});
	return {...book, writer, directory, file, call, ready: () => { ready = true; }};
}

test('a named opening and its guide resolve through setup before the material can create a world', async t => {
	const table = await pending(t, 'waiting');
	await assert.rejects(access(join(table.directory, 'world.json')), {code: 'ENOENT'});
	assert.equal((await table.file('campaign.json')).opening_scene, NAMED[0].handle);
	// A new graph load, as a restarted setup host does, must resolve the reference creation saved.
	const graph = (await api.loadModule(table.context, table.mid, 'waiting')).graph;
	assert.equal(graph.scene(NAMED[0].handle).node_id, 'scene-dock');
	assert.equal(graph.npc(NAMED[1].handle).node_id, 'npc-old-mae');
	assert.deepEqual(await table.call('setup.prologue', {scene: NAMED[0].handle, guide: NAMED[1].handle,
		text: 'The net mender greets the investigator.', handoff: 'Choose an investigator.'}), {recorded: true});
	await assert.rejects(access(join(table.directory, 'world.json')), {code: 'ENOENT'});
});

test('the first setup world retains its earlier bindings and preserves the recorded prologue', async t => {
	const table = await pending(t, 'promotion');
	await table.call('setup.prologue', {scene: NAMED[0].handle, guide: NAMED[1].handle, text: 'A greeting.'});
	table.ready();
	const campaign = await table.writer.campaign({campaign: 'promotion'}, {requireWorld: false, requireTurn: false});
	const meta = await campaign.readCampaign();
	assert.equal(await table.writer.startSetupWorld(campaign, meta), true);
	const world = await table.file('world.json'), saved = await table.file('campaign.json');
	assert.equal(world.active_scene, NAMED[0].handle);
	assert.equal(world.node_handles['npc-old-mae'], NAMED[1].handle);
	assert.equal(world.npc_presence[NAMED[1].handle], NAMED[0].handle);
	assert.equal(saved.setup.prologue.opening, 'A greeting.');
	assert.equal(Object.hasOwn(saved.setup, 'node_handles'), false);
	assert.equal((await api.loadModule(table.context, table.mid, 'promotion')).graph.scene(saved.opening_scene).node_id, 'scene-dock');
});

test('an already stranded campaign recovers exact accepted handles without fabricating a world', async t => {
	const table = await pending(t, 'older');
	const meta = await table.file('campaign.json');
	if (meta.setup) delete meta.setup.node_handles;
	await writeFile(join(table.directory, 'campaign.json'), JSON.stringify(meta));
	assert.deepEqual(await table.call('setup.prologue', {scene: NAMED[0].handle, guide: NAMED[1].handle, text: 'A recovered greeting.'}), {recorded: true});
	await assert.rejects(access(join(table.directory, 'world.json')), {code: 'ENOENT'});
	assert.equal((await table.file('campaign.json')).setup.node_handles['scene-dock'], NAMED[0].handle);
	assert.equal((await table.file('campaign.json')).setup.prologue.opening, 'A recovered greeting.');
});

test('a world map remains authoritative even if interrupted cleanup left setup bindings behind', async t => {
	const table = await pending(t, 'world-wins');
	table.ready();
	const campaign = await table.writer.campaign({campaign: 'world-wins'}, {requireWorld: false, requireTurn: false});
	await table.writer.startSetupWorld(campaign, await campaign.readCampaign());
	const meta = await table.file('campaign.json');
	meta.setup = {...meta.setup, node_handles: {'scene-dock': 'obsolete-setup-dock'}};
	await writeFile(join(table.directory, 'campaign.json'), JSON.stringify(meta));
	const graph = (await api.loadModule(table.context, table.mid, 'world-wins')).graph;
	assert.equal(graph.handle(graph.scene('scene-dock')), NAMED[0].handle);
	await assert.rejects(Promise.resolve().then(() => graph.scene('obsolete-setup-dock')), error => error.code === 'unknown_entity');
});
