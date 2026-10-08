import {playtestScratch} from './playtest-scratch.mjs';
/**
 * Contract §199.2–§199.3 (docs/specs/graph-grounding.md GG-01, GG-02): a person's statements of who they are -- the summary and
 * the first-meeting appearance -- are reviewed one by one against the page, never advisory and never cleared by Jev; and a
 * person's summary is read apart from its pages (the person-state reading), so a summary that kills a living man is refused
 * even when the vision reviewer supports it, as the live reviewer did (GG-05).
 *
 * Real table TR-F2 run 2 (Cold Harvest, library generation 74): reading `read-30` wrote Vasili Smolsky's summary
 * 「嘉琳娜已故的丈夫。」 ("Galena's late husband") from page 34, where the book prints 「瓦西里曾是嘉琳娜的丈夫……嘉琳娜死后他变得愈发
 * 沮丧。」 -- he was her husband because she is dead. The reviewer answered the record `/nodes/5` supported with a reason that
 * restated the page correctly; under module-logic-v1 that one verdict stood for the summary too. The Keeper then told the
 * player the husband was dead. These cases travel the real path: the kernel in process over a bound PDF, `module.read.claim`,
 * the reader's own checker (`checkSourceDraft`), `module.read.finish`, and the host's ReadingService with its reader and
 * reviewer children played by a fixture runtime whose verdicts are the words a reviewer gives (GG-05 records the live run).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {appendFile, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {gateRefusal, reviewUnits} from '../../extensions/module/reader-review.ts';
import {repairDecision} from '../../extensions/module/targeted-repair.ts';
import {claimSupportIneligibility} from '../../kernel-ts/modules/claim-support.ts';
import {PERSON_KIND, personStatementPath} from '../../kernel-ts/modules/review-verdicts.ts';
import {mismatchRows, personRoster, personStatements, shapePageReadings, shapeStatementReadings, stateMismatches} from '../../extensions/module/person-state.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content');
const directory = playtestScratch('graph-grounding', 'suite-');
await build({stdin: {contents: [
	`export {createKernelContext} from './kernel-ts/context.ts';`,
	`export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
	`export {createKernelRuntime} from './kernel-ts/registry.ts';`,
	`export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
	`export {checkSourceDraft} from './kernel-ts/check.ts';`,
	`export {pythonJsonDumps} from './kernel-ts/json.ts';`,
].join('\n'), resolveDir: ROOT, sourcefile: 'graph-grounding-api.ts', loader: 'ts'},
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
const delta = (nodes, claims = [], ready = nodes.map(node => node.node_id)) => ({nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready});

/** Cold Harvest p34 / p8, Vasili's entry. */
const PAGE_34 = '瓦西里曾是嘉琳娜的丈夫，性格温顺，希望能取悦每一个有权有势的人。嘉琳娜死后他变得愈发沮丧。他秃顶，带着一副厚厚的总让人联想到功利主义者的眼镜，有一个鹰钩鼻。';
/** What read-30 wrote: the husband made dead. */
const LATE_HUSBAND = '嘉琳娜已故的丈夫。';
/** What the page says of him. */
const HUSBAND_OF_THE_DEAD = '嘉琳娜的丈夫；嘉琳娜死后他愈发沮丧。';
/** A reviewer's words on read-30's summary, given the summary as its own pointer (GG-05, live). */
const REFUSED_BECAUSE = 'Page 34 says Vasili was Galena\'s husband and grew more depressed after her death; the summary makes him the one who is dead.';
const vasili = (summary, extra = {}) => ({node_id: 'npc-vasili-viktorovich-smolsky', node_kind: 'npc', name: '瓦西里·维克托罗维奇·斯莫斯基', source_refs: P2,
	summary, properties: {agenda: '性格温顺，希望取悦每个有权有势的人。', fear: '嘉琳娜死后愈发沮丧。', appearance: '秃顶，戴一副厚厚的眼镜，有一个鹰钩鼻。', ...extra}});
const pond = {node_id: 'location-north-pond', node_kind: 'location', name: '北边的池塘', source_refs: P2, summary: '嘉琳娜溺死的池塘。'};

/** A bound PDF with its index and opening published through the real kernel (as `duplicate-of-published.test.mjs` builds one). */
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
	const b = {workspace, mid, sha, kernel};
	b.call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
	b.claim = (params = {}) => b.call('module.read.claim', {owner: 'test-host', ...params});
	b.meta = async () => JSON.parse(await readFile(join(workspace, '.coc/modules', mid, 'module.json'), 'utf8'));
	b.graph = async () => { const meta = await b.meta(); return new api.ModuleGraph(mid, JSON.parse(await readFile(join(workspace, '.coc/modules', mid, meta.graph_file), 'utf8')), '', {}); };
	b.queue = async () => JSON.parse(await readFile(join(workspace, '.coc/modules', mid, 'deepen-queue.json'), 'utf8'));
	b.check = async (job, draft) => {
		await save(join(job.work_dir, 'draft.json'), draft);
		return api.checkSourceDraft(CONTENT, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'));
	};
	b.publish = async (job, draft, review = paths => [{paths, verdict: 'supported', source_refs: P2, reason: 'fixture support'}]) => {
		await save(join(job.work_dir, 'observations.json'), {file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]});
		const checked = job.purpose === 'index' ? {required_review: []} : await b.check(job, draft);
		if (job.purpose === 'index') await save(join(job.work_dir, 'draft.json'), draft);
		await save(join(job.work_dir, 'review.json'), {checked: review(checked.required_review ?? []), missing: []});
		return b.call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'),
			review_path: join(job.work_dir, 'review.json')});
	};
	await b.call('module.read.request', {purpose: 'index'});
	await b.publish(await b.claim(), {title: 'Cold Harvest', language: 'zh-Hans', sections: [{name: 'Office', pages: [[1, 1]], entities: ['Office']},
		{name: 'People', pages: [[2, 2]], entities: ['Vasili']}], map_candidates: []});
	await b.call('module.read.request', {purpose: 'opening'});
	const opened = await b.publish(await b.claim(), delta([
		{node_id: 'scene-office', node_kind: 'scene', name: 'Office', source_refs: P1, properties: {is_entrance: true}},
		{node_id: 'scene-farm', node_kind: 'scene', name: 'Farm', source_refs: P2, summary: 'The farm.', properties: {is_final: true}}],
	[{subject_id: 'scene-office', predicate: 'route-to', object: {node_id: 'scene-farm'}, truth_status: 'authored-fact', source_refs: P1}], ['scene-office']));
	assert.equal(opened.opening_ready, true);
	return b;
}
async function claimDetail(b, focus) {
	await b.call('module.read.request', {purpose: 'detail', focus, question: `Prepare ${focus}`, foreground: true});
	const job = await b.claim();
	assert.equal(job.focus, focus);
	assert.equal(job.review_policy, 'module-logic-v1', 'a PDF detail reading is reviewed under module-logic-v1, where records fold');
	return job;
}
async function refusal(promise) {
	try { await promise; } catch (error) { return error; }
	assert.fail('the publication was expected to be refused');
}

test('§199.2: the checker owes a person\'s summary and appearance as their own pointers; a place\'s summary still folds into its record', async () => {
	const b = await book('owed');
	const job = await claimDetail(b, 'vasili');
	const checked = await b.check(job, delta([vasili(LATE_HUSBAND), pond]));
	assert.equal(checked.ok, true, JSON.stringify(checked.error ?? null));
	for (const path of ['/nodes/0', '/nodes/0/summary', '/nodes/0/properties/appearance'])
		assert.ok(checked.required_review.includes(path), `${path} is owed: ${JSON.stringify(checked.required_review)}`);
	assert.ok(!checked.required_review.some(path => path.startsWith('/nodes/0/properties/agenda')), 'other fields stay with the record');
	assert.ok(!checked.required_review.includes('/nodes/1/summary'), 'a place is no person');
	// A person who writes no summary and no appearance owes neither.
	const bare = await b.check(job, delta([{...vasili(undefined, {appearance: undefined}), summary: undefined}]));
	assert.ok(!bare.required_review.some(path => path.startsWith('/nodes/0/') ), JSON.stringify(bare.required_review));
});

test('§199.2: the page refuses "Galena\'s late husband": an unsupported summary refuses the reading even when the reviewer calls it a presentation difference', async () => {
	const b = await book('refused');
	const job = await claimDetail(b, 'vasili');
	const error = await refusal(b.publish(job, delta([vasili(LATE_HUSBAND)]), paths => [
		{paths: paths.filter(path => path !== '/nodes/0/summary'), verdict: 'supported', source_refs: P2, reason: 'fixture support'},
		{paths: ['/nodes/0/summary'], verdict: 'unsupported', impact: 'presentation', source_refs: P2, reason: REFUSED_BECAUSE}]));
	assert.deepEqual([error.code, error.details.rule, error.details.path], ['invalid_params', 'review_unsupported', '/nodes/0/summary']);
	// The record's root answered alone does not answer the summary (read-30's review).
	const omitted = await refusal(b.publish(job, delta([vasili(LATE_HUSBAND)]), () => [
		{paths: ['/nodes/0', '/coverage'], verdict: 'supported', source_refs: P2,
			reason: 'Vasili is Galina\'s former husband; he is mild-mannered and seeks to please the powerful, and became more depressed after her death.'}]));
	assert.equal(omitted.details.rule, 'review_incomplete');
	assert.ok(omitted.details.required_review.includes('/nodes/0/summary'));
	assert.ok(!(await b.graph()).nodes.has('npc-vasili-viktorovich-smolsky'), 'nothing was published');
});

test('§199.2: the summary the page states is published as written', async () => {
	const b = await book('supported');
	await b.publish(await claimDetail(b, 'vasili'), delta([vasili(HUSBAND_OF_THE_DEAD)]), paths => [
		{paths, verdict: 'supported', source_refs: P2, reason: `Page 34: ${PAGE_34}`}]);
	assert.equal((await b.graph()).nodes.get('npc-vasili-viktorovich-smolsky').summary, HUSBAND_OF_THE_DEAD);
});

test('§199.2–§199.3 at the host: the statement keeps its own review unit and is never advisory there; the repair is targeted at it; Jev never clears a person', () => {
	const draft = delta([vasili(LATE_HUSBAND), pond]);
	assert.equal(PERSON_KIND, 'npc');
	assert.equal(personStatementPath(draft, '/nodes/0/summary'), true);
	assert.equal(personStatementPath(draft, '/nodes/0/properties/appearance'), true);
	assert.equal(personStatementPath(draft, '/nodes/0/properties/agenda'), false);
	assert.equal(personStatementPath(draft, '/nodes/1/summary'), false, 'a place');
	const units = reviewUnits(draft, ['/nodes/0', '/nodes/0/summary', '/nodes/0/properties/appearance', '/nodes/1/summary'], undefined, true);
	assert.ok(units.some(unit => unit.includes('/nodes/0/summary') && unit.includes('/nodes/0/properties/appearance')), 'module-logic-v1 does not fold them');
	assert.ok(!units.some(unit => unit.includes('/nodes/1/summary')), 'a place\'s summary still folds into its record');
	const task = {review_policy: 'module-logic-v1'}, refuses = gateRefusal(task, draft);
	assert.equal(refuses({verdict: 'unsupported', impact: 'presentation'}, '/nodes/0/summary'), true);
	assert.equal(refuses({verdict: 'contested', impact: 'presentation'}, '/nodes/0/properties/appearance'), true);
	assert.equal(refuses({verdict: 'unsupported', impact: 'presentation'}, '/nodes/0/properties/voice'), false, 'other fields stay advisory');
	const review = {checked: [{paths: ['/nodes/0', '/nodes/1'], verdict: 'supported', source_refs: P2, reason: 'fixture'},
		{paths: ['/nodes/0/summary'], verdict: 'unsupported', impact: 'presentation', source_refs: P2, reason: REFUSED_BECAUSE}], missing: []};
	const decision = repairDecision(draft, review, task);
	assert.equal(decision.kind, 'targeted');
	assert.deepEqual(decision.refused.map(row => [row.path, row.reason]), [['/nodes/0/summary', REFUSED_BECAUSE]]);
	assert.equal(claimSupportIneligibility(draft, '/nodes/0', () => true, () => false), 'person');
	assert.equal(claimSupportIneligibility(draft, '/nodes/1', () => true, () => false), null, 'a place stays eligible');
});

/** The person-state readers, as fixture children: each reads only its own input and answers as the model did when asked apart. */
async function personStateReader(request, seen) {
	const input = JSON.parse(await readFile(join(request.cwd, 'input.json'), 'utf8'));
	if (request.systemPrompt.endsWith('person-state-statements.md')) {
		seen.statements.push(input);
		// Asked alone, the model reads 「嘉琳娜已故的丈夫。」 as Vasili dead (3/3, GG-05) and the page's own wording as nothing of the kind.
		await save(join(request.cwd, 'readings.json'), Object.fromEntries(input.statements.map(row => [row.key, row.text === LATE_HUSBAND ? {[row.about]: 'dead'} : {}])));
	} else {
		seen.pages.push(input);
		// Asked alone, the model reads page 34 as Vasili alive (3/3).
		await save(join(request.cwd, 'readings.json'), Object.fromEntries(input.people.map(person => [person.key, input.pages.some(page => page.text.includes('嘉琳娜死后')) ? 'alive' : 'not_stated'])));
	}
	return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
}

test('§199.2 through the host: the vision reviewer supports "Galena\'s late husband" (as live), the person-state reading refuses it, the targeted repair corrects only it, and the living husband is published', async () => {
	const b = await book('host');
	const job = await claimDetail(b, 'vasili');
	const seen = {reads: 0, repairs: [], units: [], statements: [], pages: []};
	const reading = new ReadingService({home: b.workspace, model: () => ({id: 'fixture/vision', vision: true, thinking: 'off'}), progress() {}, record() {},
		call: (method, params) => b.kernel(method, params), runtime: {contentRoot: CONTENT,
			async runTask({request}) {
				if (request.systemPrompt?.includes('person-state-')) return personStateReader(request, seen);
				const task = JSON.parse(await readFile(join(request.cwd, 'task.json'), 'utf8'));
				const cache = resolve(request.source.cache), pages = [1, 2];
				if (request.prompt?.phase === 'read') {
					seen.reads++;
					seen.repairs.push(task.repair ?? null);
					// The repair round changes only what the review refused: the summary, to what the page says.
					await save(join(request.cwd, 'draft.json'), delta([vasili(seen.reads === 1 ? LATE_HUSBAND : HUSBAND_OF_THE_DEAD)]));
				} else {
					seen.units.push(task.required_review);
					// The live reviewer's verdict on read-30 under §199.2's own pointer: supported, every time.
					await save(join(request.cwd, 'review.json'), {checked: [{paths: task.required_review, verdict: 'supported', source_refs: P2,
						reason: 'Page 34 identifies Smolsky as Galina\'s husband and explicitly says she died; the summary correctly calls him her late husband.'}], missing: []});
				}
				const call = `pages-${Math.random().toString(16).slice(2)}`;
				for (const page of pages)
					await appendFile(join(cache, 'requests.jsonl'), JSON.stringify({file_sha256: b.sha, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1]}) + '\n');
				request.onEvent?.({type: 'tool_execution_end', toolCallId: call, isError: false,
					result: {content: [{type: 'image'}], details: {kind: 'source_pages', observations: pages.map(page => ({path: join(cache, `page-${page}.png`), page}))}}});
				await appendFile(request.eventLog + '.images.jsonl', JSON.stringify({included: [call]}) + '\n');
				return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
			},
			async sourceText({pages}) { return {file_sha256: b.sha, extraction_version: 'test', snapshots: pages.map(page => ({page, text: page === 2 ? PAGE_34 : '办公室。', text_sha256: ''}))}; },
			check: ({packet: path, draft}) => api.checkSourceDraft(CONTENT, path, draft), async sourceInfo() { throw new Error('not a guidance job'); }}});
	closers.push(() => reading.close());
	await reading.runJob(job, new AbortController().signal);
	assert.ok(seen.units.some(paths => paths.includes('/nodes/0/summary')), 'a reviewer was assigned the summary as written');
	// The two readings never see each other.
	assert.equal(seen.statements.length, 2, 'one statements reading per verify round');
	assert.ok(!JSON.stringify(seen.statements).includes('嘉琳娜死后他变得愈发沮丧'), 'the statements reader is shown no page');
	assert.ok(!JSON.stringify(seen.pages).includes(LATE_HUSBAND), 'the pages reader is shown no summary');
	assert.ok(!JSON.stringify([seen.statements, seen.pages]).includes('npc-vasili'), 'nor any node id');
	const evidence = JSON.parse(await readFile(join(job.work_dir, 'verify-1', 'person-state.json'), 'utf8'));
	assert.deepEqual(evidence.mismatches, [{path: '/nodes/0/summary', person: 'p1', said: 'dead', pages: 'alive'}]);
	assert.equal(seen.reads, 2, 'one repair round');
	assert.equal(seen.repairs[1]?.kind, 'targeted');
	assert.deepEqual(seen.repairs[1].refused.map(row => row.path), ['/nodes/0/summary']);
	assert.match(seen.repairs[1].refused[0].reason, /the summary calls 瓦西里·维克托罗维奇·斯莫斯基 dead, but the cited pages \(p2\) say 瓦西里·维克托罗维奇·斯莫斯基 is alive/);
	assert.equal((await b.queue()).find(row => row.job_id === job.job_id).state, 'completed');
	assert.equal((await b.graph()).nodes.get('npc-vasili-viktorovich-smolsky').summary, HUSBAND_OF_THE_DEAD, 'the living husband of a dead woman');
});

test('§199.2 the comparison: a summary that kills a man the page keeps alive is refused; one that says nothing, or the page\'s own state, is not', () => {
	const galena = {node_id: 'npc-galena-petrovna-smolskaya', node_kind: 'npc', name: '嘉琳娜·彼得罗夫娜·斯莫斯卡娅', aliases: ['嘉琳娜'], source_refs: P2};
	const draft = delta([vasili(LATE_HUSBAND), pond, {...vasili(HUSBAND_OF_THE_DEAD), node_id: 'npc-boris'}]);
	const found = personStatements(draft);
	assert.deepEqual(found.map(row => [row.path, row.text, row.pages]), [['/nodes/0/summary', LATE_HUSBAND, [2]], ['/nodes/2/summary', HUSBAND_OF_THE_DEAD, [2]]],
		'persons only: a place\'s summary is no person statement');
	const people = personRoster(draft, {known_nodes: [galena]});
	assert.deepEqual(people.map(row => [row.key, row.id]), [['p1', 'npc-vasili-viktorovich-smolsky'], ['p2', 'npc-boris'], ['p3', 'npc-galena-petrovna-smolskaya']],
		'the statements\' subjects first, then the published persons');
	const statements = found.map((row, index) => ({...row, key: `s${index + 1}`, about: people[index].key}));
	const said = shapeStatementReadings({s1: {p1: 'dead'}, s2: {p3: 'dead'}}, ['s1', 's2'], ['p1', 'p2', 'p3']);
	const read = shapePageReadings({p1: 'alive', p2: 'not_stated', p3: 'dead'}, ['p1', 'p2', 'p3']);
	const mismatches = stateMismatches(statements, said, read);
	assert.deepEqual(mismatches, [{path: '/nodes/0/summary', person: 'p1', said: 'dead', pages: 'alive'}]);
	const [row] = mismatchRows(mismatches, statements, people);
	assert.deepEqual([row.paths, row.verdict, row.impact, row.reviewer, row.source_refs], [['/nodes/0/summary'], 'unsupported', 'logic', 'person-state', [{page: 2}]]);
	// Dead on the summary and silent on the page is refused too; alive on the summary and silent on the page is not.
	assert.deepEqual(stateMismatches(statements, {s1: {p2: 'dead'}, s2: {p2: 'alive'}}, {p1: 'alive', p2: 'not_stated', p3: 'dead'}).map(row => row.path), ['/nodes/0/summary']);
	assert.deepEqual(stateMismatches(statements, {s1: {}, s2: {p3: 'alive'}}, {p1: 'alive', p2: 'alive', p3: 'dead'}).map(row => row.path), ['/nodes/2/summary'],
		'a summary that keeps the dead woman alive is refused');
	// The readers' shapes are closed.
	for (const bad of [{s1: {p1: 'dead'}}, {s1: {p1: 'gone'}, s2: {}}, {s1: {p9: 'dead'}, s2: {}}, {s1: {}, s2: {}, s3: {}}, []])
		assert.equal(shapeStatementReadings(bad, ['s1', 's2'], ['p1', 'p2', 'p3']), undefined, JSON.stringify(bad));
	for (const bad of [{p1: 'alive', p2: 'alive'}, {p1: 'alive', p2: 'alive', p3: 'maybe'}, {p1: 'alive', p2: 'alive', p3: 'dead', p4: 'dead'}])
		assert.equal(shapePageReadings(bad, ['p1', 'p2', 'p3']), undefined, JSON.stringify(bad));
});
