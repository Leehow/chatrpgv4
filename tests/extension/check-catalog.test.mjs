/** Real kernel seams only; these controlled selections are not gameplay acceptance. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {validateCheckOptions} from '../../runtime/jev/resolve-selection.ts';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.tmp'), {recursive: true});
const bundle = await mkdtemp(join(root, '.tmp/check-catalog-test-'));
after(() => rm(bundle, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'check-catalog-api.ts'},
  outfile: join(bundle, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);

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
  assert.ok(checks.some(option => option.action.decision === 'healing:first-aid-ordinary' && !option.needs.length));
  assert.deepEqual(await call('table.status'), before, 'catalog projection cannot roll or change the turn');
  const candidates = buildCandidates({capsule: await call('table.capsule'), applyOptions: await call('table.apply.options'), resolveOptions: options}, 'I listen carefully, then inspect the office.');
  assert.ok(candidates.filter(candidate => candidate.unbound.some(parameter => parameter.binder === 'resolve-selection')).length > 1);
  assert.ok(candidates.filter(candidate => candidate.unbound.some(parameter => parameter.binder === 'resolve-selection')).every(candidate => typeof candidate.bound.decision === 'string'));
  assert.equal(candidates.some(candidate => candidate.unbound.some(parameter => parameter.binder === 'ordinary-resolve')), false,
    'one current binder owns ordinary checks; the earlier preflight does not repeat them');
  assert.ok(candidates.filter(candidate => candidate.verb === 'resolve').every(candidate => candidate.checkOwner === 'jev'));
  assert.deepEqual(candidates.find(candidate => candidate.bound.decision === 'core-check:ordinary-check').detail.rule_guidance, guidance.map(rule => rule.text));
  const action = {...listen.action, modifiers: {difficulty: 'regular', bonus_dice: 0, penalty_dice: 0, reason: 'the declared method'}};
  const result = await call('table.resolve', {action, call_id: 't1-c1'});
  assert.ok(result.receipts.length, 'an issued ordinary action reaches the real TS resolver');
  const next = await call('table.resolve.options');
  assert.notEqual(next.world_revision, options.world_revision, 'the execution invalidates earlier selection snapshots');
  assert.ok(next.context.current_receipts.some(receipt => receipt.skill === 'Listen'));
});

for (const skills of [['Listen'], ['Listen', 'Spot Hidden']]) test(`the agent commits ${skills.join(' then ')} through the canonical gateway without a model resolve`, async t => {
  const decision = {async decide(batch) {
    const settled = new Set(batch.state.context?.current_receipts?.filter(receipt => receipt.kind === 'roll').map(receipt => receipt.skill));
    const answers = Object.fromEntries(batch.questions.map(question => {
      if (question.type === 'noul') {
        let p = 0;
        if (batch.family === 'check-selection-profiles' && question.key === 'remaining') p = skills.some(skill => !settled.has(skill)) ? 1 : 0;

        if (batch.family === 'check-selection-need' && !question.key.endsWith('_blocked')) {
          const check = batch.state.checks[question.key.replace(/_(uncertain|unsettled)$/, '')];
          p = skills.includes(check?.action?.skill) && !settled.has(check.action.skill) && check.action.actor === batch.state.context.conditions[0].actor ? 1 : 0;
        }
        if (batch.family === 'check-selection-need' && question.key.endsWith('_blocked')) {
          const check = batch.state.checks[question.key.replace(/_blocked$/, '')];
          p = check?.action?.skill === 'Spot Hidden' && !settled.has('Listen') ? 1 : 0;
        }
        if (batch.family === 'check-selection-authority') p = 1;
        return [question.key, {status: 'answered', type: 'noul', noul: p}];
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
      return [question.key, {status: 'answered', type: 'choice', choice: selected, confidence: 1,
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
