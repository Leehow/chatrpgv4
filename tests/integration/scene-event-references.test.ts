/** Existing source events are private scene references, never automatic occurrences. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync} from 'node:fs';
import {join} from 'node:path';
import {kernel, CONTENT_DIR, readJson, writeJson, importSource, RpcClient} from './support.ts';
const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
const {whereSection}=await importSource('kernel-ts/read/capsule.ts');
const dossier=readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier;
const sourceCondition='Only if the courier has returned; otherwise this possibility stays unexecuted.';
const secret='PRIVATE_COURIER_RETURN_REFERENCE';
function fixture(){
  const data=readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
  const scene='scene-commission-briefing';
  const added=[['scene-event-copy','scene','Office copy','An alternative source mention of the same room.'],
    ['event-courier','event','Courier return',secret],['event-bell','event','Bell sounding','A bell may sound after the meeting.'],
    ['event-remote','event','Remote event','UNRELATED_REMOTE_REFERENCE']];
  data.nodes.push(...added.map(([node_id,node_kind,name,summary])=>({node_id,node_kind,name,summary,
    properties:node_kind==='event'?{condition:sourceCondition}: {},visibility:'keeper-only',source_refs:[{source_id:'fixture',pdf_index:2}]})));
  const links=[['scene-event-copy','variant-of',scene],['event-courier','occurs-at','scene-event-copy'],
    ['event-courier','occurs-at',scene],[scene,'triggers','event-bell']];
  data.relations.push(...links.map(([from_node_id,relation_kind,to_node_id],i)=>({relation_id:'event-fixture-'+i,from_node_id,relation_kind,to_node_id,properties:{}})));
  return {data,scene};
}
test('scene notes retain direct event possibilities in both directions and identity copies only once',()=>{
  const {data,scene}=fixture(),graph=new ModuleGraph('the-haunting',data,'',dossier),node=graph.nodes.get(scene);
  const world={active_scene:graph.handle(node),clock:{minutes:4320}},before=JSON.stringify({raw:graph.raw,world});
  for(const compact of [false,true]){
    const view=whereSection(graph,world,node,()=> 'ready',compact),notes=view.keeper_notes.join('\n');
    assert.ok(notes.includes(secret),'the inbound source event reaches the existing scene notes');
    assert.ok(notes.includes('A bell may sound after the meeting.'),'outbound event associations remain discoverable');
    assert.equal(notes.split(secret).length-1,1,'duplicate source mentions do not duplicate one event');
    assert.ok(notes.includes(sourceCondition));assert.ok(notes.includes('fixture'));assert.ok(notes.includes('pdf_index'));
    assert.ok(notes.includes(graph.handle(graph.nodes.get('event-courier'))),'the full existing module read is addressable');
    assert.match(notes,/not executed|not an occurrence/i);assert.match(notes,/not.*disclos/i);
    assert.ok(!notes.includes('UNRELATED_REMOTE_REFERENCE'));
  }
  assert.equal(JSON.stringify({raw:graph.raw,world}),before,'reading does not execute, discover or rewrite anything');
});
test('production RPC carries source possibilities to Keeper look and capsule without exposing them to player view',async t=>{
  const {data}=fixture(),k=await kernel(t),content=join(k.workspace,'event-content');
  cpSync(CONTENT_DIR,content,{recursive:true});writeJson(join(content,'starters/the-haunting/module-graph.json'),data);
  const client=new RpcClient(join(k.workspace,'event-rpc'),{content});t.after(()=>client.close());
  await client.ok('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const full=await client.table('look',{focus:'scene'});
  assert.ok(JSON.stringify(full.where.keeper_notes).includes(secret));
  const note=full.where.keeper_notes.find((text:string)=>text.includes(secret));
  const reference=JSON.parse(note.slice(note.indexOf('{')));
  const event=await client.table('lookup',{kind:'module',query:reference.ref});
  assert.equal(event.entities[0].summary,secret);
  assert.equal(event.entities[0].properties.condition,sourceCondition);
  const publicBefore=await client.ok('table.view',{campaign:'c1'});
  assert.ok(!JSON.stringify(publicBefore).includes(secret));
  await client.table('narrate',{call_id:'t0-c1',text:'The owner waits at the desk.'});
  const opened=await client.table('player_input',{text:'I ask what could happen next.'});
  assert.ok(JSON.stringify(opened.capsule.where.keeper_notes).includes(secret));
  const {BUDGETS}=await importSource('kernel-ts/read/assemble.ts');
  assert.ok(Buffer.byteLength(JSON.stringify(opened.capsule.where))<=BUDGETS.where);
  const publicAfter=await client.ok('table.view',{campaign:'c1'});
  assert.ok(!JSON.stringify(publicAfter).includes(secret));
});
