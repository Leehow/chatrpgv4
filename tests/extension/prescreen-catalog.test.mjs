import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'prescreen-catalog-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `
export {prescreenCatalog} from './kernel-ts/read/prescreen-catalog.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {RuleObservations} from './kernel-ts/read/rule-facts.ts';
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
`, resolveDir: root, sourcefile: 'prescreen-catalog-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const graph = nodes => new api.ModuleGraph('fixture', {nodes, relations: []}, 'fixture', {});
const rule = (name, family) => ({node_kind: 'rule', name, properties: {family_id: family}});
const kinds = ['investigator', 'npc', 'object', 'catalog', 'rule', 'memory', 'session'];
function validate(catalog) {
  assert.equal(catalog.version, 1);
  assert.equal(new Set(catalog.candidates.map(c => c.key)).size, catalog.candidates.length);
  for (const candidate of catalog.candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), ['key', 'kind', 'label', 'method', 'params', 'summary']);
    assert.ok(kinds.includes(candidate.kind));
    assert.equal(typeof candidate.label, 'string');
    assert.equal(typeof candidate.summary, 'string');
    const {kind, method, params} = candidate;
    if (['investigator', 'npc', 'object', 'session'].includes(kind)) {
      assert.equal(method, 'table.look');
      assert.equal(params.focus, kind);
      assert.deepEqual(Object.keys(params).sort(), kind === 'session' ? ['focus'] : ['focus', 'name']);
      if (kind !== 'session') assert.ok(typeof params.name === 'string' && params.name.length);
    } else if (kind === 'memory') {
      assert.equal(method, 'table.recall');
      assert.deepEqual(params, {what: 'memory', limit: 8});
      assert.match(candidate.summary, /reports, not independent world truth/);
    } else {
      assert.equal(method, 'table.lookup');
      assert.equal(params.kind, kind);
      assert.deepEqual(Object.keys(params).sort(), ['kind', 'query']);
      assert.ok(typeof params.query === 'string' && params.query.length);
    }
  }
}

test('catalog indexes actual names and rule families without copying bodies or implying possession', () => {
  const input = {party: [{name: 'Unscripted Investigator', secret: 'sheet-body'}],
    world: {objects: {instances: {i: {name: 'Brass Key', owner: {name: 'Someone else'}}},
      definitions: {d: {name: 'brass-key'}, other: {name: 'Unusual Flask', description: 'object-body'}}}},
    graph: graph([{node_id: 'npc-a', node_kind: 'npc', name: 'Absent Friend'},
      {node_id: 'npc-z', node_kind: 'npc', name: 'Present Stranger', aliases: ['Visitor'], properties: {secret: 'npc-body'}},
      {node_id: 'scene-x', node_kind: 'scene', name: 'Not an NPC'}]),
    present: [{name: 'Visitor'}], rules: {nodes: new Map([
      ['r1', rule('First real rule', 'invented-family')], ['r2', rule('Second real rule', 'invented-family')],
      ['r3', {node_kind: 'decision', name: 'Not a rule', properties: {family_id: 'excluded'}}]])}};
  const result = api.prescreenCatalog(input);
  validate(result);
  assert.equal(result.omitted, 0);
  const byKind = kind => result.candidates.filter(c => c.kind === kind);
  assert.deepEqual(byKind('investigator').map(c => c.params.name), ['Unscripted Investigator']);
  assert.deepEqual(byKind('npc').map(c => c.params.name), ['Present Stranger', 'Absent Friend']);
  assert.deepEqual(byKind('object').map(c => c.params.name), ['Brass Key', 'Unusual Flask']);
  assert.match(byKind('object')[0].label, /Registered instance/);
  assert.match(byKind('object')[1].label, /Definition only/);
  assert.deepEqual(byKind('catalog').map(c => c.params.query), ['Brass Key', 'Unusual Flask']);
  assert.deepEqual(byKind('rule').map(c => c.params.query), ['invented-family']);
  assert.match(byKind('rule')[0].summary, /First real rule; Second real rule/);
  assert.doesNotMatch(JSON.stringify(result), /sheet-body|object-body|npc-body|Not an NPC|Not a rule|Someone else/);
  input.rules.nodes.set('r4', rule('A newly installed rule', 'new-family'));
  assert.ok(api.prescreenCatalog(input).candidates.some(c => c.kind === 'rule' && c.params.query === 'new-family'));
  assert.deepEqual(api.prescreenCatalog(input), api.prescreenCatalog(input));
});

test('64 slots rotate across every available kind, with present NPCs ahead and exact omission counts', () => {
  const names = Array.from({length: 100}, (_, i) => `Name ${String(i).padStart(3, '0')}`);
  const input = {party: names.map(name => ({name})),
    world: {objects: {definitions: Object.fromEntries(names.map(name => [name, {name}]))}},
    graph: graph(names.map(name => ({node_id: `npc-${name}`, node_kind: 'npc', name}))),
    present: [{name: names.at(-1)}], rules: {nodes: new Map(names.map(name => [name, rule(`${name} rule`, name)]))}};
  const result = api.prescreenCatalog(input);
  validate(result);
  assert.equal(result.candidates.length, 64);
  assert.equal(result.omitted, 502 - 64);
  assert.deepEqual(result.candidates.slice(0, 7).map(c => c.kind), kinds);
  assert.equal(result.candidates.find(c => c.kind === 'npc').params.name, names.at(-1));
  const reverse = {...input, party: [...input.party].reverse(),
    graph: graph([...input.graph.nodes.values()].reverse()), rules: {nodes: new Map([...input.rules.nodes].reverse())}};
  assert.deepEqual(api.prescreenCatalog(reverse), result, 'source insertion order does not affect selection');
});

test('missing optional sources add no fabricated names or rule families', () => {
  const result = api.prescreenCatalog({party: [{id: 'id-without-name'}], world: {}, graph: graph([]), present: []});
  validate(result);
  assert.deepEqual(result.candidates.map(c => c.kind), ['memory', 'session']);
  assert.equal(result.omitted, 0);
});

async function tree(path) {
  const result = {};
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const absolute = join(current, entry.name), relative = join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else result[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
    }
  }
  await walk(path);
  return result;
}

test('real TS workspace opt-in is additive, bound and read-only; descriptors use existing RPCs', async () => {
  const home = await mkdtemp(join(temporary, 'table-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'prescreen-catalog',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context);
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  try {
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.player_input', {text: 'I examine my surroundings.'});
    const base = join(home, '.coc', 'campaigns', 'c1');
    const turnState = async () => JSON.parse(await readFile(join(base, 'turn.json'), 'utf8')).state;
    assert.equal(await turnState(), 'open');
    const before = await tree(base);
    const ordinary = await call('table.workspace.read');
    assert.equal(ordinary.status, 'valid');
    assert.equal(Object.hasOwn(ordinary, 'read_catalog'), false);
    assert.deepEqual(await call('table.workspace.read', {preselect: false}), ordinary);
    assert.deepEqual(await call('table.workspace.read', {preselect: 'true'}), ordinary);
    const selected = await call('table.workspace.read', {preselect: true});
    validate(selected.read_catalog);
    const {read_catalog, ...withoutCatalog} = selected;
    assert.deepEqual(withoutCatalog, ordinary, 'coverage, manifest, binding and default workspace are untouched');
    assert.deepEqual(await call('table.workspace.read', {preselect: true}), selected);
    const stale = await call('table.workspace.read', {preselect: true, binding: {...ordinary.binding, stateStamp: 'stale'}});
    assert.equal(stale.status, 'unverifiable');
    assert.equal(Object.hasOwn(stale, 'read_catalog'), false);
    assert.deepEqual(await tree(join(home, '.coc', 'campaigns', 'c1')), before);
    const rules = await api.RuleObservations.load(context);
    const families = [...new Set([...rules.nodes.values()].filter(node => node.node_kind === 'rule')
      .map(node => node.properties.family_id).filter(Boolean))].sort();
    assert.deepEqual(read_catalog.candidates.filter(c => c.kind === 'rule').map(c => c.params.query).sort(), families);
    const sheet = JSON.parse(await readFile(join(home, '.coc', 'campaigns', 'c1', 'party', 'thomas-hayes.json'), 'utf8'));
    assert.ok(read_catalog.candidates.some(c => c.kind === 'investigator' && c.params.name === sheet.name));
    const prefetch = async () => {
      for (const candidate of read_catalog.candidates) {
        try { assert.ok(await call(candidate.method, {...candidate.params, _context_read: true})); }
        catch (error) {
          assert.ok(['unknown_entity', 'needs'].includes(error.code), `${candidate.key}: ${error.message}`);
        }
      }
    };
    await prefetch();
    assert.equal(await turnState(), 'open');
    assert.deepEqual(await tree(base), before, 'host look/lookup/recall never write campaign files');
    assert.deepEqual((await call('table.workspace.read')).binding, ordinary.binding, 'prefetch cannot invalidate its own binding');

    // A legacy snapshot is reconstructed in memory, not repaired on disk, by every host read.
    const worldPath = join(base, 'world.json'), world = JSON.parse(await readFile(worldPath, 'utf8'));
    delete world.scene_trail;
    await writeFile(worldPath, JSON.stringify(world));
    const legacyBefore = await tree(base), legacyBinding = (await call('table.workspace.read')).binding;
    await prefetch();
    for (const what of ['history', 'transcript'])
      assert.ok(await call('table.recall', {what, _context_read: true}));
    assert.deepEqual(await tree(base), legacyBefore, 'all host recall variants and catalog reads keep legacy files untouched');
    assert.deepEqual((await call('table.workspace.read')).binding, legacyBinding);
    assert.equal(await turnState(), 'open');

    // The ordinary Keeper path still repairs legacy state and advances the open turn.
    await call('table.look', {focus: 'investigator', name: sheet.name});
    assert.equal(await turnState(), 'acting');
    assert.equal(Object.hasOwn(JSON.parse(await readFile(worldPath, 'utf8')), 'scene_trail'), true);
    for (const request of [
      ['table.lookup', {kind: 'rule', query: families[0]}],
      ['table.recall', {what: 'memory', limit: 8}],
    ]) {
      const currentTurn = JSON.parse(await readFile(join(base, 'turn.json'), 'utf8')).turn;
      await call('table.narrate', {call_id: `t${currentTurn}-c1`, text: 'The room remains quiet.'});
      await call('table.player_input', {text: 'I continue examining the room.'});
      assert.equal(await turnState(), 'open');
      await call(...request);
      assert.equal(await turnState(), 'acting');
    }
  } finally { await runtime.close(); }
});
