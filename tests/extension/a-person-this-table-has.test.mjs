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
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
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

/**
 * SL-64 (2026-09-25, contract §11.5.7; amends §87.4). §87.4's roster of this table's own established
 * people is appended to `candidates()`'s ranked list last and unconditionally, once the table has
 * minted anyone at all -- a list for the Keeper (or §11.5.6/SL-62's Jev question) to resolve a name
 * *against*, never a headcount. `personOfEffect` used to read that appended list's length to decide
 * whether the graph was "silent" on a name, so once one table person existed, every later distinct
 * name found the graph not silent and refused instead of minting.
 *
 * On the 血色公路 batch-9 table (`sl29ab9-xuese-1922`, ticket 29's batch-9 entry) this reproduced five
 * times on one table: `apply npc "卡尔"` established the first table person at t11, in the same batch
 * as `apply npc "霍默"` — a second, unrelated name — which refused `unknown_entity` with
 * `details.candidates: ["卡尔"]`. The batch's `npc`/`person` writes for 霍默 both stayed unlanded
 * (SL-59's isolable refusal); the same shape recurred at t14, t15, t17 and t18 for 马瑟, 马瑟先生 and
 * 霍默 again. `npc-ledger.json` held exactly one table person.
 */
test('a batch placing two distinct people this table meets mints them both, the batch-9 shape', async t => {
	const game = await table(t);
	const FIRST = '卡尔', SECOND = '霍默';
	const result = await game.apply([
		{kind: 'npc', name: FIRST, to: 'here', why: 'the man at the pumps, talking to the investigator'},
		{kind: 'npc', name: SECOND, to: 'here', why: 'the bar owner across the street, watching from over there'},
		{kind: 'person', who: FIRST, name: FIRST},
		{kind: 'person', who: SECOND, name: SECOND}]);
	assert.equal(result.not_landed, undefined,
		`nothing in this batch should refuse, an existing table person is a candidate, never a bar: ${JSON.stringify(result.not_landed)}`);

	const world = await game.world();
	assert.deepEqual((world.table_people ?? []).map(person => person.name).sort(), [FIRST, SECOND].sort(),
		'both distinct names this table met establish their own table person; the first is not a reason the second refuses');
});

test('two people this table meets each land their own npc-ledger entry once the turn closes', async t => {
	const game = await table(t);
	const FIRST = '卡尔', SECOND = '霍默';
	await game.apply([{kind: 'npc', name: FIRST, to: 'here', why: 'the man at the pumps'},
		{kind: 'npc', name: SECOND, to: 'here', why: 'the bar owner across the street'}]);
	await game.call('table.narrate', {call_id: game.next(),
		text: `{{say:${FIRST}}}Fill her up?{{/say}} ${SECOND} watches from across the street.`});

	// The fixture's own opening scene seeds an authored NPC (Steven Knott), who already has a ledger
	// entry from the setup turn; only the table-person entries (§87's handle prefix) are this test's
	// concern, since a shared count would also pass when the second name never minted at all.
	const ledger = JSON.parse(await readFile(join(game.directory, 'npc-ledger.json'), 'utf8'));
	const tablePeople = Object.keys(ledger).filter(id => id.startsWith('npc-table-'));
	assert.equal(tablePeople.length, 2,
		`each distinct table person this table met gets their own ledger entry: ${JSON.stringify(ledger)}`);
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

/**
 * §51.4's second kind, and the condition is disagreement rather than absence. Every authored person
 * is seeded into `npc_presence` at campaign creation, so "the ledger has them nowhere" is almost
 * never true and counting `npc` receipts against spoken spans measures nothing — speaking from the
 * scene the book already put you in owes no receipt at all.
 *
 * Replaying H-SIDE t4 forward from that seed through every `npc` receipt: of 162 resolved spans by
 * the eight authored people, 113 were spoken from the right room. The gap is the other 49 — 30
 * spoken by someone the books had standing in a different scene (Steven Knott answers at the Hall of
 * Records, the Globe morgue and the Board of Health while the ledger keeps him in his office), and
 * 19 by someone a previous `to: away` had taken off the board and who was never brought back.
 *
 * Nothing here infers presence from prose: `speech.who` is the kernel's own resolution, written when
 * the turn was delivered, and the row says only that the two records disagree.
 */
test('a person the prose gave lines to here, whom the books put elsewhere, is a gap that outlives its turn', async t => {
	const game = await table(t);
	const seeded = (await game.world()).npc_presence;
	assert.ok(seeded['steven-knott'], 'the book seeds its people, which is why absence is the wrong test');

	// The larger half of the t4 gap, 30 of the 49 spans: the books have him standing somewhere else.
	// Not `away` — that is the other, smaller half, and a condition that only tested for absence
	// would pass this file while missing every Steven Knott span the real table produced.
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'newspaper-morgue', why: 'he goes across town'}]);
	const elsewhere = (await game.world()).npc_presence['steven-knott'];
	assert.ok(elsewhere && elsewhere !== (await game.world()).active_scene, 'he is on the board, in another room');

	await game.call('table.narrate', {call_id: game.next(), text: '{{say:Steven Knott}}The keys are yours.{{/say}}'});
	await game.call('table.player_input', {text: 'I take them.'});

	const capsule = await game.call('table.capsule', {});
	const row = (capsule.unrecorded ?? []).find(entry => entry.npc === 'steven-knott');
	assert.ok(row, `the books and the prose disagree, and the capsule says so: ${JSON.stringify(capsule.unrecorded)}`);
	assert.equal(row.operation, 'apply npc', 'and the row names the call that closes it');
	assert.equal(row.at, elsewhere, 'the row says where the books have him, and never which record is right');

	// Making the two agree is what retracts it; no writer has to.
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'he was here all along'}]);
	const after = await game.call('table.capsule', {});
	assert.ok(!(after.unrecorded ?? []).some(entry => entry.npc === 'steven-knott'));
});

test('a person a previous turn took off the board, speaking anyway, is the same gap', async t => {
	const game = await table(t);
	// The other 19 t4 spans. `to: away` deletes the entry rather than moving it, so the two halves
	// reach the condition by different routes and both have to be covered.
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'away', why: 'he steps out'}]);
	assert.equal((await game.world()).npc_presence['steven-knott'], undefined);
	await game.call('table.narrate', {call_id: game.next(), text: '{{say:Steven Knott}}One more thing.{{/say}}'});
	await game.call('table.player_input', {text: 'I turn around.'});
	const row = ((await game.call('table.capsule', {})).unrecorded ?? []).find(entry => entry.npc === 'steven-knott');
	assert.ok(row, 'someone taken off the board who speaks anyway is a gap');
	assert.equal(row.at, null, 'and the row says the books have them off the board rather than naming a room');
});

test('a person the books already place in this room owes nothing', async t => {
	const game = await table(t);
	// Knott is seeded into the opening scene. He speaks from it; that is not a gap, and a section
	// that reported it would be counting every ordinary line of dialogue in the campaign.
	await game.call('table.narrate', {call_id: game.next(), text: '{{say:Steven Knott}}Sit down.{{/say}}'});
	await game.call('table.player_input', {text: 'I sit.'});
	const capsule = await game.call('table.capsule', {});
	assert.deepEqual((capsule.unrecorded ?? []).filter(row => row.npc), []);
});

test('a span that stayed a label is passed over, because who counts as a person is not the kernel to decide', async t => {
	const game = await table(t);
	await game.call('table.narrate', {call_id: game.next(), text: '{{say:the voice on the line}}He is not here.{{/say}}'});
	await game.call('table.player_input', {text: 'I hang up.'});
	const capsule = await game.call('table.capsule', {});
	assert.deepEqual((capsule.unrecorded ?? []).filter(row => row.npc), [],
		'an unresolved speaker is not a person the Keeper is being told to mint');
});

test('a miss offers the people this table already has, so the Keeper can reuse a handle', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: '门房', to: 'here', why: 'he is at the stair'}]);
	// The Keeper reaches for the same man under a second appellation. Nothing decides they are one
	// person -- that is the judgement this project forbids -- but the roster is offered.
	let refused = null;
	try { await game.call('table.look', {focus: 'npc', name: '管楼的'}); }
	catch (thrown) { refused = thrown; }
	assert.equal(refused?.code, 'unknown_entity');
	assert.ok((refused.details?.candidates ?? []).some(candidate => candidate.name === '门房'),
		`the roster of this table's own people is offered: ${JSON.stringify(refused.details?.candidates)}`);
});

/**
 * Silence is what mints, not failure to resolve. The first version read through `graph.find`, which
 * answers null for an ambiguous name exactly as it does for an absent one, so a name two nodes both
 * held minted a third person called that, and a name one word off an authored one made a duplicate
 * ghost where #64's guard requires `unknown_entity`. `ts-kernel-name-fold` and
 * `ts-kernel-name-phrase` caught both; this is §87's own statement of the rule.
 *
 * `candidates` is consulted to decide whether to *refuse*, never to pick. When the graph has
 * anything to say, its own refusal and its own candidates go back untouched and the Keeper chooses.
 */
test('a name the book has something to say about is refused, not quietly turned into a second person', async t => {
	const game = await table(t);
	let refused = null;
	try { await game.apply([{kind: 'npc', name: 'Steven Knot', to: 'here', why: 'one letter short of the landlord'}]); }
	catch (thrown) { refused = thrown; }
	assert.equal(refused?.code, 'unknown_entity', 'a near miss on an authored name is still a refusal');
	assert.ok((refused.details?.candidates ?? []).some(candidate => candidate.name === 'steven-knott'),
		`and it hands back who the book does have: ${JSON.stringify(refused.details?.candidates)}`);
	assert.deepEqual((await game.world()).table_people ?? [], [], 'nothing was established');
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
