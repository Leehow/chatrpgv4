/** Scripted provider fixture: real Pi/native transport and cash arithmetic, not live semantic acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {fauxAssistantMessage,fauxToolCall,getCurrentSystemPrompt,getCurrentTools} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const textParts=message=>typeof message.content==='string'?[message.content]
    :(message.content??[]).filter(block=>block.type==='text').map(block=>block.text);
const directionRules=[
    "identify whose purse changes and who gives money to whom before choosing delta",
    "Positive delta enters subject's purse; negative delta leaves it.",
    "Returning an advance to its payer is negative for the investigator; receiving a merchant's refund is positive.",
    "source found identifies the amount's origin, not income.",
    'Check the proposed direction against the actual chosen transfer before applying it or writing the final record.',
];

function cashSchema(messages){
    for(const text of messages.flatMap(textParts)){
        let value;try{value=JSON.parse(text);}catch{continue;}
        const card=[...(value.capabilities??[]),...(value.capability_detail??[])].find(row=>row.name==='cash');
        if(card?.fields?.properties)return card.fields;
        if(typeof card?.detail==='string')return JSON.parse(card.detail);
    }
}

test('the actual single Keeper receives purse direction guidance and records both directions once with unchanged source and counterparty',async t=>{
    const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null,npcAct:null});
    const exchanges=[
        {input:'I accept the twenty dollar advance from Knott.',delta:20,why:'Advance received',text:'Knott hands over the advance.'},
        {input:'I return the twenty dollar advance to Knott.',delta:-20,why:'Advance returned',text:'You return the advance to Knott.'},
        {input:'I accept the half dollar refund from Knott.',delta:0.5,why:'Refund received',text:'Knott gives you the small refund.'},
    ];
    const effects=exchanges.map(row=>({kind:'cash',subject:'Thomas Hayes',delta:row.delta,
        category:'transfer',source:'found',with:'Steven Knott',why:row.why}));
    const requests=[];
    const capture=context=>{
        requests.push({system:String(getCurrentSystemPrompt(context.messages)),tools:getCurrentTools(context.messages),
            footer:context.messages.flatMap(textParts).findLast(text=>text.includes('You are the sole Keeper and author.')),
            schema:cashSchema(context.messages)});
    };
    const final=index=>context=>{
        capture(context);
        return fauxAssistantMessage(JSON.stringify({version:1,record:{effects:[effects[index]]},text:exchanges[index].text}));
    };
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,seedCampaign:false,runDriver:engine.runDriver,
        env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},systemPrompt:await readFile(join(root,'prompts/keeper.md'),'utf8'),
        async prepareWorkspace(workspace){
            const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'cash-direction-guidance',
                locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
            const runtime=api.createKernelRuntime(context);
            try{
                await runtime.handlers['campaign.create']({id:'test-camp',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
                await runtime.handlers['table.open']({campaign:'test-camp'});
                await runtime.handlers['table.narrate']({campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
            }finally{await runtime.close();}
        },extraExtensions:[{name:'driver',factory:engine.extension}],responses:[
            context=>{capture(context);return fauxAssistantMessage([fauxToolCall('lookup',{kind:'capability',name:'cash'})],{stopReason:'toolUse'});},
            final(0),final(1),final(2),
        ]});
    t.after(()=>table.dispose());
    const directory=join(table.workspace,'.coc/campaigns/test-camp');
    const party=join(directory,'party'),sheetPath=join(party,(await readdir(party)).find(name=>name.endsWith('.json')));
    const readSheet=async()=>JSON.parse(await readFile(sheetPath,'utf8'));
    const initialDaily=(await readSheet()).finance?.daily_spending;
    const balances=[];
    for(const [index,exchange] of exchanges.entries()){
        await table.session.prompt(exchange.input);
        const turn=JSON.parse(await readFile(join(directory,'turns',String(index+1).padStart(4,'0')+'.json'),'utf8'));
        assert.ok(turn.commit,'the canonical final record commits before publication');
        assert.equal(turn.rendered_text,exchange.text);
        const receipts=turn.receipts.filter(receipt=>receipt.kind==='cash');
        assert.equal(receipts.length,1,'one final record creates exactly one cash movement');
        const [receipt]=receipts;
        assert.equal(receipt.delta,exchange.delta);
        assert.equal(receipt.subject,'thomas-hayes');
        assert.equal(receipt.with,'steven-knott');
        assert.equal(receipt.source,'found');
        assert.equal(receipt.why,exchange.why);
        assert.equal(receipt.currency,'USD');
        assert.equal(receipt.after,receipt.before+exchange.delta);
        const sheet=await readSheet();
        assert.equal(sheet.finance.cash.amount,receipt.after,'the saved purse agrees with its canonical receipt');
        assert.equal(sheet.cash,`${receipt.after} USD`);
        assert.deepEqual(sheet.finance.daily_spending,initialDaily,'a transfer is not purchase spending');
        balances.push(receipt);
    }
    assert.equal(requests.length,4,'one read request and three final records need no second author');
    for(const request of requests){
        for(const rule of directionRules){assert.ok(request.system.includes(rule));assert.ok(request.footer?.includes(rule));}
        const apply=request.tools.find(tool=>tool.name==='apply');
        const items=apply?.parameters.properties.effects.items;
        const kinds=items?.properties?.kind?.enum??items?.anyOf?.flatMap(variant=>
            variant.properties?.kind?.enum??[variant.properties?.kind?.const]);
        assert.ok(kinds?.includes('cash'),'the actual provider is offered the canonical cash effect');
    }
    const schema=requests[1].schema;
    assert.ok(schema?.properties,'the exact CashEffect schema reaches the actual provider after its capability lookup');
    assert.ok(schema.properties.subject.description.includes("Interpret delta from this person's purse"));
    assert.ok(schema.properties.delta.description.includes('positive means subject receives money; negative means subject pays or returns money'));
    assert.ok(schema.properties.delta.description.includes('Returning an advance to its payer is negative; receiving a refund from a merchant is positive'));
    assert.ok(schema.properties.source.description.includes('this does not mean income and permits either cash direction'));
    assert.ok(schema.properties.with.description.includes('naming them does not determine the sign'));
    assert.equal(balances[1].before,balances[0].after);
    assert.equal(balances[1].after,balances[0].before,'returning the advance restores the original purse');
    assert.equal(balances[2].before,balances[1].after);
    assert.equal(balances[2].after,balances[0].before+0.5,'receiving a refund increases the investigator purse');
    assert.equal(new Set(balances.map(receipt=>receipt.id)).size,3);
    assert.equal(table.telemetry().filter(row=>row.tool==='apply'&&row.ok).length,3);
    assert.equal(table.lanes.admission.requests().length,0,'single Keeper direction is guided without an independent semantic reviewer');
    const frames=table.entries('coc-final-delivery');
    assert.equal(frames.filter(frame=>frame.event==='delta').map(frame=>frame.delta).join(''),exchanges.map(row=>row.text).join(''),
        'private records and purse instructions never enter public prose');
    assert.equal(frames.filter(frame=>frame.status==='completed').length,3);
    assert.deepEqual(table.extensionErrors,[]);
    t.diagnostic('Scripted replies prove production guidance delivery, canonical record transport and cash arithmetic; live semantic judgement is assessed separately.');
});
