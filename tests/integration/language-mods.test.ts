/** Language-scoped package counterparts of tests/kernel/test_language_mods.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,ROOT,MODULE,PREGEN,campaignDir,readJson} from './support.ts';
const FIXTURE=join(ROOT,'tests/fixtures/mods/language-zh'),ID='language-zh';
test('test_the_package_is_on_where_it_names_the_tag_and_extends_the_voice_lane_there',async t=>{
  const k=await kernel(t);await k.ok('mods.install',{path:FIXTURE});
  for(const [id,play_language] of [['zh','zh-Hans'],['en','en']])await k.ok('campaign.create',{id,module:MODULE,pregen:PREGEN,play_language});
  const locks=Object.fromEntries(['zh','en'].map(id=>[id,readJson(join(campaignDir(k.workspace,id),'world.json')).mods.active[ID].enabled]));
  assert.deepEqual(locks,{zh:true,en:false});assert.equal(readJson(join(campaignDir(k.workspace,'zh'),'world.json')).mods.active['zh-optimize'].enabled,true);
  await k.ok('mods.configure',{campaign:'zh',id:'zh-optimize',enabled:false});
  const owner=readFileSync(join(ROOT,'mods/narration-craft/voice-lane.md'),'utf8').trim(),addendum=readFileSync(join(FIXTURE,'voice-addendum.md'),'utf8').trim();
  assert.equal((await k.ok('voice.job',{campaign:'zh',backfill:true})).instruction,`${owner}\n\n## Language addendum: ${ID}\n\n${addendum}`);
  assert.equal((await k.ok('voice.job',{campaign:'en',backfill:true})).instruction,owner);
});
test('test_a_long_language_brief_installs_now_that_nothing_reads_it',async t=>{
  const k=await kernel(t),path=join(k.workspace,ID);cpSync(FIXTURE,path,{recursive:true});writeFileSync(join(path,'brief.md'),'x'.repeat(401));
  assert.equal((await k.ok('mods.install',{path})).id,ID);
});
