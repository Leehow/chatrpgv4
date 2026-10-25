/** §270.6: an untold turn's rows read newest first, so the capsule budget keeps a later result over an earlier one. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundled=await build({stdin:{contents:`export {untoldReceipts,SLICE2_BUDGETS} from './kernel-ts/read/assemble.ts';export {fitBudget} from './kernel-ts/read/capsule.ts';`,resolveDir:process.cwd()},
 bundle:true,write:false,platform:'node',format:'esm'});
const {untoldReceipts,SLICE2_BUDGETS,fitBudget}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('a success after a failure survives the untold budget',()=>{
 const roll=(id,passed)=>({id,kind:'roll',actor:'zhou',actor_label:'Zhou',skill:'Spot Hidden',skill_label:'Spot Hidden',target:50,threshold:50,roll:passed?3:78,level:passed?'extreme':'failure',passed,visibility:'public'});
 const moves=Array.from({length:12},(_,i)=>({id:`move-${i}`,kind:'move',from:`place ${i}`,to:`place ${i+1}`,minutes:5,why:'x'.repeat(40)}));
 const rows=untoldReceipts([{turn:6,closed_by:'stranded',receipts:[...moves,roll('roll:fail',false),roll('roll:success',true)]}],7);
 fitBudget(rows,SLICE2_BUDGETS.untold);
 const kept=JSON.stringify(rows);
 assert.ok(kept.includes('extreme'),'the later success is kept');
 assert.match(rows[0].line,/newest first/);
});
