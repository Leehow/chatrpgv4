import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,chmodSync,mkdtempSync,rmSync,cpSync,mkdirSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fauxAssistantMessage,fauxText,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';
import {importSource} from '../integration/support.ts';
import {writeSourceMetadata} from '../integration/module-support.ts';

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
  const {onFrame,extraExtensions=[],...options}=extra;
  const seen=[];
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  return openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedOpening,
    runDriver:engine.runDriver,env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},
    extraExtensions:[{name:'capture-stream',factory:pi=>pi.events.on('coc:final-delivery',frame=>{seen.push(frame);onFrame?.(frame);})},{name:'driver',factory:engine.extension},...extraExtensions],
    responses,...options}).then(table=>({table,seen}));
}

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

test('one trailing brace publishes one Keeper body after settling its private record once',async t=>{
  const text='You finish waiting. The office remains quiet. '.repeat(4);
  const response={version:1,record:{effects:[{kind:'time',minutes:8}],event:{name:'one-brace-reply',summary:'PRIVATE_ONE_BRACE_CAUSE'}},text};
  let authors=0,stateAtFirstDelta;
  const {table,seen}=await directTable([()=>{authors++;return fauxAssistantMessage(JSON.stringify(response)+'}');}],{
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
  }]);
  t.after(()=>table.dispose());
  await table.session.prompt('I wait eight minutes and watch the clerk.');
  assert.ok(correction.includes('invalid_params'));
  assert.ok(correction.includes('Invalid event unknown actor Unregistered fixture person'));
  assert.ok(correction.includes('registered NPC name'));
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
    fauxAssistantMessage(JSON.stringify({version:1,record:{choice:{kind:'mechanics',options:['accept','push']}},text:'You pause before taking the risk.'})),
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
 const {table}=await directTable([context=>{request=context;return fauxAssistantMessage('{{public}}The clerk answers.');}]);
 t.after(()=>table.dispose());
 await table.session.prompt('I ask the clerk what happened.');
 const text=JSON.stringify(request.messages);
 assert.match(text,/You are the sole Keeper and author/);
 assert.match(text,/Keeper-only current state and actor perspectives/);
});

test('a rejected reply remains private and preserves its original bytes for diagnosis',async t=>{
 const rejected='UNMARKED_PRIVATE_DIAGNOSTIC';
 const {table,seen}=await directTable([fauxAssistantMessage(rejected),fauxAssistantMessage(rejected)]);
 t.after(()=>table.dispose());await table.session.prompt('I wait for the answer.');
 assert.equal(seen.length,0);
 assert.ok(table.telemetry().some(row=>row.lane==='keeper-delivery'&&row.private_reply===rejected));
});
