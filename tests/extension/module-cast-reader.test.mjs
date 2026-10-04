/**
 * Contract §177.2: the host side of the book's cast (extensions/module/reading-service.ts `cast`), against a stubbed kernel
 * and runtime (not a playtest). The service asks for the job, extracts the native text in batches the source helper accepts,
 * hands it to the kernel, runs one background reader child under the cast instructions with the cast check on its path,
 * submits, records, and announces the cast; a second run with the first's refusal follows a refused submit; a book with no
 * text layer runs no child; one run per module at a time.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE_COUNT = 70;

function host(t, {texts = page => `Page ${page} names Jonah.`, submits = [() => ({state: 'complete', people: 1, refused: []})]} = {}) {
	const calls = [], runs = [], rows = [], published = [];
	let dir;
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
			? {job_id: 'cast:aaaaaaaaaaaa', module_id: params.module_id, page_count: PAGE_COUNT, play_language: 'zh-Hans', cwd: dir} : {job_id: null, state: 'complete'};
		if (method === 'cast.source') {
			if (!params.pages.some(page => page.text.trim())) return {state: 'unavailable', reason: 'no_text_layer'};
			await mkdir(dir, {recursive: true});
			return {state: 'ready', cwd: dir, pages_with_text: params.pages.length};
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

test('§177.2: job, text in batches, source, one background child under the cast instructions, submit, record, announce', async t => {
	const h = host(t);
	await h.setup();
	const result = await h.reading.cast('book-4');
	assert.deepEqual(result, {state: 'complete', people: 1, refused: []});
	const batches = h.calls.filter(([name]) => name === 'sourceText').map(([, pages]) => pages);
	assert.deepEqual(batches.map(pages => [pages[0], pages.length]), [[1, 32], [33, 32], [65, 6]], 'every page, at most 32 a call');
	const source = h.calls.find(([name]) => name === 'cast.source')[1];
	assert.deepEqual([source.campaign, source.job_id, source.pages.length, source.pages[69]], ['camp', 'cast:aaaaaaaaaaaa', 70, {page: 70, text: 'Page 70 names Jonah.'}]);
	assert.equal(h.runs.length, 1);
	const [run] = h.runs;
	assert.equal(run.priority, 'background', 'nothing waits on the cast');
	assert.equal(run.systemPrompt, await readFile(join(ROOT, 'content', 'setup', 'module-cast.md'), 'utf8'));
	assert.equal(run.tools, 'read,write,edit,bash');
	assert.match(run.brief, /coc-read-check --kind module-cast --draft draft\.json/);
	assert.match(run.brief, /"play_language":"zh-Hans"/);
	assert.ok(h.rows.some(row => row.lane === 'cast' && row.event === 'published' && row.people === 1 && row.campaign === 'camp'), JSON.stringify(h.rows));
	assert.deepEqual(h.published, [{campaign: 'camp', module_id: 'book-4', people: 1}]);
	assert.deepEqual(await h.reading.cast('book-4'), {job_id: null, state: 'complete'}, 'the kernel says when the book has its cast');
});

test('§177.2: a refused submit runs the child once more with the refusal; a second refusal ends the job as failed', async t => {
	const refusal = () => { throw Object.assign(new Error('the cast reader left no readable draft.json'), {code: 'invalid_params', details: {reason: 'no_draft'}}); };
	const h = host(t, {submits: [refusal, refusal]});
	await h.setup();
	assert.deepEqual(await h.reading.cast('book-4'), {state: 'failed'});
	assert.equal(h.runs.length, 2);
	assert.match(h.runs[1].brief, /previous attempt was refused: the cast reader left no readable draft\.json/);
	assert.deepEqual(h.rows.filter(row => row.lane === 'cast').map(row => row.event), ['refused', 'refused']);
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
	assert.equal(twice.runs.length, 1);
});

test('§177.2: preparing a book, by whichever road, queues its cast in the background', async t => {
	const h = host(t);
	await h.setup();
	h.reading.prepareBook = async () => ({state: 'ready', module_id: 'book-4'});
	assert.deepEqual(await h.reading.prepare({module_id: 'book-4', purpose: 'guidance'}), {state: 'ready', module_id: 'book-4'}, 'the preparation answers as before');
	await new Promise(resolve => setTimeout(resolve, 20));
	await Promise.all([...h.reading.casting.values()]);
	assert.ok(h.calls.some(([name, params]) => name === 'cast.job' && params.module_id === 'book-4'), 'the cast was asked for');
	assert.equal(h.runs.length, 1);
});
