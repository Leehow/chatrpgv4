/** Real TS RPC transactions, not live-play evidence (contract §249.5). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,opening,receipts} from './rules-rpc-support.ts';

test('§268.6: the Keeper cannot offer a push or a Luck spend; the player declares them (live el-v2-20261021e T27)',async t=>{
  for(const seed of ['1','2','3','4','5','6','7','8','9','10','11','12']){
    const k=await kernel(t,{env:{COC_KERNEL_SEED:seed}});await opening(k,'我去查报案登记簿。');
    const rolled=await k.table('resolve',{call_id:'t1-c1',action:{intent:'investigate',goal:'查到报案记录',method:'用图书馆使用翻登记簿',skill:'Library Use'}});
    if(rolled.outcome.level!=='failure')continue;
    for(const options of [['spend_luck','accept'],['push','accept']]){
      const refused=await k.tableErr('ask',{call_id:'t1-c2',kind:'mechanics',binds:'push-luck:luck-spend',options});
      assert.equal(refused.code,'invalid_params');assert.match(refused.message,/mechanics choice option/);
    }
    assert.equal((await receipts(k)).filter((r:any)=>r.call_id==='t1-c2').length,0,'nothing was staged');
    return;
  }
  throw Error('no seed failed the check');
});
