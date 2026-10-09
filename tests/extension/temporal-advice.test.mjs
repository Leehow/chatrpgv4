/** Mod selection/request boundary. Stub probabilities exercise protocol, not model quality or real play. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createTemporalAdvice,temporalSituation,temporalAdviceBatch,TEMPORAL_ADVICE_MESSAGE} from '../../extensions/table/temporal-advice.ts';
import {readTable} from '../../runtime/jev/hybrid-engine.ts';
import {compileBatch} from '../../runtime/jev/route-compile.ts';
import {bindBatch,initialView} from '../../runtime/jev/step-policy.ts';

const root=resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(readFileSync(resolve(root,'mods/daily-life/mod.json'),'utf8'));
const files=new Map([['contexts.json',readFileSync(resolve(root,'mods/daily-life/contexts.json'))]]);
const table={mod:manifest.id,version:manifest.version,threshold:.5,items:JSON.parse(files.get('contexts.json')).items};
const binding={campaign:'c',worldline:'main',loop:0,turn:1};
const capsule=()=>({where:{scene:'house',display_name:'An ordinary house',summary:'A residence',clock:{minutes:0,day:1,hh:'03',mm:'00',day_part:'small_hours'},temporal:{current:true,basis:'established',service:'closed'}},
    historical_setting:{era:'1920 Boston'},present:[{name:'Miriam',activity:{basis:'observed',wakefulness:'awake',current:true}}],known:{flags:{}},pressures:[],recent:[],turn:{player_text:'I knock.'},
    mods:{temporal_context:{providers:[{mod:manifest.id,version:manifest.version,threshold:.5}]}}});
const control=()=>new AbortController();
function answered(batch,choices){return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map((q,i)=>[q.key,{status:'answered',type:'noul',noul:choices?.[i]??.9}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}

test('canonical local time, observed people and returned source scope reach every independent Noul',()=>{
    const c=capsule();
    c.known.flags=[{name:'celebration-under-way',value:true}];
    const references=[{customType:'coc-clerk',content:JSON.stringify({historical_reference_materials:{materials:[{title:'Original diary',url:'https://example.org/diary',applicability:'analogous',excerpts:['Servants were preparing a feast at night.']}]}})}];
    const situation=temporalSituation(c,references);
    assert.equal(situation.clock.local_hour,3);
    assert.equal(situation.people[0].activity.wakefulness,'awake');
    assert.equal(situation.references[0].applicability,'analogous');
    assert.deepEqual(situation.flags,c.known.flags,'the actual capsule flag rows reach the judge');
    const {batch}=temporalAdviceBatch({binding,situation,request:'I knock.',tables:[table]});
    assert.equal(batch.questions.length,table.items.length);
    assert(batch.questions.every(q=>q.type==='noul'));
    assert.equal(batch.state.current_context.setting.era,'1920 Boston');
});
test('several matched items reach a bounded advisory message and identical context reuses the decision',async()=>{
    let reads=0,decisions=0;const logs=[];
    const before=capsule(),copy=structuredClone(before),signal=control().signal;
    const probabilities=table.items.map(item=>['emergency-or-celebration','already-awakened-person'].includes(item.id)?.9:0);
    const service=createTemporalAdvice({read:async()=>{reads++;return {tables:[table]};},decision:()=>({decide:async batch=>{decisions++;return answered(batch,probabilities);}}),record:row=>logs.push(row)});
    const first=await service.message(before,binding,signal);
    assert.equal(first.customType,TEMPORAL_ADVICE_MESSAGE);
    const data=JSON.parse(first.content);
    assert.deepEqual(data.items.map(item=>item.id),['emergency-or-celebration','already-awakened-person']);
    assert.match(data.authority,/not a world fact/);
    assert.deepEqual(before,copy,'a match does not mutate any recorded state');
    assert.equal((await service.message(before,binding,signal)).content,first.content);
    assert.equal(reads,1);assert.equal(decisions,1);
    assert(logs.some(row=>row.event==='matched'));
    service.clear();
});
test('disabled strategy makes no read or decision and retains the clock and observed activity',async()=>{
    let operations=0;const service=createTemporalAdvice({read:async()=>{operations++;},decision:()=>{operations++;},record:()=>{}});
    const c=capsule();delete c.mods.temporal_context;
    assert.equal(await service.message(c,binding,control().signal),undefined);
    assert.equal(operations,0);assert.equal(c.where.clock.hh,'03');assert.equal(c.present[0].activity.wakefulness,'awake');
    service.clear();
});
test('an unavailable judge produces a labelled Keeper fallback without selecting every item',async()=>{
    const service=createTemporalAdvice({read:async()=>({tables:[table]}),decision:()=>undefined,record:()=>{}});
    const note=JSON.parse((await service.message(capsule(),binding,control().signal)).content);
    assert.equal(note.status,'unavailable');assert.equal(note.reason,'unconfigured');assert.deepEqual(note.items,[]);
    service.clear();
});
test('resident guidance uses its own advice channel even when no table item matches',async()=>{
    const guidance=readFileSync(resolve(root,'mods/daily-life/agent.md'),'utf8');
    const service=createTemporalAdvice({read:async()=>({tables:[{...table,guidance}]}),decision:()=>({decide:async batch=>answered(batch,table.items.map(()=>0))}),record:()=>{}});
    const note=JSON.parse((await service.message(capsule(),binding,control().signal)).content);
    assert.deepEqual(note.items,[]);assert.equal(note.guidance[0].text,guidance);
    service.clear();
});
test('an answer for the old clock cannot be delivered after the current context changes',async()=>{
    let release;let calls=0;
    const held=new Promise(resolve=>release=resolve);
    const service=createTemporalAdvice({read:async()=>({tables:[table]}),decision:()=>({decide:async batch=>{calls++;if(calls===1)await held;return answered(batch);}}),record:()=>{},firstWaitMs:1000});
    const first=service.message(capsule(),binding,control().signal);
    await new Promise(resolve=>setImmediate(resolve));
    const later=capsule();later.where.clock={minutes:360,day:1,hh:'09',mm:'00',day_part:'morning'};
    const second=await service.message(later,binding,control().signal);
    release();assert.equal(await first,undefined);assert(second);
    assert.equal(calls,2);service.clear();
});
test('the clerk wire state includes actual availability and outcomes rather than only receipt identifiers',()=>{
    const c=capsule(),status={receipts:[{id:'private-id',call_id:'private-call',kind:'resolve',outcome:{success:false}}]};
    const {context}=readTable(c,status);
    const common={runId:'r',rawInput:'I ask to use the counter.',context,materials:[],candidates:[],observations:[]};
    const batch=compileBatch({...common,rows:{act:[{id:'attempt',describe:'A brief actual attempt'}]}},{owner:'test',audience:'keeper'},[],['act']);
    assert.equal(batch.state.now.temporal.scene.service,'closed');
    assert.deepEqual(batch.state.now.outcomes,[{kind:'resolve',outcome:{success:false}}]);
    const candidate={key:'time',verb:'apply',family:'time',label:'Actual attempt time',source:'rules.bands',bound:{kind:'time'},unbound:[{name:'band',required:true,vocabulary:'closed',options:['brief_activity']} ]};
    const view=initialView({...common,candidates:[candidate]});
    const bound=bindBatch(view,candidate,{owner:'test',audience:'keeper'},[]);
    assert.equal(bound.state.now.temporal.people[0].activity.wakefulness,'awake');
    assert.equal(bound.state.now.outcomes[0].id,undefined);
});
