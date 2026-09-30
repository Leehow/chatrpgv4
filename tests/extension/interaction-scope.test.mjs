import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionScopeBatch, interpretInteractionScope, permitsReferenceOperation} from '../../runtime/jev/interaction-scope.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {createStepPolicy, initialView, next, settleRead} from '../../runtime/jev/step-policy.ts';
import {admissionRequest} from '../../extensions/kernel/admission.ts';

const scope = {owner: 'scope-test', campaign: 'test', audience: 'keeper'};
const context = {scene: 'office', clock: {}, present: ['Knott'], receipts: []};
const batch = interactionScopeBatch('Pause the fiction. Explain how newspaper archives worked.', {player_text: 'I speak with Knott.'}, scope);
const answer = (world, system) => bindDecisionAnswers(batch, {
  world_action: {type: 'noul', status: 'answered', noul: world},
  system_request: {type: 'noul', status: 'answered', noul: system},
}, {inputTokens: 1, outputTokens: 1, costUsd: 0});

test('scope separates authorization from subject matter and has no guessed permission', () => {
  assert.equal(packDecisionBatch(batch).request.questions.world_action.type, 'noul');
  assert.equal(interpretInteractionScope(answer(0.04, 0.87)).mode, 'reference');
  assert.equal(interpretInteractionScope(answer(0.95, 0.1)).mode, 'world');
  assert.equal(interpretInteractionScope(answer(0.95, 0.95)).mode, 'world', 'an explicitly mixed request can authorize a world act');
  assert.equal(interpretInteractionScope(answer(0.6, 0.5)).mode, 'uncertain');
  assert.equal(interpretInteractionScope(undefined).mode, 'uncertain');
});

test('reference tool subtypes exclude graph preparation and world effects', () => {
  for (const tool of ['apply', 'resolve', 'ask', 'propose']) assert.equal(permitsReferenceOperation(tool, {}), false);
  assert.equal(permitsReferenceOperation('lookup', {kind: 'adaptation', action: 'prepare'}), false);
  assert.equal(permitsReferenceOperation('lookup', {kind: 'source'}), false);
  assert.equal(permitsReferenceOperation('lookup', {kind: 'source', source_mode: 'answer'}), true);
  assert.equal(permitsReferenceOperation('lookup', {kind: 'historical_reference', action: 'read'}), true);
});

test('authorization sees a non-rolling settlement and cannot reuse it for a different ending', () => {
  const request = changes => admissionRequest('resolve', {action: {actor: 'Ada', intent: 'combat', decision: 'combat:end',
    goal: 'End the agreed practice', method: 'Both stop', outcome: 'stalemate', ...changes}}, {party: ['Ada'], scene: {handle: 'yard', label: 'Yard'}});
  const stop = request({});
  assert.match(stop.lines[0], /decision="combat:end"/);
  assert.ok(!stop.lines[0].includes('roll the dice'));
  assert.notEqual(stop.key, request({decision: 'combat:attack'}).key);
  assert.notEqual(stop.key, request({outcome: 'investigators_win'}).key);
});

test('scope is asked before the first read or forced operation in a production policy', () => {
  const policy = createStepPolicy({context, requireInteractionScope: true});
  const state = policy.initial({runId: 'r', rawInput: 'Explain the rules.', inputRevision: 'i'});
  assert.deepEqual(next(state.view), {kind: 'decide', purpose: 'interaction-scope'});
});

test('reference reads cannot queue forced combat or NPC acts, and only their read grant is routed', () => {
  const view = initialView({runId: 'meta', rawInput: 'Explain the rules.', context, candidates: []});
  view.interactionScope = {mode: 'reference', calls: 1, reason: 'out_of_fiction_request'};
  const forced = {key: 'defend', verb: 'resolve', family: 'combat', label: 'Defend', bound: {decision: 'combat:defend'},
    unbound: [], clerk: 'session_step', source: 'fixture', forced: true};
  view.pending = [];
  settleRead(view, 2, {materials: [], summary: {}}, {context, candidates: [forced]}, 1);
  assert.deepEqual(view.candidates, []);
  assert.equal(view.pending.length, 0);
  assert.equal(next(view).purpose, 'route');
  view.referenceRouted = true;
  assert.deepEqual(next(view), {kind: 'infer', purpose: 'compose', reason: 'reference_request'});
  view.interactionScope = {mode: 'uncertain', calls: 0, reason: 'scope_unavailable'};
  assert.equal(next(view).reason, 'interaction_scope_uncertain');
});
