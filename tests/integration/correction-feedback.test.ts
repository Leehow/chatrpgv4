/** Existing refusal authority, with executable corrections through the native TS RPC. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,prepared,type Row} from './support.ts';

const event=(name:string)=>({name:'Witness observation',summary:'A witness observed the key.',
  knowledge:[{actor:name,statement:'The key rests on the desk.',mode:'observed',state:'accurate'}]});

test('unknown event actors leave state unchanged and the offered registered table alias succeeds',async t=>{
  const k=await kernel(t);await openTurn(k);
  const investigator=(await k.table('view')).investigators[0].name;
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'person',who:'Steven Knott',name:'Office host'}]});
  const worldPath=join(campaignDir(k.workspace),'world.json'),world=readJson(worldPath),before=await k.table('status');
  const refused=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:5}],event:event('Unregistered visitor')});
  assert.equal(refused.code,'invalid_params');assert.equal(refused.details.field,'event.unknown actor Unregistered visitor');
  assert.deepEqual(readJson(worldPath),world);assert.deepEqual((await k.table('status')).receipts,before.receipts);
  const offered=refused.details.actors.find((person:Row)=>person.called==='Office host');
  assert.ok(offered,'the current registered alias must be actionable, not an invented replacement actor');
  assert.ok(refused.details.actors.some((person:Row)=>person.name===investigator));
  const corrected=await k.table('apply',{call_id:'t1-c3',effects:[{kind:'time',minutes:5}],event:event(offered.called)});
  const occurrence=corrected.outcome.events.find((item:Row)=>item.name==='Witness observation');
  assert.equal(occurrence.knowledge[0].actor.name,'Steven Knott');
  assert.equal((await k.table('capsule')).where.clock.minutes,5);
  assert.deepEqual(readJson(worldPath).table_people,world.table_people,'choosing a current alias creates nobody');
});

test('the offered walk_on establishes a needed persistent actor, while incidental description establishes nobody',async t=>{
  const k=await kernel(t);await openTurn(k,'I invite the visiting messenger into the office.');
  const worldPath=join(campaignDir(k.workspace),'world.json'),before=readJson(worldPath);
  const refused=await k.tableErr('apply',{call_id:'t1-c1',effects:[],event:event('Visiting messenger')});
  assert.equal(refused.code,'invalid_params');assert.deepEqual(readJson(worldPath),before);
  assert.deepEqual(refused.details.walk_on,{kind:'npc',name:'Visiting messenger',walk_on:true});
  await k.table('apply',{call_id:'t1-c2',effects:[],event:{name:'Incidental visitor',summary:'A passerby crossed the entrance.',
    materials:[{name:'passing-figure',kind:'description',visibility:'player',text:'A passerby crosses the entrance.'}]}});
  assert.deepEqual(readJson(worldPath).table_people,before.table_people,'a descriptive material does not need actor registration');
  const incomplete=await k.tableErr('apply',{call_id:'t1-c3',effects:[refused.details.walk_on],event:event('Visiting messenger')});
  assert.equal(incomplete.code,'invalid_params');assert.match(incomplete.message,/an npc effect needs/);
  assert.deepEqual(readJson(worldPath).table_people,before.table_people,'a registration flag alone cannot bypass the actual npc variant');
  const corrected=await k.table('apply',{call_id:'t1-c4',effects:[{...refused.details.walk_on,to:'here',why:'The invited messenger arrives in the office.'}],event:event('Visiting messenger')});
  const occurrence=corrected.outcome.events.find((item:Row)=>item.name==='Witness observation');
  assert.equal(occurrence.knowledge[0].actor.name,'Visiting messenger');
  assert.equal(readJson(worldPath).table_people.filter((person:Row)=>person.name==='Visiting messenger').length,1);
});

for(const destination of ['Carry case','Steven Knott'])test(`the actual condition-first recipe preserves the whole object and original transfer authority to ${destination}`,async t=>{
  const k=await kernel(t);await openTurn(k);
  const investigator=(await k.table('view')).investigators[0].name;
  const draft={name:'Paper notebook',category:'item',description:'An ordinary paper notebook.',basis:'Fixture physical properties.',
    parameters:{charges:null,effects:[]},player_view:{description:'A paper notebook.',fields:[]}};
  const box={...draft,name:'Carrying case',description:'An ordinary empty carrying case.'};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),await prepared(k,box),
    {kind:'object',name:'Notebook',definition:draft.name,to:investigator,quantity:3},
    {kind:'object',name:'Carry case',definition:box.name,to:investigator}]});
  const worldPath=join(campaignDir(k.workspace),'world.json'),world=readJson(worldPath),before=await k.table('status');
  const definition=(await k.table('look',{focus:'object',name:'Notebook'})).definition;
  const original={kind:'object',name:'Notebook',from:investigator,to:destination,quantity:3,condition:'damaged',
    ...(destination==='Steven Knott'?{handover:'given'}:{}),why:'The damp notebook is put away or handed over.'};
  const refused=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'time',minutes:1},original]});
  assert.equal(refused.code,'invalid_params');assert.match(refused.message,/Transfer preserves condition/);
  assert.deepEqual(readJson(worldPath),world);assert.deepEqual((await k.table('status')).receipts,before.receipts);
  assert.deepEqual(refused.details.condition_effect,{kind:'object',name:'Notebook',from:investigator,to:investigator,quantity:3,condition:'damaged'});
  const {condition:_condition,...transfer}=original;
  const noCause=await k.tableErr('apply',{call_id:'t1-c3',effects:[refused.details.condition_effect,transfer]});
  assert.equal(noCause.code,'invalid_params');assert.match(noCause.message,/physical state change needs its causal reason/);
  assert.deepEqual(readJson(worldPath),world);assert.deepEqual((await k.table('status')).receipts,before.receipts);
  await k.table('apply',{call_id:'t1-c4',effects:[{...refused.details.condition_effect,why:original.why},transfer]});
  const actual=await k.table('look',{focus:'object',name:'Notebook'});
  assert.equal(actual.instance.state.condition,'damaged');assert.equal(actual.instance.quantity,3);
  assert.equal(actual.instance.owner,destination);
  const prior=Object.values(world.objects.instances).find((item:any)=>item.name==='Notebook') as Row;
  const stored=readJson(worldPath).objects.instances[prior.id];
  assert.equal(stored.id,prior.id);assert.equal(stored.owner.kind,destination==='Carry case'?'object':'npc');assert.deepEqual(actual.definition,definition);
  if(destination==='Steven Knott')assert.equal((await k.table('status')).receipts.at(-1).handover,'given');
});

test('the existing partial-transfer correction changes only the separated receiving instance',async t=>{
  const k=await kernel(t);await openTurn(k);
  const investigator=(await k.table('view')).investigators[0].name;
  const draft={name:'Loose paper',category:'item',description:'An ordinary stack of paper.',basis:'Fixture physical properties.',
    parameters:{charges:null,effects:[]},player_view:{description:'Loose paper.',fields:[]}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Paper stack',definition:draft.name,to:investigator,quantity:3}]});
  const worldPath=join(campaignDir(k.workspace),'world.json'),before=readJson(worldPath),receipts=(await k.table('status')).receipts;
  const original={kind:'object',name:'Paper stack',from:investigator,to:'here',quantity:1,part:'Delivered sheet',condition:'damaged'};
  const refused=await k.tableErr('apply',{call_id:'t1-c2',effects:[original]});
  assert.equal(refused.code,'invalid_params');assert.equal(refused.details.field,'object.condition');
  assert.equal(refused.details.condition_effect,undefined,'a division cannot suggest changing the whole original stack');
  assert.deepEqual(readJson(worldPath),before);assert.deepEqual((await k.table('status')).receipts,receipts);
  const {condition:_condition,...transfer}=original;
  await k.table('apply',{call_id:'t1-c3',effects:[transfer,
    {kind:'object',name:'Delivered sheet',from:'here',to:'here',quantity:1,condition:'damaged',why:'The separated delivered sheet was damp.'}]});
  const held=await k.table('look',{focus:'object',name:'Paper stack'}),received=await k.table('look',{focus:'object',name:'Delivered sheet'});
  assert.equal(held.instance.quantity,2);assert.equal(held.instance.state.condition,'intact');assert.equal(held.instance.owner,investigator);
  assert.equal(received.instance.quantity,1);assert.equal(received.instance.state.condition,'damaged');
  const saved=Object.values(readJson(worldPath).objects.instances).find((item:any)=>item.name==='Delivered sheet') as Row;
  assert.equal(saved.owner.kind,'scene');
});
