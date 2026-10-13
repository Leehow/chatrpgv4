// Confirmed acceptance seam: real Pi hooks, TS kernel, persistence and next-turn reads.
// Provider substitutes make author inputs observable; this is integration evidence, never live play.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,symlinkSync,writeFileSync,chmodSync,readFileSync} from 'node:fs';
import {KernelClient} from '../../extensions/kernel/client.ts';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';

const root=resolve(import.meta.dirname,'../..'),campaign='test-camp',npc='Steven Knott';
const emitted=mkdtempSync(join(tmpdir(),'pipicoc-turn-events-test-'));
symlinkSync(join(root,'node_modules'),join(emitted,'node_modules'),'dir');
const rpc=join(emitted,'rpc.mjs');
await build({entryPoints:[join(root,'kernel-ts/rpc.ts')],outfile:rpc,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const assembly=join(emitted,'assemble.mjs');
await build({entryPoints:[join(root,'kernel-ts/read/assemble.ts')],outfile:assembly,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const {fitPresent}=await import(assembly);
const semanticModule=join(emitted,'turn-events.mjs');
await build({entryPoints:[join(root,'kernel-ts/turn-events.ts')],outfile:semanticModule,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const {actorEventView}=await import(semanticModule);
const plan={version:1,materials:[{name:'cold room',text:'The room is cold.',kind:'description',visibility:'player',required:true}]};
const tool=(name,args)=>fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:'toolUse'});
function seedOpening(workspace){
  process.env.PI_COC_KERNEL_CMD=JSON.stringify([process.execPath,rpc,'--workspace',workspace,'--content',join(root,'content')]);
  const calls=[['table.open',{}],['table.narrate',{call_id:'t0-c1',text:'Steven Knott waits beside his desk in the office.'}]];
  const run=spawnSync(process.execPath,[rpc,'--workspace',workspace,'--content',join(root,'content')],{
    cwd:root,encoding:'utf8',input:calls.map(([method,params],id)=>JSON.stringify({id:String(id),method,params:{campaign,...params}})).join('\n')+'\n'});
  assert.equal(run.status,0,run.stderr);
  for(const line of run.stdout.trim().split('\n')){const frame=JSON.parse(line);if(!frame.progress)assert.equal(frame.ok,true,JSON.stringify(frame));}
}
const writerEnv={PI_COC_KERNEL_CMD:JSON.stringify([process.execPath,rpc]),PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/final-output-writer.mjs')])};
const errors=table=>table.session.messages.filter(m=>m.role==='toolResult'&&m.details?.coc_error).map(m=>m.details.coc_error);
const eventWriterEnv={...writerEnv,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/turn-event-writer.mjs')])};
const reconnect=workspace=>new KernelClient({command:[process.execPath,rpc,'--workspace',workspace,'--content',join(root,'content')],cwd:root,env:process.env});

for(const refusal of ['event','dependent effect'])test(`a refused ${refusal} leaves previously staged damage, healing state and receipts unchanged`,async t=>{
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv});t.after(()=>table.dispose());
  const bridge=table.runtimeBridges().at(-1);await bridge.call('table.player_input',{campaign,text:'I test the door carefully.'});
  const before=await bridge.call('table.look',{campaign,focus:'investigator'});
  const effects=[{kind:'damage',dice:'1D1',subject:'Thomas Hayes',why:'A sharp edge.'}];
  if(refusal==='dependent effect')effects.push({kind:'move',to:'unregistered destination',via:'An unknown route.'});
  await assert.rejects(bridge.call('table.apply',{campaign,call_id:'t1-c1',effects,event:refusal==='event'?{name:'invalid event',knowledge:[{actor:'unregistered person',statement:'A claim.',mode:'observed',state:'accurate'}]}:{name:'failed batch',summary:'The edge causes a wound.'}}));
  const after=await bridge.call('table.look',{campaign,focus:'investigator'});
  assert.deepEqual(after,before,'no HP or condition persists from a refused dependent batch');
  const status=await bridge.call('table.status',{campaign});assert.equal(status.receipts.length,0);
  const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));assert.equal(world.clock.minutes,0);
});

test('merged parents retain both canonical perspectives and ambiguous correction references refuse',async t=>{
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv});t.after(()=>table.dispose());
  const bridge=table.runtimeBridges().at(-1);
  const occurrence=(name,statement)=>({name,summary:'An attributed account was recorded.',knowledge:[{actor:npc,statement,mode:'observed',state:'uncertain'}]});
  await bridge.call('table.player_input',{campaign,text:'I ask for the first account.'});
  await bridge.call('table.apply',{campaign,call_id:'t1-c1',effects:[],event:occurrence('shared account','The earlier conversation occurred.')});
  const first=await bridge.call('table.narrate',{campaign,call_id:'t1-c2',text:'The conversation ends.'});
  await bridge.call('table.player_input',{campaign,text:'I ask a follow-up question.'});
  await bridge.call('table.apply',{campaign,call_id:'t2-c1',effects:[],event:occurrence('same account','The main branch account occurred.')});
  await bridge.call('table.narrate',{campaign,call_id:'t2-c2',text:'The conversation continues.'});
  await bridge.call('table.branch',{campaign,commit:first.commit,name:'side'});
  await bridge.call('table.player_input',{campaign,text:'I ask a different follow-up question.'});
  await bridge.call('table.apply',{campaign,call_id:'t2-c1',effects:[],event:occurrence('same account','The side branch account occurred.')});
  await bridge.call('table.narrate',{campaign,call_id:'t2-c2',text:'The other conversation continues.'});
  await bridge.call('table.player_input',{campaign,text:'I consider the two earlier accounts.'});
  await bridge.call('table.apply',{campaign,call_id:'t3-c1',effects:[{kind:'merge',name:'joined',lines:['main','side']}]});
  await bridge.call('table.narrate',{campaign,call_id:'t3-c2',text:'The accounts are brought together.'});
  const view=await bridge.call('table.look',{campaign,focus:'npc',name:npc});
  for(const statement of ['The earlier conversation occurred.','The main branch account occurred.','The side branch account occurred.'])assert.ok(view.cognition.some(row=>row.statement===statement),JSON.stringify({cognition:view.cognition,meta:JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/campaign.json'),'utf8')).worldlines}));
  const input=await bridge.call('table.player_input',{campaign,text:'I ask to correct the main account.'});
  assert.ok(input.capsule.present.find(row=>row.name===npc).cognition.some(row=>row.statement==='The side branch account occurred.'));
  const remembered=await bridge.call('table.recall',{campaign,what:'memory',about:[npc]});
  assert.ok(remembered.hits.some(row=>row.statement==='The side branch account occurred.'&&row.authority==='canonical_event'));
  await assert.rejects(bridge.call('table.apply',{campaign,call_id:'t4-c1',effects:[],event:{name:'ambiguous correction',summary:'An account was corrected.',corrects:'event:t2:same account'}}),/ambiguous/);
  await bridge.call('table.apply',{campaign,call_id:'t4-c2',effects:[],event:{name:'specific correction',summary:'The main account was corrected.',corrects:'event:main:t2:same account'}});
  const corrected=await bridge.call('table.look',{campaign,focus:'npc',name:npc});
  assert.ok(!corrected.cognition.some(row=>row.statement==='The main branch account occurred.'));
  assert.ok(corrected.cognition.some(row=>row.statement==='The side branch account occurred.'));
});

test('an unexecuted NPC plan survives publication and reaches the next turn without spending time',async t=>{
  const intention='Report the visitor to the supervisor later.';
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv,
    responses:[tool('apply',{effects:[{kind:'npc',name:npc,intends:intention,outcome:'planned'}]}),tool('output',{delivery:plan})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait quietly while he considers what to do.');
  assert.deepEqual(errors(table),[]);
  const bridge=table.runtimeBridges().at(-1);
  const view=await bridge.call('table.look',{campaign,focus:'npc',name:npc});
  const saved=view.ledger?.intents?.find(value=>value.intent===intention||value.text===intention);
  assert.ok(saved,'the accepted plan reaches the ordinary NPC read after publication');
  assert.equal(saved.status,'planned');
  const capsule=await bridge.call('table.capsule',{campaign});
  assert.ok(!capsule.director.offer.some(value=>value.ref===saved.ref),'a plan is not an attempted action with an owed result');
  assert.equal(capsule.where.clock.minutes,0);
});

for(const phase of ['before_cursor','after_cursor'])test(`an ask interrupted ${phase} preserves the accepted disclosure boundary and a cached retry activates once`,async t=>{
  const source='event:t1:asked announcement/announcement';
  const event={name:'asked announcement',summary:'Knott prepares an announcement.',materials:[{name:'announcement',text:'The office is open.',kind:'speech',visibility:'player',speaker:npc,audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'Knott claimed the office is open.',mode:'heard',source:npc,state:'uncertain',material:'announcement'}]};
  const choice={kind:'mechanics',options:['accept','push']},delivery={version:1,sources:[source],required:[source]};
  let table,interrupted;
  table=await openTable({legacyDeliveryFixtures:false,realKernel:true,
    env:{...eventWriterEnv,PI_COC_TEST_ASK_FAULT:'pending',PI_COC_TEST_ASK_FAULT_PHASE:phase,NODE_OPTIONS:`--import=${join(root,'tests/extension/fixtures/ask-write-fault.mjs')}`},
    prepareWorkspace:workspace=>{seedOpening(workspace);process.env.PI_COC_TEST_ASK_FAULT=join(workspace,'arm-ask');writeFileSync(process.env.PI_COC_TEST_ASK_FAULT,'armed');},
    responses:[tool('apply',{effects:[],event}),tool('output',{delivery,choice}),async()=>{
      interrupted=await table.runtimeBridges().at(-1).call('table.capsule',{campaign});return tool('output',{delivery,choice});
    }]});t.after(()=>table.dispose());await table.session.prompt('I pause before choosing how to handle the risk.');
  assert.equal(interrupted.player_knows.cognition.filter(row=>row.statement==='Knott claimed the office is open.').length,phase==='after_cursor'?1:0);
  const restarted=reconnect(table.workspace);t.after(()=>restarted.close());
  const reopened=await restarted.call('table.capsule',{campaign});
  assert.equal(reopened.player_knows.cognition.filter(row=>row.statement==='Knott claimed the office is open.').length,1);
  assert.equal((await restarted.call('table.status',{campaign})).state,'asked');
});

test('all auxiliary author channels discard private metadata while retaining public writing guidance',async t=>{
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:eventWriterEnv,
    extraExtensions:[{name:'author-reference-boundary',factory:pi=>{
      pi.events.on('coc:writing-reference-request',request=>{
        const capsule=request.capsule,turn=capsule.turn.number,campaign=capsule._context.campaign;
        capsule.where.clock.private_notes='PRIVATE_CLOCK';
        for(const person of capsule.present??[])person.private_activity='PRIVATE_ACTIVITY';
        capsule.recent.push({turn:0,player:'A public question.',keeper:'A public answer.',hidden:'PRIVATE_RECENT'});
        capsule.style.private_notes='PRIVATE_STYLE';
        capsule.style.directives.push({id:'public-example',line:'Write naturally.',private_notes:'PRIVATE_DIRECTIVE'});
        capsule.mods.establish={place:{name:'Office',secret:'PRIVATE_PLACE'},why:'Opening description.',owes:[{key:'ordinary',line:'Describe the visible room.',private_notes:'PRIVATE_ESTABLISH'}]};
        capsule.mods.instructions=[{mod:'narration-craft',version:'1.0.0',form:'brief',instruction:'Keep the public account clear.',settings:'PRIVATE_SETTINGS'}];
        capsule.mods.expression_reference={enabled:true,revision:'current',play_language:'en'};
        pi.events.emit('coc:writing-guidance',{campaign,turn,kind:'sections',revision:createHash('sha256').update(JSON.stringify(capsule.mods.instructions)).digest('hex'),
          content:{authority:'writing_reference',private_notes:'PRIVATE_SECTIONS',sections:[{package:'public',section:'style',text:'Use connected prose.',private_notes:'PRIVATE_SECTION'}]}});
        pi.events.emit('coc:writing-guidance',{campaign,turn,kind:'temporal',content:{hidden:'PRIVATE_TEMPORAL'}});
        request.accept({campaign,turn,revision:'current',content:JSON.stringify({authority:'writing_reference',hidden:'PRIVATE_EXPRESSION',people:[{name:npc,hidden:'PRIVATE_PERSON',cards:[{name:'Welcome',kind:'interaction',pattern:'Respond politely.',hidden:'PRIVATE_CARD',examples:[{context:'A visitor asks.',reply:'Please come in.',hidden:'PRIVATE_EXAMPLE'}]}]}]})});
      });
    }}],responses:[tool('apply',{effects:[{kind:'time',minutes:1}],event:{name:'PRIVATE_METADATA',summary:'PRIVATE_SUMMARY',materials:[{name:'visible room',text:'The room is cold.',kind:'description',visibility:'player'}]}}),tool('output',{delivery:plan})]});
  t.after(()=>table.dispose());await table.session.prompt('I wait one minute and look around.');
  assert.deepEqual(errors(table),[]);
  const start=table.telemetry().find(row=>row.lane==='final-output'&&row.event==='start');assert.ok(start);
  const packet=JSON.parse(readFileSync(join(table.runtimeBridges().at(-1).runtime.home,'.coc/delivery-writes',start.packet,'task.json'),'utf8'));
  assert.ok(!JSON.stringify(packet).includes('PRIVATE_'));
  assert.equal(packet.guidance.establish.owes[0].line,'Describe the visible room.');
  assert.equal(packet.guidance.expression.people[0].cards[0].examples[0].reply,'Please come in.');
  assert.ok(packet.facts.some(row=>row.kind==='time'));
});

test('a corrected event keeps history but cannot be selected as a current canonical output source',async t=>{
  const old={name:'first account',summary:'The first account was recorded.',materials:[{name:'notice',text:'The office is closed.',kind:'fact',visibility:'player'}],
    knowledge:[{actor:npc,statement:'PRIVATE_OLD_ACCOUNT',mode:'observed',state:'uncertain'}]};
  const correction={name:'corrected account',summary:'The account is corrected.',corrects:'event:t1:first account',materials:[{name:'notice',text:'The office is open.',kind:'fact',visibility:'player'}],
    knowledge:[{actor:npc,statement:'PRIVATE_NEW_ACCOUNT',mode:'observed',state:'accurate'}]};
  const oldSource='event:t1:first account/notice',source='event:t1:corrected account/notice';
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:eventWriterEnv,
    responses:[tool('apply',{effects:[],event:old}),tool('apply',{effects:[],event:correction}),
      tool('narrate',{delivery:{version:1,sources:[oldSource],required:[oldSource]}}),tool('output',{delivery:{version:1,sources:[source],required:[source]}})]});
  t.after(()=>table.dispose());await table.session.prompt('I ask him to clarify the earlier account.');
  const checks=table.session.messages.filter(m=>m.role==='toolResult'&&m.toolName==='narrate');
  assert.ok(checks.some(m=>m.isError),'the original source loses its current public grant');
  const view=await table.runtimeBridges().at(-1).call('table.look',{campaign,focus:'npc',name:npc});
  assert.ok(view.cognition.some(row=>row.statement==='PRIVATE_NEW_ACCOUNT'));
  assert.ok(!view.cognition.some(row=>row.statement==='PRIVATE_OLD_ACCOUNT'));
});

test('a permitted event utterance teaches its actual hearer only at accepted output and keeps private metadata out',async t=>{
  const name='PRIVATE_EVENT_TITLE',material=`event:t1:${name}/announcement`;
  const event={name,summary:'PRIVATE_CAUSAL_ACCOUNT',materials:[{name:'announcement',text:'The office is open.',kind:'speech',visibility:'player',speaker:npc,audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'Knott claimed the office is open.',mode:'heard',source:npc,state:'uncertain',material:'announcement'}]};
  let table,prepared;
  table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    env:{...writerEnv,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(root,'tests/extension/fixtures/turn-event-writer.mjs')])},
    responses:[tool('apply',{effects:[],event}),tool('narrate',{delivery:{version:1,sources:[material],required:[material]}}),async()=>{
      prepared=await table.runtimeBridges().at(-1).call('table.status',{campaign});
      return tool('output',{});
    }]});
  t.after(()=>table.dispose());
  await table.session.prompt('I ask whether the office is open.');
  assert.equal(prepared.outcome.knowledge_changes[0].status,'pending');
  const bridge=table.runtimeBridges().at(-1),recalled=await bridge.call('table.recall',{campaign,what:'history',turns:[1,1]});
  assert.ok(JSON.stringify(recalled).includes('delivered'),JSON.stringify(table.session.messages.filter(m=>m.role==='toolResult').map(m=>({name:m.toolName,error:m.isError,content:m.content}))));
  assert.ok(JSON.stringify(recalled).includes('Knott claimed the office is open.'));
  const capsule=await bridge.call('table.capsule',{campaign});
  assert.ok(capsule.player_knows.cognition.some(row=>row.statement==='Knott claimed the office is open.'&&row.mode==='heard'));
  const restarted=reconnect(table.workspace);t.after(()=>restarted.close());
  const reopened=await restarted.call('table.capsule',{campaign});
  assert.equal(reopened.player_knows.cognition.filter(row=>row.statement==='Knott claimed the office is open.').length,1);
});

test('a covered short quote inside canonical speech activates despite an earlier context copy',async t=>{
  const source='event:t1:contact confirmation/confirmation';
  const event={name:'contact confirmation',summary:'Knott confirms a contact.',materials:[{name:'confirmation',text:'The office is open.',kind:'speech',visibility:'player',speaker:npc,audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'Knott claimed the office is open.',mode:'heard',source:npc,state:'uncertain',material:'confirmation'}]};
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:{...eventWriterEnv,PI_COC_TEST_SHORT_COVERAGE:'1'},
    responses:[tool('apply',{effects:[],event}),tool('output',{delivery:{version:1,materials:[{name:'context copy',text:'The office is open.',kind:'context',visibility:'player',source,required:true}],sources:[source],required:[source]}})]});
  t.after(()=>table.dispose());await table.session.prompt('I ask him to confirm the office status.');
  assert.deepEqual(errors(table),[]);
  const capsule=await table.runtimeBridges().at(-1).call('table.capsule',{campaign});
  assert.equal(capsule.player_knows.cognition.filter(row=>row.statement==='Knott claimed the office is open.').length,1);
});

test('a repaired exchange separates earlier player speech from the pending NPC reply',async t=>{
  const alias='event:t1:office exchange/reply';
  const acquired={actor:npc,statement:'Thomas Hayes said the office is open.',mode:'heard',source:'Thomas Hayes',state:'uncertain'};
  const event={name:'office exchange',summary:'The office status is exchanged.',
    materials:[{name:'reply',text:'The office is open.',kind:'speech',visibility:'player',speaker:npc,audience:['Thomas Hayes']}],
    knowledge:[acquired,{actor:'Thomas Hayes',statement:'Knott claimed the office is open.',mode:'heard',source:npc,state:'uncertain',material:'reply'}]};
  const bad={...event,knowledge:[{...acquired,material:'reply'},event.knowledge[1]]};
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:eventWriterEnv,
    responses:[tool('apply',{effects:[],event:bad}),tool('apply',{effects:[],event}),tool('output',{delivery:{version:1,sources:[alias],required:[alias]}})]});
  t.after(()=>table.dispose());await table.session.prompt('I tell Knott the office is open and ask him to repeat that.');
  assert.equal(errors(table).length,1);
  const bridge=table.runtimeBridges().at(-1),npcView=await bridge.call('table.look',{campaign,focus:'npc',name:npc});
  assert.ok(npcView.cognition.some(row=>row.statement===acquired.statement&&row.mode==='heard'));
  const capsule=await bridge.call('table.capsule',{campaign});
  assert.equal(capsule.player_knows.cognition.filter(row=>row.statement==='Knott claimed the office is open.').length,1);
});

test('canonical event cognition and directed relationship survive output without a memory worker',async t=>{
  const event={name:'office conversation',summary:'Knott decides to cooperate after the earlier help.',
    materials:[{name:'visible room',text:'The room is cold.',kind:'description',visibility:'player'},
      {name:'hidden cause',text:'PRIVATE_EVENT_CAUSE',kind:'fact',visibility:'keeper'}],
    knowledge:[{actor:npc,statement:'PRIVATE_LOCKED_ROOM',mode:'observed',state:'accurate'}],
    relationships:[{actor:npc,toward:'Thomas Hayes',statement:'He trusts this visitor because the visitor helped him.'}]};
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv,
    responses:[tool('apply',{effects:[],event}),tool('output',{delivery:plan})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I remind him of the help I gave him and ask to continue.');
  const bridge=table.runtimeBridges().at(-1);
  const view=await bridge.call('table.look',{campaign,focus:'npc',name:npc});
  assert.ok(view.cognition?.some(row=>row.statement==='PRIVATE_LOCKED_ROOM'&&row.authority==='canonical_event'));
  const situation=await bridge.call('npc.situation',{campaign,name:npc});
  assert.ok(situation.who.cognition?.some(row=>row.statement==='PRIVATE_LOCKED_ROOM'));
  const investigator=await bridge.call('table.look',{campaign,focus:'investigator'});
  assert.ok(view.relationships?.some(row=>row.toward===investigator.name&&row.evidence.some(e=>e.authority==='canonical_event')),JSON.stringify(view.relationships));
  const recalled=await bridge.call('table.recall',{campaign,what:'history',turns:[1,1]});
  assert.ok(JSON.stringify(recalled).includes('office conversation'));
  const memory=await bridge.call('table.recall',{campaign,what:'memory',about:[npc],kinds:['knowledge','relationship']});
  assert.ok(memory.hits.some(row=>row.statement==='PRIVATE_LOCKED_ROOM'&&row.authority==='canonical_event'));
  const capsule=await bridge.call('table.capsule',{campaign});
  assert.ok(!JSON.stringify(capsule.player_knows).includes('PRIVATE_LOCKED_ROOM'));
  const input=await bridge.call('table.player_input',{campaign,text:'I ask him what he remembers of the locked room.'});
  assert.ok(input.capsule.present.find(row=>row.name===npc).cognition?.some(row=>row.statement==='PRIVATE_LOCKED_ROOM'));
});

test('a fitted NPC dossier retains recent cognition or a truthful route to omitted cognition',()=>{
  const cognition=[{statement:'The recent encounter happened.',turn:2,authority:'canonical_event'},
    {statement:'The earlier encounter happened.',turn:1,authority:'canonical_event'}];
  const rows=[{name:npc,cognition,background:'Long background. '.repeat(100)}];
  assert.equal(fitPresent(rows,650),true);
  assert.equal(rows[0].cognition[0].statement,'The recent encounter happened.');
  if(rows[0].cognition.length<2)assert.equal(rows[0].semantic_coverage.cognition_omitted,1);
  fitPresent(rows,100);
  assert.ok(rows[0].semantic_coverage.cognition_omitted>=1);
  assert.deepEqual(rows[0].semantic_coverage.read,{what:'memory',about:[npc]});
  const relationOnly=[{name:npc,relationships:[{toward:'Thomas Hayes',evidence:[{statement:'The visitor helped him.',authority:'canonical_event'}]}],
    semantic_coverage:{relationships_omitted:4}}];
  fitPresent(relationOnly,50);
  assert.equal(relationOnly[0].semantic_coverage.relationships_omitted,5);
});

test('bounded cognition retains the current event when current receipts precede older records',()=>{
  const event=turn=>({id:`receipt-${turn}`,scope:{campaign,worldline:'main',loop:0,turn},status:'active',
    knowledge:[{actor:{id:npc,name:npc},statement:`The encounter at turn ${turn} occurred.`,mode:'observed',state:'accurate',status:'active'}]});
  const view=actorEventView([event(17),...Array.from({length:16},(_,index)=>event(index+1))],[npc],{campaign,worldline:'main',loop:0,turn:17});
  assert.equal(view.cognition.length,12);
  assert.equal(view.cognition.at(-1).statement,'The encounter at turn 17 occurred.');
  assert.equal(view.coverage.cognition_omitted,5);
});

test('an event-bearing batch refused by action admission cannot establish an unchosen player action',async t=>{
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,env:writerEnv,
    laneResponses:{admission:[fauxAssistantMessage(JSON.stringify({verdict:'not_authorized',grounds:'The player chose only to ask, not leave.',missing:'destination'}))]},
    responses:[tool('apply',{effects:[],event:{name:'unchosen departure',summary:'The investigator leaves the office.'}}),tool('output',{delivery:plan})]});
  t.after(()=>table.dispose());
  await table.session.prompt('I ask him a question and stay where I am.');
  assert.ok(table.lanes.admission.requests().length>0,'semantic-only events reach the existing reviewer');
  const history=await table.runtimeBridges().at(-1).call('table.recall',{campaign,what:'history',turns:[1,1]});
  assert.ok(!JSON.stringify(history).includes('unchosen departure'));
});

test('a commit failure leaves disclosure pending, preserves settled time, and retries the accepted artifact once',async t=>{
  const material='event:t1:delayed announcement/announcement';
  const event={name:'delayed announcement',summary:'Knott prepares an announcement.',materials:[{name:'announcement',text:'The office is open.',kind:'speech',visibility:'player',speaker:npc,audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'Knott claimed the office is open.',mode:'heard',source:npc,state:'uncertain',material:'announcement'}]};
  let table,failed;
  table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env:eventWriterEnv,prepareWorkspace:workspace=>{
    seedOpening(workspace);
    const hook=join(workspace,'.coc/repos/test-camp.git/hooks/pre-commit');
    writeFileSync(hook,'#!/bin/sh\nmarker="$(git rev-parse --git-dir)/commit-once-marker"\nif test -e "$marker"; then exit 0; fi\ntouch "$marker"\nexit 1\n');chmodSync(hook,0o700);
  },responses:[tool('apply',{effects:[{kind:'time',minutes:1}],event}),tool('output',{delivery:{version:1,sources:[material],required:[material]}}),async()=>{
    failed=await table.runtimeBridges().at(-1).call('table.status',{campaign});
    return tool('output',{delivery:{version:1,sources:[material],required:[material]}});
  }]});t.after(()=>table.dispose());
  await table.session.prompt('I wait one minute for his answer.');
  assert.equal(failed.outcome.knowledge_changes[0].status,'pending');
  assert.equal(failed.outcome.world_effects.filter(row=>row.kind==='time').length,1);
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,1);
  const restarted=reconnect(table.workspace);t.after(()=>restarted.close());
  const capsule=await restarted.call('table.capsule',{campaign});
  assert.equal(capsule.where.clock.minutes,1);
  assert.equal(capsule.player_knows.cognition.filter(row=>row.statement==='Knott claimed the office is open.').length,1);
});
