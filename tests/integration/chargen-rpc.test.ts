/** The transport/persistence cases retained beside the direct chargen arithmetic tier. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,CAMPAIGN,CONTENT_DIR,campaignDir,readJson} from './support.ts';
test('test_kernel_sheets_are_reproducible_from_the_seed',async t=>{
  const k=await kernel(t);for(const campaign of ['c1','c2']){await k.ok('campaign.create',{id:campaign,module:'the-haunting'});
    assert.equal((await k.ok('setup.investigator',{campaign,name:'Ada',occupation:'Journalist',method:'rolled',seed:42,age:35})).receipt,'investigator:ada');}
  const one=readJson(join(campaignDir(k.workspace,'c1'),'party/ada.json')),two=readJson(join(campaignDir(k.workspace,'c2'),'party/ada.json'));
  assert.deepEqual(one,two);assert.equal(one.creation.seed,'42');assert.deepEqual([one.current_hp,one.current_san,one.current_mp,one.current_luck],[one.derived.HP,one.derived.SAN,one.derived.MP,one.characteristics.LUCK]);
});
test('test_kernel_defaults_come_from_the_steps_table',async t=>{
  const k=await kernel(t);await k.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting'});const result=await k.ok('setup.investigator',{campaign:CAMPAIGN,name:'Ada',occupation:'Antiquarian'});
  const policy=readJson(join(CONTENT_DIR,'setup/steps.json')).steps.find((row:any)=>row.id==='create-investigator');
  assert.equal(result.sheet.age,policy.defaults.age);assert.equal(result.sheet.creation.method,policy.defaults.method);assert.equal(result.sheet.era,'1920s');
});
