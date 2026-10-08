/**
 * Contract §185.13 (lead ruling 2026-10-06, NFH-07): an investigator's own name is never an untold name.
 *
 * The real acceptance table (campaign nfh-accept-blood-road-1, Blood Road, name-free): the investigator is 「丹尼尔·怀特」 and
 * the book's untold store owner is 「丹尼尔·马瑟」. The roster made a row for the piece 「丹尼尔」, and the request's rename
 * rewrote the investigator's own name in the Keeper's request; the Keeper copied the result into `cash.subject`,
 * `object.to` and `item.to`, and 9 of 11 refusals at the table were `unknown_entity: no investigator '…·怀特'`.
 *
 * Here, on the kernel in process and the context hooks as installed: a reader-built book (name-free) and a starter (legacy),
 * each with an investigator who shares a name piece with an untold book person. The Keeper's assembled request keeps the
 * investigator's full name and still renames the untold person's own full name; a delivery naming the investigator is not
 * held by the gate, while one naming the untold person is.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'investigator-name-known-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
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

/** The investigator is registered under `name`, as table 30's was: the kernel reads the party sheet from the campaign. */
async function rename(home, campaign, name) {
	const folder = join(home, '.coc', 'campaigns', campaign, 'party');
	for (const file of (await readdir(folder)).filter(file => file.endsWith('.json'))) {
		const sheet = JSON.parse(await readFile(join(folder, file), 'utf8'));
		await writeFile(join(folder, file), JSON.stringify({...sheet, name}));
	}
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

const PAGES = ['The harbor dock smells of tar. 丹尼尔·马瑟 keeps the store; 丹尼尔 smokes at the door.',
	'The old tower stands beyond the harbor.', 'A cellar floods at high tide.'];
const REFS = [{page: 1}];

/** A reader-built book (name-free): the Dock with the store owner 丹尼尔·马瑟 in it, and its cast read, printing 丹尼尔 alone. */
async function readerBuilt(t) {
	const k = await kernel(t, 'investigator-name-known');
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
		{node_id: 'npc-daniel-mather', node_kind: 'npc', name: '丹尼尔·马瑟', source_refs: REFS, summary: 'The store owner.'}],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS},
			{subject_id: 'npc-daniel-mather', predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-daniel-mather']},
		['/nodes/0', '/nodes/2', '/claims/0', '/claims/1', '/coverage']);
	const cast = await k.raw('cast.job', {module_id: mid, claim: true});
	await k.raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const range = await k.raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [{book: ['丹尼尔·马瑟', '丹尼尔'], play: ['丹尼尔·马瑟', '丹尼尔'], notes: ['Daniel Mather', 'Daniel'], pages: [1]}]}));
	assert.equal((await k.raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	await k.raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
	const saved = await k.raw('investigator.save', {campaign: 'card-source'});
	await k.raw('campaign.create', {id: 'c1', module: mid, play_language: 'zh-Hans'});
	await k.raw('investigator.load', {campaign: 'c1', library_id: saved.library_id});
	await rename(k.home, 'c1', '丹尼尔·怀特');
	await k.raw('setup.complete', {campaign: 'c1'});
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('table.open');
	assert.equal((await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).includes('"name-free"'), true);
	return {...k, call};
}

test('§185.13 (name-free): the investigator\'s own name is no untold name; the untold store owner\'s still is', async t => {
	const h = await readerBuilt(t);
	const roster = (await h.call('table.untold')).people;
	assert.ok(roster.some(row => row.name === '丹尼尔·马瑟'), JSON.stringify(roster));
	assert.ok(!roster.some(row => ['丹尼尔', '怀特', '丹尼尔·怀特'].includes(row.name)), 'no row for a piece the investigator carries');
	await h.call('table.narrate', {call_id: 't0-c1', text: '港口很安静。'});
	const input = await h.call('table.player_input', {text: '我走进杂货店。'});

	// The Keeper's request (§194.1): the investigator's full name intact, and the store owner's as the book writes it.
	const sent = await keeperSees(h.home, 'c1', h.call, input, '丹尼尔·怀特 在码头遇见了 丹尼尔·马瑟。');
	assert.equal(sent, '丹尼尔·怀特 在码头遇见了 丹尼尔·马瑟。', 'the request touches neither name');

	// The gate (§177.11): a delivery naming the investigator goes out; one saying the store owner's printed name is held.
	const own = await h.call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: '丹尼尔·怀特推开杂货店的门。'});
	assert.match(own.rendered_text, /丹尼尔·怀特推开杂货店的门/);
	const next = await h.call('table.player_input', {text: '我看看店主。'});
	await assert.rejects(h.call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: '丹尼尔·马瑟抬起头。'}),
		error => error?.details?.reason === 'untold_name');
	const spans = await h.call('table.untold_spans', {text: '丹尼尔·怀特看着丹尼尔·马瑟。'});
	assert.deepEqual(spans.spans.map(span => span.name), ['丹尼尔·马瑟'], 'only the store owner\'s name has places to judge');
});

test('§185.13 (legacy): a starter\'s investigator sharing a piece with an untold person keeps their name in the request', async t => {
	const k = await kernel(t, 'investigator-name-known-legacy');
	const call = (method, params = {}) => k.raw(method, {campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'voice-bench', pregen: 'shen-zhiwei', play_language: 'zh-Hans'});
	await rename(k.home, 'c1', '玛丽·怀特');
	await call('table.open');
	assert.equal(JSON.parse(await readFile(join(k.home, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8')).handles, 'legacy');
	const roster = (await call('table.untold')).people;
	assert.ok(roster.some(row => row.name === '玛丽·斯通'), JSON.stringify(roster));
	assert.ok(roster.some(row => row.name === '斯通'), 'the untold person\'s own pieces are still renamed');
	assert.ok(!roster.some(row => row.name === '玛丽'), 'the piece the investigator carries is not');
	await call('table.narrate', {call_id: 't0-c1', text: '雨夜。'});
	const input = await call('table.player_input', {text: '我找个位子坐下。'});
	const sent = await keeperSees(k.home, 'c1', call, input, '玛丽·怀特 在窗边看见了 玛丽·斯通。');
	assert.equal(sent, '玛丽·怀特 在窗边看见了 玛丽·斯通。', '§194.1: the request touches neither name');
	const own = await call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: '玛丽·怀特把伞靠在门边。'});
	assert.match(own.rendered_text, /玛丽·怀特把伞靠在门边/);
});
