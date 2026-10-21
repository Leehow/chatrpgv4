import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compileTurnPacket,turnPacket,turnPacketParameterSchema} from '../../runtime/turn-packet-prototype.ts';
import {Check} from 'typebox/value';

const view=scope=>({kind:'place',action:'observe',to:'Inn',sense:'sight',access:'clear',scope,facts:[scope]});
test('native observations retain their position before a return and between clock effects',()=>{
 const commands=[view('Street from the window'),{kind:'place',action:'move',to:'Inn',at:'Counter'},view('Hall after returning')];
 assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({version:4,commands}))).effects,commands);
 const timed=[view('Before waiting'),{kind:'time',minutes:5,reason:'Selected five-minute wait'},view('After waiting')];
 const effects=compileTurnPacket(turnPacket(JSON.stringify({version:4,commands:timed}))).effects;
 assert.deepEqual(effects.map(row=>row.action??row.kind),['observe','time','observe']);
});
test('current rule meanings annotate native time choices without changing acceptance',()=>{
 const rows=[{handle:'momentary',min:0,max:1,covers:'A gesture or a single word.'},{handle:'quick_observation',min:0,max:5,covers:'A look or listen from the current position.'}];
 const plain=turnPacketParameterSchema(false,rows.map(row=>row.handle));
 const described=turnPacketParameterSchema(false,rows.map(row=>row.handle),undefined,false,undefined,false,rows);
 assert.match(JSON.stringify(described),/A look or listen from the current position/);
 assert.match(JSON.stringify(described),/A gesture or a single word/);
 for(const band of ['momentary','quick_observation','invented']){
  const packet={version:4,commands:[{kind:'time',band,reason:'Selected action'}]};
  assert.equal(Check(described,packet),Check(plain,packet));
 }
});

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {openTable} from './harness.mjs';
import {fauxAssistantMessage,fauxToolCall as rawToolCall} from '@earendil-works/pi-ai';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
test('native ordered observations receive the actual before and after clock from kernel receipts',async t=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
 const engine=createHybridEngine({env,decision:{decide:async batch=>{
  const answers=Object.fromEntries(batch.questions.map(q=>[q.key,q.type==='noul'?{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?.01:.99}:{status:'answered',type:'choice',choice:Object.keys(q.criteria).find(x=>x!=='none'),confidence:.99,probabilities:{}}]));
  return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:1,outputTokens:0}};
 }}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
  prepareWorkspace:async workspace=>{const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await client.close();}},
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[
   {...view('Before the selected wait'),to:'here'},
   {kind:'time',minutes:5,reason:'The player waits five minutes'},
   {...view('After the selected wait'),to:'here'},
   {kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 const clock=()=>JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;
 const before=clock();await table.session.prompt('I look around, wait five minutes, and look again.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(m=>m.role==='toolResult'&&m.isError),[]);
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author);
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 const observations=task.result.outcomes.filter(row=>row.action==='observe');
 assert.deepEqual(observations.map(row=>row.observation.observed_clock.minutes),[before,before+5]);
 assert.equal(clock(),before+5);
});

test('final population declarations follow moves while forward newcomer dependencies precede their first observation',()=>{
 const scene={kind:'scene',service:'open',crowd:'quiet'},person={kind:'walk_on',slot:'new_1',label:'Night clerk',reason:'The ordinary clerk is already here.'};
 const move={kind:'place',action:'move',to:'Inn',at:'Counter'};
 const command={...view('The existing room before leaving'),people:['new_1']};
 const effects=compileTurnPacket(turnPacket(JSON.stringify({version:4,commands:[scene,command,move,person]}))).effects;
 assert.deepEqual(effects.map(row=>row.action??row.kind),['npc','observe','move','scene']);
 assert.equal(effects[1].people[0],'Night clerk');
 const final=compileTurnPacket(turnPacket(JSON.stringify({version:4,commands:[scene,move,person]}))).effects;
 assert.deepEqual(final.map(row=>row.action??row.kind),['move','npc','scene']);
});
