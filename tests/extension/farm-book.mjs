/**
 * The farm: a three-page bound book shaped like Cold Harvest (real tables TR-F and TR-F2): the opening, the residents' list as the
 * text layer has it (wrapped lines, a name spaced out letter by letter, no sentence ends), and a page whose picture is a letter;
 * its graph has the office, Captain Aganin and the clerk, and its cast is read by hand. Built through the kernel's own handlers,
 * in process (`two-ledgers-names.test.mjs`) or in a table's workspace before the session opens it (`public-figures-table.test.mjs`).
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const RESIDENTS = [
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
export const BOOK_PAGES = [
	'指挥室里炉火很旺。阿加宁上尉把两张卡片推过桌面。',
	RESIDENTS.join('\n'),
	'44',
];
/** §191.3: the transcript's exact layer -- the same lines, its blocks separated by a blank line. */
export const TRANSCRIPT_TEXT = [RESIDENTS.slice(0, 2).join('\n'), RESIDENTS.slice(2, 4).join('\n'), ...RESIDENTS.slice(4, 7),
	RESIDENTS.slice(7, 9).join('\n'), RESIDENTS.slice(9, 12).join('\n'), RESIDENTS.slice(12, 15).join('\n'), RESIDENTS[15], RESIDENTS[16]].join('\n\n');
/** The words a page transcript read off the picture of a letter (§191.3 `image_text`), printing two residents' book forms. */
export const LETTER = ['NKVD Station Chief', 'However, the Kravchuk family ran off in the night. I have witnessed Dimiri Kravchuk stealing grain, and Clerk Orlov saw it.\n\nAndrei Nikitin'];
/** A text handout (its `authored_text`): a resident's name, a graph person's name, and a village whose name opens with another resident's short form. */
export const NOTE = '举报信\n克拉夫楚克一家逃走那晚，我亲眼看到 Captain Aganin 也在场。\n寄自瓦西里耶夫卡村。\n嘉琳娜·斯莫斯卡娅';
export const REFS = [{page: 1}];
export const CAMPAIGN = 'farm';

export const CAST_DRAFT = {people: [
	{book: ['鲍里斯·加庞', '加庞'], play: ['鲍里斯·加庞'], notes: ['Boris Gapon'], pages: [2]},
	{book: ['瓦西里·斯莫斯基', '瓦西里'], play: ['瓦西里·斯莫斯基'], notes: ['Vasili Smolsky'], pages: [2]},
	{book: ['嘉琳娜·斯莫斯卡娅', '嘉琳娜'], play: ['嘉琳娜·斯莫斯卡娅'], notes: ['Galena Smolskaya'], pages: [2]},
	{book: ['安德烈·耶扎罗夫', '安德烈'], play: ['安德烈·耶扎罗夫'], notes: ['Andrei Yezarov'], pages: [2]},
	{book: ['安德烈·尼基京', 'Andrei Nikitin'], play: ['安德烈·尼基京'], notes: ['Andrei Nikitin'], pages: [2]},
	{book: ['迪米尔·克拉夫楚克', 'Dimiri Kravchuk', '迪米尔', '克拉夫楚克'], play: ['迪米尔·克拉夫楚克'], notes: ['Dimiri Kravchuk'], pages: [2]},
	{book: ['卡特琳娜·克拉夫楚克', 'Katarina Kravchuk', '克拉夫楚克'], play: ['卡特琳娜·克拉夫楚克'], notes: ['Katarina Kravchuk'], pages: [2]},
]};

/** The bound book read as far as its opening: the graph has the office, Captain Aganin and the clerk; the cast is read. */
/** §194.5: the opening page with a real public figure the book only mentions (TR-F2: the letter's "in Stalin's name"), and his cast row. */
export const FIGURE_LINE = '墙上挂着斯大林同志的画像。';
export const FIGURE_ROW = {book: ['斯大林'], play: ['斯大林'], notes: ['Stalin'], pages: [1]};

/**
 * The farm built through the kernel's own handlers (`raw(method, params)`) in the workspace `home`: the book bound and read, its cast
 * read, and the campaign set up; `open` also opens the table and delivers its opening. `figures` adds the public figure, `rows` more cast rows.
 */
export async function buildFarm(raw, home, {transcript = false, figures = false, rows = [], open = true} = {}) {
	const k = {raw, home};
	const PAGES = figures ? [BOOK_PAGES[0] + FIGURE_LINE, ...BOOK_PAGES.slice(1)] : BOOK_PAGES;
	const DRAFT = figures ? {people: [...CAST_DRAFT.people, FIGURE_ROW, ...rows]} : CAST_DRAFT;
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
	if (submitted.accepted !== DRAFT.people.length) throw new Error(`the fixture cast was refused: ${JSON.stringify(submitted.refused)}`);
	if (transcript) await storeTranscript(k.home, sha, 2, {text: TRANSCRIPT_TEXT});
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: CAMPAIGN, module: mid, play_language: 'zh-Hans'});
	await k.raw('investigator.load', {campaign: CAMPAIGN, library_id: saved.library_id});
	await k.raw('setup.complete', {campaign: CAMPAIGN});
	if (open) {
		await k.raw('table.open', {campaign: CAMPAIGN});
		await k.raw('table.narrate', {campaign: CAMPAIGN, call_id: 't0-c1', text: '炉火噼啪作响。'});
	}
	const stored = JSON.parse(await readFile(join(k.home, '.coc', 'modules', mid, 'cast.json'), 'utf8'));
	return {mid, sha, stored};
}

/** A page transcript record as the host stores it (§191.4), under the kernel's workspace, which is the host's home. */
export async function storeTranscript(home, sha, page, {text = '', image_text = []}) {
	const dir = join(home, '.coc', 'source-transcripts', sha);
	await mkdir(dir, {recursive: true});
	const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
	await writeFile(join(dir, `page-${String(page).padStart(4, '0')}.json`), JSON.stringify({schema: 'coc.source-transcript.page.v1',
		transcript_version: 'transcript-v1', file_sha256: sha, page, pdf_label: null, native: {extraction_version: 'test', text_sha256: digest(BOOK_PAGES[page - 1]), line_count: 1},
		text, text_sha256: digest(text), markdown: text, image_text, figures: [], dropped: [], unplaced: [], free_removed: 0, attempts: 1, model: null, thinking: null, at: '2026-10-08T00:00:00Z'}));
}
