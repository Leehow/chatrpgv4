import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,chmodSync,mkdtempSync,rmSync,cpSync,mkdirSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fauxAssistantMessage,fauxText,fauxToolCall} from '@earendil-works/pi-ai';
import {customMessages,openTable,waitForIdle} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';
import {importSource,RpcClient,rpcCommand} from '../integration/support.ts';
import {writeSourceMetadata} from '../integration/module-support.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';

const root=resolve(import.meta.dirname,'../..');
const plan={version:1,materials:[
  {name:'cold room',text:'The room is cold.',kind:'description',visibility:'player',required:true},
  {name:'secret',text:'PRIVATE_STREAM_SECRET',kind:'context',visibility:'keeper'},
]};
function seedOpening(workspace){
  const lines=[['table.open',{}],['table.narrate',{call_id:'t0-c1',text:'You wait in the office.'}]];
  const run=spawnSync(process.execPath,[join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],{
    cwd:root,encoding:'utf8',input:lines.map(([method,params],id)=>JSON.stringify({id:String(id),method,params:{campaign:'test-camp',...params}})).join('\n')+'\n'});
  assert.equal(run.status,0,run.stderr);
  for(const line of run.stdout.trim().split('\n')){const frame=JSON.parse(line);if(!frame.progress)assert.equal(frame.ok,true,JSON.stringify(frame));}
}

function seedPrintedNames(workspace,shared=false){
  seedOpening(workspace);
  const folder=join(workspace,'.coc/modules/the-haunting'),file=join(folder,'module.json');
  const metadata=JSON.parse(readFileSync(file,'utf8'));
  const sha=metadata.source_document?.file_sha256||metadata.file_sha256
    ||createHash('sha256').update(readFileSync(join(folder,'module-graph.json'))).digest('hex');
  writeFileSync(file,JSON.stringify({...metadata,file_sha256:sha}));
  writeFileSync(join(folder,'cast.json'),JSON.stringify({version:5,state:'complete',source_sha256:sha,
    people:[{id:'cast-dooley',book:['Mr. Dooley',...(shared?['Alex']:[])],play:['Mr. Dooley'],pages:[1]},
      ...(shared?[{id:'cast-wilmot',book:['Arty Wilmot','Alex'],play:['Arty Wilmot'],pages:[1]}]:[])]}));
}

test('one Keeper response records its event and delivers its own prose without a second author',async t=>{
  const seen=[];
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
  let calls=0;
  const text='The clerk nods. {{say:Steven Knott}}I only heard the family left.{{/say}}';
  const response={version:1,record:{event:{name:'clerk-reply',summary:'The clerk answers the visitor.',
    materials:[{name:'reply',text:'I only heard the family left.',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'Knott says the family left.',mode:'heard',state:'uncertain',source:'Steven Knott',material:'reply'}]}},text};
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},
    extraExtensions:[{name:'capture-stream',factory:pi=>pi.events.on('coc:final-delivery',frame=>seen.push(frame))},{name:'driver',factory:engine.extension}],
    responses:[()=>{calls++;return fauxAssistantMessage(JSON.stringify(response));}]});
  t.after(()=>table.dispose());
  await table.session.prompt('What happened to the family?');
  assert.equal(calls,1);
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.equal(seen.at(-1)?.status,'completed');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.ok(turn.receipts.some(row=>row.kind==='event'));
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0);
  const memory=await table.runtimeBridges().at(-1).call('table.recall',{campaign:'test-camp',what:'memory',about:['Thomas Hayes']});
  assert.ok(memory.hits.some(row=>row.statement==='Knott says the family left.'&&row.authority==='canonical_event'));
});

test('the same Keeper receives a real rule result and then writes the public response',async t=>{
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  let sawRoll=false;
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},extraExtensions:[{name:'driver',factory:engine.extension}],
    responses:[fauxAssistantMessage([fauxToolCall('resolve',{action:{actor:'Thomas Hayes',intent:'investigate',
      goal:'Notice signs of entry',method:'Inspect the lock carefully',skill:'Spot Hidden',decision:'core-check:ordinary-check',
      modifiers:{difficulty:'regular',bonus_dice:0,penalty_dice:0}}})],{stopReason:'toolUse'}),
      context=>{sawRoll=context.messages.some(message=>message.role==='toolResult'&&JSON.stringify(message.content).includes('roll'));
        return fauxAssistantMessage(JSON.stringify({version:1,text:'You finish inspecting the lock.'}));}]});
  t.after(()=>table.dispose());
  await table.session.prompt('I inspect the lock carefully for signs of entry.');
  assert.ok(sawRoll);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.receipts.some(receipt=>receipt.kind==='roll'));
  assert.ok(turn.commit);
  assert.equal(table.telemetry().filter(row=>row.lane==='run'&&row.type==='step_start'&&row.kind==='decide').length,0);
});


function directTable(responses,extra={}) {
  const {onFrame,extraExtensions=[],decision=checkedRecovery,...options}=extra;
  const seen=[];
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision});
  return openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},
    extraExtensions:[{name:'capture-stream',factory:pi=>pi.events.on('coc:final-delivery',frame=>{seen.push(frame);onFrame?.(frame);})},{name:'driver',factory:engine.extension},...extraExtensions],
    responses,...options}).then(table=>({table,seen}));
}

const checkedRecovery={decide:async batch=>({batchId:batch.id,status:'complete',
  answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:batch.family==='held-act-outcome'||question.key.startsWith('restriction_')?.01:.99}])),
  coverage:{required:batch.questions.map(question=>question.key),answered:batch.questions.map(question=>question.key),unknown:[]},issues:[]})};

for(const [form,minutes] of [['nested',4],['html',5]])test(`tagged ${form} calls settle through native Pi before the same Keeper streams prose`,async t=>{
  const body=readFileSync(join(import.meta.dirname,'fixtures',`tagged-apply-${form}.txt`),'utf8');
  const text='You finish waiting beside the desk. '.repeat(50);
  let requests=0,sawResult=false,stateAtFirstDelta;
  const {table,seen}=await directTable([()=>{requests++;return fauxAssistantMessage(body);},context=>{
    requests++;
    const results=context.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply');
    assert.equal(results.length,1);
    assert.equal(results[0].isError,false);
    const calls=context.messages.filter(row=>row.role==='assistant').flatMap(row=>row.content).filter(row=>row.type==='toolCall'&&row.name==='apply');
    assert.equal(calls.length,1);
    assert.equal(results[0].toolCallId,calls[0].id);
    sawResult=true;
    return fauxAssistantMessage('{{public}}'+text);
  }],{onFrame:frame=>{
    if(frame.event==='delta'&&stateAtFirstDelta===undefined){
      stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;
    }
  }});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait quietly beside the desk for a few minutes.');
  assert.equal(requests,2,'one native-call response and one public response, without a repair inference');
  assert.ok(sawResult);
  assert.equal(stateAtFirstDelta,minutes);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,minutes);
  assert.ok(turn.commit);
  assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);
  assert.equal(seen.filter(row=>row.event==='delta').map(row=>row.delta).join(''),text);
  assert.ok(seen.filter(row=>row.event==='delta').length>2);
  assert.equal(seen.at(-1)?.status,'completed');
  assert.deepEqual(table.extensionErrors,[]);
});

for(const form of ['unknown','converted'])test(`a tagged ${form} call cannot mutate the native table or publish its parameters`,async t=>{
  const original=readFileSync(join(import.meta.dirname,'fixtures','tagged-apply-nested.txt'),'utf8');
  const body=form==='unknown'?original.replace('<tool_name>apply','<tool_name>unknown')
    :original.replace('"minutes": 1','"minutes": "1"');
  let requests=0;
  const text='You remain beside the desk.';
  const {table,seen}=await directTable([()=>{requests++;return fauxAssistantMessage(body);},context=>{
    requests++;
    assert.equal(context.messages.filter(row=>row.role==='toolResult').length,0);
    return fauxAssistantMessage('{{public}}'+text);
  }]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait beside the desk.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,0);
  assert.equal(turn.receipts.filter(row=>row.kind==='event'||row.kind==='time').length,0);
  assert.equal(requests,2,'the existing correction is the only recovery');
  assert.equal(seen.filter(row=>row.event==='delta').map(row=>row.delta).join(''),text);
  assert.deepEqual(table.extensionErrors,[]);
});

test('one Keeper omits a reverse speech binding and publishes valid time, inventory, notes and hearing once',async t=>{
  let authors=0,closed=false;
  const retained=mkdtempSync(join(tmpdir(),'keeper-binding-fixture-'));
  t.after(()=>rmSync(retained,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const text='You finish waiting beside the desk. {{say:Steven Knott}}The office is open.{{/say}}';
  const response={version:1,record:{effects:[{kind:'time',minutes:8},{kind:'item',name:'Loose test slips',quantity:1},
    {kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',document:{action:'append',text:'B'},why:'Write the chosen note.'}],
    event:{name:'notes-and-answer',summary:'PRIVATE_VALID_ACCOUNT',
      materials:[{name:'reply',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes'],text:'The office is open.'},
        {name:'unspoken',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes'],text:'PRIVATE_UNSPOKEN_ACCOUNT'}],
      knowledge:[{actor:'Steven Knott',source:'Thomas Hayes',statement:'PRIVATE_OMITTED_REVERSE_BINDING',mode:'heard',state:'accurate',material:'reply'},
        {actor:'Thomas Hayes',source:'Steven Knott',statement:'Knott says the office is open.',mode:'heard',state:'uncertain',material:'reply'},
        {actor:'Thomas Hayes',source:'Steven Knott',statement:'PRIVATE_VALID_PENDING',mode:'heard',state:'uncertain',material:'unspoken'}]}},text,
    coverage:[{name:'reply',quote:'The office is open.'}]};
  const raw=JSON.stringify(response),command=JSON.stringify(rpcCommand());
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(raw);}],{
    retainAt:retained,
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:command},
    prepareWorkspace:async workspace=>{
      const kernel=new RpcClient(workspace);
      try{
        const draft={name:'Notebook',category:'item',description:'An ordinary writable carrier.',basis:'Ordinary fixture paper.',
          parameters:{charges:null,effects:[]},document:{text:'A',presentation:'notebook'},player_view:{description:'A notebook.',fields:[]}};
        const job=await kernel.ok('mods.job',{campaign:'test-camp',role:'create',input:{name:draft.name,category:draft.category,description:draft.description}});
        writeFileSync(join(job.cwd,'result.json'),JSON.stringify(draft));
        const accepted=await kernel.ok('mods.accept',{campaign:'test-camp',job:job.job});
        await kernel.ok('table.open',{campaign:'test-camp'});
        await kernel.ok('table.apply',{campaign:'test-camp',call_id:'t0-c1',effects:[
          {kind:'define',name:draft.name,category:draft.category,description:draft.description,_definition:accepted.definition,_provenance:accepted.provenance},
          {kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
        await kernel.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c2',text:'You wait in the office with your notebook.'});
      }finally{await kernel.close();}
      process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',join(root,'content')]);
    },
  });
  t.after(async()=>{if(!closed)await table.dispose();});
  await table.session.prompt('I append B to my notebook, take a loose slip from the desk, wait eight minutes, and ask whether the office is open.');
  assert.equal(authors,1);assert.deepEqual(table.extensionErrors,[]);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text,
    JSON.stringify(table.telemetry().filter(row=>row.ok===false||row.lane==='keeper-delivery')));
  assert.ok(seen.filter(frame=>frame.event==='delta').length>2);assert.equal(seen.at(-1)?.status,'completed');
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_'));
  const telemetry=table.telemetry(),omitted=telemetry.find(row=>row.lane==='keeper-delivery'&&row.reason==='not_landed');
  assert.equal(omitted?.ok,true);assert.equal(omitted.not_landed[0].details.field,'event.knowledge[0].material');
  assert.ok(omitted.private_reply.startsWith(raw.slice(0,raw.indexOf(',"text":'))),'the complete original private record bytes are retained');
  assert.ok(omitted.private_reply.includes('PRIVATE_OMITTED_REVERSE_BINDING'));
  assert.deepEqual(telemetry.filter(row=>row.tool==='apply').map(row=>row.ok),[true]);
  assert.equal(telemetry.filter(row=>row.lane==='provider-call').length,1);
  assert.equal(telemetry.filter(row=>row.lane==='kernel-rpc'&&row.method==='table.narrate'&&row.ok).length,1);
  assert.equal(telemetry.filter(row=>row.lane==='keeper-delivery'&&row.ok===false).length,0);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(turn.receipts.filter(row=>row.writing_result).length,1);
  assert.deepEqual(turn.outcome.knowledge_changes.map(row=>[row.statement,row.status]),[
    ['Knott says the office is open.','active'],['PRIVATE_VALID_PENDING','pending']]);
  assert.equal(turn.disclosures.length,1);
  const bridge=table.runtimeBridges().at(-1),memory=await bridge.call('memory.job',{campaign:'test-camp',turn:1});
  assert.equal(JSON.stringify(memory).includes('PRIVATE_OMITTED_REVERSE_BINDING'),false);
  const original=readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8');
  const workspace=table.workspace;await table.dispose();closed=true;const restarted=new RpcClient(workspace);
  t.after(()=>restarted.close());
  const capsule=await restarted.ok('table.capsule',{campaign:'test-camp'});
  assert.equal(capsule.where.clock.minutes,8);
  assert.ok(capsule.player_knows.cognition.some(row=>row.statement==='Knott says the office is open.'));
  assert.equal(JSON.stringify(capsule.player_knows).includes('PRIVATE_VALID_PENDING'),false);
  assert.equal(JSON.stringify(await restarted.ok('npc.perspective',{campaign:'test-camp',name:'Steven Knott'})).includes('PRIVATE_OMITTED_REVERSE_BINDING'),false);
  const sheet=JSON.parse(readFileSync(join(workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),'utf8'));
  assert.equal(sheet.equipment.find(row=>row.name==='Loose test slips').quantity,1);
  assert.equal(sheet.equipment.filter(row=>row.name==='Notebook').length,1);
  assert.equal((await restarted.ok('mods.document.view',{campaign:'test-camp',actor:'Thomas Hayes',name:'Notebook'})).text,'AB');
  assert.equal(JSON.stringify(await restarted.ok('table.recall',{campaign:'test-camp',what:'memory',about:['Steven Knott','Thomas Hayes']})).includes('PRIVATE_OMITTED_REVERSE_BINDING'),false);
  await restarted.close();

  let laterAuthors=0,request;
  const {table:continued,seen:laterSeen}=await directTable([context=>{
    laterAuthors++;request=context;
    return fauxAssistantMessage(JSON.stringify({version:1,record:{event:{name:'repeated-question',
      summary:'The investigator repeats the earlier question.',
      knowledge:[{actor:'Steven Knott',source:'Thomas Hayes',statement:'PRIVATE_OMITTED_REVERSE_BINDING',mode:'heard',state:'accurate'}]}},
      text:'{{say:Steven Knott}}I heard your question.{{/say}}'}));
  }],{seedCampaign:false,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:command},prepareWorkspace:continuedWorkspace=>{
    cpSync(join(workspace,'.coc'),join(continuedWorkspace,'.coc'),{recursive:true});
    process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',continuedWorkspace,'--content',join(root,'content')]);
  }});
  t.after(()=>continued.dispose());
  await continued.session.prompt('I repeat my earlier question to Knott: is the office open?');
  assert.equal(laterAuthors,1);assert.deepEqual(continued.extensionErrors,[]);
  assert.ok(JSON.stringify(request.messages).includes('Knott says the office is open.'));
  assert.equal(JSON.stringify(request.messages).includes('PRIVATE_OMITTED_REVERSE_BINDING'),false,'the next real Pi request cannot acquire omitted cognition from history or its actor projection');
  assert.equal(laterSeen.at(-1)?.status,'completed');assert.equal(JSON.stringify(laterSeen).includes('PRIVATE_'),false);
  const laterBridge=continued.runtimeBridges().at(-1),pov=await laterBridge.call('npc.perspective',{campaign:'test-camp',name:'Steven Knott'});
  assert.equal(pov.cognition.filter(row=>row.statement==='PRIVATE_OMITTED_REVERSE_BINDING'&&row.authority==='canonical_event').length,1,
    'a later genuine input establishes the hearing through the existing event path');
  const recall=await laterBridge.call('table.recall',{campaign:'test-camp',what:'memory',about:['Steven Knott']});
  assert.equal(recall.hits.filter(row=>row.statement==='PRIVATE_OMITTED_REVERSE_BINDING'&&row.authority==='canonical_event').length,1);
  assert.equal((await laterBridge.call('mods.document.view',{campaign:'test-camp',actor:'Thomas Hayes',name:'Notebook'})).text,'AB');
  const laterCapsule=await laterBridge.call('table.capsule',{campaign:'test-camp',_context_read:true});
  assert.equal(laterCapsule.where.clock.minutes,8);
  assert.equal(laterCapsule.player_knows.cognition.filter(row=>row.statement==='Knott says the office is open.'&&row.authority==='canonical_event').length,1);
  assert.equal(JSON.stringify(laterCapsule.player_knows).includes('PRIVATE_VALID_PENDING'),false,'the later hearing neither erases the earlier public fact nor activates undisclosed material');
  assert.equal(JSON.parse(readFileSync(join(continued.workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),'utf8')).equipment.find(row=>row.name==='Loose test slips').quantity,1);
  assert.equal(readFileSync(join(continued.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'),original);
  assert.equal(continued.telemetry().filter(row=>row.lane==='kernel-rpc'&&row.method==='table.narrate'&&row.ok&&row.turn===2).length,1);
});

test('the single Keeper reads a current inner scene and settles only the selected entry before its local clue',async t=>{
  let requests=0,firstRequest;
  const publicText='You enter the permitted front room and inspect the visible mark.';
  const {table,seen}=await directTable([
    context=>{requests++;firstRequest=context;return fauxAssistantMessage([fauxToolCall('look',{focus:'scene'})],{stopReason:'toolUse'});},
    context=>{
      requests++;
      const result=context.messages.filter(message=>message.role==='toolResult').at(-1);
      const view=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join(''));
      const selected=view.where.places.find(place=>place.name==='PRIVATE_INNER_NAVIGATION_TITLE');
      assert.ok(selected,'the actual scene read carries the registered inner destination');
      return fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[{kind:'move',to:selected.name},
        {kind:'clue',clue:'inner-fixture-mark',label:'Visible room mark',how:'Inspected during the chosen entry.'}],
        event:{name:'selected-room-inspection',summary:'The investigator enters and inspects the permitted front room.',
          knowledge:[{actor:'Thomas Hayes',statement:'A visible mark was inspected in the front room.',mode:'observed',state:'accurate'}]}},text:publicText}));
    }
  ],{seedCampaign:false,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand())},prepareWorkspace:async workspace=>{
    const content=join(workspace,'inner-content');cpSync(join(root,'content'),content,{recursive:true});
    const path=join(content,'starters/the-haunting/module-graph.json'),data=JSON.parse(readFileSync(path,'utf8'));
    for(const node of data.nodes)if(node.properties?.runtime_projection?.record?.is_start)node.properties.runtime_projection.record.is_start=false;
    data.nodes.push(...[
      {node_id:'scene-inner-fixture-house',node_kind:'scene',name:'Fixture house',properties:{runtime_projection:{kind:'scene',record:{scene_id:'inner-fixture-house',is_start:true}}}},
      {node_id:'scene-inner-fixture-room',node_kind:'scene',name:'PRIVATE_INNER_NAVIGATION_TITLE',properties:{}},
      {node_id:'clue-inner-fixture-mark',node_kind:'clue',name:'Visible room mark',properties:{}}
    ].map(node=>({...node,summary:node.name,visibility:'keeper-only',source_refs:[{source_id:'fixture',pdf_index:0}]})));
    data.relations.push({relation_id:'inner-fixture-room-in-house',from_node_id:'scene-inner-fixture-room',relation_kind:'located-in',to_node_id:'scene-inner-fixture-house',properties:{}},
      {relation_id:'inner-fixture-mark-in-room',from_node_id:'clue-inner-fixture-mark',relation_kind:'discoverable-at',to_node_id:'scene-inner-fixture-room',properties:{}});
    writeFileSync(path,JSON.stringify(data));
    const client=new RpcClient(workspace,{content});
    try{
      await client.ok('campaign.create',{id:'test-camp',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
      await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You stand in the house with permission to enter the front room.'});
    }finally{await client.close();}
    process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',content]);
  }});
  t.after(()=>table.dispose());
  await table.session.prompt('I enter the permitted front room and examine its visible marks.');
  assert.equal(requests,2);assert.deepEqual(table.extensionErrors,[]);
  assert.ok(JSON.stringify(firstRequest.messages).includes('PRIVATE_INNER_NAVIGATION_TITLE'));
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),publicText);
  assert.ok(seen.filter(frame=>frame.event==='delta').length>2);assert.equal(seen.at(-1)?.status,'completed');
  assert.equal(JSON.stringify(seen).includes('PRIVATE_INNER_NAVIGATION_TITLE'),false);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.deepEqual(turn.receipts.filter(receipt=>receipt.kind==='move'||receipt.kind==='clue').map(receipt=>receipt.kind),['move','clue']);
  assert.equal(turn.receipts.find(receipt=>receipt.kind==='move').to,'inner-fixture-room');
  assert.equal(turn.receipts.find(receipt=>receipt.kind==='move').minutes,0);
  assert.equal(turn.receipts.find(receipt=>receipt.kind==='clue').scene,'inner-fixture-room');
  assert.equal(JSON.stringify(turn.mechanics).includes('PRIVATE_INNER_NAVIGATION_TITLE'),false);
  assert.deepEqual(table.telemetry().filter(row=>row.tool==='apply').map(row=>row.ok),[true]);
  assert.equal(table.telemetry().filter(row=>row.lane==='kernel-rpc'&&row.method==='table.narrate'&&row.ok).length,1);
  assert.equal(table.telemetry().some(row=>row.lane==='keeper-delivery'&&row.ok===false),false);
});

// Genuine Pi/native RPC seam; decision and Keeper prose are deterministic doubles, not live play acceptance.
test('a rolled-back inner move reads the issued clue basis and reuses distinct stranded checks once',async t=>{
  let requests=0,content,stranded,rolls;const states=[];
  const retained=mkdtempSync(join(tmpdir(),'clue-route-native-fixture-'));
  t.after(()=>rmSync(retained,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const privateSummary='PRIVATE_ROUTE_BASIS: the old deed is tucked between two visible shelf boards.';
  const publicText='You enter the permitted front room and find the loose deed between the shelf boards.';
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const request=JSON.parse(init.body);if(request.state?.clue?.book_check)states.push(request.state);
    return new Response(JSON.stringify({model:JEV_MODEL,answers:Object.fromEntries(Object.keys(request.questions)
      .map(key=>[key,{type:'noul',noul:key==='fit_r0'?0.85:0.1}])),usage:{input_tokens:300,output_tokens:12}}),
      {status:200,headers:{'Content-Type':'application/json'}});
  });
  const {table,seen}=await directTable([context=>{
    requests++;assert.ok(rolls.every(roll=>JSON.stringify(context.messages).includes(roll.receipt)),'the actual next Pi request receives both earlier checks');
    return fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[
      {kind:'move',to:'route-inner-room'},{kind:'clue',clue:'route-inner-deed',label:'Loose deed',how:'The earlier shelf inspection found it.'},
      {kind:'time',minutes:8},{kind:'item',name:'Loose test slip',quantity:1}],
      event:{name:'route-room-inspection',summary:'The investigator enters the permitted room and finds the loose deed.',
        knowledge:[{actor:'Thomas Hayes',statement:'A loose deed was found between shelf boards.',mode:'observed',state:'accurate'}]}},text:publicText}));
  }],{seedCampaign:false,retainAt:retained,env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand()),
    EXT_JEV_APIKEY:'test-only',PI_COC_CLUE_ROUTE:'on',COC_KERNEL_SEED:'2'},prepareWorkspace:async workspace=>{
    content=join(workspace,'route-content');cpSync(join(root,'content'),content,{recursive:true});
    const file=join(content,'starters/the-haunting/module-graph.json'),data=JSON.parse(readFileSync(file,'utf8'));
    for(const node of data.nodes)if(node.properties?.runtime_projection?.record?.is_start)node.properties.runtime_projection.record.is_start=false;
    const nodes=[['scene-route-house','scene','Route fixture house',{runtime_projection:{kind:'scene',record:{scene_id:'route-house',is_start:true}}}],
      ['scene-route-inner-room','scene','PRIVATE_ROUTE_INNER_HEADING',{}],
      ['clue-route-inner-deed','clue','Loose deed',{delivery_kind:'skill_check',skill:'Library Use',difficulty:'regular'}]];
    data.nodes.push(...nodes.map(([node_id,node_kind,name,properties])=>({node_id,node_kind,name,properties,
      summary:node_kind==='clue'?privateSummary:name,visibility:'keeper-only',source_refs:[{source_id:'fixture',pdf_index:0}]})));
    data.relations.push({relation_id:'route-inner-in-house',from_node_id:'scene-route-inner-room',relation_kind:'located-in',to_node_id:'scene-route-house',properties:{}},
      {relation_id:'route-deed-in-room',from_node_id:'clue-route-inner-deed',relation_kind:'discoverable-at',to_node_id:'scene-route-inner-room',properties:{}});
    writeFileSync(file,JSON.stringify(data));
    const pregens=join(content,'starters/the-haunting/pregens/thomas-hayes/character.json'),pregen=JSON.parse(readFileSync(pregens,'utf8'));
    pregen.skills['Spot Hidden']=95;writeFileSync(pregens,JSON.stringify(pregen));
    const client=new RpcClient(workspace,{content,env:{COC_KERNEL_SEED:'2'}});
    try{
      await client.ok('campaign.create',{id:'test-camp',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
      await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You have permission to enter the front room.'});
      await client.ok('table.player_input',{campaign:'test-camp',text:'I inspect visible shelf boards and separately watch the owner.'});
      rolls=[];
      for(const [index,goal]of ['Inspect the shelf boards for loose records','Watch the owner reaction'].entries())
        rolls.push(await client.ok('table.resolve',{campaign:'test-camp',call_id:`t1-c${index+1}`,action:{actor:'Thomas Hayes',intent:'investigate',goal,method:goal,skill:'Spot Hidden'}}));
      assert.ok(rolls.every(roll=>roll.outcome.passed));assert.equal(new Set(rolls.map(roll=>roll.receipt)).size,2);
      await client.ok('table.release',{campaign:'test-camp',release:'stranded'});
      stranded=readFileSync(join(workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8');
    }finally{await client.close();}
    process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',content]);
  }});
  let closed=false;t.after(async()=>{if(!closed)await table.dispose();});
  await table.session.prompt('I enter the permitted front room and take the deed found by the earlier shelf inspection, take one loose slip, and spend eight minutes.');
  assert.equal(states.length,1);assert.equal(states[0].clue.states,privateSummary,'the actual route packet retains its issued child clue after rollback');
  assert.deepEqual(Object.values(states[0].rolls).map(roll=>roll.goal),['Inspect the shelf boards for loose records','Watch the owner reaction']);
  assert.equal(requests,1);assert.deepEqual(table.extensionErrors,[]);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),publicText);
  assert.ok(seen.filter(frame=>frame.event==='delta').length>2);assert.equal(seen.at(-1)?.status,'completed');
  assert.equal(JSON.stringify(seen).includes('PRIVATE_ROUTE'),false);
  const dir=join(table.workspace,'.coc/campaigns/test-camp'),turn=JSON.parse(readFileSync(join(dir,'turns/0002.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.world.clock.minutes,8);
  for(const kind of ['move','clue','time','item','event'])assert.equal(turn.receipts.filter(receipt=>receipt.kind===kind).length,1,kind);
  assert.equal(turn.receipts.some(receipt=>receipt.kind==='roll'),false,'the route does not reroll settled observations');
  const clue=turn.receipts.find(receipt=>receipt.kind==='clue');
  assert.deepEqual(clue.check,{skill:'Library Use',difficulty:'regular'});
  assert.deepEqual(clue.found_by,{route:'fitting_check',roll:rolls[0].receipt,passed:true,turn:1,judged:'jev'});
  const telemetry=table.telemetry(),route=telemetry.find(row=>row.lane==='clue-route');
  assert.equal(route?.resent,true);assert.equal(route?.chosen,'fitting_check');
  assert.ok(telemetry.some(row=>row.lane==='kernel-rpc'&&row.method==='table.apply'&&row.ok===false),'the original transaction really refuses before its bounded read');
  const refusedApply=telemetry.find(row=>row.lane==='kernel-rpc'&&row.method==='table.apply'&&row.ok===false);
  const lookups=telemetry.filter(row=>row.lane==='kernel-rpc'&&row.method==='table.lookup'&&row.ok);
  assert.equal(lookups.filter(row=>row.ordinal<refusedApply.ordinal).length,1,'destination identity is read for consent before execution');
  assert.equal(lookups.filter(row=>row.ordinal>refusedApply.ordinal).length,1,'one issued clue basis is read after rollback');
  assert.equal(readFileSync(join(dir,'turns/0001.json'),'utf8'),stranded);
  const workspace=table.workspace;await table.dispose();closed=true;
  const restarted=new RpcClient(workspace,{content});t.after(()=>restarted.close());
  const next=await restarted.ok('table.player_input',{campaign:'test-camp',text:'I read the acquired deed and remember what I saw.'});
  assert.equal(next.capsule.where.scene,'route-inner-room');assert.equal(next.capsule.where.clock.minutes,8);
  const memory=await restarted.ok('table.recall',{campaign:'test-camp',what:'memory',about:['Thomas Hayes']});
  assert.ok(memory.hits.some(row=>row.statement==='A loose deed was found between shelf boards.'&&row.authority==='canonical_event'));
  assert.equal(readFileSync(join(dir,'turns/0001.json'),'utf8'),stranded);
  assert.equal(JSON.parse(readFileSync(join(dir,'turns/0002.json'),'utf8')).commit,turn.commit);
});

// Publish a generation fixture through the existing metadata fixture/manifest seam; never gameplay.
async function sourceAppendFixture(workspace) {
  const [{createKernelContext},{graphManifest},{scopedModuleRoot}]=await Promise.all([
    importSource('kernel-ts/context.ts'),importSource('kernel-ts/write/source.ts'),
    importSource('kernel-ts/modules/campaign-scope.ts'),
  ]);
  const context=await createKernelContext({workspace,content:join(root,'content')});
  const scoped=await scopedModuleRoot(context,'test-camp','the-haunting');
  const directory=join(scoped??join(workspace,'.coc/modules'),'the-haunting'),file=join(directory,'module.json');
  return ()=>{
    const meta=JSON.parse(readFileSync(file,'utf8')),before=meta.generation;
    const graph=JSON.parse(readFileSync(join(directory,meta.graph_file??'module-graph.json'),'utf8'));
    graph.nodes.push({node_id:'clue-published-append',node_kind:'clue',name:'Deferred source detail',
      properties:{description:'PRIVATE_APPENDED_SOURCE_DETAIL'},source_refs:[]});
    const generation=Number(before)+1,folder=join(directory,'generations',`generation-${generation}-fixture`);
    mkdirSync(folder,{recursive:true});const path=join(folder,'module-graph.json');
    writeFileSync(path,JSON.stringify(graph));
    writeFileSync(join(folder,'module-graph-manifest.json'),JSON.stringify(graphManifest(graph,'the-haunting',generation)));
    writeSourceMetadata(file,{...meta,generation,graph_file:relative(directory,path),
      graph_digest:createHash('sha256').update(readFileSync(path)).digest('hex')});
    return {before,after:generation};
  };
}

test('same Keeper publication survives a source append while retaining its original world and source binding',async t=>{
  let authors=0,advance,publish,worldBefore;
  const text='You finish waiting in the quiet office. '.repeat(4);
  const response={version:1,record:{effects:[{kind:'time',minutes:8}],event:{name:'source-append-reply',summary:'PRIVATE_SETTLED_CAUSE'}},text};
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(JSON.stringify(response));}],{
    onFrame:frame=>{if(frame.event==='delta'&&!advance){
      worldBefore=readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8');
      advance=publish();
      assert.equal(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'),worldBefore);
    }},
  });
  t.after(()=>table.dispose());
  publish=await sourceAppendFixture(table.workspace);
  const bridge=table.runtimeBridges().at(-1);
  const before=await bridge.call('table.capsule',{campaign:'test-camp',_context_read:true});
  await table.session.prompt('I wait eight minutes.');
  assert.equal(authors,1);assert(advance.after>advance.before);
  const packet=seen.find(frame=>frame.event==='start').delivery_id;
  const {evidence}=JSON.parse(readFileSync(join(table.workspace,'.coc/delivery-writes',packet,'accepted.json'),'utf8'));
  const current=await bridge.call('table.capsule',{campaign:'test-camp',_context_read:true});
  assert.equal(evidence.context.source_revision,before._context.task_source_revision);
  assert.notEqual(current._context.task_source_revision,evidence.context.source_revision);
  assert.equal(seen.filter(frame=>frame.status==='completed').length,1);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_APPENDED_SOURCE_DETAIL'));
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_SETTLED_CAUSE'));
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(turn.delivery_evidence.context.source_revision,evidence.context.source_revision,'source provenance is not rebound to unseen material');
  assert.equal(turn.delivery_evidence.publication.call_id,evidence.publication.call_id);
  assert.equal(JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes,8);
});

test('a sealed source-append packet survives restart while legacy and owner conflicts remain refused',async t=>{
  const retained=mkdtempSync(join(tmpdir(),'source-append-owner-fixture-'));
  t.after(()=>rmSync(retained,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const {table:first}=await directTable([],{retainAt:retained});let firstClosed=false;
  t.after(async()=>{if(!firstClosed)await first.dispose();});
  const firstBridge=first.runtimeBridges().at(-1);
  await firstBridge.call('table.player_input',{campaign:'test-camp',text:'I wait eight minutes.'});
  await firstBridge.call('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'time',minutes:8}]});
  const owner=createFinalOutputOwner({runtime:()=>({home:first.workspace}),call:firstBridge.call.bind(firstBridge),record:async()=>{}});
  const stream=await owner.openStream('test-camp',1,'sealed-source-fixture');stream.push('The office remains quiet.');
  const sealed=await stream.finish('fixture/keeper','low',{call_id:'t1-c2'});
  owner.finishStream(sealed.evidence,'publication_pending');
  const acceptedPath=join('.coc/delivery-writes',sealed.evidence.packet,'accepted.json');
  const accepted=readFileSync(join(first.workspace,acceptedPath),'utf8');
  const world=readFileSync(join(first.workspace,'.coc/campaigns/test-camp/world.json'),'utf8');
  (await sourceAppendFixture(first.workspace))();
  assert.equal(readFileSync(join(first.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'),world);
  await first.dispose();firstClosed=true;
  let authors=0;
  const copy=workspace=>cpSync(join(first.workspace,'.coc'),join(workspace,'.coc'),{recursive:true});
  const {table:restarted}=await directTable([()=>{authors++;return fauxAssistantMessage('UNAUTHORIZED_REAUTHOR');}],{
    seedCampaign:false,prepareWorkspace:copy,
  });t.after(()=>restarted.dispose());await waitForIdle(restarted.session);
  assert.equal(authors,0);assert.equal(readFileSync(join(restarted.workspace,acceptedPath),'utf8'),accepted);
  const bridge=restarted.runtimeBridges().at(-1);
  const pending=await createFinalOutputOwner({runtime:()=>({home:restarted.workspace}),call:bridge.call.bind(bridge),record:async()=>{}}).pendingPublication('test-camp');
  assert.deepEqual(pending,sealed);
  const params=evidence=>({campaign:'test-camp',...sealed.evidence.publication,text:sealed.text,_delivery_evidence:evidence});
  const legacy=structuredClone(sealed.evidence);delete legacy.author;
  await assert.rejects(bridge.call('table.narrate',params(legacy)),error=>error.code==='revision_conflict');
  for(const [field,value] of [['campaign','another-campaign'],['turn',2],['worldline','another-line'],['loop',1]]){
    const changed=structuredClone(sealed.evidence);changed.context[field]=value;
    await assert.rejects(bridge.call('table.narrate',params(changed)),error=>error.code==='revision_conflict',field);
  }
  const result=await bridge.call('table.narrate',params(sealed.evidence));assert.ok(result.commit);
  await bridge.call('table.narrate',params(sealed.evidence));
  const turn=JSON.parse(readFileSync(join(restarted.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.deepEqual(turn.delivery_evidence.context,sealed.evidence.context);
  assert.equal(readFileSync(join(restarted.workspace,acceptedPath),'utf8'),accepted);assert.equal(authors,0);
  // A separately copied pending fixture exercises a real later world write, never a rollback of the recovered one.
  const {table:changedWorld}=await directTable([],{seedCampaign:false,prepareWorkspace:copy});
  t.after(()=>changedWorld.dispose());const changedBridge=changedWorld.runtimeBridges().at(-1);
  await changedBridge.call('table.apply',{campaign:'test-camp',call_id:'t1-c3',effects:[{kind:'flag',name:'fixture-world-change',value:true}]});
  await assert.rejects(changedBridge.call('table.narrate',params(sealed.evidence)),error=>error.code==='revision_conflict');
  assert.equal(JSON.parse(readFileSync(join(changedWorld.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes,8);
});

for(const form of ['trailing brace','closed prelude'])test(`${form} publishes one Keeper body after settling its private record once`,async t=>{
  const text='You finish waiting. The office remains quiet. '.repeat(4);
  const response={version:1,record:{effects:[{kind:'time',minutes:8}],event:{name:'one-brace-reply',summary:'PRIVATE_ONE_BRACE_CAUSE'}},text};
  let authors=0,stateAtFirstDelta;
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(form==='trailing brace'
    ?JSON.stringify(response)+'}':JSON.stringify({version:1,record:response.record})+'\n{{public}}'+text);}],{
    onFrame:frame=>{if(frame.event==='delta'&&stateAtFirstDelta===undefined)
      stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;},
  });
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes.');
  assert.equal(authors,1);
  assert.equal(stateAtFirstDelta,8);
  assert.ok(seen.filter(frame=>frame.event==='delta').length>2);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.equal(seen.filter(frame=>frame.status==='completed').length,1);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_ONE_BRACE_CAUSE'));
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);
  assert.deepEqual(table.telemetry().filter(row=>row.tool==='apply').map(row=>row.ok),[true]);
  assert.equal(table.telemetry().filter(row=>row.lane==='kernel-rpc'&&row.method==='table.narrate'&&row.ok).length,1);
  assert.equal(turn.delivery_evidence.artifact_text,text);
  assert.deepEqual(table.extensionErrors,[]);
});

test('Keeper stream appears before its final message completes and contains no private record',async t=>{
  const {table,seen}=await directTable([fauxAssistantMessage(JSON.stringify({version:1,record:{event:{name:'quiet-reply',summary:'PRIVATE_CAUSAL_ACCOUNT'}},
    text:'The office remains quiet. You can continue asking the clerk about the house.'}))]);
  t.after(()=>table.dispose());
  let beforeEnd=false;
  table.session.subscribe(event=>{if(event.type==='message_end'&&event.message?.role==='assistant')beforeEnd=seen.some(frame=>frame.event==='delta');});
  await table.session.prompt('I wait for the clerk to answer.');
  assert.ok(beforeEnd);
  assert.ok(seen.filter(frame=>frame.event==='delta').length>1);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_CAUSAL_ACCOUNT'));
  assert.equal(seen.at(-1).status,'completed');
});

test('ordinary native prose uses one Keeper request and no JSON repair',async t=>{
  const text='The clerk answers directly. {{say:Steven Knott}}The father is at the sanitarium.{{/say}}';
  const {table,seen}=await directTable([fauxAssistantMessage('{{public}}'+text)]);
  t.after(()=>table.dispose());
  await table.session.prompt('Where is the father now?');
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.equal(seen.at(-1).status,'completed');
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,1);
  assert.deepEqual(table.extensionErrors,[]);
});

for(const form of ['compact','marker'])test(`a valid ${form} final response publishes once without its extra native proposal`,async t=>{
  const text='The office remains quiet. You can keep talking to the clerk.';
  const body=form==='compact'?JSON.stringify({version:1,record:{effects:[{kind:'time',minutes:8}]},text}):'{{public}}'+text;
  const {table,seen}=await directTable([fauxAssistantMessage([
    fauxText(body),fauxToolCall('apply',{effects:[{kind:'time',minutes:2}]}),
  ],{stopReason:'toolUse'}),fauxAssistantMessage('{{public}}UNEXPECTED_SECOND_REPLY')]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait for eight minutes and listen to the clerk.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,form==='compact'?8:0,'the native proposal cannot add time after final delivery began');
  assert.ok(turn.commit,'the original complete final body has one canonical commit');
  assert.equal(turn.delivery_evidence.artifact_text,text);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,form==='compact'?1:0);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.equal(new Set(seen.map(frame=>frame.delivery_id)).size,1);
  assert.deepEqual(seen.filter(frame=>frame.event==='end').map(frame=>frame.status),['finalizing','completed']);
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,1,'no correction inference is needed');
  assert.equal(table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply').length,0);
  assert.deepEqual(table.extensionErrors,[]);
});

test('ordinary private tool-side text still executes and continues from the real result',async t=>{
  const text='You finish waiting in the office.';
  let received=false;
  const {table,seen}=await directTable([fauxAssistantMessage([
    fauxText('PRIVATE_TOOL_SIDE_EXPLANATION'),fauxToolCall('apply',{effects:[{kind:'time',minutes:8}]}),
  ],{stopReason:'toolUse'}),context=>{
    received=context.messages.some(message=>message.role==='toolResult'&&message.toolName==='apply'&&!message.isError);
    return fauxAssistantMessage('{{public}}'+text);
  }]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(received);
  assert.ok(turn.commit);
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,2,'one tool request and its normal final continuation');
  assert.deepEqual(table.telemetry().filter(row=>row.reason==='text_beside_tool_calls').map(row=>row.calls),[[{tool:'apply',outcome:'landed'}]]);
  assert.deepEqual(table.extensionErrors,[]);
});

test('a malformed final body cannot add a native proposal after its record settled',async t=>{
  const record={effects:[{kind:'time',minutes:8}]},text='After waiting, you speak again.';
  const malformed='{"version":1,"record":'+JSON.stringify(record)+' '.repeat(80)+';"text":"PRIVATE_MALFORMED_BODY"}';
  const {table,seen}=await directTable([fauxAssistantMessage([
    fauxText(malformed),fauxToolCall('apply',{effects:[{kind:'time',minutes:2}]}),
  ],{stopReason:'toolUse'}),()=>{
    assert.equal(seen.length,0,'the bad body remains private');
    assert.equal(JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes,8);
    return fauxAssistantMessage(JSON.stringify({version:1,record,text}));
  }]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes before speaking.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(turn.delivery_evidence.artifact_text,text);
  assert.equal(table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply').length,0);
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,2,'only the original malformed-body repair');
  assert.equal(new Set(seen.map(frame=>frame.delivery_id)).size,1);
  assert.deepEqual(table.extensionErrors,[]);
});

test('an interrupted final body preserves its prefix without executing its extra proposal',async t=>{
  const text='The office remains quiet. You wait patiently.';
  const {table,seen}=await directTable([fauxAssistantMessage([
    fauxText(JSON.stringify({version:1,record:{effects:[{kind:'time',minutes:8}]},text})),
    fauxToolCall('apply',{effects:[{kind:'time',minutes:2}]}),
  ],{stopReason:'length'}),fauxAssistantMessage('{{public}}UNEXPECTED_SECOND_REPLY')]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait quietly for eight minutes.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.ok(!turn.commit,'an interrupted response is not a completed delivery');
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.deepEqual(seen.filter(frame=>frame.event==='end').map(frame=>frame.status),['interrupted']);
  assert.equal(table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply').length,0);
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,1);
  assert.deepEqual(table.extensionErrors,[]);
});

test('a rejected inline record returns the actual kernel correction without candidate public bytes',async t=>{
  const bad={version:1,record:{effects:[{kind:'time',minutes:8}],event:{name:'answer',summary:'The clerk answers.',
    knowledge:[{actor:'Unregistered fixture person',statement:'The clerk is present.',mode:'observed',state:'accurate'}]}},text:'REJECTED_PRIVATE_CANDIDATE'};
  const good=structuredClone(bad);good.record.event.knowledge[0].actor='Thomas Hayes';good.text='The clerk is still present.';
  let correction;
  const {table,seen}=await directTable([fauxAssistantMessage(JSON.stringify(bad)),context=>{
    assert.equal(seen.length,0,'the rejected record never starts a public stream');
    correction=JSON.stringify(context.messages);
    return fauxAssistantMessage(JSON.stringify(good));
  }],{decision:checkedRecovery});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes and watch the clerk.');
  assert.ok(correction.includes('invalid_params'));
  assert.ok(correction.includes('Invalid event unknown actor Unregistered fixture person'));
  assert.ok(correction.includes('exact supplied id'));
  assert.ok(correction.includes('semantic handle'));
  assert.ok(correction.includes('actors')&&correction.includes('walk_on'));
  assert.ok(!correction.includes('REJECTED_PRIVATE_CANDIDATE'));
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),good.text);
  assert.equal(seen.at(-1)?.status,'completed');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,8,'the refused transaction is atomic');
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  const applies=table.telemetry().filter(row=>row.tool==='apply');
  assert.deepEqual(applies.map(row=>row.ok),[false,true]);
  assert.equal(applies[0].call_id,applies[1].call_id,'validation failure does not consume the run record identity');
  assert.deepEqual(table.extensionErrors,[]);
});

test('a refused legacy final can recover through native tools without spending another final correction',async t=>{
  const rejected='PRIVATE_REFUSED_FINAL',text='You finish waiting beside the desk.';
  let requests=0,refusalReturned=false;
  const {table,seen}=await directTable([
    ()=>{requests++;return fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[{kind:'time',minutes:-1}]},text:rejected}));},
    context=>{
      requests++;
      assert.ok(JSON.stringify(context.messages).includes('ordinary apply first'), 'the current native correction still offers explicit tools');
      assert.equal(seen.length,0);
      return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:-1}]})],{stopReason:'toolUse'});
    },
    context=>{
      requests++;
      refusalReturned=context.messages.some(message=>message.role==='toolResult'&&message.isError===true);
      assert.ok(refusalReturned,'the same Keeper receives the actual native refusal');
      return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:8}]})],{stopReason:'toolUse'});
    },
    context=>{
      requests++;
      assert.ok(context.messages.some(message=>message.role==='toolResult'&&message.isError!==true));
      return fauxAssistantMessage('{{public}}'+text);
    },
  ],{decision:checkedRecovery});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes beside the desk.');
  assert.equal(requests,4);
  assert.deepEqual(table.telemetry().filter(row=>row.tool==='apply').map(row=>row.ok),[false,false,true]);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.equal(seen.at(-1)?.status,'completed');
  assert.ok(!JSON.stringify(seen).includes(rejected));
  assert.equal(table.telemetry().filter(row=>row.lane==='turn'&&row.event==='turn_close'&&row.status==='steer').length,1);
  assert.deepEqual(table.extensionErrors,[]);
});

test('a misplaced record text receives the precise sibling correction before one settled public delivery',async t=>{
  const effects=[{kind:'time',minutes:8}];
  let requests=0,stateAtFirstDelta,correction,refused;
  const {table,seen}=await directTable([()=>{requests++;return fauxAssistantMessage(JSON.stringify({version:1,
    record:{effects,text:'PRIVATE_NESTED_CANDIDATE'}}));},context=>{
    requests++;
    const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
    refused={publicFrames:seen.length,applies:table.telemetry().filter(row=>row.tool==='apply').length,minutes:world.clock.minutes};
    correction=JSON.stringify(context.messages);
    return fauxAssistantMessage(JSON.stringify({version:1,record:{effects},text:'You finish waiting.'}));
  }],{onFrame:frame=>{if(frame.event==='delta'&&stateAtFirstDelta===undefined)
    stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;}});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes.');
  assert.equal(requests,2,'the same Keeper corrects its existing response');
  assert.deepEqual(refused,{publicFrames:0,applies:0,minutes:0},'shape refusal precedes all effects and public bytes');
  assert.ok(correction.includes('record.text')&&correction.includes('root.text'));
  assert.ok(correction.includes('sibling'));
  assert.ok(correction.includes('effects, event, scope, choice'));
  assert.ok(!correction.includes('PRIVATE_NESTED_CANDIDATE'));
  assert.equal(stateAtFirstDelta,8,'effects settle before public streaming');
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),'You finish waiting.');
  assert.equal(seen.at(-1)?.status,'completed');
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_NESTED_CANDIDATE'));
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.deepEqual(table.telemetry().filter(row=>row.tool==='apply').map(row=>row.ok),[true]);
  assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0);
  assert.deepEqual(table.extensionErrors,[]);
});

test('an unmarked final response receives the public-marker correction after its effects settled once',async t=>{
  // The provider is deterministic; Pi, RunDriver and the native kernel are real, not live-play acceptance.
  const rejected='PRIVATE_UNMARKED_FINAL_CANDIDATE',text='You finish waiting beside the desk.';
  let requests=0,correction,stateAtFirstDelta,firstReply,carriedUserText;
  const {table,seen}=await directTable([()=>{
    requests++;
    return fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:8}]})],{stopReason:'toolUse'});
  },context=>{
    requests++;
    carriedUserText=new Set(context.messages.filter(message=>message.role==='user').flatMap(message=>
      typeof message.content==='string'?[message.content]:message.content.filter(block=>block.type==='text').map(block=>block.text)));
    firstReply={publicFrames:seen.length,minutes:JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes};
    return fauxAssistantMessage(rejected);
  },context=>{
    requests++;
    correction=context.messages.filter(message=>message.role==='user').flatMap(message=>
      typeof message.content==='string'?[message.content]:message.content.filter(block=>block.type==='text').map(block=>block.text))
      .filter(text=>!carriedUserText.has(text)&&text.includes('{{public}}')).join('\n');
    return fauxAssistantMessage('{{public}}'+text);
  }],{onFrame:frame=>{if(frame.event==='delta'&&stateAtFirstDelta===undefined)
    stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;}});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes beside the desk.');
  assert.match(correction,/public marker/i,'the real correction identifies the missing public marker');
  assert.match(correction,/\{\{public\}\}/);
  assert.doesNotMatch(correction,/record\.text is invalid/,'ordinary unmarked prose is not a nested-record error');
  assert.ok(!correction.includes(rejected),'the correction does not quote the private rejected candidate');
  assert.equal(requests,3,'one tool inference, one rejected final and the existing single correction');
  assert.deepEqual(firstReply,{publicFrames:0,minutes:8});
  assert.equal(stateAtFirstDelta,8);
  assert.ok(seen.filter(frame=>frame.event==='delta').length>2,'the corrected prose streams incrementally');
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.ok(!JSON.stringify(seen).includes(rejected));
  assert.equal(seen.at(-1)?.status,'completed');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  const telemetry=table.telemetry();
  assert.deepEqual(telemetry.filter(row=>row.tool==='apply').map(row=>row.ok),[true]);
  assert.equal(telemetry.filter(row=>row.lane==='provider-call').length,3);
  assert.equal(telemetry.filter(row=>row.lane==='keeper-delivery'&&row.ok===false).length,1);
  assert.equal(telemetry.filter(row=>row.lane==='turn'&&row.event==='turn_close'&&row.status==='steer').length,1);
  assert.equal(telemetry.filter(row=>row.lane==='final-output'&&row.event==='start').length,0,'no separate author is invoked');
  assert.deepEqual(table.extensionErrors,[]);
});

test('an accepted inline prefix replays after a malformed body and refreshes the same Keeper state',async t=>{
  const record={effects:[{kind:'time',minutes:8}],event:{name:'wait-once',summary:'The visitor waits.'}};
  // The completed record reaches the kernel before a later streamed chunk supplies the bad separator.
  const malformed='{"version":1,"record":'+JSON.stringify(record)+' '.repeat(80)+';"text":"UNDELIVERED_PRIVATE_CANDIDATE"}';
  let stateAtFirstDelta,wireClocks=[],latestClock;
  const {table,seen}=await directTable([fauxAssistantMessage(malformed),context=>{
    assert.equal(seen.length,0,'the malformed separator precedes all public bytes');
    const messages=context.messages.map(message=>typeof message.content==='string'?message.content
      :(message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join(''));
    for(const text of messages){try{const value=JSON.parse(text);if(value.where?.clock)wireClocks.push(value.where.clock.minutes);
      const where=value.kind==='capsule_update'?value.sections?.where:value.where;
      if(where?.clock){latestClock=where.clock.minutes;wireClocks.push(latestClock);}}catch{}}
    return fauxAssistantMessage(JSON.stringify({version:1,record,text:'After waiting, the visitor speaks again.'}));
  }],{onFrame:frame=>{if(frame.event==='delta'&&stateAtFirstDelta===undefined)
    stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;}});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes before speaking again.');
  assert.equal(stateAtFirstDelta,8,'the record is settled before the first public delta');
  assert.equal(latestClock,8,`the corrected inference receives current canonical clock, got ${JSON.stringify(wireClocks)}`);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(turn.world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);
  const applies=table.telemetry().filter(row=>row.tool==='apply'&&row.ok);
  assert.equal(applies.length,2,'the second attempt is a kernel replay');
  assert.equal(applies[0].call_id,applies[1].call_id);
  assert.deepEqual(turn.calls[applies[0].call_id].result.receipts,turn.receipts.map(row=>row.id));
  assert.ok(table.mechanics().some(card=>card.mechanics.some(row=>row.kind==='time')));
  assert.equal(seen.at(-1)?.status,'completed');
  assert.deepEqual(table.extensionErrors,[]);
});

test('changing an accepted inline record keeps the original settlement and returns idempotency conflict',async t=>{
  const record={effects:[{kind:'time',minutes:8}]};
  const malformed='{"version":1,"record":'+JSON.stringify(record)+' '.repeat(80)+';"text":"PRIVATE_FIRST_CANDIDATE"}';
  const {table,seen}=await directTable([fauxAssistantMessage(malformed),fauxAssistantMessage(JSON.stringify({version:1,
    record:{effects:[{kind:'time',minutes:9}]},text:'PRIVATE_CHANGED_CANDIDATE'}))]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes.');
  const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(world.clock.minutes,8);
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  const applies=table.telemetry().filter(row=>row.tool==='apply');
  assert.deepEqual(applies.map(row=>row.ok),[true,false]);
  assert.equal(applies[1].code,'idempotency_conflict');
  assert.equal(applies[0].call_id,applies[1].call_id);
  assert.equal(seen.length,0,'neither invalid reply is a public artifact');
  assert.deepEqual(table.extensionErrors,[]);
});

test('an accepted physical move replays before arrival without repeating its travel time',async t=>{
  const record={effects:[{kind:'move',to:'hall-of-records',via:'Walking to the Hall of Records.',travel_minutes:8}]};
  const malformed='{"version":1,"record":'+JSON.stringify(record)+' '.repeat(80)+';"text":"PRIVATE_ARRIVAL_CANDIDATE"}';
  let stateAtFirstDelta;
  const {table,seen}=await directTable([fauxAssistantMessage(malformed),fauxAssistantMessage(JSON.stringify({version:1,
    record,text:'You arrive at the Hall of Records.'}))],{onFrame:frame=>{if(frame.event==='delta'&&!stateAtFirstDelta)
      stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));}});
  t.after(()=>table.dispose());
  await table.session.prompt('I walk to the Hall of Records.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
  const movement=turn.receipts.filter(row=>row.kind==='move');
  assert.equal(movement.length,1);
  assert.equal(stateAtFirstDelta.active_scene,world.active_scene,'arrival is based on the settled move');
  assert.equal(world.active_scene,'hall-of-records');
  assert.equal(stateAtFirstDelta.clock.minutes,8);
  assert.equal(turn.world.clock.minutes,8,'the replay does not charge the journey twice');
  const applies=table.telemetry().filter(row=>row.tool==='apply'&&row.ok);
  assert.equal(applies.length,2);
  assert.equal(applies[0].call_id,applies[1].call_id);
  assert.equal(seen.at(-1)?.status,'completed');
  assert.deepEqual(table.extensionErrors,[]);
});

test('completed source consultations reach the same Keeper without another classifier or waiting stage',async t=>{
  let received=false;
  const {table,seen}=await directTable([context=>{
    received=JSON.stringify(context.messages).includes('PRIVATE_SOURCE_ANSWER');
    return fauxAssistantMessage('{{public}}The clerk gives the publicly known answer.');
  }],{extraExtensions:[{name:'ready-source',factory:pi=>pi.on('session_start',()=>pi.events.emit('coc:source-answers',{
    campaign:'test-camp',take:()=>({pending:[],landed:[{focus:'office',question:'What is recorded?',since_turn:0,
      answer:{status:'answered',answer:'PRIVATE_SOURCE_ANSWER',source_refs:[],authority:'source-consultation',supported:true}}]})
  }))}]});
  t.after(()=>table.dispose());
  await table.session.prompt('What was recorded?');
  assert.ok(received);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_SOURCE_ANSWER'));
});

test('interrupted Keeper output retains its prefix without completing a disclosure',async t=>{
  let active,stopped=false;
  const {table,seen}=await directTable([fauxAssistantMessage(JSON.stringify({version:1,text:'The office is quiet. '.repeat(100)}))],{
    onFrame:frame=>{if(!stopped&&frame.event==='delta'){stopped=true;void active.session.abort();}},
  });active=table;
  t.after(()=>table.dispose());
  await table.session.prompt('I wait.');
  assert.ok(seen.some(frame=>frame.event==='delta'));
  assert.ok(!seen.some(frame=>frame.status==='completed'));
  const owner=createFinalOutputOwner({runtime:()=>({home:table.workspace}),call:async()=>({}),record:async()=>{}});
  const recovery=await owner.recoveries('test-camp');
  assert.equal(recovery.at(-1).status,'interrupted');
  assert.ok(recovery.at(-1).text.length>0);
});

test('publication retries the same Keeper bytes without another author or state application',async t=>{
  const response=JSON.stringify({version:1,record:{event:{name:'quiet-office',summary:'The visitor waits in the office.'}},text:'The office remains quiet.'});
  const {table,seen}=await directTable([fauxAssistantMessage(response)],{prepareWorkspace:workspace=>{
    seedOpening(workspace);
    const hook=join(workspace,'.coc/repos/test-camp.git/hooks/pre-commit');
    writeFileSync(hook,'#!/bin/sh\nmarker="$(git rev-parse --git-dir)/commit-once"\nif test -e "$marker"; then exit 0; fi\ntouch "$marker"\nexit 1\n');chmodSync(hook,0o700);
  }});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait.');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),'The office remains quiet.');
  assert.equal(seen.at(-1).status,'completed');
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,1);
});

test('native name diagnostics preserve Keeper bytes without another author, action or inferred identity',async t=>{
  let authors=0;
  const text='Mr. Dooley waits beside you.';
  const response={version:1,record:{effects:[
    {kind:'person',who:'Mr. Dooley',name:'the newspaper seller'},
    {kind:'time',minutes:8},
  ]},text};
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(JSON.stringify(response));}],{
    prepareWorkspace:seedPrintedNames,
  });
  t.after(()=>table.dispose());
  await table.session.prompt('I wait beside the newspaper seller for eight minutes.');
  assert.equal(authors,1,'the same completed author response is published');
  const names=table.telemetry().filter(row=>row.lane==='delivery'&&row.reason==='untold_name');
  assert.deepEqual(names.map(row=>row.outcome),['diagnostic']);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit,'the current turn finishes without requiring another player input');
  assert.equal(turn.rendered_text,text);
  assert.ok(!turn.told_text.includes('Mr. Dooley'),'a narrative word alone does not identify its hidden owner');
  assert.equal(turn.told_lines,undefined);
  assert.equal(turn.world.clock.minutes,8,'the settled time is not applied twice');
  assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(table.telemetry().filter(row=>row.tool==='apply'&&row.ok).length,1);
  assert.equal(turn.delivery_evidence.publication.call_id,names[0].call_id);
  assert.equal(turn.delivery_evidence.artifact_text,text,'the sealed author artifact is unchanged');
  assert.equal(seen.filter(frame=>frame.event==='start').length,1);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text,
    'raw stream exposure is retained evidence, not a semantic secrecy guarantee');
  assert.equal(seen.at(-1).status,'completed');
  assert.equal(table.telemetry().filter(row=>row.reason==='turn_unfinished_notice').length,0);
  const untold=await table.runtimeBridges().at(-1).call('table.untold',{campaign:'test-camp'});
  assert.ok(untold.people.some(person=>person.name==='Mr. Dooley'),'diagnostics do not introduce the private identity');
});

test('a same-Keeper shared word commits and survives reopen without identifying either owner',async t=>{
  let authors=0;
  const response={version:1,record:{effects:[{kind:'person',who:'Mr. Dooley',name:'the newspaper seller'},
    {kind:'person',who:'Arty Wilmot',name:'the editor'},{kind:'time',minutes:8}]},text:'Alex watches you.'};
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(JSON.stringify(response));}],{
    prepareWorkspace:workspace=>seedPrintedNames(workspace,true),
  });t.after(()=>table.dispose());
  await table.session.prompt('I wait beside the two men for eight minutes.');
  assert.equal(authors,1);assert.equal(seen.at(-1).status,'completed');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.rendered_text,response.text);
  assert.equal(turn.world.clock.minutes,8);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.ok(!turn.told_text.includes('Alex'));assert.equal(turn.told_lines,undefined);
  const bridge=table.runtimeBridges().at(-1);await bridge.call('table.open',{campaign:'test-camp'});
  const untold=await bridge.call('table.untold',{campaign:'test-camp'});
  assert.ok(untold.protected.includes('Alex'));
  assert.ok(untold.people.some(person=>person.name==='Mr. Dooley'));
  assert.ok(untold.people.some(person=>person.name==='Arty Wilmot'));
  assert.deepEqual((await bridge.call('table.untold_spans',{campaign:'test-camp',text:'Alex is the word you heard.'})).spans,[]);
  assert.deepEqual(table.telemetry().filter(row=>row.lane==='delivery'&&row.reason==='untold_name').map(row=>({outcome:row.outcome,shared:row.shared})),
    [{outcome:'diagnostic',shared:1}]);
});

test('an explicit introduction survives beside an unresolved shared-name marker',async t=>{
  const response={version:1,record:{effects:[{kind:'person',who:'Steven Knott',name:'the clerk'}]},
    text:'{{name:the clerk}} introduces himself. {{name:Alex}} remains unidentified.'};
  const {table,seen}=await directTable([fauxAssistantMessage(JSON.stringify(response))],{
    prepareWorkspace:workspace=>seedPrintedNames(workspace,true),
  });t.after(()=>table.dispose());
  await table.session.prompt('I ask the clerk to introduce himself, then recall the unclear name.');
  assert.equal(seen.at(-1).status,'completed');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.ok(turn.rendered_text.includes('Steven Knott'));
  assert.ok(turn.told_text.includes('Steven Knott'),'the explicit introduction remains identity evidence');
  assert.ok(!turn.told_text.includes('Alex'),'the unresolved word identifies neither owner');
  const untold=await table.runtimeBridges().at(-1).call('table.untold',{campaign:'test-camp'});
  assert.ok(!untold.people.some(person=>person.name==='Steven Knott'));
  assert.ok(untold.people.some(person=>person.name==='Mr. Dooley'));
  assert.ok(untold.people.some(person=>person.name==='Arty Wilmot'));
});

test('a real publication failure holds settled state and stops another Keeper inference',async t=>{
  let authors=0;
  const response={version:1,record:{effects:[
    {kind:'person',who:'Mr. Dooley',name:'the newspaper seller'},
    {kind:'person',who:'Arty Wilmot',name:'the editor'},
    {kind:'time',minutes:8},
  ]},text:'Alex watches you.'};
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(JSON.stringify(response));},()=>{
    authors++;return fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[{kind:'time',minutes:3}]},text:'UNACCEPTED_NEW_ACTION'}));
  }],{
    prepareWorkspace:workspace=>{
      seedPrintedNames(workspace,true);
      const hook=join(workspace,'.coc/repos/test-camp.git/hooks/pre-commit');
      writeFileSync(hook,'#!/bin/sh\nexit 1\n');chmodSync(hook,0o700);
    },
  });
  t.after(()=>table.dispose());
  await table.session.prompt('I wait beside the two men for eight minutes.');
  assert.equal(authors,1);
  const names=table.telemetry().filter(row=>row.lane==='delivery'&&row.reason==='untold_name');
  assert.ok(names.length>0);assert.ok(names.every(row=>row.outcome==='diagnostic'&&row.shared===1));
  assert.ok(table.telemetry().some(row=>row.tool&&row.ok===false&&row.code==='commit_failed'));
  assert.equal(seen.at(-1).status,'publication_pending');
  assert.equal(table.telemetry().filter(row=>row.tool==='apply'&&row.ok).length,1);
  const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(status.state,'acting');
  const exposed=seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join('');
  await table.session.prompt('I walk toward the gate.');
  assert.equal(authors,1,'an ended input must not start another Keeper inference');
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,1);
  assert.equal(table.telemetry().filter(row=>row.tool==='apply'&&row.ok).length,1);
  const later=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(later.state,'acting');
  assert.equal(later.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),exposed,
    'the rejected recovery adds no new public text');
});

test('session startup preserves a sealed pending publication without another Keeper or settlement',async t=>{
  const retained=mkdtempSync(join(tmpdir(),'publication-startup-fixture-'));
  t.after(()=>rmSync(retained,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  let firstAuthors=0,firstClosed=false;
  const response={version:1,record:{effects:[
    {kind:'person',who:'Mr. Dooley',name:'the newspaper seller'},
    {kind:'person',who:'Arty Wilmot',name:'the editor'},
    {kind:'time',minutes:8},
  ]},text:'Alex watches you.'};
  const {table:first}=await directTable([()=>{firstAuthors++;return fauxAssistantMessage(JSON.stringify(response));}],{
    retainAt:retained,prepareWorkspace:workspace=>{
      seedPrintedNames(workspace,true);
      const hook=join(workspace,'.coc/repos/test-camp.git/hooks/pre-commit');
      writeFileSync(hook,'#!/bin/sh\nexit 1\n');chmodSync(hook,0o700);
    },
  });
  t.after(async()=>{if(!firstClosed)await first.dispose();});
  await first.session.prompt('I wait beside the two men for eight minutes.');
  assert.equal(firstAuthors,1);
  const owner=createFinalOutputOwner({runtime:()=>({home:first.workspace}),call:async()=>({}),record:async()=>{}});
  const pending=await owner.pendingPublication('test-camp');
  assert.ok(pending);
  assert.equal(pending.evidence.publication.call_id,'t1-c2');
  const acceptedPath=join('.coc/delivery-writes',pending.evidence.packet,'accepted.json');
  const accepted=readFileSync(join(first.workspace,acceptedPath),'utf8');
  const prefix=(await owner.recoveries('test-camp'))[0].text;
  const before=await first.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(before.state,'acting');
  assert.equal(before.receipts.filter(row=>row.kind==='time').length,1);
  await first.dispose();firstClosed=true;
  let laterAuthors=0;
  const {table:restarted,seen}=await directTable([()=>{
    laterAuthors++;return fauxAssistantMessage(JSON.stringify({version:1,text:'UNAUTHORIZED_STARTUP_REAUTHOR'}));
  }],{seedCampaign:false,prepareWorkspace:workspace=>{
    // Copy only the explicit isolated fixture above; this is process-start integration, never gameplay.
    cpSync(join(first.workspace,'.coc'),join(workspace,'.coc'),{recursive:true});
  }});
  t.after(()=>restarted.dispose());
  await waitForIdle(restarted.session);
  assert.equal(laterAuthors,0,'startup must leave the sealed packet to exact-publication recovery');
  assert.equal(seen.length,0,'startup cannot expose a new author response');
  assert.equal(readFileSync(join(restarted.workspace,acceptedPath),'utf8'),accepted);
  const restoredOwner=createFinalOutputOwner({runtime:()=>({home:restarted.workspace}),call:async()=>({}),record:async()=>{}});
  assert.deepEqual(await restoredOwner.pendingPublication('test-camp'),pending);
  assert.equal((await restoredOwner.recoveries('test-camp'))[0].text,prefix);
  const failuresBefore=restarted.telemetry().filter(row=>row.tool&&row.ok===false&&row.code==='commit_failed').length;
  await restarted.session.prompt('I walk toward the gate.');
  assert.equal(laterAuthors,0,'failed exact recovery must precede and stop the next player action');
  assert.equal(restarted.telemetry().filter(row=>row.lane==='provider-call').length,
    first.telemetry().filter(row=>row.lane==='provider-call').length);
  assert.equal(readFileSync(join(restarted.workspace,acceptedPath),'utf8'),accepted);
  assert.deepEqual(await restoredOwner.pendingPublication('test-camp'),pending);
  const failures=restarted.telemetry().filter(row=>row.tool&&row.ok===false&&row.code==='commit_failed');
  assert.ok(failures.length>failuresBefore,'the actual recovery retries the original publication');
  assert.ok(failures.length<=failuresBefore+2,'the existing retry allowance is not enlarged');
  assert.equal(failures.at(-1).call_id,pending.evidence.publication.call_id);
  assert.equal(failures.at(-1).code,'commit_failed','a real transaction failure remains authoritative');
  const after=await restarted.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(after.turn,before.turn);
  assert.equal(after.state,'acting');
  assert.equal(after.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(JSON.parse(readFileSync(join(restarted.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes,8);
  assert.deepEqual(restarted.extensionErrors,[]);
});

test('a committed alternate canonical packet closes old recovery projections without changing their evidence',async t=>{
  const home=mkdtempSync(join(tmpdir(),'publication-owner-fixture-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const owner=createFinalOutputOwner({runtime:()=>({home}),record:async()=>{},call:async method=>{
    if(method==='table.capsule')return {_context:{campaign:'test-camp',turn:1,worldline:'main',loop:'fixture-loop',
      task_world_revision:'fixture-world',task_source_revision:'fixture-source'},turn:{player_text:'Fixture input'},present:[]};
    if(method==='table.delivery.check')return {speakers:[]};
    return {outcome:{public_materials:[]}};
  }});
  const stream=await owner.openStream('test-camp',1,'fixture-run');
  stream.push('An already exposed fixture prefix.');
  const sealed=await stream.finish('fixture/model','none',{call_id:'t1-c2'});
  owner.finishStream(sealed.evidence,'publication_pending');
  const directory=join(home,'.coc/delivery-writes',sealed.evidence.packet);
  const accepted=readFileSync(join(directory,'accepted.json'),'utf8'),journal=readFileSync(join(directory,'delivery.jsonl'),'utf8');
  const canonical=join(home,'.coc/campaigns/test-camp/turns/0001.json');mkdirSync(join(home,'.coc/campaigns/test-camp/turns'),{recursive:true});
  const alternate={campaign:'test-camp',turn:1,delivery_evidence:{packet:'f'.repeat(64)}};
  assert.notEqual(alternate.delivery_evidence.packet,sealed.evidence.packet);
  writeFileSync(canonical,JSON.stringify(alternate));
  assert.deepEqual(await owner.pendingPublication('test-camp'),sealed,'an uncommitted alternate does not close publication');
  assert.equal((await owner.recoveries('test-camp')).length,1);
  writeFileSync(canonical,JSON.stringify({...alternate,commit:'e'.repeat(40)}));
  assert.equal(await owner.pendingPublication('test-camp'),undefined,'canonical commit closes the same turn even with another packet');
  assert.deepEqual(await owner.recoveries('test-camp'),[],'obsolete prefix is not projected as active recovery');
  assert.equal(readFileSync(join(directory,'accepted.json'),'utf8'),accepted);
  assert.equal(readFileSync(join(directory,'delivery.jsonl'),'utf8'),journal,'old evidence is neither rewritten nor marked completed');
});

test('a planned intent survives the next response without becoming an attempted task',async t=>{
  const {table}=await directTable([fauxAssistantMessage(JSON.stringify({version:1,
    record:{effects:[{kind:'npc',name:'Steven Knott',intends:'Visit the house tomorrow.',outcome:'planned'}]},text:'The clerk leaves the decision with you.'})),
    fauxAssistantMessage(JSON.stringify({version:1,text:'The clerk waits for your answer.'}))]);
  t.after(()=>table.dispose());
  await table.session.prompt('Can we go to the house tomorrow?');
  await table.session.prompt('I consider that plan before answering.');
  const view=await table.runtimeBridges().at(-1).call('table.look',{campaign:'test-camp',focus:'npc',name:'Steven Knott'});
  assert.ok(JSON.stringify(view).includes('planned'));
  const first=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(first.receipts.filter(row=>row.kind==='time'||row.kind==='move').length,0);
});

test('an unspoken material stays pending even when the same NPC speaks',async t=>{
  const {table}=await directTable([fauxAssistantMessage(JSON.stringify({version:1,record:{event:{name:'limited-reply',summary:'The clerk offers one fact.',
    materials:[{name:'spoken',text:'The father left.',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']},
      {name:'omitted',text:'He went to a secret address.',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'The father left.',mode:'heard',state:'uncertain',source:'Steven Knott',material:'spoken'},
      {actor:'Thomas Hayes',statement:'He went to a secret address.',mode:'heard',state:'uncertain',source:'Steven Knott',material:'omitted'}]}},
    text:'{{say:Steven Knott}}The father left.{{/say}}'}))]);
  t.after(()=>table.dispose());
  await table.session.prompt('What do you know?');
  const memory=await table.runtimeBridges().at(-1).call('table.recall',{campaign:'test-camp',what:'memory',about:['Thomas Hayes']});
  assert.ok(memory.hits.some(row=>row.statement==='The father left.'&&row.authority==='canonical_event'));
  assert.ok(!memory.hits.some(row=>row.statement==='He went to a secret address.'&&row.authority==='canonical_event'));
});

test('optional Keeper quotations activate only the stated material across paragraphs and cold restart',async t=>{
  const retained=mkdtempSync(join(tmpdir(),'keeper-coverage-fixture-'));
  t.after(()=>rmSync(retained,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const text='{{say:Steven Knott}}I heard they went away.{{/say}}\n\n{{say:Steven Knott}}I was not there myself.{{/say}}';
  const response={version:1,record:{effects:[{kind:'time',minutes:8}],event:{name:'split-answer',summary:'PRIVATE_SPLIT_ACCOUNT',
    materials:[{name:'answer',text:'The family left; this is second-hand information.',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']},
      {name:'unspoken',text:'PRIVATE_UNSPOKEN_ADDRESS',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']}],
    knowledge:[{actor:'Thomas Hayes',statement:'The family left, according to Knott.',mode:'heard',state:'uncertain',source:'Steven Knott',material:'answer'},
      {actor:'Thomas Hayes',statement:'The undisclosed address.',mode:'heard',state:'uncertain',source:'Steven Knott',material:'unspoken'}]}},text,
    coverage:[{name:'answer',quote:'I heard they went away.'},{name:'answer',quote:'I was not there myself.'}]};
  let authors=0,closed=false;
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(JSON.stringify(response));}],{retainAt:retained});
  t.after(async()=>{if(!closed)await table.dispose();});
  await table.session.prompt('What did you hear about the family?');
  assert.equal(authors,1);assert.deepEqual(table.extensionErrors,[]);
  assert.equal(seen.at(-1)?.status,'completed');assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.ok(seen.filter(frame=>frame.event==='delta').length>2);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_SPLIT_ACCOUNT'));assert.ok(!JSON.stringify(seen).includes('PRIVATE_UNSPOKEN_ADDRESS'));
  const file=join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),turn=JSON.parse(readFileSync(file,'utf8'));
  assert.ok(turn.commit);assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(turn.world.clock.minutes,8);assert.equal(turn.disclosures.length,1);
  assert.deepEqual(turn.delivery_evidence.coverage.map(span=>turn.delivery_evidence.artifact_text.slice(span.start,span.end)),response.coverage.map(row=>row.quote));
  assert.deepEqual(turn.outcome.knowledge_changes.map(row=>row.status),['active','pending']);
  assert.deepEqual(table.telemetry().filter(row=>row.tool==='apply').map(row=>row.ok),[true]);
  assert.equal(table.telemetry().filter(row=>row.lane==='kernel-rpc'&&row.method==='table.narrate'&&row.ok).length,1);
  const original=readFileSync(file,'utf8');await table.dispose();closed=true;
  let laterAuthors=0,request;
  const {table:restarted}=await directTable([context=>{laterAuthors++;request=context;return fauxAssistantMessage('{{public}}The clerk waits for your next question.');}],
    {seedCampaign:false,prepareWorkspace:workspace=>cpSync(join(table.workspace,'.coc'),join(workspace,'.coc'),{recursive:true})});
  t.after(()=>restarted.dispose());
  await restarted.session.prompt('I remember that account before asking another question.');
  const bridge=restarted.runtimeBridges().at(-1),capsule=await bridge.call('table.capsule',{campaign:'test-camp',_context_read:true});
  assert.equal(laterAuthors,1);assert.ok(JSON.stringify(request.messages).includes('The family left, according to Knott.'));
  assert.deepEqual(capsule.player_knows.cognition.filter(row=>row.authority==='canonical_event').map(row=>row.statement),['The family left, according to Knott.']);
  const memory=await bridge.call('table.recall',{campaign:'test-camp',what:'memory',about:['Thomas Hayes']});
  assert.deepEqual(memory.hits.filter(row=>row.authority==='canonical_event').map(row=>row.statement),['The family left, according to Knott.']);
  assert.equal(readFileSync(join(restarted.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'),original);
  assert.equal(JSON.parse(readFileSync(join(restarted.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes,8);
});

test('invalid optional quotations remain advisory without disclosing private or ambiguous materials',async t=>{
  const speech=(name,text,visibility='player')=>({name,text,kind:'speech',visibility,speaker:'Steven Knott',audience:['Thomas Hayes']});
  const heard=name=>({actor:'Thomas Hayes',statement:'Unconfirmed '+name,mode:'heard',state:'uncertain',source:'Steven Knott',material:name});
  const text='{{say:Thomas Hayes}}That is my question.{{/say}}\n\n{{say:Steven Knott}}I have nothing else to add.{{/say}}';
  const response={version:1,record:{event:{name:'second-account',summary:'PRIVATE_OPTIONAL_ACCOUNT',
    materials:[speech('same','The second separate meaning.'),speech('wrong','The clerk supplied a different answer.'),speech('absent','An absent report.'),speech('secret','PRIVATE_OPTIONAL_SECRET','keeper')],
    knowledge:['same','wrong','absent'].map(heard)}},text,
    coverage:[{name:'same',quote:'I have nothing else to add.'},{name:'wrong',quote:'That is my question.'},
      {name:'absent',quote:'These words never appear.'},{name:'secret',quote:'I have nothing else to add.'},
      {name:'unknown',quote:'I have nothing else to add.'},null,{name:'wrong',quote:'I have nothing else to add.',start:0},
      {name:'absent',quote:'I have nothing else to add.',occurrence:-1}]};
  const {table,seen}=await directTable([fauxAssistantMessage([fauxToolCall('apply',{effects:[],event:{name:'first-account',
    materials:[speech('same','The first separate meaning.')],knowledge:[heard('same')]}})],{stopReason:'toolUse'}),fauxAssistantMessage(JSON.stringify(response))]);
  t.after(()=>table.dispose());await table.session.prompt('Please distinguish what you know from what I asked.');
  assert.deepEqual(table.extensionErrors,[]);assert.equal(seen.at(-1)?.status,'completed');
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.receipts.filter(row=>row.kind==='event').length,2,JSON.stringify(table.telemetry().filter(row=>row.ok===false)));
  assert.deepEqual(turn.delivery_evidence.coverage,[]);assert.deepEqual(turn.disclosures,[]);
  assert.equal(turn.delivery_evidence.materials.length,4);assert.ok(turn.delivery_evidence.materials.every(row=>row.visibility==='player'));
  assert.ok(turn.outcome.knowledge_changes.every(row=>row.status==='pending'));assert.equal(turn.outcome.knowledge_changes.length,4);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_OPTIONAL_SECRET'));assert.ok(!JSON.stringify(seen).includes('PRIVATE_OPTIONAL_ACCOUNT'));
  assert.equal(turn.receipts.filter(row=>row.kind==='time'||row.kind==='move').length,0);
  assert.equal(table.telemetry().filter(row=>row.lane==='kernel-rpc'&&row.method==='table.narrate'&&row.ok).length,1);
});

test('native speech aliases bind exact whole quotes to the same current actor across paragraphs',async t=>{
  const quotes=[
    ['public alias','I heard the family left.\n\nI did not see them leave.'],
    ['short alias','The archive is open.'],
    ['unknown speaker','This speaker is not registered.'],
    ['different speaker','That is the visitor speaking.'],
    ['split range','First fragment.{{/say}} {{say:steven-knott}}Second fragment.'],
    ['duplicate','The clerk repeats this.'],
    ['omitted','PRIVATE_UNSPOKEN_FACT'],
  ];
  const text='{{say:the office clerk}}'+quotes[0][1]+'{{/say}}\n\n'
    +'{{say:steven-knott}}'+quotes[1][1]+'{{/say}}\n\n'
    +'{{say:Unregistered speaker}}'+quotes[2][1]+'{{/say}}\n\n'
    +'{{say:Thomas Hayes}}'+quotes[3][1]+'{{/say}}\n\n'
    +'{{say:steven-knott}}'+quotes[4][1]+'{{/say}}\n\n'
    +'{{say:steven-knott}}'+quotes[5][1]+' '+quotes[5][1]+'{{/say}}';
  const response={version:1,record:{effects:[{kind:'person',who:'Steven Knott',name:'the office clerk'}],
    event:{name:'alias-reply',summary:'PRIVATE_CAUSAL_ACCOUNT',
      materials:quotes.map(([name,text])=>({name,text,kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']})),
      knowledge:quotes.map(([name])=>({actor:'Thomas Hayes',statement:'Acquired '+name,mode:'heard',state:'uncertain',source:'Steven Knott',material:name}))}},text};
  const {table,seen}=await directTable([fauxAssistantMessage(JSON.stringify(response)),fauxAssistantMessage('{{public}}The clerk waits for another question.')]);
  t.after(()=>table.dispose());
  await table.session.prompt('What did you hear, and can I use the archive?');
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(seen.at(-1)?.status,'completed',JSON.stringify(table.telemetry().filter(row=>row.ok===false||row.lane==='keeper-delivery')));
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.delivery_evidence.artifact_text,text,'identity resolution does not rewrite the author');
  assert.deepEqual(turn.delivery_evidence.coverage.map(row=>row.name.split('/').at(-1)),['public alias','short alias']);
  assert.equal(turn.speech.filter(row=>row.who.npc===turn.speech[0].who.npc)[0].text,quotes[0][1]);
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_CAUSAL_ACCOUNT'));
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_UNSPOKEN_FACT'));
  assert.ok(!JSON.stringify(seen.filter(frame=>frame.event==='start')).includes('Steven Knott'),
    'private canonical material names are not added to the public speaker roster');
  await table.session.prompt('I remember those answers before asking anything else.');
  const memory=await table.runtimeBridges().at(-1).call('table.recall',{campaign:'test-camp',what:'memory',about:['Thomas Hayes']});
  assert.deepEqual(memory.hits.filter(row=>row.authority==='canonical_event').map(row=>row.statement).sort(),
    ['Acquired public alias','Acquired short alias']);
  assert.deepEqual(table.extensionErrors,[]);
});

test('native public prose activates only the exact attributed speech settled by its preceding real apply',async t=>{
  const material=(name,text,visibility='player')=>({name,text,kind:'speech',visibility,speaker:'Steven Knott',audience:['Thomas Hayes']});
  const heard=name=>({actor:'Thomas Hayes',source:'Steven Knott',statement:'Heard '+name,mode:'heard',state:'uncertain',material:name});
  const text='{{say:Steven Knott}}I only heard that the family left.{{/say}}\n\n'
    +'{{say:Steven Knott}}The archive can help you.{{/say}}';
  const {table,seen}=await directTable([
    fauxAssistantMessage([fauxToolCall('apply',{effects:[],event:{name:'native-account',summary:'PRIVATE_NATIVE_CAUSE',
      materials:[material('exact','I only heard that the family left.'),material('changed','You should consult the archive.'),material('private','PRIVATE_NATIVE_SECRET','keeper')],
      knowledge:[heard('exact'),heard('changed')]}})],{stopReason:'toolUse'}),
    fauxAssistantMessage('{{public}}'+text),
  ]);
  t.after(()=>table.dispose());await table.session.prompt('What can you actually tell me?');
  assert.deepEqual(table.extensionErrors,[]);assert.equal(seen.at(-1)?.status,'completed');
  assert.equal(seen.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_NATIVE_CAUSE'));
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_NATIVE_SECRET'));
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);
  assert.deepEqual(turn.delivery_evidence.coverage.map(row=>row.name.split('/').at(-1)),['exact']);
  assert.deepEqual(turn.outcome.knowledge_changes.map(row=>({statement:row.statement,status:row.status})),
    [{statement:'Heard exact',status:'active'},{statement:'Heard changed',status:'pending'}]);
  const memory=await table.runtimeBridges().at(-1).call('table.recall',{campaign:'test-camp',what:'memory',about:['Thomas Hayes']});
  assert.deepEqual(memory.hits.filter(row=>row.authority==='canonical_event').map(row=>row.statement),['Heard exact']);
});

test('the first native stream catalog includes safe earlier-scene speech without disclosing private or corrected people',async t=>{
  const {table}=await directTable([],{prepareWorkspace:workspace=>{
    seedPrintedNames(workspace,true);
    process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',join(root,'content')]);
  }});
  t.after(()=>table.dispose());
  assert.deepEqual(table.extensionErrors,[]);
  const bridge=table.runtimeBridges().at(-1),campaign='test-camp';
  await bridge.call('table.player_input',{campaign,text:'I leave the office, go to the library and ask about public access.'});
  const speech=(name,speaker,visibility='player')=>({name,speaker,visibility,kind:'speech',text:'Words for '+name,audience:['Thomas Hayes']});
  await bridge.call('table.apply',{campaign,call_id:'t1-c1',effects:[],event:{name:'superseded-account',summary:'An earlier draft account.',
    materials:[speech('corrected-person','Arty Wilmot')]}});
  await bridge.call('table.apply',{campaign,call_id:'t1-c2',effects:[{kind:'move',to:'Central Library',minutes:30},
    {kind:'npc',name:'Public Librarian',walk_on:true,to:'here'},
    {kind:'person',who:'Mr. Dooley',name:'the porter'}],
    event:{name:'cross-scene-reply',summary:'The visitor leaves, travels and asks the librarian.',corrects:'event:t1:superseded-account',
      materials:[speech('farewell','Steven Knott'),speech('farewell-again','Steven Knott'),speech('answer','Public Librarian'),
        speech('anonymous','Mr. Dooley'),speech('private-person','Walter Corbitt','keeper')],
      knowledge:[{actor:'Thomas Hayes',source:'Steven Knott',statement:'The departure answer was heard.',mode:'heard',state:'uncertain',material:'farewell'}]}});
  const worldFile=join(table.workspace,'.coc/campaigns/test-camp/world.json'),turnFile=join(table.workspace,'.coc/campaigns/test-camp/turn.json');
  const worldBefore=readFileSync(worldFile,'utf8'),turnBefore=readFileSync(turnFile,'utf8');
  const frames=[],calls=[];
  const owner=createFinalOutputOwner({runtime:()=>({home:table.workspace}),record:async()=>{},stream:frame=>frames.push(frame),
    call:async(method,params)=>{calls.push(method);return bridge.call(method,params);}});
  const stream=await owner.openStream(campaign,1,'cross-scene-catalog-fixture');
  const start=frames.find(frame=>frame.event==='start');assert.ok(start);
  assert.deepEqual(start.speakers.map(row=>row.name).sort(),['Public Librarian','Steven Knott','the porter'].sort());
  const departure=start.speakers.find(row=>row.name==='Steven Knott'),arrival=start.speakers.find(row=>row.name==='Public Librarian');
  assert.ok(departure.who.npc);assert.ok(arrival.who.npc);assert.notEqual(departure.who.npc,arrival.who.npc);
  assert.equal(start.speakers.find(row=>row.name==='the porter').who.name,'the porter');
  assert.equal(JSON.stringify(start).includes('Mr. Dooley'),false);
  assert.equal(JSON.stringify(start).includes('Arty Wilmot'),false);
  assert.equal(JSON.stringify(start).includes('Walter Corbitt'),false);
  assert.equal(calls.filter(method=>method==='table.delivery.check').length,2,'freeze the world before the capsule, then prepare the speaker catalog');
  assert.equal(calls.includes('table.status'),false,'preparation does not add a status read');
  assert.equal(readFileSync(worldFile,'utf8'),worldBefore);
  assert.deepEqual(JSON.parse(readFileSync(turnFile,'utf8')),{...JSON.parse(turnBefore),delivery_frozen:true},'preparing identities only freezes background preparation; it neither publishes speech nor activates cognition');
  assert.equal(frames.filter(frame=>frame.event==='delta').length,0,'identities are prepared before prose');
  stream.interrupt();
  const checked=await bridge.call('table.delivery.check',{campaign,speakers:['Alex']});
  const shared=checked.speakers.find(row=>row.name==='Alex');
  assert.ok(shared);assert.equal(shared.who.label,'Alex');
  assert.equal(shared.who.npc,undefined,'a shared safe label must not select the first canonical speaker');
});

test('speech occurrence resolution reuses prepared identities and bounds missing aliases without public names',async t=>{
  const home=mkdtempSync(join(tmpdir(),'pi-coc-speech-identity-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const seen=[],checks=[];
  let statuses=0;
  const who={npc:'clerk',name:'Public clerk'};
  const materials=[{name:'known',kind:'speech',speaker:'Public clerk',text:'Known words.'},
    {name:'alias',kind:'speech',speaker:'PRIVATE_CANONICAL_NAME',text:'Alias words.'},
    {name:'ambiguous',kind:'speech',speaker:'PRIVATE_CANONICAL_NAME',text:'Shared words.'},
    {name:'overlong',kind:'speech',speaker:'L'.repeat(121),text:'Long name words.'}];
  for(const material of materials)material.visibility='player';
  const owner=createFinalOutputOwner({runtime:()=>({home}),record:async()=>{},stream:frame=>seen.push(frame),call:async(method,params)=>{
    if(method==='table.capsule')return {_context:{campaign:'fixture',turn:1,worldline:'main',loop:0,task_world_revision:'world',task_source_revision:'source'},
      present:[{name:'Public clerk'}],turn:{player_text:'What did you hear?'}};
    if(method==='table.status'){statuses++;return {outcome:{public_materials:materials}};}
    assert.equal(method,'table.delivery.check');
    if(params.speakers===undefined)return {speakers:[]};
    assert.ok(params.speakers.length<=48);
    assert.ok(params.speakers.every(name=>name.length<=120));
    checks.push(params.speakers);
    return {speakers:params.speakers.map(name=>({name,who:['Public clerk','Alias 0','PRIVATE_CANONICAL_NAME'].includes(name)?who:{label:name}}))};
  }});
  const reply=await owner.openStream('fixture',1,'run');
  const text='{{say:Public clerk}}Known words.{{/say}}{{say:Alias 0}}Alias words.{{/say}}'
    +'{{say:Shared speaker}}Shared words.{{/say}}'
    +'{{say:Alias 0}}Long name words.{{/say}}'
    +Array.from({length:49},(_,index)=>'{{say:Unknown '+index+'}}Unbound '+index+'.{{/say}}').join('');
  reply.push(text);
  const result=await reply.finish('fixture/model','off',{});
  assert.equal(result.text,text);
  assert.deepEqual(result.evidence.coverage.map(row=>row.name),['known','alias']);
  assert.equal(statuses,1);
  assert.deepEqual(checks.map(names=>names.length),[1,48,4]);
  assert.ok(checks.slice(1).every(names=>!names.includes('Public clerk')),'prepared canonical identity is reused');
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_CANONICAL_NAME'),'private resolution is not streamed');
  materials.length=0;
  const unchanged=await owner.openStream('fixture',1,'unchanged');
  unchanged.push('{{say:Another label}}An unchanged reply.{{/say}}');
  await unchanged.finish('fixture/model','off',{});
  assert.deepEqual(checks.map(names=>names.length),[1,48,4,1],'an unbound reply needs no additional alias read');
});

test('a direct mechanical choice remains pending across an OOC response',async t=>{
  const {table}=await directTable([
    fauxAssistantMessage(JSON.stringify({version:1,record:{choice:{kind:'mechanics',options:['accept','flee']}},text:'You pause before taking the risk.'})),
    fauxAssistantMessage(JSON.stringify({version:1,record:{scope:'reference'},text:'This is a rules explanation, not another action.'}))]);
  t.after(()=>table.dispose());
  await table.session.prompt('I pause before taking the risk.');
  const first=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(first.state,'asked');
  await table.session.prompt('OOC: explain the options without choosing.');
  const later=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
  assert.equal(later.state,'awaiting_player');
  assert.deepEqual(later.pending,first.pending);
  assert.deepEqual(table.extensionErrors,[]);
});

test('a failed reference publication recovers its exact text without turning into a world event',async t=>{
  const answer='The rule explanation changes no fictional state.';
  const {table,seen}=await directTable([fauxAssistantMessage('{{reference}}'+answer),fauxAssistantMessage('{{public}}The room remains quiet.')],{
    prepareWorkspace:workspace=>{
      seedOpening(workspace);
      const hook=join(workspace,'.coc/repos/test-camp.git/hooks/pre-commit');
      writeFileSync(hook,'#!/bin/sh\nexit 1\n');chmodSync(hook,0o700);
    },
  });
  t.after(()=>table.dispose());
  await table.session.prompt('OOC: explain the rule.');
  assert.equal(seen.at(-1).status,'publication_pending');
  await table.session.prompt('I wait for the explanation.');
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,1,
    'failed exact recovery ends that input before another author request');
  writeFileSync(join(table.workspace,'.coc/repos/test-camp.git/hooks/pre-commit'),'#!/bin/sh\nexit 0\n');
  await table.session.prompt('I wait quietly.');
  const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.equal(record.interaction_scope,'reference');
  assert.equal(record.rendered_text,answer);
  assert.ok(record.commit);
  assert.equal(record.receipts.length,0);
  assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,2,JSON.stringify(table.telemetry().filter(row=>['provider-call','keeper-delivery','turn'].includes(row.lane))));
});

test('the final provider request retains current prepended Keeper instructions and actor context',async t=>{
 let request;
 const {table}=await directTable([context=>{request=context;return fauxAssistantMessage('{{public}}The clerk answers.');}],
   {systemPrompt:readFileSync(join(root,'prompts/keeper.md'),'utf8')});
 t.after(()=>table.dispose());
 await table.session.prompt('I ask the clerk what happened.');
 const text=JSON.stringify(request.messages);
 assert.match(text,/You are the sole Keeper and author/);
 assert.match(text,/Keeper-only current state and actor perspectives/);
 assert.equal(/bare JSON object in version, record, text order/.test(text),false,
   'the actual higher-priority request must not redirect unsettled actions into final delivery');
 const paragraphs=[];
 const collect=value=>{if(typeof value==='string')paragraphs.push(...value.split(/\n\s*\n/));else if(value&&typeof value==='object')for(const item of Object.values(value))collect(item);};
 collect(request.messages);
 const retired=value=>/Example:.*version.*record.*effects/s.test(value);
 assert(retired('Example: {"version":1,"record":{"effects":[]},"text":"Reply"}'),'the guard still catches the retired inline settlement');
 assert.equal(['Example: place action move','version record effects'].some(retired),false,'separate tool examples cannot form a synthetic retired instruction');
 assert.equal(paragraphs.some(retired),false,
   'the actual request must not supply the retired inline-settlement example');
});

test('a rejected reply remains private and preserves its original bytes for diagnosis',async t=>{
 const rejected='UNMARKED_PRIVATE_DIAGNOSTIC',second='UNMARKED_PRIVATE_SECOND_DIAGNOSTIC';
 let authors=0;
 const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(rejected);},()=>{
   authors++;return fauxAssistantMessage(second);
 },()=>{authors++;return fauxAssistantMessage('{{public}}UNAUTHORIZED_THIRD_AUTHOR');}]);
 t.after(()=>table.dispose());await table.session.prompt('I wait for the answer.');
 assert.equal(seen.length,0);
 assert.ok(table.telemetry().some(row=>row.lane==='keeper-delivery'&&row.private_reply===rejected));
 assert.ok(table.telemetry().some(row=>row.lane==='keeper-delivery'&&row.private_reply===second));
 assert.equal(authors,2,'a second unmarked final cannot buy another author or correction');
 assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,2);
 assert.equal(table.telemetry().filter(row=>row.lane==='turn'&&row.event==='turn_close'&&row.status==='steer').length,1);
 assert.equal(table.telemetry().filter(row=>row.lane==='turn'&&row.event==='turn_close'&&row.reason==='steer_spent').length,1);
 const notices=customMessages(table.session,'coc-delivery').filter(message=>message.details?.turn_unfinished);
 assert.equal(notices.length,1,'the existing unfinished notice ends the input');
 assert.ok(!JSON.stringify(notices).includes(rejected));
 assert.ok(!JSON.stringify(notices).includes(second));
 assert.ok(!JSON.stringify(notices).includes('UNAUTHORIZED_THIRD_AUTHOR'));
 const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
 assert.equal(turn.commit,null);assert.equal(turn.receipts.length,0);
 assert.equal(turn.world.clock.minutes,0);
 assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0);
 assert.deepEqual(table.extensionErrors,[]);
});

for(const parallel of [false,true])test('the real next Keeper request retains its whole native success and refusal batch under background pressure'+(parallel?' with parallel reads':''),async t=>{
  const measure=await importSource('extensions/table/context-policy.ts');
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  let firstBytes=0,firstProjectionBytes=0,ceiling=0,expectedResults,expectedCalls,secondRequest,sourceBefore;
  const pressureDriver={...engine.runDriver,prepare:async context=>{
    const plan=await engine.runDriver.prepare(context),original=plan.ports.projection;
    return {...plan,ports:{...plan.ports,projection:{project:async request=>{
      const rows=await original.project(request);
      const operated=[...request.view.observations].reverse().find(row=>row.kind==='operate'&&row.toolResults?.length);
      if(!operated){firstProjectionBytes=measure.requestSize(rows);return rows;}
      expectedResults=operated.toolResults;
      expectedCalls=[...request.view.observations].reverse().find(row=>row.kind==='infer')?.message.content;
      sourceBefore=JSON.stringify(expectedResults);
      const batchBytes=measure.requestSize([{role:'assistant',content:expectedCalls},...expectedResults]);
      // firstBytes already contains the original host; count only refreshed projection growth.
      const projectionGrowth=measure.requestSize(rows)-firstProjectionBytes;
      const padding=ceiling-firstBytes-projectionGrowth-Math.floor(batchBytes/2);
      assert(padding>0,`fixed context alone fits the unchanged ceiling: ${JSON.stringify({ceiling,firstBytes,projectionGrowth,batchBytes,padding})}`);
      assert(firstBytes+projectionGrowth+batchBytes+padding>ceiling,'the whole native batch still creates real background pressure');
      return rows.map(row=>row.customType!=='coc-clerk'?row:{...row,content:JSON.stringify({
        ...JSON.parse(row.content),background_fixture:'PRIVATE_REFRESHED_BACKGROUND '+ 'x'.repeat(padding)})});
    }}}};
  }};
  const publicText='You finish checking the desk and hear no new answer.';
  const seen=[];
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    runDriver:pressureDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},
    extraExtensions:[{name:'driver',factory:engine.extension},{name:'capture',factory:pi=>pi.events.on('coc:final-delivery',row=>seen.push(row))}],
    responses:[context=>{
      firstBytes=measure.requestSize(context.messages);
      return fauxAssistantMessage([fauxToolCall('look',{focus:parallel?'investigator':'scene'}),
        fauxToolCall('look',{focus:'npc',name:'Missing fixture person'})],{stopReason:'toolUse'});
    },context=>{secondRequest=context;return fauxAssistantMessage('{{public}}'+publicText);}]
  });
  t.after(()=>table.dispose());ceiling=measure.requestBudget(table.faux.getModel().contextWindow);
  await table.session.prompt('I check the desk and ask whether that unfamiliar person is here.');
  assert(secondRequest,'the same Keeper makes its normal continuation; '+JSON.stringify({notices:customMessages(table.session,'coc-delivery').map(row=>row.details),tail:table.telemetry().slice(-8)}).slice(0,4000));
  assert.equal(expectedResults.length,2);assert(expectedResults.some(row=>row.isError));assert(expectedResults.some(row=>!row.isError));
  const native=secondRequest.messages.filter(row=>row.role==='toolResult');
  assert.deepEqual(native.map(row=>({id:row.toolCallId,content:row.content,isError:row.isError})),
    expectedResults.map(row=>({id:row.toolCallId,content:row.content,isError:row.isError})),
    'the actual provider sees both original results, including refusal guidance');
  assert.deepEqual(secondRequest.messages.find(row=>row.role==='assistant')?.content,expectedCalls);
  assert(measure.pairedTools(secondRequest.messages));assert(measure.requestSize(secondRequest.messages)<=ceiling);
  assert.equal(JSON.stringify(expectedResults),sourceBefore,'projection does not mutate the original results');
  for(const result of expectedResults)assert(table.session.messages.some(row=>row.role==='toolResult'&&row.toolCallId===result.toolCallId));
  assert.equal(seen.filter(row=>row.event==='delta').map(row=>row.delta).join(''),publicText);
  assert(!JSON.stringify(seen).includes('PRIVATE_REFRESHED_BACKGROUND'));assert.deepEqual(table.extensionErrors,[]);assert.equal(table.telemetry().filter(row=>row.lane==='provider-call').length,2);
});

const parameterDialects = ['paired', 'attributed'];
function parameterCall(form, args) {
    return '```html\n<tool_call><tool_name>apply</tool_name>' + Object.entries(args).map(([key,value]) => form === 'paired'
        ? '<parameter_name>'+key+'</parameter_name><parameter_value>'+JSON.stringify(value)+'</parameter_value>'
        : '<parameter name="'+key+'">'+JSON.stringify(value)+'</parameter>').join('') + '</tool_call>';
}

for (const form of parameterDialects) test('tagged tool-name '+form+' settles before native final framing',async t=>{
    let requests=0,stateAtFirstDelta;
    const text='You finish waiting beside the desk. '.repeat(10);
    const {table,seen}=await directTable([()=>{requests++;return fauxAssistantMessage(parameterCall(form,
        {effects:[{kind:'time',minutes:8}],event:{name:'Wait',summary:'The visitor waited eight minutes.'}}));},context=>{
        requests++;
        const results=context.messages.filter(row=>row.role==='toolResult'&&row.toolName==='apply');
        assert.equal(results.length,1,'the serialized call executes through native Pi');
        assert.equal(results[0].isError,false);
        return fauxAssistantMessage('{{public}}'+text);
    }],{onFrame:frame=>{if(frame.event==='delta'&&stateAtFirstDelta===undefined)
        stateAtFirstDelta=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).clock.minutes;}});
    t.after(()=>table.dispose());
    await table.session.prompt('I wait eight minutes beside the desk.');
    assert.equal(requests,2);
    assert.equal(stateAtFirstDelta,8);
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
    assert.ok(turn.commit);
    assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
    assert.equal(turn.receipts.filter(row=>row.kind==='event').length,1);
    assert.equal(seen.filter(row=>row.event==='delta').map(row=>row.delta).join(''),text);
    assert.ok(seen.filter(row=>row.event==='delta').length>2);
    assert.equal(seen.at(-1)?.status,'completed');
    assert.equal(table.telemetry().filter(row=>row.lane==='keeper-delivery'&&row.ok===false).length,0);
    assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0);
    assert.deepEqual(table.extensionErrors,[]);
});

test('an opening html fence before the public marker needs no correction inference',async t=>{
  const text='The visitor answers beside the desk. '.repeat(10);
  let requests=0;
  const {table,seen}=await directTable([()=>{requests++;return fauxAssistantMessage('```html\n{{public}}'+text);}]);
  t.after(()=>table.dispose());
  await table.session.prompt('I listen to the visitor.');
  assert.equal(requests,1);
  assert.equal(seen.filter(row=>row.event==='delta').map(row=>row.delta).join(''),text);
  assert.ok(seen.filter(row=>row.event==='delta').length>2);
  assert.equal(seen.at(-1)?.status,'completed');
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.world.clock.minutes,0);
  assert.equal(table.telemetry().filter(row=>row.lane==='keeper-delivery'&&row.ok===false).length,0);
  assert.deepEqual(table.extensionErrors,[]);
});

for(const renameGrowth of [false,true])test('the next native request keeps six results ahead of a duplicated capsule and static brief'+(renameGrowth?' after handle expansion':''),async t=>{
  const {installContextPolicy}=await importSource('extensions/table/context-runtime.ts');
  const measure=await importSource('extensions/table/context-policy.ts');
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:checkedRecovery});
  let expectedResults,expectedCalls,sourceBefore,secondRequest,thirdRequest;
  const telemetry=[];
  const pressureDriver={...engine.runDriver,prepare:async context=>{
    const plan=await engine.runDriver.prepare(context),original=plan.ports.operations;
    const pad=result=>{
      if(result.toolResult?.toolName==='look')result.toolResult.content.push({type:'text',text:'PRIVATE_NATIVE_RESULT '+ 'r'.repeat(26000)});
      return result;
    };
    return {...plan,ports:{...plan.ports,operations:{...original,
      execute:async(...args)=>pad(await original.execute(...args)),
      executeBatch:async(...args)=>{const rows=await original.executeBatch(...args);return rows?.map(pad);}},
      projection:{project:async request=>{
        const rows=await plan.ports.projection.project(request);
        const operated=[...request.view.observations].reverse().find(row=>row.kind==='operate'&&row.toolResults?.length===6);
        if(operated){
          expectedResults=operated.toolResults;sourceBefore=JSON.stringify(expectedResults);
        }
        return rows;
      }}}};
  }};
  const inflate=capsule=>({...capsule,
    module:{...capsule.module,fixture_static:'s'.repeat(2000)},
    ...(renameGrowth?{fixture_handles:Array(500).fill('qx')}:{}),
    // Reserve the measured location grammar/disclosure growth and §259's request rows and their head line; six results,
    // handle expansion and ceiling stay fixed.
    fixture_current:(capsule.where?.clock?.minutes??0)+':'+ 'c'.repeat(45000-25600)});
  const seen=[];
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    runDriver:pressureDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},
    tableExtensionFactory:pi=>installContextPolicy({...pi,events:{...pi.events,emit:pi.events.emit.bind(pi.events),on:(name,handler)=>pi.events.on(name,data=>{
      if(name==='coc:capsule')return handler({...data,capsule:inflate(data.capsule)});
      if(name==='coc:kernel-bridge'&&data.call)return handler({...data,call:async(method,...args)=>{
        const result=await data.call(method,...args);
        if(method==='table.untold'&&renameGrowth)return {...result,people:[...(result.people??[]),
          {name:'qx',id:'qx',shown:'the unfamiliar worker waiting by the gate in a weathered long coat',handle:true}]};
        return method==='table.capsule'?inflate(result):result;
      }});
      return handler(data);
    })}},row=>telemetry.push(row)),
    extraExtensions:[{name:'driver',factory:engine.extension},{name:'capture',factory:pi=>pi.events.on('coc:final-delivery',row=>seen.push(row))}],
    responses:[()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:8}]})],{stopReason:'toolUse'}),
      context=>{secondRequest=context;expectedCalls=fauxAssistantMessage(Array.from({length:6},()=>fauxToolCall('look',{focus:'investigator'})),{stopReason:'toolUse'});return expectedCalls;},
      context=>{thirdRequest=context;return fauxAssistantMessage('{{public}}You finish checking the desk.');}]
  });
  t.after(()=>table.dispose());
  // Match the real table's model window; the product's byte ceiling stays unchanged.
  table.session.model.contextWindow=500000;
  assert.equal(measure.requestBudget(table.session.model.contextWindow),measure.REQUEST_BYTES);
  await table.session.prompt('I wait eight minutes and check my supplies.');
  assert(secondRequest);assert(thirdRequest);
  const ids=new Set(expectedResults.map(row=>row.toolCallId));
  // The run projection emits custom packets; Pi carries this original native batch separately.
  assert.equal(expectedResults.length,6);
  assert.deepEqual(new Set(expectedCalls.content.filter(part=>part.type==='toolCall').map(part=>part.id)),ids);
  const requestRow=telemetry.filter(row=>row.event==='request').at(-1);
  const actual=thirdRequest.messages.filter(row=>row.role==='toolResult'&&expectedResults.some(expected=>expected.toolCallId===row.toolCallId));
  if(actual.length!==expectedResults.length)t.diagnostic(JSON.stringify({request:requestRow,original_result_bytes:measure.requestSize(expectedResults),
    consolidation:telemetry.filter(row=>row.event==='capsule_consolidation'),
    messages:thirdRequest.messages.map(row=>({role:row.role,type:row.customType,bytes:measure.requestSize([row])}))}));
  assert.deepEqual(actual.map(row=>({id:row.toolCallId,content:row.content,isError:row.isError})),
    expectedResults.map(row=>({id:row.toolCallId,content:row.content,isError:row.isError})),'all six original read results reach the next provider request');
  assert.equal(JSON.stringify(expectedResults),sourceBefore);
  if(renameGrowth)assert.ok(telemetry.some(row=>row.event==='capsule_consolidation'&&row.retained===true),'materialized current state reclaims the obsolete duplicate before the expanded native batch');
  assert.ok(requestRow.request_bytes<=measure.REQUEST_BYTES,'the full measured request, including system material, keeps the unchanged ceiling');
  assert(measure.pairedTools(thirdRequest.messages));
  assert(measure.requestSize(thirdRequest.messages)<=measure.requestBudget(table.faux.getModel().contextWindow));
  const current=thirdRequest.messages.filter(row=>row.role==='user').flatMap(row=>row.content??[]).filter(row=>row.type==='text').map(row=>row.text).join('\n');
  assert.ok(current.includes('8:'+ 'c'.repeat(100)),'the current materialized state replaces its obsolete duplicate');
  if(renameGrowth)assert.ok(current.includes('the unfamiliar worker waiting by the gate in a weathered long coat'),'the fitted capsule includes the expanded handle');
  assert.equal(telemetry.filter(row=>row.event==='request').length,3);
  assert.equal(seen.filter(row=>row.event==='delta').map(row=>row.delta).join(''),'You finish checking the desk.');
  assert.ok(!JSON.stringify(seen).includes('PRIVATE_NATIVE_RESULT'));
  assert.deepEqual(table.extensionErrors,[]);
});
