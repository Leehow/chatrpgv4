/** Contract 237.10: kernel-ts/modules/reading-boundary.ts preserves the existing setup map. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {kernel, RpcClient, campaignDir, readJson, writeJson, type Row} from './support.ts';
import {indexed, opening, request, claim, observed, finish, write} from './module-support.ts';

const HANDLE = 'tar-smelling-dock';

async function pendingCampaign(k: RpcClient, campaign: string) {
  const [mid] = await indexed(k);
  await request(k, mid, 'skeleton');
  const job = await claim(k, mid);
  observed(job);
  const refs = [{page: 1}];
  write(join(job.work_dir, 'draft.json'), {
    nodes: [{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: refs,
      properties: {is_entrance: true, is_final: true}}],
    claims: [], node_refs: [], coverage: {}, dependencies: [], critical: ['/nodes/0'], ready_nodes: [],
  });
  write(join(job.work_dir, 'review.json'), {checked: [{paths: ['/nodes/0', '/coverage'],
    verdict: 'supported', source_refs: refs, reason: 'The fixture establishes an unread entrance.'}], missing: []});
  await finish(k, job);
  await k.ok('handles.job', {module: mid});
  await k.ok('handles.submit', {module: mid, entries: [{id: 'scene-dock', handle: HANDLE}]});
  await k.ok('campaign.create', {id: campaign, module: mid, start_scene: 'scene-dock', play_language: 'en'});
  const directory = campaignDir(k.workspace, campaign);
  assert.equal(existsSync(join(directory, 'world.json')), false);
  assert.equal(readJson(join(directory, 'campaign.json')).opening_scene, HANDLE);
  return mid;
}

test('source requests preserve a setup opening identity before a world exists and after restart', async t => {
  const k = await kernel(t), campaign = 'pending-opening';
  const mid = await pendingCampaign(k, campaign);
  const args: Row = {module_id: mid, campaign, purpose: 'opening', opening_scope: 'first_interaction',
    focus: HANDLE, foreground: false};
  const queued = await k.ok('module.read.request', args);
  assert.equal(queued.state, 'queued');
  const job = await k.ok('module.read.claim', {module_id: mid, campaign, owner: 'source-test'});
  assert.equal(job.job_id, queued.job_id);
  assert.equal(job.focus, 'dock', 'the source owner receives the book identity, not the campaign handle');
  assert.equal(job.known_nodes.some((node: Row) => node.node_id === 'scene-dock'), true);
  await k.ok('module.read.finish', {module_id: mid, campaign, job_id: job.job_id, lease: job.lease, outcome: 'cancelled'});
  await k.close();
  const resumed = new RpcClient(k.workspace);
  t.after(() => resumed.close());
  const retried = await resumed.ok('module.read.request', {...args, retry: true});
  const next = await resumed.ok('module.read.claim', {module_id: mid, campaign, owner: 'resumed-source-test'});
  assert.equal(next.job_id, retried.job_id);
  assert.equal(next.focus, 'dock');
  assert.equal(existsSync(join(campaignDir(k.workspace, campaign), 'world.json')), false);
});

test('an existing world map controls source identity even with stale setup bindings or an empty map', async t => {
  const k = await kernel(t), campaign = 'world-controls-source';
  const [mid] = await indexed(k), [openingJob] = await opening(k, mid);
  await finish(k, openingJob);
  await k.ok('handles.job', {module: mid});
  await k.ok('handles.submit', {module: mid, entries: [{id: 'scene-dock', handle: HANDLE}]});
  await k.ok('campaign.create', {id: campaign, module: mid, start_scene: 'scene-dock', play_language: 'en'});
  const directory = campaignDir(k.workspace, campaign), metaPath = join(directory, 'campaign.json');
  const worldPath = join(directory, 'world.json'), meta = readJson(metaPath), world = readJson(worldPath);
  assert.equal(world.node_handles['scene-dock'], HANDLE);
  meta.setup = {...meta.setup, node_handles: {'scene-dock': 'obsolete-setup-dock'}};
  writeJson(metaPath, meta);
  const ask = async (focus: string, question: string) => {
    const queued = await k.ok('module.read.request', {module_id: mid, campaign, purpose: 'answer', focus, question});
    const job = await k.ok('module.read.claim', {module_id: mid, campaign, owner: 'source-test'});
    assert.equal(job.job_id, queued.job_id);
    await k.ok('module.read.finish', {module_id: mid, campaign, job_id: job.job_id, lease: job.lease, outcome: 'cancelled'});
    return job.focus;
  };
  assert.equal(await ask(HANDLE, 'What is visible at the entrance?'), 'dock');
  assert.equal(await ask('obsolete-setup-dock', 'What is the stale binding?'), 'obsolete-setup-dock');
  world.node_handles = {};
  writeJson(worldPath, world);
  assert.equal(await ask(HANDLE, 'What does an explicitly empty world map bind?'), HANDLE);
});
