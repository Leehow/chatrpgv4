/** Production decision seams; these bounded observations are not gameplay acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {createStepPolicy, initialView, routeBatch} from '../../runtime/jev/step-policy.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';

const scope = {owner: 'campaign:test', campaign: 'test', worldline: 'main', loop: 0, audience: 'keeper'};
const context = {scene: 'station', clock: null, present: ['Jack'], receipts: ['already-landed']};

test('route fits rich shared scene evidence and retains placement conditions without loading binder guidance', () => {
  const scene = 'The attendants wait in the shade. '.repeat(200);
  const reads = {capsule: {where: {scene: 'station'}}, applyOptions: {candidates: Array.from({length: 3}, (_, i) => ({
    effect: {kind: 'npc', name: `Attendant ${i}`, to: 'station'}, description: {kind: 'source_presence', name: `Attendant ${i}`, scene: 'station',
      actor: {name: `Attendant ${i}`, summary: 'Present only during the day.', placement_conditions: {when: {kind: 'daylight'}},
        source_needs: [{kind: 'runtime_context', question: 'Has the shift started?', trigger: 'initial presence'}]}, scene_context: scene},
  }))}, resolveOptions: {revision: 'r', decisions: Array.from({length: 23}, (_, i) => ({name: `family:${i}`, description: `Inspect rule family ${i}`,
    guidance: [{text: 'Detailed rules for the selected check only. '.repeat(300)}]})), selection: {version: 1, owner: 'jev',
    options: Array.from({length: 23}, (_, i) => ({family: 'rules', label: `Concrete trigger ${i}`, action: {decision: `family:${i}`, actor: 'Jack'},
      authorization: 'declaration', needs: [], facts: {trigger: 'an explicitly declared attempt'}, parameters: []}))}}};
  const candidates = buildCandidates(reads, 'I inspect the tire.');
  assert.equal(candidates.length, 26);
  const view = initialView({runId: 'r', rawInput: 'I inspect the tire.', context, candidates, readFirst: false, compile: false});
  const {batch} = routeBatch(view, scope, []), {estimate} = packDecisionBatch(batch);
  assert.ok(estimate.stateUpperBound + estimate.longestQuestionUpperBound < 32000);
  assert.equal(Object.keys(batch.state.source_presence_contexts).length, 1);
  assert.equal(batch.state.source_presence_contexts.scene_1, scene, 'the source text is shared exactly, not truncated');
  assert.deepEqual(batch.state.candidates.candidate_1.detail.actor.placement_conditions, {when: {kind: 'daylight'}});
  assert.equal(batch.state.candidates.candidate_1.detail.actor.source_needs[0].question, 'Has the shift started?');
  assert.equal(batch.state.rule_guidance, undefined);
  assert.ok(candidates.find(row => row.bound.decision === 'family:0').detail.rule_guidance[0].length > 10000,
    'full guidance remains host-owned for the selected binder');
});

function driver(policyState) {
  return {policyState, observations: [], pendingProposals: [], pendingRequirements: [], delivery: 'none'};
}

for (const purpose of ['route', 'bind', 'compile', 'reask']) test(`${purpose} packing refusal becomes a zero-call compose (§163: its checks a recorded no-roll) and preserves landed state`, () => {
  const candidate = {key: 'check', verb: 'resolve', family: 'core-check', label: 'Inspect the tire', bound: {decision: 'core-check:ordinary-check'},
    detail: {trigger: 'uncertain inspection', evidence: 'x'.repeat(40000)}, checkOwner: 'jev', unbound: [], clerk: 'declared_check'};
  const policy = createStepPolicy({context, candidates: [candidate], readFirst: false, compile: purpose === 'compile'});
  const state = {...policy.initial({runId: 'r', rawInput: ['compile', 'reask'].includes(purpose) ? 'x'.repeat(40000) : 'I inspect the tire.'}), scope, readSet: []};
  state.view.interactionScope = {mode: 'world', reason: 'test', calls: 0};
  if (purpose === 'bind') {
    candidate.unbound = [{name: 'target', required: true, vocabulary: 'closed', options: ['tire', 'rim']}];
    state.view.pending = [{kind: 'decide', purpose: 'bind', candidate}];
  }
  if (purpose === 'compile') {
    // A compile-owned move ensures the declaration compile is due.
    state.view.candidates.push({key: 'apply:move:yard', verb: 'apply', family: 'move', label: 'Move to yard', bound: {kind: 'move', to: 'yard'}, unbound: []});
    state.view.rows = {act: [{id: 'move', label: 'Move'}], destination: [{id: 'yard', label: 'yard'}]};
  }
  if (purpose === 'reask') {
    state.view.candidates.push({key: 'apply:clue:trace', verb: 'apply', family: 'clue', label: 'Trace', bound: {kind: 'clue', clue: 'trace'}, unbound: []});
    state.view.pending = [{kind: 'decide', purpose: 'reask', extra: {settled: [], clues: ['apply:clue:trace'], after: 'landed'}}];
  }
  const request = policy.next(driver(state));
  assert.equal(request.kind, 'decide');
  assert.equal(request.purpose, purpose);
  assert.equal(request.question.offline, 'packing_limit');
  const reduced = policy.reduce(state, {kind: 'decide', status: 'unavailable', artifact: {reason: 'offline_packing_limit'}, ms: 0}, driver(state));
  assert.equal(reduced.view.budget.jevCalls, 0);
  assert.deepEqual(reduced.view.context.receipts, ['already-landed']);
  // §163: no unresolved hold or notice; the compose's projection records the unjudged checks as a forced no-roll.
  assert.equal(reduced.view.unresolvedChecks, undefined);
  const next = policy.next(driver(reduced));
  assert.deepEqual([next.kind, next.purpose, next.reason], ['infer', 'compose', 'jev_packing_limit']);
});

test('a packing refusal during a reference query does not invent a gameplay check need', () => {
  const policy = createStepPolicy({context, readFirst: false, compile: false});
  const state = {...policy.initial({runId: 'r', rawInput: 'x'.repeat(40000)}), scope, readSet: []};
  state.view.interactionScope = {mode: 'reference', reason: 'paused', calls: 0};
  assert.equal(policy.next(driver(state)).question.offline, 'packing_limit');
  const reduced = policy.reduce(state, {kind: 'decide', status: 'unavailable', artifact: {reason: 'offline_packing_limit'}, ms: 0}, driver(state));
  assert.equal(reduced.view.unresolvedChecks, undefined);
});
