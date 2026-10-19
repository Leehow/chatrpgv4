/** Actual Pi Chat Completions protocol fixtures; these are not live Keeper play. */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {AuthStorage} from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import {getModel} from '@earendil-works/pi-ai/compat';
import extension from '../../extensions/native-search/index.ts';
import {retrieveOpenCode} from '../../runtime/opencode-search.js';
import {clearNativeSearchState,nativeSearchState,setNativeSearchPolicy,nativeSearchCapability,nativeSearchPayload} from '../../runtime/native-search.js';

const model=getModel('opencode-go','deepseek-v4.1-flash');
const policy={campaign:'campaign',worldline:'main',loop:0,run:'run',step:'step',enabled:true,allowed:true,model:'opencode-go/deepseek-v4.1-flash'};
const note={role:'user',content:JSON.stringify({native_search_scope:{run:'run',step:'step'}}),timestamp:0};
const system={role:'system',content:'Keeper instructions',timestamp:0,toolsAdded:[{name:'look',description:'Read the scene',parameters:{type:'object',properties:{focus:{type:'string'}},required:['focus']}}]};
const context={messages:[system,note]};
const key='synthetic-Go-key-must-never-reach-Exa';
const sourceText='Title: Period lamps\nURL: https://museum.example/lamps\nPublished: 2020-01-01\nHighlights:\nOil lamps were used in this period.';
const rpc=text=>({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text}]}});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const call=(name,args,id=name)=>({id:`call_${id}`,type:'function',function:{name,arguments:JSON.stringify(args)}});
function frames({text,thinking,calls=[],finish=calls.length?'tool_calls':'stop'}) {
  const chunks=[],chunk=delta=>chunks.push({id:'reply',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:null}]});
  chunk({role:'assistant'});if(thinking)chunk({reasoning_content:thinking});if(text)chunk({content:text});
  calls.forEach((tool,index)=>chunk({tool_calls:[{...tool,index}]}));
  chunks.push({id:'reply',choices:[{index:0,delta:{},finish_reason:finish}]},
    {id:'reply',choices:[],usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50,prompt_tokens_details:{cached_tokens:0}}});
  return new Response(chunks.map(row=>`data: ${JSON.stringify(row)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
function fixture(outputs,retrieval,install=extension) {
  const registrations=new Map();
  install({registerProvider:(id,config)=>registrations.set(id,config),events:new EventEmitter(),on:()=>{}});
  const wires=[],records=[],reports=[];let index=0;
  setNativeSearchPolicy(policy);nativeSearchState().persist=row=>records.push(row);nativeSearchState().report=row=>reports.push(row);
  const fetch=async(url,init)=>{const wire={url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers),init};wires.push(wire);
    if(wire.url==='https://mcp.exa.ai/mcp')return retrieval?retrieval(wire):json(rpc(sourceText));
    const output=outputs[index++];assert(output,'Unexpected extra model request');return frames(output);};
  return {run:registrations.get('opencode-go').streamSimple,registration:registrations.get('opencode-go'),wires,records,reports,
    options:{apiKey:key,reasoning:'off',maxTokens:1024,maxRetries:0,fetch,headers:{'x-opencode-session':'existing-session','x-opencode-client':'pipicoc'},
      onPayload:payload=>nativeSearchPayload(payload,model)}};
}
afterEach(()=>{clearNativeSearchState();nativeSearchState().persist=undefined;nativeSearchState().report=undefined;});

test('only known Go DeepSeek models on verified Go Chat Completions routes acquire keyless retrieval',()=>{
  assert.equal(nativeSearchCapability(model).route,'opencode-keyless-search');
  for(const patch of [{id:'kimi-k3'},{provider:'opencode'},{baseUrl:'https://proxy.example/zen/go/v1'},{baseUrl:'https://opencode.ai/zen/v1'},{api:'openai-responses'}]) {
    assert.equal(nativeSearchCapability({...model,...patch}),undefined);
  }
  assert.equal(nativeSearchCapability({...model,id:'deepseek-v4-pro',baseUrl:'https://opencode.ai/inference/go/openai/v1/'}).route,'opencode-keyless-search');
  assert.equal(nativeSearchCapability({...model,id:'deepseek-flash',provider:'deepseek-extended',api:'openai-responses',baseUrl:'https://api.deepseek.com',capabilities:{nativeSearch:{tools:['web_search']}}}).route,'deepseek-search-api');
});

test('registered Go override: search -> real game call -> game result -> answer preserves keys, headers and restart replay',async()=>{
  const f=fixture([{thinking:'Find a source.',calls:[call('web_search',{query:'1920s newsroom lamps',count:3})]},
    {text:'A sourced detail.',calls:[call('look',{focus:'scene'},'game')]},{text:'The room is lit by oil lamps.'}]);
  assert.equal(f.registration.api,'openai-completions');assert.equal(f.registration.models,undefined);assert.equal(f.registration.apiKey,undefined);
  const first=await f.run(model,context,f.options).result();assert.equal(first.stopReason,'toolUse',first.errorMessage);
  assert.deepEqual(first.content.filter(b=>b.type==='toolCall').map(b=>b.name),['look']);assert.equal(first.usage.input,40);
  const retrieval=f.wires.find(w=>w.url==='https://mcp.exa.ai/mcp');
  assert.deepEqual(retrieval.body,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'web_search_exa',arguments:{query:'1920s newsroom lamps',numResults:3}}});
  assert.equal(retrieval.headers.get('authorization'),null);assert.equal(retrieval.headers.get('x-opencode-session'),null);
  assert(!JSON.stringify(retrieval.body).includes(key));assert.equal(retrieval.init.redirect,'error');
  const requests=f.wires.filter(w=>w.url.includes('/chat/completions'));
  assert(requests.every(w=>w.headers.get('authorization')===`Bearer ${key}`&&w.headers.get('x-opencode-session')==='existing-session'));
  assert(requests.every(w=>w.body.tools.some(t=>t.function?.name==='look')&&w.body.tools.some(t=>t.function?.name==='web_search')));
  assert(requests[1].body.messages.some(m=>m.role==='tool'&&m.content.includes('museum.example/lamps')));
  assert.equal(f.records[0].transport,'opencode-keyless-search');assert(f.reports.some(r=>r.sources?.some(s=>s.url==='https://museum.example/lamps')));
  const saved=structuredClone(f.records);clearNativeSearchState();setNativeSearchPolicy({...policy,enabled:false});nativeSearchState().records=saved;
  first.content.find(b=>b.type==='text').text='Committed host projection.';const game=first.content.find(b=>b.type==='toolCall');
  const result={role:'toolResult',toolCallId:game.id,toolName:'look',content:[{type:'text',text:'Actual scene data'}],timestamp:2,isError:false};
  const last=await f.run(model,{messages:[...context.messages,first,result]},f.options).result();assert.equal(last.stopReason,'stop',last.errorMessage);
  const final=f.wires.at(-1).body;assert(final.messages.some(m=>m.role==='tool'&&m.content.includes('museum.example/lamps')));
  assert(final.messages.some(m=>m.role==='assistant'&&m.content?.includes('Committed host projection.')));
  assert.equal(final.messages.filter(m=>m.role==='assistant').map(m=>m.reasoning_content??'').join('\n').split('Find a source.').length-1,1,
    'unsigned Go reasoning from private search is replayed once');
  assert(final.messages.some(m=>m.role==='tool'&&m.content==='Actual scene data'));
  assert(!final.tools.some(t=>t.function?.name==='web_search'));assert.equal(f.wires.filter(w=>w.url==='https://mcp.exa.ai/mcp').length,1);
});

test('disabled Mod, missing grant, child context and restrictive choices never declare retrieval',async()=>{
  for(const variant of ['disabled','denied','child','none','game-choice']) {
    const f=fixture([{text:'Continue the game.'}]);if(variant==='disabled')setNativeSearchPolicy({...policy,enabled:false});
    if(variant==='denied')setNativeSearchPolicy({...policy,allowed:false});
    const options={...f.options,...(variant==='none'?{toolChoice:'none'}:variant==='game-choice'?{toolChoice:{type:'function',function:{name:'look'}}}:{})};
    const result=await f.run(model,variant==='child'?{messages:[system,{role:'user',content:'A child question',timestamp:1}]}:context,options).result();
    assert.equal(result.stopReason,'stop',result.errorMessage);assert.equal(f.wires.length,1);
    assert(!f.wires[0].body.tools.some(t=>t.function?.name==='web_search'));
  }
});

test('mixed search and game calls leave only game calls visible and retain paired search evidence',async()=>{
  const f=fixture([{text:'A period detail.',calls:[call('web_search',{query:'period lamps'}),call('look',{focus:'scene'},'game')]}]);
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'toolUse',result.errorMessage);
  assert.deepEqual(result.content.filter(b=>b.type==='toolCall').map(b=>b.name),['look']);assert.equal(f.records.length,1);
});

test('MCP JSON/SSE mapping retains sources and rejects errors, invalid URLs and oversized bodies',async()=>{
  const c={name:'web_search',arguments:{query:'period lamps'}};
  for(const response of [json(rpc(sourceText)),new Response(`event: message\ndata: ${JSON.stringify(rpc(sourceText))}\n\n`,{headers:{'content-type':'text/event-stream'}})]) {
    const result=await retrieveOpenCode(c,{apiKey:key,headers:{Authorization:key},fetch:async()=>response});
    assert.equal(result.results[0].title,'Period lamps');assert.equal(result.results[0].date,'2020-01-01');assert(result.untrusted_external_content);
  }
  for(const response of [json({jsonrpc:'2.0',id:1,error:{message:'unavailable'}}),json({jsonrpc:'2.0',id:1,result:{isError:true,content:[]}}),
    json(rpc(sourceText.replace('https://museum.example/lamps','file:///private'))),json(rpc('x'.repeat(256*1024))),new Response('bad JSON'),json({},429)]) {
    await assert.rejects(retrieveOpenCode(c,{fetch:async()=>response}),/OpenCode search/);
  }
  assert.deepEqual((await retrieveOpenCode(c,{fetch:async()=>json(rpc(''))})).results,[]);
  for(const args of [{query:''},{query:'x'.repeat(129)},{query:'valid',count:9}])await assert.rejects(retrieveOpenCode({name:'web_search',arguments:args},{fetch:()=>assert.fail('Must validate before dispatch')}));
});

test('search failure closes optional retrieval and lets the same model continue to game tools without leaking keys',async()=>{
  const f=fixture([{calls:[call('web_search',{query:'period lamps'})]},{calls:[call('look',{focus:'scene'},'game')]}],()=>json({},429));
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'toolUse',result.errorMessage);
  assert(!f.wires.at(-1).body.tools.some(t=>t.function?.name==='web_search'));
  assert(f.wires.at(-1).body.messages.some(m=>m.role==='tool'&&m.content.includes('unavailable')));
  assert(!JSON.stringify(f.records).includes(key));assert(f.reports.some(r=>r.event==='unavailable'));
});

test('cancelled or switched-scope retrieval cannot publish late sources or journal records',async()=>{
  for(const cancel of [false,true]) {
    const abort=new AbortController();const f=fixture([{calls:[call('web_search',{query:'period lamps'})]}],()=>{
      if(cancel)abort.abort();else setNativeSearchPolicy({...policy,campaign:'other',run:'other'});return json(rpc(sourceText));});
    const result=await f.run(model,context,{...f.options,signal:abort.signal}).result();
    assert(['error','aborted'].includes(result.stopReason));assert.equal(f.records.length,0);assert(!f.reports.some(r=>r.sources?.length));
  }
});

test('actual Pi model runtime registration preserves the Go catalog and resolves the original credential',async t=>{
  const root=await mkdtemp(join(tmpdir(),'opencode-search-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const runtime=await ModelRuntime.create({credentials:AuthStorage.inMemory({'opencode-go':{type:'api_key',key}}),modelsPath:null,
    modelsStorePath:join(root,'models-store.json'),allowModelNetwork:false,refreshOnCreate:false});
  const before=await runtime.getAvailable('opencode-go');const f=fixture([{calls:[call('web_search',{query:'period lamps'})]},{text:'A sourced answer.'}]);
  runtime.registerProvider('opencode-go',f.registration);const after=await runtime.getAvailable('opencode-go');
  assert.deepEqual(after.map(x=>x.id),before.map(x=>x.id));const chosen=after.find(x=>x.id===model.id);assert(chosen);
  const {apiKey,...options}=f.options;const result=await runtime.streamSimple(chosen,context,options).result();
  assert.equal(result.stopReason,'stop',result.errorMessage);assert.equal(f.wires.length,3);
  assert.equal(f.wires[0].headers.get('authorization'),`Bearer ${key}`);assert.equal(f.wires[1].headers.get('authorization'),null);
});

test('the bundled foreground extension loads outside the repository and executes the same Go search route',async t=>{
  const root=await mkdtemp(join(tmpdir(),'opencode-search-bundle-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');const outfile=join(root,'native-search.mjs');
  await build({entryPoints:['extensions/native-search/index.ts'],outfile,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
  const install=(await import(pathToFileURL(outfile).href)).default;
  const f=fixture([{calls:[call('web_search',{query:'period lamps'})]},{text:'A sourced answer.'}],undefined,install);
  const result=await f.run(model,context,f.options).result();assert.equal(result.stopReason,'stop',result.errorMessage);
  assert.equal(f.wires.filter(w=>w.url==='https://mcp.exa.ai/mcp').length,1);assert.equal(f.records[0].transport,'opencode-keyless-search');
});
