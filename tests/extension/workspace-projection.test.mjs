/**
 * KIC-03 selector/projection: the deterministic host selector over `table.workspace.read`,
 * the transport-only `coc-workspace` injection, the mode gate, fail-open behaviour and
 * A→B→A / restart / fold idempotency (contract §19.2).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {convertToLlm} from '@earendil-works/pi-coding-agent';
import {openTable, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/bounded-context-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'workspace-suite-'));
await build({stdin: {contents: `export * from './extensions/table/context-policy.ts'; export {installContextPolicy} from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/projection.ts'; export * from './extensions/table/workspace/workpad-store.ts';`,
  resolveDir: root, sourcefile: 'workspace-projection-api.ts'},
  outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const SOURCE = 'a'.repeat(64), STAMP = 'b'.repeat(64);
const binding = turn => ({version: 1, campaign: 'test-campaign', worldline: 'main', loop: 0, turn, source_revision: SOURCE,
  memory_coverage: {committed: turn, completed: turn, gaps: 0, recent: [], older: {gaps: 0}}});
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = (worldline = 'main', campaign = 'test-campaign', loop = 0) => ({campaign, worldline, loop});
const staticRef = (locator, kind, authority = 'module_source', over = {}) => ({id: digest(locator), locator, kind, authority,
  scope: over.scope ?? scope(), source_revision: over.source_revision ?? SOURCE, identity: digest(`i:${locator}`),
  coverage: over.coverage ?? 'complete'});
const recordRef = (turn, over = {}) => ({id: digest(`turn:${turn}`), locator: `turn:${turn}`, turn, authority: 'table_record',
  scope: over.scope ?? scope(), source_revision: over.source_revision ?? SOURCE, identity: digest(`r:${turn}`),
  coverage: over.coverage ?? 'complete'});
function snapshot(turn = 4, over = {}) {
  return {
    version: 1, status: over.status ?? 'valid',
    binding: {campaign: over.campaign ?? 'test-campaign', worldline: over.worldline ?? 'main', loop: over.loop ?? 0, turn: over.turn ?? turn,
      source_revision: over.source_revision !== undefined ? over.source_revision : SOURCE,
      stateStamp: over.stateStamp !== undefined ? over.stateStamp : STAMP, generation: 1},
    source: {available: true, revision: over.source_revision ?? SOURCE, authority: 'module_source', generation: 1},
    authority: over.authority ?? {checked: true, allowed: ['module_source', 'campaign_adaptation', 'table_record'], scope: scope()},
    coverage: over.coverageSection ?? {static: {status: 'complete', count: 4, ready: 4, omitted: over.staticOmitted ?? 0},
      records: {status: 'complete', count: 2, omitted: over.recordsOmitted ?? 0}},
    manifest: over.manifest ?? {version: 1,
      static: [staticRef('npc:gardener', 'npc'), staticRef('npc:willie', 'npc'), staticRef('scene:estate', 'scene'),
        staticRef('handout:letter', 'handout', 'campaign_adaptation'), staticRef('npc:hidden', 'npc', 'module_source', {coverage: 'unavailable'}),
        staticRef('npc:foreign', 'npc', 'module_source', {scope: scope('main', 'other-campaign')})],
      records: [recordRef(1), recordRef(2)], truncated: over.truncated ?? false},
  };
}
function payloadsOf(context, kind) {
  return context.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []).flatMap(block => {
    if (block.type !== 'text') return [];
    try {const data = JSON.parse(block.text); return data?.kind === kind ? [data] : [];} catch {return [];}
  }));
}
function group(turn, text = `Player ${turn}`, line = 'main') {
  const context = {...binding(turn), worldline: line};
  return [
    {role: 'user', content: [{type: 'text', text}], timestamp: turn * 10},
    {role: 'custom', customType: 'coc-capsule', content: JSON.stringify({turn: {number: turn}}), details: {turn, context}, timestamp: turn * 10 + 1},
    {role: 'assistant', content: [{type: 'toolCall', id: `call-${turn}`, name: 'look', arguments: {}}], timestamp: turn * 10 + 2},
    {role: 'toolResult', toolCallId: `call-${turn}`, toolName: 'look', content: [{type: 'text', text: `Machine result ${turn}`}], timestamp: turn * 10 + 3},
  ];
}
function entries(messages) {
  return messages.map((message, i) => message.role === 'custom'
    ? {type: 'custom_message', id: `entry-${i}`, customType: message.customType, content: message.content, details: message.details}
    : {type: 'message', id: `entry-${i}`, message});
}

test('the mode gate reads the package settings the capsule already holds and defaults to off', () => {
  const keeper = mode => ({mods: {instructions: [{mod: 'keeper-context', version: '1.0.0', settings: {mode}, form: 'full', instruction: 'x'}]}});
  assert.equal(api.workspaceModeOf(undefined), 'off', 'no capsule is off');
  assert.equal(api.workspaceModeOf({}), 'off', 'no mods section is off');
  assert.equal(api.workspaceModeOf({mods: {instructions: [{mod: 'npc-voice', settings: {mode: 'on'}}]}}), 'off', 'no package is off');
  assert.equal(api.workspaceModeOf(keeper('on')), 'on');
  assert.equal(api.workspaceModeOf(keeper('shadow')), 'shadow');
  assert.equal(api.workspaceModeOf(keeper('off')), 'off');
  assert.equal(api.workspaceModeOf(keeper('enabled')), 'off', 'an unknown mode value is off');
  assert.equal(api.workspaceModeOf(keeper(undefined)), 'off', 'a missing mode value is off');
  const budget = bytes => ({mods: {instructions: [{mod: 'keeper-context', version: '1.0.0', settings: {mode: 'on', workspace_bytes: bytes}}]}});
  assert.equal(api.workspaceBudgetOf(budget(4096)), 4096);
  assert.equal(api.workspaceBudgetOf(budget(1024 * 1024)), api.WORKSPACE_CEILING_BYTES, 'the package budget never exceeds the KIC ceiling');
  assert.equal(api.workspaceBudgetOf(budget(-5)), api.WORKSPACE_CEILING_BYTES, 'an invalid budget falls back to the ceiling');
  assert.equal(api.workspaceBudgetOf(undefined), api.WORKSPACE_CEILING_BYTES, 'no package means the ceiling, not zero');
});

test('the selector packs admissible references in stable source order and projects names only', () => {
  const state = snapshot(4);
  const first = api.selectWorkspace({snapshot: state, binding: binding(4), budget: 24576});
  const second = api.selectWorkspace({snapshot: structuredClone(state), binding: binding(4), budget: 24576});
  assert.equal(first.status, 'selected');
  assert.deepEqual(first, second, 'the same snapshot and budget always select the same message');
  assert.equal(first.message.customType, api.WORKSPACE_TYPE);
  assert.equal(first.message.display, false);
  assert.ok(api.sizeOf(first.message) <= 24576, 'the message fits the KIC budget');
  const view = JSON.parse(first.message.content);
  assert.equal(view.kind, 'coc_workspace');
  assert.equal(view.advisory, true, 'a reference-only manifest is explicitly advisory');
  assert.match(view.note, /Advisory locations, not the material/);
  assert.equal(view.turn, 4);
  assert.deepEqual(view.evidence.map(entry => entry.locator),
    ['npc:gardener', 'npc:willie', 'scene:estate', 'handout:letter', 'turn:1', 'turn:2'],
    'module_source by locator, then campaign_adaptation by locator, then records by turn');
  for (const entry of view.evidence) {
    assert.deepEqual(Object.keys(entry).sort(), entry.kind === 'record'
      ? ['authority', 'coverage', 'kind', 'locator', 'turn'] : ['authority', 'coverage', 'kind', 'locator'],
    `an entry carries names only: ${JSON.stringify(entry)}`);
  }
  for (const forbidden of ['id', 'identity', 'content_hash', 'stateStamp', 'source_revision', 'scope', 'generation'])
    assert.equal(first.message.content.includes(`"${forbidden}"`), false, `no ${forbidden} is model-facing`);
  assert.deepEqual(first.counts.packed, {static: 4, records: 2});
  assert.deepEqual(first.counts.filtered, {static: 2, records: 0}, 'the unavailable and foreign-scope references are filtered with counts');
  assert.equal(first.counts.truncated, false);
});

test('the selector omits the message on any snapshot, binding, authority or state failure', () => {
  const omit = (input, reason) => assert.deepEqual(api.selectWorkspace(input), {status: 'omitted', reason});
  omit({snapshot: {...snapshot(4), status: 'unverifiable'}, binding: binding(4), budget: 24576}, 'snapshot_not_valid');
  for (const field of ['campaign', 'worldline', 'loop', 'turn', 'source_revision']) {
    const over = {campaign: 'other', worldline: 'side', loop: 7, source_revision: 'c'.repeat(64)}[field] ?? 99;
    omit({snapshot: snapshot(4, {[field]: over}), binding: binding(4), budget: 24576}, 'binding_mismatch');
  }
  omit({snapshot: snapshot(4, {authority: {checked: false}}), binding: binding(4), budget: 24576}, 'authority_unchecked');
  omit({snapshot: snapshot(4, {stateStamp: null}), binding: binding(4), budget: 24576}, 'state_unverified');
  omit({snapshot: snapshot(4), binding: binding(4), budget: 96}, 'metadata_floor');
  omit({snapshot: snapshot(4), binding: binding(4), budget: 0}, 'metadata_floor');
});

test('budget packing is first-fit in stable order and every omission is counted', () => {
  const wide = snapshot(4, {staticOmitted: 5, recordsOmitted: 3, truncated: true});
  const packed = api.selectWorkspace({snapshot: wide, binding: binding(4), budget: 1100});
  assert.equal(packed.status, 'selected');
  assert.ok(api.sizeOf(packed.message) <= 1100, 'the message fits the package budget');
  const view = JSON.parse(packed.message.content);
  assert.ok(view.evidence.length < 6, `a tight budget packs fewer entries: ${view.evidence.length}`);
  assert.ok(packed.counts.omitted.static.budget + packed.counts.omitted.records.budget > 0, 'budget omissions are counted');
  assert.deepEqual([packed.counts.omitted.static.manifest, packed.counts.omitted.records.manifest], [5, 3], 'manifest omissions ride through');
  assert.equal(view.truncated, true);
  assert.deepEqual(JSON.parse(api.selectWorkspace({snapshot: wide, binding: binding(4), budget: api.WORKSPACE_CEILING_BYTES + 4096}).message.content).evidence.length,
    6, 'a package budget above the ceiling is clamped, never raised');
  const deduped = snapshot(4, {manifest: {version: 1, static: [staticRef('npc:gardener', 'npc')], records: [recordRef(1), recordRef(1)]}});
  const once = api.selectWorkspace({snapshot: deduped, binding: binding(4), budget: 24576});
  assert.deepEqual(JSON.parse(once.message.content).evidence.map(entry => entry.locator), ['npc:gardener', 'turn:1'], 'duplicate locators pack once');
  assert.deepEqual(once.counts.packed, {static: 1, records: 1});
  const rejected = snapshot(4, {manifest: {version: 1,
    static: [staticRef('rules:chase', 'rule', 'rules_source'), staticRef('partial:note', 'handout', 'campaign_adaptation', {coverage: 'partial'}),
      staticRef('npc:otherline', 'npc', 'module_source', {scope: scope('side')})],
    records: [{...recordRef(3), authority: 'module_source'}, {locator: 'turn:x', authority: 'table_record', turn: 'seven', coverage: 'complete', scope: scope()}]},
    authority: {checked: true, allowed: ['module_source'], scope: scope()}});
  const clean = api.selectWorkspace({snapshot: rejected, binding: binding(4), budget: 24576});
  assert.deepEqual(JSON.parse(clean.message.content).evidence, [], 'nothing inadmissible is packed');
  assert.deepEqual(clean.counts.filtered, {static: 3, records: 2});
});

test('an old coc-workspace before the current boundary is closed noise for projection and fold', () => {
  const stale = {role: 'custom', customType: api.WORKSPACE_TYPE, content: JSON.stringify({kind: 'coc_workspace', turn: 1}), details: {}, timestamp: 5};
  const messages = [stale, ...group(1), ...group(2)];
  const result = api.projectedMessages({messages, binding: binding(2), history: api.historyView(binding(2), [])});
  assert.equal(result.messages.filter(message => message.role === 'custom' && message.customType === api.WORKSPACE_TYPE).length, 0,
    'an older binding workspace never rides a later request');
  assert.equal(result.unknownBytes, 0, 'it is classified noise, not unclassified retained material');
  const plan = api.foldPlan(entries(messages), binding(2), api.historyView(binding(2), []));
  assert.ok(plan, 'a persisted workspace entry does not veto the fold');
  assert.equal(plan.details.coc_fold.unclassified, undefined, 'the fold drops it without carrying it into the summary');
  assert.equal(plan.summary.includes('coc_workspace'), false);
});

function workspaceFixture({turn = 0, mode = 'on', workspace_bytes = 24576, failRead = false, getSnapshot, workpadRoot} = {}) {
  const hooks = new Map(), bus = new Map(), rows = [];
  const state = {turn, worldline: 'main', revision: SOURCE, calls: 0, methods: [], reads: 0, available: true, snapshot: getSnapshot ?? (() => snapshot(0, {turn: 0}))};
  const instructions = mode === 'off' ? [] : [{mod: 'keeper-context', version: '1.0.0',
    settings: {mode, workspace_bytes, candidate_limit: 128, rerank_candidates: 48}, form: 'full', instruction: 'Read the index; verify before you rely on it.'}];
  const cap = at => ({turn: {number: at, player_text: 'Input'}, recent: [], module: {title: 'Book'}, style: {floor: ['World response']},
    mods: {instructions: [...instructions]}});
  const meta = at => ({...binding(at), worldline: state.worldline, source_revision: state.available ? state.revision : null, unavailable: !state.available});
  const pi = {on: (name, handler) => hooks.set(name, handler), events: {on: (name, handler) => bus.set(name, handler)}, sendMessage() {}};
  api.installContextPolicy(pi, row => rows.push(row), workpadRoot);
  const safeRoot = () => { try { return workpadRoot?.(); } catch { return undefined; } };
  bus.get('coc:kernel-bridge')({campaign: 'test-campaign', runtime: workpadRoot ? {home: safeRoot()} : undefined, call: async (method, params) => {
    state.calls++;
    state.methods.push(method);
    if (method === 'table.workspace.read') {
      state.reads++;
      if (failRead) throw new Error('workspace read exploded');
      return structuredClone(state.snapshot());
    }
    if (method === 'table.capsule') return {...cap(state.turn), _context: meta(state.turn)};
    return {cards: [], _snapshot: 'fixture-snapshot'};
  }});
  bus.get('coc:capsule')({capsule: cap(turn), context: meta(turn), epoch: 'fixture-input'});
  const messages = group(turn);
  messages[1].details.epoch = 'fixture-input';
  const ctx = {model: {contextWindow: 1000000}, getContextUsage: () => ({percent: 1, contextWindow: 1000000}),
    sessionManager: {getBranch: () => []}, compact: () => {}};
  /** Advance the fixture to a new capsule/turn/line the way a successful move or restore would. */
  const advance = (at, {epoch, worldline = 'main', line} = {}) => {
    state.turn = at;
    state.worldline = worldline;
    state.snapshot = () => snapshot(at, {turn: at, worldline});
    const next = group(at, `Player ${at}`, line ?? worldline);
    next[1].details.epoch = epoch;
    bus.get('coc:capsule')({capsule: cap(at), context: meta(at), epoch});
    return next;
  };
  return {hooks, bus, rows, state, messages, ctx, advance, cap};
}

test('with no package the workspace is never read and the request is exactly the bounded baseline', async () => {
  const t = workspaceFixture({mode: 'off'});
  const baseline = workspaceFixture({mode: 'off'});
  const result = await t.hooks.get('context')({messages: t.messages}, t.ctx);
  const plain = await baseline.hooks.get('context')({messages: baseline.messages}, baseline.ctx);
  assert.equal(t.state.reads, 0, 'off reads nothing');
  assert.equal(result.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0);
  assert.equal(JSON.stringify(result.messages), JSON.stringify(plain.messages), 'off changes nothing about the request');
  assert.equal(t.rows.filter(row => row.lane === 'workspace').length, 0, 'off writes no workspace telemetry');
});

test('mode on reads once per binding and injects exactly one advisory message after the capsule', async () => {
  const t = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0})});
  const first = await t.hooks.get('context')({messages: t.messages}, t.ctx);
  const workspaces = first.messages.filter(message => message.customType === api.WORKSPACE_TYPE);
  assert.equal(t.state.reads, 1, 'one read for the prepared binding');
  assert.equal(workspaces.length, 1);
  const capsuleAt = first.messages.findIndex(message => message.customType === 'coc-capsule');
  assert.ok(first.messages.indexOf(workspaces[0]) > capsuleAt, 'the workspace follows the current capsule');
  assert.ok(api.pairedTools(first.messages));
  const view = JSON.parse(workspaces[0].content);
  assert.equal(view.kind, 'coc_workspace');
  assert.equal(view.advisory, true);
  assert.ok(view.evidence.length >= 6);
  assert.ok(api.sizeOf(workspaces[0]) <= api.WORKSPACE_CEILING_BYTES);
  const selected = t.rows.filter(row => row.lane === 'workspace' && row.event === 'selected');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].mode, 'on');
  assert.equal(selected[0].bytes, api.sizeOf(workspaces[0]));
  assert.equal(first.messages.find(message => message.customType === api.DIAGNOSTIC_TYPE), undefined, 'a workspace turn is not degraded');
  const again = await t.hooks.get('context')({messages: t.messages}, t.ctx);
  assert.equal(t.state.reads, 1, 'a failed move (no new capsule) reuses the prepared workspace without a second read');
  assert.deepEqual(again.messages.filter(message => message.customType === api.WORKSPACE_TYPE), workspaces,
    'repeated projection is idempotent');
  const seeded = [workspaces[0], ...t.messages];
  const third = await t.hooks.get('context')({messages: seeded}, t.ctx);
  assert.equal(third.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 1,
    'a persisted copy is dropped, the one current message is injected');
});

test('shadow reads and records but never injects', async () => {
  const t = workspaceFixture({mode: 'shadow', getSnapshot: () => snapshot(0, {turn: 0})});
  const result = await t.hooks.get('context')({messages: t.messages}, t.ctx);
  assert.equal(t.state.reads, 1, 'shadow does the selection work');
  assert.equal(result.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0, 'shadow injects nothing');
  assert.equal(t.rows.filter(row => row.lane === 'workspace' && row.event === 'shadow').length, 1);
});

test('read, snapshot and selection failures are fail-open misses, never degraded turns', async () => {
  const failing = workspaceFixture({mode: 'on', failRead: true});
  const failed = await failing.hooks.get('context')({messages: failing.messages}, failing.ctx);
  assert.equal(failed.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0);
  assert.ok(failed.messages.some(message => message.customType === api.BRIEF_TYPE), 'the prepared brief survives');
  assert.ok(failed.messages.some(message => message.customType === api.HISTORY_TYPE), 'the bounded history survives');
  assert.equal(failed.messages.find(message => message.customType === api.DIAGNOSTIC_TYPE), undefined,
    'an omitted workspace is not a degraded request');
  assert.deepEqual(failing.rows.filter(row => row.lane === 'workspace'),
    [{turn: 0, lane: 'workspace', event: 'omitted', mode: 'on', reason: 'workspace_read_failed', detail: 'workspace read exploded'}]);
  const unverifiable = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0, status: 'unverifiable'})});
  const omitted = await unverifiable.hooks.get('context')({messages: unverifiable.messages}, unverifiable.ctx);
  assert.equal(omitted.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0);
  const rows = unverifiable.rows.filter(row => row.lane === 'workspace');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'omitted');
  assert.equal(rows[0].reason, 'snapshot_not_valid');
  assert.equal(rows[0].mode, 'on');
  const mismatched = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(9, {turn: 9})});
  const stale = await mismatched.hooks.get('context')({messages: mismatched.messages}, mismatched.ctx);
  assert.equal(stale.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0, 'a foreign binding is omitted');
  assert.ok(mismatched.rows.some(row => row.lane === 'workspace' && row.reason === 'binding_mismatch'));
});

test('state, worldline and source changes rebind; A→B→A recovers the dormant record index', async () => {
  const t = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0})});
  await t.hooks.get('context')({messages: t.messages}, t.ctx);
  assert.equal(t.state.reads, 1);
  // A→B: a successful move opens turn 1 on the side line; the next request reads a fresh binding.
  const side = t.advance(1, {epoch: 'side-input', worldline: 'side'});
  const sideResult = await t.hooks.get('context')({messages: side}, t.ctx);
  assert.equal(t.state.reads, 2, 'a new binding reads once more');
  let workspaces = sideResult.messages.filter(message => message.customType === api.WORKSPACE_TYPE);
  assert.equal(workspaces.length, 1);
  assert.equal(JSON.parse(workspaces[0].content).worldline, 'side');
  // A stale workspace from the previous binding is dropped, the current one injected once.
  const staleSide = {...workspaces[0], content: JSON.stringify({kind: 'coc_workspace', worldline: 'main', turn: 0})};
  // B→A: moving back rebinds to main and the turn:1 record is dormant-recoverable evidence.
  const back = t.advance(2, {epoch: 'back-input'});
  back.unshift(staleSide);
  const backResult = await t.hooks.get('context')({messages: back}, t.ctx);
  workspaces = backResult.messages.filter(message => message.customType === api.WORKSPACE_TYPE);
  assert.equal(workspaces.length, 1, 'at most one current workspace per binding');
  const view = JSON.parse(workspaces[0].content);
  assert.equal(view.worldline, 'main');
  assert.equal(view.turn, 2);
  assert.ok(view.evidence.some(entry => entry.locator === 'turn:1'), 'the record made on the earlier visit is still offered');
  assert.equal(JSON.stringify(backResult.messages).includes('"worldline":"side","kind"'), false, 'the old-line copy is gone');
  assert.equal(t.state.reads, 3);
  // A source revision change invalidates the prepared generation the same way.
  t.state.revision = 'c'.repeat(64);
  const after = t.advance(2, {epoch: 'post-publish'});
  await t.hooks.get('context')({messages: after}, t.ctx);
  assert.equal(t.state.reads, 4, 'a new source revision reads once more');
  // A session restart clears the prepared workspace; the next request rebinds from a fresh read.
  await t.hooks.get('session_start')({}, t.ctx);
  await t.hooks.get('context')({messages: after}, t.ctx);
  assert.equal(t.state.reads, 5, 'a restart rebinds from a fresh read, never from a stale preparation');
});

test('current material precedes the workspace: ceiling pressure omits it instead of cutting the turn', async () => {
  const heavy = [...group(0)];
  heavy[3].content[0].text = 'Machine output '.repeat(2000);
  process.env.PI_COC_REQUEST_BYTES = '12000';
  try {
    const squeezed = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0})});
    const tight = await squeezed.hooks.get('context')({messages: heavy}, squeezed.ctx);
    assert.equal(tight.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0,
      'the workspace yields before this turn\'s own traffic is cut');
    assert.ok(squeezed.rows.some(row => row.lane === 'context' && row.event === 'request' && row.dropped_tail > 0),
      'the current tool traffic is dropped exactly as it would be without KIC');
    delete process.env.PI_COC_REQUEST_BYTES;
    const roomy = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0})});
    const loose = await roomy.hooks.get('context')({messages: heavy}, roomy.ctx);
    assert.equal(loose.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 1,
      'with ceiling room both fit');
  } finally {delete process.env.PI_COC_REQUEST_BYTES;}
});

function keeperTurn(text) {
  return [fauxAssistantMessage([fauxToolCall('look', {})], {stopReason: 'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'}), fauxAssistantMessage('Discarded post-delivery tail.')];
}

test('a live table with keeper-context on injects one advisory workspace and never persists or leaks it', async t => {
  const requests = [];
  const table = await openTable({realKernel: true, campaign: 'workspace-projection-live', retainAt: directory,
    env: {PI_COC_COMPACT_AT: '100'}, settings: {compaction: {enabled: false}},
    responses: [...keeperTurn('The house answers your first knock.'), ...keeperTurn('The letter opens; the seal was never intact.')]});
  t.after(() => table.dispose());
  await waitForIdle(table.session, {timeoutMs: 60000});
  const bridge = table.runtimeBridges().findLast(value => typeof value.call === 'function');
  await bridge.call('mods.configure', {campaign: 'workspace-projection-live', id: 'keeper-context', enabled: true,
    settings: {mode: 'on', workspace_bytes: 24576}});
  const runner = table.session._extensionRunner, transform = runner.emitContext.bind(runner);
  runner.emitContext = async messages => {
    const result = await transform(messages);
    requests.push({context: {messages: convertToLlm(result)}, branch: structuredClone(table.rawEntries())});
    return result;
  };
  await table.session.prompt('I take the letter from the desk.');
  await waitForIdle(table.session, {timeoutMs: 60000});
  const withWorkspace = requests.filter(request => payloadsOf(request.context, 'coc_workspace').length > 0);
  assert.ok(withWorkspace.length >= 1, `workspace reached the outgoing request: ${JSON.stringify({
    requests: requests.length,
    lanes: table.telemetry().filter(row => row.lane === 'workspace'),
    errors: table.extensionErrors})}`);
  for (const request of withWorkspace) {
    const views = payloadsOf(request.context, 'coc_workspace');
    assert.equal(views.length, 1, 'at most one current workspace per request');
    assert.equal(views[0].advisory, true);
    assert.ok(views[0].evidence.length >= 1, 'the live manifest reaches the model');
    assert.ok(views[0].evidence.every(entry => Object.keys(entry).every(key => ['locator', 'kind', 'turn', 'authority', 'coverage'].includes(key))),
      `entries carry names only: ${JSON.stringify(views[0].evidence[0])}`);
    assert.equal(JSON.stringify(request.context).includes('"stateStamp"'), false);
    assert.ok(api.pairedTools(request.context.messages));
  }
  const selected = table.telemetry().filter(row => row.lane === 'workspace' && row.event === 'selected');
  assert.ok(selected.length >= 1, 'the host records the selection');
  assert.equal(table.rawEntries().filter(entry => entry.type === 'custom_message' && entry.customType === api.WORKSPACE_TYPE).length, 0,
    'the workspace is transport-only: nothing is persisted to the branch');
  for (const input of table.lanes.admission.requests())
    assert.equal(input.includes('coc_workspace'), false, 'action admission never sees the workspace');
  assert.deepEqual(table.extensionErrors, []);
});

// ---- KIC-04: the Workpad joins the same message, under the same budget and mode gate ----------

const seedWorkpad = async (root, entries, focus = null) => {
  const store = api.createWorkpadStore(api.workpadStoreRoot(root));
  const scope = {campaign: 'test-campaign', worldline: 'main', loop: 0};
  let revision = 0, last;
  for (const {id, stamp = STAMP, turn = 0, text} of entries) {
    const result = await store.publish({scope, baseRevision: revision, turn, stateStamp: stamp,
      patch: {focus: focus ?? undefined,
        upserts: [{id, kind: 'hypothesis', text: text ?? `Note ${id}`, status: 'tentative', evidence: ['npc:gardener']}], removes: []}});
    if (result.status !== 'published') throw new Error(`seed failed: ${JSON.stringify(result)}`);
    revision = result.view.revision;
    last = result;
  }
  return last;
};

test('a published workpad rides the outgoing request only when mode is on, stale entries marked', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workpad-root-'));
  try {
    await seedWorkpad(home, [{id: 'q1'}, {id: 'q2', stamp: 'c'.repeat(64), turn: 0}], 'the letter');
    const t = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0}), workpadRoot: () => api.workpadStoreRoot(home)});
    const result = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    const workspaces = result.messages.filter(message => message.customType === api.WORKSPACE_TYPE);
    assert.equal(workspaces.length, 1, 'still exactly one workspace message');
    const content = JSON.parse(workspaces[0].content);
    assert.equal(content.workpad.focus, 'the letter');
    assert.deepEqual(content.workpad.entries.map(entry => [entry.id, entry.validity]),
      [['q1', 'current'], ['q2', 'stale']]);
    assert.equal(content.workpad.entries[1].needs_recheck, true);
    assert.match(content.workpad.note, /never facts/);
    const selected = t.rows.filter(row => row.lane === 'workspace' && row.event === 'selected')[0];
    assert.equal(selected.workpad_entries, 2);
    assert.equal(selected.workpad_omitted, 0);
    assert.equal(result.messages.find(message => message.customType === api.DIAGNOSTIC_TYPE), undefined,
      'a workpad turn is not a degraded turn');
    // Shadow does the same work and records the same counts, but injects nothing.
    const shadow = workspaceFixture({mode: 'shadow', getSnapshot: () => snapshot(0, {turn: 0}), workpadRoot: () => api.workpadStoreRoot(home)});
    const shadowResult = await shadow.hooks.get('context')({messages: shadow.messages}, shadow.ctx);
    assert.equal(shadowResult.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0);
    assert.equal(shadow.rows.filter(row => row.lane === 'workspace' && row.event === 'shadow')[0].workpad_entries, 2);
    // Off reads nothing at all: no store open, no counts row, no message.
    const off = workspaceFixture({mode: 'off', workpadRoot: () => api.workpadStoreRoot(home)});
    const offResult = await off.hooks.get('context')({messages: off.messages}, off.ctx);
    assert.equal(offResult.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0);
    assert.equal(off.rows.filter(row => row.lane === 'workspace').length, 0);
  } finally { await rm(home, {recursive: true, force: true}); }
});

test('a workpad store failure is a miss on the optional layer, never a lost workspace', async () => {
  const t = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0}), workpadRoot: () => { throw new Error('no root for you'); }});
  const result = await t.hooks.get('context')({messages: t.messages}, t.ctx);
  const workspaces = result.messages.filter(message => message.customType === api.WORKSPACE_TYPE);
  assert.equal(workspaces.length, 1, 'the evidence selection stands');
  assert.equal('workpad' in JSON.parse(workspaces[0].content), false, 'only the workpad is omitted');
  assert.equal(JSON.parse(workspaces[0].content).evidence.length >= 1, true);
  assert.equal(t.rows.filter(row => row.lane === 'workspace' && row.event === 'selected')[0].workpad_entries, 0);
  assert.equal(result.messages.find(message => message.customType === api.DIAGNOSTIC_TYPE), undefined);
  const empty = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0}), workpadRoot: () => '/nonexistent/workpad-root'});
  const emptyResult = await empty.hooks.get('context')({messages: empty.messages}, empty.ctx);
  assert.equal(emptyResult.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 1,
    'a missing store is an empty workpad, not an error');
});

test('the workpad yields before current material and before packed evidence', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workpad-budget-'));
  try {
    await seedWorkpad(home, Array.from({length: 4}, (_, i) => ({id: `q${i}`, text: `Note ${i} `.repeat(20)})));
    const heavy = [...group(0)];
    heavy[3].content[0].text = 'Machine output '.repeat(2000);
    process.env.PI_COC_REQUEST_BYTES = '12000';
    try {
      const squeezed = workspaceFixture({mode: 'on', getSnapshot: () => snapshot(0, {turn: 0}), workpadRoot: () => api.workpadStoreRoot(home)});
      const tight = await squeezed.hooks.get('context')({messages: heavy}, squeezed.ctx);
      assert.equal(tight.messages.filter(message => message.customType === api.WORKSPACE_TYPE).length, 0,
        'under request-ceiling pressure the whole optional layer is omitted, workpad included');
    } finally { delete process.env.PI_COC_REQUEST_BYTES; }
    // A small package budget: workpad entries are skipped one by one, evidence entries first.
    const small = workspaceFixture({mode: 'on', workspace_bytes: 1200, getSnapshot: () => snapshot(0, {turn: 0}), workpadRoot: () => api.workpadStoreRoot(home)});
    const result = await small.hooks.get('context')({messages: small.messages}, small.ctx);
    const workspaces = result.messages.filter(message => message.customType === api.WORKSPACE_TYPE);
    assert.equal(workspaces.length, 1);
    const content = JSON.parse(workspaces[0].content);
    assert.ok(content.evidence.length >= 1, 'evidence is packed before any workpad entry');
    assert.ok(api.sizeOf(workspaces[0]) <= 1200, 'the message still fits the package budget');
    assert.equal(content.workpad?.entries.length ?? 0, small.rows.filter(row => row.lane === 'workspace')[0].workpad_entries,
      'the projected entries match the telemetry count');
  } finally { await rm(home, {recursive: true, force: true}); }
});
