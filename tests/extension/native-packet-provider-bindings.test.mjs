/** Actual adapter payloads must carry the same bound output contract as execution. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {readFileSync} from 'node:fs';
import {streamSimple as responses} from '@earendil-works/pi-ai/api/openai-responses';
import {streamSimple as messages} from '@earendil-works/pi-ai/api/anthropic-messages';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {turnPacketParameterSchema,turnPacketProviderPayload} from '../../runtime/turn-packet-prototype.ts';
const tools=offeredTools(COC_TOOLS,{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',EXT_JEV_APIKEY:'fixture'});
const bindings={entities:['npc_1','investigator_1','place_1','place_2'],people:['npc_1','investigator_1'],places:['place_1','place_2'],facts:['fact_1'],sources:['source_1']};
const schema=turnPacketParameterSchema(false,undefined,[],false,bindings,true);
const valid={version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'directions',to:'place_2',heading:'west'}}]}]};
for(const transport of ['responses','messages'])test('the '+transport+' adapter output schema equals the current bound execution schema',async()=>{
 const model=transport==='responses'?{id:'grok-4.5',name:'Fixture',api:'openai-responses',provider:'grok-build',baseUrl:'https://invalid.example/v1',reasoning:true,input:['text'],contextWindow:128000,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}:
  {...JSON.parse(readFileSync(new URL('../../node_modules/@earendil-works/pi-ai/dist/providers/data/minimax-cn.json',import.meta.url)))['anthropic-messages']['chat:MiniMax-M2.7'],id:'MiniMax-M3.1-Flash-Preview',compat:{forceAdaptiveThinking:true}};
 const controller=new AbortController();let payload;
 await(transport==='responses'?responses:messages)(model,{messages:[{role:'system',content:'Fixture',toolsAdded:tools,timestamp:0},{role:'user',content:'Fixture',timestamp:0}]},
  {apiKey:'fixture',signal:controller.signal,onPayload:body=>{payload=body;controller.abort();}}).result();
 const original=structuredClone(payload),sent=turnPacketProviderPayload(payload,schema);
 const output=sent.tools.find(tool=>tool.name==='output'),wire=output.input_schema??output.parameters;
 if(transport==='messages')assert.deepEqual(wire,schema);else assert.ok(wire.$defs,'the verified Grok declaration shares repeated schemas');
 assert(Check(wire,valid));
 assert(!Check(wire,{...valid,interactions:[{...valid.interactions[0],content:[{new:{predicate:'directions',to:'Unissued hotel',heading:'west'}}]}]}));
 assert.deepEqual(payload,original,'do not mutate the adapter payload');
 assert.equal(sent.tools.find(tool=>tool.name==='look'),payload.tools.find(tool=>tool.name==='look'));
 assert.equal(sent.model,payload.model);
 assert.equal(sent.messages??sent.input,payload.messages??payload.input);
 if(transport==='messages')assert.deepEqual(sent.tool_choice,{type:'auto'});
 else assert.equal(sent.tool_choice,payload.tool_choice);
});
test('unknown payload shapes and provider-native tools are left alone',()=>{
 const output={type:'function',name:'output',parameters:{type:'object'}},search={type:'web_search'};
 const unknown={tools:[output,search]};assert.equal(turnPacketProviderPayload(unknown,schema),unknown);
 const body={model:'grok-4.5',input:[],tools:[search,output]};
 const sent=turnPacketProviderPayload(body,schema);assert.equal(sent.tools[0],search);assert.ok(Check(sent.tools[1].parameters,valid));
});

test('unavailable material branches are omitted without admitting unavailable references',()=>{
 const empty={...bindings,facts:[],sources:[],places:[]};
 const canonical=turnPacketParameterSchema(false,undefined,[],false,empty,true);
 const request={model:'grok-4.5',input:[],tools:[{type:'function',name:'output',parameters:{type:'object'}}]};
 const wire=turnPacketProviderPayload(request,canonical).tools[0].parameters;
 const visit=(value,path='')=>{
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value.enum))assert(value.enum.length>0,'unsupported empty enum at '+path);
  for(const[key,child]of Object.entries(value))visit(child,path+'/'+key);
 };
 visit(wire);
 const answer=content=>({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content}]});
 for(const candidate of [{version:4},{version:4,reveal:[]},answer([{fact_ref:'fact_1'}]),answer([{source_ref:'source_1'}]),answer([{result_ref:'scene'}]),
   answer([{new:{predicate:'directions',to:'place_2',heading:'west'}}]),answer([{new:{predicate:'knowledge_status',topic:'npc_1',status:'uncertain'}}])])
  assert.equal(Check(wire,candidate),Check(canonical,candidate),JSON.stringify(candidate));
});

test('closed optional unavailable fields and arrays preserve canonical acceptance',async()=>{
 const {Type}=await import('typebox');
 const {availableOutputSchema}=await import('../../runtime/provider-output-schema.ts');
 const unavailable=Type.String({enum:[]});
 const canonical=Type.Object({optional:Type.Optional(unavailable),empty:Type.Optional(Type.Array(unavailable))},{additionalProperties:false});
 const wire=availableOutputSchema(canonical);
 for(const candidate of [{},{empty:[]},{empty:['x']},{optional:'x'},{unknown:'x'}])assert.equal(Check(wire,candidate),Check(canonical,candidate));
 assert.throws(()=>availableOutputSchema(Type.Object({required:unavailable},{additionalProperties:false})),/no valid input/);
 const body={model:'grok-4.5',input:[],tools:[{type:'web_search'}]};
 assert.equal(turnPacketProviderPayload(body,Type.Never()),body,'no output declaration means no availability work');
});
