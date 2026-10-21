/** Controlled real-RPC component evidence, never a substitute for live play. */
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{join}from'node:path';
import{fauxAssistantMessage,fauxToolCall}from'@earendil-works/pi-ai';
import{openTable}from'./harness.mjs';import{RpcClient}from'../integration/support.ts';import{createHybridEngine}from'../../runtime/jev/hybrid-engine.ts';
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function opened(workspace){const k=new RpcClient(workspace);try{await k.ok('table.open',{campaign:'test-camp'});await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The office is open.'});}finally{await k.close();}}
function answer(batch){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.endsWith('_blocked')||q.key.startsWith('restriction_')?.01:.99}];const choice=Object.keys(q.criteria).find(k=>k!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}
test('a settled local route crosses the real RPC status and native output completion boundary',async t=>{
 let table,route;const via='Along the interior passage to its gate';
 const engine=createHybridEngine({env,decision:{decide:async batch=>{if(batch.family==='location-route-coverage')route=batch;return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'}),scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.99,feature:.01,observation:.01}});
   return fauxAssistantMessage([fauxToolCall('place',{action:'move',to:scene,at:'Passage gate',via,additions:[{name:scene,features:[{name:'Passage gate',description:'A gate at the end of an interior passage.'}]}]})],{stopReason:'toolUse'});
  },fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I follow the interior passage and stop beside its gate.');
 assert(route,'the native final decision reviews the settled movement');
 assert.equal(route.state.location_steps[0].via,via);
 assert.equal(route.state.location_steps[0].stage,'committed');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});
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
 const coverage=batches.filter(b=>['location-decision-coverage','location-observation-coverage'].includes(b.family));assert.equal(coverage.length,2);
 assert.equal(coverage.find(b=>b.family==='location-decision-coverage').state.initial_selection.observation,.99,'the event cannot drop the selected observation');
 assert(coverage.every(b=>(b.state.reference_context??b.state).recent_public?.at(-1)?.keeper==='The office is open.'),'spatial references retain the actual preceding public exchange');
 assert(coverage.every(b=>{const people=(b.state.reference_context??b.state).people;return Array.isArray(people)&&people.some(person=>person.ref&&person.display_name); }),'opaque NPC references require their canonical public names');
 assert(coverage.every(b=>!b.questions.some(q=>q.key==='observation_selected')),'an already decisive selection is reused');
 const refused=table.session.messages.filter(m=>m.role==='toolResult'&&m.isError);assert.match(JSON.stringify(refused),/place_decision_incomplete/);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='observe').length,1,JSON.stringify({receipts:turn.receipts,errors:refused}));
 const authors=table.telemetry().filter(r=>r.lane==='isolated-expression'&&r.event==='written');assert.equal(authors.length,1,JSON.stringify({errors:refused,delivery:table.telemetry().filter(r=>r.lane==='keeper-delivery'||r.lane==='delivery')}));
 const task=readFileSync(join(authors[0].attempt,'task.json'),'utf8');assert.match(task,/Records ledger/);
 assert.equal(JSON.parse(task).player_input,'I look closely at the ledger label on the desk and read it.','the location author must receive this input rather than reconstruct intent from history');
 assert.equal(JSON.parse(task).decision_context.location_description?.version,JSON.parse(readFileSync(new URL('../../mods/enhanced-locations/mod.json',import.meta.url),'utf8')).version,'a location-selected native turn loads the installed locked Mod description section');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('completion reads registered feature state even when capsule pressure removes it',async t=>{
 let table,scene,checked=false;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{
  if(batch.family==='location-decision-coverage'&&batch.questions.some(q=>q.key==='feature_satisfied')){
   checked=true;assert(batch.state.features.some(f=>f.name==='Target window'&&f.state==='closed'));
  }
  return answer(batch);
 }}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.01,feature:.99,observation:.01}});
   const features=Array.from({length:16},(_,i)=>({name:i===15?'Target window':`Wall panel ${i}`,description:'A dark painted wooden fitting. '.repeat(30),...(i===15?{state:'closed'}:{})}));
   return fauxAssistantMessage([fauxToolCall('place',{action:'establish',additions:[{name:scene,features}]})],{stopReason:'toolUse'});
  },async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
   assert(!c.where.location?.features?.some(f=>f.name==='Target window'),'the actual capsule pressure must remove the relevant feature');
   return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});
  }]});
 t.after(()=>table.dispose());await table.session.prompt('I close the target window if it is still open.');
 assert(checked,'completion must judge the full registered state, not the cropped capsule');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('current-input observation receipts retain their focus and facts for final completion without a duplicate write',async t=>{
 let table,scene;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);if(batch.family==='location-observation-coverage')assert(batch.state.observations.some(r=>r.stage==='committed'&&r.facts?.includes('The label reads Current records.')),'the receipt projection must retain actual observed contents');return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   const c=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});scene=c.where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.01,feature:.01,observation:.99}});
   // Seed an actual current-input receipt; native apply no longer advertises place writes.
   await table.runtimeBridges().at(-1).call('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'place',action:'observe',to:scene,sense:'sight',access:'clear',scope:'The visible label.',facts:['The label reads Current records.']}]});
   return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});
  }]});
 t.after(()=>table.dispose());await table.session.prompt('I read the visible label on the desk.');
 assert.equal(batches.filter(b=>b.family==='location-observation-coverage').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(r=>r.kind==='place'&&r.action==='observe').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('native standalone location settlement precedes a selected wait and final observation',async t=>{
 let table,scene,positionAtWait;const engine=createHybridEngine({env,decision:{decide:async batch=>{if(batch.family==='continuous-action-admission'&&batch.state.proposal.kinds?.includes('time'))positionAtWait=batch.state.current_position;return answer(batch);}}});
 table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[async()=>{
   scene=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).where.scene;
   table.emit('coc:location-demand',{campaign:'test-camp',turn:1,review:true,selection:{move:.99,feature:.01,observation:.99}});
   return fauxAssistantMessage([fauxToolCall('place',{action:'inspect',need:'contract'})],{stopReason:'toolUse'});
  },()=>{
   const read=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='place');
   assert.notEqual(read.isError,true,JSON.stringify(read));assert.equal(read.details.write_route.action,'move');
   assert(read.details.parameters.anyOf.every(branch=>branch.properties.action),'demand disclosure uses the same flat entrance');
   return fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},
    {kind:'place',action:'move',to:scene,at:'desk',relation:'beside'},{kind:'place',action:'move',to:scene,at:'street window',relation:'beside'}],interactions:[]})],{stopReason:'toolUse'});
  },()=>{
   const refusal=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='output');
   assert.equal(refusal.isError,true);assert.match(JSON.stringify(refusal.content),/first call place/,'parameter feedback exposes the independent location route');
   return fauxAssistantMessage([fauxToolCall('place',{op:'inspect',change:{action:'move',to:scene,at:'street window'}})],{stopReason:'toolUse'});
  },async()=>{
   const refusal=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='place');
   assert.equal(refusal.isError,true);assert.equal(refusal.details.coc_error.details.reason,'place_mode_conflict');assert.match(refusal.details.coc_error.fix,/action:"move"/);
   const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp',projection:'receipts'});
   assert(!status.receipts.some(row=>row.kind==='place'&&row.action==='move'),'a conflicting read must not commit movement');
   return fauxAssistantMessage([fauxToolCall('place',{action:'move',name:scene,at:'street window',relation:'beside',additions:[{name:scene,features:[{name:'street window',description:'A tall window overlooking the pavement.'}]}]})],{stopReason:'toolUse'});
  },()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:2,why:'Wait at the window as selected.'}]})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},{kind:'place',action:'observe',to:scene,at:'street window',sense:'sight',access:'clear',scope:'The pavement through the window.',facts:['A cart passes the window.']}],interactions:[]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the street window, wait two minutes, then look at the pavement.');
 const call=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='place');assert.notEqual(call?.isError,true,JSON.stringify(call));
 assert(table.telemetry().some(row=>row.event==='place_target_alias_normalized'),'the native prepare boundary normalizes the explicit alias before the actual write');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 const move=turn.receipts.findIndex(row=>row.kind==='place'&&row.action==='move'),wait=turn.receipts.findIndex(row=>row.kind==='time'),observe=turn.receipts.findIndex(row=>row.kind==='place'&&row.action==='observe');
 assert(move>=0&&wait>move&&observe>wait,'canonical receipt order must be move, wait, observe: '+JSON.stringify(turn.receipts));
 assert.equal(positionAtWait?.at,'street window','the real subsequent time review reads the committed current local position');
 const protocol=table.telemetry().filter(row=>row.lane==='place-protocol');
 assert(protocol.some(row=>row.phase==='normalized'&&row.arguments.action==='inspect'));
 assert(protocol.some(row=>row.phase==='prepare'&&row.arguments.action==='inspect'),'the registered native tool actually records the pre-validation boundary');
 assert.equal(turn.receipts.filter(row=>row.kind==='place'&&row.action==='move').length,1,'final publication never replays the already settled position');
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
