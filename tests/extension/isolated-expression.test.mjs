import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {ExpressionPlanStream,expressionBrief,writeIsolatedExpression,EXPRESSION_PROFILE,expressionAuthorProfile} from '../../runtime/isolated-expression.ts';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';
const brief={scene:'An office.',narrative_content:[],npc_turns:[{speaker:'Steven Knott',intent:'Offer a meeting at dawn.',personality:'Practical',emotion:null}]};

test('the explicit MiniMax profile reaches the isolated request and actual-model verification',async t=>{
  assert.deepEqual(expressionAuthorProfile({}),EXPRESSION_PROFILE);
  assert.deepEqual(expressionAuthorProfile({PI_COC_TEST_MODEL:'minimax-cn/MiniMax-M3.1-Flash-Preview'}),{model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium'});
  const previous=process.env.PI_COC_TEST_MODEL;
  const home=await mkdtemp(join(tmpdir(),'expression-minimax-'));const calls=[],rows=[];
  t.after(()=>rm(home,{recursive:true,force:true}));
  process.env.PI_COC_TEST_MODEL='minimax-cn/MiniMax-M3.1-Flash-Preview';
  try {
    const runtime={home,async runTask(task){calls.push(task);task.request.onEvent({type:'message_end',message:{role:'assistant',provider:'minimax-cn',model:'MiniMax-M3.1-Flash-Preview',stopReason:'stop',content:[{type:'text',text:'{{public}}The office is quiet.'}]}});return{ok:true,ms:1};}};
    const result=await writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief,language:'en',stream:{push:()=>{}},record:async row=>rows.push(row)});
    assert.equal(calls[0].request.model,'minimax-cn/MiniMax-M3.1-Flash-Preview');assert.equal(calls[0].request.thinking,'medium');
    assert.deepEqual(rows.at(-1).actual_models,['minimax-cn/MiniMax-M3.1-Flash-Preview']);assert.equal(result.thinking,'medium');
  } finally {if(previous===undefined)delete process.env.PI_COC_TEST_MODEL;else process.env.PI_COC_TEST_MODEL=previous;}
});

test('chunked private composition never exposes the Keeper packet',()=>{
  const stream=new ExpressionPlanStream(),body='{{compose}}'+JSON.stringify(brief);
  for(const part of body)assert.equal(stream.push(part),'');
  assert.deepEqual(stream.finish().expression,brief);
});

test('reference answers keep their direct scope and text',()=>{
  const stream=new ExpressionPlanStream();
  assert.equal(stream.push('{{reference}}A direct answer.'),'A direct answer.');
  assert.equal(stream.finish().record.scope,'reference');
  assert.equal(stream.finish().expression,undefined);
});

test('the expression protocol accepts only the selected brief, not arbitrary history',()=>{
  assert.throws(()=>expressionBrief(JSON.stringify({...brief,keeper_context:'private'})),/Invalid private/);
  assert.throws(()=>new ExpressionPlanStream().push('{{public}}An old draft.'),/Expected a private/);
});

test('named live writing preferences survive the private brief unchanged',()=>{
  const writing={establish_first_sight:true,say_tokens:['stoneworker'],register:'ordinary speech',note:'Keep the morning street visible.'};
  const stream=new ExpressionPlanStream();
  stream.push('{{compose}}'+JSON.stringify({...brief,writing}));
  assert.deepEqual(stream.finish().expression,{...brief,writing});
});

test('isolated delivery prepares selected speaker labels before the first public byte',async t=>{
  const home=await mkdtemp(join(tmpdir(),'expression-speakers-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const calls=[],frames=[];
  const owner=createFinalOutputOwner({runtime:()=>({home}),record:async()=>{},stream:frame=>frames.push(frame),
    call:async(method,params)=>{
      calls.push({method,params});
      if(method==='table.capsule')return{_context:{campaign:'c',turn:1,worldline:'main',loop:0,task_world_revision:'w',task_source_revision:'s'},turn:{player_text:'I ask the gatekeeper.'},present:[{name:'Gatekeeper'}]};
      if(method==='table.delivery.check')return{speakers:params.speakers.map(name=>({name,who:{label:name}}))};
      return{};
    }});
  const stream=await owner.openStream('c',1,'r','isolated-expression',['Hugh Moore']);
  stream.push('{{say:Hugh Moore}}Morning.{{/say}}');
  assert.deepEqual(calls.find(row=>row.method==='table.delivery.check').params.speakers,['Hugh Moore','Gatekeeper']);
  assert.equal(frames[0].event,'start');
  assert.ok(frames[0].speakers.some(speaker=>speaker.name==='Hugh Moore'));
  assert.equal(frames[1].event,'delta');
});

test('one fresh tool-enabled author receives only the brief and its changed wording is not judged or repaired',async t=>{
  const home=await mkdtemp(join(tmpdir(),'expression-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const calls=[],prose=[],records=[];
  const runtime={home,async runTask(task){calls.push(task);const message={role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'{{public}}The meeting is at noon.'}]};task.request.onEvent({type:'message_end',message});return{ok:true,ms:1};}};
  const result=await writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief,language:'fr',stream:{push:text=>prose.push(text)},record:async row=>records.push(row)});
  assert.equal(result.text,'The meeting is at noon.');
  assert.equal(prose.join(''),result.text);
  assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(calls[0].request.brief),{play_language:'fr',...brief});
  assert.equal(calls[0].request.model,EXPRESSION_PROFILE.model);
  assert.equal(calls[0].request.thinking,'off');
  assert.equal(calls[0].request.tools,'read,write,edit,bash');
  assert.equal(records.at(-1).event,'written');
});

test('Keeper-only selection notes stay in private telemetry and never enter the author packet',async t=>{
  const home=await mkdtemp(join(tmpdir(),'expression-private-selection-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const keeper_only=['PRIVATE_ADJUDICATION_NOT_SELECTED_FOR_SPEECH'];
  const selected=expressionBrief(JSON.stringify({...brief,keeper_only})),calls=[],rows=[];
  const runtime={home,async runTask(task){calls.push(task);task.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'{{public}}An ordinary answer.'}]}});return{ok:true,ms:1};}};
  await writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief:selected,language:'fr',stream:{push:()=>{}},record:async row=>rows.push(row)});
  const expected={play_language:'fr',...brief};
  assert.deepEqual(JSON.parse(calls[0].request.brief),expected);
  assert.deepEqual(JSON.parse(await readFile(join(calls[0].request.cwd,'task.json'),'utf8')),expected);
  assert.ok(!JSON.stringify(calls[0]).includes(keeper_only[0]));
  assert.deepEqual(rows.find(row=>row.event==='start').keeper_only,keeper_only);
  assert.deepEqual(expected.npc_turns,brief.npc_turns);
});

test('real Pi/kernel publication receives the isolated author prose, not the private Keeper plan',async t=>{
  const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_ISOLATED_OUTPUT:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
    PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
  const engine=createHybridEngine({env,decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
    async prepareWorkspace(workspace){
      const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'expression-publication',locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
      const runtime=api.createKernelRuntime(context);
      try{await runtime.handlers['table.open']({campaign:'test-camp'});await runtime.handlers['table.narrate']({campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await runtime.close();}
    },
    extraExtensions:[{name:'engine',factory:engine.extension}],responses:[fauxAssistantMessage('{{compose}}'+JSON.stringify({...brief,keeper_only:['Private adjudication remains with the Keeper.']}))]});
  t.after(()=>table.dispose());
  assert.deepEqual(table.extensionsResult.errors,[]);
  await table.session.prompt('I ask Knott when he can meet.');
  assert.deepEqual(table.extensionErrors,[]);
  const shown=table.entries('coc-final-delivery').filter(row=>row.event==='delta').map(row=>row.delta).join('');
  assert.equal(shown,'{{say:Steven Knott}}I can meet you at noon.{{/say}}',JSON.stringify({workspace:table.workspace,telemetry:table.telemetry().slice(-5),messages:table.session.state.messages.filter(m=>m.role==='custom').map(m=>({type:m.customType,content:typeof m.content==='string'?m.content.slice(0,400):''})).slice(-5)}));
  assert.ok(!shown.includes('Offer a meeting at dawn'));
  const rows=table.telemetry().filter(row=>row.lane==='isolated-expression');
  assert.equal(rows.filter(row=>row.event==='start').length,1);
  const authorInput=JSON.parse(await readFile(join(rows.find(row=>row.event==='start').attempt,'task.json'),'utf8'));
  assert.equal(authorInput.play_language,'zh-Hans','The isolated author inherits the opened campaign language.');
  assert.equal(Object.hasOwn(authorInput,'keeper_only'),false);
  assert.deepEqual(rows.find(row=>row.event==='start').keeper_only,['Private adjudication remains with the Keeper.']);
  assert.equal(rows.find(row=>row.event==='written').model,EXPRESSION_PROFILE.model);
  const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(status.state,'awaiting_player');
  const directories=await readdir(join(table.workspace,'.coc/delivery-writes'));
  const accepted=await Promise.all(directories.map(async name=>JSON.parse(await readFile(join(table.workspace,'.coc/delivery-writes',name,'accepted.json'),'utf8'))));
  assert.ok(accepted.some(row=>row.evidence.author==='isolated-expression'&&row.evidence.model===EXPRESSION_PROFILE.model));
});

test('a transport failure preserves the exposed prefix and starts no replacement author',async t=>{
  const home=await mkdtemp(join(tmpdir(),'expression-interruption-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  let calls=0;const prose=[],records=[];
  const runtime={home,async runTask(task){
    calls++;
    task.request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'{{public}}An exposed beginning.'}});
    try{task.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'error',content:[]}});}catch{}
    return{ok:false,ms:1,error:'transport timeout'};
  }};
  await assert.rejects(writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief,language:'en',
    stream:{push:text=>prose.push(text)},record:async row=>records.push(row)}),/interrupted after exposure/);
  assert.equal(calls,1);
  assert.equal(prose.join(''),'An exposed beginning.');
  assert.equal(records.at(-1).event,'failed');
});
