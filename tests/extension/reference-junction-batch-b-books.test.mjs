/**
 * Contract §188.4, batch B (NR-04b), on the books that need their own fixture:
 *
 * - the material gate's pre-pass, on a reader-built book (§22.4.7.1): an `npc` effect that names a book person by this
 *   table's word meets the gate as that person, so the person whose record is not read yet is held for it, exactly as when
 *   the book's name or the handle names him;
 * - an `apply ruling` anchor after a fold (§185.6.1: `rulings.jsonl` is append-only and keeps the interim handle): the ruling
 *   still surfaces where its person stands;
 * - `lookup kind=module` on a legacy campaign (§185.3): a handle the request's rename rewrote (`<word>-house`) is found as
 *   the entity it names, as every other entrance reads it.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {interim, readerBook} from './name-free-book.mjs';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'junction-b-books-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

// The rulebook Haunting with Knott's house and ledger, whose handles begin with his (legacy-rename-round-trip's fixture).
const content = join(temporary, 'content'), MODULE = 'junction-b-rename', KNOTT = 'steven-knott', HOUSE = 'steven-knott-house', LEDGER = 'steven-knott-ledger';
await mkdir(join(content, 'starters'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
for (const name of await readdir(join(root, 'content/starters'))) await symlink(join(root, 'content/starters', name), join(content, 'starters', name));
await cp(join(root, 'content/starters/the-haunting-rulebook'), join(content, 'starters', MODULE), {recursive: true});
await cp(join(root, 'content/starters/the-haunting/pregens'), join(content, 'starters', MODULE, 'pregens'), {recursive: true});
{
	const path = join(content, 'starters', MODULE, 'module-graph.json'), graph = JSON.parse(await readFile(path, 'utf8'));
	graph.module_id = MODULE;
	const hall = graph.nodes.find(node => node.node_id === 'scene-hall-of-records'), clue = graph.nodes.find(node => node.node_kind === 'clue');
	graph.nodes.push({...structuredClone(hall), node_id: `scene-${HOUSE}`, name: "Knott's house", aliases: [], summary: "Knott's narrow brick house.",
		properties: {runtime_projection: {document: 'story-graph.json', collection: 'scenes', record: {scene_id: HOUSE, display_name: "Knott's house", is_start: false, is_final: false}}}});
	graph.nodes.push({...structuredClone(clue), node_id: `clue-${LEDGER}`, name: "Knott's rent ledger", aliases: [], summary: 'The rents Knott took from the house, year by year.'});
	graph.relations.push(
		{relation_id: 'rel-intro-to-house', relation_kind: 'may-lead-to', from_node_id: 'scene-introduction', to_node_id: `scene-${HOUSE}`, claim_id: null, properties: {}},
		{relation_id: 'rel-ledger-at-intro', relation_kind: 'discoverable-at', from_node_id: `clue-${LEDGER}`, to_node_id: 'scene-introduction', claim_id: null, properties: {}});
	await writeFile(path, JSON.stringify(graph));
}
const WORD = '戴圆眼镜的房东';

// A harbormaster the opening read publishes and does not make ready: his record is still to be read.
const QUINT = {node_id: 'npc-harbormaster-quint', node_kind: 'npc', name: 'Harbormaster Quint', source_refs: [{page: 2}], summary: 'The harbormaster, in oilskins.'};

test('§188.4: the material gate holds a book person named by the table\'s word, as it holds him by his name or handle', async t => {
	const book = await readerBook(api, {root, temporary, t, seed: 'junction-b-gate', after: [QUINT]});
	const c = await book.campaign('c1', {seated: true}), quint = interim('npc', QUINT.node_id);
	await c.call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
	await c.call('table.player_input', {text: 'I wave to the man in oilskins.'});
	await c.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'person', who: 'Harbormaster Quint', name: 'the man in oilskins'}]});
	let n = 2;
	const place = (name, extra = {}) => c.call('table.apply', {call_id: `t1-c${n++}`, effects: [{kind: 'npc', name, to: 'here', why: 'he walks up', ...extra}]});
	for (const name of ['the man in oilskins', 'Harbormaster Quint', quint])
		await assert.rejects(place(name), error => {
			assert.deepEqual([error.details?.reason, error.details?.read?.focus], ['material_pending', quint], `${name}: ${error.message}`);
			return true;
		});
	assert.equal(JSON.parse(await readFile(join(book.home, '.coc/campaigns/c1/world.json'), 'utf8')).npc_presence[quint], undefined, 'nobody placed him');
	// Another person, whose record is read, is not held; nor is a newcomer this table brings in.
	await place('Old Mae');
	await place('a girl with a bucket', {walk_on: true});
});

test('§188.4: a ruling anchored on a person before a fold still surfaces where she stands after it', async t => {
	const book = await readerBook(api, {root, temporary, t, seed: 'junction-b-fold'});
	const c = await book.campaign('c1', {seated: true}), mae = interim('npc', 'npc-old-mae');
	await c.call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
	await c.call('table.player_input', {text: 'I haggle with the net mender.'});
	const ruled = await c.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'ruling', name: 'mae-haggle', statement: 'Haggling with her is Hard.', anchor: {entities: ['Old Mae']}}]});
	const receipt = (await c.call('table.status')).receipts.find(row => row.id === ruled.receipts[0]);
	assert.deepEqual(receipt.anchor.entities, [mae], 'stored under the handle she has now');
	await c.call('table.narrate', {call_id: 't1-c2', text: 'She shakes her head.'});
	const rulings = async text => (await c.call('table.player_input', {text})).capsule.rulings.map(row => row.name);
	assert.deepEqual(await rulings('I try again.'), ['mae-haggle']);
	assert.deepEqual((await c.call('handles.submit', {entries: [{id: 'npc-old-mae', handle: 'net-mender-by-the-water'}, {id: 'scene-dock', handle: 'tar-smelling-dock'}]})).refused, []);
	await c.call('table.narrate', {call_id: 't2-c1', text: 'She shrugs.'});
	assert.deepEqual(await rulings('I try once more.'), ['mae-haggle'], 'after the fold, under her final handle');
	assert.equal(JSON.parse(await readFile(join(book.home, '.coc/campaigns/c1/world.json'), 'utf8')).node_handles['npc-old-mae'], 'net-mender-by-the-water');
});


test('§188.4: lookup kind=module finds a handle the rename rewrote as the entity it names', async t => {
	const home = await mkdtemp(join(temporary, 'home-'));
	const kernel = await api.createKernelContext({workspace: home, content, seed: 'junction-b-lookup', locks: api.nativeAdvisoryLocks(),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: MODULE, pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	await call('table.open');
	assert.deepEqual((await call('epithets.submit', {entries: [{id: KNOTT, word: WORD}]})).refused, []);
	// The lane's word reaches the world at the turn's safe moment (§176.1).
	await call('table.narrate', {call_id: 't0-c1', text: '雨停了。'});
	await call('table.player_input', {text: '我四处看看。'});
	const found = async (query, expected_kind) => (await call('table.lookup', {kind: 'module', query, ...(expected_kind ? {expected_kind} : {})})).entities.map(row => row.name);
	for (const query of [HOUSE, "Knott's house", `${WORD}-house`]) assert.deepEqual(await found(query), [HOUSE], query);
	assert.deepEqual(await found(`${WORD}-house`, 'scene'), [HOUSE]);
	assert.deepEqual(await found(`${WORD}-ledger`), [LEDGER], 'another entity is that other entity');
	assert.deepEqual(await found(`${WORD}-house`, 'clue'), [], 'not a clue');
	const missing = await call('table.lookup', {kind: 'module', query: 'the gasworks'});
	assert.deepEqual([missing.entities, missing.status], [[], 'not_found'], 'free text names nothing, as before');
});
