/**
 * Contract §188.4, batch A (NR-04a): every tool entrance that names a person reads them through `ModuleGraph.resolve` plus
 * the §87.8 junction, and a stored reference is compared by the person it names, never by its spelling.
 *
 * The entrances: an owed cash row's `with` and `subject` (and an owed object row's `to`), `apply item from`, `apply object
 * to/from` and `apply ability to` (`objectOwner`), and `apply damage` `subject`. On the real kernel in process with The
 * Haunting, each is reached by this table's word (`apply person`), by the told name and by the handle, and lands on the
 * same person; another person is refused or lands on that other person; a word two people carry is refused naming both;
 * free text that names nobody keeps the behaviour it had.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {api, root, table} from './object-usages-fixture.mjs';

const KNOTT = 'steven-knott', DOOLEY = 'dooley', CORBITT = 'walter-corbitt';
const WORD = 'the letting agent', SHARED = 'the old man';

/** The receipts one call landed, read back from the open turn. */
async function landed(game, effects) {
	const call_id = game.next();
	const result = await game.call('table.apply', {call_id, effects});
	const receipts = (await game.call('table.status')).receipts;
	return result.receipts.map(id => receipts.find(receipt => receipt.id === id));
}
/**
 * Two people this table calls one word: the junction refuses it wherever it is used (§87.8). Since §103.7 `apply person`
 * refuses a word someone else carries, so the record is put in place directly, as a table written before that holds it.
 */
async function shareWord(game) {
	const path = join(game.directory, 'world.json'), world = JSON.parse(await readFile(path, 'utf8'));
	world.person_labels = {...world.person_labels, 'arty-wilmot': {name: SHARED}, 'kim-debrun': {name: SHARED}};
	await writeFile(path, JSON.stringify(world));
}
const twoOwners = error => error.code === 'unknown_entity' && error.details?.query === SHARED && error.details?.candidates?.length === 2;
/** The NPC ledger, folded when the turn commits. */
async function ledger(game) {
	await game.call('table.narrate', {call_id: game.next(), text: 'The afternoon goes on.'});
	return JSON.parse(await readFile(join(game.directory, 'npc-ledger.json'), 'utf8'));
}

test('§188.4: an owed payment lands with its counterparty and purse named as people, never by spelling', async t => {
	const game = await table(t);
	await game.apply([{kind: 'cash', delta: 5, source: 'found', why: 'A float for the errand.'}]);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: WORD}]);
	await shareWord(game);
	const effect = {kind: 'cash', subject: game.sheet.name, delta: -0.25, currency: 'USD', settlement: 'cash', source: 'quote', with: KNOTT};
	const row = (name, change = {}) => ({name, turn: 0, kind: 'cash', effect: {...effect, ...change}, quote: 'Knott is waiting.',
		what: `${game.sheet.name}: cash -0.25 USD`, job: 'retained-review', at: '2026-10-07T00:00:00Z'});
	const rows = [row('t0-owed-1'), row('t0-owed-2'), row('t0-owed-3'), row('t0-owed-4'), row('t0-owed-5', {with: 'the front desk'})];
	await writeFile(join(game.directory, 'owed.json'), JSON.stringify({open: rows, closed: []}));
	const land = (name, change) => landed(game, [{...effect, ...change, owed: name}]);
	const mismatch = error => error.details?.reason === 'owed_mismatch';

	const [byWord] = await land('t0-owed-1', {with: WORD});
	assert.equal(byWord.with, KNOTT, 'the table\'s word lands the row the handle was stored in');
	await land('t0-owed-2', {with: 'Steven Knott'});
	await land('t0-owed-3', {subject: game.sheet.id});
	await assert.rejects(land('t0-owed-4', {with: 'Mr. Dooley'}), mismatch, 'another person does not land it');
	await assert.rejects(land('t0-owed-4', {subject: 'Mr. Dooley'}), mismatch, 'nor does a purse that is no investigator');
	await assert.rejects(land('t0-owed-4', {with: SHARED}), twoOwners, 'a word two people carry is refused naming both');
	await assert.rejects(land('t0-owed-5', {with: 'The Front Desk'}), mismatch, 'free text compares its spelling exactly, as before');
	await land('t0-owed-5', {with: 'the front desk'});
	const owed = JSON.parse(await readFile(join(game.directory, 'owed.json'), 'utf8'));
	assert.deepEqual(owed.open.map(entry => entry.name), ['t0-owed-4']);
	assert.deepEqual(owed.closed.map(entry => [entry.name, entry.how]).sort(), [['t0-owed-1', 'landed'], ['t0-owed-2', 'landed'], ['t0-owed-3', 'landed'], ['t0-owed-5', 'landed']]);
});

test('§188.4: an owed object row lands with its receiver named by sheet id or registered name', async t => {
	const game = await table(t);
	const effect = {kind: 'object', name: 'Brass key', definition: 'Chair frame', to: game.sheet.name, quantity: 1};
	const row = name => ({name, turn: 0, kind: 'object', effect, quote: 'Knott is waiting.', what: 'Brass key',
		object: {name: 'Brass key', category: 'item', owner: game.sheet.name}, owner_id: game.sheet.id, job: 'retained-review', at: '2026-10-07T00:00:00Z'});
	await writeFile(join(game.directory, 'owed.json'), JSON.stringify({open: [row('t0-owed-1')], closed: []}));
	await assert.rejects(landed(game, [{...effect, to: 'Steven Knott', owed: 't0-owed-1'}]), error => error.details?.reason === 'owed_mismatch');
	await landed(game, [{...effect, to: game.sheet.id, owed: 't0-owed-1'}]);
	const owed = JSON.parse(await readFile(join(game.directory, 'owed.json'), 'utf8'));
	assert.deepEqual(owed.closed.map(entry => [entry.name, entry.how]), [['t0-owed-1', 'landed']]);
});

test('§188.4: an item\'s giver named by the table\'s word, the told name or the handle is one person, stored by identity', async t => {
	const game = await table(t);
	await game.apply([{kind: 'person', who: 'Mr. Dooley', name: 'the paper seller'}]);
	await shareWord(game);
	const give = async (name, from) => (await landed(game, [{kind: 'item', name, from, to: game.sheet.name}])).find(receipt => receipt.kind === 'item');
	for (const [name, from] of [['Morning paper', 'the paper seller'], ['Evening paper', 'Mr. Dooley'], ['Late paper', DOOLEY]]) {
		const receipt = await give(name, from);
		assert.equal(receipt.from_id, DOOLEY, `${from} is that person`);
		assert.equal(receipt.from, 'the paper seller', 'the card names them by what this table calls them');
	}
	assert.equal((await give('Rent book', 'Steven Knott')).from_id, KNOTT, 'another person is that other person');
	const stranger = await give('Handbill', 'a street vendor');
	assert.equal(stranger.from, 'a street vendor', 'free text stays as written');
	assert.equal(stranger.from_id, undefined);
	await assert.rejects(give('Pamphlet', SHARED), twoOwners);
	const npcs = await ledger(game);
	assert.equal(npcs[`npc-${DOOLEY}`].exchanged.length, 3, 'all three reached the giver\'s ledger');
	assert.equal(npcs[`npc-${KNOTT}`].exchanged.length, 1);
});

test('§188.4: an object\'s holder named by the table\'s word, the told name or the handle is one person', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'he is waiting'}]);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: WORD}]);
	await shareWord(game);
	const hand = (from, to) => landed(game, [{kind: 'object', name: 'Study chair', from, to, handover: 'given'}]);
	const holder = async () => Object.values((await game.world()).objects.instances).find(row => row.name === 'Study chair').owner;
	for (const [to, back] of [[WORD, 'Steven Knott'], ['Steven Knott', KNOTT], [KNOTT, WORD]]) {
		await hand(game.sheet.name, to);
		assert.deepEqual([(await holder()).kind, (await holder()).id], ['npc', KNOTT], `${to} is that person`);
		await assert.rejects(hand('Mr. Dooley', game.sheet.name), error => error.code === 'invalid_params', 'another person does not hold it');
		assert.equal((await holder()).id, KNOTT, 'and the refused hand-over moved nothing');
		await hand(back, game.sheet.name);
		assert.equal((await holder()).id, game.sheet.id, `${back} names the person who holds it`);
	}
	await assert.rejects(hand(game.sheet.name, SHARED), twoOwners);
	await assert.rejects(hand(game.sheet.name, 'a passing stranger'), error => error.code === 'unknown_entity' && error.details?.field === 'object.owner',
		'free text that names nobody is refused as before');
	assert.equal((await ledger(game))[`npc-${KNOTT}`].exchanged.length, 3, 'each hand-back reached his ledger under his identity');
});

test('§188.4: an ability is learnt by the person the table\'s word, the told name or the handle names', async t => {
	const game = await table(t);
	const spell = {name: 'Whisper at the Lintel', category: 'spell', description: 'A murmured warding.', basis: 'Present in this contract fixture.',
		parameters: {cost_mp: '1', cost_sanity: '0', casting_time: '1 round', effects: []}, player_view: {description: 'A murmured warding.', fields: []}};
	const job = await game.call('mods.job', {role: 'create', input: {name: spell.name, category: 'spell', description: spell.description}});
	await writeFile(join(job.cwd, 'result.json'), JSON.stringify(spell));
	const accepted = await game.call('mods.accept', {job: job.job});
	await game.apply([{kind: 'define', name: spell.name, category: 'spell', _definition: accepted.definition, _provenance: accepted.provenance}]);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: WORD}]);
	await shareWord(game);
	const learn = async to => (await landed(game, [{kind: 'ability', name: spell.name, to, source: 'the grimoire'}]))[0].subject;
	for (const to of [WORD, 'Steven Knott', KNOTT]) assert.equal(await learn(to), KNOTT, `${to} is that person`);
	assert.equal(await learn('Mr. Dooley'), DOOLEY, 'another person learns it themselves');
	await assert.rejects(learn(SHARED), twoOwners);
	assert.deepEqual(Object.keys((await game.world()).objects.abilities).sort(), [DOOLEY, KNOTT]);
});

test('§188.4: damage lands on the body the table\'s word, the told name or the handle names', async t => {
	const game = await table(t);
	await game.apply([{kind: 'person', who: 'Walter Corbitt', name: 'the pale sleeper'}]);
	await shareWord(game);
	const hurt = async subject => (await landed(game, [{kind: 'damage', subject, dice: '1D1', why: 'A blow.'}])).find(receipt => receipt.resource === 'hp');
	for (const subject of ['the pale sleeper', 'Walter Corbitt', CORBITT]) {
		const receipt = await hurt(subject);
		assert.equal(receipt.subject, CORBITT, `${subject} is that body`);
		assert.equal(receipt.before - receipt.after, 1);
	}
	assert.equal((await hurt(game.sheet.name)).subject, game.sheet.id, 'an investigator is read by registered name as before');
	const before = (await hurt(CORBITT)).after;
	await assert.rejects(hurt(SHARED), twoOwners, 'a word two people carry is refused before anything is rolled');
	assert.equal((await hurt(CORBITT)).before, before);
});

test('§188.4: an item given under the table\'s word is a meeting with that person when they are met again', async t => {
	// Without first impressions (§178), whose presence roll would itself be a meeting: the gift is the only one.
	const home = await mkdtemp(join(tmpdir(), 'junction-a-reunion-'));
	t.after(() => rm(home, {recursive: true, force: true}));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'junction-a', locks: api.createAdvisoryLocks(async () => {}),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('mods.configure', {id: 'natural-npc', enabled: false});
	await call('table.open');
	await call('table.narrate', {call_id: 't0-c1', text: 'Knott is waiting.'});
	const world = join(home, '.coc/campaigns/c1/world.json'), saved = JSON.parse(await readFile(world, 'utf8'));
	await writeFile(world, JSON.stringify({...saved, person_labels: {...saved.person_labels, [KNOTT]: {name: WORD}}}));
	const start = saved.active_scene, sheet = (await call('table.look', {focus: 'investigator'})).name;
	const turn = async (said, effects, text) => {
		const {turn: open} = await call('table.player_input', {text: said});
		await call('table.apply', {call_id: `t${open}-c1`, effects});
		if (text) await call('table.narrate', {call_id: `t${open}-c2`, text});
	};
	await turn('He has something for me.', [{kind: 'item', name: 'Rent book', from: WORD, to: sheet}], 'He hands you the rent book without a word.');
	await turn('I spend an hour at the library.', [{kind: 'move', to: 'central-library', travel_minutes: 60}], 'You are at the library.');
	await turn('I go back to Knott.', [{kind: 'move', to: start, travel_minutes: 60}]);
	const reunion = (await call('table.look', {focus: 'npc', name: 'Steven Knott'})).reunion;
	assert.equal(reunion?.status, 'needed', 'the gift was a meeting with him, read by his identity');
	assert.equal(reunion.elapsed_minutes, 120);
});
