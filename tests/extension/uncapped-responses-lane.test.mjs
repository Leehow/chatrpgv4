/** Real Pi Responses transport against a rejecting HTTP fixture, not a playtest. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ModelRuntime} from './pi.mjs';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {createTaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {runLane} from '../../extensions/lanes/subsession.ts';
import {FLAPCODE_MODELS} from '../../extensions/flapcode/agent/models.js';

test('native model capability reaches zero-tool completion: funded request succeeds and unfunded request never reaches the relay',async t=>{
 const bodies=[];
 const server=createServer((req,res)=>{
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   const payload=JSON.parse(body);bodies.push(payload);
   if(Object.hasOwn(payload,'max_output_tokens')){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({detail:'Unsupported parameter: max_output_tokens'}));return;}
   const text=JSON.stringify({okay:true}),item={id:'msg_fixture',type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]};
   const events=[
    {type:'response.created',response:{id:'resp_fixture',model:'uncapped',status:'in_progress',output:[]}},
    {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
    {type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
    {type:'response.output_text.delta',output_index:0,content_index:0,delta:text},
    {type:'response.output_item.done',output_index:0,item},
    {type:'response.completed',response:{id:'resp_fixture',model:'uncapped',status:'completed',output:[item],usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}},
   ];
   res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const home=mkdtempSync(join(tmpdir(),'uncapped-lane-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const runtime=await ModelRuntime.create({authPath:join(home,'auth.json'),modelsPath:null,modelsStorePath:join(home,'models.json'),refreshOnCreate:false});
 runtime.registerProvider('transport-fixture',{api:'openai-responses',apiKey:'fixture-key',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{
  id:'uncapped',name:'Uncapped transport',api:'openai-responses',reasoning:false,input:['text'],maxTokens:128000,contextWindow:100000,
  cost:{input:1,output:2,cacheRead:0,cacheWrite:0},compat:{supportsMaxOutputTokens:false},
 }]});
 const model=runtime.getModel('transport-fixture','uncapped');
 assert.equal(model.compat.supportsMaxOutputTokens,false);
 assert.ok(FLAPCODE_MODELS.every(model=>model.compat.supportsMaxOutputTokens===false));
 const manifest=JSON.parse(readFileSync(new URL('../../extensions/flapcode/pipiui-extension.json',import.meta.url)));
 assert.ok(manifest.auth.provider.models.every(model=>model.compat.supportsMaxOutputTokens===false));
 const lease=output=>new TaskLease({owner:'uncapped-lane-test',goal:'Verify the real completion transport',scope:{owner:'test',audience:'system'},readSet:[],capabilities:[],budget:{deadlineAt:Date.now()+10000,remainingInputTokens:20000,remainingOutputTokens:output,remainingCostUsd:1,remainingActions:2}});
 const invoke=owner=>runLane({ctx:{model,modelRegistry:runtime,sessionManager:{getSessionId:()=>undefined}},providerBudget:createTaskProviderBudget(owner),timeoutMs:5000,
  envName:'UNUSED_TRANSPORT_FIXTURE_MODEL',lane:'transport-test',systemPrompt:'Return one short JSON verdict.',input:'Return {"okay":true}.',shape:value=>value});
 const funded=lease(128000);t.after(()=>funded.close());
 const result=await invoke(funded);assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.value,{okay:true});
 assert.equal(bodies.length,1);assert.equal(Object.hasOwn(bodies[0],'max_output_tokens'),false);assert.equal(funded.context.budget.remainingOutputTokens,127995);
 const small=lease(8192);t.after(()=>small.close());const refused=await invoke(small);
 assert.equal(refused.ok,false);assert.match(refused.detail,/task_budget_exhausted/);assert.equal(bodies.length,1,'the rejected owner never sends an HTTP request');
});
