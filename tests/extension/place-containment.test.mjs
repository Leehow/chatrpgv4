/** §204 through the current kernel: nested/sibling moves, destination identity, and exact-source binding. No models or table acceptance. */
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {buildRosterBook, CAMPAIGN, CLERK, HOUSE, OPENING_TWO, CAPTAIN} from './roster-book.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
let temporary, api;
before(async () => {
  temporary = await mkdtemp(join(ROOT, '.tmp/place-containment-'));
  await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {bindPlace} from './kernel-ts/read/place-bindings.ts';",
    resolveDir: ROOT, sourcefile: 'place-containment-entry.ts'}, outfile: join(temporary, 'api.mjs'), bundle: true,
    packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
  api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
});
after(async () => {if (temporary) await rm(temporary, {recursive: true, force: true});});

async function table(t) {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: 'place-containment',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const raw = (method, params = {}) => runtime.handlers[method](params);
  await buildRosterBook(raw, home, {open: true});
  const call = (method, params = {}) => raw(method, {campaign: CAMPAIGN, ...params});
  let ordinal = 0;
  await call('table.narrate', {call_id: 't0-c1', text: 'The captain hands you the orders.'});
  await call('table.player_input', {text: 'I visit the farm and its houses.'});
  const move = (to, establish, extra = {}) => call('table.apply', {call_id: `t1-c${++ordinal}`, effects: [{kind: 'move', to,
    ...(establish ? {establish} : {}), ...extra}]});
  const mint = async (to, within) => {
    const result = await move(to, {summary: `The ${to}.`, ...(within !== undefined ? {within} : {})}, {via: 'Walk there.'});
    const receipt = (await call('table.status', {projection: 'receipts'})).receipts.find(receipt => result.receipts.includes(receipt.id) && receipt.kind === 'move');
    assert(receipt?.established === 'table', JSON.stringify(result));
    return receipt.to;
  };
  const world = () => readFile(join(home, '.coc/campaigns', CAMPAIGN, 'world.json'), 'utf8');
  return {home, call, move, mint, world};
}

test('houses and rooms carry containment; sibling travel is one move without a detour through the farm', async t => {
  const game = await table(t);
  const farm = await game.mint('Farmland', null), first = await game.mint('First house'), room = await game.mint('Back room');
  let capsule = await game.call('table.capsule');
  assert.equal(capsule.where.within.name, first, 'a room lies in the active house by default');
  await game.move(farm);
  const second = await game.mint('Northern house');
  await game.move(farm);
  await game.move(room);
  const result = await game.move(second);
  const moves = (await game.call('table.status', {projection: 'receipts'})).receipts.filter(receipt => result.receipts.includes(receipt.id) && receipt.kind === 'move');
  assert.equal(moves.length, 1);
  assert.deepEqual([moves[0].from, moves[0].to, moves[0].within], [room, second, farm]);
  capsule = await game.call('table.capsule');
  assert.equal(capsule.where.within.name, farm);
  assert(capsule.where.within.places.some(place => place.name === first));
  const lookup = await game.call('table.lookup', {kind: 'module', query: room, expected_kind: 'scene'});
  assert(lookup.entities[0].inside.length >= 2);
});

test('binding changes no world state, persists exact excerpts, and the first binding stands', async t => {
  const game = await table(t), place = await game.mint('Northern house');
  const before = await game.world();
  const text = 'The house at the north end of the farm. The family is asleep inside.';
  const result = await game.call('table.place.bind', {place, pages: [2], excerpt: text});
  assert.equal(result.bound, true);
  assert.equal(await game.world(), before, 'background provenance cannot stale the open turn');
  const book = (await game.call('table.capsule')).where.book;
  assert.deepEqual(book.pages, [2]);assert.equal(book.text, text);
  assert.equal(book.source_refs[0].pdf_index, 1);
  const repeated = await game.call('table.place.bind', {place, pages: [1], excerpt: 'Different text.'});
  assert.deepEqual([repeated.bound, repeated.reason, repeated.pages], [false, 'already_bound', [2]]);
  await game.move('A different room', {summary: 'A room off the passage.'}, {via: 'Through the door.'});
});

test('concurrent bindings preserve both places and reject pages outside the bound book', async t => {
  const game = await table(t), first = await game.mint('First room'), second = await game.mint('Second room');
  await Promise.all([game.call('table.place.bind', {place: first, pages: [1], excerpt: 'Chapter Two.'}),
    game.call('table.place.bind', {place: second, pages: [2], excerpt: 'The house at the north end of the farm.'})]);
  const stored = JSON.parse(await readFile(join(game.home, '.coc/campaigns', CAMPAIGN, 'place-bindings.json'), 'utf8'));
  assert.equal(Object.keys(stored.places).length, 2);
  await assert.rejects(game.call('table.place.bind', {place: second, pages: [4], excerpt: 'Outside the three-page book.'}), error => error.code === 'invalid_params');
});

test('a person destination resolves to their registered place and never establishes a place under their name', async t => {
  const game = await table(t);
  const lookup = await game.call('table.lookup', {kind: 'module', query: CLERK, expected_kind: 'scene'});
  assert.equal(lookup.entities.length, 1);
  const target = lookup.entities[0];
  assert(target.reached_through.person);
  const result = await game.move(CLERK, undefined, {via: 'Across to the archive.'});
  const receipt = (await game.call('table.status', {projection: 'receipts'})).receipts.find(row => result.receipts.includes(row.id));
  assert.equal(receipt.to, target.name);assert.equal(receipt.person, target.reached_through.person);
  await assert.rejects(game.move(CAPTAIN, {summary: 'A person turned into a room.'}, {via: 'Across the office.'}),
    error => error.details?.reason === 'person_not_place');
});

test('an authored road is reachable in its reverse direction without an improvised route or a trail entry', async t => {
  const game = await table(t);
  await game.move(HOUSE, undefined, {via: 'Walk to the northern house.'});
  const result = await game.move(OPENING_TWO);
  const receipt = (await game.call('table.status', {projection: 'receipts'})).receipts.find(row => result.receipts.includes(row.id));
  assert.equal(receipt.return_route, true);
  assert.equal(receipt.improvised, undefined);
});

test('binding owners serialize the read and write across the actual file lock', async t => {
  const home = await mkdtemp(join(temporary, 'locking-'));
  const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: 'binding-lock', locks: api.nativeAdvisoryLocks()});
  t.after(() => context.git.close?.());
  const nodes = ['one', 'two'].map(name => ({node_id: `scene-${name}`, node_kind: 'scene', name}));
  const graph = new api.ModuleGraph('book', {nodes, relations: [], claims: []}, '', {});
  for (const node of nodes) graph.tableEntityNames.set(node.node_id, node.name);
  let releaseFirst, reachedFirst, attemptedSecond, reachedSecond;
  const held = new Promise(resolve => {releaseFirst = resolve;}), firstRead = new Promise(resolve => {reachedFirst = resolve;});
  const secondAcquire = new Promise(resolve => {attemptedSecond = resolve;}), secondRead = new Promise(resolve => {reachedSecond = resolve;});
  let reads = 0, acquires = 0;
  const owned = {...context, locks: {acquire: async (...args) => {if (++acquires === 2) attemptedSecond('acquire');return context.locks.acquire(...args);}},
    snapshots: {...context.snapshots, pathExists: async path => {
      const exists = await context.snapshots.pathExists(path);
      if (path.endsWith('place-bindings.json')) {
        if (++reads === 1) {reachedFirst();await held;}
        else reachedSecond('read');
      }
      return exists;
    }}};
  const first = api.bindPlace(owned, 'c', graph, 3, {place: 'one', pages: [1], excerpt: 'One.'});
  await firstRead;
  const second = api.bindPlace(owned, 'c', graph, 3, {place: 'two', pages: [2], excerpt: 'Two.'});
  try {
    assert.equal(await Promise.race([secondAcquire, secondRead]), 'acquire', 'a second owner must reach the lock before reading the ledger');
    assert.equal(reads, 1, 'the first read holds the write; the next owner cannot read stale data');
  } finally {releaseFirst();await Promise.allSettled([first, second]);}
  const stored = JSON.parse(await readFile(join(home, '.coc/campaigns/c/place-bindings.json'), 'utf8'));
  assert.equal(Object.keys(stored.places).length, 2);
});
