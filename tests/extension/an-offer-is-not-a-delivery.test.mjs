/**
 * Contract §88. An offer is not a delivery.
 *
 * Built on the shape of turn 125 of `game-1c0faba5-5a90-4eff-ade3-0d62632b4e7a`, which is the
 * only shape that matters here: the Keeper moved a sheet of paper to Knott at call two, rolled the
 * Persuade that was to decide whether he would take it at call four, the roll failed, the prose had
 * him refuse it, and `world.json` said it was his. Turn 126 carried it back with no check and
 * nobody's leave, and that was taken too.
 *
 * So the tests are the two halves of that. A move that cites the future is not expressible -- a
 * roll that has not settled cannot be named, which is what makes "write, then roll" impossible
 * rather than discouraged. And a move that cites a roll which did not pass is refused, with the
 * `fix` naming the call that records the truth instead.
 *
 * Nothing below asserts a sentence. The refusals are read for the fields a Keeper acts on -- the
 * code, the offered enumeration, the calls a citation could have named -- so the words stay free
 * to be rewritten. What is pinned is that each refusal happens, and that the world did not move.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {table} from './object-usages-fixture.mjs';

/** The instance by name, out of the world rather than out of an assertion. */
const instance = async (game, name) =>
	Object.values((await game.world()).objects.instances).find(row => row.name === name);

const refusal = async promise => {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	return null;
};

/** Knott is here and the chair is in the investigator's hands, exactly as the fixture leaves it. */
async function room(t) {
	const game = await table(t);
	await game.apply([{kind: 'npc', name: 'Steven Knott', to: 'here', why: 'the iron gate is open and he is inside'}]);
	return game;
}

/**
 * A settled roll of each kind. The kernel's dice are seeded, not scripted, so rather than pin a
 * number the turn simply rolls until it has seen one of each -- which makes the test indifferent to
 * the seed and to every future call that shifts the sequence.
 */
async function rolls(game, want) {
	const found = {};
	for (let attempt = 0; attempt < 40 && Object.keys(found).length < 2; attempt++) {
		const call_id = game.next();
		const result = await game.call('table.resolve', {call_id, action: {intent: 'investigate',
			skill: 'Spot Hidden', goal: 'read the desk while he decides'}});
		if (result.outcome?.kind !== 'check') continue;
		found[result.outcome.passed ? 'passed' : 'failed'] ??= {call_id, outcome: result.outcome};
	}
	for (const key of want)
		assert.ok(found[key], `the fixture never produced a ${key} check in forty attempts`);
	return found;
}

test('§88: a handover that cites a roll which has not settled is refused, so the write cannot precede its own decision', async t => {
	const game = await room(t);
	// Turn 125's exact order: the transfer is written first, and the call it would have to name is
	// the one the Keeper has not made yet. There is nothing to cite, and that is the point.
	const error = await refusal(game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name,
		to: 'Steven Knott', handover: 'check', check: 't1-c99'}]));
	assert.ok(error, 'a citation of a call that has not settled is refused');
	assert.equal(error.code, 'invalid_params');
	assert.equal(error.details.field, 'object.check');
	assert.ok(Array.isArray(error.details.settled), 'the refusal says which calls could have been named');
	assert.ok(!error.details.settled.includes('t1-c99'), 'and the one that was named is not among them');
	const chair = await instance(game, 'Study chair');
	assert.equal(chair.owner.id, game.sheet.id, 'nothing moved');
});

test('§88: a handover that cites a failed roll is refused, and the fix names the call that records the truth', async t => {
	const game = await room(t);
	const {failed} = await rolls(game, ['failed']);
	const error = await refusal(game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name,
		to: 'Steven Knott', handover: 'check', check: failed.call_id}]));
	assert.ok(error, 'the dice decided it and they said no');
	assert.equal(error.code, 'invalid_params');
	assert.equal(error.details.field, 'object.check');
	assert.equal(error.details.check, failed.call_id);
	assert.equal(error.details.passed, false);
	// §34.7: a Keeper executes a fix literally, so the fix has to name the effect that is true.
	assert.match(error.fix, /offer/, 'and it says what to record instead');
	const chair = await instance(game, 'Study chair');
	assert.equal(chair.owner.id, game.sheet.id, 'the paper is still where the prose said it was');
});

test('§88: a handover that cites a roll which passed carries the move, and the receipt says which roll carried it', async t => {
	const game = await room(t);
	const {passed} = await rolls(game, ['passed']);
	const call_id = game.next();
	await game.call('table.apply', {call_id, effects: [{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott', handover: 'check', check: passed.call_id}]});
	const chair = await instance(game, 'Study chair');
	assert.equal(chair.owner.id, 'steven-knott', 'the move landed');
	const {mechanics} = await game.call('table.status', {});
	const card = mechanics.find(row => row.call === call_id && row.kind === 'item');
	assert.ok(card, 'the move settles into an item card');
	assert.equal(card.handover, 'check', 'the card carries the ground');
	assert.equal(card.check, passed.call_id, 'and the roll that ground named, so the turn can be read back');
});

test('§88: a person-to-person move states its ground, and a move with no second person in it states none', async t => {
	const game = await room(t);
	const missing = await refusal(game.apply([{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott'}]));
	assert.ok(missing, 'moving a thing from one person to another needs its ground');
	assert.deepEqual(missing.details.supported, ['given', 'taken', 'check']);

	// The 52 of 78 receipts that are not person to person keep their existing shape untouched: a
	// place is nobody, and a field that would be meaningless there is refused rather than ignored.
	await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'here'}]);
	assert.equal((await instance(game, 'Study chair')).owner.kind, 'scene', 'putting it down needs no ground');
	const spurious = await refusal(game.apply([{kind: 'object', name: 'Study chair',
		from: 'here', to: game.sheet.name, handover: 'given'}]));
	assert.ok(spurious, 'a ground where there is no second person is refused, not ignored');
	assert.equal(spurious.details.field, 'object.handover');
});

test('§88: an offer moves nothing, stands in the capsule, and a plain move cannot walk past it', async t => {
	const game = await room(t);
	const call_id = game.next();
	await game.call('table.apply', {call_id, effects: [{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott', offer: 'made', why: 'she pushes it across the desk'}]});
	const held = await instance(game, 'Study chair');
	assert.equal(held.owner.id, game.sheet.id, 'holding a thing out does not give it away');
	assert.equal(held.offer.to.id, 'steven-knott', 'and the world knows who it is held out to');

	const {mechanics} = await game.call('table.status', {});
	const card = mechanics.find(row => row.call === call_id && row.kind === 'item');
	assert.equal(card.offer, 'made', 'the card says this is an offer, not a delivery');
	assert.equal(card.offered_to, 'steven-knott');

	// §31's third end: the capsule carries it, and the row says what closes it.
	await game.call('table.narrate', {call_id: game.next(), text: 'The abstract lies between you.'});
	const {capsule} = await game.call('table.player_input', {text: 'I wait.'});
	const row = capsule.obligations.find(entry => entry.kind === 'offer');
	assert.ok(row, 'an open offer is in front of the Keeper, not only in the world file');
	assert.equal(row.name, 'Study chair');
	assert.match(row.cue, /accepted/, 'and the row carries the call that closes it');
	assert.match(row.cue, /declined/);

	// And it cannot be answered by pretending it was never made.
	const walked = await refusal(game.apply([{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott', handover: 'given'}]));
	assert.ok(walked, 'a plain move between those two is refused while the offer stands');
	assert.equal(walked.details.field, 'object.offer');
});

test('§88: a declined offer leaves the paper where the prose said it was, and the object can then move on', async t => {
	const game = await room(t);
	await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott', offer: 'made'}]);
	const call_id = game.next();
	await game.call('table.apply', {call_id, effects: [{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott', offer: 'declined', why: 'two fingers push it back to the middle of the table'}]});
	const left = await instance(game, 'Study chair');
	assert.equal(left.owner.id, game.sheet.id, 'it stays with whoever held it out');
	assert.equal(left.offer, undefined, 'and nothing is standing open any more');
	const {mechanics} = await game.call('table.status', {});
	assert.equal(mechanics.find(row => row.call === call_id && row.kind === 'item').offer, 'declined');

	// The offer is closed, so the ordinary path is open again.
	await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott', handover: 'given'}]);
	assert.equal((await instance(game, 'Study chair')).owner.id, 'steven-knott');
});

test('§88: an accepted offer needs its ground, and closes with the move', async t => {
	const game = await room(t);
	await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott', offer: 'made'}]);
	const groundless = await refusal(game.apply([{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott', offer: 'accepted'}]));
	assert.ok(groundless, 'taking an offer is still a handover and still states what it stands on');
	assert.equal(groundless.details.field, 'object.handover');
	assert.equal((await instance(game, 'Study chair')).owner.id, game.sheet.id, 'and the refused call moved nothing');

	await game.apply([{kind: 'object', name: 'Study chair', from: game.sheet.name, to: 'Steven Knott',
		offer: 'accepted', handover: 'given'}]);
	const taken = await instance(game, 'Study chair');
	assert.equal(taken.owner.id, 'steven-knott', 'he took it');
	assert.equal(taken.offer, undefined, 'and the offer is closed by the taking');
});

test('§88: an offer that was never made cannot be closed', async t => {
	const game = await room(t);
	const error = await refusal(game.apply([{kind: 'object', name: 'Study chair',
		from: game.sheet.name, to: 'Steven Knott', offer: 'declined'}]));
	assert.ok(error, 'closing an offer that was never made is a claim about a moment nobody recorded');
	assert.equal(error.details.field, 'object.offer');
	assert.equal((await instance(game, 'Study chair')).owner.id, game.sheet.id);
});
