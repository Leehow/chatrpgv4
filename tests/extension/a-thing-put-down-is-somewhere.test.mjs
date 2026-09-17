/**
 * Contract §97. A stack that is partly put down is partly put down.
 *
 * Built on the shape of turn 109 of `game-3dd94f0a-4b26-41bc-96fa-f89a60abb143`, which is the only
 * shape that matters here. The Keeper asked for two of four reprints to go into the professor's
 * drawer and the other two to stay in the investigator's pocket. The call was right in every
 * particular -- `{kind: "object", name: "四张翻拍", to: "here", from: "沈砚舟", quantity: 2}` -- and
 * the kernel answered `Transfer preserves the complete instance quantity` with `next: change_input`
 * and no `fix`, because there was no input to change to. Four turns later the sheet still read
 * `四张翻拍 x4` in a police station in another part of the city, while two of them were locked in a
 * drawer behind somebody else's key.
 *
 * So the seeded table is that table: a stack, a container that locks, part of the stack left in it,
 * and the investigator walking out of the building. What is asserted is what the panel would have
 * shown -- the sheet stops counting what was left behind, and counts exactly what was kept.
 *
 * Nothing below asserts a sentence. Refusals are read for the fields a Keeper acts on, so the words
 * stay free to be rewritten; what is pinned is that the division happened, that both halves are
 * right, and that a division nobody can name is refused.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table} from './object-usages-fixture.mjs';

const instance = async (game, name) =>
	Object.values((await game.world()).objects.instances).find(row => row.name === name);

const ALL_REPRINTS = 'North doorway\nSouth stair\nCarved lintel\nDusted plinth';
const DRAWER_REPRINTS = 'North doorway\nSouth stair';
const CARRIED_REPRINTS = 'Carved lintel\nDusted plinth';

const refusal = async promise => {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	return null;
};

/** What the investigator's panel counts, by name. */
const carried = async game => {
	const sheet = JSON.parse(await readFile(game.sheetPath, 'utf8'));
	return Object.fromEntries(sheet.equipment.filter(row => row && row.object_id).map(row => [row.name, row.quantity]));
};

/** `table.apply` answers with receipt ids; the receipts themselves are on the open turn. */
const receiptsOf = async game =>
	JSON.parse(await readFile(join(game.directory, 'turn.json'), 'utf8')).receipts;

/** One accepted definition, through the same host job path the fixture uses for the chair. */
async function define(game, name, description) {
	const job = await game.call('mods.job', {role: 'create', input: {name, category: 'item', description}});
	assert.equal(job.enabled, true);
	const definition = {name, category: 'item', description, basis: 'Present in this contract fixture.',
		parameters: {charges: null, effects: []}, player_view: {description, fields: []}};
	await writeFile(join(job.cwd, 'result.json'), JSON.stringify(definition));
	const accepted = await game.call('mods.accept', {job: job.job});
	return {kind: 'define', name, category: 'item', _definition: accepted.definition, _provenance: accepted.provenance};
}

/**
 * The drawer, the four prints, and the lock. The drawer belongs to the room the table is standing
 * in, which is what makes it something the investigator can walk away from.
 */
async function room(t) {
	const game = await table(t);
	await game.apply([await define(game, 'Desk drawer', 'A shallow drawer in the study desk, with a lock.'),
		{kind: 'object', name: 'Study desk drawer', definition: 'Desk drawer', to: 'here'}]);
	await game.apply([await define(game, 'Reprint', 'A photographic reprint on thin paper.'),
		{kind: 'object', name: 'Four reprints', definition: 'Reprint', to: game.sheet.name, quantity: 4,
		 document: {text: ALL_REPRINTS, presentation: 'paper'}}]);
	return game;
}

test('§97: two of the four are left in a locked drawer, the table walks out, and the sheet counts the two that went with it', async t => {
	const game = await room(t);
	assert.deepEqual(await carried(game), {'Study chair': 1, 'Four reprints': 4}, 'all four start in hand');

	await game.apply([
		{kind: 'object', name: 'Four reprints', from: game.sheet.name, to: 'Study desk drawer',
		 quantity: 2, part: 'Two reprints in the drawer',
		 document: {action: 'divide', part_text: DRAWER_REPRINTS, remainder_text: CARRIED_REPRINTS},
		 why: 'left with him for the police to see'},
		{kind: 'flag', name: 'study desk drawer locked', why: 'he turned the key and kept it'}]);

	const stayed = await instance(game, 'Four reprints'), left = await instance(game, 'Two reprints in the drawer');
	assert.ok(left, 'the portion that separated is a thing of its own');
	assert.equal(left.quantity, 2, 'two of them went into the drawer');
	assert.equal(left.owner.kind, 'object', 'and what holds them is the drawer, not a person and not the room');
	assert.equal(left.owner.name, 'Study desk drawer');
	assert.equal(left.definition, stayed.definition, 'they are the same kind of thing they were');
	assert.equal(stayed.quantity, 2, 'the two that were kept are still the same instance, and there are two of them');
	assert.equal(stayed.owner.id, game.sheet.id);
	assert.equal(left.document.text, DRAWER_REPRINTS, 'the separated carrier says only what moved');
	assert.equal(left.document.original, DRAWER_REPRINTS, 'reset cannot restore pages that stayed behind');
	assert.equal(stayed.document.text, CARRIED_REPRINTS, 'the original carrier says only what stayed');
	assert.equal(stayed.document.original, CARRIED_REPRINTS, 'its acquisition baseline follows the physical split');
	const readable = await game.call('mods.document.view', {actor: game.sheet.name, name: 'Four reprints'});
	assert.equal(readable.text, CARRIED_REPRINTS, 'the existing document reader sees the remainder');
	assert.equal(readable.original, CARRIED_REPRINTS);
	const reset = await game.call('mods.document.apply', {actor: game.sheet.name, name: 'Four reprints',
		version: readable.version, action: 'reset'});
	assert.equal(reset.text, CARRIED_REPRINTS, 'reset cannot regrow the two prints that physically left');

	// §31's third end: the receipt says both halves, so a reader is not left to go and count the rest.
	const receipt = (await receiptsOf(game)).filter(row => row.kind === 'item').at(-1);
	assert.equal(receipt.name, 'Two reprints in the drawer', 'the receipt is about what moved');
	assert.equal(receipt.quantity, 2);
	assert.equal(receipt.divided_from, 'Four reprints');
	assert.equal(receipt.remaining, 2);

	// The decisive read of turn 113: the investigator leaves the building.
	const view = await game.call('table.look', {focus: 'scene'});
	const exit = view.where.exits.find(row => row && (row.to || row.name || row.label));
	assert.ok(exit, 'the fixture scene has somewhere to go');
	await game.apply([{kind: 'move', to: exit.to ?? exit.name ?? exit.label, why: 'back out to the street'}]);

	assert.deepEqual(await carried(game), {'Study chair': 1, 'Four reprints': 2},
		'the two in the drawer stayed in the drawer; the sheet counts only what is actually carried');
	const afterwards = await instance(game, 'Two reprints in the drawer');
	assert.equal(afterwards.owner.name, 'Study desk drawer', 'and they are still in it');
});

test('§97: a separated portion composes with the ordinary person-to-person handover ground', async t => {
	const game = await room(t);
	await game.apply([{kind: 'object', name: 'Four reprints', from: game.sheet.name, to: 'Steven Knott',
		quantity: 1, part: 'One reprint for Knott', handover: 'given',
		document: {action: 'divide', part_text: 'North doorway', remainder_text: 'South stair\nCarved lintel\nDusted plinth'},
		why: 'the investigator gives Knott one copy'}]);

	const stayed = await instance(game, 'Four reprints');
	const given = await instance(game, 'One reprint for Knott');
	assert.equal(stayed.quantity, 3);
	assert.equal(stayed.owner.id, game.sheet.id);
	assert.equal(given.quantity, 1);
	assert.equal(given.owner.kind, 'npc');
	assert.equal(given.owner.name, 'Steven Knott');
	const receipt = (await receiptsOf(game)).filter(row => row.kind === 'item').at(-1);
	assert.equal(receipt.handover, 'given');
	assert.equal(receipt.divided_from, 'Four reprints');
	assert.equal(receipt.remaining, 3);
});

test('§97: the portion that separates has to be given a name, and the refusal says what is being divided', async t => {
	const game = await room(t);
	const error = await refusal(game.apply([{kind: 'object', name: 'Four reprints',
		from: game.sheet.name, to: 'Study desk drawer', quantity: 2}]));
	assert.ok(error, 'a stack does not come apart into two things with one name between them');
	assert.equal(error.code, 'invalid_params');
	assert.equal(error.details.field, 'object.part');
	assert.equal(error.details.held, 4);
	assert.equal(error.details.moving, 2);
	const stack = await instance(game, 'Four reprints');
	assert.equal(stack.quantity, 4, 'and nothing came apart');
	assert.equal(stack.owner.id, game.sheet.id);
});

test('§97: a name something else already answers to is refused, so neither of them becomes unreachable', async t => {
	const game = await room(t);
	const error = await refusal(game.apply([{kind: 'object', name: 'Four reprints',
		from: game.sheet.name, to: 'Study desk drawer', quantity: 2, part: 'Study chair'}]));
	assert.ok(error, 'two instances cannot answer to one name');
	assert.equal(error.code, 'invalid_params');
	assert.equal(error.details.field, 'object.part');
	assert.equal(error.details.name, 'Study chair');
	assert.equal((await instance(game, 'Four reprints')).quantity, 4);
	// The thing it tried to shadow is still reachable by that name, which is the harm being prevented.
	const look = await game.call('table.look', {focus: 'object', name: 'Study chair'});
	assert.equal(look.instance.name, 'Study chair');
});

test('§97: a whole-stack move is unchanged, and what it moves is all of it', async t => {
	const game = await room(t);
	await game.apply([{kind: 'object', name: 'Four reprints', from: game.sheet.name,
		to: 'Study desk drawer', why: 'all four go in'}]);
	const stack = await instance(game, 'Four reprints');
	assert.equal(stack.quantity, 4, 'a move with no quantity still carries the complete instance');
	assert.equal(stack.owner.name, 'Study desk drawer');
	assert.deepEqual(await carried(game), {'Study chair': 1}, 'and the sheet stops counting it entirely');
});

test('§99: a written stack is refused unless the call accounts for the text on both resulting carriers', async t => {
	const game = await room(t);
	const error = await refusal(game.apply([{kind: 'object', name: 'Four reprints', from: game.sheet.name,
		to: 'Study desk drawer', quantity: 2, part: 'Two reprints in the drawer'}]));
	assert.ok(error, 'the kernel cannot guess which readable content belongs on either half');
	assert.equal(error.code, 'invalid_params');
	assert.equal(error.details.field, 'object.document');
	assert.equal((await instance(game, 'Four reprints')).quantity, 4, 'the refused batch changes neither count nor text');
	assert.equal((await instance(game, 'Four reprints')).document.text, ALL_REPRINTS);
});

test('§99: a Keeper cannot repartition a player edit', async t => {
	const game = await room(t);
	const current = await game.call('mods.document.view', {actor: game.sheet.name, name: 'Four reprints'});
	await game.call('mods.document.apply', {actor: game.sheet.name, name: 'Four reprints', version: current.version,
		action: 'save', text: `${ALL_REPRINTS}\nPlayer annotation`});
	const error = await refusal(game.apply([{kind: 'object', name: 'Four reprints', from: game.sheet.name,
		to: 'Study desk drawer', quantity: 2, part: 'Two reprints in the drawer',
		document: {action: 'divide', part_text: DRAWER_REPRINTS, remainder_text: CARRIED_REPRINTS}}]));
	assert.ok(error);
	assert.equal(error.code, 'invalid_params');
	assert.equal(error.details.field, 'object.document');
	assert.equal(error.details.player_edited, true);
	assert.equal((await instance(game, 'Four reprints')).quantity, 4);
	assert.equal((await instance(game, 'Four reprints')).document.text, `${ALL_REPRINTS}\nPlayer annotation`);
});
