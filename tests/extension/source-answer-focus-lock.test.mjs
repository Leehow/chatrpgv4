/** §22.2.1: kernel-ts/modules/reading.ts gives consultations and graph publication independent focus domains. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {readerBook} from './name-free-book.mjs';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..');
const temporary = playtestScratch('source-answer-focus-lock');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const fixture = t => readerBook(api, {root, temporary, t, seed: 'answer-focus-lock'});
const request = (book, purpose, focus, question) => book.raw('module.read.request', {module_id: book.mid, purpose, focus, question, foreground: true});
const claim = book => book.raw('module.read.claim', {module_id: book.mid, owner: 'regression-host'});

test('a station question starts with free capacity while that station material is still publishing', async t => {
	const book = await fixture(t);
	const material = await request(book, 'detail', 'Dock', 'Prepare the dock fixtures.');
	assert.equal((await claim(book)).job_id, material.job_id);
	const answer = await request(book, 'answer', 'scene-dock', 'Who works on the dock?');
	assert.equal(answer.attached, undefined, 'a consultation is not an attachment to material publication');
	assert.equal((await claim(book)).job_id, answer.job_id, 'the source question must not wait for map/material repair');
});

test('material preparation also starts while a question of that same focus runs', async t => {
	const book = await fixture(t);
	const answer = await request(book, 'answer', 'scene-dock', 'Who works on the dock?');
	assert.equal((await claim(book)).job_id, answer.job_id);
	const material = await request(book, 'detail', 'Dock', 'Prepare the dock fixtures.');
	assert.equal((await claim(book)).job_id, material.job_id);
});

test('material aliases still attach to the running material instead of duplicating publication', async t => {
	const book = await fixture(t);
	const material = await request(book, 'detail', 'Dock', 'Prepare the dock fixtures.');
	assert.equal((await claim(book)).job_id, material.job_id);
	const joined = await request(book, 'detail', 'scene-dock', 'Read the dock route.');
	assert.equal(joined.attached, true);
	assert.equal(joined.job_id, material.job_id);
	assert.equal((await claim(book)).job_id, null);
});

test('another question still attaches within the consultation focus domain', async t => {
	const book = await fixture(t);
	const answer = await request(book, 'answer', 'Dock', 'Who works on the dock?');
	assert.equal((await claim(book)).job_id, answer.job_id);
	const joined = await request(book, 'answer', 'scene-dock', 'Where does the dock route lead?');
	assert.equal(joined.attached, true);
	assert.equal(joined.job_id, answer.job_id);
	assert.equal((await claim(book)).job_id, null);
});

test('separating focus domains does not let a consultation exceed the reader capacity', async t => {
	const book = await fixture(t);
	for (const focus of ['Dock', 'Tower', 'Harbor lane']) {
		const requested = await request(book, 'detail', focus, 'Prepare this place.');
		assert.equal((await claim(book)).job_id, requested.job_id);
	}
	await request(book, 'answer', 'scene-dock', 'Who works on the dock?');
	assert.equal((await claim(book)).job_id, null);
});

test('host claim diagnostics distinguish a focus conflict from exhausted capacity', async t => {
    const book = await fixture(t);
    const first = await request(book, 'detail', 'Dock', 'Prepare the fixtures.');
    const queued = await request(book, 'detail', 'scene-dock', 'Prepare the route.');
    assert.equal((await claim(book)).job_id, first.job_id);
    let result = await book.raw('module.read.claim', {module_id: book.mid, owner: 'regression-host', diagnostics: true});
    assert.deepEqual(result.blocked, [{job_id: queued.job_id, reason: 'focus_busy', by_job: first.job_id}]);
    for (const focus of ['Tower', 'Harbor lane']) {await request(book, 'detail', focus, 'Prepare this place.'); await claim(book);}
    const answer = await request(book, 'answer', 'scene-dock', 'Who works here?');
    result = await book.raw('module.read.claim', {module_id: book.mid, owner: 'regression-host', diagnostics: true});
    assert.ok(result.blocked.some(row => row.job_id === answer.job_id && row.reason === 'capacity'));
    assert.deepEqual(await claim(book), {job_id: null}, 'ordinary claim callers keep their established envelope');
});
