/**
 * Contract §185 (owner ruling 2026-10-06, docs/specs/name-free-handles.md): name-free handles, the kernel side (NFH-02).
 *
 * A reader-built book mints node ids from the book's words, and a handle used to be the node id without its kind:
 * `book-4-robert-taylor`. §176.5's request rename hid it and also rewrote identifiers the Keeper copied back (an intention's
 * owner, `book-4-dr-brenner-home`). Here, on the real kernel over a bound three-page PDF read through the reading lane: the
 * scheme fixed at `campaign.create`, the interim handle, `handles.job`'s packet, every refusal of `handles.submit` (a notes
 * rendering of the cast among them), the first writer winning across campaigns, a node given up, and the fold at
 * `campaign.create` taking what the book's `handles.json` holds -- a handle, an ordinal, or nothing yet.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'name-free-handles-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {untoldRoster} from './kernel-ts/read/capsule.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const PAGES = ['The harbor dock smells of tar. Old Mae mends nets by the water.',
	'The old tower stands beyond the harbor. Its keeper, 西拉斯, trims the lamp.',
	'Below the tower a cellar floods at high tide.'];
const REFS = [{page: 1}];
const interim = (kind, id) => `${kind}-${createHash('sha256').update(id).digest('hex').slice(0, 6)}`;

/** A PDF read as far as its opening (the Dock with Old Mae in it, the Tower), and its cast read: one unread keeper. */
async function book(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'name-free-handles',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const pdf = join(home, 'harbor.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: sha}});
	const read = async (purpose, draft, paths) => {
		await raw('module.read.request', {module_id: mid, purpose});
		const job = await raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}], missing: []}));
		return raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor and tower', pages: [[1, 3]], source_refs: [{page: 1}],
		entities: ['Dock', 'Tower']}]}, []);
	await read('opening', {nodes: [
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'},
		{node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: REFS, summary: 'A net mender on the dock.'}],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS},
			{subject_id: 'npc-old-mae', predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-old-mae']},
		['/nodes/0', '/nodes/2', '/claims/0', '/claims/1', '/coverage']);
	// §177.14: the keeper is printed in the book's script; the game's notes call him Silas. Only the notes rendering is Latin.
	const cast = await raw('cast.job', {module_id: mid, claim: true});
	await raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const range = await raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [
		{book: ['Old Mae'], play: ['Old Mae'], notes: ['Old Mae'], pages: [1]},
		{book: ['西拉斯'], play: ['西拉斯'], notes: ['Silas'], pages: [2]}]}));
	assert.equal((await raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	const campaign = async id => {
		await raw('campaign.create', {id, module: mid, play_language: 'en'});
		const file = async name => JSON.parse(await readFile(join(home, '.coc', 'campaigns', id, name), 'utf8'));
		return {id, call: (method, params = {}) => raw(method, {campaign: id, ...params}), meta: () => file('campaign.json'), world: () => file('world.json')};
	};
	const handlesFile = async () => JSON.parse(await readFile(join(home, '.coc', 'modules', mid, 'handles.json'), 'utf8'));
	return {home, raw, mid, campaign, handlesFile};
}
const reasonOf = (answer, id) => answer.refused.find(row => row.id === id)?.reason;

test('§185.1: a campaign on a reader-built book is name-free, a starter campaign legacy; a campaign without the field is read as legacy', async t => {
	const h = await book(t);
	const named = await h.campaign('c1');
	assert.equal((await named.meta()).handles, 'name-free');
	await h.raw('campaign.create', {id: 'starter', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const starterMeta = JSON.parse(await readFile(join(h.home, '.coc', 'campaigns', 'starter', 'campaign.json'), 'utf8'));
	assert.equal(starterMeta.handles, 'legacy');
	assert.deepEqual(await h.raw('handles.job', {campaign: 'starter'}), {job_id: null}, 'a legacy campaign has nothing to ask');
	await assert.rejects(h.raw('handles.submit', {campaign: 'starter', entries: [{id: 'npc-steven-knott', handle: 'landlord'}]}),
		error => error?.details?.reason === 'legacy_handles');
	// A campaign created before §185 has no field: legacy, with no migration.
	const path = join(h.home, '.coc', 'campaigns', 'c1', 'campaign.json'), {handles: _dropped, ...older} = await named.meta();
	await writeFile(path, JSON.stringify(older));
	assert.deepEqual(await named.call('handles.job'), {job_id: null});
});

test('§185.4: before any handle is written, a new campaign shows interim handles, never the book\'s slugs', async t => {
	const h = await book(t);
	const c1 = await h.campaign('c1'), world = await c1.world();
	assert.equal(world.active_scene, interim('scene', 'scene-dock'));
	assert.deepEqual(world.visited_scenes, [interim('scene', 'scene-dock')]);
	assert.deepEqual(world.npc_presence, {[interim('npc', 'npc-old-mae')]: interim('scene', 'scene-dock')});
	assert.deepEqual(world.node_handles, {}, 'the map is empty until a fold takes the book\'s handles');
	assert.equal((await c1.meta()).opening_scene, interim('scene', 'scene-dock'));
	const text = JSON.stringify(world);
	for (const slug of ['"dock"', '"old-mae"', 'npc-old-mae', 'scene-dock']) assert.ok(!text.includes(slug), `${slug} in the world`);
});

test('§185.5: the job lists the book\'s nodes with what the graph says, the cast forms to avoid and the handles taken', async t => {
	const h = await book(t);
	const c1 = await h.campaign('c1');
	const job = await c1.call('handles.job');
	assert.match(job.job_id, /^handles:c1:[0-9a-f]{12}$/);
	const ids = job.nodes.map(node => node.id);
	for (const id of ['scene-dock', 'scene-tower', 'npc-old-mae']) assert.ok(ids.includes(id), id);
	assert.deepEqual(job.nodes.find(node => node.id === 'scene-tower'), {id: 'scene-tower', kind: 'scene', name: 'Tower', summary: 'An old tower beyond the harbor.'});
	assert.ok(job.nodes.every(node => Object.keys(node).join() === 'id,kind,name,summary'), 'nothing but the node\'s own words');
	assert.ok(job.avoid.includes('Old Mae') && job.avoid.includes('Silas') && job.avoid.includes('西拉斯'), JSON.stringify(job.avoid));
	assert.deepEqual(job.taken, []);
	assert.match(job.instruction, /avoid/);
	await c1.call('handles.submit', {entries: [{id: 'scene-tower', handle: 'lighthouse-on-the-point'}]});
	const next = await c1.call('handles.job');
	assert.ok(!next.nodes.some(node => node.id === 'scene-tower'), 'a named node is not asked again');
	assert.deepEqual(next.taken, ['lighthouse-on-the-point']);
});

test('§185.5: submit checks each entry on its own against the closed set of refusals', async t => {
	const h = await book(t);
	const c1 = await h.campaign('c1');
	const first = await c1.call('handles.submit', {entries: [
		{id: 'npc-nobody', handle: 'stranger'},
		{id: 'scene-dock', handle: 'Tar Smelling Dock'},
		{id: 'scene-tower', handle: `tower-${'x'.repeat(60)}`},
		{id: 'npc-old-mae', handle: 'old-mae-with-nets'},
	]});
	assert.deepEqual(first.written, []);
	assert.equal(reasonOf(first, 'npc-nobody'), 'unknown_entity');
	assert.equal(reasonOf(first, 'scene-dock'), 'shape');
	assert.equal(reasonOf(first, 'scene-tower'), 'shape', 'longer than the limit');
	assert.equal(reasonOf(first, 'npc-old-mae'), 'carries_name', 'a name of the graph\'s person');
	assert.ok(first.refused.every(row => typeof row.message === 'string' && row.message), 'each refusal says why');

	const second = await c1.call('handles.submit', {entries: [
		{id: 'scene-tower', handle: 'silas-lamp-tower'},
		{id: 'npc-old-mae', handle: 'npc-1a2b3c'},
		{id: 'scene-dock', handle: 'tower'},
	]});
	assert.equal(reasonOf(second, 'scene-tower'), 'carries_name', 'a notes rendering of an unread person (§177.14)');
	assert.equal(reasonOf(second, 'npc-old-mae'), 'interim_shape');
	assert.equal(reasonOf(second, 'scene-dock'), 'taken', 'another node\'s name');

	const third = await c1.call('handles.submit', {entries: [
		{id: 'scene-dock', handle: 'tar-smelling-dock'},
		{id: 'scene-tower', handle: 'tar-smelling-dock'},
		{id: 'npc-old-mae', handle: 'net-mender-by-the-water'},
	]});
	assert.deepEqual(third.written, [{id: 'scene-dock', handle: 'tar-smelling-dock'}, {id: 'npc-old-mae', handle: 'net-mender-by-the-water'}]);
	assert.equal(reasonOf(third, 'scene-tower'), 'taken', 'another entry of the batch');
	assert.equal(reasonOf(await c1.call('handles.submit', {entries: [{id: 'scene-tower', handle: 'tar-smelling-dock'}]}), 'scene-tower'), 'taken',
		'another node\'s handle in handles.json');
	assert.equal(reasonOf(await c1.call('handles.submit', {entries: [{id: 'scene-dock', handle: 'quay'}]}), 'scene-dock'), 'settled');
	const stored = await h.handlesFile();
	assert.deepEqual(Object.fromEntries(Object.entries(stored.nodes).map(([id, entry]) => [id, entry.handle])),
		{'scene-dock': 'tar-smelling-dock', 'npc-old-mae': 'net-mender-by-the-water'});
	assert.equal((await c1.world()).node_handles['scene-dock'], undefined, 'the lane never writes the world itself (§185.6)');
});

test('§185.5: the book\'s handles.json is shared and the first writer wins; a node given up is not asked again', async t => {
	const h = await book(t);
	const c1 = await h.campaign('c1'), c2 = await h.campaign('c2');
	assert.deepEqual((await c1.call('handles.submit', {entries: [{id: 'scene-dock', handle: 'tar-smelling-dock'}]})).written,
		[{id: 'scene-dock', handle: 'tar-smelling-dock'}]);
	const late = await c2.call('handles.submit', {entries: [{id: 'scene-dock', handle: 'net-strewn-quay'}]});
	assert.equal(reasonOf(late, 'scene-dock'), 'settled', 'another campaign of the book wrote it first');
	assert.ok(!(await c2.call('handles.job')).nodes.some(node => node.id === 'scene-dock'), 'every campaign of the book reuses it');
	const given = await c2.call('handles.submit', {given_up: ['scene-tower', 'scene-nowhere']});
	assert.deepEqual(given.written, [{id: 'scene-tower', given_up: true}]);
	assert.equal(reasonOf(given, 'scene-nowhere'), 'unknown_entity');
	assert.equal((await h.handlesFile()).nodes['scene-tower'].given_up, true);
	assert.ok(!(await c1.call('handles.job')).nodes.some(node => node.id === 'scene-tower'), 'a given-up node is never offered again');
	assert.equal(reasonOf(await c1.call('handles.submit', {entries: [{id: 'scene-tower', handle: 'lighthouse'}]}), 'scene-tower'), 'settled');
});

test('§185.6: campaign.create folds what handles.json holds -- a handle, an ordinal for a node given up, nothing yet for the rest', async t => {
	const h = await book(t);
	const c1 = await h.campaign('c1');
	await c1.call('handles.submit', {entries: [{id: 'scene-dock', handle: 'tar-smelling-dock'}], given_up: ['scene-tower']});
	const c2 = await h.campaign('c2'), world = await c2.world();
	assert.deepEqual(world.node_handles, {'scene-dock': 'tar-smelling-dock', 'scene-tower': 'scene-1'});
	assert.equal(world.active_scene, 'tar-smelling-dock', 'a book other campaigns named starts named');
	assert.deepEqual(world.npc_presence, {[interim('npc', 'npc-old-mae')]: 'tar-smelling-dock'}, 'a node with nothing yet keeps its interim handle');
	assert.equal((await c2.meta()).opening_scene, 'tar-smelling-dock');
	assert.deepEqual((await c1.world()).node_handles, {}, 'a campaign takes handles only at its own safe moments');
});

test('§185.7: the untold roster carries no handle rows in a name-free campaign; a legacy campaign keeps them', () => {
	// Through `table.untold` this needs a table, which a name-free campaign cannot open yet (the reading layer does not
	// know its handles: see §185.11 NFH-02); the roster itself is read here over the same graph either scheme builds.
	const raw = {nodes: [{node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: [{page: 1}]}], relations: []};
	const shown = graph => {
		const handle = graph.handle(graph.nodes.get('npc-old-mae'));
		return api.untoldRoster(graph, {person_epithets: {[handle]: {word: 'the net mender', by: 'graph'}}}, {}, []);
	};
	const legacy = shown(new api.ModuleGraph('harbor', raw, 'digest', {}));
	assert.deepEqual(legacy.filter(row => row.handle).map(row => row.name).sort(), ['npc-old-mae', 'old-mae'], 'legacy: the slug and the node id are renamed');
	const nameFree = shown(new api.ModuleGraph('harbor', raw, 'digest', {}, undefined, false, new Map([['npc-old-mae', 'net-mender-by-the-water']])));
	assert.deepEqual(nameFree.filter(row => row.handle), [], 'name-free: the rename touches names only');
	assert.deepEqual(nameFree.map(row => [row.name, row.shown]), [['Old Mae', 'the net mender']]);
});
