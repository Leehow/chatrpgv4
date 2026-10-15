/** Observe the production guidance delivered to the same Keeper; live play assesses its judgement. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {fauxAssistantMessage,fauxToolCall,getCurrentSystemPrompt} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

test('the real Keeper context supplies practical NPC knowledge and separates first impression from persuasion within its instruction budget',async t=>{
    const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
    let delivered,system,footer;
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
        env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},systemPrompt:await readFile(join(root,'prompts/keeper.md'),'utf8'),
        async prepareWorkspace(workspace){
            const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'rule-guidance',
                locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
            const runtime=api.createKernelRuntime(context);
            try{await runtime.handlers['table.open']({campaign:'test-camp'});
                await runtime.handlers['table.narrate']({campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
            }finally{await runtime.close();}
        },extraExtensions:[{name:'driver',factory:engine.extension}],responses:[context=>{
            system=String(getCurrentSystemPrompt(context.messages));
            footer=context.messages.map(message=>typeof message.content==='string'?message.content
                :(message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join(''))
                .findLast(content=>content.includes('You are the sole Keeper and author.'));
            delivered=system+JSON.stringify(context.messages);
            return fauxAssistantMessage('{{public}}The conversation continues.');
        }]});
    t.after(()=>table.dispose());
    await table.session.prompt('I ask Knott whether he will help arrange access.');
    assert.deepEqual(table.extensionErrors,[]);
    assert.ok(delivered.includes('A first impression concerns attitude, not success at a specific persuasion or access goal.'));
    assert.ok(delivered.includes('Already willing NPCs and obvious clues need no roll.'));
    assert.ok(!delivered.includes('A request this person might grant is uncertain, so it is rolled'));
    assert.ok(delivered.includes('Profession and local experience support ordinary practical knowledge and plausible improvisation'));
    assert.ok(delivered.includes('NPC knowledge is not a closed inventory of authored statements'));
    assert.ok(delivered.includes('Use already supplied relevant particulars for a concrete answer before another lookup'));
    assert.ok(delivered.includes('Source silence, missing retrieval or a pending read does not establish NPC ignorance'));
    assert.ok(delivered.includes('leave only that part uncertain; ordinary conversation and practical advice can continue'));
    assert.ok(delivered.includes('Your access does not grant private case facts or another character\'s hidden motives to the NPC or player'));
    assert.ok(delivered.includes('preserving established facts, actor-specific knowledge and disclosure'));
    assert.ok(!delivered.includes('an NPC acts only on its own authored knowledge'));
    assert.ok(delivered.includes('Use apply for physical changes, resources, clues, time, position and explicit semantic records'));
    assert.ok(system.includes('Party travel requires a move effect; an NPC\'s movement requires its npc effect.'));
    assert.ok(system.includes('If earlier prose outran an action the player actually chose, reconcile that action once through existing effects'));
    assert.ok(footer.includes('look and lookup read evidence; they never move people.'));
    assert.ok(footer.includes('Wait for the result before describing arrival.'));
    assert.ok(footer.includes('Never execute unchosen actions, infer state changes from prose, repeat settled effects or charge journey time twice.'));
    assert.ok(footer.includes('Future intentions use planned'));
    assert.ok(footer.includes('{{public}}'));
    for(const guidance of [system,footer]){
        assert.ok(guidance.includes('Settle actual changes and event records through the existing apply/resolve tools before writing dependent prose.'));
        assert.ok(guidance.includes('Read each actual result, correct a refused proposal through those tools'));
        assert.ok(guidance.includes('Do not place outstanding effects or event parameters in a final response.'));
        assert.doesNotMatch(guidance,/bare JSON object in version, record, text order/);
        assert.match(guidance,/No JSON wrapper/);
    }
    const publicText=table.entries('coc-final-delivery').filter(frame=>frame.event==='delta').map(frame=>frame.delta).join('');
    assert.equal(publicText,'The conversation continues.','host responsibilities never enter the public stream');
    for(const guidance of [system,footer]){
        assert.ok(guidance.includes('For prospective heard knowledge, speech material.text contains the exact public words you will use'));
        assert.ok(guidance.includes('reuse those words verbatim inside the actual speaker\'s say span'));
        assert.doesNotMatch(guidance,/optional root coverage|optional quotation coverage/);
    }
    assert.ok(system.includes('Already acquired knowledge needs no material binding.'));
    assert.ok(delivered.includes('Keep hidden motives, undisclosed source facts, private thoughts, tool arguments and hosting explanations out of public prose'));
    const capsule=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
    const instructions=capsule.mods.instructions;
    assert.ok(instructions.every(row=>row.form==='full'),'guidance remains whole inside the existing budget');
    const bytes=instructions.reduce((total,row)=>total+Buffer.byteLength(row.instruction,'utf8'),0);
    t.diagnostic(`Default package instructions: ${bytes} of 65536 bytes`);
    assert.ok(bytes<=65536);
});

test('the single Keeper can read necessary evidence beyond the legacy per-tool quota',async t=>{
    const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
        env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},
        async prepareWorkspace(workspace){
            const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'read-quota',
                locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
            const runtime=api.createKernelRuntime(context);
            try{await runtime.handlers['table.open']({campaign:'test-camp'});
                await runtime.handlers['table.narrate']({campaign:'test-camp',call_id:'t0-c1',text:'You wait in the office.'});
            }finally{await runtime.close();}
        },extraExtensions:[{name:'driver',factory:engine.extension}],responses:[
            ...Array.from({length:10},()=>fauxAssistantMessage([fauxToolCall('look',{focus:'scene'})],{stopReason:'toolUse'})),
            fauxAssistantMessage('{{public}}The office remains quiet.')
        ]});
    t.after(()=>table.dispose());
    await table.session.prompt('I study the surroundings before deciding what to do.');
    const reads=table.telemetry().filter(row=>row.tool==='look');
    assert.equal(reads.length,10);
    assert.ok(reads.every(row=>row.ok),'necessary reads reach the real kernel');
    assert.ok(!table.telemetry().some(row=>row.reason==='look_budget'));
    const status=await table.runtimeBridges().at(-1).call('table.status',{campaign:'test-camp'});
    assert.equal(status.state,'awaiting_player');
    const capsule=await table.runtimeBridges().at(-1).call('table.capsule',{campaign:'test-camp'});
    assert.equal(capsule.where.clock.minutes,0,'reads settle no physical changes');
    const publicText=table.entries('coc-final-delivery').filter(frame=>frame.event==='delta').map(frame=>frame.delta).join('');
    assert.equal(publicText,'The office remains quiet.');
    assert.deepEqual(table.extensionErrors,[]);
});
