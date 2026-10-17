/** Native Pi/kernel component seams with deterministic decisions; never live-play evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall,getCurrentSystemPrompt} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {RpcClient} from '../integration/support.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

function result(batch,select,confidence=.99){
    const answers=Object.fromEntries(batch.questions.map(question=>{
        if(question.type==='noul')return[question.key,{status:'answered',type:'noul',noul:confidence}];
        const choice=select(question);
        return[question.key,{status:'answered',type:'choice',choice,confidence,
            probabilities:Object.fromEntries(Object.keys(question.criteria).map(value=>[value,value===choice?confidence:(1-confidence)/(Object.keys(question.criteria).length-1)]))}];
    }));
    return {batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};
}
function selected(question){
    const choices={role:'world_response',choice:'chosen',result:'answers_player',span:'activity_time',
        target:'no_target',gate:'no_obstacle',order:'in_step',missing:'none',need:'later'};
    return choices[question.key.split('_')[0]]??Object.keys(question.criteria).find(value=>value!=='none')??'none';
}
async function opened(workspace){
    const client=new RpcClient(workspace);
    try{await client.ok('table.open',{campaign:'test-camp'});
        await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
        return await client.ok('table.capsule',{campaign:'test-camp',_context_read:true});
    }finally{await client.close();}
}
const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_JEV_PRESELECT:'0',PI_COC_ISOLATED_OUTPUT:'0',
    EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined};

test('one Keeper writes NPC speech and commits heard knowledge without a second consent task',async t=>{
    const batches=[],privateResponses=[];let requests=0;
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
        batches.push(batch);
        return result(batch,selected);
    }}});
    const text='{{say:Steven Knott}}I heard they left. I did not see them go.{{/say}}';
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,
        systemPrompt:readFileSync(new URL('../../prompts/keeper.md',import.meta.url),'utf8'),
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension},
            {name:'private-response-observer',factory(pi){pi.events.on('coc:keeper-response',message=>privateResponses.push(message));}}],responses:[context=>{
            requests++;
            const instructions=JSON.stringify(context.messages);
            const system=getCurrentSystemPrompt(context.messages);
            assert.ok(!system.includes('The isolated author chooses the actual words;'));
            assert.ok(system.includes('After a public or reference prose reply, end the response.'));
            assert.ok(instructions.includes('Never append {{compose}}, an expression brief, a private envelope or a second frame.'));
            assert.ok(instructions.includes('Begin your complete final public prose with {{public}}'));
            assert.ok(instructions.includes('a JSON object with version:1, record and text in that order'));
            return fauxAssistantMessage(JSON.stringify({version:1,record:{event:{name:'witness-reply',summary:'Knott distinguishes hearsay from observation.',
                materials:[{name:'reply',text:'I heard they left. I did not see them go.',kind:'speech',visibility:'player',speaker:'Steven Knott',audience:['Thomas Hayes']}],
                knowledge:[{actor:'Thomas Hayes',statement:'Knott says he heard about the departure.',mode:'heard',state:'uncertain',source:'Steven Knott',material:'reply'}]}},text}));
        }]});
    t.after(()=>table.dispose());
    await table.session.prompt('Which parts did you see yourself and which did you hear about?');
    assert.equal(requests,1);assert.deepEqual(table.extensionErrors,[]);
    assert.equal(table.entries('coc-final-delivery').filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),text,
        JSON.stringify(table.telemetry().filter(row=>row.lane==='admission'||row.lane==='keeper-delivery'||row.tool==='apply')));
    assert.equal(batches.filter(batch=>batch.family==='continuous-action-admission').length,0);
    assert.equal(privateResponses.length,1);
    assert.ok(privateResponses[0].content.some(block=>block.type==='text'&&block.text.includes('"record"')));
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
    assert.ok(turn.commit);assert.equal(turn.receipts.filter(receipt=>receipt.kind==='event').length,1);
    assert.equal(table.telemetry().filter(row=>row.lane==='final-output'&&row.event==='start').length,0);
});

test('the same uncertain record is not judged twice or exposed on correction',async t=>{
    let requests=0,admissionBatches=0;
    const engine=createHybridEngine({env:{},maxSteps:10,decision:{decide:async batch=>{
        const admission=batch.family==='continuous-action-admission';
        if(admission)admissionBatches++;
        return result(batch,selected,admission?.5:.99);
    }}});
    const response=JSON.stringify({version:1,record:{effects:[{kind:'time',minutes:5,why:'The selected short wait.'}]},text:'DEPENDENT_UNCERTAIN_TEXT'});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension}],
        responses:[()=>{requests++;return fauxAssistantMessage(response);},()=>{requests++;return fauxAssistantMessage(response);}]});
    t.after(()=>table.dispose());
    await table.session.prompt('I wait here for five minutes.');
    assert.equal(requests,2);assert.equal(admissionBatches,1);
    assert.equal(table.entries('coc-final-delivery').filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),'');
    assert.ok(table.telemetry().some(row=>row.lane==='admission'&&row.reused===true&&row.jev_calls===0));
});

test('an unavailable typed move keeps the existing non-arrival recovery and refusal ledger',async t=>{
    let correction='';
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>
        result(batch,selected,batch.family==='continuous-action-admission'?.5:.99)}});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension}],responses:[
            fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'move',to:'Central Library'}]})],{stopReason:'toolUse'}),
            context=>{correction=JSON.stringify(context.messages);return fauxAssistantMessage('{{public}}You remain beside the desk.');}
        ]});
    t.after(()=>table.dispose());
    await table.session.prompt('I go to the Central Library.');
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
    assert.deepEqual(turn.refused_moves,[{to:'Central Library',reason:'typed_admission_unavailable'}]);
    assert.ok(correction.includes('do not narrate its effects as having happened'));
    assert.ok(correction.includes('do not ask the player to say their action again'));
    assert.equal(turn.receipts.filter(row=>row.kind==='move').length,0);
    assert.equal(turn.world.clock.minutes,0);
    assert.deepEqual(table.extensionErrors,[]);
});

async function cashOpened(workspace){
    await opened(workspace);
    const client=new RpcClient(workspace);
    try{
        await client.ok('table.player_input',{campaign:'test-camp',text:'Please quote the complete round trip.'});
        await client.ok('table.apply',{campaign:'test-camp',call_id:'t1-c0',effects:[{kind:'cash',delta:1,source:'found'},{kind:'cash',delta:-1,source:'found'}]});
        const path=join(workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json');
        const card=JSON.parse(readFileSync(path,'utf8'));
        card.finance.cash.amount=55.25;card.finance.spending_level.amount=40;
        card.finance.daily_spending={day:0,total:22,debited:0};
        writeFileSync(path,JSON.stringify(card));
        await client.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[{kind:'cash',mode:'quote',quote:'Round-trip quotation',
            category:'purchase',source:'quote',with:'Steven Knott',items:[{name:'Round trip',quantity:1,unit_price:25}]}]});
        await client.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'The round trip costs 25 USD; the full purse debit is 47 USD including earlier daily spending.'});
        return await client.ok('table.capsule',{campaign:'test-camp',_context_read:true});
    }finally{await client.close();}
}

for(const choice of [false,true])test(`typed ${choice?'bound quotation':'explicit debit'} consent reaches one real cash transaction`,async t=>{
    let admissionBatches=0;
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
        const answer=result(batch,selected);
        if(batch.family==='continuous-action-admission'){
            admissionBatches++;
            answer.answers.cash_input_0.noul=choice?.01:.99;
            answer.answers.cash_offer_0_0.noul=choice?.99:.01;
        }
        return answer;
    }}});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:cashOpened,env,
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension}],responses:[
            fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[{kind:'cash',mode:'settle',quote:'Round-trip quotation'}]},text:'The agreed payment is settled once.'}))
        ]});
    t.after(()=>table.dispose());
    await table.session.prompt(choice?JSON.stringify({kind:'mechanics_choice',action:'accept',
        choice:{name:'cash-choice',binds:'Round-trip quotation',options:['accept','flee']}}):'I accept the actual 47 USD cash debit once, including earlier daily spending.');
    const card=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),'utf8'));
    assert.equal(card.finance.cash.amount,8.25);
    assert.equal(card.finance.daily_spending.total,47);assert.equal(card.finance.daily_spending.debited,47);
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0002.json'),'utf8'));
    assert.equal(turn.receipts.filter(row=>row.kind==='cash').length,1);
    assert.equal(admissionBatches,1);assert.deepEqual(table.extensionErrors,[]);
});

test('requested NPC work carries elapsed time while the investigator stays clear',async t=>{
    let reviews=0;
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
        if(batch.family==='continuous-action-admission'){
            reviews++;assert.deepEqual(batch.state.proposal.kinds,['time']);
            assert.equal(batch.questions.length,1);
        }
        return result(batch,selected);
    }}});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension}],responses:[
            fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[{kind:'time',minutes:5,why:'Knott fetches the requested records while the investigator watches.'},
                {kind:'npc',name:'Steven Knott',mood:'working'}]},text:'You stay beside the desk as Knott fetches the records.'}))
        ]});
    t.after(()=>table.dispose());
    await table.session.prompt('Please fetch the records. I stay beside the desk and watch; I do not follow you into storage.');
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
    assert.equal(turn.world.clock.minutes,5);assert.equal(reviews,1);
    assert.equal(turn.receipts.filter(row=>row.kind==='time').length,1);
    assert.equal(turn.receipts.filter(row=>row.kind==='move').length,0);
    assert.deepEqual(table.extensionErrors,[]);
});

test('an unchosen move beside requested NPC work refuses the entire atomic batch',async t=>{
    let reviews=0;
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
        const answer=result(batch,selected);
        if(batch.family==='continuous-action-admission'){
            reviews++;assert.deepEqual(batch.state.proposal.kinds,['time','move']);
            answer.answers.consent_1.noul=.01;
        }
        return answer;
    }}});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,prepareWorkspace:opened,env,
        runDriver:engine.runDriver,extraExtensions:[{name:'continuous',factory:engine.extension}],responses:[
            fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:5,why:'Knott fetches the requested records.'},
                {kind:'npc',name:'Steven Knott',mood:'working'},{kind:'move',to:'Central Library'}]})],{stopReason:'toolUse'}),
            fauxAssistantMessage('{{public}}You remain beside the desk.')
        ]});
    t.after(()=>table.dispose());
    await table.session.prompt('Please fetch the records. I stay beside the desk and do not leave.');
    const turn=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'),'utf8'));
    assert.equal(turn.world.clock.minutes,0);assert.equal(reviews,1);
    assert.equal(turn.receipts.filter(row=>['time','move','npc'].includes(row.kind)).length,0);
    assert.deepEqual(turn.refused_moves,[{to:'Central Library',reason:'action_not_authorized'}]);
    assert.deepEqual(table.extensionErrors,[]);
});
