/** Authored spatial projections and bounded previews from test_scene_material_views.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,CONTENT_DIR,readJson,writeJson,importSource,type Row} from './support.ts';
const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
const {whereSection,jsonSize}=await importSource('kernel-ts/read/capsule.ts');
const {BUDGETS}=await importSource('kernel-ts/read/assemble.ts');
const dossier=readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier;
const PLACE_TEXT='The passage has worn stone walls, scattered rubble, low ceilings, and narrow alcoves. Its western branch connects to the workshop, while the eastern branch returns to the courtyard.';
const RULE_TEXT='The entrance is difficult to notice because the surrounding masonry is broken and scattered, and the doorway is partly concealed by debris from the upper floor. Once discovered, entering the passage requires no skill roll.';
function spatialGraph():[Row,string]{
  const data=readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json')),scene='scene-commission-briefing';assert.ok(data.nodes.some((node:Row)=>node.node_id===scene));
  const additions=[['location-test-building','location','Test Building',''],['location-other-building','location','Other Building',''],['asset-direct-plan','asset','Direct Plan',''],['asset-building-plan','asset','Building Plan',''],['asset-unrelated-plan','asset','Unrelated Plan',''],
    ...Array.from({length:10},(_,i)=>[`location-room-${i}`,'location',`Room ${i}`,PLACE_TEXT]),...Array.from({length:8},(_,i)=>[`rule-passage-${i}`,'rule',`Passage Rule ${i}`,RULE_TEXT])];
  data.nodes.push(...additions.map(([node_id,node_kind,name,summary])=>({node_id,node_kind,name,summary,properties:{},visibility:'keeper-only',source_refs:[{source_id:'fixture',pdf_index:0}]})));
  const links=[[scene,'occurs-at','location-test-building'],['asset-direct-plan','depicts',scene],['asset-direct-plan','depicts','location-test-building'],['asset-building-plan','depicts','location-test-building'],['asset-unrelated-plan','depicts','location-other-building'],
    ...Array.from({length:10},(_,i)=>[`location-room-${i}`,'located-in','location-test-building']),...Array.from({length:8},(_,i)=>[scene,'uses-rule',`rule-passage-${i}`])];
  data.relations.push(...links.map(([from_node_id,relation_kind,to_node_id],i)=>({relation_id:`rel-spatial-fixture-${i}`,relation_kind,from_node_id,to_node_id,properties:{}})));return [data,scene];
}
test('test_compact_previews_admit_truncation_and_full_scene_retains_spatial_conditions',()=>{
  const [data,id]=spatialGraph(),graph=new ModuleGraph('the-haunting',data,'',dossier),before=structuredClone(graph.raw),scene=graph.nodes.get(id);
  const full=whereSection(graph,{},scene),compact=whereSection(graph,{},scene,()=> 'ready',true);
  assert.equal(full.places.length,10);assert.equal(full.rules.length,8);assert.ok(full.places.every((row:Row)=>row.line===PLACE_TEXT));assert.ok(full.rules.every((row:Row)=>row.line===RULE_TEXT));
  assert.ok(!('truncated' in full));assert.equal(compact.places.length,8);assert.equal(compact.rules.length,6);assert.equal(compact.truncated,true);
  assert.ok(compact.places.every((row:Row)=>row.truncated&&[...row.line].length<=90));assert.ok(compact.rules.every((row:Row)=>row.truncated&&[...row.line].length<=160));
  assert.deepEqual(graph.raw,before);assert.deepEqual(full.exits,compact.exits);assert.ok(!full.exits.some((row:Row)=>['workshop','courtyard'].includes(row.to)));
});
test('test_scene_finds_maps_of_its_authored_location_once_without_unrelated_maps',()=>{
  const [data,id]=spatialGraph(),graph=new ModuleGraph('the-haunting',data,'',dossier),names=graph.sceneAssets(graph.nodes.get(id)).map((row:Row)=>row.name);
  assert.equal(names.filter((name:string)=>name==='Direct Plan').length,1);assert.equal(names.filter((name:string)=>name==='Building Plan').length,1);assert.ok(!names.includes('Unrelated Plan'));
});
test('test_table_scene_look_is_full_while_turn_capsule_stays_bounded',async t=>{
  const [data]=spatialGraph(),k=await kernel(t),content=join(k.workspace,'content');cpSync(CONTENT_DIR,content,{recursive:true});writeJson(join(content,'starters/the-haunting/module-graph.json'),data);
  // This client gets the modified content root before it starts, rather than changing the shipped tree.
  const {RpcClient}=await import('./support.ts'),client=new RpcClient(join(k.workspace,'with-spatial-content'),{content});t.after(()=>client.close());
  await client.ok('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const full=(await client.table('look',{focus:'scene'})).where;assert.equal(full.places.length,10);assert.equal(full.places[0].line,PLACE_TEXT);assert.equal(full.rules.length,8);assert.equal(full.rules[0].line,RULE_TEXT);
  await client.table('narrate',{call_id:'t0-c1',text:'The owner places a key on the desk.'});const capsule=(await client.table('player_input',{text:'I examine the key.'})).capsule;
  assert.ok(capsule.truncated.includes('where'));assert.equal(capsule.where.truncated,true);assert.ok(capsule.where.places.length<=8);assert.ok(capsule.where.rules.length<=6);assert.ok(jsonSize(capsule.where)<=BUDGETS.where);
  const again=(await client.table('look',{focus:'scene'})).where;assert.deepEqual(again.places,full.places);assert.deepEqual(again.rules,full.rules);
});
