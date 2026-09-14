import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundled = await build({
  stdin: {contents: `export {directorOffer, OFFER_ORDER} from './kernel-ts/read/offer.ts';
export {directorAdoption, offerLedger} from './kernel-ts/write/text.ts';
export {continuationRows} from './kernel-ts/read/pressures.ts';`, resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const {directorOffer, OFFER_ORDER, directorAdoption, offerLedger, continuationRows} = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const crowded = () => ({
  present: [{name: 'Witness', wants: 'leave safely'}],
  where: {exits: [{to: 'Library', material: 'ready'}]},
  pressures: [{kind: 'clock', name: 'Closing time'}],
  previous: {receipts: [{kind: 'roll', form: 'check', passed: false, actor_label: 'Investigator', skill: 'Listen'}]},
});
const clock = (threat, id) => ({threat, clock: id, state: '0/4', next: 'A visible sign'});
const clockOffers = clocks => directorOffer('PRESSURE', {present: [], where: {}, pressures: [], pacing: {threat_clocks: clocks}});
const adoption = (offer, receipts) => directorAdoption({}, {capsule: {director: {beat: 'PRESSURE', offer}}, receipts}, {}, 'narrate');

for (const beat of [...Object.keys(OFFER_ORDER), 'UNKNOWN']) {
  test(`a crowded ${beat} offer retains the previous consequence`, () => {
    const offer = directorOffer(beat, crowded());
    assert.equal(offer.length, 3);
    assert.equal(offer.filter(row => row.kind === 'consequence').length, 1);
    assert.ok(offer.every(row => Array.from(row.line).length <= 120));
  });
}

test('empty and non-consequence histories do not invent a consequence', () => {
  const source = crowded();
  for (const receipts of [[], [{kind: 'roll', form: 'dice', passed: false}], [{kind: 'roll', form: 'check', passed: true}]]) {
    source.previous = {receipts};
    assert.ok(directorOffer('ADVANCE', source).every(row => row.kind !== 'consequence'));
  }
  assert.deepEqual(directorOffer('ADVANCE', {present: [], where: {}, pressures: []}), []);
});

test('a previous NPC stance also retains a seat', () => {
  const source = crowded();
  source.previous = {receipts: [{kind: 'npc', name: 'Witness', stance: 'hostile', why: 'the threat'}]};
  assert.ok(directorOffer('ADVANCE', source).some(row => row.kind === 'consequence' && row.who === 'Witness'));
});

test('clock offers carry their exact source target', () => {
  const offer = clockOffers([clock('front-one', 'clock-a'), clock('front-one', 'clock-b')]);
  assert.deepEqual(offer.map(row => row.target), [{threat: 'front-one', clock: 'clock-a'}, {threat: 'front-one', clock: 'clock-b'}]);
});

test('one tick counts only its selected clock, once', () => {
  const offer = clockOffers([clock('front-one', 'clock-a'), clock('front-one', 'clock-b')]);
  const tick = {id: 'tick-1', kind: 'threat', threat: 'front-one', clock: 'clock-a'};
  assert.deepEqual(adoption([...offer, offer[0]], [tick, {...tick, id: 'tick-2'}]).offer_taken, ['pressure:front-one/clock-a']);
});

test('target matching is normalized, exact and independent of display text', () => {
  const offer = clockOffers([clock('front-one', 'clock-a'), clock('front-one-extra', 'clock-a')]);
  offer[0].line = 'A completely different clipped display line';
  offer[1].line = 'front-one: a misleading prefix';
  assert.deepEqual(adoption(offer, [{kind: 'threat', threat: 'FRONT-ONE', clock: 'CLOCK-A'}]).offer_taken, ['pressure:front-one/clock-a']);
  assert.deepEqual(adoption(offer, [{kind: 'threat', threat: 'front-one', clock: 'clock-a-extra'}]).offer_taken, []);
});

test('historical unstructured pressure offers remain readable without prose-based attribution', () => {
  const offer = [{kind: 'pressure', line: 'front-one (0/4): A visible sign', from: 'mods.pacing'}];
  assert.deepEqual(adoption(offer, [{kind: 'threat', threat: 'front-one', clock: 'clock-a'}]).offer_taken, []);
});

test('selected offers and the all-material ledger retain different scopes and namespaces', () => {
  const clocks = [clock('front-one', 'clock-a'), clock('front-one', 'clock-b')];
  const offer = clockOffers(clocks).slice(0, 1);
  const receipts = [{kind: 'threat', threat: 'FRONT-ONE', clock: 'CLOCK-B'}];
  assert.deepEqual(adoption(offer, receipts).offer_taken, []);
  const ledger = offerLedger({capsule: {director: {beat: 'PRESSURE', offer}, mods: {pacing: {threat_clocks: clocks}}}, receipts});
  assert.deepEqual(ledger.offered, ['clock:front-one/clock-a', 'clock:front-one/clock-b']);
  assert.deepEqual(ledger.taken, ['clock:front-one/clock-b']);
});

test('the Director selects a continuation from canonical obligations without a rule-pressure copy', () => {
  const obligations = continuationRows([{decision: 'pushed-roll', needs: ['push']}]);
  assert.deepEqual(obligations, [{kind: 'continuation', name: 'pushed-roll', who: 'player', state: 'left by last turn, unanswered', cue: 'needs action.push'}]);
  const offer = directorOffer('PRESSURE', {present: [], where: {}, pressures: [], obligations});
  assert.equal(offer.length, 1);
  assert.equal(offer[0].kind, 'pressure');
  assert.equal(offer[0].from, 'obligations');
  assert.ok(offer[0].line.includes('pushed-roll'));
});

test('basic threats remain usable without pacing or thread Mods', () => {
  const source = {present: [], where: {}, pressures: [{kind: 'threat', name: 'front-one', state: '0/4'}]};
  const offer = directorOffer('PRESSURE', source);
  assert.equal(offer.length, 1);
  assert.equal(offer[0].from, 'pressures');
});
