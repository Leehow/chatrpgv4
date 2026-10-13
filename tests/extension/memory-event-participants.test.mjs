/** Real Pi, current TS RPC, conservative attribution review and next NPC perspective. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitFor} from './harness.mjs';
import {RpcClient,rpcCommand,CONTENT_DIR} from '../integration/support.ts';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';

test('the real memory lane can submit a canonical speaker omitted from the physical scene roster',{timeout:15000},async t=>{
  const campaign='test-camp',statement='Gabriela heard Hayes request a telephone appointment.',spoken='I heard your request for a telephone appointment.';
  let investigator,extractCalls=0,reviewCalls=0;
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  const candidate=()=>({kind:'knowledge',subject:'Gabriela Macario',knowers:['Gabriela Macario'],statement,privacy:'player_safe',state:'accurate',confidence:0.9});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
    env:{PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand()),PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_MEMORY_BACKFILL:'0'},
    extraExtensions:[{name:'driver',factory:engine.extension}],
    async prepareWorkspace(workspace){
      process.env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',CONTENT_DIR]);
      const seed=new RpcClient(workspace);
      try{
        await seed.ok('table.open',{campaign});
        await seed.ok('table.narrate',{campaign,call_id:'t0-c1',text:'You are in the office with Knott.'});
        investigator=(await seed.ok('table.view',{campaign})).investigators[0].name;
      }finally{await seed.close();}
    },
    laneResponses:{memory:[context=>{
      extractCalls++;
      const sent=context.messages.filter(message=>message.role==='user').flatMap(message=>message.content??[])
        .filter(block=>block.type==='text').map(block=>block.text).join('\n');
      const names=sent.split('\n').find(line=>line.startsWith('[Available names] '));
      assert.ok(names?.includes('Gabriela Macario'),'the producer must issue the actual canonical speaker to the extraction lane');
      return fauxAssistantMessage(JSON.stringify({candidates:[candidate()],story:{status:'unclear',thread:null,frame:null,bridge_delivered:false,delivery_quote:null}}));
    },()=>{reviewCalls++;return fauxAssistantMessage(JSON.stringify({verdict:'supported',issues:[]}));}]},
    responses:[()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[],event:{name:'Telephone appointment request',
      summary:'Gabriela hears Hayes request a telephone appointment.',
      materials:[{name:'telephone-reply',kind:'speech',visibility:'player',speaker:'Gabriela Macario',audience:[investigator],text:spoken}],
      knowledge:[{actor:'Gabriela Macario',source:investigator,statement,mode:'heard',state:'accurate'}]}})],{stopReason:'toolUse'}),
      fauxAssistantMessage('{{public}}You ask Gabriela for a telephone appointment. {{say:Gabriela Macario}}'+spoken+'{{/say}}')]});
  t.after(()=>table.dispose());
  await table.session.prompt('I telephone Gabriela and ask for an appointment.');
  assert.equal(table.committed().length,1,'the real Keeper delivery must finish before the background job');
  await waitFor(()=>table.telemetry().some(row=>row.lane==='memory'&&typeof row.ok==='boolean'),{timeoutMs:5000});
  assert.ok(table.telemetry().some(row=>row.lane==='memory'&&row.ok===true),JSON.stringify(table.telemetry().filter(row=>row.lane==='memory')));
  assert.deepEqual(table.extensionErrors,[]);
  assert.equal(extractCalls,1);assert.equal(reviewCalls,1,'the existing attribution reviewer is still called');
  assert.equal(table.telemetry().some(row=>row.lane==='memory'&&row.ok===false),false);
  const view=await table.runtimeBridges().at(-1).call('npc.perspective',{campaign,name:'Gabriela Macario'});
  assert.ok(view.knowledge_reports.some(row=>row.statement===statement));
  assert.equal(table.committed().length,1);
});
