/** Multiple resource settlements in one real apply batch retain distinct provenance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {table} from './object-usages-fixture.mjs';

test('apply child resource receipts share the batch allocator and preserve replay',async t=>{
  const game=await table(t),before=JSON.parse(await readFile(game.sheetPath,'utf8'));
  const params={call_id:'t1-c99',effects:[
    {kind:'damage',subject:game.sheet.name,dice:'1D4',why:'The first falling fragment strikes the investigator.'},
    {kind:'damage',subject:game.sheet.name,dice:'1D4',why:'A separate falling fragment strikes the investigator.'},
  ]};
  await game.call('table.apply',params);
  const receipts=(await game.call('table.status')).receipts.filter(value=>value.call_id===params.call_id);
  const rolls=receipts.filter(value=>value.kind==='roll'&&value.form==='dice'),deltas=receipts.filter(value=>value.kind==='delta'&&value.resource==='hp');
  assert.equal(rolls.length,2);assert.equal(deltas.length,2);
  assert.equal(new Set(receipts.map(value=>value.id)).size,receipts.length,'every receipt in the batch has one identity');
  assert.equal(rolls[0].id,'roll:damage-t1-c99');assert.equal(deltas[0].id,'delta:hp-t1-c99');
  assert.notEqual(rolls[0].id,rolls[1].id);assert.notEqual(deltas[0].id,deltas[1].id);
  for(let i=0;i<2;i++){
    assert.equal(deltas[i].source_receipt,rolls[i].id,'each HP change cites its own roll');
    assert.equal(deltas[i].before-deltas[i].after,rolls[i].total);
  }
  const after=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.equal(after.current_hp,(before.current_hp??before.derived.HP)-rolls.reduce((sum,value)=>sum+value.total,0));
  await game.call('table.apply',params);
  assert.deepEqual(JSON.parse(await readFile(game.sheetPath,'utf8')),after,'replaying the same call applies no second damage');
  assert.deepEqual((await game.call('table.status')).receipts.filter(value=>value.call_id===params.call_id),receipts);
});
