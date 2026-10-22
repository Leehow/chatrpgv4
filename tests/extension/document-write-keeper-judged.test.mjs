/** Real Pi tool dispatch and kernel settlement; controlled component evidence, never live play (contract §249.6). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
  EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
const NOTEBOOK='Notebook';
async function notebookOpened(workspace){const client=new RpcClient(workspace);try{
  const draft={name:NOTEBOOK,category:'item',description:'An ordinary writable carrier.',basis:'Ordinary fixture paper.',
    parameters:{charges:null,effects:[]},document:{text:'A',presentation:'notebook'},player_view:{description:'A notebook.',fields:[]}};
  const job=await client.ok('mods.job',{campaign:'test-camp',role:'create',input:{name:draft.name,category:draft.category,description:draft.description}});
  writeFileSync(join(job.cwd,'result.json'),JSON.stringify(draft));const accepted=await client.ok('mods.accept',{campaign:'test-camp',job:job.job});
  await client.ok('table.open',{campaign:'test-camp'});
  await client.ok('table.apply',{campaign:'test-camp',call_id:'t0-c0',effects:[{kind:'define',name:NOTEBOOK,category:draft.category,description:draft.description,
    _definition:accepted.definition,_provenance:accepted.provenance},{kind:'object',name:NOTEBOOK,to:'Thomas Hayes'}]});
  await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});
}finally{await client.close();}}
const notebookText=workspace=>Object.values(JSON.parse(readFileSync(join(workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).objects.instances)
  .find(row=>row.name===NOTEBOOK)?.document?.text;

test('the investigator copying notes into the notebook is the Keeper\'s own judgment: no consent review, the write lands (live el-v2-20261021f T19-T20)',async t=>{
 const batches=[];
 const engine=createHybridEngine({env,decision:{decide:async batch=>{batches.push(batch);throw Error('no consent review is expected');}}});
 const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:notebookOpened,env,runDriver:engine.runDriver,
  extraExtensions:[{name:'engine',factory:engine.extension}],responses:[
   ()=>fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'object',name:NOTEBOOK,from:'Thomas Hayes',to:'Thomas Hayes',
     document:{action:'append',text:'B'},why:'Hayes copies the 1835 entry into his notebook.'}]})],{stopReason:'toolUse'}),
   ()=>fauxAssistantMessage([fauxToolCall('output',{version:4,commands:[{kind:'scene',service:'open',crowd:'quiet'}]})],{stopReason:'toolUse'})]});
 t.after(()=>table.dispose());
 await table.session.prompt('I copy the useful entries into my notebook.');
 assert.equal(batches.filter(batch=>batch.family==='continuous-action-admission').length,0,'no consent review runs');
 assert.ok(table.telemetry().some(row=>row.lane==='admission'&&row.path==='keeper_judged'&&row.kinds.includes('object')&&row.jev_calls===0));
 assert.equal(notebookText(table.workspace),'AB','the write lands');
 assert.equal(table.entries('coc-final-delivery').filter(row=>row.event==='end'&&row.status==='completed').length,1);
});
