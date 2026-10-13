// Bounded writer/provider substitute at the public runtime adapter. Never real-play evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runtimeCapabilities} from '../../../runtime/tasks.ts';
export const ownedOutputProvider={
  async runTask(context,task,signal){
    if(!task.request.finalOutput)return runtimeCapabilities.runTask(context,task,signal);
    signal.throwIfAborted();
    const request=task.request,packet=JSON.parse(await readFile(join(request.cwd,'task.json'),'utf8'));
    const rows=packet.materials.filter(row=>row.name.startsWith('legacy draft:'));
    if(!rows.length)throw Error('This controlled provider only realizes the supplied legacy fixture');
    // Report the model the host launched this author on, as a real child would.
    const launched=String(request.model??''),slash=launched.indexOf('/'),provider=launched.slice(0,slash),id=launched.slice(slash+1);
    const usage={input:10,output:20,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
    const charge=await request.providerBudget?.reserve({model:{provider,id,api:'openai-completions',maxTokens:1000,contextWindow:128000,
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},inputTokens:10,outputTokens:100},signal);
    try{
      const text=rows.map(row=>row.text).join('');let start=0;
      const coverage=rows.map(row=>{const span={name:row.name,start,end:start+row.text.length};start=span.end;return span;});
      await writeFile(join(request.cwd,'draft.json'),JSON.stringify({version:1,text,coverage}));
      request.onEvent?.({type:'message_end',message:{role:'assistant',provider,model:id,usage,stopReason:'stop',content:[]}});
      charge?.settle(usage);
      return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[],usage:{inputTokens:10,outputTokens:20,costUsd:0,actions:1,unknownCalls:0}};
    }finally{charge?.release();}
  }
};
