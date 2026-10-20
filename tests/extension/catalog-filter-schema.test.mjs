/** The provider declaration must not advertise the blank catalog filter rejected by the kernel. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Check} from 'typebox/value';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
test('catalog kinds accepts a real filter or omission, never an empty-string placeholder',()=>{
 const schema=COC_TOOLS.find(tool=>tool.name==='lookup').parameters;
 const call={kind:'catalog',query:'bread',limit:5};
 assert.equal(Check(schema,{...call,kinds:['']}),false);
 assert.equal(Check(schema,{...call,kinds:['item']}),true);
 assert.equal(Check(schema,call),true);
});
