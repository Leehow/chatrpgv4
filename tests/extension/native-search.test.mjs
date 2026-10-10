/** Transport fixtures verify native protocol seams; they are not live Keeper play. */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {nativeSearchState, clearNativeSearchState, setNativeSearchPolicy, nativeSearchPayload, nativeSearchEvent,
  nativeSearchCapability, nativeSearchStream} from '../../runtime/native-search.js';
import {getApiProvider} from '@earendil-works/pi-ai/compat';
const model={id:'deepseek-flash',provider:'deepseek-extended',name:'DeepSeek',api:'openai-responses',baseUrl:'https://api.deepseek.com',
  capabilities:{nativeSearch:{tools:['web_search']}},reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1000000,maxTokens:2048};
const policy={campaign:'campaign',worldline:'main',loop:0,run:'run',step:'step',enabled:true,allowed:true,model:'deepseek-extended/deepseek-flash'};
const note={role:'user',content:JSON.stringify({kind:'single_loop_step',native_search_scope:{run:'run',step:'step'}}),timestamp:1};
afterEach(clearNativeSearchState);
function enable(){setNativeSearchPolicy(policy);return nativeSearchState();}
function events(content,stop='end_turn',id='message-1'){
 const list=[{type:'message_start',message:{id,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:20,output_tokens:0}}}];
 for(const [index,block] of content.entries()){
  const tool=block.type==='tool_use'||block.type==='server_tool_use';
  list.push({type:'content_block_start',index,content_block:tool?{...block,input:{}}:block});
  if(tool)list.push({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
  list.push({type:'content_block_stop',index});
 }
 list.push({type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:30}},{type:'message_stop'});
 return list;
}
function sse(content,stop,id){return events(content,stop,id).map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');}
const originals=[{type:'server_tool_use',id:'srv-search',name:'web_search',input:{query:'1920s newsroom'}},
 {type:'web_search_tool_result',tool_use_id:'srv-search',content:[{type:'web_search_result',title:'Period source',url:'https://museum.example/source',encrypted_content:'opaque-source-body'}]}];
const gameTool={type:'tool_use',id:'tool-game',name:'look',input:{focus:'scene'}};
const run=nativeSearchStream((m,c,o)=>getApiProvider(m.api).streamSimple(m,c,o),{api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic'});
function options(fetch){return {apiKey:'test-only-not-a-real-key',maxTokens:2048,cacheRetention:'none',onPayload:body=>nativeSearchPayload(body,model),
 onProviderStreamEvent:(data,physical)=>nativeSearchEvent({data,provider:physical.provider,model:physical.id}),fetch};}
test('official capabilities are protocol-specific; unknown and Responses-only gateways are not inferred',()=>{
 assert.equal(nativeSearchCapability({...model,provider:'unknown'}),undefined);
 assert.equal(nativeSearchCapability({...model,provider:'grok-build',capabilities:{nativeSearch:{tools:[]}}}),undefined);
 assert.equal(nativeSearchCapability({...model,baseUrl:'https://unverified-proxy.example'}),undefined);
 assert.equal(nativeSearchCapability(model).route,'deepseek-messages');
 assert.equal(nativeSearchPayload({input:[],tools:[{type:'function',name:'web_search'}]},{...model,provider:'unknown'}),undefined);
});
test('Mod/grant/model gates remove hosted search without changing game tool declarations or forcing tool_choice',()=>{
 enable();const payload={messages:[],tools:[{name:'look',input_schema:{type:'object'}},{type:'web_search_20250305',name:'web_search'}],tool_choice:{type:'auto'}};
 const active=nativeSearchPayload(payload,model);assert(active.tools.some(t=>t.type==='web_search_20250305'));
 assert.deepEqual(active.tools[0],payload.tools[0]);assert.deepEqual(active.tool_choice,{type:'auto'});
 for(const patch of [{enabled:false},{allowed:false},{model:'another/model'}]){setNativeSearchPolicy({...policy,...patch});assert(!nativeSearchPayload(payload,model).tools.some(t=>t.type?.startsWith('web_search')));}
 setNativeSearchPolicy(policy);assert(!nativeSearchPayload({...payload,tool_choice:{type:'none'}},model).tools.some(t=>t.type?.startsWith('web_search')));
});
test('Google search uses SDK config.tools, retains game functions, and captures grounding metadata',()=>{
 setNativeSearchPolicy({...policy,model:'google/gemini-3.1-pro-preview'});
 const google={provider:'google',id:'gemini-3.1-pro-preview',api:'google-generative-ai'};
 assert.equal(nativeSearchCapability({...google,id:'gemini-2.5-pro'}),undefined,'unverified mixed built-in/function support is unavailable');
 const payload={contents:[],config:{tools:[{functionDeclarations:[{name:'look'},{name:'web_search'}]}],temperature:.2}};
 const result=nativeSearchPayload(payload,google);
 assert.equal(result.tools,undefined);assert.equal(result.config.temperature,.2);
 assert.deepEqual(result.config.tools,[{functionDeclarations:[{name:'look'}]},{googleSearch:{}}]);
 const saved=[];nativeSearchState().persist=r=>saved.push(r);
 nativeSearchEvent({provider:'google',model:'gemini-3.1-pro-preview',data:{candidates:[{groundingMetadata:{webSearchQueries:['history'],groundingChunks:[{web:{uri:'https://museum.example'}}]}}]}});
 assert.equal(saved[0].grounding.webSearchQueries[0],'history');
});
test('actual Pi Anthropic adapter: search -> game tool -> tool result -> final text preserves server pairs on the wire',async()=>{
 enable();const records=[];nativeSearchState().persist=r=>records.push(r);
 const requests=[];let n=0;
 const fetch=async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);
  return new Response(n++===0?sse([...originals,{type:'text',text:'A period detail.'},gameTool],'tool_use','message-1')
    :sse([{type:'text',text:'The investigator sees the room.'}],'end_turn','message-2'),{status:200,headers:{'content-type':'text/event-stream'}});};
 const context={messages:[note],tools:[{name:'look',description:'Read current scene',parameters:{type:'object',properties:{focus:{type:'string'}},required:['focus']}}]};
 const first=await run(model,context,options(fetch)).result();
 assert.equal(first.stopReason,'toolUse');assert.equal(first.content.find(b=>b.type==='toolCall').name,'look');
 assert(!first.content.some(b=>b.type==='toolCall'&&b.name==='web_search'),'server search is never a local tool');
 const local={role:'toolResult',toolCallId:'tool-game',toolName:'look',content:[{type:'text',text:'Actual current scene data'}],isError:false,timestamp:2};
 first.content.find(block=>block.type==='text').text='Committed host projection.';
 setNativeSearchPolicy({...policy,allowed:false});
 const final=await run(model,{...context,messages:[note,first,local]},options(fetch)).result();
 assert.equal(final.stopReason,'stop');assert.equal(final.content.at(-1).text,'The investigator sees the room.');
 assert(!requests[1].tools.some(tool=>tool.type==='web_search_20250305'),'revoked search keeps protocol replay without a new search declaration');
 const assistant=requests[1].messages.find(m=>m.role==='assistant');assert.deepEqual(assistant.content.slice(0,2),originals);
 assert(assistant.content.some(block=>block.type==='text'&&block.text==='Committed host projection.'));
 assert(!assistant.content.some(block=>block.type==='text'&&block.text==='A period detail.'),'original working prose never replaces the host projection');
 assert(assistant.content.some(b=>b.type==='tool_use'&&b.id==='tool-game'));
 assert(requests[1].messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(b=>b.type==='tool_result'&&b.tool_use_id==='tool-game')));
 assert(records.length);assert.equal(requests.length,2);
});
test('session replay restores retained evidence but another model, worldline or compacted message cannot receive it',()=>{
 enable();nativeSearchPayload({messages:[]},model);
 for(const data of events([...originals,{type:'text',text:'A period detail.'},gameTool],'tool_use'))nativeSearchEvent({data,provider:model.provider,model:model.id});
 const input={messages:[{role:'assistant',content:[{type:'text',text:'A period detail.'},gameTool]}]};
 assert.equal(nativeSearchPayload(input,model).messages[0].content[0].type,'server_tool_use');
 setNativeSearchPolicy({...policy,worldline:'different'});assert.equal(nativeSearchPayload(input,model).messages[0].content[0].type,'text');
 setNativeSearchPolicy(policy);assert.deepEqual(nativeSearchPayload({messages:[]},model).messages,[]);
});
test('pause_turn continues inside the same provider inference with original search blocks',async()=>{
 enable();let count=0;const requests=[];
 const fetch=async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(count++===0
  ?sse([...originals,{type:'text',text:'Checking sources.'}],'pause_turn','paused')
  :sse([{type:'text',text:'Complete.'}],'end_turn','completed'),{status:200,headers:{'content-type':'text/event-stream'}});};
 const source=run(model,{messages:[note]},options(fetch));const emitted=[];for await(const event of source)emitted.push(event);
 const result=await source.result();
 assert.equal(emitted.filter(event=>event.type==='start').length,1,'Pi receives one assistant start across native pause continuation');
 assert.equal(emitted.filter(event=>event.type==='done').length,1);
 assert.equal(result.usage.input,40);assert.equal(result.usage.output,60);
 assert.equal(result.stopReason,'stop');assert.equal(count,2);
 assert.equal(requests[1].messages.find(m=>m.role==='assistant').content[0].type,'server_tool_use');
 assert.equal(nativeSearchState().carry.length,0);
});
test('child lanes and unrelated DeepSeek calls keep their existing transport and do not inherit a foreground grant',async()=>{
 enable();let delegated=false;
 const wrapper=nativeSearchStream(()=>{delegated=true;return 'original-transport';},{api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic'});
 assert.equal(wrapper(model,{messages:[{role:'user',content:'A child lane question'}]},{}),'original-transport');assert(delegated);
});
test('OpenAI/Codex native output restores annotations and server search items before local tool results',()=>{
 const codex={provider:'openai-codex',id:'codex',api:'openai-codex-responses'};
 setNativeSearchPolicy({...policy,model:'openai-codex/codex'});
 nativeSearchPayload({input:[],tools:[{type:'function',name:'look'}]},codex);
 const output=[{type:'web_search_call',id:'search-native',status:'completed',action:{type:'search',query:'history'}},
 {type:'message',role:'assistant',content:[{type:'output_text',text:'Source-backed detail.',annotations:[{type:'url_citation',url:'https://museum.example'}]}]},
 {type:'function_call',id:'fc-look',call_id:'look-call',name:'look',arguments:'{\"focus\": \"scene\"}'}];
 nativeSearchEvent({provider:'openai-codex',model:'codex',data:{type:'response.completed',response:{id:'response',status:'completed',output}}});
 const input=[{...output[1],content:[{type:'output_text',text:'Source-backed detail.',annotations:[]}]},{...output[2],arguments:'{\"focus\":\"scene\"}'},{type:'function_call_output',call_id:'look-call',output:'Current scene'}];
 const result=nativeSearchPayload({input},codex);
 assert.equal(result.input[0].type,'web_search_call');assert.equal(result.input[1].content[0].annotations[0].url,'https://museum.example');
 assert.equal(result.input.at(-1).type,'function_call_output');
});

test('the native-search launch mount has a required emitted runtime entry',async()=>{
 const {readFileSync}=await import('node:fs');
 const manifest=JSON.parse(readFileSync('pipicoc/runtime-dependencies.json','utf8'));
 const {runtimeEntrypoints}=await import('../../runtime/deployment.mjs');
 const root=process.cwd();const entry=runtimeEntrypoints(root).extensions.find(path=>path.endsWith('/native-search/index.mjs'));
 assert(entry);assert(manifest.requiredEntries.includes(entry.slice(root.length+1)));
});

test('DeepSeek fallback Responses never advertises a search tool that its server ignores',()=>{
 enable();const result=nativeSearchPayload({input:[],tools:[{type:'function',name:'look'}]},model);
 assert(!result.tools.some(tool=>tool.type==='web_search'));
});

test('late results after a campaign/run change are not persisted or delivered to another table',()=>{
 enable();nativeSearchPayload({messages:[]},model);const saved=[];nativeSearchState().persist=r=>saved.push(r);
 setNativeSearchPolicy({...policy,campaign:'other',run:'other-run'});
 for(const data of events([...originals,{type:'text',text:'Old scene detail.'}]))nativeSearchEvent({data,provider:model.provider,model:model.id});
 assert.equal(saved.length,0);assert.equal(nativeSearchState().records.length,0);
});

test('an oversized optional search result closes search for the run without throwing or disabling game tools',()=>{
 enable();nativeSearchPayload({messages:[]},model);const oversized=[originals[0],{...originals[1],content:[{type:'web_search_result',url:'https://museum.example',encrypted_content:'x'.repeat(1048576)}]},{type:'text',text:'A detail.'},gameTool];
 assert.doesNotThrow(()=>{for(const data of events(oversized,'tool_use'))nativeSearchEvent({data,provider:model.provider,model:model.id});});
 setNativeSearchPolicy(policy);const body=nativeSearchPayload({messages:[],tools:[{name:'look',input_schema:{type:'object'}}]},model);
 assert(body.tools.some(tool=>tool.name==='look'));assert(!body.tools.some(tool=>tool.type==='web_search_20250305'));
});
