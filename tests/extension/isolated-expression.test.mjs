import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {ExpressionPlanStream,expressionBrief,writeIsolatedExpression,EXPRESSION_PROFILE,expressionAuthorProfile,decisionRecentPublic} from '../../runtime/isolated-expression.ts';
import {EmptySpeechStream,speechPass} from '../../kernel-ts/write/speech-pass.ts';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';
const brief={scene:'An office.',narrative_content:[],npc_turns:[{speaker:'Steven Knott',intent:'Offer a meeting at dawn.',personality:'Practical',emotion:null}]};

test('departure continuity uses delivered turns across scene changes and preserves tail constraints',()=>{
 const current=[{turn:77,player:'I ask through the door.',keeper:'You remain outside.'},{turn:78,closed:'stranded',keeper:'An interrupted arrival.'}];
 const full='A'.repeat(9000)+' You never entered.';
 const result=decisionRecentPublic(current,[{turn:76,player:'I walk to the inn doorway.',keeper:full},{turn:77,player:'I ask through the door.',keeper:'You remain outside. The clerk speaks through the glass.'}]);
 assert.deepEqual(result.map(row=>row.turn),[76,77]);
 assert.ok(result[0].keeper.endsWith(' You never entered.'));assert.equal(result[0].truncated,true);
 assert.equal(result[1].keeper,'You remain outside. The clerk speaks through the glass.');
 assert.equal(result[0].player,'I walk to the inn doorway.');
});

test('empty speech normalization is independent of token chunk boundaries and preserves actual dialogue',()=>{
 for(const raw of ['A{{say:npc_11}}{{/say}}B','{{say:npc_11}} \n {{/say}}','{{say:npc_11}}Hello.{{/say}}','{{say:{{name:Clerk}}}}Yes.{{/say}}','A{{check:test}}B','A{B','{{say:npc_11}}']){
  const expected=raw==='{{say:npc_11}}'?'':raw.includes('Yes.')?raw:speechPass(raw,name=>({label:name})).text;
  for(let cut=0;cut<=raw.length;cut++){
   const stream=new EmptySpeechStream();
   assert.equal(stream.push(raw.slice(0,cut))+stream.push(raw.slice(cut))+stream.push('',true),expected,raw+' at '+cut);
  }
 }
});

for(const [profile,thinking] of [['minimax-cn/MiniMax-M3.1-Flash-Preview','medium'],['grok-build/grok-4.5','high']])test('the explicit profile reaches the isolated request and actual-model verification: '+profile,async t=>{
  assert.deepEqual(expressionAuthorProfile({}),EXPRESSION_PROFILE);
  assert.deepEqual(expressionAuthorProfile({PI_COC_TEST_MODEL:'grok-build/grok-4.5'}),{model:'grok-build/grok-4.5',thinking:'high'});
  assert.deepEqual(expressionAuthorProfile({PI_COC_TEST_MODEL:'minimax-cn/MiniMax-M3.1-Flash-Preview'}),{model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium'});
  const previous=process.env.PI_COC_TEST_MODEL;
  const home=await mkdtemp(join(tmpdir(),'expression-minimax-'));const calls=[],rows=[];
  t.after(()=>rm(home,{recursive:true,force:true}));
  process.env.PI_COC_TEST_MODEL=profile;
  try {
    const runtime={home,async runTask(task){calls.push(task);task.request.onEvent({type:'message_end',message:{role:'assistant',provider:profile.split('/')[0],model:profile.split('/')[1],stopReason:'stop',content:[{type:'text',text:'{{public}}The office is quiet.'}]}});return{ok:true,ms:1};}};
    const result=await writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief,language:'en',stream:{push:()=>{}},record:async row=>rows.push(row)});
    assert.equal(calls[0].request.model,profile);assert.equal(calls[0].request.thinking,thinking);
    assert.deepEqual(rows.at(-1).actual_models,[profile]);assert.equal(result.thinking,thinking);
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
      if(method==='table.delivery.check')return{speakers:(params.speakers??[]).map(name=>({name,who:name==='Investigator'?{investigator:'private-sheet-id',name:'Canonical Investigator'}:{label:name}}))};
      return{};
    }});
  const stream=await owner.openStream('c',1,'r','isolated-expression',['Hugh Moore'],['Investigator']);
  assert.equal(stream.playerText,'I ask the gatekeeper.');
  assert.deepEqual(stream.investigatorNames,['Canonical Investigator']);
  stream.push('{{say:Hugh Moore}}Morning.{{/say}}');
  assert.equal(calls[0].method,'table.delivery.check','freeze background preparation before capturing the expression capsule');
  assert.deepEqual(calls.findLast(row=>row.method==='table.delivery.check').params.speakers,['Investigator','Hugh Moore','Gatekeeper']);
  assert.equal(frames[0].event,'start');
  assert.ok(frames[0].speakers.some(speaker=>speaker.name==='Hugh Moore'));
  assert.equal(frames[1].event,'delta');
});

test('public stream consumes empty speech spans even when every token is split',async t=>{
 const home=await mkdtemp(join(tmpdir(),'expression-empty-speech-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const frames=[];
 const owner=createFinalOutputOwner({runtime:()=>({home}),record:async()=>{},stream:frame=>frames.push(frame),
  call:async method=>method==='table.capsule'?{_context:{campaign:'c',turn:1,worldline:'main',loop:0,task_world_revision:'w',task_source_revision:'s'},turn:{player_text:'I remain outside.'}}:{}});
 const stream=await owner.openStream('c',1,'r');
 const raw='Before. {{say:npc_11}}{{/say}}He looks up. {{say:npc_14}} \n {{/say}}Still quiet. {{say:npc_11}}Hello.{{/say}}';
 for(const char of raw)stream.push(char);
 const result=await stream.finish('test','medium',{});
 assert.equal(result.text,'Before. He looks up.  \n Still quiet. {{say:npc_11}}Hello.{{/say}}');
 assert.equal(frames.filter(row=>row.event==='delta').map(row=>row.delta).join(''),result.text);
 assert.equal(result.evidence.artifact_text,result.text);
});

test('silent response decisions remain sparse in the actual author task',async t=>{
 const home=await mkdtemp(join(tmpdir(),'expression-silent-'));t.after(()=>rm(home,{recursive:true,force:true}));let task;
 const runtime={home,async runTask(value){task=JSON.parse(value.request.brief);value.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'{{public}}The clerk looks up.'}]}});return{ok:true,ms:1};}};
 await writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',language:'en',decision:{scene:{},clock:{},people:[],recent_public:[],responses:[{actor:'npc_11',act:'silent'}]},stream:{push(){}},record:async()=>{}});
 assert.equal(task.decision_context.speech_allowed,false);
 assert.equal(task.decision_context.responses[0].mode,'nonverbal');
 assert.equal(task.decision_context.responses[0].observations,undefined);
 assert.equal(task.decision_context.responses[0].claims,undefined);
 await assert.rejects(writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'bad',language:'en',decision:{scene:{},clock:{},people:[],recent_public:[],responses:[{actor:'npc_11',act:'silent',points:['The clerk leaves.']}]},stream:{push(){}},record:async()=>{}}),/silent|response/i);
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

for(const emptyFirst of [false,true,'malformed'])test('real Pi/kernel publication receives isolated prose after a thinking-only completion: '+emptyFirst,async t=>{
  const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_ISOLATED_OUTPUT:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
    PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
  const engine=createHybridEngine({env,decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
    async prepareWorkspace(workspace){
      const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'expression-publication',locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
      const runtime=api.createKernelRuntime(context);
      try{await runtime.handlers['table.open']({campaign:'test-camp'});await runtime.handlers['table.narrate']({campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await runtime.close();}
    },
    extraExtensions:[{name:'engine',factory:engine.extension}],responses:[...(emptyFirst?[fauxAssistantMessage(emptyFirst==='malformed'?'{{compose}}\n\n**keeper_only**':[{type:'thinking',thinking:'Ready to submit the expression.'}])]:[]),fauxAssistantMessage('{{compose}}'+JSON.stringify({...brief,keeper_only:['Private adjudication remains with the Keeper.']}))]});
  t.after(()=>table.dispose());
  assert.deepEqual(table.extensionsResult.errors,[]);
  await table.session.prompt('I ask Knott when he can meet.');
  assert.deepEqual(table.extensionErrors,[]);
  const shown=table.entries('coc-final-delivery').filter(row=>row.event==='delta').map(row=>row.delta).join('');
  assert.equal(shown,'{{say:Steven Knott}}I can meet you at noon.{{/say}}',JSON.stringify({workspace:table.workspace,telemetry:table.telemetry().slice(-5),messages:table.session.state.messages.filter(m=>m.role==='custom').map(m=>({type:m.customType,content:typeof m.content==='string'?m.content.slice(0,400):''})).slice(-5)}));
  assert.ok(!shown.includes('Offer a meeting at dawn'));
  const rows=table.telemetry().filter(row=>row.lane==='isolated-expression');
  assert.equal(rows.filter(row=>row.event==='start').length,1);
  assert.equal(table.telemetry().filter(row=>row.lane==='turn'&&row.event==='turn_close'&&row.kind==='private_reply_protocol').length,emptyFirst?1:0);
  const authorInput=JSON.parse(await readFile(join(rows.find(row=>row.event==='start').attempt,'task.json'),'utf8'));
  assert.equal(authorInput.play_language,'zh-Hans','The isolated author inherits the opened campaign language.');
  assert.equal(authorInput.player_input,'I ask Knott when he can meet.','The host carries the actual current input even when the private brief omits it.');
  const investigator=JSON.parse(await readFile(join(root,'content/starters/the-haunting/pregens/thomas-hayes/character.json'),'utf8'));
  assert.deepEqual(authorInput.investigator_names,[investigator.name],'Canonical investigator names reach the real isolated task without character cards or internal IDs.');
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

test('a tool-enabled author keeps an unmarked tool preamble private and streams only the framed final answer',async t=>{
 const home=await mkdtemp(join(tmpdir(),'expression-preamble-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const prose=[];let calls=0;
 const runtime={home,async runTask(task){
  calls++;
  task.request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'I will write the response after inspecting the brief.'}});
  task.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'toolUse',content:[{type:'text',text:'I will write the response after inspecting the brief.'},{type:'toolCall',name:'read'}]}});
  task.request.onEvent({type:'tool_execution_start',toolName:'read'});
  task.request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'{{public}}The clerk answers carefully.'}});
  task.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'{{public}}The clerk answers carefully.'}]}});
  return{ok:true,ms:1};
 }};
 const result=await writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief,language:'en',stream:{push:text=>prose.push(text)},record:async()=>{}});
 assert.equal(result.text,'The clerk answers carefully.');assert.equal(prose.join(''),result.text);assert.equal(calls,1);
});

test('an unmarked terminal answer stays rejected without exposure or a replacement author',async t=>{
 const home=await mkdtemp(join(tmpdir(),'expression-unmarked-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const prose=[];let calls=0;
 const runtime={home,async runTask(task){
  calls++;
  task.request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'I will write the story response.'}});
  task.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'I will write the story response.'}]}});
  return{ok:true,ms:1};
 }};
 await assert.rejects(writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',brief,language:'en',stream:{push:text=>prose.push(text)},record:async()=>{}}),/Final artifact must begin/);
 assert.deepEqual(prose,[]);assert.equal(calls,1);
});

for(const mode of ['terminal','preamble','error','aborted','length','mismatch','empty'])test('decision author terminal body contract: '+mode,async t=>{
 const home=await mkdtemp(join(tmpdir(),'decision-terminal-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const prose=[];let requests=0;
 const terminal=(text,stopReason='stop')=>({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason,content:[{type:'text',text}]}});
 const runtime={home,async runTask(task){
  requests++;
  if(mode==='preamble'){
   task.request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Private tool planning.'}});
   task.request.onEvent(terminal('Private tool planning.','toolUse'));
   task.request.onEvent({type:'tool_execution_start',toolName:'read'});
  }
  const body=mode==='empty'?'':'The clerk answers carefully.';
  task.request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:body}});
  assert.deepEqual(prose,[],'unmarked text stays private before normal terminal completion');
  task.request.onEvent(terminal(mode==='mismatch'?'Different bytes.':body,['error','aborted','length'].includes(mode)?mode:'stop'));
  return{ok:true,ms:1};
 }};
 const task=writeIsolatedExpression({runtime,campaign:'c',turn:1,run:'r',decision:{scene:{},clock:{},responses:[],people:[],recent_public:[]},
  result:{player_actions_complete:true,outcomes:[]},language:'en',stream:{push:text=>prose.push(text)},record:async()=>{}});
 if(['terminal','preamble'].includes(mode)){
  assert.equal((await task).text,'The clerk answers carefully.');assert.deepEqual(prose,['The clerk answers carefully.']);
 }else{
  await assert.rejects(task);assert.deepEqual(prose,[]);
 }
 assert.equal(requests,1,'terminal transport never starts a replacement author');
});
