import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fastSuite } from './fast-support.mjs';
// Every parameter of tests/kernel/test_mechanics_identity.py, against production TS.
const suite = await fastSuite();
after(() => suite.close());
const { mechanics, clone } = suite.api;
const receipts = [
  [{id:'roll:spot-hidden-hidden-name-t1-c1',kind:'roll',skill:'Spot Hidden',roll:31,target:60,threshold:60,passed:true},'actor',{roll:31,target:60}],
  [{id:'roll:damage-t1-c1',kind:'roll',form:'dice',skill:'Damage',expression:'1D6',faces:[4],total:4},'actor',{faces:[4],total:4}],
  [{id:'delta:hp-t1-c1',kind:'delta',resource:'hp',before:12,after:8},'subject',{before:12,after:8}],
];
for (const identity of [true,false,null]) for (const [index,[input,key,numeric]] of receipts.entries()) {
  test(`test_public_identity_is_explicit_and_projection_preserves_canonical_receipt[${identity}-${index}]`, () => {
    const receipt={...input,[key]:'hidden-name',[`${key}_label`]:'Hidden Name'};
    if(identity!==null)receipt[`${key}_is_investigator`]=identity;
    const original=clone(receipt),row=mechanics([receipt],{'check:spot-hidden':receipt.id})[0];
    assert.equal(row.marker,'check:spot-hidden'); assert.equal(row.receipt,receipt.id);
    for(const [field,value] of Object.entries(numeric))assert.deepEqual(row[field],value);
    assert.equal(row[`${key}_is_investigator`],identity===true);
    if(identity===true){assert.equal(row[key],'hidden-name');assert.equal(row[`${key}_label`],'Hidden Name');}
    else {assert.ok(!(key in row));assert.ok(!(`${key}_label` in row));}
    assert.deepEqual(receipt,original);
  });
}
test('test_call_and_family_ride_on_the_projection_and_the_receipt_is_not_mutated', () => {
  const stamped={id:'delta:hp-t1-c1',kind:'delta',resource:'hp',before:12,after:8,call_id:'t1-c1',family:'core-check'};
  const original=clone(stamped),row=mechanics([stamped],{'check:spot-hidden':stamped.id})[0];
  assert.equal(row.call,'t1-c1');assert.equal(row.family,'core-check');assert.deepEqual(stamped,original);
  const bare={id:'delta:hp-t1-c1',kind:'delta',resource:'hp',before:12,after:8},copy=clone(bare);
  const plain=mechanics([bare],{'check:spot-hidden':bare.id})[0];
  assert.ok(!('call' in plain));assert.ok(!('family' in plain));assert.deepEqual(bare,copy);
});
