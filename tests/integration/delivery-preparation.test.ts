/** Component privacy evidence; synthetic visibility variants are not gameplay acceptance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir} from './support.ts';

test('delivery preparation exposes actual public check outcomes without hidden grades or receipt identifiers',async t=>{
 const k=await kernel(t);await openTurn(k);
 await k.table('resolve',{call_id:'t1-c1',action:{intent:'investigate',skill:'Spot Hidden',goal:'Notice signs around the desk',method:'Look carefully at the desk'}});
 const file=join(campaignDir(k.workspace),'turn.json'),turn=JSON.parse(readFileSync(file,'utf8'));
 const roll=turn.receipts.find((value:any)=>value.kind==='roll');assert.ok(roll);
 turn.receipts=[...turn.receipts.filter((value:any)=>value.kind!=='roll'),
  {...roll,visibility:'public'},
  {...roll,id:'PRIVATE_RECEIPT',visibility:'keeper',skill:'PRIVATE_SKILL',passed:!roll.passed},
  {...roll,id:'CONCEALED_RECEIPT',visibility:'concealed',skill:'CONCEALED_SKILL',passed:!roll.passed}];
 writeFileSync(file,JSON.stringify(turn));
 const prepared=await k.table('delivery.check',{});
 const {goal,on_failure,...check}=prepared.settled_results.checks[0];assert.equal(prepared.settled_results.checks.length,1);
 assert.deepEqual(check,{kind:'roll',skill:roll.skill,passed:roll.passed,level:roll.level});assert.equal(goal,'Notice signs around the desk','§253.2: the author learns what the check was for');
 const publicBytes=JSON.stringify(prepared.settled_results);
 for(const forbidden of ['PRIVATE_RECEIPT','PRIVATE_SKILL','CONCEALED_RECEIPT','CONCEALED_SKILL',roll.id])assert.ok(!publicBytes.includes(forbidden));
 assert.equal(Object.hasOwn(prepared.settled_results.checks[0],'roll'),false);
});
