import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §226 (with §22.9): a PDF campaign's setup keeps the accepted guidance its player was shown.
 *
 * Found 2026-10-10 on a real resumed setup: the host never passed `guidance_key` to `campaign.create`, so the campaign pinned
 * none; on resume `setup.steps` reported no key, the host prepared guidance again from the campaign's opening handle (a
 * name-free handle the library-scoped reader does not know), the fast reference path refused it, and the fallback read the
 * whole book for minutes before the player could confirm a finished card.
 *
 * These cases travel the kernel's own entry points (`module.source.bind`, `module.reference.publish`, `campaign.create`,
 * `setup.prologue`, `setup.steps`), as `read-window.test.mjs` does.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {writeSourceFixture as writeFile} from './source-state-fixture.mjs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('setup-guidance-pin', 'suite-');
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'setup-guidance-pin-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });
const save = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');

/** A bound PDF whose fast reference guidance is published under each of `keys`, as setup does before any campaign exists. */
async function book(name, keys) {
	const workspace = await mkdtemp(join(directory, `${name}-`));
	const context = await api.createKernelContext({workspace, content: CONTENT, seed: name, locks: api.nativeAdvisoryLocks(),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context);
	closers.push(() => runtime.close());
	const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
	const kernel = async (method, params = {}) => wire(await runtime.handlers[method](params));
	const file = join(workspace, 'original.pdf'), bytes = Buffer.from(`%PDF-1.7\n${name} guidance pin fixture\n`);
	await writeFile(file, bytes);
	const source = sha(bytes);
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: 60, file_sha256: source}});
	const text = 'Harbor in 1925. Choose your own investigator.', span = {id: 'p3-0-43', page: 3, start: 0, end: text.length, text};
	const packet = {protocol: 'source-reference-v1', source_sha256: source, extraction_version: 'fixture', purpose: 'guidance', question: 'Start', excerpts: [span],
		fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, [span.id]])),
		entries: [{id: 'scene-source-entry-42', name: 'Harbor', page: 42}], partial: true, visual_coverage: 'unassessed', unavailable_pages: []};
	const public_fields = Object.fromEntries(['era', 'starting_place', 'public_premise', 'creation_advice'].map(key => [key, {status: 'value', text, source_refs: [{page: 3}]}]));
	const checks = Object.fromEntries(['wrong_orientation', 'card_restriction', 'advice_omission', 'warning_omission', 'plot_disclosure', 'causal_conflict']
		.map(key => [key, {status: 'answered', type: 'noul', noul: 0}]));
	for (const [index, key] of keys.entries()) {
		const work = join(workspace, '.coc/modules', mid, 'work', `source-reference-fixture-${index}`);
		await mkdir(work, {recursive: true});
		const task = JSON.stringify({purpose: 'guidance', source_reference: 'guidance', attempt: index}), body = JSON.stringify(packet);
		await save(join(work, 'task.json'), task);
		await save(join(work, 'source-reference.json'), body);
		await save(join(work, 'reference-guidance.txt'), text);
		await save(join(work, 'source-reference-complete.json'), {protocol: 'source-reference-v1', kind: 'guidance', source_sha256: source,
			task_sha256: sha(task), packet_sha256: sha(body), text_sha256: sha(text), checks_policy: 'material-issues-v1', checks, public_fields});
		assert.equal((await kernel('module.reference.publish', {module_id: mid, work_dir: work, guidance_key: key, play_language: 'en', start_scene: 'Harbor'})).setup_ready, true);
	}
	return {workspace, mid, kernel, campaign: async id => JSON.parse(await readFile(join(workspace, '.coc/campaigns', id, 'campaign.json'), 'utf8'))};
}

test('§226: campaign.create pins the accepted guidance key, and a resumed setup reports it with prepare-module done', async () => {
	const key = 'd'.repeat(64), b = await book('pinned', [key]);
	await b.kernel('campaign.create', {id: 'pinned', module: b.mid, play_language: 'en', start_scene: 'Harbor', guidance_key: key});
	assert.equal((await b.campaign('pinned')).guidance_key, key);
	const {state, completed} = await b.kernel('setup.steps', {campaign: 'pinned'});
	assert.equal(state.guidance_key, key);
	assert.ok(completed.includes('prepare-module'), 'accepted guidance is not prepared again');
});

test('§226: a campaign created without the key reports the one accepted guidance its recorded prologue showed', async () => {
	const key = 'e'.repeat(64), b = await book('unpinned', [key]);
	const created = await b.kernel('campaign.create', {id: 'unpinned', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	assert.equal((await b.campaign('unpinned')).guidance_key, undefined, 'the fixture reproduces a campaign created before the host pinned its key');
	let {state, completed} = await b.kernel('setup.steps', {campaign: 'unpinned'});
	assert.equal(state.guidance_key, null, 'before the player saw a prologue, no guidance is attributed to the campaign');
	assert.equal(completed.includes('prepare-module'), false);
	await b.kernel('setup.prologue', {campaign: 'unpinned', scene: created.campaign?.opening_scene ?? 'Harbor', text: 'Harbor in 1925.'});
	({state, completed} = await b.kernel('setup.steps', {campaign: 'unpinned'}));
	assert.equal(state.guidance_key, key);
	assert.ok(completed.includes('prepare-module'));
	assert.equal((await b.campaign('unpinned')).guidance_key, undefined, 'reporting the shown guidance writes nothing');
});

test('§226: two accepted guides for the shown scene and language are no answer', async () => {
	const b = await book('ambiguous', ['a'.repeat(64), 'b'.repeat(64)]);
	const created = await b.kernel('campaign.create', {id: 'ambiguous', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	await b.kernel('setup.prologue', {campaign: 'ambiguous', scene: created.campaign?.opening_scene ?? 'Harbor', text: 'Harbor in 1925.'});
	const {state, completed} = await b.kernel('setup.steps', {campaign: 'ambiguous'});
	assert.equal(state.guidance_key, null);
	assert.equal(completed.includes('prepare-module'), false);
});
