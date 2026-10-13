import {spawn} from 'node:child_process';
import {appendFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {expect,it} from 'vitest';
import {createPiHostBackend} from '../src/index.js';

// Production native apply receipts are identifiers, not a synthetic mechanics field.
it('joins actual native apply receipts to their later public delivery, live and on a cold history read',async()=>{
  const repo=resolve(import.meta.dirname,'../../../..');
  const root=await mkdtemp(join(repo,'.tmp','public-apply-delivery-'));
  const nativeFile=join(root,'native.mjs');
  await build({stdin:{contents:["export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';","export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"].join('\n'),
    resolveDir:repo},outfile:nativeFile,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  const native=await import(pathToFileURL(nativeFile).href);
  const context=await native.createKernelContext({workspace:root,content:join(repo,'content'),seed:'public-summary',locks:native.nativeAdvisoryLocks()});
  const kernel=native.createKernelRuntime(context),call=(method:string,params:any={})=>kernel.handlers[method](params);
  const agentDir=join(root,'agent'),sessionsRoot=join(root,'sessions'),directory=join(sessionsRoot,'project'),cwd=join(root,'project');
  await Promise.all([mkdir(agentDir,{recursive:true}),mkdir(directory,{recursive:true}),mkdir(cwd,{recursive:true})]);
  const file=join(directory,'s1.jsonl');
  const binding={type:'custom',id:'binding',customType:'coc-session',data:{campaign:'c',home:root,play_language:'en',mode:'play'}};
  await writeFile(file,[{type:'session',version:3,id:'s1',timestamp:'2026-10-13T00:00:00.000Z',cwd},binding].map(row=>JSON.stringify(row)).join('\n')+'\n');
  const makeBackend=()=>createPiHostBackend({agentDir,sessionsRoot,runtimeRoot:root,piPath:process.execPath,env:{PATH:process.env.PATH??''},
    spawn:(_bin,_args,options)=>spawn(process.execPath,[new URL('./fake-pi.mjs',import.meta.url).pathname],options) as any,
    authRuntime:{getProviders:async()=>[],getAvailable:async()=>[],login:async()=>undefined,logout:async()=>undefined}});
  const backend=makeBackend(),frames:any[]=[];
  backend.subscribe(frame=>{if(frame.channel==='stream')frames.push(frame.event);});
  let cold:ReturnType<typeof makeBackend>|undefined;
  try{
    await call('campaign.create',{id:'c',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
    await call('table.open',{campaign:'c'});
    await call('table.narrate',{campaign:'c',call_id:'t0-c1',text:'You wait in the office.'});
    await call('table.player_input',{campaign:'c',text:'I wait a few minutes.'});
    const applied=await call('table.apply',{campaign:'c',call_id:'t1-c1',effects:[{kind:'time',minutes:3}]});
    const privateApplied=await call('table.apply',{campaign:'c',call_id:'t1-c2',effects:[{kind:'flag',name:'HIDDEN_FLAG',value:true}]});
    const published=await call('table.narrate',{campaign:'c',call_id:'t1-c3',text:'A few minutes pass.'});
    expect(applied.mechanics).toBeUndefined();expect(applied.receipts.every((id:unknown)=>typeof id==='string')).toBe(true);
    expect(published.mechanics.some((item:any)=>applied.receipts.includes(item.receipt))).toBe(true);
    await backend.handle('sendPrompt',['s1','__prose_turn__']);
    const live=(backend as any).live.get('s1');
    let parent='binding';
    const rows:any[]=[{type:'message',id:'user',parentId:parent,message:{role:'user',content:[{type:'text',text:'I wait a few minutes.'}]}}];parent='user';
    for(const [id,details] of [['apply-public',applied],['apply-private',privateApplied]] as const){
      const tool={type:'toolCall',id,name:'apply',arguments:{note:'HIDDEN_INPUT'}};
      const result={content:[{type:'text',text:'HIDDEN_RESULT'}],details};
      rows.push({type:'message',id:`${id}-call`,parentId:parent,message:{role:'assistant',content:[tool]}},
        {type:'message',id:`${id}-result`,parentId:`${id}-call`,timestamp:'2026-10-13T00:00:11.400Z',message:{role:'toolResult',toolCallId:id,toolName:'apply',isError:false,...result}});
      parent=`${id}-result`;
      (backend as any).rpcEvent(live,{type:'tool_execution_start',toolCallId:id,toolName:'apply'});
      (backend as any).rpcEvent(live,{type:'tool_execution_end',toolCallId:id,isError:false,result});
    }
    await appendFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    expect(JSON.parse(frames.find(frame=>frame.type==='tool_result'&&frame.toolCallId==='apply-public').content))
      .toEqual({tool:'apply',status:'completed'});
    const start={type:'custom',id:'stream-start',parentId:parent,customType:'coc-final-delivery',data:{version:1,event:'start',sequence:1,
      campaign:'c',turn:published.turn,worldline:'main',loop:0,delivery_id:'delivery-1',attempt_id:'attempt-1',timestamp:Date.now()}};
    const card={type:'custom',id:'delivered-card',parentId:start.id,customType:'coc-mechanics',data:{...published,final_stream_id:'delivery-1'}};
    await appendFile(file,[start,card].map(row=>JSON.stringify(row)).join('\n')+'\n');
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:start});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card});
    await expect.poll(()=>frames.filter(frame=>frame.type==='tool_result'&&frame.toolCallId==='apply-public').length).toBe(2);
    const publicResult=frames.filter(frame=>frame.type==='tool_result'&&frame.toolCallId==='apply-public').at(-1);
    expect(JSON.parse(publicResult.content)).toEqual({tool:'apply',status:'completed',mechanics:[{kind:'time',minutes:3}]});
    expect(frames.filter(frame=>frame.type==='tool_result'&&frame.toolCallId==='apply-private')).toHaveLength(1);
    expect(JSON.stringify(frames.filter(frame=>frame.type==='tool_result'))).not.toMatch(/HIDDEN_|clock_after|receipt/);
    const history=await backend.handle('getSessionHistory',['s1',0,50]) as any[];
    expect(history.find(row=>row.role==='tool'&&row.toolCallId==='apply-public')?.content).toBe(publicResult.content);
    expect(history.find(row=>row.role==='tool'&&row.toolCallId==='apply-public')?.timestamp).toBe(Date.UTC(2026,9,13,0,0,11,400));
    expect(JSON.parse(history.find(row=>row.role==='tool'&&row.toolCallId==='apply-private')!.content)).toEqual({tool:'apply',status:'completed'});
    await backend.close();cold=makeBackend();
    const restored=await cold.handle('getSessionHistory',['s1',0,50]) as any[];
    expect(restored.find(row=>row.role==='tool'&&row.toolCallId==='apply-public')?.content).toBe(publicResult.content);
    expect(restored.find(row=>row.role==='tool'&&row.toolCallId==='apply-public')?.timestamp).toBe(Date.UTC(2026,9,13,0,0,11,400));
  }finally{await backend.close();await cold?.close();await kernel.close();await rm(root,{recursive:true,force:true});}
},30000);

it.each(['matching','unmatched','other-turn','other-user','other-campaign','other-branch','missing-link','wrong-link'] as const)
  ('keeps delivered summaries within their receipt, turn, user and selected lineage: %s',async variant=>{
  const root=await mkdtemp(join(tmpdir(),'pipi-public-lineage-'));
  const agentDir=join(root,'agent'),sessionsRoot=join(root,'sessions'),directory=join(sessionsRoot,'project'),cwd=join(root,'project');
  await Promise.all([mkdir(agentDir,{recursive:true}),mkdir(directory,{recursive:true}),mkdir(cwd,{recursive:true})]);
  const file=join(directory,'s1.jsonl'),callId='call-1';
  const result={content:[{type:'text',text:'HIDDEN_RESULT'}],details:{receipts:['time-owned','roll-concealed','roll-keeper','document-owned'],
    world:{plan:'HIDDEN_PLAN'},material:{source:'/private/source.pdf'}}};
  const start={type:'custom',id:'start',parentId:variant==='other-branch'?'user':'result',customType:'coc-final-delivery',data:{
    version:1,event:'start',sequence:1,delivery_id:'delivery-1',attempt_id:'attempt-1',campaign:variant==='other-campaign'?'foreign':'c',
    turn:1,worldline:'selected-line',loop:2,timestamp:Date.now()}};
  const card={type:'custom',id:'card',parentId:'start',customType:'coc-mechanics',data:{turn:variant==='other-turn'?2:1,
    ...(variant==='missing-link'?{}:{final_stream_id:variant==='wrong-link'?'unpublished':'delivery-1'}),mechanics:[
      {kind:'time',receipt:variant==='unmatched'?'foreign-receipt':'time-owned',minutes:3},
      {kind:'roll',receipt:'roll-concealed',visibility:'concealed',skill:'Psychology',roll:97,target:50,passed:false,actor_label:'HIDDEN_ACTOR'},
      {kind:'roll',receipt:'roll-keeper',visibility:'keeper',skill:'HIDDEN_SKILL',roll:1},
      {kind:'handout',receipt:'document-owned',name:'Public letter',document:'/private/handout.md'},
      {kind:'time',receipt:'unmatched',minutes:99},
    ]}};
  if(variant==='unmatched')card.data.mechanics=card.data.mechanics.filter(item=>item.kind==='time');
  const rows:any[]=[{type:'session',version:3,id:'s1',timestamp:'2026-10-13T00:00:00.000Z',cwd},
    {type:'custom',id:'binding',customType:'coc-session',data:{campaign:'c',home:root,play_language:'en',mode:'play'}},
    {type:'message',id:'user',parentId:'binding',message:{role:'user',content:[{type:'text',text:'I wait.'}]}},
    {type:'message',id:'call',parentId:'user',message:{role:'assistant',content:[{type:'toolCall',id:callId,name:'apply',arguments:{plan:'HIDDEN_INPUT'}}]}},
    {type:'message',id:'result',parentId:'call',message:{role:'toolResult',toolCallId:callId,toolName:'apply',isError:false,...result}}];
  await writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const backend=createPiHostBackend({agentDir,sessionsRoot,runtimeRoot:root,piPath:process.execPath,env:{PATH:process.env.PATH??''},
    spawn:(_bin,_args,options)=>spawn(process.execPath,[new URL('./fake-pi.mjs',import.meta.url).pathname],options) as any,
    authRuntime:{getProviders:async()=>[],getAvailable:async()=>[],login:async()=>undefined,logout:async()=>undefined}});
  const frames:any[]=[];backend.subscribe(frame=>{if(frame.channel==='stream')frames.push(frame.event);});
  try{
    await backend.handle('sendPrompt',['s1','__prose_turn__']);const live=(backend as any).live.get('s1');
    (backend as any).rpcEvent(live,{type:'tool_execution_start',toolCallId:callId,toolName:'apply'});
    (backend as any).rpcEvent(live,{type:'tool_execution_end',toolCallId:callId,isError:false,result});
    const publication:any[]=[];
    if(variant==='other-user'){
      publication.push({type:'message',id:'next-user',parentId:'result',message:{role:'user',content:[{type:'text',text:'I continue.'}]}});
      start.parentId='next-user';
    }
    publication.push(start,card);await appendFile(file,publication.map(row=>JSON.stringify(row)).join('\n')+'\n');
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:start});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card});
    const expected=variant==='matching'?{tool:'apply',status:'completed',mechanics:[{kind:'time',minutes:3},{kind:'roll',skill:'Psychology'}]}
      :{tool:'apply',status:'completed'};
    const original=await readFile(file,'utf8');
    const history=await backend.handle('getSessionHistory',['s1',0,50]) as any[];
    const saved=history.find(row=>row.role==='tool'&&row.toolCallId===callId);
    if(variant==='other-branch')expect(saved).toBeUndefined();else expect(JSON.parse(saved.content)).toEqual(expected);
    if(variant==='matching'){
      await expect.poll(()=>frames.filter(frame=>frame.type==='tool_result'&&frame.toolCallId===callId).length).toBe(2);
      (backend as any).rpcEvent(live,{type:'entry_appended',entry:card});
      await expect.poll(()=>frames.filter(frame=>frame.type==='tool_result'&&frame.toolCallId===callId).length).toBe(3);
    }else await new Promise(done=>setTimeout(done,50));
    const results=frames.filter(frame=>frame.type==='tool_result'&&frame.toolCallId===callId);
    expect(JSON.parse(results.at(-1).content)).toEqual(expected);
    expect(results).toHaveLength(variant==='matching'?3:1);
    expect(JSON.stringify(results)).not.toMatch(/HIDDEN_|\/private\/|receipt|99|97/);
    expect(await readFile(file,'utf8')).toBe(original,'summary projection never edits its source history');
  }finally{await backend.close();await rm(root,{recursive:true,force:true});}
},30000);

it('keeps a failed play step inspectable without exposing its private input or diagnostic, live and after reload',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pipi-public-step-'));
  const agentDir=join(root,'agent'),sessionsRoot=join(root,'sessions'),directory=join(sessionsRoot,'project'),cwd=join(root,'project');
  await Promise.all([mkdir(agentDir,{recursive:true}),mkdir(directory,{recursive:true}),mkdir(cwd,{recursive:true})]);
  const file=join(directory,'s1.jsonl');
  await writeFile(file,[{type:'session',version:3,id:'s1',timestamp:'2026-10-13T00:00:00.000Z',cwd},
    {type:'custom',id:'binding',customType:'coc-session',data:{campaign:'c',home:root,play_language:'en',mode:'play'}}]
    .map(row=>JSON.stringify(row)).join('\n')+'\n');
  const backend=createPiHostBackend({agentDir,sessionsRoot,runtimeRoot:root,piPath:process.execPath,env:{PATH:process.env.PATH??''},
    spawn:(_bin,_args,options)=>spawn(process.execPath,[new URL('./fake-pi.mjs',import.meta.url).pathname],options) as any,
    authRuntime:{getProviders:async()=>[],getAvailable:async()=>[],login:async()=>undefined,logout:async()=>undefined}});
  const frames:any[]=[];
  backend.subscribe(frame=>{if(frame.channel==='stream')frames.push(frame.event);});
  try{
    await backend.handle('sendPrompt',['s1','__prose_turn__']);
    const live=(backend as any).live.get('s1');
    const call={type:'toolCall',id:'apply-1',name:'apply',arguments:{name:'HIDDEN_NPC',note:'HIDDEN_PLAN'}};
    const result={content:[{type:'text',text:'HIDDEN_SOURCE /private/source.pdf'}],
      details:{coc_error:{code:'invalid_params',message:'HIDDEN_ERROR /private/state.json',fix:'HIDDEN_FIX',details:{name:'HIDDEN_NPC'}},
        outcome:{summary:'HIDDEN_OUTCOME'}}};
    (backend as any).rpcEvent(live,{type:'message_update',assistantMessageEvent:{type:'toolcall_end',contentIndex:0,toolCall:call}});
    (backend as any).rpcEvent(live,{type:'tool_execution_start',toolCallId:call.id,toolName:call.name});
    (backend as any).rpcEvent(live,{type:'tool_execution_end',toolCallId:call.id,isError:true,result});
    const event=frames.find(frame=>frame.type==='tool_result'&&frame.toolCallId===call.id);
    expect(JSON.parse(event.content)).toEqual({tool:'apply',status:'failed',error_code:'invalid_params'});
    expect(event.isError).toBe(true);
    expect(JSON.stringify(frames)).not.toContain('HIDDEN_');
    expect(JSON.stringify(frames)).not.toContain('/private/');

    await appendFile(file,[{type:'message',id:'call-row',parentId:'binding',message:{role:'assistant',content:[call]}},
      {type:'message',id:'result-row',parentId:'call-row',message:{role:'toolResult',toolName:'apply',toolCallId:call.id,isError:true,...result}}]
      .map(row=>JSON.stringify(row)).join('\n')+'\n');
    const history=await backend.handle('getSessionHistory',['s1',0,50]) as any[];
    const saved=history.find(row=>row.role==='tool'&&row.toolCallId===call.id);
    expect(saved.content).toBe(event.content);
    expect(saved.isError).toBe(true);
    expect(JSON.stringify(history)).not.toContain('HIDDEN_');
    expect(JSON.stringify(history)).not.toContain('/private/');

    (backend as any).rpcEvent(live,{type:'tool_execution_start',toolCallId:'lookup-2',toolName:'lookup'});
    (backend as any).rpcEvent(live,{type:'tool_execution_end',toolCallId:'lookup-2',isError:true,
      result:{content:[{type:'text',text:'HIDDEN_LOOKUP'}],details:{coc_error:{code:'HIDDEN_UNREGISTERED_CODE',message:'HIDDEN_ERROR'}}}});
    expect(JSON.parse(frames.find(frame=>frame.type==='tool_result'&&frame.toolCallId==='lookup-2').content))
      .toEqual({tool:'lookup',status:'failed',error_code:'unknown'});
    expect(JSON.stringify(frames)).not.toContain('HIDDEN_');
  }finally{await backend.close();await rm(root,{recursive:true,force:true});}
},30000);

it('shows public settlement figures while keeping concealed outcomes, hidden actors and document references private',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pipi-public-mechanics-'));
  const agentDir=join(root,'agent'),sessionsRoot=join(root,'sessions'),directory=join(sessionsRoot,'project'),cwd=join(root,'project');
  await Promise.all([mkdir(agentDir,{recursive:true}),mkdir(directory,{recursive:true}),mkdir(cwd,{recursive:true})]);
  const file=join(directory,'s1.jsonl');
  await writeFile(file,[{type:'session',version:3,id:'s1',timestamp:'2026-10-13T00:00:00.000Z',cwd},
    {type:'custom',id:'binding',customType:'coc-session',data:{campaign:'c',home:root,play_language:'en',mode:'play'}}]
    .map(row=>JSON.stringify(row)).join('\n')+'\n');
  const backend=createPiHostBackend({agentDir,sessionsRoot,runtimeRoot:root,piPath:process.execPath,env:{PATH:process.env.PATH??''},
    spawn:(_bin,_args,options)=>spawn(process.execPath,[new URL('./fake-pi.mjs',import.meta.url).pathname],options) as any,
    authRuntime:{getProviders:async()=>[],getAvailable:async()=>[],login:async()=>undefined,logout:async()=>undefined}});
  const frames:any[]=[];
  backend.subscribe(frame=>{if(frame.channel==='stream')frames.push(frame.event);});
  try{
    await backend.handle('sendPrompt',['s1','__prose_turn__']);
    const live=(backend as any).live.get('s1');
    const call={type:'toolCall',id:'resolve-1',name:'resolve',arguments:{target:'HIDDEN_NPC'}};
    const result={content:[{type:'text',text:'HIDDEN_RULE_EXPLANATION'}],details:{mechanics:[
      {kind:'roll',visibility:'public',skill:'Library Use',roll:12,target:40,level:'hard',passed:true,
        actor_label:'HIDDEN_NONCOMBAT_NPC',target_label:'HIDDEN_TARGET',source:'/private/rules.pdf',why:'HIDDEN_CAUSE'},
      {kind:'roll',visibility:'concealed',skill:'Psychology',roll:99,target:50,level:'failure',passed:false,
        actor_label:'HIDDEN_ACTOR',target_label:'HIDDEN_TARGET'},
      {kind:'roll',visibility:'keeper',skill:'HIDDEN_CHECK',roll:1},
      {kind:'roll',visibility:'invalid',skill:'HIDDEN_MALFORMED_CHECK',roll:2},
      {kind:'handout',name:'Public letter',document:'/private/handout.md',path:'/private/handout.md',image_path:'/private/image.png'},
      {kind:'choice',option:'HIDDEN_ARBITRARY_CHOICE'},
    ],outcome:{summary:'HIDDEN_SUMMARY'}}};
    (backend as any).rpcEvent(live,{type:'message_update',assistantMessageEvent:{type:'toolcall_end',contentIndex:0,toolCall:call}});
    (backend as any).rpcEvent(live,{type:'tool_execution_start',toolCallId:call.id,toolName:call.name});
    (backend as any).rpcEvent(live,{type:'tool_execution_end',toolCallId:call.id,isError:false,result});
    const event=frames.find(frame=>frame.type==='tool_result'&&frame.toolCallId===call.id);
    expect(JSON.parse(event.content)).toEqual({tool:'resolve',status:'completed',mechanics:[
      {kind:'roll',skill:'Library Use',roll:12,target:40,level:'hard',passed:true},
      {kind:'roll',skill:'Psychology'},
    ]});
    expect(JSON.stringify(frames)).not.toContain('HIDDEN_');
    expect(JSON.stringify(frames)).not.toContain('/private/');
    await appendFile(file,[{type:'message',id:'call-row',parentId:'binding',message:{role:'assistant',content:[call]}},
      {type:'message',id:'result-row',parentId:'call-row',message:{role:'toolResult',toolName:'resolve',toolCallId:call.id,isError:false,...result}}]
      .map(row=>JSON.stringify(row)).join('\n')+'\n');
    const history=await backend.handle('getSessionHistory',['s1',0,50]) as any[];
    expect(history.find(row=>row.role==='tool'&&row.toolCallId===call.id)?.content).toBe(event.content);
    expect(JSON.stringify(history)).not.toContain('HIDDEN_');
    expect(JSON.stringify(history)).not.toContain('/private/');
  }finally{await backend.close();await rm(root,{recursive:true,force:true});}
},30000);
