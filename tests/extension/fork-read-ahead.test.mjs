import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §151.4 against §22.3.3 and the campaign fork: the read-ahead streams a book's source units in the background,
 * at most two in flight, and it must know which units are already read. A campaign's fork starts with an empty queue and
 * the library's material rows (`module.json`), so a unit read or settled in the library is known there only by its row.
 *
 * Found 2026-09-30: the read-ahead judged a unit "seen" from the queue alone. In a fork it asked the library's read units
 * again; each request answered `ready` (or `unusable`) from the material row and queued nothing, and still used up one of
 * the two asks of the pass. With the first units in order read in the library, the fork never reached the rest.
 *
 * These cases travel the kernel's own entry points: `module.read.request` and `module.read.ahead` queue, `module.read.claim`
 * and `module.read.finish` read, publish and refuse, and `campaign.create` plus a campaign-scoped `module.read.ahead` fork
 * the module. The host only relays the read-ahead (it calls `module.read.ahead` after every publication and when a table
 * opens); it takes no part in which unit is asked.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {KernelError} from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('fork-read-ahead', 'suite-', {retain: Boolean(process.env.KEEP_FORK_READ_AHEAD_EVIDENCE)});
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleStore} from './kernel-ts/modules/store.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'fork-read-ahead-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

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
	// The kernel never parses the PDF; it binds and hashes its bytes.
	const file = join(workspace, 'original.pdf'), bytes = Buffer.from(`%PDF-1.7\n${name} fork read-ahead fixture\n`);
	await writeFile(file, bytes);
	const sha = createHash('sha256').update(bytes).digest('hex');
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: pages, file_sha256: sha}});
	const all = Array.from({length: pages}, (_, index) => index + 1);
	const b = {workspace, mid, sha, kernel, pages: all};
	b.call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
	b.store = () => new api.ModuleStore(context);
	b.meta = () => b.store().module(mid).then(wire);
	b.queue = async () => JSON.parse(await readFile(join(b.store().moduleDir(mid), 'deepen-queue.json'), 'utf8'));
	b.claim = () => b.call('module.read.claim', {owner: 'test-host'});
	b.publish = async (job, draft) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: all, full_pages: all, review_pages: all});
		await save(join(job.work_dir, 'draft.json'), draft);
		const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
		await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json')});
	};
	/** What the host sends when its reviewer found a fact the cited page does not state (§22.3.3). */
	b.refuse = job => b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'failed', detail: 'refused at review', refusal: {
		message: 'visual review found /coverage unsupported (unsupported): the page does not say this', path: '/coverage',
		rule: 'review_unsupported', reason: 'reading_failed', refused: [{path: '/coverage', verdict: 'unsupported', reason: 'the page does not say this'}]}});
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
	/** The library's source units as its queue holds them: `[first page, state]` in queue order. */
	b.units = async () => (await b.queue()).filter(job => job.source_unit).map(job => [job.source_unit.first, job.state]);
	/** The campaign's fork of this module after `passes` campaign-scoped read-aheads: its source units, `[first page, state]`. */
	b.fork = async (campaign, passes = 2) => {
		for (let pass = 0; pass < passes; pass++) await kernel('module.read.ahead', {module_id: mid, campaign});
		const queue = JSON.parse(await readFile(join(workspace, '.coc/module-campaigns', campaign, 'modules', mid, 'deepen-queue.json'), 'utf8'));
		return queue.filter(job => job.source_unit).map(job => [job.source_unit.first, job.state]);
	};
	return b;
}

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
	await b.call('module.read.ahead', {focus: 'Harbor'});
	assert.deepEqual(await b.units(), [[3, 'queued'], [5, 'queued']], 'the units after the entry page are asked first, two in flight');
	return b;
}
const unitJob = async (b, first) => (await b.queue()).find(job => job.source_unit?.first === first && !job.review_retry);

test('§151.4 fork: units the library read are not asked again in a campaign fork, which streams the unit the library has not read', async () => {
	const b = await referenceBook('reference-read');
	for (const first of [3, 5]) {
		const {job_id} = await unitJob(b, first);
		await b.publish(await b.claimWhere(job => job.job_id === job_id), delta([], [], []));
	}
	await b.call('module.read.ahead', {focus: 'Harbor'});
	assert.deepEqual(await b.units(), [[3, 'completed'], [5, 'completed'], [1, 'queued']], 'the library streams unit 1-2 next');
	await b.kernel('campaign.create', {id: 'fork-read', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	assert.deepEqual(await b.fork('fork-read'), [[1, 'queued']], 'the fork asks unit 1-2 and not the units read before it was made');
});

test('§151.4 × §22.3.3 fork: units the library settled unusable are not asked again in a campaign fork, which streams the rest', async () => {
	const b = await referenceBook('reference-settled');
	// Both units are read, refused at review, read once more and refused again: each settles its focus unusable.
	const three = await unitJob(b, 3), five = await unitJob(b, 5);
	const reads = [await b.claimWhere(job => job.job_id === three.job_id), await b.claimWhere(job => job.job_id === five.job_id)];
	const retries = [];
	for (const read of reads) retries.push((await b.refuse(read)).requeued.job_id);
	for (const retry of retries) assert.equal((await b.refuse(await b.claimWhere(job => job.job_id === retry))).requeued, undefined, 'read once more, not twice');
	const settled = (await b.meta()).reading.materials.filter(row => row.status === 'unusable').map(row => row.focus);
	assert.deepEqual(settled, ['Original pages 3-4', 'Original pages 5-6']);
	await b.kernel('campaign.create', {id: 'fork-settled', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	assert.deepEqual(await b.fork('fork-settled'), [[1, 'queued']], 'the fork asks unit 1-2 and not the settled units');
});

test('§151.4 fork: under a first-interaction opening, the unit the library read is not asked again in a fork, which streams the next', async () => {
	const b = await book('first-interaction', 6);
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'The Harbor', language: 'en', map_candidates: [], sections: [
		{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Market']}, {name: 'Tower', pages: [[3, 4]], entities: ['Tower']}, {name: 'Cellar', pages: [[5, 6]], entities: ['Cellar']}]});
	assert.equal((await b.call('module.read.request', {purpose: 'opening', focus: 'Dock', opening_scope: 'first_interaction', foreground: true})).state, 'queued');
	await b.publish(await b.claim(), delta([
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-market', node_kind: 'scene', name: 'Market', source_refs: [{page: 2}], properties: {}}],
	[fact('scene-dock', 'route-to', 'scene-market')], ['scene-dock', 'scene-market'], {interaction_scene: 'scene-market'}));
	// One unit per pass, after the prepared encounter (page 2): Tower, then Cellar; Harbor comes last.
	await b.call('module.read.ahead', {focus: 'Dock'});
	const tower = (await b.queue()).find(job => job.source_unit?.first === 3);
	assert.ok(tower, 'the unit after the prepared encounter is asked first');
	await b.publish(await b.claimWhere(job => job.job_id === tower.job_id), delta([], [], []));
	await b.call('module.read.ahead', {focus: 'Dock'});
	assert.deepEqual(await b.units(), [[3, 'completed'], [5, 'queued']], 'the library streams unit 5-6 next');
	await b.kernel('campaign.create', {id: 'fork-first', module: b.mid, play_language: 'en'});
	// The fork has no job for 5-6 (the library's queued read is not the fork's), so two passes ask 5-6 and then 1-2.
	assert.deepEqual(await b.fork('fork-first', 2), [[5, 'queued'], [1, 'queued']], 'the fork skips unit 3-4, which the library read, and streams 5-6 and 1-2');
});

const NEED_Q = 'Any later appendix combat profile for Lena if printed separately';
test('§151.4 fork: a deferred need waits for the units no one has read, not for the units the library read; its packet lists only the unread', async () => {
	const b = await book('first-interaction-need', 6);
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'The Harbor', language: 'en', map_candidates: [], sections: [
		{name: 'Harbor', pages: [[1, 2]], entities: ['Dock', 'Market', 'Lena']}, {name: 'Tower', pages: [[3, 4]], entities: ['Tower']}, {name: 'Cellar', pages: [[5, 6]], entities: ['Cellar']}]});
	await b.call('module.read.request', {purpose: 'opening', focus: 'Dock', opening_scope: 'first_interaction', foreground: true});
	await b.publish(await b.claim(), delta([
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-market', node_kind: 'scene', name: 'Market', source_refs: [{page: 2}], properties: {}},
		{node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: REFS, properties: {}}],
	[fact('scene-dock', 'route-to', 'scene-market'), fact('npc-lena', 'present-in', 'scene-dock')], ['scene-dock', 'scene-market', 'npc-lena'], {interaction_scene: 'scene-market'}));
	// A detail reading of Lena retains one speculative (deferred) source need about her, cited on page 5.
	await b.call('module.read.request', {purpose: 'detail', focus: 'Lena', question: 'Prepare Lena for the conversation', foreground: true});
	await b.publish(await b.claimWhere(job => job.focus === 'Lena'), delta([{node_id: 'npc-lena', node_kind: 'npc', name: 'Lena', source_refs: REFS, properties: {}}], [], ['npc-lena'],
		{source_needs: [{kind: 'deferred', focus: 'Lena', question: NEED_Q, reason: 'Not printed on these pages.', trigger: 'If a fight with Lena starts.', source_refs: [{page: 5}]}]}));
	// The library reads its three units, one asked per pass; the deferred need waits until none is left unasked.
	for (const first of [3, 5, 1]) {
		await b.call('module.read.ahead', {focus: 'Dock'});
		const queue = await b.queue(), unit = queue.find(job => job.source_unit?.first === first);
		assert.ok(unit, `unit ${first} is asked`);
		assert.equal(queue.some(job => job.question === NEED_Q), first === 1, 'the deferred need is asked in the pass that asks the last unit, not before');
		await b.publish(await b.claimWhere(job => job.job_id === unit.job_id), delta([], [], []));
	}
	// The fork was made before the library's need read landed: the need is the fork's to ask, and every unit is already read.
	await b.kernel('campaign.create', {id: 'fork-need', module: b.mid, play_language: 'en'});
	assert.deepEqual(await b.fork('fork-need', 2), [], 'the fork asks none of the units the library read');
	const forkQueue = JSON.parse(await readFile(join(b.workspace, '.coc/module-campaigns/fork-need/modules', b.mid, 'deepen-queue.json'), 'utf8'));
	const need = forkQueue.find(job => job.question === NEED_Q);
	assert.ok(need?.source_need, 'the fork asks the deferred need: no unit is left unread');
	const claimed = await b.kernel('module.read.claim', {module_id: b.mid, campaign: 'fork-need', owner: 'test-host'});
	const packet = claimed.job_id === need.job_id ? claimed : undefined;
	assert.ok(packet, `the fork's first claim is its need read (${claimed.job_id}, ${claimed.focus})`);
	assert.deepEqual(packet.source_need.unread_units, [], 'its packet lists no unit as unread: the library read all three');
	// Its reader settles the need as carried by unit 5-6 anyway. That unit was read before the fork, so the need is asked again.
	const cellar = (await b.queue()).find(job => job.source_unit?.first === 5).source_unit;
	const settled = await b.kernel('module.read.finish', {module_id: b.mid, campaign: 'fork-need', job_id: packet.job_id, lease: packet.lease, outcome: 'settled',
		need: {disposition: 'carried', units: [cellar], evidence: {need_leads: [{page: 5, score: 0.8}], accepted_pages: [1]}}});
	assert.equal(settled.source_need?.disposition, 'carried');
	await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'fork-need'});
	const asked = JSON.parse(await readFile(join(b.workspace, '.coc/module-campaigns/fork-need/modules', b.mid, 'deepen-queue.json'), 'utf8'))
		.filter(job => job.question === NEED_Q).map(job => job.state);
	assert.deepEqual(asked, ['completed', 'queued'], 'the unit that carries it is already read: the need is eligible again and read afresh');
});
