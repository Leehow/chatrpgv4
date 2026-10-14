/** Full RPC/disk counterparts for test_apply_time_healing.py and test_apply_time_mp.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,writeJson,RpcClient,type Row} from './support.ts';
const INVESTIGATOR='thomas-hayes',DAY=1440,WEEK=7*DAY;
const path=(k:RpcClient)=>join(campaignDir(k.workspace),'party',INVESTIGATOR+'.json');
const sheet=(k:RpcClient)=>readJson(path(k));
const hp=async(k:RpcClient)=>(await k.table('look',{focus:'investigator'})).hp;
const hpRows=(result:Row)=>(result.recovered??[]).filter((row:Row)=>row.resource==='hp');
const hurt=(k:RpcClient,call_id:string,points:number)=>k.table('apply',{call_id,effects:[{kind:'damage',dice:`1D1+${points-1}`,why:'从楼梯上摔下来'}]});
const rest=(k:RpcClient,call_id:string,minutes:number)=>k.table('apply',{call_id,effects:[{kind:'time',minutes,why:'静养'}]});
test('ordinary recovery cannot repeat after two six-hour rests in the same day',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',4);
  await rest(k,'t1-c2',360);assert.equal(await hp(k),9);
  const repeated=await rest(k,'t1-c3',360);
  assert.equal(await hp(k),9);assert.deepEqual(hpRows(repeated),[]);
});
test('midnight and a zero-gain rest do not reset the ordinary recovery anchor',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',4);
  await rest(k,'t1-c2',720);assert.equal(await hp(k),9);
  const eveningClock=(await k.table('capsule')).where.clock;
  const overnight=await rest(k,'t1-c3',720);
  const morningClock=(await k.table('capsule')).where.clock;
  assert.notEqual(morningClock.at?.slice(0,10)??morningClock.day,eveningClock.at?.slice(0,10)??eveningClock.day);
  assert.equal(await hp(k),9);assert.deepEqual(hpRows(overnight),[]);
  const fullInterval=await rest(k,'t1-c4',720);
  assert.equal(await hp(k),10);
  assert.deepEqual(hpRows(fullInterval),[{investigator:INVESTIGATOR,resource:'hp',before:9,after:10}]);
});
test('ordinary recovery permits complete later days and retains the ceiling',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',5);await hurt(k,'t1-c2',5);
  await rest(k,'t1-c3',360);assert.equal(await hp(k),3);
  await rest(k,'t1-c4',DAY);assert.equal(await hp(k),4);
  const several=await rest(k,'t1-c5',3*DAY);assert.equal(await hp(k),7);
  assert.deepEqual(hpRows(several),[{investigator:INVESTIGATOR,resource:'hp',before:4,after:7}]);
  await rest(k,'t1-c6',30*DAY);assert.equal(await hp(k),12);
});
test('ordinary recovery reconstructs committed anchors after restart and preserves call replay',async t=>{
  const first=await kernel(t);await openTurn(first);await hurt(first,'t1-c1',4);
  await rest(first,'t1-c2',360);assert.equal(await hp(first),9);
  await first.table('narrate',{call_id:'t1-c3',text:'The investigator finishes resting.'});
  const closedPath=join(campaignDir(first.workspace),'turns','0001.json'),closed=readJson(closedPath);
  await first.close();
  const resumed=new RpcClient(first.workspace);t.after(()=>resumed.close());
  await resumed.table('open');await resumed.table('player_input',{text:'I continue resting.'});
  const repeated=await rest(resumed,'t2-c1',360);
  assert.equal(await hp(resumed),9);assert.deepEqual(hpRows(repeated),[]);
  const clock=readJson(join(campaignDir(resumed.workspace),'world.json')).clock;
  const replay=await rest(resumed,'t2-c1',360);
  assert.equal(replay.replayed,true);const {replayed,...original}=replay;
  assert.deepEqual(original,repeated);assert.equal(await hp(resumed),9);
  assert.deepEqual(readJson(join(campaignDir(resumed.workspace),'world.json')).clock,clock);
  await rest(resumed,'t2-c2',1080);assert.equal(await hp(resumed),10);
  assert.deepEqual(readJson(closedPath),closed);
});
test('first ordinary recovery still rouses an unconscious investigator',async t=>{
  const k=await kernel(t);await openTurn(k);
  for(let call=1;call<=3;call++)await hurt(k,`t1-c${call}`,4);
  assert.equal(await hp(k),0);assert.ok(sheet(k).conditions.includes('unconscious'));
  assert.ok(!sheet(k).conditions.includes('major_wound'));
  await rest(k,'t1-c4',360);assert.equal(await hp(k),1);
  assert.ok(!sheet(k).conditions.includes('unconscious'));
});
test('test_a_day_of_rest_is_one_hit_point_not_three',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',4);assert.equal(await hp(k),8);assert.ok(!sheet(k).conditions.includes('major_wound'));
  const result=await rest(k,'t1-c2',DAY);assert.equal(await hp(k),9);assert.deepEqual(hpRows(result),[{investigator:INVESTIGATOR,resource:'hp',before:8,after:9}]);assert.ok(result.receipts.some((id:string)=>id.startsWith('delta:hp-t1')));
});
test('test_the_day_turns_at_twenty_four_hours',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',4);await rest(k,'t1-c2',2*DAY-1);assert.equal(await hp(k),9);await rest(k,'t1-c3',2*DAY);assert.equal(await hp(k),11);
});
test('test_a_week_of_rest_is_seven_hit_points',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',5);await hurt(k,'t1-c2',5);assert.equal(await hp(k),2);assert.ok(!sheet(k).conditions.includes('major_wound'));
  const result=await rest(k,'t1-c3',WEEK);assert.equal(await hp(k),9);assert.deepEqual(hpRows(result),[{investigator:INVESTIGATOR,resource:'hp',before:2,after:9}]);
});
test('test_a_month_of_rest_is_as_long_as_the_month',async t=>{
  const k=await kernel(t);await openTurn(k);await hurt(k,'t1-c1',5);await hurt(k,'t1-c2',5);const result=await rest(k,'t1-c3',30*DAY);
  assert.equal(await hp(k),12);assert.deepEqual(hpRows(result),[{investigator:INVESTIGATOR,resource:'hp',before:2,after:12}]);
});
test('test_a_major_wound_gets_no_weekly_roll_from_two_days_and_a_third',async t=>{
  const k=await kernel(t,{env:{COC_KERNEL_SEED:'4'}});await openTurn(k);await hurt(k,'t1-c1',8);assert.equal(await hp(k),4);assert.ok(sheet(k).conditions.includes('major_wound'));
  const result=await rest(k,'t1-c2',3360);assert.ok(!('recovered' in result));assert.ok(!result.receipts.some((id:string)=>id.startsWith('delta:hp')));assert.equal(await hp(k),4);assert.ok(sheet(k).conditions.includes('major_wound'));
});
test('test_three_weeks_with_a_major_wound_roll_three_times',async t=>{
  const one=await kernel(t,{env:{COC_KERNEL_SEED:'4'}}),three=await kernel(t,{env:{COC_KERNEL_SEED:'4'}});
  for(const k of [one,three]){await openTurn(k);await hurt(k,'t1-c1',11);assert.equal(await hp(k),1);assert.ok(sheet(k).conditions.includes('major_wound'));}
  await rest(one,'t1-c2',WEEK);const result=await rest(three,'t1-c2',3*WEEK);assert.ok(await hp(one)>1);assert.ok(await hp(three)>await hp(one));
  assert.deepEqual(hpRows(result),[{investigator:INVESTIGATOR,resource:'hp',before:1,after:await hp(three)}]);
});
test('test_healing_clears_the_sheet_and_a_healed_wound_does_not_come_back',async t=>{
  const k=await kernel(t,{env:{COC_KERNEL_SEED:'4'}});await openTurn(k);await hurt(k,'t1-c1',8);assert.equal(await hp(k),4);assert.ok(sheet(k).conditions.includes('major_wound'));
  await rest(k,'t1-c2',8*WEEK);assert.equal(await hp(k),12);assert.deepEqual(sheet(k).conditions,[]);await hurt(k,'t1-c3',2);assert.equal(await hp(k),10);assert.ok(!sheet(k).conditions.includes('major_wound'));
});
const setMP=(k:RpcClient,value:number)=>{const valueSheet=sheet(k);valueSheet.current_mp=value;writeJson(path(k),valueSheet);};
const mpRows=(result:Row)=>(result.recovered??[]).filter((row:Row)=>row.resource==='mp');
const time=(k:RpcClient,call_id:string,minutes:number)=>k.table('apply',{call_id,effects:[{kind:'time',minutes}]});
test('test_apply_time_five_minutes_leaves_mp_untouched',async t=>{
  const k=await kernel(t);await openTurn(k);setMP(k,3);const result=await time(k,'t1-c1',5);assert.ok(!('recovered' in result));assert.equal(sheet(k).current_mp,3);
});
test('test_apply_time_sixty_minutes_grants_exactly_one_point',async t=>{
  const k=await kernel(t);await openTurn(k);setMP(k,0);const rows=mpRows(await time(k,'t1-c1',60));assert.ok(rows.length);assert.equal(rows[0].before,0);assert.equal(rows[0].after,1);assert.equal(sheet(k).current_mp,1);
});
test('test_apply_time_ninety_minutes_grants_one_point_not_a_rounded_two',async t=>{
  const k=await kernel(t);await openTurn(k);setMP(k,0);const rows=mpRows(await time(k,'t1-c1',90));assert.ok(rows.length);assert.equal(rows[0].before,0);assert.equal(rows[0].after,1);assert.equal(sheet(k).current_mp,1);
});
test('test_apply_time_two_separate_thirty_minute_advances_do_not_yet_accumulate',async t=>{
  const k=await kernel(t);await openTurn(k);setMP(k,0);assert.ok(!('recovered' in await time(k,'t1-c1',30)));assert.ok(!('recovered' in await time(k,'t1-c2',30)));assert.equal(sheet(k).current_mp,0);
});
test('test_apply_time_long_rest_never_exceeds_the_pow_over_five_ceiling',async t=>{
  const k=await kernel(t);await openTurn(k);setMP(k,9);const rows=mpRows(await time(k,'t1-c1',600));assert.ok(rows.length);assert.equal(rows[0].before,9);assert.equal(rows[0].after,11);assert.equal(sheet(k).current_mp,11);
});
