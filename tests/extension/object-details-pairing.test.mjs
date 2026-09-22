/**
 * Contract §129: the word that opens a waiting card has a writer and a reader, and they agree.
 *
 * Three ends, all real here except the Mod child itself:
 *
 *  - the kernel projects a belonging whose registration was queued past the delivery as an `item`
 *    row with `definition: "pending"` and the `definition_name` the job is producing;
 *  - the Mod host, once that job's draft is accepted beside the turn, appends one
 *    `coc-object-details` session entry naming the same definition with its player view;
 *  - the Electron backend's projection (`coc-view.ts`, the one road to both the live card and the
 *    re-read) reads that entry and draws the pending row open.
 *
 * A writer nobody reads is how three `coc:` bus events died in this repository; a reader keyed on a
 * name the writer never writes is the same hole from the other side. So the pairing is asserted on
 * the values that actually travel, not on either end's say-so.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';
import {publicDefinition} from '../../kernel-ts/mods/public-definition.ts';
import {mechanicsEntry, objectDetailsOf, pendingObjectNames} from '../../Electron/packages/pi-backend/src/coc-view.ts';
import {table} from './object-usages-fixture.mjs';
import {waitFor} from './wait.mjs';

const until = (predicate, label) => waitFor(predicate, {label});

const DRAFT = {name: 'Field camera', category: 'item', description: 'A folding bellows camera.', basis: 'Carried by the investigator.',
  parameters: {charges: 8, effects: []}, traits: [{name: 'weight', value: 2, unit: 'lb', basis: 'Fixture.'}],
  player_view: {description: 'A folding bellows camera with a scratched lens cap.', fields: ['charges'], traits: ['weight']}};

function host(game, {runTask} = {}) {
  const entries = [], hooks = new Map();
  const pi = {events: new EventEmitter(), on: (name, fn) => hooks.set(name, fn),
    appendEntry: (customType, data) => entries.push({type: 'custom', id: `entry-${entries.length}`, customType, data})};
  let bridge;
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  let minted = 0;
  // Through JSON, as the kernel RPC carries it: an absent optional field is dropped, not sent as undefined.
  pi.events.emit('coc:kernel-bridge', {call: (method, params) => game.call(method, JSON.parse(JSON.stringify(params))), mintCallId: () => `t2-c${++minted}`,
    runtime: {
      async runTask(task) {
        if (runTask) return runTask(task);
        await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(DRAFT));
        return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
      },
      async check() { return {ok: true}; },
    }});
  return {bridge, entries, hooks};
}

test('a belonging registered past the delivery is drawn pending, and the host word the backend reads opens it', async t => {
  const game = await table(t);
  const unregistered = (await game.call('mods.context')).unregistered_equipment.map(row => row.name);
  assert.ok(unregistered.length, 'the pregen has to carry unregistered equipment for this to mean anything');
  const h = host(game);
  const payload = {campaign: 'c1', effects: [{kind: 'define', name: DRAFT.name, category: 'item', description: DRAFT.description},
    {kind: 'object', name: 'Your field camera', to: game.sheet.name, adopt: unregistered[0], definition: DRAFT.name, why: 'Registering carried gear.'}]};
  await h.bridge.prepare('apply', payload);
  assert.equal(typeof payload.effects[0]._queued, 'string', 'define/adopt bookkeeping is deferred, not generated in the call');
  await game.apply(payload.effects);
  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'You set the camera on the table beside the lease.'});

  // The kernel end: the row exists at once, says it is waiting, and names what it waits on.
  const row = delivery.mechanics.find(item => item.kind === 'item' && item.adopted === unregistered[0]);
  assert.ok(row, 'the queued adoption reaches the card as a row instead of vanishing as bookkeeping');
  assert.equal(row.definition, 'pending');
  assert.equal(row.definition_name, DRAFT.name);
  assert.equal(row.object, undefined);
  assert.equal(row.to_label, undefined, 'a belonging already carried was handed to nobody');
  const card = {type: 'custom', id: 'card-t1', customType: 'coc-mechanics', timestamp: '2026-09-22', data: {turn: delivery.turn, mechanics: delivery.mechanics}};
  assert.deepEqual(pendingObjectNames(card), [DRAFT.name]);

  // The host end: the background generation lands and says so once, under the name the row carries.
  await until(() => h.entries.some(entry => entry.customType === 'coc-object-details'), 'the host announced the landed details');
  const words = h.entries.filter(entry => entry.customType === 'coc-object-details');
  assert.equal(words.length, 1);
  assert.equal(words[0].data.campaign, 'c1');
  assert.deepEqual(words[0].data.objects.map(item => [item.name, item.definition]), [[DRAFT.name, 'ready']]);

  // The reader end: the backend projection draws the recorded row open, with the player view only.
  const drawn = mechanicsEntry(card, 'en', undefined, {}, undefined, new Map(objectDetailsOf(words[0], 'c1')));
  const opened = drawn.presentation.details.mechanics.find(item => item.receipt === row.receipt);
  assert.equal(opened.definition, 'ready');
  assert.deepEqual(opened.object, publicDefinition(DRAFT));
  assert.equal(opened.object.description, DRAFT.player_view.description);
  assert.deepEqual(opened.object.parameters, {charges: 8});
  assert.equal(JSON.stringify(opened).includes(DRAFT.basis), false, 'the basis is Keeper material and never rides to the card');

  // The next turn's resume writes the definition into the world; its replayed adoption is not a
  // second row, because the card that named it pending is the one that opened.
  await game.call('table.player_input', {text: 'I take the camera and head out.'});
  await h.bridge.after('player_input', {campaign: 'c1'});
  assert.equal((await game.call('table.look', {focus: 'object', name: DRAFT.name})).definition.name, DRAFT.name);
  const status = await game.call('table.status');
  assert.equal(status.mechanics.some(item => item.kind === 'item' && item.adopted), false,
    'the replayed adoption is projected again as a second row');
  assert.equal(h.entries.filter(entry => entry.customType === 'coc-object-details').length, 1,
    'a definition already announced is not announced again');
});

/** Turn 1 queues a belonging whose child never finishes; turn 2 is open when this returns. */
async function unfinished(t) {
  const game = await table(t);
  const unregistered = (await game.call('mods.context')).unregistered_equipment.map(row => row.name);
  const h = host(game, {runTask: async () => ({ok: false, code: 1, timedOut: false, ms: 1, stderr: 'boom', command: []})});
  const payload = {campaign: 'c1', effects: [{kind: 'define', name: DRAFT.name, category: 'item', description: DRAFT.description},
    {kind: 'object', name: 'Your field camera', to: game.sheet.name, adopt: unregistered[0], definition: DRAFT.name, why: 'Registering carried gear.'}]};
  await h.bridge.prepare('apply', payload);
  await game.apply(payload.effects);
  await game.call('table.narrate', {call_id: game.next(), text: 'You set the camera on the table beside the lease.'});
  await game.call('table.player_input', {text: 'I head out.'});
  return game;
}

test('an unfinished registration is regenerated beside the next turn, under its own marker, and then written', async t => {
  const game = await unfinished(t);
  let release, started = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const again = host(game, {runTask: async task => {
    started++;
    await gate;
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(DRAFT));
    return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
  }});
  // The first verb of the turn finds the registration unfinished and returns while the child is still
  // held: it used to generate it right there, on that verb's clock and budget.
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  await until(() => started === 1, 'the regeneration started beside the turn');
  assert.equal(again.entries.length, 0, 'nothing is announced before it lands');
  release();
  await until(() => again.entries.some(entry => entry.customType === 'coc-object-details'), 'the regenerated details were announced');
  assert.deepEqual(again.entries.at(-1).data.objects.map(item => [item.name, item.definition]), [[DRAFT.name, 'ready']]);
  // The result landed in the job the marker names, so the next resume writes it instead of starting
  // the same generation again: minted under the asking turn, it never would have.
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  assert.equal(started, 1, 'the registration was generated a second time');
  assert.equal((await game.call('table.look', {focus: 'object', name: DRAFT.name})).definition.name, DRAFT.name);
});

test('a resume that has to drop its markers tells the waiting card to stop waiting', async t => {
  const game = await unfinished(t);
  // Force the resume to fail: a queued registration whose apply cannot land is discarded.
  const failing = {...game, call: async (method, params) => {
    if (method === 'table.apply') throw new Error('the deferred batch did not land');
    return game.call(method, params);
  }};
  const again = host(failing);
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  await until(() => again.entries.some(entry => entry.customType === 'coc-object-details'), 'the regenerated details were announced');
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  const words = again.entries.filter(entry => entry.customType === 'coc-object-details');
  assert.deepEqual(words.map(word => word.data.objects.map(item => [item.name, item.definition])),
    [[[DRAFT.name, 'ready']], [[DRAFT.name, 'none']]], 'a discarded registration closes the fold it had opened');
});

test('a generation still in flight when its markers are discarded does not reopen the card', async t => {
  const game = await table(t);
  const rows = (await game.call('mods.context')).unregistered_equipment.map(row => row.name);
  assert.ok(rows.length >= 2, 'two carried rows are needed: one lands in its turn, one does not');
  const LAMP = {...DRAFT, name: 'Brass lamp', description: 'A brass lamp.', player_view: {description: 'A brass lamp.', fields: []}};
  const drafts = {[DRAFT.name]: DRAFT, [LAMP.name]: LAMP};
  const nameOf = async task => JSON.parse(await readFile(join(task.request.cwd, 'request.json'), 'utf8')).input.name;
  // Turn 1: the camera lands beside the turn, the lamp's child dies.
  const h = host(game, {runTask: async task => {
    const name = await nameOf(task);
    if (name === LAMP.name) return {ok: false, code: 1, timedOut: false, ms: 1, stderr: 'boom', command: []};
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(drafts[name]));
    return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
  }});
  // Two batches: a batch with a failed member attaches nothing, so the camera would otherwise wait for
  // the next resume as well.
  for (const [draft, row, name] of [[DRAFT, rows[0], 'Your field camera'], [LAMP, rows[1], 'Your brass lamp']]) {
    const payload = {campaign: 'c1', effects: [{kind: 'define', name: draft.name, category: 'item', description: draft.description},
      {kind: 'object', name, to: game.sheet.name, adopt: row, definition: draft.name, why: 'Registering carried gear.'}]};
    await h.bridge.prepare('apply', payload);
    await game.apply(payload.effects);
  }
  await until(() => h.entries.length === 1, 'the camera was announced in its own turn');
  await game.call('table.narrate', {call_id: game.next(), text: 'You set your things on the table.'});
  await game.call('table.player_input', {text: 'I head out.'});
  // Turn 2: the resume finds the camera ready and the lamp unfinished. The lamp is regenerated beside
  // the turn and held there; the camera's apply cannot land, so every marker is discarded.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let accepted = 0;
  const failing = {...game, call: async (method, params) => {
    if (method === 'table.apply') throw new Error('the deferred batch did not land');
    try { return await game.call(method, params); }
    finally { if (method === 'mods.accept') accepted++; }
  }};
  const again = host(failing, {runTask: async task => {
    const name = await nameOf(task);
    await gate;
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(drafts[name]));
    return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
  }});
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  const closed = again.entries.map(entry => entry.data.objects.map(item => [item.name, item.definition]));
  assert.deepEqual(closed, [[[DRAFT.name, 'none'], [LAMP.name, 'none']]]);
  release();
  // The lamp's generation now finishes, after its marker is gone. The kernel no longer accepts it (the
  // job belongs to a registration that was dropped), and saying ready would open a card on a
  // registration the world will never hold.
  // Both of the creator's attempts are answered (a refused acceptance is repaired once), and then the
  // batch settles; the pause only lets that settling finish, it is not what the assertion waits on.
  await until(() => accepted === 2, 'both attempts of the held generation were answered by acceptance');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(again.entries.map(entry => entry.data.objects.map(item => [item.name, item.definition])), closed);
});
