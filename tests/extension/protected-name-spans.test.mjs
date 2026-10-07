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
 * overlaps one of those occurrences. Here, on the kernel in process and the context hooks as installed: a reader-built book
 * (name-free) whose store owner is printed 「丹尼尔·马瑟」, 「丹尼尔」 and 「丹尼」 and recorded with the alias 「丹」, and a starter
 * (legacy) whose investigator 「玛丽·斯通纳」 holds the untold 「玛丽·斯通」 whole.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
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
export {createRenameJudge} from './extensions/table/untold-rename-judge.ts';
export {prosePlaces, untoldNamesSaid} from './kernel-ts/write/names.ts';
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
async function rename(home, campaign, name) {
	const folder = join(home, '.coc', 'campaigns', campaign, 'party'), ids = [];
	for (const file of (await readdir(folder)).filter(file => file.endsWith('.json'))) {
		const sheet = JSON.parse(await readFile(join(folder, file), 'utf8'));
		await writeFile(join(folder, file), JSON.stringify({...sheet, name}));
		ids.push(sheet.id);
	}
	return ids;
}

/** The Keeper's request as the installed context hook assembles it, with one tool result carrying `text`. */
async function keeperSees(home, campaign, call, input, text) {
	const hooks = new Map(), bus = new Map();
	api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
		() => {}, () => api.workpadStoreRoot(home));
	bus.get('coc:kernel-bridge')({campaign, call});
	bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
	const {messages} = await hooks.get('context')({messages: [{role: 'user', content: 'I look around.'},
		{role: 'assistant', content: [{type: 'toolCall', id: 'lookup-1', name: 'lookup', arguments: {kind: 'source', query: 'the dock'}}]},
		{role: 'toolResult', toolCallId: 'lookup-1', toolName: 'lookup', content: [{type: 'text', text}]}]}, {model: {contextWindow: 1000000}});
	return messages.find(message => message.role === 'toolResult').content[0].text;
}

/** A decision port that answers every place "the name", keeping each place it was asked about (§177.15's marked text). */
const namePort = asked => ({async decide(batch) {
	const answers = Object.fromEntries(batch.questions.map(question => {
		asked.push(batch.state.items[question.target].text);
		return [question.key, {status: 'answered', type: 'noul', noul: 0.95}];
	}));
	return {batchId: batch.id, status: 'complete', answers, coverage: {required: [], answered: [], unknown: []}, issues: []};
}});

const INVESTIGATOR = '丹尼尔·怀特', OWNER = '丹尼尔·马瑟';
const PAGES = ['The harbor dock smells of tar. 丹尼尔·马瑟 keeps the store; 丹尼尔 smokes at the door, and the regulars call him 丹尼.',
	'The old tower stands beyond the harbor.', 'A cellar floods at high tide.'];
const REFS = [{page: 1}];

/**
 * A reader-built book (name-free): the Dock with the store owner in it. His node records the one-character alias 「丹」 (the cast
 * reader's forms are two characters or more, so the alias is the graph's), and the cast prints 「丹尼尔·马瑟」, 「丹尼尔」 and the
 * nickname 「丹尼」, which, unlike 「丹尼尔」, is no piece of the investigator's name and so is still a gated name (§177.11).
 */
async function readerBuilt(t) {
	const k = await kernel(t, 'protected-name-spans');
	const pdf = join(k.home, 'harbor.pdf');
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
	await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor', pages: [[1, 3]], source_refs: REFS, entities: ['Dock', 'Tower']}]}, []);
	await read('opening', {nodes: [
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'},
		{node_id: 'npc-daniel-mather', node_kind: 'npc', name: OWNER, aliases: ['丹'], source_refs: REFS, summary: 'The store owner.'}],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS},
			{subject_id: 'npc-daniel-mather', predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-daniel-mather']},
		['/nodes/0', '/nodes/2', '/claims/0', '/claims/1', '/coverage']);
	const cast = await k.raw('cast.job', {module_id: mid, claim: true});
	await k.raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const range = await k.raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [{book: [OWNER, '丹尼尔', '丹尼'], play: [OWNER, '丹尼尔', '丹尼'],
		notes: ['Daniel Mather', 'Daniel', 'Danny'], pages: [1]}]}));
	assert.equal((await k.raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: 'c1', module: mid, play_language: 'zh-Hans'});
	await k.raw('investigator.load', {campaign: 'c1', library_id: saved.library_id});
	const ids = await rename(k.home, 'c1', INVESTIGATOR);
	await k.raw('setup.complete', {campaign: 'c1'});
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('table.open');
	assert.equal(JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).handles, 'name-free');
	return {...k, call, ids};
}

test('§188.1 (name-free): the request keeps the investigator\'s name whole and still renames the untold name, the alias and the nickname', async t => {
	const h = await readerBuilt(t);
	const answer = await h.call('table.untold');
	const names = answer.people.map(row => row.name);
	for (const name of [OWNER, '丹', '丹尼']) assert.ok(names.includes(name), `${name} is an untold row: ${JSON.stringify(names)}`);
	assert.ok(Array.isArray(answer.protected), 'table.untold carries protected beside people');
	for (const name of [INVESTIGATOR, ...h.ids]) assert.ok(answer.protected.includes(name), `${name} is protected: ${JSON.stringify(answer.protected)}`);
	assert.ok(!answer.protected.some(name => [OWNER, '丹', '丹尼', '丹尼尔'].includes(name)), 'no untold name and no piece is protected');
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const input = await h.call('table.player_input', {text: '我走进杂货店。'});

	const sent = await keeperSees(h.home, 'c1', h.call, input, `${INVESTIGATOR} 在码头遇见了 ${OWNER}。丹说今天不开张，丹尼也这么说。`);
	assert.ok(sent.startsWith(`${INVESTIGATOR} 在码头遇见了 `), `the investigator's name reaches the Keeper whole: ${sent}`);
	assert.equal(sent.split(INVESTIGATOR).length, 2, 'exactly once, as written');
	assert.ok(!sent.includes(OWNER), `the store owner's full name is renamed: ${sent}`);
	assert.ok(!sent.includes('丹说') && !sent.includes('丹尼也'), `the lone alias and the nickname are renamed elsewhere: ${sent}`);
	assert.ok(!/丹/.test(sent.slice(INVESTIGATOR.length)), `no 丹 is left outside the investigator's name: ${sent}`);
});

test('§188.1 (name-free): the rename\'s judge is never asked about a place inside a protected name', async t => {
	const h = await readerBuilt(t);
	const roster = api.untoldRoster(await h.call('table.untold')), asked = [];
	const judge = api.createRenameJudge({record: () => {}, decision: () => namePort(asked)});
	const messages = [{role: 'toolResult', toolCallId: 'a', toolName: 'lookup', content: [{type: 'text', text: `${INVESTIGATOR}在码头遇见了${OWNER}。丹说今天不开张。`}]}];
	await judge.prepare(messages, roster);
	assert.equal(asked.length, 2, `the full name and the lone alias, and nothing inside the investigator's name: ${JSON.stringify(asked)}`);
	assert.ok(asked.every(text => !text.includes('⟦丹⟧尼尔·怀特') && !text.includes('⟦丹尼⟧尔·怀特')), JSON.stringify(asked));
	const [renamed] = api.renameUntold(messages, roster, judge.keep);
	assert.ok(renamed.content[0].text.startsWith(`${INVESTIGATOR}在码头遇见了`), renamed.content[0].text);
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
	assert.ok(sent.startsWith('玛丽·斯通纳 在窗边看见了 '), `the investigator's name reaches the Keeper whole: ${sent}`);
	assert.ok(!sent.includes('玛丽·斯通。') && !sent.includes('斯通没有'), `the untold name and its piece are renamed elsewhere: ${sent}`);
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
