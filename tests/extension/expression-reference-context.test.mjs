import assert from 'node:assert/strict';import {test,after} from 'node:test';
import {mkdtemp,writeFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{pathToFileURL}from'node:url';import{build}from'esbuild';
const ROOT=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'expression-context-'));after(()=>rm(temp,{recursive:true,force:true}));await symlink(join(ROOT,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {installContextPolicy} from './extensions/table/context-runtime.ts';",resolveDir:ROOT},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',logLevel:'silent'});const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
for(const closePath of ['narrate','embedded'])test(`actual provider content and stale withdrawal preserve the ${closePath} delivery snapshot`,async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.EXT_JEV_APIKEY;process.env.EXT_JEV_APIKEY='fixture-key';
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);await new Promise(r=>setTimeout(r,25));return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(Object.entries(body.questions).map(([key,q])=>[key,{type:q.type,noul:key.startsWith('conflict_')?.01:.99}])),usage:{input_tokens:100,output_tokens:1}}),{status:200});};
 try{
 const hooks=new Map(),bus=new Map(),rows=[],binding={version:1,campaign:'c',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64),memory_coverage:{committed:0,completed:0,gaps:0,recent:[],older:{gaps:0}}};
 const card={name:'Friendly',kind:'interaction',activation_question:'Is the targeted person responding to the current request?',applies:'An ordinary greeting.',pattern:'Acknowledge politely.',examples:[{context:'Greeting.',reply:'Hello, come in.'}]};
 const cap={turn:{number:0,player_text:'Hello'},recent:[],present:[{name:'Clerk',voice:'Polite.'}],voices:[],where:{name:'Office'},known:{investigator:{name:'Visitor'}},mods:{active:[{id:'x',version:'1.0.0'}],expression_reference:{enabled:true,revision:'r1',play_language:'zh-Hans'},instructions:[]},module:{title:'Book'},style:{floor:[]}};
 const reads=[];const pi={on:(n,f)=>hooks.set(n,f),events:{on:(n,f)=>bus.set(n,f)},sendMessage(){}};api.installContextPolicy(pi,row=>rows.push(row));
 bus.get('coc:kernel-bridge')({campaign:'c',call:async method=>{reads.push(method);return method==='mods.expression'?{enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}:{...structuredClone(cap),_context:binding}}});
 bus.get('coc:capsule')({epoch:'e1',capsule:cap,context:binding});
 const ctx={model:{contextWindow:100000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[]}};
 const messages=[{role:'user',content:[{type:'text',text:'Hello'}]},{role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{epoch:'e1',context:binding}}];
 const projected=await hooks.get('context')({messages},ctx),advice=projected.messages.find(m=>m.customType==='coc-expression-reference');assert.ok(advice);assert.ok(advice.content.includes(card.examples[0].reply));
 assert.ok(!JSON.stringify(projected.messages).includes('expression_exchange'),'selector-only history is never copied into the protected capsule');
 const {convertToLlm,ExtensionRunner,createExtensionRuntime}=await import('../../build/node_modules/@earendil-works/pi-coding-agent/dist/index.js');const payload={messages:convertToLlm(projected.messages)};
 const runner=new ExtensionRunner([{path:'expression-conformance',handlers:new Map([['before_provider_request',[hooks.get('before_provider_request')]]])}],createExtensionRuntime(),ROOT,{},{});runner.bindCore({}, {getModel:()=>ctx.model,abort(){}});
 await runner.emitBeforeProviderRequest(payload);assert.equal(rows.filter(r=>r.lane==='expression'&&r.event==='delivered').at(-1).delivered,true);
 const again=await hooks.get('context')({messages},ctx),old=again.messages.find(m=>m.customType==='coc-expression-reference');assert.ok(old);
 bus.get('coc:source-published')({campaign:'c'});const stale={messages:convertToLlm(again.messages)};
 const replacement=await runner.emitBeforeProviderRequest(stale);assert.ok(replacement?.messages);assert.equal(replacement.payload,undefined);assert.equal(JSON.stringify(replacement).includes(old.content),false);
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
