/** Bound-book and investigator-library setup resume counterparts. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,CAMPAIGN,MODULE,campaignDir,readJson} from './support.ts';
import {indexed,opening,finish} from './module-support.ts';
import {confirmedInvestigator} from './setup-support.ts';

test('test_bound_book_campaign_gets_its_world_when_the_graph_arrives',async t=>{
  const k=await kernel(t),[mid]=await indexed(k);await k.ok('campaign.create',{id:CAMPAIGN,module:mid,play_language:'zh-Hans'});
  const dir=campaignDir(k.workspace);assert.equal(readJson(join(dir,'campaign.json')).status,'setting_up');assert.ok(!existsSync(join(dir,'world.json')));
  let resume=await k.ok('setup.steps',{campaign:CAMPAIGN});assert.ok(['zh-Hans','en'].includes(resume.state.play_language));
  assert.deepEqual(resume.completed,['choose-source','create-campaign']);assert.equal(resume.state.module_id,mid);assert.equal(resume.state.source.kind,'pdf');
  await k.ok('setup.occupations',{campaign:CAMPAIGN});assert.deepEqual(readdirSync(join(dir,'party')).filter(name=>name.endsWith('.json')),[]);assert.ok(!existsSync(join(dir,'world.json')));
  const [job]=await opening(k,mid);await finish(k,job);await confirmedInvestigator(k,CAMPAIGN,'Marcus');resume=await k.ok('setup.steps',{campaign:CAMPAIGN});
  assert.ok(resume.completed.includes('prepare-module'));assert.ok(resume.completed.includes('create-investigator'));
  assert.equal((await k.ok('setup.complete',{campaign:CAMPAIGN})).status,'ready_for_table');const world=readJson(join(dir,'world.json')),meta=readJson(join(dir,'campaign.json'));
  assert.equal(world.active_scene,meta.opening_scene);assert.ok(meta.module_digest);assert.equal((await k.table('open')).campaign.status,'active');
  assert.equal((await k.ok('setup.steps',{campaign:CAMPAIGN})).completed.at(-1),'complete');
});
test('test_steps_resume_for_a_starter_and_an_unknown_campaign',async t=>{
  const k=await kernel(t);assert.ok(!('completed' in await k.ok('setup.steps')));const unknown=await k.ok('setup.steps',{campaign:'nobody'});
  assert.deepEqual(unknown.completed,[]);assert.deepEqual(unknown.state,{campaign:'nobody'});
  await k.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting',play_language:'zh-Hans'});const resume=await k.ok('setup.steps',{campaign:CAMPAIGN});
  assert.deepEqual(resume.completed,['choose-source','create-campaign']);assert.deepEqual(resume.state.source,{kind:'starter',module_id:'the-haunting'});
});
test('test_module_source_reuses_an_installed_book_and_skips_the_build_lane',async t=>{
  const k=await kernel(t),[mid]=await indexed(k),[job]=await opening(k,mid);await finish(k,job);const second='second-camp';
  const created=(await k.ok('campaign.create',{id:second,module:mid,play_language:'zh-Hans'})).campaign;
  assert.equal(created.status,'setting_up');assert.deepEqual(created.investigators,[]);assert.ok(created.opening_scene);assert.ok(existsSync(join(campaignDir(k.workspace,second),'world.json')));
  const resume=await k.ok('setup.steps',{campaign:second});assert.deepEqual(resume.completed,['choose-source','prepare-module','create-campaign']);assert.deepEqual(resume.state.source,{kind:'module',module_id:mid});
  await k.ok('setup.occupations',{campaign:second});await confirmedInvestigator(k,second,'Reused');const handoff=await k.ok('setup.complete',{campaign:second});
  assert.equal(handoff.status,'ready_for_table');assert.equal(handoff.module_id,mid);assert.equal((await k.table('open',{campaign:second})).campaign.status,'active');
});
test('test_investigator_source_reuses_a_saved_card_and_skips_occupation_and_points',async t=>{
  const k=await kernel(t),first='first-camp',second='second-camp';await k.ok('campaign.create',{id:first,module:MODULE,play_language:'en'});
  const made=await confirmedInvestigator(k,first,'Marlowe');await k.ok('setup.complete',{campaign:first});const libraryId=(await k.ok('investigator.save',{campaign:first})).library_id;
  await k.ok('campaign.create',{id:second,module:MODULE,play_language:'en'});assert.ok((await k.ok('investigator.list')).investigators.some((row:any)=>row.library_id===libraryId));
  const loaded=await k.ok('investigator.load',{campaign:second,library_id:libraryId});
  const source=readJson(join(campaignDir(k.workspace,first),'party',made.investigator.id+'.json')),target=readJson(join(campaignDir(k.workspace,second),'party',loaded.investigator.id+'.json'));
  const withoutIdOrigin=({id,origin,...rest}:any)=>rest;assert.deepEqual(withoutIdOrigin(source),withoutIdOrigin(target));
  assert.deepEqual(source.origin,{library_id:libraryId});assert.deepEqual(target.origin,{library_id:libraryId,loaded_at_turn:0});
  const resume=await k.ok('setup.steps',{campaign:second});assert.ok(resume.completed.includes('browse-library'));assert.ok(resume.completed.includes('load-investigator'));assert.ok(!resume.completed.includes('create-investigator'));
  const handoff=await k.ok('setup.complete',{campaign:second});assert.equal(handoff.status,'ready_for_table');assert.deepEqual(handoff.investigators,[loaded.investigator.id]);
  assert.equal((await k.table('open',{campaign:second})).campaign.status,'active');
});
