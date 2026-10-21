import assert from 'node:assert/strict';import {test,after} from 'node:test';
import {mkdtemp,writeFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{pathToFileURL}from'node:url';import{build}from'esbuild';
const ROOT=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'expression-context-'));after(()=>rm(temp,{recursive:true,force:true}));await symlink(join(ROOT,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {installContextPolicy} from './extensions/table/context-runtime.ts'; export {HEAD,HEAD_MODULE,HEAD_FIRST_SIGHT} from './kernel-ts/read/assemble.ts'; export {turnPacketSystemPrompt} from './runtime/turn-packet-prototype.ts';",resolveDir:ROOT},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',logLevel:'silent'});const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
for(const split of [true,false])test('locked instruction audience reaches the actual context hook; split='+split,async()=>{
 const hooks=new Map(),bus=new Map();api.installContextPolicy({on:(n,f)=>hooks.set(n,f),events:{on:(n,f)=>bus.set(n,f)},sendMessage(){}},()=>{});
 const binding={version:1,campaign:'c',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64),memory_coverage:{committed:0,completed:0,gaps:0,recent:[],older:{gaps:0}}};
 const cap={head:api.HEAD+api.HEAD_MODULE+api.HEAD_FIRST_SIGHT,turn:{number:0,player_text:'Hello'},recent:[],present:[{ref:'npc_1',display_name:'Clerk',knowledge:['LEGACY_KNOWLEDGE_COPY'],
  activity:{current:false,summary:'PRIOR_COUNTER_ACTIVITY',wakefulness:'awake',review_required:true},reunion:{status:'reunited',required:true}}],where:{scene:'Shop'},known:{},module:{title:'Book'},mods:{active:[],instructions:[
  {mod:'rules',version:'1.0.0',form:'full',instruction:'KEEPER_RULE_INSTRUCTION'},
  {mod:'writing',version:'1.0.0',form:'full',audience:'author',instruction:'AUTHOR_ONLY_INSTRUCTION'}]},
  style:{language:'en',register:'purist',axes:['AUTHOR_STYLE_AXIS'],floor:['AUTHOR_STYLE_FLOOR'],directives:[{id:'uptake',line:'AUTHOR_STYLE_DIRECTIVE'}]}};
 const original=JSON.stringify(cap);
 bus.get('coc:loop-engine')({singleKeeper:true,prescreen:'run',turnPacketPrototype:split,isolatedOutput:split});
 bus.get('coc:kernel-bridge')({campaign:'c',call:async()=>({...structuredClone(cap),_context:binding})});
 bus.get('coc:capsule')({epoch:'audience',capsule:cap,context:binding});
 try{
  const projected=await hooks.get('context')({messages:[{role:'user',content:[{type:'text',text:'Hello'}]},{role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{epoch:'audience',context:binding}}]},
   {model:{contextWindow:100000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[]}});
  assert.ok(JSON.stringify(projected.messages).includes('KEEPER_RULE_INSTRUCTION'));
  assert.ok(JSON.stringify(projected.messages).includes('purist'));
  assert.ok(JSON.stringify(projected.messages).includes('PRIOR_COUNTER_ACTIVITY'));
  const view=JSON.parse(projected.messages.find(m=>m.customType==='coc-capsule').content);
  for(const instruction of ['write the final public response yourself','No separate prose author','say what landed, in your own prose','Write what the book describes','give them one in your own words'])
   assert.equal(view.head.includes(instruction),!split,'only the actual prose owner receives '+instruction);
  assert.ok(view.head.includes('Writes are silent'));
  assert.ok(view.head.includes('Preserve source secrets'));
  assert.ok(view.head.includes(api.HEAD_MODULE));
  assert.ok(view.head.includes('a person the book keeps hidden stays hidden until found'));
  if(split)assert.ok(view.head.includes('sole prose author'));
  else assert.equal(view.head,cap.head);
  assert.equal(JSON.stringify(projected.messages).includes('full craft context'),!split);
  assert.equal(JSON.stringify(cap),original,'the request projection does not rewrite the source capsule');
  const next=await hooks.get('context')({messages:projected.messages},
   {model:{contextWindow:100000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[]}});
  const nextView=JSON.parse(next.messages.find(m=>m.customType==='coc-capsule').content);
  assert.equal(nextView.head,view.head,'continuations keep one stable delivery owner');
 }finally{await hooks.get('session_shutdown')();}
});
test('the split system retires semantic-record duties while preserving canonical tools and the source prompt',async()=>{
 const source=await import('node:fs/promises').then(fs=>fs.readFile(join(ROOT,'prompts/keeper.md'),'utf8'));
 assert.ok(source.includes('position and explicit semantic records'));
 const projected=api.turnPacketSystemPrompt(source);
 assert.ok(!projected.includes('explicit semantic records'));
 assert.ok(projected.includes('Use apply for physical changes, resources, clues, time, position.'));
 assert.ok(projected.includes('A scene read through look or lookup does not move anyone'));
 assert.ok(source.includes('position and explicit semantic records'));
});
for(const split of [true,false])for(const mode of ['answering','unavailable'])test(`retained capsule delivery ownership survives ${mode}; split=${split}`,async()=>{
 const hooks=new Map(),bus=new Map(),rows=[];
 api.installContextPolicy({on:(n,f)=>hooks.set(n,f),events:{on:(n,f)=>bus.set(n,f)},sendMessage(){}},row=>rows.push(row));
 const binding=turn=>({version:1,campaign:'c',worldline:'main',loop:0,turn,source_revision:'a'.repeat(64)});
 const capsule=turn=>({head:api.HEAD+api.HEAD_FIRST_SIGHT,turn:{number:turn,player_text:'Continue'},recent:[],present:[],
  where:{scene:'Place '+turn},known:{},module:{title:'Book'},mods:{active:[],instructions:[]},style:{}});
 const cap=capsule(2),messages=[1,2].flatMap(turn=>[
  {role:'user',content:[{type:'text',text:'Continue '+turn}]},
  {role:'custom',customType:'coc-capsule',content:JSON.stringify(capsule(turn)),details:{context:binding(turn)}},
  {role:'assistant',content:[{type:'toolCall',id:'read-'+turn,name:'look',arguments:{}}]},
  {role:'toolResult',toolCallId:'read-'+turn,toolName:'look',content:[{type:'text',text:'Result '+turn}]}]);
 if(mode==='unavailable')messages.push({role:'custom',customType:'coc-capsule-update',content:JSON.stringify({kind:'capsule_update',head:'Current section replacement.',sections:{head:api.HEAD,where:{scene:'Updated place'}}}),details:{turn:2}});
 const original=JSON.stringify(messages);
 bus.get('coc:loop-engine')({singleKeeper:true,prescreen:'run',turnPacketPrototype:split,isolatedOutput:split});
 bus.get('coc:kernel-bridge')({campaign:'c',call:async()=>{if(mode==='unavailable')throw Error('fixture_unavailable');return {...cap,_context:binding(2)};}});
 bus.get('coc:capsule')({epoch:'current',capsule:mode==='unavailable'?{}:cap,context:mode==='unavailable'?{...binding(2),source_revision:null}:binding(2),answering:['dodge']});
 try{
  const result=await hooks.get('context')({messages},{model:{contextWindow:100000},sessionManager:{getBranch:()=>[]}});
  const retained=result.messages.filter(m=>m.customType==='coc-capsule').map(m=>JSON.parse(m.content));
  assert.equal(retained.length,2,'both the protected prior turn and current turn remain available');
  for(const view of retained){
   assert.equal(view.head.includes('write the final public response yourself'),!split);
   assert.equal(view.where.scene,'Place '+view.turn.number,'head projection cannot replace historical state');
  }
  assert.equal(JSON.stringify(messages),original);
  if(mode==='unavailable'){
   assert.ok(result.messages.some(message=>message.customType==='coc-context-status'));
   const update=JSON.parse(result.messages.find(message=>message.customType==='coc-capsule-update').content);
   assert.equal(update.sections.head.includes('write the final public response yourself'),!split);
   assert.deepEqual(update.sections.where,{scene:'Updated place'});
  }
 }finally{await hooks.get('session_shutdown')();}
});
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
