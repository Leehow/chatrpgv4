/**
 * Contract §22.3.3 (SL-57) against §152.1, §151.4 and §152.4: a reading refused at review for an unsupported fact is read
 * once more with the reviewer's reasons, and that retry is the same reading. Every marker that bounds the refused job
 * travels with it: `visual_asset`, `visual_scan`, `visual_identity`, `source_unit` with `review_scope_pages` and
 * `reference_fragment`, and `source_need`.
 *
 * Found 2026-09-30 while the §39.4 map_scope backfill job was built: the retry line listed its fields by hand and carried
 * none of the markers, so a refused visual-asset reading was read once more as an ordinary detail reading of the words
 * "Visual assets on physical page 1". Its reader lost the page-bounded asset instructions and its publication lost the
 * page it had prepared.
 *
 * These cases travel the real path: a kernel runtime over a bound PDF, `module.read.request` / `module.read.ahead` doing
 * the queueing (the read-ahead's own requests go through the same `request`), `module.read.finish` doing the refusing and
 * the publishing, and, for the visual asset, the host's ReadingService with its reader and reviewer children played by a
 * fixture runtime.
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

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const evidence = join(ROOT, '.coc/playtests/review-retry-markers');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleStore} from './kernel-ts/modules/store.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'review-retry-markers-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); await closeSourceDocuments(); if (!process.env.KEEP_RETRY_MARKER_EVIDENCE) await rm(directory, {recursive: true, force: true}); });

/** A renderable PDF of `count` pages, each a different flat colour. */
function pdf(count) {
	const streams = Array.from({length: count}, (_, index) => `${(index % 3) / 2} 0.5 ${1 - (index % 2)} rg 0 0 200 100 re f`);
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
const delta = (nodes, claims = [], ready = nodes.map(node => node.node_id), extra = {}) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready, ...extra});
const fact = (subject_id, predicate, node_id, source_refs = REFS) => ({subject_id, predicate, object: {node_id}, truth_status: 'authored-fact', source_refs});

/** A bound PDF of `pages` pages on a kernel runtime; `publish` plays a host reader and a reviewer that supports every path. */
async function book(name, pages) {
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
	await writeFile(file, pdf(pages));
	const sha = createHash('sha256').update(await readFile(file)).digest('hex');
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: pages, file_sha256: sha}});
	const all = Array.from({length: pages}, (_, index) => index + 1);
	const b = {workspace, mid, sha, kernel, pages: all};
	b.call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
	b.store = () => new api.ModuleStore(context);
	b.meta = () => b.store().module(mid).then(wire);
	b.queue = async () => { try { return JSON.parse(await readFile(join(b.store().moduleDir(mid), 'deepen-queue.json'), 'utf8')); } catch { return []; } };
	b.claim = () => b.call('module.read.claim', {owner: 'test-host'});
	b.publish = async (job, draft, extra = {}) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: all, full_pages: all, review_pages: all, ...extra});
		await save(join(job.work_dir, 'draft.json'), draft);
		const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
		await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json')});
	};
	/** What the host sends when its reviewer found a fact the cited page does not state (§22.3.3). */
	b.refuse = job => b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: 'refused at review', refusal: {
		message: 'visual review found /nodes/0/summary unsupported (unsupported): the page does not say this', path: '/nodes/0/summary',
		rule: 'review_unsupported', reason: 'reading_failed', refused: [{path: '/nodes/0/summary', verdict: 'unsupported', reason: 'the page does not say this'}]}});
	/** The next claim that is `wanted`; a reading claimed before it gives its slot back unread. */
	b.claimWhere = async wanted => {
		for (let tries = 0; tries < 8; tries++) {
			const job = await b.claim();
			assert.ok(job.job_id, 'the wanted reading was queued');
			if (wanted(job)) return job;
			await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'cancelled'});
		}
		throw new Error('the wanted reading was never claimed');
	};
	/** The published index and opening: a Dock (entrance) and a Tower, with `extra` nodes beside them. */
	b.open = async ({sections, nodes = [], claims = []}) => {
		await b.call('module.read.request', {purpose: 'index'});
		await b.publish(await b.claim(), {title: 'The Harbor', language: 'en', sections, map_candidates: []});
		await b.call('module.read.request', {purpose: 'opening'});
		const opened = await b.publish(await b.claim(), delta([
			{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
			{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.', properties: {is_final: true}},
			...nodes], [fact('scene-dock', 'route-to', 'scene-tower'), ...claims], ['scene-dock', ...nodes.map(node => node.node_id)]));
		assert.equal(opened.opening_ready, true);
	};
	return b;
}

/**
 * What a job is, as `request` queued it: every field but its place in the queue, its clock and its attempt. The retry is
 * that reading again, so each of these fields must come back unchanged.
 */
const QUEUE_PLACE = new Set(['job_id', 'state', 'attempts', 'at', 'class_at', 'foreground']);
function assertSameReading(retry, queued, failed) {
	assert.ok(retry, 'the refused reading is read once more');
	assert.equal(retry.review_retry?.of, failed.job_id);
	assert.deepEqual([retry.state, retry.foreground], ['queued', false], 'a background retry');
	for (const [field, value] of Object.entries(queued))
		if (!QUEUE_PLACE.has(field)) assert.deepEqual(retry[field], value, `the retry carries ${field} of the reading it repeats`);
}
/** Refuses `job` at review and returns the retry the kernel queued for it, with the queue row the job was queued as. */
async function refusedOnce(b, job, queued) {
	const refused = await b.refuse(job);
	assert.deepEqual([refused.state, refused.requeued?.reason], ['failed', 'review_refused']);
	const retry = (await b.queue()).find(row => row.job_id === refused.requeued.job_id);
	assertSameReading(retry, queued, job);
	return retry;
}

const SCAN_Q = 'Inspect the assigned contact sheet and nominate candidate pages only.';
const ASSET_Q = 'Prepare the visual assets on this nominated original page and their necessary identity links.';
/** A harbor notice printed on page 1: the one asset its visual-asset reading prepares. */
const NOTICE = {node_id: 'asset-harbor-notice', node_kind: 'asset', name: 'Harbor notice', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.05, 0.05, 0.45, 0.5]}]}};

/** The two-page harbor with page 1 nominated as a visual candidate by a published §152.1 visual scan. */
async function nominated(name) {
	const b = await book(name, 2);
	await b.open({sections: [{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Tower']}]});
	await b.call('module.read.request', {purpose: 'detail', focus: 'Visual assets pages 1-2', question: SCAN_Q, visual_scan: {first: 1, last: 2}});
	const scan = await b.claimWhere(job => job.visual_scan);
	const published = await b.publish(scan, delta([], [], [], {visual_candidates: [{page: 1, kind: 'handout', label: 'Harbor notice'}]}), {overview_pages: [1, 2]});
	assert.equal(published.visual_navigation, true);
	return b;
}

/**
 * The host ReadingService over the real kernel, with a fixture runtime playing its children: `author(round, task,
 * findings)` writes the reader's draft; `review(paths)` answers each review unit.
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
			await save(join(request.cwd, 'review.json'), {checked: review(task.required_review), missing: []});
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

test('§22.3.3 × §152.1: a visual-asset reading refused at review is read once more as the same page-bounded asset reading, and publishes that page', async () => {
	const b = await nominated('visual-asset');
	const asked = await b.call('module.read.request', {purpose: 'detail', focus: 'Visual assets on physical page 1', question: ASSET_Q, visual_asset: {page: 1}});
	assert.equal(asked.state, 'queued');
	const queued = (await b.queue()).find(row => row.job_id === asked.job_id);
	assert.deepEqual(queued.visual_asset, {page: 1});
	const job = await b.claimWhere(row => row.job_id === asked.job_id);
	// The reviewer finds the notice's page reference unsupported, in both rounds of the first attempt; the retry is supported.
	let refusing = true;
	const host = service(b, {author: () => delta([NOTICE], [fact(NOTICE.node_id, 'depicts', 'scene-dock')]), review: paths => {
		const refused = refusing ? paths.filter(path => path.startsWith('/nodes/0')) : [];
		return [{paths: paths.filter(path => !refused.includes(path)), verdict: 'supported', source_refs: REFS, reason: 'Compared on the original page.'},
			...(refused.length ? [{paths: refused, verdict: 'unsupported', impact: 'logic', source_refs: REFS, reason: 'Page 1 prints a tide table, not a notice.'}] : [])]
			.filter(row => row.paths.length);
	}});
	await host.run(job);
	const failed = (await b.queue()).find(row => row.job_id === job.job_id);
	assert.deepEqual([failed.state, failed.refusal?.rule], ['failed', 'review_unsupported'], JSON.stringify(failed.refusal));
	const retry = (await b.queue()).find(row => row.review_retry?.of === job.job_id);
	assertSameReading(retry, queued, job);

	// The retry is claimed and read as an asset reading of that page, with the reviewer's reasons.
	refusing = false;
	const again = await b.claimWhere(row => row.job_id === retry.job_id);
	await host.run(again);
	const read = host.runs.reads.at(-1);
	assert.deepEqual(read.task.visual_asset, {page: 1}, "the retry's task is bounded to the nominated page");
	assert.equal(read.prompt.visual, 'asset', 'the retry reader runs under the visual-asset instructions');
	assert.deepEqual(read.task.review_retry.refused.map(row => row.verdict), ['unsupported'], "with the reviewer's reasons");
	assert.equal((await b.queue()).find(row => row.job_id === retry.job_id).state, 'completed');
	const material = (await b.meta()).reading.materials.find(row => row.key === retry.key);
	assert.deepEqual([material?.visual_asset, material?.node_ids], [{page: 1}, [NOTICE.node_id]], 'its publication records the page it prepared');
});

test('§22.3.3 × §152.1: a refused visual scan is read once more as the same scan of the same range', async () => {
	const b = await book('visual-scan', 2);
	await b.open({sections: [{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Tower']}]});
	const asked = await b.call('module.read.request', {purpose: 'detail', focus: 'Visual assets pages 1-2', question: SCAN_Q, visual_scan: {first: 1, last: 2}});
	const queued = (await b.queue()).find(row => row.job_id === asked.job_id);
	const retry = await refusedOnce(b, await b.claimWhere(row => row.job_id === asked.job_id), queued);
	assert.deepEqual(retry.visual_scan, {first: 1, last: 2});
	const again = await b.claimWhere(row => row.job_id === retry.job_id);
	assert.deepEqual(again.visual_scan, {first: 1, last: 2}, "the retry's packet is a scan of the range");
});

/** One village map on page 1, drafted twice: a graph that already holds a colliding pair with no verdict (§152.4). */
const region = (id, box, asset) => ({region_id: id, name: id, source_asset: asset, source_box: box, placement: box});
const MAP_A = {node_id: 'asset-map-harbor-village', node_kind: 'asset', name: 'Harbor village', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.05, 0.05, 0.95, 0.52]}], map_scope: 'area', map_regions: [region('inn', [0.1, 0.1, 0.3, 0.3], 'asset-map-harbor-village')]}};
const MAP_B = {node_id: 'asset-harbor-village-map', node_kind: 'asset', name: 'Harbor village map', visibility: 'player-safe', source_refs: REFS,
	properties: {image_sources: [{page: 1, box: [0.08, 0.03, 0.92, 0.48]}], map_scope: 'area', map_regions: [region('inn-b', [0.12, 0.15, 0.32, 0.4], 'asset-harbor-village-map')]}};

test('§22.3.3 × §152.4: a refused identity reading is read once more as the identity question of the same page and pairs', async () => {
	const b = await book('visual-identity', 2);
	await b.open({sections: [{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Tower']}]});
	// One reading drafted both crops with only the first ready; a later reading made the second ready.
	await b.call('module.read.request', {purpose: 'detail', focus: 'harbor village', question: 'Prepare the harbor village', foreground: true});
	await b.publish(await b.claimWhere(row => row.focus === 'harbor village'), delta([MAP_A, MAP_B], [fact(MAP_A.node_id, 'depicts', 'scene-dock')], [MAP_A.node_id]));
	await b.call('module.read.request', {purpose: 'detail', focus: 'harbor map', question: 'Prepare the harbor map', foreground: true});
	await b.publish(await b.claimWhere(row => row.focus === 'harbor map'), delta([MAP_B], [fact(MAP_B.node_id, 'depicts', 'scene-dock')]));
	await b.call('module.read.ahead', {});
	const queued = (await b.queue()).find(row => row.visual_identity);
	assert.equal(queued?.visual_identity.page, 1, 'the read-ahead asks the pair of page 1');
	const retry = await refusedOnce(b, await b.claimWhere(row => row.job_id === queued.job_id), queued);
	assert.deepEqual(retry.visual_identity, queued.visual_identity);
	const again = await b.claimWhere(row => row.job_id === retry.job_id);
	assert.deepEqual([again.visual_identity?.page, again.visual_identity?.pairs.map(pair => [pair.earlier.node_id, pair.later.node_id])],
		[1, [[MAP_A.node_id, MAP_B.node_id]]], "the retry's packet asks the identity question of the page's pair, not a reader for a draft");
});

/** The fast reference path (§151.4) over six pages: published guidance and an original-context entry on page 3, and no graph yet. */
async function referenceBook(name) {
	const b = await book(name, 6);
	const dir = join(b.store().moduleDir(b.mid), 'work', 'source-reference-fixture');
	await mkdir(dir, {recursive: true});
	const sha = value => createHash('sha256').update(value).digest('hex');
	const text = 'Harbor in 1925. Choose your own investigator.', span = {id: 'p3-0-43', page: 3, start: 0, end: text.length, text};
	const packet = {protocol: 'source-reference-v1', source_sha256: b.sha, extraction_version: 'fixture', purpose: 'guidance', question: 'Start', excerpts: [span],
		fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, [span.id]])),
		entries: [{id: 'scene-source-entry-3', name: 'Harbor', page: 3}], partial: true, visual_coverage: 'unassessed', unavailable_pages: []};
	const task = JSON.stringify({purpose: 'guidance', source_reference: 'guidance'}), body = JSON.stringify(packet);
	await writeFile(join(dir, 'task.json'), task);
	await writeFile(join(dir, 'source-reference.json'), body);
	await writeFile(join(dir, 'reference-guidance.txt'), text);
	const public_fields = Object.fromEntries(['era', 'starting_place', 'public_premise', 'creation_advice'].map(key => [key, {status: 'value', text, source_refs: [{page: 3}]}]));
	const checks = Object.fromEntries(['wrong_orientation', 'card_restriction', 'advice_omission', 'warning_omission', 'plot_disclosure', 'causal_conflict']
		.map(key => [key, {status: 'answered', type: 'noul', noul: 0}]));
	await writeFile(join(dir, 'source-reference-complete.json'), JSON.stringify({protocol: 'source-reference-v1', kind: 'guidance', source_sha256: b.sha,
		task_sha256: sha(task), packet_sha256: sha(body), text_sha256: sha(text), checks_policy: 'material-issues-v1', checks, public_fields}));
	assert.equal((await b.call('module.reference.publish', {work_dir: dir, guidance_key: 'd'.repeat(64), play_language: 'en'})).setup_ready, true);
	return b;
}

test('§22.3.3 × §151.4: a refused reference fragment is read once more as the same unit of the same pages', async () => {
	const b = await referenceBook('reference-fragment');
	await b.call('module.read.ahead', {focus: 'Harbor'});
	const queued = (await b.queue()).find(row => row.reference_fragment);
	assert.deepEqual([queued?.source_unit.first, queued?.source_unit.last, queued?.review_scope_pages], [3, 4, [3, 4]]);
	const retry = await refusedOnce(b, await b.claimWhere(row => row.job_id === queued.job_id), queued);
	assert.deepEqual([retry.source_unit, retry.review_scope_pages, retry.reference_fragment], [queued.source_unit, [3, 4], true]);
	// Units 3-4 (the retry) and 5-6 are in flight; unit 1-2 waits for one of them to settle.
	await b.call('module.read.ahead', {focus: 'Harbor'});
	const units = (await b.queue()).filter(row => row.source_unit && ['queued', 'running'].includes(row.state));
	assert.deepEqual(units.map(row => [row.source_unit.first, row.job_id === retry.job_id]).sort(), [[3, true], [5, false]],
		'the read-ahead counts the retry among its two units in flight and queues no third');
});

test("§22.3.3 × §152.1: a visual-asset page settled unusable counts as prepared, so a campaign fork's read-ahead asks the pages after it", async () => {
	const b = await referenceBook('asset-settled');
	/** The next claim that is `wanted`, asking the read-ahead first: it asks again for a page whose reading was cancelled unread. */
	const claimAhead = async wanted => {
		for (let tries = 0; tries < 12; tries++) {
			await b.call('module.read.ahead', {focus: 'Harbor'});
			const job = await b.claim();
			if (!job.job_id) continue;
			if (wanted(job)) return job;
			await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'cancelled'});
		}
		throw new Error('the wanted reading was never claimed');
	};
	const scan = await claimAhead(job => job.visual_scan);
	await b.publish(scan, delta([], [], [], {visual_candidates: [1, 2, 3].map(page => ({page, kind: 'map', label: `Plan ${page}`}))}), {overview_pages: b.pages});
	// Pages 1 and 2 are each refused at review twice: read once more, then settled.
	for (const page of [1, 2]) {
		const {requeued} = await b.refuse(await claimAhead(row => row.visual_asset?.page === page && !row.review_retry));
		const settled = await b.refuse(await claimAhead(row => row.job_id === requeued.job_id));
		assert.equal(settled.requeued, undefined, 'read once more, not twice');
	}
	const unusable = (await b.meta()).reading.materials.filter(row => row.status === 'unusable');
	assert.deepEqual(unusable.map(row => row.visual_asset), [{page: 1}, {page: 2}], 'each settlement records the page it could not prepare');
	// A campaign's fork starts with an empty queue and the library's materials: only the settlements say pages 1 and 2 are done.
	await b.kernel('campaign.create', {id: 'fork-camp', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'fork-camp'});
	const fork = JSON.parse(await readFile(join(b.workspace, '.coc/module-campaigns/fork-camp/modules', b.mid, 'deepen-queue.json'), 'utf8'));
	assert.deepEqual(fork.filter(row => row.visual_asset).map(row => [row.visual_asset.page, row.state]), [[3, 'queued']],
		"the fork's read-ahead asks page 3 instead of spending both of its asks on the settled pages");
});

const NEED_Q = 'Any later appendix combat profile for Lena if printed separately';
test('§22.3.3 × §151.4: a refused need read is read once more as the same need read, and its publication records the need as read', async () => {
	const b = await book('source-need', 4);
	await b.open({sections: [{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Lena']}, {name: 'Tower', pages: [[3, 4]], entities: ['Tower']}],
		nodes: [{node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: REFS, properties: {}}], claims: [fact('npc-lena', 'present-in', 'scene-dock')]});
	// A detail reading of Lena retains one speculative (deferred) source need about her, cited on page 3.
	await b.call('module.read.request', {purpose: 'detail', focus: 'Lena', question: 'Prepare Lena for the conversation', foreground: true});
	await b.publish(await b.claimWhere(row => row.focus === 'Lena'), delta([{node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: REFS, properties: {}}], [], ['npc-lena'],
		{source_needs: [{kind: 'deferred', focus: 'Lena', question: NEED_Q, reason: 'Not printed on these pages.', trigger: 'If a fight with Lena starts.', source_refs: [{page: 3}]}]}));
	await b.call('module.read.ahead', {});
	const queued = (await b.queue()).find(row => row.question === NEED_Q);
	assert.ok(queued?.source_need?.key, 'the read-ahead marks a need-driven read');
	const retry = await refusedOnce(b, await b.claimWhere(row => row.job_id === queued.job_id), queued);
	assert.deepEqual(retry.source_need, queued.source_need);
	const again = await b.claimWhere(row => row.job_id === retry.job_id);
	assert.equal(again.source_need?.key, queued.source_need.key, "the retry's packet carries the need it reads for");
	await b.publish(again, delta([{node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: [{page: 3}], properties: {}}], [], ['npc-lena'], {source_needs: []}));
	const record = (await b.meta()).reading.source_need_dispositions?.[queued.source_need.key];
	assert.deepEqual([record?.disposition, record?.job_id], ['read', retry.job_id], 'the need is recorded as read by the retry');
});
