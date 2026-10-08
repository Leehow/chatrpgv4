/**
 * Contract §198 over the kernel, in process: a person the book places here is here.
 *
 * Real table TR-F2 run 2 (Cold Harvest, App 4ce2e4cab): the opening `look` answered `present: []` although the scene's own
 * text put Captain Aganin behind the desk, and the Keeper narrated an empty room; `walk_on` on Aganin, Gapon and Pyotr --
 * each a person the table already had -- was refused three times, and on turn 18 the Keeper gave up at Pyotr's door; the
 * source-presence offer had nobody to offer on any of the 19 turns. `roster-book.mjs` is that book's history in three
 * pages: two read openings on page 1, then the reference bind that minted the anchor the campaign opens on, and a house
 * whose people are linked to the scene that happens there.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
import {CAMPAIGN, CAPTAIN, FARMER, HOUSE, HOUSE_SCENE, OPENING_ONE, OPENING_TWO, VISITOR, buildRosterBook} from './roster-book.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const evidence = playtestScratch('roster-presence', 'direct-');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: ROOT, sourcefile: 'roster-api.ts', loader: 'ts'},
	outfile: join(evidence, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
const SEAT_WHY = 'The book places them in the opening scene as play starts.';

/** The roster book's campaign, set up and not yet opened, on an in-process kernel. */
async function table(t, name) {
	const home = join(evidence, name);
	await mkdir(home, {recursive: true});
	const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: name, locks: api.nativeAdvisoryLocks(),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context);
	t.after(async () => { await runtime.close(); await context.git?.close?.(); });
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const call = (method, params = {}) => raw(method, {campaign: CAMPAIGN, ...params});
	const attempt = async (method, params = {}) => { try { return {ok: true, value: await call(method, params)}; } catch (error) { return {ok: false, error}; } };
	const file = async name => JSON.parse(await readFile(join(home, '.coc', 'campaigns', CAMPAIGN, name), 'utf8'));
	const receipt = async id => (await file('turn.json')).receipts.find(row => row.id === id);
	const built = await buildRosterBook(raw, home);
	return {home, raw, call, attempt, world: () => file('world.json'), receipt, ...built};
}
/** The handle `table.open` lists a person under, by the name the book gives them. */
const handleOf = (open, name) => open.opening_people.people.find(person => person.display_name === name)?.name;
const presentNames = rows => rows.map(row => row.name);

test('§198.2/§198.3: the anchor opening lists the people of the openings it displaced, and a seat puts them there before the opening', async t => {
	const g = await table(t, 'opening-seat');
	assert.deepEqual((await g.world()).npc_presence, {}, '§149.1: a reference book still seats nobody at creation');
	const open = await g.call('table.open');
	assert.equal(open.opening_needed, true);
	assert.deepEqual(open.opening_people.people.map(person => [person.display_name, person.placed_by?.name]), [[CAPTAIN, OPENING_ONE], [VISITOR, OPENING_TWO]],
		'the anchor stands for both openings the bind displaced, each person with the opening that places them');
	assert.match(open.opening_people.scene.text, /stands behind a small desk/, 'the book\'s own text for the opening travels to the judge');
	assert.deepEqual(presentNames((await g.call('table.look')).present), [], 'nobody is seated by being listed');
	const seated = await g.call('table.apply', {call_id: 't0-c1', effects: [{kind: 'npc', name: handleOf(open, CAPTAIN), to: 'here', why: SEAT_WHY}]});
	assert.ok(seated.receipts.some(id => id.startsWith('npc:')), JSON.stringify(seated));
	assert.deepEqual(presentNames((await g.call('table.look')).present), [CAPTAIN], 'look: the captain is behind the desk at the opening');
	const again = await g.call('table.open');
	assert.equal(again.opening_needed, true, 'a seat leaves the opening owed');
	assert.equal(again.opening_call_ordinal, 1, 'a reopened opening mints after the seat');
	assert.deepEqual(again.opening_people.people.map(person => person.display_name), [VISITOR], 'the seated captain is asked about no more');
	await g.call('table.narrate', {call_id: 't0-c2', text: 'The captain looks up from his desk.'});
	await g.call('table.player_input', {text: 'I salute.'});
	const capsule = await g.call('table.capsule');
	assert.deepEqual(presentNames(capsule.present ?? capsule.capsule?.present ?? []), [CAPTAIN], 'the capsule: the captain, and not the visitor nobody seated');
});

test('§198.3: the opening admits a seat and nothing else, and a seat only of someone the book places there whom nobody has placed', async t => {
	const g = await table(t, 'opening-gate');
	const open = await g.call('table.open'), captain = handleOf(open, CAPTAIN);
	const stance = await g.attempt('table.apply', {call_id: 't0-c1', effects: [{kind: 'npc', name: captain, stance: 'wary', why: 'x'}]});
	assert.equal(stance.error?.code, 'turn_state', 'an npc change that is no seat keeps the opening\'s refusal');
	const mixed = await g.attempt('table.apply', {call_id: 't0-c1', effects: [{kind: 'npc', name: captain, to: 'here', why: SEAT_WHY}, {kind: 'npc', name: captain, stance: 'wary', why: 'x'}]});
	assert.equal(mixed.error?.code, 'turn_state', 'a seat does not carry a change beside it');
	for (const [effect, why] of [
		[{kind: 'npc', name: FARMER, to: 'here', why: 'x'}, 'the book places the farmer at the house, not in the opening'],
		[{kind: 'npc', name: captain, to: HOUSE, why: 'x'}, 'a seat is in the opening scene'],
		[{kind: 'npc', name: 'the porter', to: 'here', walk_on: true, why: 'x'}, 'nobody is established at the opening'],
	]) {
		const refused = await g.attempt('table.apply', {call_id: 't0-c1', effects: [effect]});
		assert.equal(refused.error?.details?.reason, 'opening_seat', `${why}: ${refused.error?.message}`);
	}
	assert.deepEqual((await g.world()).npc_presence, {}, 'nothing landed');
	assert.equal((await g.world()).table_people, undefined, 'and nobody was established');
	await g.call('table.apply', {call_id: 't0-c1', effects: [{kind: 'npc', name: captain, to: 'here', walk_on: true, why: SEAT_WHY}]});
	const twice = await g.attempt('table.apply', {call_id: 't0-c2', effects: [{kind: 'npc', name: captain, to: 'here', why: SEAT_WHY}]});
	assert.equal(twice.error?.details?.reason, 'opening_seat', 'someone placed is not seated again');
	const state = await g.call('table.open');
	assert.equal(state.turn.state, 'awaiting_player', 'the opening is still owed after a seat');
});

test('§198.2: a place holds the people of the scenes that happen there, and the anchor offers the people of the openings it stands for', async t => {
	const g = await table(t, 'place-chain');
	await g.call('table.open');
	await g.call('table.narrate', {call_id: 't0-c1', text: 'The office is cold.'});
	await g.call('table.player_input', {text: 'I look around.'});
	const offers = async () => (await g.call('table.apply.options')).candidates.filter(row => row.description?.kind === 'source_presence')
		.map(row => [row.description.name, row.description.placed_by?.display_name]);
	assert.deepEqual(await offers(), [[CAPTAIN, OPENING_ONE], [VISITOR, OPENING_TWO]], 'the opening\'s offer, through the openings the anchor displaced');
	await g.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: HOUSE, via: 'the farm road'}]});
	await g.call('table.narrate', {call_id: 't1-c2', text: 'You reach the north end.'});
	await g.call('table.player_input', {text: 'I knock on the door.'});
	assert.deepEqual(await offers(), [[FARMER, HOUSE_SCENE]], 'the house offers the farmer, whom the book places in the scene that happens there');
	const offered = (await g.call('table.apply.options')).candidates.find(row => row.description?.kind === 'source_presence');
	await g.call('table.apply', {call_id: 't2-c1', effects: [{...offered.effect, why: 'the source places them here'}]});
	assert.deepEqual(presentNames((await g.call('table.look')).present), [FARMER]);
});

test('§198.1: walk_on on someone this table already has is their arrival; a newcomer is still declared, and untold people are named by the table\'s word', async t => {
	const g = await table(t, 'walk-on');
	const open = await g.call('table.open'), captain = handleOf(open, CAPTAIN);
	await g.call('table.apply', {call_id: 't0-c1', effects: [{kind: 'npc', name: captain, to: 'here', why: SEAT_WHY}]});
	await g.call('table.narrate', {call_id: 't0-c2', text: 'The captain looks up.'});
	await g.call('table.player_input', {text: 'I wait.'});
	const active = (await g.world()).active_scene;
	await g.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: CAPTAIN, to: 'away', why: 'he steps out'}]});
	assert.equal((await g.world()).npc_presence[captain], undefined);
	// TR-F2 turn 1: walk_on on the book's own person, by the book's name, with no `to`.
	const back = await g.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'npc', name: CAPTAIN, walk_on: true, why: 'he comes back in'}]});
	assert.equal((await g.world()).npc_presence[captain], active, 'read as to: here');
	assert.deepEqual(back.walk_on_read, [{index: 0, name: CAPTAIN, person: CAPTAIN, read_as: 'arrival'}]);
	assert.match(back.walk_on_note, /someone this table already has, so walk_on was read as their arrival/);
	const staged = await g.receipt(back.receipts.find(id => id.startsWith('npc:')));
	assert.deepEqual([staged.to, staged.walk_on_read, staged.established], [active, {read_as: 'arrival', person: CAPTAIN}, undefined]);
	// A `to` the Keeper wrote stands as written.
	await g.call('table.apply', {call_id: 't1-c3', effects: [{kind: 'npc', name: CAPTAIN, walk_on: true, to: HOUSE, why: 'he goes to the farm'}]});
	assert.notEqual((await g.world()).npc_presence[captain], active);
	// A variant that stands alone stages as written and moves nobody.
	const where = (await g.world()).npc_presence[captain];
	const mood = await g.call('table.apply', {call_id: 't1-c4', effects: [{kind: 'npc', name: CAPTAIN, walk_on: true, mood: 'impatient'}]});
	assert.equal((await g.world()).npc_presence[captain], where);
	assert.equal(mood.walk_on_read[0].read_as, 'person');
	assert.equal((await g.world()).table_people, undefined, 'nobody was minted under the book\'s name');
	// §177.3/§194: an untold person is named by this table's word, never by the book's name in its place.
	const id = (await g.call('table.untold')).people.find(row => row.name === CAPTAIN)?.id;
	await g.call('epithets.submit', {entries: [{id, word: 'the man behind the desk'}]});
	await g.call('table.narrate', {call_id: 't1-c5', text: 'Time passes.'});
	await g.call('table.player_input', {text: 'I call for the captain.'});
	const named = await g.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'npc', name: CAPTAIN, walk_on: true, why: 'he answers the call'}]});
	assert.equal(named.walk_on_read[0].person, 'the man behind the desk');
	assert.ok(!named.walk_on_note.includes(CAPTAIN), named.walk_on_note);
	const byWord = await g.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'npc', name: 'the man behind the desk', walk_on: true, stance: 'wary', why: 'he eyes her'}]});
	assert.equal((await g.receipt(byWord.receipts.find(rid => rid.startsWith('npc:')))).npc, 'npc-captain', 'the epithet is the person\'s word in walk_on too');
	// A newcomer is unchanged: declared, established, nobody's record.
	const porter = await g.call('table.apply', {call_id: 't2-c3', effects: [{kind: 'npc', name: 'the porter', walk_on: true, to: 'here', why: 'he heard the shouting'}]});
	assert.equal((await g.receipt(porter.receipts.find(rid => rid.startsWith('npc:')))).established, 'table');
	assert.equal(porter.walk_on_read, undefined);
	assert.deepEqual((await g.world()).table_people.map(row => row.name), ['the porter']);
});
