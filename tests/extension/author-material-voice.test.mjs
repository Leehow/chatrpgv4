/** §256: the sole author narrates selected material; only a person's own claims are spoken by that person. §256.1: the
 *  Keeper's out-of-character correction is a table note apart from the story. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {DECISION_AUTHOR_INSTRUCTION} from '../../runtime/isolated-expression.ts';
import {turnPacket} from '../../runtime/turn-packet-prototype.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {RpcClient} from '../integration/support.ts';
import {openTable} from './harness.mjs';

test('the delivery contract says who may voice selected material and what a table note already said',()=>{
 assert.match(DECISION_AUTHOR_INSTRUCTION,/A person speaks only the claims of their own selected response/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/never put them in a person's mouth unless the same material is among that person's claims/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/table_note is what a note outside the story already told the player/);
 assert.match(DECISION_AUTHOR_INSTRUCTION,/uses the corrected fact, never the misstated detail/);
});

test('the packet carries a short table note and nothing longer',()=>{
 assert.equal(turnPacket(JSON.stringify({version:4,ooc:'Your slip says 14 Webster Street.'})).ooc,'Your slip says 14 Webster Street.');
 assert.throws(()=>turnPacket(JSON.stringify({version:4,ooc:'x'.repeat(401)})));
 assert.throws(()=>turnPacket(JSON.stringify({version:4,ooc:''})));
});

const ENV={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
test('a packet note follows the story as its own table note, and the author reads what it said',async t=>{
 const engine=createHybridEngine({env:ENV,decision:{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>question.type==='noul'
  ?[question.key,{status:'answered',type:'noul',noul:batch.family==='location-context'||question.key.startsWith('restriction_')?.01:.99}]
  :[question.key,{status:'answered',type:'choice',choice:Object.keys(question.criteria).find(key=>key!=='none')??'none',confidence:.99,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key==='none'?.01:.99]))}])),
  coverage:{required:batch.questions.map(q=>q.key),answered:batch.questions.map(q=>q.key),unknown:[]},issues:[]})}});
 const note='Your slip reads 14 Webster Street, not 137 Beacon Street.';
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env:ENV,runDriver:engine.runDriver,prepareWorkspace:async workspace=>{
  const client=new RpcClient(workspace);
  try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The landlord waits at the office.'});}
  finally{await client.close();}},
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}],ooc:note})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I ask the landlord about 137 Beacon Street.');
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(table.telemetry().slice(-6)));
 const task=JSON.parse(await readFile(join(author.attempt,'task.json'),'utf8'));
 assert.equal(task.decision_context.table_note,note,'the author reads what the player was told, to keep the story on the corrected fact');
 const notes=table.session.messages.filter(m=>m.customType==='coc-delivery'&&m.details?.table_note===true);
 const story=table.session.messages.findIndex(m=>m.customType==='coc-delivery'&&!m.details?.table_note);
 assert.ok(story<0||story<table.session.messages.findIndex(m=>m.details?.table_note===true),'the note follows the story');
 assert.deepEqual(notes.map(row=>row.content),[note]);
 assert.ok(table.telemetry().some(row=>row.lane==='delivery'&&row.reason==='table_note'));
});
