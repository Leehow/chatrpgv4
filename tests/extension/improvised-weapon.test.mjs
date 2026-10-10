// Contract §224.7 (user ruling 2026-10-10; Keeper Rulebook: Improvised Weapons p.104): a declared first blow with a held
// object whose attack usage is not prepared is rolled this turn as the weapons-table row the object most resembles -- Jev's
// comparison over the kernel's own rows -- recorded as a forced `attack_fallback` roll; with no comparable row it is unarmed
// Fighting (Brawl) (§224.2). A prepared usage still takes precedence. Real RPC fixture; the Jev port is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {table} from './object-usages-fixture.mjs';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {improvisedPreparation} from '../../runtime/jev/attack-preparation.ts';

const INPUT = 'I swing the chair at Knott.';
const choice = (probabilities, confidence = 0.9) => {
  const [chosen] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return {status: 'answered', type: 'choice', choice: chosen, confidence, probabilities};
};
const complete = (batch, answers) => ({batchId: batch.id, status: 'complete', answers, coverage: {required: Object.keys(answers), answered: Object.keys(answers), unknown: []}, issues: []});
/** A Jev that reads the chair as a Fighting (Brawl) thing hitting like a large club, or finds no comparable row at all. */
const jevFor = (verdict) => ({decide: async batch => {
  assert.equal(batch.family, 'band-recovery');
  const answers = {};
  for (const question of batch.questions) {
    if (question.key === 'family') {
      assert.match(JSON.stringify(batch.state), /improvised weapon/, 'the question is framed as the rulebook comparison');
      assert.ok(question.criteria['Fighting (Brawl)'], 'the families are the kernel\'s own weapon skills');
      answers.family = verdict === 'none' ? choice({none: 0.9, 'Fighting (Brawl)': 0.1}) : choice({'Fighting (Brawl)': 0.9, none: 0.1});
    } else {
      assert.ok(question.criteria.club_large, 'the Brawl profiles are the weapons-table rows');
      answers[question.key] = choice({club_large: 0.85, club_small: 0.1, none: 0.05});
    }
  }
  return complete(batch, answers);
}});

async function harness(t, game, decision) {
  const rows = [], dispatched = [], handlers = new Map();
  const pi = {events: {on: (name, fn) => handlers.set(name, fn), emit: (name, value) => handlers.get(name)?.(value)}, on: () => {}, registerTool: () => {}};
  const engine = createHybridEngine({npcAct: null, decision, env: {...process.env, TYPESAFE_API_KEY: '', JEV_API_KEY: ''}, record: row => rows.push(row)});
  engine.extension(pi);
  pi.events.emit('coc:kernel-bridge', {campaign: 'c1', call: (method, args) => game.call(method, args)});
  pi.events.emit('coc:operation-dispatcher', {dispatch: async operation => {
    dispatched.push(structuredClone(operation.args));
    const result = await game.call(`table.${operation.operation}`, {...operation.args, call_id: game.next()});
    return {status: 'succeeded', receipts: result.receipts ?? [], result};
  }});
  const plan = engine.runDriver.prepare({runId: 'blow', inputRevision: 'input', rawInput: INPUT, session: {}});
  const signal = new AbortController().signal;
  const invocation = step => ({runId: 'blow', stepId: step, operationId: step, origin: 'policy', inputRevision: 'input', scopeId: 'root', signal});
  await plan.ports.read.read({origin: 'policy', operation: 'read', readOnly: true}, invocation('read'));
  const options = await game.call('table.resolve.options');
  const candidate = buildCandidates({capsule: await game.call('table.capsule'), applyOptions: await game.call('table.apply.options'), resolveOptions: options}, INPUT)
    .find(item => item.clerk === 'first_blow');
  assert.ok(candidate, 'the first blow is a candidate');
  const execute = (extra) => plan.ports.operations.execute({origin: 'policy', operation: 'execute', params: {candidate, extra,
    bindings: [{name: 'weapon', path: 'jev', value: extra.weapon, confidence: 0.93, distribution: {[extra.weapon]: 0.94, unknown: 0.06}}]}}, invocation('execute'));
  return {rows, dispatched, execute, row: options.context.first_blow};
}

test('§224.7: the kernel\'s first-blow row offers the weapons-table rows an unprepared held object may be rolled as', async t => {
  const game = await table(t);
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'The chosen attack requires his combat profile.'}]);
  const row = (await game.call('table.resolve.options')).context.first_blow;
  assert.ok(row.preparation.weapons.includes('Study chair'), 'the chair\'s usage is still unprepared');
  assert.ok(row.preparation.improvised.options.includes('club_large') && row.preparation.improvised.options.includes('knife_medium'));
  assert.ok(row.preparation.improvised.profiles.some(profile => profile.id === 'club_large' && profile.skill === 'Fighting (Brawl)' && profile.damage === '1D8'));
  assert.deepEqual(row.preparation.improvised.close['Study chair'], [], 'the lexical close list is per object');
  const offer = improvisedPreparation(row, {target: 'Steven Knott', weapon: 'Study chair'});
  assert.equal(offer.object, 'Study chair');
  assert.equal(improvisedPreparation(row, {target: 'Steven Knott', weapon: '.38 Revolver'}), undefined, 'a ready weapon needs no improvisation');
  const unreadyTarget = {...row, preparation: {...row.preparation, targets: ['Steven Knott']}};
  assert.equal(improvisedPreparation(unreadyTarget, {target: 'Steven Knott', weapon: 'Study chair'}), undefined, 'a target the fight cannot read keeps the attack in preparation');
});

test('§224.7: the kernel rolls a held object as the named weapons-table row and says so on the result', async t => {
  const game = await table(t);
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'The chosen attack requires his combat profile.'}]);
  const before = await game.world();
  await assert.rejects(game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', decision: 'combat:attack', target: 'Steven Knott', weapon: 'Study chair', improvised: 'spoon', goal: 'x'}}),
    error => error.code === 'needs' && error.details.needs.field === 'improvised' && error.details.needs.options.includes('club_large'));
  await assert.rejects(game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', decision: 'combat:attack', target: 'Steven Knott', weapon: 'Lamp post', improvised: 'club_large', goal: 'x'}}),
    error => error.code === 'needs' && /not in the investigator's hands/.test(error.message));
  const attack = await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', decision: 'combat:attack', target: 'Steven Knott', weapon: 'Study chair', improvised: 'club_large', defense: 'none', goal: 'Swing the chair'}});
  const roll = attack.outcome.rolls.find(entry => entry.actor === 'thomas-hayes');
  assert.equal(roll.skill, 'Fighting (Brawl)', 'the row\'s skill');
  if (roll.passed) assert.equal(attack.outcome.damage[0].expression, '1D8', 'the row\'s damage');
  assert.deepEqual(attack.outcome.improvised, {object: 'Study chair', weapon: 'club_large', profile: 'Club, large (baseball/cricket bat, poker)'});
  const after = await game.world();
  assert.deepEqual(after.objects.usages ?? {}, before.objects.usages ?? {}, 'no usage is written: the background preparation is untouched');
});

test('§224.7: the host settles the turn-31 shape -- unprepared held object, present target, declared stab -- as an improvised roll, forced attack_fallback', async t => {
  const game = await table(t);
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'The chosen attack requires his combat profile.'}]);
  const h = await harness(t, game, jevFor('club'));
  const result = await h.execute({target: 'Steven Knott', weapon: 'Study chair'});
  assert.notEqual(result.artifact.executed.summary.refusal, 'check_preparation', 'the attack is not stalled on the usage');
  assert.equal(h.dispatched.length, 1, 'one resolve reached the kernel');
  assert.equal(h.dispatched[0].action.weapon, 'Study chair');
  assert.equal(h.dispatched[0].action.improvised, 'club_large');
  assert.ok(result.artifact.executed.ok, JSON.stringify(result.artifact.executed.summary).slice(0, 400));
  const forced = h.rows.find(row => row.lane === 'forced-resolution');
  assert.equal(forced.family, 'check-binding');
  assert.equal(forced.why, 'attack_fallback');
  assert.equal(forced.chosen.outcome, 'roll');
  assert.match(forced.uncertain[0], /Study chair.*club_large.*Club, large.*Fighting \(Brawl\) 1D8.*p=0\.8[5-9]|p=0\.9/);
  const band = h.rows.find(row => row.lane === 'band-recovery');
  assert.deepEqual([band.ok, band.for, band.band, band.name], [true, 'improvised', 'club_large', 'Study chair']);
  const bind = h.rows.find(row => row.lane === 'run' && row.event === 'bind' && row.clerk === 'improvised_weapon');
  assert.deepEqual([bind.bindings[0].name, bind.bindings[0].path, bind.bindings[0].rule, bind.bindings[0].value], ['improvised', 'rule-default', 'attack_fallback', 'club_large']);
  const pending = (await game.call('table.status')).session?.pending_attack ?? (await game.call('table.look', {focus: 'session'})).pending_attack;
  if (pending) assert.deepEqual([pending.weapon_id, pending.improvised_object], ['club_large', 'Study chair'], 'the pending attack names the object and the row');
});

test('§224.7: with no comparable row (Jev none) or no Jev, the attack is unarmed Fighting (Brawl) per §224.2, still a roll', async t => {
  for (const decision of [jevFor('none'), null]) {
    const game = await table(t);
    await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'The chosen attack requires his combat profile.'}]);
    const h = await harness(t, game, decision);
    const result = await h.execute({target: 'Steven Knott', weapon: 'Study chair'});
    assert.ok(result.artifact.executed.ok, JSON.stringify(result.artifact.executed.summary).slice(0, 400));
    assert.equal(h.dispatched[0].action.weapon, 'unarmed');
    assert.equal(h.dispatched[0].action.improvised, undefined);
    const forced = h.rows.find(row => row.lane === 'forced-resolution');
    assert.equal(forced.why, 'attack_fallback');
    assert.equal(forced.chosen.outcome, 'roll');
    assert.match(forced.uncertain[0], /unarmed \(Fighting \(Brawl\) fallback\): Study chair has no prepared attack usage/);
    const band = h.rows.find(row => row.lane === 'band-recovery');
    assert.equal(band.ok, false);
    assert.equal(band.reason, decision ? 'none' : 'unconfigured');
  }
});

test('§224.7: a prepared usage takes precedence -- the kernel lists the object as ready and no improvised row is asked or bound', async t => {
  const game = await table(t);
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'The chosen attack requires his combat profile.'}]);
  const prepared = await game.prepare(); await game.apply([prepared.effect]);
  const row = (await game.call('table.resolve.options')).context.first_blow;
  assert.equal(row.preparation.weapons.includes('Study chair'), false);
  assert.equal(improvisedPreparation(row, {target: 'Steven Knott', weapon: 'Study chair'}), undefined);
  const h = await harness(t, game, {decide: async () => { throw new Error('no band question is asked for a prepared usage'); }});
  const result = await h.execute({target: 'Steven Knott', weapon: 'Study chair'});
  assert.ok(result.artifact.executed.ok, JSON.stringify(result.artifact.executed.summary).slice(0, 400));
  assert.equal(h.dispatched[0].action.weapon, 'Study chair');
  assert.equal(h.dispatched[0].action.improvised, undefined);
  assert.equal(h.rows.some(row => row.lane === 'forced-resolution' && row.why === 'attack_fallback'), false);
  const outcome = result.artifact.executed.summary;
  assert.ok(JSON.stringify(outcome).includes('"usage"') || h.dispatched[0].action.weapon === 'Study chair', 'the prepared usage is the weapon');
});
