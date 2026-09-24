/** Offline craft-reference selector. Real adapter reservations; no credentials and no network. */
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createDecisionAdapter, JEV_ENDPOINT, JEV_INPUT_USD_PER_MILLION} from '../../runtime/jev/decision-adapter.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {createTaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {CRAFT_REFERENCE_FAMILY, CRAFT_REFERENCE_NONE, CRAFT_REFERENCE_VERSION, createCraftSelector} from '../../runtime/jev/craft-reference-domain.ts';

const BOOK = 'WHOLE-BOOK-SENTINEL';
const PROMPT = 'KEEPER-PROMPT-SENTINEL';
const cards = JSON.parse(readFileSync(new URL('../../mods/narration-craft/cards.en.json', import.meta.url), 'utf8'));
const starterIds = JSON.parse(readFileSync(new URL('../../mods/narration-craft/starter-ids.json', import.meta.url), 'utf8'));
const byId = new Map(cards.map(card => [card.id, card]));
const starters = starterIds.map(id => byId.get(id));
const hidden = ['nearMiss', 'diagnosis', 'boundaryText', 'why', 'context', 'acceptable', 'stronger', 'alternative', 'elaboration'];

function binding(overrides = {}) {
  return {
    campaign: 'camp-1', worldline: 'main', loop: 2, turn: 4,
    source_revision: 'source-a', world_revision: 'world-a', npc_revision: 'npc-a', memory_revision: 'memory-a', mod_revision: 'mod-a',
    ...overrides,
  };
}
function indexFor(rows = starters, bound = binding()) {
  return {
    status: 'ready',
    provider: {mod: 'narration-craft', version: '1.4.0', digest: 'digest-a'},
    catalog_revision: 'catalog-a',
    binding: bound,
    candidates: rows.map(card => ({id: card.id, title: card.title, purpose: card.purpose, useWhen: card.useWhen, avoidWhen: card.avoidWhen})),
  };
}
function capsule(overrides = {}) {
  return {
    head: BOOK,
    module: {synopsis: BOOK},
    style: PROMPT,
    director: {beat: PROMPT, offer: BOOK},
    turn: {number: 4, player_text: 'I wait by the desk.', pending_choice: PROMPT},
    where: {scene: 'desk'},
    present: [{name: 'Ada'}],
    recent: [{turn: 3, player: 'I look.', keeper: 'Rain.'}],
    ...overrides,
  };
}
function allowance() {
  return {actions: 4, inputTokens: 1_000_000, outputTokens: 80_000, costUsd: 1};
}
function parentOf(budget = {}) {
  const lease = new TaskLease({
    owner: 'prep', goal: 'parent provider budget', scope: {owner: 'prep', audience: 'keeper'}, capabilities: [], readSet: [],
    budget: {deadlineAt: Date.now() + 60_000, remainingActions: 8, remainingInputTokens: 1_000_000, remainingOutputTokens: 80_000, remainingCostUsd: 1, ...budget},
  });
  return {lease, budget: createTaskProviderBudget(lease)};
}
function envelope(choice, criteria, usage = {input_tokens: 20, output_tokens: 5}) {
  const keys = Object.keys(criteria);
  return {model: JEV_MODEL, usage, answers: {method: {type: 'choice', choice, confidence: 1,
    probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0]))}}};
}
function observing(fetcher, seen) {
  const inner = createDecisionAdapter({apiKey: 'super-secret', fetcher});
  return {async decide(batch, lease) {
    seen.push({batch, deadlineAt: lease.context.budget.deadlineAt, scope: lease.context.scope, readSet: lease.context.readSet, actions: lease.context.budget.remainingActions});
    return inner.decide(batch, lease);
  }};
}
function selector(decision, extra = {}) {
  const parent = extra.parent ?? parentOf();
  const owned = extra.allowance ?? allowance();
  const signal = extra.signal ?? new AbortController().signal;
  return {parent, allowance: owned, signal, selector: createCraftSelector({
    decision, parent: parent.budget, allowance: owned, deadlineAt: extra.deadlineAt ?? Date.now() + 60_000, signal,
    ...(extra.record ? {record: extra.record} : {}),
  })};
}
async function codeOf(promise) {
  try { await promise; }
  catch (error) { return error; }
  return undefined;
}

test('no decision port means no selector', () => {
  assert.equal(createCraftSelector({allowance: allowance(), deadlineAt: Date.now() + 1000, signal: new AbortController().signal}), undefined);
});

test('one choice carries the issued descriptions, NONE, and only the current turn state', async () => {
  const seen = [];
  let body = '';
  const calls = [];
  const port = observing(async (url, init) => {
    calls.push(url);
    body = String(init.body);
    const request = JSON.parse(body);
    return Response.json(envelope(starterIds[0], request.questions.method.criteria));
  }, seen);
  const {parent, selector: select} = selector(port);
  try {
    const choice = await select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-7', deadlineAt: Date.now() + 60_000});
    assert.equal(choice, starterIds[0]);
    assert.equal(calls[0], JEV_ENDPOINT);
    const batch = seen[0].batch;
    assert.equal(batch.family, CRAFT_REFERENCE_FAMILY);
    assert.equal(batch.familyVersion, CRAFT_REFERENCE_VERSION);
    assert.equal(batch.model, JEV_MODEL);
    assert.equal(batch.questions.length, 1);
    assert.equal(batch.questions[0].type, 'choice');
    assert.deepEqual(Object.keys(batch.questions[0].criteria), [...starterIds, CRAFT_REFERENCE_NONE]);
    assert.deepEqual(batch.questions[0].criteria[starterIds[0]], {
      title: starters[0].title, purpose: starters[0].purpose, use_when: starters[0].useWhen, do_not_use_when: starters[0].avoidWhen,
    });
    assert.equal(batch.questions[0].target, 'Optional writing reference for the current exchange');
    assert.match(batch.questions[0].instructions, /need not be used/);
    assert.match(batch.questions[0].instructions, /Do not invent NPC motives or facts/);
    assert.match(batch.questions[0].instructions, /not a literary score/);
    const none = batch.questions[0].criteria[CRAFT_REFERENCE_NONE];
    assert.match(none.use_when, /already enough/);
    assert.match(none.use_when, /direct answer/);
    assert.match(none.use_when, /would actually help/);
    assert.match(none.use_when, /not sufficient/);
    assert.equal(JSON.stringify(none).includes('clearly fits'), false);
    assert.match(none.do_not_use_when, /Applicability is not a requirement/);
    assert.deepEqual(Object.keys(batch.state), ['player_text', 'where', 'present', 'recent']);
    assert.equal(batch.state.player_text, 'I wait by the desk.');
    assert.deepEqual(batch.state.where, {scene: 'desk'});
    assert.deepEqual(batch.state.present, [{name: 'Ada'}]);
    assert.equal(JSON.stringify(batch.state).includes(BOOK), false);
    assert.equal(JSON.stringify(batch.state).includes(PROMPT), false);
    for (const card of starters) for (const field of hidden) assert.equal(JSON.stringify(batch).includes(card[field]), false, field);
    assert.equal(seen[0].actions, 1);
    assert.deepEqual(seen[0].scope, batch.scope);
    assert.deepEqual(seen[0].readSet, batch.readSet);
    assert.equal(batch.scope.audience, 'keeper');
    assert.equal(batch.scope.campaign, 'camp-1');
    assert.equal(batch.scope.worldline, 'main');
    assert.equal(batch.scope.loop, 2);
    const revision = kind => seen[0].readSet.find(row => row.kind === kind)?.revision;
    assert.equal(seen[0].readSet.find(row => row.kind === 'source').revision, 'source-a');
    assert.equal(seen[0].readSet.find(row => row.resource === 'camp-1' && row.kind === 'world').revision, 'world-a');
    assert.equal(seen[0].readSet.find(row => row.resource === 'npc:camp-1').revision, 'npc-a');
    assert.equal(revision('memory'), 'memory-a');
    assert.equal(seen[0].readSet.find(row => row.resource === 'mod-revision:narration-craft').revision, 'mod-a');
    const pkg = seen[0].readSet.find(row => row.resource === 'craft-reference:package:narration-craft');
    const catalog = seen[0].readSet.find(row => row.resource === 'craft-reference:catalog:narration-craft');
    assert.equal(pkg.kind, 'family');
    assert.equal(pkg.revision, 'digest-a');
    assert.equal(catalog.kind, 'family');
    assert.equal(catalog.revision, 'catalog-a');
    assert.equal(seen[0].readSet.some(row => row.kind === 'adaptation' || row.kind === 'extraction'), false);
    assert.equal(seen[0].readSet.find(row => row.kind === 'model').revision, JEV_MODEL);
    assert.equal(seen[0].readSet.find(row => row.resource === CRAFT_REFERENCE_FAMILY).revision, CRAFT_REFERENCE_VERSION);
    assert.equal(batch.id.startsWith('craft-reference:epoch-7:'), true);
    const again = [];
    const second = observing(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      return Response.json(envelope(CRAFT_REFERENCE_NONE, request.questions.method.criteria));
    }, again);
    const other = selector(second, {parent});
    assert.equal(await other.selector({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-7', deadlineAt: Date.now() + 60_000}), null);
    assert.equal(again[0].batch.id, batch.id);
    const moved = [];
    const third = observing(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      return Response.json(envelope(CRAFT_REFERENCE_NONE, request.questions.method.criteria));
    }, moved);
    const shifted = selector(third, {parent});
    await shifted.selector({index: indexFor(starters, binding({world_revision: 'world-b'})), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-7', deadlineAt: Date.now() + 60_000});
    assert.notEqual(moved[0].batch.id, batch.id);
    assert.equal(body.includes(starters[0].purpose), true);
    assert.equal(body.includes(BOOK), false);
    assert.equal(body.includes(PROMPT), false);
  } finally { parent.lease.close(); }
});

test('missing turn fields stay unknown or empty and are not invented', async () => {
  const seen = [];
  const port = observing(async (_url, init) => {
    const request = JSON.parse(String(init.body));
    return Response.json(envelope(CRAFT_REFERENCE_NONE, request.questions.method.criteria));
  }, seen);
  const {parent, selector: select} = selector(port);
  try {
    assert.equal(await select({index: indexFor(), capsule: {style: PROMPT}, signal: new AbortController().signal, epoch: 'epoch-empty', deadlineAt: Date.now() + 60_000}), null);
    assert.deepEqual(seen[0].batch.state, {player_text: 'unknown', where: 'unknown', present: [], recent: []});
    assert.equal(JSON.stringify(seen[0].batch).includes(PROMPT), false);
  } finally { parent.lease.close(); }
});

test('wrong batch, foreign, missing, and incomplete answers throw and do not pretend NONE', async () => {
  const respond = (mutate) => {
    const inner = createDecisionAdapter({apiKey: 'super-secret', fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      return Response.json(envelope(starterIds[0], request.questions.method.criteria));
    }});
    return {decide: (batch, lease) => inner.decide(batch, lease).then(mutate)};
  };
  const cases = [
    [respond(result => ({...result, batchId: 'other-batch'})), 'craft_selector_wrong_batch'],
    [respond(result => ({...result, answers: {method: {status: 'answered', type: 'choice', choice: 'foreign-id'}}})), 'craft_selector_foreign_answer'],
    [createDecisionAdapter({apiKey: 'super-secret', fetcher: async () => Response.json({model: JEV_MODEL, answers: {}, usage: {input_tokens: 3, output_tokens: 1}})}), 'craft_selector_missing_answer'],
    [createDecisionAdapter({apiKey: 'super-secret', fetcher: async () => Response.json({model: JEV_MODEL, answers: {method: {type: 'choice', choice: 'nope', confidence: 1, probabilities: {}}}, usage: {input_tokens: 3, output_tokens: 1}})}), 'craft_selector_incomplete'],
  ];
  for (const [decision, code] of cases) {
    const {parent, selector: select} = selector(decision);
    try {
      const error = await codeOf(select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-bad', deadlineAt: Date.now() + 60_000}));
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.equal(error.message.includes('super-secret'), false);
    } finally { parent.lease.close(); }
  }
});

test('the deadline is the minimum of the input, the caller, the parent, and 1500ms', async () => {
  const arm = async (deadlines, expected) => {
    const seen = [];
    const parent = parentOf({deadlineAt: deadlines.parent});
    const port = observing(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      return Response.json(envelope(CRAFT_REFERENCE_NONE, request.questions.method.criteria));
    }, seen);
    const {selector: select} = selector(port, {parent, deadlineAt: deadlines.caller});
    try {
      await select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-time', deadlineAt: deadlines.input});
      assert.equal(seen[0].deadlineAt, expected);
    } finally { parent.lease.close(); }
  };
  const now = Date.now();
  await arm({input: now + 400, caller: now + 30_000, parent: now + 30_000}, now + 400);
  await arm({input: now + 30_000, caller: now + 500, parent: now + 30_000}, now + 500);
  const parentAt = Date.now() + 600;
  await arm({input: Date.now() + 30_000, caller: Date.now() + 30_000, parent: parentAt}, parentAt);
  const start = Date.now();
  const seen = [];
  const parent = parentOf({deadlineAt: start + 60_000});
  const port = observing(async (_url, init) => {
    const request = JSON.parse(String(init.body));
    return Response.json(envelope(CRAFT_REFERENCE_NONE, request.questions.method.criteria));
  }, seen);
  const {selector: select} = selector(port, {parent, deadlineAt: start + 60_000});
  try {
    await select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-cap', deadlineAt: start + 60_000});
    assert.ok(seen[0].deadlineAt >= start + 1_500 && seen[0].deadlineAt <= start + 1_700);
  } finally { parent.lease.close(); }
});

test('an exhausted parent budget spends nothing and does not call the provider', async () => {
  let calls = 0;
  const parent = parentOf({remainingActions: 0});
  const owned = allowance();
  const before = {...owned};
  const {selector: select} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: async () => { calls += 1; throw new Error('must not fetch'); }}), {parent, allowance: owned});
  try {
    const error = await codeOf(select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-poor', deadlineAt: Date.now() + 60_000}));
    assert.equal(error.code, 'craft_selector_budget');
    assert.equal(calls, 0);
    assert.deepEqual(owned, before);
    assert.equal(parent.lease.context.budget.remainingActions, 0);
  } finally { parent.lease.close(); }
});

test('cancellation and a late timeout are explicit failures', async () => {
  const owned = allowance();
  const before = {...owned};
  const parent = parentOf();
  const caller = new AbortController();
  caller.abort();
  const {selector: select} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: async () => { throw new Error('must not fetch'); }}), {parent, allowance: owned, signal: caller.signal});
  try {
    const early = await codeOf(select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-cancel', deadlineAt: Date.now() + 60_000}));
    assert.equal(early.code, 'craft_selector_cancelled');
    assert.deepEqual(owned, before);
  } finally { parent.lease.close(); }

  let calls = 0;
  const liveParent = parentOf();
  const liveAllowance = allowance();
  const input = new AbortController();
  const {selector: live} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')), {once: true});
      setTimeout(() => input.abort(), 20);
    });
  }}), {parent: liveParent, allowance: liveAllowance});
  try {
    const error = await codeOf(live({index: indexFor(), capsule: capsule(), signal: input.signal, epoch: 'epoch-inflight', deadlineAt: Date.now() + 60_000}));
    assert.equal(error.code, 'craft_selector_cancelled');
    assert.equal(calls, 1);
    assert.equal(liveAllowance.actions, 3);
    assert.equal(liveParent.lease.context.budget.remainingActions, 7);
  } finally { liveParent.lease.close(); }
});

test('a started timeout keeps the reserved spend and does not retry', async () => {
  let calls = 0;
  const parent = parentOf();
  const owned = allowance();
  const inputAt = Date.now() + 200;
  const {selector: select} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')), {once: true}));
  }}), {parent, allowance: owned, deadlineAt: Date.now() + 60_000});
  try {
    const error = await codeOf(select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-slow', deadlineAt: inputAt}));
    assert.equal(error.code, 'craft_selector_timeout');
    assert.equal(calls, 1);
    assert.equal(owned.actions, 3);
    assert.equal(parent.lease.context.budget.remainingActions, 7);
    assert.ok(owned.inputTokens < 1_000_000);
    assert.equal(1_000_000 - owned.inputTokens, 1_000_000 - parent.lease.context.budget.remainingInputTokens);
  } finally { parent.lease.close(); }
});

test('one success charges parent and allowance once; zero attempts are refunded', async () => {
  const parent = parentOf();
  const owned = allowance();
  let calls = 0;
  const {selector: select} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: async (_url, init) => {
    calls += 1;
    const request = JSON.parse(String(init.body));
    return Response.json(envelope(starterIds[0], request.questions.method.criteria, {input_tokens: 20, output_tokens: 5}));
  }}), {parent, allowance: owned});
  try {
    assert.equal(await select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-pay', deadlineAt: Date.now() + 60_000}), starterIds[0]);
    assert.equal(calls, 1);
    assert.equal(owned.actions, 3);
    assert.equal(parent.lease.context.budget.remainingActions, 7);
    assert.equal(1_000_000 - owned.inputTokens, 20);
    assert.equal(1_000_000 - parent.lease.context.budget.remainingInputTokens, 20);
    assert.equal(80_000 - owned.outputTokens, 5);
    assert.equal(80_000 - parent.lease.context.budget.remainingOutputTokens, 5);
    const cost = 20 * JEV_INPUT_USD_PER_MILLION / 1_000_000;
    assert.ok(Math.abs((1 - owned.costUsd) - cost) < 1e-12);
    assert.ok(Math.abs((1 - parent.lease.context.budget.remainingCostUsd) - cost) < 1e-12);
  } finally { parent.lease.close(); }

  const refundParent = parentOf();
  const refundAllowance = allowance();
  let refundCalls = 0;
  const {selector: refund} = selector(createDecisionAdapter({apiKey: '', fetcher: async () => { refundCalls += 1; throw new Error('must not fetch'); }}), {parent: refundParent, allowance: refundAllowance});
  try {
    const error = await codeOf(refund({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-free', deadlineAt: Date.now() + 60_000}));
    assert.equal(error.code, 'craft_selector_unavailable');
    assert.equal(refundCalls, 0);
    assert.deepEqual(refundAllowance, allowance());
    assert.equal(refundParent.lease.context.budget.remainingActions, 8);
    assert.equal(refundParent.lease.context.budget.remainingInputTokens, 1_000_000);
  } finally { refundParent.lease.close(); }
});

test('a complete answer with no attempt count keeps the reservation on both ledgers', async () => {
  const parent = parentOf();
  const owned = allowance();
  const rows = [];
  const port = {async decide(batch) {
    return {batchId: batch.id, status: 'complete', issues: [],
      coverage: {required: ['method'], answered: ['method'], unknown: []},
      answers: {method: {status: 'answered', type: 'choice', choice: starterIds[0]}}};
  }};
  const {selector: select} = selector(port, {parent, allowance: owned, record: row => rows.push(row)});
  try {
    assert.equal(await select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-uncounted', deadlineAt: Date.now() + 60_000}), starterIds[0]);
    assert.equal(owned.actions, 3);
    assert.equal(parent.lease.context.budget.remainingActions, 7);
    assert.ok(owned.inputTokens < 1_000_000);
    assert.equal(1_000_000 - owned.inputTokens, 1_000_000 - parent.lease.context.budget.remainingInputTokens);
    assert.equal(80_000 - owned.outputTokens, 80_000 - parent.lease.context.budget.remainingOutputTokens);
    assert.ok(owned.costUsd < 1);
    assert.ok(Math.abs((1 - owned.costUsd) - (1 - parent.lease.context.budget.remainingCostUsd)) < 1e-12);
    assert.equal(rows.some(row => row.status === 'selected' && row.attempts === 0), false);
    assert.equal('attempts' in rows.at(-1), false);
  } finally { parent.lease.close(); }
});

test('a late complete answer after cancel or deadline is not a selection', async () => {
  const complete = batch => ({batchId: batch.id, status: 'complete', issues: [], attempts: 1,
    coverage: {required: ['method'], answered: ['method'], unknown: []},
    answers: {method: {status: 'answered', type: 'choice', choice: starterIds[0]}}, usage: {inputTokens: 20, outputTokens: 5, costUsd: 0.000001}});
  const caller = new AbortController();
  const parent = parentOf();
  const owned = allowance();
  const rows = [];
  const {selector: select} = selector({async decide(batch) { caller.abort(); return complete(batch); }}, {parent, allowance: owned, signal: caller.signal, record: row => rows.push(row)});
  try {
    const error = await codeOf(select({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-late-cancel', deadlineAt: Date.now() + 60_000}));
    assert.equal(error.code, 'craft_selector_cancelled');
    assert.equal(rows.some(row => row.status === 'selected'), false);
    assert.equal(owned.actions, 3);
    assert.equal(parent.lease.context.budget.remainingActions, 7);
    assert.equal(1_000_000 - owned.inputTokens, 20);
    assert.equal(1_000_000 - parent.lease.context.budget.remainingInputTokens, 20);
  } finally { parent.lease.close(); }

  const slowParent = parentOf();
  const slowAllowance = allowance();
  const slowRows = [];
  const {selector: slow} = selector({decide(batch) {
    return new Promise(resolve => setTimeout(() => resolve(complete(batch)), 250));
  }}, {parent: slowParent, allowance: slowAllowance, record: row => slowRows.push(row)});
  try {
    const error = await codeOf(slow({index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-late-deadline', deadlineAt: Date.now() + 80}));
    assert.equal(error.code, 'craft_selector_timeout');
    assert.equal(slowRows.some(row => row.status === 'selected'), false);
    assert.equal(slowAllowance.actions, 3);
    assert.equal(slowParent.lease.context.budget.remainingActions, 7);
  } finally { slowParent.lease.close(); }
});

test('a shared allowance cannot be spent twice before the provider returns', async () => {
  let calls = 0;
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const parent = parentOf();
  const owned = allowance();
  owned.actions = 1;
  const {selector: select} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: async (_url, init) => {
    calls += 1;
    await gate;
    const request = JSON.parse(String(init.body));
    return Response.json(envelope(CRAFT_REFERENCE_NONE, request.questions.method.criteria));
  }}), {parent, allowance: owned});
  const input = {index: indexFor(), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-race', deadlineAt: Date.now() + 60_000};
  try {
    const first = select(input);
    const second = await codeOf(select(input));
    assert.equal(second.code, 'craft_selector_budget');
    release();
    assert.equal(await first, null);
    assert.equal(calls, 1);
    assert.equal(owned.actions, 0);
  } finally { parent.lease.close(); }
});

test('more than twelve issued ids are rejected before a provider call', async () => {
  let calls = 0;
  const parent = parentOf();
  const {selector: select} = selector(createDecisionAdapter({apiKey: 'super-secret', fetcher: async () => { calls += 1; throw new Error('must not fetch'); }}), {parent});
  try {
    const extra = [...starters, {...starters[0], id: 'CRAFT-EXTRA'}];
    const error = await codeOf(select({index: indexFor(extra), capsule: capsule(), signal: new AbortController().signal, epoch: 'epoch-many', deadlineAt: Date.now() + 60_000}));
    assert.equal(error.code, 'craft_selector_candidates');
    assert.equal(calls, 0);
  } finally { parent.lease.close(); }
});
