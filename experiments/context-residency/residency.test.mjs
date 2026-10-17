/** Component evidence only. These assertions do not simulate or certify gameplay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceResidency,projectedSource} from './residency.ts';

const binding=(turn=1,source='a')=>({campaign:'prototype',worldline:'main',loop:0,turn,source_revision:source});
const unit=(key,kind='identity',entity='Caretaker',extra={})=>({key,kind:'graph_entity',label:entity,
  authority:'module_source',source_revision:'a',scope:{campaign:'prototype',worldline:'main',loop:0},
  summary:'A retained source summary.',body:JSON.stringify({entity:{name:entity},[kind]:{text:'An exact source unit.'}}),
  read:{tool:'lookup',kind:'module',query:entity},coverage:{status:'complete',entity_complete:false,unit:{kind},dependencies:kind==='identity'?[]:['identity']},...extra});

test('a rehydrated opening uses the delivered capsule binding and current section updates',()=>{
  const view=projectedSource([{customType:'coc-capsule',content:JSON.stringify({where:{scene:'Station'},obsolete:true}),details:{context:binding()}},
    {customType:'coc-capsule-update',content:JSON.stringify({sections:{where:{scene:'Library'}},removed:['obsolete']})}]);
  assert.deepEqual(view,{binding:binding(),capsule:{where:{scene:'Library'}}});
  assert.equal(projectedSource([{customType:'coc-capsule',content:'broken',details:{context:binding()}}]),undefined);
});

test('a fresh turn re-endorses unchanged static bodies without another owner read',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);
  cache.capture([unit('identity'),unit('authored','authored')],binding(),['Caretaker']);
  cache.observe(binding(2),['Caretaker']);
  assert.deepEqual(cache.missing(['Caretaker']),[]);
  const view=cache.packet(24*1024);assert.equal(view.stats.full,2);assert.equal(view.packet.turn,2);
  assert.equal(view.stats.source_resets,1);
});
test('source and worldline changes independently invalidate old material',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);cache.capture([unit('identity')],binding(),['Caretaker']);
  cache.observe(binding(2,'b'),['Caretaker']);assert.deepEqual(cache.missing(['Caretaker']),['Caretaker']);assert.equal(cache.packet(4096).stats.full,0);
  cache.observe({...binding(3),worldline:'other'},['Caretaker']);assert.equal(cache.packet(4096).stats.cached_groups,0);
});
test('a late prior-turn catalog cannot populate current residency',()=>{
  const cache=new SourceResidency();cache.observe(binding(2),['Caretaker']);
  assert.throws(()=>cache.capture([unit('identity')],binding(),['Caretaker']),/stale request/);
  assert.equal(cache.packet(4096).stats.cached_units,0);
});
test('dynamic and foreign evidence cannot be captured as static source',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);
  const n=cache.capture([unit('current','identity','Caretaker',{authority:'current_read'}),
    unit('foreign','identity','Caretaker',{scope:{campaign:'other',worldline:'main',loop:0}})],binding(),['Caretaker']);
  assert.equal(n,0);assert.equal(cache.packet(4096).packet.materials.length,0);
});
test('authored detail requires its exact identity dependency',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);
  cache.capture([unit('authored','authored')],binding(),['Caretaker']);
  assert.equal(cache.packet(24*1024).stats.full,0);
});
test('a prior focus becomes an existing summary and retains its recovery route',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);cache.capture([unit('identity'),unit('authored','authored')],binding(),['Caretaker']);
  cache.observe(binding(2),['Station']);const view=cache.packet(4096);
  assert.equal(view.stats.compact,1);assert.equal(view.stats.full,0);
  assert.equal(view.packet.materials[0].content.summary,'A retained source summary.');
  assert.equal(view.packet.materials[0].read.query,'Caretaker');
});
test('budget pressure omits whole units without manufacturing partial JSON',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);
  const long=unit('authored','authored','Caretaker',{body:JSON.stringify({detail:'x'.repeat(8000)})});
  cache.capture([unit('identity'),long],binding(),['Caretaker']);
  const view=cache.packet(1800);
  assert.ok(Buffer.byteLength(JSON.stringify(view.packet))<=1800);
  for(const material of view.packet.materials)if(typeof material.content==='string')assert.doesNotThrow(()=>JSON.parse(material.content));
  assert.ok(!JSON.stringify(view.packet).includes('x'.repeat(100)));
});
test('private material keys stay out of the model-facing packet',()=>{
  const cache=new SourceResidency();cache.observe(binding(),['Caretaker']);
  cache.capture([unit('identity'),unit('authored','authored')],binding(),['Caretaker']);
  const text=JSON.stringify(cache.packet(4096).packet);
  assert.ok(!text.includes('"key":'));assert.ok(!text.includes('"dependencies":'));
  assert.ok(text.includes('resident material 1'));
});
