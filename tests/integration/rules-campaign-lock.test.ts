/** Per-campaign production handler guard, actual POSIX flock and bounded refusal. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {native,CONTENT_DIR} from './rules-engine-support.ts';
import {temporaryPath} from './npc-support.ts';
const fsExt=createRequire(import.meta.url)('fs-ext');
async function campaign(t:any){const workspace=String(temporaryPath(t)),locks=native.createAdvisoryLocks((fd:number,op:string)=>new Promise<void>((r,j)=>fsExt.flock(fd,op,(e:any)=>e?j(e):r()))),context=await native.createKernelContext({workspace,content:CONTENT_DIR,locks,campaignLockTimeoutMs:150});const folder=join(context.campaignsRoot,'held');mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'campaign.json'),'{}');let calls=0;const guard=native.assembleHandlers(context,{'table.status':async()=>{calls++;return {entered:true};}})['table.status'];return {context,guard,calls:()=>calls};}
test('test_uncontended_campaign_lock_still_serializes',async t=>{const c=await campaign(t);assert.deepEqual(await c.guard({campaign:'held'}),{entered:true});assert.deepEqual(await c.guard({campaign:'absent'}),{entered:true});assert.deepEqual(await c.guard({}),{entered:true});assert.equal(c.calls(),3);});
test('test_a_held_campaign_is_refused_by_name_instead_of_waiting_without_end',async t=>{const c=await campaign(t),dir=join(c.context.stateRoot,'locks');mkdirSync(dir,{recursive:true});const fd=openSync(join(dir,'held.lock'),'a+');fsExt.flockSync(fd,'ex');let error:any;const started=performance.now();try{await assert.rejects(()=>c.guard({campaign:'held'}),(e:any)=>{error=e;return true;});assert.ok((performance.now()-started)/1000>=.15,'The guard waits for its deadline before refusing');assert.equal(c.calls(),0,'The guarded handler must not enter a campaign another process holds');}finally{fsExt.flockSync(fd,'un');closeSync(fd);}assert.equal(error.code,'internal');assert.deepEqual(error.details,{reason:'campaign_locked',campaign:'held'});assert.ok(error.message.includes('held'));assert.ok(error.fix);assert.deepEqual(await c.guard({campaign:'held'}),{entered:true});assert.equal(c.calls(),1);});
