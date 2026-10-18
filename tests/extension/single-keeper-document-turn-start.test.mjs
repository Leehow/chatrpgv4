/** Real Pi/extension and TS-kernel seams for existing queued registration and writing. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import modsExtension from '../../extensions/mods/index.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const CAMPAIGN='test-camp',NAME='Retained interview notebook',EQUIPMENT='notebook and stub pencil';
const INITIAL='An existing note retained from the acquisition.\n';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
// These tests isolate physical writing, not optional context selection or post-delivery readers.
// Neither family may contaminate the assertion that writing itself needs no decision request.
const WRITING_ENV={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_MATERIAL_SCREEN:'0',
  // Keep unrelated startup recovery out; after-delivery readers are outside the apply boundary.
  PI_COC_MEMORY_BACKFILL:'0',
  PI_COC_TOLD_POSITION:'off',PI_COC_TOLD_CLUE:'off',PI_COC_TOLD_TIME:'off'};

async function seedReadyHistoricalRegistration(workspace,{ready=true}={}){
  const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'turn-start-registration',
    locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(context),call=(method,params={})=>runtime.handlers[method]({campaign:CAMPAIGN,...params});
  try{
    await call('mods.configure',{id:'enhanced-items',enabled:true});await call('table.open');
    const directory=join(workspace,'.coc/campaigns',CAMPAIGN),party=join(directory,'party');
    const sheet=await read(join(party,(await readdir(party)).find(name=>name.endsWith('.json'))));
    assert.ok(sheet.equipment.some(item=>(typeof item==='string'?item:item.name)===EQUIPMENT));
    const input={name:NAME,category:'item',description:'The notebook the investigator already carries.'};
    const job=await call('mods.job',{role:'create',input});assert.equal(job.enabled,true);
    await call('table.apply',{call_id:'t0-c1',effects:[{kind:'define',...input,_queued:job.job,_provenance:{mod:job.mod,digest:job.digest}}]});
    // A recorded pre-fix adoption had no physical instance yet. Seed only that historical queue shape
    // in this disposable fixture; the job and later promotion use the real canonical kernel APIs.
    const worldPath=join(directory,'world.json'),world=await read(worldPath);
    const entry=Object.values(world.mods.state).flatMap(value=>Object.values(value.queued??{})).find(value=>value.job===job.job);
    assert.ok(entry);
    Object.assign(entry,{adopt:EQUIPMENT,owner:sheet.name,object:{kind:'object',name:NAME,definition:NAME,to:sheet.name,
      adopt:EQUIPMENT,why:'Register the already carried notebook.'}});
    await writeFile(worldPath,JSON.stringify(world));
    const definition={...input,basis:'Existing carried notebook in the fixture.',parameters:{charges:null,effects:[]},traits:[],
      player_view:{description:input.description,fields:[]},document:{text:INITIAL,presentation:'notebook'}};
    if(ready){
      await writeFile(join(job.cwd,'result.json'),JSON.stringify(definition));
      await call('mods.accept',{job:job.job});
      assert.deepEqual((await call('mods.queued',{details_only:true})).effects.map(effect=>effect.kind),['define','object']);
    }else assert.equal((await call('mods.queued',{details_only:true})).unfinished.length,1);
    assert.ok(!Object.values((await read(worldPath)).objects?.instances??{}).some(item=>item.name===NAME));
    await call('table.narrate',{call_id:'t0-c2',text:'The prior conversation is finished.'});
  }finally{await runtime.close();}
}

test('ready historical notebook registration is promoted before the Keeper receives the new turn and looks at it',async t=>{
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  const results=[],capsules=[];
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedReadyHistoricalRegistration,
    runDriver:engine.runDriver,env:WRITING_ENV,
    extraExtensions:[{name:'mods',factory:modsExtension},{name:'driver',factory:engine.extension},
      {name:'turn-start-observer',factory:pi=>{
        pi.events.on('coc:capsule',value=>capsules.push(value));
        pi.on('tool_result',event=>{if(event.toolName==='look')results.push(event);});
      }}],
    responses:[fauxAssistantMessage([fauxToolCall('look',{focus:'object',name:NAME})],{stopReason:'toolUse'}),
      fauxAssistantMessage('{{public}}You open the notebook you already carry.')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I open my interview notebook and read it.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(results.length,1);
  assert.equal(results[0].details.instance?.document?.text,INITIAL,'the first look must receive the promoted writable instance');
  assert.ok(capsules.find(value=>value.turn===1)?.capsule.own.documents.some(document=>document.name===NAME&&document.text===INITIAL),
    'the initial capsule must already reflect the promoted notebook');
  const bridge=table.runtimeBridges().at(-1),view=await bridge.call('table.view',{campaign:CAMPAIGN});
  assert.equal(view.investigators[0].equipment.filter(item=>item.name===NAME).length,1);
  const turn=await read(join(table.workspace,'.coc/campaigns',CAMPAIGN,'turns/0001.json'));
  const adopted=turn.receipts.find(receipt=>receipt.kind==='definition'&&receipt.name===NAME&&receipt.adopted===EQUIPMENT);
  assert.ok(adopted,'promotion records representation adoption rather than another acquisition');
  assert.equal(adopted.call_id,'t1-c1','the host mints against the reset new-turn ordinal');
  assert.equal(adopted.resumed,true);
});

test('one Keeper writes the chosen suffix without append binding and the kernel still refuses a false writer',async t=>{
  const originalFetch=globalThis.fetch;
  let decisionRequests=0;
  globalThis.fetch=async url=>{
    if(String(url).startsWith('https://api.typesafe.ai/'))decisionRequests++;
    throw new Error('This deterministic writing seam must make no decision request');
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  const results=[],requestsAtApply=[],suffix='Gate code NOTE-B4.\n';
  const effect=owner=>({kind:'object',name:NAME,from:owner,to:owner,document:{action:'append',text:suffix},
    why:'The investigator writes the player-selected note in the carried notebook.'});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:seedReadyHistoricalRegistration,
    runDriver:engine.runDriver,env:{...WRITING_ENV,TYPESAFE_API_KEY:'test-only-writing-seam'},
    extraExtensions:[{name:'mods',factory:modsExtension},{name:'driver',factory:engine.extension},
      {name:'writing-observer',factory:pi=>pi.on('tool_result',event=>{if(event.toolName==='apply'){results.push(event);requestsAtApply.push(decisionRequests);}})}],
    responses:[fauxAssistantMessage([fauxToolCall('apply',{effects:[effect('Thomas Hayes')]})],{stopReason:'toolUse'}),
      fauxAssistantMessage([fauxToolCall('apply',{effects:[effect('Steven Knott')]})],{stopReason:'toolUse'}),
      fauxAssistantMessage('{{public}}You finish writing your chosen note in your notebook.')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I write "Gate code NOTE-B4" in my interview notebook.');
  assert.deepEqual(table.extensionErrors,[]);
  assert.deepEqual(requestsAtApply,[0,0],'neither selected writing nor kernel refusal invokes Jev; after-delivery first sight is separate');
  assert.equal(results.length,2);
  assert.equal(results[0].details.coc_error,undefined,'the chosen append reaches the existing kernel');
  assert.ok(results[1].details.coc_error,'the kernel still rejects an NPC who does not hold this paper');
  const view=await table.runtimeBridges().at(-1).call('mods.document.view',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:NAME});
  assert.equal(view.text,INITIAL+suffix,'the refused foreign-writer batch changed none of the writing');
  assert.equal(table.telemetry().some(row=>row.lane==='document_binding'),false);
});

test('a held unfinished creator does not delay the Keeper request at the new-turn boundary',{timeout:15000},async t=>{
  let release,started=false;
  const held=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  let keeperAnswered=false;
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,
    prepareWorkspace:workspace=>seedReadyHistoricalRegistration(workspace,{ready:false}),runDriver:engine.runDriver,
    env:WRITING_ENV,extraExtensions:[
      {name:'controlled-mod-creator',factory:pi=>{
        modsExtension(pi);
        let controlled;
        pi.events.on('coc:kernel-bridge',value=>{
          if(!value?.runtime||value.runtime===controlled)return;
          controlled={...value.runtime,async runTask(){
            started=true;await held;
            return{ok:false,code:1,timedOut:false,ms:1,stderr:'Controlled unfinished creator.',command:[]};
          }};
          pi.events.emit('coc:kernel-bridge',{...value,runtime:controlled});
        });
      }},{name:'driver',factory:engine.extension}],
    responses:[()=>{keeperAnswered=true;return fauxAssistantMessage('{{public}}You continue the conversation.');}]});
  t.after(()=>table.dispose());
  await table.session.prompt('I ask Knott what he personally saw.');
  assert.equal(started,true,'the safe boundary started the unfinished registration beside the turn');
  assert.equal(keeperAnswered,true,'the real Keeper provider answered while the creator was still held');
  assert.deepEqual(table.extensionErrors,[]);
  release();
});
