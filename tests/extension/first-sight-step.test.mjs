/**
 * Contract §168.5: a run that moved into a new scene after its capsule was read hands the Keeper that scene's first sight.
 *
 * Installed App, Blood Road, sixth table (2026-10-02), turn 1: the clerk moved the party from the prologue to the Esso
 * station; the Keeper's prose gave none of the book's station and no first-sight check ran after it.
 *
 * The engine's step (`firstSightStep`) over stub reads, and the kernel's `table.first_sight.view` in process: the rulebook
 * Haunting's introduction leads on to the Hall of Records, given a description, and Knott, given a biography.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {firstSightStep} from '../../runtime/jev/first-sight-step.ts';

const SECTION = {place: {id: 'esso', name: '埃索加油站', described: '两台旧加油机仍可用。'}, people: [{id: 'nate', name: '内特', described: '啤酒肚。'}]};
function deps({section = SECTION, campaign = 'c1', strip = new Set(), fail = false} = {}) {
  const rows = [], calls = [], viewed = [];
  return {rows, calls, viewed, deps: {campaign, stepId: 's3', record: row => rows.push(row),
    call: async method => { calls.push(method); if (fail) throw new Error('kernel down'); return {first_sight: section, head: 'first_sight is the player\'s first sight'}; },
    port: {campaign: 'c1', view: capsule => {
      viewed.push(capsule);
      const sight = capsule.first_sight, people = (sight.people ?? []).filter(person => !strip.has(person.id));
      return {...capsule, first_sight: {...(strip.has(sight.place?.id) ? {} : {place: sight.place}), ...(people.length ? {people} : {})}};
    }}}};
}

test('a scene the run moved into is asked for once: read from the kernel, through the host view noted on the turn, with its head', async () => {
  const run = {runId: 'r1', turn: 1, firstScene: 'prologue', scene: 'esso'}, d = deps();
  const sight = await firstSightStep(run, d.deps);
  assert.deepEqual(d.calls, ['table.first_sight.view']);
  assert.deepEqual(d.viewed, [{turn: {number: 1}, first_sight: SECTION}], 'the host view is told the turn, so the delivery\'s check takes these items');
  assert.deepEqual(sight, {head: 'first_sight is the player\'s first sight', ...SECTION});
  assert.deepEqual(d.rows, [{lane: 'run', event: 'first_sight', run: 'r1', step: 's3', scene: 'esso', place: true, people: 1}]);
  assert.equal(await firstSightStep(run, d.deps), undefined, 'once per scene per run');
  assert.equal(d.calls.length, 1);
});

test('nothing is asked where the run has not moved, without a turn, or for another campaign; an emptied or failed read hands nothing', async () => {
  for (const run of [{runId: 'r', turn: 1, firstScene: 'prologue', scene: 'prologue'}, {runId: 'r', turn: 1, scene: 'esso'}, {runId: 'r', firstScene: 'a', scene: 'esso'}]) {
    const d = deps();
    assert.equal(await firstSightStep(run, d.deps), undefined, JSON.stringify(run));
    assert.deepEqual(d.calls, []);
  }
  const other = deps({campaign: 'c2'});
  assert.equal(await firstSightStep({runId: 'r', turn: 1, firstScene: 'a', scene: 'esso'}, other.deps), undefined);
  assert.deepEqual(other.calls, []);
  const none = deps({section: null});
  assert.equal(await firstSightStep({runId: 'r', turn: 1, firstScene: 'a', scene: 'esso'}, none.deps), undefined);
  const inFlight = deps({strip: new Set(['esso', 'nate'])});
  assert.equal(await firstSightStep({runId: 'r', turn: 1, firstScene: 'a', scene: 'esso'}, inFlight.deps), undefined, 'every item still being checked');
  const failed = deps({fail: true});
  assert.equal(await firstSightStep({runId: 'r', turn: 1, firstScene: 'a', scene: 'esso'}, failed.deps), undefined);
  assert.equal(failed.rows[0].event, 'read_failed');
});

// The kernel's view, in process, on a copy of the rulebook Haunting given the words a first sight is made of.
const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'first-sight-view-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'first-sight-view-api.ts'},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const content = join(temporary, 'content');
await mkdir(join(content, 'starters'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
await cp(join(root, 'content/starters/the-haunting-rulebook'), join(content, 'starters/sight-fixture'), {recursive: true});
await cp(join(root, 'content/starters/the-haunting/pregens'), join(content, 'starters/sight-fixture/pregens'), {recursive: true});
const HALL = 'Rows of oak filing cabinets under green-shaded lamps; a clerk stamps deeds behind a brass grille.';
const KNOTT = 'A heavy-set man in his fifties in a rumpled brown suit, who mops his brow and talks too fast.';
const graphPath = join(content, 'starters/sight-fixture/module-graph.json'), graph = JSON.parse(await readFile(graphPath, 'utf8'));
graph.module_id = 'sight-fixture';
for (const node of graph.nodes) {
  if (node.node_id === 'scene-hall-of-records') { node.properties = {...node.properties, description: HALL}; node.visibility = 'player-safe'; }
  if (node.node_id === 'npc-steven-knott') { node.properties = {...node.properties, biography: KNOTT}; node.visibility = 'player-safe'; }
}
graph.relations.push({relation_id: 'rel-knott-present-in-hall', relation_kind: 'present-in', from_node_id: 'npc-steven-knott', to_node_id: 'scene-hall-of-records', claim_id: null, properties: {}});
await writeFile(graphPath, JSON.stringify(graph));

test('table.first_sight.view: the scene the party now stands in and who is there, as the book describes them; nothing once shown', async t => {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content, seed: 'sight', locks: api.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'sight-fixture', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  await call('table.player_input', {text: 'I go to the Hall of Records.'});
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'hall-of-records'}]});
  const view = await call('table.first_sight.view');
  assert.equal(view.first_sight.place.described, HALL);
  assert.deepEqual(view.first_sight.people.map(person => person.described), [KNOTT], 'Knott came in with the party from the entrance (§168.3)');
  assert.match(view.head, /first sight/);
  await call('table.narrate', {call_id: 't1-c2', text: 'Oak cabinets, green lamps; a heavy man in a brown suit mops his brow.'});
  await call('table.first_sight', {turn: 1, items: [{id: view.first_sight.place.id, kind: 'place', missing: []}, {id: view.first_sight.people[0].id, kind: 'person', missing: []}]});
  assert.deepEqual(await call('table.first_sight.view'), {first_sight: null}, 'shown is shown for good');
});
