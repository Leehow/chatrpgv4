/** Locked place craft reaches the actual author without another model or world write. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {locationDescription,LOCATION_DESCRIPTION_HEADING} from '../../extensions/kernel/location-description.ts';
import {writeIsolatedExpression,EXPRESSION_PROFILE} from '../../runtime/isolated-expression.ts';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {RpcClient} from '../integration/support.ts';

const section={key:'places@1.2.0#1',mod:'places',version:'1.2.0',heading:LOCATION_DESCRIPTION_HEADING,text:'LOCATION_CRAFT_FROM_THE_LOCKED_PACKAGE'};
const capsule={mods:{location_context:{mod:'places',version:'1.2.0'},instructions:[{mod:'places',version:'1.2.0',sections:[{key:section.key,heading:section.heading}]}]}};
test('only the issued active location section is loaded, and a stale replacement fails closed',async()=>{
 let reads=0;const read=async keys=>{reads++;assert.deepEqual(keys,[section.key]);return {sections:[section]};};
 const selected=await locationDescription(capsule,read);assert.equal(selected.instruction,section.text);assert.equal(reads,1);
 for(const value of [{mods:{}},{mods:{...capsule.mods,location_context:{mod:'other',version:'1.2.0'}}},{mods:{...capsule.mods,location_context:{mod:'places',version:'1.1.7'}}}])
  assert.equal(await locationDescription(value,read),undefined);
 assert.equal(reads,1,'inactive and replaced providers add no read or author context');
 await assert.rejects(()=>locationDescription(capsule,async()=>({sections:[{...section,version:'2.0.0'}]})),/locked location description/);
});
test('the sole final author receives locked location craft once alongside current input and canonical scene',async t=>{
 const home=await mkdtemp(join(tmpdir(),'place-author-'));t.after(()=>rm(home,{recursive:true,force:true}));let calls=0;
 const location_description=await locationDescription(capsule,async()=>({sections:[section]}));
 const runtime={home,async runTask({request}){
  calls++;assert.equal(request.systemPrompt.split(section.text).length-1,1);assert(!request.brief.includes(section.text));
  const packet=JSON.parse(request.brief);assert.equal(packet.player_input,'I look around the lunchroom.');
  assert.deepEqual(packet.decision_context.location_description,{mod:'places',version:'1.2.0',key:section.key});
  assert.equal(packet.decision_context.scene.name,'Lunchroom');assert.equal(request.maxRequests,1);
  request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'The counter runs along the left wall.'}});
  const [provider,...name]=EXPRESSION_PROFILE.model.split('/');
  request.onEvent({type:'message_end',message:{role:'assistant',provider,model:name.join('/'),stopReason:'stop',content:[{type:'text',text:'The counter runs along the left wall.'}]}});
  return {ok:true,ms:1};
 }};
 const text=[];await writeIsolatedExpression({runtime,campaign:'fixture',turn:1,run:'r',language:'en',playerText:'I look around the lunchroom.',
  decision:{scene:{name:'Lunchroom'},clock:{},people:[],responses:[],recent_public:[],location_description},stream:{push:delta=>text.push(delta)},record:async()=>{}});
 assert.equal(calls,1);assert.equal(text.join(''),'The counter runs along the left wall.');
});
test('first sight in an authored module scene receives the same Mod craft without a movement or observation command',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
 const engine=createHybridEngine({env,decision:{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>question.type==='noul'
  ?[question.key,{status:'answered',type:'noul',noul:batch.family==='location-context'?.01:.99}]
  :[question.key,{status:'answered',type:'choice',choice:Object.keys(question.criteria).find(key=>key!=='none')??'none',confidence:.99,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key==='none'?.01:.99]))}])),coverage:{required:batch.questions.map(q=>q.key),answered:batch.questions.map(q=>q.key),unknown:[]},issues:[]})}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,prepareWorkspace:async workspace=>{
  const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The landlord waits at the office.'});}finally{await client.close();}},
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I introduce myself to the landlord.');
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(table.telemetry().slice(-6)));
 const task=JSON.parse(await readFile(join(author.attempt,'task.json'),'utf8'));
 assert.equal(task.decision_context.location_description?.version,'1.1.10');
 assert(task.decision_context.scene.first_sight?.place,'this is the authored opening place');
 assert(!task.result.outcomes.some(row=>row.kind==='move'||row.kind==='place'),'appearance guidance does not require fabricating a player perception or journey');
});
