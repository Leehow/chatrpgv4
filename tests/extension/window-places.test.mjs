import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §190.1: the reading window's places exist before they are read.
 *
 * Found on RD-08 (2026-10-07): the Keeper narrated the station on turn 2 while the station was not in the graph -- a reference
 * book's places were minted only when a destination was requested -- so the prologue had no exits and the `apply` candidates
 * held no move at all. At table open and on each window change the host now asks Jev, one Noul per flattened bookmark entry
 * inside the window that no scene already is, whether the heading names a place the investigators can be at, and mints each
 * cleared entry as an identity-only place through `module.reference.materialize`.
 *
 * These cases travel the real entries: the reading service's `prefetch` at table open, over the kernel's own handlers
 * (`module.read.ahead`, `module.reference.status`, `module.reference.materialize`, `table.apply.options`) on a bound book
 * with chapters, with a controlled typed endpoint behind the real decision adapter. Only the reading pump's claim is
 * answered empty (no reading job is the subject here), and the PDF's bookmarks and native text come from a stub runtime.
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
import {flattenBookmarks, firstLines, placeExcerpt, windowEntries, PLACE_EXCERPT_CHARS} from '../../runtime/jev/window-places.ts';
import {selectReferencePacket} from '../../runtime/jev/source-reference.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const directory = playtestScratch('window-places', 'suite-', {retain: Boolean(process.env.KEEP_WINDOW_PLACES_EVIDENCE)});
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'window-places-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

const save = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const PAGES = 120;
/**
 * The PDF's bookmarks as `sourceInfo` reads them. Chapters (top level) at 1, 41, 45, 49 and 91, so a table at the harbor
 * (page 42) reads the town and the mine (pages 41-48). Inside that window: the two chapter headings and five sub-headings,
 * one of which (the harbor) is the opening scene already.
 */
const BOOKMARKS = [
	{name: 'Front matter', page: 1, children: []},
	{name: 'The town', page: 41, children: [{name: 'Harbor', page: 42, children: []}, {name: 'The inn', page: 42, children: []},
		{name: 'Town history', page: 43, children: []}]},
	{name: 'The mine', page: 45, children: [{name: 'Mine shaft', page: 46, children: []}]},
	{name: 'The base', page: 49, children: []},
	{name: 'Finale', page: 91, children: []},
];
/** What Jev answers per heading in this book: three places clear the shipped 0.8 bar, two headings do not. */
const NOULS = {'The town': 0.3, 'The inn': 0.92, 'Town history': 0.1, 'The mine': 0.85, 'Mine shaft': 0.88};
/** The native text of the pages, as the host's extraction gives it. */
const TEXT = {
	41: 'THE TOWN\nA chapter about the town and its people.',
	42: 'Harbor\nThe harbor at dusk, nets drying on the wall.\nThe inn\nA low inn with a crooked sign; the landlord watches the door.',
	43: 'Town history\nThe town was founded in 1820 by whalers.',
	45: 'The mine\nThe old mine above the town, closed since the collapse.',
	46: 'Mine shaft\nA dark shaft drops away behind a rusted gate.',
};
const PLACES = {'The inn': 'scene-source-place-42-3', 'The mine': 'scene-source-place-45-5', 'Mine shaft': 'scene-source-place-46-6'};

/** A bound 120-page PDF with chapters, its fast reference path published with the harbor as the opening (as setup does). */
async function book(name) {
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
	const file = join(workspace, 'original.pdf'), bytes = Buffer.from(`%PDF-1.7\n${name} window places fixture\n`);
	await writeFile(file, bytes);
	const source = sha(bytes);
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: PAGES, file_sha256: source, bookmarks: BOOKMARKS}});
	const library = join(workspace, '.coc/modules', mid), work = join(library, 'work', 'source-reference-fixture');
	await mkdir(work, {recursive: true});
	const text = TEXT[42], span = {id: `p42-0-${text.length}`, page: 42, start: 0, end: text.length, text};
	const packet = {protocol: 'source-reference-v1', source_sha256: source, extraction_version: 'fixture', purpose: 'guidance', question: 'Start', excerpts: [span],
		fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, [span.id]])),
		entries: [{id: 'scene-source-entry-42', name: 'Harbor', page: 42}], partial: true, visual_coverage: 'unassessed', unavailable_pages: []};
	const task = JSON.stringify({purpose: 'guidance', source_reference: 'guidance'}), body = JSON.stringify(packet), guide = 'Harbor in 1925. Choose your own investigator.';
	await save(join(work, 'task.json'), task);
	await save(join(work, 'source-reference.json'), body);
	await save(join(work, 'reference-guidance.txt'), guide);
	const public_fields = Object.fromEntries(['era', 'starting_place', 'public_premise', 'creation_advice'].map(key => [key, {status: 'value', text: guide, source_refs: [{page: 42}]}]));
	const checks = Object.fromEntries(['wrong_orientation', 'card_restriction', 'advice_omission', 'warning_omission', 'plot_disclosure', 'causal_conflict']
		.map(key => [key, {status: 'answered', type: 'noul', noul: 0}]));
	await save(join(work, 'source-reference-complete.json'), {protocol: 'source-reference-v1', kind: 'guidance', source_sha256: source,
		task_sha256: sha(task), packet_sha256: sha(body), text_sha256: sha(guide), checks_policy: 'material-issues-v1', checks, public_fields});
	assert.equal((await kernel('module.reference.publish', {module_id: mid, work_dir: work, guidance_key: 'd'.repeat(64), play_language: 'en', start_scene: 'Harbor'})).setup_ready, true);
	const b = {workspace, mid, sha: source, kernel};
	b.fork = campaign => join(workspace, '.coc/module-campaigns', campaign, 'modules', mid);
	b.graph = async campaign => JSON.parse(await readFile(join(b.fork(campaign), (JSON.parse(await readFile(join(b.fork(campaign), 'module.json'), 'utf8'))).graph_file), 'utf8'));
	/** A table on this book at the harbor, seated with a shipped template and opened: the kernel's own open forks the module. */
	b.table = async campaign => {
		const call = (method, params = {}) => kernel(method, {campaign, ...params});
		await kernel('campaign.create', {id: campaign, module: mid, play_language: 'en', start_scene: 'Harbor'});
		await call('setup.template', {template: 'thomas-hayes'});
		await call('setup.complete');
		await call('table.open');
		return call;
	};
	return b;
}

/**
 * The typed endpoint: each `place_e<n>` Noul answered from `NOULS` by the heading the state shows. While `batches.fail` is
 * set it answers 503, as the provider did on the first-reference table (§148).
 */
function installJev(t, {fail = false} = {}) {
	const original = globalThis.fetch, batches = [];
	batches.fail = fail;
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body), state = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;
		batches.push({body, state});
		if (batches.fail) return new Response(JSON.stringify({error: 'overloaded'}), {status: 503});
		const answers = Object.fromEntries(Object.keys(body.questions).map(key => {
			const heading = state.book_headings?.[key.replace(/^place_/, '')]?.heading;
			return [key, {type: 'noul', noul: NOULS[heading] ?? 0.05}];
		}));
		return new Response(JSON.stringify({model: 'jev-1.13.0', answers, usage: {input_tokens: 900, output_tokens: 5}}), {status: 200});
	};
	t.after(() => { globalThis.fetch = original; });
	return batches;
}

/** A reading service on the real kernel, as the module extension builds one for this campaign; the pump claims nothing. */
function service(b, campaign, rows, extra = {}) {
	const reading = new ReadingService({home: b.workspace, model: () => ({}), progress() {}, record: row => rows.push(row), campaign: () => campaign,
		env: {EXT_JEV_APIKEY: 'test-jev-key'}, ...extra,
		runtime: {sourceReferences: true,
			sourceInfo: async source => ({path: source.pdf, file_sha256: b.sha, page_count: PAGES, labels: null, bookmarks: BOOKMARKS}),
			sourceText: async request => ({file_sha256: request.expected_file_sha256, extraction_version: 'fixture', page_count: PAGES,
				snapshots: request.pages.map(page => ({page, text: TEXT[page] ?? ''})), errors: []})},
		async call(method, params) { return method === 'module.read.claim' ? {job_id: null} : b.kernel(method, params); }});
	closers.push(() => reading.close());
	return reading;
}

/** The table opens: the module extension's wake. Resolves when the window's places pass has finished. */
async function open(reading, b, campaign) {
	await reading.prefetch(b.mid, 'table-open');
	const scope = JSON.stringify([campaign, b.mid]);
	for (let i = 0; i < 200 && !reading['windowPlaceRuns'].has(scope); i++) await new Promise(resolve => setTimeout(resolve, 10));
	assert.ok(reading['windowPlaceRuns'].has(scope), 'the table open started the window-places pass');
	await reading['windowPlaceRuns'].get(scope);
}
const placeRows = rows => rows.filter(row => row.lane === 'window-places');
const outcomes = rows => Object.fromEntries(placeRows(rows).map(row => [row.entry.name, row.outcome]));

test('§190.1: an entry\'s identity is the one a destination request mints; its lines and its bounded excerpt are the page\'s own words from the heading', async () => {
	const entries = flattenBookmarks(BOOKMARKS);
	assert.deepEqual(entries.map(entry => entry.id), ['scene-source-place-1-0', 'scene-source-place-41-1', 'scene-source-place-42-2', 'scene-source-place-42-3',
		'scene-source-place-43-4', 'scene-source-place-45-5', 'scene-source-place-46-6', 'scene-source-place-49-7', 'scene-source-place-91-8']);
	assert.deepEqual(windowEntries(entries, {first: 41, last: 48}, 64).map(entry => entry.name), ['The town', 'Harbor', 'The inn', 'Town history', 'The mine', 'Mine shaft']);
	// The destination path (`selectReferencePacket` with `materializePlace`) chooses the mine shaft among the same bookmarks.
	const pages = [{page: 46, text: TEXT[46]}];
	const packet = await selectReferencePacket({pages, allPages: pages, bookmarks: BOOKMARKS, sourceSha: 'a'.repeat(64), pageCount: PAGES, extractionVersion: 'fixture',
		purpose: 'answer', question: 'Climb down the mine shaft', materializePlace: true, signal: AbortSignal.timeout(1000),
		decide: async batch => ({status: 'complete', answers: Object.fromEntries(batch.questions.map(q => [q.key, q.type === 'choice'
			? {status: 'answered', type: 'choice', choice: Object.entries(q.criteria).find(([, value]) => value?.name === 'Mine shaft')?.[0] ?? 'none', confidence: 0.9}
			: {status: 'answered', type: 'noul', noul: 0.95}]))})});
	assert.equal(packet.places[0].id, PLACES['Mine shaft']);
	assert.equal(firstLines(TEXT[42], 'The inn'), 'The inn\nA low inn with a crooked sign; the landlord watches the door.', 'the first lines start at the heading on its page');
	assert.equal(firstLines('No heading here.\nSecond line.', 'Elsewhere'), 'No heading here.\nSecond line.', 'without the heading on the page, its top');
	// The minted excerpt is the page's own bytes from the heading, bounded: every referenced place rides on every turn's moves.
	const page = {page: 46, text: 'Earlier section text.\nMine shaft\n' + 'A long description of the shaft and its ladders.\n'.repeat(40)};
	const excerpt = placeExcerpt(page, 'Mine shaft');
	assert.ok(excerpt.text.startsWith('Mine shaft\n') && excerpt.text.length <= PLACE_EXCERPT_CHARS, `${excerpt.text.length} characters`);
	assert.equal(page.text.slice(excerpt.start, excerpt.end), excerpt.text);
	assert.ok(excerpt.text.endsWith('ladders.'), 'it ends at a line break');
});

test('§190.1: at table open the window\'s headings are asked once; three of five clear and become referenced move candidates', async t => {
	const batches = installJev(t), b = await book('open'), call = await b.table('table'), rows = [];
	await open(service(b, 'table', rows), b, 'table');
	assert.equal(batches.length, 1, 'one fanned-out request');
	const asked = Object.values(batches[0].state.book_headings).map(entry => entry.heading);
	assert.deepEqual(asked, ['The town', 'The inn', 'Town history', 'The mine', 'Mine shaft'],
		'the in-window headings no scene is: not the harbor (the opening scene), nothing outside the window');
	assert.equal(Object.keys(batches[0].body.questions).length, 5);
	assert.equal(batches[0].body.model, 'jev-1.13.0', 'the model is pinned');
	assert.deepEqual(outcomes(rows), {'The town': 'not_place', 'The inn': 'minted', 'Town history': 'not_place', 'The mine': 'minted', 'Mine shaft': 'minted'},
		'one row per asked entry');
	const graph = await b.graph('table');
	for (const [name, id] of Object.entries(PLACES)) {
		const node = graph.nodes.find(node => node.node_id === id);
		assert.ok(node, `${name} is minted as ${id}`);
		assert.deepEqual([node.name, node.node_kind, node.properties.source_reference_anchor, node.source_refs.map(ref => ref.pdf_index + 1)],
			[name, 'scene', true, [Number(id.split('-')[3])]], 'an identity-only place on its own page');
		assert.ok(node.summary.startsWith(name), 'its summary is the page\'s own text from the heading on');
	}
	assert.equal(graph.nodes.filter(node => node.node_id.startsWith('scene-source-place-')).length, 3, 'nothing else is minted');
	await call('table.player_input', {text: 'I look around the harbor.'});
	const options = await call('table.apply.options');
	const referenced = options.candidates.filter(row => row.effect.kind === 'move' && row.description.source_identity === true).map(row => row.description.display_name);
	assert.deepEqual(referenced.sort(), ['Mine shaft', 'The inn', 'The mine'], 'each minted place is a referenced move candidate from the harbor');
	const minted = placeRows(rows).find(row => row.entry.name === 'The inn');
	assert.deepEqual([minted.noul, minted.place_min, minted.mode, minted.window.first, minted.window.last], [0.92, 0.8, 'on', 41, 48]);
	assert.ok(minted.scene, 'the row names the scene');
});

test('§190.1: a second table open asks nothing again: the answers are kept for the campaign and the minted places are scenes', async t => {
	const batches = installJev(t), b = await book('reopen');
	await b.table('table');
	await open(service(b, 'table', []), b, 'table');
	assert.equal(batches.length, 1);
	assert.ok(existsSync(join(b.fork('table'), 'work', 'window-places', 'answers.json')), 'the answers are kept in the campaign\'s fork');
	// A new session: a new reading service, whose window is new to it.
	const rows = [];
	await open(service(b, 'table', rows), b, 'table');
	assert.equal(batches.length, 1, 'no heading is asked again');
	assert.deepEqual(placeRows(rows), [], 'nothing is handled again, so no row');
	assert.equal(rows.filter(row => row.event === 'read_window').length, 1, 'the new session did see the window');
	assert.equal((await b.graph('table')).nodes.filter(node => node.node_id.startsWith('scene-source-place-')).length, 3);
});

test('§190.1: Jev unavailable mints nothing and the table plays on; the next open asks again', async t => {
	const failing = installJev(t, {fail: true}), b = await book('outage'), call = await b.table('table'), rows = [];
	await open(service(b, 'table', rows), b, 'table');
	assert.ok(failing.length >= 1, 'the request was made');
	assert.deepEqual(Object.values(outcomes(rows)), Array(5).fill('unavailable'), 'one unavailable row per entry');
	assert.ok(placeRows(rows).every(row => row.reason === 'service_error'), JSON.stringify(placeRows(rows).map(row => row.reason)));
	assert.equal((await b.graph('table')).nodes.filter(node => node.node_id.startsWith('scene-source-place-')).length, 0, 'nothing is minted');
	assert.equal(existsSync(join(b.fork('table'), 'work', 'window-places', 'answers.json')), false, 'no answer is kept');
	// The table is not held: the turn opens and the harbor offers no window place.
	await call('table.player_input', {text: 'I look around the harbor.'});
	const options = await call('table.apply.options');
	assert.deepEqual(options.candidates.filter(row => row.description.source_identity === true && row.description.display_name !== 'Harbor').map(row => row.description.display_name), []);
	// Jev is back at the next open: the unanswered headings are asked and the places minted.
	const before = failing.length, again = [];
	failing.fail = false;
	await open(service(b, 'table', again), b, 'table');
	assert.equal(failing.length - before, 1, 'the next open asks the unanswered headings');
	assert.deepEqual(outcomes(again), {'The town': 'not_place', 'The inn': 'minted', 'Town history': 'not_place', 'The mine': 'minted', 'Mine shaft': 'minted'});
});

test('§190.1: in shadow the rows are written and nothing is minted; turned on, the kept answers mint without asking again', async t => {
	const batches = installJev(t), b = await book('shadow');
	await b.table('table');
	const rows = [], budget = {mode: 'shadow', placeMin: 0.8, timeoutMs: 20_000, maxEntries: 64};
	await open(service(b, 'table', rows, {windowPlacesBudget: budget}), b, 'table');
	assert.equal(batches.length, 1);
	assert.deepEqual(outcomes(rows), {'The town': 'not_place', 'The inn': 'shadow', 'Town history': 'not_place', 'The mine': 'shadow', 'Mine shaft': 'shadow'});
	assert.equal((await b.graph('table')).nodes.filter(node => node.node_id.startsWith('scene-source-place-')).length, 0);
	const quiet = [];
	await open(service(b, 'table', quiet, {windowPlacesBudget: budget}), b, 'table');
	assert.deepEqual(placeRows(quiet), [], 'still shadow: a kept answer is not recorded twice');
	const on = [];
	await open(service(b, 'table', on, {windowPlacesBudget: {...budget, mode: 'on'}}), b, 'table');
	assert.equal(batches.length, 1, 'nothing is asked again');
	assert.deepEqual(placeRows(on).map(row => [row.entry.name, row.outcome, row.answer]),
		[['The inn', 'minted', 'kept'], ['The mine', 'minted', 'kept'], ['Mine shaft', 'minted', 'kept']]);
	assert.deepEqual((await b.graph('table')).nodes.filter(node => node.node_id.startsWith('scene-source-place-')).map(node => node.node_id).sort(),
		Object.values(PLACES).sort());
});

test('§190.1: an entry whose page has no native text is not asked and not minted', async t => {
	const batches = installJev(t), b = await book('scanned');
	await b.table('table');
	const rows = [], text = TEXT[46];
	delete TEXT[46];
	try { await open(service(b, 'table', rows), b, 'table'); } finally { TEXT[46] = text; }
	assert.deepEqual(Object.values(batches[0].state.book_headings).map(entry => entry.heading), ['The town', 'The inn', 'Town history', 'The mine']);
	assert.equal(outcomes(rows)['Mine shaft'], 'no_text');
	assert.equal((await b.graph('table')).nodes.some(node => node.node_id === PLACES['Mine shaft']), false);
});
