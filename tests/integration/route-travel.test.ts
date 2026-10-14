/** Road publication and movement counterparts of test_route_travel.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,CONTENT_DIR,campaignDir,createCampaign,readJson,readJsonl,writeJson,type RpcClient,type Row} from './support.ts';
import {indexed,opening,finish,request,claim,observed} from './module-support.ts';
import {ordinaryReceipts} from './npc-support.ts';
const STARTERS=['the-haunting','mystery-house','voice-bench','the-haunting-rulebook'];
const costs=readJson(join(CONTENT_DIR,'rulesets/coc7/rules-json/time-costs.json')).categories,LOCAL=costs.local_travel.default,LONG=costs.long_travel.default;
const shipped=(id:string)=>readJson(join(CONTENT_DIR,'starters',id,'module-graph.json'));
const roads=(graph:Row,a:string,b:string)=>graph.relations.filter((row:Row)=>row.relation_kind==='route-to'&&new Set([row.from_node_id,row.to_node_id]).size===new Set([a,b]).size&&[a,b].includes(row.from_node_id)&&[a,b].includes(row.to_node_id));
function published(k:RpcClient,mid:string){const folder=join(k.workspace,'.coc/modules',mid);return readJson(join(folder,readJson(join(folder,'module.json')).graph_file??'module-graph.json'));}
async function publishOpening(k:RpcClient,travel?:Row[]):Promise<[string,Row]>{const [mid]=await indexed(k),[job]=await opening(k,mid);return [mid,await finish(k,job,travel===undefined?{}:{travel})];}

for(const id of STARTERS)test(`test_every_shipped_road_minute_is_a_banded_default_or_absent[${id}]`,()=>{
  const graph=shipped(id);let counted=0;
  for(const relation of graph.relations){const p=relation.properties??{};
    if(relation.relation_kind!=='route-to'){assert.ok(!('travel_minutes' in p));assert.ok(!('travel' in p));continue;}
    if(!('travel_minutes' in p)){assert.ok(!('travel' in p));continue;}counted++;
    const travel=p.travel;assert.deepEqual(new Set(Object.keys(travel)),new Set(['basis','band','confidence']));assert.equal(travel.basis,'banded');assert.ok(travel.confidence>=0&&travel.confidence<=1);
    const expected=travel.band==='adjacent'?0:costs[travel.band].default;assert.ok(['adjacent','local_travel','long_travel'].includes(travel.band));assert.equal(p.travel_minutes,expected,relation.relation_id);
  }assert.ok(counted,`${id} ships no filled road`);
  const byPair=new Map<string,Set<number>>();for(const relation of graph.relations){const minutes=relation.properties?.travel_minutes;
    if(relation.relation_kind==='route-to'&&minutes!=null){const key=JSON.stringify([relation.from_node_id,relation.to_node_id].sort());if(!byPair.has(key))byPair.set(key,new Set());byPair.get(key)!.add(minutes);}}
  assert.ok([...byPair.values()].every(values=>values.size===1));
});
test('test_a_move_to_a_filled_exit_lands_with_the_roads_minutes',async t=>{
  const k=await kernel(t),road=roads(shipped('the-haunting'),'scene-commission-briefing','scene-hall-of-records'),minutes=road[0].properties.travel_minutes;
  assert.equal(minutes,LOCAL);assert.equal(road[0].properties.travel.band,'local_travel');await createCampaign(k);await k.table('open');await k.table('narrate',{call_id:'t0-c1',text:'Knott puts the keys on the desk.'});
  const capsule=(await k.table('player_input',{text:'我去档案馆。'})).capsule;assert.equal(capsule.where.exits.find((row:Row)=>row.to==='hall-of-records').travel_minutes,minutes);
  const moved=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'hall-of-records'}]});assert.deepEqual(moved.world.clock,{minutes});
  const receipts=ordinaryReceipts(readJson(join(campaignDir(k.workspace),'turn.json')).receipts).filter((r:Row)=>r.trigger!=='presence');
  assert.deepEqual(receipts.map((r:Row)=>r.kind),['move']);assert.equal(receipts[0].minutes,minutes);
  assert.equal(readJsonl(join(campaignDir(k.workspace),'events.jsonl')).filter(row=>row.type==='scene-moved').at(-1)!.data.minutes,minutes);
  assert.deepEqual((await k.table('apply',{call_id:'t1-c2',effects:[{kind:'move',to:'commission-briefing',travel_minutes:5}]})).world.clock,{minutes:minutes+5});
});
for(const [band,minutes] of [['local_travel',LOCAL],['long_travel',LONG],['adjacent',0]] as const)test(`test_a_publication_lands_the_hosts_band_as_the_rows_default[${band}]`,async t=>{
  const k=await kernel(t),[mid,result]=await publishOpening(k,[{from:'scene-tower',to:'scene-dock',band,confidence:0.83}]);
  assert.deepEqual(result.travel,{filled:1,skipped:[]});const road=roads(published(k,mid),'scene-dock','scene-tower');assert.equal(road.length,1);
  assert.deepEqual(road[0].properties,{travel_minutes:minutes,travel:{basis:'banded',band,confidence:0.83}});
});
test('test_without_a_band_a_road_keeps_no_minutes',async t=>{
  const k=await kernel(t),[mid,result]=await publishOpening(k);assert.ok(!('travel' in result));
  const road=roads(published(k,mid),'scene-dock','scene-tower');assert.equal(road.length,1);assert.deepEqual(road[0].properties,{});
});
test('test_a_band_that_does_not_fit_is_skipped_and_the_reading_still_publishes',async t=>{
  const k=await kernel(t),[mid,result]=await publishOpening(k,[{from:'scene-dock',to:'scene-tower',band:'sleep_night',confidence:0.9},
    {from:'scene-dock',to:'scene-dock',band:'local_travel',confidence:0.9},{from:'scene-dock',to:'npc-lena',band:'local_travel',confidence:0.9},
    {from:'scene-dock',to:'scene-tower',band:'local_travel',confidence:1.5},{from:'scene-dock',to:'scene-tower',band:'local_travel',confidence:0.9,minutes:7}]);
  assert.ok(result.generation>=1);assert.equal(result.travel.filled,0);assert.deepEqual(result.travel.skipped.map((row:Row)=>row.reason),['band_unknown','not_two_scenes','not_two_scenes','confidence','entry_shape']);
  const road=roads(published(k,mid),'scene-dock','scene-tower');assert.equal(road.length,1);assert.ok(!('travel_minutes' in road[0].properties));
});
test('test_a_filled_road_survives_the_next_publication_and_is_never_overwritten',async t=>{
  const k=await kernel(t),[mid]=await publishOpening(k,[{from:'scene-dock',to:'scene-tower',band:'local_travel',confidence:0.7}]);
  await request(k,mid,'detail',{focus:'Lena',question:'What does she remember about the tower?'});const job=await claim(k,mid),refs=[{page:2}];
  writeJson(join(job.work_dir,'draft.json'),{nodes:[{node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:refs,properties:{knowledge:['She remembers the tower keeper.']}}],
    claims:[{subject_id:'scene-dock',predicate:'route-to',object:{node_id:'scene-tower'},truth_status:'authored-fact',source_refs:refs}],node_refs:['scene-dock','scene-tower'],coverage:{},dependencies:[],critical:[],ready_nodes:['npc-lena']});
  writeJson(join(job.work_dir,'review.json'),{checked:[{paths:['/nodes/0','/claims/0','/coverage'],verdict:'supported',source_refs:refs,reason:'Fixture.'}],missing:[]});observed(job,{read_pages:[2],review_pages:[2]});
  const result=await finish(k,job,{travel:[{from:'scene-dock',to:'scene-tower',band:'long_travel',confidence:0.99}]});
  assert.deepEqual(result.travel,{filled:0,skipped:[{from:'scene-dock',to:'scene-tower',band:'long_travel',reason:'no_unfilled_road'}]});
  const road=roads(published(k,mid),'scene-dock','scene-tower');assert.equal(road.length,1);assert.deepEqual(road[0].properties,{travel_minutes:LOCAL,travel:{basis:'banded',band:'local_travel',confidence:0.7}});
});
