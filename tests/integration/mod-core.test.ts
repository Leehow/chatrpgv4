/** Inventory, adoption and definition cases migrated from test_mods.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,RpcClient,CAMPAIGN,campaignDir,readJson,writeJson,openTurn,createCampaign,prepared,type Row} from './support.ts';
import {weapon} from './mod-fixtures.ts';
const context=(k:RpcClient)=>k.ok('mods.context',{campaign:CAMPAIGN});
const sheetPath=(k:RpcClient)=>join(campaignDir(k.workspace),'party/thomas-hayes.json');
const worldPath=(k:RpcClient)=>join(campaignDir(k.workspace),'world.json');
const look=(k:RpcClient,name:string)=>k.table('look',{focus:'object',name});
const narrate=(k:RpcClient,call_id:string,text='Knott nods.')=>k.table('narrate',{call_id,text});

test('test_initial_inventory_is_audited_without_being_mentioned_and_adopted_once',async t=>{
  const k=await kernel(t);await createCampaign(k);const before=readJson(sheetPath(k));assert.ok((await context(k)).unregistered_equipment.some((row:Row)=>row.name==='flashlight'));
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'audit',input:{text:'The landlord welcomes you.'}});
  assert.ok(readJson(join(job.cwd,'request.json')).unregistered_equipment.some((row:Row)=>row.name==='flashlight'));
  await k.table('apply',{call_id:'t0-c1',effects:[await prepared(k,weapon('flashlight')),{kind:'object',name:'flashlight',to:'Thomas Hayes',adopt:'flashlight'}]});
  const after=readJson(sheetPath(k)),omit=({equipment,weapons,...rest}:Row)=>rest;assert.deepEqual(omit(before),omit(after));assert.equal(after.equipment.length,before.equipment.length);
  assert.ok(!after.equipment.includes('flashlight'));assert.equal(after.equipment.filter((row:Row)=>row?.name==='flashlight').length,1);
  assert.equal(after.weapons.find((row:Row)=>row.object_id).damage,'1D6');const receipts=(await k.table('status')).receipts;
  assert.ok(receipts.some((row:Row)=>row.adopted==='flashlight'));assert.ok(!receipts.some((row:Row)=>row.kind==='item'));
  await narrate(k,'t0-c2','诺特坐在书桌后面。');await k.table('open');assert.ok(!(await context(k)).unregistered_equipment.some((row:Row)=>row.name==='flashlight'));
  await k.table('player_input',{text:'我把手电交给诺特。'});await k.table('apply',{call_id:'t1-c1',effects:[{kind:'object',name:'flashlight',from:'Thomas Hayes',to:'Steven Knott',handover:'given'}]});
  assert.ok(!readJson(sheetPath(k)).equipment.some((row:any)=>(typeof row==='string'?row:row.name)==='flashlight'));
});
test('test_adoption_cannot_duplicate_or_change_existing_inventory_and_bad_batch_is_atomic',async t=>{
  const k=await kernel(t);await openTurn(k);const beforeSheet=readFileSync(sheetPath(k)),beforeWorld=readFileSync(worldPath(k)),definition=await prepared(k,weapon('flashlight'));
  for(const effect of [{kind:'object',name:'flashlight',to:'Thomas Hayes'},{kind:'object',name:'flashlight',to:'Thomas Hayes',adopt:'flashlight',condition:'broken'},{kind:'object',name:'flashlight',to:'Steven Knott',adopt:'flashlight'}]){
    assert.equal((await k.tableErr('apply',{call_id:'t1-c1',effects:[definition,effect]})).code,'invalid_params');assert.deepEqual(readFileSync(sheetPath(k)),beforeSheet);assert.deepEqual(readFileSync(worldPath(k)),beforeWorld);
  }
  const error=await k.tableErr('apply',{call_id:'t1-c1',effects:[definition,{kind:'object',name:'flashlight',to:'Thomas Hayes',adopt:'flashlight'},{kind:'object',name:'another',definition:'flashlight',to:'No such owner'}]});
  assert.equal(error.code,'unknown_entity');assert.deepEqual(readFileSync(sheetPath(k)),beforeSheet);assert.deepEqual(readFileSync(worldPath(k)),beforeWorld);
});
test('test_existing_equipment_state_is_preserved_and_executable_weapons_are_not_candidates',async t=>{
  const k=await kernel(t);await openTurn(k);const sheet=readJson(sheetPath(k));sheet.equipment=[{name:'medical kit',quantity:2,charges:3,condition:'damaged'},'.38 Revolver'];writeJson(sheetPath(k),sheet);
  assert.deepEqual((await context(k)).unregistered_equipment.map((row:Row)=>row.name),['medical kit']);
  const draft={name:'medical kit',category:'item',description:'A partially spent medical kit.',basis:'Fixture inventory state',parameters:{charges:8,effects:[]},player_view:{description:'A used kit.',fields:['charges']}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'medical kit',to:'Thomas Hayes',adopt:'medical kit'}]});
  const item=Object.values(readJson(worldPath(k)).objects.instances)[0] as Row;assert.equal(item.quantity,2);assert.equal(item.state.charges,3);assert.equal(item.state.condition,'damaged');
  assert.deepEqual((await context(k)).unregistered_equipment,[]);
});
test('test_mod_toggle_waits_for_safe_boundary',async t=>{
  const k=await kernel(t);await openTurn(k);const view=await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',enabled:false});
  let row=view.mods.find((r:Row)=>r.id==='natural-npc');assert.equal(row.active.enabled,true);assert.equal(row.pending.enabled,false);
  await narrate(k,'t1-c1','我们稍作停顿。');await k.table('player_input',{text:'我们继续。'});row=(await k.ok('mods.list',{campaign:CAMPAIGN})).mods.find((r:Row)=>r.id==='natural-npc');
  assert.equal(row.active.enabled,false);assert.ok(!row.pending);
});
test('test_generated_instance_transfer_preserves_identity_and_state',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,weapon()),{kind:'object',name:"Knott's launcher",definition:'Workshop launcher',to:'Steven Knott'}]});
  const before=readJson(worldPath(k)).objects.instances;assert.equal(Object.keys(before).length,1);const item=Object.values(before)[0] as Row;assert.equal(item.owner.kind,'npc');
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'object',name:"Knott's launcher",from:'Steven Knott',to:'Thomas Hayes',handover:'given'}]});const after=readJson(worldPath(k)).objects.instances;
  assert.deepEqual(Object.keys(after),Object.keys(before));assert.deepEqual(after[item.id].state,item.state);const view=await k.table('view');
  assert.equal(view.investigators[0].objects[0].name,"Knott's launcher");assert.deepEqual(view.investigators[0].objects[0].parameters,{damage:'1D6',magazine:1});
  assert.ok(!('malfunction' in view.investigators[0].weapons.find((row:Row)=>row.object_id)));await narrate(k,'t1-c3','诺特把发射器交到了我手里。');await k.table('open');assert.deepEqual(readJson(worldPath(k)).objects.instances,after);
});
test('test_bad_batch_does_not_register_definition',async t=>{
  const k=await kernel(t);await openTurn(k);const error=await k.tableErr('apply',{call_id:'t1-c1',effects:[await prepared(k,weapon()),{kind:'object',name:'Launcher',definition:'Workshop launcher',to:'Nobody here'}]});
  assert.equal(error.code,'unknown_entity');assert.ok(!readJson(worldPath(k)).objects);
});
test('test_definition_rejects_unsupported_mechanics',async t=>{
  const k=await kernel(t);await openTurn(k);const draft:Row=weapon();draft.parameters.teleport_radius=10;
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:draft});writeJson(join(job.cwd,'result.json'),draft);assert.equal((await k.err('mods.accept',{campaign:CAMPAIGN,job:job.job})).code,'invalid_params');
});
test('test_melee_definition_preserves_damage_bonus_without_dummy_gun_fields',async t=>{
  const k=await kernel(t);await openTurn(k);const draft:Row=weapon('Solid club');Object.assign(draft.parameters,{skill:'Fighting (Brawl)',magazine:null,malfunction:null,base_range_yards:null,adds_damage_bonus:true});
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'My club',definition:draft.name,to:'Thomas Hayes'}]});
  const definition=(await look(k,'My club')).definition;assert.equal(definition.parameters.adds_damage_bonus,true);assert.equal(definition.parameters.malfunction,null);
});
test('test_consumable_effect_and_charge_are_persisted_together',async t=>{
  const k=await kernel(t);await openTurn(k);const draft={name:'Soothing balm',category:'item',description:'A calming fictional balm',basis:'Fixture',parameters:{charges:1,effects:[{kind:'condition',value:'calm'}]},player_view:{description:'A soothing balm',fields:['charges']}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'My balm',definition:draft.name,to:'Thomas Hayes'}]});const action={intent:'investigate',decision:'objects:use',object:'My balm',target:'Thomas Hayes'};
  assert.equal((await k.table('resolve',{call_id:'t1-c2',action})).outcome.charges,0);assert.ok((await k.table('look',{focus:'investigator'})).conditions.includes('calm'));
  assert.equal((await k.table('resolve',{call_id:'t1-c2',action})).replayed,true);assert.equal((await k.tableErr('resolve',{call_id:'t1-c3',action})).code,'needs');
});
test('test_restart_and_disabled_generator_keep_existing_items_usable',async t=>{
  const k=await kernel(t);await openTurn(k);const draft={name:'Restoring tonic',category:'item',description:'A fictional tonic',basis:'Fixture',parameters:{charges:2,effects:[{kind:'mp',direction:'gain',amount:1}]},player_view:{description:'A tonic',fields:['charges']}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'My tonic',definition:draft.name,to:'Thomas Hayes'}]});await narrate(k,'t1-c2','我把药瓶收进包里。');
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-items',enabled:false});await k.close();const other=new RpcClient(k.workspace);t.after(()=>other.close());
  await other.table('open');await other.table('player_input',{text:'我喝一口药剂。'});const result=await other.table('resolve',{call_id:'t2-c1',action:{intent:'investigate',decision:'objects:use',object:'My tonic'}});
  assert.equal(result.outcome.charges,1);assert.equal((await other.table('view')).investigators[0].objects[0].state.charges,1);
});
test('test_a_definition_job_carries_only_the_table_its_category_can_use',async t=>{
  const k=await kernel(t);await openTurn(k);const catalogs=async(category:string,name:string)=>{const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:{name,category,description:'A fixture object.'}});return readJson(join(job.cwd,'request.json')).catalogs;};
  assert.deepEqual(Object.keys(await catalogs('weapon','Fixture launcher')),['weapons']);assert.deepEqual(Object.keys(await catalogs('spell','Fixture rite')),['spells']);assert.deepEqual(await catalogs('item','Fixture pencil'),{});
});
test('test_a_first_placement_may_name_its_giver_and_the_receipt_keeps_him',async t=>{
  const k=await kernel(t);await openTurn(k);const placement={kind:'object',name:'Given launcher',definition:'Handover launcher',to:'Thomas Hayes',why:'Knott hands it over'};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,weapon('Handover launcher')),{...placement,from:'Steven Knott',handover:'given'}]});
  const view=await look(k,'Given launcher');assert.equal(view.definition.name,'Handover launcher');assert.equal(view.instance.owner,readJson(sheetPath(k)).name);
  const receipts=(await k.table('status')).receipts;assert.ok(receipts.some((r:Row)=>r.id.startsWith('item:')));assert.ok(receipts.filter((r:Row)=>r.id.startsWith('item:')).some((r:Row)=>r.from));
  const absent=await k.tableErr('apply',{call_id:'t1-c2',effects:[{...placement,name:'Second launcher',definition:'No such launcher'}]});assert.equal(absent.code,'invalid_params');assert.ok(absent.message.includes('No such launcher'));assert.ok(!absent.message.includes('spells'));
  const wrong=await k.tableErr('apply',{call_id:'t1-c3',effects:[{...placement,from:'Steven Knott',to:'Steven Knott'}]});assert.equal(wrong.code,'invalid_params');assert.ok(wrong.message.includes('current owner'));
});
test('test_a_trait_nested_in_parameters_is_told_to_move_it_not_to_drop_it',async t=>{
  const k=await kernel(t);await openTurn(k);const measured=[{name:'length',value:91,unit:'cm',basis:'Fixture measurement.'}],draft:Row=weapon();draft.parameters.traits=measured;
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:{name:draft.name,category:draft.category,description:draft.description}});writeJson(join(job.cwd,'result.json'),draft);
  const refused=await k.err('mods.accept',{campaign:CAMPAIGN,job:job.job});assert.equal(refused.code,'invalid_params');assert.ok(refused.message.includes('traits'));assert.ok(refused.fix.includes('move it beside parameters'));
  delete draft.parameters.traits;draft.traits=measured;writeJson(join(job.cwd,'result.json'),draft);assert.deepEqual((await k.ok('mods.accept',{campaign:CAMPAIGN,job:job.job})).definition.traits,measured);
});
test('test_a_handed_over_object_opens_into_its_player_view_on_the_card',async t=>{
  const k=await kernel(t);await openTurn(k);const draft:Row={...weapon('Card launcher'),traits:[{name:'length',value:91,unit:'cm',basis:'Fixture.'},{name:'serial',value:'X-7',basis:'Keeper-only fixture.'}]};draft.player_view.traits=['length'];
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Handed launcher',definition:'Card launcher',to:'Thomas Hayes',from:'Steven Knott',handover:'given',why:'Knott hands it over'}]});
  const delivered=await narrate(k,'t1-c2','诺特把它推过桌面。'),row=delivered.mechanics.find((r:Row)=>r.kind==='item');assert.equal(row.definition,'ready');
  assert.deepEqual(row.object,{category:'weapon',description:'An improvised launcher.',traits:[{name:'length',value:91,unit:'cm',basis:'Fixture.'}],parameters:{damage:'1D6',magazine:1}});
  assert.ok(!JSON.stringify(row).includes('Fixture: a single-shot'));assert.ok(!JSON.stringify(row).includes('X-7'));
});
test('test_a_placement_that_omits_its_definition_is_offered_the_names_on_hand',async t=>{
  const k=await kernel(t);await openTurn(k);const target=(await context(k)).unregistered_equipment[0].name;
  const draft={name:'笔记本',category:'item',description:'A blank 1920s notebook.',basis:'Fixture basis.',parameters:{charges:null,effects:[]},player_view:{description:'一本空白笔记本。',fields:[]}};
  const placement={kind:'object',name:'大牛皮的笔记本',to:'Thomas Hayes',adopt:target,why:'登记已有笔记本'};
  const refused=await k.tableErr('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),placement]});assert.equal(refused.code,'invalid_params');assert.ok(refused.message.includes('大牛皮的笔记本'));
  // §263: the fix now offers the define-first route, then the accepted names ("set definition to it: 笔记本").
  assert.ok(refused.fix.includes('before this effect in the same batch'));assert.ok(refused.fix.includes('set definition to it: 笔记本'));
  await k.table('apply',{call_id:'t1-c2',effects:[await prepared(k,draft),{...placement,definition:'笔记本'}]});assert.equal((await look(k,'大牛皮的笔记本')).definition.name,'笔记本');
});
