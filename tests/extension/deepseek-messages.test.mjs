/** Synthetic transport fixtures through Pi's production Messages serializer/streamer. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeepSeekProvider} from '../../extensions/deepseek/agent/provider.js';
import {buildConversationRequest} from '../../extensions/deepseek/agent/conversation.js';
import {messagesBaseUrl} from '../../extensions/deepseek/agent/messages.js';
import {readCatalogCache} from '../../extensions/deepseek/agent/catalog-cache.js';

const provider = createDeepSeekProvider({cachePath:'/nonexistent'});
const model = {...provider.models[0],provider:'deepseek-extended',baseUrl:provider.baseUrl};
const tool = {name:'look',description:'Inspect a scene',parameters:{type:'object',properties:{},required:[]}};
const system = {role:'system',content:'Stable instructions',sections:{table:'First scene',temporary:'Temporary policy'},toolsAdded:[tool],timestamp:0};
const user = {role:'user',content:'Inspect the room.',timestamp:1};
const blocks = body => body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
const thinking = (text='Private reasoning.',signature='native_signature') => ({type:'thinking',thinking:text,signature});
const call = {type:'tool_use',id:'call_look',name:'look',input:{}};

function frames(content, {stop,cacheRead=0}={}) {
  const events = [{type:'message_start',message:{id:'message',type:'message',role:'assistant',model:model.id,content:[],
    usage:{input_tokens:20,output_tokens:0,cache_read_input_tokens:cacheRead}}}];
  for (const [index,part] of content.entries()) {
    events.push({type:'content_block_start',index,content_block:{...part,
      ...(part.type==='thinking'?{thinking:'',signature:''}:part.type==='text'?{text:''}:{input:{}})}});
    const delta = part.type==='thinking' ? {type:'thinking_delta',thinking:part.thinking}
      : part.type==='text' ? {type:'text_delta',text:part.text} : {type:'input_json_delta',partial_json:JSON.stringify(part.input)};
    events.push({type:'content_block_delta',index,delta});
    if (part.type==='thinking') events.push({type:'content_block_delta',index,delta:{type:'signature_delta',signature:part.signature}});
    events.push({type:'content_block_stop',index});
  }
  events.push({type:'message_delta',delta:{stop_reason:stop ?? (content.some(part=>part.type==='tool_use')?'tool_use':'end_turn')},usage:{output_tokens:30}},
    {type:'message_stop'});
  return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    {headers:{'content-type':'text/event-stream'}});
}

function fixture(outputs, extra={}) {
  const wires=[]; let index=0;
  const options={apiKey:'synthetic-test-key',reasoning:'high',maxTokens:2048,maxRetries:0,...extra,
    fetch:async (url,init)=>{
      wires.push({url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers)});
      return frames(outputs[index++],extra);
    }};
  return {wires,options,run:(messages=[system,user],patch={})=>provider.streamSimple(model,{messages},{...options,...patch})};
}

test('explicit low/high/max and off reach Messages without a reasoning length directive or budget',async()=>{
  for (const reasoning of ['low','high','max','off',undefined]) {
    const f=fixture([[{type:'text',text:'Visible reply.'}]]);
    const result=await f.run(undefined,{reasoning}).result();
    assert.equal(result.stopReason,'stop',result.errorMessage);
    const wire=f.wires[0],enabled=!!reasoning&&reasoning!=='off';
    assert.equal(new URL(wire.url).pathname,'/anthropic/v1/messages');
    assert.equal(wire.headers.get('x-api-key'),'synthetic-test-key');
    assert.deepEqual(wire.body.thinking,{type:enabled?'enabled':'disabled'});
    assert.deepEqual(wire.body.output_config,enabled?{effort:reasoning}:undefined);
    assert.equal(wire.body.max_tokens,2048);
    assert(!/budget_tokens|cache_control|internal reasoning must stay under|150 words/.test(JSON.stringify(wire.body)));
  }
});

test('raw ModelRuntime thinking controls survive the registered simple-stream boundary',async()=>{
  const f=fixture([[{type:'text',text:'Visible reply.'}]]);
  await f.run(undefined,{reasoning:undefined,thinkingEnabled:true,effort:'max'}).result();
  assert.deepEqual(f.wires[0].body.output_config,{effort:'max'});
});

test('unsupported structured-output formats fail before dispatch instead of being silently dropped',async()=>{
  assert.equal(model.capabilities.structuredOutputs,false);
  for (const format of [{response_format:{type:'json_object'}},{text:{format:{type:'json_object'}}},{output_config:{effort:'high',format:{type:'json_schema'}}}]) {
    const f=fixture([]);
    const result=await f.run(undefined,{onPayload:payload=>({...payload,...format})}).result();
    assert.equal(result.stopReason,'error');
    assert.match(result.errorMessage,/does not support structured output/);
    assert.equal(f.wires.length,0);
  }
});

test('signed long thinking streams incrementally and replays exactly across a tool result and restart',async()=>{
  const long='Reason carefully. '.repeat(400);
  const f=fixture([[thinking(long),call],[{type:'text',text:'The scene is clear.'}]],{cacheRead:4096});
  const stream=f.run(),events=[];
  for await (const event of stream) events.push(structuredClone(event));
  const first=await stream.result();
  assert.equal(first.api,'anthropic-messages');
  assert.equal(first.content[0].thinking,long);
  assert.equal(first.content[0].thinkingSignature,'native_signature');
  assert(events.some(event=>event.type==='thinking_delta'&&event.delta===long));
  assert.equal(first.usage.cacheRead,4096);
  const resumed=JSON.parse(JSON.stringify(first));
  await f.run([system,user,resumed,{role:'toolResult',toolCallId:'call_look',toolName:'look',content:[{type:'text',text:'Scene evidence'}],isError:false,timestamp:2}]).result();
  const wire=f.wires[1].body;
  assert.deepEqual(wire.messages.find(message=>message.role==='assistant').content,[thinking(long),call]);
  assert.equal(wire.messages.at(-1).content[0].tool_use_id,'call_look');
});

test('unsigned native thinking remains thinking instead of being turned into visible text',async()=>{
  const f=fixture([[thinking('Unsigned private reasoning.',''),call],[{type:'text',text:'Visible reply.'}]]);
  const first=await f.run().result();
  await f.run([system,user,first,{role:'toolResult',toolCallId:'call_look',toolName:'look',content:[{type:'text',text:'Scene'}],isError:false,timestamp:2}]).result();
  assert.deepEqual(blocks(f.wires[1].body).find(block=>block.type==='thinking'),thinking('Unsigned private reasoning.',''));
});

test('signature-only server thinking survives the next request without adding text',async()=>{
  const f=fixture([[thinking('','opaque_native_signature'),call],[{type:'text',text:'Visible reply.'}]]);
  const first=await f.run().result();
  await f.run([system,user,JSON.parse(JSON.stringify(first)),{role:'toolResult',toolCallId:'call_look',toolName:'look',content:[{type:'text',text:'Scene'}],isError:false,timestamp:2}]).result();
  assert.deepEqual(blocks(f.wires[1].body).find(block=>block.type==='thinking'),thinking('','opaque_native_signature'));
});

test('old cached catalog cannot restore Responses transport or unsupported format capabilities',t=>{
  const root=mkdtempSync(join(tmpdir(),'deepseek-messages-catalog-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'catalog.json');
  writeFileSync(file,JSON.stringify({version:1,baseUrl:'https://api.deepseek.com',models:[
    {...model,api:'openai-responses',compat:{thinkingFormat:'deepseek'},capabilities:{structuredOutputs:true}},
    {...model,id:'future-model',api:'openai-responses'},
  ]}));
  const cache=readCatalogCache(file);
  assert(cache.models.every(model=>model.api==='anthropic-messages'&&model.capabilities.structuredOutputs===false));
  assert.equal(cache.models[0].compat.supportsMidConvoSystemMessages,true);
  assert.equal(cache.models[1].compat.supportsMidConvoSystemMessages,false);
});

test('provider errors keep the concrete reason and never fall back to another protocol',async()=>{
  const f=fixture([]);let count=0;
  const result=await f.run(undefined,{fetch:async()=>{count++;return new Response(JSON.stringify({type:'error',error:{type:'authentication_error',message:'Credential rejected by provider'}}),
    {status:401,headers:{'content-type':'application/json'}});}}).result();
  assert.equal(result.stopReason,'error');assert.match(result.errorMessage,/Credential rejected by provider/);assert.equal(count,1);
});

test('Flash appends complete system snapshots after tool results and preserves the earlier request prefix',async()=>{
  const f=fixture([[thinking(),call],[{type:'text',text:'Visible reply.'}]]);
  const first=await f.run().result();
  const before=structuredClone(f.wires[0].body);
  const update={role:'system',content:'Additional policy',sections:{table:'Second scene',temporary:null},timestamp:3};
  const result={role:'toolResult',toolCallId:'call_look',toolName:'look',content:[{type:'text',text:'Scene'}],isError:false,timestamp:2};
  const history=[system,user,first,update,result];
  const original=structuredClone(history);
  await f.run(JSON.parse(JSON.stringify(history))).result();
  const after=f.wires[1].body;
  assert.deepEqual(after.system,before.system);
  assert.deepEqual(after.tools,before.tools);
  assert.deepEqual(after.messages.slice(0,before.messages.length),before.messages);
  assert.deepEqual(after.messages.slice(-2).map(message=>message.role),['user','system']);
  assert.deepEqual(after.messages.at(-1).content,[{type:'text',text:'Stable instructions\n\nAdditional policy\n\nSecond scene'}]);
  assert.deepEqual(history,original);
});

test('old Responses signatures are never relabelled as native Messages signatures',async()=>{
  const f=fixture([[{type:'text',text:'Visible reply.'}]]);
  const old={role:'assistant',api:'openai-responses',provider:model.provider,model:model.id,
    content:[{type:'thinking',thinking:'Historical reasoning.',thinkingSignature:'{"id":"rs_old"}'},{type:'text',text:'Earlier reply.'}],timestamp:2,stopReason:'stop',usage:{}};
  await f.run([system,user,old,{...user,timestamp:3}]).result();
  assert(!blocks(f.wires[0].body).some(block=>block.type==='thinking'));
  assert(!JSON.stringify(f.wires[0].body).includes('rs_old'));
  assert.equal(old.api,'openai-responses');
});

test('Flash appends deferred tool additions; removals and redefinitions send the current set',async()=>{
  const late={name:'late',description:'Read late evidence',parameters:{type:'object',properties:{}}};
  for (const mode of ['addition','removal','redefinition']) {
    const f=fixture([[{type:'text',text:'Ready.'}]]);
    const change=mode==='addition'?{toolsAdded:[late]}:mode==='removal'?{toolsRemoved:[{name:'look'}]}:{toolsAdded:[{...tool,description:'Changed definition'}]};
    const update={role:'system',content:'',timestamp:3,...change};
    const result=await f.run([system,user,update]).result();
    assert.equal(result.stopReason,'stop',result.errorMessage);
    const body=f.wires[0].body;
    assert(!blocks(body).some(block=>block.type==='tool_removal'));
    if (mode==='addition') {
      assert(body.tools.some(tool=>tool.name==='late'&&tool.defer_loading));
      assert(blocks(body).some(block=>block.type==='tool_addition'&&block.tool.name==='late'));
    } else {
      assert(!blocks(body).some(block=>block.type==='tool_addition'));
      assert.equal(body.tools?.length??0,mode==='removal'?0:1);
      if(mode==='redefinition')assert.equal(body.tools[0].description,'Changed definition');
    }
  }
});

test('Pro uses a collapsed current system prompt rather than unverified native snapshot updates',async()=>{
  const f=fixture([[{type:'text',text:'Visible reply.'}]]);
  const pro={...model,id:'deepseek-v4-pro'};
  const stream=provider.streamSimple(pro,{messages:[system,user,{role:'system',content:'Additional policy',sections:{table:'Updated scene'},timestamp:3}]},f.options);
  const result=await stream.result();assert.equal(result.stopReason,'stop',result.errorMessage);
  assert(JSON.stringify(f.wires[0].body.system).includes('Updated scene'));
  assert(!f.wires[0].body.messages.some(message=>message.role==='system'));
});

test('nested tool-result images keep Messages shapes and reuse the existing Files channel',async()=>{
  const f=fixture([[{type:'text',text:'Visible reply.'}]]);
  let uploads=0;
  const files={resolve:async input=>{uploads++;assert.deepEqual(input.bytes,Buffer.from('abc'));return 'file-api-test';}};
  const assistant={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[{type:'toolCall',id:'call_look',name:'look',arguments:{}}],timestamp:2,
    usage:{input:0,output:0,totalTokens:0,cacheRead:0,cacheWrite:0}};
  const image={type:'image',mimeType:'image/png',data:Buffer.from('abc').toString('base64')};
  await f.run([system,user,assistant,{role:'toolResult',toolCallId:'call_look',toolName:'look',content:[image],isError:false,timestamp:3}],
    {files,limits:{maxInlineBytes:1,maxFilesBytes:10}}).result();
  assert.equal(uploads,1);
  assert(f.wires[0].headers.get('anthropic-beta').includes('files-api-2025-04-14'));
  const nested=blocks(f.wires[0].body).find(part=>part.type==='tool_result').content;
  assert.deepEqual(nested.find(part=>part.type==='image').source,{type:'file',file_id:'file-api-test'});
});

test('default conversation helper targets Messages; configured roots cannot redirect credentials through URL fields',()=>{
  assert.equal(buildConversationRequest({modelId:model.id,credentials:'synthetic-test-key',messages:[]}).url,
    'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(messagesBaseUrl('https://api.deepseek.com/v1'),'https://api.deepseek.com/anthropic');
  assert.equal(messagesBaseUrl('https://api.deepseek.com/anthropic/v1'),'https://api.deepseek.com/anthropic');
  assert.equal(messagesBaseUrl('https://gateway.example/anthropic'),'https://gateway.example/anthropic');
  for (const url of ['https://user:secret@api.deepseek.com','https://api.deepseek.com?key=secret','https://api.deepseek.com#fragment']) {
    assert.throws(()=>messagesBaseUrl(url),/credentials, query or fragment/);
  }
});
