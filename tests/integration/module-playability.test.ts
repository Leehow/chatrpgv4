/** The original whole-graph invariants against current production TypeScript. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {CONTENT_DIR,MODULE,readJson,importSource,type Row} from './support.ts';
const {ModuleGraph,recordOf}=await importSource('kernel-ts/read/module-graph.ts');
const {playability,openingReport}=await importSource('kernel-ts/write/source.ts');
const {resolveStartScene,applyOpeningChoice}=await importSource('kernel-ts/modules/visual.ts');
const contract={graph:readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')),template:readJson(join(CONTENT_DIR,'modules/module-graph-template-v1.json'))};
const dossier=contract.graph.actor_dossier;
const starterGraph=()=>readJson(join(CONTENT_DIR,'starters',MODULE,'module-graph.json'));
const view=(graph:Row)=>new ModuleGraph(MODULE,graph,'',dossier);
const check=(graph:Row)=>playability(graph,view(graph),contract.template,dossier);
const opening=(graph:Row)=>openingReport(graph,view(graph),contract.template,dossier);

test('test_the_haunting_is_one_walkable_piece_with_its_own_gaps_reported',()=>{
  const report=check(starterGraph());assert.equal(report.status,'findings');
  assert.deepEqual(new Set(Object.keys(report.finding_counts)),new Set(['actor_in_no_scene','node_without_page']));
  assert.deepEqual(new Set(report.findings.filter((row:Row)=>row.code==='actor_in_no_scene').map((row:Row)=>row.subject)),new Set(['npc-michael-thomas']));
  const m=report.measures;assert.equal(m.scenes,12);assert.equal(m.scene_components,1);assert.equal(m.largest_component,12);assert.equal(m.endings,1);
  assert.deepEqual(new Set(Object.keys(m)),new Set(['scenes','scene_exits','scene_components','largest_component','branches','npcs','creatures','clues','conclusions','endings','rules','nodes','relations','span_consumption','pages_covered','substantive_spans_uncited','npcs_without_material']));
  const result=opening(starterGraph());assert.equal(result.opening_ready,true);assert.equal(result.start_scene,'scene-commission-briefing');
});
test('test_unpaged_is_the_account_for_a_module_without_a_source_document',()=>{
  let graph=starterGraph();graph.unpaged=true;assert.deepEqual(new Set(Object.keys(check(graph).finding_counts)),new Set(['actor_in_no_scene']));
  graph=starterGraph();graph.nodes.find((row:Row)=>row.node_kind==='module').properties.unpaged=true;
  assert.ok(!('node_without_page' in check(graph).finding_counts));
});
test('test_silence_about_entrance_and_ending_is_refused_but_an_explicit_none_is_an_answer',()=>{
  const graph=starterGraph();for(const node of graph.nodes){const record=node.properties?.runtime_projection?.record;if(record&&typeof record==='object'){delete record.is_start;delete record.is_final;}}
  const silent=check(structuredClone(graph)).finding_counts;assert.equal(silent.no_entrance_declared,1);assert.equal(silent.no_ending_declared,1);
  graph.entry_scene_ids=[];graph.nodes.find((row:Row)=>row.node_kind==='module').properties.ending_scene_ids=[];
  const accounted=check(graph).finding_counts;assert.ok(!('no_entrance_declared' in accounted));assert.ok(!('no_ending_declared' in accounted));
  assert.deepEqual(opening(graph).missing,['start_scene']);
});
test('test_two_declared_openings_come_back_as_a_choice_with_both_named',()=>{
  const graph=starterGraph(),second=graph.nodes.find((row:Row)=>row.node_kind==='scene'&&row.node_id!=='scene-commission-briefing');
  second.summary='Investigate the production failure.';graph.nodes.find((row:Row)=>row.node_id==='scene-commission-briefing').summary='Serve an arrest order.';
  second.properties.is_entrance=true;const report=opening(graph);assert.equal(report.opening_ready,false);assert.equal(report.start_scene,null);
  assert.deepEqual(report.missing,[`start_scene_ambiguous:${second.node_id},scene-commission-briefing`]);const choice=report.choice;
  assert.equal(choice.field,'start_scene');assert.equal(choice.method,'module.opening.choose');
  assert.deepEqual(new Set(choice.candidates.map((row:Row)=>row.node_id)),new Set([second.node_id,'scene-commission-briefing']));
  assert.ok(choice.candidates.every((row:Row)=>row.name));assert.deepEqual(new Set(choice.candidates.map((row:Row)=>row.summary)),new Set(['Investigate the production failure.','Serve an arrest order.']));
  assert.equal(resolveStartScene(graph,'scene-ghost',contract),null);assert.equal(resolveStartScene(graph,'commission-briefing',contract),'scene-commission-briefing');
  assert.equal(applyOpeningChoice(graph,'scene-commission-briefing',contract),true);const settled=opening(graph);
  assert.equal(settled.opening_ready,true);assert.equal(settled.start_scene,'scene-commission-briefing');assert.ok(!('choice' in settled));
  assert.deepEqual(graph.entry_scene_ids,['scene-commission-briefing']);
  assert.deepEqual(graph.nodes.filter((node:Row)=>recordOf(node).is_start===true).map((row:Row)=>row.node_id),['scene-commission-briefing']);
  assert.equal(second.properties.is_entrance,true);assert.equal(resolveStartScene(graph,second.node_id,contract),second.node_id);
  assert.equal(applyOpeningChoice(graph,second.node_id,contract),true);assert.deepEqual(graph.entry_scene_ids,[second.node_id]);
});
test('test_dangling_relation_and_unreachable_scene_are_found',()=>{
  const graph=starterGraph();graph.relations.push({relation_id:'relation-route-to-ghost',relation_kind:'route-to',from_node_id:'scene-commission-briefing',to_node_id:'scene-ghost',claim_id:'claim-ghost',properties:{}});
  graph.nodes.push({node_id:'scene-island',node_kind:'scene',name:'island',visibility:'keeper-only',aliases:[],summary:'',evidence_span_ids:['span-p1-1'],properties:{}});
  const counts=check(graph).finding_counts;assert.equal(counts.dangling_relation,1);assert.equal(counts.scene_graph_fragmented,1);assert.equal(counts.scene_unreachable_from_entrance,1);
});
