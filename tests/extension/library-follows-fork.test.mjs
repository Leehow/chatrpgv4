import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §179.1 (amends §22.6 and §151.4's fork note): the library follows the leading fork. A campaign's fork of a book
 * accumulates accepted readings; before this rule none of them flowed back to the shared library, so every new campaign
 * read the whole book again (2026-10-04: five tables of one 111-page book, 96.6% of the uncached tokens in the reading lane).
 *
 * These cases travel the kernel's own entry points: `campaign.create` and a campaign-scoped `module.read.ahead` fork the
 * module, `module.read.claim` / `module.read.finish` read and publish, `module.reference.materialize` publishes a source
 * place, and `module.read.request` answers from the material rows. The library's adoption happens inside the fork's own
 * finish; its outcome rides on the result as `library_sync`.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {KernelError} from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('library-follows-fork', 'suite-', {retain: Boolean(process.env.KEEP_LIBRARY_FOLLOWS_EVIDENCE)});
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'library-follows-fork-api.ts', loader: 'ts'},
	outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

const save = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const REFS = [{page: 1}];
const delta = (nodes = [], claims = [], ready = nodes.map(node => node.node_id)) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready});

/** Every file under `path` by its bytes: what "the library is unchanged" means. */
async function treeDigest(path, prefix = '') {
	const out = {};
	for (const entry of await readdir(path, {withFileTypes: true})) {
		const name = join(prefix, entry.name), full = join(path, entry.name);
		if (entry.isDirectory()) Object.assign(out, await treeDigest(full, name));
		else if (!entry.name.endsWith('.lock')) out[name] = sha(await readFile(full));
	}
	return out;
}

/**
 * A six-page PDF bound in the shared library with the fast reference path published there (§151.4): guidance and one
 * original-context entrance on page 3, a library graph of one generation, and no reading queued in the library.
 */
async function library(name) {
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
	const file = join(workspace, 'original.pdf'), bytes = Buffer.from(`%PDF-1.7\n${name} library follows fork fixture\n`);
	await writeFile(file, bytes);
	const source = sha(bytes), pages = [1, 2, 3, 4, 5, 6];
	const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: pages.length, file_sha256: source}});
	const b = {workspace, mid, kernel};
	b.call = (method, params = {}, campaign) => kernel(method, {module_id: mid, ...params, ...(campaign ? {campaign} : {})});
	b.dir = campaign => campaign ? join(workspace, '.coc/module-campaigns', campaign, 'modules', mid) : join(workspace, '.coc/modules', mid);
	b.meta = async campaign => JSON.parse(await readFile(join(b.dir(campaign), 'module.json'), 'utf8'));
	b.queue = async campaign => JSON.parse(await readFile(join(b.dir(campaign), 'deepen-queue.json'), 'utf8'));
	b.graph = async campaign => JSON.parse(await readFile(join(b.dir(campaign), (await b.meta(campaign)).graph_file), 'utf8'));
	/** The next claim in this scope that is `wanted`; a reading claimed before it gives its slot back unread. */
	b.claimWhere = async (campaign, wanted) => {
		for (let tries = 0; tries < 8; tries++) {
			const job = await b.call('module.read.claim', {owner: 'test-host'}, campaign);
			assert.ok(job.job_id, 'the wanted reading was queued');
			if (wanted(job)) return job;
			await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'cancelled'}, campaign);
		}
		throw new Error('the wanted reading was never claimed');
	};
	/** A host reader and a reviewer that supports every path. */
	b.publish = async (campaign, job, draft) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: source, read_pages: pages, full_pages: pages, review_pages: pages});
		await save(join(job.work_dir, 'draft.json'), draft);
		const checked = (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
		await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json')}, campaign);
	};
	/** A host consultation reader and its independent reviewer, both on the cited page (§22.4). */
	b.answer = async (campaign, job, answer) => {
		const pagesRead = answer.source_refs.map(ref => ref.page), draft = join(job.work_dir, 'draft.json'), review = join(job.work_dir, 'review.json');
		await save(draft, answer);
		await save(review, {draft_sha256: sha(await readFile(draft)), checked: [{paths: ['/status', '/answer', '/source_refs', '/limitations'], verdict: 'supported',
			source_refs: answer.source_refs, reason: 'The original page supports the answer and its limitation.'}], missing: []});
		await save(join(job.work_dir, 'observations.json'), {file_sha256: source, read_pages: pagesRead, full_pages: [], review_pages: pagesRead});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: draft, review_path: review}, campaign);
	};
	/** The campaign's source units after `passes` campaign-scoped read-aheads (the first one forks it): `[first page, state]`. */
	b.units = async (campaign, passes = 1) => {
		for (let pass = 0; pass < passes; pass++) await kernel('module.read.ahead', {module_id: mid, campaign});
		return (await b.queue(campaign)).filter(job => job.source_unit).map(job => [job.source_unit.first, job.state]);
	};
	// The fast reference path, published in the library (as setup does before any campaign exists).
	const work = join(b.dir(), 'work', 'source-reference-fixture');
	await mkdir(work, {recursive: true});
	const text = 'Harbor in 1925. Choose your own investigator.', span = {id: 'p3-0-43', page: 3, start: 0, end: text.length, text};
	const packet = {protocol: 'source-reference-v1', source_sha256: source, extraction_version: 'fixture', purpose: 'guidance', question: 'Start', excerpts: [span],
		fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, [span.id]])),
		entries: [{id: 'scene-source-entry-3', name: 'Harbor', page: 3}], partial: true, visual_coverage: 'unassessed', unavailable_pages: []};
	const task = JSON.stringify({purpose: 'guidance', source_reference: 'guidance'}), body = JSON.stringify(packet);
	await save(join(work, 'task.json'), task);
	await save(join(work, 'source-reference.json'), body);
	await save(join(work, 'reference-guidance.txt'), text);
	const public_fields = Object.fromEntries(['era', 'starting_place', 'public_premise', 'creation_advice'].map(key => [key, {status: 'value', text, source_refs: [{page: 3}]}]));
	const checks = Object.fromEntries(['wrong_orientation', 'card_restriction', 'advice_omission', 'warning_omission', 'plot_disclosure', 'causal_conflict']
		.map(key => [key, {status: 'answered', type: 'noul', noul: 0}]));
	await save(join(work, 'source-reference-complete.json'), {protocol: 'source-reference-v1', kind: 'guidance', source_sha256: source,
		task_sha256: sha(task), packet_sha256: sha(body), text_sha256: sha(text), checks_policy: 'material-issues-v1', checks, public_fields});
	assert.equal((await b.call('module.reference.publish', {work_dir: work, guidance_key: 'd'.repeat(64), play_language: 'en'})).setup_ready, true);
	/** A source place the host's excerpt reader found on `page`, staged in the scope's own work directory for `module.reference.materialize`. */
	b.place = async (campaign, page, name) => {
		const placeWork = join(b.dir(campaign), 'work', `source-place-${page}`);
		await mkdir(placeWork, {recursive: true});
		const words = `${name} is below the harbor.`, excerpt = {id: `p${page}-0-${words.length}`, page, start: 0, end: words.length, text: words};
		const placePacket = JSON.stringify({protocol: 'source-reference-v1', source_sha256: source, extraction_version: 'fixture', purpose: 'lookup', question: `Read ${name}`,
			excerpts: [excerpt], fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, []])), entries: [],
			places: [{id: `scene-source-place-${page}-0`, name, page}], partial: true, visual_coverage: 'unassessed', unavailable_pages: []});
		const placeTask = JSON.stringify({purpose: 'lookup', materialize_place: true});
		await save(join(placeWork, 'task.json'), placeTask);
		await save(join(placeWork, 'source-reference.json'), placePacket);
		await save(join(placeWork, 'source-reference-complete.json'), {protocol: 'source-reference-v1', kind: 'excerpts', source_sha256: source,
			task_sha256: sha(placeTask), packet_sha256: sha(placePacket)});
		return b.call('module.reference.materialize', {work_dir: placeWork}, campaign);
	};
	return b;
}

test('§179.1: the library follows the leading fork; a campaign forked after it reads nothing the first read, and other lineages stay private', async () => {
	const b = await library('lead');
	const seeded = await b.meta(), seededGraph = await b.graph();
	for (const id of ['table-a', 'table-c']) await b.kernel('campaign.create', {id, module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	// C forks first, from the library generation every fork so far was seeded from; A forks from the same one.
	assert.deepEqual(await b.units('table-c'), [[3, 'queued'], [5, 'queued']]);
	assert.deepEqual(await b.units('table-a'), [[3, 'queued'], [5, 'queued']]);
	assert.equal((await b.meta('table-c')).source_generation, seeded.generation);

	// A reads unit 3-4 and publishes first: the library adopts it as one new library generation.
	const readA = await b.claimWhere('table-a', job => job.source_unit?.first === 3);
	const unit = (await b.queue('table-a')).find(job => job.job_id === readA.job_id);
	const libraryQueue = await b.queue();
	const publishedA = await b.publish('table-a', readA, delta());
	assert.deepEqual(publishedA.library_sync, {state: 'published', library_generation: seeded.generation + 1});
	const followed = await b.meta(), forkA = await b.meta('table-a');
	assert.equal(followed.generation, seeded.generation + 1);
	assert.ok(followed.reading.materials.some(row => row.key === unit.key), 'the library holds the unit A read');
	assert.deepEqual({campaign: followed.synced_from.campaign, fork_generation: followed.synced_from.fork_generation, library_generation: followed.synced_from.library_generation},
		{campaign: 'table-a', fork_generation: forkA.generation, library_generation: followed.generation});
	assert.deepEqual({library_generation: forkA.library_sync.library_generation, fork_generation: forkA.library_sync.fork_generation},
		{library_generation: followed.generation, fork_generation: forkA.generation});
	for (const field of ['campaign_scope', 'source_generation', 'library_sync'])
		assert.equal(Object.hasOwn(followed, field), false, `the library never stores the fork's ${field}`);
	// The single-entrance reference publication made its own choice in the library; the fork's is never written there.
	assert.deepEqual(followed.opening_choice, seeded.opening_choice);
	assert.deepEqual(followed.reading.completed, seeded.reading.completed, "the fork's completions stay private");
	assert.deepEqual(await b.queue(), libraryQueue, "the library's queue is not touched");
	assert.deepEqual((await b.graph()).entry_scene_ids, seededGraph.entry_scene_ids, 'the library keeps its own entrances');

	// A place A materializes from the original source is a publication too; its packet travels into the library.
	const placed = await b.place('table-a', 5, 'Cellar');
	assert.equal(placed.state, 'ready');
	assert.deepEqual(placed.library_sync, {state: 'published', library_generation: seeded.generation + 2});
	const placeRow = (await b.meta()).reading.materials.find(row => row.key === `source-place:${placed.scene}`);
	assert.ok(placeRow, 'the library holds the source place A materialized');
	assert.ok(placeRow.packet_file.startsWith('synced/table-a/'), placeRow.packet_file);
	assert.equal(sha(await readFile(join(b.dir(), placeRow.packet_file))), placeRow.packet_sha256);
	assert.ok((await b.graph()).nodes.some(node => node.node_id === placed.scene));

	// A source consultation stays private to its campaign (§179.4): its finish is no publication the library follows.
	const beforeAnswer = await treeDigest(b.dir());
	const asked = await b.call('module.read.request', {purpose: 'answer', focus: 'Harbor', question: 'What year is the harbor scene set in?', foreground: true}, 'table-a');
	assert.equal(asked.state, 'queued');
	const answered = await b.answer('table-a', await b.claimWhere('table-a', job => job.job_id === asked.job_id),
		{status: 'answered', answer: 'The harbor scene is set in 1925.', source_refs: [{page: 3}], limitations: 'Only the opening page is cited.'});
	assert.equal(answered.state, 'ready');
	assert.equal(answered.library_sync, undefined, 'a consultation is not offered to the library');
	assert.deepEqual(await treeDigest(b.dir()), beforeAnswer);
	assert.equal(Object.keys((await b.meta('table-a')).reading.answers).length, 1);
	assert.deepEqual(Object.keys((await b.meta()).reading.answers ?? {}), Object.keys(seeded.reading.answers ?? {}));

	// B is created after A's publications and forks the deeper library: the unit A read is answered by its row.
	await b.kernel('campaign.create', {id: 'table-b', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	const unitsB = await b.units('table-b', 2);
	assert.ok(!unitsB.some(([first]) => first === 3), `B's read-ahead asks no unit A read: ${JSON.stringify(unitsB)}`);
	assert.deepEqual(unitsB, [[5, 'queued'], [1, 'queued']], 'B streams the units nobody has read');
	assert.equal((await b.meta('table-b')).source_generation, seeded.generation + 2);
	assert.ok((await b.meta('table-b')).reading.materials.some(row => row.key === unit.key));
	const requested = await b.call('module.read.request', {purpose: 'detail', focus: unit.focus, question: unit.question, source_unit: unit.source_unit}, 'table-b');
	assert.equal(requested.state, 'ready');
	assert.equal(requested.job_id, undefined, 'a detail request for a unit A read queues nothing');
	assert.ok(!(await b.queue('table-b')).some(job => job.key === unit.key));

	// C forked from the generation before A's sync: another lineage. Its reading stays its own, the library is unchanged.
	const before = await treeDigest(b.dir());
	const readC = await b.claimWhere('table-c', job => job.source_unit?.first === 3);
	const publishedC = await b.publish('table-c', readC, delta());
	assert.deepEqual(publishedC.library_sync, {state: 'skipped', reason: 'library_advanced'});
	assert.deepEqual(await treeDigest(b.dir()), before, 'a fork whose base the library has moved past publishes nothing to it');
	const forkC = await b.meta('table-c');
	assert.ok(forkC.reading.materials.some(row => row.key === unit.key), "C's own reading holds its unit");
	assert.equal(forkC.generation, seeded.generation + 1);
	assert.equal(forkC.library_sync, undefined);

	// B forked the library's head after A's publications, so B leads now although the library last followed A: what B
	// reads beyond A goes back to the library (2026-10-04: a campaign created after the first sync could never publish).
	const readB = await b.claimWhere('table-b', job => job.source_unit?.first === 5);
	const unitB = (await b.queue('table-b')).find(job => job.job_id === readB.job_id);
	const publishedB = await b.publish('table-b', readB, delta());
	assert.deepEqual(publishedB.library_sync, {state: 'published', library_generation: seeded.generation + 3});
	const afterB = await b.meta();
	assert.equal(afterB.synced_from.campaign, 'table-b', 'the library follows B now');
	assert.ok(afterB.reading.materials.some(row => row.key === unitB.key), 'the library holds the unit B read beyond A');
	assert.ok(afterB.reading.materials.some(row => row.key === unit.key), "and keeps the unit A read");
	// A's base is behind the head B wrote: A's next reading stays A's own.
	const afterBBytes = await treeDigest(b.dir());
	const readA5 = await b.claimWhere('table-a', job => job.source_unit?.first === 5);
	assert.deepEqual((await b.publish('table-a', readA5, delta())).library_sync, {state: 'skipped', reason: 'library_advanced'});
	assert.deepEqual(await treeDigest(b.dir()), afterBBytes);

	// A library-scoped reading is not a fork's publication: it carries no sync, and it moves the library's head, which
	// ends B's lineage (§179.4): B's next publication stays B's own.
	const libraryUnit = (await b.queue('table-b')).find(job => job.source_unit?.first === 1);
	await b.call('module.read.request', {purpose: 'detail', focus: libraryUnit.focus, question: libraryUnit.question, source_unit: libraryUnit.source_unit});
	const readLibrary = await b.claimWhere(undefined, job => job.source_unit?.first === 1);
	const publishedLibrary = await b.publish(undefined, readLibrary, delta());
	assert.equal(publishedLibrary.library_sync, undefined, 'the library follows no one');
	const head = await b.meta();
	assert.equal(head.generation, seeded.generation + 4);
	assert.equal(head.synced_from.campaign, 'table-b', 'the record says which fork the library last followed');
	const afterLibrary = await treeDigest(b.dir());
	const readB1 = await b.claimWhere('table-b', job => job.source_unit?.first === 1);
	assert.deepEqual((await b.publish('table-b', readB1, delta())).library_sync, {state: 'skipped', reason: 'library_advanced'});
	assert.deepEqual(await treeDigest(b.dir()), afterLibrary);
});
