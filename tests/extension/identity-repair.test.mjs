import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §191.5: repairing graphs that already hold duplicates.
 *
 * Blood Road's forks and library hold copies written before §191.1's landing check (the general store, the town centre, the
 * store owner, eight more on generation 60). These cases travel the real path: a kernel runtime over a bound PDF, its index
 * and opening published through `module.read.finish`, copies written straight into a generation as those readings left them,
 * and `module.read.ahead` -- the read-ahead a table's opening and the host send -- doing the repair. The verdict jobs run
 * through the host's ReadingService with its reviewer child played by a fixture runtime, or through `module.read.finish`
 * directly where the kernel's own checks are the point. The clone of the acceptance home's generation-60 fork is in the
 * DUP-03 record (§191.8).
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
import {nodeIdentityVerdicts} from '../../kernel-ts/modules/node-identity-shape.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('identity-repair', 'suite-', {retain: Boolean(process.env.KEEP_REPAIR_EVIDENCE)});
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
	`export {CAST_VERSION} from './kernel-ts/read/cast.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
	`export {ModuleStore} from './kernel-ts/modules/store.ts';`,
	`export {ensureCampaignModule, libraryLineage, moduleContext} from './kernel-ts/modules/campaign-scope.ts';`,
	`export {createModuleRuntime} from './kernel-ts/modules/index.ts';`,
	`export {loadCampaignModule} from './kernel-ts/read/campaign.ts';`,
	`export {bookCast} from './kernel-ts/read/cast.ts';`,
	`export {untoldRoster} from './kernel-ts/read/capsule.ts';`,
	`export {repairCandidates} from './kernel-ts/modules/identity-repair.ts';`,
	`export {identityPairKey} from './kernel-ts/modules/published-duplicates.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'identity-repair-api.ts', loader: 'ts'},
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
/** The general store and its copy (Blood Road's pp. 25-26): one name, one page. */
const STORE = scene('scene-dusty-shop', 'General Store', P1, {summary: 'A dusty shop on the main street.'});
const STORE_COPY = scene('scene-store-copy', 'General Store', P1, {summary: 'The general store, where the owner sells feed.', aliases: ['Mather\'s']});
/** A doctor read on two pages (Blood Road's p. 50 Brenner node): one name, no shared page. */
const BRENNER = npc('npc-brenner', 'Dr Brenner', P1, {summary: 'The town doctor.'});
const BRENNER_COPY = npc('npc-brenner-later', 'Dr Brenner', P2, {summary: 'The doctor at the base.'});
/** Two men a short form joins (Pete and Peter Benson, §191's census: different). */
const PETE = npc('npc-pete', 'Pete', P1, {summary: 'A drifter in the trailer.'});
const BENSON = npc('npc-peter-benson', 'Peter Benson', P2, {aliases: ['Pete'], summary: 'The hardware store owner.'});

/** A bound PDF with its index and opening published through the real kernel. */
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
	b.ahead = campaign => b.call('module.read.ahead', campaign ? {campaign} : {});
	b.store = campaign => new api.ModuleStore(campaign ? api.moduleContext(context, campaign) : {...context, moduleRoot: join(context.stateRoot, 'modules')});
	b.meta = campaign => b.store(campaign).module(mid);
	b.raw = campaign => b.store(campaign).readGraph(mid);
	b.graph = async campaign => new api.ModuleGraph(mid, await b.raw(campaign), '', {});
	b.queue = campaign => b.store(campaign).queue(mid);
	b.identityJobs = async campaign => (await b.queue(campaign)).filter(job => job.node_identity);
	b.relations = async campaign => (await b.raw(campaign)).relations.filter(rel => rel.relation_id.startsWith('rel-identity-'));
	b.key = (kind, x, y) => api.identityPairKey(sha, kind, x, y);
	b.campaignCast = async () => { try { return JSON.parse(await readFile(join(b.store().moduleDir(mid), 'cast.json'), 'utf8')).people.map(row => ({book: row.book, play: row.play})); } catch { return []; } };
	/** A live campaign (its `campaign.json`) with its fork seeded from the library's head. */
	b.campaign = async campaign => {
		await mkdir(join(workspace, '.coc/campaigns', campaign), {recursive: true});
		await save(join(workspace, '.coc/campaigns', campaign, 'campaign.json'), {id: campaign, module_id: mid});
		await api.ensureCampaignModule(context, campaign, mid);
	};
	b.publish = async (job, draft) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]});
		await save(join(job.work_dir, 'draft.json'), draft);
		const checked = job.purpose === 'index' ? {required_review: []} : await api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'));
		await save(join(job.work_dir, 'review.json'), {checked: [{paths: checked.required_review ?? [], verdict: 'supported', source_refs: P1, reason: 'fixture support'}], missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json')});
	};
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'Abattoir', language: 'en', sections: [{name: 'Main street', pages: [[1, 1]], entities: ['Main street']},
		{name: 'Base', pages: [[2, 2]], entities: ['Base']}], map_candidates: []});
	await b.call('module.read.request', {purpose: 'opening'});
	const opened = await b.publish(await b.claim(), delta([
		scene('scene-main-street', 'Main street', P1, {properties: {is_entrance: true}}),
		scene('scene-base', 'Base', P2, {summary: 'The compound beyond the town.', properties: {is_final: true}})],
	[{subject_id: 'scene-main-street', predicate: 'route-to', object: {node_id: 'scene-base'}, truth_status: 'authored-fact', source_refs: P1}], ['scene-main-street']));
	assert.equal(opened.opening_ready, true);
	return b;
}

/**
 * Nodes written straight into a new generation of the library (or a campaign's fork), as a page reading before §191.1 left
 * them: runtime source refs and one `reading.materials` row each, so the earlier written is the earlier published
 * (`oneReading`: one row lists them all, as one reading's publication does).
 */
async function seed(b, nodes, {campaign, relations = [], oneReading = false} = {}) {
	const store = b.store(campaign), meta = await store.module(b.mid), graph = await store.readGraph(b.mid);
	graph.nodes.push(...nodes.map(node => ({...node, source_refs: node.source_refs.map(ref => ({source_id: `pdf:${b.mid}`, pdf_index: ref.page - 1}))})));
	graph.relations = [...(graph.relations ?? []), ...relations];
	await store.writeGraph(meta, graph);
	const rows = oneReading ? [nodes] : nodes.map(node => [node]);
	meta.reading.materials.push(...rows.map(group => ({key: `seed-${group[0].node_id}`, purpose: 'detail', focus: group[0].name, question: '',
		node_ids: group.map(node => node.node_id), generation: meta.generation})));
	await store.writeModule(meta);
}

/** The identity job the read-ahead queued; a background reading the table queued before it gives its slot back unread. */
async function claimIdentity(b, campaign) {
	for (let tries = 0; tries < 8; tries++) {
		const job = await b.claim(campaign ? {campaign} : {});
		if (job.node_identity) return job;
		assert.ok(job.job_id, 'the identity job was queued');
		await b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'cancelled', ...(campaign ? {campaign} : {})});
	}
	throw new Error('no identity job was claimed');
}

/** The host's page evidence for one reviewer run: the pages it opened with the pdf tool, delivered on the provider's record. */
async function openPages(request, pages, id) {
	request.onEvent?.({type: 'tool_execution_start', toolName: 'pdf', toolCallId: id, args: {pages}});
	request.onEvent?.({type: 'tool_execution_end', toolCallId: id, isError: false,
		result: {content: pages.map(() => ({type: 'image'})), details: {kind: 'source_pages', observations: pages.map(page => ({page, path: join(request.source.cache, `page-${page}.jpg`)}))}}});
	await appendFile(request.eventLog + '.images.jsonl', JSON.stringify({delivery: 'succeeded', included: [id]}) + '\n');
}

/**
 * The host ReadingService over the real kernel, with a fixture runtime playing the identity reviewer: it opens every page of
 * both sides of each pair (`reads`: false opens none) and answers `identity(pair)`.
 */
function service(b, {identity, reads = true, campaign}) {
	const runs = {identity: 0, tasks: []};
	const runtime = {
		contentRoot: CONTENT,
		async runTask({request}) {
			assert.ok(request.systemPrompt?.endsWith('instructions-node-identity.md'), 'only the identity reviewer runs');
			runs.identity++;
			const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
			runs.tasks.push(task);
			if (reads) for (const [index, pair] of task.pairs.entries()) await openPages(request, [...new Set([...pair.a.pages, ...pair.b.pages])], `pdf-${runs.identity}-${index}`);
			await save(join(request.cwd, 'identity.json'), {verdicts: task.pairs.map(pair => ({key: pair.key, ...identity(pair)}))});
			return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
		},
		async sourceInfo() { throw new Error('not a guidance job'); },
	};
	const rows = [];
	const reading = new ReadingService({home: b.workspace, runtime, model: () => ({id: 'fixture/reviewer', thinking: 'off'}),
		progress() {}, record: row => rows.push(row), call: (method, params) => b.kernel(method, params), ...(campaign ? {campaign: () => campaign} : {})});
	closers.push(() => reading.close());
	return {reading, runs, rows, run: job => reading.runJob(job, new AbortController().signal, campaign)};
}
const same = reason => () => ({verdict: 'same', reason});
const differentPete = pair => [pair.a.node_id, pair.b.node_id].includes(PETE.node_id)
	? {verdict: 'different', reason: 'Page 1 is a drifter; page 2 is the hardware store owner.'}
	: {verdict: 'same', reason: 'Both pages describe the one town doctor.'};

test('§191.5 owner rule: one kind, one name, a shared page is merged by the read-ahead, even on a built book; a second read-ahead writes nothing', async () => {
	const b = await book('owner-rule');
	await seed(b, [STORE]);
	await seed(b, [STORE_COPY]);
	// §182.2: a short book already built queues nothing more for its source; the repair is no reading of it and runs all the same.
	const built = await b.meta();
	built.reading.build_complete = {source_sha256: b.sha, at: '2026-10-07T00:00:00Z'};
	await b.store().writeModule(built);
	const graphBefore = await b.graph();
	assert.throws(() => graphBefore.resolve('General Store', ['scene']), /ambiguous/, 'two stores answer one name');
	const before = (await b.meta()).generation;
	const first = await b.ahead();
	assert.equal(first.identity_repair.state, 'published', JSON.stringify(first.identity_repair));
	assert.deepEqual([first.identity_repair.merged, first.identity_repair.written, first.identity_repair.open], [1, 1, 0]);
	const [relation] = await b.relations();
	assert.equal(relation.relation_id, `rel-identity-${STORE_COPY.node_id}-to-${STORE.node_id}`, 'the copy reads as the store published first');
	assert.deepEqual(relation.properties.identity_review, {by: 'kernel', rule: 'same-name-same-page', generation: before + 1});
	const graph = await b.graph();
	assert.equal(graph.resolve('General Store', ['scene']).node_id, STORE.node_id, 'one store answers its name');
	assert.ok(graph.nodes.get(STORE.node_id).aliases.includes('Mather\'s'), 'the survivor took the copy\'s alias (§191.4)');
	assert.equal((await b.meta()).generation, before + 1, 'one new generation');
	const second = await b.ahead();
	assert.equal(second.identity_repair, undefined, `a quiet repair leaves the read-ahead's answer as it was: ${JSON.stringify(second.identity_repair)}`);
	assert.equal((await b.meta()).generation, before + 1, 'a second load writes nothing');
	assert.deepEqual(await b.identityJobs(), [], 'nothing waits for a verdict');
});

test('§191.5 never without a verdict: a pair the graph relates, one reading\'s two, a shared alias and disjoint pages are asked; a reader\'s variant-of is neither merged nor asked', async () => {
	const b = await book('never-owner');
	const rats = npc('npc-sand-rats', 'Sand Rats', P1, {summary: 'The gang that runs the junkyard.'});
	const hick = npc('npc-sand-rat', 'Sand Rats', P1, {summary: 'One of the gang, a hick with a shotgun.'});
	const pharmacy = scene('scene-pharmacy', 'Pharmacy', P1), drugstore = scene('scene-kellys', 'Kelly\'s Drugstore', P1, {aliases: ['Pharmacy']});
	const virginia = npc('npc-virginia', 'Virginia', P2, {summary: 'Dead in her grave.'}), revived = npc('npc-virginia-revived', 'Virginia', P2, {summary: 'Risen.'});
	await seed(b, [rats, pharmacy, virginia, BRENNER]);
	// One reading published two fishermen of one name on one page: that reader kept them apart.
	await seed(b, [npc('npc-tom-north', 'Tom', P1, {summary: 'A fisherman at the north dock.'}), npc('npc-tom-south', 'Tom', P1, {summary: 'A fisherman at the south dock.'})],
		{oneReading: true});
	await seed(b, [hick, drugstore, revived, BRENNER_COPY], {relations: [
		{relation_id: 'rel-npc-sand-rat-member-of-npc-sand-rats', relation_kind: 'member-of', from_node_id: hick.node_id, to_node_id: rats.node_id, properties: {}},
		{relation_id: 'rel-npc-virginia-revived-variant-of-npc-virginia', relation_kind: 'variant-of', from_node_id: revived.node_id, to_node_id: virginia.node_id, properties: {}}]});
	const repaired = await b.ahead();
	assert.deepEqual([repaired.identity_repair.state, repaired.identity_repair.merged, repaired.identity_repair.open, repaired.identity_repair.asked.length],
		['unchanged', 0, 4, 1], JSON.stringify(repaired.identity_repair));
	assert.deepEqual(await b.relations(), [], 'nothing was merged without a verdict');
	const pairs = api.repairCandidates(b.mid, await b.raw(), await b.meta(), []);
	assert.deepEqual(pairs.map(pair => [pair.kind, pair.a.node_id, pair.b.node_id, pair.rule, pair.related.map(rel => rel.relation_kind)]), [
		['npc', BRENNER.node_id, BRENNER_COPY.node_id, null, []],
		['npc', hick.node_id, rats.node_id, null, ['member-of']],
		['npc', 'npc-tom-north', 'npc-tom-south', null, []],
		['scene', drugstore.node_id, pharmacy.node_id, null, []]], 'the reader\'s variant-of pair is no candidate');
	const [job] = await b.identityJobs();
	assert.deepEqual(job.node_identity.pairs, pairs.map(pair => pair.key).sort(), 'one background job asks the four');
	assert.equal(job.foreground, false);
	const again = await b.ahead();
	assert.equal(again.identity_repair, undefined, 'one live identity job at a time: nothing new is asked');
	assert.equal((await b.identityJobs()).length, 1);
});

test('§191.5 a verdict job: the reviewer opens both nodes\' pages; same writes the relation, different is kept and never asked again', async () => {
	const b = await book('verdict-job');
	await seed(b, [BRENNER, PETE]);
	await seed(b, [BRENNER_COPY, BENSON]);
	const asked = await b.ahead();
	assert.equal(asked.identity_repair.open, 2);
	const job = await claimIdentity(b);
	assert.equal(job.node_identity.protocol, 'node-identity-v1');
	assert.deepEqual(job.node_identity.pairs.map(pair => [pair.a.node_id, pair.a.pages, pair.b.node_id, pair.b.pages, pair.raised_by]), [
		[BRENNER.node_id, [1], BRENNER_COPY.node_id, [2], 'name'],
		[PETE.node_id, [1], BENSON.node_id, [2], 'name']]);
	assert.equal(job.cast_names, undefined, 'an identity job reads no cast and no page window');
	const host = service(b, {identity: differentPete});
	await host.run(job);
	assert.equal(host.runs.identity, 1);
	const key = b.key('npc', BRENNER.node_id, BRENNER_COPY.node_id), apart = b.key('npc', PETE.node_id, BENSON.node_id);
	const [relation] = await b.relations();
	assert.equal(relation.relation_id, `rel-identity-${BRENNER_COPY.node_id}-to-${BRENNER.node_id}`);
	const meta = await b.meta();
	assert.deepEqual(relation.properties.identity_review, {by: 'review', job_id: job.job_id, key, reason: 'Both pages describe the one town doctor.', generation: meta.generation});
	assert.deepEqual(meta.reading.identity[apart], {verdict: 'different', kind: 'npc', nodes: [PETE.node_id, BENSON.node_id], by: 'review', job_id: job.job_id,
		reason: 'Page 1 is a drifter; page 2 is the hardware store owner.', generation: meta.generation}, '§191.1\'s record of a reviewed distinct_from');
	assert.equal((await b.queue()).find(row => row.job_id === job.job_id).state, 'completed');
	assert.ok(host.rows.some(row => row.event === 'node_identity_published' && row.same === 1 && row.different === 1));
	// The host's read-ahead after the finish found nothing left to ask; neither pair is a candidate again.
	assert.deepEqual(api.repairCandidates(b.mid, await b.raw(), meta, []), []);
	assert.equal((await b.identityJobs()).length, 1, 'the pair a verdict answered is never queued again');
	assert.equal((await b.ahead()).identity_repair, undefined);
	assert.equal((await b.graph()).resolve('Dr Brenner', ['npc']).node_id, BRENNER.node_id);
});

test('§191.5 a reviewer that opens no page of a side is asked once more, then fails the job; the read-ahead asks again until three failures', async () => {
	const b = await book('unread');
	await seed(b, [BRENNER]);
	await seed(b, [BRENNER_COPY]);
	await b.ahead();
	const host = service(b, {identity: same('They match.'), reads: false});
	for (let round = 1; round <= 3; round++) {
		const job = await claimIdentity(b);
		await host.run(job);
		const failed = (await b.identityJobs()).filter(row => row.state === 'failed');
		assert.equal(failed.length, round, `round ${round} failed its job`);
		assert.equal(failed.at(-1).refusal.rule, 'node_identity_unavailable');
		assert.match(failed.at(-1).detail, /Open a page of npc-brenner/);
	}
	assert.equal(host.runs.identity, 6, 'each job asked the reviewer twice: once more with the reason');
	assert.deepEqual(await b.relations(), [], 'nothing was merged on an unread answer');
	await b.ahead();
	assert.equal((await b.identityJobs()).filter(row => ['queued', 'running'].includes(row.state)).length, 0, 'three failures end the asking');
});

test('§191.5 the kernel refuses an identity answer that skips a pair, a side the reader never opened, or the protocol', async () => {
	const b = await book('kernel-checks');
	await seed(b, [BRENNER, PETE]);
	await seed(b, [BRENNER_COPY, BENSON]);
	await b.ahead();
	const job = await claimIdentity(b), file = join(job.work_dir, 'node-identity.json');
	const [doctor, men] = job.node_identity.pairs;
	const finish = () => b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', node_identity_path: file});
	const refused = async (message) => {
		await assert.rejects(finish(), error => { assert.equal(error.details?.reason, 'node_identity_invalid', error.message); assert.match(error.message, message); return true; });
	};
	await save(join(job.work_dir, 'observations.json'), {file_sha256: b.sha, read_pages: [1, 2], full_pages: [], review_pages: []});
	await save(file, {protocol: 'node-identity-v1', verdicts: [{key: doctor.key, verdict: 'same', reason: 'One doctor.'}]});
	await refused(/no verdict for/);
	await save(file, {verdicts: [{key: doctor.key, verdict: 'same', reason: 'One doctor.'}, {key: men.key, verdict: 'different', reason: 'Two men.'}]});
	await refused(/protocol/);
	await save(file, {protocol: 'node-identity-v1', verdicts: [{key: doctor.key, verdict: 'same', reason: 'One doctor.'}, {key: men.key, verdict: 'different', reason: 'Two men.'}]});
	await save(join(job.work_dir, 'observations.json'), {file_sha256: b.sha, read_pages: [1], full_pages: [], review_pages: []});
	await refused(/opened no page of npc-brenner-later, npc-peter-benson/);
	assert.deepEqual(await b.relations(), []);
	await save(join(job.work_dir, 'observations.json'), {file_sha256: b.sha, read_pages: [1, 2], full_pages: [], review_pages: []});
	const done = await finish();
	assert.deepEqual([done.node_identity.same, done.node_identity.different], [1, 1]);
	assert.throws(() => nodeIdentityVerdicts({verdicts: [{key: 'k', verdict: 'maybe', reason: 'r'}]}, [{key: 'k'}]), /same, different, unsure/);
	assert.equal(nodeIdentityVerdicts({verdicts: [{key: 'k', verdict: 'unsure', reason: 'The pages do not say.'}]}, [{key: 'k'}], {complete: true})[0].verdict, 'unsure');
	assert.throws(() => nodeIdentityVerdicts({verdicts: [{key: 'k', verdict: 'same', reason: ' '}]}, [{key: 'k'}]), /reason/);
	assert.throws(() => nodeIdentityVerdicts({verdicts: [{key: 'x', verdict: 'same', reason: 'r'}]}, [{key: 'k'}], {complete: true}), /not asked/);
});

test('§191.5 the library is never written while a live fork holds its lineage; that fork\'s repair is adopted and keeps it', async () => {
	const b = await book('lineage');
	await seed(b, [STORE]);
	await seed(b, [STORE_COPY]);
	await b.campaign('behind');
	// The library publishes once more (its own reading), so the earlier fork is no longer its lineage; the later one is.
	await seed(b, [scene('scene-junkyard', 'Junkyard', P2)]);
	await b.campaign('leading');
	assert.deepEqual([await api.libraryLineage(b.context, 'behind', b.mid), await api.libraryLineage(b.context, 'leading', b.mid)], ['library_advanced', 'lineage']);
	const library = (await b.meta()).generation;
	const behind = await b.ahead('behind');
	assert.equal(behind.identity_repair.state, 'published', 'the fork that loads is repaired in its own new generation');
	assert.deepEqual(behind.identity_repair.library_sync, {state: 'skipped', reason: 'library_advanced'});
	assert.deepEqual(behind.identity_repair.library_repair, {state: 'skipped', reason: 'lineage_held', holders: ['leading'], merged: 0, imported: 0, written: 0, open: 0});
	assert.equal((await b.meta()).generation, library, 'the library is untouched');
	assert.equal(await api.libraryLineage(b.context, 'leading', b.mid), 'lineage', 'the leading fork keeps its lineage');
	const leading = await b.ahead('leading');
	assert.equal(leading.identity_repair.library_sync.state, 'published', 'the lineage fork\'s repair is adopted (§184.1)');
	assert.equal((await b.meta()).generation, library + 1);
	assert.deepEqual((await b.relations()).map(rel => rel.relation_id), [`rel-identity-${STORE_COPY.node_id}-to-${STORE.node_id}`]);
	assert.equal(await api.libraryLineage(b.context, 'leading', b.mid), 'lineage', 'and keeps its lineage');
	assert.equal((await b.ahead('leading')).identity_repair, undefined);
	assert.equal((await b.ahead()).identity_repair, undefined, 'the library\'s own read-ahead has nothing left');
	assert.equal((await b.meta()).generation, library + 1, 'a second load writes nothing');
});

test('§191.5 with no fork holding its lineage, the library is repaired by its own publication and takes the loading fork\'s reviewed decisions', async () => {
	const b = await book('library-own');
	await seed(b, [STORE, BRENNER]);
	await seed(b, [STORE_COPY, BRENNER_COPY]);
	await b.campaign('table');
	await seed(b, [scene('scene-junkyard', 'Junkyard', P2)]);
	assert.equal(await api.libraryLineage(b.context, 'table', b.mid), 'library_advanced');
	const library = (await b.meta()).generation;
	const loaded = await b.ahead('table');
	assert.equal(loaded.identity_repair.library_repair.state, 'published', JSON.stringify(loaded.identity_repair));
	assert.equal(loaded.identity_repair.library_repair.merged, 1, 'the owner\'s rule, in the library\'s own generation');
	assert.equal((await b.meta()).generation, library + 1);
	// The fork asks its open pair; its reviewed `same` reaches the library by the library's own publication.
	const job = await claimIdentity(b, 'table');
	await service(b, {identity: same('Both pages describe the one town doctor.'), campaign: 'table'}).run(job);
	const doctor = (await b.relations()).find(rel => rel.from_node_id === BRENNER_COPY.node_id);
	assert.ok(doctor, 'the library took the fork\'s verdict');
	const fork = (await b.meta('table')).generation;
	assert.deepEqual(doctor.properties.identity_review, {by: 'review', job_id: job.job_id, key: b.key('npc', BRENNER.node_id, BRENNER_COPY.node_id),
		reason: 'Both pages describe the one town doctor.', imported_from: {store: 'campaign', campaign: 'table', generation: fork}, generation: library + 2});
	assert.equal((await b.identityJobs()).length, 0, 'the library asked nothing of its own');
	assert.equal((await b.ahead()).identity_repair, undefined);
});

test('§191.5 a fork takes the library\'s reviewed decisions instead of asking again', async () => {
	const b = await book('fork-takes');
	const guard = npc('npc-guard', 'Guard', P1, {summary: 'A guard at the gate.'}), gateGuard = npc('npc-guard-base', 'Guard', P2, {summary: 'A guard at the base.'});
	await seed(b, [BRENNER, PETE, guard]);
	await seed(b, [BRENNER_COPY, BENSON, gateGuard]);
	await b.campaign('early');
	// The library answers its own pairs (its own read-ahead, no fork holds its lineage after this publication).
	await seed(b, [scene('scene-junkyard', 'Junkyard', P2)]);
	await b.ahead();
	const unsureGuard = pair => pair.a.node_id === guard.node_id ? {verdict: 'unsure', reason: 'Neither page says which gate.'} : differentPete(pair);
	await service(b, {identity: unsureGuard}).run(await claimIdentity(b));
	const decided = await b.meta();
	assert.deepEqual(Object.values(decided.reading.identity).map(record => record.verdict).sort(), ['different', 'unsure']);
	const loaded = await b.ahead('early');
	assert.deepEqual([loaded.identity_repair.imported, loaded.identity_repair.open], [3, 0], JSON.stringify(loaded.identity_repair));
	assert.equal(loaded.identity_repair.asked, undefined, 'the fork asks nothing the library answered');
	const meta = await b.meta('early'), key = b.key('npc', PETE.node_id, BENSON.node_id);
	assert.equal(meta.reading.identity[key].verdict, 'different');
	assert.deepEqual(meta.reading.identity[key].imported_from, {store: 'library', generation: decided.generation});
	assert.equal(meta.reading.identity[b.key('npc', guard.node_id, gateGuard.node_id)].verdict, 'unsure', 'an unsure travels too, so the fork does not ask it');
	assert.ok((await b.relations('early')).some(rel => rel.from_node_id === BRENNER_COPY.node_id && rel.properties.identity_review.imported_from.store === 'library'));
});

test('§191.5 the repair is maintenance: a library record it cannot read is reported, and the table opening\'s read-ahead repairs the fork and goes on', async () => {
	const b = await book('library-unreadable');
	await seed(b, [STORE]);
	await seed(b, [STORE_COPY]);
	await b.campaign('table');
	await writeFile(join(b.store().moduleDir(b.mid), 'module.json'), '{"id": ');
	// The kernel's own read-ahead at a table's opening (`kernel-ts/write/index.ts`), which waits on no merge.
	const modules = api.createModuleRuntime(b.context);
	closers.push(() => modules.close());
	const opened = await modules.source.ahead({module_id: b.mid, campaign: 'table'});
	assert.equal(opened.identity_repair.state, 'published', JSON.stringify(opened.identity_repair));
	assert.equal(opened.identity_repair.library_sync.state, 'failed');
	assert.equal(opened.identity_repair.library_repair.state, 'failed');
	assert.ok(Array.isArray(opened.queued) && opened.window, 'the read-ahead answered as it always does');
	assert.deepEqual((await b.relations('table')).map(rel => rel.relation_id), [`rel-identity-${STORE_COPY.node_id}-to-${STORE.node_id}`]);
});

test('§191.5 DUP-03b doubt never splits: unsure keeps a cast-folded pair one person and is never asked again; different splits; same writes the relation', async () => {
	const b = await book('doubt');
	// Three people the cast holds as one individual each, read twice under two different own names (Blood Road's Sutton,
	// Alissya and Brenner): no name raises them, the cast does, and a verdict job is asked.
	const row = (id, forms) => ({id, book: forms, play: forms, notes: forms, pages: [1, 2]});
	await save(join(b.store().moduleDir(b.mid), 'cast.json'), {version: api.CAST_VERSION, source_sha256: b.sha, state: 'complete', ranges_done: 1, ranges_total: 1,
		people: [row('cast-sutton', ['Matthew Peter Sutton', 'Matthew Sutton', 'Peter Sutton']), row('cast-alissya', ['Alissya Ssrissi Ana', 'Alissya', 'Ssrissi Ana']),
			row('cast-brenner', ['Robert L. Brenner', 'Robert Brenner', 'Dr Brenner'])]});
	const person = (id, name, full, refs) => npc(id, name, refs, {aliases: [full], summary: `${name}, as one page names them.`});
	const SUTTON = [person('npc-matthew-sutton', 'Matthew Sutton', 'Matthew Peter Sutton', P1), person('npc-peter-sutton', 'Peter Sutton', 'Matthew Peter Sutton', P2)];
	const ALISSYA = [person('npc-alissya', 'Alissya', 'Alissya Ssrissi Ana', P1), person('npc-ssrissi-ana', 'Ssrissi Ana', 'Alissya Ssrissi Ana', P2)];
	const ROBERT = [person('npc-robert-brenner', 'Robert Brenner', 'Robert L. Brenner', P1), person('npc-dr-brenner', 'Dr Brenner', 'Robert L. Brenner', P2)];
	await seed(b, [SUTTON[0], ALISSYA[0], ROBERT[0]]);
	await seed(b, [SUTTON[1], ALISSYA[1], ROBERT[1]]);
	const asked = await b.ahead();
	assert.deepEqual([asked.identity_repair.merged, asked.identity_repair.open], [0, 3], JSON.stringify(asked.identity_repair));
	const job = await claimIdentity(b);
	assert.deepEqual(job.node_identity.pairs.map(pair => [pair.a.node_id, pair.b.node_id, pair.raised_by]), [
		['npc-alissya', 'npc-ssrissi-ana', 'cast'], ['npc-dr-brenner', 'npc-robert-brenner', 'cast'], ['npc-matthew-sutton', 'npc-peter-sutton', 'cast']]);
	const answers = {'npc-matthew-sutton': {verdict: 'unsure', reason: 'Page 2 names a Peter Sutton but never says whether he is Matthew.'},
		'npc-alissya': {verdict: 'different', reason: 'Page 1 is the girl; page 2 is her mother, who shares the family name.'},
		'npc-dr-brenner': {verdict: 'same', reason: 'Both pages describe the one town doctor.'}};
	const host = service(b, {identity: pair => answers[pair.a.node_id]});
	await host.run(job);
	const meta = await b.meta(), key = pair => b.key('npc', ...pair.map(node => node.node_id).sort());
	assert.deepEqual(meta.reading.identity[key(SUTTON)], {verdict: 'unsure', kind: 'npc', nodes: ['npc-matthew-sutton', 'npc-peter-sutton'], by: 'review',
		job_id: job.job_id, reason: answers['npc-matthew-sutton'].reason, generation: meta.generation}, 'an unsure is kept under the pair\'s key');
	assert.equal(meta.reading.identity[key(ALISSYA)].verdict, 'different');
	assert.deepEqual((await b.relations()).map(rel => rel.relation_id), ['rel-identity-npc-dr-brenner-to-npc-robert-brenner'], 'only same writes a relation');
	assert.ok(host.rows.some(r => r.event === 'node_identity_published' && r.same === 1 && r.different === 1 && r.unsure === 1), JSON.stringify(host.rows));
	// Never asked again: no candidate is left, and the next read-ahead is quiet.
	assert.deepEqual(api.repairCandidates(b.mid, await b.raw(), meta, (await b.campaignCast())), []);
	assert.equal((await b.ahead()).identity_repair, undefined);
	assert.equal((await b.identityJobs()).length, 1);
	// Read as a table reads it (the campaign loader installs the cast fold and the verdicts): the unsure pair stays one person,
	// the different pair is two, the same pair is one by its relation.
	await b.campaign('table');
	const world = {active_scene: 'scene-main-street'}, loaded = (await api.loadCampaignModule(b.context, b.mid, world, 'table')).graph;
	const persons = api.bookCast(loaded).filter(each => each.nodes.length).map(each => each.nodes.map(node => node.node_id).sort());
	assert.ok(persons.some(ids => JSON.stringify(ids) === JSON.stringify(['npc-matthew-sutton', 'npc-peter-sutton'])), `Sutton is one person: ${JSON.stringify(persons)}`);
	assert.ok(persons.some(ids => JSON.stringify(ids) === JSON.stringify(['npc-dr-brenner', 'npc-robert-brenner'])), 'Brenner is one person');
	assert.ok(persons.some(ids => JSON.stringify(ids) === JSON.stringify(['npc-alissya'])) && persons.some(ids => JSON.stringify(ids) === JSON.stringify(['npc-ssrissi-ana'])),
		`Alissya and Ssrissi Ana are two: ${JSON.stringify(persons)}`);
	assert.equal(loaded.resolve('Peter Sutton', ['npc']).node_id, loaded.resolve('Matthew Sutton', ['npc']).node_id, 'either name resolves to the one Sutton');
	assert.notEqual(loaded.resolve('Ssrissi Ana', ['npc']).node_id, loaded.resolve('Alissya', ['npc']).node_id);
	// Told through one copy, the unsure pair's person is told; the different pair's other person is not.
	const told = api.untoldRoster(loaded, world, {entries: {'npc-peter-sutton': {named_at: 1}, 'npc-alissya': {named_at: 1}}}, []);
	assert.ok(!told.some(entry => ['Matthew Sutton', 'Peter Sutton', 'Matthew Peter Sutton'].includes(entry.name)), `Sutton told through his copy: ${JSON.stringify(told.map(e => e.name))}`);
	assert.ok(told.some(entry => entry.name === 'Ssrissi Ana'), 'the different one is still untold');
});
