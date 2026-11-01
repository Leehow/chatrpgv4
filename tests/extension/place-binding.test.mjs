/** §204.4: the host source-binding owner; controlled reference results, no model or gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlaceBindings, bindingExcerpts} from '../../extensions/kernel/place-binding.ts';

const original = excerpts => ({source_answer: {status: 'excerpts', authority: 'original-source-excerpts', excerpts}});
const deferred = () => {let resolve;const promise = new Promise(done => {resolve = done;});return {promise, resolve};};

test('only original excerpts bind; page and text bounds retain exact source characters', () => {
  assert.equal(bindingExcerpts({source_answer: {status: 'ready', authority: 'model', excerpts: [{page: 1, text: 'invented'}]}}), undefined);
  assert.equal(bindingExcerpts(original([{page: 0, text: 'bad'}, {page: 1.5, text: 'bad'}])), undefined);
  const text = '🌲'.repeat(1300);
  assert.deepEqual(bindingExcerpts(original([{page: 2, text}, {page: 2, text: 'more'}, {page: 3, text: 'three'},
    {page: 4, text: 'four'}, {page: 5, text: 'five'}, {page: 6, text: 'six'}])), {pages: [2, 3, 4, 5], excerpt: '🌲'.repeat(1200)});
});

test('a mint is looked up and bound after the source answers; starting never waits and a repeated receipt starts once', async () => {
  const source = deferred(), asked = deferred(), finished = deferred(), calls = [], queries = [], rows = [];
  const owner = new PlaceBindings();
  const deps = {campaign: 'c', turn: 3, moduleId: 'book', receipts: [{kind: 'move', established: 'table', to: 'north-house', to_label: 'Northern house'},
    {kind: 'move', to: 'old-house'}, {kind: 'clue', established: 'table', to: 'irrelevant'}],
    call: async (method, params) => {calls.push({method, params});return method === 'table.lookup'
      ? {entities: [{name: 'north-house', summary: 'The house beside the pond.'}]} : {bound: true};},
    reference: async (moduleId, params, signal) => {queries.push({moduleId, params, signal});asked.resolve();return source.promise;},
    record: row => {rows.push(row);finished.resolve();}};
  assert.equal(owner.start(deps), undefined);
  owner.start(deps);
  await asked.promise;
  assert.equal(queries.length, 1);
  assert.equal(calls.length, 1, 'no binding before the source finishes');
  assert.equal(queries[0].params.focus, 'Northern house');
  assert.match(queries[0].params.question, /The house beside the pond/);
  assert(queries[0].signal instanceof AbortSignal);
  source.resolve(original([{page: 2, text: 'A body lies in the northern house.'}, {page: 3, text: 'Its door opens onto the road.'}]));
  await finished.promise;
  assert.deepEqual(calls[1], {method: 'table.place.bind', params: {campaign: 'c', place: 'north-house', pages: [2, 3],
    excerpt: 'A body lies in the northern house.\n\nIts door opens onto the road.'}});
  assert.equal(rows[0].outcome, 'bound');
});

test('an absent, unverified or failing source leaves a committed place unchanged', async () => {
  for (const reference of [undefined, async () => undefined, async () => ({source_answer: {authority: 'model', status: 'excerpts'}}),
    async () => {throw Error('reader unavailable');}]) {
    const done = deferred(), calls = [], rows = [];
    new PlaceBindings().start({campaign: 'c', turn: 1, moduleId: 'book', receipts: [{kind: 'move', established: 'table', to: 'new-house'}],
      reference, call: async (method, params) => {calls.push({method, params});return {entities: []};},
      record: row => {rows.push(row);done.resolve();}});
    await done.promise;
    assert(!calls.some(call => call.method === 'table.place.bind'));
    assert(['unavailable', 'unbound'].includes(rows[0].outcome));
  }
});

test('the apply result carries receipt names; only their canonical committed bodies trigger a binding', async () => {
  const done = deferred(), calls = [], requested = [];
  new PlaceBindings().start({campaign: 'c', turn: 3, moduleId: 'book', receipts: ['t3-new-move'],
    call: async (method, params) => {
      calls.push({method, params});
      if (method === 'table.status') return {receipts: [{id: 't2-old-move', kind: 'move', established: 'table', to: 'old-house'},
        {id: 't3-new-move', kind: 'move', established: 'table', to: 'new-house', to_label: 'Northern house'}]};
      if (method === 'table.lookup') return {entities: [{name: 'new-house', summary: 'On the northern road.'}]};
      return {bound: true};
    },
    reference: async (_module, params) => {requested.push(params);return original([{page: 2, text: 'On the northern road.'}]);},
    record: () => done.resolve()});
  await done.promise;
  assert.deepEqual(calls[0], {method: 'table.status', params: {campaign: 'c', projection: 'receipts', expected_turn: 3}});
  assert.equal(requested.length, 1);
  assert.deepEqual(calls.filter(call => call.method === 'table.place.bind').map(call => call.params.place), ['new-house']);
});

test('places a place or move receipt newly registered (added) start a binding once each, like a mint', async () => {
  const asked = [], rows = [], done = deferred();
  const owner = new PlaceBindings();
  const deps = {campaign: 'c', turn: 2, moduleId: 'book', receipts: [{kind: 'place', action: 'establish', added: ['Inn', 'Inn / Room 203']},
    {kind: 'move', to: 'Inn / Room 203', added: ['Inn / Room 203']}, {kind: 'place', action: 'move', added: []}, {kind: 'clue', added: ['Not a place']}],
    call: async method => method === 'table.lookup' ? {entities: []} : {bound: true},
    reference: async (_module, params) => {asked.push(params.focus);return original([{page: 2, text: 'In the book.'}]);},
    record: row => {rows.push(row);if (rows.length === 2) done.resolve();}};
  owner.start(deps);owner.start(deps);
  await done.promise;
  assert.deepEqual(asked.sort(), ['Inn', 'Room 203'], 'the label is the place\'s own leaf; a repeat or a clue starts nothing');
});

test('a registered place that already cites the book\'s pages is not read again', async () => {
  const rows = [], done = deferred();let asked = 0;
  new PlaceBindings().start({campaign: 'c', turn: 2, moduleId: 'book', receipts: [{kind: 'place', added: ['Old house']}],
    call: async () => ({entities: [{name: 'Old house', summary: 'x', original_pages: [4]}]}),
    reference: async () => {asked++;return original([{page: 2, text: 'x'}]);},
    record: row => {rows.push(row);done.resolve();}});
  await done.promise;
  assert.equal(asked, 0);assert.deepEqual([rows[0].outcome, rows[0].reason], ['skipped', 'already_paged']);
});
