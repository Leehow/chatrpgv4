/** Branch-local grammar must remain typed on the actual Responses adapter seam. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {streamSimple} from '@earendil-works/pi-ai/api/openai-responses';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
import {NativePlaceParameters} from '../../shared/place-structures.ts';

test('Responses action branches retain array grammar without depending on sibling properties',async()=>{
 const tools=locationToolDeclarations(offeredTools(COC_TOOLS,{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',EXT_JEV_APIKEY:'fixture'}),true);
 const model={id:'grok-4.5',name:'Fixture',api:'openai-responses',provider:'grok-build',baseUrl:'https://invalid.example/v1',reasoning:true,input:['text'],contextWindow:128000,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const controller=new AbortController();let payload;
 await streamSimple(model,{messages:[{role:'system',content:'Fixture',toolsAdded:tools,timestamp:0},{role:'user',content:'Fixture',timestamp:0}]},
  {apiKey:'fixture',signal:controller.signal,onPayload:body=>{payload=body;controller.abort();}}).result();
 const schema=payload.tools.find(tool=>tool.name==='place').parameters;
 for(const canonical of NativePlaceParameters.anyOf){
  const action=canonical.properties.action.const,branch=schema.anyOf.find(branch=>branch.properties.action.const===action);
  assert(branch,action);
  for(const [field,shape] of Object.entries(canonical.properties))if(shape.type==='array'){
   // Existing observation projection uses view instead of exposing an inline relations write.
   if(action==='observe'&&field==='relations'){assert.equal(branch.properties[field],undefined);continue;}
   assert.equal(branch.properties[field]?.type,'array',action+'.'+field);
   assert.equal(branch.properties[field].maxItems,shape.maxItems,action+'.'+field);
   assert.deepEqual(branch.properties[field].items,JSON.parse(JSON.stringify(shape.items)),action+'.'+field);
  }
 }
 const move=schema.anyOf.find(branch=>branch.properties.action.const==='move');
 const request={action:'move',to:'Station',additions:[{name:'Station',features:[{name:'Counter',description:'A worn oak counter.'}]}]};
 assert(Check(move,request));
 assert(!Check(move,{...request,additions:JSON.stringify(request.additions)}));
 assert(!Check(move,{...request,additions:[{name:'Station',features:'[]'}]}));
 assert(!Check(move,{...request,additions:[{name:'Station',features:[{name:'Counter'}]}]}));
 assert(!Check(move,{...request,additions:[]}));
 assert(Check(NativePlaceParameters,request));
 assert(!Check(NativePlaceParameters,{...request,action:'inspect'}));
});
