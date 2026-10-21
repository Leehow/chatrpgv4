/** Real request hook, no Keeper or live-play acceptance claims. */
import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'location-intent-hook-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {installContextPolicy} from './extensions/table/context-runtime.ts'; export {COC_TOOLS} from './extensions/kernel/tools.ts';",resolveDir:root},
 outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const {installContextPolicy,COC_TOOLS}=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

for(const mode of ['arrival','focused','inactive'])test(`location context loads without a Jev selection review: ${mode} (§249)`,async t=>{
 const previousFetch=globalThis.fetch,priorKey=process.env.EXT_JEV_APIKEY;
 process.env.EXT_JEV_APIKEY='fixture-only';
 t.after(()=>{globalThis.fetch=previousFetch;if(priorKey===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=priorKey;});
 let decisions=0;
 globalThis.fetch=async(_url,init)=>{
  decisions++;const request=JSON.parse(init.body),values=Object.fromEntries(Object.keys(request.questions).map(key=>[key,.5]));
  return new Response(JSON.stringify({model:request.model,answers:Object.fromEntries(Object.keys(request.questions).map(key=>[key,{type:'noul',noul:values[key]}])),usage:{input_tokens:10,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
 };
 const hooks=new Map(),bus=new Map(),rows=[];
 const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),emit:(name,value)=>bus.get(name)?.(value)},
  getAllTools:()=>COC_TOOLS,getActiveTools:()=>COC_TOOLS.map(x=>x.name),sendMessage(){}};
 installContextPolicy(pi,row=>rows.push(row));
 const binding={version:1,campaign:'intent-hook',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64)};
 const capsule={turn:{number:0,player_text:mode==='focused'?'Enter the inn and read the posted room prices.':'Enter the inn and ask for a room.'},
  recent:[],module:{title:'Component'},style:{},where:{scene:'Street'},present:[],mods:{instructions:[],...(mode!=='inactive'?{location_context:{mod:'enhanced-locations',version:'1.2.2'}}:{})}};
 const canonical=structuredClone(capsule);
 await hooks.get('session_start')();
 bus.get('coc:kernel-bridge')({campaign:binding.campaign,call:async method=>method==='table.capsule'?{...capsule,_context:binding}:method==='table.history'?{turns:[],memory:[],_context:binding}:method==='mods.locations.inspect'?{place:{name:'Street'},catalogue:[]}: {}});
 bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run',singleKeeper:true,turnPacketPrototype:true,isolatedOutput:true});
 bus.get('coc:capsule')({capsule,context:binding,epoch:'input-1'});
 const lifetime=new AbortController();
 bus.get('coc:task-provider-budget')(()=>({signal:lifetime.signal,deadlineAt:Date.now()+20000,reserve:async()=>({settle(){},release(){}})}));
 const messages=[{role:'user',content:[{type:'text',text:capsule.turn.player_text}],timestamp:1},
  {role:'custom',customType:'coc-capsule',content:JSON.stringify(capsule),details:{context:binding,epoch:'input-1'},timestamp:2}];
 const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages})}};
 const output=await hooks.get('context')({messages},ctx);
 const tools=COC_TOOLS.map(({name,description,parameters})=>({name,description,parameters}));
 const native=[{role:'system',content:'Keeper core.',toolsAdded:tools,timestamp:0},...output.messages];
 const projected=hooks.get('context_with_system')({messages:native},ctx)?.messages??native;
 const place=projected[0].toolsAdded?.find(tool=>tool.name==='place');
 if(mode!=='inactive'){assert(place.parameters.anyOf.length>=6,'an active provider declares every place action in full');assert.doesNotMatch(place.description,/need contract/);}
 const payload={input:projected,tools};
 hooks.get('before_provider_request')({payload});
 const sent=JSON.parse(payload.input.find(m=>m.customType==='coc-capsule').content);
 assert.deepEqual(payload.tools.map(x=>x.name),tools.map(x=>x.name),'the advisory assessment removes no tool');
 assert.equal(sent.location_intent,undefined,'the Keeper judges selection; no reviewer assessment is attached');
 assert.equal(decisions,0,'loading location context asks no Jev question');
 if(mode!=='inactive')assert(rows.some(row=>row.lane==='location-context'&&row.status==='keeper'&&row.jev_calls===0));
 assert.deepEqual(capsule,canonical,'request context must not mutate canonical state');
});
