/** Real Pi completion/options and Responses wire payload against a local fixture, not live gameplay. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ModelRuntime} from './pi.mjs';
import {runLane} from '../../extensions/lanes/subsession.ts';
import {relayModels} from '../../extensions/codex-relay/agent/models.js';

const laneEnv='PI_COC_LIVE_PROFILE_FIXTURE_MODEL';
async function round(t,{profile,thinking,expected,source='test-profile',afterDelivery=false}){
  const [provider,id]=(profile?.startsWith('grok-build/')?'grok-build/grok-4.5':'codex-relay/gpt-6-luna').split('/');
  const saved=Object.fromEntries(['PI_COC_TEST_MODEL','PI_COC_LANE_THINKING',laneEnv,`${laneEnv}_THINKING`].map(key=>[key,process.env[key]]));
  if(profile===undefined)delete process.env.PI_COC_TEST_MODEL;else process.env.PI_COC_TEST_MODEL=profile;
  process.env[laneEnv]=`${provider}/${id}`;process.env[`${laneEnv}_THINKING`]='medium';process.env.PI_COC_LANE_THINKING='off';
  t.after(()=>{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const bodies=[];
  const server=createServer((request,response)=>{
    let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
      bodies.push(JSON.parse(body));
      const text='{"okay":true}',item={id:'msg_fixture',type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]};
      const events=[
        {type:'response.created',response:{id:'resp_fixture',model:id,status:'in_progress',output:[]}},
        {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
        {type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
        {type:'response.output_text.delta',output_index:0,content_index:0,delta:text},
        {type:'response.output_item.done',output_index:0,item},
        {type:'response.completed',response:{id:'resp_fixture',model:id,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}},
      ];
      response.writeHead(200,{'content-type':'text/event-stream'});response.end(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const home=mkdtempSync(join(tmpdir(),'lane-live-profile-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const runtime=await ModelRuntime.create({authPath:join(home,'auth.json'),modelsPath:null,modelsStorePath:join(home,'models.json'),refreshOnCreate:false});
  runtime.registerProvider(provider,{api:'openai-responses',apiKey:'fixture-key',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{...relayModels()[0],id}]});
  const model=runtime.getModel(provider,id),sent=[],rows=[],complete=runtime.complete.bind(runtime);
  runtime.complete=(selected,context,options)=>{sent.push({model:selected,context,options});return complete(selected,context,options);};
  const registry={find:runtime.getModel.bind(runtime),complete:runtime.complete.bind(runtime)};
  const result=await runLane({ctx:{cwd:home,model,thinkingLevel:'off',modelRegistry:registry,sessionManager:{getSessionId:()=>undefined}},
    envName:laneEnv,lane:'live-profile-fixture',systemPrompt:'Return one short JSON verdict.',input:'Return {"okay":true}.',
    ...(thinking===undefined?{}:{thinking}),afterDelivery,record:row=>rows.push(row),shape:value=>value});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.model,`${provider}/${id}`);
  assert.equal(sent.length,1);assert.deepEqual(sent[0].model,model);assert.equal(sent[0].options.reasoningEffort,expected);
  assert.equal(sent[0].context.tools,undefined);assert.equal(bodies.length,1);assert.equal(bodies[0].model,id);
  assert.equal(bodies[0].reasoning.effort,expected,'actual Pi adapter HTTP body carries the selected profile');
  const start=rows.find(row=>row.phase==='start'),payload=rows.find(row=>row.phase==='request');
  assert.equal(start.model,`${provider}/${id}`);assert.equal(start.lane_thinking,expected);
  assert.equal(start.lane_thinking_effective,sent[0].options.reasoningEffort);assert.equal(start.thinking_source,source);
  assert.equal(start.thinking_carried,true);assert.equal(payload.reasoning_effort,bodies[0].reasoning.effort);
}
for(const profile of ['codex-relay/gpt-6-luna','grok-build/grok-4.5'])for(const thinking of ['off','low']){
  test(`${profile} overrides caller ${thinking} on the actual request and telemetry`,t=>round(t,{profile,thinking,expected:profile.startsWith('codex-relay/')?'high':'low'}));
}
test('the fallback remains low even against an explicit high caller and the post-delivery floor',t=>round(t,{profile:'grok-build/grok-4.5',thinking:'high',expected:'low',afterDelivery:true}));
test('ordinary runs retain caller precedence over lane environment defaults',t=>round(t,{thinking:'low',expected:'low',source:'caller'}));
test('another test model value retains caller precedence',t=>round(t,{profile:'codex-relay/gpt-6-other',thinking:'low',expected:'low',source:'caller'}));
test('the acceptance profile match is exact',t=>round(t,{profile:'codex-relay/gpt-6-luna ',thinking:'low',expected:'low',source:'caller'}));
test('ordinary runs without a caller retain per-lane environment precedence',t=>round(t,{expected:'medium',source:'lane-operator'}));
