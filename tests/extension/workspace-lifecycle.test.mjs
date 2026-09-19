/** Contract evidence: real TS transactions through the installed context hooks. Not a playtest. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'workspace-lifecycle-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export * from './extensions/table/context-policy.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';
export * from './extensions/table/workspace/evidence.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('source bodies survive a real same-turn scene round trip and a context-runtime restart', async t => {
  const home = await mkdtemp(join(temporary, 'real-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'workspace-lifecycle',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('mods.configure', {id: 'keeper-context', enabled: true, settings: {mode: 'on'}});
  const input = await call('table.player_input', {text: 'I visit the newspaper archive and then return to the commission office.'});
  const rows = [], ctx = {model: {contextWindow: 1000000}};
  const setup = () => {
    const hooks = new Map(), bus = new Map();
    api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
      row => rows.push(row), () => api.workpadStoreRoot(home));
    bus.get('coc:kernel-bridge')({campaign: 'c1', call});
    return {hooks, bus};
  };
  let host = setup();
  host.bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
  const messages = [{role: 'user', content: 'I visit the archive and return.'}];
  const request = async () => {
    const result = await host.hooks.get('context')({messages}, ctx);
    const message = result.messages.find(message => message.customType === 'coc-workspace');
    assert.ok(message, JSON.stringify(rows.slice(-4)));
    assert.ok(api.pairedTools(result.messages));
    return JSON.parse(message.content);
  };
  const first = await request();
  assert.ok(first.evidence.some(entry => entry.body), 'the first model request contains bodies');
  let sequence = 0;
  const move = async (to, id) => {
    await host.hooks.get('tool_call')({toolName: 'apply', toolCallId: id, input: {effects: [{kind: 'move', to}]}});
    const result = await call('table.apply', {call_id: `t${input._context.turn}-c${++sequence}`, effects: [{kind: 'move', to, travel_minutes: 1}]});
    await host.hooks.get('tool_result')({toolName: 'apply', toolCallId: id, details: result, isError: false});
  };
  await move('newspaper-morgue', 'move-out');
  assert.equal((await call('table.workspace.read')).binding.scene, 'newspaper-morgue');
  const away = await request();
  assert.ok(away.evidence.some(entry => entry.locator === 'scene:newspaper-morgue' && entry.body));
  await move('commission-briefing', 'move-back');
  const returned = await request();
  assert.equal((await call('table.workspace.read')).binding.scene, 'commission-briefing');
  assert.ok(returned.evidence.some(entry => entry.locator === 'scene:commission-briefing' && entry.body));
  assert.ok(rows.some(row => row.lane === 'workspace-evidence' && row.hits > 0), 'return consumes persistent evidence');
  await host.hooks.get('session_shutdown')();
  host = setup();
  const restarted = await request();
  assert.ok(restarted.evidence.some(entry => entry.locator === 'scene:commission-briefing' && entry.body));
  assert.ok(rows.filter(row => row.lane === 'workspace-evidence').at(-1).hits > 0, 'new context owner reads L2 bodies');
});

test('scene drafts stay dormant and separate store instances compare revisions under one lock', async () => {
  const home = await mkdtemp(join(temporary, 'drafts-')), root = api.workpadStoreRoot(home);
  const a = {campaign: 'c1', worldline: 'main', loop: 0, scene: 'office'};
  const b = {...a, scene: 'archive'};
  const patch = {focus: 'Question at the office', upserts: [{id: 'question', kind: 'open_question', text: 'Where did the letter come from?', evidence: ['npc:knott']}]};
  const input = {scope: a, baseRevision: 0, turn: 1, stateStamp: 'a'.repeat(64), patch};
  const outcomes = await Promise.all([api.createWorkpadStore(root).publish(input), api.createWorkpadStore(root).publish(input)]);
  assert.deepEqual(outcomes.map(row => row.status).sort(), ['discarded', 'published']);
  assert.equal((await api.createWorkpadStore(root).read(b)).status, 'empty');
  assert.equal((await api.createWorkpadStore(root).read(a)).view.focus, patch.focus);
});

test('persistent scene and travelling-entity references restore bodies outside the fresh candidate pool', async () => {
  const home = await mkdtemp(join(temporary, 'dormant-')), root = join(home, '.coc', 'workspace-cache', 'evidence');
  const scope = {campaign: 'c1', worldline: 'main', loop: 0};
  const binding = {...scope, scene: 'office', source_revision: 'a'.repeat(64), rules_revision: 'b'.repeat(64), adapter: 'static-evidence-v2'};
  const snapshot = {status: 'valid', binding, authority: {checked: true}, candidates: {static: []}, relevant_entities: []};
  const candidate = name => ({locator: `npc:${name}`, kind: 'npc', scope, authority: 'module_source',
    body: `Authored profile of ${name}`, coverage: 'complete', scene_refs: ['office'], entity_refs: [name], thread_refs: []});
  const signal = new AbortController().signal;
  await api.reuseEvidence(root, snapshot, [{...candidate('stationary'), thread_refs: ['house-records']}, candidate('traveller')], signal);
  const away = {...snapshot, binding: {...binding, scene: 'archive'}, relevant_entities: ['traveller']};
  assert.deepEqual((await api.dormantEvidence(root, away, 32, signal)).map(ref => ref.locator), ['npc:traveller']);
  const thread = {...away, relevant_entities: [], candidates: {static: [{scene_refs: ['archive'], thread_refs: ['house-records']}]}};
  assert.deepEqual((await api.dormantEvidence(root, thread, 32, signal)).map(ref => ref.locator), ['npc:stationary']);
  assert.equal((await api.dormantEvidence(root, snapshot, 32, signal)).length, 2, 'return restores both retained office references');
  assert.deepEqual(await api.dormantEvidence(root, {...snapshot, binding: {...binding, source_revision: 'changed'}}, 32, signal), []);
  assert.deepEqual(await api.dormantEvidence(root, {...snapshot, binding: {...binding, worldline: 'other'}}, 32, signal), []);
});
