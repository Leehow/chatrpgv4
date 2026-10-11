/**
 * Contract §221: sanity is judged from what happened, per the Keeper Rulebook. Real kernel seams, controlled Jev
 * answers; not gameplay acceptance. The kernel is bundled from source here (`kernel-ts/`), so no `build/` is needed.
 */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {selectCheck, validateCheckOptions, specializedTriggerQuestion} from '../../runtime/jev/resolve-selection.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.tmp'), {recursive: true});
const bundle = await mkdtemp(join(root, '.tmp/sanity-ladder-test-'));
after(() => rm(bundle, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {SanitySession} from './kernel-ts/sanity/session.ts';
export {sanityLossLadder} from './kernel-ts/sanity/index.ts';
export {keeperAwardScale} from './kernel-ts/development/award.ts';
export {closeSanityDays} from './kernel-ts/healing/day.ts';
export {SHAPE_KINDS} from './kernel-ts/modules/mechanics-catalog.ts';
export {CheckArithmetic} from './kernel-ts/resolve/arithmetic.ts';
export {PythonRandom} from './kernel-ts/random.ts';
export {RuleTables} from './kernel-ts/rules/tables.ts';`, resolveDir: root, sourcefile: 'sanity-ladder-api.ts'},
  outfile: join(bundle, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);

const RULES = join(root, 'content/rulesets/coc7/rules-json');
const LADDER = ['0/1D2', '0/1D3', '0/1D4', '1/1D4+1', '0/1D6', '0/1D6', '0/1D6', '1/1D6+1', '0/1D10', '1/1D10', '2/2D10+1', '1D10/1D100'];

async function kernelAt(t, name, seed) {
  const home = await mkdtemp(join(bundle, `${name}-`));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed, locks: api.nativeAdvisoryLocks()});
  const kernel = api.createKernelRuntime(context);
  t.after(() => kernel.close());
  return {context, kernel, call: (method, params = {}) => kernel.handlers[method]({campaign: name, ...params})};
}

test('§221.2: the rules data holds the twelve example rows of p.155 and the award scale, each read by the grammar', async t => {
  const {context} = await kernelAt(t, 'data', 'ladder-data');
  const tables = new api.RuleTables(context);
  const ladder = await api.sanityLossLadder(tables);
  assert.deepEqual(ladder.map(row => row.san_loss), LADDER);
  assert.ok(ladder.every(row => row.situation.trim() && !/[.!?]$/.test(row.situation)), 'labels are short paraphrases, not sentences');
  const shipped = JSON.parse(await readFile(join(RULES, 'sanity.json'), 'utf8'));
  assert.deepEqual(shipped.sample_loss_ladder.rows.map(row => row.san_loss), LADDER);
  assert.equal(shipped.getting_used_to_the_awfulness.development_phase_reduction, 1);
  assert.equal(shipped.mythos_hardened.permanent, true);
  assert.equal(shipped.sanity_day.fallback, 'calendar_day');
  const scale = await api.keeperAwardScale(tables);
  assert.deepEqual(scale.map(rung => rung.expression), [null, '1D3', '1D6', '2D6']);
  assert.deepEqual(scale.filter(rung => rung.printed).map(rung => rung.expression), ['1D6'], 'only the book\'s example is printed');
  assert.ok(api.SHAPE_KINDS.sanity_loss.includes('clue'), '§221.4: a clue may state its sanity loss');
});

test('§221.3(4) T18: a corpse filed as a clue with no stated loss is offered as a Sanity roll over the ladder, and a stub Jev picking 0/1D3 rolls it', async t => {
  const {call} = await kernelAt(t, 't18', 't18-corpse');
  await call('campaign.create', {id: 't18', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  const declaration = 'I pry the boards off and look behind them.';
  await call('table.player_input', {text: declaration});
  // The clue is improvised at the table (`establish`); the system path does not depend on hand-authored haunting clues.
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: 'The body behind the boards', how: 'tearing the boards away',
    establish: {summary: 'A wizened, seemingly dead figure lies on a pallet behind the boards, a chain at its throat.'}}]});
  const options = await call('table.resolve.options');
  const checks = validateCheckOptions(options.selection.options);
  assert.ok(checks, 'the catalog stays a valid check inventory');
  const judged = checks.find(option => option.action.decision === 'sanity:check' && option.facts?.loss_source === 'rulebook_examples');
  assert.ok(judged, 'an investigator with no stated horror still has a Sanity roll to judge');
  assert.equal(judged.authorization, 'consequence');
  const actor = judged.action.actor;
  assert.ok(typeof actor === 'string' && actor, 'the investigator is the actor');
  assert.equal(judged.action.san_loss, undefined, 'the loss is a Jev parameter, not a host fact');
  const ladder = judged.parameters.find(parameter => parameter.name === 'san_loss');
  assert.deepEqual(ladder.options.map(option => option.value), LADDER);
  assert.ok(ladder.options.every(option => option.label.endsWith(`(${option.value})`)), 'each rung is labelled by its example situation');
  assert.equal(ladder.selection, undefined, 'one rung is chosen, with unknown available');
  assert.equal(judged.parameters.find(parameter => parameter.name === 'involuntary').selection, 'compatible');
  const bout = judged.parameters.find(parameter => parameter.name === 'bout');
  assert.equal(bout.selection, 'compatible');
  assert.equal(bout.options[0].value, 'roll');
  assert.ok(bout.options.some(option => option.value === 'violence'));
  assert.deepEqual(judged.facts.done_this_turn.clues.map(clue => clue.label), ['The body behind the boards']);
  assert.equal(judged.facts.done_this_turn.declaration, declaration);
  assert.ok(judged.definition.includes('p.155'));
  assert.ok(specializedTriggerQuestion(judged).includes('done_this_turn'));
  assert.ok(options.selection.coverage.find(entry => entry.decision === 'sanity:check').executable, 'the family is executable: no check_arguments_unavailable placeholder');
  assert.ok(!checks.some(option => option.needs.some(need => need === 'check_arguments_unavailable:sanity:check')));

  // A stub Jev: the roll is needed now, the horror is "a corpse or body part" (0/1D3), the investigator freezes, the bout is rolled.
  const lease = new TaskLease({owner: 'check-selection', goal: 'T18', scope: {owner: 'check-selection', campaign: 't18', worldline: 'main', loop: 0, audience: 'keeper'},
    readSet: [], capabilities: ['decision'], budget: {deadlineAt: Date.now() + 10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
  t.after(() => lease.close());
  const seen = [];
  const decision = {async decide(batch) {
    seen.push(batch);
    const answers = Object.fromEntries(batch.questions.map(raw => {
      const question = {...raw, key: raw.key.replace(/__semantic_(facts|execution)$/, '')};
      if (question.type === 'choice') {
        const wanted = Object.entries(question.criteria).find(([, label]) => typeof label === 'string' && label.endsWith('(0/1D3)'))?.[0] ?? 'unknown';
        return [raw.key, {status: 'answered', type: 'choice', choice: wanted, confidence: 0.95,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === wanted ? 0.95 : 0.05 / (Object.keys(question.criteria).length - 1)]))}];
      }
      let p = 0.02;
      if (question.key.endsWith('_blocked')) p = 0.01;
      else if (question.key.startsWith('check_')) p = 0.97;
      else if (question.target === 'involuntary: freeze' || question.target === 'bout: Roll on the bout table (1D10)') p = 0.9;
      return [raw.key, {status: 'answered', type: 'noul', noul: p}];
    }));
    return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
  }};
  const selected = await selectCheck({options: checks, request: {decision: 'sanity:check', bound: {}}, declaration, context: options.context,
    scope: lease.scope ?? {owner: 'check-selection', campaign: 't18', worldline: 'main', loop: 0, audience: 'keeper'}, readSet: [], lease, decision, investigators: [actor]});
  assert.equal(selected.status, 'selected', JSON.stringify(selected));
  assert.equal(selected.option.key, judged.key);
  assert.equal(selected.action.san_loss, '0/1D3');
  assert.equal(selected.action.involuntary, 'freeze');
  assert.equal(selected.action.bout, 'roll');
  assert.ok(seen.some(batch => batch.family === 'check-selection-need' && JSON.stringify(batch.state).includes('The body behind the boards')), 'Jev reads what happened this turn');
  // Live Jev 2026-10-10: without the facts the ladder question answered unknown at 1.0 ("not determined by supplied state").
  assert.ok(seen.some(batch => batch.family === 'check-selection-bind' && JSON.stringify(batch.state).includes('The body behind the boards')), 'the loss is bound reading the same facts');

  // Live table 2026-10-10: the host's resolve goes through the tool schema, which refused `bout` ("schema is false") and the
  // SAN roll never ran. Every key a catalog option binds -- action or parameter -- is a property of the resolve action.
  const resolveTool = COC_TOOLS.find(spec => spec.name === 'resolve');
  const actionProps = Object.keys(resolveTool.parameters.properties.action.properties);
  // `difficulty`, `bonus` and `penalty` are folded into `modifiers` by the host (`settleCheckSelection`) before the call.
  const unknown = [...new Set(checks.flatMap(option => [...Object.keys(option.action), ...option.parameters.map(parameter => parameter.name)]
    .filter(key => !actionProps.includes(key) && !['difficulty', 'bonus', 'penalty'].includes(key)).map(key => `${option.action.decision}:${key}`)))];
  assert.deepEqual(unknown, [], 'every key a catalog option binds reaches the kernel through the resolve tool schema');
  assert.doesNotThrow(() => validateToolArguments({name: 'resolve', description: '', parameters: resolveTool.parameters},
    {type: 'toolCall', id: 't1', name: 'resolve', arguments: {action: selected.action}}));
  const result = await call('table.resolve', {call_id: 't1-c2', action: selected.action});
  assert.equal(result.decision, 'sanity:check');
  assert.equal(result.outcome.kind, 'sanity');
  assert.equal(result.outcome.skill, 'SAN');
  const roll = (await call('table.status')).receipts.find(receipt => receipt.kind === 'roll' && receipt.roll_kind === 'sanity_check');
  assert.ok(roll, 'a SAN roll receipt landed');
  assert.equal(roll.actor, 'thomas-hayes');
  assert.equal(roll.npc_exposure, undefined, 'a situation is not a creature');
  const again = validateCheckOptions((await call('table.resolve.options')).selection.options);
  assert.ok(!again.some(option => option.action.decision === 'sanity:check' && option.facts?.loss_source === 'rulebook_examples'), 'one Sanity roll per investigator per turn');
  // §221.11: on the next turn the judged option shows the roll already made on this visit, so a sight that merely continues is settled.
  await call('table.narrate', {call_id: 't1-c3', text: 'You stare at the figure behind the boards.'});
  await call('table.player_input', {text: 'I keep looking at it.'});
  const later = validateCheckOptions((await call('table.resolve.options')).selection.options)
    .find(option => option.action.decision === 'sanity:check' && option.facts?.loss_source === 'rulebook_examples');
  assert.ok(later, 'a new turn offers the judged roll again');
  assert.equal(later.facts.settled_this_visit.length, 1);
  assert.equal(later.facts.settled_this_visit[0].san_loss ?? '0/1D3', '0/1D3');
  assert.match(specializedTriggerQuestion(later), /settled_this_visit/);
});

test('§221.6/§221.7: the awfulness cap is the failure half\'s maximum, hardening is permanent, development eases the totals', async t => {
  const {context} = await kernelAt(t, 'engine', 'awfulness');
  const tables = new api.RuleTables(context), arithmetic = await api.CheckArithmetic.create(tables);
  const session = new api.SanitySession('inv', 50, new api.PythonRandom('cap'), tables, arithmetic, 0, 99, 0);
  session.state.san_current = 90;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const before = session.state.san_current;
    await session.sanityCheck('seeing the thing', '1', '1D6+1', {creatureType: 'catalog:Thing', involuntaryKind: 'freeze'});
    total += before - session.state.san_current;
    // A unit reset: insanity is another rule's; only the cap is under test here.
    Object.assign(session.state, {san_current: 90, bout_active: false, bout_rounds_remaining: 0, active_bout_id: null, temporary_insane: false, indefinite_insane: false, daily_san_lost: 0});
    session.drainPending();
  }
  assert.equal(total, 7, 'the total lost to one sort of monster stops at its maximum possible loss (1/1D6+1 -> 7, not 8)');
  assert.deepEqual(session.state.awfulness_caps, {'catalog:Thing': 7});
  assert.deepEqual(session.easeAwfulness(1).payload.totals, {'catalog:Thing': 6});
  assert.equal(session.state.events.at(-1).type, 'awfulness_eased');
  assert.equal(session.easeAwfulness(0), null);

  const hardened = new api.SanitySession('inv', 50, new api.PythonRandom('hard'), tables, arithmetic, 0, 99, 40);
  hardened.state.san_current = 30;
  await hardened.sanityCheck('the truth', '2', '2', {involuntaryKind: 'freeze'});
  assert.equal(hardened.state.mythos_hardened, true);
  assert.equal(hardened.drainPending()[0].mythos_hardened, true);
  Object.assign(hardened.state, {san_current: 80, bout_active: false, bout_rounds_remaining: 0, active_bout_id: null, temporary_insane: false, indefinite_insane: false, daily_san_lost: 0});
  await hardened.sanityCheck('the truth again', '2', '2', {involuntaryKind: 'freeze'});
  const record = hardened.drainPending()[0];
  assert.equal(record.mythos_hardened, true, 'Sanity above Cthulhu Mythos again does not revert the hardening (p.169)');
  assert.equal(record.san_loss, 1, 'the loss stays halved');
  const closed = api.closeSanityDays(hardened.state, 'inv', 40, 1440, 1);
  assert.equal(closed.mythos_hardened, true, 'the day close carries the flag');

  const chooser = new api.SanitySession('inv', 50, new api.PythonRandom('bout'), tables, arithmetic, 0, 99, 0);
  const picked = await chooser.startBout('a corpse', false, null, 2, 'violence');
  assert.equal(picked.bout_kind, 'violence');
  assert.equal(picked.bout_chosen, true);
  assert.equal(chooser.drainPending().find(record => record.kind === 'bout_of_madness_table').outcome, 'chosen');
  const rolled = await chooser.startBout('a corpse', false, null, 2, 'roll');
  assert.equal(rolled.bout_chosen, undefined);
  assert.equal(chooser.drainPending().find(record => record.kind === 'bout_of_madness_table').outcome, 'rolled');
});

test('§221.9: the session ending offers the Keeper award from the scale, with no award as the rules default when the book states none', async t => {
  const {call} = await kernelAt(t, 'award', 'award');
  await call('campaign.create', {id: 'award', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'We leave the house behind us.'});
  const options = await call('table.resolve.options');
  const endings = validateCheckOptions(options.selection.options).filter(option => option.action.decision === 'development:end-session');
  const conclusion = endings.find(option => option.action.ending === 'conclusion');
  assert.ok(conclusion);
  assert.equal(conclusion.action.scenario_san_reward_expr, undefined, 'nobody types the figure');
  const reward = conclusion.parameters.find(parameter => parameter.name === 'scenario_san_reward_expr');
  assert.equal(conclusion.facts.reward_source, 'rulebook_scale');
  assert.deepEqual(reward.options.map(option => option.value), [null, '1D3', '1D6', '2D6']);
  assert.equal(reward.default.value, null, 'the opening scene states no reward: none is the default');
  assert.ok(reward.default.question.includes('p.168'));
  assert.ok(conclusion.definition.includes('cowardly, brutal or murderous'));
  assert.ok(!endings.some(option => option.action.ending === 'tpk'), 'a living party has no tpk');
});
