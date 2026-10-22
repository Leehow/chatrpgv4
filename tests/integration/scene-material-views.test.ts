/** Authored spatial projections and bounded previews from test_scene_material_views.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,CONTENT_DIR,readJson,writeJson,importSource,RpcClient,campaignDir,type Row} from './support.ts';
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

test('legacy occurs-at object rows remain available to readers but are never movement candidates',async t=>{
  const [data,id]=spatialGraph();
  const objects=[['object-uninstantiated-lantern','Uninstantiated lantern'],['object-uninstantiated-tools','Uninstantiated tools']];
  data.nodes.push(...objects.map(([node_id,name])=>({node_id,node_kind:'object',name,summary:name,properties:{},visibility:'keeper-only',source_refs:[{source_id:'fixture',pdf_index:0}]})));
  data.relations.push(...objects.map(([from_node_id],i)=>({relation_id:`legacy-object-location-${i}`,from_node_id,relation_kind:'located-in',to_node_id:'location-test-building',properties:{}})));
  const graph=new ModuleGraph('the-haunting',data,'',dossier);graph.projectSourcePlaces();
  assert.deepEqual(graph.scenePlaces(graph.nodes.get(id)).map((place:Row)=>place.name),[
    ...Array.from({length:10},(_,i)=>`Room ${i}`),'Uninstantiated lantern','Uninstantiated tools']);
  const k=await kernel(t),content=join(k.workspace,'legacy-object-content');cpSync(CONTENT_DIR,content,{recursive:true});
  writeJson(join(content,'starters/the-haunting/module-graph.json'),data);
  const client=new RpcClient(join(k.workspace,'legacy-object-workspace'),{content});t.after(()=>client.close());
  await client.ok('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const view=await client.table('look',{focus:'scene'});
  assert.deepEqual(view.where.places.slice(-2).map((place:Row)=>place.name),objects.map(([,name])=>name));
  assert.equal(JSON.stringify(readJson(join(campaignDir(client.workspace),'world.json')).objects??{}).includes('Uninstantiated'),false);
  await client.table('narrate',{call_id:'t0-c1',text:'You wait in the room.'});await client.table('player_input',{text:'I look around without choosing a new destination.'});
  const moves=(await client.ok('table.apply.options',{campaign:'c1'})).candidates.filter((candidate:Row)=>candidate.effect.kind==='move');
  assert.equal(moves.some((candidate:Row)=>objects.some(([id,name])=>[id,id.replace('object-',''),name].includes(candidate.effect.to))),false);
});

function innerSceneGraph(projectable=true):Row{
  const data=readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
  for(const node of data.nodes)if(node.properties?.runtime_projection?.record?.is_start)node.properties.runtime_projection.record.is_start=false;
  const additions:[string,string,string,Row][]=[['location-fixture-farm','location','Fixture farm',{}],
    ['location-fixture-house',projectable?'location':'scene','Fixture house',{runtime_projection:{kind:'scene',record:{scene_id:'fixture-house',is_start:true}}}],
    ...Array.from({length:16},(_,i):[string,string,string,Row]=>[`scene-neighbor-${i}`,'scene',`Neighbor ${i}`,{}]),
    ['scene-inner-front-room','scene','UNDISCLOSED_PRIVATE_ROOM_HEADING',{}],
    ['scene-inner-basement','scene','UNDISCLOSED_BASEMENT_HEADING',{}],
    ['object-inner-coat','object','An ordinary coat',{}],
    ['clue-inner-room-mark','clue','A local mark',{delivery_kind:'skill_check',skill:'Spot Hidden'}],
    ['clue-inner-basement-mark','clue','UNDISCLOSED_BASEMENT_CLUE',{}]];
  data.nodes.push(...additions.map(([node_id,node_kind,name,properties])=>({node_id,node_kind,name,summary:name,properties,visibility:'keeper-only',source_refs:[{source_id:'fixture',pdf_index:0}]})));
  const links=[['location-fixture-house','located-in','location-fixture-farm'],
    ...Array.from({length:16},(_,i)=>[`scene-neighbor-${i}`,'located-in','location-fixture-farm']),
    ['scene-inner-front-room','located-in','location-fixture-house'],['scene-inner-basement','located-in','scene-inner-front-room'],
    ['scene-inner-front-room','part-of','location-fixture-house'],['location-fixture-house','contains','scene-inner-front-room'],
    ['object-inner-coat','located-in','location-fixture-house'],
    ['clue-inner-room-mark','discoverable-at','scene-inner-front-room'],['clue-inner-basement-mark','discoverable-at','scene-inner-basement']];
  data.relations.push(...links.map(([from_node_id,relation_kind,to_node_id],i)=>({relation_id:`relation-inner-fixture-${i}`,from_node_id,relation_kind,to_node_id,properties:{}})));
  return data;
}

test('current source location projects direct inner scenes without descendant clues or source mutation',()=>{
  const data=innerSceneGraph(),graph=new ModuleGraph('the-haunting',data,'',dossier);graph.projectSourcePlaces();
  const parent=graph.scene('fixture-house'),before=structuredClone(graph.raw);
  const where=whereSection(graph,{},parent);
  assert.deepEqual(where.places.map((place:Row)=>place.name),['UNDISCLOSED_PRIVATE_ROOM_HEADING']);
  assert.equal(JSON.stringify(where.places).includes('UNDISCLOSED_BASEMENT'),false,'direct local navigation does not recursively reveal child material');
  assert.deepEqual(graph.sceneClueIds(parent),[],'containment alone gives no child clue authority');
  assert.deepEqual(graph.raw,before);
});

test('chosen inner navigation keeps crowded-container priority and reuses distinct stranded checks without another roll',async t=>{
  const k=await kernel(t),content=join(k.workspace,'inner-content');cpSync(CONTENT_DIR,content,{recursive:true});
  writeJson(join(content,'starters/the-haunting/module-graph.json'),innerSceneGraph(false));
  const pregenPath=join(content,'starters/the-haunting/pregens/thomas-hayes/character.json'),pregen=readJson(pregenPath);
  pregen.skills['Spot Hidden']=95;writeJson(pregenPath,pregen);
  const client=new RpcClient(join(k.workspace,'inner-workspace'),{content,env:{COC_KERNEL_SEED:'2'}});t.after(()=>client.close());
  await client.ok('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  await client.table('narrate',{call_id:'t0-c1',text:'You stand in the house; its owner permits a look inside the front room.'});
  const first=await client.table('player_input',{text:'I enter the permitted front room, observe its visible marks, and separately watch the owner.'});
  assert.equal(first.capsule.where.scene,'fixture-house');
  assert.equal(first.capsule.where.places[0].name,'UNDISCLOSED_PRIVATE_ROOM_HEADING');
  const offered=(await client.ok('table.apply.options',{campaign:'c1'})).candidates;
  const inner=offered.find((candidate:Row)=>candidate.effect.kind==='move'&&candidate.effect.to==='inner-front-room');
  assert.ok(inner,'the current inner scene survives sixteen earlier farm neighbors');
  assert.equal(inner.description.within,'fixture-house');
  assert.equal(inner.description.authority,'available_route_not_player_choice');
  assert.equal(offered.filter((candidate:Row)=>candidate.description.within).length<=12,true);
  assert.equal(offered.some((candidate:Row)=>candidate.effect.kind==='clue'&&candidate.effect.clue==='inner-room-mark'),false);
  const before=readJson(join(campaignDir(client.workspace),'world.json'));
  const refusal=await client.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'inner-room-mark'}]});
  assert.equal(refusal.code,'not_here');assert.ok(refusal.fix.includes('inner-front-room'));
  const deeper=await client.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'inner-basement-mark'}]});
  assert.equal(deeper.code,'not_here');assert.equal(deeper.fix.includes('inner-basement'),false,'the local correction does not treat a descendant area as the current direct child');
  const replacement=await client.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'inner-room-mark',establish:{summary:'A renamed version of the same authored clue.'},how:'An attempted repair.'}]});
  // §250.10: the establish beside the book's clue name is dropped, and the book's clue is still not obtainable from the enclosing place.
  assert.equal(replacement.code,'not_here');assert.ok(replacement.fix.includes('inner-front-room'));
  assert.deepEqual(readJson(join(campaignDir(client.workspace),'world.json')),before);
  const rolls:Row[]=[];
  for(const [index,goal]of ['Inspect the front room visible marks','Watch the owner response on entering'].entries())
    rolls.push(await client.table('resolve',{call_id:`t1-c${index+2}`,action:{actor:'Thomas Hayes',intent:'investigate',goal,method:goal,skill:'Spot Hidden'}}));
  assert.ok(rolls.every((roll:Row)=>roll.outcome.passed),JSON.stringify(rolls.map((roll:Row)=>roll.outcome)));
  assert.equal(new Set(rolls.map((roll:Row)=>roll.receipt)).size,2);
  await client.table('release',{release:'stranded'});
  const stranded=readJson(join(campaignDir(client.workspace),'turns/0001.json'));
  assert.equal(stranded.closed_by,'stranded');assert.equal(stranded.commit,null);
  assert.equal(stranded.receipts.filter((receipt:Row)=>receipt.kind==='roll').length,2);
  await client.table('player_input',{text:'I continue the already chosen front-room inspection from the two settled observations.'});
  const params={call_id:'t2-c1',effects:[{kind:'move',to:inner.effect.to},{kind:'clue',clue:'inner-room-mark',label:'Visible room mark',how:'Seen during the chosen inspection.'}]};
  const settled=await client.table('apply',params);
  const status=await client.table('status'),clue=status.receipts.find((receipt:Row)=>receipt.kind==='clue');
  assert.equal(clue.found_by.turn,1);assert.equal(clue.found_by.passed,true);
  assert.ok(stranded.receipts.some((receipt:Row)=>receipt.kind==='roll'&&receipt.id===clue.found_by.roll));
  assert.equal(status.receipts.some((receipt:Row)=>receipt.kind==='roll'),false,'movement and acquisition do not reroll the earlier chosen observations');
  assert.equal((await client.table('apply',params)).replayed,true);
  assert.equal((await client.tableErr('apply',{call_id:'t2-c2',effects:[{kind:'clue',clue:'inner-basement-mark'}]})).code,'not_here');
  const published=await client.table('narrate',{call_id:'t2-c3',text:'You finish the permitted inspection in the front room.'});
  assert.equal(JSON.stringify(published.mechanics).includes('UNDISCLOSED'),false);
  assert.equal(readJson(join(campaignDir(client.workspace),'world.json')).active_scene,'inner-front-room');
  assert.deepEqual(readJson(join(campaignDir(client.workspace),'world.json')).discovered_clues,['inner-room-mark']);
  assert.equal(settled.receipts.length,2);
  await client.close();const reopened=new RpcClient(client.workspace,{content});t.after(()=>reopened.close());
  assert.equal((await reopened.table('capsule')).where.scene,'inner-front-room');
  assert.deepEqual(readJson(join(campaignDir(reopened.workspace),'turns/0001.json')),stranded);
});
