import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {root, temporary, table} from './object-usages-fixture.mjs';
import {selectCheck, validateCheckOptions} from '../../runtime/jev/resolve-selection.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';

const modulePath = join(temporary, 'chase-gateway.mjs');
await build({stdin: {contents: "export * from './kernel-ts/chase/index.ts'; export * from './kernel-ts/rules/tables.ts'; export * from './kernel-ts/resolve/arithmetic.ts'; export * from './kernel-ts/random.ts';",
  resolveDir: root, sourcefile: 'chase-gateway-test.ts'}, outfile: modulePath, bundle: true, packages: 'external',
  format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent'});
const {executeChase, ChaseSession, RuleTables, CheckArithmetic, PythonRandom} = await import(pathToFileURL(modulePath).href);

test('the settlement gateway starts a vehicle chase with Drive Auto and published vehicle MOV, not foot CON/MOV', async t => {
  const game = await table(t), tables = new RuleTables(game.context), arithmetic = await CheckArithmetic.create(tables);
  const create = ChaseSession.create;
  let captured;
  const stop = new Error('fixture stops after the real session receives its participants');
  ChaseSession.create = async (...args) => {
    captured = await create(...args);
    captured.establish = () => {throw stop;};
    return captured;
  };
  t.after(() => {ChaseSession.create = create;});
  const participant = (actor_id, side) => ({actor_id, side, mov: 7, dex: 60, con: 5, hp: 12,
    is_vehicle: true, vehicle_key: 'car_standard', drive_auto: 80, armor: 2, role: 'driver'});
  await assert.rejects(executeChase({kernel: game.context, tables, arithmetic, rng: new PythonRandom(3),
    snapshot: {meta: {play_language: 'en'}}, sessions: () => ({chase: null})},
    {command: {kind: 'chase_start', payload: {chase_id: 'vehicle-test', participants: [
      participant('driver', 'quarry'), participant('pursuer', 'pursuer')], locations: []}}}), error => error === stop);
  const driver = captured.participants.driver;
  assert.equal(driver.is_vehicle, true);
  assert.equal(driver.vehicle_key, 'car_standard');
  assert.equal(driver.mov_base, 14, 'Table V supplies chase MOV');
  assert.equal(driver.drive_auto, 80, 'the driver skill reaches the engine');
  assert.equal(driver.hp, 12, 'occupant HP is retained');
  delete captured.establish;
  const established = captured.establish();
  assert.equal(established.speed_rolls.driver.skill, 'Drive Auto');
  assert.equal(captured.pendingRolls.find(roll => roll.actor_id === 'driver').target, 80);
});

test('ordinary resolve binds a registered driver roster and persists vehicle participants through the production starter', async t => {
  const game = await table(t);
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'capable_adult', why: 'Pinned fixture actor.'}]);
  await game.apply([{kind: 'npc', name: 'Pickup gunner', walk_on: true, to: 'here', archetype: 'capable_adult', why: 'A fixture passenger in the pursuing vehicle.'}]);
  const world = await game.world(), handle = Object.keys(world.npc_profiles)[0];
  world.npc_profiles[handle].skills['Drive Auto'] = 80;
  await writeFile(join(game.directory, 'world.json'), JSON.stringify(world));
  const sheet = JSON.parse(await readFile(game.sheetPath, 'utf8'));
  sheet.skills['Drive Auto'] = 80;
  await writeFile(game.sheetPath, JSON.stringify(sheet));
  const catalog = await game.call('table.resolve.options');
  const options = validateCheckOptions(catalog.selection.options);
  const vehicle = options.find(option => option.facts?.mobility === 'vehicle');
  assert.ok(options.some(option => option.facts?.mobility === 'foot'));
  assert.equal(vehicle.facts.chase_actors.find(actor => actor.name === 'Steven Knott').driving_available, true);
  assert.ok(vehicle.facts.vehicle_profiles.some(profile => profile.key === 'car_standard'));
  const scope = {owner: 'check-selection', campaign: 'fixture', worldline: 'main', loop: 0, audience: 'keeper'};
  const lease = new TaskLease({owner: 'check-selection', goal: 'Escape the pursuing car.', scope, readSet: [], capabilities: ['decision'],
    budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
  t.after(() => lease.close());
  const families = [];
  const selected = await selectCheck({options, request: {decision: 'chase:start', bound: {actor: sheet.name}},
    declaration: 'I drive away from Steven Knott and the passenger in his pursuing car.', context: {}, scope, readSet: [], lease,
    decision: {async decide(batch) {
      families.push(batch.family);
      const answers = Object.fromEntries(batch.questions.map(question => {
        if (question.type === 'noul') {
          const candidate = batch.state.checks?.[question.key.replace(/_(uncertain|unsettled|blocked)$/, '')];
          const value = batch.family === 'check-selection-need' ? !question.key.endsWith('_blocked') && candidate?.facts?.mobility === 'vehicle' : true;
          return [question.key, {status: 'answered', type: 'noul', noul: value ? .99 : .01}];
        }
        const actor = batch.state.actors?.[question.key.replace('role_', 'actor_')];
        const value = batch.family === 'check-selection-chase-roles' ? actor.name === 'Pickup gunner' ? 'passenger' : 'driver'
          : batch.family === 'check-selection-chase-vehicles' ? Object.entries(batch.state.vehicle_profiles).find(([, profile]) => profile.key === 'car_standard')[0]
          : batch.family === 'check-selection-chase-passengers' ? 'driver_1'
          : Object.entries(question.criteria).find(([, label]) => label === 'flee')[0];
        return [question.key, {status: 'answered', type: 'choice', choice: value, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === value ? 1 : 0]))}];
      }));
      return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
    }}});
  assert.equal(selected.status, 'selected', JSON.stringify(selected.needs));
  assert.equal(selected.action.intent, 'flee');
  assert.ok(families.includes('check-selection-chase-vehicle-validity'));
  const result = await game.call('table.resolve', {call_id: game.next(), action: selected.action});
  assert.equal(result.decision, 'chase:start');
  const saved = JSON.parse(await readFile(join(game.directory, 'save/chase.json'), 'utf8'));
  for (const participant of saved.participants.filter(participant => participant.role !== 'passenger')) {
    assert.equal(participant.is_vehicle, true);
    assert.equal(participant.drive_auto, 80);
    assert.equal(participant.mov_base, 14);
  }
  const passenger = saved.participants.find(participant => participant.role === 'passenger');
  assert.ok(passenger);
  assert.equal(passenger.side, 'passenger');
  assert.equal(passenger.movement_actions, 0);
  assert.ok(saved.participants.some(participant => participant.actor_id === passenger.vehicle_actor_id && participant.is_vehicle));
});
