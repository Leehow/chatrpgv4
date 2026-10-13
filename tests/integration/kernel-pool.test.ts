/** Real-process retarget/cache boundaries from tests/kernel/test_kernel_pool.py. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readdirSync,symlinkSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import {ROOT,CONTENT_DIR,RpcClient,readJson,writeJson,createCampaign,openTurn} from './support.ts';
import {KernelPool,pooledClient,type Link} from './kernel-pool.ts';
import {differences,snapshot} from './rpc-evidence.ts';
const PROBE={COC_KERNEL_SEED:'pool-leak-probe'},CONTENT_PROBE={COC_KERNEL_SEED:'pool-content-probe'};
const ACTION={intent:'investigate',goal:'看桌上有什么',method:'用侦查扫一眼'},OTHER={intent:'investigate',goal:'翻看壁炉架',method:'用侦查仔细看'};
function temporary(t:any){const root=mkdtempSync(join(ROOT,'.tmp/pool-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function poolFor(t:any){const pool=new KernelPool();t.after(()=>pool.close());return pool;}
async function play(c:any){await createCampaign(c);await c.table('open');await c.table('narrate',{call_id:'t0-c1',text:'Knott puts the keys on the desk.'});await c.table('player_input',{text:'I observe Knott.'});await c.table('resolve',{call_id:'t1-c1',action:ACTION});await c.table('narrate',{call_id:'t1-c2',text:'His hands shake.'});await c.table('player_input',{text:'I ask why.'});await c.table('look',{focus:'scene'});return c.exchanges.map((r:any)=>r.response);}
async function dirty(c:any){await openTurn(c,'I open the cellar.');await c.table('resolve',{call_id:'t1-c1',action:OTHER});await c.table('narrate',{call_id:'t1-c2',text:'Darkness lies beyond.'});await c.table('player_input',{text:'I light a match.'});await c.table('resolve',{call_id:'t2-c1',action:ACTION});await c.table('look',{focus:'scene'});await c.table('look',{focus:'investigator'});}
test('test_a_reused_process_is_indistinguishable_from_a_fresh_one',async t=>{
 const root=temporary(t),workspace=join(root,'ws'),pool=poolFor(t);const reference=new RpcClient(workspace,{env:PROBE,frozen_clock:true});let expected:any;
 try{assert.equal((reference as any).pooled??false,false);expected=await play(reference);}finally{await reference.close();}const expectedState=snapshot(workspace);rmSync(workspace,{recursive:true});
 const first=await pooledClient(pool,workspace,{env:PROBE});assert.equal(first.pooled,true);await dirty(first);await first.close();const pid=first.proc.pid;rmSync(workspace,{recursive:true});
 const second=await pooledClient(pool,workspace,{env:PROBE});assert.equal(second.pooled,true);assert.equal(second.proc.pid,pid);assert.ok(second.link.generation>=2);const actual=await play(second);await second.close();assert.deepEqual(actual,expected);assert.deepEqual(differences(expectedState,snapshot(workspace)),[]);
});
test('test_a_rewritten_content_file_is_read_again_after_retarget',async t=>{
 const root=temporary(t),content=join(root,'content'),pool=poolFor(t);mkdirSync(content);for(const child of readdirSync(CONTENT_DIR))if(child!=='starters')symlinkSync(join(CONTENT_DIR,child),join(content,child));mkdirSync(join(content,'starters'));cpSync(join(CONTENT_DIR,'starters/the-haunting'),join(content,'starters/the-haunting'),{recursive:true});
 const path=join(content,'starters/the-haunting/pregens/thomas-hayes/character.json');function rename(name:string){const data=readJson(path);data.name=name;writeJson(path,data);}
 async function investigatorName(c:any){await createCampaign(c);return readJson(join(c.workspace,'.coc/campaigns/c1/party/thomas-hayes.json')).name;}
 rename('First name');const first=await pooledClient(pool,join(root,'ws1'),{env:CONTENT_PROBE,content});assert.equal(first.pooled,true);assert.equal(await investigatorName(first),'First name');await first.close();
 rename('Second name');const second=await pooledClient(pool,join(root,'ws2'),{env:CONTENT_PROBE,content});assert.equal(second.proc.pid,first.proc.pid);assert.equal(await investigatorName(second),'Second name');await second.close();
});
test('test_retarget_refuses_a_bad_target_and_keeps_serving',async t=>{
 const root=temporary(t),pool=poolFor(t),c=await pooledClient(pool,join(root,'ws'),{env:PROBE});assert.equal(c.pooled,true);await createCampaign(c as any);
 let error=await c.err('kernel.retarget',{workspace:join(root,'elsewhere'),content:join(root,'no-content')});assert.equal(error.code,'invalid_params');assert.ok(error.message.includes('rulesets/coc7'));
 error=await c.err('kernel.retarget',{workspace:'',content:CONTENT_DIR});assert.equal(error.code,'invalid_params');assert.deepEqual((await c.ok('campaign.list')).campaigns.map((r:any)=>r.id),['c1']);await c.close();
});
test('test_a_plain_process_refuses_to_retarget',async t=>{const root=temporary(t),c=new RpcClient(join(root,'ws'));t.after(()=>c.close());const error=await c.err('kernel.retarget',{workspace:join(root,'other'),content:CONTENT_DIR});assert.equal(error.code,'not_implemented');assert.equal(error.next,'stop');assert.deepEqual((await c.ok('kernel.hello')).content.rulesets,['coc7']);});
test('test_a_dead_or_wedged_process_is_not_handed_to_the_next_test',async t=>{const root=temporary(t),pool=poolFor(t),killed=await pooledClient(pool,join(root,'a'),{env:CONTENT_PROBE});assert.equal(killed.pooled,true);const exited=once(killed.proc,'exit');killed.proc.kill('SIGKILL');await exited;await killed.close();const replacement=await pooledClient(pool,join(root,'b'),{env:CONTENT_PROBE});assert.notEqual(replacement.proc.pid,killed.proc.pid);assert.ok((await replacement.ok('kernel.hello')).kernel_version);await replacement.close();});
test('test_fresh_clients_and_foreign_commands_spawn_their_own_process',async t=>{const root=temporary(t),one=new RpcClient(join(root,'a')),two=new RpcClient(join(root,'b'));assert.equal((one as any).pooled??false,false);assert.equal((two as any).pooled??false,false);assert.notEqual(one.proc.pid,two.proc.pid);await one.close();await two.close();assert.equal(one.proc.exitCode,0);assert.equal(two.proc.exitCode,0);});
test('test_evict_survives_an_emptied_idle_list',async()=>{
 const pool=new KernelPool(),fake=(at:number)=>({parkedAt:at,terminate:async()=>{}} as Link);pool.idle.set('a:1',[]);for(let n=0;n<4;n++)pool.idle.set(`k:${n}`,[fake(n*10),fake(n*10+1)]);await pool.evict();assert.equal(pool.idle.has('a:1'),false);assert.equal([...pool.idle.values()].reduce((n,a)=>n+a.length,0),pool.IDLE_TOTAL);assert.equal(pool.stats.evicted,2);
});

test('malformed transport cannot return a live process to the reusable pool',async t=>{
 const root=temporary(t),pool=poolFor(t),client=new RpcClient(join(root,'broken'),{command:[process.execPath,'-e','process.stdin.on("data",()=>console.log("not-json"))','--']});
 const pid=client.proc.pid;
 await assert.rejects(()=>client.raw('{}'),/Invalid JSONL response/);
 await pool.release({client,key:'bad-transport',parking:join(root,'parking'),content:CONTENT_DIR,generation:0,parkedAt:0,terminate:()=>client.close()});
 assert.notEqual(client.proc.exitCode,null);
 const next=await pool.acquire(join(root,'next'));assert.notEqual(next.client.proc.pid,pid);await createCampaign(next.client);assert.ok(Array.isArray((await next.client.table('status')).receipts));await pool.release(next);
});
