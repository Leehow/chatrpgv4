/** Guided-creation note counterparts of tests/kernel/test_setup_notes.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,CAMPAIGN,type RpcClient,type Row} from './support.ts';
const begin=(k:RpcClient)=>k.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting',play_language:'zh-Hans'});
const note=(k:RpcClient,args:Row)=>k.ok('setup.note',{campaign:CAMPAIGN,...args});

test('test_the_package_declares_its_slots_and_the_setup_context_carries_them',async t=>{
  const k=await kernel(t);await begin(k);const context=await k.ok('mods.context',{campaign:CAMPAIGN});
  const slots=Object.fromEntries(context.slots.map((row:Row)=>[row.id,row]));assert.ok(['trade','built_for','known_for','not_good_at'].every(id=>id in slots));
  assert.ok(Object.values(slots).every((row:Row)=>row.mod==='guided-creation'));assert.ok(slots.built_for.required);assert.ok(!slots.not_good_at.required);
  assert.ok(slots.built_for.purpose);assert.ok(slots.built_for.ask);
});
test('test_notes_are_kept_by_the_kernel_and_returned_with_the_steps',async t=>{
  const k=await kernel(t);await begin(k);const first=await note(k,{slot:'trade',value:'屠夫，落在 Farmer 一栏'});
  assert.deepEqual(first.notes.slots.trade,{value:'屠夫，落在 Farmer 一栏',origin:'player',turn:0});assert.equal(first.notes.turns,0);
  assert.equal((await note(k,{advance:true})).notes.turns,1);const second=await note(k,{slot:'built_for',value:'膀子力气',origin:'concept'});
  assert.deepEqual(second.notes.slots.built_for,{value:'膀子力气',origin:'concept',turn:1});
  assert.deepEqual((await k.ok('setup.steps',{campaign:CAMPAIGN})).state.notes,second.notes);
});
test('test_a_note_names_an_active_slot_or_stop_and_a_real_origin',async t=>{
  const k=await kernel(t);await begin(k);const unknown=await k.err('setup.note',{campaign:CAMPAIGN,slot:'mood',value:'grumpy'});
  assert.equal(unknown.code,'needs');assert.ok(unknown.details.options.includes('stop'));assert.ok(unknown.details.options.includes('built_for'));
  for(const args of [{slot:'trade',value:'   '},{slot:'trade',value:'x'.repeat(401)},{slot:'trade',value:'ok',origin:'keeper'},
    {slot:'stop',value:'现在出卡',origin:'concept'},{slot:'trade',value:'ok',advance:true}])
    assert.equal((await k.err('setup.note',{campaign:CAMPAIGN,...args})).code,'invalid_params');
  assert.equal((await note(k,{slot:'stop',value:'现在出卡'})).notes.slots.stop.origin,'player');
});
test('test_without_the_package_there_are_no_slots_and_no_notes',async t=>{
  const k=await kernel(t);await begin(k);await k.ok('mods.configure',{campaign:CAMPAIGN,id:'guided-creation',enabled:false});
  assert.deepEqual((await k.ok('mods.context',{campaign:CAMPAIGN})).slots,[]);const refused=await k.err('setup.note',{campaign:CAMPAIGN,slot:'built_for',value:'力气'});
  assert.equal(refused.code,'needs');assert.deepEqual(refused.details.options,['stop']);
});
