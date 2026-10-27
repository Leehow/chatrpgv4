/** §268.2: First Aid is counted per wound; a fresh wound may be treated again the same day. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {derivedTable,apply,ok} from './rules-derived-support.ts';
const aid=(k:any,call_id:string)=>k.call('table.resolve',{campaign:'c1',call_id,action:{intent:'investigate',goal:'bind the wound',method:'first aid on the wound'}});
const rolled=(result:any)=>result.receipts.some((id:string)=>id.startsWith('roll:'));
test('a second First Aid on the same wound is refused but a new wound is treated again',async t=>{const k=await derivedTable(t,1,{});
ok(await apply(k,'t1-c1',{kind:'damage',dice:'1D3',why:'a splinter'}));
const first=ok(await aid(k,'t1-c2'));assert.equal(first.decision,'healing:first-aid-ordinary');assert.ok(rolled(first));
const again=ok(await aid(k,'t1-c3'));assert.ok(!rolled(again),'the same wound is not treated twice');
ok(await apply(k,'t1-c4',{kind:'damage',dice:'1D3',why:'a second fall'}));
const fresh=ok(await aid(k,'t1-c5'));assert.ok(rolled(fresh),'the new wound gets its own First Aid');});
