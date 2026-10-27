/** A social action that names a skill which is no social approach is rolled as that skill (1026l). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,openTurn} from './support.ts';
// 1026l Dust to Dust T2/T3: the book has the police questioned with Law; intent social with skill Law was refused twice for
// naming none of the four approaches, and the Keeper re-sent it as Persuade.
test('a social question asked with Law rolls Law',async t=>{
  const k=await kernel(t,{env:{COC_KERNEL_SEED:'7'}});await openTurn(k);
  const result=await k.table('resolve',{call_id:'t1-c1',action:{intent:'social',skill:'Law',target:'Steven Knott',goal:'learn what the police wrote down',method:'cite the inquest procedure to him'}});
  assert.equal(result.decision,'core-check:ordinary-check',JSON.stringify(result.decision));
  assert.equal(result.outcome.skill,'Law');
});
test('a social approach still goes to the social adjudication',async t=>{
  const k=await kernel(t,{env:{COC_KERNEL_SEED:'7'}});await openTurn(k);
  const result=await k.table('resolve',{call_id:'t1-c1',action:{intent:'social',skill:'Persuade',target:'Steven Knott',goal:'get him to open the house',method:'talk him round'}});
  assert.notEqual(result.decision,'core-check:ordinary-check');
});
