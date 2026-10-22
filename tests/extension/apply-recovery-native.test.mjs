import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
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
const keeperJudged=table=>table.telemetry().filter(row=>row.lane==='admission'&&row.path==='keeper_judged').map(row=>({kinds:row.kinds,jev_calls:row.jev_calls}));
// §249/§249.6: the single Keeper judges move, place, time, cash, item and object lines itself, document writes included; a map
// reveal is still reviewed.
const MAP='player-corbitt-house-map';
const reveal=label=>({kind:'map',name:MAP,regions:['ground-entry-hall'],region_labels:{'ground-entry-hall':'Entry hall'},
 level_labels:{'Ground Floor':'Ground floor'},label,why:'Knott spreads the house plan on the desk.'});
const mapTitle=workspace=>JSON.parse(readFileSync(join(workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).map_labels?.[MAP]?.title;
test('a corrected unknown owner does not poison the actual committed handover at native publication',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 const effects=[{kind:'object',name:'Test notebook',to:'Steven Knott',from:'npc_1',handover:'given',why:'Hayes hands over his notebook.'}];
 const corrected=effects.map(effect=>({...effect,from:'Thomas Hayes'}));
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:async workspace=>{
  const c=new RpcClient(workspace);try{
   await c.ok('table.open',{campaign:'test-camp'});
   const job=await c.ok('mods.job',{campaign:'test-camp',role:'create',input:{name:'Notebook',category:'item',description:'A plain paper notebook.'}});
   writeFileSync(join(job.cwd,'result.json'),JSON.stringify({name:'Notebook',category:'item',description:'A plain paper notebook.',basis:'Present in this controlled component fixture.',parameters:{charges:null,effects:[]},player_view:{description:'A paper notebook.',fields:[]}}));
   const accepted=await c.ok('mods.accept',{campaign:'test-camp',job:job.job});
   await c.ok('table.apply',{campaign:'test-camp',call_id:'t0-c1',effects:[
    {kind:'define',name:'Notebook',category:'item',_definition:accepted.definition,_provenance:accepted.provenance},{kind:'object',name:'Test notebook',definition:'Notebook',to:'Thomas Hayes'}]});
   await c.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c2',text:'Knott waits at his desk. Hayes holds a paper notebook.'});
  }finally{await c.close();}
 },env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
  ()=>fauxAssistantMessage([fauxToolCall('apply',{effects})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:corrected})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I give my notebook to Knott.');
 const calls=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply');
 assert.equal(calls[0].details.coc_error.code,'unknown_entity',JSON.stringify(calls[0]));assert.notEqual(calls[1].isError,true,JSON.stringify(calls[1]));
 const published=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='output');
 assert.notEqual(published?.isError,true,'a fully committed corrected handover must reach the sole native author: '+JSON.stringify(published?.details));
 const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(record.receipts.filter(row=>row.kind==='item').length,1,'the rejected transaction does not transfer a second item');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 assert.deepEqual(table.extensionErrors,[]);
});
// §249: the owed departure is a move, so the single Keeper's recovery of it is its own judgment, not a consent review.
test('the active single-Keeper path settles a prior declared departure as its own judgment before this turn communication once',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,(batch.state.line_contexts?.[0]?.current_player_words??batch.state.current_player_words)===original?.99:.01);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:owedWorkspace,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[move]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',output)],{stopReason:'toolUse'})]});t.after(()=>table.dispose());
 await table.session.prompt('I introduce myself at the counter, without ordering.');
 assert.deepEqual(table.extensionErrors,[]);
 const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(record.receipts.filter(x=>x.kind==='move').length,1,'the declared journey must settle before this intent counts as complete');
 const consent=batches.filter(x=>x.family==='continuous-action-admission');assert.equal(consent.length,0,JSON.stringify(table.session.messages.filter(x=>x.role==='toolResult').map(x=>({tool:x.toolName,error:x.details?.coc_error,body:x.isError?x.content:undefined}))));
 assert.deepEqual(keeperJudged(table),[{kinds:['move'],jev_calls:0}]);
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

test('a refused atomic reviewed-line and move batch does not suppress a later committed move in a native decision',async t=>{
 const batches=[];const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,batch.family==='continuous-action-admission'&&batch.state.proposal.kinds.includes('map')?.01:.99);}}});
 const destination={kind:'move',to:'central-library',travel_band:'local_travel'};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:async workspace=>{
  process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',CONTENT_DIR]);const c=new RpcClient(workspace);try{await c.ok('table.open',{campaign:'test-camp'});await c.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at the office.'});}finally{await c.close();}
 },env,runDriver:engine.runDriver,extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
  // The unchosen map reveal is the reviewed line; the Keeper-judged move falls with it in the atomic batch.
  ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[reveal('An unchosen note.'),destination]})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[destination]})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'},{kind:'walk_on',slot:'new_1',label:'The reference clerk',reason:'A staffed reference desk during service hours.'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I leave the office and go to Central Library, stopping by the reference desk.');
 const calls=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply');assert.equal(calls[0].isError,true);assert.notEqual(calls[1].isError,true,JSON.stringify(calls[1]));
 const published=table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='output');assert.notEqual(published?.isError,true,JSON.stringify({published,errors:table.extensionErrors,telemetry:table.telemetry().slice(-12)}));
 const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(record.receipts.filter(row=>row.kind==='move').length,1);assert.equal(mapTitle(table.workspace),undefined,'the refused reveal never lands');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 const author=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author);
 const task=JSON.parse(readFileSync(join(author.attempt,'task.json'),'utf8'));
 assert.deepEqual(task.decision_context.failed_attempts,[{tool:'apply',status:'uncommitted',reason:'action_not_authorized'}]);
 assert.ok(task.result.outcomes.some(row=>row.kind==='move'&&row.status==='changed'));assert.equal(task.result.outcomes.filter(row=>row.kind==='move').length,1);
 assert.ok(!batches.some(row=>row.family==='held-act-outcome'),'native state projection needs no prose judgment');assert.deepEqual(table.extensionErrors,[]);
});

// Controlled RPC component: a read-only preview refusal remains evidence, never settlement.
test('a precommit cash preview refusal permits actual split service receipts to reach the sole author',async t=>{
 const batches=[],engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch);}}});
 const cash={kind:'cash',mode:'settle',subject:'Thomas Hayes',with:'Steven Knott',category:'living',source:'quote',items:[{name:'Coffee',quantity:1,unit_price:.25}]};
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
  prepareWorkspace:async workspace=>{const c=new RpcClient(workspace);try{await c.ok('table.open',{campaign:'test-camp'});await c.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott has offered coffee.'});}finally{await c.close();}},
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',band:'brief_activity',why:'Drink the selected coffee.'},cash]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'item',name:'Coffee',from:'Steven Knott',quantity:1,why:'Knott serves the selected coffee.'},{kind:'item',name:'Coffee',quantity:-1,why:'Hayes drinks the coffee.'},{kind:'time',minutes:2,why:'Drink the coffee.'}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[cash]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',{...output,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I accept the coffee, drink it, then pay no more than one dollar.');
 const calls=table.session.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply');
 assert.equal(calls[0].details?.coc_error?.details?.reason,'preview_clock_unknown');
 assert(calls.slice(1).every(row=>!row.isError),JSON.stringify(calls.map(row=>row.details)));
 const author=table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='written');assert.equal(author.length,1,'actual successful service receipts must reach the native author: '+JSON.stringify({output:table.session.messages.findLast(row=>row.role==='toolResult'&&row.toolName==='output'),last:table.telemetry().slice(-8),errors:table.extensionErrors}));
 const task=JSON.parse(readFileSync(join(author[0].attempt,'task.json'),'utf8'));
 assert(task.decision_context.failed_attempts.some(row=>row.reason==='preview_clock_unknown'),'the original failed preview is retained as uncommitted');
 assert.equal(task.result.outcomes.filter(row=>row.kind==='item').length,2);
 assert(task.result.outcomes.some(row=>row.kind==='cash'&&row.status==='changed'));
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
 assert(!batches.some(row=>row.family==='held-act-outcome'),'known precommit failure needs no new semantic judge');
});

test('known cash preflight refusals never classify an unknown or partial failure as uncommitted',async()=>{
 const {HeldActOutcome}=await import('../../runtime/jev/held-act-outcome.ts');
 const scope={campaign:'c',turn:1,playerText:'I eat then pay.'};
 for(const cause of ['preview_clock_unknown','chosen_covered_quote']){
  const boundary=new HeldActOutcome();boundary.hold(scope,{tool:'apply',lines:['The cash preflight did not execute.'],cause},true);
  assert.deepEqual(boundary.uncommittedFailures(),[{tool:'apply',status:'uncommitted',reason:cause}]);
  boundary.hold(scope,{tool:'apply',lines:['Unknown execution state.'],cause:'unknown_partial_write'},true);
  assert.equal(boundary.uncommittedFailures(),undefined);
 }
});
