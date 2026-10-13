import test from 'node:test';
import assert from 'node:assert/strict';
import {createWritingSupportNames,publicSupportText} from '../../runtime/writing-support.ts';

const binding={campaign:'c',worldline:'main',loop:0,turn:1,task_source_revision:'source1'};
const message=(text='The room is cold.')=>({content:JSON.stringify({kind:'keeper_support',turn:1,
  materials:[{alias:'material_1',label:'Room',kind:'scene',authority:'source',content:{text,visibility:'player'},coverage:{status:'complete'}}],
  parameters:{scene:['material_1']},note:''})});

test('source names retain exact evidence and never silently change content within an input',()=>{
  const name=createWritingSupportNames(),first=JSON.parse(name(message(),binding).content);
  const again=JSON.parse(name(message(),binding).content),changed=JSON.parse(name(message('The room is warm.'),binding).content);
  assert.equal(first.materials[0].alias,again.materials[0].alias);
  assert.notEqual(first.materials[0].alias,changed.materials[0].alias);
  assert.deepEqual(first.parameters.scene,[first.materials[0].alias]);
  assert.deepEqual(first.materials[0].content,{text:'The room is cold.',visibility:'player'});
  assert.equal(first.materials[0].authority,'source');
  const freshSource=JSON.parse(name(message(),{...binding,task_source_revision:'source2'}).content);
  assert.notEqual(first.materials[0].alias,freshSource.materials[0].alias);
});

test('only explicit owner visibility permits verbatim reuse',()=>{
  for(const content of [{text:'hidden'}, {text:'hidden',privacy:'keeper_only'},
    {text:'hidden',visibility:'keeper',privacy:'player_safe'}, {text:'hidden',visibility:'player',privacy:'keeper_only'},
    {text:'hidden',visibility:'player',privacy:'unknown'}])
    assert.equal(publicSupportText({content}),undefined);
  assert.equal(publicSupportText({content:{text:'Public.',privacy:'player_safe'}}),'Public.');
  assert.equal(publicSupportText({content:{text:'Public.',visibility:'player'}}),'Public.');
});
