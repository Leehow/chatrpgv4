/**
 * Contract §199.4–§199.5 (docs/specs/graph-grounding.md GG-03, GG-04): the epithet lane words a graph person only from what an
 * investigator meets of them, and the lane is never asked about a person the graph says nothing first-meeting of.
 *
 * Real table TR-F2 run 2 (Cold Harvest, App 4ce2e4cab): Maria Yezarova's word was 「后背藏触手的躲闪母亲」 -- her `looks` was her
 * biography, the reader's account of her infection and tentacles (p34); Sofia, with no row of her own, was given her neighbour
 * Timur's 「戴眼镜、浓密胡须的NKVD医生」. The farm (`farm-book.mjs`) carries those people here, in the book's words: Maria's p34
 * entry as her biography and her p8 "how to play" line as her first-meeting appearance, Dmitri with only his p33 biography,
 * Sofia with only the Keeper's summary, and Timur as the book's pregenerated doctor.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {CAMPAIGN, buildFarm} from './farm-book.mjs';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'graph-grounding-epithets-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {personAppearance, personDescribed} from './kernel-ts/first-sight/index.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const REFS = [{page: 1}];
/** Cold Harvest p34, Maria's entry: what the book reveals about her. */
const MARIA_REVEAL = '玛利亚和他的丈夫安德烈都受到了罗伊格尔的感染。罗伊格尔玩弄她，让她成为了村里的荡妇。她拥有背上长出触手的能力。';
/** Cold Harvest p8, "how to play Maria": what an investigator meets. */
const MARIA_MEETS = '说话时双手在双臂上部来回抚摸，对调查员抛媚眼，嘟着嘴。';
/** Cold Harvest p33, Dmitri's entry: the cause of his sixth finger is the Lloigor. */
const DMITRI_REVEAL = '通常昏沉无生气，每天踢土块或去萨马拉河玩水；与父亲一样，罗伊格尔引发的变异使右手多出一根退化的第六指。';
const TIMUR_LOOKS = '戴眼镜、浓密胡须、皮肤粗糙。', TIMUR_ROLE = '此预设角色是一名NKVD特派员/医生。';
const PEOPLE = [
	{node_id: 'npc-maria-androvna-yezarova', node_kind: 'npc', name: '玛利亚·安德罗芙娜·耶扎罗娃', source_refs: REFS,
		summary: '耶扎罗娃一家成员；多数回答含糊，不会主动谈及触手。', properties: {biography: MARIA_REVEAL, appearance: MARIA_MEETS}},
	{node_id: 'npc-dmitri-abramov', node_kind: 'npc', name: '德米特里·彼特洛维奇·阿布拉莫夫', source_refs: REFS,
		summary: '彼得的儿子。', properties: {biography: DMITRI_REVEAL}},
	{node_id: 'npc-sofia', node_kind: 'npc', name: '索菲亚', source_refs: REFS, summary: '鲍里斯的妻子，与他一同据守卧室。'},
	{node_id: 'npc-timur-alexsandrovich-yarov', node_kind: 'npc', name: '帖木儿·亚历山德洛维奇·亚洛夫', source_refs: REFS,
		summary: 'NKVD特派员兼医生，34岁；预设调查员角色。', properties: {relationship_to_investigators: TIMUR_ROLE, appearance: TIMUR_LOOKS}},
];

async function farm(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'graph-grounding-epithets',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	await buildFarm(raw, home, {people: PEOPLE});
	const call = (method, params = {}) => raw(method, {campaign: CAMPAIGN, ...params});
	// Every job of the campaign, the words written as the lane would, until the kernel has no one left to offer.
	const jobs = async () => {
		const all = [];
		for (let round = 0; round < 6; round++) {
			const job = await call('epithets.job');
			if (!job.job_id) break;
			all.push(job);
			await call('epithets.submit', {entries: job.people.map((person, index) => ({id: person.id, word: `测试词${all.length}-${index}`}))});
		}
		return all;
	};
	return {call, jobs};
}

test('§199.4: a graph person\'s looks is their first-meeting appearance; neither the biography the book reveals later nor the summary reaches the lane', async t => {
	const h = await farm(t);
	const people = (await h.jobs()).flatMap(job => job.people), text = JSON.stringify(people);
	const maria = people.find(person => person.looks === MARIA_MEETS);
	assert.ok(maria, `Maria is offered with her first-meeting appearance: ${text}`);
	assert.equal(maria.role, undefined, 'the book gives her no role towards the investigators');
	for (const hidden of ['触手', '罗伊格尔', '荡妇', '不会主动谈及'])
		assert.ok(!text.includes(hidden), `nothing the book reveals later reaches the lane: ${hidden}`);
	const timur = people.find(person => person.role === TIMUR_ROLE);
	assert.deepEqual({role: timur?.role, looks: timur?.looks}, {role: TIMUR_ROLE, looks: TIMUR_LOOKS});
	// The farm's own clerk: his appearance, never his biography or his summary.
	assert.ok(people.some(person => person.looks === 'A stooped clerk with ink-stained cuffs.'));
	assert.ok(!text.includes('Carried the informer') && !text.includes('Drowned the informer'));
});

test('§199.5: a person with neither appearance nor role is not offered: the biography alone (Dmitri) and the summary alone (Sofia) word nobody', async t => {
	const h = await farm(t);
	const people = (await h.jobs()).flatMap(job => job.people), text = JSON.stringify(people);
	assert.ok(!text.includes('第六指') && !text.includes('据守卧室'), text);
	// Four graph people are offered: Aganin by his role, the clerk, Maria and Timur by their appearance; Dmitri and Sofia are not.
	assert.equal(people.filter(person => !person.id.startsWith('cast-')).length, 4, text);
	// The lane is done once only they are left: no job offers them again.
	assert.equal((await h.call('epithets.job')).job_id, null);
});

test('§199.5: TR-F2\'s job 2 put Sofia (nothing) beside Timur (glasses, beard, doctor); now Sofia is in no job and Timur\'s row carries only his own words', async t => {
	const h = await farm(t);
	const roster = (await h.call('table.untold')).people;
	const idOf = name => roster.find(person => person.book_name === name || person.name === name)?.id;
	const sofia = idOf('索菲亚'), timur = idOf('帖木儿·亚历山德洛维奇·亚洛夫');
	assert.ok(sofia && timur, JSON.stringify(roster));
	const people = (await h.jobs()).flatMap(job => job.people);
	assert.ok(!people.some(person => person.id === sofia), 'the person the App gave Timur\'s word is never asked about');
	const row = people.find(person => person.id === timur);
	assert.deepEqual(row, {id: timur, role: TIMUR_ROLE, looks: TIMUR_LOOKS});
	// The lane asks one row per request (npc-epithets-lane.test.mjs), so Timur's word can only be written under Timur's id.
	assert.ok(!JSON.stringify(row).includes('据守卧室'));
});

test('§199.4: first sight takes the first-meeting appearance when the reader wrote one, else the biography, as before', () => {
	const graph = new api.ModuleGraph('book', {nodes: PEOPLE, claims: [], relations: []}, '', {});
	const node = id => graph.nodes.get(id);
	assert.equal(api.personDescribed(graph, node('npc-maria-androvna-yezarova')), MARIA_MEETS);
	assert.equal(api.personDescribed(graph, node('npc-dmitri-abramov')), DMITRI_REVEAL, 'a book read before §199 keeps its first sight');
	assert.equal(api.personAppearance(graph, node('npc-dmitri-abramov')), null, 'the epithet lane never reads a biography');
	assert.equal(api.personAppearance(graph, node('npc-sofia')), null, 'nor a summary');
});
