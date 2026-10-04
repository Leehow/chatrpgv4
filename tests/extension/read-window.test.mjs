import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §182: reading follows the book's chapters. A short book (at most `reading.whole_book_max_pages`, shipped 60) is
 * streamed whole once and then records `build_complete`, after which the read-ahead asks nothing more; a long book's
 * background asks are limited to its reading window -- the chapter that holds the current scene and the next one, from the
 * PDF's own top-level bookmarks (`source_document.outline`), or, without chapters, the anchor page through
 * `reading.fallback_window_pages` (shipped 24) pages after it. The read-ahead never asks the whole-book index of a book that
 * reads by reference units, and it reports its `window`.
 *
 * Found 2026-10-04: four tables of a 111-page book each added 174-707 graph nodes in the background while the player played
 * 5-10 turns in 2-4 scenes; at most 7-17% of them ever reached the Keeper, and every fork queued a whole-book index job that
 * never finished. The PDF carries its chapters as bookmarks, which the host read at binding and the kernel dropped.
 *
 * These cases travel the kernel's own entry points (`module.source.bind`, `module.source.outline`, `module.reference.publish`,
 * `module.read.ahead`, `module.read.claim`, `module.read.finish`, `campaign.create`), as `fork-read-ahead.test.mjs` does; the
 * host cases drive the reading service's own read-ahead and outline backfill with a recording kernel.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {KernelError} from '../../extensions/kernel/client.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('read-window', 'suite-', {retain: Boolean(process.env.KEEP_READ_WINDOW_EVIDENCE)});
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
	`export {cleanOutline, outlineChapters, indexChapters, readingWindow} from './kernel-ts/modules/chapters.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'read-window-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

const save = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const REFS = [{page: 1}];
const EMPTY = {nodes: [], claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: []};
/** The PDF's top-level bookmarks as the host's `sourceInfo` reads them: chapters at pages 1, 41, 45, 49 and 91. */
const BOOKMARKS = [{name: 'Front matter', page: 1, children: []}, {name: 'The town', page: 41, children: [{name: 'The inn', page: 42, children: []}]},
	{name: 'The mine', page: 45, children: []}, {name: 'The base', page: 49, children: []}, {name: 'Finale', page: 91, children: []}];

/**
 * A bound PDF of `pages` pages in a fresh home, with the fast reference path (§148) published in the library: guidance and
 * original-context entrances (`entries`), the first of them chosen as the opening. `bookmarks` is what the host read.
 */
async function book(name, pages, {bookmarks, entries = [{id: 'scene-source-entry-42', name: 'Harbor', page: 42}]} = {}) {
	const workspace = await mkdtemp(join(directory, `${name}-`));
	const context = await api.createKernelContext({workspace, content: CONTENT, seed: name, locks: api.nativeAdvisoryLocks(),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context);
	closers.push(() => runtime.close());
	const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
	const kernel = async (method, params = {}) => {
		try { return wire(await runtime.handlers[method](params)); }
		catch (error) { if (typeof error?.toJson === 'function') throw new KernelError(wire(error.toJson())); throw error; }
	};
	const file = join(workspace, 'original.pdf'), bytes = Buffer.from(`%PDF-1.7\n${name} read window fixture\n`);
	await writeFile(file, bytes);
	const source = sha(bytes), all = Array.from({length: pages}, (_, index) => index + 1);
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: pages, file_sha256: source, ...(bookmarks ? {bookmarks} : {})}});
	const b = {workspace, mid, sha: source, kernel};
	b.call = (method, params = {}, campaign) => kernel(method, {module_id: mid, ...params, ...(campaign ? {campaign} : {})});
	b.dir = campaign => campaign ? join(workspace, '.coc/module-campaigns', campaign, 'modules', mid) : join(workspace, '.coc/modules', mid);
	b.meta = async campaign => JSON.parse(await readFile(join(b.dir(campaign), 'module.json'), 'utf8'));
	b.queue = async campaign => JSON.parse(await readFile(join(b.dir(campaign), 'deepen-queue.json'), 'utf8'));
	b.ahead = (params = {}, campaign) => b.call('module.read.ahead', params, campaign);
	/** Every reading queued in this scope reads and settles: a unit publishes nothing new, any other reading fails. */
	b.drain = async campaign => {
		for (let job = await b.call('module.read.claim', {owner: 'test-host'}, campaign); job.job_id; job = await b.call('module.read.claim', {owner: 'test-host'}, campaign)) {
			if (job.source_unit) {
				await save(join(job.work_dir, 'observations.json'), {file_sha256: source, read_pages: all, full_pages: all, review_pages: all});
				await save(join(job.work_dir, 'draft.json'), EMPTY);
				const checked = (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
				await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []});
				await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
					review_path: join(job.work_dir, 'review.json')}, campaign);
			}
			else await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: 'fixture: this reading finds nothing'}, campaign);
		}
	};
	/** What is queued is read, then a read-ahead pass, until a pass finds nothing queued and queues nothing; that pass's result. */
	b.settle = async (params = {}, campaign) => {
		for (let pass = 0; pass < 40; pass++) {
			await b.drain(campaign);
			const result = await b.ahead(params, campaign);
			if (!result.queued.length && !(await b.queue(campaign)).some(job => job.state === 'queued')) return result;
		}
		throw new Error('the read-ahead never stopped asking');
	};
	/** The first page of every source unit this scope ever queued, in queue order. */
	b.units = async campaign => (await b.queue(campaign)).filter(job => job.source_unit).map(job => job.source_unit.first);
	// The fast reference path, published in the library (as setup does before any campaign exists).
	const work = join(b.dir(), 'work', 'source-reference-fixture');
	await mkdir(work, {recursive: true});
	const text = 'Harbor in 1925. Choose your own investigator.', span = {id: 'p3-0-43', page: 3, start: 0, end: text.length, text};
	const packet = {protocol: 'source-reference-v1', source_sha256: source, extraction_version: 'fixture', purpose: 'guidance', question: 'Start', excerpts: [span],
		fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, [span.id]])),
		entries, partial: true, visual_coverage: 'unassessed', unavailable_pages: []};
	const task = JSON.stringify({purpose: 'guidance', source_reference: 'guidance'}), body = JSON.stringify(packet);
	await save(join(work, 'task.json'), task);
	await save(join(work, 'source-reference.json'), body);
	await save(join(work, 'reference-guidance.txt'), text);
	const public_fields = Object.fromEntries(['era', 'starting_place', 'public_premise', 'creation_advice'].map(key => [key, {status: 'value', text, source_refs: [{page: 3}]}]));
	const checks = Object.fromEntries(['wrong_orientation', 'card_restriction', 'advice_omission', 'warning_omission', 'plot_disclosure', 'causal_conflict']
		.map(key => [key, {status: 'answered', type: 'noul', noul: 0}]));
	await save(join(work, 'source-reference-complete.json'), {protocol: 'source-reference-v1', kind: 'guidance', source_sha256: source,
		task_sha256: sha(task), packet_sha256: sha(body), text_sha256: sha(text), checks_policy: 'material-issues-v1', checks, public_fields});
	assert.equal((await b.call('module.reference.publish', {work_dir: work, guidance_key: 'd'.repeat(64), play_language: 'en', start_scene: entries[0].name})).setup_ready, true);
	return b;
}
const noIndex = async (b, campaign) => assert.equal((await b.queue(campaign)).some(job => job.purpose === 'index'), false, 'no whole-book index job is queued for a reference-read book');

test('§182.1: binding keeps the top-level bookmarks with a page as the outline; children and malformed rows are dropped', async () => {
	const long = 'X'.repeat(300);
	const b = await book('bind-outline', 120, {bookmarks: [{name: '  The town  ', page: 41, children: [{name: 'The inn', page: 42, children: []}]},
		{name: 'No page', children: []}, {name: long, page: 50, children: []}, {name: 'Beyond the book', page: 999, children: []},
		{name: 'Front matter', page: 1, children: []}, {page: 3, children: []}, {name: '   ', page: 4}, 'not a row']});
	assert.deepEqual((await b.meta()).source_document.outline, [{name: 'Front matter', page: 1}, {name: 'The town', page: 41}, {name: 'X'.repeat(200), page: 50}]);
	assert.equal((await b.call('module.status')).outline, 3, 'module.status reports the outline a host need not backfill');
	const bare = await book('bind-no-outline', 20, {entries: [{id: 'scene-source-entry-3', name: 'Harbor', page: 3}]});
	assert.equal((await bare.meta()).source_document.outline, undefined, 'a host that sent no bookmarks records no outline');
	assert.equal((await bare.call('module.status')).outline, null, 'module.status says the outline was never recorded');
});

test('§182.1: chapters run from one bookmark to the next; a page shared collapses to the last; one chapter is none; the window holds the chapter in play and the next', () => {
	assert.deepEqual(api.outlineChapters([{name: 'Contents', page: 3}, {name: 'Welcome', page: 17}, {name: 'The town', page: 17}, {name: 'The base', page: 43}], 60),
		[{name: 'Contents', first: 3, last: 16}, {name: 'The town', first: 17, last: 42}, {name: 'The base', first: 43, last: 60}]);
	assert.deepEqual(api.outlineChapters([{name: 'Only', page: 1}], 60), [], 'fewer than two chapters is none');
	const chapters = api.outlineChapters(BOOKMARKS, 120);
	assert.deepEqual(api.readingWindow(120, chapters, 42, 24), {mode: 'chapters', first: 41, last: 48, chapters: ['The town', 'The mine']});
	assert.deepEqual(api.readingWindow(120, chapters, 95, 24), {mode: 'chapters', first: 91, last: 120, chapters: ['Finale']}, 'the last chapter has no next');
	assert.deepEqual(api.readingWindow(120, api.outlineChapters(BOOKMARKS.slice(1), 120), 7, 24), {mode: 'chapters', first: 7, last: 44, chapters: ['The town']},
		'front matter reads on through the first chapter');
	assert.deepEqual(api.readingWindow(120, [], 100, 24), {mode: 'pages', first: 100, last: 120, chapters: []}, 'a page window stops at the last page');
	assert.deepEqual(api.indexChapters([{name: 'Harbor', pages: [[0, 9]]}, {name: 'Tower', pages: [[10, 19], [30, 31]]}, {name: 'Lost', pages: [[20, 29]], state: 'unreadable'}], 40),
		[{name: 'Harbor', first: 1, last: 10}, {name: 'Tower', first: 11, last: 40}], 'the model index sections are the fallback chapters');
});

test('§182.3: a long book reads the chapter in play and the next; when the scene moves to another chapter the next pass reads the new window only', async () => {
	const b = await book('long-chapters', 120, {bookmarks: BOOKMARKS,
		entries: [{id: 'scene-source-entry-42', name: 'Harbor', page: 42}, {id: 'scene-source-entry-95', name: 'Mine Shaft', page: 95}]});
	const first = await b.ahead({focus: 'Harbor'});
	assert.deepEqual(first.window, {mode: 'chapters', first: 41, last: 48, chapters: ['The town', 'The mine']});
	assert.deepEqual(await b.units(), [41, 43], 'the units of the scene\'s chapter are asked first, two in flight');
	const read = await b.settle({focus: 'Harbor'});
	assert.deepEqual(read.window, first.window);
	assert.deepEqual(await b.units(), [41, 43, 45, 47], 'only the units of the window are ever asked: the town and the mine, nothing before or after');
	const scans = (await b.queue()).filter(job => job.visual_scan).map(job => `${job.visual_scan.first}-${job.visual_scan.last}`);
	assert.deepEqual([...new Set(scans)], ['41-60'], 'only the contact sheet that meets the window');
	// The scene moves to a scene in the last chapter: the next pass works on that chapter alone.
	const moved = await b.ahead({focus: 'Mine Shaft'});
	assert.deepEqual(moved.window, {mode: 'chapters', first: 91, last: 120, chapters: ['Finale']});
	assert.deepEqual(await b.units(), [41, 43, 45, 47, 95, 97], 'the next pass reads the new window, from the scene\'s page on, and nothing of the window it left');
	await b.settle({focus: 'Mine Shaft'});
	const units = await b.units();
	assert.ok(units.slice(4).every(page => page >= 91), `after the move every unit asked is in the finale: ${units}`);
	assert.equal(units.length, 4 + 15, 'the finale has fifteen units, each asked once');
	await noIndex(b);
});

test('§182.3: a long book without bookmarks reads a page window from the scene\'s page', async () => {
	const b = await book('long-pages', 120);
	const first = await b.ahead({focus: 'Harbor'});
	assert.deepEqual(first.window, {mode: 'pages', first: 42, last: 66, chapters: []});
	await b.settle({focus: 'Harbor'});
	assert.deepEqual(await b.units(), [41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63, 65], 'every unit asked meets pages 42-66; none beyond');
	await noIndex(b);
});

test('§182.2 × §179.1: a short book is streamed whole once; when every ask has finished the build completes, the library adopts it, and a later fork asks nothing', async () => {
	const b = await book('short-build', 20, {entries: [{id: 'scene-source-entry-3', name: 'Harbor', page: 3}]});
	await b.kernel('campaign.create', {id: 'first-table', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	const first = await b.ahead({}, 'first-table');
	assert.deepEqual(first.window, {mode: 'whole', first: 1, last: 20, chapters: [], complete: false});
	const done = await b.settle({}, 'first-table');
	assert.deepEqual(await b.units('first-table'), [3, 5, 7, 9, 11, 13, 15, 17, 19, 1], 'the whole book is streamed, from the opening\'s page on');
	await noIndex(b, 'first-table');
	assert.equal(done.window.complete, true, 'the pass that finds nothing left reports the build complete');
	assert.equal(done.library_sync?.state, 'published', 'the completion is offered to the library at once');
	assert.equal((await b.meta('first-table')).reading.build_complete.source_sha256, b.sha);
	assert.equal((await b.meta()).reading.build_complete?.source_sha256, b.sha, 'the library adopted the build');
	const jobs = (await b.queue('first-table')).length, again = await b.ahead({}, 'first-table');
	assert.deepEqual([again.queued, again.window.complete], [[], true]);
	assert.equal((await b.queue('first-table')).length, jobs, 'a built book queues nothing more for its source');
	// A second table forks the library after it adopted the build: its fork starts complete and its read-ahead asks nothing.
	await b.kernel('campaign.create', {id: 'second-table', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	const second = await b.ahead({}, 'second-table');
	assert.deepEqual([second.queued, second.window.complete], [[], true]);
	assert.deepEqual(await b.queue('second-table'), [], 'the second table reads nothing in the background');
});

const NEED_Q = 'Where does the book print the foreman\'s full profile?';
test('§182.3 × §151.4: a need is asked only when its entity cites a page inside the window', async () => {
	const b = await book('long-need', 120, {bookmarks: BOOKMARKS,
		entries: [{id: 'scene-source-entry-42', name: 'Harbor', page: 42}, {id: 'scene-source-entry-95', name: 'Mine Shaft', page: 95}]});
	// The finale's first unit publishes the foreman (printed on page 95) and retains a need about him.
	await b.ahead({focus: 'Mine Shaft'});
	const unit = (await b.queue()).find(job => job.source_unit?.first === 95);
	let job = await b.call('module.read.claim', {owner: 'test-host'});
	while (job.job_id !== unit.job_id) {
		await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: 'fixture: not this one'});
		job = await b.call('module.read.claim', {owner: 'test-host'});
	}
	await save(join(job.work_dir, 'observations.json'), {file_sha256: b.sha, read_pages: [95, 96], full_pages: [95, 96], review_pages: [95, 96]});
	await save(join(job.work_dir, 'draft.json'), {...EMPTY, nodes: [{node_id: 'npc-foreman', node_kind: 'npc', name: 'Foreman', source_refs: [{page: 95}], properties: {}}],
		ready_nodes: [], source_needs: [{kind: 'source_read', focus: 'Foreman', question: NEED_Q, reason: 'Not on these pages.', trigger: 'If he fights.', source_refs: [{page: 95}]}]});
	const checked = (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
	await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: [{page: 95}], reason: 'fixture support'}] : [], missing: []});
	await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	const asked = async () => (await b.queue()).filter(job => job.question === NEED_Q).length;
	await b.ahead({focus: 'Harbor'});
	assert.equal(await asked(), 0, 'the town\'s window does not ask about a man printed in the finale');
	await b.ahead({focus: 'Mine Shaft'});
	assert.equal(await asked(), 1, 'the finale\'s window asks it');
});

test('§182.4: a background index queued before the read-ahead stopped asking it is not read; a foreground one is', async () => {
	const b = await book('stale-index', 120, {bookmarks: BOOKMARKS});
	const queue = await b.queue();
	queue.push({job_id: `read-${queue.length + 1}`, key: 'stale-index-key', purpose: 'index', focus: '', question: '', pages: [], foreground: false, state: 'queued', attempts: 0, at: new Date().toISOString()});
	await save(join(b.dir(), 'deepen-queue.json'), queue);
	const claimed = await b.call('module.read.claim', {owner: 'test-host'});
	assert.notEqual(claimed.purpose, 'index');
	const index = (await b.queue()).find(job => job.purpose === 'index');
	assert.equal(index.state, 'cancelled', 'the stale background index is cancelled, never claimed');
	await b.call('module.read.finish', {job_id: claimed.job_id, lease: claimed.lease, outcome: 'failed', detail: 'fixture'}).catch(() => undefined);
	assert.equal((await b.call('module.read.request', {purpose: 'index', foreground: true, retry: true})).state, 'queued', 'a foreground request still reads the index');
});

test('§182.1: module.source.outline writes the library and an existing fork, refuses another source, is idempotent, and forks no campaign', async () => {
	const b = await book('outline-backfill', 120);
	await b.kernel('campaign.create', {id: 'forked', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	await b.ahead({}, 'forked');
	await b.kernel('campaign.create', {id: 'unforked', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	assert.equal(existsSync(b.dir('unforked')), false);
	await assert.rejects(b.call('module.source.outline', {file_sha256: 'f'.repeat(64), outline: BOOKMARKS}), error => error.code === 'invalid_params' && error.details?.reason === 'source_mismatch');
	assert.equal((await b.meta()).source_document.outline, undefined, 'a refused outline writes nothing');
	const cleaned = BOOKMARKS.map(({name, page}) => ({name, page}));
	assert.deepEqual(await b.call('module.source.outline', {file_sha256: b.sha, outline: BOOKMARKS}, 'forked'),
		{module_id: b.mid, library: 'written', entries: 5, campaign: 'written'});
	assert.deepEqual((await b.meta()).source_document.outline, cleaned);
	assert.deepEqual((await b.meta('forked')).source_document.outline, cleaned);
	assert.deepEqual(await b.call('module.source.outline', {file_sha256: b.sha, outline: BOOKMARKS}, 'forked'),
		{module_id: b.mid, library: 'unchanged', entries: 5, campaign: 'unchanged'}, 'idempotent');
	assert.deepEqual(await b.call('module.source.outline', {file_sha256: b.sha, outline: BOOKMARKS}, 'unforked'),
		{module_id: b.mid, library: 'unchanged', entries: 5, campaign: 'no_fork'});
	assert.equal(existsSync(b.dir('unforked')), false, 'the outline forks no campaign');
	// The fork's next pass reads by chapters: the scene's page (42) is in the town, so the town and the mine.
	assert.deepEqual((await b.ahead({}, 'forked')).window, {mode: 'chapters', first: 41, last: 48, chapters: ['The town', 'The mine']});
});

/** A reading service on a recording kernel: `answers` maps a method to its reply (a function of the params, or a value). */
function service(answers, rows, runtime = {}) {
	const calls = [];
	const reading = new ReadingService({home: directory, model: () => ({}), progress() {}, record: row => rows.push(row), campaign: () => 'table',
		runtime: {sourceInfo: async () => { throw new Error('sourceInfo was not expected'); }, ...runtime},
		async call(method, params) { calls.push({method, params}); const answer = answers[method]; if (answer === undefined) throw new Error(`unexpected ${method}`);
			return typeof answer === 'function' ? answer(params) : answer; }});
	return {reading, calls};
}

test('§182.4 host: a read_window row is written when the window changes, never for the same window again', async () => {
	const rows = [], windows = [{mode: 'chapters', first: 41, last: 48, chapters: ['The town', 'The mine']}];
	windows.push(windows[0], {mode: 'chapters', first: 91, last: 120, chapters: ['Finale']});
	let pass = 0;
	const {reading} = service({'module.read.ahead': () => ({queued: [], window: windows[pass++]})}, rows);
	for (let index = 0; index < windows.length; index++) await reading['readAhead']({module_id: 'book-1'}, 'table');
	assert.deepEqual(rows.filter(row => row.event === 'read_window').map(({lane, event, module_id, campaign, first, last, mode, chapters}) => ({lane, event, module_id, campaign, mode, first, last, chapters})), [
		{lane: 'reading', event: 'read_window', module_id: 'book-1', campaign: 'table', mode: 'chapters', first: 41, last: 48, chapters: ['The town', 'The mine']},
		{lane: 'reading', event: 'read_window', module_id: 'book-1', campaign: 'table', mode: 'chapters', first: 91, last: 120, chapters: ['Finale']}]);
});

test('§182.1 host: a table opening on a book without an outline hands the PDF\'s bookmarks to module.source.outline; a recorded outline is left alone', async () => {
	const rows = [];
	const {reading, calls} = service({'module.status': {source: 'pdf', outline: null}, 'module.source.snapshot': {pdf: '/books/one.pdf', file_sha256: 'a'.repeat(64)},
		'module.source.outline': {module_id: 'book-1', library: 'written', entries: 5, campaign: 'written'}}, rows,
		{sourceInfo: async source => ({path: source.pdf, file_sha256: 'a'.repeat(64), page_count: 120, labels: null, bookmarks: BOOKMARKS})});
	await reading.backfillOutline('book-1');
	assert.deepEqual(calls.map(call => call.method), ['module.status', 'module.source.snapshot', 'module.source.outline']);
	assert.deepEqual(calls[2].params, {module_id: 'book-1', file_sha256: 'a'.repeat(64), outline: BOOKMARKS, campaign: 'table'});
	assert.equal(rows.find(row => row.event === 'outline_backfill')?.state, 'written');
	const kept = service({'module.status': {source: 'pdf', outline: 5}}, []);
	await kept.reading.backfillOutline('book-1');
	assert.deepEqual(kept.calls.map(call => call.method), ['module.status'], 'a recorded outline is not read again');
	const failedRows = [], failing = service({'module.status': {source: 'pdf', outline: null}, 'module.source.snapshot': {pdf: '/books/one.pdf', file_sha256: 'a'.repeat(64)}}, failedRows,
		{sourceInfo: async () => { throw new Error('the PDF cannot be opened'); }});
	await failing.reading.backfillOutline('book-1');
	assert.deepEqual(failedRows.map(row => [row.event, row.state, row.detail]), [['outline_backfill', 'failed', 'the PDF cannot be opened']], 'a failure is one row and nothing else');
});
