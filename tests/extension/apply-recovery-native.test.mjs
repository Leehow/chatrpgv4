import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient,rpcCommand,CONTENT_DIR} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const original='I walk across Main Street to Corner Cafe.';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
 EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function owedWorkspace(workspace,options={}){process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',CONTENT_DIR]);const c=new RpcClient(workspace);try{
 await c.ok('table.open',{campaign:'test-camp'});await c.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at the office.'});
 const text=options.text??'You arrive at Corner Cafe.';
 await c.ok('table.player_input',{campaign:'test-camp',text:options.player??original});
 await c.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c1',text});
 const owed=await c.ok('table.owe',{campaign:'test-camp',turn:1,effect:options.effect??{kind:'move',unlisted:true},quote:text,source:'told-position'});
 assert.equal(owed.owed,'t1-owed-1');
 return (await c.ok('table.capsule',{campaign:'test-camp',_context_read:true})).owed[0];
}finally{await c.close();}}
function answer(batch,p=.99){return{batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?1-p:p}])),coverage:{required:batch.questions.map(x=>x.key),answered:batch.questions.map(x=>x.key),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}
const move={kind:'move',to:'Corner Cafe',via:'Across Main Street',establish:{summary:'A public cafe across the street.'},owed:'t1-owed-1'};
const output={version:4,commands:[{kind:'scene',service:'open',crowd:'empty'}],interactions:[]};
test('the active single-Keeper path settles a prior declared departure before this turn communication once',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,(batch.state.line_contexts?.[0]?.current_player_words??batch.state.current_player_words)===original?.99:.01);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:owedWorkspace,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[move]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',output)],{stopReason:'toolUse'})]});t.after(()=>table.dispose());
 await table.session.prompt('I introduce myself at the counter, without ordering.');
 assert.deepEqual(table.extensionErrors,[]);
 const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(record.receipts.filter(x=>x.kind==='move').length,1,'the declared journey must settle before this intent counts as complete');
 const consent=batches.filter(x=>x.family==='continuous-action-admission');assert.equal(consent.length,1,JSON.stringify(table.session.messages.filter(x=>x.role==='toolResult').map(x=>({tool:x.toolName,error:x.details?.coc_error,body:x.isError?x.content:undefined}))));
 assert.equal(consent[0].state.line_contexts[0].current_player_words,original);
 assert.equal(consent[0].questions.length,2);
 const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
 assert.equal(world.active_scene,'Corner Cafe');
 const ledger=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/owed.json'),'utf8'));
 assert.equal(ledger.open.some(x=>x.name==='t1-owed-1'),false);
 assert.equal(ledger.closed.filter(x=>x.name==='t1-owed-1').length,1);
});

test('a kernel-issued complete owed effect settles without any consent inference',async t=>{
 let issued,calls=0;const engine=createHybridEngine({env,decision:{decide:async batch=>{calls++;return answer(batch);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:async workspace=>{issued=await owedWorkspace(workspace,{
  player:'I drive to the Corbitt House.',text:'You arrive at the Corbitt House.',effect:{kind:'move',to:'corbitt-house-ground'}});},env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[{...issued.effect,owed:issued.name}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',output)],{stopReason:'toolUse'})]});t.after(()=>table.dispose());
 await table.session.prompt('I look around from here.');assert.deepEqual(table.extensionErrors,[]);assert.equal(calls,0);
 const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(record.receipts.filter(x=>x.kind==='move'&&x.owed===issued.name).length,1);
 assert.ok(table.telemetry().some(x=>x.lane==='admission'&&x.path==='told'&&x.jev_calls===0));
});

test('a current-action rejection cannot poison the same move with bound prior-turn authority',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,(batch.state.line_contexts?.[0]?.current_player_words??batch.state.current_player_words)===original?.99:.01);}}});
 const {owed:_,...ordinary}=move;
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:owedWorkspace,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[ordinary]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[move]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',output)],{stopReason:'toolUse'})]});t.after(()=>table.dispose());
 await table.session.prompt('I introduce myself at the counter, without ordering.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.equal(batches.filter(x=>x.family==='continuous-action-admission').length,2);
 const calls=table.session.messages.filter(x=>x.role==='toolResult'&&x.toolName==='apply');
 assert.equal(calls.length,2);assert.equal(calls[0].isError,true);assert.notEqual(calls[1].isError,true,JSON.stringify(calls[1]));
 const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(record.receipts.filter(x=>x.kind==='move').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(x=>x.event==='end'&&x.status==='completed').length,1,JSON.stringify({tools:table.session.messages.filter(x=>x.role==='toolResult').map(x=>({tool:x.toolName,error:x.details?.coc_error,receipts:x.details?.receipts,body:x.isError?x.content:undefined})),calls:table.session.messages.filter(x=>x.role==='assistant').flatMap(x=>x.content??[]).filter(x=>x.type==='toolCall'),held:table.telemetry().filter(x=>x.lane==='held-operation'||x.lane==='held_act_outcome')}));
});
