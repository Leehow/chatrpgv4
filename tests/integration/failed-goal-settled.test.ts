/** §270.5: a goal this input already failed is not rolled again under another check. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,opening} from './rules-rpc-support.ts';

test('a failed goal re-rolled through a combined check with the same skill is refused; a different goal still rolls',async t=>{
  for(const seed of ['1','2','3','4','5','6','7','8','9','10','11','12']){
    const k=await kernel(t,{env:{COC_KERNEL_SEED:seed}});await opening(k,'我翻抽屉找信。');
    const goal='找到抽屉里的信';
    const rolled=await k.table('resolve',{call_id:'t1-c1',action:{intent:'investigate',goal,method:'仔细翻找',skill:'Spot Hidden'}});
    if(rolled.outcome.passed!==false)continue;
    const again=await k.tableErr('resolve',{call_id:'t1-c2',action:{intent:'investigate',goal,method:'换个法子',skill:'Spot Hidden',skills:['Spot Hidden','Library Use']}});
    assert.equal(again.code,'turn_state');assert.equal(again.details.reason,'goal_already_failed');
    const other=await k.table('resolve',{call_id:'t1-c3',action:{intent:'investigate',goal:'看清抽屉的锁',method:'凑近看',skill:'Spot Hidden'}});
    assert.equal(other.outcome.kind,'check');
    return;
  }
  throw Error('no seed failed the check');
});
