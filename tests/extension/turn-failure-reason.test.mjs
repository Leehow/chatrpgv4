import uiSeed from '../../content/ui/zh-Hans/extension.json' with {type:'json'};
/** Real Pi/native-kernel component evidence; controlled responses are not live-play evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,customMessages,waitFor} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {rememberTurnFailure,turnFailure,unfinishedTurnFailure,turnFailureNotice} from '../../extensions/kernel/turn-failure.ts';

async function opened(workspace){
 const client=new RpcClient(workspace);
 try{
  await client.ok('table.open',{campaign:'test-camp'});
  await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});
 }finally{await client.close();}
}
function answer(batch){
 const answers=Object.fromEntries(batch.questions.map(q=>{
  if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:batch.family==='continuous-action-admission'?(q.key.startsWith('restriction_')?.38:.46):.99}];
  const choice=Object.keys(q.criteria).find(value=>value!=='none')??'none';
  return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(value=>[value,value===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];
 }));
 return {batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};
}
const notices=table=>customMessages(table.session,'coc-delivery').filter(row=>row.details?.turn_unfinished);

test('an actual native author failure reaches the player as HTTP 504 with committed state retained',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/failed-direct-author.mjs')])};
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I remain beside the desk.');
 await waitFor(()=>notices(table).length===1,{label:'the original native author cause'});
 const notice=notices(table)[0];assert.match(notice.content,/HTTP 504 Gateway Timeout/);
 assert.ok(notice.content.includes(uiSeed.turn_failure_settlement_kept));
 assert.doesNotMatch(notice.content,/PRIVATE_PROVIDER_ERROR_SENTINEL|<html>|internal/);
 assert.ok(notice.details.failure.settled_receipts>0);
 assert.match(JSON.stringify(notice.details.failure),/provider_http_504/);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,0);
 assert.deepEqual(table.extensionErrors,[]);
});

test('native missing output identifies the failed publication stage instead of an internal composition error',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined};
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[0,1].map(()=>fauxAssistantMessage([{type:'thinking',thinking:'PRIVATE_NATIVE_REASONING'}],{stopReason:'stop'}))});
 t.after(()=>table.dispose());await table.session.prompt('I remain here.');
 await waitFor(()=>notices(table).length===1,{label:'the native missing-output diagnostic'});
 const notice=notices(table)[0];assert.ok(notice.content.includes(uiSeed.turn_failure_missing_output),JSON.stringify(notice));
 assert.doesNotMatch(notice.content,/PRIVATE_NATIVE_REASONING|internal|composition/);
 assert.match(JSON.stringify(notice.details.failure),/native_output_missing/);
});

test('native output refusal reaches the player with its actual consent cause and no invented settlement',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined};
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 const move={kind:'move',to:'Central Library'};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,
  runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[move],interactions:[]})],{stopReason:'toolUse'}),
   fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[move,{kind:'scene',service:'unknown',crowd:'quiet'}],interactions:[]})],{stopReason:'toolUse'}),
   fauxAssistantMessage([{type:'thinking',thinking:'PRIVATE_NEXT_TURN'}],{stopReason:'stop'}),
   fauxAssistantMessage([{type:'thinking',thinking:'PRIVATE_NEXT_TURN'}],{stopReason:'stop'})
  ]});
 t.after(()=>table.dispose());
 await table.session.prompt('I drive back to the Central Library approach and stop outside.');
 await waitFor(()=>notices(table).length===1,{label:'the terminal failure reason'});
 const notice=notices(table)[0];
 assert.ok(notice.content.includes(uiSeed.turn_failure_admission));
 assert.ok(notice.content.includes(uiSeed.turn_failure_no_settlement));
 assert.doesNotMatch(notice.content,/```|action_admission_uncertain|0\.46/);
 assert.match(JSON.stringify(notice.details.failure),/action_admission_uncertain/);
 assert.equal(notice.details.failure.stopped_by,'held_act_unconfirmed');
 assert.match(JSON.stringify(notice.details.failure),/0\.46/);
 assert.doesNotMatch(notice.content,/send anything|without a delivered result/);
 assert.equal(notice.details.failure.settled_receipts,0);
 assert.equal(notice.details.failure.failures.find(row=>row.reason==='action_admission_uncertain').operation,'apply');
 assert.equal(table.telemetry().filter(row=>row.lane==='admission').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='delta').length,0);
 await waitFor(()=>table.telemetry().some(row=>row.event==='released'&&row.ok),{label:'the failed input release'});
 await table.session.prompt('I wait here.');
 await waitFor(()=>notices(table).length===2,{label:'a separate next-turn diagnostic'});
 assert.doesNotMatch(notices(table)[1].content,/action_admission_uncertain|0\.46|PRIVATE_NEXT_TURN/);
 assert.notEqual(notices(table)[1].details.failure.turn,notice.details.failure.turn);
});

test('thinking-only completion identifies the missing final output and keeps private reasoning private',async t=>{
 const thought=()=>fauxAssistantMessage([{type:'thinking',thinking:'PRIVATE_REASONING_SENTINEL'}],{stopReason:'stop'});
 const table=await openTable({env:{FAKE_KERNEL_STRICT_TURN:'1'},responses:[thought(),thought()]});
 t.after(()=>table.dispose());
 await table.session.prompt('I wait.');
 await waitFor(()=>notices(table).length===1,{label:'the missing final output reason'});
 assert.ok(notices(table)[0].content.includes(uiSeed.turn_failure_missing_output));
 assert.doesNotMatch(notices(table)[0].content,/```|thinking|missing_final_output/);
 assert.match(JSON.stringify(notices(table)[0].details.failure),/missing_final_output/);
 assert.deepEqual(notices(table)[0].details.failure.completion.blocks,['thinking']);
 assert.doesNotMatch(notices(table)[0].content,/PRIVATE_REASONING_SENTINEL/);
});

test('the bounded cause chain keeps the original error, resets next turn and never copies private arguments',()=>{
 const state={turn:1};
 const cause=Object.assign(new Error('The typed consent decision is uncertain'),{code:'needs',details:{reason:'action_admission_uncertain',proposed:['PRIVATE_ARGUMENT_SENTINEL']}});
 rememberTurnFailure(state,'output',new Error('Publication stopped',{cause}));
 assert.match(JSON.stringify(unfinishedTurnFailure(state)),/action_admission_uncertain/);
 assert.doesNotMatch(JSON.stringify(unfinishedTurnFailure(state)),/PRIVATE_ARGUMENT_SENTINEL/);
 for(let i=0;i<12;i++)rememberTurnFailure(state,'output',new Error('follow-up '+i));
 assert.equal(turnFailure(state).failures.length,6);
 assert.equal(turnFailure(state).failures[0].message,'Publication stopped');
 assert.match(JSON.stringify(unfinishedTurnFailure(state)),/action_admission_uncertain/);
 state.turn=2;
 assert.equal(turnFailure(state).failures.length,0);
 assert.match(JSON.stringify(unfinishedTurnFailure(state)),/missing_final_output/);
 assert.doesNotMatch(JSON.stringify(unfinishedTurnFailure(state)),/action_admission_uncertain/);
 assert.equal(unfinishedTurnFailure(state).settled_receipts,null);
 rememberTurnFailure(state,'output.publication',new SyntaxError('Unexpected token: PRIVATE_DRAFT_SENTINEL'));
 assert.match(JSON.stringify(unfinishedTurnFailure(state)),/invalid_json/);
 assert.doesNotMatch(JSON.stringify(unfinishedTurnFailure(state)),/PRIVATE_DRAFT_SENTINEL/);
});


test('readable notices keep filesystem causes and settlement truth without exposing JSON or paths',()=>{
 const state={turn:2};
 rememberTurnFailure(state,'output',Object.assign(new Error('mkdir /private/output failed'),{code:'ENOTDIR'}));
 const failure=unfinishedTurnFailure(state);
 const notice=turnFailureNotice({...failure,settled_receipts:2});
 assert.match(notice.content,/output path is not a directory/);
 assert.match(notice.content,/ENOTDIR/);
 assert.match(notice.content,/Already settled actions are retained/);
 assert.doesNotMatch(notice.content,/private|mkdir|settled_receipts|[{}]/);
 assert.match(turnFailureNotice(failure).content,/could not be verified/);
 assert.match(turnFailureNotice({...failure,settled_receipts:0}).content,/No actions were settled/);
 assert.equal(turnFailureNotice({status:'unfinished',failures:[null]}),undefined);
 assert.equal(turnFailureNotice(undefined),undefined);
 assert.equal(turnFailureNotice(failure,{turn_failure_details:'Projected detail label'}).label,'Projected detail label');
});

test('the readable provider failure keeps HTTP 504 rather than the final generic cause code',()=>{
 const state={turn:1};
 rememberTurnFailure(state,'output',Object.assign(new Error('The response provider returned HTTP 504 Gateway Timeout.',{cause:new Error('504 <html>PRIVATE_PROVIDER_BODY</html>')}),
  {code:'provider_error',details:{reason:'provider_http_504'}}));
 const failure={...unfinishedTurnFailure(state),settled_receipts:2};
 const notice=turnFailureNotice(failure);
 assert.match(notice.content,/HTTP 504 Gateway Timeout/);assert.match(notice.content,/Already settled actions are retained/);
 assert.doesNotMatch(notice.content,/PRIVATE_PROVIDER_BODY|<html>|internal|provider_http_/);
 assert.match(JSON.stringify(notice),/provider_http_504|HTTP 504/);
 assert.match(JSON.stringify(failure),/504 <html>/,'the bounded original provider cause remains available in technical details');
});
