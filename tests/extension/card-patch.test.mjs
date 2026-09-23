/**
 * Contract §132: an asynchronous lane enriches a card the player already has with one word, the
 * `coc-card-patch` session entry, and the backend that draws the card reads that same word.
 *
 * Asserted on the values that actually travel, end to end: the helper's entry; the definition lane
 * (§129's `announceDetails`, now a patch, with the older `coc-object-details` still beside it) against
 * a real kernel's pending row; and the usage prefetch lane against a real kernel's accepted proposal --
 * each fed through the backend's own ledger and projection (`coc-view.ts`), which is the one road to
 * both the live card and the re-read.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';
import {CARD_PATCH, patchCard} from '../../extensions/table/card-patch.ts';
import {publicDefinition, publicUsage} from '../../kernel-ts/mods/public-definition.ts';
import {CocCardLedger, mechanicsEntry} from '../../Electron/packages/pi-backend/src/coc-view.ts';
import {table, usage} from './object-usages-fixture.mjs';
import {waitFor} from './wait.mjs';

const until = (predicate, label) => waitFor(predicate, {label});

test('patchCard appends one well-formed entry and never throws', () => {
  const entries = [];
  const pi = {appendEntry: (customType, data) => entries.push({customType, data})};
  assert.equal(patchCard(pi, {campaign: 'c1', card: {turn: 3, id: 'card-3', anchor: 'ignored'}, patch: {objects: {Lamp: {lit: true}}}, source: 'test-lane'}), true);
  assert.equal(entries.length, 1);
  const [{customType, data}] = entries;
  assert.equal(customType, CARD_PATCH);
  assert.equal(customType, 'coc-card-patch');
  assert.deepEqual(Object.keys(data).sort(), ['at', 'campaign', 'card', 'patch', 'source']);
  assert.deepEqual(data.card, {id: 'card-3', turn: 3}, 'only the selectors the backend resolves travel');
  assert.deepEqual(data.patch, {objects: {Lamp: {lit: true}}});
  assert.equal(data.source, 'test-lane');
  assert.ok(!Number.isNaN(Date.parse(data.at)));
  // A card with no selector is every card whose rows the patch names.
  assert.equal(patchCard(pi, {campaign: 'c1', patch: {definitions: {Lamp: {definition: 'none'}}}, source: 'test-lane'}), true);
  assert.deepEqual(entries[1].data.card, {});
  // What cannot be a patch is refused, and nothing is written.
  for (const bad of [{campaign: '', patch: {a: 1}, source: 's'}, {campaign: 'c1', patch: {}, source: 's'}, {campaign: 'c1', patch: [1], source: 's'},
    {campaign: 'c1', patch: {a: 1}, source: ''}, null, undefined])
    assert.equal(patchCard(pi, bad), false);
  assert.equal(entries.length, 2);
  // A host that cannot append, or throws, costs the lane nothing.
  assert.equal(patchCard({}, {campaign: 'c1', patch: {a: 1}, source: 's'}), false);
  assert.equal(patchCard({appendEntry: () => { throw new Error('closed session'); }}, {campaign: 'c1', patch: {a: 1}, source: 's'}), false);
  assert.equal(patchCard(null, {campaign: 'c1', patch: {a: 1}, source: 's'}), false);
});

const DRAFT = {name: 'Field camera', category: 'item', description: 'A folding bellows camera.', basis: 'Carried by the investigator.',
  parameters: {charges: 8, effects: []}, traits: [{name: 'weight', value: 2, unit: 'lb', basis: 'Fixture.'}],
  player_view: {description: 'A folding bellows camera with a scratched lens cap.', fields: ['charges'], traits: ['weight']}};

/** The Mod host over a real kernel, with the session entries it appends kept in order. */
function host(game, {runTask, record} = {}) {
  const entries = [], hooks = new Map();
  const pi = {events: new EventEmitter(), on: (name, fn) => hooks.set(name, fn),
    appendEntry: (customType, data) => entries.push({type: 'custom', id: `entry-${entries.length}`, customType, data})};
  let bridge;
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  let minted = 0;
  pi.events.emit('coc:kernel-bridge', {call: (method, params) => game.call(method, JSON.parse(JSON.stringify(params))), mintCallId: () => `t2-c${++minted}`,
    record: row => record?.(row),
    runtime: {
      async runTask(task) {
        if (runTask) return runTask(task);
        await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(DRAFT));
        return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
      },
      async check() { return {ok: true}; },
    }});
  return {bridge, entries, hooks, pi};
}

/** The card the backend draws for these rows, with every entry the host appended read in order. */
function drawn(card, entries, campaign = 'c1') {
  const ledger = new CocCardLedger(campaign);
  ledger.note(card);
  for (const entry of entries) ledger.note(entry);
  return mechanicsEntry(card, 'en', undefined, {}, undefined, ledger.patchesFor(card.id)).presentation.details;
}

test('a landed definition is announced as a card patch, beside the older word, and opens the kernel row', async t => {
  const game = await table(t);
  const unregistered = (await game.call('mods.context')).unregistered_equipment.map(row => row.name);
  assert.ok(unregistered.length);
  const h = host(game);
  const payload = {campaign: 'c1', effects: [{kind: 'define', name: DRAFT.name, category: 'item', description: DRAFT.description},
    {kind: 'object', name: 'Your field camera', to: game.sheet.name, adopt: unregistered[0], definition: DRAFT.name, why: 'Registering carried gear.'}]};
  await h.bridge.prepare('apply', payload);
  await game.apply(payload.effects);
  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'You set the camera on the table beside the lease.'});
  const card = {type: 'custom', id: 'card-t1', customType: 'coc-mechanics', timestamp: '2026-09-22', data: {turn: delivery.turn, mechanics: delivery.mechanics}};
  const row = delivery.mechanics.find(item => item.kind === 'item' && item.definition === 'pending');
  assert.ok(row, 'the kernel drew the queued adoption pending');

  await until(() => h.entries.some(entry => entry.customType === CARD_PATCH), 'the host patched the waiting card');
  const patches = h.entries.filter(entry => entry.customType === CARD_PATCH);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].data.card, {}, 'the definition lane cannot know the card, so it names the definition');
  assert.equal(patches[0].data.source, 'object-details');
  assert.deepEqual(patches[0].data.patch, {definitions: {[DRAFT.name]: {definition: 'ready', object: publicDefinition(DRAFT)}}});
  // The older word still travels for one release, for a reader that predates §132.
  const legacy = h.entries.filter(entry => entry.customType === 'coc-object-details');
  assert.equal(legacy.length, 1);
  assert.deepEqual(legacy[0].data.objects.map(item => [item.name, item.definition]), [[DRAFT.name, 'ready']]);

  // The patch alone opens the row, with the player view and nothing else.
  const opened = drawn(card, patches).mechanics.find(item => item.receipt === row.receipt);
  assert.equal(opened.definition, 'ready');
  assert.deepEqual(opened.object, publicDefinition(DRAFT));
  assert.equal(JSON.stringify(opened).includes(DRAFT.basis), false);
  // Both words together draw the same card as either alone.
  assert.deepEqual(drawn(card, h.entries), drawn(card, patches));
  assert.deepEqual(drawn(card, legacy), drawn(card, patches));
  assert.equal(drawn(card, patches).definitions, undefined, 'the addressing map does not travel on to the renderer');
});

test('a dropped registration patches the fold closed again', async t => {
  const game = await table(t);
  const unregistered = (await game.call('mods.context')).unregistered_equipment.map(row => row.name);
  const failing = host(game, {runTask: async () => ({ok: false, code: 1, timedOut: false, ms: 1, stderr: 'boom', command: []})});
  const payload = {campaign: 'c1', effects: [{kind: 'define', name: DRAFT.name, category: 'item', description: DRAFT.description},
    {kind: 'object', name: 'Your field camera', to: game.sheet.name, adopt: unregistered[0], definition: DRAFT.name, why: 'Registering carried gear.'}]};
  await failing.bridge.prepare('apply', payload);
  await game.apply(payload.effects);
  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'You set the camera on the table.'});
  const card = {type: 'custom', id: 'card-t1', customType: 'coc-mechanics', timestamp: '2026-09-22', data: {turn: delivery.turn, mechanics: delivery.mechanics}};
  await game.call('table.player_input', {text: 'I head out.'});
  // The next resume regenerates it beside the turn (ready), then cannot land it and discards (none).
  const broken = {...game, call: async (method, params) => {
    if (method === 'table.apply') throw new Error('the deferred batch did not land');
    return game.call(method, params);
  }};
  const again = host(broken);
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  await until(() => again.entries.some(entry => entry.customType === CARD_PATCH), 'the regenerated details were patched in');
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  const patches = again.entries.filter(entry => entry.customType === CARD_PATCH);
  assert.deepEqual(patches.map(entry => entry.data.patch.definitions[DRAFT.name].definition), ['ready', 'none']);
  assert.equal(patches[1].data.patch.definitions[DRAFT.name].object, null, 'null deletes the view the first patch opened');
  const closed = drawn(card, patches).mechanics.find(item => item.definition_name === DRAFT.name);
  assert.equal(closed.definition, 'none');
  assert.equal(closed.object, undefined);
});

test('a prefetched usage for a held object patches the card that named it with what the sheet shows', async t => {
  const game = await table(t);
  const prior = process.env.PI_COC_MOD_PREFETCH_LIMIT;
  process.env.PI_COC_MOD_PREFETCH_LIMIT = '5';
  t.after(() => { if (prior === undefined) delete process.env.PI_COC_MOD_PREFETCH_LIMIT; else process.env.PI_COC_MOD_PREFETCH_LIMIT = prior; });
  await game.apply([{kind: 'object', name: 'Desk chair', definition: 'Chair frame', to: game.sheet.name},
    {kind: 'object', name: 'Scene chair', definition: 'Chair frame', to: 'here'}]);
  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'Two more wooden chairs: one by your desk, one by the door.'});
  const card = {type: 'custom', id: 'card-t1', customType: 'coc-mechanics', timestamp: '2026-09-22', data: {turn: delivery.turn, mechanics: delivery.mechanics}};
  assert.ok(delivery.mechanics.some(item => item.kind === 'item' && item.name === 'Desk chair'), 'the card names the held chair');
  const rows = [];
  const h = host(game, {record: row => { if (row.lane === 'usage-prefetch') rows.push(row); },
    runTask: async task => {
      await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(usage('Swing')));
      return {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
    }});
  h.pi.events.emit('coc:turn-committed', {campaign: 'c1', turn: delivery.turn});
  await until(() => rows.some(row => row.event === 'scan'), 'the prefetch scan finished');
  const landed = rows.filter(row => row.event !== 'scan' && row.ok && row.enabled && !row.negative).map(row => row.object).sort();
  assert.ok(landed.includes('Desk chair') && landed.includes('Scene chair'), `both chairs were prefetched: ${landed}`);

  const patches = h.entries.filter(entry => entry.customType === CARD_PATCH);
  const named = patches.flatMap(entry => Object.keys(entry.data.patch.objects ?? {}));
  assert.ok(named.includes('Desk chair'));
  assert.equal(named.includes('Scene chair'), false, 'the sheet shows no usage for an object nobody holds, so neither does the card');
  const desk = patches.find(entry => entry.data.patch.objects?.['Desk chair']);
  assert.equal(desk.data.source, 'usage-prefetch');
  assert.deepEqual(desk.data.card, {}, 'the prefetch knows the object, not the card, so the backend matches the row by name');
  const world = await game.world();
  const record = Object.values(world.objects.usages).find(value => value.name === 'Swing' && world.objects.instances[value.object_id]?.name === 'Desk chair');
  assert.ok(record, 'the proposal was accepted into the world');
  assert.deepEqual(desk.data.patch, {objects: {'Desk chair': {usages: {Swing: publicUsage(record)}}}});
  assert.deepEqual(publicUsage(record), {name: 'Swing', parameters: {skill: 'Fighting (Brawl)', damage: '1D6'}});

  // Through the backend: the row that named the chair carries the usage, and nothing the sheet hides.
  const chair = drawn(card, h.entries).mechanics.find(item => item.kind === 'item' && item.name === 'Desk chair');
  assert.deepEqual(chair.usages, {Swing: {name: 'Swing', parameters: {skill: 'Fighting (Brawl)', damage: '1D6'}}});
  for (const hidden of [record.basis, record.description, record.player_view.description])
    assert.equal(JSON.stringify(chair).includes(hidden), false);
  const scene = drawn(card, h.entries).mechanics.find(item => item.kind === 'item' && item.name === 'Scene chair');
  assert.equal(scene?.usages, undefined);
});
