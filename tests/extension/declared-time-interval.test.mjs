/** Closed decision replay through current candidate, binder and canonical TS kernel; no model or play claims. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
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
        ,"export {declaredClockTimes,declaredDurations} from './runtime/jev/declared-duration.ts';"
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
    const probabilities=Object.fromEntries(Object.keys(batch.questions[0].criteria).map(key=>[key,key===selected?confidence:key==='unknown'?1-confidence:0]));
    const result={status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'choice',choice:selected,confidence,probabilities}]))};
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
test('literal halves and quarters occupy a complete source span and bind only exact whole minutes',()=>{
    const accepted=[['half an hour',30],['a half hour',30],['quarter hour',15],['a quarter hour',15],
        ['one and a half hours',90],['9 and a half hours',570],['two and a quarter hours',135],
        ['\u534a\u5c0f\u65f6',30],['\u534a\u4e2a\u5c0f\u65f6',30],['\u4e5d\u4e2a\u534a\u5c0f\u65f6',570],
        ['\u4e5d\u500b\u534a\u5c0f\u6642',570],['9\u4e2a\u534a\u5c0f\u65f6',570],['\u4e00\u5929',1440]];
    for(const [interval,minutes] of accepted){
        const text=`I wait ${interval}.`,value=candidate(text),entries=Object.entries(value.timeDurations??{});
        assert.equal(entries.length,1,interval);
        const [alias,duration]=entries[0];assert.equal(duration.minutes,minutes,interval);
        assert.equal(duration.text,interval);assert.equal(text.slice(duration.start,duration.end),interval);
        assert.equal(api.kernelCall(value,bind(value,alias).extra).params.effects[0].minutes,minutes);
    }
    for(const interval of ['half a minute','quarter minute','1.5 and a half hours','one hundred and a half hours',
        '1,000\u4e2a\u534a\u5c0f\u65f6','\u4e00\u767e\u4e94\u4e2a\u534a\u5c0f\u65f6','9007199254740990 and a half minutes',
        '\u4e5d\u4e2a\u534a\u5c0f\u65f6\u534a','\u4e5d\u5c0f\u65f6\u534a',
        '\u4e5d\u4e2a\u534a\u5c0f\u65f6\u548c\u4e94\u5206\u949f','half an hour and 5 minutes']){
        const value=candidate(`I wait ${interval}.`);assert.deepEqual(value.timeDurations??{},{},interval);
        assert.equal(bind(value,'duration:0').pending.some(item=>item.purpose==='execute'),false,interval);
    }
});
test('unsupported amount lists stay bounded, including a failing suffix and near-limit input in a private process',async()=>{
    const probe=spawnSync(process.execPath,['--input-type=module','-e',`
        import {declaredDurations} from ${JSON.stringify(pathToFileURL(join(bundle,'api.mjs')).href)};
        const inputs=[26,2000,7990].flatMap(n=>[
            'I wait '+Array(n).fill('1').join(',')+'x minutes.',
            'I wait '+Array(n).fill('1').join('/')+' minutes.'
        ]);
        inputs.push('I wait '+Array(1500).fill('one').join(' and ')+' minutes.');
        const start=performance.now();
        const results=inputs.map(text=>({characters:text.length,durations:declaredDurations(text)}));
        console.log(JSON.stringify({results,elapsed_ms:performance.now()-start}));
    `],{encoding:'utf8',timeout:3000});
    assert.equal(probe.error,undefined,'the complete synchronous lexer must fit the private three-second deadline');
    assert.equal(probe.status,0,probe.stderr);
    const proof=JSON.parse(probe.stdout);
    for(const result of proof.results)assert.deepEqual(result.durations,{},String(result.characters));
    if(process.env.JEV04_LEXER_REPORT)await writeFile(process.env.JEV04_LEXER_REPORT,JSON.stringify({kind:'bounded-duration-source-probe',live_play:false,model_calls:0,
        deadline_ms:3000,elapsed_ms:proof.elapsed_ms,results:proof.results},null,2)+'\n');
});
test('exact five-minute and nine-and-a-half-hour intervals reach apply, clock projection and replay without moving anyone',async()=>{
    const home=playtestScratch('declared-time-interval-contracts'),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'fixed-wait',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    try{
        const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
        await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
        const campaign=new api.CampaignWriter(kernel,'c1'),evidence=[];
        let initial,afterFirst;
        for(let turn=1;turn<=2;turn++){
            const declaration=turn===1?input:'\u6211\u539f\u5730\u7b49\u4e5d\u4e2a\u534a\u5c0f\u65f6\u3002',minutes=turn===1?5:570;
            await call('table.player_input',{text:declaration});
            const source={capsule:await call('table.capsule'),applyOptions:await call('table.apply.options'),resolveOptions:await call('table.resolve.options'),bands:{time:(await call('rules.bands',{field:'time.band'})).rows}};
            const before=await campaign.readWorld();if(turn===1)initial=before;
            const value=candidate(declaration,source),alias=Object.keys(value.timeDurations)[0],bound=bind(value,alias),operation=api.kernelCall(value,bound.extra);
            const args={call_id:`t${turn}-c1`,...operation.params};
            await call(operation.method,args);const replay=await call(operation.method,args);assert.equal(replay.replayed,true);
            const status=await call('table.status'),after=await campaign.readWorld(),receipt=status.receipts.find(r=>r.kind==='time');
            assert.equal(receipt.minutes,minutes);assert.equal(receipt.clock_after-receipt.clock_before,minutes);assert.equal(receipt.band,undefined);
            assert.equal(after.active_scene,before.active_scene);assert.deepEqual(after.npc_locations,before.npc_locations);
            const capsule=await call('table.capsule');assert.equal(capsule.where.clock.minutes,after.clock.minutes);
            if(turn===1)afterFirst=after;else assert.equal(after.clock.minutes-afterFirst.clock.minutes,570);
            evidence.push({turn,selected:alias,operation:operation.params,receipt,projected_minutes:capsule.where.clock.minutes,replayed:replay.replayed,scene_before:before.active_scene,scene_after:after.active_scene});
            await call('table.narrate',{call_id:`t${turn}-c2`,text:'The chosen interval passes. There is no callback; the investigator remains in the room.'});
        }
        const final=await campaign.readWorld();assert.equal(final.clock.minutes-initial.clock.minutes,575);
        if(process.env.JEV04_REPORT)await writeFile(process.env.JEV04_REPORT,JSON.stringify({kind:'closed-decision-kernel-contract',live_play:false,model_calls:0,initial_minutes:initial.clock.minutes,final_minutes:final.clock.minutes,evidence},null,2)+'\n');
    }finally{await runtime.close();}
});
// §211 (issue #112 blocker 2): a declared clock endpoint -- "wait until 23:30" -- binds as `apply time {until: {time}}`;
// the kernel counts the minutes to its next occurrence from the staged clock. Closed decision replay; no model, no play.
const waitInput='I sit on the granite outside the closed library and wait until 23:30 before going back in. I do not leave.';
test('§211.2 a literal clock time in the declaration is an issued endpoint beside the activity bands and intervals',()=>{
    const value=candidate(waitInput),clocks=Object.entries(value.timeClocks??{});
    assert.equal(clocks.length,1,'the chosen clock endpoint must be representable, instead of only estimated activity bands');
    const [alias,clock]=clocks[0];assert.equal(alias,'clock:0');assert.equal(clock.time,'23:30');assert.equal(waitInput.slice(clock.start,clock.end),clock.text);
    assert.deepEqual(value.timeDurations??{},{},'a clock endpoint is not an elapsed interval');
    const batch=api.bindBatch(api.initialView({runId:'clock-replay',rawInput:waitInput,context,candidates:[value],compile:false,readFirst:false}),value,scope,[]);
    assert.match(batch.questions[0].criteria[alias],/24-hour reading 23:30/);assert.match(batch.questions[0].instructions,/next occurrence/);
    assert.ok(Object.hasOwn(batch.questions[0].criteria,'short_rest'),'ordinary activities retain the actual kernel band');
    assert.equal(value.basis.clock_source.read,'current-player-input');
});
test('§211.2 a chosen clock endpoint binds until {time} with no days, minutes or band; unoffered, unknown or low stays unsettled',()=>{
    const value=candidate(waitInput),alias=Object.keys(value.timeClocks)[0];
    const bound=bind(value,alias);assert.deepEqual(bound.pending.map(p=>[p.kind,p.purpose]),[['direct','execute']]);
    const effect=api.kernelCall(value,bound.extra).params.effects[0];
    assert.deepEqual(effect.until,{time:'23:30'},'the host sends only the time; the kernel resolves the day and the minutes');
    assert.equal(effect.minutes,undefined);assert.equal(effect.band,undefined);assert.equal(effect.kind,'time');
    assert.equal(bound.bindings[0].name,'until');assert.equal(bound.bindings[0].path,'jev');assert.equal(bound.bindings[0].value,'23:30');
    for(const held of [bind(value,'unknown'),bind(value,'clock:7'),bind(value,alias,0.2),api.interpretBind(value,bound.batch,undefined,0.6)]){
        assert.equal(held.pending.some(p=>p.purpose==='execute'||p.purpose==='bind'||p.purpose==='adjudicate'),false);
        assert.equal(held.pending[0].purpose,'compose');assert.equal(held.pending[0].extra.time_unsettled,true);
    }
    const ordinary=bind(value,'quick_observation');assert.equal(api.kernelCall(value,ordinary.extra).params.effects[0].band,'quick_observation');
});
test('§211.2 the clock lexer issues only bounded 24-hour literals; longer tokens, stamps and bad values expose nothing',()=>{
    const accepted=[['23:30','23:30'],['9:05','09:05'],['00:00','00:00'],['23：30','23:30'],['18:01','18:01']];
    for(const [literal,time] of accepted){
        const text=`I wait until ${literal}.`,entries=Object.values(api.declaredClockTimes(text));
        assert.equal(entries.length,1,literal);assert.equal(entries[0].time,time,literal);assert.equal(text.slice(entries[0].start,entries[0].end),literal);
    }
    assert.deepEqual(Object.values(api.declaredClockTimes('The call at 18:01 ended; I wait until 23:30.')).map(v=>v.time),['18:01','23:30'],'every occurrence is a closed choice; syntax chooses none');
    for(const text of ['It is 1920-10-12T18:01 now.','I wait 12:05:30.','I wait until 24:00.','I wait until 23:60.','I wait until x23:30.','I wait until 23:30x.',
        'I wait until 123:30.','I wait until 23:3.','I wait 1:30.5.','I wait until 23.30.','x'.repeat(16001)+' 23:30.',Array(17).fill('23:30.').join(' ')])
        assert.deepEqual(api.declaredClockTimes(text),{},text.slice(0,40));
    assert.equal(candidate('I wait until 23:30.',{...reads,applyOptions:{context:{current_receipts:[{kind:'time',minutes:5}]}}}),undefined,'time is charged once');
});
test('§211 over the TS kernel at 18:01: until 23:30 lands 329 minutes the same day, an earlier time of day lands the next day, equal lands 0',async()=>{
    const home=playtestScratch('declared-clock-endpoint-contracts'),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'clock-wait',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    try{
        const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
        await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
        const campaign=new api.CampaignWriter(kernel,'c1');
        // The evidence table's clock: The Haunting opens 10:00; the library closed at 18:01.
        await call('table.player_input',{text:'I spend the day in the library until it closes.'});
        await call('table.apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:481,why:'the day in the library'}]});
        await call('table.narrate',{call_id:'t1-c2',text:'The lamps go out at one minute past six; you are shown out.'});
        assert.equal((await call('table.capsule')).where.clock.at,'1920-10-12T18:01');
        const turns=[
            {text:waitInput,time:'23:30',minutes:329,at:'1920-10-12T23:30',days:0,narrate:'The hours pass on the granite; at half past eleven you stand.'},
            {text:'I wait until 06:00, when the first tram runs.',time:'06:00',minutes:390,at:'1920-10-13T06:00',days:1,narrate:'Dawn; the first tram.'},
            {text:'I wait until 06:00 exactly, not a minute more.',time:'06:00',minutes:0,at:'1920-10-13T06:00',days:0,narrate:'It is six already.'}];
        for(const [index,step] of turns.entries()){
            const turn=index+2;
            await call('table.player_input',{text:step.text});
            const source={capsule:await call('table.capsule'),applyOptions:await call('table.apply.options'),resolveOptions:await call('table.resolve.options'),bands:{time:(await call('rules.bands',{field:'time.band'})).rows}};
            const before=await campaign.readWorld();
            const value=candidate(step.text,source),entries=Object.entries(value.timeClocks??{});
            assert.equal(entries.length,1,step.text);assert.equal(entries[0][1].time,step.time);
            const bound=bind(value,entries[0][0]),operation=api.kernelCall(value,bound.extra);
            assert.deepEqual(operation.params.effects[0].until,{time:step.time});
            const args={call_id:`t${turn}-c1`,...operation.params};
            await call(operation.method,args);const replay=await call(operation.method,args);assert.equal(replay.replayed,true,'the same call lands once');
            const status=await call('table.status'),after=await campaign.readWorld(),receipt=status.receipts.filter(r=>r.kind==='time').at(-1);
            assert.equal(receipt.minutes,step.minutes,step.text);assert.equal(receipt.clock_after-receipt.clock_before,step.minutes);
            assert.deepEqual(receipt.until,{days:step.days,time:step.time},'the receipt is absolute: the kernel resolved the day');
            assert.equal(receipt.band,undefined);assert.equal(after.clock.minutes-before.clock.minutes,step.minutes);
            assert.equal((await call('table.capsule')).where.clock.at,step.at);
            assert.equal(after.active_scene,before.active_scene);assert.deepEqual(after.npc_locations,before.npc_locations);
            await call('table.narrate',{call_id:`t${turn}-c2`,text:step.narrate});
        }
        // §145.1 unchanged: the Keeper's own until with days still counts from the day the turn began, and a bad time is refused.
        await call('table.player_input',{text:'I come back the next morning.'});
        await call('table.apply',{call_id:'t5-c1',effects:[{kind:'time',until:{days:1,time:'08:00'}}]});
        const next=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
        assert.equal(next.minutes,26*60);assert.deepEqual(next.until,{days:1,time:'08:00'});
        await assert.rejects(call('table.apply',{call_id:'t5-c2',effects:[{kind:'time',until:{time:'8:00'}}]}),error=>error.details?.reason==='until_invalid');
    }finally{await runtime.close();}
});
