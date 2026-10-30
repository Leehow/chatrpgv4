/** A bout of madness the rules run is settled by the decision named, whatever intent the call carries (live 1030j ad T3). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RpcClient,open_turn,pyDivide,temporaryPath} from './npc-support.ts';
import {resolve,walk_to_confrontation} from './rules-families.test.ts';

test('a bout tick or end sent with an idle or meta intent settles the bout instead of rolling nothing', async t => {
 const client = new RpcClient(pyDivide(temporaryPath(t), 'ws'), {env: {COC_KERNEL_SEED: '1'}});
 try {
  await open_turn(client, '我掀开裹尸布。');
  const n = await walk_to_confrontation(client);
  const checked = await resolve(client, `t1-c${n}`, {intent: 'investigate', goal: '看见科比特的尸体动了', method: '', target: 'Walter Corbitt',
   decision: 'sanity:check', involuntary: {kind: 'freeze', summary: '手电筒的光柱僵在原地'}});
  assert.equal(checked.session?.status, 'active', 'the failed check opens a bout');
  const rounds = checked.session.bout.rounds_remaining;
  const tick = await resolve(client, `t1-c${n + 1}`, {intent: 'meta', goal: '推进疯狂发作', method: '', decision: 'sanity:bout-tick'});
  assert.equal(tick.decision, 'sanity:bout-tick');
  assert.equal(tick.outcome?.status, 'bout_tick');
  assert.equal(tick.outcome.bout_rounds_remaining, rounds - 1);
  const end = rounds - 1 > 0 ? await resolve(client, `t1-c${n + 2}`, {intent: 'idle', goal: '发作结束', method: '', decision: 'sanity:bout-end'}) : tick;
  assert.equal(end.outcome?.bout_active, false);
  assert.equal(end.session?.status, 'ended');
 } finally { await client.close(); }
});
