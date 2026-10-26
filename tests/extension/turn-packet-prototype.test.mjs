/** Component evidence only: real native kernel and Pi, controlled author/semantic decisions. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall as rawToolCall,getCurrentTools,getCurrentSystemPrompt} from '@earendil-works/pi-ai';
import {turnPacket,normalizeTurnPacketArguments,compileTurnPacket,turnPacketResult,turnPacketProviderPayload,turnPacketParameterSchema,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {ExpressionPlanStream} from '../../runtime/isolated-expression.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient,kernel,openTurn,importSource} from '../integration/support.ts';
const brief={version:4,commands:[],interactions:[]};
const minimaxWire=JSON.parse(readFileSync(join(import.meta.dirname,'fixtures/location-native-wire-20261019.json'),'utf8'));
for(const [index,body]of [...minimaxWire.attempts,JSON.stringify({version:4})].entries())test(`MiniMax M3 output frame ${index+1} publishes once through the actual native boundary`,async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'}),
   fauxAssistantMessage(body)]});
 t.after(()=>table.dispose());await table.session.prompt('I remain by the desk.');
 await table.session.prompt('I look around without moving.');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed'&&row.turn===2).length,1);
 assert.equal(table.telemetry().filter(row=>row.turn===2&&row.reason==='text_tool_call_routed'&&row.tool==='output').length,1);
 assert.equal(table.telemetry().filter(row=>row.turn===2&&row.lane==='isolated-expression'&&row.event==='written').length,1);
 assert.deepEqual(table.extensionErrors,[]);
});
test('the actual native Keeper request has one output contract rather than legacy prose instructions',async t=>{
 let prompt,request;
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  systemPrompt:readFileSync(join(import.meta.dirname,'../../prompts/keeper.md'),'utf8'),
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[context=>{prompt=getCurrentSystemPrompt(context.messages);request=JSON.stringify(context.messages);return fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());await table.session.prompt('I look around without moving.');
 assert.equal(typeof prompt,'string');
 for(const inherited of ['For unchanged conversation, begin the final reply with {{public}}','return {{compose}} followed','then supply a private expression brief.','Begin your complete final public prose with {{public}}'])
  assert.ok(!prompt.includes(inherited),'native request contains a contradictory legacy instruction: '+inherited);
 for(const inherited of ['write the final public response yourself','No separate prose author','say what landed, in your own prose','Write what the book describes','explicit semantic records'])
  assert.ok(!request.includes(inherited),'native capsule and system agree on the delivery owner: '+inherited);
 assert.ok(request.includes('do not draft that prose here'));
});
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
test('selected information references existing host material and refuses event prose',()=>{
   const event={name:'Read the notice',materials:[{name:'notice',text:'The office closes at noon.',kind:'fact',visibility:'player'}]};
   assert.throws(()=>turnPacket(JSON.stringify({...brief,event})),/additional/);
   const packet=turnPacket(JSON.stringify({...brief,reveal:[{source_ref:'source_1'}]}));
   assert.deepEqual(compileTurnPacket(packet),{responses:[],effects:[]});
   assert.equal(TURN_PACKET_PARAMETERS.properties.event,undefined);
  });
test('directed relationship commands settle once and reach the sole author as current state',async t=>{
 let ref='npc_1';const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'relationship',actor:ref,toward:'investigator_1',affinity:'friendly'}],interactions:[{actor:ref,to:['investigator_1'],act:'acknowledge'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I thank the visitor for his help and stay by the desk.');
 assert.deepEqual(table.extensionErrors,[]);
 const author=table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written');assert.equal(author.length,1);
 const task=JSON.parse(readFileSync(join(author[0].attempt,'task.json'),'utf8'));
 assert.ok(task.decision_context.people.find(person=>person.ref===ref).relationships.some(row=>row.toward==='investigator_1'&&row.public==='friendly'));
 assert.equal(table.telemetry().filter(row=>row.lane==='turn-packet-prototype'&&row.ok===true).length,1);
 assert.equal(batches.filter(batch=>batch.family==='continuous-action-admission').length,0);
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
// §249/§249.6: the single Keeper judges move, place, time, cash, item and object lines itself, document writes included;
// the admission lane records them without a consent batch. A map reveal is still reviewed, so it carries the consent machinery.
const consent=batches=>batches.filter(batch=>batch.family==='continuous-action-admission');
const keeperJudged=table=>table.telemetry().filter(row=>row.lane==='admission'&&row.path==='keeper_judged').map(row=>({kinds:row.kinds,jev_calls:row.jev_calls}));
const MAP='player-corbitt-house-map';
const reveal=label=>({kind:'map',name:MAP,regions:['ground-entry-hall'],region_labels:{'ground-entry-hall':'Entry hall'},
 level_labels:{'Ground Floor':'Ground floor'},label,why:'Knott spreads the house plan on the desk.'});
const mapTitle=workspace=>JSON.parse(readFileSync(join(workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).map_labels?.[MAP]?.title;
const authorTask=table=>{const written=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(written,JSON.stringify(table.telemetry().slice(-8)));return JSON.parse(readFileSync(join(written.attempt,'task.json'),'utf8'));};
function answer(batch,p){const answers=Object.fromEntries(batch.questions.map(q=>{if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?1-p:p}];const choice=Object.keys(q.criteria).find(x=>x!=='none')??'none';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(x=>[x,x===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];}));return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};}

test('a cross-place observation reaches the actual sole author without moving the observed person',async t=>{
 let office,ref;
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[
   {kind:'place',action:'move',to:'Office annex',at:'glass partition',relation:'beside',via:'Through the side door into the annex',travel_band:'adjacent',
    additions:[{name:'Office annex',within:office,description:'A small waiting annex beside the office.',features:[{name:'glass partition',description:'A clear glass panel.',state:'closed',passable:false}]}]},
   {kind:'time',minutes:5,reason:'The player explicitly waits five minutes beside the panel.',beyond_travel:true},
   {kind:'place',action:'observe',to:office,sense:'sight',access:'limited',scope:'Only the desk visible through the glass.',facts:['The same visitor remains beside the original desk.'],people:[ref],
    view:'The annex glass panel shows the office desk from the current position.'},
   {kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 const before=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});office=before.where.scene;ref=before.present.find(person=>person.name==='Steven Knott').ref;
 const clockBefore=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;
 await table.session.prompt('I step into the waiting annex, stand by its glass panel, wait five minutes and look back at the visitor beside the office desk.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(message=>message.role==='toolResult'&&message.details?.coc_error).map(message=>message.details.coc_error),[]);
 const after=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
 assert.equal(after.where.scene,office+' / Office annex');assert.equal(after.present.length,0);
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(table.telemetry().slice(-8)));
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 assert.equal(task.decision_context.observations[0].people[0].ref,ref);
 assert.equal(task.decision_context.cast.find(person=>person.ref===ref).presence,'observed');
 assert.equal(task.decision_context.scene.presence.people.length,0);
 assert.deepEqual(task.result.outcomes.find(outcome=>outcome.action==='observe').observation.facts,['The same visitor remains beside the original desk.']);
 assert.equal(task.result.outcomes.find(outcome=>outcome.kind==='time').minutes,5);
 assert.equal(task.result.outcomes.find(outcome=>outcome.action==='observe').observation.observed_clock.minutes,clockBefore+5);
 const observedPerson=await table.runtimeBridges().at(-1).call('table.look',{campaign:'test-camp',focus:'npc',name:ref});
 assert.equal(observedPerson.scene,office);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('a native place observation survives frozen final preparation into the author',async t=>{
 let ref;
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'place',action:'observe',to:'here',sense:'sight',access:'clear',scope:'The desk area.',facts:['The visitor waits beside the desk.'],people:[ref]},{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I stay here and watch the visitor beside the desk.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(message=>message.role==='toolResult'&&message.details?.coc_error).map(message=>message.details.coc_error),[]);
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(table.telemetry().slice(-8)));
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 assert.equal(task.result.outcomes.filter(outcome=>outcome.action==='observe').length,1);
 assert.equal(task.decision_context.observations[0].people[0].ref,ref);
});

test('a focused observation history read reaches the sole author only for this input',async t=>{
 let office,ref;
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[
    {kind:'place',action:'move',to:'Waiting annex',at:'glass panel',via:'Through the side door',travel_band:'adjacent',additions:[{name:'Waiting annex',within:office,description:'A waiting room beside the office.',features:[{name:'glass panel',description:'A panel overlooking the office.'}]}]},
    {kind:'place',action:'observe',to:office,sense:'sight',access:'clear',scope:'The office desk.',facts:['The same visitor waits beside the desk.'],people:[ref],view:'Through the clear panel from the waiting annex.'},
    {kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('place',{op:'inspect',need:'observation',name:office,sense:'sight'})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());const bridge=table.runtimeBridges().at(-1);
 const current=await bridge.call('table.capsule',{campaign:'test-camp'});office=current.where.scene;ref=current.present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I enter the waiting annex and look through its panel at the visitor by the desk.');
 const world=()=>JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
 const before=world();
 await table.session.prompt('Out of character, read the recorded observation of the office without looking again or advancing time.');
 assert.deepEqual(table.extensionErrors,[]);
 const written=()=>table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written').at(-1);
 const packet=()=>JSON.parse(readFileSync(join(written().attempt,'task.json'),'utf8'));
 const task=packet();assert.equal(task.decision_context.reference_observations.length,1);
 assert.equal(task.decision_context.reference_observations[0].records[0].people[0].ref,ref);
 assert.deepEqual(task.decision_context.observations,[],'reading old records is not a new perception');
 assert.equal(task.decision_context.people.some(person=>person.ref===ref),false,'history adds no remote private actor card');
 assert.deepEqual(world().clock,before.clock);assert.deepEqual(world().mods.state['enhanced-locations'],before.mods.state['enhanced-locations']);
 await table.session.prompt('Out of character, acknowledge this note without inspecting any place.');
 assert.equal(packet().decision_context.reference_observations,undefined,'demand history expires on the next input');
});

test('a repeated look at the same view gives the sole author its prior record without a Keeper read (§249)',async t=>{
 let office,ref;
 const look=facts=>({kind:'place',action:'observe',to:office,sense:'sight',access:'clear',scope:'The office desk.',facts,people:[ref],view:'Through the clear panel from the waiting annex.'});
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[
    {kind:'place',action:'move',to:'Waiting annex',at:'glass panel',via:'Through the side door',travel_band:'adjacent',additions:[{name:'Waiting annex',within:office,description:'A waiting room beside the office.',features:[{name:'glass panel',description:'A panel overlooking the office.'}]}]},
    look(['The same visitor waits beside the desk.']),{kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'time',minutes:5,reason:'The selected short wait.'},look(['The visitor now sits on the desk edge.'])]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'place',action:'move',to:'here',at:'glass panel',relation:'beside'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());const bridge=table.runtimeBridges().at(-1);
 const current=await bridge.call('table.capsule',{campaign:'test-camp'});office=current.where.scene;ref=current.present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I enter the waiting annex and look through its panel at the visitor by the desk.');
 await table.session.prompt('I wait five minutes and look through the panel again.');
 assert.deepEqual(table.extensionErrors,[]);
 const written=()=>table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written').at(-1);
 const packet=()=>JSON.parse(readFileSync(join(written().attempt,'task.json'),'utf8'));
 assert.equal(table.session.messages.some(row=>row.role==='assistant'&&row.content.some(block=>block.type==='toolCall'&&block.name==='place')),false,'no Keeper read');
 const references=packet().decision_context.reference_observations;
 assert.equal(references?.length,1,'the prior record of the re-observed view reaches the author');
 assert.deepEqual(references[0].records[0].facts,['The same visitor waits beside the desk.']);
 await table.session.prompt('I stay at the panel.');
 assert.equal(packet().decision_context.reference_observations,undefined,'a turn that does not look again carries no history');
});

test('an observation atomically creates a remote place and person without adding a local actor card',async t=>{
 let office;
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[
   {kind:'walk_on',slot:'new_1',label:'Boy selling newspapers',to:'Street outside',reason:'An ordinary street vendor counting coins.'},
   {kind:'place',action:'observe',to:'Street outside',sense:'sight',access:'limited',scope:'The entrance pavement.',facts:['A boy is counting coins beside his newspaper bundle.'],view:'From the current desk through the open doorway.',people:['new_1'],
    additions:[{name:'Street outside',within:'',description:'The ordinary street outside this office.'}],situations:[{name:'Selling newspapers',summary:'The boy is counting his change.',status:'ongoing',participants:['new_1']}]},
   {kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());office=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).where.scene;
 await table.session.prompt('I stay beside the desk and watch the newspaper seller outside through the doorway.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(message=>message.role==='toolResult'&&message.details?.coc_error).map(message=>message.details.coc_error),[]);
 const current=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});assert.equal(current.where.scene,office);
 const written=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(written);
 const task=JSON.parse(readFileSync(join(written.attempt,'task.json'),'utf8')),observed=task.decision_context.observations[0].people[0];
 assert.equal(task.decision_context.cast.find(person=>person.ref===observed.ref).presence,'observed');
 assert.equal(task.decision_context.people.some(person=>person.ref===observed.ref),false,'remote observation does not expose a private speech/profile card');
 assert.equal(current.present.some(person=>person.ref===observed.ref),false);
 assert.equal((await table.runtimeBridges().at(-1).call('table.look',{campaign:'test-camp',focus:'npc',name:observed.ref})).scene,'Street outside');
});

test('a direct place submit without a route arrives as an open route, and later local refinement needs no review (§250)',async t=>{
 const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const command={kind:'place',action:'move',to:'Ordinary Inn / Single room',via:'Along the street and up the inn stairs',travel_band:'adjacent',
  additions:[{name:'Ordinary Inn',description:'An ordinary inn.'},{name:'Single room',within:'Ordinary Inn',description:'A plain single room.',features:[{name:'window',description:'A wooden window.'}]}]};
 const {kind,via,...missingRoute}=command;
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('place',{op:'submit',change:missingRoute})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'empty'}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'place',action:'move',to:'here',at:'window',relation:'beside'}]})],{stopReason:'toolUse'})
  ]});
 t.after(()=>table.dispose());
 await table.session.prompt('I visit a nearby ordinary inn and enter a single room to look around.');
 assert.deepEqual(table.extensionErrors,[]);
 const bridge=table.runtimeBridges().at(-1);
 assert.equal((await bridge.call('table.capsule',{campaign:'test-camp'})).where.scene,command.to);
 const arrival=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8')).receipts.find(row=>row.kind==='move');
 assert.equal(arrival.improvised,true);assert(arrival.adjusted.some(row=>row.reason==='open_route'));
 await table.session.prompt('I stay here and look around.');
 assert.deepEqual(table.extensionErrors,[]);
 await table.session.prompt('I move beside the window.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.equal((await bridge.call('table.capsule',{campaign:'test-camp'})).where.location.position.at,'window');
 assert(!batches.some(batch=>batch.family==='continuous-action-admission'&&JSON.stringify(batch.state?.proposal?.kinds??[]).includes('place')),'the Keeper judges location lines (§249)');
});

test('a Keeper decision that omits the selected journey publishes as judged, without a completion review or an arrival (§249)',async t=>{
 const families=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{families.push(batch.family);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension},{name:'location-demand-fixture',factory:pi=>{pi.on('tool_call',()=>pi.events.emit('coc:location-demand',{campaign:'test-camp',turn:1}));}}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 const before=(await table.runtimeBridges().at(-1)?.call('table.capsule',{campaign:'test-camp'}))?.where?.scene;
 await table.session.prompt('I enter an ordinary inn.');
 assert.deepEqual(table.extensionErrors,[]);
 assert(!families.some(family=>family.startsWith('location-')),'no location review is asked: '+families.join(','));
 assert(!table.telemetry().some(row=>row.lane==='location-decision-coverage'));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const scene=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).where.scene;
 assert.notEqual(scene,'Ordinary Inn','an omitted journey moves nobody');if(before)assert.equal(scene,before);
});

test('the non-strict Anthropic request retains the complete owned schema without claiming strict decoding',()=>{
 const other={name:'look',input_schema:{type:'object',properties:{}}};
 const payload={model:'MiniMax-M3.1-Flash-Preview',thinking:{type:'adaptive'},output_config:{effort:'medium'},
  messages:[{role:'user',content:'Existing material'}],tools:[other,{name:'output',input_schema:{type:'object',properties:TURN_PACKET_PARAMETERS.properties,required:TURN_PACKET_PARAMETERS.required},cache_control:{type:'ephemeral'}}]};
 const sent=turnPacketProviderPayload(payload);
 assert.deepEqual(sent.tools[1].input_schema.properties.responses,TURN_PACKET_PARAMETERS.properties.responses);
 assert.deepEqual(sent.tools[1].input_schema.required,TURN_PACKET_PARAMETERS.required);assert.equal(sent.tools[1].input_schema.additionalProperties,false);
 const current=sent.tools[1].input_schema;
 assert.deepEqual(current,turnPacketParameterSchema());
 for(const branch of current.properties.commands.anyOf){
  const bounded=branch.items.anyOf.find(row=>row.properties?.kind?.const==='npc');
  assert.deepEqual(bounded.properties.to.enum,['here','away']);assert.deepEqual(bounded.properties.actor,TURN_PACKET_PARAMETERS.properties.commands.anyOf[0].items.anyOf.find(row=>row.properties?.kind?.const==='npc').properties.actor);
 }
 assert.equal(sent.tools[1].strict,undefined);assert.equal(sent.output_config.format,undefined);
 assert.deepEqual(sent.messages,payload.messages);assert.equal(sent.thinking,payload.thinking);assert.equal(sent.tools[0],other);
 assert.equal(payload.tools[1].input_schema.additionalProperties,undefined,'do not mutate the adapter payload');
 assert.deepEqual(sent.tools[1].cache_control,{type:'ephemeral'});
 assert.equal(turnPacketProviderPayload({tools:[other]}).tools[0],other);
});

test('compact commands and response meanings have closed fields and bounded strings',()=>{
 const reply={actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}]};
 const packet={version:4,commands:[movement],interactions:[reply]};
 assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify(packet))),{responses:[reply],effects:[movement]});
 for(const bad of [{...brief,scene:'prose'},{...brief,actions:[]},{...brief,commands:[{...movement,passage:'prose'}]},{...brief,interactions:[{...reply,points:['a'.repeat(161)]}]}])assert.throws(()=>turnPacket(JSON.stringify(bad)),/Invalid/);
 // §250: several stops and an additional wait share one ordered packet.
 assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({...brief,commands:[movement,{kind:'time',minutes:5,reason:'wait'},movement]}))).effects.map(effect=>effect.kind),[movement.kind,'time',movement.kind]);
 assert.throws(()=>{const stream=new ExpressionPlanStream();stream.push('{{compose}}'+JSON.stringify(packet));stream.finish();},/Invalid private expression/);
});

test('silent decisions cannot carry a second free-text world-change channel',()=>{
 const packet=responses=>JSON.stringify({version:4,commands:[],interactions:responses});
 assert.deepEqual(turnPacket(packet([{actor:'npc_1',act:'silent'}])).interactions,[{actor:'npc_1',act:'silent'}]);
 for(const fields of [{points:['The guest leaves.']},{points:[]},{stance:'Gets up and leaves.'},{observations:['Leaves the inn.']}])
  assert.throws(()=>turnPacket(packet([{actor:'npc_1',act:'silent',...fields}])),/silent|response/i);
});

for(const fault of ['unissued_npc_destination','silent_world_change'])test('native preflight repairs '+fault+' before any world write or author',async t=>{
 const batches=[];let requests=0,ref='npc_1';
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const good=()=>({version:4,commands:[{kind:'npc',actor:ref,to:'away',reason:'The visitor leaves.'},{kind:'scene',service:'open',crowd:'empty'}],interactions:[{actor:ref,act:'silent'}]});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;const packet=good();if(fault==='unissued_npc_destination')packet.commands[0].to='An unissued street';else packet.interactions[0].points=['The visitor leaves.'];return fauxAssistantMessage([rawToolCall('output',packet)],{stopReason:'toolUse'});},
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
 assert.deepEqual(task.decision_context.responses,[{actor:ref,act:'silent',location:{scope:'offstage'},mode:'nonverbal'}]);
 assert.deepEqual(task.decision_context.cast.filter(person=>person.role==='player').map(person=>person.display_name),task.investigator_names);
 assert.equal(task.decision_context.cast.find(person=>person.ref===ref).presence,'offstage');
 assert.equal(batches.filter(batch=>batch.family==='continuous-action-admission').length,0,'NPC-only movement and malformed parameters need no player-action judgment');
});

test('distinct schema and capability corrections reach one valid packet without executing rejected attempts',async t=>{
 let requests=0,ref='npc_1';const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:4,commands:[],interactions:[{actor:ref,act:'silent',points:['Leaves.']}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'npc',actor:ref,to:'invented street',reason:'Leaves.'}],interactions:[]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'time',minutes:-1,reason:'Invalid duration.'}],interactions:[]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}],interactions:[]})],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I remain by the desk.');
 assert.equal(requests,4);assert.equal(batches.length,0);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
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
 assert.deepEqual(task.decision_context.settled_results.checks,[{kind:'roll',skill:roll.skill,passed:roll.passed,level:roll.level,goal:'Notice signs around the desk'}],'§253.2: the author learns what the check was for');
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,1);
});

// §249 (amended 2026-10-21): a resolve of a Mod's registered meeting check is the Keeper's to roll, so it is not put to review.
test('a native registered contact resolution is the Keeper\'s meeting check and lands without a consent request (§249)',async t=>{
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
 assert.equal(consent(batches).length,0,'the reviewer is not asked whether the player selected a rule of the meeting');
 assert.deepEqual(keeperJudged(table),[{kinds:['meeting_check'],jev_calls:0}],'the pending row matched and the check was recorded as judged');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='roll').length,1,'the meeting check is rolled');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
test('an invented time phrase is corrected before admission and settles once as the Keeper\'s own judgment (§249)',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:['several minutes','quick_observation'].map(band=>()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{...brief,commands:[{kind:'time',band,reason:'I look around the office.'}]})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 assert.equal(requests,2,JSON.stringify(table.telemetry().filter(row=>row.lane==='run'||row.lane==='keeper-delivery')));assert.equal(batches.length,0,'§249: a wait is not put to the consent review');
 assert.deepEqual(keeperJudged(table),[{kinds:['time'],jev_calls:0}],'invalid closed parameters never reach admission; the corrected packet does once');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
test('unissued time bands are refused without consent or mutation until the Keeper selects an issued one',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:['several minutes','another phrase','quick_observation'].map(band=>()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{...brief,commands:[{kind:'time',band,reason:'I look around the office.'}]})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 // §272.1: a changed packet meeting the same refusal gets a third try; the third ends the input.
 assert.equal(requests,3,JSON.stringify(table.telemetry().filter(row=>row.lane==='arguments'||row.lane==='keeper-delivery'||row.lane==='run'&&row.type==='run_end')));assert.equal(batches.length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json')));
 // The third packet selects an issued band: the correction settles once and publishes, never the unissued ones.
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('a refused earlier write cannot publish false success through native output',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.01);}}});
 // §249: a native output carries only Keeper-judged lines, so the refused line is an earlier reviewed map reveal.
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',{effects:[reveal('An unchosen note.')]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[{kind:'time',band:'quick_observation',reason:'Stay beside the desk.'}]})],{stopReason:'toolUse'});}
  ]});
 t.after(()=>table.dispose());await table.session.prompt('I stay beside the desk and write nothing.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 assert.deepEqual(consent(batches).map(batch=>batch.state.proposal.kinds),[['map']],'only the map reveal is reviewed');
 assert.deepEqual(keeperJudged(table),[{kinds:['time'],jev_calls:0}],'the wait in the published packet is the Keeper\'s own judgment');
 assert.equal(batches.filter(b=>b.family==='held-act-outcome').length,0);
 assert.equal(mapTitle(table.workspace),undefined,'the refused reveal changed nothing');
 const task=authorTask(table);
 assert.deepEqual(task.decision_context.failed_attempts,[{tool:'apply',status:'uncommitted',reason:'action_not_authorized'}],'the author learns the write was refused');
 assert.ok(!JSON.stringify(task).includes('An unchosen note.'),'the refused reveal never reaches the author');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
});

test('model event writes are refused atomically before their accompanying mechanics',async t=>{
   const batches=[];let requests=0;
   const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
   const illegal={effects:[{kind:'time',minutes:4}],event:{name:'A response',summary:'Complete dialogue.'}};
   const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
    extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
     ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',illegal)],{stopReason:'toolUse'});},
     ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}
    ]});t.after(()=>table.dispose());await table.session.prompt('I wait beside the desk.');
   const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
   assert.equal(turn.receipts.filter(row=>['time','event'].includes(row.kind)).length,0);
   assert.ok(JSON.stringify(table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply')).includes('event'));
   assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
  });

test('clue parameter corrections reuse the same player-action decision and release only its completed time',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 // §249: the wait is the Keeper's own judgment; the map reveal is the reviewed player action held across the corrections.
 const clock={kind:'time',minutes:1,why:'Read the posted notice.'},note=reveal('Office hours: nine to noon.');
 const clue={kind:'clue',clue:'A new posted notice',establish:{summary:'A posted office-hours notice.',how:'read it'}};
 // §264.24: a missing how no longer refuses; the third attempt is refused for naming a clue after a person instead.
 const attempts=[{effects:[clock,note,clue]},
  {effects:[clock,note,{...clue,establish:{summary:'The selected hours notice.',how:'read it'}}]},
  {effects:[clock,note,{...clue,clue:'Steven Knott',establish:{summary:'The selected hours notice.'},how:'The investigator reads it on the door.'}]},
  {effects:[clock,note,{...clue,establish:{summary:'The selected hours notice.'},how:'The investigator reads it on the door.'}]}];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[...attempts.map(args=>()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',args)],{stopReason:'toolUse'});}),
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}]
 });t.after(()=>table.dispose());await table.session.prompt('I spend a minute reading the posted notice and study the house plan beside it.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,5);
 assert.deepEqual(consent(batches).map(batch=>batch.state.proposal.kinds),[['map']],JSON.stringify(table.telemetry().filter(row=>row.lane==='held-operation'||row.lane==='keeper-delivery').slice(-8)));
 assert.ok(table.telemetry().some(row=>row.lane==='admission'&&row.reused&&row.verdict==='authorized'),'the corrected attempt reuses the one player-action decision');
 const judged=keeperJudged(table);assert.ok(judged.length&&judged.every(row=>row.kinds.join()==='time'&&row.jev_calls===0),JSON.stringify(judged));
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const repaired=table.telemetry().filter(row=>row.lane==='held-operation'&&row.event==='parameter_failure_reconciled');assert.equal(repaired.length,1,'bookkeeping variations share one held player-action row');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);assert.equal(turn.receipts.filter(row=>row.kind==='clue').length,1);assert.equal(turn.world.clock.minutes,1);
 assert.equal(mapTitle(table.workspace),'Office hours: nine to noon.','the held reveal lands once with its corrected batch');
});

test('invalid NPC bookkeeping never becomes a refused player action',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   // A schema-valid reunion still fails the canonical return-encounter precondition.
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',{effects:[{kind:'npc',name:'Steven Knott',reunion:{background:[],reports:[]}}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([rawToolCall('apply',{effects:[{kind:'npc',name:'Steven Knott',stance:'warm'}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'});}
  ]});t.after(()=>table.dispose());await table.session.prompt('I greet Knott and ask him about the office.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,3);
 assert.equal(batches.filter(row=>['continuous-action-admission','held-act-outcome'].includes(row.family)).length,0);
 assert.ok(table.session.messages.some(row=>row.role==='toolResult'&&row.details?.coc_error?.details?.reason==='npc_reunion_not_due'));
 assert.ok(table.telemetry().some(row=>row.lane==='held-operation'&&row.event==='argument_outside_player_scope'),JSON.stringify(table.session.messages.filter(row=>row.role==='toolResult').map(row=>({name:row.toolName,details:row.details,content:row.content})).slice(-4)));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('an event-only model packet cannot reach the author or create an occurrence',async t=>{
   const engine=createHybridEngine({env,decision:null});
   const event={name:'Read the notice',materials:[{name:'notice',text:'The office closes at noon.',kind:'fact',visibility:'player'}]};
   const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
    extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([fauxToolCall('output',{...brief,event})],{stopReason:'toolUse'})]});
   t.after(()=>table.dispose());await table.session.prompt('I read the posted notice.');
   assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,0);
   const client=new RpcClient(table.workspace);try{const status=await client.ok('table.status',{campaign:'test-camp'});assert.equal(status.receipts.filter(row=>row.kind==='event').length,0);}finally{await client.close();}
  });

test('native schema rejects extra movement fields before admission and permits one corrected Keeper-judged submission (§249)',async t=>{
 const batches=[];let requests=0;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[{...movement,note:'Unrecognized metadata'}]})],{stopReason:'toolUse'});},
   ()=>{requests++;return fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement]})],{stopReason:'toolUse'});}
  ]});
 t.after(()=>table.dispose());await table.session.prompt('I walk along the street to the Central Library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 assert.equal(consent(batches).length,0,'§249: movement is not put to the consent review');
 assert.deepEqual(keeperJudged(table),[{kinds:['move'],jev_calls:0}],'invalid syntax never reaches admission; the corrected move does once');
 assert.equal(table.telemetry().filter(r=>r.lane==='isolated-expression'&&r.event==='written').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(r=>r.kind==='move').length,1);
});

// §249: 'refusing-reviewer' was a reviewer refusal of the move; the single Keeper now judges it and no reviewer is asked.
for(const mode of ['accepted','refusing-reviewer','dialogue','sparse-dialogue','wrapped-dialogue','unknown-dialogue','offer-dialogue','planned','activity'])test('native packet settlement and publication: '+mode,async t=>{
 const batches=[];let requests=0,submittedSchema;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,mode==='refusing-reviewer'?.01:.99);}}});
 const packet={...brief,commands:mode==='activity'?[{kind:'time',band:'brief_activity',reason:'arrange notes'}]:mode.endsWith('dialogue')||mode==='planned'?[]:[movement]};
 if(mode==='sparse-dialogue'||mode==='wrapped-dialogue'||mode==='unknown-dialogue'||mode==='offer-dialogue')packet.interactions=[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{new:{predicate:'planned_visit',actor:'npc_1',to:'pending-place',when:{day_offset:0,hour:12,minute:0}}}]}];
 if(mode==='offer-dialogue')packet.interactions[0].act='offer';
 if(mode==='unknown-dialogue')packet.interactions[0].actor='npc_999999';
 if(mode==='wrapped-dialogue')packet.interactions[0].content={item:packet.interactions[0].content};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
   extraExtensions:[{name:'engine',factory:engine.extension}],responses:[context=>{requests++;const output=getCurrentTools(context.messages).find(tool=>tool.name==='output');assert.equal(getCurrentTools(context.messages).some(tool=>tool.name==='apply'),true);assert.equal(getCurrentTools(context.messages).some(tool=>tool.name==='resolve'),true);submittedSchema=output;return fauxAssistantMessage([{type:'text',text:'Private planning preamble.'},fauxToolCall('output',packet)],{stopReason:'toolUse'});}]});
 t.after(()=>table.dispose());
 if(packet.interactions.length){
  const capsule=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
  if(mode==='unknown-dialogue'){
   const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
   packet.interactions[0].actor=Object.values(world.npc_references.by_node).find(ref=>!capsule.present.some(row=>row.ref===ref));
   assert.ok(packet.interactions[0].actor,'the forged reference must exist but remain unissued');
  }else {packet.interactions[0].actor=capsule.present.find(row=>row.name==='Steven Knott').ref;const content=packet.interactions[0].content.item??packet.interactions[0].content;content[0].new.actor=packet.interactions[0].actor;content[0].new.to=capsule.where.scene;}
 }
 await table.session.prompt(mode==='activity'?'I spend a few minutes arranging my notes.':mode==='refusing-reviewer'?'I stay at the desk. I do not leave.':mode.endsWith('dialogue')?'I ask Knott when he can meet.':mode==='planned'?'I might go to the library later.':'I walk along the street to the Central Library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,1);assert.equal(submittedSchema.parameters.additionalProperties,false);assert.deepEqual(Object.keys(submittedSchema.parameters.properties),['version','commands','interactions','reveal','ooc','force','routine'],'the default Mod set includes Quick Settlement (§247.3); §256.1 adds the table note');
 const rows=table.telemetry(),writes=rows.filter(r=>r.lane==='turn-packet-prototype');
 assert.equal(rows.filter(r=>r.lane==='run'&&r.type==='step_start'&&r.kind==='infer').length,mode==='unknown-dialogue'?2:1,'count actual inference steps: '+JSON.stringify(rows.filter(r=>r.lane==='keeper-delivery'||r.lane==='tool').slice(-4)));
 assert.equal(consent(batches).length,0,'§249: no line of a native packet is put to the consent review');
 assert.deepEqual(keeperJudged(table),mode==='activity'?[{kinds:['time'],jev_calls:0}]:['accepted','refusing-reviewer'].includes(mode)?[{kinds:['move'],jev_calls:0}]:[]);
 assert.equal(batches.filter(b=>b.family==='held-act-outcome').length,0,'no extra publication judge is introduced');
 assert.equal(batches.filter(b=>b.family==='continuous-turn').length,0,'candidate preparation does not add a speculative semantic decision');
 assert.equal(rows.filter(r=>r.lane==='isolated-expression'&&r.event==='written').length,mode==='unknown-dialogue'?0:1,'the author must actually complete');
 assert.equal(table.entries('coc-final-delivery').filter(r=>r.event==='end'&&r.status==='completed').length,mode==='unknown-dialogue'?0:1,'one completed public delivery');
 const authors=rows.filter(r=>r.lane==='isolated-expression'&&r.event==='start');
 assert.equal(authors.length,mode==='unknown-dialogue'?0:1,JSON.stringify(rows.slice(-8)));
 if(mode==='accepted'){
   assert.equal(writes.length,1);assert.equal(writes[0].ok,true);
   const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
   assert.equal(turn.receipts.filter(r=>r.kind==='move').length,1);
   const task=JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8'));
   assert.equal(task.scene,undefined);assert.equal(task.narrative_content,undefined);assert.ok(task.decision_context.scene.name);assert.ok(task.decision_context.clock.day_part);assert.deepEqual(task.decision_context.recent_public,[]);assert.equal(task.decision_context.scene.public_material,undefined);
   assert.equal(task.result.outcomes[0].kind,'move');
   assert.equal(task.result.outcomes[0].status,'changed');
   assert.equal(task.result.outcomes[0].to,task.decision_context.scene.name);
   assert.equal(task.result.outcomes[0].minutes,turn.receipts.find(r=>r.kind==='move').minutes);
   const current=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
   assert.equal(task.decision_context.scene.description,current.public_scene.description??current.first_sight?.place?.described,'current native scenery reaches the actual author task');
   assert.deepEqual(task.decision_context.style.axes,current.style.axes,'the authored style axes survive the native output owner');
   assert.deepEqual(task.decision_context.style.floor,current.style.floor);
   assert.equal(task.decision_context.style.language,current.style.language);
   assert.ok(task.decision_context.style.directives.length,'turn-specific style selection survives without comparison to the next turn');
   assert.equal(task.result.player_actions_complete,true);assert.equal(task.settled_actions,undefined,'proposals are not reconstructed as committed results');
 }
 if(mode==='sparse-dialogue'||mode==='wrapped-dialogue'||mode==='offer-dialogue'){const task=JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8'));assert.equal(task.npc_turns,undefined);assert.equal(task.decision_context.responses[0].mode,'speech_only');assert.equal(task.decision_context.responses[0].say_as,`{{say:${packet.interactions[0].actor}}}…{{/say}}`);if(mode==='offer-dialogue')assert.equal(task.decision_context.responses[0].player_acceptance,'pending');assert.equal(task.decision_context.responses[0].claims[0].value.predicate,'planned_visit');assert.equal(task.decision_context.responses[0].claims[0].value.when.hour,12);assert.equal(task.decision_context.people[0].ref,packet.interactions[0].actor);assert.equal(typeof task.decision_context.people[0].name_known,'boolean');assert.equal(task.decision_context.people[0].name,task.decision_context.people[0].display_name);assert.equal(task.decision_context.people[0].knowledge,undefined);assert.equal(task.decision_context.people[0].keeper_note,undefined);}
 if(mode==='unknown-dialogue')assert.equal(writes.length,0,'unknown speaker cannot execute a write or start the author');
 if(mode==='refusing-reviewer'){
   // §249.1/§249.3: the Keeper's proposal is its judgment that the player selected the line; kernel validation still applies.
   const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
   assert.equal(turn.receipts.filter(r=>r.kind==='move').length,1,'the judged move lands without asking the reviewer that would refuse it');
   assert.equal(JSON.parse(readFileSync(join(authors[0].attempt,'task.json'),'utf8')).result.outcomes[0].kind,'move');
 }
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

test('array dialect decoding preserves selected reference objects and rejects prose',()=>{
   const reply={actor:'npc_1',to:['investigator_1'],act:'answer',content:{item:{fact_ref:'fact_1'}}};
   const packet={version:4,interactions:{item:reply}};
   const result=normalizeTurnPacketArguments(packet);assert.ok(result.repairs>=1);
   assert.deepEqual(turnPacket(JSON.stringify(result.args)).interactions[0].content,[{fact_ref:'fact_1'}]);
   assert.throws(()=>turnPacket(JSON.stringify({...brief,interactions:[{...reply,content:[{fact_ref:'fact_1',text:'Complete dialogue.'}]}]})));
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
 await client.tableErr('apply',{call_id:'t1-c1',effects:[movement,{kind:'npc',name:'Steven Knott',to:'  '}]});
 const after=await client.table('capsule');assert.deepEqual(after.where,before.where);
});

test('partial NPC results cannot be reinterpreted as a complete decision',async t=>{
 const client=await kernel(t);await openTurn(client);
 const result=await client.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'Central Library'},{kind:'npc',name:'Unregistered Stranger',to:'Central Library'}]});
 assert.equal(result.outcomes[0].status,'changed');assert.ok(result.not_landed.length);
 assert.throws(()=>turnPacketResult(result),/Part of the operation did not land/);
});

// §250.1 removed the moving/stationary split, so time beside a move is always additional; the band here is simply unissued.
test('an unissued time band beside a journey is rejected locally and the repaired journey settles once as Keeper-judged (§249, §250)',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement,{kind:'time',band:'invented',reason:'the same journey'}]})],{stopReason:'toolUse'}),
   fauxAssistantMessage([fauxToolCall('output',{...brief,commands:[movement]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the Central Library.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(consent(batches).length,0,'§249: movement is not put to the consent review');
 assert.deepEqual(keeperJudged(table),[{kinds:['move'],jev_calls:0}],'the rejected packet never reaches admission');
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
 // A walk_on under the investigator's own name is a contradiction the kernel refuses after the move is staged (a book
 // person's name now seats that person, §270.4, so it no longer serves).
 const bad={...brief,commands:[movement,{kind:'walk_on',slot:'new_1',label:'Thomas Hayes',reason:'He lingers at the desk.'},{kind:'scene',service:'closed',crowd:'quiet'}]};
 // The unrelated packet stays in the unassessed office, so it carries that scene's own assessment.
 const second=mode==='repeat'?bad:mode==='unrelated'?{...brief,commands:[{kind:'scene',service:'open',crowd:'quiet'}]}:{...brief,commands:[movement,{kind:'scene',service:'closed',crowd:'empty'}]};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[bad,second,{...brief,commands:[movement,{kind:'scene',service:'closed',crowd:'empty'}]}].map(args=>()=>{
   requests++;return fauxAssistantMessage([rawToolCall('output',args)],{stopReason:'toolUse'});
  })});t.after(()=>table.dispose());await table.session.prompt('I leave the office and walk to Central Library now.');
 assert.deepEqual(table.extensionErrors,[]);assert.equal(requests,2);
 const errors=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='output'&&row.isError);
 assert.match(JSON.stringify(errors[0]),/no npc named/);
 assert.match(JSON.stringify(errors[0]),/before_commit/);
 assert.equal(consent(batches).length,0,'§249: movement is the Keeper\'s own judgment, never a consent request');
 assert.deepEqual(keeperJudged(table),Array(mode==='unrelated'?1:2).fill({kinds:['move'],jev_calls:0}),'each staged move attempt is admitted as judged');
 assert.equal(batches.filter(row=>row.family==='held-act-outcome').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 // §249.3: an unreviewed move leaves no held player action, so an unrelated corrected packet publishes as judged and moves nobody.
 const published=mode!=='repeat';
 assert.equal(turn.receipts.filter(row=>row.kind==='move').length,mode==='repair'?1:0);
 assert.equal(turn.receipts.filter(row=>row.kind==='scene').length,published?1:0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,published?1:0);
 assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,published?1:0);
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

test('reordered identical refused object operations reuse the native negative verdict',async t=>{
 const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.01);}}});
 // §249/§249.6: object lines are the Keeper's own judgment; a map reveal is still reviewed.
 const note=reveal('An unchosen note.'),reordered=Object.fromEntries(Object.entries(note).reverse());
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('apply',{effects:[note]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([rawToolCall('apply',{effects:[reordered]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I remain at the desk and ask what the clerk knows.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(consent(batches).map(batch=>batch.state.proposal.kinds),[['map']]);
 assert.ok(table.telemetry().some(row=>row.lane==='admission'&&row.reused&&row.verdict==='not_authorized'));
 assert.equal(mapTitle(table.workspace),undefined,'a reused negative verdict never becomes permission');
 const task=authorTask(table);
 assert.ok(task.decision_context.failed_attempts.length&&task.decision_context.failed_attempts.every(row=>row.reason==='action_not_authorized'),JSON.stringify(task.decision_context.failed_attempts));
 assert.ok(!JSON.stringify(task).includes('An unchosen note.'));
});

test('a stationary activity retires expired population material without blocking already settled output',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const assessed=async workspace=>{const client=new RpcClient(workspace);try{
  await client.ok('table.open',{campaign:'test-camp'});
  await client.ok('table.apply',{campaign:'test-camp',call_id:'t0-c1',effects:compileTurnPacket({...brief,commands:[{kind:'scene',service:'open',crowd:'quiet',review_after_minutes:1}]}).effects});
  await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c2',text:'Knott waits at his desk.'});
 }finally{await client.close();}};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:assessed,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([rawToolCall('output',{
   ...brief,commands:[{kind:'time',band:'quick_observation',reason:'Look at the selected office record while remaining here.'}]
  })],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I spend time reading the office records and remain at the desk.');
 assert.deepEqual(table.extensionErrors,[]);
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author);
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 assert.equal(task.decision_context.scene.temporal.current,false);
 assert.equal(task.decision_context.scene.temporal.crowd,undefined);
 assert.equal(task.result.outcomes.filter(row=>row.kind==='time').length,1);
 assert.equal(consent(batches).length,0,'§249: the activity time is the Keeper\'s own judgment');
 assert.deepEqual(keeperJudged(table),[{kinds:['time'],jev_calls:0}]);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('an unassessed scene publishes without a scene command and renders its population unknown (§250.6)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'time',minutes:3,reason:'The selected short wait.'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I wait here for three minutes.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error),[]);
 assert.ok(table.telemetry().some(row=>row.lane==='scene-population'&&row.event==='assessment_retired'&&row.reason==='unassessed'));
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');
 assert.equal(JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8')).decision_context.scene.presence.population,'unknown');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('an arrival into an empty-assessed scene settles in one call; the courier stays beside the empty assessment and no supplement is asked (§250.6, §264.30)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const prepare=async workspace=>{const k=new RpcClient(workspace);try{
  await k.ok('table.open',{campaign:'test-camp'});
  await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});
  await k.ok('table.player_input',{campaign:'test-camp',text:'I ask Knott to step out.'});
  await k.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'away',why:'Knott steps out when asked.'},
   ...compileTurnPacket({version:4,commands:[{kind:'scene',service:'open',crowd:'empty',review_after_minutes:30}]}).effects]});
  await k.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'Knott steps out; the office is empty.'});
 }finally{await k.close();}};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:prepare,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'walk_on',slot:'new_1',label:'a courier',reason:'A courier arrives with a parcel.'},{kind:'time',minutes:2,reason:'Wait the two minutes explicitly selected.'}]})],{stopReason:'toolUse'})
  ]});t.after(()=>table.dispose());
 await table.session.prompt('I wait here for two minutes.');
 assert.deepEqual(table.extensionErrors,[]);
 const errors=table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error);
 assert.deepEqual(errors,[]);
 assert.ok(table.telemetry().some(row=>row.lane==='scene-population'&&row.event==='assessment_retired'&&row.reason==='registered_people_stay'));
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(errors));
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 assert.equal(task.result.outcomes.filter(row=>row.kind==='time').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='npc').length,1);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);assert.equal(turn.receipts.filter(row=>row.kind==='scene').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('an empty assessment the registered presence contradicts before the packet is never refused; it stands (§266.17, §264.30)',async t=>{
 // Strangers on the Train (2026-10-24): an output with no scene command was refused `needs` and the turn delivered nothing.
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const prepare=async workspace=>{const k=new RpcClient(workspace);try{
  await k.ok('table.open',{campaign:'test-camp'});
  await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});
  await k.ok('table.player_input',{campaign:'test-camp',text:'I look around the office.'});
  await k.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:compileTurnPacket({version:4,commands:[{kind:'scene',service:'open',crowd:'empty',review_after_minutes:30}]}).effects});
  await k.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'The office is quiet.'});
 }finally{await k.close();}};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:prepare,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'time',minutes:2,reason:'Wait the two minutes explicitly selected.'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I wait here for two minutes.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error),[]);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='scene').length,0,'§264.30: the empty assessment stands beside the registered people');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('everyone leaving a populated scene needs no supplement: an unnamed crowd is not a contradiction (§250.6)',async t=>{
 let ref;const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const prepare=async workspace=>{const k=new RpcClient(workspace);try{
  await k.ok('table.open',{campaign:'test-camp'});
  await k.ok('table.apply',{campaign:'test-camp',call_id:'t0-c1',effects:compileTurnPacket({version:4,commands:[{kind:'scene',service:'open',crowd:'quiet',review_after_minutes:30}]}).effects});
  await k.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c2',text:'Knott waits at his desk.'});
 }finally{await k.close();}};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:prepare,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'npc',actor:ref,to:'away',reason:'Knott leaves when asked.'},{kind:'time',minutes:2,reason:'Wait the two minutes explicitly selected.'}]})],{stopReason:'toolUse'})
  ]});t.after(()=>table.dispose());
 ref=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(person=>person.name==='Steven Knott').ref;
 await table.session.prompt('I ask the visitor to leave and wait here for two minutes.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error),[]);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('a current investigator reference reaches ordinary resolve as its issued actor without creating a false held failure',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('resolve',{action:{actor:'investigator_1',intent:'investigate',skill:'Spot Hidden',goal:'Notice signs around the desk',method:'Look carefully at the desk'}})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'})
  ]});t.after(()=>table.dispose());await table.session.prompt('I examine the desk carefully for useful signs.');
 assert.deepEqual(table.extensionErrors,[]);
 assert.deepEqual(table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error),[]);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='roll').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('the single Keeper\'s resolve is its own judgment: a reviewer that would refuse is never asked (§249.4)',async t=>{
 const families=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{families.push(batch.family);return answer(batch,.01);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('resolve',{action:{actor:'investigator_1',intent:'investigate',skill:'Spot Hidden',goal:'Notice signs around the desk',method:'Look carefully at the desk'}})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'})
  ]});t.after(()=>table.dispose());await table.session.prompt('I examine the desk carefully for useful signs.');
 assert.deepEqual(table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error),[]);
 assert.equal(families.filter(family=>family==='continuous-action-admission').length,0);
 assert.ok(table.telemetry().some(row=>row.lane==='admission'&&row.verb==='resolve'&&row.path==='keeper_judged'&&row.kinds?.includes('resolve')&&row.jev_calls===0));
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='roll').length,1);
});

test('a failed meeting check is no player act: the turn still publishes (§249.4, live el-v2-20261021c T6, T14)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('resolve',{action:{actor:'investigator_1',intent:'social',decision:'natural-npc:first-impression',target:'Nobody who is here',goal:'A first impression',method:'Meeting them'}})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',brief)],{stopReason:'toolUse'})
  ]});t.after(()=>table.dispose());
 const capsule=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
 assert.ok((capsule.mods?.pending_contacts??[]).some(row=>row.decision==='natural-npc:first-impression'),'the fixture offers the meeting check');
 await table.session.prompt('I greet Knott.');
 const errors=table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error);
 assert.equal(errors.length,1,JSON.stringify(errors));assert.equal(errors[0].code,'unknown_entity');
 assert.ok(table.telemetry().some(row=>row.lane==='held-operation'&&row.event==='non_player_operation_failed'));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1,'the prose is not held for the failed check');
});

test('an unissued investigator reference remains refused without a roll or publication',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('resolve',{action:{actor:'investigator_999',intent:'investigate',skill:'Spot Hidden',goal:'Notice signs around the desk',method:'Look carefully at the desk'}})],{stopReason:'toolUse'})
  ]});t.after(()=>table.dispose());await table.session.prompt('I examine the desk carefully for useful signs.');
 const errors=table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error);
 assert.ok(errors.some(row=>row.code==='unknown_entity'),JSON.stringify(errors));
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='roll').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,0);
});

test('distinct native parameter corrections reach one valid settlement without accepting the malformed attempts',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const commands=[{kind:'time',band:'several minutes',reason:'Look around the office.'},{kind:'time',band:'quick_observation',reason:'Look around the office.',unused:true},{kind:'time',band:'quick_observation',reason:'Look around the office.'}];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:commands.map(command=>()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{...brief,commands:[command,{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 assert.equal(requests,3);assert.equal(batches.length,0,'§249: the corrected wait is not put to the consent review');
 assert.deepEqual(keeperJudged(table),[{kinds:['time'],jev_calls:0}],'only the valid packet reaches admission: '+JSON.stringify(table.session.messages.filter(row=>row.role==='toolResult'&&row.isError).map(row=>row.details??row.content)));
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('a third new parameter finding can be corrected before one actual settlement',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const commands=[{kind:'time',band:'several minutes',reason:'Look around the office.'},{kind:'time',band:'quick_observation',reason:'Look around the office.',unused:true},{kind:'time',band:'quick_observation',minutes:1,reason:'Look around the office.'},{kind:'time',band:'quick_observation',reason:'Look around the office.'}];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:commands.map(command=>()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{...brief,commands:[command,{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 assert.equal(requests,4);assert.equal(batches.length,0,'§249: the corrected wait is not put to the consent review');
 assert.deepEqual(keeperJudged(table),[{kinds:['time'],jev_calls:0}],'none of the three malformed packets reaches admission');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('eight distinct native parameter failures stay uncommitted, stop the run and reset on new player input',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,.99);}}});
 const time={kind:'time',band:'quick_observation',reason:'Look around the office.'};
 const packets=[{commands:[{...time,band:'several minutes'}]},{commands:[{...time,unused:true}]},{commands:[{...time,minutes:1}]},
  {commands:[{kind:'time',minutes:-1,reason:time.reason}]},{commands:[{kind:'time',band:time.band}]},{commands:[{...time,reason:17}]},
  {commands:[{kind:'scene',service:'open',crowd:'many'}]},{reveal:'not an array'},
  {commands:[time,{kind:'scene',service:'open',crowd:'quiet'}]}];
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:packets.map(packet=>()=>{requests++;return fauxAssistantMessage([rawToolCall('output',{...brief,...packet})],{stopReason:'toolUse'});})});
 t.after(()=>table.dispose());await table.session.prompt('I look around the office without leaving.');
 assert.equal(requests,8);assert.equal(batches.length,0);assert.deepEqual(keeperJudged(table),[],'no malformed packet reaches admission');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.receipts.filter(row=>row.kind==='time').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,0);
 const refused=table.telemetry().filter(row=>row.event==='packet_parameters_refused');
 assert.equal(refused.length,8);assert.equal(refused.at(-1).retry,false);assert.equal(refused.at(-1).limit,8);
 assert(table.telemetry().some(row=>row.event==='input_ended'&&row.cause==='parameter_protocol_budget'));
 await table.session.prompt('I still want to look around the office without leaving.');
 assert.equal(requests,9);assert.equal(batches.length,0,'§249: the wait is not put to the consent review');
 assert.deepEqual(table.telemetry().filter(row=>row.lane==='admission'&&row.path==='keeper_judged').map(row=>({turn:row.turn,kinds:row.kinds,jev_calls:row.jev_calls})),[{turn:2,kinds:['time'],jev_calls:0}],'the reset input admits its valid packet');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed'&&row.turn===2).length,1);
});

test('each stop of a route carries its own population assessment, settled before the route leaves it (§250.12, live el-v2-20261021e T33)',()=>{
 const route={version:4,commands:[
  {kind:'place',action:'move',to:'Station Hotel',travel_band:'adjacent'},
  {kind:'walk_on',slot:'new_1',label:'the day clerk',reason:'The desk is staffed by day.'},
  {kind:'scene',service:'open',crowd:'quiet'},
  {kind:'place',action:'move',to:'corbitt-house-ground',via:'along the tram line',travel_band:'local_travel'},
  {kind:'walk_on',slot:'new_2',label:'a street sweeper',to:'corbitt-house-ground',reason:'Early sweeping.'},
  {kind:'scene',service:'closed',crowd:'quiet'},
  {kind:'place',action:'observe',to:'corbitt-house-ground',facts:['The gate stands open.']}]};
 const effects=compileTurnPacket(turnPacket(JSON.stringify(route))).effects.map(e=>e.kind==='scene'?`scene:${e.activity.crowd}`:e.kind==='npc'?`npc:${e.name}@${e.to}`:`${e.kind}:${e.action??''}:${e.to??''}`);
 assert.deepEqual(effects,['place:move:Station Hotel','npc:the day clerk@here','scene:quiet','place:move:corbitt-house-ground','place:observe:corbitt-house-ground','npc:a street sweeper@corbitt-house-ground','scene:quiet']);
 const twice={version:4,commands:[{kind:'place',action:'move',to:'Station Hotel',travel_band:'adjacent'},{kind:'scene',service:'open',crowd:'quiet'},{kind:'scene',service:'open',crowd:'empty'}]};
 assert.throws(()=>turnPacket(JSON.stringify(twice)),/Two scene commands assess the same place/,'two assessments of one stop are still a duplicate');
 const one={version:4,commands:[{kind:'walk_on',slot:'new_1',label:'the clerk',reason:'Staffed.'},{kind:'scene',service:'open',crowd:'quiet'},{kind:'place',action:'observe',facts:['A counter.'],people:['new_1']}]};
 assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify(one))).effects.map(e=>e.kind),['npc','place','scene'],'a single stop still settles its assessment last');
});

test('a command written as a field of its own beside commands is that command, after the others (§250.4, live el-v2-20261021g T32)',()=>{
 const observe={kind:'place',action:'observe',to:'here',at:'front door',facts:['The brass around the keyhole shines.']};
 const raw={version:4,commands:[{kind:'place',action:'move',to:'Corbitt House',via:'By cab',travel_band:'local_travel'}],item:observe};
 const normalized=normalizeTurnPacketArguments(raw);
 assert.equal(normalized.strayCommandRepairs,1);assert.equal(normalized.args.item,undefined);
 assert.deepEqual(normalized.args.commands.map(row=>row.action),['move','observe']);
 assert.doesNotThrow(()=>turnPacket(JSON.stringify(normalized.args)));
 assert.deepEqual(normalizeTurnPacketArguments({version:4,extra:[observe,{...observe,facts:['Two.']}]}).args.commands.length,2,'a list of commands moves too');
 for(const value of [{note:'not a command'},{kind:'invented'},[observe,{kind:'invented'}],'text']){
  const kept=normalizeTurnPacketArguments({version:4,commands:[],extra:value});
  assert.equal(kept.strayCommandRepairs,undefined,JSON.stringify(value));assert.deepEqual(kept.args.extra,value);
 }
});

test('an ordinary turn settles its finding, a mood and a name in one output packet, with no apply call (§267.1)',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch,.99)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([rawToolCall('output',{version:4,commands:[{kind:'mood',actor:'npc_1',mood:'wary but willing'},{kind:'name',actor:'npc_1',name:'the man behind the desk'},
    {kind:'clue',clue:'knott-commission',how:'Knott lays the contract on the desk',from:'npc_1'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I ask Knott what he wants of me.');
 assert.deepEqual(table.extensionErrors,[]);
 const errors=table.session.messages.filter(row=>row.role==='toolResult'&&row.details?.coc_error).map(row=>row.details.coc_error);
 assert.deepEqual(errors,[]);
 assert.equal(table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply').length,0,'no apply call of the Keeper');
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.ok(turn.receipts.some(row=>row.kind==='clue'&&row.clue==='knott-commission'),JSON.stringify(turn.receipts.map(row=>row.kind)));
 assert.ok(turn.receipts.some(row=>row.kind==='npc'&&row.mood),JSON.stringify(turn.receipts.map(row=>row.kind)));
 assert.ok(turn.receipts.some(row=>row.kind==='person'),JSON.stringify(turn.receipts.map(row=>row.kind)));
});
