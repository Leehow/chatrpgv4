import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runtimeEntrypoints} from '../../runtime/deployment.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url));
test('compiled profile installation mounts Fast App assets and agent without changing account configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pipicoc-fast-profile-'));
 try {
  const home=join(root,'home'),profile=join(home,'agent');
  await mkdir(join(root,'build/runtime'),{recursive:true});
  await mkdir(join(root,'runtime'),{recursive:true});
  await mkdir(join(root,'node/bin'),{recursive:true});
  await mkdir(profile,{recursive:true});
  await symlink(process.execPath,join(root,'node/bin/node'));
  await writeFile(join(root,'deployment.json'),'{}');
  await cp(join(source,'runtime/deployment.mjs'),join(root,'runtime/deployment.mjs'));
  // The context supplies deployment paths only; the real installer owns every file operation.
  await writeFile(join(root,'build/runtime/host.mjs'),"import {runtimeEntrypoints} from '../../runtime/deployment.mjs'; export function composeRuntimeContext(_owner,{resourceRoot,agentHome}){return {agentHome,entrypoints:runtimeEntrypoints(resourceRoot,'compiled')}}");
  await cp(join(source,'pipicoc'),join(root,'pipicoc'),{recursive:true});
  await cp(join(source,'pipiui-extension.json'),join(root,'pipiui-extension.json'));
  for(const name of ['deepseek','grok-build-oauth','image-gen','rerank','jev','remote-control','openai-fast'])
   await cp(join(source,'extensions',name),join(root,'extensions',name),{recursive:true});
  const entries=runtimeEntrypoints(root,'compiled');
  for(const path of [entries.agent,entries.deepseek,entries.grokBuild,entries.imageGen,entries.rerank,entries.jev,join(root,'build/extensions/openai-fast/agent/index.mjs')]){
   await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'// retained compiled test artifact: '+path+'\n');
  }
  const protectedFiles=['settings.json','auth.json','extensions.json'];
  for(const name of protectedFiles)await writeFile(join(profile,name),JSON.stringify({unchanged:name}));
  const before=await Promise.all(protectedFiles.map(name=>readFile(join(profile,name))));
  const run=()=>spawnSync('/bin/bash',[join(root,'pipicoc/install')],{encoding:'utf8',env:{...process.env,PI_COC_LAYOUT:'compiled',PI_COC_HOME:home,PI_CODING_AGENT_DIR:profile},timeout:30000});
  for(let repeat=0;repeat<2;repeat++){
   const result=run();assert.equal(result.status,0,result.stderr);
   const dest=join(profile,'extensions/openai-fast');
   const manifest=JSON.parse(await readFile(join(dest,'pipiui-extension.json')));
   assert.equal(manifest.id,'openai-fast');assert.equal(manifest.defaultEnabled,true);
   assert.equal(manifest.agent.extension,'agent/index.mjs');
   assert.deepEqual(manifest.app,JSON.parse(await readFile(join(source,'extensions/openai-fast/pipiui-extension.json'))).app);
   for(const file of ['app/control.js','shared/policy.js'])assert.deepEqual(await readFile(join(dest,file)),await readFile(join(source,'extensions/openai-fast',file)));
   assert.deepEqual(await readFile(join(dest,'agent/index.mjs')),await readFile(join(root,'build/extensions/openai-fast/agent/index.mjs')));
   for(let i=0;i<protectedFiles.length;i++)assert.deepEqual(await readFile(join(profile,protectedFiles[i])),before[i]);
  }
 } finally {await rm(root,{recursive:true,force:true});}
});
