import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §184.1 (amends §22.6 and §151.4's fork note): the library follows the leading fork. §184.5 (amends §184.1 and
 * §184.4): a fork that is not the library's lineage gives back its readings one by one, through the library's own finish. A campaign's fork of a book
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
import {mkdir, mkdtemp, readFile, readdir, realpath, rename, symlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, relative, resolve} from 'node:path';
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
 * A content root that is the real one except for `host-budgets.json`'s `reading` entry, which gains `reading` (the SL-93
 * overlay pattern of admission-typed-settle.test.mjs).
 */
async function contentWith(name, reading) {
	const overlay = await mkdtemp(join(directory, `${name}-content-`)), coc7 = join(CONTENT, 'rulesets', 'coc7');
	for (const entry of await readdir(CONTENT)) if (entry !== 'rulesets') await symlink(join(CONTENT, entry), join(overlay, entry));
	await mkdir(join(overlay, 'rulesets', 'coc7'), {recursive: true});
	for (const entry of await readdir(join(CONTENT, 'rulesets'))) if (entry !== 'coc7') await symlink(join(CONTENT, 'rulesets', entry), join(overlay, 'rulesets', entry));
	for (const entry of await readdir(coc7)) if (entry !== 'host-budgets.json') await symlink(join(coc7, entry), join(overlay, 'rulesets', 'coc7', entry));
	const budgets = JSON.parse(await readFile(join(coc7, 'host-budgets.json'), 'utf8'));
	await writeFile(join(overlay, 'rulesets', 'coc7', 'host-budgets.json'), JSON.stringify({...budgets, reading: {...budgets.reading, ...reading}}));
	return overlay;
}

/**
 * A six-page PDF bound in the shared library with the fast reference path published there (§151.4): guidance and one
 * original-context entrance on page 3, a library graph of one generation, and no reading queued in the library.
 * `reading` overrides the content's reading budgets.
 */
async function library(name, {reading} = {}) {
	const workspace = await mkdtemp(join(directory, `${name}-`));
	const content = reading ? await contentWith(name, reading) : CONTENT;
	const context = await api.createKernelContext({workspace, content, seed: name, locks: api.nativeAdvisoryLocks(),
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
	/**
	 * `action` runs while the library's binding is set aside, so a fork's publications reach no library (`library_missing`):
	 * the state of a fork whose readings predate §184, as the lead measured it on the App's own data.
	 */
	b.aside = async action => {
		const binding = join(b.dir(), 'module.json');
		await rename(binding, `${binding}.aside`);
		try { return await action(); } finally { await rename(`${binding}.aside`, binding); }
	};
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
	/** A host reader and a reviewer that supports every path; `assets` are the host-rendered images its finish passes. */
	b.publish = async (campaign, job, draft, assets) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: source, read_pages: pages, full_pages: pages, review_pages: pages});
		await save(join(job.work_dir, 'draft.json'), draft);
		const checked = (await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
		await save(join(job.work_dir, 'review.json'), {checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json'), ...(assets ? {assets} : {})}, campaign);
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

test('§184.1: the library follows the leading fork; a campaign forked after it reads nothing the first read, and other lineages stay private', async () => {
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

	// A source consultation stays private to its campaign (§184.4): its finish is no publication the library follows.
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

	// C forked from the generation before A's sync: another lineage. §184.5: its readings the library lacks are merged one by
	// one, and the unit C read is one A gave the library first, so the library is unchanged.
	const before = await treeDigest(b.dir());
	const readC = await b.claimWhere('table-c', job => job.source_unit?.first === 3);
	const publishedC = await b.publish('table-c', readC, delta());
	assert.deepEqual(publishedC.library_sync, {state: 'skipped', reason: 'already_present'});
	assert.deepEqual(await treeDigest(b.dir()), before, 'a reading the library already holds is not given back again');
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
	// A's base is behind the head B wrote, and the unit A reads now is one B gave the library: nothing is merged.
	const afterBBytes = await treeDigest(b.dir());
	const readA5 = await b.claimWhere('table-a', job => job.source_unit?.first === 5);
	assert.deepEqual((await b.publish('table-a', readA5, delta())).library_sync, {state: 'skipped', reason: 'already_present'});
	assert.deepEqual(await treeDigest(b.dir()), afterBBytes);

	// A library-scoped reading is not a fork's publication: it carries no sync, and it moves the library's head, which
	// ends B's lineage (§184.4): B's next publication is merged, and the unit it read is the library's own already.
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
	assert.deepEqual((await b.publish('table-b', readB1, delta())).library_sync, {state: 'skipped', reason: 'already_present'});
	assert.deepEqual(await treeDigest(b.dir()), afterLibrary);
});

/** A person read from `page`: not ready, so a later reading of the same field from another page contradicts it (§22.3.1). */
const ferryman = (summary, page) => ({node_id: 'npc-ferryman', node_kind: 'npc', name: 'Ferryman', summary, source_refs: [{page}]});
const keeper = {node_id: 'npc-keeper', node_kind: 'npc', name: 'Lighthouse Keeper', summary: 'The keeper tends the light.', source_refs: [{page: 5}]};
/** A player-safe handout cropped from page 5, and the one-pixel PNG a host would render for it. */
const chart = {node_id: 'handout-chart', node_kind: 'handout', name: 'Tide Chart', visibility: 'player-safe', source_refs: [{page: 5}], properties: {image_sources: [{page: 5}]}};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGk0AAAAASUVORK5CYII=', 'base64');

test('§184.5: a fork that is not the library\'s lineage gives back its readings one by one, through the library\'s own publication', async () => {
	const b = await library('merge');
	for (const id of ['table-a', 'table-c']) await b.kernel('campaign.create', {id, module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	// A and C fork the same library head.
	assert.deepEqual(await b.units('table-a'), [[3, 'queued'], [5, 'queued']]);
	assert.deepEqual(await b.units('table-c'), [[3, 'queued'], [5, 'queued']]);
	assert.equal((await b.meta('table-a')).source_generation, (await b.meta('table-c')).source_generation);

	// A publishes first: the library fast-forwards to A (§184.1). Its unit names a person it does not make ready.
	const readA3 = await b.claimWhere('table-a', job => job.source_unit?.first === 3);
	const libraryHead = await b.meta();
	assert.deepEqual((await b.publish('table-a', readA3, delta([ferryman('The ferryman rows at dawn.', 3)], [], []))).library_sync,
		{state: 'published', library_generation: libraryHead.generation + 1});
	const unit3 = (await b.queue('table-a')).find(job => job.job_id === readA3.job_id);

	// C read both of its units while A published. Its unit 5 is new to the library: it is replayed through the library's own
	// finish as one library job and one new library generation.
	const readC3 = await b.claimWhere('table-c', job => job.source_unit?.first === 3);
	const readC5 = await b.claimWhere('table-c', job => job.source_unit?.first === 5);
	const unit5 = (await b.queue('table-c')).find(job => job.job_id === readC5.job_id);
	// A row C was seeded with is the library's, even after the library dropped it (§22.3.3: a published reading of a focus
	// replaces its unusable settlement): it is not one of C's readings and is never merged or reported.
	const forkC = await b.meta('table-c');
	forkC.reading.materials.push({key: 'settled-before-the-fork', purpose: 'detail', focus: 'Lighthouse', question: '', status: 'unusable',
		reason: 'fixture: settled in the library before C forked', job_id: 'read-99', node_ids: [], generation: forkC.source_generation});
	await save(join(b.dir('table-c'), 'module.json'), forkC);
	const beforeC5 = await b.meta(), rendered = join(readC5.work_dir, 'assets', 'handout-chart.png');
	await mkdir(join(readC5.work_dir, 'assets'), {recursive: true});
	await writeFile(rendered, PNG);
	const mergedC5 = await b.publish('table-c', readC5, delta([keeper, chart]), [{node_id: 'handout-chart', path: rendered, sha256: sha(PNG)}]);
	assert.deepEqual(mergedC5.library_sync, {state: 'merged', merged: 1, skipped: [], library_generation: beforeC5.generation + 1, remaining: 0});
	const afterC5 = await b.meta(), row5 = afterC5.reading.materials.find(row => row.key === unit5.key);
	assert.ok(row5, "the library holds C's unit 5");
	assert.deepEqual({node_ids: row5.node_ids, generation: row5.generation}, {node_ids: ['npc-keeper', 'handout-chart'], generation: afterC5.generation});
	assert.ok((await b.graph()).nodes.some(node => node.node_id === 'npc-keeper'), "C's nodes are in the library graph");
	// The handout's rendered image travels with the replay: the library's finish checked it and registers it in the copy.
	const chartNode = (await b.graph()).nodes.find(node => node.node_id === 'handout-chart');
	assert.equal(chartNode.properties.asset_ref, join('work', 'merged', 'table-c', readC5.job_id, 'assets', 'handout-chart.png'));
	assert.equal(chartNode.properties.asset_digest, sha(PNG));
	assert.equal(sha(await readFile(join(b.dir(), chartNode.properties.asset_ref))), sha(PNG));
	assert.equal(afterC5.synced_from.campaign, 'table-a', 'a merge is not a fast-forward: the record still names A');
	const replays = (await b.queue()).filter(job => job.merged_from);
	assert.equal(replays.length, 1);
	assert.deepEqual({state: replays[0].state, merged_from: replays[0].merged_from, key: replays[0].key, source_unit: replays[0].source_unit},
		{state: 'completed', merged_from: {campaign: 'table-c', job_id: readC5.job_id}, key: unit5.key, source_unit: unit5.source_unit});
	assert.equal(relative(await realpath(b.dir()), replays[0].work_dir), join('work', 'merged', 'table-c', readC5.job_id));
	assert.equal(sha(await readFile(join(replays[0].work_dir, 'draft.json'))), sha(await readFile(join(readC5.work_dir, 'draft.json'))));
	assert.equal(afterC5.reading.completed[replays[0].job_id].state, mergedC5.state, "the replay is the library's own completion");
	assert.equal((await b.meta('table-c')).library_sync, undefined, 'C is still not the library\'s lineage');

	// The merge was the library's own publication: it ends A's lineage, so A's next reading cannot replace what C gave back.
	const readA5 = await b.claimWhere('table-a', job => job.source_unit?.first === 5);
	let bytes = await treeDigest(b.dir());
	assert.deepEqual((await b.publish('table-a', readA5, delta())).library_sync, {state: 'skipped', reason: 'already_present'});
	assert.deepEqual(await treeDigest(b.dir()), bytes);
	assert.ok((await b.graph()).nodes.some(node => node.node_id === 'npc-keeper'));

	// C's own unit 3 is one A gave the library first: A's row stays, nothing is merged.
	assert.deepEqual((await b.publish('table-c', readC3, delta())).library_sync, {state: 'skipped', reason: 'already_present'});
	assert.deepEqual(await treeDigest(b.dir()), bytes, "A's reading of the unit stays the library's");
	assert.ok((await b.meta('table-c')).reading.materials.some(row => row.key === unit3.key), "C's reading stays in C's own workspace");

	// A consultation C answers stays C's (§184.4): its finish offers the library nothing.
	const asked = await b.call('module.read.request', {purpose: 'answer', focus: 'Harbor', question: 'What year is the harbor scene set in?', foreground: true}, 'table-c');
	const answered = await b.answer('table-c', await b.claimWhere('table-c', job => job.job_id === asked.job_id),
		{status: 'answered', answer: 'The harbor scene is set in 1925.', source_refs: [{page: 3}], limitations: 'Only the opening page is cited.'});
	assert.equal(answered.state, 'ready');
	assert.equal(answered.library_sync, undefined);
	assert.deepEqual(await treeDigest(b.dir()), bytes);

	// C's unit 1 reads the same person from another page and writes another value: the library's own finish refuses it
	// (§22.3.1). The refusal ends that reading's merge only; its library job is failed and kept.
	assert.ok((await b.units('table-c')).some(([first, state]) => first === 1 && state === 'queued'));
	const readC1 = await b.claimWhere('table-c', job => job.source_unit?.first === 1);
	const unit1 = (await b.queue('table-c')).find(job => job.job_id === readC1.job_id);
	const beforeConflict = await b.meta();
	const conflicted = await b.publish('table-c', readC1, delta([ferryman('The ferryman never rows.', 1)], [], []));
	assert.deepEqual({state: conflicted.library_sync.state, merged: conflicted.library_sync.merged, library_generation: conflicted.library_sync.library_generation,
		skipped: conflicted.library_sync.skipped.map(({key, reason}) => [key, reason])},
		{state: 'merged', merged: 0, library_generation: beforeConflict.generation, skipped: [[unit1.key, 'refused']]});
	assert.match(conflicted.library_sync.skipped[0].detail, /contradicts a published value/);
	const refusedJob = (await b.queue()).find(job => job.merged_from?.job_id === readC1.job_id);
	assert.deepEqual({state: refusedJob.state, campaign: refusedJob.merged_from.campaign}, {state: 'failed', campaign: 'table-c'});
	assert.match(refusedJob.refusal.message, /contradicts a published value/);
	assert.ok(!(await b.meta()).reading.materials.some(row => row.key === unit1.key));
	assert.equal((await b.graph()).nodes.find(node => node.node_id === 'npc-ferryman').summary, 'The ferryman rows at dawn.');
	assert.equal((await b.graph('table-c')).nodes.find(node => node.node_id === 'npc-ferryman').summary, 'The ferryman never rows.', "C keeps its own reading");

	// A source place C materializes is merged through the library's own materialization; the refused reading is reported
	// again and not replayed again.
	const beforePlace = await b.meta();
	const placed = await b.place('table-c', 5, 'Cellar');
	assert.equal(placed.state, 'ready');
	assert.deepEqual({state: placed.library_sync.state, merged: placed.library_sync.merged, library_generation: placed.library_sync.library_generation,
		skipped: placed.library_sync.skipped.map(({key, reason}) => [key, reason])},
		{state: 'merged', merged: 1, library_generation: beforePlace.generation + 1, skipped: [[unit1.key, 'refused']]});
	assert.equal((await b.queue()).filter(job => job.merged_from?.job_id === readC1.job_id).length, 1, 'a refused reading is not replayed again');
	const placeRow = (await b.meta()).reading.materials.find(row => row.key === `source-place:${placed.scene}`);
	assert.ok(placeRow, 'the library holds the place C materialized');
	assert.equal(sha(await readFile(join(b.dir(), placeRow.packet_file))), placeRow.packet_sha256);
	assert.ok((await b.graph()).nodes.some(node => node.node_id === placed.scene));
	assert.ok(await readFile(join(b.dir(), 'work', 'merged', 'table-c', 'source-place-5', 'source-reference.json')));

	// D is created afterwards and forks the deeper library: its read-ahead asks neither unit A or C gave back, only the one
	// the library refused.
	await b.kernel('campaign.create', {id: 'table-d', module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	const unitsD = await b.units('table-d', 2);
	assert.deepEqual(unitsD, [[1, 'queued']], `D asks only the unit nobody gave back: ${JSON.stringify(unitsD)}`);
	const forkD = await b.meta('table-d');
	for (const key of [unit3.key, unit5.key, `source-place:${placed.scene}`]) assert.ok(forkD.reading.materials.some(row => row.key === key), key);
	const chartD = await b.call('module.asset', {name: 'Tide Chart'}, 'table-d');
	assert.ok(chartD.asset.path.startsWith(b.dir('table-d') + '/'), chartD.asset.path);
	assert.equal(sha(await readFile(chartD.asset.path)), sha(PNG));
	// The refused replay is not the library's own reading of that unit: a library request for it queues a reading.
	const libraryAsk = await b.call('module.read.request', {purpose: 'detail', focus: unit1.focus, question: unit1.question, source_unit: unit1.source_unit});
	assert.equal(libraryAsk.state, 'queued', JSON.stringify(libraryAsk));
});

test('§184.5: a replay whose merge was interrupted is never claimed by a library reader, and the next merge replays it', async () => {
	const b = await library('interrupted');
	for (const id of ['table-a', 'table-c']) await b.kernel('campaign.create', {id, module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	await b.units('table-a');
	await b.units('table-c');
	assert.equal((await b.publish('table-a', await b.claimWhere('table-a', job => job.source_unit?.first === 3), delta())).library_sync.state, 'published');
	await b.claimWhere('table-c', job => job.source_unit?.first === 3);
	const readC5 = await b.claimWhere('table-c', job => job.source_unit?.first === 5);
	const unit = (await b.queue('table-c')).find(job => job.job_id === readC5.job_id);
	// What a kernel killed between a replay's queue write and its finish leaves behind: a running library job whose lock no
	// one holds.
	const interrupted = {job_id: 'read-1', key: unit.key, purpose: 'detail', focus: unit.focus, question: unit.question, pages: unit.pages, source_unit: unit.source_unit,
		foreground: false, state: 'running', owner: 'merge', attempts: 1, lease: 'interrupted-lease', lock_version: 2,
		work_dir: join(b.dir(), 'work', 'merged', 'table-c', readC5.job_id), at: new Date().toISOString(), merged_from: {campaign: 'table-c', job_id: readC5.job_id}};
	await save(join(b.dir(), 'deepen-queue.json'), [...await b.queue(), interrupted]);
	const claimed = await b.call('module.read.claim', {owner: 'test-host'});
	assert.equal(claimed.job_id, null, 'a library reader never claims a replay');
	assert.deepEqual((({state, refusal}) => ({state, rule: refusal?.rule}))((await b.queue()).find(job => job.job_id === 'read-1')),
		{state: 'failed', rule: 'merge_interrupted'});
	// A failed replay is not the library's own reading of the unit: the library's read-ahead still asks it.
	await b.kernel('module.read.ahead', {module_id: b.mid});
	assert.ok((await b.queue()).some(job => job.source_unit?.first === 5 && !job.merged_from && job.state === 'queued'),
		JSON.stringify((await b.queue()).map(job => [job.job_id, job.source_unit?.first, job.state, Boolean(job.merged_from)])));
	// C's publication replays the interrupted reading again.
	const merged = await b.publish('table-c', readC5, delta([keeper]));
	assert.deepEqual({state: merged.library_sync.state, merged: merged.library_sync.merged}, {state: 'merged', merged: 1});
	assert.deepEqual((await b.queue()).filter(job => job.merged_from?.job_id === readC5.job_id).map(job => [job.job_id, job.state]).slice(0, 1),
		[['read-1', 'failed']]);
	assert.deepEqual((await b.queue()).filter(job => job.merged_from?.job_id === readC5.job_id).map(job => job.state), ['failed', 'completed']);
	assert.ok((await b.meta()).reading.materials.some(row => row.key === unit.key));
});

/** Merged rows of a fork's reading in the library queue, by fork job id. */
const replaysOf = async (b, jobId) => (await b.queue()).filter(job => job.merged_from?.job_id === jobId);

test('§184.5 bounded per call: with merge_budget_ms 0 a backlog merges one reading per call, a publication first and the read-ahead after', async () => {
	const b = await library('budget', {reading: {merge_budget_ms: 0}});
	for (const id of ['table-a', 'table-c']) await b.kernel('campaign.create', {id, module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	await b.units('table-a');
	await b.units('table-c');
	assert.deepEqual((await b.publish('table-a', await b.claimWhere('table-a', job => job.source_unit?.first === 3), delta())).library_sync.state, 'published');
	// A is the library's lineage: its read-ahead carries no merge.
	assert.equal(Object.hasOwn(await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'table-a'}), 'library_sync'), false);

	// C reads three readings the library never sees: units 5 and 1 and a source place.
	const readC3 = await b.claimWhere('table-c', job => job.source_unit?.first === 3);
	const readC5 = await b.claimWhere('table-c', job => job.source_unit?.first === 5);
	await b.aside(async () => {
		// A, still the lineage, materializes a place the library never sees.
		assert.equal((await b.place('table-a', 1, 'Lighthouse')).library_sync.reason, 'library_missing');
		assert.deepEqual((await b.publish('table-c', readC5, delta([keeper]))).library_sync, {state: 'skipped', reason: 'library_missing'});
		assert.ok((await b.units('table-c')).some(([first, state]) => first === 1 && state === 'queued'));
		assert.deepEqual((await b.publish('table-c', await b.claimWhere('table-c', job => job.source_unit?.first === 1), delta())).library_sync,
			{state: 'skipped', reason: 'library_missing'});
		assert.equal((await b.place('table-c', 5, 'Cellar')).library_sync.reason, 'library_missing');
	});
	// A is still the lineage: its read-ahead merges nothing, though its place is missing; its next publication fast-forwards.
	const libraryBytes = await treeDigest(b.dir());
	assert.equal(Object.hasOwn(await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'table-a'}), 'library_sync'), false);
	assert.deepEqual(await treeDigest(b.dir()), libraryBytes, 'the library is unchanged');
	const forkC = await b.meta('table-c'), own = forkC.reading.materials.filter(row => row.generation > forkC.source_generation).map(row => row.key);
	assert.equal(own.length, 3);
	/** C's readings the library holds, in the library's order. */
	const held = async () => (await b.meta()).reading.materials.filter(row => own.includes(row.key)).map(row => row.key);
	// A library-scoped read-ahead merges nothing.
	const libraryRows = (await b.meta()).reading.materials.length;
	assert.equal(Object.hasOwn(await b.kernel('module.read.ahead', {module_id: b.mid}), 'library_sync'), false);
	assert.equal((await b.meta()).reading.materials.length, libraryRows);

	// C's next publication is a unit the library holds: its merge batch starts one replay and stops.
	const first = await b.publish('table-c', readC3, delta());
	const {skipped, ...shape} = first.library_sync, generation = (await b.meta()).generation;
	assert.deepEqual(shape, {state: 'merged', merged: 1, library_generation: generation, remaining: 2, partial: true});
	assert.deepEqual(skipped.map(({reason}) => reason), ['already_present']);
	assert.deepEqual(await held(), [own[0]]);
	// The campaign's read-ahead continues the backlog, one batch per pass.
	const second = (await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'table-c'})).library_sync;
	assert.deepEqual({merged: second.merged, remaining: second.remaining, partial: second.partial}, {merged: 1, remaining: 1, partial: true});
	const third = (await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'table-c'})).library_sync;
	assert.deepEqual({merged: third.merged, remaining: third.remaining, partial: third.partial ?? false}, {merged: 1, remaining: 0, partial: false});
	assert.deepEqual((await held()).sort(), [...own].sort(), 'the library ends with all three');
	// Nothing left: the read-ahead adds no field.
	assert.equal(Object.hasOwn(await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'table-c'}), 'library_sync'), false);
});

test('§184.5 bounded per call: a reading the library refused does not take every call\'s one replay', async () => {
	const b = await library('budget-refused', {reading: {merge_budget_ms: 0}});
	for (const id of ['table-a', 'table-c']) await b.kernel('campaign.create', {id, module: b.mid, play_language: 'en', start_scene: 'Harbor'});
	await b.units('table-a');
	await b.units('table-c');
	assert.equal((await b.publish('table-a', await b.claimWhere('table-a', job => job.source_unit?.first === 3),
		delta([ferryman('The ferryman rows at dawn.', 3)], [], []))).library_sync.state, 'published');
	const readC3 = await b.claimWhere('table-c', job => job.source_unit?.first === 3);
	const readC5 = await b.claimWhere('table-c', job => job.source_unit?.first === 5);
	let unit1;
	await b.aside(async () => {
		// C's first reading contradicts the library; its second does not.
		await b.publish('table-c', readC5, delta([ferryman('The ferryman never rows.', 5)], [], []));
		await b.units('table-c');
		const readC1 = await b.claimWhere('table-c', job => job.source_unit?.first === 1);
		unit1 = (await b.queue('table-c')).find(job => job.job_id === readC1.job_id);
		await b.publish('table-c', readC1, delta([keeper]));
	});
	const first = (await b.publish('table-c', readC3, delta())).library_sync;
	assert.deepEqual({merged: first.merged, remaining: first.remaining, reasons: first.skipped.map(({reason}) => reason)},
		{merged: 0, remaining: 1, reasons: ['already_present', 'refused']});
	const second = (await b.kernel('module.read.ahead', {module_id: b.mid, campaign: 'table-c'})).library_sync;
	assert.deepEqual({merged: second.merged, remaining: second.remaining, reasons: second.skipped.map(({reason}) => reason)},
		{merged: 1, remaining: 0, reasons: ['refused']});
	assert.equal((await replaysOf(b, readC5.job_id)).length, 1, 'the refused reading was started once');
	assert.ok((await b.meta()).reading.materials.some(row => row.key === unit1.key));
});
