// SL-97 phase 2a: the analysis and holdout helpers on synthetic rows. No retained evidence is read here.
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {armTable, batchClass, mixWeights, naturalShare, readRow, recombine, wilsonLower, wilsonUpper} from './sl97b-analyze.mjs';
import {holdout} from './sl97b-holdout.mjs';

test('batch classes come from the closed effect kinds only', () => {
  assert.equal(batchClass(['apply time: minutes=5']), 'time');
  assert.equal(batchClass(['apply move: to="x"', 'apply time: minutes=5']), 'move');
  assert.equal(batchClass(['apply clue: clue="a"', 'apply handout: name="b"', 'apply time: minutes=5']), 'clue');
  assert.equal(batchClass(['apply move: to="x"', 'apply clue: clue="a"']), 'other');
  assert.equal(batchClass(['resolve (roll the dice for an action): intent="social"']), 'resolve');
});

test('a row reads as the product reads it (max) or by admitting mass (sum, single)', () => {
  const row = {route: 'typed', jev: 'entailed', confidence: 0.4, line_admit_p: [0.97, 0.9], design: 'v2',
    lines_v2: [{single_admit: 0.2}, {single_admit: 0.99}]};
  assert.deepEqual(readRow(row, 'max'), {admit: true, confidence: 0.4, label: 'entailed'});
  assert.deepEqual(readRow(row, 'sum'), {admit: true, confidence: 0.8, label: 'entailed'});
  assert.deepEqual(readRow(row, 'single'), {admit: false, confidence: 0.6, label: null});
  assert.equal(readRow({...row, route: 'fallback'}, 'sum'), null);
  assert.equal(readRow({...row, line_admit_p: [0.9, null]}, 'sum'), null);
});

test('exploratory re-readings recombine stored 2a.3 answers without a call', () => {
  const line = {role: {investigator_act: 1, world_response: 0, time_passing: 0}, choice: {chosen: 0.9, routine_step: 0.05, keeper_choice: 0.05, unclear: 0},
    result: {answers_player: 1, world_on_its_own: 0, needs_unchosen_act: 0, unclear: 0}, span: {activity_time: 1, imposed_time: 0, unchosen_time: 0, unclear: 0},
    target: {addressed: 1, no_target: 0, not_addressed: 0}, gate: {no_obstacle: 1, player_takes_it_on: 0, skips_obstacle: 0}, order: {in_step: 0.3, ahead_of_plan: 0.7}};
  assert.equal(recombine(line, 'no_order'), 0.95);
  assert.equal(recombine(line, 'order_on_acts'), 0.3);
  // On a world response, order_on_acts leaves the line alone.
  assert.equal(recombine({...line, role: {investigator_act: 0, world_response: 1, time_passing: 0}}, 'order_on_acts'), 1);
  assert.equal(recombine({...line, order: undefined}, 'no_order'), null);
  assert.deepEqual(readRow({route: 'typed', jev: 'authorized', lines_v2: [line]}, 'order_on_acts'), {admit: false, confidence: 0.4, label: null});
});

test('false admits are settled admits the lane refused, counted per threshold and class', () => {
  const value = (id, lane, admit, confidence, cls = 'time') => ({id, lane, cls, read: {admit, confidence, label: null}, jev_ms: 300});
  const cases = [value('a', 'entailed', true, 0.95), value('b', 'not_authorized', true, 0.9), value('c', 'not_authorized', false, 0.95),
    value('d', 'authorized', false, 0.6), value('e', 'review_pending', true, 0.99)];
  const table = armTable(cases, mixWeights({entailed: 1, not_authorized: 2, authorized: 1}, {entailed: 10, not_authorized: 2, authorized: 10}), {time: 0.1});
  assert.equal(table.labelled, 4);
  assert.deepEqual(table.pending.map(row => row.id), ['e']);
  const at = threshold => table.by_threshold.find(row => row.threshold === threshold);
  assert.deepEqual([at(0).settled_admits, at(0).false_admits, at(0).false_refusals], [2, 1, 1]);
  assert.deepEqual([at(0.95).settled_admits, at(0.95).false_admits, at(0.95).decided], [1, 0, 2]);
  const time = at(0).per_class.time;
  assert.deepEqual([time.lane_refusals, time.settle_given_refuse, time.settle_given_admit], [2, 0.5, 0.5]);
  assert.equal(time.false_admit_share_class_natural, 0.1);
});

test('the natural share and the Wilson bounds', () => {
  assert.ok(Math.abs(naturalShare(0.1, 0.5, 0.5) - 0.1) < 1e-12);
  assert.equal(naturalShare(0.1, 0, 0.5), 0);
  assert.equal(naturalShare(null, 0, 0.5), null);
  assert.equal(wilsonLower(0, 20), 0);
  assert.ok(wilsonUpper(0, 20) > 0.15 && wilsonUpper(0, 20) < 0.17);
  assert.ok(wilsonLower(20, 20) > 0.83);
});

test('the holdout is disjoint, lane-labelled, cash-free, stratified and seeded', () => {
  const make = (id, verdict, line, extra = {}) => ({id, verb: 'apply', lane: {verdict}, kinds: [], input: {proposal: [line]}, ...extra});
  const cases = [
    ...Array.from({length: 6}, (_, index) => make(`t${index}`, 'entailed', 'apply time: minutes=5')),
    ...Array.from({length: 4}, (_, index) => make(`r${index}`, 'not_authorized', 'apply time: minutes=5')),
    make('pending', 'review_pending', 'apply time: minutes=5'), make('none', null, 'apply time: minutes=5'),
    make('cash', 'not_authorized', 'apply time: minutes=5', {kinds: ['cash']}), make('used', 'not_authorized', 'apply time: minutes=5'),
    make('m0', 'authorized', 'apply move: to="x"'), {...make('res', 'authorized', 'resolve (roll the dice for an action): x'), verb: 'resolve'},
  ];
  const picked = holdout(cases, new Set(['used']), {classes: ['time', 'move'], refusals: 3, admits: 2, seed: 2});
  const ids = picked.map(value => value.id);
  assert.equal(picked.filter(value => value.lane.verdict === 'not_authorized').length, 3);
  assert.equal(picked.filter(value => value.lane.verdict === 'entailed').length, 2);
  assert.ok(ids.includes('m0'));
  for (const id of ['pending', 'none', 'cash', 'used', 'res']) assert.ok(!ids.includes(id), id);
  assert.deepEqual(holdout(cases, new Set(['used']), {classes: ['time', 'move'], refusals: 3, admits: 2, seed: 2}).map(value => value.id), ids);
});
