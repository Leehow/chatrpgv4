/** Real kernel seams only; these controlled selections are not gameplay acceptance. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {validateCheckOptions} from '../../runtime/jev/resolve-selection.ts';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {initialView, routeBatch} from '../../runtime/jev/step-policy.ts';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.tmp'), {recursive: true});
const bundle = await mkdtemp(join(root, '.tmp/check-catalog-test-'));
after(() => rm(bundle, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'check-catalog-api.ts'},
  outfile: join(bundle, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);

test('six prepared NPCs do not send Cartesian parameter inventories to family routing', async t => {
  const home = await mkdtemp(join(bundle, 'packing-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'route-packing', locks: api.nativeAdvisoryLocks()});
  const kernel = api.createKernelRuntime(context); t.after(() => kernel.close());
  const call = (method, params = {}) => kernel.handlers[method]({campaign: 'packing', ...params});
  await call('campaign.create', {id: 'packing', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'I drive away from the pursuers.'});
  await call('table.apply', {call_id: 't1-c1', effects: [
    {kind: 'npc', name: 'Steven Knott', archetype: 'capable_adult', why: 'Prepared fixture actor.'},
    ...Array.from({length: 5}, (_, i) => ({kind: 'npc', name: `Fixture pursuer ${i + 1}`, walk_on: true, to: 'here', archetype: 'capable_adult', why: 'A prepared fixture participant.'})),
  ]});
  const capsule = await call('table.capsule'), resolveOptions = await call('table.resolve.options');
  const candidates = buildCandidates({capsule, resolveOptions, applyOptions: await call('table.apply.options')}, 'I drive away from the pursuers.');
  const view = initialView({runId: 'packing', rawInput: 'I drive away from the pursuers.', context: {scene: 'road', clock: {}, present: []}, candidates, readFirst: false});
  const {batch} = routeBatch(view, {owner: 'route', campaign: 'packing', worldline: 'main', loop: 0, audience: 'keeper'}, []);
  const candidate = candidates.find(row => row.bound.decision === 'social:adjudicate-difficulty');
  assert.equal(candidate.detail.check_options.length, 42);
  const projected = Object.values(batch.state.candidates).find(row => row.bound.decision === 'social:adjudicate-difficulty');
  const expected = candidate.detail.check_options.map(option => [option.action.actor, option.action.target]).sort();
  const actual = projected.detail.check_options.flatMap(option => option.participants.map(pair => [pair.actor, pair.target])).sort();
  assert.deepEqual(actual, expected);
  assert.ok(projected.detail.check_options.length < 42);
  assert.equal(projected.detail.check_options.some(option => option.definition || option.parameters), false);
  assert.equal(candidate.detail.check_options.length, 42, 'the full catalog remains available to the selected binder');
});

test('current kernel issues a complete rule inventory and executable ordinary/treatment choices without mutation', async t => {
  const home = await mkdtemp(join(bundle, 'home-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'check-catalog',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const kernel = api.createKernelRuntime(context);
  t.after(() => kernel.close());
  const call = (method, params = {}) => kernel.handlers[method]({campaign: 'catalog', ...params});
  await call('campaign.create', {id: 'catalog', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'I listen carefully, then inspect the office.'});
  const before = await call('table.status');
  const options = await call('table.resolve.options');
  assert.equal(options.selection.owner, 'jev');
  const guidance = options.decisions.find(decision => decision.name === 'core-check:ordinary-check').guidance;
  assert.ok(guidance.some(rule => rule.text.includes('uncertain consequential outcome') && rule.source_refs.length));
  const checks = validateCheckOptions(options.selection.options);
  assert.ok(checks?.length);
  for (const decision of options.decisions) assert.ok(options.selection.coverage.some(entry => entry.decision === decision.name), decision.name);
  const listen = checks.find(option => option.action.skill === 'Listen');
  const spot = checks.find(option => option.action.skill === 'Spot Hidden');
  assert.ok(listen && spot && listen.key !== spot.key, 'two methods do not share a mutually exclusive skill selector');
  assert.ok(!checks.some(option => option.action.decision === 'healing:first-aid-ordinary'), 'a healthy party supplies no First Aid patient');
  for (const decision of ['healing:dying-hour-clock', 'healing:dying-round-clock', 'healing:weekly-major-wound-recovery', 'sanity:reality-check']) {
    assert.ok(!checks.some(option => option.action.decision === decision), `${decision} has no active condition`);
    assert.ok(options.selection.coverage.some(entry => entry.decision === decision), 'inactive decisions remain inventoried');
  }
  assert.deepEqual(await call('table.status'), before, 'catalog projection cannot roll or change the turn');
  const candidates = buildCandidates({capsule: await call('table.capsule'), applyOptions: await call('table.apply.options'), resolveOptions: options}, 'I listen carefully, then inspect the office.');
  assert.ok(candidates.filter(candidate => candidate.unbound.some(parameter => parameter.binder === 'resolve-selection')).length > 1);
  assert.ok(candidates.filter(candidate => candidate.unbound.some(parameter => parameter.binder === 'resolve-selection')).every(candidate => typeof candidate.bound.decision === 'string'));
  assert.equal(candidates.some(candidate => candidate.unbound.some(parameter => parameter.binder === 'ordinary-resolve')), false,
    'one current binder owns ordinary checks; the earlier preflight does not repeat them');
  assert.ok(candidates.filter(candidate => candidate.verb === 'resolve').every(candidate => candidate.checkOwner === 'jev'));
  assert.deepEqual(candidates.find(candidate => candidate.bound.decision === 'core-check:ordinary-check').detail.rule_guidance, guidance.map(rule => rule.text));
  const action = {...listen.action, intent: 'investigate', modifiers: {difficulty: 'regular', bonus_dice: 0, penalty_dice: 0, reason: 'the declared method'}};
  const result = await call('table.resolve', {action, call_id: 't1-c1'});
  assert.ok(result.receipts.length, 'an issued ordinary action reaches the real TS resolver');
  const next = await call('table.resolve.options');
  assert.notEqual(next.world_revision, options.world_revision, 'the execution invalidates earlier selection snapshots');
  assert.ok(next.context.current_receipts.some(receipt => receipt.skill === 'Listen'));
});

test('a wounded NPC is a bound patient before necessity, and an out-of-session pursuit is reachable', async t => {
  const home = await mkdtemp(join(bundle, 'patient-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'patient-check', locks: api.nativeAdvisoryLocks()});
  const kernel = api.createKernelRuntime(context);
  t.after(() => kernel.close());
  const call = (method, params = {}) => kernel.handlers[method]({campaign: 'patient', ...params});
  await call('campaign.create', {id: 'patient', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'I use First Aid to bandage the injured porter.'});
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: 'Porter', walk_on: true, to: 'here', archetype: 'ordinary_adult', why: 'The porter is the prepared patient.'}]});
  await call('table.apply', {call_id: 't1-c2', effects: [{kind: 'damage', subject: 'Porter', dice: '1D1+2', why: 'A fresh cut.'}]});
  const options = await call('table.resolve.options');
  const patient = options.selection.situation.patients.find(row => row.name === 'Porter');
  assert.equal(patient.max - patient.hp, 3);
  assert.equal(patient.injured, true);
  const aid = options.selection.options.find(row => row.action.decision === 'healing:first-aid-ordinary');
  assert.equal(aid.action.target, 'Porter');
  assert.notEqual(aid.action.actor, aid.action.target);
  assert.equal(aid.facts.clinical_eligibility, 'eligible');
  assert.equal(aid.parameters.some(row => row.name === 'target'), false);
  const candidates = buildCandidates({capsule: await call('table.capsule'), applyOptions: await call('table.apply.options'), resolveOptions: options}, 'I treat the porter.');
  assert.ok(candidates.some(row => row.bound.decision === 'chase:start'), 'starting a chase does not require an existing chase');
  const pursuit = options.selection.options.find(option => option.action.decision === 'chase:start' && option.action.target === 'Porter');
  const influence = options.selection.options.find(option => option.action.decision === 'social:adjudicate-difficulty' && option.action.actor !== 'Porter' && option.action.target === 'Porter');
  assert.equal(influence.parameters.find(parameter => parameter.name === 'skill').selection, 'compatible', 'the Keeper adjudicates social skill from described conduct');
  assert.deepEqual(influence.facts, {stage: 'difficulty_adjudication', actor_role: 'investigator', target_role: 'npc'});
  assert.equal(pursuit.action.target, 'Porter');
  assert.equal(pursuit.action.intent, undefined, 'an unbound intent is not a contradictory default fact');
  assert.equal(candidates.find(row => row.bound.decision === 'healing:first-aid-ordinary').detail.check_options[0].action.target, 'Porter');
  await call('table.resolve', {call_id: 't1-c3', action: aid.action});
  const status = await call('table.status');
  const rolled = status.receipts.find(row => row.kind === 'roll' && row.skill === 'First Aid');
  assert.equal(rolled.actor, 'thomas-hayes');
  const after = await call('table.resolve.options');
  const body = after.selection.situation.patients.find(row => row.name === 'Porter');
  assert.equal(body.hp, patient.hp + (rolled.passed ? 1 : 0));
  assert.equal(body.first_aid_used, true);
  assert.ok(!after.selection.options.some(row => row.action.decision === 'healing:first-aid-ordinary' && row.action.target === 'Porter'));
});

for (const skills of [['Listen'], ['Listen', 'Spot Hidden']]) test(`the agent commits ${skills.join(' then ')} through the canonical gateway without a model resolve`, async t => {
  const decision = {async decide(batch) {
    const settled = new Set(batch.state.context?.current_receipts?.filter(receipt => receipt.kind === 'roll').map(receipt => receipt.skill));
    const answers = Object.fromEntries(batch.questions.map(rawQuestion => {
        const question = {...rawQuestion, key: rawQuestion.key.replace(/__semantic_(facts|execution)$/, '')};
      if (question.type === 'noul') {
        let p = 0;
        if (batch.family === 'check-selection-profiles' && question.key === 'remaining') p = skills.some(skill => !settled.has(skill)) ? 1 : 0;

        if (batch.family === 'check-selection-need' && !question.key.endsWith('_blocked')) {
          const check = batch.state.checks[question.key.replace(/_(uncertain|unsettled|selected)$/, '')];
          p = skills.includes(check?.action?.skill) && !settled.has(check.action.skill) && check.action.actor === batch.state.context.conditions[0].actor ? 1 : 0;
        }
        if (batch.family === 'check-selection-need' && question.key.endsWith('_blocked')) {
          const check = batch.state.checks[question.key.replace(/_blocked$/, '')];
          p = check?.action?.skill === 'Spot Hidden' && !settled.has('Listen') ? 1 : 0;
        }
        if (batch.family === 'check-selection-authority') p = 1;
        return [rawQuestion.key, {status: 'answered', type: 'noul', noul: p}];
      }
      let selected;
      if (batch.family === 'single-loop-route' && question.key.startsWith('need_')) {
        const candidate = batch.state.candidates[question.key.replace('need_', 'candidate_')];
        if (candidate?.bound?.decision === 'core-check:ordinary-check') selected = 'now';
      }
      if (batch.family === 'check-selection-profiles') selected = Object.entries(question.criteria)
        .find(([, value]) => skills.includes(value?.skill) && !settled.has(value.skill) && value.actor === batch.state.context.conditions[0].actor)?.[0];
      if (batch.family === 'check-selection-bind') selected = Object.entries(question.criteria).find(([, label]) => ['investigate', 'regular', 'none'].includes(label))?.[0];
      selected ??= question.key === 'exit' ? 'finish' : 'unknown' in question.criteria ? 'unknown' : 'later' in question.criteria ? 'later' : Object.keys(question.criteria)[0];
      return [rawQuestion.key, {status: 'answered', type: 'choice', choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0]))}];
    }));
    return bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
  }};
  const engine = createHybridEngine({env: {...process.env, PI_COC_JEV_PRESELECT: '0', COC_JEV_STEPS: 'off'}, decision, compile: false, npcAct: null});
  const table = await openTable({realKernel: true, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
    prepareWorkspace: async workspace => {
      const context = await api.createKernelContext({workspace, content: join(root, 'content'), seed: 'catalog-play', locks: api.nativeAdvisoryLocks()});
      const kernel = api.createKernelRuntime(context);
      try {
        await kernel.handlers['table.open']({campaign: 'test-camp'});
        await kernel.handlers['table.player_input']({campaign: 'test-camp', text: 'I am ready.'});
        await kernel.handlers['table.narrate']({campaign: 'test-camp', call_id: 't1-c1', text: 'You wait in the office.'});
      } finally { await kernel.close(); }
    },
    extraExtensions: [{name: 'check-selection-engine', factory: engine.extension}],
    responses: [fauxAssistantMessage([fauxToolCall('narrate', {text: 'You pause near the door and listen carefully before deciding where to go next.'})], {stopReason: 'toolUse'})]});
  t.after(() => table.dispose());
  await table.session.prompt(skills.length === 1 ? 'I listen carefully by the office door.' : 'I listen carefully by the office door, then inspect the floor for traces.');
  const telemetry = table.telemetry();
  const checks = telemetry.filter(row => row.tool === 'resolve' && row.ok && row.origin === 'policy' && row.basis?.selection_snapshot);
  assert.equal(checks.length, skills.length, JSON.stringify(telemetry.filter(row => row.lane === 'check-selection' || row.tool === 'resolve')
    .map(row => ({lane: row.lane, purpose: row.purpose, status: row.status, needs: row.needs, ok: row.ok, code: row.code, reason: row.reason}))));
  assert.ok(telemetry.some(row => row.lane === 'check-selection' && row.status === 'selected'));
  assert.ok(telemetry.some(row => row.lane === 'check-selection' && row.status === 'no_roll'));
  assert.ok(!table.activeTools().includes('resolve'));
  assert.equal(table.session.lastDrivenRun.status, 'delivered');
});

test('a source NPC SAN receipt covers the same exposure after the turn commits', async t => {
  const home = await mkdtemp(join(bundle, 'exposure-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'san-exposure', locks: api.nativeAdvisoryLocks()});
  const kernel = api.createKernelRuntime(context);
  t.after(() => kernel.close());
  const call = (method, params = {}) => kernel.handlers[method]({campaign: 'exposure', ...params});
  await call('campaign.create', {id: 'exposure', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'I look at Corbitt.'});
  let n = 0;
  for (const to of ['corbitt-house-ground', 'basement-rites', 'corbitt-confrontation'])
    await call('table.apply', {call_id: `t1-c${++n}`, effects: [{kind: 'move', to, travel_minutes: 0}]});
  const options = await call('table.resolve.options');
  const san = options.selection.options.find(option => option.action.decision === 'sanity:check' && option.action.target === 'Walter Corbitt');
  assert.equal(san.action.san_loss, '1/1D8');
  assert.equal(san.parameters.find(parameter => parameter.name === 'involuntary').selection, 'compatible');
  await call('table.resolve', {call_id: `t1-c${++n}`, action: {...san.action, involuntary: 'freeze'}});
  const status = await call('table.status');
  assert.ok(status.receipts.some(receipt => receipt.skill === 'SAN' && typeof receipt.npc_exposure === 'string' && receipt.npc_exposure.length), JSON.stringify(status.receipts));
  await call('table.narrate', {call_id: `t1-c${++n}`, text: 'The shriveled body opens its eyes before you.'});
  await call('table.player_input', {text: 'I keep watching the same body.'});
  const next = await call('table.resolve.options');
  assert.ok(!next.selection.options.some(option => option.action.decision === 'sanity:check' && option.action.target === 'Walter Corbitt'));
});

test('combat end exposes the engine outcomes and actually closes a live session', async t => {
  const home = await mkdtemp(join(bundle, 'combat-end-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'combat-outcomes', locks: api.nativeAdvisoryLocks()});
  const kernel = api.createKernelRuntime(context);
  t.after(() => kernel.close());
  const call = (method, params = {}) => kernel.handlers[method]({campaign: 'combat-end', ...params});
  await call('campaign.create', {id: 'combat-end', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.player_input', {text: 'We begin a practice bout.'});
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult', why: 'Prepared sparring partner.'}]});
  await call('table.resolve', {call_id: 't1-c2', action: {intent: 'combat', decision: 'combat:attack', target: 'Steven Knott', weapon: 'unarmed', goal: 'Practice a punch', method: 'Unarmed sparring'}});
  let n = 2, options = await call('table.resolve.options');
  const pending = options.context.session.pending_defense;
  if (pending) {
    await call('table.resolve', {call_id: `t1-c${++n}`, action: {intent: 'combat', decision: 'combat:defend', actor: pending.actor, defense: 'dodge', goal: 'Evade the punch', method: 'Dodge'}});
    options = await call('table.resolve.options');
  }
  const end = options.context.session.actions.find(action => action.decision === 'combat:end');
  assert.deepEqual(options.context.combat_outcomes, ['fled', 'investigators_win', 'monsters_win', 'stalemate']);
  const investigator = options.context.session.participants.find(person => person.side === 'investigator').name;
  const candidates = buildCandidates({capsule: {}, applyOptions: {}, resolveOptions: {...options, context: {...options.context,
    session: {...options.context.session, turn_of: investigator, actions: [{...end, actor: investigator}]}}}}, 'We agree to stop sparring.');
  const ending = candidates.find(candidate => candidate.bound.decision === 'combat:end');
  assert.equal(ending.unbound[0].vocabulary, 'closed');
  assert.deepEqual(ending.unbound[0].options, options.context.combat_outcomes);
  await call('table.resolve', {call_id: `t1-c${++n}`, action: {intent: 'combat', decision: 'combat:end', outcome: 'stalemate', goal: 'End the agreed practice', method: 'Both stop'}});
  assert.ok((await call('table.status')).receipts.some(receipt => receipt.kind === 'session' && receipt.transition === 'end' && receipt.outcome === 'stalemate'));
  assert.equal((await call('table.resolve.options')).context.session, null);
});
