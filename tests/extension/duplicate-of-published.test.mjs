import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §191.1, §191.2 (DUP-01): one thing, one node.
 *
 * Blood Road's generation 55 (NR-07 survey §1): a page reading of pp. 25-26 declared `npc-daniel-mather` beside the published
 * `npc-book-4-daniel-mather`, the general store, the town centre under its very same name and five more; it had read 400 lines
 * of a 68,652-line task and never reached `known_nodes`, and publication merged by node id alone. These cases travel the real
 * path: a kernel runtime over a bound PDF, `module.read.claim` and `module.read.finish` doing the claiming and the publishing,
 * the checker the reader's `coc-read-check` runs (`checkSourceDraft`, over the attempt's own `packet.json` and the claim's
 * `graph-view.json`), and the host's ReadingService with its reader and reviewer children played by a fixture runtime. The
 * replay of generation 55 itself, on a clone of the acceptance home, is recorded in the DUP-01 report (§191.8).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {appendFile, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ReadingService, distinctReviewContext, readerTaskText} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {detailReviewInput, gateRefusal, reviewUnits} from '../../extensions/module/reader-review.ts';
import {claimSupportIneligibility} from '../../kernel-ts/modules/claim-support.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('duplicate-of-published', 'suite-', {retain: Boolean(process.env.KEEP_DUPLICATE_EVIDENCE)});
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
	`export {CAST_VERSION} from './kernel-ts/read/cast.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
	`export {ModuleStore} from './kernel-ts/modules/store.ts';`,
	`export {publishIdentities} from './kernel-ts/modules/identity.ts';`,
	`export {publishedDuplicates} from './kernel-ts/modules/published-duplicates.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'duplicate-of-published-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); await closeSourceDocuments(); });

/** A two-page renderable PDF. */
function pdf() {
	const streams = ['1 0 0 rg 0 0 100 100 re f 0 0 1 rg 100 0 100 100 re f', '0 0.6 0 rg 0 0 200 100 re f 1 1 0 rg 20 20 40 40 re f'];
	const pages = streams.map((stream, index) => ({page: 3 + index * 2, content: 4 + index * 2, stream}));
	const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map(row => `${row.page} 0 R`).join(' ')}] /Count ${streams.length} >>`,
		...pages.flatMap(row => [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents ${row.content} 0 R >>`,
			`<< /Length ${row.stream.length} >>\nstream\n${row.stream}\nendstream`])];
	let text = '%PDF-1.7\n';
	const offsets = [0];
	for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	text += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return text;
}
const save = (path, value) => writeFile(path, JSON.stringify(value));
const P1 = [{page: 1}], P2 = [{page: 2}];
const scene = (id, name, refs, extra = {}) => ({node_id: id, node_kind: 'scene', name, source_refs: refs, ...extra});
const npc = (id, name, refs, extra = {}) => ({node_id: id, node_kind: 'npc', name, source_refs: refs, ...extra});
const delta = (nodes, claims = [], ready = nodes.map(node => node.node_id)) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready});
const STORE = scene('scene-general-store', 'General Store', P1, {summary: 'A dusty shop on the main street.'});
const PHARMACY = scene('scene-pharmacy', 'Pharmacy', P1, {summary: 'The town pharmacy.'});
/** The cast row of a man the book prints three ways; neither reading's own name is the other's (§188.2's both-ways join). */
const SUTTON_ROW = {id: 'cast-sutton', book: ['Matthew Peter Sutton', 'Matthew Sutton', 'Peter Sutton'], play: ['Matthew Peter Sutton'], notes: ['Matthew Peter Sutton'], pages: [1, 2]};

/**
 * A bound PDF with its index and opening published through the real kernel. `publish` plays a host reader whose review
 * supports everything the kernel asks to be reviewed unless `review` says otherwise; `finish` is the real `module.read.finish`.
 */
async function book(name, {cast} = {}) {
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
	const file = join(workspace, 'original.pdf');
	await writeFile(file, pdf());
	const sha = createHash('sha256').update(await readFile(file)).digest('hex');
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
	const b = {workspace, mid, sha, kernel, context};
	b.call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
	b.claim = (params = {}) => b.call('module.read.claim', {owner: 'test-host', ...params});
	b.moduleDir = campaign => campaign ? join(workspace, '.coc/module-campaigns', campaign, 'modules', mid) : join(workspace, '.coc/modules', mid);
	b.meta = async campaign => JSON.parse(await readFile(join(b.moduleDir(campaign), 'module.json'), 'utf8'));
	b.raw = async () => { const meta = await b.meta(); return JSON.parse(await readFile(join(b.moduleDir(), meta.graph_file), 'utf8')); };
	b.graph = async () => new api.ModuleGraph(mid, await b.raw(), '', {});
	b.queue = async () => JSON.parse(await readFile(join(b.moduleDir(), 'deepen-queue.json'), 'utf8'));
	/** The reader's own check on this attempt, as `coc-read-check --packet` runs it (graph view beside the packet). */
	b.check = async (job, draft) => {
		await save(join(job.work_dir, 'draft.json'), draft);
		return api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'));
	};
	b.publish = async (job, draft, review = paths => [{paths, verdict: 'supported', source_refs: P1, reason: 'fixture support'}], campaign) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]});
		const checked = job.purpose === 'index' ? {required_review: []} : await b.check(job, draft);
		if (job.purpose === 'index') await save(join(job.work_dir, 'draft.json'), draft);
		await save(join(job.work_dir, 'review.json'), {checked: review(checked.required_review ?? []), missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json'), ...(campaign ? {campaign} : {})});
	};
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'The Harbor', language: 'en', sections: [{name: 'Dock', pages: [[1, 1]], entities: ['Dock']},
		{name: 'Tower', pages: [[2, 2]], entities: ['Tower']}], map_candidates: []});
	if (cast) await save(join(b.moduleDir(), 'cast.json'), {version: api.CAST_VERSION, source_sha256: sha, state: 'complete', people: cast, ranges_done: 1, ranges_total: 1});
	await b.call('module.read.request', {purpose: 'opening'});
	const opened = await b.publish(await b.claim(), delta([
		scene('scene-dock', 'Dock', P1, {properties: {is_entrance: true}}),
		scene('scene-tower', 'Tower', P2, {summary: 'An old tower beyond the harbor.', properties: {is_final: true}})],
	[{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: P1}], ['scene-dock']));
	assert.equal(opened.opening_ready, true);
	return b;
}

/** A foreground detail reading, requested and claimed; its packet is what a reader would be handed. */
async function claimDetail(b, focus, campaign) {
	await b.call('module.read.request', {purpose: 'detail', focus, question: `Prepare the ${focus}`, foreground: true, ...(campaign ? {campaign} : {})});
	const job = await b.claim(campaign ? {campaign} : {});
	assert.equal(job.focus, focus);
	return job;
}

/** The refusal a rejected promise carried, for assertions on its shape. */
async function refusal(promise) {
	try { await promise; } catch (error) { return error; }
	assert.fail('the publication was expected to be refused');
}

test('§191.1 landing: two readings claimed on one generation both mint one name; the second is refused against the generation it lands on', async () => {
	const b = await book('landing');
	const first = await claimDetail(b, 'general store'), second = await claimDetail(b, 'the store');
	assert.equal(first.base_generation, second.base_generation, 'both readings were claimed on one generation');
	assert.ok(!second.known_nodes.some(node => node.node_id === STORE.node_id));
	await b.publish(first, delta([STORE]));
	const copy = scene('scene-store', 'General Store', P1);
	// The second reader's own check judges against the view it was claimed with, which had no store: only the landing sees it.
	assert.equal((await b.check(second, delta([copy]))).ok, true);
	const error = await refusal(b.publish(second, delta([copy])));
	assert.equal(error.code, 'invalid_params');
	assert.deepEqual([error.details.reason, error.details.rule, error.details.path], ['reading_failed', 'duplicate_of_published', '/nodes/0']);
	assert.equal(error.details.duplicates.length, 1);
	const [pair] = error.details.duplicates;
	assert.deepEqual([pair.drafted, pair.by, pair.shared], ['scene-store', 'name', 'General Store']);
	assert.deepEqual(pair.published, {node_id: 'scene-general-store', node_kind: 'scene', name: 'General Store', aliases: [], pages: [1], summary: STORE.summary},
		'the refusal names the published node with its kind, names, pages and summary');
	assert.match(error.message, /scene-general-store/);
	assert.match(error.fix, /distinct_from/);
	assert.ok(!(await b.graph()).nodes.has('scene-store'), 'the second store was not published');
	// The reader's repair: the published id, with only a new fact.
	await b.publish(second, delta([{node_id: STORE.node_id, node_kind: 'scene', name: 'General Store', aliases: ['Mather store'], source_refs: P1}]));
	const graph = await b.graph();
	assert.ok(!graph.nodes.has('scene-store'));
	assert.deepEqual(graph.nodes.get(STORE.node_id).aliases, ['Mather store'], 'the new fact landed on the published node');
	assert.equal(graph.kind('scene').filter(node => node.name === 'General Store').length, 1, 'one store');
});

test('§191.1 check: coc-read-check reports every duplicate at once, by own name either way and by the book cast, and leaves a new thing alone', async () => {
	const b = await book('findings', {cast: [SUTTON_ROW]});
	const setup = await claimDetail(b, 'people');
	await b.publish(setup, delta([STORE,
		npc('npc-pete', 'Pete', P1, {aliases: ['Peter Smith'], summary: 'A kind squatter.'}),
		npc('npc-matthew-sutton', 'Matthew Sutton', P2, {aliases: ['Matthew Peter Sutton'], summary: 'The station owner.'})]));
	const job = await claimDetail(b, 'the town again');
	assert.ok(job.cast_names.length, 'the packet carries the book cast');
	const draft = delta([
		scene('scene-store', 'General Store', P1),                                         // its own name is the published name
		npc('npc-peter-smith', 'Peter Smith', P1),                                         // its own name is a published alias
		npc('npc-peter-benson', 'Peter Benson', P2, {aliases: ['Pete']}),                 // the published own name is its alias
		npc('npc-peter-sutton', 'Peter Sutton', P2, {aliases: ['Matthew Peter Sutton']}), // only the cast holds them as one
		{node_id: 'object-dynamite-crate', node_kind: 'object', name: 'Dynamite crate', source_refs: P1}]);
	const checked = await b.check(job, draft);
	assert.equal(checked.ok, false);
	const details = checked.error.details;
	assert.equal(details.rule, 'duplicate_of_published');
	assert.deepEqual(details.findings.map(finding => [finding.path, finding.rule]), [
		['/nodes/0', 'duplicate_of_published'], ['/nodes/1', 'duplicate_of_published'], ['/nodes/2', 'duplicate_of_published'], ['/nodes/3', 'duplicate_of_published']],
		'every duplicate at once, and the new object is no finding');
	assert.deepEqual(details.duplicates.map(pair => [pair.drafted, pair.published.node_id, pair.by]), [
		['scene-store', 'scene-general-store', 'name'], ['npc-peter-smith', 'npc-pete', 'name'], ['npc-peter-benson', 'npc-pete', 'name'],
		['npc-peter-sutton', 'npc-matthew-sutton', 'cast']]);
	for (const finding of details.findings) assert.match(finding.message, /Published (scene|npc)-[a-z-]+: names .*; pages \d; summary /);
	assert.match(details.findings[3].message, /cast holds them as one individual/);
	// Pages are evidence, never a condition: the Sutton pair shares page 2, the Benson pair shares no name on the same page.
	assert.deepEqual(details.duplicates[2].published.pages, [1]);
	// The publication gate says the same, before any review is read.
	const error = await refusal(b.publish(job, draft, () => []));
	assert.deepEqual(error.details.duplicates.map(pair => [pair.drafted, pair.published.node_id]), details.duplicates.map(pair => [pair.drafted, pair.published.node_id]));
	assert.equal(error.details.rule, 'duplicate_of_published');
});

test('§191.1 distinct_from: a supported answer publishes the node, keeps the verdict, and an answered pair is not raised again', async () => {
	const b = await book('distinct');
	await b.publish(await claimDetail(b, 'pharmacy'), delta([PHARMACY]));
	const job = await claimDetail(b, 'hospital');
	const other = scene('scene-hospital-pharmacy', 'Pharmacy', P2, {summary: 'The hospital dispensary.', distinct_from: [PHARMACY.node_id]});
	const checked = await b.check(job, delta([other]));
	assert.equal(checked.ok, true);
	assert.ok(checked.required_review.includes('/nodes/0/distinct_from'), 'the answer is owed to the reviewer as its own pointer, under module-logic-v1 too');
	assert.equal(job.review_policy, 'module-logic-v1');
	await b.publish(job, delta([other]), paths => [{paths, verdict: 'supported', source_refs: P2, reason: 'Page 2 is the hospital dispensary, not the town pharmacy.'}]);
	const graph = await b.graph();
	assert.ok(graph.nodes.has('scene-hospital-pharmacy') && graph.nodes.has(PHARMACY.node_id), 'both stand');
	assert.equal(Object.hasOwn(graph.nodes.get('scene-hospital-pharmacy'), 'distinct_from'), false, 'the answer is kept in module.json, not on the node');
	const meta = await b.meta(), key = `${b.sha}:scene:scene-hospital-pharmacy:scene-pharmacy`;
	assert.deepEqual(Object.keys(meta.reading.identity), [key]);
	assert.deepEqual({...meta.reading.identity[key], generation: 0}, {verdict: 'different', kind: 'scene', nodes: ['scene-pharmacy', 'scene-hospital-pharmacy'],
		by: 'review', job_id: job.job_id, generation: 0, reason: 'Page 2 is the hospital dispensary, not the town pharmacy.'});
	assert.equal(meta.reading.identity[key].generation, meta.generation);
	// A later claim's view carries the kept verdicts, and the check reads them: the answered pair is never raised again.
	const later = await claimDetail(b, 'later');
	const view = JSON.parse(await readFile(join(later.work_dir, 'graph-view.json'), 'utf8'));
	assert.deepEqual(Object.keys(view.identity_verdicts), [key]);
	assert.equal(view.identity_source, b.sha);
	const unanswered = {...view, known_nodes: view.known_nodes.filter(node => node.node_id !== 'scene-hospital-pharmacy')};
	await save(join(later.work_dir, 'graph-view.json'), unanswered);
	const again = delta([scene('scene-hospital-pharmacy', 'Pharmacy', P2)]);
	assert.equal((await b.check(later, again)).ok, true, 'a pair with a kept verdict is not raised');
	await save(join(later.work_dir, 'graph-view.json'), {...unanswered, identity_verdicts: {}});
	assert.equal((await b.check(later, again)).error.details.rule, 'duplicate_of_published', 'the same pair without the verdict is raised');
});

test('§191.1 a fork\'s kept answer travels with the generation the library follows (§184.1 adopts reading.identity)', async () => {
	const b = await book('fork');
	await b.publish(await claimDetail(b, 'pharmacy'), delta([PHARMACY]));
	await b.kernel('campaign.create', {id: 'c1', module: b.mid, play_language: 'en'});
	const job = await claimDetail(b, 'hospital', 'c1');
	const published = await b.publish(job, delta([scene('scene-hospital-pharmacy', 'Pharmacy', P2, {distinct_from: [PHARMACY.node_id]})]), undefined, 'c1');
	assert.equal(published.library_sync?.state, 'published', JSON.stringify(published.library_sync));
	const key = `${b.sha}:scene:scene-hospital-pharmacy:scene-pharmacy`;
	assert.equal((await b.meta('c1')).reading.identity[key].verdict, 'different', 'the fork kept the verdict');
	assert.equal((await b.meta()).reading.identity?.[key]?.verdict, 'different', 'the library followed the fork, verdict included');
	assert.ok((await b.graph()).nodes.has('scene-hospital-pharmacy'));
});

test('§191.1 distinct_from: an answer the review does not support refuses, advisory or not, and keeps nothing', async () => {
	const b = await book('unsupported');
	await b.publish(await claimDetail(b, 'pharmacy'), delta([PHARMACY]));
	const job = await claimDetail(b, 'pharmacy again');
	const other = scene('scene-drugstore', 'Pharmacy', P2, {distinct_from: [PHARMACY.node_id]});
	// Under module-logic-v1 a presentation finding is advisory elsewhere; an identity statement never is.
	const error = await refusal(b.publish(job, delta([other]), paths => [
		{paths: paths.filter(path => path !== '/nodes/0/distinct_from'), verdict: 'supported', source_refs: P2, reason: 'fixture support'},
		{paths: ['/nodes/0/distinct_from'], verdict: 'unsupported', impact: 'presentation', source_refs: P2, reason: 'Page 2 describes the same town pharmacy.'}]));
	assert.deepEqual([error.code, error.details.rule, error.details.path], ['invalid_params', 'review_unsupported', '/nodes/0/distinct_from']);
	// A review that answers only the record's root has not answered the identity.
	const omitted = await refusal(b.publish(job, delta([other]), () => [{paths: ['/nodes/0', '/coverage'], verdict: 'supported', source_refs: P2, reason: 'fixture'}]));
	assert.equal(omitted.details.rule, 'review_incomplete');
	assert.ok(omitted.details.required_review.includes('/nodes/0/distinct_from'));
	assert.ok(!(await b.graph()).nodes.has('scene-drugstore'));
	assert.equal((await b.meta()).reading.identity, undefined, 'no verdict was kept');
});

test('§191.1 distinct_from shape: a new node answers with published ids of its own kind, each once', async () => {
	const b = await book('shape');
	await b.publish(await claimDetail(b, 'pharmacy'), delta([PHARMACY]));
	const job = await claimDetail(b, 'shape');
	const rules = async node => {
		const checked = await b.check(job, delta([node]));
		return checked.ok ? [] : checked.error.details.findings.filter(finding => finding.rule === 'distinct_from').map(finding => finding.path);
	};
	assert.deepEqual(await rules(scene('scene-pharmacy', 'Pharmacy', P1, {distinct_from: ['scene-dock']})), ['/nodes/0/distinct_from'], 'not on a published node');
	assert.deepEqual(await rules(scene('scene-x', 'Pharmacy', P1, {distinct_from: ['scene-nowhere']})), ['/nodes/0/distinct_from'], 'an unpublished id');
	assert.deepEqual(await rules(npc('npc-x', 'Pharmacy', P1, {distinct_from: [PHARMACY.node_id]})), ['/nodes/0/distinct_from'], 'another kind');
	assert.deepEqual(await rules(scene('scene-x', 'Pharmacy', P1, {distinct_from: [PHARMACY.node_id, PHARMACY.node_id]})), ['/nodes/0/distinct_from'], 'twice');
	assert.deepEqual(await rules(scene('scene-x', 'Pharmacy', P1, {distinct_from: [PHARMACY.node_id]})), []);
});

test('§191.2 the packet starts with the roster of the job\'s own pages, and task.json\'s first lines are that roster', async () => {
	const b = await book('roster');
	await b.publish(await claimDetail(b, 'tower people'), delta([npc('npc-keeper', 'Lighthouse Keeper', P2, {aliases: ['Old Tom']}), STORE]));
	await b.call('module.read.request', {purpose: 'detail', focus: 'Tower', question: 'Read the tower page.', source_unit: {section: 'Tower', first: 2, last: 2}, foreground: true});
	const job = await b.claim();
	assert.deepEqual(job.source_unit, {section: 'Tower', first: 2, last: 2});
	assert.equal(Object.keys(job)[0], 'roster', 'the roster comes first, ahead of the cast and the index');
	assert.deepEqual(job.roster, [
		{id: 'npc-keeper', kind: 'npc', name: 'Lighthouse Keeper', aliases: ['Old Tom'], pages: [2]},
		{id: 'scene-tower', kind: 'scene', name: 'Tower', aliases: [], pages: [2]}], 'the published nodes on page 2 alone, grouped by kind');
	const packet = JSON.parse(await readFile(join(job.work_dir, 'packet.json'), 'utf8'));
	assert.equal(Object.keys(packet)[0], 'roster');
	// The host writes it first in task.json, one node per line, and hands it to the reader first when the task is inlined.
	const tasks = [];
	const reading = new ReadingService({home: b.workspace, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record() {},
		call: (method, params) => b.kernel(method, params), runtime: {contentRoot: CONTENT,
			async runTask({request}) {
				const text = await readFile(join(request.cwd, 'task.json'), 'utf8');
				tasks.push({phase: request.prompt?.phase, text, brief: request.brief});
				if (request.prompt?.phase === 'read') await save(join(request.cwd, 'draft.json'), delta([]));
				else await save(join(request.cwd, 'review.json'), {checked: [{paths: JSON.parse(text).required_review, verdict: 'supported', source_refs: P2, reason: 'fixture'}], missing: []});
				return {ok: false, code: 1, timedOut: false, ms: 1, stderr: 'fixture stops after the task is written', command: []};
			},
			check: ({packet: path, draft}) => api.checkSourceDraft(CONTENT, path, draft), async sourceInfo() { throw new Error('not a guidance job'); }}});
	closers.push(() => reading.close());
	await reading.runJob(job, new AbortController().signal).catch(() => undefined);
	const [read] = tasks;
	assert.ok(read, 'the reader was started');
	const lines = read.text.split('\n');
	assert.deepEqual(lines.slice(0, 4), ['{', '  "roster": [', `    ${JSON.stringify(job.roster[0])},`, `    ${JSON.stringify(job.roster[1])}`]);
	const parsed = JSON.parse(read.text);
	assert.equal(Object.keys(parsed)[0], 'roster');
	assert.deepEqual(parsed.roster, job.roster);
	assert.ok(Object.keys(parsed).indexOf('index') > 0 && Object.keys(parsed).indexOf('known_nodes') > 0);
	if (read.brief.includes('<input_json>')) assert.ok(read.brief.indexOf('"roster"') < read.brief.indexOf('"index"'), 'the inlined input leads with the roster too');
	// The serializer is the pretty JSON of old for a task without a roster, and a faithful round trip with one.
	const plain = {purpose: 'detail', known_nodes: [{node_id: 'scene-a'}]};
	assert.equal(readerTaskText(plain), JSON.stringify(plain, null, 2) + '\n');
	assert.deepEqual(JSON.parse(readerTaskText({roster: [], ...plain})), {roster: [], ...plain});
	assert.deepEqual(JSON.parse(readerTaskText({roster: []})), {roster: []});
});

/**
 * A published copy of the general store, as generation 55 left Blood Road's: written straight into a generation, as a page
 * reading published one before §191.1's landing check refused it (no `distinct_from`, so no `different` verdict: a recorded one
 * keeps the pair apart and the identity writer refuses to join it, §191.3), then joined to the store by a kernel identity
 * relation (DUP-02's writer). `storeNeeds` and `copyNeeds` add retained deferred questions to the store's reading and the copy.
 */
async function storeWithCopy(b, {copyNeeds = [], storeNeeds = []} = {}) {
	const need = (focus, question) => ({kind: 'deferred', focus, question, reason: 'The page names it for later.', trigger: 'When the party shops.', source_refs: P1});
	const withNeeds = (draft, needs, focus) => needs.length ? {...draft, source_needs: needs.map(question => need(focus, question))} : draft;
	await b.publish(await claimDetail(b, 'general store'), withNeeds(delta([STORE]), storeNeeds, STORE.node_id));
	const copy = scene('scene-store-copy', 'General Store', P2, {aliases: ['Corner shop'], summary: 'The shop again.'});
	const store = new api.ModuleStore(b.context), meta = await store.module(b.mid), graph = await store.readGraph(b.mid);
	const runtime = refs => refs.map(ref => ({source_id: `pdf:${b.mid}`, pdf_index: ref.page - 1}));
	graph.nodes.push({...copy, visibility: 'keeper-only', properties: {}, source_refs: runtime(copy.source_refs)});
	graph.source_needs = [...(graph.source_needs ?? []), ...copyNeeds.map(question => ({...need('store-copy', question), source_refs: runtime(P1),
		node_id: copy.node_id, source_sha256: meta.file_sha256}))];
	await store.writeGraph(meta, graph);
	meta.reading.materials.push({key: `copy-${copy.node_id}`, purpose: 'detail', focus: copy.name, question: '', node_ids: [copy.node_id], generation: meta.generation});
	await store.writeModule(meta);
	const joined = await api.publishIdentities(store, b.mid, [{nodes: [STORE.node_id, copy.node_id], review: {by: 'test', rule: 'fixture'}}]);
	assert.deepEqual(joined.written.map(row => [row.from, row.to]), [[copy.node_id, STORE.node_id]], 'the copy reads as the store');
	return copy;
}

test('§191.1 against survivors: a drafted node that meets a published copy is paired with its survivor, and reusing the survivor\'s id publishes', async () => {
	const b = await book('survivors');
	const copy = await storeWithCopy(b);
	const job = await claimDetail(b, 'the shop a third time');
	const view = JSON.parse(await readFile(join(job.work_dir, 'graph-view.json'), 'utf8'));
	assert.deepEqual(view.survivors, {[copy.node_id]: STORE.node_id}, 'the claim\'s view says which node stands for the copy');
	// The roster of a job on the copy's page lists the thing once, as the store, with the copy's names and pages (§191.2).
	await b.call('module.read.request', {purpose: 'detail', focus: 'Tower', question: 'Read the tower page.', source_unit: {section: 'Tower', first: 2, last: 2}, foreground: true});
	const unit = await b.claim();
	assert.deepEqual(unit.roster.filter(entry => entry.kind === 'scene'), [
		{id: STORE.node_id, kind: 'scene', name: 'General Store', aliases: ['Corner shop'], pages: [1, 2]},
		{id: 'scene-tower', kind: 'scene', name: 'Tower', aliases: [], pages: [2]}], 'the copy is listed as its survivor');
	await b.call('module.read.finish', {job_id: unit.job_id, lease: unit.lease, outcome: 'cancelled'});
	const third = delta([scene('scene-shop', 'Corner shop', P1)]);
	const checked = await b.check(job, third);
	assert.deepEqual(checked.error.details.duplicates.map(pair => [pair.drafted, pair.published.node_id, pair.shared]), [['scene-shop', STORE.node_id, 'Corner shop']],
		'one finding, naming the survivor, never the copy');
	assert.deepEqual(checked.error.details.duplicates[0].published.pages, [1, 2], 'the pages of every node that reads as the store');
	const error = await refusal(b.publish(job, third));
	assert.deepEqual(error.details.duplicates.map(pair => pair.published.node_id), [STORE.node_id], 'publication pairs against the landing graph\'s survivor');
	// Answered against the copy, the answer is the survivor's: the check takes it, and the kept verdict is keyed by the survivor.
	const apart = delta([scene('scene-shop', 'Corner shop', P1, {distinct_from: [copy.node_id]})]);
	assert.equal((await b.check(job, apart)).ok, true);
	await b.publish(job, apart);
	assert.deepEqual(Object.keys((await b.meta()).reading.identity).filter(key => key.includes('scene-shop')), [`${b.sha}:scene:scene-general-store:scene-shop`]);
	// The reader's other answer: the survivor's id, which publishes onto the node that stands for the store.
	const fourth = await claimDetail(b, 'the shop a fourth time');
	await b.publish(fourth, delta([{node_id: STORE.node_id, node_kind: 'scene', name: 'General Store', aliases: ['Mather store'], source_refs: P2}]));
	assert.ok((await b.graph()).nodes.get(STORE.node_id).aliases.includes('Mather store'));
	// The survivor's names include what only the copy carried: without the map the copy would be a candidate of its own.
	const nodes = [{...STORE, source_refs: P1, aliases: []}, {...copy, aliases: ['Corner shop']}];
	const drafted = [scene('scene-shop', 'Corner shop', P1)];
	const through = api.publishedDuplicates(drafted, nodes, b.mid, [], {}, b.sha, id => id === copy.node_id ? STORE.node_id : id);
	assert.deepEqual(through.map(pair => [pair.published.node_id, pair.shared, pair.published.aliases]), [[STORE.node_id, 'Corner shop', ['Corner shop']]]);
	assert.deepEqual(api.publishedDuplicates(drafted, nodes, b.mid, [], {}, b.sha).map(pair => pair.published.node_id), [copy.node_id]);
});

test('§191.3 retained needs read through survivors: a need on a copy is read as the survivor\'s, and one question about one thing is asked once', async () => {
	const b = await book('needs');
	await storeWithCopy(b, {storeNeeds: ['What does the shop sell?'], copyNeeds: ['What does the shop sell?', 'Who keeps the ledger?']});
	const before = new Set((await b.queue()).map(job => job.job_id));
	await b.call('module.read.ahead', {});
	const asked = (await b.queue()).filter(job => !before.has(job.job_id) && job.source_need);
	const graph = await b.graph(), handle = graph.handle(graph.nodes.get(STORE.node_id));
	assert.deepEqual(asked.map(job => [job.question, job.focus]).sort(), [['What does the shop sell?', handle], ['Who keeps the ledger?', handle]],
		'each question once, both read as the store');
	const sells = asked.find(job => job.question === 'What does the shop sell?');
	assert.equal(JSON.parse(sells.source_need.key)[1], STORE.node_id, 'the survivor\'s own need stands for the question its copy repeats');
	// The read of the store answers the question on both nodes: neither retained need is left.
	const job = await b.claim();
	assert.equal(job.job_id, asked.find(row => row.job_id === job.job_id)?.job_id, 'a need read is claimed');
	await b.publish(job, delta([{node_id: STORE.node_id, node_kind: 'scene', name: 'General Store', source_refs: P1, properties: {keeper_notes: 'The answer, on the page.'}}]));
	const left = (await b.raw()).source_needs.filter(need => need.question === job.question);
	assert.deepEqual(left, [], `the question ${job.question} was answered for the store and its copy`);
});

test('§191.1 the host keeps the identity pointer: its own review unit, never advisory, never cleared by the claim check, the published node in view', async () => {
	const draft = delta([scene('scene-hospital-pharmacy', 'Pharmacy', P2, {distinct_from: [PHARMACY.node_id]})]);
	const units = reviewUnits(draft, ['/nodes/0/distinct_from', '/nodes/0/summary'], undefined, true);
	assert.ok(units.some(unit => unit.includes('/nodes/0/distinct_from')), 'module-logic-v1 folds fields into their record, but not the identity pointer');
	assert.ok(!units.some(unit => unit.includes('/nodes/0/summary')), 'other fields still fold into the record');
	const refuses = gateRefusal({review_policy: 'module-logic-v1'});
	assert.equal(refuses({verdict: 'unsupported', impact: 'presentation'}, '/nodes/0/distinct_from'), true);
	assert.equal(refuses({verdict: 'unsupported', impact: 'presentation'}, '/nodes/0/summary'), false);
	const input = detailReviewInput({purpose: 'detail', known_nodes: [PHARMACY, STORE]}, draft, ['/nodes/0/distinct_from']);
	assert.deepEqual(input.known_context.nodes.map(node => node.node_id), [PHARMACY.node_id], 'the reviewer sees the published node it is told apart from');
	assert.equal(claimSupportIneligibility(draft, '/nodes/0', () => true, () => false), 'identity');
	// A page-cut packet may lack the published node: the host takes it from the claim's whole-graph view for the review.
	const attempt = await mkdtemp(join(directory, 'distinct-context-'));
	await save(join(attempt, 'graph-view.json'), {generation: 3, known_nodes: [PHARMACY, STORE], known_claims: []});
	assert.deepEqual((await distinctReviewContext(attempt, {known_nodes: [STORE]}, draft)).map(node => node.node_id), [PHARMACY.node_id]);
	assert.deepEqual(await distinctReviewContext(attempt, {known_nodes: [PHARMACY]}, draft), [], 'nothing the packet already carries');
	assert.deepEqual(await distinctReviewContext(attempt, {known_nodes: []}, delta([STORE])), [], 'nothing when no node answers with distinct_from');
});

test('§191.1 through the host: the repair round reads duplicate_of_published, answers with distinct_from, and the reviewer owes the pointer', async () => {
	const b = await book('host');
	await b.publish(await claimDetail(b, 'pharmacy'), delta([PHARMACY]));
	const job = await claimDetail(b, 'hospital');
	const seen = {reads: 0, findings: [], units: []};
	const other = scene('scene-hospital-pharmacy', 'Pharmacy', P2);
	const reading = new ReadingService({home: b.workspace, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record() {},
		call: (method, params) => b.kernel(method, params), runtime: {contentRoot: CONTENT,
			async runTask({request}) {
				const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
				const cache = resolve(request.source.cache), pages = [1, 2];
				if (request.prompt?.phase === 'read') {
					seen.reads++;
					let findings = null;
					try { findings = JSON.parse(await readFile(join(request.cwd, 'findings.json'), 'utf8')); } catch { /* the first round has none */ }
					seen.findings.push(findings);
					await save(join(request.cwd, 'draft.json'), delta([seen.reads === 1 ? other : {...other, distinct_from: [PHARMACY.node_id]}]));
				} else {
					seen.units.push(task);
					await save(join(request.cwd, 'review.json'), {checked: [{paths: task.required_review, verdict: 'supported', source_refs: P2, reason: 'Page 2 is the hospital dispensary.'}], missing: []});
				}
				const call = `pages-${Math.random().toString(16).slice(2)}`;
				for (const page of pages)
					await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: b.sha, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1]}) + '\n');
				request.onEvent?.({type: 'tool_execution_end', toolCallId: call, isError: false,
					result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: pages.map(page => ({path: join(cache, `page-${page}.png`), page}))}}});
				await appendFile(request.eventLog + '.images.jsonl', JSON.stringify({included: [call]}) + '\n');
				return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
			},
			check: ({packet: path, draft}) => api.checkSourceDraft(CONTENT, path, draft), async sourceInfo() { throw new Error('not a guidance job'); }}});
	closers.push(() => reading.close());
	await reading.runJob(job, new AbortController().signal);
	assert.equal(seen.reads, 2, 'one repair round');
	assert.match(JSON.stringify(seen.findings[1]), /duplicate_of_published/, 'the repair round read the refusal');
	assert.match(JSON.stringify(seen.findings[1]), /scene-pharmacy/);
	const owed = seen.units.find(unit => unit.required_review.includes('/nodes/0/distinct_from'));
	assert.ok(owed, 'a reviewer was assigned the identity pointer as written');
	assert.equal((await b.queue()).find(row => row.job_id === job.job_id).state, 'completed');
	assert.ok((await b.graph()).nodes.has('scene-hospital-pharmacy'));
	assert.equal(Object.values((await b.meta()).reading.identity)[0].verdict, 'different');
});
