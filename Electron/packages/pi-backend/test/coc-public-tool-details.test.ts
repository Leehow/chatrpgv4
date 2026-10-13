import {spawn} from 'node:child_process';
import {appendFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {createPiHostBackend} from '../src/index.js';

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
