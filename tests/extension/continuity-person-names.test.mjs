import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root=resolve(import.meta.dirname,'../..');
const directory=playtestScratch('continuity-person-names');
await writeFile(join(directory,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
await build({stdin:{contents:`export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {continuityView} from './kernel-ts/read/continuity.ts'; export {npcNode} from './kernel-ts/read/capsule.ts'; export {resolveReference} from './kernel-ts/read/references.ts';`,resolveDir:root},
  outfile:join(directory,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const {ModuleGraph,continuityView,npcNode,resolveReference}=await import(pathToFileURL(join(directory,'api.mjs')).href);
function fixture(){
  const graph=new ModuleGraph('neutral',{nodes:[
    {node_id:'scene-room',node_kind:'scene',name:'Room'},
    {node_id:'npc-mechanic',node_kind:'npc',name:'Mechanic',aliases:['Shared source']},
    {node_id:'npc-reader',node_kind:'npc',name:'Reader',aliases:['Shared source']},
    {node_id:'clue-paper',node_kind:'clue',name:'Paper'},
  ],relations:[],claims:[]},'neutral',{});
  const mechanic=graph.kind('npc')[0],reader=graph.kind('npc')[1];
  const world={active_scene:'room',person_labels:{[graph.handle(mechanic)]:{name:'Morgan'}},
    person_epithets:{[graph.handle(mechanic)]:{word:'The helpful repairer'}}};
  return {graph,world,mechanic,reader};
}
test('continuity uses the same registered person name and epithet as the NPC read',()=>{
  const {graph,world,mechanic}=fixture();const before=JSON.stringify(world);
  for(const name of ['Morgan','The helpful repairer','npc: Morgan']){
    assert.deepEqual(continuityView(graph,world,[],[],{query:name}).anchors,[graph.handle(mechanic)]);
  }
  assert.equal(npcNode(graph,world,'Morgan').node_id,mechanic.node_id);
  assert.deepEqual(continuityView(graph,world,[],[],{anchors:['Morgan']}).anchors,[graph.handle(mechanic)]);
  assert.equal(JSON.stringify(world),before);
  assert.throws(()=>resolveReference(graph,'Morgan'),error=>error.code==='unknown_entity',
    'graph-only callers do not silently gain a world namespace');
});
test('registered continuity names preserve graph priority, kind restrictions and genuine ambiguity',()=>{
  const {graph,world,mechanic,reader}=fixture();
  assert.throws(()=>continuityView(graph,world,[],[],{query:'clue: Morgan'}),error=>error.code==='unknown_entity');
  world.person_labels[graph.handle(reader)]={name:'Morgan'};
  assert.throws(()=>continuityView(graph,world,[],[],{query:'Morgan'}),error=>error.code==='unknown_entity');
  world.person_labels[graph.handle(mechanic)]={name:'Reader'};
  assert.deepEqual(continuityView(graph,world,[],[],{query:'Reader'}).anchors,[graph.handle(reader)]);
  world.person_labels[graph.handle(mechanic)]={name:'Shared source'};
  assert.throws(()=>continuityView(graph,world,[],[],{query:'Shared source'}),error=>error.code==='unknown_entity',
    'a unique table label cannot override graph ambiguity');
});
