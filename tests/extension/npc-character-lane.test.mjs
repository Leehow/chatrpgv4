/** Tool-enabled background character preparation through the Pi event interface. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import npc from '../../extensions/npc/index.ts';
import {waitFor} from './harness.mjs';

test('background authors overlap and never block session readiness while only checked artifacts publish',async t=>{
 const root=resolve(import.meta.dirname,'../..'),parent=join(root,'.pi/npc-implementation/lane-tests');await mkdir(parent,{recursive:true});
 const cwd=await mkdtemp(join(parent,'run-')),events=new EventEmitter(),hooks=new Map(),telemetry=[];
 const previous={PI_COC_MODE:process.env.PI_COC_MODE,PI_COC_NPC_AUTHORS:process.env.PI_COC_NPC_AUTHORS};
 process.env.PI_COC_MODE='play';process.env.PI_COC_NPC_AUTHORS='2';
 t.after(()=>{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const pi={events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:(...row)=>telemetry.push(row)};
 npc(pi);
 let release;const gate=new Promise(r=>release=r),starts=[],published=[];
 const runtime={home:cwd,runTask:async task=>{
   starts.push(task);await gate;
   const packet=JSON.parse(await readFile(join(task.request.cwd,'packet.json'),'utf8'));
   assert(!JSON.stringify(packet).includes('job_id'));
   await writeFile(join(task.request.cwd,'draft.json'),JSON.stringify({personality:{description:`${packet.npc.name} values discretion but asks clear questions.`}}));
   return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:['--model','author/test']};
 }};
 const call=async(method,params)=>{
   if(method==='table.look')return {present:[{name:'Anna'},{name:'Bela'}]};
   if(method==='npc.job')return {job_id:`owned:${params.name}`,claim:`claim:${params.name}`,npc:{name:params.name,sources:[]},instruction:'Write a bounded personality.'};
   if(method==='npc.submit'){published.push(params);return {};}
   throw new Error('Unexpected RPC '+method);
 };
 events.emit('coc:kernel-bridge',{campaign:'test',call,runtime});
 for(const fn of hooks.get('session_start')??[])await fn({}, {cwd,model:{provider:'author',id:'test'},modelRegistry:{}});
 await waitFor(()=>starts.length===2);
 assert.equal(published.length,0,'session readiness and both authors occur before either model finishes');
 assert(starts.every(t=>t.request.tools==='read,write,edit,bash'&&t.request.priority==='background'));
 release();await waitFor(()=>published.length===2);
 assert.deepEqual(published.map(x=>x.personality.description).sort(),['Anna values discretion but asks clear questions.','Bela values discretion but asks clear questions.']);
 for(const fn of hooks.get('session_shutdown')??[])await fn({});
});

test('automatic advice has a soft foreground deadline and cannot wait for a blocked context read',async t=>{
 const hooks=new Map(),events=new EventEmitter();
 const values={PI_COC_MODE:'play',EXT_JEV_APIKEY:'test-only-credential',PI_COC_NPC_ADVICE_WAIT_MS:'15'};
 const previous=new Map(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 t.after(()=>{for(const[k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 npc({events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:()=>{}});
 events.emit('coc:kernel-bridge',{campaign:'test',call:async()=>new Promise(()=>{})});
 for(const fn of hooks.get('session_start')??[])await fn({}, {cwd:process.cwd(),model:{provider:'author',id:'test'},modelRegistry:{}});
 let timer;
 try{
  const results=await Promise.race([Promise.all((hooks.get('before_agent_start')??[]).map(fn=>fn({prompt:'Hello'}))),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('optional advice blocked foreground play')),250);})]);
  assert(results.every(value=>value===undefined));
 }finally{clearTimeout(timer);for(const fn of hooks.get('session_shutdown')??[])await fn({});}
});

test('shared-auth typed advice enters current Keeper context once and expires after a game tool',async t=>{
 const hooks=new Map(),events=new EventEmitter(),values={PI_COC_MODE:'play',PIPIUI_SPAWN_CONTRACT:'{}',PIPIUI_MOUNTED_EXTENSIONS:'kernel,npc,jev',PIPIUI_EXT_SETTINGS_JEV:'{}',EXT_JEV_APIKEY:'test-only-credential',PI_COC_NPC_ADVICE_WAIT_MS:'200'};
 const previous=new Map(Object.keys(values).map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
 Object.assign(process.env,values);let calls=0;
 t.after(()=>{globalThis.fetch=originalFetch;for(const[k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 globalThis.fetch=async(_url,init)=>{
  calls++;assert.equal(init.headers.Authorization,'Bearer test-only-credential');const body=JSON.parse(init.body);
  assert(!init.body.includes('test-only-credential'));
  const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{
   if(q.type==='choice'){const chosen=key==='choose'?'response:1':'supported';return [key,{type:'choice',choice:chosen,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===chosen?1:0]))}];}
   return [key,{type:'score',score:3,confidence:1,legend:Object.fromEntries(q.criteria.map((v,i)=>[String(i),v])),probabilities:Object.fromEntries(q.criteria.map((_,i)=>[String(i),i===3?1:0]))}];
  }));
  return new Response(JSON.stringify({model:body.model,answers,usage:{input_tokens:200,output_tokens:100}}));
 };
 npc({events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:()=>{}});
 const view={name:'Anna',scope:{worldline:'main',loop:0},view_revision:'current-view',input:{turn:1,player_input:'Goodbye.'},responses:[{intent:'Offer a brief farewell and return to work.',when:'The visitor has chosen to leave.'}]};
 events.emit('coc:kernel-bridge',{campaign:'test',call:async method=>method==='table.look'?{present:[{name:'Anna'}]}:method==='npc.perspectives'?{views:[view]}:view});
 const ctx={cwd:process.cwd(),model:{provider:'author',id:'test'},modelRegistry:{}};
 for(const fn of hooks.get('session_start')??[])await fn({},ctx);
 const before=await hooks.get('before_agent_start')[0]({prompt:'Goodbye.'},ctx);
 assert.equal(calls,1);assert.equal(JSON.parse(before.message.content).advice[0].selected.intent,view.responses[0].intent);
 const message={role:'custom',...before.message,timestamp:Date.now()};
 assert.equal(hooks.get('context')[0]({messages:[message]}).messages.length,1);
 const previousProcess={...message,details:{...message.details,session:'previous-process'}};
 assert.equal(hooks.get('context')[0]({messages:[previousProcess,message]}).messages.length,1,'a reused numeric epoch cannot revive advice retained by an older process');
 for(const fn of hooks.get('tool_result')??[])await fn({toolName:'apply'});
 assert.equal(hooks.get('context')[0]({messages:[message]}).messages.length,0);
 assert.equal(await hooks.get('before_agent_start')[0]({prompt:'A host continuation.'},ctx),undefined);
 assert.equal(calls,1,'the same canonical player input is not evaluated again on a host continuation');
 for(const fn of hooks.get('session_shutdown')??[])await fn({});
});

test('a failed background author can retry a new claim on the next committed turn without restarting play',async t=>{
 const parent=resolve(import.meta.dirname,'../../.pi/npc-implementation/lane-tests');await mkdir(parent,{recursive:true});
 const cwd=await mkdtemp(join(parent,'retry-')),events=new EventEmitter(),hooks=new Map();
 const previous=process.env.PI_COC_MODE;process.env.PI_COC_MODE='play';
 t.after(()=>{if(previous===undefined)delete process.env.PI_COC_MODE;else process.env.PI_COC_MODE=previous;});
 npc({events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:()=>{}});
 let failed=0,attempts=0,published=0;
 const runtime={home:cwd,runTask:async task=>{
  if(++attempts===1)throw new Error('temporary author service failure');
  await writeFile(join(task.request.cwd,'draft.json'),JSON.stringify({personality:{description:'Patient, but protective of her time.'}}));
  return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:['author/test']};
 }};
 const call=async(method,params)=>{
  if(method==='table.look')return {present:[{name:'Anna'}]};
  if(method==='npc.job')return published?{job_id:null}:{job_id:'stable-job',claim:`claim-${failed}`,npc:{name:'Anna'},instruction:'Describe the person.'};
  if(method==='npc.fail'){failed++;return {};}
  if(method==='npc.submit'){assert.equal(params.claim,'claim-1');published++;return {};}
  if(method==='npc.responses.job')return {job_id:null};
  throw new Error(method);
 };
 events.emit('coc:kernel-bridge',{campaign:'test',call,runtime});
 for(const fn of hooks.get('session_start')??[])await fn({}, {cwd,model:{provider:'author',id:'test'},modelRegistry:{}});
 await waitFor(()=>failed===1);
 events.emit('coc:turn-committed',{campaign:'test',turn:1});
 await waitFor(()=>published===1,{timeoutMs:2000});
 assert.equal(attempts,2);
 for(const fn of hooks.get('session_shutdown')??[])await fn({});
});
