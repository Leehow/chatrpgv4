/** Native Pi/kernel component seams with deterministic decisions; never live-play evidence (contract §249). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const NOTEBOOK='Notebook';
async function notebookOpened(workspace){
    const client=new RpcClient(workspace);
    try{
        const draft={name:NOTEBOOK,category:'item',description:'An ordinary writable carrier.',basis:'Ordinary fixture paper.',
            parameters:{charges:null,effects:[]},document:{text:'A',presentation:'notebook'},player_view:{description:'A notebook.',fields:[]}};
        const job=await client.ok('mods.job',{campaign:'test-camp',role:'create',input:{name:draft.name,category:draft.category,description:draft.description}});
        writeFileSync(join(job.cwd,'result.json'),JSON.stringify(draft));
        const accepted=await client.ok('mods.accept',{campaign:'test-camp',job:job.job});
        await client.ok('table.open',{campaign:'test-camp'});
        await client.ok('table.apply',{campaign:'test-camp',call_id:'t0-c1',effects:[
            {kind:'define',name:draft.name,category:draft.category,description:draft.description,_definition:accepted.definition,_provenance:accepted.provenance},
            {kind:'object',name:NOTEBOOK,to:'Thomas Hayes'}]});
        await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c2',text:'Knott waits beside his desk. Hayes holds his notebook.'});
    }finally{await client.close();}
}
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_JEV_PRESELECT:'0',PI_COC_ISOLATED_OUTPUT:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined};
test('a refused Keeper-judged player act is held: prose claiming it is not delivered (§249)',async t=>{
    const families=[];
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>{families.push(batch.family);
        return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',
            noul:batch.family==='held-act-outcome'?.99:q.key.startsWith('restriction_')?.01:.99}])),
            coverage:{required:batch.questions.map(q=>q.key),answered:batch.questions.map(q=>q.key),unknown:[]},issues:[]};}}});
    const bad={version:1,record:{effects:[{kind:'time',minutes:8}],event:{name:'answer',summary:'The clerk answers.',
        knowledge:[{actor:'Unregistered fixture person',statement:'The clerk is present.',mode:'observed',state:'accurate'}]}},text:'REJECTED_PRIVATE_CANDIDATE'};
    const claim='{{public}}You have waited the full eight minutes.';
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:notebookOpened,env,
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension}],responses:[
            fauxAssistantMessage(JSON.stringify(bad)),fauxAssistantMessage(claim),fauxAssistantMessage(claim)]});
    t.after(()=>table.dispose());
    await table.session.prompt('I wait eight minutes.');
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
    assert.equal(turn.world.clock.minutes,0,'the refused wait did not settle');
    assert.ok(table.telemetry().some(row=>row.lane==='admission'&&row.path==='keeper_judged'&&row.kinds?.includes('time')),'the wait was the Keeper\'s own judgment');
    assert.equal(table.telemetry().some(row=>row.lane==='held-operation'&&row.event==='argument_outside_player_scope'),false,
        'a Keeper-judged player line is the player\'s act, not bookkeeping');
    assert.ok(families.includes('held-act-outcome'),'the publication guard asks whether the prose claims the held act');
    assert.equal(table.entries('coc-final-delivery').filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),'',
        'prose claiming the refused act is not delivered');
});
