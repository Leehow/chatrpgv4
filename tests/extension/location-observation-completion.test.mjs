/** Controlled real-RPC component evidence, never a substitute for live play. */
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{join}from'node:path';
import{fauxAssistantMessage,fauxToolCall}from'@earendil-works/pi-ai';
import{openTable}from'./harness.mjs';import{RpcClient}from'../integration/support.ts';import{createHybridEngine}from'../../runtime/jev/hybrid-engine.ts';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const k=new RpcClient(workspace);try{await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The office is open.'});}finally{await k.close();}}
function answer(batch){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.endsWith('_blocked')||q.key.startsWith('restriction_')?.01:.99}];const choice=Object.keys(q.criteria).find(k=>k!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}
test('a settled local route publishes through native output without a location completion review (§249)',async t=>{
 let table;const via='Along the interior passage to its gate',families=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{families.push(batch.family);return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'}),scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1});
   return fauxAssistantMessage([fauxToolCall('place',{action:'move',to:scene,at:'Passage gate',via,additions:[{name:scene,features:[{name:'Passage gate',description:'A gate at the end of an interior passage.'}]}]})],{stopReason:'toolUse'});
  },fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I follow the interior passage and stop beside its gate.');
 assert(!families.some(family=>family.startsWith('location-')),'no location review is asked: '+families.join(','));
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='move').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});
test('a focused observation publishes on its first packet and reaches the sole author once (§249)',async t=>{
 const batches=[];let table,scene,requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   requests++;const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1});
   return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},
    {kind:'place',action:'observe',to:scene,sense:'sight',access:'clear',scope:'The visible ledger label on the desk.',facts:['The ledger label reads Records ledger.']}],interactions:[]})],{stopReason:'toolUse'});
  }]});
 t.after(()=>table.dispose());await table.session.prompt('I look closely at the ledger label on the desk and read it.');
 assert.equal(requests,1,'the first complete packet is published without a completion retry');
 assert(!batches.some(b=>b.family.startsWith('location-')),'no location review is asked');
 const refused=table.session.messages.filter(m=>m.role==='toolResult'&&m.isError);assert.deepEqual(refused,[]);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='observe').length,1,JSON.stringify({receipts:turn.receipts,errors:refused}));
 const authors=table.telemetry().filter(r=>r.lane==='isolated-expression'&&r.event==='written');assert.equal(authors.length,1,JSON.stringify({errors:refused,delivery:table.telemetry().filter(r=>r.lane==='keeper-delivery'||r.lane==='delivery')}));
 const task=readFileSync(join(authors[0].attempt,'task.json'),'utf8');assert.match(task,/Records ledger/);
 assert.equal(JSON.parse(task).player_input,'I look closely at the ledger label on the desk and read it.','the location author must receive this input rather than reconstruct intent from history');
 assert.equal(JSON.parse(task).decision_context.location_description?.version,JSON.parse(readFileSync(new URL('../../mods/enhanced-locations/mod.json',import.meta.url),'utf8')).version,'a location-selected native turn loads the installed locked Mod description section');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('a current-input observation receipt is published once without a duplicate write',async t=>{
 let table,scene;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1});
   // Seed an actual current-input receipt; native apply no longer advertises place writes.
   await table.runtimeBridges().at(-1).call('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'place',action:'observe',to:scene,sense:'sight',access:'clear',scope:'The visible label.',facts:['The label reads Current records.']}]});
   return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});
  }]});
 t.after(()=>table.dispose());await table.session.prompt('I read the visible label on the desk.');
 assert(!batches.some(b=>b.family.startsWith('location-')),'no location review is asked');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='observe').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('a selected local route, wait and look settle in order from one packet after one committed step (§250)',async t=>{
 let table,scene;const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   scene=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1});
   return fauxAssistantMessage([fauxToolCall('place',{action:'inspect',need:'contract'})],{stopReason:'toolUse'});
  },()=>{
   const read=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='place');
   assert.notEqual(read.isError,true,JSON.stringify(read));assert.match(read.details.guide,/Every place field is declared/);
   assert.equal(read.details.parameters,undefined,'the contract read carries no second grammar');assert.equal(read.details.write_route,undefined);
   return fauxAssistantMessage([fauxToolCall('place',{op:'inspect',change:{action:'move',to:scene,at:'street window'}})],{stopReason:'toolUse'});
  },async()=>{
   const refusal=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='place');
   assert.equal(refusal.isError,true);assert.equal(refusal.details.coc_error.details.reason,'place_mode_conflict');assert.match(refusal.details.coc_error.fix,/action:"move"/);
   const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp',projection:'receipts'});
   assert(!status.receipts.some(row=>row.kind==='place'&&row.action==='move'),'a conflicting read must not commit movement');
   return fauxAssistantMessage([fauxToolCall('place',{action:'move',name:scene,at:'desk',relation:'beside'})],{stopReason:'toolUse'});
  },()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[
    {kind:'place',action:'move',to:'here',at:'street window',relation:'beside',additions:[{name:scene,features:[{name:'street window',description:'A tall window overlooking the pavement.'}]}]},
    {kind:'time',minutes:2,reason:'Wait at the window as selected.'},
    {kind:'place',action:'observe',to:scene,at:'street window',facts:['A cart passes the window.']},
    {kind:'scene',service:'open',crowd:'quiet'}],interactions:[]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the desk, then to the street window, wait two minutes, then look at the pavement.');
 const output=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='output');assert.notEqual(output?.isError,true,JSON.stringify(output));
 assert(table.telemetry().some(row=>row.event==='place_target_alias_normalized'),'the native prepare boundary normalizes the explicit alias before the actual write');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 const kinds=turn.receipts.map(row=>row.kind==='place'?'place.'+row.action:row.kind);
 const desk=turn.receipts.findIndex(row=>row.kind==='place'&&row.action==='move'&&row.position?.spot==='desk'),window=turn.receipts.findIndex(row=>row.kind==='place'&&row.action==='move'&&row.position?.at==='street window');
 const wait=turn.receipts.findIndex(row=>row.kind==='time'),observe=turn.receipts.findIndex(row=>row.kind==='place'&&row.action==='observe');
 assert(desk>=0&&window>desk&&wait>window&&observe>wait,'canonical receipt order must be desk, window, wait, observe: '+JSON.stringify(kinds));
 assert(turn.receipts[desk].adjusted.some(row=>row.reason==='unregistered_feature_as_spot'));
 const protocol=table.telemetry().filter(row=>row.lane==='place-protocol');
 assert(protocol.some(row=>row.phase==='prepare'&&row.arguments.action==='inspect'),'the registered native tool actually records the pre-validation boundary');
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
