// Policy tests with a stub DecisionPort and a stub executor. No network, no kernel, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
// The policy is the product's (runtime/jev/step-policy.ts, SL-01); runTurn is the prototype's driver over it.
import {next, initialView, routeDigest, DEFAULT_BUDGET} from '../../runtime/jev/step-policy.ts';
import {runTurn} from './loop.ts';

const scope = {owner: 'campaign:test', campaign: 'test', worldline: 'main', loop: 0, audience: 'keeper'};
const context = {scene: 'office', clock: {minutes: 0}, present: ['A'], receipts: []};
const bound = {key: 'apply:move:b', verb: 'apply', family: 'move', label: 'Move to B', source: 'stub', bound: {kind: 'move', to: 'b'},
  unbound: [{name: 'travel_minutes', required: false, vocabulary: 'open'}]};
const open = {key: 'apply:person:A', verb: 'apply', family: 'person', label: 'Stage A', source: 'stub', bound: {kind: 'person', who: 'A'},
  unbound: [{name: 'name', required: true, vocabulary: 'open'}]};
const closed = {key: 'resolve:x:A', verb: 'resolve', family: 'mod_check', label: 'Check A', source: 'stub', bound: {decision: 'x'},
  unbound: [{name: 'intent', required: true, vocabulary: 'closed', options: ['social', 'investigate']}]};

function view(overrides = {}) {
  return {...initialView({runId: 'r', rawInput: 'go to B', context, candidates: [bound, open, closed], readFirst: false}), ...overrides};
}
/** Answer every question of a batch: `answers` maps question key → choice (or [choice, confidence]); the rest answer `later`/`continue`. */
function answer(batch, answers = {}, confidence = 0.9) {
  const out = {};
  for (const question of batch.questions) {
    const given = answers[question.key];
    const [choice, own] = Array.isArray(given) ? given : [given ?? (question.key === 'exit' ? 'continue' : Object.keys(question.criteria)[0] === 'now' ? 'later' : Object.keys(question.criteria)[0]), confidence];
    out[question.key] = {status: 'answered', type: 'choice', choice, confidence: own};
  }
  return {batchId: batch.id, status: 'complete', answers: out, coverage: {required: Object.keys(out), answered: Object.keys(out), unknown: []}, issues: []};
}
/** A stub port answering from a script; each entry sees the batch. Counts every call. */
function ports(script, overrides = {}) {
  const calls = [];let clock = 0;
  return {calls, ports: {
    scope, readSet: () => [], now: () => clock += 5,
    async decide(batch) {calls.push(batch);const entry = script.shift();assert.ok(entry, 'unexpected Jev call');return entry(batch);},
    async locate() {return {calls: 1, ms: 5, summary: {}};},
    async bindOrdinary() {return {disposition: 'unknown', unresolved: [], calls: 0, ms: 0};},
    async execute(candidate) {return {ok: true, summary: {executed: candidate.key}};},
    async read() {return {materials: [], located: [], summary: {read: 0}};},
    async refresh(current) {return {context: current.context, candidates: current.candidates.filter(value => !current.consumed.includes(value.key))};},
    projectionBytes: () => 100,
    ...overrides,
  }};
}

test('a determined step is executed directly without a Jev call', async () => {
  const start = view({pending: [{kind: 'direct', purpose: 'execute', candidate: bound}]});
  assert.equal(next(start).kind, 'direct');
  const {calls, ports: stub} = ports([batch => answer(batch, {exit: 'finish'})]);
  const {telemetry} = await runTurn(stub, start);
  assert.equal(telemetry[0].kind, 'direct');
  assert.equal(telemetry[0].jev_calls, 0);
  assert.equal(telemetry[0].choice, bound.key);
  assert.equal(calls.length, 1, 'only the later open step asked Jev');
});

test('an open step goes to Jev as one need question per candidate plus the exit', async () => {
  const start = view();
  const request = next(start);
  assert.equal(request.kind, 'decide');
  assert.equal(request.purpose, 'route');
  const {calls, ports: stub} = ports([batch => answer(batch, {exit: 'finish'})]);
  await runTurn(stub, start);
  assert.deepEqual(calls[0].questions.map(question => question.key), ['need_1', 'need_2', 'need_3', 'exit']);
  assert.deepEqual(Object.keys(calls[0].questions[0].criteria), ['now', 'later', 'unknown']);
  assert.deepEqual(Object.keys(calls[0].questions[3].criteria), ['continue', 'ask_llm', 'read_more', 'finish']);
});

test('needs judged now run in structural order: the person before the check before the move', async () => {
  // Route (all three now) → LLM bind of the person + its proposal slot → Jev binds the check → executes → the move → route again → finish.
  const {ports: stub} = ports([batch => answer(batch, {need_1: 'now', need_2: 'now', need_3: 'now'}), batch => answer(batch, {intent: 'social'}), batch => answer(batch, {exit: 'finish'})]);
  const {telemetry} = await runTurn(stub, view());
  const executed = telemetry.filter(row => row.kind === 'direct' || (row.kind === 'infer' && row.purpose === 'bind')).map(row => row.choice);
  // person (open → LLM bind + proposal slot), then the closed check (Jev bind → execute), then the move.
  assert.deepEqual(executed.slice(0, 2), [open.key, open.key]);
  assert.ok(executed.indexOf(closed.key) < executed.indexOf(bound.key));
});

test('a low-confidence need is not selected; a low-confidence exit goes to the LLM', async () => {
  const {ports: stub} = ports([batch => answer(batch, {need_1: ['now', 0.3], exit: ['continue', 0.3]})]);
  const {telemetry, view: after} = await runTurn(stub, view(), {gate: 0.6});
  assert.deepEqual(telemetry.map(row => [row.kind, row.purpose]), [['decide', 'route'], ['infer', 'adjudicate'], ['finish', 'finish']]);
  assert.equal(telemetry[1].reason, 'low_confidence');
  assert.equal(after.observations.some(value => value.kind === 'direct'), false);
});

test('a margin lead clears the gate even when the reported confidence does not', async () => {
  const {ports: stub} = ports([batch => {
    const result = answer(batch, {need_1: ['now', 0.4], exit: 'continue'});
    result.answers.need_1.probabilities = {now: 0.6, later: 0.2, unknown: 0.2};
    return result;
  }, batch => answer(batch, {exit: 'finish'})]);
  const {telemetry} = await runTurn(stub, view(), {gate: 0.6});
  assert.equal(telemetry[1].kind, 'direct');
  assert.equal(telemetry[1].choice, bound.key);
});

test('ask_llm with nothing selected is a legal answer and goes to the LLM', async () => {
  const {ports: stub} = ports([batch => answer(batch, {exit: 'ask_llm'})]);
  const {telemetry} = await runTurn(stub, view());
  assert.equal(telemetry[1].kind, 'infer');
  assert.equal(telemetry[1].reason, 'ask_llm');
});

test('the same question over the same candidates and materials escalates to the LLM', async () => {
  const start = view();
  assert.deepEqual(next({...start, asked: [routeDigest(start)]}), {kind: 'infer', purpose: 'adjudicate', reason: 'repeated_question'});
  // read_more that reads nothing new leaves the question identical; the second ask is not sent to Jev.
  const {calls, ports: stub} = ports([batch => answer(batch, {exit: 'read_more'})]);
  const {telemetry} = await runTurn(stub, {...start, located: true});
  assert.equal(calls.length, 1);
  assert.deepEqual(telemetry.map(row => [row.kind, row.purpose, row.reason ?? null]).slice(0, 3),
    [['decide', 'route', 'read_more'], ['direct', 'read', null], ['infer', 'adjudicate', 'repeated_question']]);
});

test('after an LLM step the next step is direct or finish, never a Jev decision', async () => {
  const afterInfer = view({observations: [{step: 1, kind: 'infer', purpose: 'bind', status: 'recorded'}],
    pending: [{kind: 'decide', purpose: 'bind', candidate: closed}]});
  assert.equal(next(afterInfer).kind, 'finish');
  // An open-parameter candidate: infer(bind), then the direct execution slot of its proposal, with no Jev call between.
  const {calls, ports: stub} = ports([batch => answer(batch, {need_2: 'now'}), batch => answer(batch, {exit: 'finish'})]);
  const {telemetry} = await runTurn(stub, view());
  assert.deepEqual(telemetry.slice(0, 3).map(row => [row.kind, row.purpose]), [['decide', 'route'], ['infer', 'bind'], ['direct', 'llm_proposal']]);
  assert.equal(calls.length, 2, 'Jev is asked again only after the direct slot');
});

test('a closed parameter is bound by Jev and then executed directly', async () => {
  const {calls, ports: stub} = ports([batch => answer(batch, {need_3: 'now'}), batch => answer(batch, {intent: 'social'}), batch => answer(batch, {exit: 'finish'})]);
  const {telemetry} = await runTurn(stub, view());
  assert.deepEqual(telemetry.slice(0, 3).map(row => [row.kind, row.purpose]), [['decide', 'route'], ['decide', 'bind'], ['direct', 'execute']]);
  assert.deepEqual(calls[1].questions.map(question => question.key), ['intent']);
});

test('an exhausted Jev budget hands the close to the LLM', async () => {
  const spent = view({budget: {...view().budget, jevCalls: DEFAULT_BUDGET.maxJevCalls}});
  assert.deepEqual(next(spent), {kind: 'infer', purpose: 'compose', reason: 'jev_budget'});
  const slow = view({budget: {...view().budget, jevMs: DEFAULT_BUDGET.maxJevMs}});
  assert.equal(next(slow).kind, 'infer');
  const {calls, ports: stub} = ports([]);
  const {telemetry} = await runTurn(stub, spent);
  assert.equal(calls.length, 0);
  assert.equal(telemetry[0].reason, 'jev_budget');
});

// SL-02: structure selects a step the kernel forces (an NPC's pending defence), and a closed choice among the
// actions the kernel issues runs the chosen one with its own parameters.
const forcedDefence = {key: 'resolve:combat:defend:knott:tom:r2', verb: 'resolve', family: 'combat', label: 'Knott defends', source: 'stub', forced: true,
  bound: {decision: 'combat:defend', actor: 'knott', defense: 'dodge'}, unbound: []};
const npcTurn = {key: 'resolve:combat:turn:knott:r2', verb: 'resolve', family: 'combat', label: 'Knott acts', source: 'stub', forced: true,
  bound: {actor: 'knott'}, unbound: [{name: 'decision', required: true, vocabulary: 'closed', options: ['combat:attack', 'combat:maneuver']}],
  variants: {'combat:attack': {label: 'Knott attacks Tom', bound: {decision: 'combat:attack', actor: 'knott', target: 'tom'}, unbound: []},
    'combat:maneuver': {label: 'Knott manoeuvres', bound: {decision: 'combat:maneuver', actor: 'knott'}, unbound: [{name: 'goal', required: true, vocabulary: 'open'}]}}};

test('a step the kernel forces runs before any route question, without asking Jev', async () => {
  let reads = 0;
  const {calls, ports: stub} = ports([batch => answer(batch, {exit: 'finish'})], {
    async refresh(current) { reads++; return {context: current.context, candidates: reads === 1 ? [forcedDefence, bound] : [bound].filter(value => !current.consumed.includes(value.key))}; },
  });
  const {telemetry} = await runTurn(stub, {...initialView({runId: 'r', rawInput: 'hit him', context, candidates: []})});
  assert.deepEqual(telemetry.slice(0, 3).map(row => [row.kind, row.purpose, row.choice]), [['direct', 'read', null], ['direct', 'execute', forcedDefence.key], ['decide', 'route', 'finish']]);
  assert.equal(calls.length, 1, 'Jev was asked only the route question after the forced step');
});

test('a closed choice among issued actions runs the chosen action with its own parameters', async () => {
  const executed = [];
  let reads = 0;
  const {ports: stub} = ports([batch => answer(batch, {decision: 'combat:attack'}), batch => answer(batch, {exit: 'finish'})], {
    async refresh(current) { reads++; return {context: current.context, candidates: reads === 1 ? [npcTurn] : []}; },
    async execute(candidate) { executed.push(candidate); return {ok: true, summary: {executed: candidate.key}}; },
  });
  const {telemetry} = await runTurn(stub, initialView({runId: 'r', rawInput: 'hit him', context, candidates: []}));
  assert.deepEqual(telemetry.slice(0, 3).map(row => [row.kind, row.purpose]), [['direct', 'read'], ['decide', 'bind'], ['direct', 'execute']]);
  assert.deepEqual(executed.map(candidate => [candidate.key, candidate.bound.decision, candidate.bound.target]), [[npcTurn.key, 'combat:attack', 'tom']]);
});
