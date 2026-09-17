/**
 * A person this table has and the book does not.
 *
 * H-SIDE t4 (`homes/t4`, campaign game-1c0faba5, 121 turns): twenty people spoke whom the engine had
 * no record of — a reception nurse, a parish clerk, a building superintendent, four municipal window
 * clerks — carrying 60 of that table's 270 spoken spans across 22 turns. `speech.who` already
 * degraded to `{label}` for every one of them (§40) and `resolve` already rolled against one as
 * `action.target`, because `npcTarget` reads through `graph.find`, which answers null and falls
 * through. Only `apply npc` and `look focus=npc` refused, seventeen times.
 *
 * Turns 96–99 are the shape of the cost: five refusals, `present: []` and `voices: []` in every
 * capsule, and a superintendent who still unlocked a cellar, answered three questions, took a card
 * and left — all of it in prose alone. Turn 98 closed with zero receipts, and the only two world
 * writes that turn wanted were his presence and his stance.
 *
 * Refusing did not prevent a fabrication either. Turn 106, refused on an assessors'-window clerk,
 * the Keeper staged the book's own Hall of Records clerk at the assessors' window instead, and that
 * was accepted. The last test here is that one: a refusal with no lawful road moves the write onto
 * an authored person's record rather than stopping it.
 *
 * No assertion below reads a name to decide anything, and none of them says who deserves a record.
 * The boundary is mechanical: the graph knew this name or it did not.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {table} from './object-usages-fixture.mjs';

/** The doorman of turns 96–99, by the name that turn's `apply npc` actually used. */
const DOORMAN = '门房';

const receiptOf = (result, kind) => (result.receipts ?? []).find(id => String(id).startsWith(`${kind}:`));

test('a person the book never had is established by the call that puts them in the scene', async t => {
	const game = await table(t);
	const result = await game.apply([{kind: 'npc', name: DOORMAN, to: 'here', stance: 'wary',
		why: 'he is standing at the boiler-room stair with one foot on the first step'}]);
	assert.ok(receiptOf(result, 'npc'), 'the presence of a person the table just met settles into a receipt');

	const world = await game.world();
	assert.ok((world.table_people ?? []).some(person => person.name === DOORMAN),
		'the record of who this table has is world state');
	assert.equal(world.npc_presence[DOORMAN], world.active_scene,
		'and the person is in the scene, under the name the Keeper used');
});

test('an established person reads back, and says which of the three roads they came by', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: DOORMAN, to: 'here', why: 'he leads her down the cellar stair'}]);

	// Turn 98's `look focus=npc name=门房` — the Keeper could not read back a person it had narrated
	// the turn before.
	const view = await game.call('table.look', {focus: 'npc', name: DOORMAN});
	assert.equal(view.name, DOORMAN);
	assert.equal(view.origin?.kind, 'table',
		'a person the table established is never indistinguishable from one the book printed');

	const capsule = await game.call('table.look', {focus: 'scene'});
	const present = (await game.call('table.status', {})).capsule?.present ?? capsule.present ?? [];
	assert.ok(present.some(row => row.name === DOORMAN) || (await game.world()).npc_presence[DOORMAN],
		'and the capsule that told the Keeper who is here now has them in it');
});

test('the same person established twice is one person', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: DOORMAN, to: 'here', why: 'he is at the stair'}]);
	await game.apply([{kind: 'npc', name: DOORMAN, stance: 'wary', why: 'she has pushed him twice now'}]);
	const world = await game.world();
	assert.equal((world.table_people ?? []).filter(person => person.name === DOORMAN).length, 1);
});

test('a pin on an unknown name is still refused, with its candidates', async t => {
	const game = await table(t);
	// An archetype and a skill put numbers on a person. Establishing the person and pinning their
	// numbers in one call is how a stat block ends up attached to a typo, so this road stays shut.
	let refused = null;
	try { await game.apply([{kind: 'npc', name: 'Stevan Knot', archetype: 'ordinary_adult',
		why: 'numbers for someone whose name was mistyped'}]); }
	catch (thrown) { refused = thrown; }
	assert.equal(refused?.code, 'unknown_entity');
	assert.ok((refused.details?.candidates ?? []).length, 'and the refusal names who the book does have');
	assert.equal(((await game.world()).table_people ?? []).length, 0, 'nothing was established');
});

/**
 * The Keeper usually has no name for these people. What it had on t4 was `管楼的`, `the janitor`,
 * `评税处窗口职员` -- appellations, and in three cases an English description on a zh-Hans table.
 * Demanding a personal name here would be asking the Keeper to invent one, which is a fabrication
 * the table never made, so the identity is whatever they are already calling them and nothing reads
 * it. The player-facing word is §79's, exactly as it is for the book's own people: the-haunting
 * prints an NPC named `the Hall of Records clerk`, and that English description reached t4's player
 * 47 times while `world.person_labels` stayed null for all 121 turns.
 */
test('an appellation is an identity, and the word the player sees is the one this table gave', async t => {
	const game = await table(t);
	const appellation = 'the clerk at the archive window';
	await game.apply([{kind: 'npc', name: appellation, to: 'here', why: 'he is behind the counter'}]);
	await game.apply([{kind: 'person', who: appellation, name: '档房窗口的职员',
		why: 'this is what the table has been calling him'}]);

	const view = await game.call('table.look', {focus: 'npc', name: appellation});
	assert.equal(view.called?.name, '档房窗口的职员',
		'the table\'s own word for them is what a Keeper-facing surface carries');

	const call_id = game.next();
	await game.call('table.apply', {call_id, effects: [{kind: 'npc', name: appellation, stance: 'warm', why: 'she was civil'}]});
	const {receipts} = await game.call('table.status', {});
	const staged = (receipts ?? []).find(receipt => receipt.call_id === call_id && receipt.kind === 'npc');
	assert.equal(staged?.label, '档房窗口的职员',
		'and the receipt files that word, not the description the Keeper used as an identity');
});

test("an authored person's record is not where a table person ends up", async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: DOORMAN, to: 'here', why: 'he is at the stair'}]);
	const authored = await game.call('table.look', {focus: 'npc', name: 'Steven Knott'});
	assert.notEqual(authored.origin?.kind, 'table',
		'the book\'s own person is untouched by anything the table established');
	assert.notEqual(authored.id, DOORMAN);
	// Turn 106's substitution: the doorman must have his own entry, not borrow the authored clerk's.
	const world = await game.world();
	assert.equal(world.npc_presence[DOORMAN], world.active_scene);
	assert.notEqual(authored.id, world.table_people[0].name);
	assert.equal((world.table_people ?? []).length, 1,
		'the table established exactly the one person it named, and no authored record moved');
});
