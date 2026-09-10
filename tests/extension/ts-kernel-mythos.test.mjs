/**
 * Cthulhu Mythos tracking, on the kernel that ships (Keeper Rulebook ch.8, p.167/p.179).
 *
 * These cases came from a suite that asserted the same arithmetic against the retired Python
 * implementation, where they could not fail for any reason the product cares about. The rule
 * citations are the point: a first encounter is +5 CM and later ones +1 (p.167), maximum Sanity is
 * 99 - CM (p.167 F9) with current Sanity clamped down to it, and the believer bomb (p.179 F3)
 * costs Sanity equal to current CM first-hand while a tome costs none.
 */
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-mythos-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: "export {becomeBeliever, gainMythos, maxSanFor} from './kernel-ts/magic/mythos.ts';",
  resolveDir: ROOT, loader: 'ts', sourcefile: 'mythos.ts'},
  outfile: join(temporary, 'mythos.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node22',
  packages: 'external', logLevel: 'silent'});
const {becomeBeliever, gainMythos, maxSanFor} = await import(pathToFileURL(join(temporary, 'mythos.mjs')).href);

test('maximum Sanity is 99 minus Cthulhu Mythos, and never negative (p.167 F9)', () => {
  assert.equal(maxSanFor(0), 99);
  assert.equal(maxSanFor(10), 89);
  assert.equal(maxSanFor(50), 49);
  assert.equal(maxSanFor(100), 0);
  assert.equal(maxSanFor(150), 0);
});

test('a first Mythos encounter grants 5 and lowers the ceiling with it (p.167)', () => {
  const state = {cm_value: 0, current_san: 70, max_san: 99};
  const event = gainMythos(state, {isFirst: true});
  assert.equal(state.cm_value, 5);
  assert.equal(state.max_san, 94);
  assert.equal(event.cm_gain, 5);
  assert.equal(event.is_first, true);
});

test('current Sanity is clamped to the new ceiling, and left alone below it', () => {
  const atTheCeiling = {cm_value: 0, current_san: 99, max_san: 99};
  const clamped = gainMythos(atTheCeiling, {isFirst: true});
  assert.equal(atTheCeiling.current_san, 94);
  assert.equal(clamped.san_clamped, 5);

  const below = {cm_value: 0, current_san: 50, max_san: 99};
  const untouched = gainMythos(below, {isFirst: true});
  assert.equal(below.current_san, 50);
  assert.equal(untouched.san_clamped, 0);
});

test('a later encounter grants one, and a named amount overrides both (p.167)', () => {
  const later = {cm_value: 5, current_san: 60, max_san: 94};
  assert.equal(gainMythos(later, {isFirst: false}).cm_gain, 1);
  assert.equal(later.cm_value, 6);
  assert.equal(later.max_san, 93);

  const named = {cm_value: 10, current_san: 60, max_san: 89};
  assert.equal(gainMythos(named, {amount: 7}).cm_gain, 7);
  assert.equal(named.cm_value, 17);
  assert.equal(named.max_san, 82);

  const unrecorded = {current_san: 70};
  gainMythos(unrecorded, {isFirst: true});
  assert.equal(unrecorded.cm_value, 5);
});

test('the believer bomb costs Sanity equal to Mythos first-hand, and nothing from a tome (p.179)', () => {
  const firstHand = {cm_value: 10, current_san: 70, max_san: 89};
  const bomb = becomeBeliever(firstHand, {source: 'first_hand_encounter', isFirst: false});
  assert.equal(firstHand.believer, true);
  assert.equal(bomb.event_type, 'become_believer');
  assert.equal(bomb.san_lost, 10);
  assert.equal(firstHand.current_san, 60);
  assert.equal(bomb.permanently_insane, false);

  // A tome may be read without believing it: the Mythos still rises, the Sanity does not fall.
  const tome = {cm_value: 10, current_san: 70, max_san: 89};
  const read = becomeBeliever(tome, {source: 'tome', isFirst: false});
  assert.equal(read.san_lost, 0);
  assert.equal(tome.current_san, 70);
  assert.equal(tome.cm_value, 11);
});

test('Sanity spent to the last point by the bomb is permanent insanity', () => {
  const spent = {cm_value: 12, current_san: 12, max_san: 87};
  assert.equal(becomeBeliever(spent, {source: 'first_hand_encounter'}).permanently_insane, true);
  assert.equal(spent.current_san, 0);
});

test('a believer source the rules do not name is refused', () => {
  assert.throws(() => becomeBeliever({cm_value: 0, current_san: 70, max_san: 99}, {source: 'rumor'}),
    error => /rumor/.test(error.message));
});
