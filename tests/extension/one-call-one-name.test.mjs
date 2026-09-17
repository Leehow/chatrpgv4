/**
 * Contract §75. One call, one name for one place.
 *
 * Turn 99 of campaign `game-1c0faba5` settled a single call into two cards the player reads side by
 * side: an item card saying the card was left at `Benefit Street office building` and, under it, a
 * move card leaving the place the table had named in its own language. Same handle, same `call_id`,
 * two names -- so this is not two implementations drifting apart over a campaign's life, it is two
 * producers of one turn reading two different records for one entity.
 *
 * The record that decides is `world.scene_labels`: the name the Keeper gave the place at this table.
 * `apply move` reads it; the object transfer read the module graph instead. These tests hold both
 * producers to the same record, and hold the identity they mint apart from the label they draw.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {table} from './object-usages-fixture.mjs';

/** The name this table gave the place, taken from the world rather than written here. */
const tableName = async (game, handle) => (await game.world()).scene_labels[handle];
const carded = (mechanics, call_id, kind) => mechanics.filter(row => row.call === call_id && row.kind === kind);

/** Name the place the party is standing in, the way the Keeper does: `apply move` onto itself. */
async function named(game, label) {
    const here = (await game.call('table.view', {})).scene.name;
    await game.apply([{kind: 'move', to: here, label}]);
    return here;
}

test('§75: one call that leaves an object behind and moves away gives the place one name', async t => {
    const game = await table(t), here = await named(game, 'The letting agent back room');
    const call_id = game.next();
    await game.call('table.apply', {call_id, effects: [
        {kind: 'object', name: 'Calling card', definition: 'Chair frame', to: 'here'},
        {kind: 'move', to: 'corbitt-house-ground', via: 'Knott walked them over with the keys'}
    ]});
    const {mechanics} = await game.call('table.status', {});
    const [item] = carded(mechanics, call_id, 'item'), [moved] = carded(mechanics, call_id, 'scene');
    assert.ok(item && moved, 'the call must settle into an item card and a scene card');
    assert.equal(item.to, moved.from, 'both cards must be about the same place');
    assert.equal(item.to_label, moved.from_label, 'one place, one name, in one call');
    assert.equal(item.to_label, await tableName(game, item.to), "the name is the table's, not the book's");
});

test("§75: an object taken back off a place is taken from the place's name at this table", async t => {
    const game = await table(t), here = await named(game, 'The letting agent back room');
    await game.apply([{kind: 'object', name: 'Calling card', definition: 'Chair frame', to: 'here'}]);
    const call_id = game.next();
    await game.call('table.apply', {call_id, effects: [{kind: 'object', name: 'Calling card', from: 'here', to: game.sheet.name}]});
    const {mechanics} = await game.call('table.status', {});
    const [item] = carded(mechanics, call_id, 'item');
    assert.equal(item.from, await tableName(game, here), "the giver is the place's name at this table");
    assert.equal(item.to_label, game.sheet.name, 'a person carries their own name; nothing renames them');
});

test('§75: the label a card draws never becomes the identity an instance is stored under', async t => {
    const game = await table(t), here = await named(game, 'The letting agent back room');
    await game.apply([{kind: 'object', name: 'Calling card', definition: 'Chair frame', to: 'here'}]);
    const stored = Object.values((await game.world()).objects.instances).find(row => row.name === 'Calling card');
    assert.equal(stored.owner.id, here, 'the stored owner is the handle');
    assert.notEqual(stored.owner.name, await tableName(game, here), 'a renameable label has no business in a stored identity');
    // Renaming the place again must not strand the instance: `from` still resolves to its owner.
    await named(game, 'The back room off Benefit Street');
    await game.apply([{kind: 'object', name: 'Calling card', from: 'here', to: game.sheet.name}]);
    const carried = Object.values((await game.world()).objects.instances).find(row => row.name === 'Calling card');
    assert.equal(carried.owner.id, game.sheet.id);
});
