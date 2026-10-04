/**
 * Contract §177 (owner ruling 2026-10-04, 「按你推荐的做」 on docs/specs/module-cast.md): the book's cast.
 *
 * Probe of 2026-10-04 (a scratch copy of table 23's campaign, Blood Road at turn 9): seven `walk_on` names carrying book names
 * -- 史蒂夫, 老史蒂夫, 史蒂夫大叔, 拉塞尔, 卡车司机拉塞尔, 爱丽丝, 金发的爱丽丝 -- were all minted as new people, beside 史蒂夫·布朗,
 * the told 拉塞尔·威廉姆斯 and 爱丽丝·杜威特; and the graph, read on demand, had only the 54 people the reader had reached.
 *
 * Here, on the real kernel over a bound three-page PDF whose graph has only Old Mae: the cast reader's job, its source and its
 * submit (refusing a row whose name no cited page prints); the stored rows joining the graph's person or standing as people
 * not read yet; the newcomer refusal; the Keeper's rename and the epithet lane over the whole cast; lookup by the table's
 * word; a write naming an unread person landing on the cast's pages; the replacement by cast id; a book with no text layer;
 * and an authored module, whose cast is its graph.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'module-cast-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {replacePassagePeople} from './kernel-ts/read/table-people.ts';
export {bookCast, newcomerRefusal} from './kernel-ts/read/cast.ts';
export {checkCastDraft, mergeCastRows} from './kernel-ts/cast/draft.ts';
export {untoldRoster} from './kernel-ts/read/capsule.ts';
export {foldPersonWords} from './kernel-ts/read/person-words.ts';
export {checkModuleCast} from './kernel-ts/check.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const PAGES = ['The harbor dock smells of tar. Old Mae mends nets by the water.',
	'The old tower stands beyond the harbor. Its keeper, Silas Marsh, trims the lamp.',
	"Below the tower a cellar floods at high tide. Mae's boy Jonah drowned there last spring."];
const REFS = [{page: 1}];
const CAMPAIGN = 'harbor-camp';

async function kernel(t, seed) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed,
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const attempt = async (method, params = {}) => { try { return {ok: true, result: await raw(method, params)}; } catch (error) { return {ok: false, error}; } };
	return {home, raw, attempt};
}

/** A bound PDF read as far as its opening: the graph has the Dock, the Tower and Old Mae; the index lists Silas Marsh. */
async function harbor(t) {
	const k = await kernel(t, 'module-cast');
	const pdf = join(k.home, 'harbor.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await k.raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: sha}});
	const read = async (purpose, draft, paths) => {
		await k.raw('module.read.request', {module_id: mid, purpose});
		const job = await k.raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}], missing: []}));
		return k.raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor and tower', pages: [[1, 3]], source_refs: [{page: 1}],
		entities: ['Dock', 'Tower', 'Silas Marsh']}]}, []);
	await read('opening', {nodes: [
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'},
		{node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: REFS, summary: 'A net mender on the dock.'}],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock']}, ['/nodes/0', '/claims/0', '/coverage']);
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: CAMPAIGN, module: mid, play_language: 'en'});
	await k.raw('investigator.load', {campaign: CAMPAIGN, library_id: saved.library_id});
	await k.raw('setup.complete', {campaign: CAMPAIGN});
	await k.raw('table.open', {campaign: CAMPAIGN});
	await k.raw('table.narrate', {campaign: CAMPAIGN, call_id: 't0-c1', text: 'The harbor is quiet.'});
	const call = (method, params = {}) => k.raw(method, {campaign: CAMPAIGN, ...params});
	const attempt = (method, params = {}) => k.attempt(method, {campaign: CAMPAIGN, ...params});
	const world = async () => JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', CAMPAIGN, 'world.json'), 'utf8'));
	return {...k, mid, sha, call, attempt, world};
}

const DRAFT = {people: [
	{book: ['Old Mae', 'Mae'], play: ['Old Mae', 'Mae'], notes: ['Old Mae', 'Mae'], pages: [1, 3]},
	{book: ['Silas Marsh'], play: ['Silas Marsh'], notes: ['Silas Marsh'], pages: [2]},
	{book: ['Jonah'], play: ['Jonah'], notes: ['Jonah'], pages: [3]},
	{book: ['Harbormaster Quill'], play: ['Harbormaster Quill'], notes: ['Harbormaster Quill'], pages: [1]},
]};

/** The host's calls (extensions/module/reading-service.ts `readCast`), with the reader child's draft written by hand. */
async function readCast(h, draft = DRAFT) {
	const job = await h.call('cast.job', {module_id: h.mid});
	const staged = await h.call('cast.source', {module_id: h.mid, job_id: job.job_id, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const place = await h.call('cast.range', {module_id: h.mid, job_id: job.job_id, index: staged.ranges[0].index});
	await writeFile(join(place.cwd, 'draft.json'), JSON.stringify(draft));
	return {job, staged, place, submitted: await h.call('cast.submit', {module_id: h.mid, job_id: job.job_id, index: place.index})};
}

test('§177.2: the cast reader works on the book\'s own text; a row no cited page prints is refused alone; the reader\'s check agrees', async t => {
	const h = await harbor(t);
	const job = await h.call('cast.job', {module_id: h.mid});
	assert.match(job.job_id, /^cast:/);
	assert.deepEqual([job.page_count, job.play_language, job.source], [3, 'en', 'needed']);
	const staged = await h.call('cast.source', {module_id: h.mid, job_id: job.job_id, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	assert.deepEqual(staged, {state: 'ready', ranges: [{index: 0, first: 1, last: 3, done: false}]});
	const place = await h.call('cast.range', {module_id: h.mid, job_id: job.job_id, index: 0});
	assert.deepEqual([place.first, place.last, place.pages_with_text, place.known], [1, 3, 3, 0]);
	assert.equal(await readFile(join(place.cwd, 'pages', 'page-0002.txt'), 'utf8'), PAGES[1], 'one file per physical page, as the text layer has it');
	assert.deepEqual(JSON.parse(await readFile(join(place.cwd, 'task.json'), 'utf8')).range, {index: 0, first: 1, last: 3});

	await writeFile(join(place.cwd, 'draft.json'), JSON.stringify(DRAFT));
	const checked = await api.checkModuleCast(join(place.cwd, 'draft.json'));
	assert.equal(checked.ok, false);
	assert.deepEqual(checked.refused.map(row => [row.index, row.reason]), [[3, 'not_on_page']], 'the reader\'s own check names the row it refuses');
	assert.match(checked.refused[0].fix, /add the page/);

	const submitted = await h.call('cast.submit', {module_id: h.mid, job_id: job.job_id, index: 0});
	assert.deepEqual([submitted.state, submitted.people, submitted.refused.map(row => row.index)], ['complete', 3, [3]], 'the other rows stand');
	const stored = JSON.parse(await readFile(join(dirname(dirname(dirname(place.cwd))), 'cast.json'), 'utf8'));
	assert.equal(stored.source_sha256, h.sha);
	const jonah = stored.people.find(row => row.book.includes('Jonah'));
	assert.match(jonah.id, /^cast-[0-9a-f]{10}$/, 'an opaque id: no slug of the name');
	assert.deepEqual(jonah.first, {page: 3, sentence: "Mae's boy Jonah drowned there last spring."}, 'the first mention, cut by machine');
	assert.deepEqual(await h.call('cast.job', {module_id: h.mid}), {job_id: null, state: 'complete'}, 'a book reads its cast once');
	assert.equal((await h.attempt('cast.submit', {module_id: h.mid, job_id: 'cast:000000000000', index: 0})).ok, false);
});

test('§177.2: a long book is read in ranges; a later range joins a known person by a known form, keeps the row\'s id, and resumes where it stopped', async t => {
	const k = await kernel(t, 'module-cast-ranges');
	const pdf = join(k.home, 'long.pdf');
	await writeFile(pdf, '%PDF-1.7\n% a long book\n%%EOF\n');
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await k.raw('module.source.bind', {source: {path: pdf, page_count: 45, file_sha256: sha}});
	const text = page => page === 2 ? 'Its keeper, Silas Marsh, trims the lamp.' : page === 43 ? 'At dusk Silas lights the lamp again.' : page % 7 === 0 ? 'Rain on the harbor.' : '';
	const job = await k.raw('cast.job', {module_id: mid});
	const staged = await k.raw('cast.source', {module_id: mid, job_id: job.job_id, pages: Array.from({length: 45}, (_, index) => ({page: index + 1, text: text(index + 1)}))});
	assert.deepEqual(staged.ranges.map(range => [range.index, range.first, range.last]), [[0, 1, 40], [1, 41, 45]]);
	const first = await k.raw('cast.range', {module_id: mid, job_id: job.job_id, index: 0});
	await writeFile(join(first.cwd, 'draft.json'), JSON.stringify({people: [{book: ['Silas Marsh'], play: ['Silas Marsh'], notes: ['Silas Marsh'], pages: [2]}]}));
	assert.equal((await k.raw('cast.submit', {module_id: mid, job_id: job.job_id, index: 0})).state, 'partial');
	const castPath = join(k.home, '.coc', 'modules', mid, 'cast.json');
	const firstId = JSON.parse(await readFile(castPath, 'utf8')).people[0].id;
	const resumed = await k.raw('cast.job', {module_id: mid});
	assert.deepEqual([resumed.source, resumed.ranges.map(range => range.done)], ['kept', [true, false]], 'the text is kept; the next run starts at the range not read');
	const second = await k.raw('cast.range', {module_id: mid, job_id: job.job_id, index: 1});
	const task = JSON.parse(await readFile(join(second.cwd, 'task.json'), 'utf8'));
	assert.deepEqual(task.known_cast, [{book: ['Silas Marsh'], play: ['Silas Marsh'], notes: ['Silas Marsh']}], 'the reader of the next range sees who earlier ranges found');
	await writeFile(join(second.cwd, 'draft.json'), JSON.stringify({people: [{book: ['Silas Marsh', 'Silas'], play: ['Silas Marsh', 'Silas'], notes: ['Silas Marsh', 'Silas'], pages: [43]},
		{book: ['Silas Marsh'], play: ['Silas Marsh'], notes: ['Silas Marsh'], pages: [2]}]}));
	const checked = await api.checkModuleCast(join(second.cwd, 'draft.json'));
	assert.deepEqual(checked.refused.map(row => [row.index, row.reason]), [[1, 'shape']], 'a page outside the range is not this reader\'s to cite');
	const done = await k.raw('cast.submit', {module_id: mid, job_id: job.job_id, index: 1});
	assert.deepEqual([done.state, done.people, done.ranges_done, done.ranges_total], ['complete', 1, 2, 2]);
	const stored = JSON.parse(await readFile(castPath, 'utf8'));
	assert.deepEqual(stored.people.map(row => [row.id, row.book, row.pages]), [[firstId, ['Silas Marsh', 'Silas'], [2, 43]]],
		'one person across both ranges, under the id the first range gave (a word the lane gave under it stays theirs)');
});

test('§177.2: a row is one person as the reader wrote it, though two rows share a form; across ranges only a form one row carries joins', () => {
	const pages = new Map(PAGES.map((text, index) => [index + 1, text]));
	// Table 24: the reader gave a bare first name to the bar owner and to the doctor; folding on it made them one person.
	const two = api.checkCastDraft({people: [{book: ['Old Mae', 'Mae'], play: ['Old Mae', 'Mae'], notes: ['Old Mae', 'Mae'], pages: [1]}, {book: ['Mae'], play: ['Mae'], notes: ['Mae'], pages: [3]}]}, pages, 3);
	assert.deepEqual(two.people.map(row => row.book), [['Old Mae', 'Mae'], ['Mae']], 'two rows, two people');
	assert.notEqual(two.people[0].id, two.people[1].id);
	assert.equal(api.checkCastDraft({people: [], extra: 1}, pages, 3).error.length > 0, true);
	const shapes = api.checkCastDraft({people: [{book: ['Jonah'], pages: [3]}, {book: ['Jonah'], play: ['Jonah'], notes: ['Jonah'], pages: [9]}, {book: ['J'], play: ['J'], notes: ['J'], pages: [3]},
		{book: ['Jonah'], play: ['Jonah'], pages: [3]}]}, pages, 3);
	assert.deepEqual(shapes.refused.map(row => row.reason), ['shape', 'shape', 'shape', 'shape'], 'a row without notes is refused too');
	const stored = [{id: 'cast-aaaaaaaaaa', book: ['Robert Taylor', 'Robert'], play: ['Robert Taylor', 'Robert'], notes: ['Robert Taylor', 'Robert'], pages: [15]},
		{id: 'cast-bbbbbbbbbb', book: ['Robert Brenner', 'Robert'], play: ['Robert Brenner', 'Robert'], notes: ['Robert Brenner', 'Robert'], pages: [32]}];
	const merged = api.mergeCastRows(stored, [{id: 'cast-cccccccccc', book: ['Robert'], play: ['Robert'], notes: ['Robert'], pages: [50]},
		{id: 'cast-dddddddddd', book: ['Robert Brenner', 'Doc'], play: ['Robert Brenner', 'Doc'], notes: ['Robert Brenner', 'Doc'], pages: [51]}]);
	assert.deepEqual(merged.map(row => [row.id, row.book]), [['cast-aaaaaaaaaa', ['Robert Taylor', 'Robert']], ['cast-bbbbbbbbbb', ['Robert Brenner', 'Robert', 'Doc']],
		['cast-cccccccccc', ['Robert']]], 'the shared first name joins nobody; the doctor\'s full name joins him under his id');
	// A first name only one kept row carries is still no identity: the bar owner's row has it, the doctor is someone else.
	const onlyOne = api.mergeCastRows([{id: 'cast-aaaaaaaaaa', book: ['Robert Taylor', 'Robert'], play: ['Robert Taylor', 'Robert'], notes: ['Robert Taylor', 'Robert'], pages: [15]}],
		[{id: 'cast-eeeeeeeeee', book: ['Robert L. Brenner', 'Robert'], play: ['Robert L. Brenner', 'Robert'], notes: ['Robert L. Brenner', 'Robert'], pages: [52]}]);
	assert.deepEqual(onlyOne.map(row => row.id), ['cast-aaaaaaaaaa', 'cast-eeeeeeeeee']);
	// Rows of one range never join each other, though the second shares a form with the first.
	const sameRange = api.mergeCastRows([], [{id: 'cast-1111111111', book: ['Robert Taylor', 'Robert'], play: ['Robert Taylor'], notes: ['Robert Taylor'], pages: [15]},
		{id: 'cast-2222222222', book: ['Robert L. Brenner', 'Robert'], play: ['Robert L. Brenner'], notes: ['Robert L. Brenner'], pages: [32]}]);
	assert.equal(sameRange.length, 2);
});

test('§177.1/§177.4: a row joins a graph person by a whole identity; a name two untold people share is hidden as both their words', () => {
	const raw = {nodes: [{node_id: 'npc-robert-taylor', node_kind: 'npc', name: 'Robert Taylor', aliases: ['Robert'], source_refs: [{page: 15}]}], relations: []};
	const graph = new api.ModuleGraph('road', raw, 'digest', {});
	graph.castStore = {version: 4, source_sha256: 'x', state: 'complete', people: [
		{id: 'cast-aaaaaaaaaa', book: ['Robert L. Brenner', 'Robert'], play: ['Robert L. Brenner', 'Robert'], notes: ['Robert L. Brenner', 'Robert'], pages: [32]},
		{id: 'cast-bbbbbbbbbb', book: ['Robert Benson', 'Robert'], play: ['Robert Benson', 'Robert'], notes: ['Robert Benson', 'Robert'], pages: [36]},
		{id: 'cast-cccccccccc', book: ['Robert Taylor', 'Robert'], play: ['Robert Taylor', 'Robert'], notes: ['Robert Taylor', 'Robert'], pages: [41]}]};
	const cast = api.bookCast(graph);
	assert.deepEqual(cast.map(person => [person.id, person.castIds]), [['robert-taylor', ['cast-cccccccccc']], ['cast-aaaaaaaaaa', ['cast-aaaaaaaaaa']], ['cast-bbbbbbbbbb', ['cast-bbbbbbbbbb']]],
		'the doctor\'s and the hardware man\'s rows do not join the bar owner by the first name his node carries');
	const world = {person_epithets: {'robert-taylor': {word: 'the bar owner', by: 'graph'}, 'cast-aaaaaaaaaa': {word: 'the doctor', by: 'graph'}, 'cast-bbbbbbbbbb': {word: 'the hardware man', by: 'graph'}}};
	const roster = api.untoldRoster(graph, world, {}, []);
	const shown = name => roster.filter(row => row.name === name).map(row => row.shown);
	assert.deepEqual(shown('Robert'), ['the bar owner / the doctor / the hardware man'], 'hidden, and blamed on nobody');
	assert.deepEqual(shown('Robert L. Brenner'), ['the doctor']);
});

test('§177.14: the notes rendering is a name to hide and to refuse, never a form a delivery is checked for', () => {
	// Table 27 (turn 6): the reader's English fields called the station owner "Lars"; the cast held only the Chinese forms, the
	// request exit did not rename it, and the Keeper reasoned that the owner "is likely named Lars".
	const raw = {nodes: [{node_id: 'npc-lars-williams', node_kind: 'npc', name: '拉塞尔·威廉姆斯', aliases: ['拉斯', '拉索', '拉斯·威廉姆斯'], source_refs: [{page: 17}]}], relations: []};
	const graph = new api.ModuleGraph('road', raw, 'digest', {});
	graph.castStore = {version: 4, source_sha256: 'x', state: 'complete', people: [
		{id: 'cast-aaaaaaaaaa', book: ['拉斯·威廉姆斯', '拉斯'], play: ['拉斯·威廉姆斯', '拉斯'], notes: ['Lars Williams', 'Lars'], pages: [17]}]};
	const cast = api.bookCast(graph), [owner] = cast;
	assert.deepEqual(cast.map(person => [person.id, person.castIds]), [['lars-williams', ['cast-aaaaaaaaaa']]], 'the row joins the graph person by the whole printed name');
	assert.ok(owner.names.includes('Lars'), 'the notes rendering is one of his names');
	// Table 28: a note said "Russell" alone; the book's form is in two parts, so the two-word rendering's words are names too.
	const two = new api.ModuleGraph('road', {nodes: [{node_id: 'npc-x', node_kind: 'npc', name: '\u62c9\u585e\u5c14\u00b7\u5a01\u5ec9\u59c6\u65af', source_refs: [{page: 17}]}], relations: []}, 'digest', {});
	two.castStore = {version: 4, source_sha256: 'x', state: 'complete', people: [
		{id: 'cast-cccccccccc', book: ['\u62c9\u585e\u5c14\u00b7\u5a01\u5ec9\u59c6\u65af'], play: ['\u62c9\u585e\u5c14\u00b7\u5a01\u5ec9\u59c6\u65af'], notes: ['Russell Williams'], pages: [17]},
		{id: 'cast-dddddddddd', book: ['Silas Marsh'], play: ['Silas Marsh'], notes: ['Silas Marsh'], pages: [2]}]};
	const [russell, silas] = api.bookCast(two);
	assert.ok(russell.names.includes('Russell') && russell.names.includes('Williams'), `the rendering's words: ${russell.names}`);
	assert.ok(!silas.names.includes('Silas'), 'a book printed in the notes language splits nothing by spaces');
	assert.ok(!owner.printed.includes('Lars') && owner.printed.includes('拉斯'), 'the delivery gate checks only what the book prints and the play language writes');
	const world = {person_epithets: {'lars-williams': {word: '油布口袋的加油站老板', by: 'graph'}}};
	const roster = api.untoldRoster(graph, world, {}, []);
	assert.deepEqual(roster.filter(row => row.name === 'Lars').map(row => row.shown), ['油布口袋的加油站老板'], 'the request renames the notes rendering');
	assert.match(api.newcomerRefusal(graph, world, 'Lars from the garage')?.message ?? '', /name/i, 'a newcomer may not take it');
});

test('§177.5: a word that carries a name learned later is withdrawn; a word given while unread does not follow the person into the graph', async () => {
	const raw = {nodes: [{node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: [{page: 1}]},
		{node_id: 'npc-jonah', node_kind: 'npc', name: 'Jonah', source_refs: [{page: 3}]}], relations: []};
	const graph = new api.ModuleGraph('harbor', raw, 'digest', {});
	graph.castStore = {version: 4, source_sha256: 'x', state: 'complete', people: [
		{id: 'cast-0123456789', book: ['Jonah'], play: ['Jonah'], notes: ['Jonah'], pages: [3]}, {id: 'cast-9876543210', book: ['Silas'], play: ['Silas'], notes: ['Silas'], pages: [2]}]};
	const file = {people: {'old-mae': {word: "Silas's sister at the nets"}, 'cast-0123456789': {word: 'the drowned boy'}}};
	let written = null;
	const campaign = {path: name => name, context: {snapshots: {pathExists: async () => true}}, read: async () => structuredClone(file), write: async (name, value) => { written = value; }};
	const world = {person_epithets: {'old-mae': {word: "Silas's sister at the nets", by: 'graph'}}};
	await api.foldPersonWords(campaign, graph, world, {}, []);
	assert.ok(written && !written.people['old-mae'], 'withdrawn from the lane\'s file, so the lane is asked again');
	assert.equal(world.person_epithets['old-mae'], undefined, 'and from the world');
	assert.equal(world.person_epithets.jonah, undefined, 'the unread word was made from the sentence that first names him; he is worded again from his record');
});

test('§177.2: the cast is the book\'s, read in the shared library; the campaign\'s fork reads it', async t => {
	const h = await harbor(t);
	const forked = await readFile(join(h.home, '.coc', 'module-campaigns', CAMPAIGN, 'modules', h.mid, 'module.json'), 'utf8').then(() => true, () => false);
	assert.equal(forked, true, 'the fixture\'s campaign has its own copy of the module');
	const job = await h.raw('cast.job', {module_id: h.mid});
	const staged = await h.raw('cast.source', {module_id: h.mid, job_id: job.job_id, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const place = await h.raw('cast.range', {module_id: h.mid, job_id: job.job_id, index: staged.ranges[0].index});
	assert.ok(place.cwd.startsWith(join(h.home, '.coc', 'modules', h.mid)), place.cwd);
	await writeFile(join(place.cwd, 'draft.json'), JSON.stringify(DRAFT));
	await h.raw('cast.submit', {module_id: h.mid, job_id: job.job_id, index: place.index});
	const roster = (await h.call('table.untold')).people;
	assert.match(roster.find(row => row.name === 'Jonah')?.id ?? '', /^cast-/, 'the fork has no cast of its own and reads the library\'s');
});

test('§177.1/§177.4/§177.5: stored rows join the graph\'s person or stand unread; the rename and the epithet lane cover the whole cast', async t => {
	const h = await harbor(t);
	await readCast(h);
	const roster = (await h.call('table.untold')).people;
	const shownOf = name => roster.find(row => row.name === name)?.shown;
	assert.equal(roster.find(row => row.name === 'Mae')?.id, 'old-mae', 'a printed short form joins the graph person who carries the row\'s other name');
	const silasId = roster.find(row => row.name === 'Silas Marsh')?.id, jonahId = roster.find(row => row.name === 'Jonah')?.id;
	assert.match(silasId, /^cast-/, 'someone the book names and the graph does not have yet is renamed too');
	assert.equal(shownOf('Jonah'), jonahId, 'shown by the opaque row id until the lane gives a word');

	const job = await h.call('epithets.job');
	const ids = job.people.map(person => person.id);
	assert.ok(ids.includes('old-mae') && ids.includes(silasId) && ids.includes(jonahId), JSON.stringify(ids));
	assert.ok(ids.indexOf('old-mae') < ids.indexOf(jonahId), 'the graph\'s people first');
	assert.equal(job.people.find(person => person.id === jonahId).looks, "Mae's boy Jonah drowned there last spring.");
	const refused = await h.call('epithets.submit', {entries: [{id: jonahId, word: "Mae's drowned boy"}]});
	assert.equal(refused.refused[0]?.reason, 'untold_name', 'a word may not carry the name of anyone untold in the cast');
	const written = await h.call('epithets.submit', {entries: [{id: 'old-mae', word: 'the net mender'}, {id: silasId, word: 'the lamp keeper'}, {id: jonahId, word: 'the drowned boy'}]});
	assert.equal(written.written.length, 3, JSON.stringify(written.refused));

	await h.call('table.player_input', {text: 'I look along the dock.'});
	assert.deepEqual((await h.world()).person_epithets[jonahId]?.word, 'the drowned boy', 'folded under the row id at the turn\'s start');
	assert.equal((await h.call('table.untold')).people.find(row => row.name === 'Jonah')?.shown, 'the drowned boy');
	const person = await h.attempt('table.apply', {call_id: 't1-c1', effects: [{kind: 'person', who: 'old-mae', name: "Jonah's mother", why: 'the fiction'}]});
	assert.equal(person.ok, false);
	assert.equal(person.error.details?.reason, 'untold_name', 'apply person refuses a name of anyone untold in the cast');
	// The journal lane's label is refused for carrying the name of someone else untold in the cast, not only the person's own.
	await h.call('table.narrate', {call_id: 't1-c5', text: 'The net mender looks up. {{say:old-mae}}"Mind the cellar."{{/say}}'});
	const journal = await h.call('journal.job', {turn: 1});
	assert.ok(journal.recordable.includes('Old Mae'), JSON.stringify(journal.recordable));
	await assert.rejects(h.call('journal.submit', {job_id: journal.job_id, entries: [{name: 'Old Mae', label: "Jonah's mother at the nets"}]}),
		error => error?.details?.reason === 'untold_name' && !/Jonah drowned/.test(error.message), 'the drowned boy\'s name, though he is not in the graph');
	await h.call('journal.submit', {job_id: journal.job_id, entries: [{name: 'Old Mae', label: 'the woman with tar on her hands'}]});
});

test('§177.3: a newcomer may not take or carry a name of anyone the book names, nor a word the table already uses; the refusal names nobody', async t => {
	const h = await harbor(t);
	await readCast(h);
	const roster = (await h.call('table.untold')).people, silasId = roster.find(row => row.name === 'Silas Marsh')?.id;
	await h.call('epithets.submit', {entries: [{id: silasId, word: 'the lamp keeper'}]});
	await h.call('table.player_input', {text: 'Someone comes down the pier.'});
	let ordinal = 1;
	const walkOn = name => h.attempt('table.apply', {call_id: `t1-c${ordinal++}`, effects: [{kind: 'npc', name, to: 'here', walk_on: true, why: 'a stranger walks up'}]});
	for (const name of ['Jonah', 'old Jonah', "Mae's cousin", 'Silas Marsh', 'the lamp keeper']) {
		const answer = await walkOn(name);
		assert.equal(answer.ok, false, `${name} is refused`);
		assert.equal(answer.error.details?.reason, 'book_name', `${name}: ${answer.error.message}`);
		assert.ok(!/Silas Marsh|Old Mae|Jonah drowned/.test(answer.error.message.replace(JSON.stringify(name), '')), `the refusal names nobody: ${answer.error.message}`);
	}
	// A space is not punctuation (§103.8): the book prints only "Silas Marsh", so "Silas" alone is no name it gives anyone.
	assert.equal((await walkOn('Silas the boatwright')).ok, true);
	const stranger = await walkOn('the ferryman');
	assert.equal(stranger.ok, true, JSON.stringify(stranger.error?.message));
	assert.ok((await h.world()).table_people.some(row => row.name === 'the ferryman'));
	// The table's own newcomer is still theirs on a later write.
	assert.equal((await walkOn('the ferryman')).ok, true);
});

test('§177.6/§177.7: lookup finds a person by the table\'s word; an unread person answers as unread and a write naming them lands on the cast\'s pages', async t => {
	const h = await harbor(t);
	await readCast(h);
	const roster = (await h.call('table.untold')).people, jonahId = roster.find(row => row.name === 'Jonah')?.id;
	await h.call('epithets.submit', {entries: [{id: 'old-mae', word: 'the net mender'}, {id: jonahId, word: 'the drowned boy'}]});
	await h.call('table.player_input', {text: 'I ask about the cellar.'});
	const mae = await h.call('table.lookup', {kind: 'module', query: 'the net mender'});
	assert.equal(mae.entities[0]?.name, 'old-mae', 'the epithet finds her through the person junction');
	const boy = await h.call('table.lookup', {kind: 'module', query: 'the drowned boy'});
	assert.deepEqual([boy.entities[0]?.name, boy.entities[0]?.material, boy.entities[0]?.original_pages], ['the drowned boy', 'unread', [3]]);
	assert.equal(boy.status, undefined, 'not not_found');

	const place = extra => h.attempt('table.apply', {call_id: 't1-c1', ...extra, effects: [{kind: 'npc', name: 'the drowned boy', to: 'here', why: 'the story calls him up'}]});
	const held = await place({});
	assert.equal(held.ok, false);
	assert.equal(held.error.details?.reason, 'material_pending');
	assert.deepEqual(held.error.details.person, {key: 'the drowned boy', name: 'the drowned boy', names: ['Jonah'], book: false});
	assert.deepEqual(held.error.details.index, {pages: [3]}, 'the cast\'s pages, though no index row lists him');
	const passage = {scene: null, page: 3, label: null, sentence: "Mae's boy Jonah drowned there last spring."};
	const landed = await place({_land_on_text: [{key: 'the drowned boy', passage}]});
	assert.equal(landed.ok, true, JSON.stringify(landed.error?.message));
	assert.deepEqual(landed.result.person_text, [{person: 'the drowned boy', focus: 'Jonah', pages: [3], passage}]);
	const entry = (await h.world()).table_people.find(row => row.name === 'the drowned boy');
	assert.equal(entry?.cast_id, jonahId, 'registered under the table\'s word, with the row it came from');
});

test('§177.6: once the reader publishes the person, the landed entry is replaced by the cast row\'s id, though its word is no book name', () => {
	const raw = {nodes: [{node_id: 'npc-jonah', node_kind: 'npc', name: 'Jonah', source_refs: [{page: 3}]}], relations: []};
	const graph = new api.ModuleGraph('harbor', raw, 'digest', {});
	graph.castStore = {version: 4, source_sha256: 'x', state: 'complete', people: [{id: 'cast-0123456789', book: ['Jonah'], play: ['Jonah'], notes: ['Jonah'], pages: [3]}]};
	assert.deepEqual(api.bookCast(graph).map(person => [person.id, person.castIds]), [['jonah', ['cast-0123456789']]]);
	const world = {table_people: [{name: 'the drowned boy', from_passage: {page: 3, sentence: 'Jonah drowned.'}, cast_id: 'cast-0123456789'}],
		npc_stances: {'the drowned boy': 'wary'}};
	api.replacePassagePeople(graph, world);
	assert.equal(world.table_people[0].replaced_by, 'jonah');
});

test('§177.1/§177.2: a partial cast is used as it stands; a cast of another state or version is not', () => {
	const raw = {nodes: [{node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: [{page: 1}]}], relations: []};
	const people = state => {
		const graph = new api.ModuleGraph('harbor', raw, 'digest', {});
		graph.castStore = {version: 4, source_sha256: 'x', state, people: [{id: 'cast-0123456789', book: ['Jonah'], play: ['Jonah'], notes: ['Jonah'], pages: [3]}]};
		return api.bookCast(graph).map(person => person.id);
	};
	assert.deepEqual(people('partial'), ['old-mae', 'cast-0123456789'], 'the ranges read so far are true already');
	assert.deepEqual(people('complete'), ['old-mae', 'cast-0123456789']);
	assert.deepEqual(people('unavailable'), ['old-mae']);
});

test('§177.2 (owner Q2): a book with no text layer has no cast, and the checks read the graph', async t => {
	const h = await harbor(t);
	const job = await h.call('cast.job', {module_id: h.mid});
	const staged = await h.call('cast.source', {module_id: h.mid, job_id: job.job_id, pages: PAGES.map((_, index) => ({page: index + 1, text: '  '}))});
	assert.deepEqual(staged, {state: 'unavailable', reason: 'no_text_layer'});
	assert.deepEqual(await h.call('cast.job', {module_id: h.mid}), {job_id: null, state: 'unavailable'});
	await h.call('table.player_input', {text: 'A man walks up.'});
	const answer = await h.attempt('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: 'Old Mae', to: 'here', walk_on: true, why: 'x'}]});
	assert.equal(answer.ok, false, 'the graph\'s own person still refuses a newcomer under her name');
});

test('§177.15: a place the host judged part of another word is no name: not refused, not replaced, and it tells nobody', async t => {
	const h = await harbor(t);
	await readCast(h);
	const jonahId = (await h.call('table.untold')).people.find(row => row.name === 'Jonah')?.id;
	await h.call('epithets.submit', {entries: [{id: 'old-mae', word: 'the net mender'}, {id: jonahId, word: 'the drowned boy'}]});
	await h.call('table.player_input', {text: 'I ask the net mender about the boats.'});
	// Table 27 (turn 8): Dallas, written in Chinese, holds the station owner's printed nickname. Here a jinx is "a Jonah".
	const text = 'The crews called that skiff a Jonah. My boy Jonah went down to the cellar.';
	const {spans} = await h.call('table.untold_spans', {text});
	assert.deepEqual(spans.map(span => [span.name, span.nth, text.slice(span.start, span.end)]), [['Jonah', 0, 'Jonah'], ['Jonah', 1, 'Jonah']]);
	const cleared = [{name: 'Jonah', nth: 0}];
	const first = await h.attempt('table.narrate', {call_id: 't1-c1', text, untold_cleared: cleared});
	assert.equal(first.error?.details?.places, 1, 'only the place the host did not clear is refused');
	assert.match(first.error.details.excerpts[0], /a Jonah\. My boy \u25a2{5} went/, 'the cleared place shows as written, the name blanked');
	const again = await h.call('table.narrate', {call_id: 't1-c1', text, untold_cleared: cleared});
	assert.match(again.rendered_text, /a Jonah\. My boy the drowned boy went down/, 'the cleared place stands; the name is replaced');
	assert.ok((await h.call('table.untold')).people.some(row => row.id === jonahId), 'a Jonah of the crews told nobody his name');
	await h.call('table.player_input', {text: 'And the skiff?'});
	const whole = await h.call('table.narrate', {call_id: 't2-c1', text: 'They still call that skiff a Jonah.', untold_cleared: cleared});
	assert.equal(whole.rendered_text, 'They still call that skiff a Jonah.', 'every place cleared: delivered as written');
	assert.ok((await h.call('table.untold')).people.some(row => row.id === jonahId), 'and still told nobody');
	await h.call('table.player_input', {text: 'Anything for the boat?'});
	// A graph person's whole name, cleared too: an inn named after her is not her name said to the investigator.
	await h.call('table.narrate', {call_id: 't3-c1', text: 'She points you to the Old Mae Inn for a bed.', untold_cleared: [{name: 'Old Mae', nth: 0}]});
	assert.ok((await h.call('table.untold')).people.some(row => row.name === 'Old Mae'), 'an inn told nobody her name');
	await h.call('table.player_input', {text: 'Anything else?'});
	await assert.rejects(h.call('table.narrate', {call_id: 't4-c1', text: 'x', untold_cleared: [{name: 'Jonah'}]}),
		error => error?.details?.field === 'untold_cleared', 'the host\'s list has a shape');
});

test('§177.1: an authored module has no cast job; its cast is its graph, and an abbreviation is no name piece', async t => {
	const k = await kernel(t, 'module-cast-authored');
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('table.open');
	assert.deepEqual(await call('cast.job', {module_id: 'the-haunting'}), {job_id: null, reason: 'authored'});
	await call('table.player_input', {text: 'Someone knocks.'});
	const walkOn = async (name, n) => k.attempt('table.apply', {campaign: 'c1', call_id: `t1-c${n}`, effects: [{kind: 'npc', name, to: 'here', walk_on: true, why: 'a visitor'}]});
	const dooley = await walkOn('Dooley the younger', 1);
	assert.equal(dooley.error?.details?.reason, 'book_name', 'the alias the book gives Mr. Dooley');
	const mister = await walkOn('Mr Smith', 2);
	assert.equal(mister.ok, true, `"Mr" is written as an abbreviation in "Mr. Dooley", not as his name: ${mister.error?.message}`);
});

test('§177.11: a delivery that says an untold printed name in its own words is refused; the name token says it; once told it is the Keeper\'s', async t => {
	const h = await harbor(t);
	await readCast(h);
	const jonahId = (await h.call('table.untold')).people.find(row => row.name === 'Jonah')?.id;
	await h.call('epithets.submit', {entries: [{id: 'old-mae', word: 'the net mender'}, {id: jonahId, word: 'the drowned boy'}]});
	await h.call('table.player_input', {text: 'I ask the net mender about her family.'});
	// Table 25 (turn 8): the toothless trucker said 「叫我厄尼就行」, the name of another man of the book nobody had met.
	const unread = await h.attempt('table.narrate', {call_id: 't1-c1', text: 'She sighs. "My boy Jonah went down to the cellar."'});
	assert.equal(unread.ok, false);
	assert.deepEqual([unread.error.details?.reason, unread.error.details?.places], ['untold_name', 1], 'someone the reader has not reached');
	assert.deepEqual(unread.error.details?.excerpts, ['She sighs. "My boy \u25a2\u25a2\u25a2\u25a2\u25a2 went down to the cellar'], 'shown blanked, with the words around it');
	assert.ok(!(unread.error.message + JSON.stringify(unread.error.details)).includes('Jonah'), 'the refusal never quotes the name: the request would rename it');
	// The same names again in the turn: delivered, the name replaced by the word this table calls him -- never the name, never a stuck turn.
	const again = await h.call('table.narrate', {call_id: 't1-c1', text: 'She sighs. "My boy Jonah went down to the cellar."'});
	assert.match(again.rendered_text, /My boy the drowned boy went down/);
	assert.ok(!again.rendered_text.includes('Jonah'));
	await h.call('table.player_input', {text: 'And what do people call you?'});
	const graphPerson = await h.attempt('table.narrate', {call_id: 't2-c1', text: 'She says, "Call me Mae."'});
	assert.deepEqual(graphPerson.error?.details?.excerpts, ['She says, "Call me \u25a2\u25a2\u25a2."'], 'a printed form of an untold graph person');
	const token = await h.call('table.narrate', {call_id: 't2-c1', text: 'She wipes her hands. {{say:the net mender}}"Everyone calls me {{name:the net mender}}."{{/say}}'});
	assert.match(token.rendered_text, /Old Mae/, 'the token puts the book\'s name in on purpose');
	await h.call('table.player_input', {text: 'And your boy?'});
	const told = await h.attempt('table.narrate', {call_id: 't3-c1', text: 'Old Mae looks away.'});
	assert.equal(told.ok, true, `told, her name is the Keeper's to write: ${told.error?.message}`);
});

test('§177.11: a module without a cast has no names to refuse: a graph\'s names are as often roles and groups', async t => {
	const k = await kernel(t, 'module-cast-delivery-authored');
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await call('campaign.create', {id: 'c1', module: 'the-haunting-rulebook', play_language: 'en'});
	await call('investigator.load', {library_id: saved.library_id});
	await call('setup.complete');
	await call('table.open');
	await call('table.player_input', {text: 'I look around the street.'});
	const group = await k.attempt('table.narrate', {campaign: 'c1', call_id: 't1-c1', text: 'Down the street the kids are kicking a can past the newsstand.'});
	assert.equal(group.ok, true, `"the kids" is the Macario boys' alias, an ordinary phrase: ${group.error?.message}`);
});

test('§177.13: recall finds a person by the word this table calls them; a word nobody carries is still refused', async t => {
	const h = await harbor(t);
	await readCast(h);
	await h.call('epithets.submit', {entries: [{id: 'old-mae', word: 'the net mender'}]});
	await h.call('table.player_input', {text: 'What do I remember about the net mender?'});
	// Table 27 (turn 5): recall about the toothless trucker by his epithet was refused unknown_entity, and the lookup and look
	// in the same batch never ran. For someone untold the epithet is the only name the Keeper holds.
	const recalled = await h.call('table.recall', {what: 'memory', about: ['the net mender']});
	assert.deepEqual(recalled.about, ['Old Mae'], 'the epithet resolves to the person the memory rows name');
	await assert.rejects(h.call('table.recall', {what: 'memory', about: ['the lighthouse keeper']}),
		error => error?.code === 'unknown_entity' || /not a known name/.test(error?.message ?? ''), 'a word nobody carries is refused as before');
});

test('§177.12 with §176.9: a made-up name tells nobody; a form only the cast prints is her name in a label', async t => {
	const h = await harbor(t);
	await readCast(h);
	await h.call('epithets.submit', {entries: [{id: 'old-mae', word: 'the net mender'}]});
	await h.call('table.player_input', {text: 'I ask the net mender her name.'});
	// Table 26 (turn 8): asked his name, the toothless trucker said "call me Earl", a name the Keeper made up; the lane gave
	// named: true on that line and the book's name stopped being hidden. §176.9 asks the lane the narrow question.
	await h.call('table.narrate', {call_id: 't1-c1', text: 'She shrugs. {{say:the net mender}}"Folk call me Granny Nets."{{/say}}'});
	const job = await h.call('journal.job', {turn: 1});
	await assert.rejects(h.call('journal.submit', {job_id: job.job_id, entries: [{name: 'Old Mae', named: true, named_quote: 'Folk call me Granny Nets.'}]}),
		error => error?.details?.reason === 'not_a_book_name', 'a name nobody in the book has needs the narrow question');
	// The graph has only "Old Mae"; the book also prints "Mae" alone, which only the cast holds. A label carrying it names her.
	await assert.rejects(h.call('journal.submit', {job_id: job.job_id, entries: [{name: 'Old Mae', label: 'Mae of the nets'}]}),
		error => error?.details?.field === 'label' && /the book gives .Old Mae/.test(error?.message ?? ''), 'a form only the cast prints is her own book name in a label');
	await h.call('journal.submit', {job_id: job.job_id, entries: [{name: 'Old Mae', label: 'the woman with tar on her hands'}]});
	assert.ok((await h.call('table.untold')).people.some(row => row.name === 'Old Mae'), 'she stays untold, her book name still hidden');
	await h.call('table.player_input', {text: 'And your real name?'});
	await h.call('table.narrate', {call_id: 't2-c1', text: 'She sighs. {{say:the net mender}}"It is {{name:the net mender}}, if you must."{{/say}}'});
	const second = await h.call('journal.job', {turn: 2});
	if (second.job_id) await h.call('journal.submit', {job_id: second.job_id, entries: [{name: 'Old Mae', named: true, named_quote: 'It is Old Mae, if you must.'}]});
	assert.ok(!(await h.call('table.untold')).people.some(row => row.name === 'Old Mae'), 'her book name said, she is told');
});
