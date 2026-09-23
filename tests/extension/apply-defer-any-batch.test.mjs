/**
 * Contract §129.4: a definition never holds an apply, whatever else the batch carries.
 *
 * Live evidence (2026-09-23, installed 67a281c3e, the-haunting): turn 1's apply carried four clues, cash,
 * a handout and a `define` + `object` placement for the house keys. Only define/adopt batches were
 * deferred, so this one ran its creator child in the foreground and the tool call returned after 47.4 s,
 * of which admission was 3.0 s. The player waited 44 s for nothing they could see.
 *
 * Everything here is real except the Mod child: the Mod host's `prepare`/`after`, the kernel (built from
 * source), its apply staging, the mechanics projection and the resume.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {publicDefinition} from '../../kernel-ts/mods/public-definition.ts';
import {table, usage} from './object-usages-fixture.mjs';
import {waitFor} from './wait.mjs';

const until = (predicate, label) => waitFor(predicate, {label});

const DRAFT = {name: 'Field camera', category: 'item', description: 'A folding bellows camera.', basis: 'Carried by the investigator.',
  parameters: {charges: 8, effects: []}, traits: [{name: 'weight', value: 2, unit: 'lb', basis: 'Fixture.'}],
  player_view: {description: 'A folding bellows camera with a scratched lens cap.', fields: ['charges'], traits: ['weight']}};
const PLACED = 'Your field camera';

const ok = {ok: true, code: 0, timedOut: false, ms: 1, stderr: '', command: []};
const boom = {ok: false, code: 1, timedOut: false, ms: 1, stderr: 'boom', command: []};

function host(game, runTask) {
  const entries = [], tasks = [];
  const pi = {events: new EventEmitter(), on: () => undefined,
    appendEntry: (customType, data) => entries.push({type: 'custom', id: `entry-${entries.length}`, customType, data})};
  let bridge;
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  // The kernel extension mints call ids in the open turn; these stay clear of the fixture's own ordinals.
  let minted = 50;
  const self = {turn: 1};
  // Through JSON and the kernel client's error type, as the RPC bridge delivers both.
  const call = async (method, params) => {
    try { return await game.call(method, JSON.parse(JSON.stringify(params))); }
    catch (error) {
      if (typeof error?.code !== 'string') throw error;
      throw new KernelError({code: error.code, message: error.message, fix: error.fix, details: error.details});
    }
  };
  pi.events.emit('coc:kernel-bridge', {call,
    mintCallId: () => `t${self.turn}-c${++minted}`,
    runtime: {
      async runTask(task) {
        const request = JSON.parse(await readFile(join(task.request.cwd, 'request.json'), 'utf8'));
        tasks.push(request.role);
        return runTask(task, request);
      },
      async check() { return {ok: true}; },
    }});
  const details = () => entries.filter(entry => entry.customType === 'coc-object-details')
    .map(entry => entry.data.objects.map(item => [item.name, item.definition]));
  return Object.assign(self, {bridge, entries, tasks, details});
}

/** A creator child held until `release()`; it writes DRAFT when let go. */
function held() {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let finished = 0;
  const runTask = async (task, request) => {
    if (request.role === 'usage') {
      await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(usage('swing')));
      return ok;
    }
    await gate;
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(DRAFT));
    finished++;
    return ok;
  };
  return {runTask, release: () => release(), finished: () => finished};
}

/** The shape of the live turn 1: clues and cash beside a new object's definition and its placement. */
const mixed = game => ({campaign: 'c1', effects: [
  {kind: 'clue', clue: 'clue-knott-commission', how: 'Knott lays the contract out.'},
  {kind: 'cash', delta: 20, source: 'found', why: "Knott's retainer."},
  {kind: 'define', name: DRAFT.name, category: 'item', description: DRAFT.description},
  {kind: 'object', name: PLACED, definition: DRAFT.name, to: game.sheet.name, why: 'Knott hands over the camera.'}]});

const instanceOf = world => Object.values(world.objects.instances).find(item => item.name === PLACED);

test('a mixed batch returns without its creator, places the object against a placeholder, and the next resume completes it in place', async t => {
  const game = await table(t);
  const child = held();
  const h = host(game, child.runTask);
  const payload = mixed(game);
  // The creator is held for the whole of prepare and apply: neither may wait for it.
  await h.bridge.prepare('apply', payload);
  assert.equal(child.finished(), 0);
  assert.equal(typeof payload.effects[2]._queued, 'string', 'the define is queued, not generated inside the call');
  assert.equal(payload.effects[2]._definition, undefined);
  const applied = await game.apply(payload.effects);
  assert.equal(applied.receipts.length, 4);

  const placed = await game.world();
  const item = instanceOf(placed), stand = placed.objects.definitions[item.definition];
  assert.ok(item, 'the placement resolved in the same batch as its definition');
  assert.equal(stand.placeholder, true);
  assert.equal(stand.name, DRAFT.name);
  assert.deepEqual(stand.parameters, {}, 'nothing about the object is invented: no parameters until they are generated');
  assert.deepEqual(stand.player_view, {description: '', fields: []}, "the Keeper's request wording is not shown to the player");
  assert.equal(item.state.charges, null);
  const queued = Object.values(placed.mods.state).flatMap(state => Object.values(state.queued ?? {}));
  assert.deepEqual(queued.map(entry => [entry.name, entry.adopt]), [[DRAFT.name, null]], 'the registration is still marked queued');
  const receipts = JSON.parse(await readFile(join(game.directory, 'turn.json'), 'utf8')).receipts;
  assert.equal(receipts.find(receipt => receipt.kind === 'definition').queued, true, 'the receipt says the registration is queued');
  assert.match((await game.call('table.look', {focus: 'object', name: PLACED})).pending, /still being prepared/);
  // A usage prepared now would bind to parameters about to be replaced.
  await assert.rejects(game.call('mods.job', {role: 'usage', input: {object: PLACED, name: 'swing', description: 'Swing it.'}}),
    error => error.details?.reason === 'definition_pending');

  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'Knott slides the contract and a camera across the desk.'});
  const row = delivery.mechanics.find(entry => entry.kind === 'item' && entry.name === PLACED);
  assert.equal(row.definition, 'pending');
  assert.equal(row.definition_name, DRAFT.name);
  assert.equal(row.object, undefined);
  assert.ok(delivery.mechanics.some(entry => entry.kind === 'clue') && delivery.mechanics.some(entry => entry.kind === 'cash'));

  child.release();
  await until(() => h.details().length === 1, 'the landed details were announced');
  assert.deepEqual(h.details(), [[[DRAFT.name, 'ready']]]);
  assert.deepEqual(h.entries.at(-1).data.objects[0].object, publicDefinition(DRAFT));

  await game.call('table.player_input', {text: 'I check the camera over.'});
  h.turn = 2;
  await h.bridge.after('player_input', {campaign: 'c1'});
  const world = await game.world(), after = instanceOf(world), definition = world.objects.definitions[after.definition];
  assert.equal(after.id, item.id, 'the instance keeps its identity');
  assert.equal(after.definition, item.definition, 'the generated definition took the placeholder id');
  assert.equal(definition.placeholder, undefined);
  assert.deepEqual(definition.parameters, DRAFT.parameters);
  assert.equal(after.state.charges, 8, 'what the placement could not read from the placeholder is filled in');
  assert.deepEqual(Object.values(world.mods.state).flatMap(state => Object.values(state.queued ?? {})), []);
  const sheet = JSON.parse(await readFile(game.sheetPath, 'utf8'));
  assert.equal(sheet.equipment.find(entry => entry.name === PLACED)?.description, DRAFT.player_view.description,
    'the sheet mirrors the definition that replaced the placeholder');
  const turn = JSON.parse(await readFile(join(game.directory, 'turn.json'), 'utf8'));
  assert.equal(turn.receipts.find(receipt => receipt.kind === 'definition')?.replaced_placeholder, true);
  assert.deepEqual((await game.call('table.look', {focus: 'object', name: PLACED})).definition.parameters, DRAFT.parameters);
  assert.deepEqual(h.tasks, ['create'], 'one creator child, run beside the turn');
  assert.equal(h.details().length, 1, 'a definition already announced is not announced again');
});

test('a generation that fails leaves the placement standing, and a dropped registration closes its card', async t => {
  const game = await table(t);
  let attempts = 0;
  const h = host(game, async () => { attempts++; return boom; });
  const payload = mixed(game);
  await h.bridge.prepare('apply', payload);
  await game.apply(payload.effects);
  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'Knott slides the contract and a camera across the desk.'});
  assert.equal(delivery.mechanics.find(entry => entry.kind === 'item' && entry.name === PLACED).definition, 'pending');
  await until(() => attempts === 1, 'the creator ran beside the turn');
  await game.call('table.player_input', {text: 'I check the camera over.'});
  // The resume finds it unfinished and starts it beside the turn again; the object never left the world.
  await h.bridge.after('player_input', {campaign: 'c1'});
  await until(() => attempts === 2, 'the unfinished registration was started again');
  assert.deepEqual(h.details(), [], 'nothing is announced ready that never landed');
  const standing = instanceOf(await game.world());
  assert.equal((await game.world()).objects.definitions[standing.definition].placeholder, true);

  // Now it lands, but the resume that writes it cannot: the markers are dropped and the card is told.
  const failing = {...game, call: async (method, params) => {
    if (method === 'table.apply') throw new Error('the deferred batch did not land');
    return game.call(method, params);
  }};
  const again = host(failing, async task => {
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(DRAFT));
    return ok;
  });
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  await until(() => again.details().length === 1, 'the regenerated details were announced');
  await again.bridge.prepare('resolve', {campaign: 'c1'});
  assert.deepEqual(again.details(), [[[DRAFT.name, 'ready']], [[DRAFT.name, 'none']]]);

  const world = await game.world(), item = instanceOf(world);
  assert.equal(item.id, standing.id, 'the placement still stands');
  assert.equal(world.objects.definitions[item.definition].placeholder, true);
  // A later card naming the object says its preparation was dropped instead of waiting for good.
  await game.apply([{kind: 'object', name: PLACED, from: game.sheet.name, to: 'here', why: 'You set the camera down.'}]);
  const later = await game.call('table.narrate', {call_id: game.next(), text: 'You set the camera down on the desk.'});
  const row = later.mechanics.find(entry => entry.kind === 'item' && entry.name === PLACED);
  assert.equal(row.definition, 'none');
  assert.equal(row.definition_name, undefined);
});

test('a usage batch completes the placeholder its object stands on before the usage is prepared', async t => {
  const game = await table(t);
  const child = held();
  const h = host(game, child.runTask);
  const payload = mixed(game);
  await h.bridge.prepare('apply', payload);
  await game.apply(payload.effects);
  // Same turn: the player swings the camera. The usage path waits (§26); it waits for the definition first.
  const swing = {campaign: 'c1', effects: [{kind: 'usage', object: PLACED, name: 'swing', description: 'Swing the camera by its strap.'}]};
  const preparing = h.bridge.prepare('apply', swing);
  child.release();
  await preparing;
  const world = await game.world(), item = instanceOf(world);
  assert.equal(world.objects.definitions[item.definition].placeholder, undefined, 'the definition landed before the usage');
  assert.equal(item.state.charges, 8);
  assert.equal(swing.effects[0]._usage.usage.name, 'swing');
  await game.apply(swing.effects);
  assert.deepEqual(h.tasks, ['create', 'usage']);
  assert.deepEqual(h.details(), [[[DRAFT.name, 'ready']]], 'announced once, whichever path wrote it');
});

test('a definition whose job is already accepted attaches in the call instead of standing on a placeholder', async t => {
  const game = await table(t);
  const h = host(game, async () => { throw new Error('no child may run for an accepted definition'); });
  // The fixture accepted "Chair frame" on turn 0; defining it again reuses that definition.
  const define = {kind: 'define', name: 'Chair frame', category: 'item', description: 'A solid wooden chair.'};
  const payload = {campaign: 'c1', effects: [{kind: 'cash', delta: 5, source: 'found', why: 'Coins under the cushion.'}, define,
    {kind: 'object', name: 'Spare chair', definition: 'Chair frame', to: game.sheet.name, why: 'A second chair.'}]};
  await h.bridge.prepare('apply', payload);
  assert.equal(define._queued, undefined);
  assert.equal(define._definition.name, 'Chair frame');
  await game.apply(payload.effects);
  const world = await game.world();
  const spare = Object.values(world.objects.instances).find(item => item.name === 'Spare chair');
  assert.equal(world.objects.definitions[spare.definition].placeholder, undefined);
  assert.equal(Object.values(world.objects.definitions).filter(value => value.name === 'Chair frame').length, 1);
  assert.deepEqual(h.tasks, []);
});
