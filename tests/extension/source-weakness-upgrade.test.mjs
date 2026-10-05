/** §180.20: real source cohorts, explicit fragment artifacts and product RPC; no semantic/model execution. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, readdir, symlink, writeFile, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root=resolve(import.meta.dirname,'../..'), content=join(root,'content'), id='the-haunting-rulebook';
const scratch=playtestScratch('source-weakness-upgrade');
await build({stdin:{contents:[
  `export * from './kernel-ts/testing/api.ts';`,
  `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
  `export {ModuleStore} from './kernel-ts/modules/store.ts';`,
  `export {previewSourceUpgrade} from './kernel-ts/modules/source-upgrade.ts';`,
  `export {loadModuleContract} from './kernel-ts/modules/contract.ts';`,
  `export {ModuleGraph,dossierWith} from './kernel-ts/read/module-graph.ts';`,
  `export {weaknessChain} from './kernel-ts/read/weaknesses.ts';`,
  `export {buildVocabulary} from './kernel-ts/read/mods.ts';`,
  `export {graphManifest} from './kernel-ts/write/source.ts';`,
  `export {ensureCampaignModule} from './kernel-ts/modules/campaign-scope.ts';`,
].join('\n'),resolveDir:root,sourcefile:'source-weakness-upgrade-api.ts'},outfile:join(scratch,'api.mjs'),
bundle:true,packages:'external',format:'esm',platform:'node',logLevel:'silent'});
const api=await import(pathToFileURL(join(scratch,'api.mjs')).href);
const contract=await api.loadModuleContract({content,snapshots:api.snapshots}), law=contract.graph.actor_weaknesses;
const shippedPath=join(content,'starters',id,'module-graph.json'), shippedBytes=await readFile(shippedPath);
const shipped=JSON.parse(shippedBytes), upgrade=JSON.parse(await readFile(join(content,'starters',id,'weaknesses-upgrade.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const node=(graph,id)=>graph.nodes.find(node=>node.node_id===id);
const exists=path=>stat(path).then(()=>true,()=>false);
const evidence=async(name,value)=>{
  if(process.env.COC_SOURCE_UPGRADE_EVIDENCE_DIR)
    await writeFile(join(process.env.COC_SOURCE_UPGRADE_EVIDENCE_DIR,`${name}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
};
let ordinal=0;
async function kernel(t,contentRoot=content) {
  const workspace=join(scratch,`home-${++ordinal}`); await mkdir(workspace);
  const context=await api.createKernelContext({workspace,content:contentRoot,seed:'source-weakness-upgrade',locks:api.nativeAdvisoryLocks(),
    env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(context); t.after(()=>runtime.close());
  const call=async(method,params={})=>JSON.parse(api.pythonJsonDumps(await runtime.handlers[method](params)));
  const dir=join(workspace,'.coc/modules',id), meta=async()=>JSON.parse(await readFile(join(dir,'module.json'),'utf8'));
  return {workspace,context,call,dir,meta,store:new api.ModuleStore(context)};
}
const apply=(game,preview,params={})=>game.call('module.source.upgrade',{module_id:id,action:'apply',revision:preview.revision,...params});

test('shipped legacy facts upgrade only the missing source field, with exact citations and no other graph changes',async()=>{
  const meta={id,generation:4,graph_digest:sha(shippedBytes)}, before=structuredClone(shipped);
  const checked=api.previewSourceUpgrade(meta,shipped,upgrade,law);
  assert.equal(upgrade.base_graph_digest,meta.graph_digest);
  assert.equal(checked.report.additions.length,1);
  assert.equal(checked.report.additions[0].actor_id,'npc-walter-corbitt');
  assert.equal(checked.report.additions[0].weaknesses.length,2);
  assert.ok(checked.report.unassessed.some(row=>row.actor_id!=='npc-walter-corbitt'));
  assert.ok(checked.report.unassessed.every(row=>row.state==='source_extraction_required'));
  assert.deepEqual(shipped,before,'pure preview never mutates its input');
  delete node(checked.graph,'npc-walter-corbitt').properties.weaknesses;
  delete checked.graph.field_spans['/nodes/npc-walter-corbitt/properties/weaknesses'];
  if(!Object.keys(checked.graph.field_spans).length&&!before.field_spans)delete checked.graph.field_spans;
  assert.deepEqual(JSON.parse(api.pythonJsonDumps(checked.graph)),before,'source properties, visibility, mechanics, nodes and relations retained');
  assert.equal(sha(await readFile(shippedPath)),meta.graph_digest);
});

test('reviewed entries are generic across npc and creature, preserving manual entries and explicit empty lists',()=>{
  const refs=[{source_id:'pdf:unrelated',pdf_index:8}];
  const graph={nodes:[
    {node_id:'npc-keeper',node_kind:'npc',name:'Keeper',properties:{end_condition:'The hand opens the seal.'},source_refs:refs},
    {node_id:'creature-cloud',node_kind:'creature',name:'Cloud',properties:{end_condition:'Wind disperses it.'},source_refs:refs},
    {node_id:'npc-manual',node_kind:'npc',name:'Manual',properties:{weaknesses:[{book:'Retain my exact words.'}],end_condition:'Other words.'},source_refs:refs},
    {node_id:'creature-empty',node_kind:'creature',name:'Empty',properties:{weaknesses:[],end_condition:'Other words.'},source_refs:refs},
    {node_id:'npc-projected',node_kind:'npc',name:'Projected',properties:{end_condition:'Other words.',runtime_projection:{record:{weaknesses:[{book:'Manual projection stays.'}]}}},source_refs:refs},
    {node_id:'creature-unknown',node_kind:'creature',name:'Unknown',properties:{},source_refs:refs},
  ],relations:[]};
  const meta={id:'unrelated',generation:1,graph_digest:api.jsonDigest(graph)};
  const artifact={version:1,id:'fragment-review-1',base_graph_digest:meta.graph_digest,
    review:{method:'source-fragment-review',source:'Original fragment page 9.',reason:'Explicit fixture transcription.'},
    entries:graph.nodes.slice(0,5).map(actor=>({actor_id:actor.node_id,weaknesses:[{book:actor.properties.end_condition}],source_refs:refs,
      evidence:[{node_id:actor.node_id,path:'/properties/end_condition',value:actor.properties.end_condition}]}))};
  const preview=api.previewSourceUpgrade(meta,graph,artifact,law);
  assert.deepEqual(preview.report.additions.map(row=>row.actor_id),['npc-keeper','creature-cloud']);
  assert.deepEqual(preview.report.preserved.map(row=>row.actor_id),['npc-manual','creature-empty','npc-projected']);
  assert.deepEqual(node(preview.graph,'npc-manual').properties.weaknesses,node(graph,'npc-manual').properties.weaknesses);
  assert.deepEqual(node(preview.graph,'creature-empty').properties.weaknesses,[]);
  assert.deepEqual(node(preview.graph,'npc-projected').properties,node(graph,'npc-projected').properties);
  assert.deepEqual(preview.report.unassessed.map(row=>row.actor_id),['creature-unknown']);
});

test('source vocabulary is present even when there are no installed consumer packages',async t=>{
  const base=join(scratch,'no-packages');await mkdir(join(base,'content'),{recursive:true});
  for(const name of await readdir(content))await symlink(join(content,name),join(base,'content',name));
  const game=await kernel(t,join(base,'content')), vocabulary=await api.buildVocabulary(game.context);
  assert.deepEqual(vocabulary.actor_weaknesses,{source:'module-source',version:1});
  assert.deepEqual(vocabulary.creature_profile_keys??[],[]);
  const unassessed=api.previewSourceUpgrade({id:'unknown',generation:1,graph_digest:sha(shippedBytes)},shipped,null,law);
  assert.equal(unassessed.report.state,'source_extraction_required');
  assert.deepEqual(unassessed.graph,shipped);
});

test('registration, preview, generation publication, retry and re-registration retain the upgraded cohort',async t=>{
  const game=await kernel(t); await game.call('module.register',{module_id:id});
  const before=await game.meta(), beforeBytes=await readFile(join(game.dir,'module.json'));
  const preview=await game.call('module.source.upgrade',{module_id:id});
  assert.equal(preview.state,'preview');
  assert.deepEqual(await readFile(join(game.dir,'module.json')),beforeBytes);
  await assert.rejects(apply(game,{}),error=>error.details.reason==='source_upgrade_preview_required');
  assert.equal((await game.meta()).generation,before.generation);
  const result=await apply(game,preview), after=await game.meta();
  assert.equal(result.state,'applied'); assert.equal(after.generation,before.generation+1);
  assert.deepEqual(after.vocabulary.actor_weaknesses,{source:'module-source',version:1});
  const published=await game.store.readGraph(id);
  assert.deepEqual(node(published,'npc-walter-corbitt').properties.weaknesses,upgrade.entries[0].weaknesses);
  assert.deepEqual(published.source_fact_upgrades,after.source_fact_upgrades);
  assert.equal(sha(await readFile(join(game.dir,'module-graph.json'))),before.graph_digest,'previous generation retained');
  await game.call('module.register',{module_id:id});
  assert.equal((await game.meta()).graph_digest,after.graph_digest,'registration must not undo the source upgrade');
  assert.equal((await game.meta()).generation,after.generation);
  assert.equal((await apply(game,preview)).state,'already_applied');
  assert.equal((await game.meta()).generation,after.generation);
  const conflicting=structuredClone(upgrade); conflicting.review.reason+=' Changed bytes.';
  await assert.rejects(game.call('module.source.upgrade',{module_id:id,upgrade:conflicting}),error=>error.details.reason==='source_upgrade_id_conflict');
  assert.equal((await game.meta()).graph_digest,after.graph_digest);
  await evidence('registered-upgrade',{no_model_calls:true,before,preview,result,after,replay_generation:(await game.meta()).generation,
    previous_bytes_retained:true,re_registration_retained:true,source_sha256:sha(await readFile(shippedPath))});
});

test('bad source witness, base, citations, entry references and stale previews cannot publish',async t=>{
  const game=await kernel(t); await game.call('module.register',{module_id:id});
  const before=await readFile(join(game.dir,'module.json'));
  const variants=[
    ['source_upgrade_base_changed',a=>a.base_graph_digest='0'.repeat(64)],
    ['source_upgrade_evidence_changed',a=>a.entries[0].evidence[0].value='Different source text.'],
    ['source_upgrade_invalid',a=>a.entries[0].source_refs[0].pdf_index=999],
    ['source_upgrade_weaknesses_invalid',a=>a.entries[0].weaknesses[0].needs=['object-missing']],
    ['source_upgrade_invalid',a=>a.review.method='keyword-classifier'],
    ['source_upgrade_invalid',a=>delete a.review.source],
    ['source_upgrade_invalid',a=>delete a.entries[0].source_refs[0].source_id],
  ];
  for(const[reason,change]of variants){const a=structuredClone(upgrade);change(a);
    await assert.rejects(game.call('module.source.upgrade',{module_id:id,action:'apply',upgrade:a,revision:'obsolete'}),error=>error.details.reason===reason);
    assert.deepEqual(await readFile(join(game.dir,'module.json')),before);}
  const preview=await game.call('module.source.upgrade',{module_id:id});
  const meta=await game.meta(); await game.store.writeGraph(meta,await game.store.readGraph(id)); await game.store.writeModule(meta);
  const changed=await game.meta();
  await assert.rejects(apply(game,preview),error=>error.details.reason==='source_upgrade_preview_required');
  assert.equal((await game.meta()).graph_digest,changed.graph_digest);
});

test('preview does not fork, campaign apply is private, and library apply leaves private forks and knowledge untouched',async t=>{
  const game=await kernel(t); await game.call('module.register',{module_id:id});
  await game.call('campaign.create',{id:'private',module:id,play_language:'en'});
  await game.call('campaign.create',{id:'old-private',module:id,play_language:'en'});
  const campaign=join(game.workspace,'.coc/campaigns/private'), fork=join(game.workspace,'.coc/module-campaigns/private/modules',id);
  const world=await readFile(join(campaign,'world.json')), library=await readFile(join(game.dir,'module.json'));
  const preview=await game.call('module.source.upgrade',{module_id:id,campaign:'private'});
  assert.equal(await exists(fork),false);
  await assert.rejects(apply(game,{}, {campaign:'private'}),error=>error.details.reason==='source_upgrade_preview_required');
  assert.equal(await exists(fork),false,'an invalid apply must not fork');
  await api.ensureCampaignModule(game.context,'old-private',id);
  const oldFork=join(game.workspace,'.coc/module-campaigns/old-private/modules',id,'module.json'), oldBytes=await readFile(oldFork);
  const applied=await apply(game,preview,{campaign:'private'});
  assert.equal(applied.state,'applied'); assert.equal(await exists(fork),true);
  assert.deepEqual(await readFile(join(game.dir,'module.json')),library);
  assert.deepEqual(await readFile(join(campaign,'world.json')),world);
  const privateMeta=await readFile(join(fork,'module.json'));
  const libraryPreview=await game.call('module.source.upgrade',{module_id:id}); await apply(game,libraryPreview);
  assert.deepEqual(await readFile(join(fork,'module.json')),privateMeta);
  assert.deepEqual(await readFile(oldFork),oldBytes);
  assert.deepEqual(await readFile(join(campaign,'world.json')),world);
  await evidence('campaign-isolation',{no_model_calls:true,preview,applied,preview_did_not_fork:true,library_unchanged_after_private_apply:true,
    private_forks_unchanged_after_library_apply:true,world_bytes_unchanged:true});
});

test('changed upstream starter refuses re-registration instead of replacing the reviewed generation',async t=>{
  const base=join(scratch,'edited-content'); await mkdir(join(base,'content/starters',id),{recursive:true});
  await symlink(join(root,'mods'),join(base,'mods'));
  for(const name of await readdir(content))if(name!=='starters')await symlink(join(content,name),join(base,'content',name));
  for(const name of await readdir(join(content,'starters')))if(name!==id)await symlink(join(content,'starters',name),join(base,'content/starters',name));
  for(const name of await readdir(join(content,'starters',id)))if(name!=='module-graph.json')await symlink(join(content,'starters',id,name),join(base,'content/starters',id,name));
  const source=join(base,'content/starters',id,'module-graph.json'); await writeFile(source,shippedBytes);
  const game=await kernel(t,join(base,'content')); await game.call('module.register',{module_id:id});
  await apply(game,await game.call('module.source.upgrade',{module_id:id}));
  const before=await readFile(join(game.dir,'module.json'));
  await writeFile(source,JSON.stringify({...shipped,local_test_revision:1}));
  await assert.rejects(game.call('module.register',{module_id:id}),error=>error.details.reason==='source_upgrade_starter_changed');
  assert.deepEqual(await readFile(join(game.dir,'module.json')),before);
});

test('upgraded Keeper chain tracks renamed source means and real discovery without granting player knowledge',async t=>{
  const game=await kernel(t); await game.call('module.register',{module_id:id});
  await apply(game,await game.call('module.source.upgrade',{module_id:id}));
  await game.call('campaign.create',{id:'sheet-source',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const saved=await game.call('investigator.save',{campaign:'sheet-source'});
  await game.call('campaign.create',{id:'table',module:id,play_language:'en'});
  await game.call('investigator.load',{campaign:'table',library_id:saved.library_id});
  await game.call('setup.complete',{campaign:'table'});
  const call=(method,params={})=>game.call(method,{campaign:'table',...params});
  await call('table.open'); await call('table.narrate',{call_id:'t0-c1',text:'A controlled source-fact fixture begins.'});
  await call('table.player_input',{text:'I examine what I already know.'});
  const before=await call('table.look',{focus:'npc',name:'Walter Corbitt'});
  assert.equal(before.weaknesses.length,2); assert.equal(before.weaknesses[0].learned_by.found,0);
  const partyDir=join(game.workspace,'.coc/campaigns/table/party');
  const sheet=JSON.parse(await readFile(join(partyDir,(await readdir(partyDir)).find(name=>name.endsWith('.json'))),'utf8'));
  const fixture=join(game.workspace,'source-items');await cp(join(root,'mods/enhanced-items'),fixture,{recursive:true});
  const manifest=JSON.parse(await readFile(join(fixture,'mod.json'),'utf8'));
  manifest.id='source-weakness-items'; manifest.requires=[...new Set([...manifest.requires,'audit.continuity.v1'])];
  manifest.contributes={materializer:'creator.md',auditor:'auditor.md'};
  await writeFile(join(fixture,'mod.json'),JSON.stringify(manifest));
  await call('mods.install',{path:fixture}); await call('mods.configure',{id:manifest.id,version:manifest.version,enabled:true});
  const definition={name:'Retained source blade',category:'item',description:'A sharp retained blade.',basis:'Controlled exact source fixture; no author model.',
    parameters:{charges:null,effects:[]},player_view:{description:'A blade.',fields:[]}};
  const job=await call('mods.job',{role:'create',input:{name:definition.name,category:'item',description:definition.description}});
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(definition));
  const accepted=await call('mods.accept',{job:job.job});
  for(const [i,to]of ['boston-globe','neighborhood','roxbury-sanitarium'].entries())
    await call('table.apply',{call_id:`t1-c${i+1}`,effects:[{kind:'move',to,travel_minutes:0}]});
  await call('table.apply',{call_id:'t1-c4',effects:[
    {kind:'define',name:definition.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
    {kind:'object',name:'Renamed retained source blade',definition:definition.name,source_object:'floating-dagger',to:sheet.name},
    {kind:'clue',clue:'vittorio-own-weapon',how:'Read the retained authored clue.'}]});
  const after=await call('table.look',{focus:'npc',name:'Walter Corbitt'});
  assert.equal(after.weaknesses[0].needs[0].held_by,sheet.name);
  assert.equal(after.weaknesses[0].learned_by.found,1);
  const player=await call('table.view');
  assert.ok(!JSON.stringify(player).includes(upgrade.entries[0].weaknesses[1].book),'Keeper sunlight text is not player knowledge');
  assert.equal(node(await game.store.readGraph(id),'npc-walter-corbitt').properties.weaknesses.length,2);
  await evidence('discovery-ownership',{no_model_calls:true,before,after,player,renamed_source_holder:sheet.name,clue_discovery_progress:[0,1],
    sunlight_not_discovered:true,no_executable_rule_created:true});
});

test('an explicit source identity defeats a same-name object from another source and an ordinary decoy',()=>{
  const preview=api.previewSourceUpgrade({id,generation:1,graph_digest:sha(shippedBytes)},shipped,upgrade,law);
  const graph=new api.ModuleGraph(id,preview.graph,'',api.dossierWith({}, {actor_weaknesses:true}));
  const actor=graph.nodes.get('npc-walter-corbitt'), source=graph.nodes.get('object-floating-dagger');
  const world={objects:{instances:{source:{id:'source',name:'Renamed blade',source_object:{module_id:id,node_id:source.node_id},owner:{kind:'scene',id:'room',name:'Room'}},
    decoy:{id:'decoy',name:source.name,owner:{kind:'investigator',id:'inv',name:'Decoy holder'}},
    other:{id:'other',name:source.name,source_object:{module_id:'another-book',node_id:source.node_id},owner:{kind:'investigator',id:'inv',name:'Other holder'}}}}};
  assert.equal(api.weaknessChain(graph,world,actor).weaknesses[0].needs[0].held_by,undefined);
  world.objects.instances.source.owner={kind:'investigator',id:'inv',name:'Actual holder'};
  assert.equal(api.weaknessChain(graph,world,actor).weaknesses[0].needs[0].held_by,'Actual holder');
  delete world.objects.instances.source; delete world.objects.instances.decoy;
  assert.equal(api.weaknessChain(graph,world,actor,{party:[{name:'Other holder',equipment:[{name:source.name,object_id:'other'}]}]}).weaknesses[0].needs[0].held_by,undefined);
});

test('actual historical published graph copy upgrades exact retained PDF facts; original bytes stay unchanged',async t=>{
  const original=process.env.COC_HISTORICAL_WEAKNESS_GRAPH;
  if(!original){t.skip('Set COC_HISTORICAL_WEAKNESS_GRAPH to the read-only historical graph for local acceptance.');return;}
  const bytes=await readFile(original), originalDigest=sha(bytes), graph=JSON.parse(bytes);
  assert.equal(originalDigest,'060190e75489f66d4b3cc74cf748fdf88106cfc75b19e447e1a83982630eb073');
  assert.equal(node(graph,'npc-walter-corbitt').properties.weaknesses,undefined);
  const game=await kernel(t); await mkdir(game.dir,{recursive:true});
  // Copy the legacy bytes; a current integrity cohort is fixture metadata, never an edit to the old publication.
  const meta={id,source:'pdf',generation:4,status:'installed',graph_digest:originalDigest,title:'Historical graph copy'};
  await writeFile(join(game.dir,'module-graph.json'),bytes);
  await writeFile(join(game.dir,'module-graph-manifest.json'),api.pythonJsonDumps(api.graphManifest(api.parsePythonJson(bytes.toString()),id,4)));
  await game.store.writeModule(meta);
  const artifact=JSON.parse(await readFile(join(content,'starters',id,'weaknesses-upgrades',`${originalDigest}.json`),'utf8'));
  const preview=await game.call('module.source.upgrade',{module_id:id});
  const result=await apply(game,preview);
  assert.equal(result.generation,5);
  assert.deepEqual(node(await game.store.readGraph(id),'npc-walter-corbitt').properties.weaknesses,artifact.entries[0].weaknesses);
  await game.call('module.register',{module_id:id});
  assert.equal((await game.meta()).generation,5,'a same-id bundled starter cannot overwrite the upgraded historical PDF');
  assert.equal((await game.meta()).graph_digest,result.graph_digest);
  assert.equal(sha(await readFile(original)),originalDigest);
  assert.equal(sha(await readFile(join(game.dir,'module-graph.json'))),originalDigest);
  await evidence('historical-copy',{no_model_calls:true,original,original_digest_before:originalDigest,original_digest_after:sha(await readFile(original)),
    source_review:artifact.review,preview,result,legacy_bytes_retained:true,original_not_written:true,same_id_starter_preserved_pdf:true});
});
