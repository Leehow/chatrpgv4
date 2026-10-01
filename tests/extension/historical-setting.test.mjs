/** Scenario-to-reference seams; deterministic evidence, not live play. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {historyContext, savedBatch, selectionBatch} from '../../runtime/historical-reference.ts';
let api, folder;
const root=resolve(import.meta.dirname,'../..');
before(async()=>{
  await mkdir(join(root,'.tmp'),{recursive:true});folder=await mkdtemp(join(root,'.tmp/history-setting-'));
  await build({stdin:{contents:"export * from './kernel-ts/read/historical-setting.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {buildCapsule} from './kernel-ts/read/assemble.ts'; export {createKernelContext} from './kernel-ts/context.ts'; export {CampaignSnapshot,loadModule} from './kernel-ts/read/campaign.ts';",resolveDir:root},
    outfile:join(folder,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(folder,'api.mjs')).href);
});
after(async()=>{if(folder)await rm(folder,{recursive:true,force:true});});
const graph=(era,background,entranceEra)=>new api.ModuleGraph('fixture',{nodes:[
  {node_id:'module-fixture',node_kind:'module',name:'Setting',summary:background,properties:{era,entry_scene_ids:['scene-start']}},
  {node_id:'scene-start',node_kind:'scene',name:'Sherborne manor',properties:{is_start:true,is_entrance:true,...(entranceEra?{investigator_setup:{era:entranceEra}}:{})}},
],relations:[],entry_scene_ids:['scene-start']},'fixture',{});
const field=text=>({status:'value',text,source_refs:[{page:2}]});
test('selected authored medieval era survives finance fallback and the opening brief disappearing',()=>{
  const setting=api.projectHistoricalSetting(graph('1920s','Norman England, Wessex.','England around 1080'),{opening_scene:'scene-start'},null);
  const capsule={historical_setting:setting,where:{scene:'scene:elsewhere'},known:{investigator:{era:'1920s',finance_period:'1920s'}}};
  assert.equal(historyContext(capsule).period,'England around 1080');
  assert.match(historyContext(capsule).scenario.background,/Norman England/);
  assert.equal(capsule.module,undefined);
});
test('approved public source context takes precedence and retains Soviet institutional setting',()=>{
  const setting=api.projectHistoricalSetting(graph('1937','Legacy summary'),{},
    {era:field('October 1937'),starting_place:field('Kuybyshev, USSR'),public_premise:field('NKVD agents visit a sovkhoz state farm with wage labour and state-appointed management.')});
  assert.equal(setting.era,'October 1937');assert.equal(setting.starting_place,'Kuybyshev, USSR');
  assert.match(setting.background,/sovkhoz/);assert.equal(setting.source,'public_guidance');
  const context=historyContext({historical_setting:setting,where:{scene:'farm'}});
  const input={binding:'b',scope:{owner:'test',audience:'keeper'},query:'farm administration',context,player_input:'What are these records?'};
  assert.deepEqual(savedBatch(input,[],true).state.setting,context);
  assert.deepEqual(selectionBatch(input,[]).state.setting,context);
  assert.equal(selectionBatch({...input,query:'A saved reference title'},[]).state.player_input,'What are these records?','named reads retain the actual requested detail rather than only the reference address');
});
test('unknown setting remains unknown and copied source text stays within its byte ceiling',()=>{
  assert.equal(api.projectHistoricalSetting(graph(null,''),{},null).era,null);
  const setting=api.projectHistoricalSetting(graph('Medieval England','a'.repeat(7000)),{},null);
  assert.equal(setting.era,'Medieval England');assert.equal(setting.truncated,true);
  assert(Buffer.byteLength(JSON.stringify(setting))<=2048);
  const escaped=api.projectHistoricalSetting(graph('1080','\u4e2d\n\t"'.repeat(2000)),{},null);
  assert(Buffer.byteLength(JSON.stringify(escaped))<=2048);
});
test('real capsule always carries source setting without requesting its module briefing',async()=>{
  const context=await api.createKernelContext({workspace:folder,content:join(root,'content')});
  const campaign=new api.CampaignSnapshot(context,'fixture');
  campaign.meta={module_id:'the-haunting',play_language:'en',opening_scene:'scene:office'};
  campaign.world={active_scene:'scene:office',clock:{minutes:0}};campaign.turn={turn:2,state:'open'};
  const module=await api.loadModule(context,'the-haunting');
  module.graph=graph('1080','Wessex, Norman England.');campaign.meta.opening_scene='scene-start';campaign.world.active_scene='scene-start';
  const capsule=await api.buildCapsule(campaign,module,{moduleBrief:false,styleFull:false,situations:[]});
  assert.equal(capsule.module,undefined);assert.equal(capsule.historical_setting.era,'1080');
  assert.match(capsule.historical_setting.background,/Wessex/);
  assert.match(capsule.head,/historical_setting/);
});
test('public context loader rejects another source or an unapproved artifact',async()=>{
  const context=await api.createKernelContext({workspace:folder,content:join(root,'content')});
  const campaign=new api.CampaignSnapshot(context,'bound-guidance'),key='a'.repeat(64);
  campaign.meta={guidance_key:key,opening_scene:'scene-start',play_language:'en'};
  const module={graph:graph('1080','Norman England'),meta:{file_sha256:'source-sha',character_guidance:{[key]:{scene:'Sherborne manor',play_language:'en'}}}};
  const path=join(context.stateRoot,'modules','fixture','character-guidance',key);
  await mkdir(path,{recursive:true});
  const guide={approved:true,fingerprint:key,source_sha256:'source-sha',fields:{era:field('Public 1080'),starting_place:field('Wessex'),public_premise:field('Norman household service')}};
  await writeFile(join(path,'public.json'),JSON.stringify(guide));
  assert.equal((await api.historicalSetting(campaign,module)).era,'Public 1080');
  delete campaign.meta.guidance_key;
  assert.equal((await api.historicalSetting(campaign,module)).starting_place,'Wessex','a legacy campaign without a key recovers its unique approved entrance/language guide');
  module.meta.character_guidance['b'.repeat(64)]={scene:'Sherborne manor',play_language:'en'};
  assert.equal((await api.historicalSetting(campaign,module)).source,'authored_module','ambiguity cannot silently pick a different guide');
  delete module.meta.character_guidance['b'.repeat(64)];
  await writeFile(join(path,'public.json'),JSON.stringify({...guide,source_sha256:'different-pdf'}));
  assert.equal((await api.historicalSetting(campaign,module)).era,'1080');
  await writeFile(join(path,'public.json'),JSON.stringify({...guide,approved:false}));
  assert.equal((await api.historicalSetting(campaign,module)).source,'authored_module');
});
