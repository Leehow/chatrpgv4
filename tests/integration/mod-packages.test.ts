/** Version lifecycle counterparts of tests/kernel/test_mod_packages.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {crc32} from 'node:zlib';
import {kernel,ROOT,CAMPAIGN,campaignDir,readJson,readJsonl,writeJson,openTurn,type RpcClient,type Row} from './support.ts';

const SHIPPED=readJson(join(ROOT,'mods/natural-npc/mod.json')).version;
const [major,minor]=SHIPPED.split('.').map(Number),NEXT=`${major}.${minor+1}.0`;
function packageAt(k:RpcClient,{version=NEXT,state_version=1,migrations}:Row={}){
  const root=join(k.workspace,`package-${version}`);cpSync(join(ROOT,'mods/natural-npc'),root,{recursive:true});
  const manifest=readJson(join(root,'mod.json'));Object.assign(manifest,{version,state_version});
  if(migrations!==undefined)manifest.migrations=migrations;
  writeJson(join(root,'mod.json'),manifest);return root;
}
function change(root:string,edit:(manifest:Row)=>void){const path=join(root,'mod.json'),manifest=readJson(path);edit(manifest);writeJson(path,manifest);}
const modsPath=(k:RpcClient)=>join(campaignDir(k.workspace),'world.json');
const frozenPath=(k:RpcClient)=>join(k.workspace,'.coc/mods/packages/natural-npc',NEXT);
const stop=async(k:RpcClient)=>{await openTurn(k);await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});};
const retirementRows=(k:RpcClient)=>readJsonl(join(campaignDir(k.workspace),'telemetry.jsonl')).filter(row=>row.lane==='mods');
function retainedState(k:RpcClient){
  const world=readJson(modsPath(k));world.mods.state['natural-npc']={retained:{turns:[1,2]}};
  writeJson(modsPath(k),world);return world.mods;
}

// One stored ZIP entry, including its central directory, lets the real importer inspect a hostile name.
function storedZip(name:string,body:string){
  const filename=Buffer.from(name),data=Buffer.from(body),checksum=crc32(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
  local.writeUInt32LE(checksum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(checksum,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);
  const offset=local.length+filename.length+data.length,size=central.length+filename.length,end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([local,filename,data,central,filename,end]);
}

test('test_install_does_not_upgrade_save_and_missing_migration_retains_old_lock',async t=>{
  const k=await kernel(t);await stop(k);const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
  const before=readJson(modsPath(k)).mods;assert.equal(before.active['natural-npc'].version,SHIPPED);
  assert.equal((await k.err('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT})).code,'invalid_params');
  assert.deepEqual(readJson(modsPath(k)).mods,before);
});

test('test_explicit_migration_runs_once_and_old_package_stays_available',async t=>{
  const k=await kernel(t);await stop(k);
  const root=packageAt(k,{state_version:2,migrations:[{from:1,to:2,operations:[{op:'default',key:'migration_note',value:'retained'}]}]});
  await k.ok('mods.install',{path:root});const args={campaign:CAMPAIGN,id:'natural-npc',version:NEXT};
  await k.ok('mods.configure',args);await k.ok('mods.configure',args);const world=readJson(modsPath(k));
  assert.equal(world.mods.state['natural-npc'].migration_note,'retained');assert.equal(world.mods.active['natural-npc'].state_version,2);
  assert.ok(existsSync(join(k.workspace,'.coc/mods/packages/natural-npc',SHIPPED,'mod.json')));
});

test('test_import_rejects_escaping_archive_and_different_bytes_for_a_version',async t=>{
  const k=await kernel(t),bad=join(k.workspace,'bad.zip');writeFileSync(bad,storedZip('../escape.json','{}'));
  assert.equal((await k.err('mods.install',{path:bad})).code,'invalid_params');assert.ok(!existsSync(join(k.workspace,'escape.json')));
  const root=packageAt(k);await k.ok('mods.install',{path:root});writeFileSync(join(root,'agent.md'),'Changed bytes under the same version');
  assert.equal((await k.err('mods.install',{path:root})).code,'invalid_params');
});

test('test_incompatible_mod_is_listed_but_not_activated',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k);change(root,m=>m.requires.push('unsupported.future.v1'));
  await k.ok('mods.install',{path:root});const view=await k.ok('mods.list',{campaign:CAMPAIGN});
  assert.equal(view.mods.find((row:Row)=>row.id==='natural-npc'&&row.version===NEXT).compatible,false);
  assert.equal((await k.err('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT})).code,'invalid_params');
});

test('test_future_contributions_do_not_break_the_current_catalog',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k);
  change(root,m=>{m.requires.push('future.renderer.v2');m.contributes={future_renderer:{entry:'unknown-to-this-kernel'}};m.settings={future_setting:{complex:true}};});
  await k.ok('mods.install',{path:root});const view=await k.ok('mods.list',{campaign:CAMPAIGN});
  const future=view.mods.find((row:Row)=>row.id==='natural-npc'&&row.version===NEXT);
  assert.equal(future.compatible,false);assert.deepEqual(future.settings,{});assert.ok((await k.ok('mods.context',{campaign:CAMPAIGN})).active.length);
});

test('test_mod_list_never_projects_engineering_changelogs',async t=>{
  const k=await kernel(t),view=await k.ok('mods.list');assert.ok(view.mods.length);
  assert.ok(view.mods.every((row:Row)=>!('changelog' in row)));
});

test('test_scoped_package_freezes_only_declared_runtime_files',async t=>{
  const k=await kernel(t),root=packageAt(k);
  change(root,m=>{m.requires=[...new Set([...m.requires,'mods.package-files.v1'])];m.package_files=['agent.md','sections.json','auditor.md','character-tables.json'];});
  const installed=await k.ok('mods.install',{path:root}),frozen=frozenPath(k);
  assert.deepEqual(readdirSync(frozen).sort(),['agent.md','auditor.md','character-tables.json','mod.json','sections.json']);assert.ok(!existsSync(join(frozen,'CHANGELOG.md')));
  writeFileSync(join(root,'CHANGELOG.md'),'Engineering note from another acceptance run.\n');
  assert.deepEqual(await k.ok('mods.install',{path:root}),{id:'natural-npc',version:NEXT,reused:true});assert.equal(installed.digest.length,64);
});

test('test_legacy_all_files_package_keeps_its_historical_digest_and_lock',async t=>{
  const k=await kernel(t);await stop(k);const root=packageAt(k);
  change(root,m=>{m.requires=m.requires.filter((name:string)=>name!=='mods.package-files.v1');delete m.package_files;});
  const installed=await k.ok('mods.install',{path:root});assert.ok(existsSync(join(frozenPath(k),'CHANGELOG.md')));
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT});
  const active=(await k.ok('mods.list',{campaign:CAMPAIGN})).mods.find((row:Row)=>row.id==='natural-npc'&&row.version===NEXT).active;
  assert.equal(active.digest,installed.digest);assert.ok((await k.ok('mods.context',{campaign:CAMPAIGN})).active.length);
});

test('test_scoped_package_refuses_an_incomplete_or_engineering_allowlist',async t=>{
  const k=await kernel(t),root=packageAt(k);change(root,m=>{m.package_files=['agent.md','sections.json','CHANGELOG.md'];});
  let error=await k.err('mods.install',{path:root});assert.equal(error.code,'invalid_params');assert.ok(error.message.includes('CHANGELOG.md'));
  change(root,m=>{m.package_files=['agent.md','sections.json'];});
  error=await k.err('mods.install',{path:root});assert.equal(error.code,'invalid_params');assert.ok(error.message.includes('contributes.auditor'));
});

test('test_declared_setting_is_editable_and_invalid_option_is_atomic',async t=>{
  const k=await kernel(t);await stop(k);const root=packageAt(k);
  change(root,m=>{m.settings={tone:'balanced'};m.settings_schema={tone:{enum:['balanced','restrained']}};});
  await k.ok('mods.install',{path:root});const args={campaign:CAMPAIGN,id:'natural-npc',version:NEXT,settings:{tone:'restrained'}};
  await k.ok('mods.configure',args);const before=readJson(modsPath(k));assert.deepEqual(before.mods.active['natural-npc'].settings,{tone:'restrained'});
  assert.equal((await k.err('mods.configure',{...args,settings:{tone:'invalid'}})).code,'invalid_params');assert.deepEqual(readJson(modsPath(k)),before);
});

test('test_a_version_that_dropped_a_setting_is_reached_with_version_only_and_the_retired_keys_are_recorded',async t=>{
  const k=await kernel(t);await stop(k);const root=packageAt(k);change(root,m=>{m.settings={};m.settings_schema={};});
  await k.ok('mods.install',{path:root});const before=readJson(modsPath(k)).mods;
  assert.equal(before.active['natural-npc'].version,SHIPPED);assert.deepEqual(before.active['natural-npc'].settings,{language_mixing:'light'});
  assert.equal((await k.err('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT,settings:{language_mixing:'light'}})).code,'invalid_params');
  assert.deepEqual(readJson(modsPath(k)).mods,before);await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT});
  const lock=readJson(modsPath(k)).mods.active['natural-npc'];assert.equal(lock.version,NEXT);assert.deepEqual(lock.settings,{});
  assert.deepEqual(retirementRows(k).map(({at,...row})=>row),[{lane:'mods',event:'settings_retired',mod:'natural-npc',from:SHIPPED,to:NEXT,keys:['language_mixing']}]);
  const row=(await k.table('capsule')).mods.instructions.find((entry:Row)=>entry.mod==='natural-npc');assert.equal(row.version,NEXT);assert.deepEqual(row.settings,{});
});

test('test_a_retiring_upgrade_staged_during_a_busy_turn_lands_at_the_safe_boundary',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k);change(root,m=>{m.settings={};m.settings_schema={};});
  await k.ok('mods.install',{path:root});await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT});
  const staged=readJson(modsPath(k)).mods;assert.equal(staged.active['natural-npc'].version,SHIPPED);
  assert.deepEqual(staged.pending['natural-npc'],{id:'natural-npc',version:NEXT,enabled:true,settings:{},version_policy:'pinned'});
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
  const mods=readJson(modsPath(k)).mods;assert.equal(mods.active['natural-npc'].version,NEXT);assert.deepEqual(mods.active['natural-npc'].settings,{});
  assert.ok(!('natural-npc' in mods.pending));const rows=retirementRows(k);assert.equal(rows.length,1);assert.deepEqual(rows[0].keys,['language_mixing']);assert.equal(rows[0].to,NEXT);
});

test('latest follows installed packages at idle boundaries, while concrete selection stays pinned',async t=>{
  const k=await kernel(t);await stop(k);const root=packageAt(k);await k.ok('mods.install',{path:root});
  await k.table('open');
  let lock=readJson(modsPath(k)).mods.active['natural-npc'];assert.equal(lock.version,NEXT);assert.equal(lock.version_policy,undefined);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:SHIPPED});
  await k.table('open');lock=readJson(modsPath(k)).mods.active['natural-npc'];
  assert.equal(lock.version,SHIPPED);assert.equal(lock.version_policy,'pinned');
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',enabled:false});
  lock=readJson(modsPath(k)).mods.active['natural-npc'];assert.equal(lock.version,SHIPPED);assert.equal(lock.version_policy,'pinned');
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  lock=readJson(modsPath(k)).mods.active['natural-npc'];assert.equal(lock.version,NEXT);assert.equal(lock.version_policy,undefined);assert.equal(lock.enabled,false);
  const rows=(await k.ok('mods.list',{campaign:CAMPAIGN})).mods.filter((r:Row)=>r.id==='natural-npc');
  assert.deepEqual(rows.map((r:Row)=>[r.version,r.latest,r.version_policy]),[[SHIPPED,false,'latest'],[NEXT,true,'latest']]);
});

test('automatic upgrades wait for the next idle input and do not turn replayed latest into a pin',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k);await k.ok('mods.install',{path:root,campaign:CAMPAIGN});
  await k.table('open');assert.equal(readJson(modsPath(k)).mods.active['natural-npc'].version,SHIPPED);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  assert.equal(readJson(modsPath(k)).mods.pending['natural-npc'].version_policy,'latest');
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
  const mods=readJson(modsPath(k)).mods;assert.equal(mods.active['natural-npc'].version,NEXT);
  assert.equal(mods.active['natural-npc'].version_policy,undefined);assert.equal(mods.pending['natural-npc'],undefined);
});

test('an installed update follows automatically after delivery and an explicit queued pin takes precedence',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k);await k.ok('mods.install',{path:root,campaign:CAMPAIGN});
  assert.equal(readJson(modsPath(k)).mods.active['natural-npc'].version,SHIPPED);
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
  assert.equal(readJson(modsPath(k)).mods.active['natural-npc'].version,NEXT);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:SHIPPED});
  const newest=packageAt(k,{version:`${major}.${minor+2}.0`});await k.ok('mods.install',{path:newest,campaign:CAMPAIGN});
  await k.table('narrate',{call_id:'t2-c1',text:'We stop again.'});await k.table('player_input',{text:'Continue.'});
  const lock=readJson(modsPath(k)).mods.active['natural-npc'];assert.equal(lock.version,SHIPPED);assert.equal(lock.version_policy,'pinned');
});

test('following skips a newer incompatible package and preserves custom settings and enablement',async t=>{
  const k=await kernel(t);await stop(k);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',enabled:false,settings:{language_mixing:'off'}});
  const root=packageAt(k);await k.ok('mods.install',{path:root});
  const incompatible=packageAt(k,{version:`${major}.${minor+2}.0`});change(incompatible,m=>m.requires.push('unsupported.future.v1'));
  await k.ok('mods.install',{path:incompatible});await k.table('open');
  const lock=readJson(modsPath(k)).mods.active['natural-npc'];assert.equal(lock.version,NEXT);assert.equal(lock.enabled,false);
  assert.deepEqual(lock.settings,{language_mixing:'off'});
});

test('automatic migration refusal preserves play and reports its target without repeated diagnostics',async t=>{
  const k=await kernel(t);await stop(k);const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
  const before=readJson(modsPath(k)).mods;await k.table('open');await k.table('open');
  const mods=readJson(modsPath(k)).mods;assert.deepEqual(mods.active,before.active);assert.deepEqual(mods.state,before.state);
  assert.equal(mods.update_errors['natural-npc'].version,NEXT);
  const entry=(await k.ok('mods.list',{campaign:CAMPAIGN})).mods.find((r:Row)=>r.id==='natural-npc');
  assert.match(entry.update_error.message,/No state migration/);
  assert.equal(retirementRows(k).filter(r=>r.event==='automatic_update_refused').length,1);
});

test('a queued return to latest keeps play available when its upgrade cannot migrate',async t=>{
  const k=await kernel(t);await stop(k);await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:SHIPPED});
  await k.table('player_input',{text:'Continue.'});const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  await k.table('narrate',{call_id:'t2-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
  const mods=readJson(modsPath(k)).mods;assert.equal(mods.active['natural-npc'].version,SHIPPED);
  assert.equal(mods.active['natural-npc'].version_policy,undefined);assert.equal(mods.pending['natural-npc'],undefined);
  assert.equal(mods.update_errors['natural-npc'].version,NEXT);
});

test('an idle return to latest releases the pin even when the resolved upgrade is refused',async t=>{
  const k=await kernel(t);await stop(k);await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:SHIPPED});
  const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
  const view=await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  const entry=view.mods.find((r:Row)=>r.id==='natural-npc');assert.equal(entry.version_policy,'latest');
  assert.equal(entry.active.version,SHIPPED);assert.equal(entry.active.version_policy,undefined);assert.equal(entry.update_error.version,NEXT);
  await k.table('open');assert.equal(readJson(modsPath(k)).mods.active['natural-npc'].version,SHIPPED);
  assert.equal(retirementRows(k).filter(r=>r.event==='automatic_update_refused').length,1);
});

test('pinning the already current version prevents a later automatic update across a restart',async t=>{
  const k=await kernel(t);await stop(k);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:SHIPPED});
  const root=packageAt(k);await k.ok('mods.install',{path:root,campaign:CAMPAIGN});await k.table('open');
  assert.equal(readJson(modsPath(k)).mods.active['natural-npc'].version,SHIPPED);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  const nextRoot=packageAt(k,{version:`${major}.${minor+2}.0`});await k.ok('mods.install',{path:nextRoot});
  const {RpcClient}=await import('./support.ts');const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  await restarted.table('open');assert.equal(readJson(modsPath(k)).mods.active['natural-npc'].version,`${major}.${minor+2}.0`);
});

for(const explicitLatest of [false,true]){
  const selection=explicitLatest?{version:'latest'}:{};
  test(`floating controls remain editable when an installed upgrade cannot migrate (${explicitLatest?'explicit latest':'retained policy'})`,async t=>{
    const k=await kernel(t);await stop(k);const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
    const before=retainedState(k);
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',...selection,enabled:false});
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',...selection,settings:{language_mixing:'off'}});
    let mods=readJson(modsPath(k)).mods,lock=mods.active['natural-npc'];
    assert.equal(lock.version,SHIPPED);assert.equal(lock.enabled,false);assert.equal(lock.version_policy,undefined);
    assert.equal(lock.state_version,before.active['natural-npc'].state_version);
    assert.deepEqual(lock.settings,{language_mixing:'off'});assert.deepEqual(mods.state,before.state);
    await k.table('open');mods=readJson(modsPath(k)).mods;lock=mods.active['natural-npc'];
    assert.equal(lock.version,SHIPPED);assert.equal(lock.enabled,false);assert.deepEqual(lock.settings,{language_mixing:'off'});
    assert.deepEqual(mods.state,before.state);assert.equal(mods.update_errors['natural-npc'].version,NEXT);
    const entry=(await k.ok('mods.list',{campaign:CAMPAIGN})).mods.find((r:Row)=>r.id==='natural-npc');
    assert.equal(entry.version_policy,'latest');assert.match(entry.update_error.message,/No state migration/);
  });

  test(`floating controls queued during play survive a refused upgrade (${explicitLatest?'explicit latest':'retained policy'})`,async t=>{
    const k=await kernel(t);await openTurn(k);const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
    const before=retainedState(k);
    await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',...selection,enabled:false,settings:{language_mixing:'off'}});
    const pending=readJson(modsPath(k)).mods.pending['natural-npc'];
    assert.equal(pending.version,SHIPPED);assert.equal(pending.enabled,false);assert.equal(pending.version_policy,'latest');
    assert.deepEqual(pending.settings,{language_mixing:'off'});
    assert.deepEqual(pending.requested_controls,{enabled:false,settings:{language_mixing:'off'}});
    await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
    const mods=readJson(modsPath(k)).mods,lock=mods.active['natural-npc'];
    assert.equal(lock.version,SHIPPED);assert.equal(lock.enabled,false);assert.equal(lock.version_policy,undefined);
    assert.deepEqual(lock.settings,{language_mixing:'off'});assert.deepEqual(mods.state,before.state);
    assert.equal(mods.pending['natural-npc'],undefined);assert.equal(mods.update_errors['natural-npc'].version,NEXT);
  });
}

test('a version-only floating replay ignores target defaults when its upgrade cannot migrate',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k,{state_version:2});
  change(root,m=>{m.settings={tone:'balanced'};m.settings_schema={tone:{enum:['balanced','restrained']}};});
  await k.ok('mods.install',{path:root});retainedState(k);await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});
  const before=readJson(modsPath(k)).mods;
  assert.deepEqual(before.pending['natural-npc'].requested_controls,{});
  await k.table('player_input',{text:'Continue.'});
  const after=readJson(modsPath(k)).mods;
  assert.equal(after.pending['natural-npc'],undefined);assert.deepEqual(after.active,before.active);assert.deepEqual(after.state,before.state);
  assert.equal(after.update_errors['natural-npc'].version,NEXT);
});

test('a legacy floating user-settings replay preserves its request when the actual package rejects it',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k,{state_version:2});
  change(root,m=>{m.settings={tone:'balanced'};m.settings_schema={tone:{enum:['balanced','restrained']}};});
  await k.ok('mods.install',{path:root});await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest'});
  // Older runtimes admitted these user settings against the target and stored no control provenance.
  const world=readJson(modsPath(k));delete world.mods.pending['natural-npc'].requested_controls;
  world.mods.pending['natural-npc'].settings={tone:'restrained'};writeJson(modsPath(k),world);
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});
  const before=readJson(modsPath(k)).mods;
  const error=await k.tableErr('player_input',{text:'Continue.'});assert.equal(error.code,'invalid_params');
  const after=readJson(modsPath(k)).mods;
  assert.deepEqual(after.pending,before.pending);assert.deepEqual(after.active,before.active);assert.deepEqual(after.state,before.state);
});

test('a previously saved floating control request lands on the actual package after its upgrade fails',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
  retainedState(k);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'latest',enabled:false,settings:{language_mixing:'off'}});
  // Prior builds resolved controls to the new version before persisting this same queue shape.
  const world=readJson(modsPath(k));world.mods.pending['natural-npc'].version=NEXT;
  delete world.mods.pending['natural-npc'].requested_controls;writeJson(modsPath(k),world);
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
  const mods=readJson(modsPath(k)).mods,lock=mods.active['natural-npc'];
  assert.equal(lock.version,SHIPPED);assert.equal(lock.enabled,false);assert.equal(lock.version_policy,undefined);
  assert.deepEqual(lock.settings,{language_mixing:'off'});assert.deepEqual(mods.state,world.mods.state);
  assert.equal(mods.pending['natural-npc'],undefined);assert.equal(mods.update_errors['natural-npc'].version,NEXT);
});

test('a concrete queued version keeps its exact request when migration fails',async t=>{
  const k=await kernel(t);await openTurn(k);const root=packageAt(k,{state_version:2});await k.ok('mods.install',{path:root});
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:NEXT,enabled:false});
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});
  const before=readJson(modsPath(k)).mods;
  assert.equal(before.pending['natural-npc'].version_policy,'pinned');
  const error=await k.tableErr('player_input',{text:'Continue.'});assert.match(error.message,/No state migration/);
  const after=readJson(modsPath(k)).mods;
  assert.deepEqual(after.pending,before.pending);assert.deepEqual(after.active,before.active);assert.deepEqual(after.state,before.state);
});
