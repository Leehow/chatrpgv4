/** Native RPC/disk coverage from tests/kernel/test_time_reconciliation.py. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,readJsonl,type RpcClient,type Row} from './support.ts';
const TEXT='You leave as the door closes behind you. You return the next morning; the newspaper room is lit.';
const reading=(overrides:Row={}):Row=>({cut:'next_day',confidence:.98,floor:240,refusable:true,ends_at:'morning',...overrides});
const deliver=(c:RpcClient,id:string,params:Row={})=>c.table('narrate',{call_id:id,text:TEXT,...params});
const record=(c:RpcClient,turn=1)=>readJson(join(campaignDir(c.workspace),'turns',String(turn).padStart(4,'0')+'.json'));
const timeRows=(c:RpcClient)=>readJsonl(join(campaignDir(c.workspace),'telemetry.jsonl')).filter(r=>r.reason==='time_unrecorded');
const warnings=(rec:Row)=>(rec.warnings??[]).filter((r:Row)=>r.kind==='time_unrecorded');
async function gap(c:RpcClient,id:string,params:Row={},turn=1){
 assert.equal((await deliver(c,id,params)).turn,turn);const ws=warnings(record(c,turn));assert.equal(ws.length,1);const rows=timeRows(c).filter(r=>r.call_id===id);assert.equal(rows.length,1);
 const row=rows[0];assert.deepEqual([row.ok,row.outcome,row.lane,row.turn],[true,'delivered','delivery',turn]);return [ws[0],row];
}
const advance=(c:RpcClient,id:string,minutes:number)=>c.table('apply',{call_id:id,effects:[{kind:'time',minutes}]});
test('test_a_skip_with_no_time_is_delivered_with_the_finding_that_names_the_call',async t=>{
 const c=await kernel(t);await openTurn(c);const [w,r]=await gap(c,'t1-c1',{time_reading:reading()});
 assert.equal(w.lane,'delivery');assert.equal(w.quote,null);assert.equal(w.cut,'next_day');assert.equal(w.ends_at,'morning');assert.deepEqual(w.suggest,{until:{days:1,time:'08:00'}});
 assert.ok(w.fix.includes('apply time')&&w.fix.includes('until'));assert.ok(w.why.includes('1920-10-12T10:00 (morning)'));
 assert.deepEqual([r.cut,r.ends_at,r.landed,r.floor,r.day_part],['next_day','morning',0,240,'morning']);assert.ok(!('time_gate'in readJson(join(campaignDir(c.workspace),'turn.json'))));
 assert.deepEqual(timeRows(c).map(r=>[r.ok,r.outcome]),[[true,'delivered']]);
});
test('test_not_refusable_goes_out_with_the_finding',async t=>{const c=await kernel(t);await openTurn(c);await deliver(c,'t1-c1',{time_reading:reading({refusable:false})});assert.equal(warnings(record(c)).length,1);assert.ok(!('time_gate'in readJson(join(campaignDir(c.workspace),'turn.json'))));});
test('test_too_little_time_is_a_gap',async t=>{const c=await kernel(t);await openTurn(c);await advance(c,'t1-c1',15);const [w,r]=await gap(c,'t1-c2',{time_reading:reading()});assert.equal(r.landed,15);assert.equal(r.floor,240);assert.ok(w.why.includes('15 minutes landed'));});
test('test_the_suggestion_counts_from_the_day_the_turn_began',async t=>{const c=await kernel(t);await openTurn(c);await advance(c,'t1-c1',1050);const [w,r]=await gap(c,'t1-c2',{time_reading:reading()});assert.equal(r.day_part,'small_hours');assert.equal(r.landed,1050);assert.deepEqual(w.suggest,{until:{days:1,time:'08:00'}});});
test('test_enough_minutes_to_the_wrong_part_of_the_day_is_a_gap',async t=>{const c=await kernel(t);await openTurn(c);await advance(c,'t1-c1',360);const [w,r]=await gap(c,'t1-c2',{time_reading:reading()});assert.deepEqual([r.landed,r.floor,r.day_part],[360,240,'afternoon']);assert.equal(w.ends_at,'morning');});
test('test_a_neighbouring_day_part_is_not_a_gap',async t=>{const c=await kernel(t);await openTurn(c);await advance(c,'t1-c1',400);await deliver(c,'t1-c2',{time_reading:reading({cut:'later_today',floor:60,ends_at:'evening'})});assert.deepEqual(warnings(record(c)),[]);assert.deepEqual(timeRows(c),[]);});
test('test_the_suggested_until_closes_the_gap',async t=>{
 const c=await kernel(t);await openTurn(c);const [w]=await gap(c,'t1-c1',{time_reading:reading()});await c.table('player_input',{text:'I wait for daybreak.'});await c.table('apply',{call_id:'t2-c1',effects:[{kind:'time',until:w.suggest.until}]});await deliver(c,'t2-c2',{time_reading:reading()});
 assert.deepEqual(warnings(record(c,2)),[]);assert.deepEqual(timeRows(c).map(r=>r.turn),[1]);assert.equal((await c.table('capsule')).where.clock.at,'1920-10-13T08:00');
});
test('test_no_ends_at_checks_the_floor_only',async t=>{const c=await kernel(t);await openTurn(c);await advance(c,'t1-c1',240);const input=reading();delete input.ends_at;await deliver(c,'t1-c2',{time_reading:input});assert.deepEqual(warnings(record(c)),[]);});
test('test_travel_minutes_count_as_the_clock_moving',async t=>{const c=await kernel(t);await openTurn(c);await c.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'Hall of Records',travel_minutes:90}]});const input=reading({cut:'later_today',floor:60});delete input.ends_at;await deliver(c,'t1-c2',{time_reading:input});assert.deepEqual(warnings(record(c)),[]);});
test('test_later_today_suggests_today_when_the_part_is_still_ahead',async t=>{const c=await kernel(t);await openTurn(c);const [w]=await gap(c,'t1-c1',{time_reading:reading({cut:'later_today',floor:60,ends_at:'evening'})});assert.deepEqual(w.suggest,{until:{days:0,time:'18:00'}});});
test('test_no_suggestion_behind_the_clock',async t=>{const c=await kernel(t);await openTurn(c);await advance(c,'t1-c1',600);const [w,r]=await gap(c,'t1-c2',{time_reading:reading({cut:'later_today',floor:60,ends_at:'midday'})});assert.equal(r.day_part,'evening');assert.equal(r.landed,600);assert.ok(!('suggest'in w));});
test('test_days_suggest_nothing',async t=>{const c=await kernel(t);await openTurn(c);const [w,r]=await gap(c,'t1-c1',{time_reading:reading({cut:'days',floor:1440})});assert.equal(w.cut,'days');assert.equal(r.floor,1440);assert.ok(!('suggest'in w));});
test('test_the_gap_stays_in_unrecorded_until_time_lands',async t=>{
 const c=await kernel(t);await openTurn(c);await deliver(c,'t1-c1',{time_reading:reading({refusable:false})});let cap=(await c.table('player_input',{text:'I go inside.'})).capsule;
 let rows=cap.unrecorded.filter((r:Row)=>r.operation==='apply time');assert.equal(rows.length,1);assert.deepEqual([rows[0].time,rows[0].turn,rows[0].ends_at],['next_day',1,'morning']);assert.ok(rows[0].line.includes('1920-10-12T10:00')&&rows[0].line.includes('apply time'));assert.ok(cap.head.includes('three kinds'));
 await c.table('narrate',{call_id:'t2-c1',text:'The clerk looks up.'});cap=(await c.table('player_input',{text:'I wait.'})).capsule;assert.deepEqual(cap.unrecorded.filter((r:Row)=>r.operation==='apply time').map((r:Row)=>r.turn),[1]);
 await c.table('apply',{call_id:'t3-c1',effects:[{kind:'time',until:{days:1,time:'08:00'}}]});await c.table('narrate',{call_id:'t3-c2',text:'You wait for morning.'});cap=(await c.table('player_input',{text:'I enter.'})).capsule;assert.deepEqual(cap.unrecorded.filter((r:Row)=>r.operation==='apply time'),[]);
});
test('test_the_reading_is_not_part_of_the_call_s_digest',async t=>{const c=await kernel(t);await openTurn(c);const first=await deliver(c,'t1-c1',{time_reading:reading({refusable:false})}),again=await deliver(c,'t1-c1');assert.equal(again.receipt,first.receipt);});
test('test_no_reading_changes_nothing',async t=>{const c=await kernel(t);await openTurn(c);await deliver(c,'t1-c1');assert.deepEqual(warnings(record(c)),[]);assert.deepEqual(timeRows(c),[]);});
test('test_a_malformed_reading_is_refused',async t=>{
 const c=await kernel(t);await openTurn(c);for(const bad of [{cut:'short',confidence:.9,floor:0,refusable:true},{cut:'next_day',confidence:.9,floor:240,refusable:true,ends_at:'teatime'},{cut:'next_day',confidence:.9,floor:-1,refusable:true},{cut:'next_day',confidence:.9,floor:240}])assert.equal((await c.tableErr('narrate',{call_id:'t1-c1',text:TEXT,time_reading:bad})).code,'invalid_params');
});
