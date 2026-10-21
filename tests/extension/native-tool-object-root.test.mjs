/** Provider payload preparation only; aborted before network, no live acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {streamSimple} from '@earendil-works/pi-ai/api/openai-responses';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
test('the actual Responses request has object tool roots and still requires native effects',async()=>{
 for(const detail of [false,true]){
 const tools=locationToolDeclarations(offeredTools(COC_TOOLS,{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',EXT_JEV_APIKEY:'fixture'}),detail);
 const model={id:'grok-4.5',name:'Fixture',api:'openai-responses',provider:'grok-build',baseUrl:'https://invalid.example/v1',reasoning:true,input:['text'],contextWindow:128000,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const controller=new AbortController();let payload;
 await streamSimple(model,{messages:[{role:'system',content:'Fixture',toolsAdded:tools,timestamp:0},{role:'user',content:'Fixture',timestamp:0}]},
  {apiKey:'fixture',signal:controller.signal,onPayload:body=>{payload=body;controller.abort();}}).result();
 assert(payload.tools.length>0);
 for(const tool of payload.tools){
  const root=tool.parameters,branches=root.anyOf??root.oneOf;
  assert.equal(root.type,'object',tool.name);
  if(branches)assert(branches.every(branch=>branch.type==='object'),tool.name+' root union has a non-object branch');
 }
 if(detail){
  const additions=payload.tools.find(tool=>tool.name==='place').parameters.properties.additions;
  assert.equal(additions.type,'array');assert.equal(additions.anyOf,undefined);
  assert.equal(additions.maxItems,12);assert(additions.items.properties.description);
 }
 const schema=tools.find(tool=>tool.name==='apply').parameters;
 assert(!Check(schema,{}));assert(!Check(schema,{event:{summary:'Unowned prose'}}));
 assert(Check(schema,{effects:[{kind:'time',minutes:1,why:'A selected wait.'}]}));
 }
});
