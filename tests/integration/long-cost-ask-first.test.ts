/** Real TS RPC capsule, not live-play evidence (contract §253.4). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn,type Row} from './support.ts';

test('a rule row that costs an hour or more carries the ask beside its cost (live el-v2-20261021f T18)',async t=>{
  const k=await kernel(t);await openTurn(k,'我坐电车去中央图书馆。');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'place',action:'move',to:'central-library',travel_band:'local_travel',via:'By streetcar'}]});
  const rules=((await k.table('capsule')).where.rules??[]) as Row[];
  const research=rules.find(rule=>rule.handle==='library-research');
  assert.ok(research,JSON.stringify(rules));
  assert.match(research!.ask_first,/player's to accept/);
  assert.ok(rules.filter(rule=>!rule.time_cost).every(rule=>!('ask_first' in rule)),'rows with no stated time cost are unchanged');
});
