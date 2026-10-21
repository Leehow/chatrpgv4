/** Real TS RPC transactions, not live-play evidence (contract §249.7). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn,type Row} from './support.ts';

const research={intent:'investigate',goal:'Find the earliest record of the house',method:'Work the card catalogue and the bound registers',stakes:'Half a day goes nowhere.',rule:'library-research'};

test('a rule that states no check beside an explicitly named skill is the ordinary check of that skill (live el-v2-20261021g T11)',async t=>{
  const k=await kernel(t);await openTurn(k,'我坐电车去中央图书馆查宅子的旧档。');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'central-library',travel_band:'local_travel',via:'By streetcar'}]});
  const rolled=await k.table('resolve',{call_id:'t1-c2',action:{...research,skill:'Library Use'}});
  assert.equal(rolled.outcome.kind,'check');assert.equal(rolled.outcome.skill,'Library Use');
  assert.ok((await k.table('status')).receipts.some((receipt:Row)=>receipt.kind==='roll'&&receipt.skill==='Library Use'));
  const refused=await k.tableErr('resolve',{call_id:'t1-c3',action:research});
  assert.equal(refused.code,'invalid_params');assert.match(refused.message,/states no check to roll/,'with no skill named the rule is still refused');
});
