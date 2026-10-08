/**
 * Contract §194.2 (owner ruling 2026-10-08, two ledgers), on the kernel in process: the capsule's `player_knows` section.
 *
 * Real table TR-F: the player held the letter that prints its writer's name, and the Keeper said it bore none. The Keeper's
 * request now carries the book's truth (§194.1); this section is the other ledger -- whom the investigator has met or been
 * told of, by which word and whether by name, and which documents were handed to them.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'player-knows-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {playerKnowsSection, PLAYER_KNOWS_BUDGET} from './kernel-ts/read/player-knows.ts';
export {jsonSize} from './kernel-ts/read/capsule.ts';
export {stableFirst} from './extensions/table/context-policy.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const HANDOUT = "Handout 1: Mr. Knott's Commission";

async function haunting(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'player-knows',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('table.open');
	return call;
}

test('§194.2: a told person by name, a met untold one with book_name, a delivered handout; the section rides with the stable ones', async t => {
	const call = await haunting(t);
	const untold = (await call('table.untold')).people;
	const knott = untold.find(person => person.name === 'Steven Knott'), dooley = untold.find(person => person.name === 'Mr. Dooley');
	assert.ok(knott && dooley, JSON.stringify(untold));
	await call('table.narrate', {call_id: 't0-c1', text: 'Boston, 1920s. A letter asks you to call at an office downtown.'});

	const first = await call('table.player_input', {text: 'I go to the office.'});
	assert.deepEqual(first.capsule.player_knows.people, [], `nobody met or told yet: ${JSON.stringify(first.capsule.player_knows)}`);
	assert.deepEqual(first.capsule.player_knows.documents, []);
	assert.match(first.capsule.player_knows.use, /known\.discovered_clues/, 'it points at the clues, never copies them');
	const turn = first._context.turn;
	await call('table.apply', {call_id: `t${turn}-c1`, effects: [
		{kind: 'person', who: knott.id, name: 'the ink-stained clerk'},
		{kind: 'person', who: dooley.id, name: 'the newsboy'},
		{kind: 'handout', name: HANDOUT, why: 'Knott slides the commission across the desk.'}]});
	// Within the turn the handout is not yet delivered.
	await call('table.narrate', {call_id: `t${turn}-c2`,
		text: 'The man at the desk looks up. {{say:the ink-stained clerk}}"I am {{name:the ink-stained clerk}}."{{/say}} Outside, the newsboy shouts the headlines.'});

	const next = await call('table.player_input', {text: 'I read the commission.'});
	const knows = next.capsule.player_knows;
	assert.deepEqual(knows.people.find(person => person.name === 'Steven Knott'), {word: 'Steven Knott', name: 'Steven Knott'},
		`told through the token, he is known by name: ${JSON.stringify(knows.people)}`);
	assert.deepEqual(knows.people.find(person => person.book_name === 'Mr. Dooley'), {word: 'the newsboy', untold: true, book_name: 'Mr. Dooley'},
		'met under the table\'s word, his name not heard: the book\'s name rides beside for the Keeper');
	assert.equal(knows.people.length, 2, `only the people met or told: ${JSON.stringify(knows.people)}`);
	assert.deepEqual(knows.documents, [{label: HANDOUT, turn}], 'the delivered handout, with the turn it was handed over');
	assert.equal(knows.omitted, undefined);
	assert.ok(!(next.capsule.truncated ?? []).includes('player_knows'));
	// §184.2: a stable section, among the stable ones, before the ones that change every turn.
	const order = Object.keys(api.stableFirst(next.capsule));
	assert.ok(order.indexOf('player_knows') < order.indexOf('known') && order.indexOf('player_knows') > order.indexOf('warnings'), order.join(','));
});

test('§194.2: over its budget the section keeps the newest rows of each list and counts the rest', () => {
	const people = Array.from({length: 40}, (_, at) => ({node_id: `npc-p${at}`, node_kind: 'npc', name: `Person Number ${at}`, visibility: 'player-safe'}));
	const graph = new api.ModuleGraph('crowd', {nodes: people}, '', {});
	const handles = people.map(node => graph.handle(node));
	const journal = {entries: Object.fromEntries(people.map((node, at) => [node.node_id, {name: node.name, first_seen_turn: at, last_seen_turn: at, seen_count: 1, exchanges: []}]))};
	const records = Array.from({length: 30}, (_, at) => ({turn: at, closed_by: 'narrate', rendered_text: 'x',
		receipts: [{kind: 'handout', handout: `handout-${at}`, name: `Handout ${at}`, label: `Handout ${at}`}]}));
	const section = api.playerKnowsSection(graph, {}, journal, records, 40, undefined);
	assert.ok(api.jsonSize(section) <= api.PLAYER_KNOWS_BUDGET, `fits: ${api.jsonSize(section)}`);
	assert.ok(section.omitted.people > 0 && section.omitted.documents > 0, JSON.stringify(section.omitted));
	assert.equal(section.people.length + section.omitted.people, 40);
	assert.equal(section.documents.length + section.omitted.documents, 30);
	assert.equal(section.people[0].book_name, 'Person Number 39', 'newest first');
	assert.deepEqual(section.documents[0], {label: 'Handout 29', turn: 29});
	assert.ok(section.people.every(person => person.untold === true));
	// A first sight shown, or still owed, is a meeting too; a person the investigator never met nor heard of is not here.
	const seen = api.playerKnowsSection(graph, {}, {entries: {}}, [], 1, {shown: {places: [], people: [handles[3]]}, open: [{kind: 'person', id: handles[5], missing: ['scar'], turn: 0}]});
	assert.deepEqual(seen.people.map(person => person.book_name), ['Person Number 3', 'Person Number 5']);
	assert.deepEqual(api.playerKnowsSection(graph, {}, {entries: {}}, [], 1, undefined).people, []);
	// A stranded turn handed nothing to the player; a turn not closed yet has not been delivered.
	const stranded = api.playerKnowsSection(graph, {}, {entries: {}}, [{turn: 1, closed_by: 'stranded', receipts: records[1].receipts},
		{turn: 3, closed_by: 'narrate', receipts: records[3].receipts}], 3, undefined);
	assert.deepEqual(stranded.documents, []);
});
