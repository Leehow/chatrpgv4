import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {withTableEntities,tableEntityId} from './kernel-ts/read/table-entities.ts'; export {admissionRequest} from './extensions/kernel/admission.ts'; export {report} from './kernel-ts/worldline/confluence-plan.ts'; export {actedOn} from './kernel-ts/npc/act-options.ts'; export {COC_TOOLS} from './extensions/kernel/tools.ts'; export {Check} from 'typebox/value'; export {withTablePeople,tablePersonId} from './kernel-ts/read/table-people.ts';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('campaign places and evidence remain readable when later source has the same name; source bytes remain unchanged',()=>{
 const name='Riverside photographic shop',clue='The delivery address';
 const raw={nodes:[{node_id:'source-shop',node_kind:'scene',name,summary:'The source describes another counter layout.',properties:{}}],relations:[],claims:[]};
 const before=JSON.stringify(raw),world={table_entities:[
  {id:api.tableEntityId('scene',name),kind:'scene',name,summary:'The shop established at this table.',turn:2},
  {id:api.tableEntityId('clue',clue),kind:'clue',name:clue,summary:'A warehouse address.',scene:name,turn:2}]};
 const module=api.withTableEntities({graph:new api.ModuleGraph('book',raw,'digest',{}),material:()=> 'missing'},world);
 assert.equal(module.graph.scene(name).summary,'The shop established at this table.');
 assert.equal(module.graph.search(name).length,1);
 assert.equal(module.graph.search(name)[0].summary,'The shop established at this table.');
 assert.equal(module.graph.clue(clue).summary,'A warehouse address.');
 assert.equal(module.material(name),'ready');
 assert.equal(module.material(clue),'ready');
 assert.equal(module.graph.sceneClueIds(module.graph.scene(name)).length,1);
 assert(module.graph.search(clue).some(node=>node.name===clue));
 assert.equal(JSON.stringify(raw),before);
 assert.equal(module.graph.nodes.get('source-shop').summary,'The source describes another counter layout.');
});

test('new place establishment remains visible to ordinary player admission',()=>{
 const proposal=api.admissionRequest('apply',{effects:[{kind:'move',to:'Riverside photographic shop',via:'Walk there',establish:{summary:'A public shop'}}]},{party:['Nora'],scene:{handle:'cemetery'}});
 assert(proposal);
 assert.match(JSON.stringify(proposal.lines),/establish/);
 assert.match(JSON.stringify(proposal.lines),/Riverside photographic shop/);
 const changed=api.admissionRequest('apply',{effects:[{kind:'move',to:'Riverside photographic shop',via:'Walk there',establish:{summary:'A different physical location'}}]},{party:['Nora'],scene:{handle:'cemetery'}});
 assert.notEqual(changed.key,proposal.key,'changed establishment must not reuse an earlier admission');
});

test('confluence cannot silently discard another branch campaign entity',()=>{
 assert.throws(()=>api.report(new api.ModuleGraph('book',{nodes:[],relations:[]},'digest',{}),[
  {line:'one',world:{active_scene:'dock',table_entities:[]}},
  {line:'two',world:{active_scene:'dock',table_entities:[{name:'A shop',kind:'scene'}]}}
 ],'dock'),error=>error.code==='needs'&&error.details.reason==='table_entity_merge_conflict');
});

test('source locations enter the scene view with their original identity, clues and rule relationships',()=>{
 const raw={nodes:[
  {node_id:'location-police',node_kind:'location',name:'Police station',summary:'Officers receive reports here.',source_refs:[{page:4}],properties:{}},
  {node_id:'clue-footprints',node_kind:'clue',name:'Footprints',properties:{}},
  {node_id:'rule-case-details',node_kind:'rule',name:'Case details require a Law check',properties:{}}
 ],relations:[
  {from_node_id:'clue-footprints',to_node_id:'location-police',relation_kind:'discoverable-at',properties:{}},
  {from_node_id:'location-police',to_node_id:'rule-case-details',relation_kind:'uses-rule',properties:{}}
 ],claims:[]};
 const original=JSON.stringify(raw),graph=new api.ModuleGraph('book',raw,'digest',{});
 graph.projectSourcePlaces();graph.projectSourcePlaces();
 const place=graph.scene('police');
 assert.equal(place.node_id,'location-police');assert.equal(graph.handle(place),'police');
 assert.equal(graph.kind('scene').length,1);assert.equal(place.source_kind,'location');
 assert.deepEqual(graph.sceneClueIds(place),['clue-footprints']);
 assert.equal(graph.out.get(place.node_id)[0].to_node_id,'rule-case-details');
 assert.equal(JSON.stringify(raw),original);
 assert.equal(new api.ModuleGraph('book',raw,'digest',{}).resolve('police').node_kind,'location');
 const withScene=new api.ModuleGraph('book',{...raw,nodes:[...raw.nodes,{node_id:'scene-police',node_kind:'scene',name:'Police station',properties:{}}]},'digest',{});
 withScene.projectSourcePlaces();withScene.projectSourcePlaces();
 assert.equal(withScene.scene('police').node_id,'scene-police','an existing authored scene wins over a same-handle location');
 const retainedSameHandle=new api.ModuleGraph('book',withScene.raw,'digest',{});
 retainedSameHandle.projectSourcePlaces(['police']);
 assert.equal(retainedSameHandle.scene('police').node_id,'scene-police','retention does not duplicate an authored scene with the same canonical handle');
});


test('retained source places survive a later authored scene alias without changing source identities',()=>{
 const raw={nodes:[
  {node_id:'location-town',node_kind:'location',name:'Desert town',properties:{}},
  {node_id:'scene-station',node_kind:'scene',name:'Fuel station',aliases:['Desert town'],properties:{}}
 ],relations:[],claims:[]};
 const before=JSON.stringify(raw);
 const graph=new api.ModuleGraph('book',raw,'digest',{});
 graph.projectSourcePlaces(['town']);graph.projectSourcePlaces(['town']);
 assert.equal(graph.scene('town').node_id,'location-town');
 assert.equal(graph.scene('station').node_id,'scene-station');
 assert.equal(graph.kind('scene').length,2);
 assert.equal(JSON.stringify(raw),before);
 const ordinary=new api.ModuleGraph('book',raw,'digest',{});
 ordinary.projectSourcePlaces();
 assert.equal(ordinary.kind('location').length,1,'unretained authored-scene precedence stays unchanged');
 for(const retained of ['location-town','mapped-town']){
  const mapped=new api.ModuleGraph('book',raw,'digest',{},new Map(),true,new Map([['location-town','mapped-town'],['scene-station','mapped-station']]));
  mapped.projectSourcePlaces([retained]);
  assert.equal(mapped.scene('mapped-town').node_id,'location-town');
 }
 const personRaw={...raw,nodes:[...raw.nodes,{node_id:'npc-town',node_kind:'npc',name:'Desert town',properties:{}}]};
 const personGraph=new api.ModuleGraph('book',personRaw,'digest',{});
 personGraph.projectSourcePlaces(['town']);
 assert.equal(personGraph.nodes.get('location-town').node_kind,'location','person identity exclusion remains authoritative');
});

test('an impression guides the Keeper without a second NPC reaction, while a contested roll still triggers one',()=>{
 const person={is:value=>value==='the officer'};
 const impression={id:'first-meeting',kind:'roll',roll_kind:'mod_check',npc:'the officer',actor:'investigator',impression:{reaction:'favorable'}};
 const check={id:'persuasion',kind:'roll',npc:'the officer',actor:'investigator'};
 assert.deepEqual(api.actedOn(person,{receipts:[impression]},[],true),[]);
 assert.deepEqual(api.actedOn(person,{receipts:[impression,check]},[],true),[{receipt:'persuasion',kind:'roll_against'}]);
});


test('the public apply schema accepts closing an existing note without inventing a new note name',()=>{
 const apply=api.COC_TOOLS.find(tool=>tool.name==='apply');
 assert(api.Check(apply.parameters,{effects:[{kind:'note',closes:'existing-manual-note'}]}));
});

test('a frozen delivery keeps provisional person identity until a safe module load',()=>{
 const name='Old clerk',id=api.tablePersonId(name),raw={nodes:[{node_id:'npc-clerk',node_kind:'npc',name,properties:{}}],relations:[],claims:[]};
 const world={table_people:[{name,from_passage:{sentence:'Old clerk waits.'},turn:1}],npc_presence:{[name]:{scene:'office'}},npc_character:{[id]:{personality:{description:'Careful listener.'}}}};
 const before=JSON.stringify(world),module=()=>({graph:new api.ModuleGraph('book',raw,'digest',{}),material:()=> 'ready'});
 const frozen=api.withTablePeople(module(),world,true);
 assert.equal(JSON.stringify(world),before);
 assert.ok(frozen.graph.nodes.has(id),'the previously established identity remains available');
 assert.equal(frozen.graph.npc(name).node_id,id,'the frozen name still resolves to its established person');
 api.withTablePeople(module(),world,false);
 assert.ok(world.table_people[0].replaced_by);
 assert.equal(world.npc_character['npc-clerk'].personality.description,'Careful listener.');
});
