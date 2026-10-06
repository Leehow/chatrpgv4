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
/** A campaign on the book with an investigator (saved from a starter pregen, §21.5), still being set up. */
async function seated(h, id) {
	if (!h.library) {
		await h.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
		h.library = (await h.raw('investigator.save', {campaign: 'card-source'})).library_id;
	}
	const c = await h.campaign(id);
	await c.call('investigator.load', {library_id: h.library});
	const file = async name => JSON.parse(await readFile(join(h.home, '.coc', 'campaigns', id, name), 'utf8'));
	return {...c, file, telemetry: async () => (await readFile(join(h.home, '.coc', 'campaigns', id, 'telemetry.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))};
}
const NAMED = [{id: 'scene-dock', handle: 'tar-smelling-dock'}, {id: 'npc-old-mae', handle: 'net-mender-by-the-water'}, {id: 'scene-tower', handle: 'lighthouse-on-the-point'}];
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

test('§185.6.1: the fold at table.open moves what the campaign stored under interim handles; the opening keeps its people', async t => {
	// The first campaign on a book writes its world before the lane has named anything: every handle in it is interim.
	const h = await book(t), c1 = await seated(h, 'c1');
	const dock = interim('scene', 'scene-dock'), mae = interim('npc', 'npc-old-mae');
	assert.deepEqual((await c1.world()).npc_presence, {[mae]: dock});
	// The epithet lane worded her during setup, under the handle she had then.
	assert.deepEqual((await c1.call('epithets.submit', {entries: [{id: mae, word: 'the net mender'}]})).written, [{id: mae, word: 'the net mender'}]);
	assert.deepEqual((await c1.call('handles.submit', {entries: NAMED})).refused, []);
	await c1.call('setup.complete');
	await c1.call('table.open');
	const world = await c1.world();
	assert.deepEqual(world.node_handles, Object.fromEntries(NAMED.map(entry => [entry.id, entry.handle])));
	assert.equal(world.active_scene, 'tar-smelling-dock');
	assert.deepEqual(world.visited_scenes, ['tar-smelling-dock']);
	assert.deepEqual(world.npc_presence, {'net-mender-by-the-water': 'tar-smelling-dock'}, 'present where she was, under her final handle');
	assert.equal((await c1.meta()).opening_scene, 'tar-smelling-dock');
	assert.deepEqual(Object.keys((await c1.file('epithets.json')).people), ['net-mender-by-the-water'], 'the lane\'s file moved with her');
	const look = await c1.call('table.look', {focus: 'scene'});
	assert.deepEqual(look.present.map(person => person.untold?.id), ['net-mender-by-the-water'], JSON.stringify(look.present));
	assert.ok(!JSON.stringify(look).includes(mae) && !JSON.stringify(look).includes(dock), 'nothing shows the interim handles any more');
	const folded = (await c1.telemetry()).filter(row => row.lane === 'handles' && row.event === 'folded');
	assert.equal(folded.length, 1);
	assert.equal(folded[0].mapped, 3);
	assert.ok(folded[0].files.includes('campaign.json') && folded[0].files.includes('epithets.json'), JSON.stringify(folded[0].files));
});

test('§185.6/§185.6.1: a fold at player_input mid-play -- history read by identity, references and lanes written under the interim handle land on the final one, and a folded handle never moves', async t => {
	const h = await book(t), c1 = await seated(h, 'c1');
	await c1.call('setup.complete');
	await c1.call('table.open');
	const dock = interim('scene', 'scene-dock'), mae = interim('npc', 'npc-old-mae'), roster = async () => (await c1.call('table.untold')).people.map(row => row.id);
	await c1.call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
	await c1.call('table.player_input', {text: 'I ask the old woman what she is doing.'});
	// Before any handle is written: she sets out to do something, and says her own name in a line.
	await c1.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: mae, intends: 'mend the torn net before dusk', outcome: 'attempted'}]});
	await c1.call('table.narrate', {call_id: 't1-c2', text: 'She looks up. {{say:Old Mae}}"Mind the cellar."{{/say}}'});
	const before = JSON.parse(await readFile(join(h.home, '.coc', 'campaigns', 'c1', 'npc-ledger.json'), 'utf8'))['npc-old-mae'].intents[0].ref;
	assert.ok(before.startsWith(`intent:${mae}:`), before);
	assert.ok(!(await roster()).includes(mae), 'told by her own line: the record keeps her interim handle');

	await c1.call('handles.submit', {entries: NAMED});
	const opened = await c1.call('table.player_input', {text: 'I nod to her.'});
	assert.equal((await c1.world()).node_handles['npc-old-mae'], 'net-mender-by-the-water', 'folded at the turn\'s start');
	assert.ok(!(await roster()).includes('net-mender-by-the-water'), 'still told: the line is read by identity across the fold');

	// A reference the Keeper copied before the fold still resolves, and lands on her final handle.
	await c1.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'person', who: mae, address: 'grandmother'}]});
	assert.equal((await c1.world()).person_labels['net-mender-by-the-water'].address, 'grandmother');
	assert.equal((await c1.world()).person_labels[mae], undefined);
	// NFH-01: her card shows the intention recorded under her interim handle by her current one, and that old reference
	// still settles it.
	const digest = before.split(':').at(-1), shown = opened.capsule.present.flatMap(person => person.history?.intents ?? []).map(row => row.ref);
	assert.deepEqual(shown, [`intent:net-mender-by-the-water:${digest}`], JSON.stringify(opened.capsule.present));
	const settled = await c1.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'npc', name: 'net-mender-by-the-water', intent_ref: before, outcome: 'done'}]});
	const receipt = (await c1.call('table.status')).receipts.find(row => row.id === settled.receipts[0]);
	assert.deepEqual([receipt.intent?.ref.split(':').at(-1), receipt.intent?.outcome], [digest, 'done'], JSON.stringify(receipt));
	// A lane answer written with the interim handle after the fold is kept under the final one.
	const checked = await c1.call('table.first_sight', {turn: 1, items: [{kind: 'place', id: dock, missing: []}]});
	assert.deepEqual(checked.shown, [{kind: 'place', id: 'tar-smelling-dock'}]);
	assert.deepEqual((await c1.file('first-sight.json')).shown.places, ['tar-smelling-dock']);

	// A folded handle survives a new word from apply person and a cast that grows a name it carries.
	await c1.call('table.apply', {call_id: 't2-c3', effects: [{kind: 'person', who: 'net-mender-by-the-water', name: 'the net woman'}]});
	const cast = join(h.home, '.coc', 'modules', h.mid, 'cast.json'), table = JSON.parse(await readFile(cast, 'utf8'));
	table.people.push({id: 'cast-00000000ff', book: ['内塔'], play: ['内塔'], notes: ['Net'], pages: [3]});
	await writeFile(cast, JSON.stringify(table));
	await c1.call('table.narrate', {call_id: 't2-c4', text: 'She goes back to her nets.'});
	await c1.call('table.player_input', {text: 'I watch the water.'});
	assert.equal(reasonOf(await c1.call('handles.submit', {entries: [{id: 'module-book-1', handle: 'net-and-harbor-book'}]}), 'module-book-1'), 'carries_name',
		'the cast now has the word');
	assert.equal((await c1.world()).node_handles['npc-old-mae'], 'net-mender-by-the-water', 'a folded handle is never changed');
	assert.equal((await c1.call('table.look', {focus: 'npc', name: 'the net woman'})).id, 'net-mender-by-the-water', 'her new word finds her under the same handle');
	assert.equal((await c1.world()).npc_presence['net-mender-by-the-water'], 'tar-smelling-dock');
});

test('§185.5: a reader-built book is named in the library alone; an authored module is refused', async t => {
	const h = await book(t);
	const job = await h.raw('handles.job', {module: h.mid});
	assert.match(job.job_id, /^handles:book:/);
	assert.ok(job.nodes.some(node => node.id === 'npc-old-mae') && job.avoid.includes('Silas'), JSON.stringify(job));
	assert.deepEqual((await h.raw('handles.submit', {module: h.mid, entries: [{id: 'scene-dock', handle: 'tar-smelling-dock'}, {id: 'npc-old-mae', handle: 'old-mae-at-the-nets'}]})).refused.map(row => [row.id, row.reason]),
		[['npc-old-mae', 'carries_name']]);
	assert.equal((await h.handlesFile()).nodes['scene-dock'].handle, 'tar-smelling-dock');
	const c1 = await h.campaign('c1');
	assert.equal((await c1.world()).active_scene, 'tar-smelling-dock', 'a campaign created after the library was named starts named');
	for (const method of ['handles.job', 'handles.submit'])
		await assert.rejects(h.raw(method, {module: 'the-haunting', entries: []}), error => error?.details?.reason === 'authored', method);
});
