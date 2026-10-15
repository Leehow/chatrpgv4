/** Memory identity must agree with the existing graph resolver. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSource} from './support.ts';

test('a current exact handle wins over a source alias without widening identity scopes',async()=>{
  const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
  const {EntityIndex}=await importSource('kernel-ts/read/memory.ts');
  const graph=new ModuleGraph('neutral',{nodes:[
    {node_id:'source-room',node_kind:'scene',name:'Source room',aliases:['Established room','Shared room']},
    {node_id:'other-room',node_kind:'scene',name:'Other room',aliases:['Shared room']},
  ],relations:[],claims:[]},'digest',{});
  graph.addTableEntity({id:'table-room',kind:'scene',name:'Established room',turn:1});
  assert.equal(graph.resolve('Established room',['scene']).node_id,'table-room');
  const index=new EntityIndex(graph,[]);
  assert.deepEqual(index.matches('Established room'),['scene:table-room']);
  assert.equal(index.matches('Shared room').length,2,'genuine shared aliases stay ambiguous');
  assert.deepEqual(index.matches('Established room',{kinds:['clue']}),[]);
  assert.deepEqual(new EntityIndex(graph,[],{},['source-room']).matches('Established room',{kinds:['scene']}),[],
    'an exact unissued identity must not fall through to an admitted alias');
  const competing=new EntityIndex(graph,[{id:'reader',name:'Established room'}]);
  assert.deepEqual(competing.matches('Established room').sort(),['investigator:reader','scene:table-room']);
});
