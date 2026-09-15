import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';
import {table, usage} from './object-usages-fixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const latch = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return {promise, release}; };
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'background work reached the expected observable');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const item = (name, extra = {}) => ({id: name, name, owner: {kind: 'scene', name: 'Study'},
  definition_digest: 'definition', condition: 'intact', has_any_usage: false, covered: false, ...extra});

async function harness(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'mods-prefetch-host-'));
  const oldLimit = process.env.PI_COC_MOD_PREFETCH_LIMIT;
  if (options.limit === undefined) delete process.env.PI_COC_MOD_PREFETCH_LIMIT;
  else process.env.PI_COC_MOD_PREFETCH_LIMIT = String(options.limit);
  const priorFetch = globalThis.fetch, priorPort = process.env.PIPIUI_BRIDGE_PORT, priorCapability = process.env.PIPIUI_SESSION_CAPABILITY;
  process.env.PIPIUI_BRIDGE_PORT = '1'; process.env.PIPIUI_SESSION_CAPABILITY = 'test';
  const events = [], telemetry = [], scans = [], operations = [], runs = [], jobs = new Map(), hooks = new Map();
  globalThis.fetch = async (_url, request) => { events.push(JSON.parse(request.body)); return {}; };
  const pi = {events: new EventEmitter(), on: (name, handler) => hooks.set(name, handler)};
  let bridge, active = 0, peak = 0;
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  const view = {campaign: 'c1', worldline: 'main', turn: 2, state: 'awaiting_player', pending_choice: null,
    active_scene: 'Study', instances: options.items ?? [item('Chair')]};
  const call = async (method, params) => {
    operations.push({method, params});
    if (options.call) return options.call(method, params);
    if (method === 'mods.prefetch.targets') return structuredClone(view);
    if (method === 'mods.queued') return {effects: [], unfinished: []};
    if (method === 'mods.job') {
      const key = `${view.worldline}-${params.input.object}-${params.input.propose ? 'proposal' : params.input.name}`;
      const cwd = join(home, key); await mkdir(cwd, {recursive: true}); jobs.set(key, params.input);
      await writeFile(join(cwd, 'request.json'), JSON.stringify(params));
      return {enabled: true, accepted: false, job: key, cwd, system_prompt: join(cwd, 'prompt.md')};
    }
    if (method === 'mods.prefetch.accept' || method === 'mods.accept') {
      const input = jobs.get(params.job), value = JSON.parse(await readFile(join(home, params.job, 'result.json'), 'utf8'));
      const result = {usage: value, provenance: {job: params.job, prefetched: method === 'mods.prefetch.accept'}};
      await writeFile(join(home, params.job, 'accepted.json'), JSON.stringify(result));
      if (method === 'mods.prefetch.accept') view.instances.find(row => row.name === input.object).covered = true;
      return result;
    }
    throw new Error(`Unexpected RPC ${method}`);
  };
  pi.events.emit('coc:kernel-bridge', {call, record: row => (row.event === 'scan' ? scans : telemetry).push(row), runtime: {
    async runTask(task, signal) {
      active++; peak = Math.max(peak, active); runs.push({task, signal});
      try {
        if (options.run) return await options.run(task, signal);
        await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(usage('Swing')));
        return {ok: true};
      } finally { active--; }
    },
    async check(request) { return options.check ? options.check(request) : {ok: true}; },
  }});
  t.after(async () => {
    await hooks.get('session_shutdown')();
    await until(() => active === 0); await tick();
    globalThis.fetch = priorFetch;
    for (const [key, value] of [['PI_COC_MOD_PREFETCH_LIMIT', oldLimit], ['PIPIUI_BRIDGE_PORT', priorPort], ['PIPIUI_SESSION_CAPABILITY', priorCapability]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(home, {recursive: true, force: true});
  });
  return {bridge, view, hooks, operations, runs, telemetry, scans, events, home, peak: () => peak,
    commit: (turn = view.turn - 1) => pi.events.emit('coc:turn-committed', {campaign: 'c1', turn}),
    input: () => hooks.get('input')({text: 'My next action'})};
}

test('a real committed turn prepares an uncovered scene object through proposal acceptance without receipts', async t => {
  const game = await table(t);
  const priorUsage = await game.prepare(); await game.apply([priorUsage.effect]);
  await game.apply([{kind: 'object', name: 'Scene chair', definition: 'Chair frame', to: 'here'}]);
  const delivery = await game.call('table.narrate', {call_id: game.next(), text: 'A second wooden chair waits in the room.'});
  const status = await game.call('table.status'), before = await game.world();
  const h = await harness(t, {call: game.call});
  h.commit(delivery.turn);
  assert.equal(h.runs.length, 0, 'the commit event returns before any creator starts');
  await until(() => h.telemetry.length === 1);
  assert.equal(h.telemetry[0].ok, true);
  const proposals = h.operations.filter(row => row.method === 'mods.job');
  assert.deepEqual(proposals.map(row => row.params.input), [{object: 'Scene chair', propose: true}]);
  assert.equal(h.operations.some(row => row.method === 'mods.accept'), false);
  const after = await game.world();
  const records = Object.values(after.objects.usages).filter(row => row.provenance.prefetched);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'Swing');
  assert.deepEqual(after.clock, before.clock);
  assert.deepEqual(await game.call('table.status'), status);
  assert.ok(delivery.rendered_text);
  assert.equal(h.events.length, 0, 'prefetch does not emit progress or other panel events');
  assert.equal(h.telemetry[0].turn, delivery.turn);
  assert.equal(status.turn, delivery.turn + 1, 'the retained turn advances at commit');
  assert.equal(h.telemetry[0].lane, 'usage-prefetch');
  await game.call('table.player_input', {text: 'I swing the scene chair.'});
  const effect = {kind: 'usage', object: 'Scene chair', name: 'Swing', description: 'Swing the chair at an attacker'};
  await h.bridge.prepare('apply', {campaign: 'c1', effects: [effect]});
  assert.ok(effect._usage.provenance.reused_usage, 'the ordinary action job reuses the prepared record');
  assert.equal(h.runs.length, 1, 'the action has no creator wait on a prepared hit');
});

test('a commit starts prefetch on the next retained turn while telemetry belongs to the committed turn', async t => {
  const h = await harness(t);
  assert.equal(h.view.turn, 2);
  h.commit(1);
  await until(() => h.telemetry.length === 1);
  assert.equal(h.runs.length, 1);
  assert.equal(h.telemetry[0].turn, 1);
  assert.equal(h.telemetry[0].ok, true);
  assert.equal(h.scans[0].turn, 1);
  assert.equal(h.scans[0].retained_turn, 2);
  assert.equal(h.scans[0].started, 1);
});

test('filtering precedes the default budget; jobs are serial and negative results stay covered across turns', async t => {
  const started = latch(), finish = latch();
  let ordinal = 0;
  const h = await harness(t, {items: [item('Used', {has_any_usage: true}), item('Covered', {covered: true}), item('Paper'), item('Chair'), item('Third')],
    async run(task) {
      if (++ordinal === 1) { started.release(); await finish.promise; }
      await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(null));
      return {ok: true};
    }});
  h.commit(); await started.promise;
  h.commit(); h.commit();
  assert.equal(h.runs.length, 1);
  finish.release(); await until(() => h.telemetry.length === 2);
  await tick(); await tick();
  assert.equal(h.runs.length, 2); assert.equal(h.peak(), 1);
  assert.deepEqual(h.operations.filter(row => row.method === 'mods.job').map(row => row.params.input.object), ['Paper', 'Chair']);
  assert.ok(h.telemetry.every(row => row.negative && row.turn === 1));
  const scan = h.scans.find(row => row.reason === 'completed');
  assert.equal(scan.scanned, 5); assert.equal(scan.candidates, 3); assert.equal(scan.started, 2);
  assert.deepEqual(scan.skipped, {has_any_usage: 1, covered: 1});
  h.view.turn = 3; h.commit(); await until(() => h.telemetry.length === 3);
  assert.equal(h.operations.filter(row => row.method === 'mods.job').at(-1).params.input.object, 'Third');
  assert.equal(h.telemetry.at(-1).turn, 2);
  assert.equal(h.events.length, 0);
});

test('configured zero disables scans, a positive limit bounds work, invalid values retain the default', async t => {
  for (const [limit, count] of [[0, 0], [1, 1], ['invalid', 2]]) await t.test(String(limit), async t => {
    const h = await harness(t, {limit, items: [item('One'), item('Two'), item('Three')]});
    h.commit();
    if (count) await until(() => h.telemetry.length === count);
    else { await tick(); await tick(); }
    assert.equal(h.runs.length, count);
    if (!count) assert.equal(h.operations.length, 0);
  });
});

test('open/acting turns and pending player choices never start a proposal', async t => {
  for (const [state, pending] of [['open', null], ['acting', null], ['committing', null], ['asked', {kind: 'choice'}], ['awaiting_player', {kind: 'defense'}]]) await t.test(state, async t => {
    const h = await harness(t, {}); h.view.state = state; h.view.pending_choice = pending;
    h.commit(); await until(() => h.scans.length === 1);
    assert.equal(h.runs.length, 0);
    assert.equal(h.operations.some(row => row.method === 'mods.job'), false);
    assert.equal(h.scans[0].reason, 'not_idle');
    assert.equal(h.scans[0].started, 0);
    assert.equal(h.scans[0].turn, 1);
  });
});

test('new input invalidates a queued scan and in-turn usage preparation keeps its ordinary route', async t => {
  const h = await harness(t);
  h.commit(); h.input();
  const effect = {kind: 'usage', object: 'Chair', name: 'Swing', description: 'Swing the chair at an attacker'};
  await h.bridge.prepare('apply', {campaign: 'c1', effects: [effect]});
  await tick();
  assert.equal(h.runs.length, 1);
  assert.ok(effect._usage); assert.equal(effect._queued, undefined);
  const jobs = h.operations.filter(row => row.method === 'mods.job');
  assert.deepEqual(jobs[0].params.input, {object: 'Chair', name: 'Swing', description: effect.description});
  assert.equal(h.operations.some(row => row.method === 'mods.prefetch.accept'), false);
  assert.equal(h.telemetry.length, 0);
  assert.ok(h.events.some(event => event.event === 'mods-progress'));
});

test('foreground work cancels an active proposal without waiting or starting the next candidate', async t => {
  const started = latch(), finish = latch();
  const h = await harness(t, {items: [item('Chair'), item('Second')], async run(task, signal) {
    const request = JSON.parse(await readFile(join(task.request.cwd, 'request.json'), 'utf8'));
    if (request.input.propose) { started.release(); await finish.promise; signal.throwIfAborted(); }
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(usage('Swing')));
    return {ok: true};
  }});
  h.commit(); await started.promise; h.input();
  assert.equal(h.runs[0].signal.aborted, true);
  const effect = {kind: 'usage', object: 'Chair', name: 'Swing', description: 'Swing it now'};
  await h.bridge.prepare('apply', {campaign: 'c1', effects: [effect]});
  assert.ok(effect._usage, 'the action did not wait for the background promise');
  finish.release(); await until(() => h.telemetry.length === 1);
  assert.equal(h.telemetry[0].cancelled, true);
  assert.equal(h.telemetry[0].turn, 1);
  assert.equal(h.operations.some(row => row.method === 'mods.prefetch.accept'), false);
  assert.equal(h.runs.length, 2);
});

test('failed, timed-out and malformed proposals stay silent and retain task evidence', async t => {
  for (const failure of ['throw', 'timeout', 'parse', 'check']) await t.test(failure, async t => {
    const h = await harness(t, {async run(task) {
      if (failure === 'throw') throw new Error('creator unavailable');
      if (failure === 'timeout') return {ok: false, timedOut: true};
      await writeFile(join(task.request.cwd, 'result.json'), failure === 'parse' ? '{' : JSON.stringify(usage('Swing')));
      return {ok: true};
    }, check: async () => ({ok: false, error: 'invalid usage'})});
    const before = structuredClone(h.view);
    h.commit(); await until(() => h.telemetry.length === 1);
    assert.equal(h.telemetry[0].ok, false); assert.equal(h.telemetry[0].turn, 1);
    assert.deepEqual(h.view, before);
    assert.equal(h.events.length, 0);
    assert.equal(h.operations.some(row => ['table.apply', 'mods.prefetch.accept', 'mods.accept'].includes(row.method)), false);
    assert.ok(await readFile(join(h.runs[0].task.request.cwd, 'run-1.json'), 'utf8'));
  });
});

test('zero candidates still leave a scan summary without player-visible output', async t => {
  for (const items of [[], [item('Used', {has_any_usage: true}), item('Covered', {covered: true})]]) await t.test(String(items.length), async t => {
    const h = await harness(t, {items}); h.commit();
    await until(() => h.scans.length === 1);
    assert.deepEqual(h.scans[0], {lane: 'usage-prefetch', event: 'scan', campaign: 'c1', turn: 1, prefetched: true,
      scanned: items.length, candidates: 0, started: 0, skipped: {has_any_usage: items.length / 2, covered: items.length / 2},
      reason: 'completed', retained_turn: 2, state: 'awaiting_player', worldline: 'main'});
    assert.equal(h.runs.length, 0); assert.equal(h.events.length, 0);
  });
});

test('a worldline switch while the child runs discards its result', async t => {
  const started = latch(), finish = latch();
  const h = await harness(t, {async run(task) { started.release(); await finish.promise;
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(usage('Swing'))); return {ok: true}; }});
  h.commit(); await started.promise;
  h.view.worldline = 'branch'; finish.release();
  await until(() => h.scans.length === 1);
  assert.equal(h.telemetry[0].ok, false);
  assert.equal(h.scans[0].reason, 'cancelled');
  assert.equal(h.operations.some(row => row.method === 'mods.prefetch.accept'), false);
});

test('a turn that becomes active while the child runs cannot accept its result', async t => {
  const started = latch(), finish = latch();
  const h = await harness(t, {async run(task) { started.release(); await finish.promise;
    await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(usage('Swing'))); return {ok: true}; }});
  h.commit(); await started.promise;
  h.view.turn = 2; h.view.state = 'acting'; finish.release();
  await until(() => h.telemetry.length === 1);
  assert.equal(h.telemetry[0].ok, false); assert.equal(h.telemetry[0].turn, 1);
  assert.equal(h.operations.some(row => row.method === 'mods.prefetch.accept'), false);
});
