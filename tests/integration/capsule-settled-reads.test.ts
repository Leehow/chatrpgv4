/** §269.1-§269.2: the capsule reads this turn's settled checks and the papers within reach. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,CAMPAIGN,openTurn,prepared,type Row} from './support.ts';

const paper=(name:string):Row=>({name,category:'item',description:'An ordinary letter.',basis:'Fixture text, not an authored scenario claim.',
  parameters:{charges:null,effects:[]},document:{text:'To whom it may concern.',presentation:'paper'},player_view:{description:'A folded letter.',fields:[]}});

test('a rolled check is read back as one settled row with its goal and stake, in the result and the capsule',async t=>{
  const k=await kernel(t);await openTurn(k,'我翻抽屉。');
  const rolled=await k.table('resolve',{call_id:'t1-c1',action:{intent:'investigate',goal:'找到抽屉里的信',method:'仔细翻找',skill:'Spot Hidden',stakes:'翻动声惊动了楼下的人'}});
  const row=rolled.settled.rows[0];
  assert.deepEqual([row.skill,row.goal,row.stake,row.passed],['Spot Hidden','找到抽屉里的信','翻动声惊动了楼下的人',rolled.outcome.passed===true]);
  assert.match(rolled.settled.note,/final result/);
  const capsule=await k.table('capsule',{});
  assert.deepEqual(capsule.checks_this_turn.rows.map((r:Row)=>r.id),[row.id]);
});

test('a paper an investigator carries is listed within reach with its holder',async t=>{
  const k=await kernel(t);await openTurn(k);
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,paper('Letter of introduction')),{kind:'object',name:'Letter of introduction',to:'Thomas Hayes'}]});
  const capsule=await k.table('capsule',{});
  const row=capsule.documents_in_reach.rows.find((r:Row)=>r.name==='Letter of introduction');
  assert.ok(row.holder);assert.equal(row.reach,'investigator');
});
