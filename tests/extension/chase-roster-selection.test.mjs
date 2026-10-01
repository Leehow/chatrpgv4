import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectChaseRoster} from '../../runtime/jev/chase-roster-selection.ts';
import {CHECK_SELECTION_GATES} from '../../runtime/jev/resolve-selection.ts';

const option = {key: 'vehicles', family: 'chase', label: 'Vehicle pursuit', action: {actor: 'Jack', decision: 'chase:start', intent: 'flee'},
  parameters: [], needs: [], authorization: 'declaration', facts: {mobility: 'vehicle',
    chase_actors: [{name: 'Jack', investigator: true, driving_available: true},
      {name: 'Pursuing driver', driving_available: true}, {name: 'Bed gunner', driving_available: false}],
    vehicle_profiles: [{key: 'car_standard', label: 'Standard car', mov: 14}, {key: 'pickup_truck', label: 'Pickup truck', mov: 14}]}};
const port = (override = {}) => async (_purpose, _state, questions) => {
  const answers = Object.fromEntries(questions.map(q => {
    const selected = q.key.startsWith('role_') ? (q.key === 'role_2' ? 'passenger' : 'driver')
      : q.key.startsWith('riding_') ? 'driver_1' : q.key === 'vehicle_0' ? 'profile_0' : 'profile_1';
    return [q.key, override[q.key] ?? (q.type === 'noul' ? {status: 'answered', type: 'noul', noul: .99}
      : {status: 'answered', type: 'choice', choice: selected, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === selected ? .99 : 0]))})];
  }));
  return {status: 'complete', answers, issues: [], coverage: {required: [], answered: [], unknown: []}};
};
const run = (value = option, overrides = {}) => selectChaseRoster(value, 'I drive away from the pursuing cars.', {}, CHECK_SELECTION_GATES, port(overrides));

test('driver and passenger bindings use only issued names and vehicle profiles, with no numeric plan', async () => {
  const result = await run();
  assert.equal(result.status, 'selected');
  assert.deepEqual(result.action.chase_roster, [{actor: 'Jack', role: 'driver', vehicle: 'car_standard'},
    {actor: 'Pursuing driver', role: 'driver', vehicle: 'pickup_truck'}, {actor: 'Bed gunner', role: 'passenger', riding_with: 'Pursuing driver'}]);
  assert.deepEqual(Object.keys(result.action.chase_roster[0]), ['actor', 'role', 'vehicle']);
});

test('a compatible vehicle class is confirmed independently when several profile choices share probability', async () => {
  const result = await run(option, {vehicle_0: {status: 'answered', type: 'choice', choice: 'profile_0', probabilities: {profile_0: .45, profile_1: .45, unknown: .1}}});
  assert.equal(result.status, 'selected');
  const refused = await run(option, {valid_0: {status: 'answered', type: 'noul', noul: .4}});
  assert.equal(refused.status, 'unresolved');
  assert.equal(refused.action, undefined);
});

test('missing driver numbers and uncertain passenger identity remain explicit needs', async () => {
  const missing = await run({...option, facts: {...option.facts, chase_actors: option.facts.chase_actors.map(actor => ({...actor, driving_available: false}))}});
  assert.deepEqual(missing.needs, ['chase_driver_skill_unavailable']);
  assert.equal(missing.preparation.decision, 'chase:start');
  const ambiguous = await run(option, {riding_2: {status: 'answered', type: 'choice', choice: 'unknown', probabilities: {unknown: 1}}});
  assert.deepEqual(ambiguous.needs, ['chase_passenger_driver_unbound']);
});

test('uncertain roles, unsupported profiles and unavailable provider answers cannot create a roster', async () => {
  for (const override of [
    {role_0: {status: 'answered', type: 'choice', choice: 'driver', probabilities: {driver: .6}}},
    {role_0: {status: 'answered', type: 'choice', choice: 'passenger', probabilities: {passenger: 1}}},
    {vehicle_0: {status: 'answered', type: 'choice', choice: 'profile_99', probabilities: {profile_99: 1}}},
    {valid_0: {status: 'unknown'}},
  ]) {
    const result = await run(option, override);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.action, undefined);
  }
});
