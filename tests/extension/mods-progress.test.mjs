import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';

async function harness(t, {fail = false, hasUI = true} = {}) {
  const contentRoot = await mkdtemp(join(tmpdir(), 'mods-progress-'));
  await mkdir(join(contentRoot, 'ui', 'zz'), {recursive: true});
  await writeFile(join(contentRoot, 'languages.json'), JSON.stringify({source: 'zz', default: 'zz', suggested: ['zz']}));
  await writeFile(join(contentRoot, 'ui', 'zz', 'mods.json'), JSON.stringify({'progress.usage': 'Projected usage {objects} {done}/{total}'}));
  const priorFetch = globalThis.fetch;
  const priorPort = process.env.PIPIUI_BRIDGE_PORT;
  const priorCapability = process.env.PIPIUI_SESSION_CAPABILITY;
  process.env.PIPIUI_BRIDGE_PORT = '1';
  process.env.PIPIUI_SESSION_CAPABILITY = 'test';
  const events = [], statuses = [], hooks = new Map();
  globalThis.fetch = async (_url, options) => { events.push(JSON.parse(options.body)); return {}; };
  t.after(async () => {
    globalThis.fetch = priorFetch;
    if (priorPort === undefined) delete process.env.PIPIUI_BRIDGE_PORT; else process.env.PIPIUI_BRIDGE_PORT = priorPort;
    if (priorCapability === undefined) delete process.env.PIPIUI_SESSION_CAPABILITY; else process.env.PIPIUI_SESSION_CAPABILITY = priorCapability;
    await rm(contentRoot, {recursive: true, force: true});
  });
  const pi = {events: new EventEmitter(), on: (name, fn) => hooks.set(name, fn)};
  let bridge, release;
  const pending = new Promise(resolve => { release = resolve; });
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  await hooks.get('session_start')({}, {hasUI, ui: {setStatus: (key, line) => statuses.push({key, line})}});
  pi.events.emit('coc:table-open', {open: {campaign: {play_language: 'zz'}}});
  pi.events.emit('coc:kernel-bridge', {runtime: {contentRoot, home: contentRoot}, call: async (method, params) => {
    if (method === 'mods.queued') return {};
    if (method === 'mods.job') return {enabled: true, accepted: true, job: params.input.name};
    if (method === 'mods.accept') {
      await pending;
      if (fail) throw new Error('Preparation failed');
      return {definition: {name: params.job}, provenance: {mod: 'test'}};
    }
    throw new Error(method);
  }});
  const progress = () => events.filter(event => event.event === 'mods-progress').map(event => event.payload);
  return {bridge, release, statuses, progress, hooks};
}

const usage = (object, name = 'Strike') => ({kind: 'usage', object, name, description: 'Strike with the object'});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('definition batches retain done/total and add role and distinct object names without a TUI usage status', async t => {
  const h = await harness(t);
  const work = h.bridge.prepare('apply', {campaign: 'c1', effects: [
    {kind: 'define', name: 'Lamp'}, {kind: 'define', name: 'Rope'}, {kind: 'define', name: 'Lamp'},
  ]});
  await tick();
  assert.deepEqual(h.progress(), [{campaign: 'c1', role: 'define', objects: ['Lamp', 'Rope'], done: 0, total: 2}]);
  h.release();
  await work;
  assert.deepEqual(h.progress().map(row => row.done), [0, 1, 2]);
  assert.deepEqual(h.progress().at(-1), {campaign: 'c1', role: 'define', objects: ['Lamp', 'Rope'], done: 2, total: 2});
  assert.deepEqual(h.statuses, []);
});

test('in-turn usage emits object names, paints projected TUI words with a bounded label, and clears on completion', async t => {
  const h = await harness(t);
  const work = h.bridge.prepare('apply', {campaign: 'c1', effects: [usage('Lamp'), usage('Rope'), usage('Chair')]});
  await tick();
  const progress = h.progress().filter(row => row.role === 'usage');
  assert.deepEqual(progress, [{campaign: 'c1', role: 'usage', objects: ['Lamp', 'Rope', 'Chair'], done: 0, total: 3}]);
  assert.deepEqual(h.statuses, [{key: 'coc-mods', line: 'Projected usage Lamp, Rope … 0/3'}]);
  h.release();
  await work;
  assert.deepEqual(h.progress().filter(row => row.role === 'usage').map(row => row.done), [0, 1, 2, 3]);
  assert.deepEqual(h.statuses.at(-1), {key: 'coc-mods', line: undefined});
});

test('failed usage clears the status before the preparation error is returned', async t => {
  const h = await harness(t, {fail: true});
  const work = h.bridge.prepare('apply', {campaign: 'c1', effects: [usage('Lamp')]});
  await tick();
  assert.equal(h.statuses.at(-1).line, 'Projected usage Lamp 0/1');
  h.release();
  await assert.rejects(work, /Preparation failed/);
  assert.deepEqual(h.statuses.at(-1), {key: 'coc-mods', line: undefined});
  assert.equal(h.progress().at(-1).done, 1);
});

test('headless preparation still emits progress without touching the TUI', async t => {
  const h = await harness(t, {hasUI: false});
  h.release();
  await h.bridge.prepare('apply', {campaign: 'c1', effects: [usage('Lamp')]});
  assert.equal(h.progress().at(-1).role, 'usage');
  assert.deepEqual(h.statuses, []);
});

test('session shutdown clears an in-flight usage status', async t => {
  const h = await harness(t);
  const work = h.bridge.prepare('apply', {campaign: 'c1', effects: [usage('Lamp')]});
  await tick();
  await h.hooks.get('session_shutdown')();
  assert.deepEqual(h.statuses.at(-1), {key: 'coc-mods', line: undefined});
  const count = h.statuses.length;
  h.release();
  await work;
  assert.equal(h.statuses.length, count);
});
