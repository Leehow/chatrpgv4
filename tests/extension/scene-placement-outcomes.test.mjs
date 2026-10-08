/** §204.3: independent containment decisions and preservation of the Keeper's explicit topology. No models. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {placementOutcome, placedEffect, placementState, SCENE_PLACEMENT_FALLBACK} from '../../runtime/jev/scene-placement.ts';
const budget = {...SCENE_PLACEMENT_FALLBACK, sameMin: .8, insideMin: .75, choiceConfidenceMin: .7};
const result = patch => ({status: 'answered', chosen: 'farm', confidence: .3, distribution: {farm: .32, house: .29, none: .39},
  same: {farm: .1, house: .1}, inside: {farm: .91, house: .9}, elapsedMs: 1, usage: {}, ...patch});
const candidates = [{name: 'farm', summary: 'The farm.', source: 'within', inside: []},
  {name: 'house', summary: 'The house on the farm.', source: 'here', inside: ['farm'], table_place: true}];

test('a weak Choice cannot veto strong inside Nouls, and the innermost clearing place wins', () => {
  assert.deepEqual(placementOutcome(result({}), budget, 'elsewhere', candidates), {outcome: 'inside', handle: 'house'});
  assert.deepEqual(placementOutcome(result({chosen: null}), budget, 'elsewhere', candidates), {outcome: 'inside', handle: 'house'});
});
test('same retains the gate and excludes table places; confident none explicitly places a mint outside', () => {
  assert.deepEqual(placementOutcome(result({chosen: 'farm', confidence: .9, same: {farm: .95}}), budget, 'elsewhere', candidates),
    {outcome: 'same', handle: 'farm'});
  assert.deepEqual(placementOutcome(result({chosen: 'house', confidence: .9, same: {house: .95}}), budget, 'elsewhere', candidates),
    {outcome: 'inside', handle: 'house'});
  assert.deepEqual(placementOutcome(result({chosen: null, confidence: .9, inside: {farm: .1, house: .1}}), budget, 'elsewhere', candidates),
    {outcome: 'outside'});
});
test('an explicit within name or null survives placement; same still reuses the existing book place', () => {
  const effect = {kind: 'move', to: 'New room', via: 'Through the door.', establish: {summary: 'A room.'}};
  assert.equal(placedEffect({...effect, establish: {...effect.establish, within: 'known-house'}}, {outcome: 'inside', handle: 'farm'}).establish.within, 'known-house');
  assert.equal(placedEffect({...effect, establish: {...effect.establish, within: null}}, {outcome: 'inside', handle: 'farm'}).establish.within, null);
  assert.equal(placedEffect(effect, {outcome: 'outside'}).establish.within, null);
  assert.deepEqual(placedEffect(effect, {outcome: 'same', handle: 'farm'}), {kind: 'move', to: 'farm', via: 'Through the door.'});
});
test('the model sees a table origin, while ancestor handles stay private to the host', () => {
  const input = {to: 'Room', via: '', summary: 'A room.', scene: {name: 'house', summary: ''}, candidates};
  const state = placementState(input);
  assert.equal(state.book_places.c1.origin, 'table');
  assert(!Object.hasOwn(state.book_places.c1, 'inside'));
});
