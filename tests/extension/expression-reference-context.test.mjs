import assert from 'node:assert/strict';import {test,after} from 'node:test';
import {mkdtemp,writeFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{pathToFileURL}from'node:url';import{build}from'esbuild';
const ROOT=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'expression-context-'));after(()=>rm(temp,{recursive:true,force:true}));await symlink(join(ROOT,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {installContextPolicy} from './extensions/table/context-runtime.ts';",resolveDir:ROOT},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',logLevel:'silent'});const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
for(const closePath of ['narrate','embedded'])test(`expression examples stay with output and stale guidance is withdrawn for ${closePath}`,async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.EXT_JEV_APIKEY;process.env.EXT_JEV_APIKEY='fixture-key';
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);await new Promise(r=>setTimeout(r,25));return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(Object.entries(body.questions).map(([key,q])=>[key,{type:q.type,noul:key.startsWith('conflict_')?.01:.99}])),usage:{input_tokens:100,output_tokens:1}}),{status:200});};
 try{
 const hooks=new Map(),bus=new Map(),rows=[],binding={version:1,campaign:'c',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64),memory_coverage:{committed:0,completed:0,gaps:0,recent:[],older:{gaps:0}}};
 const card={name:'Friendly',kind:'interaction',activation_question:'Is the targeted person responding to the current request?',applies:'An ordinary greeting.',pattern:'Acknowledge politely.',examples:[{context:'Greeting.',reply:'Hello, come in.'}]};
 const cap={turn:{number:0,player_text:'Hello'},recent:[],present:[{name:'Clerk',voice:'Polite.'}],voices:[{name:'Clerk',mask:'Measured phrasing with warm acknowledgements','in exchange':['hello → welcome','where → here','certain → not yet']}],where:{name:'Office'},known:{investigator:{name:'Visitor'}},mods:{active:[{id:'x',version:'1.0.0'}],expression_reference:{enabled:true,revision:'r1',play_language:'zh-Hans'},instructions:[]},module:{title:'Book'},style:{floor:[]}};
 const reads=[];const pi={on:(n,f)=>hooks.set(n,f),events:{on:(n,f)=>bus.set(n,f)},sendMessage(){}};api.installContextPolicy(pi,row=>rows.push(row));
 bus.get('coc:kernel-bridge')({campaign:'c',call:async method=>{reads.push(method);return method==='mods.expression'?{enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}:{...structuredClone(cap),_context:binding}}});
 bus.get('coc:capsule')({epoch:'e1',capsule:cap,context:binding});
 const ctx={model:{contextWindow:100000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[]}};
 const messages=[{role:'user',content:[{type:'text',text:'Hello'}]},{role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{epoch:'e1',context:binding}}];
 const projected=await hooks.get('context')({messages},ctx);
 assert.ok(!projected.messages.some(m=>m.customType==='coc-expression-reference'));
 assert.ok(!JSON.stringify(projected.messages).includes(card.examples[0].reply),'writer examples never consume Keeper request bytes');
 assert.ok(!rows.some(row=>row.lane==='expression'&&row.event==='first_request_wait'),'the Keeper does not wait for writer examples');
 assert.ok(!JSON.stringify(projected.messages).includes('expression_exchange'));
 const {convertToLlm,ExtensionRunner,createExtensionRuntime}=await import('../../build/node_modules/@earendil-works/pi-coding-agent/dist/index.js');const payload={messages:convertToLlm(projected.messages)};
 const runner=new ExtensionRunner([{path:'expression-conformance',handlers:new Map([['before_provider_request',[hooks.get('before_provider_request')]]])}],createExtensionRuntime(),ROOT,{},{});runner.bindCore({}, {getModel:()=>ctx.model,abort(){}});
 assert.ok(JSON.stringify(payload).includes(cap.voices[0].mask),'personality and authored voice remain with the Keeper');
 await runner.emitBeforeProviderRequest(payload);
 await new Promise(resolve=>setTimeout(resolve,60));
 let advice;
 bus.get('coc:writing-reference-request')({campaign:'c',capsule:{...cap,_context:binding},accept:value=>{advice=value;}});
 advice=await advice;
 assert.ok(advice?.content.includes(card.examples[0].reply),'the selected writer can obtain current prepared examples');
 assert.equal(rows.filter(row=>row.lane==='expression'&&row.event==='handoff').at(-1).destination,'output');
 const catalogReads=reads.filter(method=>method==='mods.expression').length;
 bus.get('coc:source-published')({campaign:'c'});
 let stale;
 bus.get('coc:writing-reference-request')({campaign:'c',capsule:{...cap,_context:binding},accept:value=>{stale=value;}});
 assert.equal(stale instanceof Promise,true,'only the selected writer waits for replacement guidance');
 stale=await stale;
 assert.ok(reads.filter(method=>method==='mods.expression').length>catalogReads,'source publication revalidates the expression catalog');
 assert.ok(!stale||stale.content.includes(card.examples[0].reply),'a replacement is obtained through a fresh current selection');
 await hooks.get('context')({messages},ctx);const beforeClose=reads.filter(m=>m==='table.capsule').length;
 const closeTool=closePath==='embedded'?'apply':'narrate';
 await hooks.get('tool_call')({toolName:closeTool,toolCallId:'close',input:{text:'Hello.'}});
 await hooks.get('tool_result')({toolName:closeTool,toolCallId:'close',details:closePath==='embedded'?{narrate_in_apply:true}:{},result:{}});
 const closed=await hooks.get('context')({messages},ctx);
 assert.equal(reads.filter(m=>m==='table.capsule').length,beforeClose,'optional selection never advances the mandatory fold snapshot after delivery');
 assert.ok(!closed.messages.some(m=>m.customType==='coc-expression-reference'),'closed input retires optional advice');
 await hooks.get('session_shutdown')();
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=originalKey;}
});

test('single Keeper never starts the retired expression selector even when its Mod is enabled',async()=>{
 const priorKey=process.env.EXT_JEV_APIKEY,priorFetch=globalThis.fetch;
 process.env.EXT_JEV_APIKEY='fixture-key';let fetched=0;
 globalThis.fetch=async()=>{fetched++;throw Error('Retired selector must not run');};
 const hooks=new Map(),bus=new Map(),reads=[];
 const binding={version:1,campaign:'c',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64),memory_coverage:{committed:0,completed:0,gaps:0,recent:[],older:{gaps:0}}};
 const cap={turn:{number:0,player_text:'Hello'},recent:[],present:[{name:'Clerk',voice:'Polite.'}],where:{name:'Office'},known:{investigator:{name:'Visitor'}},mods:{active:[],expression_reference:{enabled:true,revision:'r1',play_language:'en'},instructions:[]},module:{title:'Book'},style:{floor:[]}};
 try{
  api.installContextPolicy({on:(n,f)=>hooks.set(n,f),events:{on:(n,f)=>bus.set(n,f)},sendMessage(){}},()=>{});
  bus.get('coc:loop-engine')({singleKeeper:true,prescreen:'run'});
  bus.get('coc:kernel-bridge')({campaign:'c',call:async method=>{reads.push(method);return {...structuredClone(cap),_context:binding};}});
  bus.get('coc:capsule')({epoch:'single',capsule:cap,context:binding});
  await hooks.get('context')({messages:[{role:'user',content:[{type:'text',text:'Hello'}]},{role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{epoch:'single',context:binding}}]},
   {model:{contextWindow:100000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[]}});
  assert.equal(reads.includes('mods.expression'),false);assert.equal(fetched,0);
  await hooks.get('session_shutdown')();
 }finally{globalThis.fetch=priorFetch;if(priorKey===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=priorKey;}
});
