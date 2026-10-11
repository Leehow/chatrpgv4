/**
 * Contract §218.1 (amends §138.10's literal intervals, §211.2 and §211.3): the stated measure of a declared time -- the clock
 * time at which what the investigator does now ends, or the length of the time they let pass -- is read by Jev on
 * host-enumerated number grids, never by a host lexer. Closed decision replay through the current candidate, binder and
 * canonical TS kernel with captured band answers from the d6c live table; no model call, no play claim.
 */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const root=resolve(import.meta.dirname,'../..');
let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/declared-time-'));
    await build({stdin:{contents:[
        "export {buildCandidates,kernelCall} from './runtime/jev/candidates.ts';",
        "export {bindBatch,initialView,interpretBind,createStepPolicy,STATED_KEYS,STATED_AMOUNTS} from './runtime/jev/step-policy.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
        "export {CampaignWriter} from './kernel-ts/write/store.ts';",
    ].join('\n'),resolveDir:root,sourcefile:'declared-time-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
const scope={owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'};
const context={scene:'corbitt-house-ground',clock:null,present:[],receipts:[]};
// The 17 act rows of the live table's time-costs (the told-time rows of d6c), in its order.
const capturedRows=['speak_briefly','quick_observation','single_room_search','careful_house_search','library_research','first_aid','medicine_treatment','short_rest',
    'sleep_night','therapy_week','therapy_month','spell_learning','tome_study','investigation_recovery','momentary','brief_activity','record_lookup'];
const reads={capsule:{},applyOptions:{},resolveOptions:{},bands:{time:capturedRows.map(handle=>handle==='sleep_night'?{handle,min:360,max:600}
    :handle==='tome_study'?{handle,min:168,max:6720}:{handle,min:1,max:30}),gates:{time:0.5}}};
const views=key=>[key,`${key}__semantic_facts`,`${key}__semantic_execution`];
const zero=Object.fromEntries(capturedRows.map(handle=>[handle,0]));
// d6c turn 43, telemetry row 20481 (purpose bind): "...read Corbitt's diaries until nine in the evening", written in Han numerals.
// The three band views verbatim; the base bound tome_study (pooled .567) and the kernel rolled 5,488 minutes.
const t43Input='天要黑了，我不在这屋里过夜。我把三本日记夹在胳膊底下，把椅子挪回原处，带上前门锁好。出门找街口最近一家还开着的小饭馆，要一份晚饭和一壶咖啡，坐在靠灯的位子上，从第一本开始读科比特的日记，一直读到晚上九点再说。';
const t43Band={
    band:{...zero,single_room_search:.01,careful_house_search:.01,library_research:.04,tome_study:.55,investigation_recovery:.01,momentary:.01,brief_activity:.09,record_lookup:.03,unknown:.25},
    band__semantic_facts:{...zero,single_room_search:.01,careful_house_search:.01,library_research:.03,tome_study:.59,investigation_recovery:.01,momentary:.01,brief_activity:.07,record_lookup:.03,unknown:.24},
    band__semantic_execution:{...zero,single_room_search:.01,careful_house_search:.01,library_research:.03,tome_study:.56,investigation_recovery:.01,brief_activity:.08,record_lookup:.04,unknown:.25}};
// d6c turn 48 (purpose bind): "...walk back, buy a sandwich, write up the day, sleep, get up at 07:30". The band views verbatim,
// re-keyed onto this vocabulary: the retired literal option clock:0 (.26/.27/.27) is dropped and the rest renormalized.
const t48Input='“谢谢，那我明早来。”我出了市政厅，步行回寄宿处，路上在面包铺买个夹肉面包当晚饭。回屋把今天的事记进采访本，然后睡觉，07:30起床。';
const renorm=dist=>{const sum=Object.values(dist).reduce((a,b)=>a+b,0);return Object.fromEntries(Object.entries(dist).map(([key,value])=>[key,value/sum]));};
const t48Band={
    band:renorm({...zero,speak_briefly:.02,sleep_night:.33,investigation_recovery:.01,momentary:.02,brief_activity:.11,record_lookup:.01,unknown:.24}),
    band__semantic_facts:renorm({...zero,speak_briefly:.02,library_research:.01,sleep_night:.32,investigation_recovery:.01,momentary:.02,brief_activity:.12,record_lookup:.01,unknown:.22}),
    band__semantic_execution:renorm({...zero,speak_briefly:.02,sleep_night:.35,investigation_recovery:.01,momentary:.01,brief_activity:.12,record_lookup:.01,unknown:.21})};
function candidate(text,source=reads){return api.buildCandidates(source,text).find(value=>value.key==='apply:time:declared');}
/** One grid read the same in its three views: `lead` carries `top`, the rest of the mass is spread over the other options. */
function grid(batch,key,lead,top){
    const options=Object.keys(batch.questions.find(q=>q.key===key).criteria),rest=(1-top)/(options.length-1);
    const probabilities=Object.fromEntries(options.map(option=>[option,option===lead?top:rest]));
    return Object.fromEntries(views(key).map(view=>[view,probabilities]));
}
function answered(distributions){
    const answers=Object.fromEntries(Object.entries(distributions).map(([key,probabilities])=>{
        const choice=Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0][0];
        return [key,{status:'answered',type:'choice',choice,confidence:probabilities[choice],probabilities}];}));
    return {status:'complete',answers};
}
/** Bind with the captured band views (re-keyed onto the issued rows) and the given grid answers. */
function bindWith(text,band,grids=()=>({}),source=reads){
    const value=candidate(text,source);
    const view=api.initialView({runId:'stated-measure-replay',rawInput:text,context,candidates:[value],compile:false,readFirst:false});
    const batch=api.bindBatch(view,value,scope,[]),rows=Object.keys(batch.questions.find(q=>q.key==='band').criteria);
    const onto=dist=>Object.fromEntries(rows.map(option=>[option,dist[option]??0]));
    const answers={...Object.fromEntries(Object.entries(band).map(([key,dist])=>[key,onto(dist)])),...grids(batch)};
    return {value,batch,...api.interpretBind(value,batch,answered(answers),0.6)};
}
const end=(hour,minute,half,top={hour:.8,minute:.85,half:.75})=>batch=>({...grid(batch,'stated_end:hour',hour,top.hour),
    ...grid(batch,'stated_end:minute',minute,top.minute),...grid(batch,'stated_end:half',half,top.half)});
const span=(unit,amount,top={unit:.8,amount:.8})=>batch=>({...grid(batch,'stated_span:unit',unit,top.unit),...grid(batch,'stated_span:amount',amount,top.amount)});
const noMeasure=batch=>({...grid(batch,'stated_end:hour','none',.9),...grid(batch,'stated_span:unit','none',.9)});

test('§218.1 the time candidate offers the activity rows only; the bind asks the five grids in three views, each with its none boundary',()=>{
    const value=candidate(t43Input);
    assert.equal(value.timeDurations,undefined);assert.equal(value.timeClocks,undefined);
    const batch=api.bindBatch(api.initialView({runId:'grids',rawInput:t43Input,context,candidates:[value],compile:false,readFirst:false}),value,scope,[]);
    const band=batch.questions.find(q=>q.key==='band');
    assert.deepEqual(Object.keys(band.criteria),[...capturedRows,'unknown'],'no literal option: a stated measure is its own question');
    const keys=batch.questions.map(q=>q.key);
    for(const key of Object.values(api.STATED_KEYS))for(const view of views(key))assert.ok(keys.includes(view),`${view} is asked`);
    const hour=batch.questions.find(q=>q.key==='stated_end:hour');
    assert.deepEqual(Object.keys(hour.criteria),['none',...Array.from({length:12},(_,i)=>`h${i+1}`),'unknown']);
    assert.match(hour.criteria.h9,/09:00-09:59 or 21:00-21:59/);assert.match(hour.criteria.h12,/00:00-00:59.*12:00-12:59/);
    for(const word of ['schedule','opening or closing hour','appointment','quotation','deadline','past moment','condition that is not met now'])
        assert.ok(hour.criteria.none.includes(word),word);
    assert.equal(Object.keys(batch.questions.find(q=>q.key==='stated_end:minute').criteria).length,61);
    assert.deepEqual(Object.keys(batch.questions.find(q=>q.key==='stated_end:half').criteria),['am','pm','not_said','unknown']);
    assert.deepEqual(Object.keys(batch.questions.find(q=>q.key==='stated_span:unit').criteria),['none','minutes','hours','days','unknown']);
    const amounts=Object.keys(batch.questions.find(q=>q.key==='stated_span:amount').criteria);
    for(const key of ['x0.25','x0.5','x1','x9.5','x12','x13','x120','unknown'])assert.ok(amounts.includes(key),key);
    assert.equal(amounts.includes('x12.5'),false,'halves stop at twelve');
    assert.equal(api.STATED_AMOUNTS.length,134);
    // The host reads no word: the same issued options for every script.
    const english=api.bindBatch(api.initialView({runId:'grids-en',rawInput:'I read until nine.',context,candidates:[candidate('I read until nine.')],compile:false,readFirst:false}),candidate('I read until nine.'),scope,[]);
    assert.deepEqual(english.questions.map(q=>[q.key,Object.keys(q.criteria)]),batch.questions.map(q=>[q.key,Object.keys(q.criteria)]));
});

test('§218.1 t43: the captured band alone still binds tome_study; with the end read as nine in the evening it binds until 21:00 and rolls no band',()=>{
    const base=bindWith(t43Input,t43Band);
    assert.equal(base.extra.band,'tome_study','the live behaviour: the band decided');
    const pm=bindWith(t43Input,t43Band,end('h9','m00','pm'));
    assert.deepEqual(pm.pending.map(p=>[p.kind,p.purpose]),[['direct','execute']]);
    assert.deepEqual(pm.extra.until,{time:'21:00'});assert.equal(pm.extra.band,undefined);assert.equal(pm.extra.minutes,undefined);
    const effect=api.kernelCall(pm.value,pm.extra).params.effects[0];
    assert.deepEqual(effect.until,{time:'21:00'});assert.equal(effect.band,undefined);
    const record=pm.bindings.find(b=>b.name==='until');
    assert.equal(record.path,'jev');assert.equal(record.value,'21:00');assert.equal(record.superseded.choice,'tome_study');
    assert.equal(record.stated['stated_end:hour'].choice,'h9');
    assert.equal(pm.bindings.some(b=>b.name==='band'),false,'no band is rolled');
    // The half not fixed: the kernel takes the reading it reaches first.
    const either=bindWith(t43Input,t43Band,end('h9','m00','not_said',{hour:.8,minute:.85,half:.7}));
    assert.deepEqual(either.extra.until,{time:'09:00',either_half:true});
    assert.equal(either.bindings.find(b=>b.name==='until').either_half,true);
    const weakHalf=bindWith(t43Input,t43Band,end('h9','m00','pm',{hour:.8,minute:.85,half:.5}));
    assert.deepEqual(weakHalf.extra.until,{time:'09:00',either_half:true},'a half below its bar is not fixed');
});

test('§218.1 the hold: an end the grids lead with but cannot read with confidence never becomes a band roll',()=>{
    for(const grids of [end('h9','m00','pm',{hour:.4,minute:.85,half:.75}),end('h9','m00','pm',{hour:.8,minute:.3,half:.75}),
        span('minutes','x0.5'),span('hours','x9.5',{unit:.8,amount:.2})]){
        const held=bindWith(t43Input,t43Band,grids);
        assert.equal(held.pending.some(p=>p.purpose==='execute'),false);
        assert.equal(held.pending[0].purpose,'compose');assert.equal(held.pending[0].extra.time_unsettled,true);
        assert.equal(held.pending[0].extra.cause,'stated_measure_uncertain');
        assert.equal(held.extra?.band,undefined,'the base rolled tome_study here');
    }
    // Neither grid leads with a measure: the band decides, as before.
    const none=bindWith(t43Input,t43Band,noMeasure);
    assert.equal(none.extra.band,'tome_study');
});

test('§218.1 t48: the captured band with the end read as 07:30 in the morning binds until 07:30 over sleep_night',()=>{
    const base=bindWith(t48Input,t48Band);
    assert.equal(base.extra.band,'sleep_night','the live behaviour: 401 minutes rolled, 00:21');
    const bound=bindWith(t48Input,t48Band,end('h7','m30','am'));
    assert.deepEqual(bound.extra.until,{time:'07:30'});assert.equal(bound.extra.band,undefined);
    assert.equal(bound.bindings.find(b=>b.name==='until').superseded.choice,'sleep_night');
});

test('§218.1 a stated length binds whole minutes; with an end as well the end wins; a non-whole length holds',()=>{
    const text='I lie down and sleep for 8 hours.';
    const length=bindWith(text,t48Band,span('hours','x8'));
    assert.equal(length.extra.minutes,480);assert.equal(length.extra.band,undefined);assert.equal(length.extra.until,undefined);
    assert.equal(length.bindings.find(b=>b.name==='minutes').superseded.choice,'sleep_night');
    const half=bindWith('I wait nine and a half hours.',t48Band,span('hours','x9.5'));
    assert.equal(half.extra.minutes,570);
    const quarter=bindWith('I wait a quarter of an hour.',t48Band,span('hours','x0.25'));
    assert.equal(quarter.extra.minutes,15);
    const both=bindWith('I sleep 8 hours and get up at 07:00.',t48Band,batch=>({...end('h7','m00','am')(batch),...span('hours','x8')(batch)}));
    assert.deepEqual(both.extra.until,{time:'07:00'});assert.equal(both.extra.minutes,undefined);
    assert.equal(both.bindings.find(b=>b.name==='until').superseded.span_minutes,480);
});

test('§218.1 time is still charged once and never in a fight; unknown, low or unavailable stays unsettled',()=>{
    assert.equal(candidate(t43Input,{...reads,applyOptions:{context:{current_receipts:[{kind:'time',minutes:5}]}}}),undefined,'time is charged once');
    assert.equal(candidate(t43Input,{...reads,resolveOptions:{context:{session:{kind:'combat',status:'active'}}}}),undefined,'combat uses rounds');
    const value=candidate(t43Input);
    const unknown=bindWith(t43Input,{band:{...zero,unknown:1},band__semantic_facts:{...zero,unknown:1},band__semantic_execution:{...zero,unknown:1}},noMeasure);
    assert.equal(unknown.pending[0].purpose,'compose');
    const batch=api.bindBatch(api.initialView({runId:'unavailable',rawInput:t43Input,context,candidates:[value],compile:false,readFirst:false}),value,scope,[]);
    const unavailable=api.interpretBind(value,batch,undefined,0.6);assert.equal(unavailable.pending[0].purpose,'compose');
    const policy=api.createStepPolicy({context,candidates:[value],compile:false,readFirst:false,scope});
    const state=policy.initial({runId:'unavailable-time',rawInput:t43Input});state.view.pending=unavailable.pending;
    const request=policy.next({policyState:state,observations:[],pendingProposals:[],steps:0});
    assert.equal(request.purpose,'compose');assert.equal(request.request.declared_time_unresolved.time_unsettled,true);
});

test('§218.1 the declaration module is gone: no host lexer reads the player\'s words for time',()=>{
    assert.equal(existsSync(join(root,'runtime/jev/declared-duration.ts')),false);
});

async function kernelAt(name,minutes,t){
    const home=playtestScratch(name),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:name,locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    t.after(()=>runtime.close());
    const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
    await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'zh-Hans'});await call('table.open');
    await call('table.player_input',{text:'I spend the day on the case.'});
    await call('table.apply',{call_id:'t1-c1',effects:[{kind:'time',minutes,why:'the day on the case'}]});
    await call('table.narrate',{call_id:'t1-c2',text:'The day goes.'});
    call.kernel=kernel;
    return call;
}
test('§218.1 over the TS kernel at 18:28: the captured t43 declaration with its end read binds until 21:00 -- 152 minutes, not 5,488',async t=>{
    const call=await kernelAt('stated-end-t43',508,t);
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-12T18:28');
    await call('table.player_input',{text:t43Input});
    const source={capsule:await call('table.capsule'),applyOptions:await call('table.apply.options'),resolveOptions:await call('table.resolve.options'),bands:{time:(await call('rules.bands',{field:'time.band'})).rows,gates:{time:0.5}}};
    const bound=bindWith(t43Input,t43Band,end('h9','m00','not_said',{hour:.8,minute:.85,half:.7}),source);
    const operation=api.kernelCall(bound.value,bound.extra);
    assert.deepEqual(operation.params.effects[0].until,{time:'09:00',either_half:true});
    await call(operation.method,{call_id:'t2-c1',...operation.params});
    const receipt=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(receipt.minutes,152);assert.deepEqual(receipt.until,{days:0,time:'21:00',either_half:true});assert.equal(receipt.band,undefined);
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-12T21:00');
});
test('§218.1 either_half at 23:10 reaches 07:00 the next morning; with days or an afternoon time it is until_invalid',async t=>{
    const call=await kernelAt('stated-end-either',790,t);
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-12T23:10');
    await call('table.player_input',{text:'I go to bed and get up at seven.'});
    await assert.rejects(call('table.apply',{call_id:'t2-c1',effects:[{kind:'time',until:{days:1,time:'07:00',either_half:true}}]}),error=>error.details?.reason==='until_invalid');
    await assert.rejects(call('table.apply',{call_id:'t2-c2',effects:[{kind:'time',until:{time:'19:00',either_half:true}}]}),error=>error.details?.reason==='until_invalid');
    await call('table.apply',{call_id:'t2-c3',effects:[{kind:'time',until:{time:'07:00',either_half:true}}]});
    const receipt=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(receipt.minutes,470);assert.deepEqual(receipt.until,{days:1,time:'07:00',either_half:true});
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T07:00');
    // §211.1 unchanged: a fixed time without either_half is its own next occurrence.
    await call('table.apply',{call_id:'t2-c4',effects:[{kind:'time',until:{time:'08:00'}}]});
    const next=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(next.minutes,60);assert.deepEqual(next.until,{days:1,time:'08:00'});
});

/*
 * §218.8: the 4d7 live table (runtime 4d77fddb4, turns 68-101). `fixtures/time-ledger-4d7-grids.json` holds, per stated-time turn,
 * the player's input and the pooled distributions of the bind row (its stated grids and the superseded band), as captured; each
 * pooled distribution is replayed in the three views. The questions §218.8 adds (kind, journey, scope) were not asked live: where a
 * test needs them their answers are stated, synthetic, beside the captured grids.
 */
const live=JSON.parse(readFileSync(join(root,'tests/extension/fixtures/time-ledger-4d7-grids.json'),'utf8')).turns;
/** A captured sparse pooled distribution over the issued options of `key`, renormalized, in its three views. */
function captured(batch,key,dist){
    const options=Object.keys(batch.questions.find(q=>q.key===key).criteria);
    const sum=options.reduce((total,option)=>total+(dist[option]??0),0);
    const probabilities=Object.fromEntries(options.map(option=>[option,(dist[option]??0)/sum]));
    return Object.fromEntries(views(key).map(view=>[view,probabilities]));
}
/** Replay turn `t` with its captured band and grids, and any stated answers for the questions §218.8 adds. */
function replay(t,extra=()=>({})){
    const turn=live[t];
    return bindWith(turn.input,{band:turn.band,band__semantic_facts:turn.band,band__semantic_execution:turn.band},
        batch=>({...Object.fromEntries(Object.entries(turn.grids).flatMap(([key,dist])=>Object.entries(captured(batch,key,dist)))),...extra(batch)}));
}
const held=bound=>{
    assert.equal(bound.pending.some(p=>p.purpose==='execute'),false,'nothing is executed');
    assert.equal(bound.pending[0].purpose,'compose');assert.equal(bound.pending[0].extra.time_unsettled,true);
    return bound.pending[0].extra.cause;
};

test('§218.8 the questions: what the stated time is, the order against a journey, how much a length covers; the minute and half say half past and noon',()=>{
    const value=candidate(live[79].input);
    const batch=api.bindBatch(api.initialView({runId:'grids-218-8',rawInput:live[79].input,context,candidates:[value],compile:false,readFirst:false}),value,scope,[]);
    const keys=batch.questions.map(q=>q.key);
    for(const key of ['stated_end:kind','stated_end:journey','stated_span:scope'])for(const view of views(key))assert.ok(keys.includes(view),`${view} is asked`);
    const options=key=>Object.keys(batch.questions.find(q=>q.key===key).criteria);
    assert.deepEqual(options('stated_end:kind'),['end_of_now','start_only','deadline','condition','other_time','no_time','unknown']);
    assert.deepEqual(options('stated_end:journey'),['journey_then_end','end_then_journey','both_sides','no_journey','unknown']);
    assert.deepEqual(options('stated_span:scope'),['all','one_part','no_length','unknown']);
    const minute=batch.questions.find(q=>q.key==='stated_end:minute');
    assert.equal(/no minutes are given/.test(minute.criteria.m00),false,'a half written as a word gives no minute digits: m00 is exactly on the hour');
    assert.match(minute.criteria.m30,/half past/);assert.match(minute.criteria.m15,/quarter past/);assert.match(minute.criteria.m45,/quarter to/);
    const half=batch.questions.find(q=>q.key==='stated_end:half');
    assert.match(half.criteria.pm,/noon itself/);assert.match(half.criteria.am,/midnight itself/);
    const hour=batch.questions.find(q=>q.key==='stated_end:hour');
    assert.match(hour.instructions,/take when it ends/);
});

test('§218.8 the captured 4d7 misses: a condition, a deadline, a bedtime and a half-past minute hold where the base bound 14:00, 17:00, 18:00, 22:00 and 08:00',()=>{
    for(const t of [73,90,99,76,79]){
        const bound=replay(t);
        assert.equal(bound.extra?.until,undefined,`t${t}: the base bound ${live[t].bound.value}`);
        assert.equal(held(bound),'stated_measure_uncertain',`t${t}`);
    }
});

test('§218.8 with the role read as a deadline or a condition no end was stated: the band decides',()=>{
    const role=(choice,top=.85)=>batch=>grid(batch,'stated_end:kind',choice,top);
    const t90=replay(90,role('deadline'));
    assert.equal(t90.extra.until,undefined);assert.equal(t90.extra.band,'speak_briefly','the ride before the shift change is the move\'s, not an end');
    const t99=replay(99,role('condition'));
    assert.equal(t99.extra.until,undefined);assert.equal(t99.extra.band,'brief_activity');
    // t73's band led unknown: the declared time stays unsettled, but not for a stated measure.
    assert.equal(held(replay(73,role('condition'))),'unknown_binding');
    // A role below its bar is unsure: hold, whatever the hour.
    assert.equal(held(replay(93,role('end_of_now',.5))),'stated_measure_uncertain');
    // A confident end with the hour, minute and half read binds it: t76 read as getting up at 06:30.
    const t76=replay(76,batch=>({...role('end_of_now')(batch),...grid(batch,'stated_end:hour','h6',.9),...grid(batch,'stated_end:minute','m30',.85),...grid(batch,'stated_end:half','am',.9)}));
    assert.equal(t76.extra.until.time,'06:30');
});

test('§218.8 t69: twelve noon with no fixed half binds 12:00 either_half, not 00:00',()=>{
    const t69=replay(69);
    assert.deepEqual(t69.extra.until,{time:'12:00',either_half:true});
    const pm=replay(69,batch=>grid(batch,'stated_end:half','pm',.9));assert.deepEqual(pm.extra.until,{time:'12:00'});
    const am=replay(69,batch=>grid(batch,'stated_end:half','am',.9));assert.deepEqual(am.extra.until,{time:'00:00'},'twelve in the first half is midnight');
});

test('§218.8 the captured 4d7 reads that were right still bind; t100\'s .65 minute holds at the calibrated bar',()=>{
    for(const [t,time] of [[77,'06:30'],[84,'11:30'],[93,'07:00'],[97,'15:00']]){
        const bound=replay(t);assert.equal(bound.extra.until.time,time,`t${t}`);
    }
    assert.equal(held(replay(100)),'stated_measure_uncertain');
    for(const [t,minutes] of [[68,60],[78,10],[86,120],[92,480]])assert.equal(replay(t).extra.minutes,minutes,`t${t}`);
});

test('§218.8 the order against the turn\'s journeys binds until.journeys; a length of one part is recorded as one part',()=>{
    const order=(choice,top=.85)=>batch=>grid(batch,'stated_end:journey',choice,top);
    assert.deepEqual(replay(97,order('journey_then_end')).extra.until,{time:'15:00',journeys:'before'});
    assert.deepEqual(replay(97,order('journey_then_end',.5)).extra.until,{time:'15:00'},'an order below its bar binds none');
    assert.deepEqual(replay(97,order('no_journey')).extra.until,{time:'15:00'});
    // t79's captured hour (.79) and minute hold; read as eight-thirty (stated), the order rides on the end.
    const t79=replay(79,batch=>({...grid(batch,'stated_end:hour','h8',.85),...grid(batch,'stated_end:minute','m30',.85),...order('end_then_journey')(batch)}));
    assert.deepEqual(t79.extra.until,{time:'08:30',journeys:'after'});
    const part=replay(92,batch=>grid(batch,'stated_span:scope','one_part',.85));
    assert.equal(part.extra.minutes,480);
    assert.equal(part.bindings.find(b=>b.name==='minutes').scope,'one_part');
    assert.equal(replay(92,batch=>grid(batch,'stated_span:scope','all',.85)).bindings.find(b=>b.name==='minutes').scope,undefined);
});

test('§218.8 over the TS kernel: either_half 12:00 is noon at 09:37 and midnight at 13:00; 13:00 either_half is until_invalid',async t=>{
    const call=await kernelAt('stated-end-noon',1417,t);
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T09:37');
    await call('table.player_input',{text:live[69].input});
    await assert.rejects(call('table.apply',{call_id:'t2-c1',effects:[{kind:'time',until:{time:'13:00',either_half:true}}]}),error=>error.details?.reason==='until_invalid');
    await call('table.apply',{call_id:'t2-c2',effects:[{kind:'time',until:{time:'12:00',either_half:true}}]});
    let receipt=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(receipt.minutes,143);assert.deepEqual(receipt.until,{days:0,time:'12:00',either_half:true});
    await call('table.apply',{call_id:'t2-c3',effects:[{kind:'time',minutes:60}]});
    await call('table.apply',{call_id:'t2-c4',effects:[{kind:'time',until:{time:'12:00',either_half:true}}]});
    receipt=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(receipt.minutes,660);assert.deepEqual(receipt.until,{days:1,time:'00:00',either_half:true});
});

const LODGING={kind:'move',to:'rooming-house',establish:{summary:'A cheap rooming house a short walk from the commission office.'},via:'By tram to the rooming house.'};
test('§218.8 over the TS kernel, t97: until 15:00 with journeys before -- the ride that lands after it is inside the stated time (15:00, not 15:30)',async t=>{
    const call=await kernelAt('stated-end-before',1290,t);
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T07:30');
    await call('table.player_input',{text:live[97].input});
    await call('table.apply',{call_id:'t2-c1',effects:[{kind:'time',until:{time:'15:00',journeys:'before'}}]});
    const time=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(time.minutes,450);assert.equal(time.until.journeys,'before');
    await call('table.apply',{call_id:'t2-c2',effects:[{...LODGING,travel_minutes:30}]});
    const move=(await call('table.status')).receipts.filter(r=>r.kind==='move').at(-1);
    assert.equal(move.minutes,0);assert.deepEqual(move.inside_until,{receipt:time.id,minutes:30});
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T15:00');
    // The road keeps the journey's minutes for the next trip.
    const roads=(await new api.CampaignWriter(call.kernel,'c1').readWorld()).table_roads;
    assert.deepEqual(Object.values(roads??{}).map(road=>road.minutes),[30]);
    // Without journeys the base behaviour: the later ride adds its minutes.
    const plain=await kernelAt('stated-end-plain',1290,t);
    await plain('table.player_input',{text:live[97].input});
    await plain('table.apply',{call_id:'t2-c1',effects:[{kind:'time',until:{time:'15:00'}}]});
    await plain('table.apply',{call_id:'t2-c2',effects:[{...LODGING,travel_minutes:30}]});
    assert.equal((await plain('table.capsule')).where.clock.at,'1920-10-13T15:30');
});

test('§218.8 over the TS kernel, t79: until 08:30 with journeys after -- a ride that landed first is counted after the stated end (09:00)',async t=>{
    const call=await kernelAt('stated-end-after',1240,t);
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T06:40');
    await call('table.player_input',{text:live[79].input});
    await call('table.apply',{call_id:'t2-c1',effects:[{...LODGING,travel_minutes:30}]});
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T07:10');
    await call('table.apply',{call_id:'t2-c2',effects:[{kind:'time',until:{time:'08:30',journeys:'after'}}]});
    const time=(await call('table.status')).receipts.filter(r=>r.kind==='time').at(-1);
    assert.equal(time.minutes,110);assert.deepEqual(time.until,{days:0,time:'08:30',journeys:'after',journeys_after:30});
    assert.equal((await call('table.capsule')).where.clock.at,'1920-10-13T09:00');
    await assert.rejects(call('table.apply',{call_id:'t2-c3',effects:[{kind:'time',until:{time:'10:00',journeys:'sideways'}}]}),error=>error.details?.reason==='until_invalid');
});
