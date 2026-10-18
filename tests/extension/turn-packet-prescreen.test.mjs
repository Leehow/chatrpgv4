/** Real Pi/kernel component seams; controlled Jev and author, not gameplay. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall as rawToolCall,getCurrentTools} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {ContinuousTurn} from '../../runtime/jev/continuous-turn.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_PACKET_PRESCREEN:'1',
 PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
 PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
// Controlled semantic answers explicitly assess the fixture scene; they are not gameplay.
const fauxToolCall=(name,args)=>rawToolCall(name,name==='output'?{...args,commands:[...args.commands,{kind:'scene',service:'open',crowd:'empty'}]}:args);
async function opened(workspace,assessed=true){const client=new RpcClient(workspace);try{
 await client.ok('table.open',{campaign:'test-camp'});
 await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
 await client.ok('table.player_input',{campaign:'test-camp',text:'I accept the commission and ask for the public research leads.'});
 await client.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[
  ...(assessed?[{kind:'scene',name:'central-library',activity:{summary:'The library fixture is quiet and empty before this visit.',basis:'established',service:'open',crowd:'empty',review_after_minutes:60},why:'The controlled fixture has already assessed this destination.'}]:[]),{kind:'flag',name:'knott-commission-accepted',value:true},{kind:'clue',clue:'knott-research-leads',from:'Steven Knott'}]});
 await client.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'Knott has named the public research destinations. The Central Library has a red doorway, two blocks west.'});
}finally{await client.close();}}
function answer(batch,scope='travel_only',selection=.99,veto=.01){
 const candidates=batch.state.proposal?.lines??[];
 const answers=Object.fromEntries(batch.questions.map(q=>{
  const index=Number(q.key.split('_').at(-1));
  const chosen=['Central Library','central-library'].includes(candidates[index]?.to);
  if(q.type==='noul')return[q.key,{status:'answered',type:'noul',noul:q.key==='additional_work'?(scope==='travel_only'?.01:.99):q.key.startsWith('restriction_')?veto:chosen?selection:.01}];
  const choice=q.key==='reply_scope'?scope:q.key.startsWith('need_')?(chosen?'now':'later'):Object.keys(q.criteria)[0];
  return[q.key,{status:'answered',type:'choice',choice,confidence:.99,
   probabilities:Object.fromEntries(Object.keys(q.criteria).map(key=>[key,key===choice?.99:.01/(Object.keys(q.criteria).length-1)]))}];
 }));
 return{batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};
}
test('a ready routine journey publishes actual movement without Keeper inference or a second Jev request',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);const result=answer(batch);result.answers.additional_work.noul=.21;return result;}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{version:3,commands:[{kind:'move',to:'Central Library'}],responses:[]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the Central Library.');
 assert.equal(requests,0,JSON.stringify({batches,events:table.telemetry().filter(x=>['continuous-turn','keeper-delivery'].includes(x.lane))}));
 assert.equal(batches.length,1,'prescreen must replace post-proposal consent, not precede it');
 assert.ok(batches[0].state.previous_public.some(row=>row.keeper?.includes('red doorway, two blocks west.')),
  'the same committed NPC directions must reach consent, not only the final author');
 assert.equal(table.entries('coc-final-delivery').filter(x=>x.event==='end'&&x.status==='completed').length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(x=>x.kind==='move').length,1);
 const writer=table.telemetry().find(x=>x.lane==='isolated-expression'&&x.event==='written');
 const task=JSON.parse(readFileSync(join(writer.attempt,'task.json'),'utf8'));
 assert.equal(task.result.outcomes.filter(x=>x.kind==='move'&&x.status==='changed').length,1);
 assert.deepEqual(table.session.getActiveToolNames().sort(),['look','lookup','recall','resolve','apply','ask','output'].sort(),'routine travel skips inference while the complete chapter retains production rules');
 assert.deepEqual(table.extensionErrors,[]);
});

test('an unassessed arrival uses one existing Keeper decision without another consent batch',async t=>{
 let requests=0;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:workspace=>opened(workspace,false),env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{version:3,commands:[],responses:[]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the Central Library.');
 assert.equal(requests,1);assert.equal(batches.length,1);
 assert.equal(table.telemetry().filter(row=>row.lane==='continuous-turn'&&row.event==='scene_population_required').length,1);
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

test('a restarted journey retains full delivered directions past 200 characters and later stranded inputs',async t=>{
 let requests=0;const batches=[];
 const marker='The red doorway two blocks west belongs to the Central Library.';
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
  prepareWorkspace:async workspace=>{
   await opened(workspace);const client=new RpcClient(workspace);
   try{
    await client.ok('table.player_input',{campaign:'test-camp',text:'Which doorway is it?'});
    await client.ok('table.narrate',{campaign:'test-camp',call_id:'t2-c1',text:'Public conversation. '.repeat(30)+marker});
    for(const text of ['I go toward that doorway.','I continue toward that doorway.']){
     await client.ok('table.player_input',{campaign:'test-camp',text});
     await client.ok('table.release',{campaign:'test-camp',release:'stranded'});
    }
   }finally{await client.close();}
  },extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{version:3,commands:[],responses:[]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());await table.session.prompt('I go to that red doorway two blocks west.');
 assert.equal(batches.length,1);assert.equal(requests,0);
 const previous=batches[0].state.previous_public;
 assert.ok(previous.some(row=>row.turn===2&&row.player==='Which doorway is it?'&&row.keeper.endsWith(marker)));
 assert.equal(previous.some(row=>row.turn===3||row.turn===4),false,'unpublished retries never replace the delivered reference');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});

for(const work of [.5,.99])test('remaining-work probability '+work+' preserves movement and asks the Keeper only for responses',async t=>{
 let requests=0;let actorRef;const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);const result=answer(batch,'travel_then_dialogue');result.answers.additional_work.noul=work;return result;}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[context=>{requests++;
   assert.ok(JSON.stringify(context.messages).includes('host_operations'));
   assert.ok(getCurrentTools(context.messages).some(x=>x.name==='apply'));
   assert.ok(getCurrentTools(context.messages).some(x=>x.name==='resolve'));
   return fauxAssistantMessage([fauxToolCall('output',{version:3,commands:[],responses:[
    {actor:actorRef,act:'answer',points:['The meeting is at noon.']} ]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());actorRef=(await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'})).present.find(row=>row.name==='Steven Knott').ref;await table.session.prompt('I walk to the library, then ask Knott over the telephone when we can meet.');
 assert.equal(requests,1);assert.equal(batches.length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(x=>x.kind==='move').length,1);
 const writer=table.telemetry().find(x=>x.lane==='isolated-expression'&&x.event==='written');
 const task=JSON.parse(readFileSync(join(writer.attempt,'task.json'),'utf8'));
 assert.equal(task.result.outcomes.filter(x=>x.kind==='move').length,1);
 assert.equal(task.decision_context.responses[0].claims[0],'The meeting is at noon.');
});

for(const field of ['task_world_revision','task_source_revision'])test('changed '+field+' invalidates prescreen execution before mutation',async()=>{
 const context={campaign:'c',turn:1,worldline:'main',loop:0,world_revision:'w',task_world_revision:'tw',source_revision:'s',task_source_revision:'ts'};
 let mutations=0;
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',playerText:'I walk to the library.',campaign:'c',packet:true,current:()=>true,record:()=>{},
  call:async method=>method==='table.apply.options'?{candidates:[{effect:{kind:'move',to:'central-library'},description:{travel_minutes:3,display_name:'Central Library',unlock_when:{met:true}}}]}:{_context:{...context},where:{scene:'office'}},
  decision:{decide:async batch=>answer(batch)},dispatch:async(proposal,owner)=>{await owner.validateCurrent(proposal);mutations++;return{status:'succeeded'};}});
 const signal=new AbortController().signal;await turn.prepare(signal);await turn.decide(signal);
 assert.equal(turn.selected.length,1);context[field]+='changed';await turn.execute(signal,'step');
 assert.equal(mutations,0);assert.equal(turn.outcome.status,'refused');
});

test('cleared negative movement candidates are absent from the Keeper material',async()=>{
 const capsule={_context:{campaign:'c',turn:1,worldline:'main',loop:0,world_revision:'w',task_world_revision:'tw',source_revision:'s',task_source_revision:'ts'},where:{scene:'office'}};
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',playerText:'I walk to the library.',campaign:'c',packet:true,current:()=>true,record:()=>{},
  call:async method=>method==='table.apply.options'?{candidates:['central-library','hall-of-records'].map(to=>({effect:{kind:'move',to},description:{travel_minutes:3,display_name:to,unlock_when:{met:true}}}))}:capsule,
  decision:{decide:async batch=>answer(batch)},dispatch:async()=>{throw Error('This material check must not execute');}});
 const signal=new AbortController().signal;await turn.prepare(signal);await turn.decide(signal);
 const material=turn.materials(capsule);assert.equal(material.candidates.length,1);
 assert.equal(material.candidates[0].operation.effects[0].to,'central-library');
});

for(const mode of ['plan','condition','discussion','uncertain'])test('a '+mode+' is not executed and a wrong exact proposal reuses the same decision',async t=>{
 const batches=[];let requests=0;
 const selection=mode==='uncertain'?.5:mode==='condition'?.99:.01,veto=mode==='condition'?.99:.01;
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,'other',selection,veto);}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[()=>{requests++;return fauxAssistantMessage([
   fauxToolCall('output',{version:3,commands:[{kind:'move',to:'central-library'}],responses:[]})],{stopReason:'toolUse'});} ]});
 t.after(()=>table.dispose());
 const inputs={plan:'I will go to the library tomorrow.',condition:'I go to the library only if Knott first agrees; he has not answered.',
  discussion:'I ask whether we should go to the library; I am not leaving.',uncertain:'I go back there.'};
 await table.session.prompt(inputs[mode]);
 assert.equal(requests,1);assert.equal(batches.length,1,'an unchanged prescreen decision must not be judged again');
 assert.equal(table.telemetry().filter(x=>x.lane==='isolated-expression'&&x.event==='start').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(x=>x.event==='delta').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(x=>x.kind==='move').length,0);assert.equal(turn.world.clock.minutes,0);
});

test('a Keeper packet cannot replay a journey the host already settled',async t=>{
 const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);return answer(batch,'travel_then_dialogue');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[fauxAssistantMessage([
   fauxToolCall('output',{version:3,commands:[{kind:'move',to:'central-library'}],responses:[]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the library and ask for the opening hours.');
 assert.equal(batches.length,1);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(x=>x.kind==='move').length,1);
 assert.equal(table.telemetry().filter(x=>x.lane==='isolated-expression'&&x.event==='start').length,0);
});

test('a host journey blocked by a tool hook cannot start the author through an empty command packet',async t=>{
 const engine=createHybridEngine({env,decision:{decide:async batch=>answer(batch)}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension},{name:'block-host-move',factory(pi){
   pi.on('tool_call',event=>event.toolName==='apply'?{block:true,reason:'Fixture blocks the selected journey before execution.'}:undefined);
  }}],responses:[fauxAssistantMessage([fauxToolCall('output',{version:3,commands:[],responses:[
   {actor:'npc_1',act:'answer',points:['We have arrived at the library.']} ]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());await table.session.prompt('I walk to the library.');
 assert.equal(table.telemetry().filter(x=>x.lane==='isolated-expression'&&x.event==='start').length,0);
 assert.equal(table.entries('coc-final-delivery').filter(x=>x.event==='delta').length,0);
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
 assert.equal(turn.receipts.filter(x=>x.kind==='move').length,0);
});
