/** Prepared-usage lifecycle and read-only inventory projection from test_mods.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {kernel,CAMPAIGN,campaignDir,readJson,readJsonl,writeJson,openTurn,prepared,type Row,type RpcClient} from './support.ts';
import {prefetchObject,prefetchUsage,proposalJob,acceptProposal,fork,walkToConfrontation} from './mod-fixtures.ts';
const worldPath=(k:RpcClient)=>join(campaignDir(k.workspace),'world.json');
const targets=(k:RpcClient)=>k.ok('mods.prefetch.targets',{campaign:CAMPAIGN});
const close=(k:RpcClient,call_id='t1-c2')=>k.table('narrate',{call_id,text:'I put the rod aside.'});
function retainedTree(root:string){const rows:Row={};function walk(path:string){if(!existsSync(path))return;const stat=statSync(path,{bigint:true});rows[relative(root,path)]=[stat.mtimeNs,stat.isFile()?readFileSync(path):null];if(stat.isDirectory())for(const name of readdirSync(path).sort())walk(join(path,name));}walk(root);return rows;}

test('test_prefetch_accept_outside_turn_is_idempotent_without_action_side_effects',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);await close(k);const folder=campaignDir(k.workspace),beforeWorld=readJson(worldPath(k)),beforeTurn=readFileSync(join(folder,'turn.json')),beforeEvents=readFileSync(join(folder,'events.jsonl'));
  const job=await proposalJob(k),identity=readJson(join(job.cwd,'identity.json'));assert.ok(!('turn' in identity));assert.equal(identity.prefetch,true);assert.deepEqual(readJson(join(job.cwd,'request.json')).receipts,[]);
  const accepted=await acceptProposal(k,job,prefetchUsage());assert.equal(accepted.provenance.prefetched,true);assert.deepEqual(await k.ok('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job}),accepted);
  const after=readJson(worldPath(k)),records=after.objects.usages;delete after.objects.usages;delete beforeWorld.objects.usages;assert.deepEqual(after,beforeWorld);
  assert.equal(Object.keys(records).length,1);assert.deepEqual((Object.values(records)[0] as Row).provenance,accepted.provenance);
  assert.deepEqual(readFileSync(join(folder,'turn.json')),beforeTurn);assert.deepEqual(readFileSync(join(folder,'events.jsonl')),beforeEvents);
  await k.table('player_input',{text:'I inspect the rod.'});const again=await proposalJob(k);assert.equal(again.job,job.job);assert.equal(again.accepted,true);assert.deepEqual(await k.ok('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job}),accepted);
});
test('test_prefetch_resolve_reuses_record_without_new_creator_job',async t=>{
  const k=await kernel(t,{env:{COC_KERNEL_SEED:'7'}});await openTurn(k);const n=await walkToConfrontation(k);await prefetchObject(k,`t1-c${n}`);const job=await proposalJob(k);
  await close(k,`t1-c${n+1}`);await k.table('player_input',{text:'I swing the rod at Walter Corbitt.'});const accepted=await acceptProposal(k,job,prefetchUsage()),usage=Object.values(readJson(worldPath(k)).objects.usages)[0] as Row;
  const parent=join(job.cwd,'..'),jobsBefore=readdirSync(parent).sort();const result=await k.table('resolve',{call_id:'t2-c1',action:{intent:'combat',object:'My rod',usage:'Swing',target:'Walter Corbitt',defense:'none'}});
  assert.ok(result.outcome);assert.deepEqual(readdirSync(parent).sort(),jobsBefore);const combat=readJson(join(campaignDir(k.workspace),'save/combat.json'));
  assert.ok(usage.id in combat.weapon_catalog);assert.equal(combat.weapon_catalog[usage.id].object_id,usage.object_id);assert.equal(combat.weapon_catalog[usage.id].damage,accepted.usage.parameters.damage);
  const replay=await k.ok('mods.job',{campaign:CAMPAIGN,role:'usage',input:{object:'My rod',name:'Swing',description:'Reuse the known swing.'}});assert.equal(replay.accepted,true);
  const ordinary=await k.ok('mods.accept',{campaign:CAMPAIGN,job:replay.job});assert.equal(ordinary.provenance.reused_usage,usage.id);assert.ok(!('prefetched' in ordinary.provenance));
});
test('test_prefetch_and_action_records_share_physical_invalidation',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const job=await proposalJob(k);await acceptProposal(k,job,prefetchUsage());
  const request={object:'My rod',name:'Strike',description:'Strike with the rod.'},actionJob=await k.ok('mods.job',{campaign:CAMPAIGN,role:'usage',input:request});writeJson(join(actionJob.cwd,'result.json'),prefetchUsage('Strike'));
  const actionUsage=await k.ok('mods.accept',{campaign:CAMPAIGN,job:actionJob.job});await k.table('apply',{call_id:'t1-c2',effects:[{kind:'usage',...request,_usage:actionUsage}]});
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'object',name:'My rod',from:'Thomas Hayes',to:'Thomas Hayes',condition:'broken',why:'The rod snapped against the stone wall.'}]});
  const look=await k.table('look',{focus:'object',name:'My rod'});assert.equal(look.instance.usages.length,2);assert.ok(look.instance.usages.every((usage:Row)=>!usage.applicable));
  for(const usage of ['Swing','Strike'])assert.equal((await k.tableErr('resolve',{call_id:'t1-c4',action:{intent:'combat',object:'My rod',usage,target:'Steven Knott',defense:'none'}})).details.reason,'usage_required');
  assert.equal((await k.err('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job})).details.reason,'usage_stale');assert.notEqual((await proposalJob(k)).job,job.job);
});
test('test_prefetch_negative_result_is_retained_and_deduplicated',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const job=await proposalJob(k),before=readFileSync(worldPath(k)),accepted=await acceptProposal(k,job,null);
  assert.equal(accepted.usage,null);assert.equal(accepted.provenance.prefetched,true);assert.deepEqual(readJson(join(job.cwd,'accepted.json')),accepted);assert.deepEqual(readFileSync(worldPath(k)),before);
  await close(k);await k.table('player_input',{text:'I wait.'});assert.equal((await proposalJob(k)).job,job.job);assert.equal((await proposalJob(k)).accepted,true);assert.deepEqual(await k.ok('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job}),accepted);
  assert.ok(readJsonl(join(campaignDir(k.workspace),'telemetry.jsonl')).some(row=>row.event==='usage_prefetch_accepted'&&row.negative===true));
});
test('test_prefetch_entry_does_not_relax_action_turn_binding',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const proposal=await proposalJob(k);assert.equal((await k.err('mods.accept',{campaign:CAMPAIGN,job:proposal.job})).details.reason,'prefetch_accept_required');
  const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'usage',input:{object:'My rod',name:'Swing',description:'Swing the rod.'}});writeJson(join(job.cwd,'result.json'),prefetchUsage());
  assert.equal((await k.err('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job})).details.reason,'action_accept_required');await close(k);await k.table('player_input',{text:'I change my mind.'});
  const error=await k.err('mods.accept',{campaign:CAMPAIGN,job:job.job});assert.equal(error.code,'invalid_params');assert.ok(error.message.includes('another turn'));assert.ok(!existsSync(join(job.cwd,'accepted.json')));
});
test('test_prefetch_rejects_changed_request_without_registering',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const job=await proposalJob(k),path=join(job.cwd,'request.json'),request=readJson(path);request.usage_object.state.condition='broken';writeJson(path,request);writeJson(join(job.cwd,'result.json'),prefetchUsage());
  assert.equal((await k.err('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job})).details.reason,'usage_request_changed');assert.ok(!existsSync(join(job.cwd,'accepted.json')));assert.equal(Object.keys(readJson(worldPath(k)).objects.usages??{}).length,0);
});
test('test_prefetch_records_survive_generator_disable',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);await acceptProposal(k,await proposalJob(k),prefetchUsage());await close(k);await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-items',enabled:false});await k.table('player_input',{text:'I examine the rod.'});
  assert.equal((await proposalJob(k)).enabled,false);assert.equal((await k.table('look',{focus:'object',name:'My rod'})).instance.usages[0].applicable,true);assert.ok((await k.table('view')).investigators[0].weapons.some((row:Row)=>row.usage==='Swing'));
});
test('test_prefetch_worldline_snapshot_keeps_records_but_jobs_cannot_cross',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const job=await proposalJob(k),accepted=await acceptProposal(k,job,prefetchUsage());await close(k);const records=readJson(worldPath(k)).objects.usages;
  await fork(k,2,'side');assert.deepEqual(readJson(worldPath(k)).objects.usages,records);assert.deepEqual((Object.values(records)[0] as Row).provenance,accepted.provenance);
  assert.ok((await k.err('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job})).message.includes('worldline'));assert.notEqual((await proposalJob(k)).job,job.job);
});
test('test_prefetch_refuses_an_ordinary_item',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const stick={name:'Oak walking stick',category:'item',description:'A plain oak walking stick.',basis:'Fixture physical facts',parameters:{effects:[]},player_view:{description:'A walking stick.',fields:[]}};
  await k.table('apply',{call_id:'t1-c2',effects:[await prepared(k,stick),{kind:'object',name:'My stick',definition:stick.name,to:'Thomas Hayes'}]});await close(k,'t1-c3');const before=readJson(worldPath(k));
  const error=await k.err('mods.job',{campaign:CAMPAIGN,role:'usage',input:{object:'My stick',propose:true}});assert.equal(error.code,'needs');assert.equal(error.details.reason,'usage_requires_action');assert.deepEqual(readJson(worldPath(k)),before);assert.ok((await proposalJob(k)).job);
});
test('test_prefetch_targets_scope_owner_and_unbounded_read_only_projection',async t=>{
  const k=await kernel(t);await openTurn(k);const folder=campaignDir(k.workspace),jobs=join(k.workspace,'.coc/mods/jobs');let before=[retainedTree(folder),retainedTree(jobs)];assert.deepEqual((await targets(k)).instances,[]);assert.deepEqual([retainedTree(folder),retainedTree(jobs)],before);
  await prefetchObject(k);const placements=[['Scene rod','here'],['NPC rod','Steven Knott'],['Remote rod','corbitt-house-ground'],['Nested rod','My rod'],['Remote nested rod','Remote rod'],...Array.from({length:25},(_,i)=>[`Scene rod ${i}`,'here'])];
  await k.table('apply',{call_id:'t1-c2',effects:placements.map(([name,to])=>({kind:'object',name,definition:'Wooden rod',to}))});before=[retainedTree(folder),retainedTree(jobs)];const result=await targets(k);assert.deepEqual([retainedTree(folder),retainedTree(jobs)],before);
  const instances=Object.fromEntries(result.instances.map((row:Row)=>[row.name,row])) as Record<string,Row>;
  assert.deepEqual(new Set(Object.keys(instances)),new Set(['My rod','Scene rod','NPC rod','Nested rod',...Array.from({length:25},(_,i)=>`Scene rod ${i}`)]));const world=readJson(worldPath(k));
  assert.deepEqual(instances['My rod'].owner,world.objects.instances[instances['My rod'].id].owner);assert.equal(instances['My rod'].owner.kind,'investigator');assert.equal(instances['NPC rod'].owner.kind,'npc');assert.equal(instances['Scene rod'].owner.id,result.active_scene);
  assert.deepEqual(instances['Nested rod'].owner,{kind:'other',id:instances['My rod'].id,name:'My rod'});
  for(const item of Object.values(instances)){const physical=world.objects.instances[item.id];assert.equal(item.definition_digest,world.objects.definitions[physical.definition].digest);assert.equal(item.condition,'intact');assert.equal(item.has_any_usage,false);assert.equal(item.covered,false);}
});
test('test_prefetch_targets_positive_and_action_records_are_marked_even_when_stale',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);const job=await proposalJob(k);assert.equal((await targets(k)).instances[0].covered,false);await acceptProposal(k,job,prefetchUsage());
  let item=(await targets(k)).instances[0];assert.equal(item.has_any_usage,true);assert.equal(item.covered,true);
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'My rod',from:'Thomas Hayes',to:'Thomas Hayes',condition:'broken',why:'The rod snapped.'}]});item=(await targets(k)).instances[0];assert.equal(item.condition,'broken');assert.equal(item.has_any_usage,true);assert.equal(item.covered,false);
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'object',name:'Action rod',definition:'Wooden rod',to:'here'}]});const request={object:'Action rod',name:'Swing',description:'Swing the rod.'};
  const action=await k.ok('mods.job',{campaign:CAMPAIGN,role:'usage',input:request});writeJson(join(action.cwd,'result.json'),prefetchUsage());const accepted=await k.ok('mods.accept',{campaign:CAMPAIGN,job:action.job});
  await k.table('apply',{call_id:'t1-c4',effects:[{kind:'usage',...request,_usage:accepted}]});item=(await targets(k)).instances.find((row:Row)=>row.name==='Action rod');assert.equal(item.has_any_usage,true);assert.equal(item.covered,false);
});
test('test_prefetch_targets_negative_coverage_worldline_and_state_are_read_only',async t=>{
  const k=await kernel(t);await openTurn(k);await prefetchObject(k);await acceptProposal(k,await proposalJob(k),null);const folder=campaignDir(k.workspace),jobs=join(k.workspace,'.coc/mods/jobs');
  async function check(){const before=[retainedTree(folder),retainedTree(jobs)],result=await targets(k);assert.deepEqual([retainedTree(folder),retainedTree(jobs)],before);
    const meta=readJson(join(folder,'campaign.json')),turn=readJson(join(folder,'turn.json')),world=readJson(worldPath(k));
    assert.deepEqual(Object.fromEntries(['campaign','worldline','turn','state','pending_choice','active_scene'].map(key=>[key,result[key]])),{campaign:CAMPAIGN,worldline:meta.active_worldline,turn:turn.turn,state:turn.state,pending_choice:turn.pending_choice,active_scene:world.active_scene});return result.instances[0];}
  const item=await check();assert.equal(item.has_any_usage,false);assert.equal(item.covered,true);await close(k);assert.equal((await check()).covered,true);await fork(k,2,'side');assert.equal((await check()).covered,false);
  const path=join(folder,'turn.json'),turn=readJson(path);turn.pending_choice={kind:'fixture-choice',options:['wait','leave']};writeJson(path,turn);await check();
});
