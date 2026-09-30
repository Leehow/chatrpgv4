/**
 * Contract §152.4: one printed visual is one node.
 *
 * Dust to Dust generation 36 (installed App, campaign game-5d82fd23) held two nodes for the one village map of physical
 * page 8: two readings claimed in the same second, each with a known-node packet that lacked the other's map, and
 * publication merged by node id only. These cases travel the real path: a kernel runtime over a bound, renderable PDF,
 * the host's ReadingService with its reader, reviewer and identity-reviewer children played by a fixture runtime, and
 * `module.read.finish` doing the publishing. The crops below keep the geometry of the two village maps.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {createCanvas, loadImage} from '@napi-rs/canvas';
import {collision, identityVerdicts} from '../../kernel-ts/modules/visual-identity-shape.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const evidence = join(ROOT, '.coc/playtests/visual-identity');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
	`export {heldHandouts} from './kernel-ts/read/handout-document.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {handoutNode} from './kernel-ts/apply/entities.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'visual-identity-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); await closeSourceDocuments(); if (!process.env.KEEP_IDENTITY_EVIDENCE) await rm(directory, {recursive: true, force: true}); });

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
const REFS = [{page: 1}];
/** The two crops of the one village map on Dust to Dust's page 8 (read-7 and read-10), moved to this PDF's page 1. */
const BOX_A = [0.05, 0.05, 0.95, 0.52], BOX_B = [0.08, 0.03, 0.92, 0.48];
const region = (id, box, asset) => ({region_id: id, name: id, source_asset: asset, source_box: box, placement: box});
const MAP_A = {node_id: 'asset-map-harbor-village', node_kind: 'asset', name: 'Harbor village', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: BOX_A}], map_scope: 'area', map_regions: [region('inn', [0.1, 0.1, 0.3, 0.3], 'asset-map-harbor-village'), region('church', [0.5, 0.5, 0.7, 0.7], 'asset-map-harbor-village')]}};
const MAP_B = {node_id: 'asset-harbor-village-map', node_kind: 'asset', name: 'Harbor village map', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: BOX_B}], map_scope: 'area', map_regions: [region('inn-b', [0.12, 0.15, 0.32, 0.4], 'asset-harbor-village-map'), region('lighthouse', [0.7, 0.1, 0.9, 0.3], 'asset-harbor-village-map')]}};
/** The lighthouse of MAP_B expressed in MAP_A's frame: the same page coordinates, divided by MAP_A's own crop. */
const LIGHTHOUSE_IN_A = region('lighthouse', [0.687, 0.053, 0.873, 0.245], 'asset-map-harbor-village');
const depicts = subject => ({subject_id: subject, predicate: 'depicts', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS});
const delta = (nodes, claims = [], ready = nodes.map(node => node.node_id)) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready});

/**
 * A bound PDF with its index and opening published through the real kernel. `publish` plays a host reader and
 * reviewer that support everything the kernel asks to be reviewed; `finish` is the real `module.read.finish`.
 */
async function book(name) {
	const workspace = await mkdtemp(join(directory, `${name}-`));
	const context = await api.createKernelContext({workspace, content: CONTENT, seed: name, locks: api.nativeAdvisoryLocks(),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context);
	closers.push(() => runtime.close());
	/** The kernel as the host's client sees it, across the JSON wire: a refusal arrives as a KernelError. */
	const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
	const kernel = async (method, params = {}) => {
		try { return wire(await runtime.handlers[method](params)); }
		catch (error) { if (typeof error?.toJson === 'function') throw new KernelError(wire(error.toJson())); throw error; }
	};
	const file = join(workspace, 'original.pdf');
	await writeFile(file, pdf());
	const sha = createHash('sha256').update(await readFile(file)).digest('hex');
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
	const b = {workspace, mid, sha, kernel};
	b.call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
	b.claim = (params = {}) => b.call('module.read.claim', {owner: 'test-host', ...params});
	b.publish = async (job, draft, extra = {}) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]});
		await save(join(job.work_dir, 'draft.json'), draft);
		const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review;
		await save(join(job.work_dir, 'review.json'), {checked: [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json'), ...extra});
	};
	b.meta = async (campaign) => JSON.parse(await readFile(join(await b.moduleDir(campaign), 'module.json'), 'utf8'));
	b.moduleDir = async (campaign) => campaign ? join(workspace, '.coc/module-campaigns', campaign, 'modules', mid) : join(workspace, '.coc/modules', mid);
	b.raw = async (campaign) => { const meta = await b.meta(campaign); return JSON.parse(await readFile(join(await b.moduleDir(campaign), meta.graph_file), 'utf8')); };
	b.graph = async (campaign) => new api.ModuleGraph(mid, await b.raw(campaign), '', {});
	b.queue = async (campaign) => { try { return JSON.parse(await readFile(join(await b.moduleDir(campaign), 'deepen-queue.json'), 'utf8')); } catch { return []; } };
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Tower']}], map_candidates: []});
	await b.call('module.read.request', {purpose: 'opening'});
	const opened = await b.publish(await b.claim(), delta([
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.', properties: {is_final: true}}],
	[{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS}], ['scene-dock']));
	assert.equal(opened.opening_ready, true);
	return b;
}

/** A background detail reading, requested and claimed; its packet is what a reader would be handed. */
async function claimDetail(b, focus, campaign) {
	// Foreground, so the claim takes it before any background reading the table queued meanwhile.
	await b.call('module.read.request', {purpose: 'detail', focus, question: `Prepare the ${focus}`, foreground: true, ...(campaign ? {campaign} : {})});
	const job = await b.claim(campaign ? {campaign} : {});
	assert.equal(job.focus, focus);
	return job;
}

/** The identity job the read-ahead queued; a background reading the table queued before it gives its slot back unread. */
async function claimIdentity(b, campaign) {
	for (let tries = 0; tries < 6; tries++) {
		const job = await b.claim(campaign ? {campaign} : {});
		if (job.visual_identity) return job;
		assert.ok(job.job_id, 'the identity job was queued');
		await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'cancelled', ...(campaign ? {campaign} : {})});
	}
	throw new Error('no identity job was claimed');
}

/** The host's page evidence for one child run: the pages it viewed, delivered on the provider's record. */
async function seePages(request, cache, sha, pages) {
	const call = `pages-${pages.join('-')}-${Math.random().toString(16).slice(2)}`;
	for (const page of pages)
		await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: sha, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1]}) + '\n');
	request.onEvent?.({type: 'tool_execution_end', toolCallId: call, isError: false,
		result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: pages.map(page => ({path: join(cache, `page-${page}.png`), page}))}}});
	await appendFile(request.eventLog + '.images.jsonl', JSON.stringify({included: [call]}) + '\n');
}

/**
 * The host ReadingService over the real kernel, with a fixture runtime playing its children: `author(round, task,
 * findings)` writes the reader's draft, every review unit supports what it is assigned, and `identity(pair, attempt)`
 * answers the identity reviewer (undefined: the child writes nothing). Every identity child reads every preview.
 */
function service(b, {author, identity, campaign, reads = true}) {
	const runs = {read: 0, verify: 0, identity: 0, identityTasks: [], findings: []};
	const runtime = {
		contentRoot: CONTENT,
		async runTask({request}) {
			const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
			const pageCache = join(resolve(request.source.cache));
			if (request.systemPrompt?.endsWith('instructions-identity.md')) {
				runs.identity++;
				// The tasks as the reviewer sees them, with each preview resolved against its own directory.
				runs.identityTasks.push({...task, pairs: task.pairs.map(pair => ({...pair, preview: resolve(request.cwd, pair.preview)}))});
				const ids = [];
				for (const [index, pair] of task.pairs.entries()) {
					const id = `read-preview-${runs.identity}-${index}`;
					ids.push(id);
					if (!reads) continue;
					request.onEvent({type: 'tool_execution_start', toolName: 'read', toolCallId: id, args: {path: pair.preview}});
					// The real reviewer is a confined reader: a file outside its task directory is refused, not delivered.
					const inside = !relative(request.cwd, resolve(request.cwd, pair.preview)).startsWith('..');
					request.onEvent({type: 'tool_execution_end', toolCallId: id, isError: !inside,
						result: {content: [inside ? {type: 'image'} : {type: 'text', text: 'Reader confinement blocked read: the path is outside the task directory and its bound PDF cache'}]}});
				}
				await appendFile(request.eventLog + '.images.jsonl', JSON.stringify({included: ids}) + '\n');
				const verdicts = task.pairs.map(pair => identity(pair, runs.identity)).filter(Boolean);
				if (verdicts.length === task.pairs.length)
					await save(join(request.cwd, 'identity.json'), {verdicts: task.pairs.map((pair, index) => ({key: pair.key, ...verdicts[index]}))});
				return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
			}
			if (request.prompt?.phase === 'read') {
				runs.read++;
				let findings = null;
				try { findings = JSON.parse(await readFile(join(request.cwd, 'findings.json'), 'utf8')); } catch { /* the first round has none */ }
				runs.findings.push(findings);
				await save(join(request.cwd, 'draft.json'), author(runs.read, task, findings));
				await seePages(request, pageCache, b.sha, [1]);
				return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
			}
			runs.verify++;
			await save(join(request.cwd, 'review.json'), {checked: [{paths: task.required_review, verdict: 'supported', source_refs: REFS, reason: 'Compared on the original page.'}], missing: []});
			await seePages(request, pageCache, b.sha, [1]);
			return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
		},
		check: ({packet, draft}) => api.checkSourceDraft(CONTENT, packet, draft),
		async sourceInfo() { throw new Error('not a guidance job'); },
	};
	const reading = new ReadingService({home: b.workspace, runtime, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}),
		progress() {}, record() {}, call: (method, params) => b.kernel(method, params), ...(campaign ? {campaign: () => campaign} : {})});
	closers.push(() => reading.close());
	return {reading, runs, run: job => reading.runJob(job, new AbortController().signal, campaign)};
}
const same = () => ({verdict: 'same', reason: 'One printed village map; the second crop is cut a little tighter.'});
const different = () => ({verdict: 'different', reason: 'Two maps printed side by side.'});

test('§152.4 geometry: a crop overlapping another by half the smaller box raises the question, less does not', () => {
	const node = (box, page = 1) => ({node_id: 'asset-x', node_kind: 'asset', properties: {image_sources: [{page, box}]}});
	assert.ok(collision(node(BOX_A), node(BOX_B)), 'the two village-map crops collide');
	// [0, 0, .5, .5] against [.25, 0, .75, .5]: the overlap is exactly half of either box (all exact in binary).
	assert.deepEqual(collision(node([0, 0, 0.5, 0.5]), node([0.25, 0, 0.75, 0.5])), {page: 1, a: [0, 0, 0.5, 0.5], b: [0.25, 0, 0.75, 0.5]});
	assert.equal(collision(node([0, 0, 0.5, 0.5]), node([0.375, 0, 0.875, 0.5])), null, 'less than half is not a question');
	assert.equal(collision(node(BOX_A), node(BOX_A, 2)), null, 'another page is another print');
	// A clipping inside a larger card overlaps all of the smaller box: geometry asks, and only asks.
	assert.ok(collision(node([0.02, 0.42, 0.48, 0.88]), node([0.24, 0.58, 0.475, 0.775])));
	assert.equal(collision({node_kind: 'scene', properties: {image_sources: [{page: 1}]}}, node(BOX_A)), null, 'only printed visuals');
});

test('§152.4 shape: a verdict is same or different with a reason; a correspondence belongs only to two published maps', () => {
	const pair = {key: 'k', page: 1, earlier: {map_regions: [{region_id: 'inn'}]}, later: {map_regions: [{region_id: 'inn-b'}]}};
	assert.deepEqual(identityVerdicts({verdicts: [{key: 'k', verdict: 'same', reason: 'r', region_correspondence: {'inn-b': 'inn'}}]}, [pair], {complete: true})[0].region_correspondence, {'inn-b': 'inn'});
	assert.throws(() => identityVerdicts({verdicts: [{key: 'k', verdict: 'different', reason: 'r', region_correspondence: {'inn-b': 'inn'}}]}, [pair]), /only to a same-print answer/);
	assert.throws(() => identityVerdicts({verdicts: [{key: 'k', verdict: 'same', reason: 'r', region_correspondence: {inn: 'inn-b'}}]}, [pair]), /maps a region of the later map/);
	assert.throws(() => identityVerdicts({verdicts: [{key: 'k', verdict: 'maybe', reason: 'r'}]}, [pair]), /same, different/);
	assert.throws(() => identityVerdicts({verdicts: [{key: 'k', verdict: 'same', reason: ' '}]}, [pair]), /reason/);
	assert.throws(() => identityVerdicts({verdicts: []}, [pair], {complete: true}), /no verdict for k/);
	const drafted = {key: 'd', page: 1, published: {map_regions: [{region_id: 'inn'}]}, drafted: {map_regions: [{region_id: 'inn-b'}]}};
	assert.throws(() => identityVerdicts({verdicts: [{key: 'd', verdict: 'same', reason: 'r', region_correspondence: {'inn-b': 'inn'}}]}, [drafted]), /two published maps/);
});

test('§152.4 race: two readings claimed before either published cannot both publish a new node for one print', async () => {
	const b = await book('race');
	const first = await claimDetail(b, 'harbor village'), second = await claimDetail(b, 'harbor map');
	assert.ok(!second.known_nodes.some(node => node.node_id === MAP_A.node_id), "the second reader's packet lacks the first reader's map");
	await b.publish(first, delta([MAP_A], [depicts(MAP_A.node_id)]));
	await assert.rejects(b.publish(second, delta([MAP_B], [depicts(MAP_B.node_id)])), error => {
		assert.equal(error.code, 'needs');
		assert.equal(error.details.reason, 'visual_identity_pending');
		assert.equal(error.details.pairs.length, 1);
		const [pair] = error.details.pairs;
		assert.deepEqual([pair.page, pair.published.node_id, pair.drafted.node_id], [1, MAP_A.node_id, MAP_B.node_id]);
		assert.deepEqual(pair.drafted.image_sources, MAP_B.properties.image_sources, 'both crops travel with the question');
		return true;
	});
	const graph = await b.graph();
	assert.ok(graph.nodes.has(MAP_A.node_id));
	assert.ok(!graph.nodes.has(MAP_B.node_id), 'the second print was not published as a new node');
	// Geometry only: a node elsewhere on the page with the same name is no question at all.
	const third = await claimDetail(b, 'tower plan');
	const elsewhere = {...MAP_B, node_id: 'asset-harbor-village-map-tower', properties: {image_sources: [{page: 1, box: [0.1, 0.6, 0.4, 0.95]}]}};
	await b.publish(third, delta([elsewhere]));
	assert.ok((await b.graph()).nodes.has(elsewhere.node_id));
});

test('§152.4 same print: the reviewer is asked once, the draft is repaired onto the published node, and its new region lands there', async () => {
	const b = await book('same-print');
	const first = await claimDetail(b, 'harbor village'), second = await claimDetail(b, 'harbor map');
	await b.publish(first, delta([MAP_A], [depicts(MAP_A.node_id)]));
	const host = service(b, {identity: same, author(round, task, findings) {
		if (round === 1) return delta([MAP_B], [depicts(MAP_B.node_id)]);
		// The repair round: the refusal names the published node and what it already holds.
		assert.equal(findings.details.rule, 'same_print_duplicate');
		assert.equal(findings.details.existing.node_id, MAP_A.node_id);
		assert.deepEqual(findings.details.existing.image_sources, MAP_A.properties.image_sources);
		assert.deepEqual(findings.details.existing.map_regions.map(row => row.region_id), ['inn', 'church']);
		// §39.4: a draft that grows a map says its kind; this reader's packet was claimed before the published map existed.
		return delta([{...MAP_A, properties: {image_sources: MAP_A.properties.image_sources, map_scope: 'area', map_regions: [LIGHTHOUSE_IN_A]}}], [depicts(MAP_A.node_id)]);
	}});
	await host.run(second);
	assert.equal(host.runs.identity, 1, 'the identity reviewer was asked once');
	const [asked] = host.runs.identityTasks;
	assert.deepEqual([asked.pairs[0].a.node_id, asked.pairs[0].b.node_id], [MAP_A.node_id, MAP_B.node_id], 'A is the published crop, B the drafted one');
	assert.equal(asked.pairs[0].correspondence, false, 'no region correspondence is asked of a drafted pair');
	// Both crops, side by side: A on the left and B on the right, each cut from the red-and-blue page.
	const preview = await loadImage(await readFile(asked.pairs[0].preview)), canvas = createCanvas(preview.width, preview.height), ctx = canvas.getContext('2d');
	ctx.drawImage(preview, 0, 0);
	const pixel = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)];
	const red = ([r, g, bl]) => r > 200 && g < 60 && bl < 60, blue = ([r, g, bl]) => bl > 200 && r < 60 && g < 60;
	// Along one row: A's red then blue, the white gap between the sides, then B's red then blue.
	const row = Array.from({length: preview.width}, (_, x) => pixel(x, 60)), white = ([r, g, bl]) => r > 240 && g > 240 && bl > 240;
	const gap = row.findIndex((value, x) => white(value) && row.slice(x, x + 30).every(white));
	assert.ok(gap > 0, 'a gap separates the two sides');
	const end = row.findIndex((value, x) => x > gap && !white(value));
	// A few pixels in from each side's framed edge.
	assert.ok(red(row[8]) && blue(row[gap - 8]), 'crop A is drawn on the left');
	assert.ok(red(row[end + 8]) && blue(row[row.length - 8]), 'crop B is drawn on the right');
	const graph = await b.graph();
	assert.ok(!graph.nodes.has(MAP_B.node_id), 'the duplicate published nothing of its own');
	assert.deepEqual(graph.nodes.get(MAP_A.node_id).properties.map_regions.map(row => row.region_id), ['inn', 'church', 'lighthouse'],
		'the published regions stay as published and the new one is added in their frame');
	assert.deepEqual(graph.nodes.get(MAP_A.node_id).properties.map_regions[2].source_box, LIGHTHOUSE_IN_A.source_box);
	const verdicts = Object.values((await b.meta()).reading.visual_identity);
	assert.equal(verdicts.length, 1);
	assert.deepEqual([verdicts[0].verdict, verdicts[0].nodes], ['same', [MAP_A.node_id, MAP_B.node_id]], 'the verdict survived the refusal it caused');
	assert.equal((await b.queue()).find(job => job.job_id === second.job_id).state, 'completed');
});

test('§152.4 different prints: both stand, the verdict is kept, and the pair is not asked again', async () => {
	const b = await book('different-prints');
	const first = await claimDetail(b, 'harbor village'), second = await claimDetail(b, 'harbor map');
	await b.publish(first, delta([MAP_A], [depicts(MAP_A.node_id)]));
	const host = service(b, {identity: different, author: () => delta([MAP_B], [depicts(MAP_B.node_id)])});
	await host.run(second);
	assert.equal(host.runs.identity, 1);
	const graph = await b.graph();
	assert.ok(graph.nodes.has(MAP_A.node_id) && graph.nodes.has(MAP_B.node_id), 'both prints stand');
	assert.equal(graph.isVariant(graph.nodes.get(MAP_B.node_id)), false);
	assert.equal(Object.values((await b.meta()).reading.visual_identity)[0].verdict, 'different');
	// The published pair is not queued for review: the kept verdict answers for those two crops.
	await b.call('module.read.ahead', {});
	assert.equal((await b.queue()).filter(job => job.visual_identity).length, 0, 'the read-ahead does not ask the pair again');
});

test('§152.4 review unavailable: the job is held with its attempt, asked again, and fails on the third hold without publishing', async () => {
	const b = await book('unavailable');
	const first = await claimDetail(b, 'harbor village'), second = await claimDetail(b, 'harbor map');
	await b.publish(first, delta([MAP_A], [depicts(MAP_A.node_id)]));
	const host = service(b, {identity: () => undefined, author: () => delta([MAP_B], [depicts(MAP_B.node_id)])});
	await host.run(second);
	let job = (await b.queue()).find(row => row.job_id === second.job_id);
	assert.deepEqual([job.state, job.identity_holds], ['queued', 1], 'held, not failed');
	assert.ok(!(await b.graph()).nodes.has(MAP_B.node_id), 'an unanswered question is not a different');
	for (const hold of [2, 3]) {
		const again = await b.claim();
		assert.equal(again.job_id, second.job_id);
		assert.ok(again.resume_from, 'the held attempt is resumed, not read from nothing');
		await host.run(again);
		job = (await b.queue()).find(row => row.job_id === second.job_id);
		assert.equal(job.identity_holds, hold);
	}
	assert.equal(job.state, 'failed');
	assert.equal(job.refusal.rule, 'visual_identity_unavailable');
	assert.equal(host.runs.read, 1, 'the resumed attempts reused the checkpointed read');
	assert.ok(!(await b.graph()).nodes.has(MAP_B.node_id));
	assert.equal((await b.meta()).reading.visual_identity, undefined, 'no verdict was invented');
});

test('§152.4 an answer given without reading both crops is not an answer: the job is held and nothing is published', async () => {
	const b = await book('unread-preview');
	const first = await claimDetail(b, 'harbor village'), second = await claimDetail(b, 'harbor map');
	await b.publish(first, delta([MAP_A], [depicts(MAP_A.node_id)]));
	const host = service(b, {identity: different, reads: false, author: () => delta([MAP_B], [depicts(MAP_B.node_id)])});
	await host.run(second);
	assert.equal(host.runs.identity, 2, 'the reviewer is told to read the previews once, then the question is left unanswered');
	const job = (await b.queue()).find(row => row.job_id === second.job_id);
	assert.deepEqual([job.state, job.identity_holds], ['queued', 1]);
	assert.ok(!(await b.graph()).nodes.has(MAP_B.node_id));
	assert.equal((await b.meta()).reading.visual_identity, undefined);
});

/**
 * A graph that already holds two nodes for one print, published through the real publisher: one reading drafted both
 * crops (only the first ready), a later reading made the second ready, so they were first published a generation apart.
 */
async function duplicated(b, campaign) {
	const both = await claimDetail(b, 'harbor village', campaign);
	await b.publish(both, delta([MAP_A, MAP_B], [depicts(MAP_A.node_id)], [MAP_A.node_id]), campaign ? {campaign} : {});
	const later = await claimDetail(b, 'harbor map', campaign);
	await b.publish(later, delta([MAP_B], [depicts(MAP_B.node_id)]), campaign ? {campaign} : {});
}

test('§152.4 existing duplicates: the read-ahead queues their review, and a same verdict writes variant-of from the later node with the reviewed correspondence', async () => {
	const b = await book('existing');
	await duplicated(b);
	let graph = await b.graph();
	assert.ok(graph.nodes.has(MAP_A.node_id) && graph.nodes.has(MAP_B.node_id));
	await b.call('module.read.ahead', {});
	const queued = (await b.queue()).filter(job => job.visual_identity);
	assert.equal(queued.length, 1, 'one identity job for the page');
	assert.deepEqual([queued[0].visual_identity.page, queued[0].foreground], [1, false]);
	const job = await b.claim();
	assert.equal(job.job_id, queued[0].job_id);
	assert.deepEqual([job.visual_identity.pairs[0].earlier.node_id, job.visual_identity.pairs[0].later.node_id], [MAP_A.node_id, MAP_B.node_id],
		'the earlier node is the one first published earlier');
	const host = service(b, {author() { throw new Error('an identity job has no author'); },
		identity: pair => ({...same(), region_correspondence: {'inn-b': 'inn'}})});
	await host.run(job);
	assert.equal(host.runs.identity, 1);
	assert.equal(host.runs.identityTasks[0].pairs[0].correspondence, true, 'two published maps may be matched region by region');
	assert.deepEqual(host.runs.identityTasks[0].pairs[0].b.regions.map(row => row.marker), ['B1', 'B2']);
	graph = await b.graph();
	const variant = graph.nodes.get(MAP_B.node_id), survivor = graph.nodes.get(MAP_A.node_id);
	const [relation] = graph.raw.relations.filter(rel => rel.relation_kind === 'variant-of');
	assert.deepEqual([relation.from_node_id, relation.to_node_id], [MAP_B.node_id, MAP_A.node_id], 'from the later node to the survivor');
	assert.deepEqual(relation.properties.region_correspondence, {'inn-b': 'inn'});
	assert.equal(graph.isVariant(variant), true);
	assert.equal(graph.isVariant(survivor), false);
	assert.equal(graph.survivorOf(variant).node_id, MAP_A.node_id);
	assert.deepEqual(graph.regionCorrespondence(variant, survivor), {'inn-b': 'inn'});
	assert.equal((await b.queue()).find(row => row.job_id === job.job_id).state, 'completed');
	await b.call('module.read.ahead', {});
	assert.equal((await b.queue()).filter(row => row.visual_identity).length, 1, 'nothing more to ask');
	// A later publication re-assembles the graph; the reviewed relation is carried, not rebuilt from claims.
	const again = await claimDetail(b, 'tower');
	await b.publish(again, delta([{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], properties: {}}]));
	assert.deepEqual((await b.graph()).regionCorrespondence((await b.graph()).nodes.get(MAP_B.node_id), survivor), {'inn-b': 'inn'});
});

test('§152.4 survivor walk: follows variant-of between printed visuals only, composes correspondences, and survives a cycle', () => {
	const node = (id, kind = 'handout') => ({node_id: id, node_kind: kind, name: id, properties: {}});
	const rel = (from, to, correspondence) => ({relation_id: `rel-${from}-${to}`, relation_kind: 'variant-of', from_node_id: from, to_node_id: to,
		properties: correspondence ? {region_correspondence: correspondence} : {}});
	const chain = new api.ModuleGraph('book', {nodes: [node('handout-a'), node('handout-b'), node('asset-c', 'asset'), node('npc-d', 'npc'), node('npc-e', 'npc'), node('handout-f')],
		relations: [rel('handout-b', 'asset-c', {x: 'y'}), rel('asset-c', 'handout-a', {y: 'z', w: 'v'}), rel('npc-e', 'npc-d'), rel('handout-f', 'npc-d')]}, '', {});
	assert.equal(chain.isVariant(chain.nodes.get('handout-f')), false, 'a print is a variant only of another print');
	assert.equal(chain.survivorOf(chain.nodes.get('handout-b')).node_id, 'handout-a');
	assert.deepEqual(chain.regionCorrespondence(chain.nodes.get('handout-b'), chain.nodes.get('handout-a')), {x: 'z'});
	assert.deepEqual(chain.regionCorrespondence(chain.nodes.get('handout-a'), chain.nodes.get('handout-a')), {});
	assert.equal(chain.isVariant(chain.nodes.get('npc-e')), false, 'a person is not a printed visual');
	assert.equal(chain.survivorHandle('b'), 'a');
	assert.deepEqual(chain.shownThroughSurvivors(['b', 'a', 'unknown-handle']), ['a', 'unknown-handle']);
	const cycle = new api.ModuleGraph('book', {nodes: [node('handout-a'), node('handout-b'), node('handout-c')],
		relations: [rel('handout-c', 'handout-b'), rel('handout-b', 'handout-a'), rel('handout-a', 'handout-b')]}, '', {});
	for (const id of ['handout-a', 'handout-b', 'handout-c']) assert.equal(cycle.survivorOf(cycle.nodes.get(id)).node_id, 'handout-a');
	assert.equal(cycle.isVariant(cycle.nodes.get('handout-a')), false, 'a cycle still leaves one survivor');
});

/** Handout cards of one print: the reader gave the clipping two nodes, as Dust to Dust did for newspaper cards 1-5. */
const CARD_A = {node_id: 'handout-harbor-advertiser-2', node_kind: 'handout', name: 'Harbor Advertiser, second clipping', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.47, 0.385, 0.99, 0.915]}], authored_text: 'The watchman saw nothing unusual.'}};
const CARD_B = {node_id: 'handout-card-2-harbor-robbery', node_kind: 'handout', name: 'Card 2: the harbor robbery', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.5, 0.44, 0.975, 0.9]}], authored_text: 'The watchman saw nothing unusual that night.'}};

test('§152.4 handouts: a variant is handed over as its survivor, and a handout shown under the variant counts as shown for it', async () => {
	const b = await book('handouts');
	const kernel = (method, params = {}) => b.kernel(method, {campaign: 'c1', ...params});
	const [, saved] = [await b.kernel('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'}),
		await b.kernel('investigator.save', {campaign: 'card-source'})];
	await b.kernel('campaign.create', {id: 'c1', module: b.mid, play_language: 'en'});
	await kernel('investigator.load', {library_id: saved.library_id});
	await kernel('setup.complete');
	await kernel('table.open');
	await kernel('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
	await kernel('table.player_input', {text: 'I read the papers.'});
	// Both cards published a generation apart, before this change could ask; the table was handed the later one.
	const both = await claimDetail(b, 'harbor papers', 'c1');
	await b.publish(both, delta([CARD_A, CARD_B], [], [CARD_A.node_id]), {campaign: 'c1'});
	const later = await claimDetail(b, 'harbor robbery', 'c1');
	await b.publish(later, delta([CARD_B]), {campaign: 'c1'});
	const shown = await kernel('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: CARD_B.name, why: 'The clipping is handed over.'}]});
	assert.ok(shown.receipts.some(id => id.startsWith('handout:card-2-harbor-robbery-')), 'before the verdict each node stands for itself');
	// The reviewer finds one print; the campaign's module records the later card as a variant of the earlier one.
	await b.call('module.read.ahead', {campaign: 'c1'});
	const job = await claimIdentity(b, 'c1');
	assert.equal(job.visual_identity.pairs.length, 1);
	const host = service(b, {author() { throw new Error('no author'); }, identity: same, campaign: 'c1'});
	await host.run(job);
	const graph = await b.graph('c1');
	assert.equal(graph.survivorOf(graph.nodes.get(CARD_B.node_id)).node_id, CARD_A.node_id);

	await kernel('table.narrate', {call_id: 't1-c2', text: 'The clipping is in your hands.'});
	await kernel('table.player_input', {text: 'I read it again, and ask for the robbery card.'});
	const again = await kernel('table.apply', {call_id: 't2-c1', effects: [{kind: 'handout', name: CARD_B.name, why: 'The card is handed over again.'}]});
	assert.deepEqual(again.receipts.filter(id => id.startsWith('handout:')), ['handout:harbor-advertiser-2-t2'], 'the variant is handed over as its survivor');
	const world = JSON.parse(await readFile(join(b.workspace, '.coc/campaigns/c1/world.json'), 'utf8'));
	assert.ok(world.handouts_shown.includes('card-2-harbor-robbery'), 'what the table was handed stays recorded under its handle');
	assert.deepEqual(graph.shownThroughSurvivors(world.handouts_shown), ['harbor-advertiser-2'], 'membership is read through the survivor');
	// The board's list of held documents: one entry for the one print.
	const turns = join(b.workspace, '.coc/campaigns/c1/turns'), receipts = [];
	for (const name of (await readdir(turns)).filter(file => file.endsWith('.json')).sort())
		receipts.push(...(JSON.parse(await readFile(join(turns, name), 'utf8')).receipts ?? []));
	const held = await api.heldHandouts(join(b.workspace, '.coc/campaigns/c1'), world.handouts_shown, receipts, graph);
	assert.deepEqual(held.map(row => row.handout), ['harbor-advertiser-2']);
	assert.match(held[0].text, /watchman/);
	const onlyVariant = await api.heldHandouts(join(b.workspace, '.coc/campaigns/c1'), ['card-2-harbor-robbery'], receipts, graph);
	assert.deepEqual(onlyVariant.map(row => [row.handout, row.text]), [['harbor-advertiser-2', 'The watchman saw nothing unusual that night.']],
		'shown only under the variant, it is held as the survivor with the document the table was handed');
	// A name only the variant and its survivor share is the survivor, not an ambiguity.
	const shared = {...CARD_B, name: CARD_A.name};
	const onlyShared = new api.ModuleGraph(b.mid, {...graph.raw, nodes: graph.raw.nodes.map(node => node.node_id === CARD_B.node_id ? shared : node)}, '', {});
	assert.equal(api.handoutNode(onlyShared, CARD_A.name).node_id, CARD_A.node_id);
});
