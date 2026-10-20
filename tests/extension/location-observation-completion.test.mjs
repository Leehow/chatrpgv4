/** Controlled real-RPC component evidence, never a substitute for live play. */
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{join}from'node:path';
import{fauxAssistantMessage,fauxToolCall}from'@earendil-works/pi-ai';
import{openTable}from'./harness.mjs';import{RpcClient}from'../integration/support.ts';import{createHybridEngine}from'../../runtime/jev/hybrid-engine.ts';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const k=new RpcClient(workspace);try{await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The office is open.'});}finally{await k.close();}}
function answer(batch){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.endsWith('_blocked')||q.key.startsWith('restriction_')?.01:.99}];const choice=Object.keys(q.criteria).find(k=>k!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}
test('focused perception selection crosses the demand event, rejects omission and reaches the sole author once',async t=>{
 const batches=[];let table,scene,requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   requests++;const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.01,feature:.01,observation:.99}});
   return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});
  },()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},
   {kind:'place',action:'observe',to:scene,sense:'sight',access:'clear',scope:'The visible ledger label on the desk.',facts:['The ledger label reads Records ledger.']}],interactions:[]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());await table.session.prompt('I look closely at the ledger label on the desk and read it.');
 assert.equal(requests,2);
 const coverage=batches.filter(b=>b.family==='location-decision-coverage');assert.equal(coverage.length,2);
 assert(coverage.every(b=>b.state.initial_selection.observation===.99),'the event cannot drop the selected observation');
 assert(coverage.every(b=>!b.questions.some(q=>q.key==='observation_selected')),'an already decisive selection is reused');
 const refused=table.session.messages.filter(m=>m.role==='toolResult'&&m.isError);assert.match(JSON.stringify(refused),/place_decision_incomplete/);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='observe').length,1,JSON.stringify({receipts:turn.receipts,errors:refused}));
 const authors=table.telemetry().filter(r=>r.lane==='isolated-expression'&&r.event==='written');assert.equal(authors.length,1,JSON.stringify({errors:refused,delivery:table.telemetry().filter(r=>r.lane==='keeper-delivery'||r.lane==='delivery')}));
 const task=readFileSync(join(authors[0].attempt,'task.json'),'utf8');assert.match(task,/Records ledger/);
 assert.equal(JSON.parse(task).player_input,'I look closely at the ledger label on the desk and read it.','the location author must receive this input rather than reconstruct intent from history');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('current-input observation receipts retain their focus and facts for final completion without a duplicate write',async t=>{
 let table,scene;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);if(batch.family==='location-decision-coverage')assert(batch.state.settled_receipts.some(r=>r.observation?.facts?.includes('The label reads Current records.')),'the receipt projection must retain actual observed contents');return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.01,feature:.01,observation:.99}});
   return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'place',action:'observe',to:scene,sense:'sight',access:'clear',scope:'The visible label.',facts:['The label reads Current records.']}]})],{stopReason:'toolUse'});
  },()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I read the visible label on the desk.');
 assert.equal(batches.filter(b=>b.family==='location-decision-coverage').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='observe').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});
