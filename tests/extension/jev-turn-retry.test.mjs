/**
 * Audit 1101 (Jev retry audit): the Jev failures were connections that never reached Jev (undici UND_ERR_CONNECT_TIMEOUT,
 * a fetch TypeError), which every family without `retryNetwork` reported as `service_error` at once. This file holds the
 * adapter's shared behaviour (a default policy for the families a shared adapter does not name; a retry never pushed past
 * the deadline; a budget that holds one attempt and not its retry still gets that attempt) and, per changed family, its own
 * policy and deadline over a fake transport: a reset answered on the retry, a lasting reset bounded to two attempts.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDecisionAdapter, JEV_TURN_RETRY} from '../../runtime/jev/decision-adapter.ts';
import {JEV_MODEL, packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {CLUE_ROUTE_RETRY} from '../../extensions/kernel/clue-route.ts';
import {WRITING_SURFACES_RETRY} from '../../extensions/mods/writing-surfaces.ts';

const readSet = [{kind: 'world', resource: 'campaign-a', revision: 'w1'}];
const scope = {owner: 'retry-test', campaign: 'campaign-a', worldline: 'main', loop: 0, audience: 'keeper'};
const batch = family => ({id: `b-${family}`, model: JEV_MODEL, family, familyVersion: '1', scope, readSet, state: {said: 'x'},
  questions: [{key: 'q', target: 't', instructions: 'Is it so?', type: 'noul', criteria: {true: 'yes', false: 'no'}}]});
const lease = (ms, budget = {}) => new TaskLease({owner: 'retry-test', goal: 'answer', scope, capabilities: ['decision'], readSet,
  budget: {deadlineAt: Date.now() + ms, remainingInputTokens: 1_000_000, remainingOutputTokens: 1_000_000, remainingCostUsd: 10, remainingActions: 10, ...budget}});
const ok = () => new Response(JSON.stringify({model: JEV_MODEL, answers: {q: {type: 'noul', noul: 0.8}}, usage: {input_tokens: 10, output_tokens: 2}}),
  {status: 200, headers: {'Content-Type': 'application/json'}});
const reset = () => { throw new TypeError('fetch failed', {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}}); };
/** `plan(n)`: what the n-th request gets ('reset', 'hang', a status, or an answer). */
const transport = (plan, calls) => async (_url, init) => {
  calls.n++; const what = plan(calls.n);
  if (what === 'reset') reset();
  if (what === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true}));
  if (typeof what === 'number') return new Response('busy', {status: what, headers: {'retry-after-ms': '5'}});
  return ok();
};
async function decide(options, family, ms, plan, budget) {
  const calls = {n: 0}, owner = lease(ms, budget);
  try { return {result: await createDecisionAdapter({apiKey: 'test-only', fetcher: transport(plan, calls), ...options}).decide(batch(family), owner), calls: calls.n}; }
  finally { owner.close(); }
}

test('a shared adapter\'s default policy covers the families it does not name; a named policy wins', async () => {
  const shared = {defaultRetryPolicy: JEV_TURN_RETRY, retryPolicies: {named: {maxRetries: 0, backoffInitialMs: 0, backoffMaxMs: 0}}};
  const unnamed = await decide(shared, 'any-turn-family', 4000, n => n === 1 ? 'reset' : 'ok');
  assert.equal(unnamed.result.status, 'complete'); assert.equal(unnamed.calls, 2);
  const named = await decide(shared, 'named', 4000, n => n === 1 ? 'reset' : 'ok');
  assert.equal(named.result.failure.code, 'service_error'); assert.equal(named.calls, 1);
  const none = await decide({}, 'any-turn-family', 4000, n => n === 1 ? 'reset' : 'ok');
  assert.equal(none.result.failure.code, 'service_error', 'without a default, as before: no retry'); assert.equal(none.calls, 1);
});

test('a retry never passes the deadline: a stalled connection uses the deadline, and a wait past it is not taken', async () => {
  const began = Date.now();
  const stalled = await decide({defaultRetryPolicy: JEV_TURN_RETRY}, 'f', 300, () => 'hang');
  assert.equal(stalled.result.failure.code, 'timeout'); assert.equal(stalled.calls, 1, 'no time left for a retry');
  assert.ok(Date.now() - began < 1500);
  const late = await decide({defaultRetryPolicy: {...JEV_TURN_RETRY, backoffInitialMs: 5000, backoffMaxMs: 5000}}, 'f', 1000, n => n === 1 ? 'reset' : 'ok');
  assert.equal(late.result.failure.code, 'service_error'); assert.equal(late.calls, 1, 'a backoff past the deadline is not slept');
});

test('a budget that holds one attempt and not its retry still gets the attempt, never budget_exhausted', async () => {
  const one = packDecisionBatch(batch('f')).estimate.totalUpperBound;
  const tight = await decide({defaultRetryPolicy: JEV_TURN_RETRY}, 'f', 4000, () => 'ok', {remainingInputTokens: one * 2 - 1});
  assert.equal(tight.result.status, 'complete'); assert.equal(tight.calls, 1);
  const noRetry = await decide({defaultRetryPolicy: JEV_TURN_RETRY}, 'f', 4000, n => n === 1 ? 'reset' : 'ok', {remainingInputTokens: one * 2 - 1});
  assert.equal(noRetry.result.failure.code, 'service_error'); assert.equal(noRetry.calls, 1, 'the retry the budget cannot hold is not sent');
  const none = await decide({defaultRetryPolicy: JEV_TURN_RETRY}, 'f', 4000, () => 'ok', {remainingInputTokens: one - 1});
  assert.equal(none.result.failure.code, 'budget_exhausted', 'a budget short of one attempt is refused as before');
});

// Each changed family with the policy its adapter now passes and the shortest deadline its call has (file:line in
// kp-translate-only/jev-retry-audit-1101.md).
const FAMILIES = [
  ['action-admission (hybrid turn port)', JEV_TURN_RETRY, 4000], ['continuous-action-admission (hybrid turn port)', JEV_TURN_RETRY, 4000],
  ['held-act-outcome', JEV_TURN_RETRY, 2000], ['continuous-turn (hybrid turn port)', JEV_TURN_RETRY, 4000],
  ['memory-read (hybrid turn port)', JEV_TURN_RETRY, 45000], ['keeper-support-agent (session adapter, support lookup)', JEV_TURN_RETRY, 12000],
  ['keeper-support-locate', JEV_TURN_RETRY, 1000], ['band-recovery', JEV_TURN_RETRY, 4000], ['untold-name-spans', JEV_TURN_RETRY, 2500],
  ['cast-public-figures', JEV_TURN_RETRY, 2500], ['opening-presence', JEV_TURN_RETRY, 4000], ['owned-document-binding', JEV_TURN_RETRY, 4000],
  ['person-name-resolution', JEV_TURN_RETRY, 2500], ['clue-route', CLUE_ROUTE_RETRY, 8000], ['equipment-writing-surfaces', WRITING_SURFACES_RETRY, 30000],
  ['setup-input-route / setup-card-fields / setup-interest-fit', {maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 800, retryNetwork: true}, 8000],
  ['source-* reader families, source-visual-funnel', {maxRetries: 1, backoffInitialMs: 250, backoffMaxMs: 1000, retryNetwork: true}, 20000],
];
for (const [family, policy, ms] of FAMILIES) test(`${family}: a reset is answered on the retry within ${ms} ms; a lasting reset stops at two attempts`, async () => {
  const options = {retryPolicies: {[family]: policy}};
  const once = await decide(options, family, ms, n => n === 1 ? 'reset' : 'ok');
  assert.equal(once.result.status, 'complete'); assert.equal(once.calls, 2);
  const busy = await decide(options, family, ms, n => n === 1 ? 529 : 'ok');
  assert.equal(busy.result.status, 'complete'); assert.equal(busy.calls, 2, 'a 529 waits its Retry-After and is retried once');
  const down = await decide(options, family, ms, () => 'reset');
  assert.equal(down.result.failure.code, 'service_error'); assert.equal(down.calls, 2, 'bounded');
});
