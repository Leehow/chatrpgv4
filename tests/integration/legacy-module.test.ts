/** Published legacy books stay usable without the retired source builder. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,ROOT,readJson,importSource} from './support.ts';
import {confirmedInvestigator} from './setup-support.ts';
const source=join(ROOT,'tests/kernel/fixtures/legacy-module');
test('test_legacy_graph_and_assets_open_without_text_bundles_or_an_original_pdf',async t=>{
  const k=await kernel(t),target=join(k.workspace,'.coc/modules/grey-heron-dock');cpSync(source,target,{recursive:true});
  assert.ok(!existsSync(join(target,'source.pdf')));assert.ok(!existsSync(join(target,'bundle/pages')));
  assert.equal((await k.ok('module.status',{module_id:'grey-heron-dock'})).opening_ready,true);
  for(const name of ['dock-map','asset-dock-map','map-dock']){const asset=await k.ok('module.asset',{module_id:'grey-heron-dock',name});
    assert.equal(asset.player_visible,true);assert.deepEqual(readFileSync(asset.asset.path),readFileSync(join(source,'bundle/assets/map-dock.png')));}
  await k.ok('campaign.create',{id:'c1',module:'grey-heron-dock',play_language:'en'});await confirmedInvestigator(k);await k.ok('setup.complete',{campaign:'c1'});
  assert.equal((await k.table('open')).scene.name,'dock-teahouse');
  const error=await k.err('module.read.request',{module_id:'grey-heron-dock',purpose:'detail',focus:'dock-teahouse',question:'What does the original page say about the north door?'});
  assert.equal(error.details.reason,'needs_source');
});
test('test_a_new_visual_region_preserves_legacy_asset_names_and_uses_its_actual_media_type',async()=>{
  const {assetRegistry}=await importSource('kernel-ts/write/source.ts'),graph=readJson(join(source,'module-graph.json')),previous=readJson(join(source,'assets.json')).assets;
  previous[0].media_type='image/jpeg';Object.assign(graph.nodes.find((node:any)=>node.node_id==='asset-dock-map').properties,{image_sources:[{page:4}],asset_ref:'work/new-region.png',media_type:'image/png'});
  const entry=assetRegistry(graph,previous).assets[0];assert.equal(entry.bundle_asset_id,'map-dock');assert.equal(entry.path,'work/new-region.png');assert.equal(entry.media_type,'image/png');
});
