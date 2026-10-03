/**
 * Contract §168.3: an entrance carries its people into the scene it leads to.
 *
 * Installed App 153469067, Blood Road, campaign game-717a9e4b (2026-10-02): the prologue (`is_entrance`) `hands-off-to`
 * the Esso station and both seat Lars, Nate and Steve, but a campaign seats each person once, in the entrance. The
 * player's 「开到油泵旁边」 moved the party to the station, the turn record read `Present: nobody` beside a station
 * description with three men under the awning, and the Keeper asked the player for their occupation.
 *
 * Here the rulebook Haunting's introduction stands in for the prologue: it `may-lead-to` the Hall of Records, and the
 * fixture seats Knott there too. A second copy writes that way as `route-to`, travel between places: ordinary travel
 * carries nobody.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'entrance-company-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: root, sourcefile: 'entrance-api.ts'},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

// The repository's content, with one more starter: the rulebook Haunting whose Hall of Records also seats Knott.
const content = join(temporary, 'content');
await mkdir(join(content, 'starters'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
for (const name of await readdir(join(root, 'content/starters'))) await symlink(join(root, 'content/starters', name), join(content, 'starters', name));
await cp(join(root, 'content/starters/the-haunting-rulebook'), join(content, 'starters/entrance-fixture'), {recursive: true});
const graphPath = join(content, 'starters/entrance-fixture/module-graph.json'), graph = JSON.parse(await readFile(graphPath, 'utf8'));
graph.module_id = 'entrance-fixture';
graph.relations.push({relation_id: 'rel-knott-present-in-hall', relation_kind: 'present-in', from_node_id: 'npc-steven-knott', to_node_id: 'scene-hall-of-records',
  claim_id: graph.relations.find(rel => rel.relation_kind === 'present-in')?.claim_id ?? null, properties: {}});
// Past the entrance the playing order carries nobody: the Hall leads on to the Globe, which seats Knott as well.
graph.relations.push({relation_id: 'rel-knott-present-in-globe', relation_kind: 'present-in', from_node_id: 'npc-steven-knott', to_node_id: 'scene-boston-globe', claim_id: null, properties: {}},
  {relation_id: 'rel-hall-leads-to-globe', relation_kind: 'may-lead-to', from_node_id: 'scene-hall-of-records', to_node_id: 'scene-boston-globe', claim_id: null, properties: {}});
await writeFile(graphPath, JSON.stringify(graph));
// The same book with the introduction's way to the Hall of Records written as travel (`route-to`): Knott stays put.
await cp(join(content, 'starters/entrance-fixture'), join(content, 'starters/route-fixture'), {recursive: true});
const routeGraph = join(content, 'starters/route-fixture/module-graph.json');
await writeFile(routeGraph, JSON.stringify({...graph, module_id: 'route-fixture', relations: graph.relations.map(rel =>
  rel.from_node_id === 'scene-introduction' && rel.to_node_id === 'scene-hall-of-records' && rel.relation_kind === 'may-lead-to' ? {...rel, relation_kind: 'route-to'} : rel)}));
// Both borrow the Haunting's pregenerated investigator, so a campaign opens without a setup meeting.
for (const name of ['entrance-fixture', 'route-fixture']) await cp(join(root, 'content/starters/the-haunting/pregens'), join(content, 'starters', name, 'pregens'), {recursive: true});

async function campaign(t, module) {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content, seed: 'entrance', locks: api.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module, pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
  await call('table.player_input', {text: 'I go on.'});
  const world = async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8'));
  return {call, world};
}
const handle = (world, id) => Object.keys(world.npc_presence).find(name => name.endsWith(id.replace(/^npc-/, '')));

test('a move out of the entrance along the book\'s playing order brings the people both scenes seat, and the receipt names them', async t => {
  const {call, world} = await campaign(t, 'entrance-fixture');
  const before = await world(), knott = handle(before, 'npc-steven-knott');
  assert.equal(before.npc_presence[knott], before.active_scene, 'seated in the entrance first');
  const landed = await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'hall-of-records'}]});
  const after = await world();
  assert.equal(after.npc_presence[knott], after.active_scene, 'Knott is where the party now stands');
  const receipt = (await call('table.status')).receipts.find(value => value.id === landed.receipts.find(id => id.startsWith('move:')));
  assert.deepEqual(receipt.with, [knott]);
  await call('table.apply', {call_id: 't1-c2', effects: [{kind: 'move', to: 'boston-globe'}]});
  const later = await world();
  assert.equal(later.npc_presence[knott], after.active_scene, 'past the entrance he stays at the Hall');
});

test('a move along route-to carries nobody, even someone the destination also seats', async t => {
  const {call, world} = await campaign(t, 'route-fixture');
  const before = await world(), knott = handle(before, 'npc-steven-knott');
  assert.equal(before.npc_presence[knott], before.active_scene);
  const landed = await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'hall-of-records'}]});
  const after = await world();
  assert.notEqual(after.active_scene, before.active_scene);
  assert.equal(after.npc_presence[knott], before.active_scene, 'Knott stays where he was');
  const receipt = (await call('table.status')).receipts.find(value => value.id === landed.receipts.find(id => id.startsWith('move:')));
  assert.equal(receipt.with, undefined);
});
