/** Closed decision replay through current candidate, binder and canonical TS kernel; no model or play claims. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const root=resolve(import.meta.dirname,'../..');
const input='I stay in the safe room and wait 5 minutes for an explicit callback; I do not leave.';
let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/declared-time-'));
    await build({stdin:{contents:[
        "export {buildCandidates,kernelCall} from './runtime/jev/candidates.ts';",
        "export {bindBatch,initialView,interpretBind,createStepPolicy} from './runtime/jev/step-policy.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"
        ,"export {CampaignWriter} from './kernel-ts/write/store.ts';"
    ].join('\n'),resolveDir:root,sourcefile:'declared-time-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
const scope={owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
const context={scene:'commission-briefing',clock:null,present:[],receipts:[]};
const reads={capsule:{},applyOptions:{},resolveOptions:{},bands:{time:[{handle:'short_rest',min:60,max:240},{handle:'quick_observation',min:0,max:5}],gates:{time:0.5}}};
function candidate(text=input,source=reads){return api.buildCandidates(source,text).find(value=>value.key==='apply:time:declared');}
function bind(value,selected,confidence=0.9){
    const view=api.initialView({runId:'closed-duration-replay',rawInput:input,context,candidates:[value],compile:false,readFirst:false});
    const batch=api.bindBatch(view,value,scope,[]);
    const result={status:'complete',answers:{band:{status:'answered',type:'choice',choice:selected,confidence,probabilities:{[selected]:confidence}}}};
    return {batch,...api.interpretBind(value,batch,result,0.6)};
}
test('a fixed player wait has an issued exact interval beside ordinary activity bands',()=>{
    const value=candidate(),durations=Object.entries(value.timeDurations??{});
    assert.equal(durations.length,1,'the chosen fixed interval must be representable, instead of only a 60-240 minute rest');
    const [alias,duration]=durations[0];assert.equal(duration.minutes,5);assert.equal(input.slice(duration.start,duration.end),duration.text);
    const bound=bind(value,alias);assert.deepEqual(bound.pending.map(p=>[p.kind,p.purpose]),[['direct','execute']]);
    const effect=api.kernelCall(value,bound.extra).params.effects[0];assert.equal(effect.minutes,5);assert.equal(effect.band,undefined);
    assert.equal(bound.bindings[0].path,'jev');assert.equal(bound.bindings[0].band,undefined);
    assert.ok(Object.hasOwn(bound.batch.questions[0].criteria,'short_rest'),'ordinary activities retain the actual kernel band');
});
test('different occurrences remain closed choices; the last number is never chosen by syntax',()=>{
    const text='The earlier call took 5 minutes. I now wait 10 minutes.',value=candidate(text),entries=Object.entries(value.timeDurations??{});
    assert.deepEqual(entries.map(([,v])=>v.minutes),[5,10]);
    const chosen=bind(value,entries[1][0]);assert.equal(api.kernelCall(value,chosen.extra).params.effects[0].minutes,10);
    const ordinary=bind(value,'quick_observation');assert.equal(api.kernelCall(value,ordinary.extra).params.effects[0].band,'quick_observation');
    const unknown=bind(value,'unknown');assert.equal(unknown.pending.some(p=>p.purpose==='execute'||p.purpose==='bind'||p.purpose==='adjudicate'),false);
    assert.equal(unknown.pending[0].purpose,'compose','only clarification/narration remains when the host cannot bind time');
    const forged=bind(value,'duration:not-issued');assert.equal(forged.pending.some(p=>p.purpose==='execute'),false);
    const low=bind(value,entries[1][0],0.2);assert.equal(low.pending.some(p=>p.purpose==='execute'),false);
    const unavailable=api.interpretBind(value,chosen.batch,undefined,0.6);assert.equal(unavailable.pending[0].purpose,'compose');
    const policy=api.createStepPolicy({context,candidates:[value],compile:false,readFirst:false,scope});
    const state=policy.initial({runId:'unavailable-time',rawInput:input});state.view.pending=unavailable.pending;
    const request=policy.next({policyState:state,observations:[],pendingProposals:[],steps:0});
    assert.equal(request.purpose,'compose');assert.equal(request.request.declared_time_unresolved.time_unsettled,true,'the unsettled interval reaches the real driver request');
});
test('source numeral syntax includes the retained five-minute declaration without classifying its strategy',()=>{
    const historical='\u6211\u6309\u8b66\u5458\u5efa\u8bae\u7ee7\u7eed\u7559\u5728\u65e0\u7a97\u5185\u5ba4\uff0c\u518d\u5b89\u9759\u7b49\u4e94\u5206\u949f\uff0c\u8ba9\u56fa\u5b9a\u603b\u673a\u6216\u4e3b\u7ba1\u7ed9\u51fa\u660e\u786e\u7684\u7b54\u590d\uff1b\u4e0d\u51fa\u95e8\u3002';
    assert.deepEqual(Object.values(candidate(historical).timeDurations??{}).map(v=>v.minutes),[5]);
    assert.deepEqual(Object.values(candidate('I wait 1.5 hours.').timeDurations??{}).map(v=>v.minutes),[90]);
    assert.deepEqual(Object.values(candidate('I wait five minutes.').timeDurations??{}).map(v=>v.minutes),[5]);
    assert.deepEqual(Object.values(candidate('I wait 120 seconds.').timeDurations??{}).map(v=>v.minutes),[2]);
    for(const text of ['I wait -5 minutes.','I wait 0.5 minutes.','I wait 5-10 minutes.','It is 12:05 minutes.','I read file 5.',
        'I wait 1 hour and 30 minutes.','I wait 5 minutes and 30 seconds.','I wait one hundred five minutes.','I wait 1 hour and a half.',
        'I wait \u4e00\u767e\u4e94\u5206\u949f.',Array(17).fill('5 minutes.').join(' '),'x'.repeat(16001)+' 5 minutes.'])
        assert.deepEqual(candidate(text).timeDurations??{},{});
    assert.equal(candidate(input,{...reads,applyOptions:{context:{current_receipts:[{kind:'time',minutes:5}]}}}),undefined,'time is charged once');
    assert.equal(candidate(input,{...reads,resolveOptions:{context:{session:{kind:'combat',status:'active'}}}}),undefined,'combat uses rounds');
});
test('unsupported complete numerals and compound intervals never expose an executable component to the real binder',()=>{
    const rejected=['1,000 minutes','1,5 hours','1, 000 minutes','1 000 minutes','1 hour, 30 minutes','1 hour + 30 minutes',
        'half an hour and 5 minutes','5 minutes and half an hour','5 minutes and 1 1/2 hours','1 1/2 hours and 5 minutes',
        '1 hour and30 minutes','one hundred five minutes','1 hour + half','1 hour, half','1 hour/30 minutes','1 hour-30 minutes',
        '\u4e94\u5206\u949f\u548c\u5341\u79d2'];
    for(const interval of rejected){
        const value=candidate(`I wait ${interval}.`);
        assert.deepEqual(value.timeDurations??{},{},interval);
        const batch=api.bindBatch(api.initialView({runId:'partial-duration',rawInput:`I wait ${interval}.`,context,candidates:[value],compile:false,readFirst:false}),value,scope,[]);
        assert.equal(Object.keys(batch.questions[0].criteria).some(key=>key.startsWith('duration:')),false,interval);
        const invented=bind(value,'duration:0');
        assert.equal(invented.pending.some(item=>item.purpose==='execute'||item.purpose==='adjudicate'),false,interval);
        assert.equal(invented.pending[0].purpose,'compose',interval);
    }
    for(const [interval,minutes] of [['1.5 hours',90],['5 minutes',5],['twenty-five minutes',25]]){
        const value=candidate(`I wait ${interval}.`),alias=Object.keys(value.timeDurations)[0],bound=bind(value,alias);
        assert.equal(api.kernelCall(value,bound.extra).params.effects[0].minutes,minutes,interval);
    }
});
test('exact closed interval reaches real apply, clock projection and replay receipts twice without moving anyone',async()=>{
    const home=playtestScratch('declared-time-interval-contracts'),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'fixed-wait',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    try{
        const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
        await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
        const campaign=new api.CampaignWriter(kernel,'c1'),evidence=[];
        let initial,afterFirst;
        for(let turn=1;turn<=2;turn++){
            await call('table.player_input',{text:input});
            const source={capsule:await call('table.capsule'),applyOptions:await call('table.apply.options'),resolveOptions:await call('table.resolve.options'),bands:{time:(await call('rules.bands',{field:'time.band'})).rows}};
            const before=await campaign.readWorld();if(turn===1)initial=before;
            const value=candidate(input,source),alias=Object.keys(value.timeDurations)[0],bound=bind(value,alias),operation=api.kernelCall(value,bound.extra);
            const args={call_id:`t${turn}-c1`,...operation.params};
            await call(operation.method,args);const replay=await call(operation.method,args);assert.equal(replay.replayed,true);
            const status=await call('table.status'),after=await campaign.readWorld(),receipt=status.receipts.find(r=>r.kind==='time');
            assert.equal(receipt.minutes,5);assert.equal(receipt.clock_after-receipt.clock_before,5);assert.equal(receipt.band,undefined);
            assert.equal(after.active_scene,before.active_scene);assert.deepEqual(after.npc_locations,before.npc_locations);
            const capsule=await call('table.capsule');assert.equal(capsule.where.clock.minutes,after.clock.minutes);
            if(turn===1)afterFirst=after;else assert.equal(after.clock.minutes-afterFirst.clock.minutes,5);
            evidence.push({turn,selected:alias,operation:operation.params,receipt,projected_minutes:capsule.where.clock.minutes,replayed:replay.replayed,scene_before:before.active_scene,scene_after:after.active_scene});
            await call('table.narrate',{call_id:`t${turn}-c2`,text:'The chosen five-minute interval passes. There is no callback; the investigator remains in the room.'});
        }
        const final=await campaign.readWorld();assert.equal(final.clock.minutes-initial.clock.minutes,10);
        if(process.env.JEV04_REPORT)await writeFile(process.env.JEV04_REPORT,JSON.stringify({kind:'closed-decision-kernel-contract',live_play:false,model_calls:0,initial_minutes:initial.clock.minutes,final_minutes:final.clock.minutes,evidence},null,2)+'\n');
    }finally{await runtime.close();}
});
