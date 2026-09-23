/** §126.3 ordinary item identity lands now; optional definition enrichment stays background-owned. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..');
async function fixture(t){
  await mkdir(join(ROOT,'.tmp'),{recursive:true});const folder=await mkdtemp(join(ROOT,'.tmp/foreground-item-core-')),bundle=join(folder,'api.mjs'),home=join(folder,'home');await mkdir(home);
  await build({stdin:{contents:["export {createKernelContext} from './kernel-ts/context.ts';","export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"].join('\n'),resolveDir:ROOT,sourcefile:'foreground-item-core-entry.ts'},outfile:bundle,
    bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  const api=await import(pathToFileURL(bundle).href),context=await api.createKernelContext({workspace:home,content:join(ROOT,'content'),seed:'foreground-item-core',
    locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context),
    call=(method,params={})=>runtime.handlers[method](params),campaign='c1';
  t.after(async()=>{await runtime.close();await context.git.close();await rm(folder,{recursive:true,force:true});});
  await call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open',{campaign});
  await call('table.narrate',{campaign,call_id:'t0-c1',text:'Knott waits behind his desk.'});await call('table.player_input',{campaign,text:'I accept and take the key.'});
  return{home,campaign,call};
}
const accepted=(name,description)=>({name,category:'item',description,basis:'The accepted request establishes an ordinary item; no unrequested executable effect is inferred.',
  parameters:{charges:null,effects:[]},player_view:{description,fields:[]}});

test('pending ordinary identity is authoritative now and promotes once without replaying the handover',async t=>{
  const f=await fixture(t),define={kind:'define',name:'House key definition',description:'An ordinary iron house key.'},
    object={kind:'object',name:'House key',definition:'House key definition',to:'Thomas Hayes',from:'Steven Knott',handover:'given',why:'Knott hands it over.'},
    plan=await f.call('mods.identity.plan',{campaign:f.campaign,define,object});
  assert.equal(plan.eligible,true);const applied=await f.call('table.apply',{campaign:f.campaign,call_id:'t1-c1',effects:[
    {...define,_queued:plan.job,_provenance:{mod:plan.mod,digest:plan.digest},_identity_defer:true},{...object,_identity_defer:true}]});
  assert(applied.receipts.some(value=>value.startsWith('item:')));let sheet=JSON.parse(await readFile(join(f.home,'.coc/campaigns/c1/party/thomas-hayes.json')));
  const pending=sheet.equipment.find(value=>value?.name==='House key');assert(pending?.pending_definition);
  await assert.rejects(f.call('table.look',{campaign:f.campaign,focus:'object',name:'House key'}),error=>error.details?.reason===undefined&&/parameters are still being prepared/.test(error.message));
  await assert.rejects(f.call('mods.job',{campaign:f.campaign,role:'usage',input:{object:'House key',name:'Turn',description:'Turn the key in a lock.'}}),
    error=>error.details?.reason==='definition_pending');
  await writeFile(join(plan.cwd,'result.json'),JSON.stringify(accepted(define.name,define.description)));await f.call('mods.accept',{campaign:f.campaign,job:plan.job});
  await f.call('table.narrate',{campaign:f.campaign,call_id:'t1-c2',text:'The key is in your pocket.'});await f.call('table.player_input',{campaign:f.campaign,text:'Continue.'});
  assert.equal((await f.call('mods.queued',{campaign:f.campaign})).optional_ready,1);
  const ready=await f.call('mods.queued',{campaign:f.campaign,publish_optional:true});assert.deepEqual(ready.effects.map(value=>value.kind),['define','object']);
  const promoted=await f.call('table.apply',{campaign:f.campaign,call_id:'t2-c1',effects:ready.effects});
  assert(promoted.receipts.every(value=>!value.startsWith('item:')),'promotion does not replay the handover receipt');
  const look=await f.call('table.look',{campaign:f.campaign,focus:'object',name:'House key'});
  assert.equal(look.definition.name,define.name);sheet=JSON.parse(await readFile(join(f.home,'.coc/campaigns/c1/party/thomas-hayes.json')));
  assert(!sheet.equipment.some(value=>value?.pending_definition),'promotion removes the one legacy identity row');
});

test('late accepted definition cannot resurrect a removed pending acquisition',async t=>{
  const f=await fixture(t),define={kind:'define',name:'Returned key definition',description:'An ordinary returned key.'},
    object={kind:'object',name:'Returned key',definition:define.name,to:'Thomas Hayes',why:'A key is handed over.'},plan=await f.call('mods.identity.plan',{campaign:f.campaign,define,object});
  await f.call('table.apply',{campaign:f.campaign,call_id:'t1-c1',effects:[{...define,_queued:plan.job,_provenance:{mod:plan.mod,digest:plan.digest},_identity_defer:true},{...object,_identity_defer:true}]});
  await f.call('table.apply',{campaign:f.campaign,call_id:'t1-c2',effects:[{kind:'item',name:'Returned key',quantity:-1,why:'It is returned before enrichment finishes.'}]});
  await writeFile(join(plan.cwd,'result.json'),JSON.stringify(accepted(define.name,define.description)));await f.call('mods.accept',{campaign:f.campaign,job:plan.job});
  await f.call('table.narrate',{campaign:f.campaign,call_id:'t1-c3',text:'The key has been returned.'});await f.call('table.player_input',{campaign:f.campaign,text:'Continue.'});
  assert.deepEqual(await f.call('mods.queued',{campaign:f.campaign,publish_optional:true}),{effects:[],unfinished:[]});
  await assert.rejects(f.call('table.look',{campaign:f.campaign,focus:'object',name:'Returned key'}));
});
