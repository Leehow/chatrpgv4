/** Component evidence only: real native kernel and Pi, controlled author/semantic decisions. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall as rawToolCall,getCurrentTools} from '@earendil-works/pi-ai';
import {turnPacket,normalizeTurnPacketArguments,compileTurnPacket,turnPacketResult,turnPacketProviderPayload,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {ExpressionPlanStream} from '../../runtime/isolated-expression.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient,kernel,openTurn,importSource} from '../integration/support.ts';
const brief={version:3,commands:[],responses:[]};
test('packet parameter refusals identify the exact field without coercing its JSON type',()=>{
 const packet={...brief,commands:[{kind:'move',to:'Central Library'},{kind:'scene',service:'open',crowd:'active',review_after_minutes:'45'}]};
 assert.throws(()=>turnPacket(JSON.stringify(packet)),/commands\[1\]\/review_after_minutes.*must be integer.*received string/);
 assert.equal(packet.commands[1].review_after_minutes,'45');
 for(const [value,reason] of [[0,/minimum/],[61,/maximum/],[1.5,/integer/]])assert.throws(()=>turnPacket(JSON.stringify({...brief,commands:[{...packet.commands[1],review_after_minutes:value}]})),reason);
 assert.throws(()=>turnPacket(JSON.stringify({...brief,commands:[{kind:'npc',actor:'npc_1',to:'away'}]})),/commands\[0\].*reason.*required/);
 assert.equal(turnPacket(JSON.stringify({...packet,commands:packet.commands.map(row=>row.kind==='scene'?{...row,review_after_minutes:45}:row)})).commands[1].review_after_minutes,45);
 const sentinel='private-submitted-material-'.repeat(200);
 assert.throws(()=>turnPacket(JSON.stringify({...brief,commands:[{kind:'scene',service:'open',crowd:'quiet',[sentinel]:'secret'}]})),error=>{
  assert.match(error.message,/<additional-property>/);assert.ok(!error.message.includes('private-submitted-material'));assert.ok(error.message.length<=1600);return true;
 });
});
test('selected information uses the existing closed event schema and one compiled apply payload',()=>{
 const event={name:'Read the notice',materials:[{name:'notice',text:'The office closes at noon.',kind:'fact',visibility:'player'}]};
 const packet=turnPacket(JSON.stringify({...brief,event})),compiled=compileTurnPacket(packet);
 assert.deepEqual(compiled,{responses:[],effects:[],event});
 assert.throws(()=>turnPacket(JSON.stringify({...brief,event:{...event,prose:'An invented narrative brief'}})),/additional/);
 assert.throws(()=>turnPacket(JSON.stringify({...brief,event:{...event,materials:[{...event.materials[0],author_instruction:'Write a scene'}]}})),/additional/);
 assert.ok(TURN_PACKET_PARAMETERS.properties.event.properties.materials);
});
test('native argument normalization repairs only canonical decimal strings within declared integer bounds',()=>{
 const original={...brief,commands:[{kind:'scene',service:'open',crowd:'quiet',review_after_minutes:'45'}]};
 const normalized=normalizeTurnPacketArguments(original);
 assert.equal(normalized.integerRepairs,1);assert.equal(normalized.args.commands[0].review_after_minutes,45);
 assert.equal(original.commands[0].review_after_minutes,'45');assert.doesNotThrow(()=>turnPacket(JSON.stringify(normalized.args)));
 for(const value of ['0','61','1.5','045',' 45','4.5e1','',true]){
  const bad={...brief,commands:[{...original.commands[0],review_after_minutes:value}]};
  assert.equal(normalizeTurnPacketArguments(bad).args,bad);assert.throws(()=>turnPacket(JSON.stringify(bad)));
 }
 const nonnumeric={...brief,commands:[{kind:'move',to:'45'}]};assert.equal(normalizeTurnPacketArguments(nonnumeric).args,nonnumeric);
});
const movement={kind:'move',to:'Central Library',via:'public street'};
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
  EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
// The controlled Keeper supplies current scene activity alongside its selected actions.
const fauxToolCall=(name,args)=>rawToolCall(name,name==='output'?{...args,commands:[...args.commands,{kind:'scene',service:'open',crowd:args.commands?.some(row=>row.kind==='move')?'empty':'quiet'}]}:args);
async function opened(workspace){const client=new RpcClient(workspace);try{await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});}finally{await client.close();}}
function answer(batch,p){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?1-p:p}];const choice=Object.keys(q.criteria).find(x=>x!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(x=>[x,x===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}

test('the non-strict Anthropic request retains the complete owned schema without claiming strict decoding',()=>{
 const other={name:'look',input_schema:{type:'object',properties:{}}};
 const payload={model:'MiniMax-M3.1-Flash-Preview',thinking:{type:'adaptive'},output_config:{effort:'medium'},
  messages:[{role:'user',content:'Existing material'}],tools:[other,{name:'output',input_schema:{type:'object',properties:TURN_PACKET_PARAMETERS.properties,required:TURN_PACKET_PARAMETERS.required},cache_control:{type:'ephemeral'}}]};
 const sent=turnPacketProviderPayload(payload);
 assert.deepEqual(sent.tools[1].input_schema.properties.responses,TURN_PACKET_PARAMETERS.properties.responses);
 assert.deepEqual(sent.tools[1].input_schema.required,TURN_PACKET_PARAMETERS.required);assert.equal(sent.tools[1].input_schema.additionalProperties,false);
 for(const branch of sent.tools[1].input_schema.properties.commands.anyOf){
  const bounded=branch.items.anyOf.find(row=>row.properties?.kind?.const==='npc');
  assert.deepEqual(bounded.properties.to.enum,['here','away']);assert.deepEqual(bounded.properties.actor,TURN_PACKET_PARAMETERS.properties.commands.anyOf[0].items.anyOf.find(row=>row.properties?.kind?.const==='npc').properties.actor);
 }
 assert.equal(sent.tools[1].strict,undefined);assert.equal(sent.output_config.format,undefined);
 assert.equal(sent.messages,payload.messages);assert.equal(sent.thinking,payload.thinking);assert.equal(sent.tools[0],other);
 assert.equal(payload.tools[1].input_schema.additionalProperties,undefined,'do not mutate the adapter payload');
 assert.deepEqual(sent.tools[1].cache_control,{type:'ephemeral'});
 assert.equal(turnPacketProviderPayload({tools:[other]}).tools[0],other);
});

test('compact commands and response meanings have closed fields and bounded strings',()=>{
 const reply={actor:'npc_1',act:'answer',points:['The meeting is at noon.']};
 const packet={version:3,commands:[movement],responses:[reply]};
 assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify(packet))),{responses:[reply],effects:[movement]});
 for(const bad of [{...brief,scene:'prose'},{...brief,actions:[]},{...brief,commands:[{...movement,passage:'prose'}]},{...brief,responses:[{...reply,points:['a'.repeat(161)]}]},{...brief,commands:[movement,movement]},{...brief,commands:[movement,{kind:'time',band:'invented',reason:'travel'}]}])assert.throws(()=>turnPacket(JSON.stringify(bad)),/Invalid|Only one/);
 assert.throws(()=>{const stream=new ExpressionPlanStream();stream.push('{{compose}}'+JSON.stringify(packet));stream.finish();},/Invalid private expression/);
});

test('silent decisions cannot carry a second free-text world-change channel',()=>{
 const packet=responses=>JSON.stringify({version:3,commands:[],responses});
 assert.deepEqual(turnPacket(packet([{actor:'npc_1',act:'silent'}])).responses,[{actor:'npc_1',act:'silent'}]);
 for(const fields of [{points:['The guest leaves.']},{points:[]},{stance:'Gets up and leaves.'},{observations:['Leaves the inn.']}])
  assert.throws(()=>turnPacket(packet([{actor:'npc_1',act:'silent',...fields}])),/silent|response/i);
});

for(const fault of ['unissued_npc_destination','silent_world_change'])test('native preflight repairs '+fault+' before any world write or author',async t=>{
 const batches=[];let requests=0,ref='npc_1';
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const good=()=>({version:3,commands:[{kind:'npc',actor:ref,to:'away',reason:'The visitor leaves.'},{kind:'scene',service:'open',crowd:'empty'}],responses:[{actor:ref,act:'silent'}]});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;const packet=good();if(fault==='unissued_npc_destination')packet.commands[0].to='An unissued street';else packet.responses[0].points=['The visitor leaves.'];return fauxAssistantMessage([rawToolCall('output',packet)],{stopReason:'toolUse'});},
   context=>{requests++;assert.ok(context.messages.some(message=>message.role==='toolResult'&&message.isError));return fauxAssistantMessage([rawToolCall('output',good())],{stopReason:'toolUse'});}
  ]});
 t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I watch the visitor leave and remain at the desk.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 const rows=table.telemetry(),authors=rows.filter(row=>row.lane==='isolated-expression'&&row.event==='written');
 assert.equal(rows.filter(row=>row.lane==='arguments'&&row.event==='packet_parameters_refused').length,1);
 assert.equal(authors.length,1);assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const task=JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8'));
 assert.equal(task.result.npc_actions_complete,true);
 assert.deepEqual(task.result.outcomes.filter(row=>row.kind==='npc').map(row=>({actor:row.actor,to:row.to,status:row.status})),[{actor:ref,to:'away',status:'changed'}]);
 assert.ok(!task.decision_context.scene.presence.people.some(person=>person.ref===ref));
 assert.deepEqual(task.decision_context.responses,[{actor:ref,act:'silent',mode:'nonverbal'}]);
 assert.equal(batches.filter(batch=>batch.family==='continuous-action-admission').length,0,'NPC-only movement and malformed parameters need no player-action judgment');
});

test('schema and capability failures share one correction allowance and cannot later publish success',async t=>{
 let requests=0,ref='npc_1';const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:3,commands:[],responses:[{actor:ref,act:'silent',points:['Leaves.']}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:3,commands:[{kind:'npc',actor:ref,to:'invented street',reason:'Leaves.'}],responses:[]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:3,commands:[],responses:[]})],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I remain by the desk.');
 assert.equal(requests,2);assert.equal(batches.length,0);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='delta').length,0);
 const state=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
 assert.ok(state.present.some(person=>person.ref===ref));
});

test('native invalid integer parameters get one correction and canonical decimals normalize before validation',async t=>{
 let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{...brief,commands:[{kind:'scene',service:'open',crowd:'quiet',review_after_minutes:'45.5'}]})],{stopReason:'toolUse'});},
   context=>{requests++;const errors=context.messages.filter(row=>row.role==='toolResult'&&row.isError).flatMap(row=>row.content??[]).map(row=>row.text??'').join('\n');
    assert.match(errors,/commands\[0\]\/review_after_minutes/);assert.match(errors,/must be integer/);assert.match(errors,/received string/);
    return fauxAssistantMessage([rawToolCall('output',{...brief,commands:[{kind:'scene',service:'open',crowd:'quiet',review_after_minutes:'45'}]})],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());
 await table.session.prompt('I remain by the desk.');
 assert.equal(requests,2);assert.deepEqual(table.extensionErrors,[]);
 assert.equal(table.telemetry().filter(row=>row.event==='packet_parameters_refused').length,1);
 assert.equal(table.telemetry().filter(row=>row.event==='decision_integer_normalized').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('native final output retains the production rule path and delivers actual public check results to its author',async t=>{
 let requests=0;const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   context=>{requests++;assert.ok(getCurrentTools(context.messages).some(tool=>tool.name==='resolve'));
    return fauxAssistantMessage([rawToolCall('resolve',{action:{intent:'investigate',skill:'Spot Hidden',goal:'Notice signs around the desk',method:'Look carefully at the desk'}})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());await table.session.prompt('I examine the desk carefully for any useful signs.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(table.telemetry().slice(-8)));
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 const roll=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'))).receipts.find(row=>row.kind==='roll');assert.ok(roll);
 assert.deepEqual(task.decision_context.settled_results.checks,[{kind:'roll',skill:roll.skill,passed:roll.passed,level:roll.level}]);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,1);
});

test('native contact resolution carries the current kernel rule into its single consent request',async t=>{
 let contact;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
  prepareWorkspace:async workspace=>{await opened(workspace);const client=new RpcClient(workspace);try{
   const capsule=await client.table('capsule',{campaign:'test-camp'});contact=capsule.mods.pending_contacts.find(row=>row.handle==='steven-knott');assert.ok(contact);
  }finally{await client.close();}},extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('resolve',{action:{intent:'social',actor:contact.actor,target:contact.target,decision:contact.decision,
    goal:'Ask this person for help with the investigation',method:'Approach him and ask for help'}})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I approach Steven Knott and ask for his help with the investigation.');
 assert.deepEqual(table.extensionErrors,[]);
 const consent=batches.filter(row=>row.family==='continuous-action-admission');assert.equal(consent.length,1);
 assert.match(JSON.stringify(consent[0]),/registered_contact_check/);
 assert.match(JSON.stringify(consent[0]),/mere presence does not establish it/);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
test('an invented time phrase is corrected before one consent batch and one settlement',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:['several minutes','quick_observation'].map(band=>()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{...brief,commands:[{kind:'time',band,reason:'I look around the office.'}]})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 assert.equal(requests,2,JSON.stringify(table.telemetry().filter(row=>row.lane==='run'||row.lane==='keeper-delivery')));assert.equal(batches.length,1,'invalid closed parameters do not reach consent');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
test('repeated unissued time bands terminate without consent, mutation or a later false-success packet',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:['several minutes','another phrase','quick_observation'].map(band=>()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{...brief,commands:[{kind:'time',band,reason:'I look around the office.'}]})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 assert.equal(requests,2,JSON.stringify(table.telemetry().filter(row=>row.lane==='arguments'||row.lane==='keeper-delivery'||row.lane==='run'&&row.type==='run_end')));assert.equal(batches.length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,0);
});

test('a refused earlier write cannot publish false success through native output',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.01);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement]})],{stopReason:'toolUse'});}
  ]});
 t.after(()=>table.dispose());await table.session.prompt('I stay beside the desk and do not leave.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,1);
 assert.equal(batches.filter(b=>b.family==='continuous-action-admission').length,1);
 assert.equal(batches.filter(b=>b.family==='held-act-outcome').length,0);
 assert.equal(table.telemetry().filter(r=>r.lane==='isolated-expression'&&r.event==='start').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='delta').length,0);
});

test('event validation repair uses this successful canonical event without an extra publication judge',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const initial={effects:[{kind:'time',minutes:4}],event:{name:'Photograph the mark',summary:'The proposed event.',material:'',materials:[{name:'view',kind:'description',visibility:'player',text:'The selected view.'}]}};
 const repaired={effects:initial.effects,event:{name:initial.event.name,summary:'The corrected canonical event.'}};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',initial)],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',repaired)],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());await table.session.prompt('I spend a few minutes photographing the mark.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,3);
 const repair=table.telemetry().filter(row=>row.lane==='held-operation'&&row.event==='parameter_failure_reconciled');assert.equal(repair.length,1);
 assert.notEqual(repair[0].failed_operation,repair[0].settled_operation);assert.equal(repair[0].completion_scope,'player_action');assert.ok(repair[0].receipts.length);
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const replies=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply');
 assert.ok(JSON.stringify(replies[0]).includes('event_argument_validation'));assert.ok(!JSON.stringify(replies).includes('argumentCompletionKey'),'private reconciliation keys stay out of model messages');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);assert.equal(turn.world.clock.minutes,4);
});

test('clue parameter corrections reuse the same player-action decision and release only its completed time',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const clock={kind:'time',minutes:1,why:'Read the posted notice.'};
 const clue={kind:'clue',clue:'A new posted notice',establish:{summary:'A posted office-hours notice.',how:'read it'}};
 const attempts=[{effects:[clock,clue]},
  {effects:[clock,{...clue,establish:{summary:'The selected hours notice.',how:'read it'}}]},
  {effects:[clock,{...clue,establish:{summary:'The selected hours notice.'}}]},
  {effects:[clock,{...clue,establish:{summary:'The selected hours notice.'},how:'The investigator reads it on the door.'}]}];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[...attempts.map(args=>()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',args)],{stopReason:'toolUse'});}),
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}]
 });t.after(()=>table.dispose());await table.session.prompt('I spend a minute reading the posted notice.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,5);
 assert.equal(batches.filter(row=>row.family==='continuous-action-admission').length,1);
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const repaired=table.telemetry().filter(row=>row.lane==='held-operation'&&row.event==='parameter_failure_reconciled');assert.equal(repaired.length,1,'bookkeeping variations share one held player-action row');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);assert.equal(turn.receipts.filter(row=>row.kind==='clue').length,1);assert.equal(turn.world.clock.minutes,1);
});

test('invalid NPC bookkeeping never becomes a refused player action',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',{effects:[{kind:'npc',name:'Steven Knott',reunion:{elapsed_minutes:5,background:[],reports:[]}}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',{effects:[{kind:'npc',name:'Steven Knott',stance:'warm'}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());await table.session.prompt('I greet Knott and ask him about the office.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,3);
 assert.equal(batches.filter(row=>['continuous-action-admission','held-act-outcome'].includes(row.family)).length,0);
 assert.ok(table.telemetry().some(row=>row.lane==='held-operation'&&row.event==='argument_outside_player_scope'));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('an event-only native decision reaches the author and activates paraphrased material once',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const event={name:'Read the notice',summary:'The investigator reads the posted notice.',material:'notice',materials:[{name:'notice',text:'The office closes at noon.',kind:'fact',visibility:'player'}]};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,event})],{stopReason:'toolUse'});}]
 });t.after(()=>table.dispose());await table.session.prompt('I read the posted notice.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,1);
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);assert.equal(typeof turn.commit,'string');
 assert.equal(turn.rendered_text,'The notice says the office shuts at midday.');
 assert.equal(turn.disclosures.filter(row=>row.status==='delivered'&&row.material.endsWith('/notice')).length,1);
});

test('native schema rejects extra movement fields before consent and permits one corrected submission',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[{...movement,note:'Unrecognized metadata'}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement]})],{stopReason:'toolUse'});}
  ]});
 t.after(()=>table.dispose());await table.session.prompt('I walk along the street to the Central Library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 assert.equal(batches.filter(b=>b.family==='continuous-action-admission').length,1,'invalid syntax must not spend a consent request');
 assert.equal(table.telemetry().filter(r=>r.lane==='isolated-expression'&&r.event==='written').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(r=>r.kind==='move').length,1);
});

for(const mode of ['accepted','refused','dialogue','sparse-dialogue','wrapped-dialogue','unknown-dialogue','offer-dialogue','planned','activity'])test('native packet settlement and publication: '+mode,async t=>{
 const batches=[];let requests=0,submittedSchema;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,mode==='refused'?.01:.99);}}});
 const packet={...brief,commands:mode==='activity'?[{kind:'time',band:'brief_activity',reason:'arrange notes'}]:mode.endsWith('dialogue')||mode==='planned'?[]:[movement]};
 if(mode==='sparse-dialogue'||mode==='wrapped-dialogue'||mode==='unknown-dialogue'||mode==='offer-dialogue')packet.responses=[{actor:'npc_1',act:'answer',points:['The meeting is at noon.']}];
 if(mode==='offer-dialogue')packet.responses[0].act='offer';
 if(mode==='unknown-dialogue')packet.responses[0].actor='npc_999999';
 if(mode==='wrapped-dialogue')packet.responses[0].points={item:{item:packet.responses[0].points}};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
   extraExtensions:[{name:'engine',factory:engine.extension}],responses:[context=>{requests++;const output=getCurrentTools(context.messages).find(tool=>tool.name==='output');assert.equal(getCurrentTools(context.messages).some(tool=>tool.name==='apply'),true);assert.equal(getCurrentTools(context.messages).some(tool=>tool.name==='resolve'),true);submittedSchema=output;return fauxAssistantMessage([{type:'text',text:'Private planning preamble.'},fauxToolCall('output',packet)],{stopReason:'toolUse'});}]});
 t.after(()=>table.dispose());
 if(packet.responses.length){
  const capsule=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
  if(mode==='unknown-dialogue'){
   const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
   packet.responses[0].actor=Object.values(world.npc_references.by_node).find(ref=>!capsule.present.some(row=>row.ref===ref));
   assert.ok(packet.responses[0].actor,'the forged reference must exist but remain unissued');
  }else packet.responses[0].actor=capsule.present.find(row=>row.name==='Steven Knott').ref;
 }
 await table.session.prompt(mode==='activity'?'I spend a few minutes arranging my notes.':mode==='refused'?'I stay at the desk. I do not leave.':mode.endsWith('dialogue')?'I ask Knott when he can meet.':mode==='planned'?'I might go to the library later.':'I walk along the street to the Central Library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,1);assert.equal(submittedSchema.parameters.additionalProperties,false);assert.deepEqual(Object.keys(submittedSchema.parameters.properties),['version','commands','responses','event']);
 const rows=table.telemetry(),writes=rows.filter(r=>r.lane==='turn-packet-prototype');
 assert.equal(rows.filter(r=>r.lane==='run'&&r.type==='step_start'&&r.kind==='infer').length,mode==='unknown-dialogue'?2:1,'count actual inference steps: '+JSON.stringify(rows.filter(r=>r.lane==='keeper-delivery'||r.lane==='tool').slice(-4)));
 assert.equal(batches.filter(b=>b.family==='continuous-action-admission').length,['accepted','refused','activity'].includes(mode)?1:0);
 assert.equal(batches.filter(b=>b.family==='held-act-outcome').length,0,'no extra publication judge is introduced');
 assert.equal(batches.filter(b=>b.family==='continuous-turn').length,0,'candidate preparation does not add a speculative semantic decision');
 assert.equal(rows.filter(r=>r.lane==='isolated-expression'&&r.event==='written').length,['refused','unknown-dialogue'].includes(mode)?0:1,'the author must actually complete');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,['refused','unknown-dialogue'].includes(mode)?0:1,'one completed public delivery');
 const authors=rows.filter(r=>r.lane==='isolated-expression'&&r.event==='start');
 assert.equal(authors.length,['refused','unknown-dialogue'].includes(mode)?0:1,JSON.stringify(rows.slice(-8)));
 if(mode==='accepted'){
   assert.equal(writes.length,1);assert.equal(writes[0].ok,true);
   const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
   assert.equal(turn.receipts.filter(r=>r.kind==='move').length,1);
   const task=JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8'));
   assert.equal(task.scene,undefined);assert.equal(task.narrative_content,undefined);assert.ok(task.decision_context.scene.name);assert.ok(task.decision_context.clock.day_part);assert.equal(task.decision_context.recent_public.at(-1)?.keeper,'Knott waits at his desk.');assert.ok(!JSON.stringify(task.decision_context.scene.public_material).includes('Knott waits at his desk.'));
   assert.equal(task.result.outcomes[0].kind,'move');
   assert.equal(task.result.outcomes[0].status,'changed');
   assert.equal(task.result.outcomes[0].to,task.decision_context.scene.name);
   assert.equal(task.result.outcomes[0].minutes,turn.receipts.find(r=>r.kind==='move').minutes);
   assert.equal(task.result.player_actions_complete,true);assert.equal(task.settled_actions,undefined,'proposals are not reconstructed as committed results');
 }
 if(mode==='sparse-dialogue'||mode==='wrapped-dialogue'||mode==='offer-dialogue'){const task=JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8'));assert.equal(task.npc_turns,undefined);assert.equal(task.decision_context.responses[0].mode,'speech_only');if(mode==='offer-dialogue')assert.equal(task.decision_context.responses[0].player_acceptance,'pending');assert.equal(task.decision_context.responses[0].claims[0],'The meeting is at noon.');assert.equal(task.decision_context.people[0].ref,packet.responses[0].actor);assert.equal(typeof task.decision_context.people[0].name_known,'boolean');assert.equal(task.decision_context.people[0].name,task.decision_context.people[0].display_name);assert.equal(task.decision_context.people[0].knowledge,undefined);assert.equal(task.decision_context.people[0].keeper_note,undefined);}
 if(mode==='unknown-dialogue')assert.equal(writes.length,0,'unknown speaker cannot execute a write or start the author');
 if(mode==='refused')assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='delta').length,0);
 if(mode==='activity'){
   const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
   const receipt=turn.receipts.find(r=>r.kind==='time');
   assert.ok(receipt.minutes>=2&&receipt.minutes<=10);assert.equal(receipt.band,'brief_activity');
   assert.equal(turn.world.clock.minutes,receipt.minutes);assert.equal(turn.receipts.filter(r=>r.kind==='time').length,1);
   const task=JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8'));
   assert.equal(task.result.outcomes[0].minutes,receipt.minutes);assert.equal(task.result.outcomes[0].band,receipt.band);
 }
 if(['dialogue','sparse-dialogue','planned'].includes(mode))assert.ok(writes.every(row=>row.effects.every(effect=>effect.kind==='scene')),'unchanged dialogue may assess the scene but executes no physical/player action');
});

test('array dialect decoding is lossless and never drops extra fields or invalid scalars',()=>{
 const reply={actor:'npc_1',act:'answer',points:{item:{item:'The meeting is at noon.'}}};
 const packet={version:3,commands:[],responses:{item:reply}};
 const result=normalizeTurnPacketArguments(packet);assert.equal(result.repairs,2);assert.deepEqual(turnPacket(JSON.stringify(result.args)).responses[0].points,['The meeting is at noon.']);assert.equal(normalizeTurnPacketArguments(result.args).args,result.args);
 for(const points of [{item:['noon'],secret:'keep'},{item:42}])assert.throws(()=>turnPacket(JSON.stringify(normalizeTurnPacketArguments({...brief,responses:[{...reply,points}]}).args)),/Invalid/);
});

test('NPC presence and travel compile into one existing effect transaction',()=>{
 const action={kind:'npc',actor:'npc_1',to:'Central Library',reason:'the selected companion joins the journey'};
 assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({...brief,commands:[movement,action]}))).effects,[movement,{kind:'npc',name:action.actor,to:action.to,why:action.reason}]);
});

test('actual NPC position outcomes distinguish change, no-op and idempotent replay',async t=>{
 const client=await kernel(t);await openTurn(client);
 const params={call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'Central Library'}]};
 const changed=await client.table('apply',params);
 const ref=(await client.table('look',{focus:'npc',name:'Steven Knott'})).ref;
 assert.equal(changed.outcomes[0].status,'changed');assert.equal(changed.outcomes[0].actor,ref);assert.equal(changed.outcomes[0].to,'Central Library');
 const unchanged=await client.table('apply',{...params,call_id:'t1-c2'});
 assert.deepEqual(unchanged.receipts,[],'unchanged assignments do not create change receipts');
 assert.equal(unchanged.outcomes[0].status,'unchanged');
 const replay=await client.table('apply',params);assert.equal(replay.replayed,true);const {replayed,...stored}=replay;assert.deepEqual(stored,changed,'replay returns the original actual result');
});

test('a failed NPC placement rolls back the combined journey and its clock',async t=>{
 const client=await kernel(t);await openTurn(client);
 const before=await client.table('capsule');
 await client.tableErr('apply',{call_id:'t1-c1',effects:[movement,{kind:'npc',name:'Steven Knott',to:'An unregistered destination'}]});
 const after=await client.table('capsule');assert.deepEqual(after.where,before.where);
});

test('partial NPC results cannot be reinterpreted as a complete decision',async t=>{
 const client=await kernel(t);await openTurn(client);
 const result=await client.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'Central Library'},{kind:'npc',name:'Unregistered Stranger',to:'Central Library'}]});
 assert.equal(result.outcomes[0].status,'changed');assert.ok(result.not_landed.length);
 assert.throws(()=>turnPacketResult(result),/Part of the operation did not land/);
});

test('duplicate journey timing is rejected locally and repaired before one consent batch',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement,{kind:'time',band:'invented',reason:'the same journey'}]})],{stopReason:'toolUse'}),
   fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the Central Library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(batches.filter(row=>row.family==='continuous-action-admission').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));assert.equal(turn.receipts.filter(row=>row.kind==='move').length,1);
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,0);
});

test('earlier direct NPC settlement reaches final author without repeating the command',async t=>{
 let ref='npc_1',seen;const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('apply',{effects:[{kind:'npc',name:ref,to:'away',why:'The visitor leaves.'}]})],{stopReason:'toolUse'}),
   context=>{const result=context.messages.filter(row=>row.role==='toolResult').at(-1);seen=result;return fauxAssistantMessage([rawToolCall('output',{...brief,commands:[{kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'});}]});t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I watch the visitor leave and stay at the desk.');
 const written=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(written,JSON.stringify({seen,errors:table.extensionErrors,tail:table.telemetry().slice(-12)}));
 const task=JSON.parse(readFileSync(join(written.attempt,'task.json'),'utf8'));
 assert.deepEqual(task.result.outcomes.filter(row=>row.kind==='npc').map(row=>({actor:row.actor,to:row.to,status:row.status})),[{actor:ref,to:'away',status:'changed'}]);
});

for(const mode of ['repair','repeat','unrelated'])test('native staged parameter recovery preserves the transaction boundary: '+mode,async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const bad={...brief,commands:[movement,{kind:'scene',service:'closed',crowd:'quiet'}]};
 const second=mode==='repeat'?bad:mode==='unrelated'?{...brief,commands:[]}:{...brief,commands:[movement,{kind:'scene',service:'closed',crowd:'empty'}]};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[bad,second,{...brief,commands:[movement,{kind:'scene',service:'closed',crowd:'empty'}]}].map(args=>()=>{
   requests++;return fauxAssistantMessage([rawToolCall('output',args)],{stopReason:'toolUse'});
  })});t.after(()=>table.dispose());await table.session.prompt('I leave the office and walk to Central Library now.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 const errors=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='output'&&row.isError);
 assert.match(JSON.stringify(errors[0]),/transaction_state.*uncommitted/);
 assert.match(JSON.stringify(errors[0]),/before_commit/);
 assert.equal(batches.filter(row=>row.family==='continuous-action-admission').length,1,'unchanged movement reuses its consent decision');
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='move').length,mode==='repair'?1:0);
 assert.equal(turn.receipts.filter(row=>row.kind==='scene').length,mode==='repair'?1:0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,mode==='repair'?1:0);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,mode==='repair'?1:0);
});

test('an earlier partial direct settlement cannot reach the native author as complete',async t=>{
 const batches=[];let ref='npc_1',partial;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('apply',{effects:[{kind:'npc',name:ref,to:'away',why:'The visitor leaves.'},{kind:'npc',name:'Unregistered Stranger',to:'away'}]})],{stopReason:'toolUse'}),
   context=>{partial=context.messages.filter(row=>row.role==='toolResult').at(-1);return fauxAssistantMessage([rawToolCall('output',{...brief,commands:[{kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I watch the visitors leave and stay at the desk.');
 assert.ok(JSON.stringify(partial).includes('not_landed'),JSON.stringify(partial));
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='delta').length,0);
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0,'native completeness is deterministic');
});

test('renaming the current scene is never projected as an arrival',async()=>{
 const {operationOutcomes}=await importSource('kernel-ts/apply/outcomes.ts');
 const outcome=operationOutcomes([{kind:'move',from:'scene',to:'scene',from_label:'New label',to_label:'New label',renamed:true,minutes:0}],{},{});
 assert.deepEqual(outcome,[{kind:'move',status:'unchanged',from:'New label',to:'New label',minutes:0}]);
});
