/** Published starter asset names, bytes and visibility from test_module_lanes.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {kernel,CONTENT_DIR,MODULE,readJson,writeJson,importSource} from './support.ts';

test('test_starter_assets_come_from_the_graph',async t=>{
  const k=await kernel(t);await k.ok('module.register',{module_id:MODULE});
  const {createKernelContext}=await importSource('kernel-ts/context.ts'),{ModuleStore}=await importSource('kernel-ts/modules/store.ts');
  const store=new ModuleStore(await createKernelContext({workspace:k.workspace,content:CONTENT_DIR})),assets=await store.assets(MODULE);
  assert.equal(assets.length,30);assert.ok(assets.every((a:any)=>['handout','map','illustration'].includes(a.kind)));
  const handout=await store.asset(MODULE,'Handout 2: Unpublished Boston Globe Story (1918)');
  assert.ok(handout);assert.equal(handout.visibility,'player-safe');assert.equal(handout.kind,'handout');
  assert.ok(handout.authored_text.startsWith('BOSTON GLOBE'));assert.equal(handout.node_id,'handout-globe-unpublished-1918');
  assert.deepEqual(await store.asset(MODULE,'globe-unpublished-1918'),handout);
  const keeperOnly=await k.ok('module.asset',{module_id:MODULE,name:'Bed attack illustration'});
  assert.equal(keeperOnly.player_visible,false);assert.equal(keeperOnly.asset.visibility,'keeper-only');assert.deepEqual(keeperOnly.asset.pages,[454]);
});
test('test_replayed_starter_registration_publishes_late_local_asset_bytes_with_the_graph',async t=>{
  const k=await kernel(t),first=await k.ok('module.register',{module_id:MODULE}),generation=first.generation;
  assert.equal((await k.ok('module.asset',{module_id:MODULE,name:'Corbitt House Investigator Map'})).asset.path,null);
  const shared=join(k.workspace,'.coc/modules',MODULE),privateRoot=join(k.workspace,'.coc/module-campaigns/existing-campaign/modules',MODULE);
  cpSync(shared,privateRoot,{recursive:true});const meta=readJson(join(privateRoot,'module.json'));
  Object.assign(meta,{campaign_scope:'existing-campaign',source_generation:generation});writeJson(join(privateRoot,'module.json'),meta);
  const root=join(k.workspace,'.coc/module-assets/the-haunting-keeper-rulebook-40th-full-v1'),source=join(root,'assets/player/corbitt-house-investigator-map.png');
  mkdirSync(dirname(source),{recursive:true});writeFileSync(source,'private reviewed map bytes');
  writeJson(join(root,'identity.json'),{schema_version:1,asset_root_id:'the-haunting-keeper-rulebook-40th-full-v1',file_sha256:'a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb'});
  assert.equal((await k.ok('module.register',{module_id:MODULE})).generation,generation);
  const target=(await k.ok('module.asset',{module_id:MODULE,name:'Corbitt House Investigator Map'})).asset.path;
  assert.equal(target,join(shared,'assets/player/corbitt-house-investigator-map.png'));assert.deepEqual(readFileSync(target),readFileSync(source));
  assert.deepEqual(readFileSync(join(privateRoot,'assets/player/corbitt-house-investigator-map.png')),readFileSync(source));
});
