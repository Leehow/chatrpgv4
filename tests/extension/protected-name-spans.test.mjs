/**
 * Contract §188.1 (NR-01): protected spans in the request's rename and in the delivery gate.
 *
 * The §185 acceptance table (`nfh-accept-blood-road-1`, Blood Road, name-free): the investigator is 「丹尼尔·怀特」, and the book's
 * untold store owner 「丹尼尔·马瑟」 is also printed as the one-character 「丹」. §185.13 made the shared piece 「丹尼尔」 known; the
 * one-character alias still matched inside the investigator's name, so the Keeper's request read 「抓胡茬的红发杂货店主尼尔·怀特」,
 * and the Keeper copied it into `object.to`, `item.to`, `cash.subject` and a note the player reads.
 *
 * `protectedNames` (the kernel) lists every whole name the investigator's side owns; `table.untold` carries it as `protected`.
 * The host rename, its §177.15 judge and the kernel's gate (`table.untold_spans`, the `untold_name` hold) skip every place that
 * overlaps one of those occurrences. §194.1 (2026-10-08): the request no longer renames book names at all and its judge is
 * gone, so the request now carries the store owner's names as written beside the investigator's; the gate still holds them. Here, on the kernel in process and the context hooks as installed: a reader-built book
 * (name-free) whose store owner is printed 「丹尼尔·马瑟」, 「丹尼尔」 and 「丹尼」 and recorded with the alias 「丹」, and a starter
 * (legacy) whose investigator 「玛丽·斯通纳」 holds the untold 「玛丽·斯通」 whole.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {withPersonStatements} from './person-statements.mjs';
const root = resolve(import.meta.dirname, '../..');
// The installed hooks read the Jev key from the environment; this file never asks a live model.
for (const key of ['EXT_JEV_APIKEY', 'TYPESAFE_API_KEY']) delete process.env[key];
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'protected-name-spans-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {untoldRoster, renameUntold} from './extensions/kernel/untold-view.ts';
export {prosePlaces, untoldNamesSaid} from './kernel-ts/write/names.ts';
export {toldTurn} from './kernel-ts/journal/naming.ts';
export {prepareNameHistory} from './kernel-ts/journal/name-history.ts';
export {CONTINUITY_AUDIT} from './kernel-ts/mods/audit-result.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

async function kernel(t, seed) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed,
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	return {home, raw: (method, params = {}) => runtime.handlers[method](params)};
}

/** The investigator is registered under `name`, as table 30's was; returns the sheet ids. */
async function rename(home, campaign, name, appearance) {
	const folder = join(home, '.coc', 'campaigns', campaign, 'party'), ids = [];
	for (const file of (await readdir(folder)).filter(file => file.endsWith('.json'))) {
		const sheet = JSON.parse(await readFile(join(folder, file), 'utf8'));
		// The words the player wrote at setup reach the capsule's investigator section as `appearance` (§119).
		const backstory = appearance === undefined ? sheet.backstory : {...sheet.backstory, personal_description: appearance};
		await writeFile(join(folder, file), JSON.stringify({...sheet, name, ...(backstory === undefined ? {} : {backstory})}));
		ids.push(sheet.id);
	}
	return ids;
}

/** The Keeper's request as the installed context hook assembles it, with one tool result carrying `text`. */
async function keeperSees(home, campaign, call, input, text) {
	return (await keeperRequest(home, campaign, call, input, text)).find(message => message.role === 'toolResult').content[0].text;
}

/** Every message of that request, as the text the Keeper reads. */
async function keeperRequest(home, campaign, call, input, text) {
	const hooks = new Map(), bus = new Map();
	api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
		() => {}, () => api.workpadStoreRoot(home));
	bus.get('coc:kernel-bridge')({campaign, call});
	bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
	const {messages} = await hooks.get('context')({messages: [{role: 'user', content: 'I look around.'},
		{role: 'assistant', content: [{type: 'toolCall', id: 'lookup-1', name: 'lookup', arguments: {kind: 'source', query: 'the dock'}}]},
		{role: 'toolResult', toolCallId: 'lookup-1', toolName: 'lookup', content: [{type: 'text', text}]}]}, {model: {contextWindow: 1000000}});
	return messages;
}
const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part.text ?? '').join('');

const INVESTIGATOR = '丹尼尔·怀特', OWNER = '丹尼尔·马瑟';
const PAGES = ['The harbor dock smells of tar. 丹尼尔·马瑟 keeps the store; 丹尼尔 smokes at the door, and the regulars call him 丹尼.',
	'The old tower stands beyond the harbor.', 'A cellar floods at high tide.'];
const REFS = [{page: 1}];
const STORE_OWNER = {node_id: 'npc-daniel-mather', name: OWNER, aliases: ['丹'], summary: 'The store owner.'};

/**
 * A reader-built book (name-free): the Dock with the store owner in it. His node records the one-character alias 「丹」 (the cast
 * reader's forms are two characters or more, so the alias is the graph's), and the cast prints 「丹尼尔·马瑟」, 「丹尼尔」 and the
 * nickname 「丹尼」, which, unlike 「丹尼尔」, is no piece of the investigator's name and so is still a gated name (§177.11).
 */
const DOCK = {pages: PAGES, people: [STORE_OWNER],
	cast: [{book: [OWNER, '丹尼尔', '丹尼'], play: [OWNER, '丹尼尔', '丹尼'], notes: ['Daniel Mather', 'Daniel', 'Danny'], pages: [1]}]};

async function readerBuilt(t, book = DOCK, appearance) {
	const k = await kernel(t, 'protected-name-spans');
	const pdf = join(k.home, 'harbor.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${book.pages.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await k.raw('module.source.bind', {source: {path: pdf, page_count: book.pages.length, file_sha256: sha}});
	const read = async (purpose, draft, paths) => {
		await k.raw('module.read.request', {module_id: mid, purpose});
		const job = await k.raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths: withPersonStatements(draft, paths), verdict: 'supported', source_refs: REFS, reason: 'fixture support'}], missing: []}));
		return k.raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor', pages: [[1, 3]], source_refs: REFS, entities: ['Dock', 'Tower']}]}, []);
	const people = book.people.map(person => ({...person, node_kind: 'npc', source_refs: REFS}));
	await read('opening', {nodes: [
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'}, ...people],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS},
			...people.map(person => ({subject_id: person.node_id, predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS}))],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', ...people.map(person => person.node_id)]},
		['/nodes/0', ...people.map((_person, at) => `/nodes/${at + 2}`), '/claims/0', ...people.map((_person, at) => `/claims/${at + 1}`), '/coverage']);
	const cast = await k.raw('cast.job', {module_id: mid, claim: true});
	await k.raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: book.pages.map((text, index) => ({page: index + 1, text}))});
	const range = await k.raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: book.cast}));
	assert.equal((await k.raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: 'c1', module: mid, play_language: 'zh-Hans'});
	await k.raw('investigator.load', {campaign: 'c1', library_id: saved.library_id});
	const ids = await rename(k.home, 'c1', INVESTIGATOR, appearance);
	await k.raw('setup.complete', {campaign: 'c1'});
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('table.open');
	assert.equal(JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).handles, 'name-free');
	return {...k, call, ids};
}

test('§188.1/§194.1 (name-free): the request keeps the investigator\'s name whole, and now the untold name, the alias and the nickname as written', async t => {
	const h = await readerBuilt(t);
	const answer = await h.call('table.untold');
	const names = answer.people.map(row => row.name);
	for (const name of [OWNER, '丹', '丹尼']) assert.ok(names.includes(name), `${name} is an untold row: ${JSON.stringify(names)}`);
	assert.ok(Array.isArray(answer.protected), 'table.untold carries protected beside people');
	for (const name of [INVESTIGATOR, ...h.ids]) assert.ok(answer.protected.includes(name), `${name} is protected: ${JSON.stringify(answer.protected)}`);
	assert.ok(['丹尼尔', '怀特'].every(name => answer.protected.includes(name)), 'and the pieces of his name (§185.13\'s trade, at the span level)');
	assert.ok(!answer.protected.some(name => [OWNER, '丹', '丹尼'].includes(name)), 'no untold name is protected');
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const input = await h.call('table.player_input', {text: '我走进杂货店。'});

	const sent = await keeperSees(h.home, 'c1', h.call, input, `${INVESTIGATOR} 在码头遇见了 ${OWNER}。丹说今天不开张，丹尼也这么说。`);
	assert.ok(sent.startsWith(`${INVESTIGATOR} 在码头遇见了 `), `the investigator's name reaches the Keeper whole: ${sent}`);
	assert.equal(sent.split(INVESTIGATOR).length, 2, 'exactly once, as written');
	assert.equal(sent, `${INVESTIGATOR} 在码头遇见了 ${OWNER}。丹说今天不开张，丹尼也这么说。`, `§194.1: the book's names reach the Keeper as written: ${sent}`);
});

test('§188.1 (name-free): the gate holds the untold name and never a name inside the investigator\'s', async t => {
	const h = await readerBuilt(t);
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const spans = await h.call('table.untold_spans', {text: `${INVESTIGATOR}看着${OWNER}，丹尼没说话。`});
	assert.deepEqual(spans.spans.map(span => span.name), [OWNER, '丹尼'], 'the places to judge are the store owner\'s, none inside the investigator\'s name');
	assert.equal(spans.spans[1].start, `${INVESTIGATOR}看着${OWNER}，`.length);

	const input = await h.call('table.player_input', {text: '我走进杂货店。'});
	const own = await h.call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: `${INVESTIGATOR}推开杂货店的门。`});
	assert.equal(own.rendered_text.includes(`${INVESTIGATOR}推开杂货店的门`), true, 'a delivery naming the investigator in full is not held');
	const next = await h.call('table.player_input', {text: '我看看店主。'});
	await assert.rejects(h.call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: `${OWNER}抬起头。`}),
		error => error?.details?.reason === 'untold_name', 'a delivery naming the untold person is held');
	await assert.rejects(h.call('table.narrate', {call_id: `t${next._context.turn}-c2`, text: `${INVESTIGATOR}看见丹尼抬起头。`}),
		error => error?.details?.reason === 'untold_name' && error.details.places === 1, 'the nickname alone is still held, once');
	// The same name again this turn goes out replaced (§177.11), at its own place only: the investigator's name stays whole.
	const again = await h.call('table.narrate', {call_id: `t${next._context.turn}-c3`, text: `${INVESTIGATOR}看见丹尼抬起头。`});
	assert.ok(again.rendered_text.startsWith(`${INVESTIGATOR}看见`) && !again.rendered_text.includes('看见丹尼'), again.rendered_text);
	// A name token naming nobody is left as the word it carries (§103.8): the nickname said only there is still held, though the
	// prose holds it inside the investigator's name.
	const third = await h.call('table.player_input', {text: '我喊了一声。'});
	await assert.rejects(h.call('table.narrate', {call_id: `t${third._context.turn}-c1`, text: `${INVESTIGATOR}喊：“{{name:丹尼某某}}在吗？”`}),
		error => error?.details?.reason === 'untold_name' && error.details.places === 0, 'said inside an unresolved token: held, with no place');
});

test('§188.1 (legacy): a starter\'s investigator holding an untold name whole keeps it; the told and the table\'s words are protected', async t => {
	const k = await kernel(t, 'protected-name-spans-legacy');
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'voice-bench', pregen: 'shen-zhiwei', play_language: 'zh-Hans'});
	const ids = await rename(k.home, 'c1', '玛丽·斯通纳');
	await call('table.open');
	assert.equal(JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).handles, 'legacy');
	const before = await call('table.untold');
	assert.ok(before.people.some(row => row.name === '玛丽·斯通') && before.people.some(row => row.name === '斯通'), JSON.stringify(before.people));
	assert.ok(['玛丽·斯通纳', ...ids].every(name => before.protected.includes(name)), JSON.stringify(before.protected));

	// The table's words for people are protected, and a person once told is.
	const job = await call('epithets.job');
	const entries = job.people.map((person, at) => ({id: person.id, word: `第${at + 1}张桌边的客人`}));
	assert.deepEqual((await call('epithets.submit', {entries})).refused, []);
	// A starter has no cast, so the gate holds nothing (§177.11): the prose tells the name, and no label is written for it.
	await call('table.narrate', {call_id: 't0-c1', text: '雨夜。门口坐着王铁柱。'});
	const input = await call('table.player_input', {text: '我找个位子坐下。'});
	const after = await call('table.untold');
	assert.ok(after.protected.includes('王铁柱'), `a told person's name is protected: ${JSON.stringify(after.protected)}`);
	// The epithets fold at the next safe moment for the people still untold (§176.1); the told man's was never folded.
	const folded = entries.filter(entry => after.people.some(row => row.id === entry.id));
	assert.equal(folded.length, 8);
	assert.ok(folded.every(entry => after.protected.includes(entry.word)), `every word this table calls someone is protected: ${JSON.stringify(after.protected)}`);
	assert.ok(!after.protected.includes('玛丽·斯通') && !after.protected.includes('斯通'), 'the untold person\'s names are not');

	const sent = await keeperSees(k.home, 'c1', call, input, '玛丽·斯通纳 在窗边看见了 玛丽·斯通。斯通没有回头。');
	assert.equal(sent, '玛丽·斯通纳 在窗边看见了 玛丽·斯通。斯通没有回头。', `§194.1: the investigator's name and the untold name both reach the Keeper as written: ${sent}`);
	const own = await call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: '玛丽·斯通纳把伞靠在门边。'});
	assert.match(own.rendered_text, /玛丽·斯通纳把伞靠在门边/);
});

test('§188.1: a protected name inside a longer untold name does not shield it; one holding an untold name whole does, on both sides', () => {
	// A told person's bare first name (a whole name of theirs) begins an untold person's full name: the full name is still the
	// untold person's place, as a name inside a longer name's place goes with that place (§177.15). Table 24 had two such men.
	const roster = {people: [{name: OWNER, shown: 'the store owner'}, {name: '丹', shown: 'the store owner'}], protected: ['丹尼尔', INVESTIGATOR]};
	const message = {role: 'toolResult', toolCallId: 'a', toolName: 'lookup', content: [{type: 'text', text: `${OWNER}来了，${INVESTIGATOR}看见丹，丹尼尔也来了。`}]};
	const [renamed] = api.renameUntold([message], roster);
	assert.equal(renamed.content[0].text, `the store owner来了，${INVESTIGATOR}看见the store owner，丹尼尔也来了。`);
	assert.equal(api.renameUntold([message], roster.people)[0].content[0].text.split('the store owner').length - 1, 4, 'bare rows protect nothing: every 丹 is renamed');

	const text = `${OWNER}来了，${INVESTIGATOR}看见丹尼，丹尼尔也来了。`, none = () => ({});
	const said = api.untoldNamesSaid(text, none, {find: () => null}, [OWNER, '丹尼'], roster.protected);
	assert.deepEqual(said, [OWNER, '丹尼']);
	assert.deepEqual(api.prosePlaces(text, said, roster.protected).map(place => [place.name, place.start]),
		[[OWNER, 0], ['丹尼', `${OWNER}来了，${INVESTIGATOR}看见`.length]], 'the gate reads the same places');
	assert.deepEqual(api.untoldNamesSaid(`${INVESTIGATOR}来了。`, none, {find: () => null}, ['丹尼'], roster.protected), [], 'said only inside a protected name: not said');
});

/**
 * §188.1 (told detection): a book where two other people's names stand inside the investigator's 「丹尼尔·怀特」: an unread cast
 * row printed 「丹尼尔」 alone (a second Daniel; the notes render him "Daniel" and "Dan"), and the postmaster 「怀特」, a graph person. The
 * store owner 「丹尼尔·马瑟」 keeps the alias 「丹」. Before, the investigator's name in a delivery made both of them told: the unread
 * row's names left the roster with it (and "Daniel", a notes word it shares with the store owner, reached the Keeper), and the
 * journal's floor would have written the postmaster's `named_at` for good.
 */
const TOLD = {pages: ['The harbor dock smells of tar. 丹尼尔·马瑟 keeps the store. 丹尼尔 smokes at the door. 怀特 sorts the mail.',
	'The old tower stands beyond the harbor.', 'A cellar floods at high tide.'],
people: [STORE_OWNER, {node_id: 'npc-mr-white', name: '怀特', summary: 'The postmaster.'}],
cast: [{book: [OWNER], play: [OWNER], notes: ['Daniel Mather'], pages: [1]}, {book: ['丹尼尔'], play: ['丹尼尔'], notes: ['Daniel', 'Dan'], pages: [1]},
	{book: ['怀特'], play: ['怀特'], notes: ['White'], pages: [1]}]};

/** The roster's ids: the unread Dan's row id, the postmaster's handle, the store owner's handle. */
async function toldCast(h) {
	const roster = (await h.call('table.untold')).people, idOf = name => roster.find(row => row.name === name)?.id;
	const ids = {dan: idOf('Dan'), white: idOf('White'), owner: idOf(OWNER)};
	assert.ok(ids.dan && ids.white && ids.owner && ids.dan !== ids.owner, JSON.stringify(roster));
	assert.ok(roster.some(row => row.name === 'Daniel'), 'the store owner\'s notes word is hidden');
	return ids;
}
const untoldIn = (input, id) => input.capsule.present.find(person => person.untold?.id === id || person.id === id)?.untold ?? null;

test('§188.1 (told detection): the investigator\'s name in the prose tells nobody whose name stands inside it', async t => {
	const h = await readerBuilt(t, TOLD);
	const ids = await toldCast(h);
	await h.call('table.narrate', {call_id: 't0-c1', text: `${INVESTIGATOR}推开杂货店的门。`});
	const after = (await h.call('table.untold')).people;
	assert.ok(after.some(row => row.name === 'Dan' && row.id === ids.dan), `the unread Daniel is still untold: ${JSON.stringify(after)}`);
	assert.ok(after.some(row => row.name === 'Daniel'), 'and "Daniel", which the store owner\'s notes share, is still hidden (before, the second Daniel was told and it reached the Keeper)');
	assert.ok(after.some(row => row.name === OWNER) && after.some(row => row.name === 'White'), 'nobody else was told either');
	const input = await h.call('table.player_input', {text: '我看看四周。'});
	assert.ok(untoldIn(input, ids.white), `the postmaster is still untold: ${JSON.stringify(input.capsule.present)}`);

	// The journal lane: its floor does not count the postmaster as named, and a quote that says his name only inside the
	// investigator's is no naming of him, by itself or with named_as.
	const job = await h.call('journal.job', {turn: 0});
	assert.ok(job.unnamed.includes('怀特'), `the floor leaves him unnamed: ${JSON.stringify(job.unnamed)}`);
	const quote = `${INVESTIGATOR}推开杂货店的门。`;
	await assert.rejects(h.call('journal.submit', {job_id: job.job_id, lease: job.lease, entries: [{name: '怀特', named: true, named_quote: quote}]}),
		error => error?.details?.reason === 'not_a_book_name', 'the quote carries his name only inside the investigator\'s');
	await assert.rejects(h.call('journal.submit', {job_id: job.job_id, lease: job.lease, entries: [{name: '怀特', named: true, named_quote: quote, named_as: '怀特'}]}),
		error => error?.details?.reason === 'not_a_book_name', 'nor does named_as found only there');
});

test('§188.1 (told detection): a person\'s own name said in the prose still tells them, and their own word never shields it', async t => {
	const h = await readerBuilt(t, TOLD);
	const ids = await toldCast(h);
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const input = await h.call('table.player_input', {text: '我问邮差他叫什么。'});
	// The postmaster's whole name is the investigator's surname, a piece of the investigator's name (§185.13's trade at the span
	// level): 「怀特」 alone in the prose is the investigator's and tells him nothing. The name token does: it also makes 「怀特」
	// the postmaster's own word at this table, which never shields his own name.
	await h.call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: '怀特先生点了点头。'});
	const asked = await h.call('table.player_input', {text: '我再问一遍。'});
	assert.ok(untoldIn(asked, ids.white), 'his name alone is the investigator\'s piece: not told');
	await h.call('table.narrate', {call_id: `t${asked._context.turn}-c1`, text: `邮差说：“我是{{name:${ids.white}}}。”`});
	const next = await h.call('table.player_input', {text: '我问店主他叫什么。'});
	assert.equal(untoldIn(next, ids.white), null, 'the name token tells him');
	assert.ok(!(await h.call('table.untold')).people.some(row => row.name === 'White'));
	// The name token puts the store owner's book name in the prose and makes it this table's word for him (§103.8): his own word
	// stands exactly where his name does, and does not shield it. It does shield the second Daniel, whose name stands inside it.
	await h.call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: `店主抬起头：“我是{{name:${ids.owner}}}。”`});
	const roster = (await h.call('table.untold')).people;
	assert.ok(!roster.some(row => row.name === OWNER), `the store owner is told: ${JSON.stringify(roster)}`);
	assert.ok(roster.some(row => row.name === 'Dan' && row.id === ids.dan), 'the unread Daniel inside his name is not');
});

test('§188.1 (told detection): a say token\'s shown word reads the same guard as the prose', () => {
	// A speech row's `shown` is the token's own text when it matched one of the person's names (§103.5), and the told check
	// reads it. On the real path a token by the table's word shows nothing, so this pins the speech branch on its own: a shown
	// word holding the person's name inside an investigator's registered name tells nobody; their own word does not shield it.
	const graph = {handle: node => node.handle, displayName: node => node.name, nodeHandles: null};
	const node = {node_id: 'npc-wang', handle: 'wang', name: '王铁柱'};
	const records = [{closed_by: 'narrate', commit: true, turn: 1, rendered_text: '伙计擦着桌子。', speech: [{who: {npc: 'wang', name: '王铁柱', shown: '王铁柱·怀特'}}]}];
	const guard = owners => ({key: JSON.stringify(owners), words: [{word: '王铁柱·怀特', owners}]});
	assert.equal(api.toldTurn(graph, node, api.prepareNameHistory(records)), 1, 'unguarded, the shown word tells him');
	assert.equal(api.toldTurn(graph, node, api.prepareNameHistory(records, guard([]))), null, 'inside an investigator\'s name it does not');
	assert.equal(api.toldTurn(graph, node, api.prepareNameHistory(records, guard(['wang']))), 1, 'his own word never shields his name');
});

/**
 * §188.1, the investigator's pieces (real table nr06-blood-road-2, 2026-10-07): the investigator's own sheet said
 * 「委托人的女儿三个月前在这条公路上失踪，丹尼尔受托寻找她。」, his given name alone, and only his full name was protected, so the
 * untold store owner's one-character alias 「丹」 was renamed inside it: the Keeper read 「戴厚黑框眼镜的红发店主尼尔受托寻找她」 and
 * on turn 5 had the store owner introduce himself as 「尼尔」.
 */
const BRIEF = '委托人的女儿三个月前在这条公路上失踪，丹尼尔受托寻找她。';

test('§188.1 (investigator\'s pieces): his given name alone stays whole in the request, the gate and the told check', async t => {
	const h = await readerBuilt(t, DOCK, BRIEF);
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const input = await h.call('table.player_input', {text: '我走进杂货店。'});
	const messages = await keeperRequest(h.home, 'c1', h.call, input, `${OWNER}在柜台后面。丹说今天不开张，丹尼尔受托寻找她。`);
	const sheet = messages.filter(message => message.role !== 'toolResult').map(textOf).filter(text => text.includes('受托寻找她'));
	assert.ok(sheet.length, 'the capsule carries the investigator\'s own words');
	assert.ok(sheet.every(text => text.includes('丹尼尔受托寻找她')), `the sheet's words reach the Keeper as written: ${sheet.map(text => text.slice(text.indexOf('受托') - 30, text.indexOf('受托') + 6))}`);
	const result = textOf(messages.find(message => message.role === 'toolResult'));
	assert.ok(result.includes('丹尼尔受托寻找她'), result);
	assert.ok(result.includes(OWNER) && result.includes('丹说'), `§194.1: the store owner's full name and a lone alias reach the Keeper as written: ${result}`);

	// The gate: 「丹尼尔」 alone means the investigator; the nickname 「丹尼」 inside it is no untold place.
	assert.deepEqual((await h.call('table.untold_spans', {text: '丹尼尔走进杂货店。'})).spans, []);
	const own = await h.call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: '丹尼尔走进杂货店。'});
	assert.match(own.rendered_text, /丹尼尔走进杂货店/, 'a delivery saying his given name alone is not held');
	// Told detection: the journal lane may not count the store owner named by it, as a quote or as named_as.
	const job = await h.call('journal.job', {turn: input._context.turn});
	assert.ok(job.unnamed.includes(OWNER), JSON.stringify(job.unnamed));
	await assert.rejects(h.call('journal.submit', {job_id: job.job_id, lease: job.lease, entries: [{name: OWNER, named: true, named_quote: '丹尼尔走进杂货店。'}]}),
		error => error?.details?.reason === 'not_a_book_name', 'the quote carries his name only as the investigator\'s given name');
	await assert.rejects(h.call('journal.submit', {job_id: job.job_id, lease: job.lease, entries: [{name: OWNER, named: true, named_quote: '丹尼尔走进杂货店。', named_as: '丹尼尔'}]}),
		error => error?.details?.reason === 'not_a_book_name', 'nor as named_as');
	assert.ok((await h.call('table.untold')).people.some(row => row.name === OWNER), 'the store owner is still untold');
});

test('§188.1 (investigator\'s pieces): his given name alone in the prose tells no untold person who carries it', async t => {
	const h = await readerBuilt(t, TOLD);
	const ids = await toldCast(h);
	await h.call('table.narrate', {call_id: 't0-c1', text: BRIEF});
	const after = (await h.call('table.untold')).people;
	assert.ok(after.some(row => row.name === 'Dan' && row.id === ids.dan), `the unread second Daniel is still untold: ${JSON.stringify(after)}`);
	assert.ok(after.some(row => row.name === 'Daniel') && after.some(row => row.name === OWNER), 'and so is the store owner');
});

/**
 * §188.8 (real table nr07-blood-road-1, 2026-10-07): two untold men share the first name 「皮特」, the trailer squatter and the
 * hardware store owner, so the request shows that name as both their words joined. §177.11's second delivery put the joined
 * word into the player's prose as if it were one man's name, in four turns.
 */
const TRAILER = '拒绝饮酒的拖车住客', HARDWARE = '戴眼镜的五金店老板';
const SHARED = {pages: ['The harbor dock smells of tar. 皮特·诺兰 sleeps in a trailer behind the dock. 皮特·加西亚 keeps the hardware store. Town calls both of them 皮特.',
	'The old tower stands beyond the harbor.', 'A cellar floods at high tide.'],
people: [{node_id: 'npc-pete-trailer', name: '皮特·诺兰', summary: 'Lives in a trailer.'}, {node_id: 'npc-pete-hardware', name: '皮特·加西亚', summary: 'Runs the hardware store.'}],
cast: [{book: ['皮特·诺兰', '皮特'], play: ['皮特·诺兰', '皮特'], notes: ['Pete Nolan', 'Pete'], pages: [1]},
	{book: ['皮特·加西亚', '皮特'], play: ['皮特·加西亚', '皮特'], notes: ['Pete Garcia', 'Pete'], pages: [1]}]};

/** The shared book with each man's word folded, and the turn open; the joined word as the request shows it. */
async function twoPetes(t) {
	const h = await readerBuilt(t, SHARED);
	const roster = (await h.call('table.untold')).people, idOf = name => roster.find(row => row.name === name)?.id;
	const trailer = idOf('皮特·诺兰'), hardware = idOf('皮特·加西亚');
	assert.ok(trailer && hardware && trailer !== hardware, JSON.stringify(roster));
	assert.deepEqual((await h.call('epithets.submit', {entries: [{id: trailer, word: TRAILER}, {id: hardware, word: HARDWARE}]})).refused, []);
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const input = await h.call('table.player_input', {text: '我问镇上有没有叫皮特的人。'});
	const joined = (await h.call('table.untold')).people.find(row => row.name === '皮特')?.shown;
	assert.ok(joined && joined.includes(TRAILER) && joined.includes(HARDWARE) && joined !== TRAILER && joined !== HARDWARE, `the request shows the shared name joined: ${joined}`);
	let n = 0;
	return {...h, turn: input._context.turn, joined, trailer, hardware, narrate: text => h.call('table.narrate', {call_id: `t${input._context.turn}-c${++n}`, text})};
}
const heldShared = (joined, words) => error => {
	const text = `${error?.message ?? ''}\n${error?.fix ?? error?.data?.fix ?? ''}`;
	return error?.details?.reason === 'untold_name' && words.every(word => text.includes(`"${word}"`)) && !text.includes(joined);
};
/** A refusal's candidate lists as their words, each list sorted: NR-08b's rows are `{word, say_name}`. */
const sorted = groups => groups.map(people => people.map(person => typeof person === 'string' ? person : person.word).sort()).sort();

test('§188.8: a delivery saying a name two untold people share is held with each person\'s own word, never joined, and never replaced', async t => {
	const h = await twoPetes(t);
	const text = '你问镇上有没有叫皮特的人。本说：“皮特？你是说五金店那个吗？”';
	await assert.rejects(h.narrate(text), error => heldShared(h.joined, [TRAILER, HARDWARE])(error)
		&& JSON.stringify(sorted(error.details.shared)) === JSON.stringify(sorted([[TRAILER, HARDWARE]])), 'held, each word apart');
	await assert.rejects(h.narrate(text), error => heldShared(h.joined, [TRAILER, HARDWARE])(error), 'the same text again is held again: no word stands for a name two people share');
	const own = await h.narrate(`你问镇上的人。本说：“${HARDWARE}？我知道他。”`);
	assert.ok(own.rendered_text.includes(HARDWARE) && !own.rendered_text.includes(h.joined), 'one person\'s own word goes out');
});

test('§188.8: a delivery or a document that writes the joined word verbatim is held with each person\'s own word', async t => {
	const h = await twoPetes(t);
	await assert.rejects(h.narrate(`你问镇上有没有叫${h.joined}的人。`),
		error => heldShared(h.joined, [TRAILER, HARDWARE])(error) && JSON.stringify(sorted(error.details.joined)) === JSON.stringify(sorted([[TRAILER, HARDWARE]])));
	await assert.rejects(h.narrate(`你问镇上有没有叫${h.joined}的人。`), error => error?.details?.reason === 'untold_name', 'every time');
	await assert.rejects(h.narrate(`{{say:${h.joined}}}“谁找我？”{{/say}}`), error => error?.details?.joined?.length === 1, 'inside a marker too');

	// A note the investigator writes is text the player reads (the §185 table had the Keeper copy a request-only string into one).
	const fixture = join(h.home, 'notes-mod');
	await cp(join(root, 'mods/enhanced-items'), fixture, {recursive: true});
	const manifest = JSON.parse(await readFile(join(fixture, 'mod.json'), 'utf8'));
	await writeFile(join(fixture, 'mod.json'), JSON.stringify({...manifest, id: 'notes-fixture', version: '1.0.0',
		requires: [...new Set([...manifest.requires, 'objects.usages.v1', api.CONTINUITY_AUDIT])], contributes: {materializer: 'creator.md', auditor: 'auditor.md'}}));
	await h.call('mods.install', {path: fixture});
	await h.call('mods.configure', {id: 'notes-fixture', version: '1.0.0', enabled: true});
	const job = await h.call('mods.job', {role: 'create', input: {name: 'Notebook', category: 'item', description: 'A pocket notebook.'}});
	const definition = {name: 'Notebook', category: 'item', description: 'A pocket notebook.', basis: 'Present in this contract fixture.',
		parameters: {charges: null, effects: []}, player_view: {description: 'A pocket notebook.', fields: []}};
	await writeFile(join(job.cwd, 'result.json'), JSON.stringify(definition));
	const accepted = await h.call('mods.accept', {job: job.job});
	let c = 10;
	const apply = effects => h.call('table.apply', {call_id: `t${h.turn}-c${++c}`, effects});
	await apply([{kind: 'define', name: 'Notebook', category: 'item', _definition: accepted.definition, _provenance: accepted.provenance},
		{kind: 'object', name: 'Pocket notebook', definition: 'Notebook', to: INVESTIGATOR, document: {text: '', presentation: 'notebook'}}]);
	await assert.rejects(apply([{kind: 'object', name: 'Pocket notebook', from: INVESTIGATOR, to: INVESTIGATOR, why: 'he writes it down',
		document: {action: 'write', text: `问${h.joined}关于失踪的女孩。`}}]),
		error => heldShared(h.joined, [TRAILER, HARDWARE])(error) && error.details.field === 'object.document.text');
	await apply([{kind: 'object', name: 'Pocket notebook', from: INVESTIGATOR, to: INVESTIGATOR, why: 'he writes it down', document: {action: 'write', text: `问${HARDWARE}关于失踪的女孩。`}}]);
});

test('§188.8: a name one untold person carries is held, then replaced by their word, as before', async t => {
	const h = await twoPetes(t);
	const text = '皮特·诺兰从拖车里探出头。';
	await assert.rejects(h.narrate(text), error => error?.details?.reason === 'untold_name' && !error.details.shared && !error.details.joined, 'held, with the usual fix');
	const second = await h.narrate(text);
	assert.equal(second.rendered_text, `${TRAILER}从拖车里探出头。`, 'the second delivery shows his own word');
});

/**
 * NR-08b (real table nr08-blood-road-1, turns 8 and 9): the hardware store's man was asked his name and the Keeper had him give
 * it; every way of writing the shared name was refused, about thirty times, until the refusal budget ran out and two turns
 * delivered nothing. The refusal now carries each person's say_name: the token has the name said for that one person.
 */
test('§188.8 NR-08b: the hold lists each person\'s say_name; the token delivers the book\'s name and tells only that person', async t => {
	const h = await twoPetes(t);
	await assert.rejects(h.narrate('五金店老板说：“我叫皮特。”'), error => {
		const people = error?.details?.shared?.[0] ?? [];
		return heldShared(h.joined, [TRAILER, HARDWARE])(error) && people.length === 2
			&& people.every(person => person.say_name === `{{name:${person.word}}}` && error.message.includes(person.say_name))
			&& /say_name/.test(error.fix);
	}, 'each candidate with their own token');
	// apply person refuses the bare name and hands over the same token.
	await assert.rejects(h.call('table.apply', {call_id: `t${h.turn}-c20`, effects: [{kind: 'person', who: HARDWARE, name: '皮特', why: 'he gives his name'}]}),
		error => error?.details?.reason === 'untold_name' && error.details.say_name === `{{name:${HARDWARE}}}` && error.fix.includes(`{{name:${HARDWARE}}}`));
	const said = await h.narrate(`五金店老板说：“我叫{{name:${HARDWARE}}}。”`);
	assert.ok(said.rendered_text.includes('我叫皮特·加西亚'), `the delivery puts in the book's name for him: ${said.rendered_text}`);
	const roster = (await h.call('table.untold')).people;
	assert.ok(!roster.some(row => row.name === '皮特·加西亚'), 'he is told');
	assert.ok(roster.some(row => row.name === '皮特·诺兰'), `the other man is not: ${JSON.stringify(roster)}`);
	const next = await h.call('table.player_input', {text: '我看向拖车那边。'});
	await assert.rejects(h.call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: '皮特·诺兰从拖车里探出头。'}),
		error => error?.details?.reason === 'untold_name', 'and his name is still held');
});
