/** Authored investigator references and play-order exits, migrated from test_lookup_templates.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {CONTENT_DIR,readJson,importSource,type Row} from './support.ts';
const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
const dossier=readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier;
const starter=()=>readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
test('test_investigator_templates_rank_last_and_carry_the_note',()=>{
  const graph=starter();graph.nodes.push({node_id:'investigator-template-knott-hunter',node_kind:'investigator-template',name:'Knott Hunter',visibility:'keeper-only',aliases:[],summary:'a pregenerated investigator printed in the book',evidence_span_ids:[],properties:{}});
  const loaded=new ModuleGraph('the-haunting',graph,'',dossier),hits=loaded.search('Knott',50),kinds=hits.map((row:Row)=>row.node_kind);
  assert.ok(kinds.includes('investigator-template'));assert.equal(kinds.at(-1),'investigator-template');assert.ok(kinds.indexOf('npc')<kinds.indexOf('investigator-template'));
  const template=hits.find((row:Row)=>row.node_kind==='investigator-template');assert.ok(loaded.describe(template).note.includes('this table'));
  assert.ok(loaded.entityView(template).note.includes('this table'));assert.ok(!('note' in loaded.describe(hits.find((row:Row)=>row.node_kind==='npc'))));
});
test('test_play_order_relations_are_exits_at_the_table',()=>{
  const graph=starter();graph.nodes.push({node_id:'scene-road-north',node_kind:'scene',name:'The Road North',visibility:'player-safe',aliases:[],summary:'two days on the road',evidence_span_ids:[],properties:{}});
  const start=graph.nodes.find((row:Row)=>row.node_id.startsWith('scene-')&&row.node_id.includes('commission'));
  graph.relations.push({relation_id:'relation-test-play-precedes',relation_kind:'play-precedes',from_node_id:start.node_id,to_node_id:'scene-road-north',claim_id:null,properties:{}});
  const loaded=new ModuleGraph('the-haunting',graph,'',dossier),road=loaded.sceneExits(loaded.scene(start.node_id)).find((row:Row)=>row.to==='road-north');
  assert.ok(road);assert.equal(road.via,'play-precedes');
});
