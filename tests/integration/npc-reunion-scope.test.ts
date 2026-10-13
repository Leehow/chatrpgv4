/** Reunion identity remains the stable branch/circuit boundary under wider event reads. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {CONTENT_DIR,importSource,readJson} from './support.ts';

const [{ModuleGraph},{reunionInterval,reunionView,acceptReunion}]=await Promise.all([
  importSource('kernel-ts/read/module-graph.ts'),importSource('kernel-ts/npc/reunion.ts')]);
const contract=readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json'));
const graph=new ModuleGraph('the-haunting',readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json')),'',contract.actor_dossier);
const node=graph.find('Steven Knott',['npc']);
const stable={worldline:'main',loop:0};
// Retained by the pre-event-scope RPC fixture; this digest must keep finding accepted continuity.
const acceptedKey='c91893375994772aa47c6c476be55aa81bfaeb32ad681e429f0bd93c63cd99d3';
const continuity={background:['Knott spent the interval sorting ordinary correspondence.'],reports:['He says the office has been quiet.'],open_threads:[]};
function fixture(){
  const presence={'steven-knott':'commission-briefing'};
  return {world:{active_scene:'commission-briefing',npc_presence:{...presence},clock:{minutes:120}},records:[
    {turn:0,commit:'seen',world:{active_scene:'commission-briefing',npc_presence:{...presence},clock:{minutes:0}},
      speech:[{who:{npc:'steven-knott'},text:'Bring me what you can establish.'}],receipts:[]},
    {turn:1,commit:'away',world:{active_scene:'central-library',npc_presence:{...presence},clock:{minutes:60}},speech:[],receipts:[]}
  ]};
}
test('reunion wider event scope preserves the original accepted interval key',()=>{
  const {world,records}=fixture();
  const narrow=reunionInterval(graph,world,node,records,stable);
  const wide=reunionInterval(graph,world,node,records,{...stable,campaign:'npc-test',turn:2,worldlines:{main:{loop:0}},current_receipts:[{kind:'move'}]});
  assert.equal(narrow.key,acceptedKey);assert.deepEqual(wide,narrow);
  assert.deepEqual(wide.scope,stable);
});
test('reunion identity preserves absent stable scope fields instead of adding defaults',()=>{
  const {world,records}=fixture();
  for(const scope of [{},{worldline:'main'},{loop:0}]){
    const narrow=reunionInterval(graph,world,node,records,scope);
    const wide=reunionInterval(graph,world,node,records,{campaign:'npc-test',turn:200,current_receipts:[],...scope});
    assert.deepEqual(wide.scope,scope);assert.deepEqual(wide,narrow);
    assert.notEqual(wide.key,acceptedKey);
  }
});
test('reunion identity keeps different worldlines and loops distinct',()=>{
  const {world,records}=fixture();
  const keys=[stable,{worldline:'alternate',loop:0},{worldline:'main',loop:1}].map(scope=>reunionInterval(graph,world,node,records,scope).key);
  assert.equal(keys[0],acceptedKey);assert.equal(new Set(keys).size,3);
});
test('accepted reunion is reused through wide reads and reload without replacing its record',()=>{
  const {world,records}=fixture();
  acceptReunion(graph,world,node,records,stable,continuity,2);
  const retained=JSON.stringify(world),wide={...stable,campaign:'npc-test',turn:99,worldlines:{main:{last_turn:98}},current_receipts:[{kind:'npc'}]};
  assert.equal(reunionView(graph,world,node,records,wide).status,'established');
  assert.deepEqual(reunionView(graph,JSON.parse(retained),node,records,wide).background,continuity.background);
  assert.equal(acceptReunion(graph,world,node,records,wide,continuity,99).reused,true);
  assert.throws(()=>acceptReunion(graph,world,node,records,wide,{...continuity,background:['A different invented past.']},99),error=>(error as any).code==='idempotency_conflict');
  assert.equal(JSON.stringify(world),retained);
});
