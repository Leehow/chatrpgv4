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
  change(root,m=>{m.requires=[...new Set([...m.requires,'mods.package-files.v1'])];m.package_files=['agent.md','sections.json','auditor.md'];});
  const installed=await k.ok('mods.install',{path:root}),frozen=frozenPath(k);
  assert.deepEqual(readdirSync(frozen).sort(),['agent.md','auditor.md','mod.json','sections.json']);assert.ok(!existsSync(join(frozen,'CHANGELOG.md')));
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
  assert.deepEqual(staged.pending['natural-npc'],{id:'natural-npc',version:NEXT,enabled:true,settings:{}});
  await k.table('narrate',{call_id:'t1-c1',text:'We stop here.'});await k.table('player_input',{text:'Continue.'});
  const mods=readJson(modsPath(k)).mods;assert.equal(mods.active['natural-npc'].version,NEXT);assert.deepEqual(mods.active['natural-npc'].settings,{});
  assert.ok(!('natural-npc' in mods.pending));const rows=retirementRows(k);assert.equal(rows.length,1);assert.deepEqual(rows[0].keys,['language_mixing']);assert.equal(rows[0].to,NEXT);
});
