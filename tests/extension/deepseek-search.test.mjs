/** Real Pi serializer and streaming transport fixtures, not live Keeper play. */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {createDeepSeekProvider} from '../../extensions/deepseek/agent/provider.js';
import {loadContributedAuthProvider} from '../../Electron/packages/pi-backend/src/extension-auth-providers.ts';
import {retrieveDeepSeek} from '../../extensions/deepseek/agent/search.js';
import {clearNativeSearchState,nativeSearchState,setNativeSearchPolicy,nativeSearchPayload,nativeSearchEvent} from '../../runtime/native-search.js';

const model={id:'deepseek-flash',provider:'deepseek-extended',name:'DeepSeek',api:'openai-responses',baseUrl:'https://api.deepseek.com',
  capabilities:{nativeSearch:{tools:['web_search']}},reasoning:true,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
  contextWindow:1000000,maxTokens:2048,thinkingLevelMap:{low:'low',high:'high',max:'max'},compat:{supportsDeveloperRole:false}};
const policy={campaign:'campaign',worldline:'main',loop:0,run:'run',step:'step',enabled:true,allowed:true,model:'deepseek-extended/deepseek-flash'};
const note={role:'user',content:JSON.stringify({native_search_scope:{run:'run',step:'step'}}),timestamp:0};
const system={role:'system',content:'Keeper instructions',timestamp:0,toolsAdded:[{name:'look',description:'Read the current scene',parameters:{type:'object',properties:{focus:{type:'string'}},required:['focus']}}]};
const context={messages:[system,note]};
const key='synthetic-key-DO-NOT-EXPOSE';
const source={url:'https://museum.example/lamps',title:'Period lamps',snippet:'A museum source.',summary:'Oil lamps were used in this period.',date:'2020-01-01T00:00:00Z'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const fn=(name,args,id=name)=>({type:'function_call',id:`fc_${id}`,call_id:`call_${id}`,name,arguments:JSON.stringify(args),status:'completed'});
const text=(value,id='text')=>({type:'message',id:`msg_${id}`,role:'assistant',status:'completed',content:[{type:'output_text',text:value,annotations:[]}]});
const reasoning=id=>({type:'reasoning',id:`rs_${id}`,content:[{type:'reasoning_text',text:`Reasoning ${id}.`}],summary:[]});
function frames(output,id='response',status='completed') {
  const events=[{type:'response.created',response:{id,status:'in_progress',output:[]}}];
  for(const [output_index,item]of output.entries()){
    events.push({type:'response.output_item.added',output_index,item:{...item,...(item.type==='function_call'?{arguments:''}:item.type==='message'?{content:[]}: {})}});
    if(item.type==='function_call')events.push({type:'response.function_call_arguments.delta',output_index,item_id:item.id,delta:item.arguments});
    if(item.type==='message')events.push({type:'response.output_text.delta',output_index,item_id:item.id,content_index:0,delta:item.content[0].text});
    events.push({type:'response.output_item.done',output_index,item});
  }
  events.push({type:`response.${status}`,response:{id,status,output,...(status==='incomplete'?{incomplete_details:{reason:'max_output_tokens'}}:{}),usage:{input_tokens:20,output_tokens:30,total_tokens:50,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:1}}}});
  return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
function fixture(outputs,extra={}) {
  setNativeSearchPolicy(policy);
  const wires=[],reports=[],records=[];
  nativeSearchState().report=row=>reports.push(row);nativeSearchState().persist=row=>records.push(row);
  let index=0;
  const fetch=async(url,init)=>{
    const wire={url:String(url),body:JSON.parse(init.body),init};wires.push(wire);
    if(wire.url.endsWith('/tools/search'))return extra.search?extra.search(wire):json({results:[source]});
    if(wire.url.endsWith('/tools/fetch'))return extra.fetch?extra.fetch(wire):json({title:source.title,content:'# Lamps\nMuseum page.'});
    const output=outputs[index++];assert(output,'Unexpected additional model request');return frames(output,`response_${index}`,extra.status);
  };
  const options={apiKey:key,reasoning:'high',maxTokens:2048,maxRetries:0,fetch,
    onPayload:payload=>nativeSearchPayload(payload,model),
    onProviderStreamEvent:(data,physical)=>nativeSearchEvent({provider:physical.provider,model:physical.id,data})};
  return {run:createDeepSeekProvider().streamSimple,wires,reports,records,options};
}
afterEach(()=>{clearNativeSearchState();nativeSearchState().report=undefined;nativeSearchState().persist=undefined;});

test('actual Pi Responses: search -> fetch -> game call -> game result -> final prose, with restart replay',async()=>{
  const f=fixture([[reasoning('search'),fn('web_search',{query:'1920s newsroom lamps',count:3})],
    [reasoning('fetch'),fn('web_fetch',{url:source.url})],[text('A sourced detail.'),fn('look',{focus:'scene'},'game')],[text('The room is lit by oil lamps.','final')]]);
  const first=await f.run(model,context,f.options).result();
  assert.equal(first.stopReason,'toolUse',first.errorMessage);
  assert.deepEqual(first.content.filter(row=>row.type==='toolCall').map(row=>row.name),['look']);
  assert.equal(first.usage.input,60);assert.equal(first.usage.output,90);
  assert(f.wires.every(wire=>!wire.url.includes('/anthropic')));
  const search=f.wires.find(wire=>wire.url.endsWith('/tools/search'));
  assert.deepEqual(search.body,{query:'1920s newsroom lamps',count:3,need_content:false});
  assert.equal(search.init.headers.Authorization,`Bearer ${key}`);assert.equal(search.init.redirect,'error');
  const models=f.wires.filter(wire=>wire.url.endsWith('/responses'));
  assert(models.every(wire=>!wire.body.tools.some(tool=>tool.type==='web_search')));
  assert(models.every(wire=>wire.body.tools.some(tool=>tool.name==='look')));
  assert.equal(models[0].body.reasoning.effort,'high');
  assert(models[1].body.input.some(row=>row.type==='function_call_output'&&JSON.parse(row.output).results?.[0]?.url===source.url));
  assert.equal(f.records[0].transport,'deepseek-search-api');
  assert(f.reports.some(row=>row.event==='response'&&row.sources.some(s=>s.url===source.url)));
  const saved=structuredClone(f.records);clearNativeSearchState();setNativeSearchPolicy({...policy,allowed:false});nativeSearchState().records=saved;
  first.content.find(row=>row.type==='text').text='Committed host projection.';
  const game=first.content.find(row=>row.type==='toolCall');
  const final=await f.run(model,{...context,messages:[system,note,first,{role:'toolResult',toolCallId:game.id,toolName:'look',content:[{type:'text',text:'Actual scene data'}],isError:false,timestamp:1}]},f.options).result();
  assert.equal(final.stopReason,'stop',final.errorMessage);
  const replay=f.wires.at(-1).body;
  assert(!replay.tools.some(tool=>['web_search','web_fetch'].includes(tool.name)));
  assert(replay.input.some(row=>row.type==='function_call'&&row.name==='web_search'));
  assert(replay.input.some(row=>row.type==='function_call_output'&&row.output==='Actual scene data'));
  assert(JSON.stringify(replay.input).includes('Committed host projection.'));
  assert(!JSON.stringify(replay.input).includes('A sourced detail.'));
  const thinking=replay.input.filter(row=>row.type==='reasoning');assert.equal(new Set(thinking.map(row=>row.id)).size,thinking.length);
});

test('mixed search/game response executes only private retrieval and leaves the real game tool for Pi',async()=>{
  const f=fixture([[fn('web_search',{query:'period lamps'}),fn('look',{focus:'scene'},'game')],[text('Finished.')]]);
  const stream=f.run(model,context,f.options),events=[];for await(const event of stream)events.push(event);
  const first=await stream.result();assert.equal(first.stopReason,'toolUse',first.errorMessage);
  assert.deepEqual(first.content.filter(row=>row.type==='toolCall').map(row=>row.name),['look']);
  assert.equal(events.filter(row=>row.type==='start').length,1);assert.equal(events.filter(row=>row.type==='done').length,1);
  assert(events.filter(row=>row.type.startsWith('toolcall_')).every(row=>row.partial.content[row.contentIndex].name==='look'));
  assert.equal(f.wires.length,2);
  const game=first.content[0];
  await f.run(model,{...context,messages:[system,note,first,{role:'toolResult',toolCallId:game.id,toolName:'look',content:[{type:'text',text:'Scene'}],isError:false,timestamp:1}]},f.options).result();
  assert(f.wires.at(-1).body.input.some(row=>row.type==='function_call_output'&&JSON.parse(row.output||'null')?.results));
});

test('streaming text/thinking stay incremental and content indices survive private search removal',async()=>{
  const f=fixture([[reasoning('one'),text('Checking a source.','one'),fn('web_search',{query:'period lamps'})],[reasoning('two'),text('A lit room.','two')]]);
  const stream=f.run(model,context,f.options),events=[];for await(const event of stream)events.push(structuredClone(event));
  const result=await stream.result();assert.equal(result.stopReason,'stop',result.errorMessage);
  assert.equal(events.filter(row=>row.type==='start').length,1);assert.equal(events.filter(row=>row.type==='done').length,1);
  assert(events.some(row=>row.type==='text_delta'&&row.delta==='Checking a source.'));
  assert(events.some(row=>row.type==='text_delta'&&row.delta==='A lit room.'));
  for(const event of events.filter(row=>row.contentIndex!==undefined))assert.equal(event.partial.content[event.contentIndex].type,event.type.startsWith('thinking')?'thinking':'text');
  assert.equal(result.usage.input,40);
});

test('child lanes and unverified origins never receive private retrieval tools or HTTP calls',async()=>{
  for(const [m,c]of [[model,{...context,messages:[{role:'user',content:'A child question',timestamp:0}]}],[{...model,baseUrl:'https://proxy.example'},context]]){
    const f=fixture([[text('Ordinary response.')]]);const result=await f.run(m,c,f.options).result();
    assert.equal(result.stopReason,'stop',result.errorMessage);assert.equal(f.wires.length,1);
    assert(!f.wires[0].body.tools.some(tool=>['web_search','web_fetch'].includes(tool.name)));
  }
});

test('disabled grants and restrictive tool choices preserve ordinary game declarations',async()=>{
  for(const patch of [{enabled:false},{allowed:false},{model:'other/model'}]){
    const f=fixture([[text('Ordinary response.')]]);setNativeSearchPolicy({...policy,...patch});
    await f.run(model,context,f.options).result();assert(f.wires[0].body.tools.some(tool=>tool.name==='look'));
    assert(!f.wires[0].body.tools.some(tool=>tool.name==='web_search'));
  }
  const f=fixture([[text('No retrieval.')]]);
  await f.run(model,context,{...f.options,onPayload:payload=>({...nativeSearchPayload(payload,model),tool_choice:'none'})}).result();
  assert(!f.wires[0].body.tools.some(tool=>tool.name==='web_search'));assert.equal(f.wires[0].body.tool_choice,'none');
});

test('failed or malformed retrieval closes optional search and continues the game without leaking credentials',async()=>{
  for(const response of [()=>json({error:{message:key}},402),()=>json({results:[{url:'not a URL'}]}),()=>json({results:[{...source,summary:'x'.repeat(1048576)}]})]){
    const f=fixture([[fn('web_search',{query:'period lamps'})],[fn('look',{focus:'scene'},'game')]],{search:response});
    const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'toolUse',result.errorMessage);
    assert.equal(result.content.find(row=>row.type==='toolCall').name,'look');
    assert(!f.wires.at(-1).body.tools.some(tool=>tool.name==='web_search'));
    assert(!JSON.stringify(f.records).includes(key));assert(f.reports.some(row=>row.event==='unavailable'));
  }
});

test('empty results are successful and do not trigger a forced retry',async()=>{
  const f=fixture([[fn('web_search',{query:'no matching pages'})],[text('No sources found.')]],{search:()=>json({results:[]})});
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'stop',result.errorMessage);
  assert.equal(f.wires.filter(wire=>wire.url.endsWith('/tools/search')).length,1);
});

test('cancelled or changed-scope retrieval cannot persist or deliver a late result',async()=>{
  for(const change of [()=>setNativeSearchPolicy({...policy,campaign:'other',run:'other'}),()=>setNativeSearchPolicy({...policy,allowed:false})]){
    const f=fixture([[fn('web_search',{query:'period lamps'})]],{search:()=>{change();return json({results:[source]});}});
    const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'error');assert.equal(f.records.length,0);
  }
  const controller=new AbortController();
  const f=fixture([[fn('web_search',{query:'period lamps'})]],{search:()=>{controller.abort();return json({results:[source]});}});
  const result=await f.run(model,context,{...f.options,signal:controller.signal}).result();assert.equal(result.stopReason,'aborted');assert.equal(f.records.length,0);
});

test('HTTP request schema rejects invalid queries, counts and fetch URLs before dispatch',async()=>{
  for(const [name,args]of [['web_search',{query:' '}],['web_search',{query:'x'.repeat(129)}],['web_search',{query:'q',count:51}],['web_fetch',{url:'https://user:pass@example.com'}],['web_fetch',{url:'file:///tmp/private'}]]){
    let called=false;await assert.rejects(retrieveDeepSeek({name,arguments:args},{apiKey:key,fetch:()=>{called=true;}}));assert.equal(called,false);
  }
  const value=await retrieveDeepSeek({name:'web_search',arguments:{query:'😀'.repeat(128),count:1}},{apiKey:key,fetch:()=>json({results:[]})});assert.deepEqual(value.results,[]);
});

test('four retrievals exhaust the private allowance without dropping pending ordinary game calls',async()=>{
  const searches=Array.from({length:5},(_,i)=>fn('web_search',{query:`period source ${i}`},`search_${i}`));
  const f=fixture([[...searches,fn('look',{focus:'scene'},'game')]]);
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'toolUse',result.errorMessage);
  assert.equal(f.wires.filter(wire=>wire.url.endsWith('/tools/search')).length,4);
  const pairs=f.records[0].content.filter(row=>row.role==='toolResult');assert.equal(pairs.length,5);assert.equal(pairs.at(-1).isError,true);
  assert.equal(result.content.find(row=>row.type==='toolCall').name,'look');
});

test('foreign worldlines/loops/models, missing anchors, and incomplete pairs cannot replay search evidence',async()=>{
  const original=fixture([[fn('web_search',{query:'period lamps'}),fn('look',{focus:'scene'},'game')]]);
  const first=await original.run(model,context,original.options).result(),record=structuredClone(original.records[0]);
  for(const patch of [{worldline:'other'},{loop:1},{model:'deepseek-extended/other'},{anchor:'unmatched'},{content:record.content.slice(0,-1)}]){
    const f=fixture([[text('Continued.')]]);nativeSearchState().records=[{...record,...patch}];setNativeSearchPolicy({...policy,allowed:false});
    await f.run(model,{messages:[system,note,first]},f.options).result();
    assert(!f.wires[0].body.input.some(row=>row.type==='function_call'&&row.name==='web_search'));
  }
});

test('API failure statuses, malformed fetch, redirect and transport errors stay private and never retry',async()=>{
  for(const status of [400,401,402,403,404,408,413,429,500,504]){
    let count=0;await assert.rejects(retrieveDeepSeek({name:'web_search',arguments:{query:'period lamps'}},
      {apiKey:key,fetch:()=>{count++;return json({error:{message:key}},status);}}),error=>error.message.includes(`HTTP ${status}`)&&!error.message.includes(key));
    assert.equal(count,1);
  }
  await assert.rejects(retrieveDeepSeek({name:'web_fetch',arguments:{url:source.url}},{apiKey:key,fetch:()=>json({title:'Empty',content:''})}),/no usable Markdown/);
  await assert.rejects(retrieveDeepSeek({name:'web_fetch',arguments:{url:source.url}},{apiKey:key,fetch:(_url,init)=>{
    assert.equal(init.redirect,'error');throw new Error(key);
  }}),error=>error.message==='DeepSeek retrieval transport failed');
});

test('cumulative retained payloads are bounded without disabling the next ordinary game call',async()=>{
  const f=fixture([[fn('web_fetch',{url:source.url},'one')],[fn('web_fetch',{url:source.url},'two')],[fn('look',{focus:'scene'},'game')]],
    {fetch:()=>json({title:'Page',content:'a'.repeat(600_000)})});
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'toolUse',result.errorMessage);
  assert(Buffer.byteLength(JSON.stringify(f.records[0].content))<=1048576);
  assert(f.reports.some(row=>row.reason==='protocol_retention_bound'));
  assert(!f.wires.at(-1).body.tools.some(tool=>tool.name==='web_fetch'));
});

test('the bundled provider loads outside the repository and uses the same official search continuation',async t=>{
  const root=mkdtempSync(join(tmpdir(),'deepseek-installed-search-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'agent'));symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');writeFileSync(join(root,'package.json'),'{"type":"module"}');
  await build({entryPoints:['extensions/deepseek/agent/index.js'],outfile:join(root,'agent/provider.js'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
  const loaded=await loadContributedAuthProvider(root,{cacheDir:null});assert.equal(loaded.id,'deepseek-extended');
  const f=fixture([[fn('web_search',{query:'period lamps'})],[fn('look',{focus:'scene'},'game')]]);
  const result=await loaded.config.streamSimple(model,context,f.options).result();
  assert.equal(result.stopReason,'toolUse',result.errorMessage);assert.equal(result.content.find(row=>row.type==='toolCall').name,'look');
  assert(f.wires.some(wire=>wire.url==='https://api.deepseek.com/v1/tools/search'));
});

test('an incomplete model response keeps its length termination and never executes partial retrieval calls',async()=>{
  const f=fixture([[fn('web_search',{query:'period lamps'})]],{status:'incomplete'});
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'length',result.errorMessage);
  assert.equal(f.wires.length,1);assert.equal(f.records.length,0);
});

test('identical assistant prose from different responses keeps each response paired with its own search',async()=>{
  const firstRun=fixture([[fn('web_search',{query:'first period source'},'first')],[text('Done.','first')]]);
  const first=await firstRun.run(model,context,firstRun.options).result();assert.equal(first.stopReason,'stop',first.errorMessage);
  const secondRun=fixture([[fn('web_search',{query:'second period source'},'second')],[text('Done.','second')]]);
  const second=await secondRun.run(model,{messages:[system,note,first]},secondRun.options).result();assert.equal(second.stopReason,'stop',second.errorMessage);
  const finalRun=fixture([[text('Continued.')]]);setNativeSearchPolicy({...policy,allowed:false});
  await finalRun.run(model,{messages:[system,note,first,second]},finalRun.options).result();
  const queries=finalRun.wires[0].body.input.filter(row=>row.type==='function_call'&&row.name==='web_search').map(row=>JSON.parse(row.arguments).query);
  assert.deepEqual(queries,['first period source','second period source']);
});
