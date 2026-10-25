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
test('a skill with a gloss the rulebook does not print resolves to the part it has (§264.42, live 2026-10-25)',async t=>{
  const k=await seeded(t);await openTurn(k,'I search the desk.');
  const result=await k.table('resolve',{call_id:'t1-c1',action:{intent:'investigate',skill:'Spot Hidden (Notice)',goal:'Find what is hidden in the desk',method:'search it',stakes:'Knott may notice'}});
  assert.equal(result.outcome?.skill,'Spot Hidden',JSON.stringify(result.outcome));
});
