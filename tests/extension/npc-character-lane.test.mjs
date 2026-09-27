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

test('with a Jev key the NPC lane authors personalities only: no advice hook, no Jev call, no bank method (§143.6)',async t=>{
 const parent=resolve(import.meta.dirname,'../../.pi/npc-implementation/lane-tests');await mkdir(parent,{recursive:true});
 const cwd=await mkdtemp(join(parent,'retired-')),hooks=new Map(),events=new EventEmitter(),entries=[];
 const values={PI_COC_MODE:'play',EXT_JEV_APIKEY:'test-only-credential'};
 const previous=new Map(Object.keys(values).map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;Object.assign(process.env,values);
 let fetched=0;globalThis.fetch=async()=>{fetched++;throw new Error('the NPC lane has no Jev call left to make');};
 t.after(()=>{globalThis.fetch=originalFetch;for(const[k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 npc({events,on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);},appendEntry:(...row)=>entries.push(row)});
 assert.deepEqual(['before_agent_start','context','tool_result'].filter(name=>hooks.has(name)),[],'nothing of the NPC lane rides the Keeper request');
 const methods=[];let published=0;
 const runtime={home:cwd,runTask:async task=>{
  await writeFile(join(task.request.cwd,'draft.json'),JSON.stringify({personality:{description:'Anna keeps her own counsel but answers plainly.'}}));
  return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:['author/test']};
 }};
 const call=async(method,params)=>{
  methods.push(method);
  if(method==='table.look')return {present:[{name:'Anna'}]};
  if(method==='npc.job')return published?{job_id:null}:{job_id:'job-anna',claim:'claim-anna',npc:{name:params.name},instruction:'Describe the person.'};
  if(method==='npc.submit'){published++;return {};}
  throw new Error('Unexpected RPC '+method);
 };
 events.emit('coc:kernel-bridge',{campaign:'test',call,runtime});
 for(const fn of hooks.get('session_start')??[])await fn({}, {cwd,model:{provider:'author',id:'test'},modelRegistry:{}});
 await waitFor(()=>published===1);
 events.emit('coc:turn-committed',{campaign:'test',turn:1});
 await waitFor(()=>methods.filter(method=>method==='table.look').length===2&&methods.at(-1)==='npc.job');
 assert.deepEqual([...new Set(methods)].sort(),['npc.job','npc.submit','table.look'],'no bank job and no perspective read');
 assert.equal(fetched,0);
 const kinds=entries.filter(([type])=>type==='coc-telemetry').map(([,row])=>row.kind);
 assert.deepEqual([...new Set(kinds)],['personality'],'the lane writes personality rows only');
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
