/** Real TS RPC transactions, not live-play evidence (contract §249.5). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,opening,receipts} from './rules-rpc-support.ts';

async function failedOffer(t:any){
  for(const seed of ['1','2','3','4','5','6','7','8','9','10','11','12']){
    const k=await kernel(t,{env:{COC_KERNEL_SEED:seed}});await opening(k,'我去查报案登记簿。');
    const rolled=await k.table('resolve',{call_id:'t1-c1',action:{intent:'investigate',goal:'查到报案记录',method:'用图书馆使用翻登记簿',skill:'Library Use'}});
    if(rolled.outcome.level!=='failure')continue;
    const asked=await k.table('ask',{call_id:'t1-c2',kind:'mechanics',binds:'push-luck:luck-spend',options:['spend_luck','push','accept']});
    await k.table('player_input',{text:'那就这样吧，我接受这个结果。'});
    return {k,pending:asked.pending_choice.name};
  }
  throw Error('no seed failed the check');
}

test('accepting a failed roll\'s push or Luck offer settles the offer and rolls nothing, whatever the intent (live el-v2-20261021e T27)',async t=>{
  const {k,pending}=await failedOffer(t);
  const answered=await k.table('resolve',{call_id:'t2-c1',action:{intent:'social',goal:'接受失败，不再纠缠',method:'不孤注一掷也不花幸运',choice:{pending,option:'accept'}}});
  assert.deepEqual(answered.outcome,{kind:'none'});assert.equal(answered.pending_choice,null);
  const mine=(await receipts(k)).filter((r:any)=>r.call_id==='t2-c1');
  assert.deepEqual(mine.map((r:any)=>[r.kind,r.option]),[['choice','accept']],'the choice lands and no roll is thrown');
});
