// Contract §224.7 (user rulings 2026-10-10 and 2026-10-11; Keeper Rulebook: Improvised Weapons p.104): on a table where the
// Enhanced Items Mod (a package requiring `weapons.improvised.v1`) is enabled, a declared first blow with a held object whose
// attack usage is not prepared is rolled this turn as the weapons-table row the object most resembles -- Jev's comparison over
// the kernel's own rows -- recorded as a forced `attack_fallback` roll; with no comparable row it is unarmed Fighting (Brawl)
// (§224.2). A prepared usage still takes precedence. Without the capability the kernel offers no rows, the host keeps the
// attack in preparation (§159.10.1) and `action.improvised` is not a resolve input. Real RPC fixture (the package copied from
// `mods/enhanced-items`, so it requires what the shipped Mod requires); the Jev port is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {table} from './object-usages-fixture.mjs';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {improvisedPreparation} from '../../runtime/jev/attack-preparation.ts';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';

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
  // Live table 2026-10-10: the host's resolve is validated against the Pi tool schema, which refused `improvised` ("schema is
  // false") until it was declared; this dispatcher bypasses that check, so the dispatched arguments are validated here.
  const resolveTool = COC_TOOLS.find(spec => spec.name === 'resolve');
  assert.doesNotThrow(() => validateToolArguments({name: 'resolve', description: '', parameters: resolveTool.parameters},
    {type: 'toolCall', id: 't1', name: 'resolve', arguments: {action: h.dispatched[0].action}}));
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
  const session = (await game.call('table.resolve.options')).context?.session ?? {};
  const pending = session.pending_defense;
  assert.ok(pending, 'the first blow waits on the defender');
  assert.equal(pending.actor, 'steven-knott');
  // Live table 2026-10-10: the defender's step then failed the snapshot's pending-attack contract ("combat pending attack
  // contract is invalid") because it did not know the two improvised fields. The defence settles the attack.
  const defended = await game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', decision: 'combat:defend', actor: 'Steven Knott', defense: 'dodge', goal: 'dodge the chair'}});
  assert.ok(defended, 'the defence resolves against an improvised attack');
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

test('§224.7: with the Mod disabled (no package requires weapons.improvised.v1) the first blow behaves as before: no offer, check_preparation, no improvised input', async t => {
  const game = await table(t, {without: ['weapons.improvised.v1']});
  await game.apply([{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'The chosen attack requires his combat profile.'}]);
  const row = (await game.call('table.resolve.options')).context.first_blow;
  assert.ok(row.preparation.weapons.includes('Study chair'), 'the chair is still listed as unprepared');
  assert.equal(row.preparation.improvised, undefined, 'the kernel offers no rows without the capability');
  assert.equal(improvisedPreparation(row, {target: 'Steven Knott', weapon: 'Study chair'}), undefined);
  await assert.rejects(game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', decision: 'combat:attack', target: 'Steven Knott', weapon: 'Study chair', improvised: 'club_large', goal: 'x'}}),
    error => error.code === 'invalid_params' && error.details.reason === 'unsupported_capability' && error.details.required[0] === 'weapons.improvised.v1');
  await assert.rejects(game.call('table.resolve', {call_id: game.next(), action: {intent: 'combat', decision: 'combat:attack', target: 'Steven Knott', weapon: 'Study chair', goal: 'x'}}),
    error => error.code === 'needs' && !/improvised/.test(`${error.message} ${error.fix ?? ''}`), 'the refusal (no prepared usage) does not name a path the table does not have');
  const h = await harness(t, game, {decide: async () => { throw new Error('no band question is asked without the capability'); }});
  const result = await h.execute({target: 'Steven Knott', weapon: 'Study chair'});
  assert.equal(result.status, 'refused');
  assert.equal(result.artifact.executed.summary.refusal, 'check_preparation', 'the §159.10.1 preparation refusal, as before §224.7');
  assert.match(result.artifact.executed.summary.preparation.needs[0], /Study chair/);
  assert.equal(h.dispatched.length, 0, 'no resolve reached the kernel');
  assert.equal(h.rows.some(row => row.lane === 'band-recovery' || row.why === 'attack_fallback'), false);
  const prepared = await game.prepare(); await game.apply([prepared.effect]);
  assert.equal((await game.call('table.resolve.options')).context.first_blow.preparation.weapons.includes('Study chair'), false, 'the prepared usage readies the chair as before');
});
