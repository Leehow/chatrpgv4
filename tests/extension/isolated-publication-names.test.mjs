import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient,rpcCommand} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {createFinalOutputOwner} from '../../extensions/kernel/final-output.ts';

// Controlled transport only: no fixture response counts as live gameplay.
const text='Mr. Dooley and Alex wait beside you. {{say:Steven Knott}}I heard Alex was waiting.{{/say}}';
const rendered='Mr. Dooley and Alex wait beside you. I heard Alex was waiting.';
const brief={scene:'An office.',narrative_content:['A visitor waits.'],npc_turns:[]};
const campaign='test-camp';

test('an exposed isolated expression commits once without assigning a shared private name, including ask and reopen',async t=>{
  let authors=0;
  const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_ISOLATED_OUTPUT:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
    PI_COC_KERNEL_CMD:JSON.stringify(rpcCommand()),PI_COC_READER_CMD:undefined};
  const engine=createHybridEngine({env,decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env,runDriver:engine.runDriver,
    async prepareWorkspace(workspace){
      env.PI_COC_KERNEL_CMD=JSON.stringify([...rpcCommand(),'--workspace',workspace,'--content',join(import.meta.dirname,'../../content')]);
      process.env.PI_COC_KERNEL_CMD=env.PI_COC_KERNEL_CMD;
      const client=new RpcClient(workspace);
      try{
        await client.ok('table.open',{campaign});
        await client.ok('table.narrate',{campaign,call_id:'t0-c1',text:'You wait in the office.'});
      }finally{await client.close();}
      const folder=join(workspace,'.coc/modules/the-haunting'),file=join(folder,'module.json');
      const metadata=JSON.parse(readFileSync(file,'utf8'));
      const sha=metadata.source_document?.file_sha256||metadata.file_sha256
        ||createHash('sha256').update(readFileSync(join(folder,'module-graph.json'))).digest('hex');
      writeFileSync(file,JSON.stringify({...metadata,file_sha256:sha}));
      writeFileSync(join(folder,'cast.json'),JSON.stringify({version:5,state:'complete',source_sha256:sha,people:[
        {id:'cast-dooley',book:['Mr. Dooley','Alex'],play:['Mr. Dooley'],pages:[1]},
        {id:'cast-wilmot',book:['Arty Wilmot','Alex'],play:['Arty Wilmot'],pages:[1]},
      ]}));
      const writer=join(workspace,'expression-fixture.mjs');
      writeFileSync(writer,`process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:${JSON.stringify('{{public}}'+text)}}]}})+'\\n');`);
      env.PI_COC_READER_CMD=JSON.stringify([process.execPath,writer]);
      process.env.PI_COC_READER_CMD=env.PI_COC_READER_CMD;
    },
    extraExtensions:[{name:'engine',factory:engine.extension}],
    responses:[()=>{authors++;return fauxAssistantMessage('{{compose}}'+JSON.stringify(brief));}]});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait at the desk.');
  assert.deepEqual(table.extensionErrors,[]);
  const frames=table.entries('coc-final-delivery');
  assert.equal(frames.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text,
    JSON.stringify(table.telemetry().slice(-8)));
  assert.equal(frames.at(-1).status,'completed','already exposed words must not enter the old draft refusal');
  assert.equal(authors,1);
  assert.equal(table.telemetry().filter(row=>row.lane==='isolated-expression'&&row.event==='start').length,1);
  const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
  assert.ok(turn.commit);
  assert.equal(turn.rendered_text,rendered);
  assert.equal(turn.delivery_evidence.author,'isolated-expression');
  assert.equal(turn.delivery_evidence.artifact_text,text);
  assert.ok(!turn.told_text.includes('Alex'));
  assert.ok(!turn.told_text.includes('Mr. Dooley'));
  assert.deepEqual(table.telemetry().filter(row=>row.lane==='delivery'&&row.reason==='untold_name').map(row=>row.outcome),['diagnostic']);
  const bridge=table.runtimeBridges().at(-1);
  await bridge.call('table.open',{campaign});
  const untold=await bridge.call('table.untold',{campaign});
  for(const name of ['Mr. Dooley','Arty Wilmot'])assert.ok(untold.people.some(person=>person.name===name));
  assert.ok(untold.protected.includes('Alex'));

  await bridge.call('table.player_input',{campaign,text:'I ask whether to wait.'});
  await bridge.call('table.apply',{campaign,call_id:'t2-c1',effects:[{kind:'time',minutes:8}]});
  const askFrames=[];
  const owner=createFinalOutputOwner({runtime:()=>({home:table.workspace}),call:(method,params)=>bridge.call(method,params),
    record:async()=>{},stream:frame=>askFrames.push(frame)});
  const stream=await owner.openStream(campaign,2,'isolated-ask','isolated-expression');
  stream.push(text);
  const publication={call_id:'t2-c2',kind:'story',prompt:'Wait here?',options:['Wait','Leave']};
  const written=await stream.finish('opencode-go/deepseek-v4.1-flash','off',publication);
  await bridge.call('table.ask',{campaign,...publication,text:written.text,_delivery_evidence:written.evidence});
  owner.finishStream(written.evidence,'completed');
  assert.equal(askFrames.at(-1).status,'completed');
  const asked=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
  assert.equal(asked.rendered_text,rendered);
  assert.equal(asked.delivery_evidence.artifact_text,text);
  await bridge.call('table.open',{campaign});
  const afterAsk=await bridge.call('table.untold',{campaign});
  for(const name of ['Mr. Dooley','Arty Wilmot'])assert.ok(afterAsk.people.some(person=>person.name===name));
  assert.equal(asked.world.clock.minutes,8);
  assert.equal(asked.receipts.filter(receipt=>receipt.kind==='time').length,1);
  assert.equal(authors,1,'publication never asks the Keeper to regenerate or repeat effects');
});
