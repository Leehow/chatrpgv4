import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from './pi.mjs';
import {AuthStorage} from '../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import {streamSimple as anthropicStream} from '@earendil-works/pi-ai/api/anthropic-messages';
import extension,{miniMaxStream} from '../../extensions/minimax-enhanced/agent/index.js';
import {minimaxImageAdapter,createVideo,queryVideo,videoBody} from '../../extensions/minimax-enhanced/agent/media.js';
import {createMiniMaxHostLibrary} from '../../extensions/minimax-enhanced/agent/host.js';
import {enabledInHost,mediaOrigin} from '../../extensions/minimax-enhanced/agent/config.js';
import {createImageGenExtension,generateImage} from '../../extensions/image-gen/agent/index.js';
import {routeImageModel} from '../../extensions/image-gen/agent/vendors.js';
import {nativeSearchCapability,nativeSearchState,clearNativeSearchState,setNativeSearchPolicy,nativeSearchPayload,nativeSearchEvent} from '../../runtime/native-search.js';
import {agentExtensionManifests,runtimeEntrypoints,sessionExtensionPaths,desktopSessionExtensionPaths,readerProviderExtensionPaths} from '../../runtime/deployment.mjs';
import {registerSheetPanel} from '../../pipicoc/sheet.ts';
import {registerIllustrationPanel} from '../../pipicoc/illustration.ts';

const base=JSON.parse(readFileSync(new URL('../../node_modules/@earendil-works/pi-ai/dist/providers/data/minimax-cn.json',import.meta.url)))['anthropic-messages']['chat:MiniMax-M2.7'];
const model={...base,id:'MiniMax-M3.1-Flash-Preview',compat:{forceAdaptiveThinking:true}};
const key='synthetic-key-DO-NOT-EXPOSE';
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
const credentials={apiKey:key,provider:'minimax-cn',baseUrl:model.baseUrl};
const prompt={prompt:'A lantern at a rainy station.'};
const policy={campaign:'campaign',worldline:'main',loop:0,run:'run',step:'step',enabled:true,allowed:true,model:`${model.provider}/${model.id}`};
const note={role:'user',content:JSON.stringify({native_search_scope:{run:'run',step:'step'}}),timestamp:0};
const context={model,modelRegistry:{getAll:()=>[model],getApiKeyForProvider:async provider=>provider===model.provider?key:undefined}};
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const owned=[];
afterEach(()=>{for(const f of owned.splice(0))f.shutdown();clearNativeSearchState();});
function fixture(extra={}) {
  const hooks=new Map(),commands=new Map(),rows=[],registrations=[];
  const pi={events:new EventEmitter(),registerProvider:(id,value)=>registrations.push({id,value}),
    on:(name,handler)=>hooks.set(name,[...(hooks.get(name)??[]),handler]),registerCommand:(name,value)=>commands.set(name,value),
    appendEntry:(customType,data)=>rows.push({type:'custom',customType,data})};
  extension(pi,{env:{},...extra});
  const f={hooks,commands,rows,registrations,shutdown:()=>{for(const fn of hooks.get('session_shutdown')??[])fn();}};
  owned.push(f);return f;
}
function frames(blocks,stop='end_turn',id='mini-response') {
  const values=[{type:'message_start',message:{id,type:'message',role:'assistant',model:model.id,content:[],usage:{input_tokens:20,output_tokens:0}}}];
  for(const [index,block]of blocks.entries()) {
    const tool=['tool_use','server_tool_use'].includes(block.type);
    values.push({type:'content_block_start',index,content_block:tool?{...block,input:{}}:block});
    if(tool)values.push({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
    values.push({type:'content_block_stop',index});
  }
  values.push({type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:30}},{type:'message_stop'});
  return values.map(value=>`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join('');
}

test('disabled host installs no provider override, capability, command or credential store',()=>{
  const f=fixture({env:{PIPIUI_HOST_PROTOCOL:'1',PIPIUI_MOUNTED_EXTENSIONS:'kernel,anthropic-cache'}});
  assert.deepEqual(f.registrations,[]);assert.equal(f.commands.size,0);
  assert.equal(nativeSearchCapability(model),undefined);
  assert.equal(enabledInHost({PIPIUI_HOST_PROTOCOL:'1',PIPIUI_MOUNTED_EXTENSIONS:'minimax-enhanced'}),true);
});
test('stream-only overrides retain the built-in accounts/catalog and declare official-origin search only',()=>{
  const f=fixture();
  assert.deepEqual(f.registrations.map(row=>row.id),['minimax-cn','minimax']);
  for(const {value}of f.registrations)assert.deepEqual(Object.keys(value).sort(),['api','streamSimple']);
  assert.equal(nativeSearchCapability(model).exactReplay,true);
  assert.equal(nativeSearchCapability({...model,baseUrl:'https://unverified.example'}),undefined);
  assert.equal(nativeSearchCapability({...model,api:'openai-completions'}),undefined);
  assert.equal(nativeSearchCapability(base),undefined,'older MiniMax models do not acquire beta server search');
  f.shutdown();assert.equal(nativeSearchCapability(model),undefined);
});
test('real Pi serialization retains unsigned MiniMax thinking, original tools and selected effort',async()=>{
  fixture();const wires=[];
  const previous={role:'assistant',api:model.api,provider:model.provider,model:model.id,stopReason:'toolUse',timestamp:0,
    usage:{input:10,output:10,cacheRead:0,cacheWrite:0,totalTokens:20,cost:{total:0}},
    content:[{type:'thinking',thinking:'Private tool reasoning.'},{type:'toolCall',id:'look_1',name:'look',arguments:{focus:'scene'}}]};
  const result=await miniMaxStream()(model,{messages:[{role:'system',content:'Keeper instructions',timestamp:0},previous,
    {role:'toolResult',toolCallId:'look_1',toolName:'look',content:[{type:'text',text:'Current scene'}],isError:false,timestamp:0}]},
  {apiKey:key,reasoning:'high',maxTokens:128,fetch:async(_url,init)=>{wires.push(JSON.parse(init.body));return new Response(frames([{type:'text',text:'Done.'}]),{headers:{'content-type':'text/event-stream'}});}}).result();
  assert.notEqual(result.stopReason,'error',result.errorMessage);
  assert.equal(wires[0].messages[0].content[0].type,'thinking');
  assert.equal(wires[0].messages[0].content[0].thinking,'Private tool reasoning.');
  assert.equal(wires[0].messages[0].content[1].id,'look_1');
  assert.equal(wires[0].output_config.effort,'high');
  assert.equal(wires[0].max_tokens,128);
});
test('granted search has the documented declaration and exact interleaved replay through the actual SDK',async()=>{
  fixture();setNativeSearchPolicy(policy);
  const originals=[{type:'thinking',thinking:'Before search.'},{type:'text',text:'Looking up a source.'},
    {type:'server_tool_use',id:'search_1',name:'web_search',input:{query:'1920s station lamps'}},
    {type:'web_search_tool_result',tool_use_id:'search_1',content:[{type:'web_search_result',title:'Museum',url:'https://museum.example/lamps',content:'Period source'}]},
    {type:'thinking',thinking:'After search.'},{type:'text',text:'The source is available.'},
    {type:'tool_use',id:'look_1',name:'look',input:{focus:'scene'}}];
  const wires=[];let index=0;
  const opts={apiKey:key,maxTokens:1024,onPayload:body=>nativeSearchPayload(body,model),
    onProviderStreamEvent:(data,physical)=>nativeSearchEvent({provider:physical.provider,model:physical.id,data}),
    fetch:async(_url,init)=>{wires.push(JSON.parse(init.body));return new Response(index++?frames([{type:'text',text:'Done.'}]):frames(originals,'tool_use'),{headers:{'content-type':'text/event-stream'}});}};
  const stream=miniMaxStream();
  const first=await stream(model,{messages:[note]},opts).result();
  assert.notEqual(first.stopReason,'error',first.errorMessage);
  assert.deepEqual(wires[0].tools.at(-1),{type:'web_search_20250305',name:'web_search'});
  const record=nativeSearchState().records[0];assert.equal(record.exactReplay,true);
  const second=await stream(model,{messages:[note,first,{role:'toolResult',toolCallId:'look_1',toolName:'look',content:[{type:'text',text:'Current scene'}],isError:false,timestamp:1}]},opts).result();
  assert.notEqual(second.stopReason,'error',second.errorMessage);
  assert.deepEqual(wires[1].messages.find(row=>row.role==='assistant').content,originals);
  const replay=wires[1].messages.find(row=>row.role==='assistant');
  const changed=structuredClone(replay);changed.content.find(block=>block.type==='text').text='A changed private projection.';
  const withoutServer={...changed,content:changed.content.filter(block=>!['server_tool_use','web_search_tool_result'].includes(block.type))};
  const after=nativeSearchPayload({model:model.id,messages:[withoutServer]},model);
  assert.deepEqual(after.messages[0].content,withoutServer.content,'matching tools alone cannot restore changed text');
  for(const patch of [{allowed:false},{enabled:false},{model:'other/model'}]){
    setNativeSearchPolicy({...policy,...patch});
    assert.ok(!nativeSearchPayload({messages:[],tools:[]},model).tools.some(tool=>tool.name==='web_search'));
  }
});
test('mixed client and deferred server tools retain exact continuation without inventing a result',async()=>{
  fixture();setNativeSearchPolicy(policy);
  const originals=[{type:'thinking',thinking:'Check the room and the public archive.'},
    {type:'tool_use',id:'local_deferred',name:'look',input:{focus:'scene'}},
    {type:'server_tool_use',id:'search_deferred',name:'web_search',input:{query:'historic public reading rooms'}}];
  const wires=[];let index=0;
  const opts={apiKey:key,maxTokens:1024,onPayload:body=>nativeSearchPayload(body,model),
    onProviderStreamEvent:(data,physical)=>nativeSearchEvent({provider:physical.provider,model:physical.id,data}),
    fetch:async(_url,init)=>{wires.push(JSON.parse(init.body));return new Response(index++
      ?frames([{type:'web_search_tool_result',tool_use_id:'search_deferred',content:[{type:'web_search_result',title:'Archive',url:'https://archive.example/room',content:'Historical record'}]},{type:'text',text:'The archive is available.'}])
      :frames(originals,'tool_use'),{headers:{'content-type':'text/event-stream'}});}};
  const stream=miniMaxStream(),first=await stream(model,{messages:[note]},opts).result();
  assert.notEqual(first.stopReason,'error',first.errorMessage);
  assert.equal(nativeSearchState().records.length,1,'deferred server work is a valid continuation, not corrupt history');
  assert.deepEqual(nativeSearchState().records[0].content,originals);
  assert.equal(nativeSearchState().records[0].sources?.length??0,0,'a pending call is not a search result');
  const next=await stream(model,{messages:[note,first,{role:'toolResult',toolCallId:'local_deferred',toolName:'look',content:[{type:'text',text:'A public room'}],isError:false,timestamp:1}]},opts).result();
  assert.notEqual(next.stopReason,'error',next.errorMessage);
  assert.deepEqual(wires[1].messages.find(row=>row.role==='assistant').content,originals);
  assert(wires[1].tools.some(tool=>tool.name==='web_search'));
  assert.equal(wires[1].messages.filter(row=>row.role==='user').flatMap(row=>row.content??[]).filter(block=>block.tool_use_id==='search_deferred').length,0,'the host never fabricates a server result');
  assert.equal(nativeSearchState().records.length,2);
  const supplemental={role:'user',content:[{type:'text',text:'Fresh host context: no journey is settled.'}],timestamp:2};
  await stream(model,{messages:[note,first,{role:'toolResult',toolCallId:'local_deferred',toolName:'look',content:[{type:'text',text:'A public room'}],isError:false,timestamp:1},supplemental]},opts).result();
  const follow=wires[2].messages.findLast(row=>row.role==='user');
  assert.deepEqual(follow.content.map(b=>b.type),['tool_result'],'pending server continuation has no top-level host text');
  const contextBlock=follow.content[0].content.find(b=>b.type==='text'&&b.text.includes('conversation_context'));
  assert(contextBlock,'supplementary context is preserved as user-role context, never fabricated search output');
  assert.match(JSON.stringify(follow.content[0].content),/no journey is settled/);
  assert.deepEqual(wires[2].messages.find(row=>row.role==='assistant').content,originals);
});
// el-v2-a turn 12 (events.jsonl 8913/9272/9501/9513): the host's request ceiling cut the response that issued a
// deferred server search while keeping the next response, whose first block is that search's result.
const deferredCall={type:'server_tool_use',id:'call_function_35x4msu7q1yn_4',name:'web_search',input:{query:'1920s Boston horse-drawn cab fare price per trip'}};
const deferredFirst=[{type:'thinking',thinking:'Check both people and the office before the cab ride.'},
  {type:'tool_use',id:'call_function_35x4msu7q1yn_1',name:'look',input:{focus:'npc',name:'看房的中间人'}},
  {type:'tool_use',id:'call_function_35x4msu7q1yn_2',name:'look',input:{focus:'npc',name:'史蒂文·诺特'}},
  {type:'tool_use',id:'call_function_35x4msu7q1yn_3',name:'place',input:{action:'inspect',name:'commission-briefing',need:'context'}},deferredCall];
const deferredSecond=[{type:'web_search_tool_result',tool_use_id:deferredCall.id,content:[{type:'web_search_result',title:'Is the Fare Fair? Taximeter Testing in the 1920s',url:'https://nist.example/fare',content:'Period fares'}]},
  {type:'thinking',thinking:'The fare is known; settle the ride.'},
  {type:'tool_use',id:'call_function_jthfcym6nugf_1',name:'apply',input:{effects:[{kind:'cash',mode:'settle'}]}}];
const deferredThird=[{type:'thinking',thinking:'Look up the ledger and settle again.'},
  {type:'tool_use',id:'call_function_bok0tglm9swe_1',name:'lookup',input:{query:'fare'}},
  {type:'tool_use',id:'call_function_bok0tglm9swe_2',name:'apply',input:{effects:[]}}];
const toolResult=(toolCallId,toolName,text)=>({role:'toolResult',toolCallId,toolName,content:[{type:'text',text}],isError:false,timestamp:1});
const contentOf=message=>Array.isArray(message.content)?message.content:[];
/** MiniMax rejects (2013) a server result whose server call is absent earlier in the request. */
function orphanServerResult(body) {
  const calls=new Set();
  for(const message of body.messages)for(const block of contentOf(message)){
    if(block.type==='server_tool_use')calls.add(block.id);
    if(block.type==='web_search_tool_result'&&!calls.has(block.tool_use_id))return block.tool_use_id;
  }
}
/** A server call may stay unanswered only in the last assistant message (a deferred continuation). */
function abandonedServerCall(body) {
  const assistants=body.messages.filter(message=>message.role==='assistant');
  const results=new Set(assistants.flatMap(contentOf).filter(b=>b.type==='web_search_tool_result').map(b=>b.tool_use_id));
  return assistants.slice(0,-1).flatMap(contentOf).find(b=>b.type==='server_tool_use'&&!results.has(b.id))?.id;
}
function deferredTable() {
  fixture();setNativeSearchPolicy(policy);
  const wires=[],reports=[],responses=[[deferredFirst,'tool_use','resp-call'],[deferredSecond,'tool_use','resp-result'],[deferredThird,'tool_use','resp-plain']];
  nativeSearchState().report=row=>reports.push(row);
  const opts={apiKey:key,maxTokens:1024,onPayload:body=>nativeSearchPayload(body,model),
    onProviderStreamEvent:(data,physical)=>nativeSearchEvent({provider:physical.provider,model:physical.id,data}),
    fetch:async(_url,init)=>{
      const body=JSON.parse(init.body);wires.push(body);const orphan=orphanServerResult(body);
      if(orphan)return new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:`invalid params, tool result's tool id(${orphan}) not found (2013)`}}),{status:400,headers:{'content-type':'application/json'}});
      const next=responses.shift()??[[{type:'text',text:'Done.'}],'end_turn','resp-final'];
      return new Response(frames(...next),{headers:{'content-type':'text/event-stream'}});
    }};
  return {wires,reports,opts,stream:miniMaxStream()};
}
test('a trimmed deferred-call response keeps its server result paired on the next MiniMax request',async()=>{
  const {wires,reports,opts,stream}=deferredTable();
  const first=await stream(model,{messages:[note]},opts).result();
  assert.notEqual(first.stopReason,'error',first.errorMessage);
  const looks=[toolResult('call_function_35x4msu7q1yn_1','look','A broker waits.'),toolResult('call_function_35x4msu7q1yn_2','look','Knott is out.'),
    toolResult('call_function_35x4msu7q1yn_3','place','The office.')];
  const host={role:'user',content:[{type:'text',text:'Fresh host context for this step.'}],timestamp:1};
  const second=await stream(model,{messages:[note,first,...looks,host]},opts).result();
  assert.notEqual(second.stopReason,'error',second.errorMessage);
  const settled=toolResult('call_function_jthfcym6nugf_1','apply','refused');
  const third=await stream(model,{messages:[note,first,...looks,second,settled]},opts).result();
  assert.notEqual(third.stopReason,'error',third.errorMessage);
  assert.deepEqual(wires[2].messages.filter(row=>row.role==='assistant').map(row=>row.content),[deferredFirst,deferredSecond],'untrimmed history replays both halves in place');
  // The host's ceiling drops the oldest pair-safe step: the call's response and its three local results.
  const trimmed=[note,second,settled,third,toolResult('call_function_bok0tglm9swe_1','lookup','none'),toolResult('call_function_bok0tglm9swe_2','apply','ok')];
  const final=await stream(model,{messages:trimmed},opts).result();
  assert.notEqual(final.stopReason,'error',final.errorMessage);
  assert.equal(final.content.at(-1).text,'Done.');
  const wire=wires[3];
  assert.equal(orphanServerResult(wire),undefined);assert.equal(abandonedServerCall(wire),undefined);
  const carrier=wire.messages.find(row=>contentOf(row).some(b=>b.type==='web_search_tool_result'));
  assert.deepEqual(carrier.content,[deferredCall,...deferredSecond],'the result keeps its own original call, immediately before it');
  assert.equal(wire.messages.flatMap(contentOf).filter(b=>b.type==='server_tool_use').length,1);
  assert.ok(reports.some(row=>row.event==='server_call_reanchored'&&row.server_id===deferredCall.id
    &&row.response_id==='resp-result'&&row.call_response_id==='resp-call'));
});
test('an unrestorable server pair half is omitted together with its partner and reported',async()=>{
  const {wires,reports,opts,stream}=deferredTable();
  const first=await stream(model,{messages:[note]},opts).result();
  const looks=[toolResult('call_function_35x4msu7q1yn_1','look','A broker waits.'),toolResult('call_function_35x4msu7q1yn_2','look','Knott is out.'),
    toolResult('call_function_35x4msu7q1yn_3','place','The office.')];
  const second=await stream(model,{messages:[note,first,...looks]},opts).result();
  assert.notEqual(second.stopReason,'error',second.errorMessage);
  const settled=toolResult('call_function_jthfcym6nugf_1','apply','refused');
  const records=[...nativeSearchState().records];
  // The call's journal record is gone (for example past the 64-record bound): its result cannot be re-paired.
  nativeSearchState().records=records.filter(record=>record.responseId!=='resp-call');
  const orphaned=await stream(model,{messages:[note,second,settled]},opts).result();
  assert.notEqual(orphaned.stopReason,'error',orphaned.errorMessage);
  assert.deepEqual(wires[2].messages.find(row=>row.role==='assistant').content,deferredSecond.slice(1),'neither half reaches the provider');
  assert.ok(reports.some(row=>row.event==='server_pair_omitted'&&row.reason==='server_call_absent'&&row.server_id===deferredCall.id&&row.response_id==='resp-result'));
  // The result's journal record is gone: the call cannot stay open once a later response has been sent.
  nativeSearchState().records=records.filter(record=>record.responseId!=='resp-result');
  await stream(model,{messages:[note,first,...looks,second,settled]},opts).result();
  const wire=wires[3];
  assert.equal(abandonedServerCall(wire),undefined);assert.equal(orphanServerResult(wire),undefined);
  assert.deepEqual(wire.messages.find(row=>row.role==='assistant').content,deferredFirst.slice(0,-1));
  assert.ok(reports.some(row=>row.event==='server_pair_omitted'&&row.reason==='server_result_absent'&&row.server_id===deferredCall.id&&row.response_id==='resp-call'));
});
test('incomplete MiniMax server pairs without a continuation are unavailable',()=>{
  fixture();setNativeSearchPolicy(policy);
  const blocks=[{type:'thinking',thinking:'Before tool.'},{type:'tool_use',id:'local_1',name:'look',input:{}},{type:'server_tool_use',id:'search_1',name:'web_search',input:{query:'Boston telephone 1920'}}];
  const reports=[];nativeSearchState().report=row=>reports.push(row);
  nativeSearchPayload({model:model.id,messages:[note],tools:[]},model);
  for(const [index,content_block]of blocks.entries())nativeSearchEvent({provider:model.provider,model:model.id,data:{type:'content_block_start',index,content_block}});
  nativeSearchEvent({provider:model.provider,model:model.id,data:{type:'message_delta',delta:{stop_reason:'end_turn'}}});
  nativeSearchEvent({provider:model.provider,model:model.id,data:{type:'message_stop'}});
  assert.equal(nativeSearchState().records.length,0);
  assert.ok(reports.some(row=>row.reason==='incomplete_server_protocol'));
  const next=nativeSearchPayload({model:model.id,messages:[note],tools:[]},model);
  assert.ok(!next.tools.some(tool=>tool.name==='web_search'));
});
test('multiple suspended server-only responses replay their own segments and retain one complete external history',async()=>{
  fixture();setNativeSearchPolicy(policy);const wires=[];let index=0;
  const call=id=>({type:'server_tool_use',id,name:'web_search',input:{query:'A public historical detail'}});
  const result=id=>({type:'web_search_tool_result',tool_use_id:id,content:[]});
  const segments=[[call('pause_1')],[result('pause_1'),call('pause_2')],[result('pause_2'),{type:'tool_use',id:'after_pauses',name:'look',input:{focus:'scene'}}]];
  const opts={apiKey:key,maxTokens:1024,onPayload:body=>nativeSearchPayload(body,model),
    onProviderStreamEvent:(data,physical)=>nativeSearchEvent({provider:physical.provider,model:physical.id,data}),
    fetch:async(_url,init)=>{wires.push(JSON.parse(init.body));const step=index++;return new Response(step<3?frames(segments[step],step<2?'pause_turn':'tool_use'):frames([{type:'text',text:'Finished.'}]),{headers:{'content-type':'text/event-stream'}});}};
  const stream=miniMaxStream(),first=await stream(model,{messages:[note]},opts).result();
  assert.notEqual(first.stopReason,'error',first.errorMessage);assert.equal(wires.length,3);
  assert.deepEqual(wires[2].messages.filter(row=>row.role==='assistant').map(row=>row.content),segments.slice(0,2));
  const final=await stream(model,{messages:[note,first,{role:'toolResult',toolCallId:'after_pauses',toolName:'look',content:[{type:'text',text:'Current room'}],isError:false,timestamp:1}]},opts).result();
  assert.notEqual(final.stopReason,'error',final.errorMessage);
  assert.deepEqual(wires[3].messages.find(row=>row.role==='assistant').content,segments.flat());
});
test('old incomplete MiniMax journal records cannot overwrite a matching local-tool message',()=>{
  fixture();setNativeSearchPolicy(policy);
  const local={type:'tool_use',id:'local_1',name:'look',input:{}};
  const fingerprint=createHash('sha256').update(JSON.stringify([['tool',local.id,local.name,local.input]])).digest('hex');
  nativeSearchState().records.push({...policy,model:policy.model,api:model.api,exactReplay:true,fingerprint,
    content:[local,{type:'server_tool_use',id:'search_1',name:'web_search',input:{query:'Boston 1920'}}],terminal:'tool_use'});
  const message={role:'assistant',content:[local]};
  const result=nativeSearchPayload({model:model.id,messages:[message],tools:[]},model);
  assert.deepEqual(result.messages[0],message);
});
test('image gen and subject-reference edit use the official body, one base64 result and no asset download',async()=>{
  const calls=[],fetchImpl=async(url,init)=>{calls.push({url,init});return json({data:{image_base64:[png.toString('base64')]},base_resp:{status_code:0}});};
  for(const kind of ['gen','edit']){
    const image=await minimaxImageAdapter({kind,model:'image-01',...prompt,aspectRatio:'3:4',images:['data:image/png;base64,'+png.toString('base64')]},credentials,{fetchImpl});
    assert.deepEqual(image.bytes,png);assert.equal(image.mime,'image/png');
  }
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://api.minimaxi.com/v1/image_generation');
  const first=JSON.parse(calls[0].init.body),second=JSON.parse(calls[1].init.body);
  assert.deepEqual(first,{model:'image-01',...prompt,n:1,response_format:'base64',prompt_optimizer:false,aspect_ratio:'3:4'});
  assert.equal(second.subject_reference[0].type,'character');
  assert.equal(calls[0].init.headers.authorization,'Bearer '+key);
  assert.equal(calls[0].init.redirect,'error');
});
test('existing image tools and host portrait entry route explicit MiniMax without changing automatic defaults',async t=>{
  assert.equal(routeImageModel('minimax-cn','image-01'),'minimax');
  const tools=new Map(),calls=[];
  const ctx={...context,modelRegistry:{...context.modelRegistry,find:()=>undefined}};
  const deps={grok:{usable:async()=>{throw Error('Explicit MiniMax must not fall through');}},
    readConfiguredModel:()=>({model:'minimax-cn/image-01'}),fetchImpl:async(url,init)=>{calls.push({url,init});return json({data:{image_base64:[png.toString('base64')]}});},
    makeWriter:()=>({save:async()=>({path:'/synthetic/image.png',mime:'image/png'})})};
  createImageGenExtension(deps)({registerTool:tool=>tools.set(tool.name,tool),registerCommand(){}});
  const result=await tools.get('image_gen').execute('call',prompt,undefined,undefined,ctx);
  assert.equal(result.details.backend,'minimax');assert.equal(result.details.path,'/synthetic/image.png');
  assert.equal(calls.length,1);
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=deps.fetchImpl;
  const portrait=await generateImage(ctx,{kind:'gen',model:'minimax-cn/image-01',...prompt});
  assert.equal(portrait.backend,'minimax');assert.deepEqual(portrait.bytes,png);
  assert.equal(calls.length,2,'the actual shared portrait entry reaches the same adapter');
});

test('actual portrait and scene host controls share MiniMax selection, storage and character reference',async t=>{
  const home=await mkdtemp(join(tmpdir(),'minimax-host-controls-'));
  const keys=['PI_COC_AGENT_DIR','PI_CODING_AGENT_DIR'];
  const priorEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const symbol=Symbol.for('pipiui.ext-invoke.registry'),priorRegistry=globalThis[symbol],priorFetch=globalThis.fetch;
  t.after(()=>{globalThis[symbol]=priorRegistry;globalThis.fetch=priorFetch;for(const key of keys){if(priorEnv[key]===undefined)delete process.env[key];else process.env[key]=priorEnv[key];}});
  for(const key of keys)process.env[key]=home;
  await writeFile(join(home,'image-model.json'),JSON.stringify({model:'minimax-cn/image-01'}));
  await mkdir(join(home,'.coc','campaigns','image-test'),{recursive:true});
  const handlers=new Map(),hooks=new Map(),calls=[];
  globalThis[symbol]={version:1,register(_id,method,handler){handlers.set(method,handler);return()=>{};}};
  globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.minimaxi.com/v1/image_generation');calls.push(JSON.parse(init.body));return json({data:{image_base64:[png.toString('base64')]}});};
  const pi={events:new EventEmitter(),on(name,handler){hooks.set(name,[...(hooks.get(name)??[]),handler]);}};
  registerSheetPanel(pi);
  const panel=registerIllustrationPanel(pi,{runner:async request=>{await writeFile(join(request.cwd,'prompt.json'),JSON.stringify({prompt:'A period investigator beneath a street lamp; match the portrait reference.'}));return {ok:true,code:0};}});
  const hostContext={...context,modelRegistry:{...context.modelRegistry,find:()=>undefined}};
  for(const hook of hooks.get('session_start'))await hook({},hostContext);
  pi.events.emit('coc:kernel-bridge',{campaign:'image-test',runtime:{home,contentRoot:home,signal:new AbortController().signal},call:async()=>({play_language:'en',investigators:[{name:'Test investigator',era:'1920s',backstory:{personal_description:'A man with a narrow face and round spectacles.'}}]})});
  pi.events.emit('coc:table-open',{campaign:'image-test',open:{campaign:{play_language:'en'}}});
  const portrait=await handlers.get('sheet')({portrait:'generate'});
  assert.equal(portrait.status,'ready',portrait.reason);assert.match(portrait.identity_art.portrait,/^data:image\/png;base64,/);
  assert.deepEqual(await readFile(join(home,'.coc','campaigns','image-test','portrait.png')),png);
  assert.deepEqual(await handlers.get('illustration.generate')({messageId:'scene-one',text:'The investigator stands beneath a street lamp.'}),{status:'generating'});
  await panel.settled();
  const index=JSON.parse(await readFile(join(home,'.coc','campaigns','image-test','illustrations','index.json')));
  assert.deepEqual(await readFile(join(home,'.coc','campaigns','image-test','illustrations',index['scene-one'])),png);
  assert.equal(calls.length,2);assert.equal(calls[0].subject_reference,undefined);
  assert.equal(calls[1].subject_reference[0].type,'character');
  assert.equal(calls[1].subject_reference[0].image_file,portrait.identity_art.portrait);
  assert.ok(calls.every(body=>body.model==='image-01'&&body.aspect_ratio==='3:4'));
});
test('invalid media combinations and unverified endpoints refuse before any network call',async()=>{
  const fetchImpl=async()=>{throw Error('Unexpected request');};
  assert.throws(()=>mediaOrigin('http://api.minimax.cn'),/official HTTPS/);
  assert.throws(()=>mediaOrigin('https://evil.example'),/official HTTPS/);
  assert.throws(()=>mediaOrigin('https://api.minimax.cn/custom-prefix'),/official HTTPS/);
  await assert.rejects(minimaxImageAdapter({kind:'gen',model:'image-01-live',...prompt,aspectRatio:'21:9'},credentials,{fetchImpl}),/ratio/);
  await assert.rejects(minimaxImageAdapter({kind:'gen',model:'image-01',prompt:'a'.repeat(1501)},credentials,{fetchImpl}),/prompt/);
  for(const req of [{model:'MiniMax-H3-Max',resolution:'2K'},{model:'MiniMax-H3-Max',duration:4},{duration:16},{aspect_ratio:'adaptive'}])assert.throws(()=>videoBody({...prompt,...req}));
  await assert.rejects(createMiniMaxHostLibrary(context,{env:{PIPIUI_HOST_PROTOCOL:'1'},fetchImpl}).createVideo(prompt),/disabled/);
});
test('H3 submission returns a durable ID and query returns an HTTPS link without polling or downloading video',async()=>{
  const calls=[],fetchImpl=async(url,init)=>{calls.push({url,init});return calls.length===1?json({task_id:'task_1'}):json({task:{id:'task_1',model:'MiniMax-H3',status:'succeeded',content:{url:'https://video.example/result.mp4'}}});};
  const created=await createVideo({...prompt,first_frame:'https://images.example/frame.png'},credentials,{fetchImpl});
  assert.deepEqual(created,{task_id:'task_1',model:'MiniMax-H3',status:'submitted'});
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.ratio,'adaptive');assert.equal(body.content[1].role,'first_frame');
  assert.equal(calls[0].url,'https://api.minimaxi.com/v2/video_generation');
  const result=await queryVideo('task_1',credentials,{fetchImpl});
  assert.equal(result.url,'https://video.example/result.mp4');
  assert.equal(calls.length,2);assert.equal(calls[1].init.method,'GET');
  assert.equal(calls[1].url,'https://api.minimaxi.com/v2/query/video_generation/task_1');
});
test('HTTP, provider and invalid-result errors never expose keys, retry creation or switch accounts',async()=>{
  let count=0;
  await assert.rejects(createVideo(prompt,credentials,{fetchImpl:async()=>{count++;return new Response(key,{status:402});}}),error=>!error.message.includes(key)&&error.message.includes('402'));
  assert.equal(count,1);
  await assert.rejects(minimaxImageAdapter({kind:'gen',model:'image-01',...prompt},credentials,{fetchImpl:async()=>json({base_resp:{status_code:1008,status_msg:key}})}),error=>!error.message.includes(key)&&error.message.includes('1008'));
  await assert.rejects(queryVideo('task_1',credentials,{fetchImpl:async()=>json({task:{id:'other',status:'succeeded'}})}),/does not match/);
  await assert.rejects(queryVideo('task_1',credentials,{fetchImpl:async()=>json({task:{id:'task_1',status:'succeeded',content:{url:'http://video.example/out.mp4'}}})}),/HTTPS/);
});
test('the actual host invoke registry reaches video operations and journals only non-secret task metadata',async t=>{
  const symbol=Symbol.for('pipiui.ext-invoke.registry'),prior=globalThis[symbol],handlers=new Map();
  t.after(()=>{globalThis[symbol]=prior;});
  globalThis[symbol]={register(id,method,handler){const k=`${id}/${method}`;handlers.set(k,handler);return()=>handlers.delete(k);}};
  const f=fixture({media:{fetchImpl:async()=>json({task_id:'task_1'})}});
  const ctx={...context,sessionManager:{getBranch:()=>f.rows}};
  for(const hook of f.hooks.get('session_start'))hook({},ctx);
  const created=await handlers.get('minimax-enhanced/video-create')({...prompt,provider:'minimax-cn'});
  assert.equal(created.ok,true);assert.equal(created.data.task_id,'task_1');
  const status=await handlers.get('minimax-enhanced/status')({});
  assert.equal(status.data.tasks[0].task_id,'task_1');
  assert.equal(status.data.cache.requests,0);
  assert.equal(status.data.cache.write.tokens,null);
  assert.doesNotMatch(JSON.stringify(f.rows),new RegExp(key));
  assert.doesNotMatch(JSON.stringify(f.rows),/lantern/);
  f.shutdown();assert.equal(handlers.size,0);
});
test('build discovery and every foreground route mount the extension, without mounting it into reader lanes',()=>{
  const root=process.cwd(),entry=agentExtensionManifests(root).find(row=>row.name==='minimax-enhanced');
  assert.equal(entry.built,'build/extensions/minimax-enhanced/agent/index.mjs');
  const manifest=JSON.parse(readFileSync('extensions/minimax-enhanced/pipiui-extension.json','utf8'));
  assert.equal(manifest.host.entry,'agent/host.js');assert.equal(manifest.auth,undefined);
  for(const layout of ['source','compiled']){
    const entries=runtimeEntrypoints(root,layout);
    assert.ok(sessionExtensionPaths(entries).includes(entries.minimaxEnhanced));
    assert.ok(desktopSessionExtensionPaths(entries).includes(entries.minimaxEnhanced));
    assert.ok(!readerProviderExtensionPaths(entries).includes(entries.minimaxEnhanced));
  }
});
for (const layout of ['source','emitted']) test(`a real Pi model runtime keeps native catalog/auth after the extension registers its stream override (${layout})`,async t=>{
  const install=layout==='source' ? extension : (await import('../../build/extensions/minimax-enhanced/agent/index.mjs')).default;
  const workspace=await mkdtemp(join(tmpdir(),'minimax-runtime-'));
  t.after(()=>rm(workspace,{recursive:true,force:true}));
  const runtime=await ModelRuntime.create({credentials:AuthStorage.inMemory({'minimax-cn':{type:'api_key',key}}),
    modelsPath:null,modelsStorePath:join(workspace,'models-store.json'),allowModelNetwork:false,refreshOnCreate:false});
  const before=await runtime.getAvailable('minimax-cn');
  const chosen=before.find(row=>row.id===base.id);assert.ok(chosen);
  const wires=[],settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off'});
  let requestKey,extensionContext;
  const loader=new DefaultResourceLoader({cwd:workspace,agentDir:join(workspace,'agent'),settingsManager:settings,
    extensionFactories:[{name:'minimax-under-test',factory(pi){
      pi.on('session_start',(_event,ctx)=>{extensionContext=ctx;});
      install(pi,{env:{},stream:(selected,context,options)=>anthropicStream(selected,context,{...options,
      fetch:async(_url,init)=>{wires.push(JSON.parse(init.body));requestKey=new Headers(init.headers).get('x-api-key');return new Response(frames([{type:'text',text:'OK'}]),{headers:{'content-type':'text/event-stream'}});}})});}}]});
  await loader.reload();
  const {session}=await createAgentSession({cwd:workspace,agentDir:join(workspace,'agent'),model:chosen,modelRuntime:runtime,
    noTools:'builtin',resourceLoader:loader,sessionManager:SessionManager.inMemory(),settingsManager:settings});
  t.after(()=>session.dispose());
  await session.bindExtensions({mode:'print'});
  const after=await runtime.getAvailable('minimax-cn');
  assert.deepEqual(after.map(row=>row.id),before.map(row=>row.id));
  const status=await createMiniMaxHostLibrary(extensionContext,{env:{}}).status();
  assert.equal(status.accounts.find(row=>row.provider==='minimax-cn').configured,true);
  await session.prompt('Offline provider hook check.');
  assert.equal(wires.length,1);assert.equal(wires[0].model,chosen.id);
  assert.equal(requestKey,key);
});
