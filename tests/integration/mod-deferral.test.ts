/** Deferred identity/definition counterparts of tests/kernel/test_mods.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,RpcClient,CAMPAIGN,campaignDir,readJson,writeJson,openTurn,type Row} from './support.ts';
import {weapon} from './mod-fixtures.ts';
const queued=(k:RpcClient,args:Row={})=>k.ok('mods.queued',{campaign:CAMPAIGN,...args});
const context=(k:RpcClient)=>k.ok('mods.context',{campaign:CAMPAIGN});
const world=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'world.json'));
const sheet=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'party/thomas-hayes.json'));
const look=(k:RpcClient,name:string)=>k.table('look',{focus:'object',name});
const finish=async(k:RpcClient,job:Row,draft:Row)=>{writeJson(join(job.cwd,'result.json'),draft);return k.ok('mods.accept',{campaign:CAMPAIGN,job:job.job});};
const defineQueued=(draft:Row,job:Row)=>({kind:'define',...draft,_queued:job.job,_provenance:{mod:job.mod,digest:job.digest}});
const narrate=(k:RpcClient,call_id:string,text:string)=>k.table('narrate',{call_id,text});
const plain=(draft:Row,description:string)=>({...draft,category:'item',basis:'Ordinary item fixture.',parameters:{charges:null,effects:[]},player_view:{description,fields:[]}});

test('an existing notebook is writable before enrichment and later enrichment preserves its notes',async t=>{
  const k=await kernel(t);await openTurn(k);
  const target=(await context(k)).unregistered_equipment.find((entry:Row)=>entry.name==='notebook and stub pencil').name;
  const draft={name:'Notebook definition',category:'item',description:'The carried notebook and short pencil.'};
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:draft});
  await k.table('apply',{call_id:'t1-c1',effects:[defineQueued(draft,job),{kind:'object',name:'Hayes notebook',definition:draft.name,to:'Thomas Hayes',adopt:target,document:{text:'Children safe in Baltimore.\n',presentation:'notebook'},why:'Record the player-chosen note in the carried notebook.'}]});
  const initial=await look(k,'Hayes notebook');assert.equal(initial.instance.document.text,'Children safe in Baltimore.\n');
  const inventory=sheet(k).equipment;assert.equal(inventory.filter((entry:Row|string)=>typeof entry==='string'?entry===target:entry.name==='Hayes notebook').length,1);
  const identity=inventory.find((entry:Row)=>entry.name==='Hayes notebook').object_id;assert.ok(identity);
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'Hayes notebook',from:'Thomas Hayes',to:'Thomas Hayes',document:{action:'append',text:'Address withheld.\n'},why:'Append the second chosen note.'}]});
  await finish(k,job,{...plain(draft,'A carried notebook.'),document:{text:'Creator seed must not overwrite notes.',presentation:'notebook'}});
  await narrate(k,'t1-c3','The notes are written.');await k.table('player_input',{text:'I read my notebook.'});
  const ready=await queued(k);assert.deepEqual(ready.effects.map((entry:Row)=>entry.kind),['define']);
  await k.table('apply',{call_id:'t2-c1',effects:ready.effects});
  const completed=await look(k,'Hayes notebook');
  assert.equal(completed.instance.document.text,'Children safe in Baltimore.\nAddress withheld.\n');
  assert.equal(sheet(k).equipment.filter((entry:Row)=>entry.object_id===identity).length,1);
  await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  const reopened=await restarted.ok('mods.document.view',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Hayes notebook'});
  assert.equal(reopened.text,'Children safe in Baltimore.\nAddress withheld.\n');
});

test('test_registration_can_be_queued_past_delivery_and_completed_afterwards',async t=>{
  const k=await kernel(t);await openTurn(k);const rows=(await context(k)).unregistered_equipment.map((entry:Row)=>entry.name);assert.ok(rows.length);const target=rows[0];
  const draft={name:'Queued fixture kit',category:'item',description:'Fixture gear for a deferred registration.'};
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:draft});
  await k.table('apply',{call_id:'t1-c1',effects:[defineQueued(draft,job),{kind:'object',name:draft.name,to:'Thomas Hayes',adopt:target,definition:draft.name,why:'Fixture adoption.'}]});
  assert.equal(Object.keys(world(k).objects?.definitions??{}).length,1);assert.ok(!(await context(k)).unregistered_equipment.some((row:Row)=>row.name===target));
  await finish(k,job,{...plain(draft,'一套夹具装备。'),basis:'Fixture basis for the deferred kit.'});assert.deepEqual(await queued(k),{effects:[],unfinished:[]});
  const delivered=await narrate(k,'t1-c3','诺特把条件说完，等你开口。'),waiting=delivered.mechanics.filter((row:Row)=>row.adopted===target);
  assert.deepEqual(waiting,[{kind:'item',receipt:waiting[0].receipt,name:draft.name,adopted:target,definition:'pending',definition_name:draft.name,call:'t1-c1'}]);
  await k.table('player_input',{text:'我接下这单。'});const ready=await queued(k);assert.deepEqual(ready.effects.map((row:Row)=>row.kind),['define']);assert.deepEqual(ready.unfinished,[]);
  await k.table('apply',{call_id:'t2-c1',effects:ready.effects});assert.deepEqual((await k.table('status')).mechanics.filter((row:Row)=>row.adopted),[]);
  assert.equal((await look(k,draft.name)).definition.name,draft.name);assert.deepEqual(await queued(k),{effects:[],unfinished:[]});
  assert.ok(!(await context(k)).unregistered_equipment.some((row:Row)=>row.name===target));
});
test('test_plain_item_identity_lands_now_and_ready_definition_adopts_only_the_same_acquisition',async t=>{
  const k=await kernel(t);await openTurn(k);const define={kind:'define',name:'House key definition',category:'item',description:'An ordinary iron house key.'};
  const transfer={kind:'object',name:'House key',definition:define.name,to:'Thomas Hayes',from:'Steven Knott',handover:'given',why:'Knott hands over the key.'};
  const plan=await k.ok('mods.identity.plan',{campaign:CAMPAIGN,define,object:transfer});assert.equal(plan.eligible,true);assert.equal(plan.accepted,false);
  const result=await k.table('apply',{call_id:'t1-c1',effects:[{...defineQueued(define,plan),_identity_defer:true},{...transfer,_identity_defer:true}]});assert.ok(result.receipts.some((row:string)=>row.startsWith('item:')));
  const priorSheet=sheet(k),pending=priorSheet.equipment.find((row:Row)=>row?.name==='House key');assert.equal(pending.from,'Steven Knott');assert.ok(pending.pending_definition.startsWith('item:'));
  assert.equal(Object.keys(world(k).objects?.definitions??{}).length,0);assert.equal(Object.keys(world(k).objects?.instances??{}).length,0);
  await finish(k,plan,{name:define.name,category:'item',description:define.description,basis:'The request establishes only an ordinary iron key; no executable use is asserted.',parameters:{charges:null,effects:[]},player_view:{description:'一把普通的铁制房门钥匙。',fields:[]}});
  assert.deepEqual(await queued(k),{effects:[],unfinished:[]});
  const handed=(await k.table('status')).receipts.filter((row:Row)=>row.kind==='item'&&row.name==='House key');assert.deepEqual(handed.map((row:Row)=>row.pending_definition),[true]);
  await narrate(k,'t1-c2','诺特把钥匙交到你手里。');await k.table('player_input',{text:'我把钥匙收进口袋。'});assert.equal((await queued(k)).optional_ready,1);
  const ready=await queued(k,{publish_optional:true});assert.deepEqual(ready.effects.map((row:Row)=>row.kind),['define','object']);await k.table('apply',{call_id:'t2-c1',effects:ready.effects});
  const view=await look(k,'House key');assert.equal(view.definition.name,define.name);assert.equal(view.instance.owner,priorSheet.name);
  const promoted=(await k.table('status')).receipts;assert.deepEqual(promoted.filter((row:Row)=>row.kind==='item'),[]);
  assert.deepEqual(promoted.filter((row:Row)=>row.id.startsWith('definition:adopt-')).map((row:Row)=>[row.name,row.adopted,row.resumed]),[['House key','House key',true]]);
});
test('test_pending_identity_removed_before_creator_completion_is_never_resurrected',async t=>{
  const k=await kernel(t);await openTurn(k);const define={kind:'define',name:'Pending key definition',description:'An ordinary pending key.'},transfer={kind:'object',name:'Pending key',definition:define.name,to:'Thomas Hayes',why:'A key is handed over.'};
  const plan=await k.ok('mods.identity.plan',{campaign:CAMPAIGN,define,object:transfer});await k.table('apply',{call_id:'t1-c1',effects:[{...defineQueued(define,plan),_identity_defer:true},{...transfer,_identity_defer:true}]});
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'item',name:'Pending key',quantity:-1,why:'The key is returned.'}]});
  await finish(k,plan,{name:define.name,category:'item',description:define.description,basis:'Ordinary key fixture.',parameters:{charges:null,effects:[]},player_view:{description:'一把钥匙。',fields:[]}});
  await narrate(k,'t1-c3','钥匙已经交还。');await k.table('player_input',{text:'继续。'});assert.deepEqual(await queued(k,{publish_optional:true}),{effects:[],unfinished:[]});
  assert.equal((await k.tableErr('look',{focus:'object',name:'Pending key'})).code,'unknown_entity');
});
test('test_a_placement_beside_a_queued_definition_stands_on_a_placeholder_until_the_resume_replaces_it',async t=>{
  const k=await kernel(t);await openTurn(k);const draft=weapon('Queued launcher'),request={name:draft.name,category:'weapon',description:draft.description};
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:request});await k.table('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'clue-knott-commission',how:'Fixture.'},defineQueued(request,job),{kind:'object',name:'Borrowed launcher',definition:draft.name,to:'Thomas Hayes',why:'Fixture placement.'}]});
  const definitions=Object.entries(world(k).objects.definitions);assert.equal(definitions.length,1);const [definitionId,stand]=definitions[0] as [string,Row];
  assert.equal(stand.placeholder,true);assert.equal(stand.name,draft.name);assert.equal(stand.category,'weapon');assert.deepEqual(stand.parameters,{});assert.deepEqual(stand.traits,[]);assert.deepEqual(stand.player_view,{description:'',fields:[]});
  const instances=Object.entries(world(k).objects.instances).filter(([,row]:[string,any])=>row.name==='Borrowed launcher');assert.equal(instances.length,1);const [instanceId,original]=instances[0] as [string,Row];
  assert.equal(original.definition,definitionId);assert.equal(original.state.ammo,null);assert.deepEqual(sheet(k).weapons.filter((row:Row)=>row.object_id===instanceId),[]);
  const receipts=readJson(join(campaignDir(k.workspace),'turn.json')).receipts;assert.deepEqual(receipts.filter((row:Row)=>row.kind==='definition').map((row:Row)=>row.queued),[true]);assert.deepEqual(await queued(k),{effects:[],unfinished:[]});
  const refused=await k.err('mods.job',{campaign:CAMPAIGN,role:'usage',input:{object:'Borrowed launcher',name:'Fire',description:'Fire it.'}});assert.equal(refused.code,'needs');assert.equal(refused.details.reason,'definition_pending');
  const row=(await narrate(k,'t1-c2','诺特把发射器借给你。')).mechanics.find((row:Row)=>row.kind==='item');assert.equal(row.definition,'pending');assert.equal(row.definition_name,draft.name);assert.ok(!('object' in row));
  await finish(k,job,draft);await k.table('player_input',{text:'我检查发射器。'});const ready=await queued(k);assert.deepEqual(ready.effects.map((row:Row)=>row.kind),['define']);assert.deepEqual(ready.unfinished,[]);
  await k.table('apply',{call_id:'t2-c1',effects:ready.effects});const after=world(k);assert.deepEqual(Object.keys(after.objects.definitions),[definitionId]);const landed=after.objects.definitions[definitionId];
  assert.ok(!('placeholder' in landed));assert.equal(landed.parameters.damage,'1D6');assert.equal(landed.version,1);const item=after.objects.instances[instanceId];assert.equal(item.definition,definitionId);assert.equal(item.owner.id,'thomas-hayes');assert.equal(item.state.ammo,1);
  assert.equal(readJson(join(campaignDir(k.workspace),'turn.json')).receipts.find((r:Row)=>r.kind==='definition').replaced_placeholder,true);
  assert.equal(sheet(k).weapons.find((row:Row)=>row.object_id===instanceId).damage,'1D6');assert.deepEqual(await queued(k),{effects:[],unfinished:[]});assert.equal((await look(k,'Borrowed launcher')).definition.parameters.magazine,1);
});
test('test_a_usage_batch_can_take_the_registration_behind_a_placeholder_in_the_same_turn',async t=>{
  const k=await kernel(t);await openTurn(k);const draft=weapon('Queued sidearm'),request={name:draft.name,category:'weapon',description:draft.description};
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:request}),other={name:'Queued lantern',category:'item',description:'A lantern.'},lantern=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:other});
  await k.table('apply',{call_id:'t1-c1',effects:[defineQueued(request,job),defineQueued(other,lantern),{kind:'object',name:'Borrowed sidearm',definition:draft.name,to:'Thomas Hayes',why:'Fixture placement.'}]});
  assert.deepEqual(await queued(k,{now:true,objects:['Borrowed sidearm']}),{effects:[],unfinished:[{...request,job:job.job}]});await finish(k,job,draft);
  const ready=await queued(k,{now:true,objects:['Borrowed sidearm']});assert.deepEqual(ready.effects.map((row:Row)=>[row.kind,row.name]),[['define',draft.name]]);
  await k.table('apply',{call_id:'t1-c2',effects:ready.effects});const after=world(k),byName=Object.fromEntries(Object.values(after.objects.definitions).map((row:any)=>[row.name,row]));
  assert.ok(!('placeholder' in byName[draft.name]));assert.ok(!(other.name in byName));
  assert.deepEqual(Object.values(after.mods.state).flatMap((row:any)=>Object.values(row.queued??{}).map((entry:any)=>entry.name)),[other.name]);
});
test('test_a_queued_registration_answers_look_instead_of_reading_as_unknown',async t=>{
  const k=await kernel(t);await openTurn(k);const target=(await context(k)).unregistered_equipment[0].name,draft={name:'Queued field kit',category:'item',description:'Fixture gear for a deferred registration.'};
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:draft});await k.table('apply',{call_id:'t1-c1',effects:[defineQueued(draft,job),{kind:'object',name:draft.name,to:'Thomas Hayes',adopt:target,definition:draft.name,why:'Fixture adoption.'}]});
  const pending=await look(k,draft.name);assert.ok(pending.pending.includes(draft.name));assert.equal(pending.instance.name,draft.name);
  const registered=(await context(k)).objects.queued_registrations;assert.deepEqual(registered.map((row:Row)=>row.name),[draft.name]);
  assert.equal((await k.tableErr('look',{focus:'object',name:'Nothing named this'})).code,'unknown_entity');
});
