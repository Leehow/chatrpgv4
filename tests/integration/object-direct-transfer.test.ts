/** Real TS RPC transactions, not live-play evidence (contract §250.14). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn,prepared,type Row} from './support.ts';

const draft={name:'House key',category:'item',description:'An ordinary iron house key with a paper tag.',basis:'Fixture physical properties.',
  parameters:{charges:null,effects:[]},player_view:{description:'A house key.',fields:[]}};
const key={kind:'object',name:'House key',from:'Steven Knott',to:'Thomas Hayes',handover:'given',why:'Knott pushes the key across the desk.'};
const itemReceipt=async(k:any)=>(await k.table('status')).receipts.filter((receipt:Row)=>receipt.kind==='item').at(-1);
async function keyWithKnott(t:any,text:string){
  const k=await kernel(t);await openTurn(k,text);
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'House key',definition:draft.name,to:'Steven Knott',why:'Knott keeps the key in his desk.'}]});
  return k;
}

test('"accepted" with no offer standing and a handover between two people is the direct transfer it describes (live el-v2-20261021f T2)',async t=>{
  const k=await keyWithKnott(t,'我收下钥匙。');
  await k.table('apply',{call_id:'t1-c2',effects:[{...key,offer:'accepted',condition:'intact'}]});
  const moved=await itemReceipt(k);
  assert.deepEqual(moved.adjusted,[{field:'offer',reason:'no_open_offer_direct_transfer'}]);
  const investigator=(await k.table('view')).investigators[0];
  assert.ok([investigator.id,investigator.name].includes(moved.subject),'the key reaches the investigator');
});

test('an offer that stands is closed by "accepted" as before, with no repair; one never made is still not declined',async t=>{
  const k=await keyWithKnott(t,'诺特把钥匙递过来，我接了。');
  const {handover:_given,...holdOut}=key;
  await k.table('apply',{call_id:'t1-c2',effects:[{...holdOut,offer:'made',why:'He holds the key out.'}]});
  await k.table('apply',{call_id:'t1-c3',effects:[{...key,offer:'accepted',why:'Hayes takes it.'}]});
  assert.equal((await itemReceipt(k)).adjusted,undefined);
  const refusal=await k.tableErr('apply',{call_id:'t1-c4',effects:[{...holdOut,from:'Thomas Hayes',to:'Steven Knott',offer:'declined',why:'Nothing is held out.'}]});
  assert.equal(refusal.code,'invalid_params');
});
