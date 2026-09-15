import assert from 'node:assert/strict';
import {after} from 'node:test';
import {cp, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

export const root=resolve(import.meta.dirname,'../..'), temporary=await mkdtemp(join(tmpdir(),'object-usages-rpc-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await symlink(join(root,'node_modules'),join(temporary,'node_modules'),'dir');
await build({stdin:{contents:"export * from './kernel-ts/testing/api.ts'; export {CONTINUITY_AUDIT} from './kernel-ts/mods/audit-result.ts';",resolveDir:root,sourcefile:'usage-rpc-api.ts'},outfile:join(temporary,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node22',logLevel:'silent'});
export const api=await import(pathToFileURL(join(temporary,'api.mjs')).href);
const fixture=join(temporary,'package');
await cp(join(root,'mods/enhanced-items'),fixture,{recursive:true});
const manifest=JSON.parse(await readFile(join(fixture,'mod.json'),'utf8'));
manifest.id='usage-fixture'; manifest.version='1.0.0'; manifest.requires=[...new Set([...manifest.requires,'objects.usages.v1',api.CONTINUITY_AUDIT])];
manifest.contributes={materializer:'creator.md',auditor:'auditor.md'};
await writeFile(join(fixture,'mod.json'),JSON.stringify(manifest));
export const usage=(name='swing',mode='melee')=>({name,description:'Swing the retained wooden chair.',basis:'The recorded solid wooden frame.',mode,
  parameters:{skill:mode==='thrown'?'Throw':'Fighting (Brawl)',damage:'1D6',base_range_yards:mode==='thrown'?5:null,
    uses_per_round:1,magazine:null,malfunction:null,impale:false,adds_damage_bonus:true},player_view:{description:'A wooden chair used to strike.',fields:['skill','damage']}});
export async function table(t) {
  const home=await mkdtemp(join(temporary,'home-'));
  const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'usage-rpc',locks:api.createAdvisoryLocks(async()=>{}),
    env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(context); t.after(()=>runtime.close());
  const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
  await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  await call('mods.install',{path:fixture});
  await call('mods.configure',{id:manifest.id,version:manifest.version,enabled:true});
  await call('table.open');
  const directory=join(home,'.coc/campaigns/c1'), party=join(directory,'party'), file=(await readdir(party)).find(name=>name.endsWith('.json'));
  const sheetPath=join(party,file), sheet=JSON.parse(await readFile(sheetPath,'utf8'));
  const job=await call('mods.job',{role:'create',input:{name:'Chair frame',category:'item',description:'A solid wooden chair.'}});
  assert.equal(job.enabled,true);
  const definition={name:'Chair frame',category:'item',description:'A solid wooden chair.',basis:'Present in this contract fixture.',
    parameters:{charges:null,effects:[]},player_view:{description:'A solid wooden chair.',fields:[]}};
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(definition));
  const accepted=await call('mods.accept',{job:job.job});
  await call('table.apply',{call_id:'t0-c1',effects:[{kind:'define',name:definition.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
    {kind:'object',name:'Study chair',definition:definition.name,to:sheet.name}]});
  await call('table.narrate',{call_id:'t0-c2',text:'Knott is waiting. The solid wooden chair is in your hands.'});
  await call('table.player_input',{text:'I swing the chair at Knott.'});
  let ordinal=1;
  const apply=effects=>call('table.apply',{call_id:`t1-c${ordinal++}`,effects});
  const prepare=async(value=usage())=>{
    const input={object:'Study chair',name:value.name,description:value.description};
    const job=await call('mods.job',{role:'usage',input}); assert.equal(job.enabled,true);
    if(!job.accepted) await writeFile(join(job.cwd,'result.json'),JSON.stringify(value));
    const accepted=await call('mods.accept',{job:job.job});
    return {job,accepted,effect:{kind:'usage',...input,_usage:accepted}};
  };
  return {home,context,directory,sheetPath,sheet,call,apply,prepare,next:()=>`t1-c${ordinal++}`,
    world:async()=>JSON.parse(await readFile(join(directory,'world.json'),'utf8'))};
}
