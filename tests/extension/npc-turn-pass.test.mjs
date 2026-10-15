/** One accepted native batch can describe the same actor's hold and its completed intent. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {temporaryPath,campaign_dir} from '../integration/npc-support.ts';
import {client_with,corbitts_turn,CORBITT,INVESTIGATOR} from '../integration/npc-npc-standing-action.test.ts';

test('one NPC hold and completed intention in the same apply spend one combat turn and survive restart',async t=>{
  const home=temporaryPath(t),client=await client_with(home,{disposition:'fights_to_the_end'});
  t.after(()=>client.close());
  const ordinal=await corbitts_turn(client);
  const before=(await client.table('look',{focus:'session'})).session;
  assert.equal(before.turn_of,CORBITT);
  const beforeRolls=(await client.table('status')).receipts.filter(row=>row.kind==='roll').length;
  const combatPath=join(String(await campaign_dir(client.workspace)),'save','combat.json');
  const original=await readFile(combatPath,'utf8');
  const effects=[
    {kind:'npc',name:'Walter Corbitt',action:'hold',why:'He waits instead of striking.'},
    {kind:'npc',name:'Walter Corbitt',intends:'Wait without striking during this exchange.',outcome:'done',spend_turn:true},
  ];
  await assert.rejects(client.table('apply',{call_id:`t1-c${ordinal}`,effects:[...effects,{kind:'time',minutes:-1}]}));
  assert.equal(await readFile(combatPath,'utf8'),original,'an invalid sibling leaves the combat save unchanged');
  assert.equal((await client.table('look',{focus:'session'})).session.turn_of,CORBITT);
  const result=await client.table('apply',{call_id:`t1-c${ordinal+1}`,effects});
  assert.equal(result.turn_passed.length,1);
  assert.equal(result.turn_passed[0].passed,CORBITT);
  const receipts=(await client.table('status')).receipts.filter(row=>result.receipts.includes(row.id));
  assert.equal(receipts.length,2);
  assert.ok(receipts.every(row=>row.passes_turn?.round===before.round&&row.passes_turn.turn_of===INVESTIGATOR));
  const after=(await client.table('look',{focus:'session'})).session;
  assert.equal(after.turn_of,INVESTIGATOR);
  assert.equal(after.round,before.round+1);
  assert.equal((await client.table('status')).receipts.filter(row=>row.kind==='roll').length,beforeRolls,'the batch adds no dice');
  await client.close();
  const {RpcClient}=await import('../integration/npc-support.ts');
  const restarted=new RpcClient(client.workspace);t.after(()=>restarted.close());
  const restored=(await restarted.table('look',{focus:'session'})).session;
  assert.equal(restored.turn_of,after.turn_of);assert.equal(restored.round,after.round);
});
