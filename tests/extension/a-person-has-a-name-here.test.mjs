/**
 * Contract §79. A person has a name here.
 *
 * A place has `world.scene_labels` and a clue has `world.clue_labels`. A person had nothing, so
 * three readings of the same table converged on one root: M-MAIN's prose wrote 杰克逊·伊莱亚斯 for
 * seven turns and 杰克逊·埃利亚斯 at turn 42 while the engine answered `Jackson Elias` throughout;
 * H-SIDE's player corrected a form of address at turn 32, the NPC accepted it on the spot, and it
 * relapsed at turn 57 — and at another NPC after two turns, and a third NPC who had never been
 * corrected used the wrong form the first time they opened their mouth.
 *
 * Two and twenty-five both failing is the finding: nothing was storing it. So the test that matters
 * is the last one here — the address is still true long after the turn that established it, and it
 * is on the person addressed rather than on the pair, which is why a stranger owes it too.
 *
 * Nothing below asserts a word this change is free to rewrite: every label is read back out of
 * `world.person_labels` rather than written into the assertion.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {table} from './object-usages-fixture.mjs';

/** The record this table keeps for one person, taken from the world rather than written here. */
const record = async (game, id) => ((await game.world()).person_labels ?? {})[id] ?? {};
const carded = (mechanics, call_id, kind) => mechanics.filter(row => row.call === call_id && row.kind === kind);

/** One turn of play: the Keeper closes, the player speaks, and the next capsule comes back. */
async function turn(game, said = 'I keep looking around.') {
	await game.call('table.narrate', {call_id: game.next(), text: 'The room is quiet for a moment.'});
	return game.call('table.player_input', {text: said});
}

test('§79: a name this table gave a person is the name a later card carries', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'he is waiting'}]);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: 'The letting agent', why: 'this is what the table has been calling him'}]);
	const call_id = game.next();
	await game.call('table.apply', {call_id, effects: [{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott'}]});
	const {mechanics} = await game.call('table.status', {});
	const [item] = carded(mechanics, call_id, 'item');
	assert.ok(item, 'handing an object to a person settles into an item card');
	assert.equal(item.to, 'steven-knott', 'the card names the identity');
	assert.equal(item.to_label, (await record(game, 'steven-knott')).name, "and calls them what this table calls them, not what the book does");
	assert.notEqual(item.to_label, item.to, 'a handle is a machine word and never reaches the player');
});

test('§79: the label a card draws never becomes the identity a person is stored under', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'he is waiting'}]);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: 'The letting agent'}]);
	await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott'}]);
	const stored = Object.values((await game.world()).objects.instances).find(row => row.name === 'Study chair');
	assert.equal(stored.owner.id, 'steven-knott', 'the stored owner is the identity');
	assert.notEqual(stored.owner.name, (await record(game, 'steven-knott')).name, 'a renameable label has no business in a stored identity');
	// Renaming the person must not strand what they are holding: `from` still resolves to them.
	await game.apply([{kind: 'person', who: 'The letting agent', name: 'The man with the keys'}]);
	await game.apply([{kind: 'object', name: 'Study chair', from: 'Steven Knott', to: game.sheet.name}]);
	const carried = Object.values((await game.world()).objects.instances).find(row => row.name === 'Study chair');
	assert.equal(carried.owner.id, game.sheet.id, 'the transfer landed after the rename');
	assert.equal((await record(game, 'steven-knott')).name, 'The man with the keys', 'and the table has one record for this person, updated in place');
});

test('§79: a form of address established in play is still true twenty-five turns later, and a stranger owes it too', async t => {
	const game = await table(t);
	await game.apply([{kind: 'person', who: game.sheet.id, address: 'the nurse', why: 'the player said she is not a fellow and the man accepted it'}]);
	const established = (await record(game, game.sheet.id)).address;
	assert.ok(established, 'the correction is written where a person is kept, not left in a memory candidate');

	// The relapses were at two turns and at twenty-five. Both must survive, so run the longer one:
	// nothing here is a fresh assertion of the address, only turns passing.
	let capsule;
	for (let n = 0; n < 25; n++)
		({capsule} = await turn(game));
	const called = capsule.known.investigator.called;
	assert.ok(called, 'the capsule still carries what this person is called');
	assert.equal(called.address, established, 'twenty-five turns on, it is the word the table established');
	assert.ok(String(called.use).includes(established), 'and it is put in front of the Keeper as something to use, not only as a field');

	// The fifteenth H-SIDE case: an NPC who was never corrected, speaking for the first time. The
	// address is a fact about the person addressed, so it is there before they open their mouth.
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'he arrives now, twenty-five turns after the correction'}]);
	const arrival = await turn(game, 'I turn to the man who just walked in.');
	assert.ok(arrival.capsule.present.some(person => person.name === 'Steven Knott'), 'he is in the room');
	assert.equal(arrival.capsule.known.investigator.called.address, established, 'and the turn he first speaks already knows what she is called');
	assert.deepEqual(Object.keys((await game.world()).person_labels), [game.sheet.id],
		'the record is keyed by the person addressed, not by the pair who happened to be talking');
});

test('§79: an investigator carries their own name, and the table does not keep a second one', async t => {
	const game = await table(t);
	await assert.rejects(
		() => game.apply([{kind: 'person', who: game.sheet.id, name: 'Somebody else'}]),
		error => {
			assert.equal(error.code ?? error.data?.code, 'invalid_params');
			return true;
		},
		'a name the player chose is on their sheet; one fact lives in one place');
	assert.equal((await game.world()).person_labels?.[game.sheet.id], undefined, 'and the refusal wrote nothing');
});

test('§79: a say token naming someone by what this table calls them resolves to that person', async t => {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'he is waiting'}]);
	await game.apply([{kind: 'person', who: 'Steven Knott', name: 'The letting agent'}]);
	const named = (await record(game, 'steven-knott')).name;
	const delivery = await game.call('table.narrate', {call_id: game.next(), text: `{{say:${named}}}"Take the keys."{{/say}} He turns away.`});
	const [spoken] = delivery.speech;
	assert.ok(spoken, 'the line was lifted out as speech');
	assert.equal(spoken.who.npc, 'steven-knott', "the table's own word for someone is one of that person's names");
	assert.equal(spoken.who.name, named, 'and the resolved row carries it, so the journal and the legend read one word for one person');
	assert.ok(!(delivery.unresolved_speakers ?? null), 'nobody was left standing as an anonymous label');
});
