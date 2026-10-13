/** Native RPC and disk counterparts of tests/kernel/test_time_until.py. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,writeJson,ROOT,CONTENT_DIR,RpcClient,type Row} from './support.ts';
const clock=async(c:RpcClient)=>(await c.table('capsule')).where.clock;
const receipts=(c:RpcClient)=>readJson(join(campaignDir(c.workspace),'turn.json')).receipts;
const until=(c:RpcClient,id:string,days:number,time:string,extra:Row={})=>c.table('apply',{call_id:id,effects:[{kind:'time',until:{days,time},...extra}]});
const at=(c:RpcClient,id:string,time:string,extra:Row={})=>c.table('apply',{call_id:id,effects:[{kind:'time',until:{time},...extra}]});
let ordinal=10;
async function refused(c:RpcClient,effects:Row[],reason:string){
  const error=await c.tableErr('apply',{call_id:`t1-c${ordinal++}`,effects});
  assert.equal(error.code,'invalid_params');assert.equal(error.details.field,'until');assert.equal(error.details.reason,reason);
  assert.equal((await clock(c)).minutes,0);return error;
}
test('test_until_tomorrow_morning_counts_the_night',async t=>{
 const c=await kernel(t);await openTurn(c);await until(c,'t1-c1',1,'08:00',{why:'Leave and return the next morning.'});
 assert.deepEqual(await clock(c),{minutes:22*60,elapsed:'22 h 0 min',at:'1920-10-13T08:00',day_part:'morning'});
 const r=receipts(c).at(-1);assert.equal(r.kind,'time');assert.equal(r.minutes,22*60);assert.deepEqual(r.until,{days:1,time:'08:00'});
});
test('test_until_later_today',async t=>{const c=await kernel(t);await openTurn(c);await until(c,'t1-c1',0,'18:30');assert.equal((await clock(c)).at,'1920-10-12T18:30');assert.equal((await clock(c)).minutes,8*60+30);});
test('test_until_binds_after_the_batch_s_earlier_time',async t=>{
 const c=await kernel(t);await openTurn(c);await c.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:60},{kind:'time',until:{days:0,time:'12:00'}}]});
 assert.equal((await clock(c)).at,'1920-10-12T12:00');assert.deepEqual(receipts(c).filter((r:Row)=>r.kind==='time').map((r:Row)=>r.minutes),[60,60]);
});
test('test_until_refusals_write_nothing',async t=>{
 const c=await kernel(t);await openTurn(c);
 assert.deepEqual((await refused(c,[{kind:'time',minutes:30,until:{days:0,time:'12:00'}}],'until_conflict')).details.fields,['minutes']);
 assert.deepEqual((await refused(c,[{kind:'time',stated:'anything',until:{days:0,time:'12:00'}}],'until_conflict')).details.fields,['stated']);
 for(const bad of [{days:-1,time:'08:00'},{days:0,time:'8:00'},{days:0,time:'24:00'},{days:.5,time:'08:00'},{days:1}])await refused(c,[{kind:'time',until:bad}],'until_invalid');
 const early=await refused(c,[{kind:'time',until:{days:0,time:'09:00'}}],'until_not_forward');assert.deepEqual(early.details.clock,{at:'1920-10-12T10:00',day_part:'morning'});assert.ok(early.fix.includes('days 1'));
 await refused(c,[{kind:'damage',dice:'1D3',until:{days:0,time:'12:00'}}],'until_none');
});
test('test_days_count_from_the_day_the_turn_began',async t=>{
 const c=await kernel(t);await openTurn(c);await c.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:1050}]});
 assert.equal((await clock(c)).at,'1920-10-13T03:30');await until(c,'t1-c2',1,'10:30');assert.equal((await clock(c)).at,'1920-10-13T10:30');assert.equal(receipts(c).at(-1).minutes,7*60);
});
test('test_the_same_until_again_lands_nothing',async t=>{
 const c=await kernel(t);await openTurn(c);await until(c,'t1-c1',1,'08:00');await until(c,'t1-c2',1,'08:00');
 assert.equal((await clock(c)).at,'1920-10-13T08:00');assert.deepEqual(receipts(c).filter((r:Row)=>r.kind==='time').map((r:Row)=>r.minutes),[22*60,0]);
});
test('test_a_later_turn_counts_from_its_own_day',async t=>{
 const c=await kernel(t);await openTurn(c);await until(c,'t1-c1',1,'10:30');await c.table('narrate',{call_id:'t1-c2',text:'You arrive the next morning.'});await c.table('player_input',{text:'I return the following morning.'});
 await until(c,'t2-c1',1,'08:00');assert.equal((await clock(c)).at,'1920-10-14T08:00');
});
test('test_until_replays_the_journaled_receipt',async t=>{
 const c=await kernel(t);await openTurn(c);const first=await until(c,'t1-c1',1,'08:00'),again=await until(c,'t1-c1',1,'08:00');
 assert.deepEqual(again.receipts,first.receipts);assert.equal(again.replayed,true);assert.equal((await clock(c)).minutes,22*60);
});
test('test_a_night_by_until_heals_like_the_minutes_would',async t=>{
 const c=await kernel(t);await openTurn(c);await c.table('apply',{call_id:'t1-c1',effects:[{kind:'damage',dice:'1D1+3',why:'A fall.'}]});assert.equal((await c.table('look',{focus:'investigator'})).hp,8);
 const rested=await until(c,'t1-c2',1,'08:00');assert.equal((await c.table('look',{focus:'investigator'})).hp,9);assert.deepEqual(rested.recovered.filter((r:Row)=>r.resource==='hp').map((r:Row)=>r.after),[9]);
});
test('test_an_undated_clock_binds_the_same_way',async t=>{
 const dir=mkdtempSync(join(ROOT,'.tmp/time-undated-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const content=join(dir,'content');cpSync(CONTENT_DIR,content,{recursive:true});
 function undate(value:any):void{if(Array.isArray(value))value.forEach(undate);else if(value&&typeof value==='object'){delete value.start_clock;delete value.start_time;Object.values(value).forEach(undate);}}
 for(const name of ['module-meta.json','module-graph.json']){const path=join(content,'starters/the-haunting',name);if(existsSync(path)){const data=readJson(path);undate(data);writeJson(path,data);}}
 const c=new RpcClient(join(dir,'ws'),{content});t.after(()=>c.close());await openTurn(c);const before=await clock(c);assert.ok(!('at'in before));assert.deepEqual([before.day,before.hh,before.mm],[1,'09','00']);
 await until(c,'t1-c1',0,'20:00');const after=await clock(c);assert.deepEqual([after.day,after.hh,after.mm,after.day_part],[1,'20','00','evening']);await until(c,'t1-c2',1,'06:15');const next=await clock(c);assert.deepEqual([next.day,next.hh,next.mm],[2,'06','15']);
});
test('test_until_without_days_is_later_today_when_not_yet_past',async t=>{
 const c=await kernel(t);await openTurn(c);await c.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:8*60+1}]});assert.equal((await clock(c)).at,'1920-10-12T18:01');await at(c,'t1-c2','23:30',{why:'Wait outside the library.'});
 assert.equal((await clock(c)).at,'1920-10-12T23:30');const r=receipts(c).at(-1);assert.equal(r.minutes,329);assert.deepEqual(r.until,{days:0,time:'23:30'});
});
test('test_until_without_days_is_the_next_day_when_already_past',async t=>{
 const c=await kernel(t);await openTurn(c);await at(c,'t1-c1','06:00');assert.equal((await clock(c)).at,'1920-10-13T06:00');const r=receipts(c).at(-1);assert.equal(r.minutes,20*60);assert.deepEqual(r.until,{days:1,time:'06:00'});
});
test('test_until_without_days_equal_to_the_clock_lands_nothing',async t=>{const c=await kernel(t);await openTurn(c);await at(c,'t1-c1','10:00');assert.equal((await clock(c)).at,'1920-10-12T10:00');assert.equal(receipts(c).at(-1).minutes,0);});
test('test_until_without_days_counts_from_the_staged_clock_across_midnight',async t=>{
 const c=await kernel(t);await openTurn(c);await c.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:1050}]});assert.equal((await clock(c)).at,'1920-10-13T03:30');await at(c,'t1-c2','10:30');assert.equal((await clock(c)).at,'1920-10-13T10:30');const r=receipts(c).at(-1);assert.equal(r.minutes,7*60);assert.deepEqual(r.until,{days:1,time:'10:30'});
});
test('test_until_without_days_still_refuses_a_bad_time',async t=>{const c=await kernel(t);await openTurn(c);for(const bad of [{time:'8:00'},{time:'24:00'},{days:'1',time:'08:00'},{}])await refused(c,[{kind:'time',until:bad}],'until_invalid');});
