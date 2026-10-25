/** Real TS RPC transactions, not live-play evidence (contract 242). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,openTurn} from './support.ts';
const seeded=(t:any)=>kernel(t,{env:{COC_KERNEL_SEED:'7'}});
test('a decision the rulebook lacks is set aside and the action routes by its intent and skill (§264.33, live 2026-10-24)',async t=>{
  const k=await seeded(t);await openTurn(k,'I try to persuade Knott to let me into the archive.');
  const result=await k.table('resolve',{call_id:'t1-c1',action:{intent:'social',decision:'social:persuade',skill:'Persuade',target:'Steven Knott',goal:'Be let into the archive',stakes:'He keeps the archive locked'}});
  assert.ok((result.adjusted??[]).some((row:any)=>row.field==='decision'&&row.reason==='unknown_decision'&&row.ignored==='social:persuade'),JSON.stringify(result.adjusted));
  assert.notEqual(result.decision,'social:persuade');
});
