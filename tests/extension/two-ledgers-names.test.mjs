/**
 * Contract §194.3, §194.4 and §194.5 (docs/specs/two-ledgers.md, tickets TL-04 and TL-05; real table TR-F2), on the real kernel
 * in-process, with the host's hooks where the host is involved.
 *
 * Real table TR-F (Cold Harvest, App d944b6b07): the settlement record on page 10 lists the farm's residents with no
 * sentence ends, so every resident's first-mention sentence (§177.2) was a window over six to eight of them, and the epithet
 * lane gave Dimiri Kravchuk (46, stonemason, fled) his neighbour Vasili's age and trade: 「四十九岁的电工斯基」. A graph
 * person's summary reached the lane too, and the victim became 「使两家人突变的生物」. And the player held the denunciation
 * letter, which prints the writer's and the accused's names, while both stayed untold.
 *
 * The fixture is the farm (`farm-book.mjs`), a three-page bound book shaped like Cold Harvest.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createUntoldSpanJudge} from '../../extensions/kernel/untold-spans.ts';
import {createPublicFigureJudge} from '../../extensions/kernel/public-figures.ts';
import {PUBLIC_FIGURE_AT} from '../../runtime/jev/public-figures.ts';
import {BOOK_PAGES, CAMPAIGN, LETTER, NOTE, TRANSCRIPT_TEXT, buildFarm, storeTranscript} from './farm-book.mjs';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'two-ledgers-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {castEntry} from './kernel-ts/cast/entry.ts';
export {sayRanges} from './kernel-ts/write/speech-pass.ts';
export {handleLine} from './kernel-ts/transport.ts';
export {ModuleStore} from './kernel-ts/modules/store.ts';
export {ensureCampaignModule, moduleContext} from './kernel-ts/modules/campaign-scope.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

async function kernel(t, seed, env = {}) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed,
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const attempt = async (method, params = {}) => { try { return {ok: true, result: await raw(method, params)}; } catch (error) { return {ok: false, error}; } };
	return {home, context, runtime, raw, attempt};
}

/** The farm on the in-process kernel, its table open and its opening delivered (`farm-book.mjs`). */
async function farm(t, {transcript = false, env = {}, figures = false, rows = []} = {}) {
	const k = await kernel(t, 'two-ledgers', env);
	const built = await buildFarm(k.raw, k.home, {transcript, figures, rows});
	const call = (method, params = {}) => k.raw(method, {campaign: CAMPAIGN, ...params});
	const attempt = (method, params = {}) => k.attempt(method, {campaign: CAMPAIGN, ...params});
	return {...k, ...built, call, attempt};
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
	await storeTranscript(h.home, h.sha, 1, {text: BOOK_PAGES[0], image_text: ['Dimiri Kravchuk']});
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

/** A fake Jev port: each place's Noul from `score(marked text)`. */
const spanPort = score => ({async decide(batch) {
	const answers = Object.fromEntries(batch.questions.map(question => [question.key,
		{status: 'answered', type: 'noul', noul: score(batch.state.items[question.target].text)}]));
	return {batchId: batch.id, status: 'complete', answers, coverage: {required: [], answered: [], unknown: []}, issues: []};
}});
const refusalOf = async promise => { try { await promise; return null; } catch (error) { return error; } };

test('§194.5: a delivery\'s own handouts tell before its gate: the names they print are delivered in its prose the first time, and told', async t => {
	const h = await farm(t);
	await addNodes(h, [{node_id: 'handout-note', node_kind: 'handout', name: 'The Note', visibility: 'player-safe', summary: 'Keeper: Aganin wrote it.',
		properties: {authored_text: NOTE}}]);
	await h.call('table.player_input', {text: '我读那张纸条。'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Note', why: 'Aganin hands it over.'}]});
	// TR-F2 turn 2: the Keeper rendered the letter it handed over, and the gate refused the names the letter prints.
	const prose = '纸条署名嘉琳娜·斯莫斯卡娅；她写道那晚 Captain Aganin 也在场。';
	assert.deepEqual((await h.call('table.untold_spans', {text: prose})).spans, [], 'the prose\'s names are the document\'s: no place to ask about');
	// A name the handout does not print is still held.
	const other = await refusalOf(h.call('table.narrate', {call_id: 't1-c2', text: `${prose}安德烈·耶扎罗夫在门口等着。`}));
	assert.equal(other?.details?.reason, 'untold_name', 'a resident the note does not print is refused');
	assert.equal(other.details.places, 1, 'only his name');
	await h.call('table.narrate', {call_id: 't1-c3', text: prose});
	const record = (await records(h)).find(row => row.turn === 1);
	assert.equal(record.rendered_text, prose, 'delivered as written, nothing replaced');
	assert.deepEqual(record.told_documents[0].names, ['Captain Aganin', '瓦西里', '嘉琳娜·斯莫斯卡娅'], 'no Jev here: the village tells too');
	const after = await untoldNames(h);
	assert.ok(!after.includes('嘉琳娜·斯莫斯卡娅') && !after.includes('Captain Aganin'), 'and the people it prints are told');
	assert.ok(after.includes('安德烈·耶扎罗夫'), 'the refused one stays untold');
});

test('§194.5: an ask\'s handouts tell before its gate too', async t => {
	const h = await farm(t);
	await addNodes(h, [{node_id: 'handout-letter', node_kind: 'handout', name: 'The Letter', visibility: 'player-safe', summary: 'A denunciation.',
		properties: {image_sources: [{page: 3, box: [0, 0, 1, 0.6]}], asset_ref: await picture(h), media_type: 'image/png'}}]);
	await storeTranscript(h.home, h.sha, 3, {text: '44', image_text: LETTER});
	await h.call('table.player_input', {text: '信上写了什么？'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Letter', why: 'The letter is handed over.'}]});
	const text = '信里说 Dimiri Kravchuk 偷了粮，Clerk Orlov 看见了。';
	await h.call('table.ask', {call_id: 't1-c2', kind: 'story', prompt: '你要怎么做？', options: ['去农场', '再读一遍'], text});
	const record = (await records(h)).find(row => row.turn === 1);
	assert.equal(record.rendered_text, text, 'delivered the first time, as written');
	const after = await untoldNames(h);
	assert.ok(!after.includes('迪米尔·克拉夫楚克') && !after.includes('Clerk Orlov'), `told at the ask: ${after}`);
});

test('§194.5: a document place the host clears leaves its person untold, so the prose\'s places are asked again with that clearance', async t => {
	const h = await farm(t);
	await addNodes(h, [{node_id: 'handout-note', node_kind: 'handout', name: 'The Note', visibility: 'player-safe', summary: 'Keeper: Aganin wrote it.',
		properties: {authored_text: NOTE}}]);
	await h.call('table.player_input', {text: '我读那张纸条。'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Note', why: 'Aganin hands it over.'}]});
	// The Keeper echoes the village the note was sent from, whose name opens with a resident's short form.
	const prose = '纸条寄自瓦西里耶夫卡村。';
	const rows = [];
	const judge = createUntoldSpanJudge({record: row => rows.push(row), decision: () => spanPort(text => text.includes('⟦瓦西里⟧耶夫卡') ? 0.05 : 0.95)});
	const direct = (method, params) => h.raw(method, params);
	const sent = await judge('table.narrate', {campaign: CAMPAIGN, call_id: 't1-c2', text: prose}, direct);
	const handout = sent.untold_cleared.find(place => place.handout)?.handout;
	assert.ok(handout, JSON.stringify(sent.untold_cleared));
	assert.deepEqual(sent.untold_cleared, [{name: '瓦西里', nth: 0, handout}, {name: '瓦西里', nth: 0}],
		'the document\'s village, then the prose\'s, found once the village no longer tells the resident');
	assert.deepEqual(rows.map(row => [row.event, row.round ?? 1, row.places, row.cleared]), [['judged', 1, 4, 1], ['judged', 2, 1, 1]]);
	await h.raw('table.narrate', sent);
	assert.equal((await records(h)).find(row => row.turn === 1)?.rendered_text, prose, 'delivered the first time');
	assert.ok((await untoldNames(h)).includes('瓦西里·斯莫斯基'), 'the village told nobody');
});

/** The investigator's name as the party sheet holds it: what a say token writes for the player's own lines. */
const investigatorName = async h => {
	const {readdir} = await import('node:fs/promises');
	const dir = join(h.home, '.coc', 'campaigns', CAMPAIGN, 'party');
	const [file] = (await readdir(dir)).filter(name => name.endsWith('.json'));
	return JSON.parse(await readFile(join(dir, file), 'utf8')).name;
};
const worldOf = async h => JSON.parse(await readFile(join(h.home, '.coc', 'campaigns', CAMPAIGN, 'world.json'), 'utf8'));

/** The supervisor as a graph person too: the reader reached him, and his node joins his cast row by his full name. */
const GAPON = {node_id: 'npc-gapon', node_kind: 'npc', name: '鲍里斯·加庞', summary: 'Keeper: hid the failed harvest.',
	properties: {relationship_to_investigators: 'the farm\'s production supervisor'}};

test('§194.5: a name spoken in a line of someone other than the investigator is delivered and tells that person, as {{name:}} does', async t => {
	const h = await farm(t);
	await addNodes(h, [GAPON]);
	await h.call('table.player_input', {text: '谁报告的？'});
	// TR-F2 turn 1: the captain's own line named the supervisor, and the gate refused it. Here he says the short form, which
	// is not the name a told check looks for in prose (his display name is the full one): the line tells him by identity.
	const line = '{{say:Captain Aganin}}“监督员加庞报告产量不足。安德烈·尼基京也这么说。”{{/say}}';
	const text = `阿加宁上尉敲了敲桌面。${line}`;
	const spans = (await h.call('table.untold_spans', {text})).spans.map(span => span.name);
	assert.deepEqual(spans, ['加庞', '安德烈·尼基京'], 'the places inside the line are still asked about (§177.15)');
	await h.call('table.narrate', {call_id: 't1-c1', text});
	const record = (await records(h)).find(row => row.turn === 1);
	assert.match(record.rendered_text, /监督员加庞报告产量不足。安德烈·尼基京也这么说/, 'delivered the first time, the names as written');
	const nikitin = h.stored.people.find(row => row.book.includes('安德烈·尼基京'));
	assert.equal(record.told_lines.length, 1);
	assert.deepEqual(record.told_lines[0].names, ['加庞', '安德烈·尼基京']);
	assert.ok(!record.told_lines[0].people[0].startsWith('cast-'), 'the supervisor by his handle');
	assert.equal(record.told_lines[0].people[1], nikitin.id, 'the unread resident by his cast row');
	assert.equal(record.told_lines[0].by, record.speech[0].who.npc, 'the line\'s speaker');
	const after = await untoldNames(h);
	assert.ok(!after.includes('鲍里斯·加庞') && !after.includes('安德烈·尼基京'), `both told: ${after}`);
	// The sync an introduction makes: the supervisor's table word is now his name, and his card is no longer untold.
	assert.ok(Object.values((await worldOf(h)).person_labels ?? {}).some(label => label.name === '鲍里斯·加庞'));
	const card = await h.call('table.look', {focus: 'npc', name: '鲍里斯·加庞'});
	assert.equal(card.untold, undefined);
	assert.equal(card.called?.name, '鲍里斯·加庞');
});

test('§194.5: narration outside a line and the investigator\'s own lines stay gated; a family name two people share is delivered in a line and tells neither', async t => {
	const h = await farm(t);
	await h.call('table.player_input', {text: '谁跑了？'});
	const me = await investigatorName(h);
	// Each refusal below names someone else: the same names twice in a turn would be delivered replaced (§177.11).
	const outside = await refusalOf(h.call('table.narrate', {call_id: 't1-c1', text: '你想起了鲍里斯·加庞的报告。'}));
	assert.equal(outside?.details?.reason, 'untold_name', 'narration');
	assert.match(outside.message, /outside the lines people other than the investigator speak/);
	assert.match(String(outside.fix), /keep it inside their \{\{say:<who>\}\}/, 'the fix names the line');
	const mine = await refusalOf(h.call('table.narrate', {call_id: 't1-c2', text: `{{say:${me}}}“安德烈·耶扎罗夫在哪？”{{/say}}`}));
	assert.equal(mine?.details?.reason, 'untold_name', 'the investigator\'s own line');
	const label = await refusalOf(h.call('table.narrate', {call_id: 't1-c3', text: '{{say:门外的人}}“瓦西里·斯莫斯基来了。”{{/say}}'}));
	assert.equal(label?.details?.reason, 'untold_name', 'a line whose speaker resolves to nobody');
	// Both Kravchuks print the family name alone: in the captain's line it stands as written and tells neither.
	const text = '{{say:Captain Aganin}}“克拉夫楚克一家六月就跑了。”{{/say}}';
	await h.call('table.narrate', {call_id: 't1-c4', text});
	const record = (await records(h)).find(row => row.turn === 1);
	assert.match(record.rendered_text, /克拉夫楚克一家六月就跑了/);
	assert.equal(record.told_lines, undefined, 'nobody is told by a shared name');
	assert.ok(!record.told_text.includes('克拉夫楚克'), 'and the told check never reads it');
	const after = await untoldNames(h);
	assert.ok(after.includes('迪米尔·克拉夫楚克') && after.includes('卡特琳娜·克拉夫楚克'), 'both still untold');
});

test('§194.5: a place in a line the host cleared tells nobody; an ask delivers a spoken name and tells nobody, as {{name:}} on an ask', async t => {
	const h = await farm(t);
	await h.call('table.player_input', {text: '信从哪来？'});
	const text = '{{say:Captain Aganin}}“信是从瓦西里耶夫卡寄来的。”{{/say}}';
	const [village] = (await h.call('table.untold_spans', {text})).spans;
	assert.equal(village.name, '瓦西里');
	await h.call('table.narrate', {call_id: 't1-c1', text, untold_cleared: [{name: village.name, nth: village.nth}]});
	const record = (await records(h)).find(row => row.turn === 1);
	assert.equal(record.told_lines, undefined);
	assert.ok((await untoldNames(h)).includes('瓦西里·斯莫斯基'), 'the village told nobody');
	await h.call('table.player_input', {text: '我问他名单上还有谁。'});
	const asked = '{{say:Captain Aganin}}“还有安德烈·耶扎罗夫。”{{/say}}';
	await h.call('table.ask', {call_id: 't2-c1', kind: 'story', prompt: '你要怎么做？', options: ['去农场', '留下'], text: asked});
	const two = (await records(h)).find(row => row.turn === 2);
	assert.match(two.rendered_text, /还有安德烈·耶扎罗夫/, 'not refused');
	assert.equal(two.told_lines, undefined);
	assert.ok((await untoldNames(h)).includes('安德烈·耶扎罗夫'), 'an ask tells nobody by its lines');
});

test('§194.5: a narrate whose commit fails puts back the table word a spoken name changed (§141)', async t => {
	const {execFileSync} = await import('node:child_process');
	const {chmod} = await import('node:fs/promises');
	const dir = await mkdtemp(join(temporary, 'git-')), armed = join(dir, 'armed'), wrapper = join(dir, 'git');
	const git = execFileSync('/bin/sh', ['-c', 'command -v git'], {encoding: 'utf8'}).trim();
	await writeFile(wrapper, `#!/bin/sh\nfor a in "$@"; do if [ "$a" = commit ] && [ -f '${armed}' ]; then echo 'fixture: commit refused' >&2; exit 1; fi; done\nexec '${git}' "$@"\n`);
	await chmod(wrapper, 0o755);
	const h = await farm(t, {env: {PI_COC_GIT: wrapper}});
	await addNodes(h, [GAPON]);
	await h.call('table.player_input', {text: '谁带路？'});
	const before = (await worldOf(h)).person_labels ?? {};
	await writeFile(armed, 'arm');
	const text = '{{say:Captain Aganin}}“加庞会带你去。”{{/say}}';
	const failed = await refusalOf(h.call('table.narrate', {call_id: 't1-c1', text}));
	assert.equal(failed?.code, 'commit_failed', String(failed?.message));
	assert.deepEqual((await worldOf(h)).person_labels ?? {}, before, 'the label the line made is rolled back');
	await rm(armed);
	await h.call('table.narrate', {call_id: 't1-c1', text});
	assert.ok(Object.values((await worldOf(h)).person_labels ?? {}).some(label => label.name === '鲍里斯·加庞'), 'and made again by the delivery that lands');
});

test('§194.5: a line is where the speech pass says it is: to its close token, the next open token, a paragraph break or the end', () => {
	const spans = text => api.sayRanges(text, name => ({npc: name, name})).map(span => [text.slice(span.start, span.end), span.who.npc]);
	assert.deepEqual(spans('甲说{{say:A}}“一”{{/say}}乙说'), [['“一”', 'A']]);
	assert.deepEqual(spans('{{say:A}}“一”{{say:B}}“二”'), [['“一”', 'A'], ['“二”', 'B']], 'an open token closes the line before it; the last runs to the end');
	assert.deepEqual(spans('{{say:A}}“一”\n\n旁白说了加庞。'), [['“一”', 'A']], 'a paragraph break ends a line left open');
	assert.deepEqual(spans('{{/say}}{{say: }}“无名”'), [], 'a stray close and a token naming nobody open no line');
});

/** One fake Jev for both families: the places of untold names (§177.15) and the cast's public figures (§194.5). */
const jevPort = ({span = () => 0.95, figure = () => 0.05} = {}, seen = []) => ({async decide(batch) {
	seen.push(batch);
	const answers = Object.fromEntries(batch.questions.map(question => {
		const item = batch.state.items[question.target];
		return [question.key, {status: 'answered', type: 'noul', noul: batch.family === 'cast-public-figures' ? figure(item) : span(item.text)}];
	}));
	return {batchId: batch.id, status: 'complete', answers, coverage: {required: [], answered: [], unknown: []}, issues: []};
}});
const stalinOnly = item => item.names.includes('斯大林') ? 0.97 : 0.05;
const figureBatches = seen => seen.filter(batch => batch.family === 'cast-public-figures');
const verdictsOf = async h => JSON.parse(await readFile(join(h.home, '.coc', 'modules', h.mid, 'cast-public.json'), 'utf8'));
/** The host's hook as the kernel extension wires it: the delivery's places, after the cast's unjudged rows. */
const hostHook = (h, port, rows = []) => {
	const figures = createPublicFigureJudge({record: row => rows.push(row), decision: () => port});
	const judge = createUntoldSpanJudge({record: row => rows.push(row), decision: () => port, publicFigures: figures});
	const prepare = (method, params) => judge(method, {campaign: CAMPAIGN, ...params}, (m, p) => h.raw(m, p));
	return {figures, prepare, deliver: async (method, params) => h.raw(method, await prepare(method, params))};
};

test('§194.5: a public figure the cast lists is judged once by Jev from his own entry, and leaves the roster, the gate and the epithet lane', async t => {
	const h = await farm(t, {figures: true});
	const stalin = h.stored.people.find(row => row.book.includes('斯大林'));
	await h.call('table.player_input', {text: '信上怎么说？'});
	// TR-F2 turn 2: the letter says the workers toil in Stalin's name, and the gate refused it.
	const prose = '信里说大家都以斯大林的名义工作。';
	const before = await h.call('table.untold_spans', {text: prose});
	assert.deepEqual(before.spans.map(span => span.name), ['斯大林'], 'untold until judged: the cast lists him');
	assert.equal(before.public_pending, true);
	assert.ok((await untoldNames(h)).includes('斯大林'), 'in the untold roster until judged');
	assert.ok((await h.call('epithets.job')).people.some(person => person.id === stalin.id), 'and offered to the epithet lane');
	const seen = [], rows = [], host = hostHook(h, jevPort({figure: stalinOnly}, seen), rows);
	const sent = await host.prepare('table.narrate', {call_id: 't1-c1', text: prose});
	// Judged before the delivery reaches the gate, and before any delivery has said his name.
	assert.ok(!(await untoldNames(h)).includes('斯大林'), 'out of the untold roster, so out of the request\'s rename');
	assert.ok(!(await h.call('epithets.job')).people.some(person => person.id === stalin.id), 'and the epithet lane gives him no word');
	await h.raw('table.narrate', sent);
	assert.equal((await records(h)).find(row => row.turn === 1)?.rendered_text, prose, 'delivered the first time');
	const [asked] = figureBatches(seen);
	assert.equal(figureBatches(seen).length, 1, 'one request for the whole cast');
	assert.equal(Object.keys(asked.state.items).length, h.stored.people.length, 'one question per cast row');
	const item = Object.values(asked.state.items).find(each => each.names.includes('斯大林'));
	assert.deepEqual(item, {names: ['斯大林', 'Stalin'], entry: '斯大林同志的画像。'}, 'the row\'s names and its own entry (§194.4)');
	assert.equal(seen.filter(batch => batch.family === 'untold-name-spans').length, 0, 'no place left to ask about');
	const verdicts = await verdictsOf(h);
	assert.equal(verdicts.rows[stalin.id].public, true);
	assert.deepEqual(Object.values(verdicts.rows).filter(row => row.public).length, 1, 'nobody else');
	assert.equal((await h.call('table.untold_spans', {text: prose})).public_pending, undefined);
	assert.equal(await host.figures(CAMPAIGN, (m, p) => h.raw(m, p)), false, 'asked once per row: nothing left to judge');
	assert.equal(figureBatches(seen).length, 1);
	assert.deepEqual(rows.filter(row => row.lane === 'public-figures').map(row => [row.event, row.people, row.public]), [['judged', h.stored.people.length, 1]]);
});

test('§194.5: below the bar, or with Jev unavailable, the person stays untold', async t => {
	const prose = '信里说大家都以斯大林的名义工作。';
	const low = await farm(t, {figures: true});
	await low.call('table.player_input', {text: '信上怎么说？'});
	const seen = [], unsure = hostHook(low, jevPort({figure: item => item.names.includes('斯大林') ? PUBLIC_FIGURE_AT - 0.05 : 0.05}, seen));
	const refused = await refusalOf(unsure.deliver('table.narrate', {call_id: 't1-c1', text: prose}));
	assert.equal(refused?.details?.reason, 'untold_name', 'below the bar: still refused');
	const stalin = low.stored.people.find(row => row.book.includes('斯大林'));
	assert.equal((await verdictsOf(low)).rows[stalin.id].public, false, 'the verdict is kept, and it is no');
	assert.equal((await low.call('table.untold_spans', {text: prose})).public_pending, undefined, 'and not asked again');
	const off = await farm(t, {figures: true});
	await off.call('table.player_input', {text: '信上怎么说？'});
	const rows = [], none = hostHook(off, undefined, rows);
	const unavailable = await refusalOf(none.deliver('table.narrate', {call_id: 't1-c1', text: prose}));
	assert.equal(unavailable?.details?.reason, 'untold_name', 'no Jev: still refused');
	assert.equal(await readFile(join(off.home, '.coc', 'modules', off.mid, 'cast-public.json')).then(() => true, () => false), false, 'no verdict written');
	assert.equal((await off.call('table.untold_spans', {text: prose})).public_pending, true, 'still to be judged');
	// Jev answering nothing: no verdict, and the campaign is not asked again until the pause is over.
	const failing = {async decide(batch) { return {batchId: batch.id, status: 'failed', failure: {code: 'service_error'}, answers: {}, coverage: {required: [], answered: [], unknown: []}, issues: []}; }};
	const down = createPublicFigureJudge({record: row => rows.push(row), decision: () => failing});
	assert.equal(await down(CAMPAIGN, (m, p) => off.raw(m, p)), false);
	assert.deepEqual(rows.filter(row => row.lane === 'public-figures').map(row => [row.event, row.reason]), [['fallback', 'service_error']]);
	assert.equal(await down(CAMPAIGN, async () => { throw new Error('asked during the pause'); }), false, 'paused');
});

test('§194.5: a verdict is bound to its row: a re-read row is asked again, alone, and a verdict for an old row is skipped', async t => {
	const h = await farm(t, {figures: true});
	const seen = [], host = hostHook(h, jevPort({figure: stalinOnly}, seen));
	assert.equal(await host.figures(CAMPAIGN, (m, p) => h.raw(m, p)), true);
	const castPath = join(h.home, '.coc', 'modules', h.mid, 'cast.json');
	const table = JSON.parse(await readFile(castPath, 'utf8'));
	const row = table.people.find(person => person.book.includes('斯大林'));
	const old = (await verdictsOf(h)).rows[row.id].row_sha256;
	assert.ok(!(await untoldNames(h)).includes('斯大林'));
	row.notes = ['Stalin', 'Joseph Stalin'];
	await writeFile(castPath, JSON.stringify(table));
	assert.ok((await untoldNames(h)).includes('斯大林'), 'a verdict on what the row said before serves nothing');
	assert.equal((await h.call('table.untold_spans', {text: ''})).public_pending, true);
	const job = await h.call('cast.public.job', {version: '1'});
	assert.deepEqual(job.people.map(person => person.id), [row.id], 'only the row that changed');
	assert.deepEqual(await h.call('cast.public.submit', {version: '1', verdicts: [{id: row.id, row_sha256: old, noul: 0.97, public: true}]}),
		{written: 0, public: 0, skipped: 1}, 'a verdict for what the row said before is skipped');
	assert.equal(await host.figures(CAMPAIGN, (m, p) => h.raw(m, p)), true);
	assert.equal(figureBatches(seen).length, 2);
	assert.deepEqual(Object.values(figureBatches(seen)[1].state.items).map(item => item.names), [['斯大林', 'Stalin', 'Joseph Stalin']]);
	assert.ok(!(await untoldNames(h)).includes('斯大林'), 'judged again');
	const refused = await refusalOf(h.call('cast.public.submit', {verdicts: [{id: row.id, row_sha256: 'x', noul: 2, public: true}]}));
	assert.equal(refused?.code, 'invalid_params', 'a noul outside 0..1 is refused');
	// Over the wire a Noul is a Python float, and 0 or 1 an int (the harness table found the in-process call hid it).
	const current = (await h.call('cast.public.job', {version: '2'})).people.find(person => person.id === row.id);
	const line = JSON.stringify({id: 'wire', method: 'cast.public.submit', params: {campaign: CAMPAIGN, version: '2',
		verdicts: [{id: row.id, row_sha256: current.row_sha256, noul: 0.97, public: true}, ...table.people.filter(other => other !== row).slice(0, 1)
			.map(other => ({id: other.id, row_sha256: 'old', noul: 0, public: false}))]}});
	const wire = await api.handleLine(line, h.runtime.handlers);
	assert.equal(wire.ok, true, JSON.stringify(wire));
	assert.deepEqual(wire.result, {written: 1, public: 1, skipped: 1});
});

test('§194.5: a public figure a handout prints tells nobody, and a graph person his row joins is never untold', async t => {
	const h = await farm(t, {figures: true});
	await addNodes(h, [
		{node_id: 'handout-poster', node_kind: 'handout', name: 'The Poster', visibility: 'player-safe', summary: 'A slogan.',
			properties: {authored_text: '为斯大林同志的五年计划而奋斗！——嘉琳娜·斯莫斯卡娅'}},
		{node_id: 'npc-stalin', node_kind: 'npc', name: '斯大林', summary: 'The leader on the wall.'}]);
	const host = hostHook(h, jevPort({figure: stalinOnly}));
	assert.equal(await host.figures(CAMPAIGN, (m, p) => h.raw(m, p)), true);
	const card = await h.call('table.look', {focus: 'npc', name: '斯大林'});
	assert.equal(card.untold, undefined, 'the graph person his row joins is never untold');
	const words = await h.call('epithets.job');
	assert.ok(card.id, JSON.stringify(card));
	assert.ok(!words.people.some(person => person.id === card.id), 'and no word is asked for him');
	await h.call('table.player_input', {text: '我看看那张海报。'});
	await h.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: 'The Poster', why: 'It hangs by the door.'}]});
	const {documents} = await h.call('table.untold_spans', {text: '海报贴在门边。'});
	assert.deepEqual(documents.map(document => document.spans.map(span => span.name)), [['嘉琳娜·斯莫斯卡娅']], 'his name is no place in the document');
	await host.deliver('table.narrate', {call_id: 't1-c2', text: '海报贴在门边。'});
	const [told] = (await records(h)).find(row => row.turn === 1).told_documents;
	assert.deepEqual(told.names, ['嘉琳娜·斯莫斯卡娅'], 'the poster tells only the character it prints');
	const known = (await h.call('table.player_input', {text: '我继续往前走。'})).capsule.player_knows.people;
	assert.ok(known.some(person => person.name === '嘉琳娜·斯莫斯卡娅'), JSON.stringify(known));
	assert.ok(!known.some(person => person.name === '斯大林' || person.book_name === '斯大林'), 'and he is not in the player\'s ledger by being public alone');
});

test('§194.5: a public figure\'s name is the investigator\'s side\'s, so an untold name inside it is no place', async t => {
	// A resident printed by a name the public figure's name holds whole: inside "斯大林" it is his, not hers.
	const h = await farm(t, {figures: true, rows: [{book: ['大林'], play: ['大林'], notes: ['Dalin'], pages: [1]}]});
	const host = hostHook(h, jevPort({figure: stalinOnly}));
	assert.equal(await host.figures(CAMPAIGN, (m, p) => h.raw(m, p)), true);
	await h.call('table.player_input', {text: '信上怎么说？'});
	assert.deepEqual((await h.call('table.untold_spans', {text: '大家都以斯大林的名义工作。'})).spans, [], 'no place inside his name');
	assert.deepEqual((await h.call('table.untold_spans', {text: '大林在门口。'})).spans.map(span => span.name), ['大林'], 'her name alone is still hers');
});

test('§194.5: one run per campaign at a time; a delivery\'s hook does not wait for a run in flight (the client\'s queue would hold it)', async () => {
	let release;
	const gate = new Promise(resolve => { release = resolve; }), calls = [];
	const call = async method => { calls.push(method); if (method === 'cast.public.job') await gate; return {job_id: null}; };
	const judge = createPublicFigureJudge({record: () => {}, decision: () => jevPort()});
	const first = judge(CAMPAIGN, call), shared = judge(CAMPAIGN, call);
	const late = new Promise(resolve => setTimeout(() => resolve('waited'), 200));
	assert.equal(await Promise.race([judge(CAMPAIGN, call, {wait: false}), late]), false, 'the delivery goes on at once');
	release();
	assert.deepEqual([await first, await shared], [false, false]);
	assert.deepEqual(calls, ['cast.public.job'], 'one run for all three');
	assert.equal(await createPublicFigureJudge({record: () => {}, decision: () => undefined})(CAMPAIGN, async () => { throw new Error('no Jev: nothing asked'); }), false);
});
