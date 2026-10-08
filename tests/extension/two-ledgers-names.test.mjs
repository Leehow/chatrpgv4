/**
 * Contract §194.3 and §194.4 (docs/specs/two-ledgers.md, tickets TL-04 and TL-05), on the real kernel in-process.
 *
 * Real table TR-F (Cold Harvest, App d944b6b07): the settlement record on page 10 lists the farm's residents with no
 * sentence ends, so every resident's first-mention sentence (§177.2) was a window over six to eight of them, and the epithet
 * lane gave Dimiri Kravchuk (46, stonemason, fled) his neighbour Vasili's age and trade: 「四十九岁的电工斯基」. A graph
 * person's summary reached the lane too, and the victim became 「使两家人突变的生物」. And the player held the denunciation
 * letter, which prints the writer's and the accused's names, while both stayed untold.
 *
 * The fixture is a three-page bound book shaped like Cold Harvest: the opening, the residents' list as the text layer has it
 * (wrapped lines, a name spaced out letter by letter, no sentence ends), and a page whose picture is a letter.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createUntoldSpanJudge} from '../../extensions/kernel/untold-spans.ts';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'two-ledgers-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {castEntry} from './kernel-ts/cast/entry.ts';
export {ModuleStore} from './kernel-ts/modules/store.ts';
export {ensureCampaignModule, moduleContext} from './kernel-ts/modules/campaign-scope.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const RESIDENTS = [
	'小卡片#3—居民名单',
	'居民名单，1935 年 3 月',
	'鲍里斯·加庞，53 岁，定居点管理',
	'者。',
	'瓦西里·斯莫斯基，49 岁，电工',
	'嘉琳娜·斯莫斯卡娅，51 岁，劳工',
	'安德烈·耶扎罗夫，32 岁，机械与电工',
	'安德烈·尼基京(Andrei',
	'Nikitin)，62 岁，劳工',
	'迪米尔·克拉夫楚克(Dimiri',
	'Kravchuk)，46 岁，石匠与木工—于 1937 年 6 月',
	'21 日逃跑',
	'卡 特 琳 娜 ·克 拉 夫 楚 克 (Katarina',
	'Kravchuk)，42 岁，电工—于 1937 年',
	'6 月 21 日逃跑',
	'2.3 前往农场',
	'风雪中卡车停在路口，司机说再往前就没有路了。',
];
const PAGES = [
	'指挥室里炉火很旺。阿加宁上尉把两张卡片推过桌面。',
	RESIDENTS.join('\n'),
	'44',
];
/** §191.3: the transcript's exact layer -- the same lines, its blocks separated by a blank line. */
const TRANSCRIPT_TEXT = [RESIDENTS.slice(0, 2).join('\n'), RESIDENTS.slice(2, 4).join('\n'), ...RESIDENTS.slice(4, 7),
	RESIDENTS.slice(7, 9).join('\n'), RESIDENTS.slice(9, 12).join('\n'), RESIDENTS.slice(12, 15).join('\n'), RESIDENTS[15], RESIDENTS[16]].join('\n\n');
/** The words a page transcript read off the picture of a letter (§191.3 `image_text`), printing two residents' book forms. */
const LETTER = ['NKVD Station Chief', 'However, the Kravchuk family ran off in the night. I have witnessed Dimiri Kravchuk stealing grain, and Clerk Orlov saw it.\n\nAndrei Nikitin'];
/** A text handout (its `authored_text`): a resident's name, a graph person's name, and a village whose name opens with another resident's short form. */
const NOTE = '举报信\n克拉夫楚克一家逃走那晚，我亲眼看到 Captain Aganin 也在场。\n寄自瓦西里耶夫卡村。\n嘉琳娜·斯莫斯卡娅';
const REFS = [{page: 1}];
const CAMPAIGN = 'farm';

const DRAFT = {people: [
	{book: ['鲍里斯·加庞', '加庞'], play: ['鲍里斯·加庞'], notes: ['Boris Gapon'], pages: [2]},
	{book: ['瓦西里·斯莫斯基', '瓦西里'], play: ['瓦西里·斯莫斯基'], notes: ['Vasili Smolsky'], pages: [2]},
	{book: ['嘉琳娜·斯莫斯卡娅', '嘉琳娜'], play: ['嘉琳娜·斯莫斯卡娅'], notes: ['Galena Smolskaya'], pages: [2]},
	{book: ['安德烈·耶扎罗夫', '安德烈'], play: ['安德烈·耶扎罗夫'], notes: ['Andrei Yezarov'], pages: [2]},
	{book: ['安德烈·尼基京', 'Andrei Nikitin'], play: ['安德烈·尼基京'], notes: ['Andrei Nikitin'], pages: [2]},
	{book: ['迪米尔·克拉夫楚克', 'Dimiri Kravchuk', '迪米尔', '克拉夫楚克'], play: ['迪米尔·克拉夫楚克'], notes: ['Dimiri Kravchuk'], pages: [2]},
	{book: ['卡特琳娜·克拉夫楚克', 'Katarina Kravchuk', '克拉夫楚克'], play: ['卡特琳娜·克拉夫楚克'], notes: ['Katarina Kravchuk'], pages: [2]},
]};

async function kernel(t, seed) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed,
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const attempt = async (method, params = {}) => { try { return {ok: true, result: await raw(method, params)}; } catch (error) { return {ok: false, error}; } };
	return {home, context, raw, attempt};
}

/** The bound book read as far as its opening: the graph has the office, Captain Aganin and the clerk; the cast is read. */
async function farm(t, {transcript = false} = {}) {
	const k = await kernel(t, 'two-ledgers');
	const pdf = join(k.home, 'farm.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await k.raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: sha}});
	const read = async (purpose, draft, paths) => {
		await k.raw('module.read.request', {module_id: mid, purpose});
		const job = await k.raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}], missing: []}));
		return k.raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Farm', language: 'zh-Hans', sections: [{name: 'Opening', pages: [[1, 3]], source_refs: [{page: 1}],
		entities: ['Office', 'Captain Aganin']}]}, []);
	await read('opening', {nodes: [
		{node_id: 'scene-office', node_kind: 'scene', name: 'Office', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-farm', node_kind: 'scene', name: 'Farm', source_refs: [{page: 2}], summary: 'The settlement beyond the road.'},
		{node_id: 'npc-aganin', node_kind: 'npc', name: 'Captain Aganin', source_refs: REFS,
			summary: 'Forged the denunciation himself to cover the failed harvest.',
			properties: {relationship_to_investigators: 'the commissar who sends the investigators to the farm'}},
		{node_id: 'npc-clerk', node_kind: 'npc', name: 'Clerk Orlov', source_refs: REFS,
			summary: 'Drowned the informer in the pond.',
			properties: {biography: 'A stooped clerk with ink-stained cuffs.'}}],
		claims: [{subject_id: 'scene-office', predicate: 'route-to', object: {node_id: 'scene-farm'}, truth_status: 'authored-fact', source_refs: REFS}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-office']},
		['/nodes/0', '/nodes/2', '/nodes/3', '/claims/0', '/coverage']);
	// The cast, as the host reads it (extensions/module/reading-service.ts `readCast`), with the reader's draft written by hand.
	const job = await k.raw('cast.job', {module_id: mid, claim: true});
	const staged = await k.raw('cast.source', {module_id: mid, job_id: job.job_id, lease: job.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const place = await k.raw('cast.range', {module_id: mid, job_id: job.job_id, lease: job.lease, index: staged.ranges[0].index});
	await writeFile(join(place.cwd, 'draft.json'), JSON.stringify(DRAFT));
	const submitted = await k.raw('cast.submit', {module_id: mid, job_id: job.job_id, lease: job.lease, index: place.index});
	assert.equal(submitted.accepted, DRAFT.people.length, JSON.stringify(submitted.refused));
	if (transcript) await storeTranscript(k.home, sha, 2, {text: TRANSCRIPT_TEXT});
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: CAMPAIGN, module: mid, play_language: 'zh-Hans'});
	await k.raw('investigator.load', {campaign: CAMPAIGN, library_id: saved.library_id});
	await k.raw('setup.complete', {campaign: CAMPAIGN});
	await k.raw('table.open', {campaign: CAMPAIGN});
	await k.raw('table.narrate', {campaign: CAMPAIGN, call_id: 't0-c1', text: '炉火噼啪作响。'});
	const call = (method, params = {}) => k.raw(method, {campaign: CAMPAIGN, ...params});
	const attempt = (method, params = {}) => k.attempt(method, {campaign: CAMPAIGN, ...params});
	const stored = JSON.parse(await readFile(join(k.home, '.coc', 'modules', mid, 'cast.json'), 'utf8'));
	return {...k, mid, sha, call, attempt, stored};
}

/** A page transcript record as the host stores it (§191.4), under the kernel's workspace, which is the host's home. */
async function storeTranscript(home, sha, page, {text = '', image_text = []}) {
	const dir = join(home, '.coc', 'source-transcripts', sha);
	await mkdir(dir, {recursive: true});
	const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
	await writeFile(join(dir, `page-${String(page).padStart(4, '0')}.json`), JSON.stringify({schema: 'coc.source-transcript.page.v1',
		transcript_version: 'transcript-v1', file_sha256: sha, page, pdf_label: null, native: {extraction_version: 'test', text_sha256: digest(PAGES[page - 1]), line_count: 1},
		text, text_sha256: digest(text), markdown: text, image_text, figures: [], dropped: [], unplaced: [], free_removed: 0, attempts: 1, model: null, thinking: null, at: '2026-10-08T00:00:00Z'}));
}

const lookOf = (job, stored, book) => job.people.find(person => person.id === stored.people.find(row => row.book.includes(book))?.id)?.looks;

test('§194.4: each resident of a list without sentence ends is shown to the epithet lane by their own entry, not a window over their neighbours', async t => {
	const h = await farm(t);
	const dimiri = h.stored.people.find(row => row.book.includes('迪米尔'));
	assert.match(dimiri.first.sentence, /瓦西里·斯莫斯基，49 岁，电工/, 'the stored first mention is the window that misled the lane on TR-F');
	const job = await h.call('epithets.job');
	assert.equal(lookOf(job, h.stored, '迪米尔'), '迪米尔·克拉夫楚克(Dimiri Kravchuk)，46 岁，石匠与木工—于 1937 年 6 月 21 日逃跑');
	assert.equal(lookOf(job, h.stored, '瓦西里'), '瓦西里·斯莫斯基，49 岁，电工');
	assert.equal(lookOf(job, h.stored, '鲍里斯·加庞'), '鲍里斯·加庞，53 岁，定居点管理 者。');
	// 安德烈 alone is the first Andrei's short form and opens the second's full name: the longer name is the second man's place.
	assert.equal(lookOf(job, h.stored, '安德烈·耶扎罗夫'), '安德烈·耶扎罗夫，32 岁，机械与电工');
	assert.equal(lookOf(job, h.stored, '安德烈·尼基京'), '安德烈·尼基京(Andrei Nikitin)，62 岁，劳工');
	// The native layer has no paragraph break after the last resident: the entry runs on to the page's end.
	assert.match(lookOf(job, h.stored, '卡特琳娜·克拉夫楚克'), /^卡 特 琳 娜 ·克 拉 夫 楚 克 \(Katarina Kravchuk\)，42 岁，电工.*前往农场/);
	for (const person of job.people.filter(person => person.id.startsWith('cast-')))
		assert.ok([...person.looks.matchAll(/\d+ 岁/g)].length <= 1, `one resident's age at most: ${person.looks}`);
});

test('§194.4: the page transcript is the reading text when stored, and an entry ends at its paragraph', async t => {
	const h = await farm(t, {transcript: true});
	const job = await h.call('epithets.job');
	assert.equal(lookOf(job, h.stored, '卡特琳娜·克拉夫楚克'), '卡 特 琳 娜 ·克 拉 夫 楚 克 (Katarina Kravchuk)，42 岁，电工—于 1937 年 6 月 21 日逃跑');
	assert.equal(lookOf(job, h.stored, '迪米尔'), '迪米尔·克拉夫楚克(Dimiri Kravchuk)，46 岁，石匠与木工—于 1937 年 6 月 21 日逃跑');
});

test('§194.4: a graph person\'s looks is their appearance, else their role; never the summary, which is the Keeper\'s account', async t => {
	const h = await farm(t);
	const job = await h.call('epithets.job');
	const aganin = job.people.find(person => person.role === 'the commissar who sends the investigators to the farm');
	assert.ok(aganin, JSON.stringify(job.people));
	assert.equal(aganin.looks, 'the commissar who sends the investigators to the farm', 'no appearance: the role');
	const clerk = job.people.find(person => person.looks === 'A stooped clerk with ink-stained cuffs.');
	assert.ok(clerk, 'the appearance the book gives');
	assert.ok(!JSON.stringify(job.people).includes('Forged') && !JSON.stringify(job.people).includes('Drowned'), 'no summary reaches the lane');
	assert.match(job.instruction, /first meeting/);
	assert.match(job.instruction, /never a secret, a motive, a cause, what happens to them, or anything the book reveals later/);
	assert.match(job.instruction, /about that person alone/);
});

test('§194.4: the cut, string by string: own name first, a longer name of someone else wins its place, a paragraph ends it', () => {
	assert.equal(api.castEntry('甲·乙，40 岁\n丙·丁，30 岁', ['甲·乙'], [['丙·丁']]), '甲·乙，40 岁');
	assert.equal(api.castEntry('丙·丁说：甲·乙来了。\n\n后来下雪。', ['甲·乙'], [['丙·丁']]), '甲·乙来了。', 'from the name on, to the paragraph end');
	assert.equal(api.castEntry('安德烈·尼基京，62 岁 安德烈·耶扎罗夫，32 岁', ['安德烈·尼基京'], [['安德烈·耶扎罗夫', '安德烈']]), '安德烈·尼基京，62 岁');
	assert.equal(api.castEntry('无人在此。', ['甲·乙'], []), null);
});

/** Nodes written into the campaign's fork, counted as read (as `module-cast.test.mjs` writes a copy). */
async function addNodes(h, nodes) {
	await api.ensureCampaignModule(h.context, CAMPAIGN, h.mid);
	const store = new api.ModuleStore(api.moduleContext(h.context, CAMPAIGN));
	const meta = await store.module(h.mid), graph = await store.readGraph(h.mid);
	graph.nodes.push(...nodes.map(node => ({source_refs: [{source_id: `pdf:${h.mid}`, pdf_index: 2}], ...node})));
	await store.writeGraph(meta, graph);
	meta.reading.materials.push({key: 'handouts', purpose: 'detail', focus: 'handouts', question: '', node_ids: nodes.map(node => node.node_id), generation: meta.generation});
	await store.writeModule(meta);
}
/** A picture the handout's image is cut from, as a file the kernel can find. */
async function picture(h) {
	const path = join(h.home, 'letter.png');
	await writeFile(path, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
	return path;
}
const untoldNames = async h => (await h.call('table.untold')).people.map(row => row.name);
const records = async h => {
	const dir = join(h.home, '.coc', 'campaigns', CAMPAIGN, 'turns');
	const {readdir} = await import('node:fs/promises');
	return Promise.all((await readdir(dir)).filter(name => name.endsWith('.json')).sort().map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
};

test('§194.3: a text handout tells the untold names it prints at the delivery that hands it over; a place the host cleared tells nobody', async t => {
	const h = await farm(t);
	await addNodes(h, [{node_id: 'handout-note', node_kind: 'handout', name: 'The Note', visibility: 'player-safe', summary: 'Keeper: Aganin wrote it.',
		properties: {authored_text: NOTE}}]);
	assert.ok((await h.call('table.look', {focus: 'npc', name: 'Captain Aganin'})).untold, 'the captain\'s card is untold at first');
	const before = await untoldNames(h);
	for (const name of ['嘉琳娜·斯莫斯卡娅', '瓦西里·斯莫斯基', 'Captain Aganin']) assert.ok(before.includes(name), `${name} untold at first: ${before}`);
	await h.call('table.player_input', {text: '我看看那张纸。'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Note', why: 'Aganin hands it over.'}]});
	const prose = '阿加宁把纸条推了过来。';
	const answer = await h.call('table.untold_spans', {text: prose});
	assert.deepEqual(answer.spans, [], 'the prose names nobody');
	assert.equal(answer.documents?.length, 1, JSON.stringify(answer));
	const [document] = answer.documents;
	assert.equal(document.text, '# The Note\n\n' + NOTE + '\n', 'the document is the file the card shows');
	const placed = document.spans.map(span => document.text.slice(span.start, span.end));
	assert.deepEqual(placed, ['克拉夫楚克', 'Captain Aganin', '瓦西里', '嘉琳娜·斯莫斯卡娅'], 'every untold name the document prints, the village\'s piece included');
	// The host's Jev check judged the village's piece another word.
	const village = document.spans.find(span => span.name === '瓦西里');
	await h.call('table.narrate', {call_id: 't1-c2', text: prose, untold_cleared: [{name: '瓦西里', nth: village.nth, handout: document.handout}]});
	const after = await untoldNames(h);
	assert.ok(!after.includes('嘉琳娜·斯莫斯卡娅'), 'the writer the note prints is told');
	assert.ok(!after.includes('Captain Aganin'), 'and the graph person it prints');
	assert.ok(after.includes('瓦西里·斯莫斯基'), 'the village told nobody');
	assert.ok(after.includes('迪米尔·克拉夫楚克') && after.includes('卡特琳娜·克拉夫楚克'), 'a name two untold people share tells neither (§188.8)');
	const world = JSON.parse(await readFile(join(h.home, '.coc', 'campaigns', CAMPAIGN, 'world.json'), 'utf8'));
	assert.ok(Object.values(world.person_labels ?? {}).some(label => label.name === 'Captain Aganin'), 'the table calls him by the book\'s name now, as at an introduction');
	const card = await h.call('table.look', {focus: 'npc', name: 'Captain Aganin'});
	assert.equal(card.untold, undefined, 'his card is no longer untold');
	assert.equal(card.called?.name, 'Captain Aganin', 'and shows his name');
	const record = (await records(h)).find(row => row.turn === 1);
	const galena = h.stored.people.find(row => row.book.includes('嘉琳娜'));
	assert.equal(record.told_documents.length, 1);
	assert.equal(record.told_documents[0].handout, document.handout);
	assert.deepEqual(record.told_documents[0].names, ['Captain Aganin', '嘉琳娜·斯莫斯卡娅'], 'the names as the document printed them');
	assert.equal(record.told_documents[0].people[1], galena.id, 'each person by identity: her cast row');
	assert.ok(!record.told_documents[0].people[0].startsWith('cast-'), 'and the captain by his handle');
	assert.ok(!record.rendered_text.includes('嘉琳娜'), 'the prose itself is unchanged');
});

test('§194.3: a pictured handout tells through the words the page transcript read off its picture; delivered by an ask, it tells at the ask', async t => {
	const h = await farm(t);
	await addNodes(h, [{node_id: 'handout-letter', node_kind: 'handout', name: 'The Letter', visibility: 'player-safe', summary: 'A denunciation.',
		properties: {image_sources: [{page: 3, box: [0, 0, 1, 0.6]}], asset_ref: await picture(h), media_type: 'image/png'}}]);
	await storeTranscript(h.home, h.sha, 3, {text: '44', image_text: LETTER});
	await h.call('table.player_input', {text: '信上写了什么？'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Letter', why: 'The letter is handed over.'}]});
	const {documents} = await h.call('table.untold_spans', {text: ''});
	assert.deepEqual(documents.map(document => document.spans.map(span => span.name)), [['Dimiri Kravchuk', 'Clerk Orlov', 'Andrei Nikitin']]);
	await h.call('table.ask', {call_id: 't1-c2', kind: 'story', prompt: '你要怎么做？', options: ['去农场', '再读一遍'], text: '阿加宁等你开口。'});
	const after = await untoldNames(h);
	assert.ok(!after.includes('迪米尔·克拉夫楚克') && !after.includes('安德烈·尼基京'), `both residents the letter prints are told: ${after}`);
	assert.ok(after.includes('卡特琳娜·克拉夫楚克'), 'his wife, whose names carry the family name, is not told by his');
	assert.ok(!after.includes('Clerk Orlov'), 'the graph person the letter prints is told');
	assert.equal((await h.call('table.look', {focus: 'npc', name: 'Clerk Orlov'})).called?.name, 'Clerk Orlov', 'and called by the book\'s name');
	const [told] = (await records(h)).find(row => row.turn === 1)?.told_documents ?? [];
	assert.deepEqual([told?.handout, told?.names], [documents[0].handout, ['Dimiri Kravchuk', 'Clerk Orlov', 'Andrei Nikitin']]);
	assert.deepEqual([told.people[0], told.people[2]], ['迪米尔', '安德烈·尼基京'].map(book => h.stored.people.find(row => row.book.includes(book)).id));
});

test('§194.3: a handout with no known text tells nothing: no transcript of its page, a page another picture shares, or a picture never delivered', async t => {
	const h = await farm(t);
	await addNodes(h, [
		{node_id: 'handout-letter', node_kind: 'handout', name: 'The Letter', visibility: 'player-safe', summary: 'A denunciation.',
			properties: {image_sources: [{page: 3, box: [0, 0, 1, 0.6]}], asset_ref: await picture(h), media_type: 'image/png'}},
		{node_id: 'handout-photo', node_kind: 'handout', name: 'The Photo', visibility: 'player-safe', summary: 'A photograph.',
			properties: {image_sources: [{page: 1, box: [0, 0, 1, 1]}], asset_ref: await picture(h), media_type: 'image/png'}},
		{node_id: 'asset-stamp', node_kind: 'asset', name: 'Stamp', visibility: 'player-safe', summary: 'A rubber stamp.',
			properties: {image_sources: [{page: 1, box: [0, 0.8, 0.2, 1]}]}},
		{node_id: 'handout-lost', node_kind: 'handout', name: 'The Lost Card', visibility: 'player-safe', summary: 'A card.',
			properties: {image_sources: [{page: 2, box: [0, 0, 1, 1]}], asset_ref: join(h.home, 'missing.png'), media_type: 'image/png'}}]);
	// The lost card's page has its own transcript, but its picture never reached the player (no file): the player holds nothing.
	await storeTranscript(h.home, h.sha, 2, {text: TRANSCRIPT_TEXT, image_text: ['Andrei Nikitin']});
	// The photo's page has a transcript that reads a name, but another picture stands on that page: the words are not the photo's.
	await storeTranscript(h.home, h.sha, 1, {text: PAGES[0], image_text: ['Dimiri Kravchuk']});
	await h.call('table.player_input', {text: '我看看这些东西。'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Letter', why: 'handed over'}, {kind: 'handout', name: 'The Photo', why: 'handed over'},
		{kind: 'handout', name: 'The Lost Card', why: 'handed over'}]});
	const answer = await h.call('table.untold_spans', {text: '你拿到了信和照片。'});
	assert.equal(answer.documents, undefined, JSON.stringify(answer.documents));
	await h.call('table.narrate', {call_id: 't1-c2', text: '你拿到了信和照片。'});
	const after = await untoldNames(h);
	assert.ok(after.includes('迪米尔·克拉夫楚克') && after.includes('安德烈·尼基京'), 'nobody told');
	assert.equal((await records(h)).find(row => row.turn === 1)?.told_documents, undefined);
});

test('§194.3: the host asks about a document\'s places as about the prose\'s, and clears them by the handout', async () => {
	const prose = '你接过信。', text = '寄自瓦西里耶夫卡村。嘉琳娜·斯莫斯卡娅';
	const village = text.indexOf('瓦西里'), writer = text.indexOf('嘉琳娜');
	const direct = async () => ({spans: [], documents: [{handout: 'handout-7f', text, spans: [
		{name: '瓦西里', nth: 0, start: village, end: village + 3}, {name: '嘉琳娜·斯莫斯卡娅', nth: 0, start: writer, end: writer + 9}]}]});
	const rows = [], seen = [];
	const port = {async decide(batch) {
		seen.push(batch);
		const answers = Object.fromEntries(batch.questions.map(question => [question.key,
			{status: 'answered', type: 'noul', noul: batch.state.items[question.target].text.includes('⟦瓦西里⟧耶夫卡') ? 0.05 : 0.95}]));
		return {batchId: batch.id, status: 'complete', answers, coverage: {required: [], answered: [], unknown: []}, issues: []};
	}};
	const judge = createUntoldSpanJudge({record: row => rows.push(row), decision: () => port});
	const sent = await judge('table.narrate', {campaign: 'c1', call_id: 't1-c1', text: prose}, direct);
	assert.deepEqual(sent.untold_cleared, [{name: '瓦西里', nth: 0, handout: 'handout-7f'}]);
	assert.match(seen[0].state.items.s1.text, /寄自⟦瓦西里⟧耶夫卡村/, 'the place is shown in the document\'s own words');
	assert.deepEqual([rows.at(-1).places, rows.at(-1).document_places, rows.at(-1).cleared], [2, 2, 1]);
	const asked = await judge('table.ask', {campaign: 'c1', kind: 'mechanics', options: ['push', 'accept']}, direct);
	assert.deepEqual(asked.untold_cleared, [{name: '瓦西里', nth: 0, handout: 'handout-7f'}], 'an ask without text still has its documents asked about');
});
