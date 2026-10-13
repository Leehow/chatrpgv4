import {spawn} from 'node:child_process';
import {appendFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {createPiHostBackend} from '../src/index.js';
import {FinalDeliveryHistory} from '../src/final-delivery-history.js';

it('retains a completed public reference stream until a canonical prose replacement exists',()=>{
  const history=new FinalDeliveryHistory();
  const base={version:1,campaign:'c',turn:1,worldline:'main',loop:0,run:'run',input_revision:'input',delivery_id:'reference',attempt_id:'attempt',timestamp:1};
  for(const [index,row] of [{event:'start',status:'streaming'},{event:'delta',delta:'Public rules answer.'},{event:'end',status:'completed'}].entries())
    history.accept({customType:'coc-final-delivery',data:{...base,...row,sequence:index+1}});
  expect(history.entry('reference')?.presentation?.details?.chunks).toEqual(['Public rules answer.']);
  history.accept({customType:'coc-mechanics',data:{final_stream_id:'reference'}});
  expect(history.entry('reference')).toBeUndefined();
});

it('forwards real delivery frames immediately and restores one interrupted prefix from the transcript',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pipi-final-stream-'));
  const agentDir=join(root,'agent'),sessionsRoot=join(root,'sessions'),directory=join(sessionsRoot,'project'),cwd=join(root,'project');
  await Promise.all([mkdir(agentDir,{recursive:true}),mkdir(directory,{recursive:true}),mkdir(cwd,{recursive:true})]);
  const file=join(directory,'s1.jsonl');
  await writeFile(file,[{type:'session',version:3,id:'s1',timestamp:'2026-10-13T00:00:00.000Z',cwd},
    {type:'custom',id:'binding',customType:'coc-session',data:{campaign:'c',home:root,play_language:'en',mode:'play'}}].map(row=>JSON.stringify(row)).join('\n')+'\n');
  const backend=createPiHostBackend({agentDir,sessionsRoot,runtimeRoot:root,piPath:process.execPath,env:{PATH:process.env.PATH??''},
    spawn:(_bin,_args,options)=>spawn(process.execPath,[new URL('./fake-pi.mjs',import.meta.url).pathname],options) as any,
    authRuntime:{getProviders:async()=>[],getAvailable:async()=>[],login:async()=>undefined,logout:async()=>undefined}});
  const seen:any[]=[],publicFrames:any[]=[];
  backend.subscribe(frame=>{if(frame.channel==='stream'){publicFrames.push(frame.event);if(frame.event.type==='final_delivery')seen.push(frame.event);}});
  try {
    await backend.handle('sendPrompt',['s1','__prose_turn__']);
    for(let at=0;at<100&&!(backend as any).live.get('s1');at++)await new Promise(resolve=>setTimeout(resolve,10));
    const live=(backend as any).live.get('s1');
    for(const type of ['text_delta','thinking_delta','toolcall_delta'])
      (backend as any).rpcEvent(live,{type:'message_update',assistantMessageEvent:{type,contentIndex:0,delta:'HIDDEN_CONTROL_RECORD'}});
    (backend as any).rpcEvent(live,{type:'tool_execution_end',toolCallId:'private-tool',result:{content:[{type:'text',text:'HIDDEN_TOOL_RESULT'}],details:{secret:'HIDDEN_TOOL_DETAILS'}}});
    expect(JSON.stringify(publicFrames)).not.toContain('HIDDEN_');
    const privateRow={type:'message',id:'private-row',parentId:'binding',message:{role:'assistant',content:[
      {type:'text',text:'HIDDEN_CONTROL_RECORD'},{type:'thinking',thinking:'HIDDEN_THOUGHT'},
      {type:'toolCall',id:'private-tool',name:'apply',arguments:{secret:'HIDDEN_ARGUMENT'}}]}};
    await appendFile(file,JSON.stringify(privateRow)+'\n');
    await appendFile(file,JSON.stringify({type:'compaction',id:'private-compaction',parentId:'private-row',summary:'HIDDEN_COMPACTION',firstKeptEntryId:'binding',tokensBefore:1000})+'\n');
    const base={version:1,campaign:'c',turn:1,worldline:'main',loop:0,run:'run',input_revision:'input',delivery_id:'delivery',attempt_id:'attempt'};
    let parent='private-compaction';
    for(const [index,content] of [{event:'start',status:'streaming'},{event:'delta',delta:'A visible prefix.'},{event:'end',status:'interrupted'}].entries()){
      const row={type:'custom',id:`frame-${index}`,parentId:parent,customType:'coc-final-delivery',timestamp:new Date().toISOString(),data:{...base,...content,sequence:index+1,timestamp:Date.now()}};
      await appendFile(file,JSON.stringify(row)+'\n');parent=row.id;
      (backend as any).rpcEvent((backend as any).live.get('s1'),{type:'entry_appended',entry:row});
      expect(seen).toHaveLength(index+1);
    }
    const history=await backend.handle('getSessionHistory',['s1',0,50]) as any[];
    expect(JSON.stringify(history)).not.toContain('HIDDEN_');
    const entries=history.filter(row=>row.presentation?.renderer==='coc-stream');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('coc-final:delivery');
    expect(entries[0].presentation.details.chunks.join('')).toBe('A visible prefix.');
    expect(entries[0].presentation.details.status).toBe('interrupted');
  } finally {await backend.close();await rm(root,{recursive:true,force:true});}
},30000);
