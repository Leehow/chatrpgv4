import test from 'node:test';
import assert from 'node:assert/strict';
import {importSource} from '../integration/support.ts';

const api=await importSource('extensions/table/context-policy.ts');
const binding={version:1,campaign:'priority-fixture',worldline:'main',loop:0,turn:1,source_revision:'a'.repeat(64)};
const messages=[{role:'user',content:[{type:'text',text:'Check both records.'}],timestamp:1},
  {role:'custom',customType:'coc-capsule',content:JSON.stringify({state:'c'.repeat(35000)}),details:{context:binding,turn:1},timestamp:2},
  {role:'assistant',content:['one','two'].map(id=>({type:'toolCall',id,name:'look',arguments:{}})),timestamp:3},
  ...['one','two'].map(id=>({role:'toolResult',toolCallId:id,toolName:'look',content:[{type:'text',text:id+'r'.repeat(25000)}],timestamp:4}))];

test('current complete native results displace a rebuildable brief without changing data or the ceiling',()=>{
  const before=JSON.stringify(messages),budget=90000;
  const result=api.projectedMessages({messages,binding,history:{},brief:{reference:'s'.repeat(30000)},budget,singleKeeper:true});
  assert(api.retainsLatestToolBatch(messages,result.messages,binding));
  assert.equal(result.messages.some(row=>row.customType===api.BRIEF_TYPE),false);
  assert.deepEqual(result.messages.filter(row=>row.role==='toolResult'),messages.filter(row=>row.role==='toolResult'));
  assert.equal(result.degraded,'request_ceiling_reached');
  assert(api.pairedTools(result.messages));assert(api.requestSize(result.messages)<=budget);
  assert.equal(JSON.stringify(messages),before);
});

test('ordinary requests keep their static brief and native batch',()=>{
  const result=api.projectedMessages({messages,binding,history:{},brief:{reference:'s'.repeat(30000)},budget:150000,singleKeeper:true});
  assert(result.messages.some(row=>row.customType===api.BRIEF_TYPE));
  assert(api.retainsLatestToolBatch(messages,result.messages,binding));
});

test('an old input or an incomplete batch does not trigger the current-result priority',()=>{
  const next={...binding,turn:2};
  assert.equal(api.retainsLatestToolBatch(messages,[],next),true);
  assert.equal(api.retainsLatestToolBatch(messages.slice(0,-1),[],binding),true);
  assert.equal(api.retainsLatestToolBatch(messages,[],binding),false);
});

test('legacy projection and a genuinely unfit native batch retain their bounded fallback',()=>{
  const legacy=api.projectedMessages({messages,binding,history:{},brief:{reference:'s'.repeat(30000)},budget:90000});
  assert(legacy.messages.some(row=>row.customType===api.BRIEF_TYPE));
  assert.equal(api.retainsLatestToolBatch(messages,legacy.messages,binding),false);
  const small=api.projectedMessages({messages,binding,history:{},budget:40000,singleKeeper:true});
  assert(api.requestSize(small.messages)<=40000);assert(api.pairedTools(small.messages));
  assert.equal(api.retainsLatestToolBatch(messages,small.messages,binding),false);
});
