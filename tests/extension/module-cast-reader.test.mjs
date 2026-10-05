/**
 * Contract §177.2: the host side of the book's cast (extensions/module/reading-service.ts `cast`), against a stubbed kernel
 * and runtime (not a playtest). The service asks for the job, extracts the native text in batches the source helper accepts,
 * hands it to the kernel, runs one background reader child per page range under the cast instructions with the cast check on
 * its path, submits, records, and announces each range; a stopped run resumes at the first range not read; a second run with
 * the first's refusal follows a refused submit; a book with no text layer runs no child; one run per module at a time.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KernelError} from '../../extensions/kernel/client.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {EventEmitter} from 'node:events';
import moduleExtension from '../../extensions/module/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE_COUNT = 70;

function host(t, {texts = page => `Page ${page} names Jonah.`, submits, job: jobAnswer} = {}) {
	const calls = [], runs = [], rows = [], published = [];
	let dir;
	const ranges = [{index: 0, first: 1, last: 40, done: false}, {index: 1, first: 41, last: 70, done: false}];
	submits ??= [() => ({state: 'partial', people: 1, accepted: 1, refused: []}), () => ({state: 'complete', people: 2, accepted: 1, refused: []})];
	const runtime = {
		contentRoot: join(ROOT, 'content'),
		async sourceText({pages}) { calls.push(['sourceText', pages]); return {snapshots: pages.map(page => ({page, text: texts(page)}))}; },
		async runTask(task) {
			runs.push(task.request);
			await writeFile(join(task.request.cwd, 'draft.json'), JSON.stringify({people: []}));
			return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
		},
	};
	const call = async (method, params) => {
		calls.push([method, params]);
		if (method === 'module.source.snapshot') return {pdf: '/books/harbor.pdf', file_sha256: 'a'.repeat(64)};
		if (method === 'cast.job') return calls.filter(([name]) => name === 'cast.job').length === 1
			? ({lease: 'test-lease', ...(jobAnswer ?? {job_id: 'cast:aaaaaaaaaaaa', module_id: params.module_id, page_count: PAGE_COUNT, play_language: 'zh-Hans', source: 'needed'})}) : {job_id: null, state: 'complete'};
		if (method === 'cast.release') return {released: true};
		if (method === 'cast.source') return params.pages.some(page => page.text.trim()) ? {state: 'ready', ranges} : {state: 'unavailable', reason: 'no_text_layer'};
		if (method === 'cast.range') {
			const range = ranges[params.index], cwd = join(dir, `range-${params.index}`);
			await mkdir(cwd, {recursive: true});
			return {cwd, index: params.index, first: range.first, last: range.last, pages_with_text: range.last - range.first + 1, known: params.index};
		}
		if (method === 'cast.submit') {
			const answer = submits.shift();
			if (!answer) throw new Error('unexpected submit');
			return answer();
		}
		throw new Error(`unexpected ${method}`);
	};
	const reading = new ReadingService({home: tmpdir(), runtime, call, campaign: () => 'camp',
		model: () => ({id: 'fixture/reader', vision: true, thinking: 'low'}), progress() {}, record: row => rows.push(row), published: row => published.push(row)});
	return {
		calls, runs, rows, published, reading,
		async setup() { dir = join(await mkdtemp(join(tmpdir(), 'cast-reader-')), 'work'); t.after(() => rm(dirname(dir), {recursive: true, force: true})); t.after(() => reading.close()); },
	};
}

test('§177.2: job, text in batches, source, one background child per range under the cast instructions, submit, record, announce', async t => {
	const h = host(t);
	await h.setup();
	const result = await h.reading.cast('book-4');
	assert.deepEqual(result, {state: 'complete', people: 2, accepted: 1, refused: []});
	const batches = h.calls.filter(([name]) => name === 'sourceText').map(([, pages]) => pages);
	assert.deepEqual(batches.map(pages => [pages[0], pages.length]), [[1, 32], [33, 32], [65, 6]], 'every page, at most 32 a call');
	const source = h.calls.find(([name]) => name === 'cast.source')[1];
	assert.deepEqual([source.campaign, source.job_id, source.pages.length, source.pages[69]], [undefined, 'cast:aaaaaaaaaaaa', 70, {page: 70, text: 'Page 70 names Jonah.'}],
		'the cast is the book\'s: read in the shared library, which every campaign\'s fork falls back to');
	assert.ok(h.calls.filter(([name]) => name.startsWith('cast.')).every(([, params]) => !Object.hasOwn(params, 'campaign')));
	assert.deepEqual(h.calls.filter(([name]) => name === 'cast.range' || name === 'cast.submit').map(([name, params]) => [name, params.index]),
		[['cast.range', 0], ['cast.submit', 0], ['cast.range', 1], ['cast.submit', 1]], 'one range after another, in the book\'s order');
	assert.equal(h.runs.length, 2);
	const [run, next] = h.runs;
	assert.equal(run.priority, 'background', 'nothing waits on the cast');
	assert.equal(run.systemPrompt, await readFile(join(ROOT, 'content', 'setup', 'module-cast.md'), 'utf8'));
	assert.equal(run.tools, 'read,write,edit,bash');
	assert.match(run.brief, /coc-read-check --kind module-cast --draft draft\.json/);
	assert.match(run.brief, /pages 1-40/);
	assert.match(next.brief, /pages 41-70/);
	assert.match(run.brief, /"play_language":"zh-Hans"/);
	assert.deepEqual(h.rows.filter(row => row.lane === 'cast').map(row => [row.event, row.range]), [['range', 0], ['published', 1]]);
	assert.deepEqual(h.published, [{module_id: 'book-4', people: 1, state: 'partial'}, {module_id: 'book-4', people: 2, state: 'complete'}],
		'each range announces its rows: the lanes can use them before the book is done');
	assert.deepEqual(await h.reading.cast('book-4'), {job_id: null, state: 'complete'}, 'the kernel says when the book has its cast');
});

test('§177.2: a run that stopped resumes at the first range not read, from the text the kernel kept', async t => {
	const h = host(t, {job: {job_id: 'cast:aaaaaaaaaaaa', module_id: 'book-4', page_count: PAGE_COUNT, play_language: 'en', source: 'kept',
		ranges: [{index: 0, first: 1, last: 40, done: true}, {index: 1, first: 41, last: 70, done: false}]},
		submits: [() => ({state: 'complete', people: 2, accepted: 1, refused: []})]});
	await h.setup();
	assert.equal((await h.reading.cast('book-4')).state, 'complete');
	assert.deepEqual(h.calls.filter(([name]) => ['sourceText', 'cast.source'].includes(name)), [], 'no text is extracted again');
	assert.deepEqual(h.calls.filter(([name]) => name === 'cast.range').map(([, params]) => params.index), [1]);
	assert.equal(h.runs.length, 1);
});

test('§177.2: a refused submit runs the child once more with the refusal; a second refusal ends the job as failed', async t => {
	const refusal = () => { throw Object.assign(new Error('the cast reader left no readable draft.json'), {code: 'invalid_params', details: {reason: 'no_draft'}}); };
	const h = host(t, {submits: [refusal, refusal]});
	await h.setup();
	assert.deepEqual(await h.reading.cast('book-4'), {state: 'failed', range: 0});
	assert.equal(h.runs.length, 2, 'the same range twice, and the run stops there');
	assert.match(h.runs[1].brief, /previous attempt was refused: the cast reader left no readable draft\.json/);
	assert.deepEqual(h.rows.filter(row => row.lane === 'cast').map(row => [row.event, row.range]), [['refused', 0], ['refused', 0]]);
	assert.deepEqual(h.published, []);
	assert.deepEqual(await h.reading.cast('book-4'), {state: 'failed', retry: 'next_session'}, 'not paid for again this session');
	assert.equal(h.runs.length, 2);
});

test('§177.2 (owner Q2): no text layer, no child; one run per module at a time', async t => {
	const blank = host(t, {texts: () => ''});
	await blank.setup();
	assert.deepEqual(await blank.reading.cast('book-4'), {state: 'unavailable', reason: 'no_text_layer'});
	assert.equal(blank.runs.length, 0);
	assert.ok(blank.rows.some(row => row.lane === 'cast' && row.event === 'unavailable'));

	const twice = host(t);
	await twice.setup();
	const [first, second] = [twice.reading.cast('book-4'), twice.reading.cast('book-4')];
	assert.equal(first, second, 'the same run');
	await first;
	assert.equal(twice.runs.length, 2, 'one child per range, once');
});

test('§177.2: preparing a book, by whichever road, queues its cast in the background', async t => {
	const h = host(t);
	await h.setup();
	h.reading.prepareBook = async () => ({state: 'ready', module_id: 'book-4'});
	assert.deepEqual(await h.reading.prepare({module_id: 'book-4', purpose: 'guidance'}), {state: 'ready', module_id: 'book-4'}, 'the preparation answers as before');
	await new Promise(resolve => setTimeout(resolve, 20));
	await Promise.all([...h.reading.casting.values()]);
	assert.ok(h.calls.some(([name, params]) => name === 'cast.job' && params.module_id === 'book-4'), 'the cast was asked for');
	assert.equal(h.runs.length, 2);
});

test('§177.2: a module that exists only in a campaign\'s scope is read there', async t => {
	const h = host(t);
	await h.setup();
	const original = h.reading.deps.call;
	let libraryAsked = 0;
	h.reading.deps.call = async (method, params) => {
		if (method === 'cast.job' && !params.campaign) { libraryAsked += 1; return {job_id: null, reason: 'no_module'}; }
		return original(method, params);
	};
	assert.equal((await h.reading.cast('book-4')).state, 'complete');
	assert.equal(libraryAsked, 1);
	assert.ok(h.calls.filter(([name]) => name.startsWith('cast.')).every(([, params]) => params.campaign === 'camp'), 'every later call names the campaign');
});

test('§177.2: a table that opened before the session started still gets its cast, in either startup order', async () => {
	// The installed App (table 24): the kernel extension opens the table inside its own session_start, before the module
	// extension's session_start has made a reader, so the table-open ask found no reader and was dropped.
	for (const earlyTable of [true, false]) {
		const events = new EventEmitter(), hooks = new Map(), asked = [];
		moduleExtension({events, on(name, fn) { hooks.set(name, fn); }, appendEntry() {}, getThinkingLevel() { return 'low'; }});
		const ctx = {model: {provider: 'fixture', id: 'reader'}, modelRegistry: {find() { return {input: ['image']}; }}};
		const open = () => events.emit('coc:table-open', {campaign: 'camp', open: {module_reading: true, campaign: {module_id: 'book-4'}}});
		events.emit('coc:kernel-bridge', {campaign: 'camp', runtime: {home: tmpdir(), readerModel: 'fixture/reader', contentRoot: join(ROOT, 'content')},
			async call(method, params) { if (method === 'cast.job') asked.push(params.module_id); return {job_id: null, state: 'complete'}; }});
		if (earlyTable) open();
		await hooks.get('session_start')({}, ctx);
		if (!earlyTable) open();
		for (let i = 0; i < 100 && !asked.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
		assert.ok(asked.includes('book-4'), `the cast was asked for (${earlyTable ? 'table first' : 'session first'})`);
		await hooks.get('session_shutdown')();
	}
});

test('§177.2: a busy foreign owner runs no reader; waiting cancellation and every exit release only the owned lease', async t => {
	const h = host(t);
	await h.setup();
	const original = h.reading.deps.call;
	let claims = 0;
	h.reading.deps.call = async (method, params) => {
		if (method === 'cast.job' && claims++ === 0) return {job_id: null, state: 'busy', reason: 'reader_owned'};
		return original(method, params);
	};
	const result = await h.reading.cast('book-4');
	assert.equal(result.state, 'complete');
	assert.equal(h.runs.length, 2, 'the waiting host reads ranges only after it owns them');
	assert.ok(h.calls.filter(([method]) => ['cast.source', 'cast.range', 'cast.submit', 'cast.release'].includes(method)).every(([, params]) => params.lease === 'test-lease'));
	assert.equal(h.calls.filter(([method]) => method === 'cast.release').length, 1);

	const cancelled = host(t);
	await cancelled.setup();
	cancelled.reading.deps.call = async () => ({job_id: null, state: 'busy', reason: 'reader_owned'});
	const wait = cancelled.reading.cast('book-4');
	await new Promise(resolve => setTimeout(resolve, 10));
	await cancelled.reading.close();
	assert.equal((await wait).state, 'stopped');
	assert.equal(cancelled.runs.length, 0, 'a cancelled waiter paid for no child and released no foreign lease');

	const failed = host(t);
	await failed.setup();
	failed.reading.deps.runtime.runTask = async () => { throw new Error('fixture child failed'); };
	assert.equal((await failed.reading.cast('book-4')).state, 'failed');
	assert.equal(failed.calls.filter(([method]) => method === 'cast.release').length, 1, 'the failure releases its lease');
});


test('§177.2: completion by another host, missing ownership and lost leases never pay for another child', async t => {
	const done = host(t); await done.setup();
	let claims = 0;
	done.reading.deps.call = async () => claims++ === 0 ? {job_id: null, state: 'busy', reason: 'reader_owned'} : {job_id: null, state: 'complete'};
	assert.deepEqual(await done.reading.cast('book-4'), {job_id: null, state: 'complete'});
	assert.equal(done.runs.length, 0, 'the other host already read the book');
	const missing = host(t, {job: {job_id: 'cast:aaaaaaaaaaaa', lease: null}}); await missing.setup();
	assert.equal((await missing.reading.cast('book-4')).state, 'failed');
	assert.equal(missing.runs.length, 0, 'no unlocked fallback');
	const lost = host(t, {submits: [() => { throw new KernelError({code: 'invalid_params', message: 'old owner', details: {reason: 'cast_lease_lost'}}); }]}); await lost.setup();
	assert.equal((await lost.reading.cast('book-4')).state, 'failed');
	assert.equal(lost.runs.length, 1, 'lost ownership is not a draft-repair retry');
	assert.equal(lost.calls.filter(([method]) => method === 'cast.release').length, 1);
});
