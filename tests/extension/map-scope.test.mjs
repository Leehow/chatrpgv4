/**
 * Contract §39.4, "Only interior maps are masked" (owner ruling 2026-09-30): the reader writes `properties.map_scope`
 * ("area" or "interior") on every map it publishes, a reviewer checks it on the original page, and a map published before
 * the ruling is asked about in the background, one map at a time.
 *
 * These cases travel the real path: a kernel runtime over a bound, renderable PDF, `module.read.finish` doing the
 * publishing, `module.read.ahead` doing the queueing, and the host's ReadingService with its reader and reviewer children
 * played by a fixture runtime. A map "published before the ruling" is a generation whose map lost its `map_scope`, written
 * through the module store the publisher itself writes with: the current publisher refuses to publish one.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {appendFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {composeRuntimeContext} from '../../runtime/host.ts';
import {runtimeCapabilities} from '../../runtime/tasks.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const evidence = join(ROOT, '.coc/playtests/map-scope');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
	`export {ModuleStore} from './kernel-ts/modules/store.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
	`export {MAP_SCOPE_QUESTION} from './kernel-ts/modules/map-scope.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'map-scope-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); await closeSourceDocuments(); if (!process.env.KEEP_MAP_SCOPE_EVIDENCE) await rm(directory, {recursive: true, force: true}); });

/** A two-page renderable PDF: red and blue halves, then green with a yellow square. */
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
const REFS = [{page: 1}], TOWER = [{page: 2}];
const region = (id, box, asset) => ({region_id: id, name: id, source_asset: asset, source_box: box, placement: box});
/** A village map printed on page 1 and a cellar plan printed on page 2; neither crop overlaps another. */
const VILLAGE = {node_id: 'asset-harbor-village', node_kind: 'asset', name: 'Harbor village', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.05, 0.05, 0.45, 0.5]}], map_scope: 'area',
		map_regions: [region('inn', [0.1, 0.1, 0.3, 0.3], 'asset-harbor-village'), region('church', [0.5, 0.5, 0.7, 0.7], 'asset-harbor-village')]}};
const CELLAR = {node_id: 'asset-tower-cellar', node_kind: 'asset', name: 'Tower cellar', visibility: 'player-safe', source_refs: TOWER,
	properties: {image_sources: [{page: 2, box: [0.1, 0.1, 0.6, 0.9]}], map_scope: 'interior',
		map_regions: [region('stair', [0.1, 0.1, 0.4, 0.4], 'asset-tower-cellar'), region('vault', [0.5, 0.5, 0.9, 0.9], 'asset-tower-cellar')]}};
/** A second crop of the village map, already recorded as the same print (`variant-of` the village). */
const COPY = {node_id: 'asset-a-village-copy', node_kind: 'asset', name: 'Village copy', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.55, 0.55, 0.95, 0.95]}], map_scope: 'area', map_regions: [region('copy-inn', [0.1, 0.1, 0.3, 0.3], 'asset-a-village-copy')]}};
/** A chart printed on page 1 whose second region is cut from the cellar plate on page 2: its picture spans both pages. */
const CHART = {node_id: 'asset-harbor-chart', node_kind: 'asset', name: 'Harbor chart', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.05, 0.55, 0.45, 0.95]}], map_scope: 'area',
		map_regions: [region('pier', [0.1, 0.1, 0.5, 0.5], 'asset-harbor-chart'), {...region('cellar-stair', [0.1, 0.1, 0.4, 0.4], 'asset-tower-cellar'), placement: [0.5, 0.5, 0.9, 0.9]}]}};
const withProps = (node, change) => ({...node, properties: change({...node.properties})});
const without = (node, key) => withProps(node, props => { delete props[key]; return props; });
const delta = (nodes, claims = [], ready = nodes.map(node => node.node_id)) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready});
/** The one draft a map-scope reading writes. */
const scopeDraft = (node, scope, extra = {}) => ({nodes: [{node_id: node.node_id, node_kind: node.node_kind, name: node.name,
	properties: {map_scope: scope, ...extra}, source_refs: [{page: node.properties.image_sources[0].page}]}],
claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: []});

/**
 * A bound PDF with its index and opening published through the real kernel. `publish` plays a host reader and reviewer
 * that support everything the kernel asks to be reviewed (or `paths`, when given); `finish` is the real `module.read.finish`.
 */
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
	const file = join(workspace, 'original.pdf');
	await writeFile(file, pdf());
	const sha = createHash('sha256').update(await readFile(file)).digest('hex');
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
	const b = {workspace, mid, sha, kernel, context};
	b.call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
	b.claim = (params = {}) => b.call('module.read.claim', {owner: 'test-host', ...params});
	b.publish = async (job, draft, {paths, read = [1, 2]} = {}) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: read, full_pages: read, review_pages: [1, 2]});
		await save(join(job.work_dir, 'draft.json'), draft);
		// A draft the checker refuses owes no review: the publisher refuses it before it reads one.
		const checked = paths ?? (job.purpose === 'index' ? [] : (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? []);
		await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json')});
	};
	b.store = () => new api.ModuleStore(context);
	b.raw = async () => b.store().readGraph(mid).then(wire);
	b.node = async id => (await b.raw()).nodes.find(node => node.node_id === id);
	b.queue = async () => { try { return JSON.parse(await readFile(join(b.store().moduleDir(mid), 'deepen-queue.json'), 'utf8')); } catch { return []; } };
	b.scopeJobs = async () => (await b.queue()).filter(job => job.map_scope);
	/** A generation as one published before the ruling: these maps lose their kind; `change` may edit the graph further. */
	b.beforeTheRuling = async (ids, change = () => {}) => {
		const store = b.store(), meta = await store.module(mid), raw = await store.readGraph(mid);
		for (const node of raw.nodes) if (ids.includes(node.node_id)) delete node.properties.map_scope;
		change(raw);
		await store.writeGraph(meta, raw);
		await store.writeModule(meta);
	};
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Tower']}], map_candidates: []});
	await b.call('module.read.request', {purpose: 'opening'});
	const opened = await b.publish(await b.claim(), delta([
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: TOWER, summary: 'An old tower beyond the harbor.', properties: {is_final: true}}],
	[{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS}], ['scene-dock']));
	assert.equal(opened.opening_ready, true);
	return b;
}

/** A foreground detail reading, requested and claimed; its packet is what a reader would be handed. */
async function claimDetail(b, focus) {
	await b.call('module.read.request', {purpose: 'detail', focus, question: `Prepare the ${focus}`, foreground: true});
	const job = await b.claim();
	assert.equal(job.focus, focus);
	return job;
}
/** The map-scope job the read-ahead queued; a background reading the table queued before it gives its slot back unread. */
async function claimScope(b) {
	for (let tries = 0; tries < 6; tries++) {
		const job = await b.claim();
		if (job.map_scope) return job;
		assert.ok(job.job_id, 'the map-scope job was queued');
		await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'cancelled'});
	}
	throw new Error('no map-scope job was claimed');
}
/** Publishes maps through the real publisher, one detail reading each. */
async function publishMaps(b, ...maps) {
	for (const map of maps) await b.publish(await claimDetail(b, map.name), delta([map], [{subject_id: map.node_id, predicate: 'depicts',
		object: {node_id: map === CELLAR ? 'scene-tower' : 'scene-dock'}, truth_status: 'authored-fact', source_refs: map.source_refs}]));
}
const refusal = (rule, check = () => {}) => error => {
	assert.equal(error.code, 'invalid_params', error.message);
	assert.equal(error.details.rule, rule, error.message);
	check(error);
	return true;
};

test('§39.4 publication: a drafted map says area or interior; another word, none at all, or one on a node that is no map is refused with a fix that defines both kinds', async () => {
	const b = await book('publication');
	const job = await claimDetail(b, 'harbor village');
	const bothKinds = error => {
		assert.match(error.fix, /"area" for a town, village, district, city, region or other outdoor map that players are handed or see as a whole/);
		assert.match(error.fix, /"interior" for a building, floor plan, cellar, cave, ship or other enclosed place the investigators explore and uncover room by room/);
		assert.equal(error.details.path, '/nodes/0/properties/map_scope');
		assert.deepEqual(error.details.allowed, ['area', 'interior']);
	};
	await assert.rejects(b.publish(job, delta([withProps(VILLAGE, props => ({...props, map_scope: 'outdoor'}))])), refusal('map_scope_invalid', error => {
		bothKinds(error);
		assert.match(error.message, /must be "area" or "interior", not 'outdoor'/);
		assert.match(error.fix, /^Set properties\.map_scope of asset-harbor-village to exactly one of the two strings/);
	}));
	await assert.rejects(b.publish(job, delta([without(VILLAGE, 'map_scope')])), refusal('map_scope_missing', error => {
		bothKinds(error);
		assert.match(error.fix, /^Add properties\.map_scope to asset-harbor-village, judged from the original page/);
	}));
	const scene = {node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: TOWER, properties: {map_scope: 'interior'}};
	await assert.rejects(b.publish(job, delta([VILLAGE, scene], [], [VILLAGE.node_id])), refusal('map_scope_not_a_map', error => {
		assert.equal(error.details.path, '/nodes/1/properties/map_scope');
		assert.match(error.fix, /^Delete properties\.map_scope from scene-tower/);
	}));
	// The kind is reviewed on the page like the map's other fields: a review that never names it does not publish it.
	const required = await (async () => { await save(join(job.work_dir, 'draft.json'), delta([VILLAGE]));
		return (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review; })();
	assert.ok(required.includes('/nodes/0/properties/map_scope'), 'the kernel asks for the kind to be reviewed');
	await assert.rejects(b.publish(job, delta([VILLAGE]), {paths: required.filter(path => path !== '/nodes/0/properties/map_scope')}), refusal('review_incomplete', error => {
		assert.deepEqual(error.details.required_review, ['/nodes/0/properties/map_scope']);
	}));
	await b.publish(job, delta([VILLAGE]));
	assert.equal((await b.node(VILLAGE.node_id)).properties.map_scope, 'area');
	await publishMaps(b, CELLAR);
	assert.equal((await b.node(CELLAR.node_id)).properties.map_scope, 'interior');
});

test('§39.4 a map published before the ruling stays valid; a draft that changes its regions gives its kind, one onto a map that has a kind need not', async () => {
	const b = await book('before-the-ruling');
	await publishMaps(b, VILLAGE, CELLAR);
	await b.beforeTheRuling([VILLAGE.node_id]);
	assert.equal(Object.hasOwn((await b.node(VILLAGE.node_id)).properties, 'map_scope'), false, 'the village map is as it was published before the ruling');
	// An unrelated publication onto that graph is not judged by the old map.
	await b.publish(await claimDetail(b, 'tower'), delta([{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: TOWER,
		summary: 'An old tower beyond the harbor.', properties: {is_final: true}}]));
	// A draft that adds a region to the old map owes its kind; with it, the region and the kind are published together.
	const lighthouse = region('lighthouse', [0.7, 0.1, 0.9, 0.3], VILLAGE.node_id);
	const grown = withProps(without(VILLAGE, 'map_scope'), props => ({...props, map_regions: [lighthouse]}));
	const job = await claimDetail(b, 'harbor lighthouse');
	await assert.rejects(b.publish(job, delta([grown])), refusal('map_scope_missing'));
	await b.publish(job, delta([withProps(grown, props => ({...props, map_scope: 'area'}))]));
	const village = await b.node(VILLAGE.node_id);
	assert.deepEqual([village.properties.map_scope, village.properties.map_regions.map(row => row.region_id)], ['area', ['inn', 'church', 'lighthouse']]);
	// The cellar has a kind: a draft that grows it keeps that kind without repeating it.
	await b.publish(await claimDetail(b, 'cellar well'), delta([withProps(without(CELLAR, 'map_scope'), props => ({...props,
		map_regions: [region('well', [0.1, 0.5, 0.4, 0.9], CELLAR.node_id)]}))]));
	const cellar = await b.node(CELLAR.node_id);
	assert.deepEqual([cellar.properties.map_scope, cellar.properties.map_regions.map(row => row.region_id)], ['interior', ['stair', 'vault', 'well']]);
});

test('§39.4 read-ahead: one background job for the lowest-page map without a kind, none beside it, none for a variant, none once every map has one', async () => {
	const b = await book('read-ahead');
	await publishMaps(b, CELLAR, VILLAGE, COPY);
	// Before the ruling: no map has a kind, and the copy is already recorded as a print of the village map.
	await b.beforeTheRuling([CELLAR.node_id, VILLAGE.node_id, COPY.node_id], raw => raw.relations.push({relation_id: 'rel-identity-copy', relation_kind: 'variant-of',
		from_node_id: COPY.node_id, to_node_id: VILLAGE.node_id, properties: {}}));
	await b.call('module.read.ahead', {});
	let jobs = await b.scopeJobs();
	assert.equal(jobs.length, 1, 'one map at a time');
	assert.deepEqual([jobs[0].map_scope, jobs[0].pages, jobs[0].purpose, jobs[0].foreground, jobs[0].state],
		[{node: VILLAGE.node_id}, [1], 'detail', false, 'queued'], 'the lowest page first, and never the variant that sorts before it');
	assert.equal(jobs[0].question, api.MAP_SCOPE_QUESTION);
	await b.call('module.read.ahead', {});
	assert.equal((await b.scopeJobs()).length, 1, 'not a second while one is queued');
	// Asked directly about a map that already has a kind, or with a malformed marker, the kernel queues nothing.
	await assert.rejects(b.call('module.read.request', {purpose: 'detail', focus: 'x', question: 'y', map_scope: {node: VILLAGE.node_id, pages: [1]}}), {code: 'invalid_params'});
	const job = await claimScope(b);
	await b.publish(job, scopeDraft(VILLAGE, 'area'));
	assert.deepEqual(await b.call('module.read.request', {purpose: 'detail', focus: 'x', question: 'y', map_scope: {node: VILLAGE.node_id}}), {generation: (await b.store().module(b.mid)).generation, missing: [], state: 'ready'});
	await b.call('module.read.ahead', {});
	jobs = await b.scopeJobs();
	assert.deepEqual(jobs.map(row => [row.map_scope.node, row.pages, row.state]), [[VILLAGE.node_id, [1], 'completed'], [CELLAR.node_id, [2], 'queued']]);
	await b.publish(await claimScope(b), scopeDraft(CELLAR, 'interior'));
	await b.call('module.read.ahead', {});
	assert.equal((await b.scopeJobs()).length, 2, 'every survivor has a kind: nothing more to ask');
	assert.equal(Object.hasOwn((await b.node(COPY.node_id)).properties, 'map_scope'), false, 'the variant was never asked');
});

test('§39.4 a map-scope reading views every page its map is printed on, not only the one it cites', async () => {
	const b = await book('two-pages');
	await publishMaps(b, CELLAR, CHART);
	await b.beforeTheRuling([CHART.node_id]);
	await b.call('module.read.ahead', {});
	const job = await claimScope(b);
	assert.deepEqual([job.map_scope, job.pages], [{node: CHART.node_id}, [1, 2]], "the chart's own crop and the plate its region is cut from");
	await save(join(job.work_dir, 'draft.json'), scopeDraft(CHART, 'area'));
	const checked = await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'));
	assert.deepEqual([checked.ok, checked.required_view_pages], [true, [1, 2]], 'the reader is sent to both pages before it may submit');
	await assert.rejects(b.publish(job, scopeDraft(CHART, 'area'), {read: [1]}), refusal('map_scope_job_bounds', error => assert.match(error.message, /not viewed: 2/)));
	await b.publish(job, scopeDraft(CHART, 'area'));
	assert.equal((await b.node(CHART.node_id)).properties.map_scope, 'area');
});

/**
 * The host ReadingService over the real kernel, with a fixture runtime playing its children: `author(round, task,
 * findings)` writes the reader's draft; `review(paths)` answers each review unit (by default every path is supported).
 */
function service(b, {author, review}) {
	const runs = {reads: [], verifies: []};
	const runtime = {
		contentRoot: CONTENT,
		async runTask({request}) {
			const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
			const cache = resolve(request.source.cache), pages = Array.isArray(task.pages) && task.pages.length ? task.pages : [1];
			const see = async () => {
				const call = `pages-${Math.random().toString(16).slice(2)}`;
				for (const page of pages)
					await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: b.sha, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1]}) + '\n');
				request.onEvent?.({type: 'tool_execution_end', toolCallId: call, isError: false,
					result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: pages.map(page => ({path: join(cache, `page-${page}.png`), page}))}}});
				await appendFile(request.eventLog + '.images.jsonl', JSON.stringify({included: [call]}) + '\n');
			};
			if (request.prompt?.phase === 'read') {
				let findings = null;
				try { findings = JSON.parse(await readFile(join(request.cwd, 'findings.json'), 'utf8')); } catch { /* the first round has none */ }
				runs.reads.push({task, prompt: request.prompt, findings});
				await save(join(request.cwd, 'draft.json'), author(runs.reads.length, task, findings));
				await see();
				return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
			}
			runs.verifies.push(task);
			const checked = (review ?? (paths => [{paths, verdict: 'supported', source_refs: REFS, reason: 'Compared on the original page.'}]))(task.required_review);
			await save(join(request.cwd, 'review.json'), {checked, missing: []});
			await see();
			return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
		},
		check: ({packet, draft}) => api.checkSourceDraft(CONTENT, packet, draft),
		async sourceInfo() { throw new Error('not a guidance job'); },
	};
	const reading = new ReadingService({home: b.workspace, runtime, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}),
		progress() {}, record() {}, call: (method, params) => b.kernel(method, params)});
	closers.push(() => reading.close());
	return {runs, run: job => reading.runJob(job, new AbortController().signal)};
}

test('§39.4 the map-scope job: its reader is told exactly what to write, writes only the kind, and publication adds it to the published map and nothing else', async () => {
	const b = await book('scope-job');
	await publishMaps(b, VILLAGE, CELLAR);
	await b.beforeTheRuling([VILLAGE.node_id]);
	const before = await b.raw();
	await b.call('module.read.ahead', {});
	const job = await claimScope(b);
	const host = service(b, {author(round, task, findings) {
		// The first draft strays into the map's regions; the checker's findings send it back to the kind alone.
		if (round === 1) return scopeDraft(VILLAGE, 'area', {map_regions: [region('lighthouse', [0.7, 0.1, 0.9, 0.3], VILLAGE.node_id)]});
		assert.match(findings.error, /map_scope_job_bounds/, JSON.stringify(findings));
		return scopeDraft(VILLAGE, 'area');
	}});
	await host.run(job);
	assert.equal(host.runs.reads.length, 2, 'the straying draft was refused by the checker and read again');
	const [first] = host.runs.reads;
	assert.deepEqual([first.task.map_scope, first.task.pages, first.task.question, first.task.purpose], [{node: VILLAGE.node_id}, [1], api.MAP_SCOPE_QUESTION, 'detail']);
	assert.equal(first.prompt.visual, 'scope', 'the reader runs under the map-scope instructions');
	assert.ok(host.runs.verifies.some(task => task.required_review.includes('/nodes/0/properties/map_scope')), 'the reviewer is asked about the kind by name');
	assert.equal((await b.queue()).find(row => row.job_id === job.job_id).state, 'completed');
	const after = await b.raw();
	const village = after.nodes.find(node => node.node_id === VILLAGE.node_id), old = before.nodes.find(node => node.node_id === VILLAGE.node_id);
	assert.deepEqual(village.properties, {...old.properties, map_scope: 'area'}, 'the kind is added; the regions and crops stay as published');
	assert.deepEqual([village.name, village.node_kind, village.visibility], [old.name, old.node_kind, old.visibility]);
	assert.deepEqual(after.nodes.filter(node => node.node_id !== VILLAGE.node_id), before.nodes.filter(node => node.node_id !== VILLAGE.node_id), 'no other node changes');
	assert.deepEqual([after.claims, after.relations], [before.claims, before.relations], 'no claim or relation changes');
});

test('§39.4 a kind the reviewer finds wrong on the page refuses the job, and its review retry is still a map-scope reading', async () => {
	const b = await book('scope-refused');
	await publishMaps(b, VILLAGE);
	await b.beforeTheRuling([VILLAGE.node_id]);
	await b.call('module.read.ahead', {});
	const job = await claimScope(b);
	const host = service(b, {author: () => scopeDraft(VILLAGE, 'interior'), review: paths => [
		{paths: paths.filter(path => path !== '/nodes/0/properties/map_scope'), verdict: 'supported', source_refs: REFS, reason: 'The map is on this page.'},
		...(paths.includes('/nodes/0/properties/map_scope') ? [{paths: ['/nodes/0/properties/map_scope'], verdict: 'unsupported', impact: 'logic', source_refs: REFS,
			reason: 'The page prints streets and houses of a village handed to players whole, not rooms of an enclosed place.'}] : []),
	]});
	await host.run(job);
	const queue = await b.queue(), failed = queue.find(row => row.job_id === job.job_id);
	assert.equal(failed.state, 'failed');
	assert.equal(failed.refusal?.rule, 'review_unsupported');
	assert.equal(Object.hasOwn((await b.node(VILLAGE.node_id)).properties, 'map_scope'), false, 'a refused kind is not published');
	const retry = queue.find(row => row.review_retry?.of === job.job_id);
	assert.ok(retry, 'the refused reading is read once more with the reviewer\'s reasons');
	assert.deepEqual(retry.map_scope, {node: VILLAGE.node_id}, 'the retry is still bounded to the kind of this one map');
});

test('§39.4 the reader of a map-scope job runs under its own short instructions', async () => {
	const home = await mkdtemp(join(directory, 'prompt-')), cwd = join(home, 'attempt');
	await mkdir(cwd);
	const transport = join(home, 'transport.mjs');
	await writeFile(transport, `console.log(JSON.stringify({type:'transport_ready'}));\n`);
	const context = composeRuntimeContext({owner: 'preparation', home}, {resourceRoot: ROOT, contentRoot: CONTENT,
		env: {...process.env, UV_OFFLINE: '1', UV_NO_SYNC: '1', PI_COC_READER_CMD: JSON.stringify([process.execPath, transport])}});
	const result = await runtimeCapabilities.runTask(context, {kind: 'reader', request: {cwd, brief: 'Say the kind.', model: 'fixture/model', thinking: 'low',
		prompt: {phase: 'read', visual: 'scope'}, eventLog: join(cwd, 'events.jsonl')}}, new AbortController().signal);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(await readFile(join(cwd, 'instructions-read.md'), 'utf8'), await readFile(join(CONTENT, 'setup', 'visual-map-scope.md'), 'utf8'));
});
