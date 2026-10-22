/** Real TS RPC transactions, not live-play evidence (contract §253.3). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn} from './support.ts';

const persuade={intent:'social',goal:'Get Arty to open the clipping room',method:'Explain the landlord\'s commission',target:'Arty Wilmot',skill:'Persuade'};
async function atMorgue(t:any){
  const k=await kernel(t);await openTurn(k,'我说明来意，请他帮忙调出科比特宅这些年的旧剪报。');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'newspaper-morgue'}]});
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'person',who:'Arty Wilmot',name:'Arty'}]});
  return k;
}

test('a roll cannot decide access whose guarded results already landed this input (live el-v2-20261021f T12)',async t=>{
  const k=await atMorgue(t);
  const landed=await k.table('apply',{call_id:'t1-c3',effects:[{kind:'clue',clue:'globe-unpublished-story',how:'Ruth hands over the held 1918 copy'}]});
  assert.equal(landed.obligation_open,'globe-clippings-access','landing a guarded result stays allowed and is reported (owner ruling Q5)');
  for(const action of [{...persuade,obligation:'globe-clippings-access'},persuade]){
    const refused=await k.tableErr('resolve',{call_id:'t1-c4',action});
    assert.equal(refused.code,'invalid_params');assert.equal(refused.details.reason,'obligation_outcome_landed',JSON.stringify(action));
  }
});

test('the obligation check rolled before its guarded results is unchanged',async t=>{
  const k=await atMorgue(t);
  const rolled=await k.table('resolve',{call_id:'t1-c3',action:{...persuade,obligation:'globe-clippings-access'}});
  assert.equal(rolled.outcome.kind,'check');
});
