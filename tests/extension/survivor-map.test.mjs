/**
 * Contract §192.3/§192.4 (DUP-02, owner rulings 2026-10-07): one survivor map for every kind, and carry.
 *
 * Blood Road's generation 55 published a second node for things the graph already had: the general store, the town centre,
 * the store owner. The places resolved `ambiguous`, read material looked unread by name, and facts split across the copies.
 * Here, on the real kernel over a bound three-page PDF: the campaign's fork holds an old tower, its lamp oil and Old Mae twice
 * (written straight into a generation, as a graph that already holds duplicates does), the table finds a copy's clue and seats
 * the lamp keeper in the copy before anything is joined, and then the kernel's identity writer joins each copy to the node
 * published first. Every reader §192.3 lists then reads through the node that stands for each thing, and the survivor carries
 * what only its copy had (§192.4). A reader-authored `variant-of`, which states a state, never joins anything.
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
const temporary = await mkdtemp(join(root, '.coc', 'survivor-map-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {createModuleRuntime} from './kernel-ts/modules/index.ts';
export {ModuleStore} from './kernel-ts/modules/store.ts';
export {ensureCampaignModule, moduleContext} from './kernel-ts/modules/campaign-scope.ts';
export {publishIdentities, writeIdentity} from './kernel-ts/modules/identity.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {loadCampaignModule} from './kernel-ts/read/campaign.ts';
export {bookCast} from './kernel-ts/read/cast.ts';
export {individualNodes} from './kernel-ts/read/rename-undo.ts';
export {untoldRoster, fittedModuleSection, whereSection, withinSection, npcsPresent, calledPerson} from './kernel-ts/read/capsule.ts';
export {identityRelationId, isIdentityRelation, pairKey, apartPairs} from './kernel-ts/read/survivors.ts';
export {conditionStatus} from './kernel-ts/read/module-graph.ts';
export {mapsForScene} from './kernel-ts/read/maps.ts';
export {revealRows, mainLineComplete} from './kernel-ts/read/director.ts';
export {threadSection} from './kernel-ts/read/thread.ts';
export {weaknessChain} from './kernel-ts/read/weaknesses.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const PAGES = ['The harbor dock smells of tar. Old Mae mends nets by the water.',
	'The old tower stands beyond the harbor. Its keeper, Silas Marsh, trims the lamp. Fresh lamp oil stands by the door.',
	"Below the tower a cellar floods at high tide. Mae's boy Jonah drowned there last spring; the cellar key hangs on a nail."];
const CAMPAIGN = 'tower-camp';
const ref = page => [{source_id: 'pdf:MID', pdf_index: page - 1}];

async function kernel(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'survivor-map',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context), modules = api.createModuleRuntime(context);
	t.after(() => Promise.all([runtime.close(), modules.close()]));
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const attempt = async (method, params = {}) => { try { return {ok: true, result: await raw(method, params)}; } catch (error) { return {ok: false, error}; } };
	return {home, context, modules, raw, attempt};
}

/**
 * The book read as far as its opening (the dock, the old tower with its lamp oil, Old Mae), a name-free campaign on it, and
 * then a fork generation that holds the duplicates a page reading once published: the tower again with a cellar key, a way
 * down to the cellar and the lamp keeper; the lamp oil again, found at the dock; Old Mae again, with what she knows; and her
 * drowned-boy state as a reader's own `variant-of` claim, which is no identity.
 */
async function tower(t) {
	const k = await kernel(t);
	const pdf = join(k.home, 'tower.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await k.raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: sha}});
	const read = async (purpose, draft, paths) => {
		await k.raw('module.read.request', {module_id: mid, purpose});
		const job = await k.raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: [{page: 1}], reason: 'fixture support'}], missing: []}));
		return k.raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Tower', language: 'en', sections: [{name: 'Harbor and tower', pages: [[1, 3]], source_refs: [{page: 1}],
		entities: ['Dock', 'Old Tower', 'Silas Marsh', 'Cellar']}]}, []);
	await read('opening', {nodes: [
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: [{page: 1}], properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Old Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'},
		{node_id: 'npc-mae', node_kind: 'npc', name: 'Old Mae', source_refs: [{page: 1}], summary: 'A net mender on the dock.',
			properties: {biography: 'She has mended nets on this dock for forty years.'}},
		{node_id: 'clue-lamp-oil', node_kind: 'clue', name: 'Fresh lamp oil', source_refs: [{page: 2}], summary: 'Someone still fills the lamp.'}],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: [{page: 1}]},
			{subject_id: 'clue-lamp-oil', predicate: 'discoverable-at', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: [{page: 2}]}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'scene-tower', 'npc-mae', 'clue-lamp-oil']},
		['/nodes/0', '/nodes/1', '/nodes/2', '/nodes/3', '/claims/0', '/claims/1', '/coverage']);
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: CAMPAIGN, module: mid, play_language: 'en'});
	await k.raw('investigator.load', {campaign: CAMPAIGN, library_id: saved.library_id});
	await k.raw('setup.complete', {campaign: CAMPAIGN});
	await k.raw('table.open', {campaign: CAMPAIGN});
	await k.raw('table.narrate', {campaign: CAMPAIGN, call_id: 't0-c1', text: 'The harbor is quiet.'});
	// The fork holds the copies, as generation 55's landing left Blood Road's: written whole, never through today's check.
	await api.ensureCampaignModule(k.context, CAMPAIGN, mid);
	const store = new api.ModuleStore(api.moduleContext(k.context, CAMPAIGN));
	const meta = await store.module(mid), graph = await store.readGraph(mid);
	const refs = page => [{source_id: `pdf:${mid}`, pdf_index: page - 1}];
	const relation = (from, kind, to, extra = {}) => ({relation_id: `rel-${from}-${kind}-${to}`, relation_kind: kind, from_node_id: from, to_node_id: to, properties: {}, ...extra});
	graph.nodes.push(
		{node_id: 'scene-tower-copy', node_kind: 'scene', name: 'Old Tower', aliases: ['the lamp tower'], source_refs: refs(2), visibility: 'keeper-only',
			summary: 'The tower again, as a later page reading wrote it.', properties: {dramatic_question: 'Who still fills the lamp?'}},
		{node_id: 'scene-cellar', node_kind: 'scene', name: 'Flooded cellar', source_refs: refs(3), summary: 'A cellar under the tower.'},
		{node_id: 'npc-silas-marsh', node_kind: 'npc', name: 'Silas Marsh', source_refs: refs(2), summary: 'The lamp keeper.'},
		{node_id: 'clue-lamp-oil-copy', node_kind: 'clue', name: 'Fresh lamp oil', source_refs: refs(2), summary: 'The oil again.'},
		{node_id: 'clue-cellar-key', node_kind: 'clue', name: 'Cellar key on a nail', source_refs: refs(3), summary: 'The key to the cellar.'},
		{node_id: 'npc-mae-copy', node_kind: 'npc', name: 'Old Mae', aliases: ['Granny Mae'], source_refs: refs(3), visibility: 'keeper-only', summary: 'Old Mae again.',
			properties: {knowledge: 'Her boy Jonah drowned in the cellar.', biography: 'A widow who lost her son.'}},
		{node_id: 'npc-mae-grieving', node_kind: 'npc', name: 'Old Mae, grieving', source_refs: refs(3), summary: 'Old Mae after the drowning.'},
		{node_id: 'rule-lamp-check', node_kind: 'rule', name: 'Lamp room check', source_refs: refs(2), summary: 'Spot Hidden in the lamp room.'},
		{node_id: 'tome-keeper-log', node_kind: 'tome', name: 'Keeper\'s log', source_refs: refs(2), summary: 'The lamp keeper\'s log.'},
		{node_id: 'ending-lamp-out', node_kind: 'ending', name: 'The lamp goes out', source_refs: refs(3), summary: 'The harbor goes dark.'},
		{node_id: 'location-headland', node_kind: 'location', name: 'Headland', source_refs: refs(2), summary: 'The headland the tower stands on.'},
		{node_id: 'location-lamp-room', node_kind: 'location', name: 'Lamp room', source_refs: refs(2), summary: 'The room at the top.'},
		{node_id: 'asset-tower-plan', node_kind: 'asset', name: 'Tower plan', source_refs: refs(2), visibility: 'player-safe',
			properties: {map_regions: [{region_id: 'lamp-room', name: 'Lamp room', source_asset: 'asset-tower-plan', source_box: [0.1, 0.1, 0.5, 0.5], placement: [0.1, 0.1, 0.5, 0.5]}]}},
		{node_id: 'conclusion-keeper-alive', node_kind: 'conclusion', name: 'Someone keeps the lamp', source_refs: refs(2), summary: 'The keeper is alive.'},
		{node_id: 'conclusion-keeper-alive-copy', node_kind: 'conclusion', name: 'Someone keeps the lamp', source_refs: refs(2), summary: 'The keeper lives.'});
	graph.claims.push(
		{claim_id: 'claim-mae-copy-believes-tide', subject_id: 'npc-mae-copy', predicate: 'believes', object: {statement: 'The tide took Jonah on purpose.'},
			truth_status: 'authored-belief', source_refs: refs(3)},
		{claim_id: 'claim-mae-copy-knows-oil', subject_id: 'npc-mae-copy', predicate: 'knows', object: {node_id: 'clue-lamp-oil-copy'},
			truth_status: 'authored-fact', source_refs: refs(3)});
	graph.relations.push(
		// The way down opens once the oil is found: a condition that names the oil, met by finding its copy.
		relation('scene-tower-copy', 'route-to', 'scene-cellar', {properties: {when: {kind: 'clue_discovered', clue_id: 'clue-lamp-oil'}}}),
		relation('asset-tower-plan', 'depicts', 'scene-tower-copy'),
		relation('clue-lamp-oil-copy', 'supports', 'conclusion-keeper-alive'),
		relation('clue-cellar-key', 'supports', 'conclusion-keeper-alive'),
		relation('clue-lamp-oil-copy', 'misleads', 'npc-silas-marsh'),
		relation('npc-silas-marsh', 'present-in', 'scene-tower-copy'),
		relation('clue-cellar-key', 'discoverable-at', 'scene-tower-copy'),
		relation('clue-lamp-oil-copy', 'discoverable-at', 'scene-dock'),
		relation('scene-tower-copy', 'uses-rule', 'rule-lamp-check'),
		relation('tome-keeper-log', 'located-in', 'scene-tower-copy'),
		relation('scene-tower-copy', 'ends-in', 'ending-lamp-out'),
		relation('scene-tower-copy', 'occurs-at', 'location-headland'),
		relation('location-lamp-room', 'located-in', 'location-headland'),
		relation('scene-dock', 'play-precedes', 'scene-tower-copy'),
		relation('scene-cellar', 'located-in', 'scene-tower-copy'),
		// The copy routes to the tower it copies, as a reader that knew both would write: no way out of the tower once joined.
		relation('scene-tower-copy', 'route-to', 'scene-tower'),
		relation('npc-mae-copy', 'present-in', 'scene-tower-copy'),
		// A reader's own `variant-of` claim: a state of Old Mae, no identity (Dust to Dust's revived Virginia).
		relation('npc-mae-grieving', 'variant-of', 'npc-mae'));
	graph.source_needs = [...(graph.source_needs ?? []), {kind: 'runtime_context', focus: 'mae-copy', question: 'What does Old Mae say about the cellar?',
		reason: 'The page gives her grief, not her words.', trigger: 'If asked about Jonah.', source_refs: refs(3), node_id: 'npc-mae-copy', source_sha256: sha}];
	graph.field_spans = {...(graph.field_spans ?? {}), '/nodes/npc-mae-copy/properties/knowledge': refs(3), '/nodes/npc-mae-copy/aliases': refs(3)};
	// The dock's search grants the oil by the copy's id, as an affordance written against the copy would.
	const dock = graph.nodes.find(node => node.node_id === 'scene-dock'), record = dock.properties?.runtime_projection?.record ?? (dock.properties ??= {});
	record.affordances = [{id: 'nets', cue: 'Search the nets', grants_clue_ids: ['clue-lamp-oil-copy']}];
	await store.writeGraph(meta, graph);
	// The copies the table can use were read (the lamp keeper, Old Mae's copy, the oil found at the dock, the cellar);
	// the tower's copy never was, as generation 55's eight were never in `reading.materials`.
	meta.reading.materials.push({key: 'fixture-copies', purpose: 'detail', focus: 'Silas Marsh', question: '',
		node_ids: ['npc-silas-marsh', 'clue-lamp-oil-copy', 'clue-cellar-key', 'scene-cellar', 'npc-mae-grieving', 'npc-mae-copy'], generation: meta.generation});
	await store.writeModule(meta);
	const call = (method, params = {}) => k.raw(method, {campaign: CAMPAIGN, ...params});
	const attempt = (method, params = {}) => k.attempt(method, {campaign: CAMPAIGN, ...params});
	const world = async () => JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', CAMPAIGN, 'world.json'), 'utf8'));
	const loaded = async () => api.loadCampaignModule(k.context, mid, await world(), CAMPAIGN);
	// A node's handle as the kernel shows it: lookup by its node id finds that very node.
	const handle = async id => (await call('table.lookup', {kind: 'module', query: id})).entities.find(entity => entity.name)?.name;
	const join_ = writes => api.publishIdentities(store, mid, writes);
	return {...k, mid, sha, store, call, attempt, world, loaded, handle, join: join_};
}

const REVIEW = {by: 'test', rule: 'fixture'};
// Named in either order: the node published first survives (Old Mae's pair is named copy first).
const IDENTITIES = [
	{nodes: ['scene-tower', 'scene-tower-copy'], review: REVIEW},
	{nodes: ['clue-lamp-oil', 'clue-lamp-oil-copy'], review: REVIEW},
	{nodes: ['npc-mae-copy', 'npc-mae'], review: REVIEW},
	{nodes: ['conclusion-keeper-alive', 'conclusion-keeper-alive-copy'], review: REVIEW}];
const JOINED = [['scene-tower-copy', 'scene-tower'], ['clue-lamp-oil-copy', 'clue-lamp-oil'], ['npc-mae-copy', 'npc-mae'],
	['conclusion-keeper-alive-copy', 'conclusion-keeper-alive']];

test('§192.3: before the identity relations the copies split the tower; after them every reader reads one tower', async t => {
	const h = await tower(t);
	const [tower_, copy, cellar, silas, oil, oilCopy, key, mae, maeCopy] = await Promise.all(['scene-tower', 'scene-tower-copy', 'scene-cellar', 'npc-silas-marsh',
		'clue-lamp-oil', 'clue-lamp-oil-copy', 'clue-cellar-key', 'npc-mae', 'npc-mae-copy'].map(h.handle));
	await h.call('table.player_input', {text: 'I look along the dock, then send for the lamp keeper.'});
	// Before: the place is two places, so its name reads as unread material (the copy was never read) and the move is held
	// for a reading of something already read; and the table writes under the copies' handles.
	const before = await h.attempt('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'Old Tower'}]});
	assert.equal(before.ok, false);
	assert.match(before.error.message, /not prepared/, JSON.stringify(before.error.details));
	assert.equal(await h.modules.source.materialReady(h.mid, 'Old Tower', CAMPAIGN), false, 'the copy was never read');
	await h.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'clue', clue: oilCopy, how: 'a can of fresh oil on the dock'},
		{kind: 'npc', name: silas, to: copy}, {kind: 'npc', name: maeCopy, to: copy}]});
	await h.call('table.narrate', {call_id: 't1-c3', text: 'A can of oil sits by the nets.'});
	assert.deepEqual([(await h.world()).discovered_clues, (await h.world()).npc_presence], [[oilCopy], {[silas]: copy, [maeCopy]: copy}]);

	const published = await h.join(IDENTITIES);
	assert.deepEqual(published.written.map(row => [row.from, row.survivor]), JOINED);
	assert.deepEqual(published.skipped, []);

	await h.call('table.player_input', {text: 'I walk up to the old tower.'});
	// resolve: one tower by name; the copy's handle is an input key that names the tower too.
	await h.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'move', to: 'Old Tower'}]});
	assert.equal((await h.world()).active_scene, tower_, 'the name lands on the tower published first');
	await h.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'move', to: 'Dock'}]});
	await h.call('table.apply', {call_id: 't2-c3', effects: [{kind: 'move', to: copy}]});
	assert.equal((await h.world()).active_scene, tower_, 'the copy\'s handle names the tower');
	// materialReady: read through the tower's group.
	assert.equal(await h.modules.source.materialReady(h.mid, 'Old Tower', CAMPAIGN), true);
	// presence: the keeper seated under the copy's handle stands in the tower.
	const present = async () => (await h.call('table.look', {focus: 'npc'})).present.map(row => [row.name, row.untold?.id]);
	assert.deepEqual(await present(), [['Silas Marsh', silas], ['Old Mae', mae]], 'the keeper and Old Mae, seated in the copy under any handle, are here');
	// One entry per person: sending her away clears what her copy's handle held, which would otherwise stand in again.
	await h.call('table.apply', {call_id: 't2-c4', effects: [{kind: 'npc', name: 'Old Mae', to: 'away'}]});
	assert.deepEqual(await present(), [['Silas Marsh', silas]]);
	assert.deepEqual(Object.keys((await h.world()).npc_presence), [silas]);
	// clues: one lamp oil, found through its copy, beside the copy's cellar key.
	const clues = (await h.call('table.look', {focus: 'clues'})).clues_here;
	assert.deepEqual(clues.map(row => [row.name, row.discovered]), [[oil, true], [key, false]], JSON.stringify(clues));
	// exits: the way down that only the copy had.
	const capsule = await h.call('table.capsule', {rehydrate: true});
	assert.ok(capsule.where.exits.some(exit => exit.to === cellar), JSON.stringify(capsule.where.exits));
	assert.ok(!capsule.where.exits.some(exit => [tower_, copy].includes(exit.to)), 'a copy of this scene is no way out of it');
	assert.ok(capsule.known.clues_here.length === 2 && capsule.known.clues_here.every(row => row.name !== oilCopy));
	// the brief: Old Mae once.
	assert.equal(capsule.module.people.filter(row => row.name === 'Old Mae').length, 1, JSON.stringify(capsule.module.people));
});

test('§198.1 with §192.3: walk_on on a person the graph holds twice is their arrival under the node that stands for them, and clears the copy\'s entry', async t => {
	const h = await tower(t);
	const [dock, copy, mae, maeCopy] = await Promise.all(['scene-dock', 'scene-tower-copy', 'npc-mae', 'npc-mae-copy'].map(h.handle));
	await h.call('table.player_input', {text: 'I look up at the tower.'});
	// Old Mae seated under her copy's handle, in the tower's copy, before the two are joined.
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: maeCopy, to: copy}]});
	await h.call('table.narrate', {call_id: 't1-c2', text: 'Someone moves at the top of the tower.'});
	await h.join(IDENTITIES);
	await h.call('table.player_input', {text: 'I wave Old Mae down to the dock.'});
	assert.equal((await h.world()).active_scene, dock);
	assert.deepEqual((await h.world()).npc_presence, {[maeCopy]: copy}, 'before: her copy\'s entry, in the tower');
	// TR-F2's shape: walk_on on someone the table has, with no `to`.
	const applied = await h.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'npc', name: 'Old Mae', walk_on: true, why: 'she comes down to the dock'}]});
	assert.deepEqual(applied.walk_on_read?.map(row => [row.name, row.read_as]), [['Old Mae', 'arrival']]);
	// The arrival is the `to` write: one entry, under the node that stands for her; her copy's entry, which would stand in
	// again once this one went away, is gone. Nobody is minted.
	const world = await h.world();
	assert.deepEqual(world.npc_presence, {[mae]: dock}, JSON.stringify(world.npc_presence));
	assert.equal(world.table_people, undefined);
	assert.deepEqual((await h.call('table.look', {focus: 'npc'})).present.map(row => [row.name, row.untold?.id]), [['Old Mae', mae]]);
});

test('§192.3: the in-process readers -- scene groups, placeOf, material, the cast, a reader\'s own variant-of', async t => {
	const h = await tower(t);
	const before = (await h.loaded()).graph;
	assert.throws(() => before.resolve('Old Mae', ['npc']), /ambiguous/);
	assert.equal(before.placeOf('Old Tower stairs'), null, 'two towers tie');
	await h.join(IDENTITIES);
	const loaded = await h.loaded(), graph = loaded.graph, node = id => graph.nodes.get(id);
	assert.equal(graph.resolve('Old Mae', ['npc']).node_id, 'npc-mae');
	assert.equal(graph.resolve('Granny Mae', ['npc']).node_id, 'npc-mae', 'a name only the copy carried names her');
	assert.equal(graph.resolve(graph.handle(node('npc-mae-copy')), ['npc']).node_id, 'npc-mae', 'the copy\'s handle names her');
	assert.equal(graph.resolve('npc-mae-copy', ['npc']).node_id, 'npc-mae', 'the copy\'s node id names her');
	assert.equal(graph.placeOf('Old Tower stairs')?.node_id, 'scene-tower', 'a part of the tower is the tower');
	assert.deepEqual(graph.sceneNpcIds(node('scene-tower')), ['npc-mae', 'npc-silas-marsh'], 'her copy\'s present-in is hers');
	assert.deepEqual(graph.sceneNpcIds(node('scene-tower-copy')), ['npc-mae', 'npc-silas-marsh'], 'a copy reads as its group');
	assert.deepEqual(graph.sceneClueIds(node('scene-tower')), ['clue-lamp-oil', 'clue-cellar-key']);
	assert.deepEqual(graph.sceneClueIds(node('scene-dock')), ['clue-lamp-oil'], 'the copy found at the dock is the lamp oil');
	assert.deepEqual(graph.sceneExits(node('scene-tower')).map(exit => exit.to), [graph.handle(node('scene-cellar'))]);
	assert.deepEqual(graph.sceneExits(node('scene-dock')).map(exit => exit.to), [graph.handle(node('scene-tower'))]);
	assert.deepEqual(graph.groupOf(node('scene-tower-copy')).map(each => each.node_id), ['scene-tower', 'scene-tower-copy']);
	// The rest of the scene's relations, the union of its group's.
	assert.deepEqual(graph.sceneRules(node('scene-tower')).map(row => row.name), ['Lamp room check']);
	assert.ok(graph.sceneAssetNodes(node('scene-tower')).some(each => each.node_id === 'tome-keeper-log'), 'what the copy holds');
	assert.deepEqual(graph.sceneEndings(node('scene-tower')).map(row => row.name), ['The lamp goes out']);
	assert.deepEqual(graph.placesOutward(node('scene-tower')), ['scene-tower', 'location-headland']);
	assert.deepEqual(graph.scenePlaces(node('scene-tower')).map(row => row.name), ['Lamp room']);
	assert.equal(graph.entranceRelation(node('scene-dock'), node('scene-tower')), 'play-precedes');
	// The dock's affordance names the oil that stands for the copy it grants, found through the copy.
	const oilCopy = graph.handle(node('clue-lamp-oil-copy'));
	const [nets] = api.whereSection(graph, {discovered_clues: [oilCopy]}, node('scene-dock')).affordances;
	assert.deepEqual([nets.clue, nets.clues.map(row => [row.clue, row.discovered])], [graph.handle(node('clue-lamp-oil')), [[graph.handle(node('clue-lamp-oil')), true]]]);
	// Presence: her own entry wins over her copy's, which stands in only while she has none.
	const at = id => graph.handle(node(id));
	const both = {npc_presence: {[at('npc-mae')]: at('scene-dock'), [at('npc-mae-copy')]: at('scene-tower-copy')}};
	assert.deepEqual([api.npcsPresent(graph, both, node('scene-tower')), api.npcsPresent(graph, both, node('scene-dock'))].map(list => list.map(each => each.node_id)), [[], ['npc-mae']]);
	// The cellar lies in the tower's copy: its place is the tower, with the group's people, seated by an entry under any handle.
	const within = api.withinSection(graph, {npc_presence: {[at('npc-mae-copy')]: at('scene-cellar')}}, node('scene-cellar'));
	assert.deepEqual([within.name, within.people.map(row => [row.name, row.seated])], [at('scene-tower'), [[at('npc-mae'), true], [at('npc-silas-marsh'), false]]]);
	// A word two of her nodes carry is one owner, her.
	assert.equal(api.calledPerson(graph, {person_labels: {[graph.handle(node('npc-mae-copy'))]: {name: 'the net mender'}},
		person_epithets: {[graph.handle(node('npc-mae'))]: {word: 'the net mender'}}}, 'the net mender').node_id, 'npc-mae');
	// The kernel's material, by a node id no reading listed: the copy is the tower, which was read.
	assert.equal(loaded.material('scene-tower-copy'), 'ready');
	assert.equal(loaded.material('Old Tower'), 'ready');
	// The cast and NR-02's `individuals`: one person, the node published first, the copy a view of the survivor map.
	const mae = api.bookCast(graph).find(person => person.nodes.some(each => each.node_id === 'npc-mae'));
	assert.deepEqual(mae.nodes.map(each => each.node_id), ['npc-mae', 'npc-mae-copy']);
	assert.deepEqual([...graph.individuals], [['npc-mae-copy', 'npc-mae']]);
	assert.deepEqual(Object.fromEntries(api.individualNodes(graph)), {'npc-mae': 'npc-mae', 'npc-mae-copy': 'npc-mae'});
	// A reader's own `variant-of` states a state and joins nothing.
	assert.equal(graph.isVariant(node('npc-mae-grieving')), false);
	assert.equal(graph.resolve('Old Mae, grieving', ['npc']).node_id, 'npc-mae-grieving');
	assert.deepEqual(graph.groupOf(node('npc-mae-grieving')).map(each => each.node_id), ['npc-mae-grieving']);
	// The brief, fitted as the capsule fits it.
	const [brief] = api.fittedModuleSection(graph, 2048);
	assert.deepEqual(brief.people.map(row => row.name).sort(), ['Old Mae', 'Old Mae, grieving', 'Silas Marsh']);
	assert.equal(brief.more, undefined, 'a copy is not a roster line the fit dropped');
});

test('§192.4: the survivor takes what only the copy had; a contradiction stays on the copy; the relation is the kernel\'s', async t => {
	const h = await tower(t);
	await h.join(IDENTITIES);
	const raw = await h.store.readGraph(h.mid), node = id => raw.nodes.find(each => each.node_id === id);
	const mae = node('npc-mae'), copy = node('npc-mae-copy');
	assert.deepEqual(mae.aliases, ['Granny Mae'], 'the copy\'s name the survivor lacked, as an alias');
	assert.deepEqual(mae.source_refs.map(item => item.pdf_index ?? item.page), [0, 2], 'its pages');
	assert.equal(mae.properties.knowledge, 'Her boy Jonah drowned in the cellar.', 'a property the survivor lacked');
	assert.equal(mae.properties.biography, 'She has mended nets on this dock for forty years.', 'a contradiction stays the survivor\'s');
	assert.equal(copy.properties.biography, 'A widow who lost her son.', 'and the copy keeps its own');
	assert.equal(mae.visibility, node('npc-mae').visibility);
	assert.deepEqual(raw.field_spans['/nodes/npc-mae/properties/knowledge'], raw.field_spans['/nodes/npc-mae-copy/properties/knowledge'], 'with its spans');
	const tower_ = node('scene-tower');
	assert.equal(tower_.properties.dramatic_question ?? tower_.properties.runtime_projection?.record?.dramatic_question, 'Who still fills the lamp?');
	assert.equal(tower_.name, 'Old Tower');
	assert.ok(!('scene_id' in tower_.properties) || tower_.properties.scene_id !== 'old-tower', 'identity fields never travel');
	const relations = raw.relations.filter(rel => rel.relation_kind === 'variant-of');
	const kernel = relations.filter(api.isIdentityRelation);
	assert.deepEqual(kernel.map(rel => rel.relation_id).sort(), JOINED.map(([later, earlier]) => api.identityRelationId(later, earlier)).sort());
	assert.ok(kernel.every(rel => rel.properties.identity_review.by === 'test' && Number.isSafeInteger(Number(rel.properties.identity_review.generation))));
	assert.equal(relations.find(rel => rel.from_node_id === 'npc-mae-grieving').relation_id, 'rel-npc-mae-grieving-variant-of-npc-mae');
	// Written again, the same decisions change nothing; a node that already reads as another is not joined twice.
	const generation = (await h.store.module(h.mid)).generation;
	const again = await h.join([...IDENTITIES, {nodes: ['scene-tower-copy', 'scene-cellar'], review: REVIEW}]);
	assert.deepEqual(again.skipped, [{from: 'scene-tower-copy', to: 'scene-cellar', reason: 'survivor_taken'}]);
	assert.deepEqual(again.written.map(row => [row.carried.aliases, row.carried.properties]), IDENTITIES.map(() => [[], []]));
	assert.equal((await h.store.module(h.mid)).generation, generation + 1);
	// A pair a recorded `different` verdict keeps apart is refused by the writer, named, and nothing is published for it.
	const meta = await h.store.module(h.mid);
	meta.reading.identity = {...(meta.reading.identity ?? {}), [`${h.sha}:scene:scene-cellar:scene-dock`]: {verdict: 'different', kind: 'scene', nodes: ['scene-dock', 'scene-cellar'], by: 'review'}};
	await h.store.writeModule(meta);
	const refused = await h.join([{nodes: ['scene-cellar', 'scene-dock'], review: REVIEW}]);
	assert.deepEqual(refused, {generation: generation + 1, written: [], skipped: [{from: 'scene-cellar', to: 'scene-dock', reason: 'verdict_different', nodes: ['scene-cellar', 'scene-dock']}]});
});

test('§192.3: the lanes skip a copy; a copy\'s need asks about the survivor; two foci that are one thing are one reading', async t => {
	const h = await tower(t);
	await h.call('table.player_input', {text: 'I watch the dock.'});
	const asked = async () => (await h.call('handles.job')).nodes?.map(row => row.id) ?? [];
	const words = async () => (await h.call('epithets.job')).people?.map(row => row.id) ?? [];
	const maeCopy = await h.handle('npc-mae-copy');
	assert.ok((await asked()).includes('scene-tower-copy'), 'apart, the copy is a node of its own');
	assert.ok((await words()).includes(maeCopy));
	await h.join(IDENTITIES);
	await h.call('table.narrate', {call_id: 't1-c1', text: 'Gulls.'});
	await h.call('table.player_input', {text: 'I ask the net mender about the cellar.'});
	const nodes = await asked();
	assert.ok(nodes.includes('scene-tower') && !['scene-tower-copy', 'clue-lamp-oil-copy', 'npc-mae-copy'].some(id => nodes.includes(id)), JSON.stringify(nodes));
	const people = await words();
	assert.ok(people.includes(await h.handle('npc-mae')) && !people.includes(maeCopy), JSON.stringify(people));
	// Source needs: the copy's need rides on Old Mae, focused on her.
	const view = await h.call('table.look', {focus: 'npc', name: 'Old Mae'});
	assert.deepEqual(view.source_needs?.map(need => [need.focus, need.question]), [[await h.handle('npc-mae'), 'What does Old Mae say about the cellar?']]);
	// Focus identity: a detail reading of the copy is running; a request about Old Mae attaches to it.
	const first = await h.raw('module.read.request', {module_id: h.mid, campaign: CAMPAIGN, purpose: 'detail', focus: 'npc-mae-copy', question: 'What does she say about Jonah?'});
	const claimed = await h.raw('module.read.claim', {module_id: h.mid, campaign: CAMPAIGN, owner: 'test-host'});
	assert.equal(claimed.job_id, first.job_id);
	const second = await h.raw('module.read.request', {module_id: h.mid, campaign: CAMPAIGN, purpose: 'detail', focus: 'npc-mae', question: 'Where is the cellar key?'});
	assert.deepEqual([second.job_id, second.attached], [first.job_id, true], JSON.stringify(second));
});

test('§192.3: the identity writer joins two nodes of one kind, decided by a review, and never a node twice', () => {
	const graph = {module_id: 'book', nodes: [
		{node_id: 'scene-a', node_kind: 'scene', name: 'A'}, {node_id: 'scene-b', node_kind: 'scene', name: 'A'},
		{node_id: 'location-a', node_kind: 'location', name: 'A'}, {node_id: 'handout-a', node_kind: 'handout', name: 'H'},
		{node_id: 'asset-a', node_kind: 'asset', name: 'H', properties: {map_regions: [{region_id: 'r'}], image_sources: [{page: 1}]}}], relations: []};
	assert.throws(() => api.writeIdentity(graph, 'location-a', 'scene-a', REVIEW), error => error.details?.reason === 'cross_kind');
	assert.throws(() => api.writeIdentity(graph, 'scene-b', 'scene-a', null), /review/);
	assert.throws(() => api.writeIdentity(graph, 'scene-b', 'scene-z', REVIEW), /scene-z/);
	const written = api.writeIdentity(graph, 'scene-b', 'scene-a', REVIEW);
	assert.equal(written.relation.relation_id, 'rel-identity-scene-b-to-scene-a');
	assert.equal(api.writeIdentity(graph, 'scene-a', 'scene-b', REVIEW), null, 'no cycle');
	// A printed visual carries its names and references, never another crop's regions (§152.4).
	const visual = api.writeIdentity(graph, 'asset-a', 'handout-a', REVIEW);
	assert.deepEqual(visual.carried.properties, []);
	assert.equal(graph.nodes.find(node => node.node_id === 'handout-a').properties, undefined);
	const view = new api.ModuleGraph('book', graph, '', {});
	assert.equal(view.survivorOf(view.nodes.get('scene-b')).node_id, 'scene-a');
	assert.equal(view.survivorOf(view.nodes.get('asset-a')).node_id, 'handout-a');
	// A `variant-of` with the kernel's id shape but no review, or between two kinds, is no identity.
	const forged = new api.ModuleGraph('book', {nodes: [{node_id: 'npc-a', node_kind: 'npc', name: 'X'}, {node_id: 'npc-b', node_kind: 'npc', name: 'X'},
		{node_id: 'scene-c', node_kind: 'scene', name: 'X'}],
		relations: [{relation_id: 'rel-identity-npc-b-to-npc-a', relation_kind: 'variant-of', from_node_id: 'npc-b', to_node_id: 'npc-a', properties: {}},
			{relation_id: 'rel-identity-scene-c-to-npc-a', relation_kind: 'variant-of', from_node_id: 'scene-c', to_node_id: 'npc-a', properties: {identity_review: REVIEW}}]}, '', {});
	assert.equal(forged.isVariant(forged.nodes.get('npc-b')), false);
	assert.equal(forged.isVariant(forged.nodes.get('scene-c')), false);
	// §192.3 (lead ruling): a recorded `different` verdict and an identity relation cannot both stand. The writer refuses to join
	// such a pair, through any node of their relation groups; a graph that holds one anyway is reported, the relation left alone.
	const apart = new Set([api.pairKey('scene-a', 'scene-c2')]);
	const kept = {module_id: 'book', nodes: [{node_id: 'scene-a', node_kind: 'scene', name: 'A'}, {node_id: 'scene-b', node_kind: 'scene', name: 'A'},
		{node_id: 'scene-c2', node_kind: 'scene', name: 'A'}], relations: [{relation_id: 'rel-identity-scene-b-to-scene-a', relation_kind: 'variant-of',
		from_node_id: 'scene-b', to_node_id: 'scene-a', properties: {identity_review: REVIEW}}]};
	assert.throws(() => api.writeIdentity(kept, 'scene-c2', 'scene-b', REVIEW, apart), error => error.details?.reason === 'identity_verdict_different'
		&& JSON.stringify(error.details.nodes.sort()) === JSON.stringify(['scene-a', 'scene-c2']));
	assert.equal(kept.relations.length, 1, 'nothing written');
	// Lookup's aliases for a thing with copies: a relation written without carry (an older kernel's, or a cast fold) leaves the
	// copy's names on the copy; the survivor is listed with them all the same.
	const named = new api.ModuleGraph('book', {nodes: [{node_id: 'scene-x', node_kind: 'scene', name: 'Harbor', aliases: ['Quay']},
		{node_id: 'scene-y', node_kind: 'scene', name: 'Old harbor', aliases: ['Harbor', 'Wharf']}], relations: [{relation_id: 'rel-identity-scene-y-to-scene-x',
		relation_kind: 'variant-of', from_node_id: 'scene-y', to_node_id: 'scene-x', properties: {identity_review: REVIEW}}]}, '', {});
	assert.deepEqual(named.groupAliases(named.nodes.get('scene-x')), ['Quay', 'Old harbor', 'Wharf']);
	const conflicted = new api.ModuleGraph('book', {...kept, relations: [...kept.relations, {relation_id: 'rel-identity-scene-c2-to-scene-a', relation_kind: 'variant-of',
		from_node_id: 'scene-c2', to_node_id: 'scene-a', properties: {identity_review: REVIEW}}]}, '', {});
	conflicted.apart = apart;
	assert.deepEqual(conflicted.identityConflicts(), [{nodes: ['scene-a', 'scene-c2'], survivor: 'scene-a'}]);
	assert.equal(conflicted.isVariant(conflicted.nodes.get('scene-c2')), true, 'the relation is left as it is; nothing is guessed');
	// The verdicts read from `reading.identity` are the bound source's `different` ones only.
	assert.deepEqual([...api.apartPairs({'sha:scene:a:b': {verdict: 'different', nodes: ['b', 'a']}, 'sha:scene:a:c': {verdict: 'same', nodes: ['a', 'c']},
		'old:scene:a:d': {verdict: 'different', nodes: ['a', 'd']}}, 'sha')], [api.pairKey('a', 'b')]);
});

test('§192.3 with §188.2: an identity relation makes two people one cast person before any cast row; the roster shows one word', () => {
	const raw = {nodes: [
		{node_id: 'npc-book-4-daniel-mather', node_kind: 'npc', name: '丹尼尔·马瑟', aliases: ['丹', '丹·马瑟'], source_refs: ref(26)},
		{node_id: 'npc-daniel-mather', node_kind: 'npc', name: '丹尼尔·马瑟', aliases: ['丹·马瑟'], source_refs: ref(26)}],
		relations: [{relation_id: api.identityRelationId('npc-daniel-mather', 'npc-book-4-daniel-mather'), relation_kind: 'variant-of',
			from_node_id: 'npc-daniel-mather', to_node_id: 'npc-book-4-daniel-mather', properties: {identity_review: {by: 'kernel', rule: 'same-name-same-page'}}}]};
	const graph = new api.ModuleGraph('road', raw, 'digest', {});
	const cast = api.bookCast(graph);
	assert.deepEqual(cast.map(person => person.nodes.map(node => node.node_id)), [['npc-book-4-daniel-mather', 'npc-daniel-mather']]);
	const [mather, copy] = ['npc-book-4-daniel-mather', 'npc-daniel-mather'].map(id => graph.handle(graph.nodes.get(id)));
	const world = {person_epithets: {[mather]: {word: '抓胡茬的红发杂货店主', by: 'graph'}, [copy]: {word: '站在基地里的住民', by: 'graph'}}};
	const roster = api.untoldRoster(graph, world, {}, []);
	assert.deepEqual(roster.filter(row => row.name === '丹尼尔·马瑟').map(row => [row.id, row.shown]), [[mather, '抓胡茬的红发杂货店主']]);
	assert.equal(graph.resolve('丹尼尔·马瑟', ['npc']).node_id, 'npc-book-4-daniel-mather', 'no cast fold needed');
});

test('§192.3 (DUP-02b): lookup lists the tower once; maps, a copy\'s claims and every discovered-clue reader read through survivors', async t => {
	const h = await tower(t);
	const [tower_, copy, cellar] = await Promise.all(['scene-tower', 'scene-tower-copy', 'scene-cellar'].map(h.handle));
	await h.join(IDENTITIES);
	await h.call('table.player_input', {text: 'I ask around the dock.'});
	// search / lookup: the tower once, found by a name only its copy carried, with its copies' names among its aliases.
	const byName = (await h.call('table.lookup', {kind: 'module', query: 'Old Tower'})).entities.filter(entity => entity.kind === 'scene');
	assert.deepEqual(byName.map(entity => entity.name), [tower_], JSON.stringify(byName.map(entity => entity.name)));
	const byCopyName = (await h.call('table.lookup', {kind: 'module', query: 'the lamp tower'})).entities;
	assert.deepEqual([byCopyName.map(entity => entity.name), byCopyName[0]?.aliases?.includes('the lamp tower')], [[tower_], true]);
	// The handle list (§127.1): the copy's handle is the tower.
	const listed = (await h.call('table.lookup', {kind: 'module', query: `${copy} ${cellar}`})).entities.map(entity => entity.name);
	assert.deepEqual(listed, [tower_, cellar]);
	const graph = (await h.loaded()).graph, node = id => graph.nodes.get(id), at = id => graph.handle(node(id));
	assert.deepEqual(graph.search('Old Tower').filter(each => each.node_kind === 'scene').map(each => each.node_id), ['scene-tower']);
	// mapsForScene: the plan depicts the copy, so it is the tower's map.
	assert.ok(api.mapsForScene(graph, node('scene-tower')).some(each => each.node_id === 'asset-tower-plan'));
	// A copy's claims are the person's: her copy's belief, and what her copy knows, as the clue that stands for it.
	assert.ok(graph.npcBeliefs(node('npc-mae')).includes('The tide took Jonah on purpose.'));
	assert.deepEqual(graph.npcKnows(node('npc-mae')).map(entry => entry.node.node_id), ['clue-lamp-oil']);
	assert.deepEqual(graph.npcsKnowing(node('clue-lamp-oil-copy')), ['npc-mae'], 'she knows it once, never her copy beside her');
	// Discovered clues: the oil was found through its copy.
	const found = {discovered_clues: [at('clue-lamp-oil-copy')]};
	assert.equal(api.conditionStatus({kind: 'clue_discovered', clue_id: 'clue-lamp-oil'}, found, graph), true);
	assert.equal(api.conditionStatus({kind: 'clue_discovered', clue_id: 'clue-lamp-oil'}, found), false, 'without the graph, its own handles only');
	const exit = api.whereSection(graph, found, node('scene-tower')).exits.find(row => row.to === at('scene-cellar'));
	assert.equal(exit?.unlock_when?.met, true, 'the way down a condition on the oil locks is open: its copy was found');
	assert.deepEqual(api.revealRows(graph, found, node('scene-tower')).map(row => row.clue), [at('clue-cellar-key')], 'the oil is no reveal left');
	assert.deepEqual(graph.supportingClues(node('conclusion-keeper-alive')).map(each => each.node_id).sort(), ['clue-cellar-key', 'clue-lamp-oil']);
	assert.equal(api.mainLineComplete(graph, {discovered_clues: [at('clue-lamp-oil-copy'), at('clue-cellar-key')]}), true);
	assert.equal(api.mainLineComplete(graph, {discovered_clues: [at('clue-cellar-key')]}), false);
	const thread = api.threadSection(graph, {...found, active_scene: at('scene-tower')}, node('scene-tower'), []);
	assert.deepEqual(thread.lines.map(line => [line.name, line.missing, line.of]), [[at('conclusion-keeper-alive'), 1, 2]], 'one conclusion, its oil found');
	const weaknesses = {...found, mods: {active: {lore: {enabled: true}}, state: {lore: {weaknesses: {'npc-silas-marsh': [{book: 'Fears the dark.', learned_by: 'conclusion-keeper-alive'}]}}}}};
	const chain = api.weaknessChain(graph, weaknesses, node('npc-silas-marsh'));
	assert.deepEqual(chain.weaknesses?.[0]?.learned_by, {conclusion: at('conclusion-keeper-alive'), found: 1, of: 2});
	assert.deepEqual(chain.false_leads, [{clue: at('clue-lamp-oil'), discovered: true}]);
});
