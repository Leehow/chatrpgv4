/** Combat, legacy contact and worldline cases from tests/kernel/test_mods.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,ROOT,CAMPAIGN,campaignDir,readJson,writeJson,openTurn,createCampaign,prepared,type RpcClient,type Row} from './support.ts';
import {weapon,walkToConfrontation,fork,switchLine} from './mod-fixtures.ts';
const worldPath=(k:RpcClient)=>join(campaignDir(k.workspace),'world.json');
const turn=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'turn.json')).turn;
const close=(k:RpcClient,call_id:string,text='Knott nods.')=>k.table('narrate',{call_id,text});
const seeded=(t:any)=>kernel(t,{env:{COC_KERNEL_SEED:'7'}});
async function contactTurn(k:RpcClient){await createCampaign(k);await k.ok('mods.install',{path:join(ROOT,'tests/extension/fixtures/natural-npc-1.4.4')});await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'1.4.4'});await k.table('open');await close(k,'t0-c1');await k.table('player_input',{text:'我仔细观察诺特。'});}
test('test_first_impression_refusal_names_who_is_here_and_how_to_stage_the_target',async t=>{
  const k=await seeded(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'away',why:'他先走了'}]});
  const error=await k.tableErr('resolve',{call_id:'t1-c2',action:{intent:'social',decision:'natural-npc:first-impression',target:'Steven Knott',goal:'Introduce myself'}});
  assert.equal(error.code,'not_here');assert.ok(error.message.includes('Steven Knott'));assert.ok(error.fix.includes('apply {kind: "npc"'));assert.ok(error.fix.includes('"here"'));
  assert.equal(error.details.field,'target');assert.equal(error.details.npc,'steven-knott');assert.ok(Array.isArray(error.details.present));assert.ok(!error.details.present.includes('Steven Knott'));
});
test('test_first_impression_uses_higher_value_and_reuses_pair',async t=>{
  const k=await seeded(t);await contactTurn(k);const action={intent:'social',decision:'natural-npc:first-impression',target:'Steven Knott',goal:'Introduce myself'},first=await k.table('resolve',{call_id:'t1-c1',action});
  assert.equal(first.outcome.target,Math.max(...Object.values(first.outcome.attribute_snapshot) as number[]));assert.ok(first.outcome.impression.reaction);
  const second=await k.table('resolve',{call_id:'t1-c2',action});assert.equal(second.reused,true);assert.deepEqual(second.outcome,first.outcome);
  assert.equal((await k.table('status')).receipts.filter((row:Row)=>row.mod).length,1);await close(k,'t1-c3','诺特审视了我一眼，拉开椅子。');await k.table('open');await k.table('player_input',{text:'我继续和诺特交谈。'});
  const again=await k.table('resolve',{call_id:'t2-c1',action});assert.deepEqual(again.outcome,first.outcome);assert.equal(again.reused,true);
});
test('the current first-impression instructions let the Keeper choose a meaningful contact and reuse its public result',async t=>{
  const k=await seeded(t);await openTurn(k,'I ask Knott for access to the house.');
  // §248.1: natural-npc rides indexed; its First impression section is read by key.
  const row=(await k.ok('mods.context',{campaign:CAMPAIGN})).instructions.find((row:Row)=>row.mod==='natural-npc');
  const key=row.sections.find((section:Row)=>section.heading==='First impression').key;
  const impression=(await k.ok('mods.sections',{campaign:CAMPAIGN,keys:[key]})).sections[0].text;
  assert.doesNotMatch(impression,/Never resolve\s+natural-npc:first-impression yourself/);
  assert.match(impression,/Decide whether the initial impression matters to this approach/);
  assert.match(impression,/call `resolve` with\s+`action\.decision: "natural-npc:first-impression"`/);
  assert.match(impression,/Pending contacts are optional/);
  assert.match(impression,/greetings need no roll/);
  assert.equal((await k.table('status')).receipts.filter((row:Row)=>row.kind==='roll').length,0,'sharing the opening scene creates no automatic roll');
  const action={intent:'social',decision:'natural-npc:first-impression',actor:'Thomas Hayes',target:'Steven Knott',goal:'Seek access to the house'};
  const first=await k.table('resolve',{call_id:'t1-c1',action});
  assert.equal(first.outcome.target,50,'the fixture has Appearance 50 and Credit Rating 25');
  assert.ok(Number.isInteger(first.outcome.roll),'the current first impression has a public die result');
  assert.ok(first.outcome.impression.reaction);
  const second=await k.table('resolve',{call_id:'t1-c2',action});
  assert.equal(second.reused,true);assert.deepEqual(second.outcome,first.outcome);
  assert.equal((await k.table('status')).receipts.filter((row:Row)=>row.decision==='natural-npc:first-impression').length,1);
  await close(k,'t1-c3');await k.table('open');await k.table('player_input',{text:'I continue discussing access with Knott.'});
  const again=await k.table('resolve',{call_id:'t2-c1',action});
  assert.equal(again.reused,true);assert.deepEqual(again.outcome,first.outcome);
});
test('test_pending_contact_carries_the_handle_the_first_impression_receipt_carries',async t=>{
  const k=await seeded(t);await contactTurn(k);const pending=(await k.table('capsule')).mods.pending_contacts.filter((row:Row)=>row.decision==='natural-npc:first-impression'),knott=pending.find((row:Row)=>row.target==='Steven Knott');
  assert.equal(knott.handle,'steven-knott');assert.ok(pending.every((row:Row)=>row.handle&&row.handle!==row.target));
  await k.table('resolve',{call_id:'t1-c1',action:{intent:'social',decision:'natural-npc:first-impression',target:'Steven Knott',goal:'Introduce myself'}});
  const roll=(await k.table('status')).receipts.find((row:Row)=>row.kind==='roll'&&row.decision==='natural-npc:first-impression');assert.equal(roll.npc,knott.handle);
  const mods=(await k.table('capsule')).mods;assert.ok(!mods.pending_contacts.some((row:Row)=>row.handle===knott.handle));assert.equal(mods.relationships.find((row:Row)=>row.decision==='natural-npc:first-impression'&&row.target==='Steven Knott').handle,roll.npc);
});
test('test_npc_fires_generated_weapon_then_player_takes_remaining_ammo',async t=>{
  const k=await seeded(t);await openTurn(k);const n=await walkToConfrontation(k),draft=weapon("Corbitt's launcher profile");Object.assign(draft.parameters,{damage:'0',magazine:3});
  await k.table('apply',{call_id:`t1-c${n}`,effects:[await prepared(k,draft),{kind:'object',name:"Corbitt's launcher",definition:draft.name,to:'Walter Corbitt'}]});
  await k.table('resolve',{call_id:`t1-c${n+1}`,action:{intent:'combat',target:'Walter Corbitt',weapon:'unarmed',defense:'none'}});
  await k.table('resolve',{call_id:`t1-c${n+2}`,action:{intent:'combat',actor:'Walter Corbitt',target:'Thomas Hayes',weapon:"Corbitt's launcher",defense:'none'}});
  let item=Object.values(readJson(worldPath(k)).objects.instances)[0] as Row;assert.equal(item.state.ammo,2);
  await k.table('apply',{call_id:`t1-c${n+3}`,effects:[{kind:'object',name:"Corbitt's launcher",from:'Walter Corbitt',to:'Thomas Hayes',handover:'taken'}]});
  await k.table('resolve',{call_id:`t1-c${n+4}`,action:{intent:'combat',target:'Walter Corbitt',weapon:"Corbitt's launcher",defense:'none'}});item=Object.values(readJson(worldPath(k)).objects.instances)[0] as Row;assert.equal(item.state.ammo,1);assert.equal(item.owner.id,'thomas-hayes');
});
test('test_generated_spell_is_priced_and_npc_can_cast_it',async t=>{
  const k=await seeded(t);await openTurn(k);const n=await walkToConfrontation(k),draft={name:'Cold touch',category:'spell',description:'A fictional chill that drains one magic point.',basis:'Fixture',parameters:{cost_mp:'1D2+1D2',cost_sanity:0,casting_time:'one action',effects:[{kind:'mp',amount:1,direction:'loss'}]},player_view:{description:'A chilling touch',fields:[]}};
  await k.table('apply',{call_id:`t1-c${n}`,effects:[await prepared(k,draft),{kind:'ability',name:draft.name,to:'Walter Corbitt',source:'Established sorcerous knowledge'}]});const before=(await k.table('look',{focus:'investigator'})).mp;
  const result=await k.table('resolve',{call_id:`t1-c${n+1}`,action:{intent:'cast',actor:'Walter Corbitt',target:'Thomas Hayes',spell:'Cold touch',goal:'Chill the intruder',method:'Cast'}});
  assert.equal(result.outcome.status,'cast');assert.ok(result.outcome.mp_spent>=2&&result.outcome.mp_spent<=4);assert.equal((await k.table('look',{focus:'investigator'})).mp,before-1);assert.deepEqual(new Set(result.effects.filter((row:Row)=>row.kind==='mp').map((row:Row)=>row.subject)),new Set(['walter-corbitt','thomas-hayes']));
});
test('test_legacy_hidden_first_impression_is_reused_without_disclosing_or_rerolling',async t=>{
  const k=await kernel(t);await createCampaign(k);const receipt:Row={schema_version:1,receipt_id:'legacy-first-impression',campaign_id:CAMPAIGN,investigator_id:'thomas-hayes',npc_id:'npc-steven-knott',app:60,credit_rating:30,governing_value:60,disposition:'helpful',concealed_roll:7,rule_ref:'legacy'};
  const canonical=JSON.stringify(Object.fromEntries(Object.keys(receipt).sort().map(key=>[key,receipt[key]])));receipt.integrity_digest='sha256:'+createHash('sha256').update(canonical).digest('hex');
  const path=join(campaignDir(k.workspace),'save/npc-first-impressions.json');mkdirSync(join(campaignDir(k.workspace),'save'),{recursive:true});writeJson(path,{receipts:{pair:receipt}});
  await k.table('open');await close(k,'t0-c1');assert.deepEqual(readJson(join(campaignDir(k.workspace),'turns/0000.json')).receipts.filter((row:Row)=>row.kind==='roll'&&row.decision==='natural-npc:first-impression'),[]);
  await k.table('player_input',{text:'我仔细观察诺特。'});const result=await k.table('resolve',{call_id:'t1-c1',action:{intent:'social',decision:'natural-npc:first-impression',target:'Steven Knott'}});
  assert.equal(result.reused,true);assert.equal(result.outcome.impression.disposition,'helpful');assert.ok(!('roll' in result.outcome));assert.deepEqual((await k.table('status')).receipts,[]);
});
test('test_player_learns_generated_spell_and_its_effect_reaches_the_sheet',async t=>{
  const k=await seeded(t);await openTurn(k);let n=await walkToConfrontation(k);const draft={name:'Steady hands',category:'spell',description:'A fictional calming charm',basis:'Fixture',parameters:{cost_mp:1,cost_sanity:0,casting_time:'one action',effects:[{kind:'condition',value:'steady_hands'}]},player_view:{description:'A calming charm',fields:['cost_mp']}};
  await k.table('apply',{call_id:`t1-c${n++}`,effects:[await prepared(k,draft),{kind:'ability',name:draft.name,to:'Walter Corbitt',source:'Established occult study'}]});
  assert.equal((await k.tableErr('resolve',{call_id:`t1-c${n}`,action:{intent:'cast',spell:draft.name}})).code,'needs');let learned:Row={};
  for(let i=0;i<24;i++){learned=await k.table('resolve',{call_id:`t1-c${n++}`,action:{intent:'investigate',spell:draft.name,target:'Walter Corbitt',method:'Study the spell',goal:'Learn it'}});if(learned.outcome.status==='studying')break;}
  assert.equal(learned.outcome.status,'studying');await k.table('apply',{call_id:`t1-c${n++}`,effects:[{kind:'time',minutes:learned.outcome.study_due_minutes}]});let cast:Row={};
  for(let i=0;i<10;i++){cast=await k.table('resolve',{call_id:`t1-c${n++}`,action:{intent:'cast',spell:draft.name,target:'Thomas Hayes',method:'Cast the charm',goal:'Steady my hands'}});if(cast.outcome.status==='cast')break;}
  assert.equal(cast.outcome.status,'cast');assert.ok((await k.table('look',{focus:'investigator'})).conditions.includes('steady_hands'));
});
test('test_worldline_merge_requires_an_explicit_choice_for_different_object_owners',async t=>{
  const k=await kernel(t);await openTurn(k);const draft=weapon();await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'The launcher',definition:draft.name,to:'Steven Knott'}]});
  await close(k,'t1-c2','诺特收起了发射器。');await fork(k,2,'side');let n=turn(k);await k.table('player_input',{text:'我接过发射器。'});await k.table('apply',{call_id:`t${n}-c1`,effects:[{kind:'object',name:'The launcher',from:'Steven Knott',to:'Thomas Hayes',handover:'given'}]});
  await close(k,`t${n}-c2`,'我收起了发射器。');await switchLine(k,turn(k),'main');n=turn(k);await k.table('player_input',{text:'让两种可能交汇。'});
  const error=await k.tableErr('apply',{call_id:`t${n}-c1`,effects:[{kind:'merge',name:'joined',lines:['main','side']}]});assert.equal(error.code,'needs');const conflicts=error.details.conflicts;
  assert.ok(conflicts.some((row:Row)=>row.class==='mod_state'&&JSON.stringify(row.modes)==='["from"]'));
  const dispositions=Object.fromEntries(conflicts.map((row:Row)=>[row.id,{mode:'from',line:'side'}]));await k.table('apply',{call_id:`t${n}-c1`,effects:[{kind:'merge',name:'joined',lines:['main','side'],dispositions}]});
  await close(k,`t${n}-c2`,'两种可能重合，我握着那件武器。');assert.equal((await k.table('view')).investigators[0].objects[0].name,'The launcher');
});
test('test_container_transfer_and_condition_are_preserved',async t=>{
  const k=await kernel(t);await openTurn(k);const box={name:'Wooden case',category:'item',description:'A carrying case',basis:'Fixture',parameters:{charges:null,effects:[]},traits:[{name:'length',value:1.2,unit:'m'}],player_view:{description:'A case',fields:[],traits:['length']}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,box),await prepared(k,weapon()),{kind:'object',name:'My case',definition:box.name,to:'Thomas Hayes'},{kind:'object',name:'Jammed launcher',definition:'Workshop launcher',to:'My case',condition:'jammed'}]});
  assert.deepEqual((await k.table('look',{focus:'object',name:'My case'})).instance.contents,['Jammed launcher']);assert.deepEqual((await k.table('view')).investigators[0].objects[0].traits,[{name:'length',value:1.2,unit:'m'}]);
  assert.equal((await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'My case',from:'Thomas Hayes',to:'Jammed launcher'}]})).code,'invalid_params');
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'Jammed launcher',from:'My case',to:'Thomas Hayes'}]});const value=await k.table('look',{focus:'object',name:'Jammed launcher'});assert.equal(value.instance.state.condition,'jammed');assert.equal(value.instance.state.ammo,1);
  const n=await walkToConfrontation(k,3),error=await k.tableErr('resolve',{call_id:`t1-c${n}`,action:{intent:'combat',target:'Walter Corbitt',weapon:'Jammed launcher',defense:'none'}});assert.equal(error.code,'needs');assert.ok(error.message.includes('condition'));
});
test('test_mod_resolution_obeys_pending_defense_and_preserves_session_projection',async t=>{
  const k=await kernel(t);await openTurn(k);const n=await walkToConfrontation(k);await k.table('resolve',{call_id:`t1-c${n}`,action:{intent:'combat',target:'Walter Corbitt',weapon:'unarmed'}});
  const action={intent:'social',decision:'natural-npc:first-impression',target:'Walter Corbitt'};assert.equal((await k.tableErr('resolve',{call_id:`t1-c${n+1}`,action})).code,'turn_state');
  await k.table('resolve',{call_id:`t1-c${n+1}`,action:{intent:'combat',actor:'Walter Corbitt',defense:'none'}});const result=await k.table('resolve',{call_id:`t1-c${n+2}`,action});assert.equal(result.session.kind,'combat');assert.equal(result.session.status,'active');
});
test('test_same_owner_damage_updates_instance_and_cannot_be_hidden_in_legacy_rows',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,weapon()),{kind:'object',name:'My launcher',definition:'Workshop launcher',to:'Thomas Hayes'}]});
  const before=(await k.table('look',{focus:'object',name:'My launcher'})).definition;await k.table('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'My launcher',from:'Thomas Hayes',to:'Thomas Hayes',condition:'broken',why:'An established failed push snapped its frame'}]});
  const value=await k.table('look',{focus:'object',name:'My launcher'});assert.equal(value.instance.state.condition,'broken');assert.deepEqual(value.definition,before);const row=(await k.table('status')).mechanics.find((row:Row)=>row.item==='My launcher');
  assert.equal(row.kind,'change');assert.equal(row.before,'intact');assert.equal(row.after,'broken');assert.equal((await k.tableErr('apply',{call_id:'t1-c3',effects:[{kind:'item',name:'My launcher',quantity:-1}]})).code,'invalid_params');
});
