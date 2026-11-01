/**
 * Contract §276.2 against the real TypeScript kernel: a name-free campaign on a reader-built book, its first chapter read
 * resolved from the campaign's own opening. Live 1031 (cs, du): the module named its opening by the book's node id, which no
 * lookup row of a name-free campaign shows, so the opening never matched and every table started in the keeper's background
 * chapter (`first`), which was then kept for good.
 *
 * Two books with the same chapters (bookmarks: Background p2, Prologue p3, Harbor p5, Tower p7 of eight pages) and openings
 * built differently: one whose pages hold a majority in Harbor, one whose pages scatter over three chapters, so the opening's
 * first page decides.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
import {withPersonStatements} from './person-statements.mjs';

const root = resolve(import.meta.dirname, '../..');
const temporary = playtestScratch('chapter-scope-kernel');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ReadingService} from './extensions/module/reading-service.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const PAGES = Array.from({length: 8}, (_, index) => `Page ${index + 1} of the harbor book.`);
const ALL = PAGES.map((_, index) => index + 1);
const BOOKMARKS = [{name: 'Background', page: 2}, {name: 'Prologue', page: 3}, {name: 'Harbor', page: 5}, {name: 'Tower', page: 7}];

/** A book read through the kernel's reading lane as far as its opening, the Dock on `dockPages`, and a campaign created on it. */
async function bookTable(t, seed, dockPages, {anchor = false} = {}) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed,
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const pdf = join(home, 'harbor.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: sha}});
	const refs = dockPages.map(page => ({page}));
	const read = async (purpose, draft, paths) => {
		await raw('module.read.request', {module_id: mid, purpose});
		const job = await raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: ALL, full_pages: ALL, review_pages: ALL}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths: withPersonStatements(draft, paths), verdict: 'supported', source_refs: refs, reason: 'fixture support'}], missing: []}));
		return raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor and tower', pages: [[1, 8]], source_refs: refs, entities: ['Dock', 'Tower']}]}, []);
	const nodes = [{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: refs, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 7}], summary: 'An old tower beyond the harbor.'}];
	// live7 du: an opening's reading anchor on the title page and the keeper's background (`is_entrance` + `source_reference_anchor`).
	const claims = [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: refs}];
	if (anchor) {
		nodes.push({node_id: 'scene-title-entry', node_kind: 'scene', name: 'Title entry', source_refs: [{page: 2}], summary: 'The book opens.',
			properties: {is_entrance: true, source_reference_anchor: true}});
		claims.push({subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-title-entry'}, truth_status: 'authored-fact', source_refs: refs});
	}
	await read('opening', {nodes, claims,
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock']}, ['/nodes/0', '/claims/0', ...(anchor ? ['/nodes/2', '/claims/1'] : []), '/coverage']);
	const campaign = `${seed}-table`;
	// Seated and opened as a live table is: an investigator from a starter pregen (§21.5), setup completed, the table opened.
	await raw('campaign.create', {id: campaign, module: mid, play_language: 'en', ...(anchor ? {start_scene: 'scene-dock'} : {})});
	await raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const {library_id} = await raw('investigator.save', {campaign: 'card-source'});
	await raw('investigator.load', {campaign, library_id});
	await raw('setup.complete', {campaign});
	await raw('table.open', {campaign});
	const notes = [];
	const reading = new api.ReadingService({
		call: (method, params) => raw(method, params),
		campaign: () => campaign, home, model: () => ({id: 'm', vision: true}), progress: () => {}, record: row => notes.push(row),
		env: {PATH: process.env.PATH},
		runtime: {sourceInfo: async () => ({bookmarks: BOOKMARKS}),
			sourcePageText: async ({pages}) => ({pages: pages.map(page => ({page, text: PAGES[page - 1], layer: 'native'}))})},
	});
	t.after(() => reading.dispose());
	return {raw, mid, campaign, reading, notes, home};
}

test('§276.2 (real kernel): an opening whose pages hold a majority starts the table in that chapter, resolved from the opening', async t => {
	const table = await bookTable(t, 'majority', [5, 6, 7]);
	const meta = JSON.parse(await readFile(join(table.home, '.coc', 'campaigns', table.campaign, 'campaign.json'), 'utf8'));
	assert.equal(meta.handles, 'name-free');
	const status = await table.raw('module.status', {module_id: table.mid, campaign: table.campaign});
	assert.equal(status.campaign_opening, meta.opening_scene, 'the campaign names its own opening');
	assert.notEqual(status.opening?.start_scene, meta.opening_scene, 'the module names the book node id, which the table does not show');
	// live 1031 du: the Keeper moved the party to a place the table made before the first book read.
	await table.raw('table.narrate', {campaign: table.campaign, call_id: 't0-c1', text: 'The tar smell carries up from the dock.'});
	await table.raw('table.player_input', {campaign: table.campaign, text: 'I walk up to the newsstand on the main street.'});
	await table.raw('table.apply', {campaign: table.campaign, call_id: 't1-c1', effects: [{kind: 'move', to: 'Main street newsstand', via: 'up the hill from the dock', travel_minutes: 5,
		establish: {summary: 'A newsstand on the main street above the harbor.', within: null}}]});
	const where = (await table.raw('table.capsule', {campaign: table.campaign, _context_read: true})).where;
	assert.equal(where.scene, 'Main street newsstand', 'a scene the book has no pages for, registered inside no place');
	const scope = await table.reading.chapterScope(table.mid, table.campaign);
	assert.deepEqual([scope.name, scope.first, scope.last, scope.resolved], ['Harbor', 5, 6, 'opening']);
	assert.deepEqual(table.notes.filter(row => row.event === 'chapter_scope').map(row => [row.chapter, row.resolved]), [['Harbor', 'opening']]);
});

test('§276.2 (real kernel): an opening whose pages scatter starts the table in the chapter of its first page', async t => {
	const table = await bookTable(t, 'scatter', [4, 6, 8]);
	const scope = await table.reading.chapterScope(table.mid, table.campaign);
	assert.deepEqual([scope.name, scope.first, scope.last, scope.resolved], ['Prologue', 3, 4, 'opening'],
		'one page each in Prologue, Harbor and Tower: no majority, page 4 decides; not Background, the first chapter');
});

test('§276.2 (real kernel): an opening\'s reading anchor the party moves into does not move it to its pages', async t => {
	const table = await bookTable(t, 'anchor', [5, 6, 7], {anchor: true});
	assert.equal((await table.reading.chapterScope(table.mid, table.campaign)).name, 'Harbor');
	const found = await table.raw('table.lookup', {campaign: table.campaign, kind: 'module', query: 'Title entry', _context_read: true});
	const entry = found.entities.find(row => row.kind === 'scene' && row.properties?.source_reference_anchor === true);
	assert.ok(entry, 'the anchor is a scene row carrying its structural marks');
	// §276.2: the Keeper's one-line hint is carried only while the party stands in an opening's reading anchor.
	assert.equal('opening_anchor_note' in (await table.raw('table.capsule', {campaign: table.campaign, _context_read: true})).where, false, 'absent at a place');
	await table.raw('table.narrate', {campaign: table.campaign, call_id: 't0-c1', text: 'The tar smell carries up from the dock.'});
	await table.raw('table.player_input', {campaign: table.campaign, text: 'I go back to where it all began.'});
	await table.raw('table.apply', {campaign: table.campaign, call_id: 't1-c1', effects: [{kind: 'move', to: entry.name, travel_minutes: 5}]});
	const where = (await table.raw('table.capsule', {campaign: table.campaign, _context_read: true})).where;
	assert.equal(where.scene, entry.name);
	assert.match(where.opening_anchor_note, /section of the book .* not a place\. Register the place/);
	const scope = await table.reading.chapterScope(table.mid, table.campaign);
	assert.deepEqual([scope.name, scope.resolved], ['Harbor', 'kept'], 'not Background, the anchor\'s page');
});

test('§276.2 rule A (real kernel): a place the table registers inside a book place is located by that place\'s pages, also two levels up', async t => {
	const table = await bookTable(t, 'parent', [5, 6]);
	assert.equal((await table.reading.chapterScope(table.mid, table.campaign)).name, 'Harbor', 'the opening');
	const tower = (await table.raw('table.lookup', {campaign: table.campaign, kind: 'module', query: 'Tower', _context_read: true})).entities.find(row => row.kind === 'scene');
	assert.deepEqual(tower.original_pages, [7]);
	await table.raw('table.narrate', {campaign: table.campaign, call_id: 't0-c1', text: 'The tar smell carries up from the dock.'});
	await table.raw('table.player_input', {campaign: table.campaign, text: 'I climb the tower stair.'});
	await table.raw('table.apply', {campaign: table.campaign, call_id: 't1-c1', effects: [{kind: 'move', to: 'Tower stair', via: 'along the breakwater', travel_minutes: 10,
		establish: {summary: 'A winding stair inside the old tower.', within: tower.name}}]});
	const stair = (await table.raw('table.lookup', {campaign: table.campaign, kind: 'module', query: 'Tower stair', _context_read: true})).entities[0];
	assert.deepEqual([stair.origin?.kind, stair.original_pages], ['table', []], 'a place the table made, no pages of its own');
	assert.ok(stair.relations.some(rel => rel.kind === 'located-in' && rel.to === tower.name), 'registered inside the tower (located-in)');
	let scope = await table.reading.chapterScope(table.mid, table.campaign);
	assert.deepEqual([scope.name, scope.first, scope.last, scope.resolved], ['Tower', 7, 8, 'scene_parent']);
	// The journey places a mint with no within inside the place the party stands (§264.14): the stair, whose parent is the tower.
	await table.raw('table.narrate', {campaign: table.campaign, call_id: 't1-c2', text: 'The stair turns and turns.'});
	await table.raw('table.player_input', {campaign: table.campaign, text: 'I keep climbing to the top.'});
	await table.raw('table.apply', {campaign: table.campaign, call_id: 't2-c1', effects: [{kind: 'move', to: 'Lamp room', via: 'up the last steps', travel_minutes: 2,
		establish: {summary: 'The lamp room at the top of the tower.'}}]});
	assert.equal((await table.raw('table.capsule', {campaign: table.campaign, _context_read: true})).where.scene, 'Lamp room');
	const lamp = (await table.raw('table.lookup', {campaign: table.campaign, kind: 'module', query: 'Lamp room', _context_read: true})).entities[0];
	assert.deepEqual(lamp.relations.filter(rel => rel.kind === 'located-in').map(rel => rel.to), [stair.name], 'inside the stair, two levels below the tower');
	table.notes.length = 0;
	scope = await table.reading.chapterScope(table.mid, table.campaign);
	assert.deepEqual([scope.name, scope.resolved], ['Tower', 'scene_parent']);
	assert.deepEqual(table.notes.filter(row => row.event === 'chapter_scope'), [], 'the same chapter: nothing changed, nothing noted');
	const kept = JSON.parse(await readFile(join(table.home, '.coc', 'chapter-scope', `${createHash('sha256').update(table.campaign).digest('hex').slice(0, 32)}.json`), 'utf8'));
	assert.equal(kept.modules[table.mid].source, 'scene_parent');
});
