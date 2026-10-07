/**
 * Contract §188.3 (amends §185.3; docs/specs/names-in-the-request-rename.md, NR-03): a reference that misses is read once more
 * with the request's rename undone -- every row the roster can make, names as well as handles, in name-free and legacy
 * campaigns alike.
 *
 * The seam is §188.6's: the kernel in process and the context hooks as installed. A tool result carrying the book's text is
 * handed to the hook, and each string the Keeper would copy is taken from the request the hook assembles and sent back in the
 * tool call that uses it, one per rename row kind:
 * - a whole name: 「丹尼尔·马瑟」 shown as his word, as `npc.name`;
 * - a piece: 「马瑟」 inside the clue 「马瑟的账本」, as `clue`;
 * - a one-character alias: 「丹」 inside the clue 「丹的钥匙」, as `clue`;
 * - a joined word (§177.4): 「丹尼尔」, which an unread man of the book (「丹尼尔·罗斯」) shares, resolves to the one node its
 *   names reach (name-free); 「艾米」, which two people of the graph share, is refused `ambiguous`, naming each by their own
 *   word and never by a book name;
 * - a legacy handle: the clue whose handle begins with Mather's, as `clue`.
 *
 * The investigator shares no name with anyone here: §188.1 keeps an investigator's name out of the rename (NR-01), so these are
 * places the rename really makes.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'rename-undo-names-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {loadCampaignModule} from './kernel-ts/read/campaign.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

/** The book's people, and the words this table gives them. */
const MATHER = '丹尼尔·马瑟', ROSS = '丹尼尔·罗斯', CLARK = '艾米·克拉克', STONE = '艾米·斯通';
const WORDS = {[MATHER]: '戴草帽的店主', [ROSS]: '开卡车的路人', [CLARK]: '红围巾的女人', [STONE]: '提灯的女人'};
/** Two men the book prints by one bare name and nothing else (name-free book only), and their words. */
const TOM = '汤姆', TOMS = {'npc-tom-north': '北码头的渔夫', 'npc-tom-south': '南码头的渔夫'};
/** A name-free handle before any fold (§185.4). */
const interim = id => `npc-${createHash('sha256').update(id).digest('hex').slice(0, 6)}`;
/** Every book name and piece of the people here, none of which a refusal may carry. */
const BOOK_NAMES = [MATHER, ROSS, CLARK, STONE, TOM, '丹尼尔', '马瑟', '罗斯', '艾米', '克拉克', '斯通', 'Daniel', 'Mather', 'Ross', 'Amy', 'Clark', 'Stone'];
const LEDGER = '马瑟的账本', KEY = '丹的钥匙';
/** What a source lookup hands back: the book's own text, one labelled line per string the Keeper will copy. */
const PAGE = `whole: ${MATHER}.\npiece: ${LEDGER}.\nsingle: ${KEY}.\nshared: 丹尼尔.\nboth: 艾米.\nalike: ${TOM}.`;

async function kernel(t, seed, content = join(root, 'content')) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content, seed,
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	return {home, context, raw: (method, params = {}) => runtime.handlers[method](params)};
}

/** The Keeper's request as the installed context hook assembles it, with one tool result carrying `text`: that result's text and the capsule. */
async function keeperSees(game, input, text) {
	const hooks = new Map(), bus = new Map();
	api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
		() => {}, () => api.workpadStoreRoot(game.home));
	bus.get('coc:kernel-bridge')({campaign: 'c1', call: game.call});
	bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
	const {messages} = await hooks.get('context')({messages: [{role: 'user', content: '我看看四周。'},
		{role: 'assistant', content: [{type: 'toolCall', id: 'lookup-1', name: 'lookup', arguments: {kind: 'source', query: 'the store'}}]},
		{role: 'toolResult', toolCallId: 'lookup-1', toolName: 'lookup', content: [{type: 'text', text}]}]}, {model: {contextWindow: 1000000}});
	return {text: messages.find(message => message.role === 'toolResult').content[0].text,
		capsule: JSON.parse(messages.find(message => message.customType === 'coc-capsule').content)};
}
/** Every string in `value` that `pick` keeps. */
const strings = (value, pick, out = []) => {
	if (typeof value === 'string') { if (pick(value)) out.push(value); }
	else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, pick, out);
	return out;
};
/** The string the request holds on one labelled line of the page. */
const copied = (sent, label) => sent.match(new RegExp(`^${label}: (.+)\\.$`, 'm'))?.[1];

/** Give each person their word through the epithet lane, and open a turn; the words are folded at its start (§176.1). */
async function worded(game, ids) {
	const answer = await game.call('epithets.submit', {entries: Object.entries(ids).map(([name, id]) => ({id, word: WORDS[name]}))});
	assert.deepEqual(answer.refused, [], JSON.stringify(answer.refused));
	await game.call('table.narrate', {call_id: 't0-c1', text: '风从海上吹来。'});
	return game.call('table.player_input', {text: '我走进杂货店。'});
}

const REFS = [{page: 1}];
const claim = (subject_id, predicate, object) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: REFS});
const PAGES = [`${MATHER} keeps the store; 丹 smokes at the door. ${ROSS} drives the truck. ${CLARK} and ${STONE} sell bait.`,
	`${LEDGER} lies under the counter. ${KEY} hangs on a nail.`, 'A cellar floods at high tide.'];

/** A reader-built book (name-free): the Store with Mather, Clark and Stone in it, two clues there, and its cast read. */
async function nameFree(t, unworded = []) {
	const k = await kernel(t, 'rename-undo-names-free');
	const pdf = join(k.home, 'store.pdf');
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
	await read('index', {title: 'The Store', language: 'en', sections: [{name: 'Store', pages: [[1, 3]], source_refs: REFS, entities: ['Store', 'Cellar']}]}, []);
	const nodes = [
		{node_id: 'scene-store', node_kind: 'scene', name: 'Store', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-cellar', node_kind: 'scene', name: 'Cellar', source_refs: [{page: 3}], summary: 'A cellar that floods.'},
		{node_id: 'npc-daniel-mather', node_kind: 'npc', name: MATHER, aliases: ['丹'], source_refs: REFS, summary: 'The store owner.'},
		{node_id: 'npc-amy-clark', node_kind: 'npc', name: CLARK, source_refs: REFS, summary: 'A woman selling bait.'},
		{node_id: 'npc-amy-stone', node_kind: 'npc', name: STONE, source_refs: REFS, summary: 'Another woman selling bait.'},
		...Object.keys(TOMS).map(id => ({node_id: id, node_kind: 'npc', name: TOM, source_refs: REFS, summary: `A fisherman, ${id}.`})),
		{node_id: 'clue-mather-ledger', node_kind: 'clue', name: LEDGER, source_refs: [{page: 2}], summary: 'The store\'s accounts.'},
		{node_id: 'clue-dan-key', node_kind: 'clue', name: KEY, source_refs: [{page: 2}], summary: 'A key on a nail.'}];
	const claims = [claim('scene-store', 'route-to', 'scene-cellar'),
		...['npc-daniel-mather', 'npc-amy-clark', 'npc-amy-stone', ...Object.keys(TOMS)].map(id => claim(id, 'present-in', 'scene-store')),
		claim('clue-mather-ledger', 'discoverable-at', 'scene-store'), claim('clue-dan-key', 'discoverable-at', 'scene-store')];
	await read('opening', {nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: nodes.map(node => node.node_id)},
		[...nodes.keys().map(index => `/nodes/${index}`), ...claims.keys().map(index => `/claims/${index}`), '/coverage']);
	const cast = await k.raw('cast.job', {module_id: mid, claim: true});
	await k.raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const range = await k.raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [
		{book: [MATHER, '丹尼尔', '丹'], play: [MATHER, '丹尼尔', '丹'], notes: ['Daniel Mather', 'Daniel', 'Dan'], pages: [1]},
		{book: [ROSS, '丹尼尔'], play: [ROSS, '丹尼尔'], notes: ['Daniel Ross', 'Daniel'], pages: [1]},
		{book: [CLARK, '艾米'], play: [CLARK, '艾米'], notes: ['Amy Clark', 'Amy'], pages: [1]},
		{book: [STONE, '艾米'], play: [STONE, '艾米'], notes: ['Amy Stone', 'Amy'], pages: [1]}]}));
	assert.equal((await k.raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: 'c1', module: mid, play_language: 'zh-Hans'});
	await k.raw('investigator.load', {campaign: 'c1', library_id: saved.library_id});
	await k.raw('setup.complete', {campaign: 'c1'});
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('table.open');
	assert.equal(JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).handles, 'name-free');
	return seat({...k, module: mid, call}, unworded, Object.entries(TOMS).map(([id, word]) => ({id: interim(id), word})));
}

/** The people's handles from the roster, their words given (but `unworded`'s, and with `more`), and a turn opened. */
async function seat(game, unworded = [], more = []) {
	const roster = (await game.call('table.untold')).people, idOf = name => roster.find(row => row.name === name)?.id;
	const ids = Object.fromEntries([MATHER, ROSS, CLARK, STONE].map(name => [name, idOf(name)]).filter(([, id]) => id));
	const answer = await game.call('epithets.submit', {entries: [...Object.entries(ids).filter(([name]) => !unworded.includes(name)).map(([name, id]) => ({id, word: WORDS[name]})), ...more]});
	assert.deepEqual(answer.refused, [], JSON.stringify(answer.refused));
	await game.call('table.narrate', {call_id: 't0-c1', text: '风从海上吹来。'});
	// The words are folded into the world at the turn's start (§176.1).
	const input = await game.call('table.player_input', {text: '我走进杂货店。'});
	return {...game, input, ids};
}

/**
 * A starter (legacy): the rulebook Haunting with the same people and clues at its opening, and a letter whose handle begins
 * with Mather's (`daniel-mather-letter`), so the request renames it as `<his word>-letter`. No cast: a starter's people are
 * its graph's (§177.1), so no unread man shares 「丹尼尔」 here.
 */
async function legacy(t) {
	const content = join(temporary, `content-${Math.random().toString(16).slice(2)}`), module = 'rename-undo-legacy';
	await mkdir(join(content, 'starters'), {recursive: true});
	for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
	for (const name of await readdir(join(root, 'content/starters'))) await symlink(join(root, 'content/starters', name), join(content, 'starters', name));
	await cp(join(root, 'content/starters/the-haunting-rulebook'), join(content, 'starters', module), {recursive: true});
	await cp(join(root, 'content/starters/the-haunting/pregens'), join(content, 'starters', module, 'pregens'), {recursive: true});
	const path = join(content, 'starters', module, 'module-graph.json'), graph = JSON.parse(await readFile(path, 'utf8'));
	graph.module_id = module;
	const knott = graph.nodes.find(node => node.node_id === 'npc-steven-knott'), clue = graph.nodes.find(node => node.node_kind === 'clue');
	const person = (id, name, aliases = []) => ({...structuredClone(knott), node_id: id, name, aliases, summary: `${name}.`});
	graph.nodes.push(person('npc-daniel-mather', MATHER, ['丹']), person('npc-amy-clark', CLARK), person('npc-amy-stone', STONE),
		{...structuredClone(clue), node_id: 'clue-daniel-mather-ledger', name: LEDGER, aliases: [], summary: 'The store\'s accounts.'},
		{...structuredClone(clue), node_id: 'clue-dan-key', name: KEY, aliases: [], summary: 'A key on a nail.'},
		{...structuredClone(clue), node_id: 'clue-daniel-mather-letter', name: '一封没寄出的信', aliases: [], summary: 'A letter never sent.'});
	const relation = (from, kind, to) => ({relation_id: `rel-${from}-${kind}`, relation_kind: kind, from_node_id: from, to_node_id: to, claim_id: null, properties: {}});
	graph.relations.push(...['npc-daniel-mather', 'npc-amy-clark', 'npc-amy-stone'].map(id => relation(id, 'present-in', 'scene-introduction')),
		...['clue-daniel-mather-ledger', 'clue-dan-key', 'clue-daniel-mather-letter'].map(id => relation(id, 'discoverable-at', 'scene-introduction')));
	await writeFile(path, JSON.stringify(graph));
	const k = await kernel(t, 'rename-undo-names-legacy', content);
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module, pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	await call('table.open');
	assert.equal(JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).handles, 'legacy');
	return seat({...k, module, call});
}

const receipts = async game => (await game.call('table.status')).receipts;
/** One effect in a fresh call of the open turn; its receipt. */
async function apply(game, effect) {
	const {turn} = await game.call('table.status');
	game.calls = (game.calls ?? 0) + 1;
	const landed = await game.call('table.apply', {call_id: `t${turn}-c${game.calls}`, effects: [effect]});
	return (await receipts(game)).find(row => row.id === landed.receipts[0]);
}
/** The copied string, refused as the ambiguity §188.3 names: each candidate by their word, no book name anywhere. */
async function refusedAmbiguous(game, effect, words) {
	const people = async () => JSON.parse(await readFile(join(game.home, '.coc', 'campaigns', 'c1', 'world.json'), 'utf8')).table_people ?? [];
	const before = await people();
	let refusal;
	await assert.rejects(apply(game, effect), error => (refusal = error, true));
	assert.equal(refusal.code, 'unknown_entity', refusal.message);
	assert.equal(refusal.details?.reason, 'ambiguous', JSON.stringify(refusal.details));
	assert.deepEqual(refusal.details.candidates.map(row => row.shown).sort(), [...words].sort(), JSON.stringify(refusal.details.candidates));
	const text = JSON.stringify({message: refusal.message, fix: refusal.fix, details: refusal.details});
	for (const name of BOOK_NAMES) assert.ok(!text.includes(name), `the refusal carries no book name: ${name} in ${text}`);
	assert.deepEqual(await people(), before, 'nobody is minted under an ambiguous word');
	return refusal;
}

test('§188.3 (name-free): every rename row kind copied from the request resolves to its original, or is refused ambiguous', async t => {
	const game = await nameFree(t);
	const {text: sent} = await keeperSees(game, game.input, PAGE);
	const whole = copied(sent, 'whole'), piece = copied(sent, 'piece'), single = copied(sent, 'single'), shared = copied(sent, 'shared'), both = copied(sent, 'both');
	const alike = copied(sent, 'alike');
	// The request holds the renamed strings, and no book name of these people.
	assert.deepEqual([whole, piece, single, shared, both, alike], [WORDS[MATHER], `${WORDS[MATHER]}的账本`, `${WORDS[MATHER]}的钥匙`,
		`${WORDS[MATHER]} / ${WORDS[ROSS]}`, `${WORDS[CLARK]} / ${WORDS[STONE]}`, Object.values(TOMS).join(' / ')], sent);

	await t.test('the whole name, as the person an npc effect is about', async () => {
		assert.equal((await apply(game, {kind: 'npc', name: whole, intends: 'Keep the ledger out of sight.', outcome: 'attempted'})).npc, 'npc-daniel-mather');
	});
	// A name-free clue's handle is the one its book name looks up to (an input key, §185.4).
	const handleOf = async name => (await game.call('table.lookup', {kind: 'module', query: name})).entities[0].name;
	await t.test('a piece inside a clue\'s name, as the clue', async () => {
		assert.equal((await apply(game, {kind: 'clue', clue: piece, how: '在柜台下翻到的'})).clue, await handleOf(LEDGER));
	});
	await t.test('a one-character alias inside a clue\'s name, as the clue', async () => {
		assert.equal((await apply(game, {kind: 'clue', clue: single, how: '从钉子上取下的'})).clue, await handleOf(KEY));
	});
	await t.test('a joined word whose names reach one node is that node: the other owner is a man the reader has not reached', async () => {
		assert.equal((await apply(game, {kind: 'npc', name: shared, intends: 'Count the till before closing.', outcome: 'attempted'})).npc, 'npc-daniel-mather');
	});
	await t.test('a joined word whose names reach two nodes is refused ambiguous, each candidate by their own word', async () => {
		const refusal = await refusedAmbiguous(game, {kind: 'npc', name: both, intends: 'Sell the last of the bait.', outcome: 'attempted'}, [WORDS[CLARK], WORDS[STONE]]);
		// A name-free handle names each candidate in a call, and carries no name (§185.7).
		assert.deepEqual(refusal.details.candidates.map(row => row.name).sort(), [game.ids[CLARK], game.ids[STONE]].sort());
		const picked = refusal.details.candidates.find(row => row.shown === WORDS[STONE]).name;
		assert.equal((await apply(game, {kind: 'npc', name: picked, intends: 'Sell the last of the bait.', outcome: 'attempted'})).npc, 'npc-amy-stone');
	});
	await t.test('a joined word for a name two people carry and nothing else names either is refused ambiguous: no spelling names one', async () => {
		const refusal = await refusedAmbiguous(game, {kind: 'npc', name: alike, intends: 'Mend the nets.', outcome: 'attempted'}, Object.values(TOMS));
		assert.deepEqual(refusal.details.candidates.map(row => row.name).sort(), Object.keys(TOMS).map(interim).sort());
	});
});

test('§188.3 (legacy): the same row kinds, and a handle the rename rewrote, copied from the request', async t => {
	const game = await legacy(t);
	const {text: sent, capsule} = await keeperSees(game, game.input, PAGE);
	const whole = copied(sent, 'whole'), piece = copied(sent, 'piece'), single = copied(sent, 'single'), both = copied(sent, 'both');
	assert.deepEqual([whole, piece, single, both], [WORDS[MATHER], `${WORDS[MATHER]}的账本`, `${WORDS[MATHER]}的钥匙`, `${WORDS[CLARK]} / ${WORDS[STONE]}`], sent);
	// §176.5: the letter's handle begins with Mather's, and the capsule shows it with his word there.
	const [handle] = strings(capsule, value => value === `${WORDS[MATHER]}-letter`);
	assert.ok(handle && !JSON.stringify(capsule).includes('daniel-mather'), JSON.stringify(capsule));

	await t.test('the whole name', async () => {
		assert.equal((await apply(game, {kind: 'npc', name: whole, intends: 'Keep the ledger out of sight.', outcome: 'attempted'})).npc, 'npc-daniel-mather');
	});
	await t.test('a piece inside a clue\'s name', async () => {
		assert.equal((await apply(game, {kind: 'clue', clue: piece, how: '在柜台下翻到的'})).clue, 'daniel-mather-ledger');
	});
	await t.test('a one-character alias inside a clue\'s name', async () => {
		assert.equal((await apply(game, {kind: 'clue', clue: single, how: '从钉子上取下的'})).clue, 'dan-key');
	});
	await t.test('a handle that began with a person\'s handle', async () => {
		assert.equal((await apply(game, {kind: 'clue', clue: handle, how: '夹在账本里的'})).clue, 'daniel-mather-letter');
	});
	await t.test('a joined word two people of the graph share is refused ambiguous, by their words and no slug', async () => {
		const refusal = await refusedAmbiguous(game, {kind: 'npc', name: both, intends: 'Sell the last of the bait.', outcome: 'attempted'}, [WORDS[CLARK], WORDS[STONE]]);
		// A legacy handle is the book's name as a slug: the word names each candidate instead.
		assert.ok(!JSON.stringify(refusal.details).includes('amy-'), JSON.stringify(refusal.details));
		assert.deepEqual(refusal.details.candidates.map(row => row.name).sort(), [WORDS[CLARK], WORDS[STONE]].sort());
		const picked = refusal.details.candidates.find(row => row.shown === WORDS[CLARK]).name;
		assert.equal((await apply(game, {kind: 'npc', name: picked, intends: 'Sell the last of the bait.', outcome: 'attempted'})).npc, 'npc-amy-clark');
	});
});

test('§188.3: the rows are installed in both schemes; handle rows only where the rename makes them, a legacy campaign', async t => {
	const rows = async game => {
		const world = JSON.parse(await readFile(join(game.home, '.coc', 'campaigns', 'c1', 'world.json'), 'utf8'));
		return (await api.loadCampaignModule(game.context, game.module, world, 'c1')).graph.renameUndo;
	};
	const free = await rows(await nameFree(t)), old = await rows(await legacy(t));
	const mather = list => list.find(row => row.shown === WORDS[MATHER])?.names ?? [];
	for (const list of [free, old]) assert.ok([MATHER, '丹', '马瑟'].every(name => mather(list).includes(name)), JSON.stringify(list));
	assert.ok(!free.some(row => row.names.some(name => /^(npc-)?(daniel-mather|amy-clark|amy-stone)$/.test(name))), 'no handle or node id in a name-free campaign');
	assert.ok(['daniel-mather', 'npc-daniel-mather'].every(name => mather(old).includes(name)), 'a legacy campaign undoes the handle and the node id');
});

test('§188.3: a person\'s word read whole stays the junction\'s: one word two people answer to is refused naming both, never picked', async t => {
	const game = await nameFree(t);
	// Stored state the junction must refuse (§87.8): Clark has since been named anew and Stone was given the word Clark was
	// shown by, which Clark still answers to as her epithet (§176.2). Written to the world between turns, as an older campaign
	// can hold it: today's `apply person` refuses a word in use.
	const {turn} = await game.call('table.status');
	await game.call('table.narrate', {call_id: `t${turn}-c9`, text: '两个女人在码头上收摊。'});
	const path = join(game.home, '.coc', 'campaigns', 'c1', 'world.json'), world = JSON.parse(await readFile(path, 'utf8'));
	world.person_labels = {...world.person_labels, [game.ids[CLARK]]: {name: '卖鱼饵的女人'}, [game.ids[STONE]]: {name: WORDS[CLARK]}};
	await writeFile(path, JSON.stringify(world));
	await game.call('table.player_input', {text: '我叫住那个戴红围巾的女人。'});
	let refusal;
	await assert.rejects(apply(game, {kind: 'npc', name: WORDS[CLARK], intends: 'Sell the last of the bait.', outcome: 'attempted'}), error => (refusal = error, true));
	assert.equal(refusal.code, 'unknown_entity', refusal.message);
	assert.deepEqual(refusal.details?.candidates?.map(row => row.name).sort(), [game.ids[CLARK], game.ids[STONE]].sort(), JSON.stringify(refusal.details));
});

test('§188.3: a journal label the request shows before the fold (§176.4) is undone too; the junction does not read it', async t => {
	const game = await nameFree(t, [STONE]);
	// The journal lane labelled Stone after this turn's fold: the roster shows her by the label until the next one.
	const LABEL = '提着马灯的女人';
	await writeFile(join(game.home, '.coc', 'campaigns', 'c1', 'npc-journal.json'), JSON.stringify({entries: {'npc-amy-stone': {label: LABEL}}}));
	const {text: sent} = await keeperSees(game, game.input, `${PAGE}\nstone: ${STONE}.`);
	assert.deepEqual([copied(sent, 'stone'), copied(sent, 'both')], [LABEL, `${WORDS[CLARK]} / ${LABEL}`], sent);
	assert.equal((await apply(game, {kind: 'npc', name: copied(sent, 'stone'), intends: 'Pack up the lamp.', outcome: 'attempted'})).npc, 'npc-amy-stone');
	await refusedAmbiguous(game, {kind: 'npc', name: copied(sent, 'both'), intends: 'Pack up the lamp.', outcome: 'attempted'}, [WORDS[CLARK], LABEL]);
});
