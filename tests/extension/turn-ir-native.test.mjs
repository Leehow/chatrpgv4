/** §270: Turn IR through the actual native boundary: real kernel and Pi, controlled Keeper and author. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall,getCurrentTools} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_TURN_IR:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
 EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});
 await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await client.close();}}
function answer(batch,p){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?1-p:p}];
 const choice=Object.keys(q.criteria).find(x=>x!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(x=>[x,x===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));
 return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}
const output=actions=>fauxAssistantMessage([fauxToolCall('output',{version:5,actions})],{stopReason:'toolUse'});
async function play(t,responses,input='I look around the office.'){
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses});
 t.after(()=>table.dispose());await table.session.prompt(input);return table;
}
const results=table=>table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='output');
const published=(table,turn=1)=>table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed'&&row.turn===turn).length;

test('the Keeper is offered the Turn IR and one IR output publishes the turn',async t=>{
 let offered;
 const table=await play(t,[context=>{offered=getCurrentTools(context.messages).find(tool=>tool.name==='output');
  return output([{op:'scene',service:'open',crowd:'quiet'},{op:'perceive',what:[{observe:'The desk lamp flickers.'}]}]);},fauxAssistantMessage('done')]);
 assert.equal(offered.parameters.properties.version.const,5,'the output tool declares the IR');
 assert.equal(published(table),1);
 assert.deepEqual(table.extensionErrors,[]);
});

test('a list ending at a rule barrier returns the settled check, and the next output publishes the rest',async t=>{
 const table=await play(t,[
  output([{op:'rule',as:'r1',skill:'Spot Hidden',goal:'spot what is in the open drawer',stakes:'Knott sees the search'}]),
  ()=>output([{op:'scene',service:'open',crowd:'quiet'},
   {op:'perceive',what:[{observe:'The drawer holds receipts.'}],when:{check:'r1',passed:true}}]),
  fauxAssistantMessage('done')],'I search the drawer.');
 const barrier=JSON.parse(results(table)[0].content[0].text);
 assert.equal(barrier.settled[0].as,'r1');assert.equal(barrier.settled[0].goal,'spot what is in the open drawer');assert.equal(typeof barrier.settled[0].passed,'boolean');
 assert.equal(table.telemetry().filter(row=>row.lane==='turn-ir'&&row.event==='barrier_returned').length,1);
 assert.equal(published(table),1);
 assert.deepEqual(table.extensionErrors,[]);
});

test('a name nobody at the table carries is refused with the action named, before anything settles',async t=>{
 const table=await play(t,[
  output([{op:'communicate',speaker:'Nobody Known',to:['Thomas Hayes'],act:'answer',says:[{claim:'never saw him'}]}]),
  output([{op:'scene',service:'open',crowd:'quiet'}]),
  fauxAssistantMessage('done')]);
 const refusal=results(table)[0].details.coc_error;
 assert.equal(refusal.details.reason,'turn_ir_action');assert.equal(refusal.details.action_index,0);
 assert.equal(published(table),1);
});

test('a newcomer seated before a barrier keeps their @alias into the next output, which speaks for them',async t=>{
 const table=await play(t,[
  output([{op:'presence',who:'@clerk',action:'enter',as:'night clerk',reason:'The clerk comes in from the back room.'},
   {op:'rule',as:'r1',skill:'Psychology',goal:'read whether the clerk is nervous',stakes:'the clerk notices being studied'}]),
  output([{op:'scene',service:'open',crowd:'quiet'},{op:'communicate',speaker:'@clerk',to:['investigator_1'],act:'greet'}]),
  fauxAssistantMessage('done')],'I watch whoever comes in.');
 const outputs=results(table);
 assert.equal(outputs.length,2);assert.ok(!outputs[1].details?.coc_error,JSON.stringify(outputs[1].details?.coc_error));
 assert.equal(published(table),1);
 assert.deepEqual(table.extensionErrors,[]);
});
